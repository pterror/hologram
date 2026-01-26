/**
 * Restricted JavaScript expression evaluator for $if conditional facts.
 *
 * Expressions are boolean JS with safe globals:
 *   $if random(0.3): has fox ears
 *   $if hasFact("poisoned") && random(0.5): takes damage
 *   $if time.isNight: glows faintly
 */

// =============================================================================
// Types
// =============================================================================

export interface ExprContext {
  /** Returns true with given probability (0.0-1.0) */
  random: (chance: number) => boolean;
  /** Check if entity has a fact matching pattern */
  has_fact: (pattern: string) => boolean;
  /** Roll dice expression (e.g. "2d6+3"), returns total */
  roll: (dice: string) => number;
  /** Current time info */
  time: {
    hour: number;
    is_day: boolean;
    is_night: boolean;
  };
  /** Milliseconds since last response in channel */
  dt_ms: number;
  /** Milliseconds since triggering message */
  elapsed_ms: number;
  /** Whether the bot was @mentioned */
  mentioned: boolean;
  /** Message content */
  content: string;
  /** Message author name */
  author: string;
  /** Interaction type if applicable (drink, eat, throw, etc.) */
  interaction_type?: string;
  /** Additional context-specific variables */
  [key: string]: unknown;
}

// =============================================================================
// Sanitization
// =============================================================================

// Allowed tokens in expressions
const ALLOWED_PATTERN = /^[\w\s\d.,()[\]!&|<>=+\-*/%?:"']+$/;

// Dangerous patterns to reject
const DANGEROUS_PATTERNS = [
  /\beval\b/,
  /\bFunction\b/,
  /\bconstructor\b/,
  /\bprototype\b/,
  /\b__proto__\b/,
  /\bimport\b/,
  /\bexport\b/,
  /\brequire\b/,
  /\bprocess\b/,
  /\bglobal\b/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bPromise\b/,
  /\basync\b/,
  /\bawait\b/,
  /\bwhile\b/,
  /\bfor\b/,
  /\bdo\b/,
  /\bclass\b/,
  /\bnew\b/,
  /\bthis\b/,
  /\bsuper\b/,
  /\breturn\b/,
  /\bthrow\b/,
  /\btry\b/,
  /\bcatch\b/,
  /\bfinally\b/,
  /\bdelete\b/,
  /\btypeof\b/,
  /\binstanceof\b/,
  /\bvoid\b/,
  /\bin\b/,
  /\bof\b/,
  /\blet\b/,
  /\bconst\b/,
  /\bvar\b/,
  /\bfunction\b/,
  /=>/,        // arrow functions
  /[;{}]/,     // statement separators, blocks
];

export function sanitizeExpr(expr: string): string {
  const trimmed = expr.trim();

  if (!ALLOWED_PATTERN.test(trimmed)) {
    throw new ExprError(`Invalid characters in expression: ${trimmed}`);
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new ExprError(`Dangerous pattern in expression: ${trimmed}`);
    }
  }

  return trimmed;
}

// =============================================================================
// Compilation & Caching
// =============================================================================

const exprCache = new Map<string, (ctx: ExprContext) => boolean>();

export function compileExpr(expr: string): (ctx: ExprContext) => boolean {
  let fn = exprCache.get(expr);
  if (fn) return fn;

  const sanitized = sanitizeExpr(expr);

  // Compile with 'with' to provide context variables as globals
  // This is safe because we've sanitized the expression
  fn = new Function(
    "ctx",
    `with(ctx) { return Boolean(${sanitized}); }`
  ) as (ctx: ExprContext) => boolean;

  exprCache.set(expr, fn);
  return fn;
}

export function evalExpr(expr: string, context: ExprContext): boolean {
  try {
    const fn = compileExpr(expr);
    return fn(context);
  } catch (err) {
    if (err instanceof ExprError) throw err;
    throw new ExprError(`Failed to evaluate expression "${expr}": ${err}`);
  }
}

// =============================================================================
// Comment Stripping
// =============================================================================

/**
 * Strip comments from facts.
 * Comments are lines starting with # in the FIRST column only.
 * Lines starting with space then # are NOT comments (escape mechanism).
 */
export function stripComments(facts: string[]): string[] {
  return facts.filter((fact) => !fact.startsWith("#"));
}

// =============================================================================
// Fact Processing
// =============================================================================

const IF_SIGIL = "$if ";
const RESPOND_SIGIL = "$respond";
const RETRY_SIGIL = "$retry ";

export interface ProcessedFact {
  content: string;
  conditional: boolean;
  expression?: string;
  /** True if this fact is a $respond directive */
  isRespond: boolean;
  /** For $respond directives, whether to respond (true) or suppress (false) */
  respondValue?: boolean;
  /** True if this fact is a $retry directive */
  isRetry: boolean;
  /** For $retry directives, the delay in milliseconds */
  retryMs?: number;
}

/**
 * Parse a fact, detecting $if prefix, $respond, and $retry directives.
 */
export function parseFact(fact: string): ProcessedFact {
  const trimmed = fact.trim();

  if (trimmed.startsWith(IF_SIGIL)) {
    const rest = trimmed.slice(IF_SIGIL.length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) {
      throw new ExprError(`Invalid $if fact, missing colon: ${fact}`);
    }
    const expression = rest.slice(0, colonIdx).trim();
    const content = rest.slice(colonIdx + 1).trim();

    // Check if content is a $respond directive
    const respondResult = parseRespondDirective(content);
    if (respondResult !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: true,
        respondValue: respondResult,
        isRetry: false,
      };
    }

    // Check if content is a $retry directive
    const retryResult = parseRetryDirective(content);
    if (retryResult !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: true,
        retryMs: retryResult,
      };
    }

    return { content, conditional: true, expression, isRespond: false, isRetry: false };
  }

  // Check for unconditional $respond
  const respondResult = parseRespondDirective(trimmed);
  if (respondResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: true,
      respondValue: respondResult,
      isRetry: false,
    };
  }

  // Check for unconditional $retry
  const retryResult = parseRetryDirective(trimmed);
  if (retryResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: true,
      retryMs: retryResult,
    };
  }

  return { content: trimmed, conditional: false, isRespond: false, isRetry: false };
}

/**
 * Parse a $respond directive.
 * Returns null if not a respond directive, true for $respond / $respond true, false for $respond false.
 */
function parseRespondDirective(content: string): boolean | null {
  if (!content.startsWith(RESPOND_SIGIL)) {
    return null;
  }
  const rest = content.slice(RESPOND_SIGIL.length).trim().toLowerCase();
  if (rest === "" || rest === "true") {
    return true;
  }
  if (rest === "false") {
    return false;
  }
  // Not a valid $respond directive (might be $respond_to_something or similar)
  return null;
}

/**
 * Parse a $retry directive.
 * Returns null if not a retry directive, or the delay in ms.
 */
function parseRetryDirective(content: string): number | null {
  if (!content.startsWith(RETRY_SIGIL)) {
    return null;
  }
  const rest = content.slice(RETRY_SIGIL.length).trim();
  const ms = parseInt(rest);
  if (isNaN(ms) || ms < 0) {
    return null;
  }
  return ms;
}

export interface EvaluatedFacts {
  /** Facts that apply (excluding directives) */
  facts: string[];
  /** Whether to respond. null means no $respond directives were present (default true). */
  shouldRespond: boolean | null;
  /** If set, re-evaluate after this many milliseconds. Last fired $retry wins. */
  retryMs: number | null;
}

/**
 * Evaluate a list of facts, returning only those that apply.
 * Non-conditional facts always apply.
 * Conditional facts apply if their expression evaluates to true.
 *
 * Directives (evaluated top to bottom):
 * - $respond / $respond false → control response behavior (last one wins)
 * - $retry <ms> → schedule re-evaluation (early exit)
 */
export function evaluateFacts(
  facts: string[],
  context: ExprContext
): EvaluatedFacts {
  const results: string[] = [];
  let shouldRespond: boolean | null = null;
  let retryMs: number | null = null;

  // Strip comments first
  const uncommented = stripComments(facts);

  for (const fact of uncommented) {
    const parsed = parseFact(fact);

    // Check if this fact applies
    let applies = true;
    if (parsed.conditional && parsed.expression) {
      applies = evalExpr(parsed.expression, context);
    }

    if (!applies) continue;

    // Handle $respond directives - last one wins
    if (parsed.isRespond) {
      shouldRespond = parsed.respondValue ?? true;
      continue;
    }

    // Handle $retry directives - early exit
    if (parsed.isRetry) {
      retryMs = parsed.retryMs ?? null;
      break;
    }

    results.push(parsed.content);
  }

  return { facts: results, shouldRespond, retryMs };
}

// =============================================================================
// Error Type
// =============================================================================

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprError";
  }
}

// =============================================================================
// Context Factory
// =============================================================================

export interface BaseContextOptions {
  has_fact: (pattern: string) => boolean;
  dt_ms?: number;
  elapsed_ms?: number;
  mentioned?: boolean;
  content?: string;
  author?: string;
  interaction_type?: string;
}

/**
 * Create a base context with standard globals.
 * Caller should extend with entity-specific data.
 */
export function createBaseContext(options: BaseContextOptions): ExprContext {
  const now = new Date();
  const hour = now.getHours();

  return {
    random: (chance: number) => Math.random() < chance,
    has_fact: options.has_fact,
    roll: (dice: string) => rollDice(dice),
    time: {
      hour,
      is_day: hour >= 6 && hour < 18,
      is_night: hour < 6 || hour >= 18,
    },
    dt_ms: options.dt_ms ?? 0,
    elapsed_ms: options.elapsed_ms ?? 0,
    mentioned: options.mentioned ?? false,
    content: options.content ?? "",
    author: options.author ?? "",
    interaction_type: options.interaction_type,
  };
}

/**
 * Simple dice roller: "2d6+3" -> random result
 */
function rollDice(expr: string): number {
  const match = expr.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) {
    throw new ExprError(`Invalid dice expression: ${expr}`);
  }

  const count = parseInt(match[1]);
  const sides = parseInt(match[2]);
  const modifier = match[3] ? parseInt(match[3]) : 0;

  let total = modifier;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }

  return total;
}
