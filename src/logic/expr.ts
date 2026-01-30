/**
 * Restricted JavaScript expression evaluator for $if conditional facts.
 *
 * Expressions are boolean JS with safe globals:
 *   $if random() < 0.3: has fox ears
 *   $if has_fact("poisoned") && random() < 0.5: takes damage
 *   $if time.is_night: glows faintly
 *   $if self.fox_tf >= 0.5: has full fur
 */

import { MAX_CONTEXT_CHAR_LIMIT } from "../ai/context";
import { validateRegexPattern } from "./safe-regex";

// =============================================================================
// Types
// =============================================================================

/** Parsed fact values accessible via self.* in expressions */
export type SelfContext = Record<string, string | number | boolean>;

export interface ExprContext {
  /** Entity's own parsed fact values (from "key: value" facts) */
  self: SelfContext;
  /** Returns random float [0,1), or random int [1,max] or [min,max]. */
  random: (min?: number, max?: number) => number;
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
  response_ms: number;
  /** Milliseconds since triggering message (for $retry re-evaluation) */
  retry_ms: number;
  /** Milliseconds since any message in channel */
  idle_ms: number;
  /** Whether the bot was @mentioned */
  mentioned: boolean;
  /** Whether the message is a reply to the bot */
  replied: boolean;
  /** Name of entity that was replied to (empty if not a webhook reply) */
  replied_to: string;
  /** Whether the message is a forwarded message */
  is_forward: boolean;
  /** Whether the message is from this entity's own webhook (self-triggered) */
  is_self: boolean;
  /** Check if a name is mentioned in dialogue (excludes XML tags like <Name>) */
  mentioned_in_dialogue: (name: string) => boolean;
  /** Message content (alias for messages(1, "%m")) */
  content: string;
  /** Message author (alias for messages(1, "%a")) */
  author: string;
  /** Interaction type if applicable (drink, eat, throw, etc.) */
  interaction_type?: string;
  /** This entity's name */
  name: string;
  /** Names of all characters bound to channel */
  chars: string[];
  /** Get the last N messages from the channel. Format: %a=author, %m=message (default "%a: %m"). Filter: "user", "char", or name. */
  messages: (n?: number, format?: string, filter?: string) => string;
  /** Comma-separated names of all characters bound to channel */
  group: string;
  /** Format a duration in ms as human-readable string */
  duration: (ms: number) => string;
  /** Date string, e.g. "Thu Jan 30 2026", with optional offset */
  date_str: (offset?: string) => string;
  /** Time string, e.g. "6:00 PM", with optional offset */
  time_str: (offset?: string) => string;
  /** ISO date "2026-01-30", with optional offset */
  isodate: (offset?: string) => string;
  /** ISO time "18:00", with optional offset */
  isotime: (offset?: string) => string;
  /** Weekday name "Thursday", with optional offset */
  weekday: (offset?: string) => string;
  /** Channel metadata */
  channel: {
    id: string;
    name: string;
    description: string;
    mention: string;
  };
  /** Server metadata */
  server: {
    id: string;
    name: string;
    description: string;
  };
  /** Additional context-specific variables */
  [key: string]: unknown;
}

// =============================================================================
// Tokenizer
// =============================================================================

type TokenType =
  | "number"
  | "string"
  | "boolean"
  | "identifier"
  | "operator"
  | "paren"
  | "dot"
  | "comma"
  | "eof";

interface Token {
  type: TokenType;
  value: string | number | boolean;
  raw: string;
  /** Position in original string where this token starts */
  pos: number;
}

const OPERATORS = [
  "&&", "||", "===", "!==", "==", "!=", "<=", ">=", "<", ">",
  "+", "-", "*", "/", "%", "!", "?", ":"
];

/**
 * Lazy tokenizer that produces tokens on demand.
 * This is crucial for parseCondition to avoid tokenizing content after the colon.
 */
class Tokenizer {
  private expr: string;
  private pos = 0;
  private peeked: Token | null = null;

  constructor(expr: string) {
    this.expr = expr;
  }

  /** Get current position in the expression */
  getPos(): number {
    return this.peeked ? this.peeked.pos : this.pos;
  }

  /** Peek at next token without consuming */
  peek(): Token {
    if (this.peeked) return this.peeked;
    this.peeked = this.nextToken();
    return this.peeked;
  }

  /** Consume and return next token */
  next(): Token {
    if (this.peeked) {
      const t = this.peeked;
      this.peeked = null;
      return t;
    }
    return this.nextToken();
  }

  /** Internal: read the next token from the expression */
  private nextToken(): Token {
    const expr = this.expr;

    // Skip whitespace
    while (this.pos < expr.length && /\s/.test(expr[this.pos])) {
      this.pos++;
    }

    if (this.pos >= expr.length) {
      return { type: "eof", value: "", raw: "", pos: this.pos };
    }

    const start = this.pos;

    // Number
    if (/\d/.test(expr[this.pos]) || (expr[this.pos] === "." && /\d/.test(expr[this.pos + 1]))) {
      let num = "";
      while (this.pos < expr.length && /[\d.]/.test(expr[this.pos])) {
        num += expr[this.pos++];
      }
      return { type: "number", value: parseFloat(num), raw: num, pos: start };
    }

    // String (double or single quotes)
    if (expr[this.pos] === '"' || expr[this.pos] === "'") {
      const quote = expr[this.pos++];
      let str = "";
      while (this.pos < expr.length && expr[this.pos] !== quote) {
        if (expr[this.pos] === "\\") {
          this.pos++; // skip backslash
          if (this.pos < expr.length) str += expr[this.pos++];
        } else {
          str += expr[this.pos++];
        }
      }
      if (expr[this.pos] !== quote) throw new ExprError("Unterminated string");
      this.pos++; // skip closing quote
      return { type: "string", value: str, raw: `${quote}${str}${quote}`, pos: start };
    }

    // Identifier or boolean
    if (/[a-zA-Z_]/.test(expr[this.pos])) {
      let id = "";
      while (this.pos < expr.length && /[a-zA-Z0-9_]/.test(expr[this.pos])) {
        id += expr[this.pos++];
      }
      if (id === "true") {
        return { type: "boolean", value: true, raw: id, pos: start };
      } else if (id === "false") {
        return { type: "boolean", value: false, raw: id, pos: start };
      } else {
        return { type: "identifier", value: id, raw: id, pos: start };
      }
    }

    // Operators (try longest match first)
    for (const op of OPERATORS) {
      if (expr.slice(this.pos, this.pos + op.length) === op) {
        this.pos += op.length;
        return { type: "operator", value: op, raw: op, pos: start };
      }
    }

    // Parentheses
    if (expr[this.pos] === "(" || expr[this.pos] === ")") {
      const ch = expr[this.pos++];
      return { type: "paren", value: ch, raw: ch, pos: start };
    }

    // Dot
    if (expr[this.pos] === ".") {
      this.pos++;
      return { type: "dot", value: ".", raw: ".", pos: start };
    }

    // Comma
    if (expr[this.pos] === ",") {
      this.pos++;
      return { type: "comma", value: ",", raw: ",", pos: start };
    }

    // Unknown character
    throw new ExprError(`Unexpected character: ${expr[this.pos]}`);
  }
}

/** Eager tokenize - used for full expression compilation */
function tokenize(expr: string): Token[] {
  const tokenizer = new Tokenizer(expr);
  const tokens: Token[] = [];
  while (true) {
    const token = tokenizer.next();
    tokens.push(token);
    if (token.type === "eof") break;
  }
  return tokens;
}

// =============================================================================
// Parser & Evaluator
// =============================================================================

type ExprNode =
  | { type: "literal"; value: string | number | boolean }
  | { type: "identifier"; name: string }
  | { type: "member"; object: ExprNode; property: string }
  | { type: "call"; callee: ExprNode; args: ExprNode[] }
  | { type: "unary"; operator: string; operand: ExprNode }
  | { type: "binary"; operator: string; left: ExprNode; right: ExprNode }
  | { type: "ternary"; test: ExprNode; consequent: ExprNode; alternate: ExprNode };

/** Token source interface - works with both eager Token[] and lazy Tokenizer */
interface TokenSource {
  peek(): Token;
  next(): Token;
  getPos(): number;
}

/** Adapter to use Token[] as TokenSource */
class ArrayTokenSource implements TokenSource {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token {
    return this.tokens[this.pos];
  }

  next(): Token {
    return this.tokens[this.pos++];
  }

  getPos(): number {
    return this.tokens[this.pos]?.pos ?? this.tokens[this.tokens.length - 1].pos;
  }
}

class Parser {
  private source: TokenSource;

  constructor(source: Token[] | TokenSource) {
    this.source = Array.isArray(source) ? new ArrayTokenSource(source) : source;
  }

  private peek(): Token {
    return this.source.peek();
  }

  private consume(): Token {
    return this.source.next();
  }

  private expect(type: TokenType, value?: string | number | boolean): Token {
    const token = this.consume();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new ExprError(`Expected ${type}${value !== undefined ? ` '${value}'` : ""}, got ${token.type} '${token.raw}'`);
    }
    return token;
  }

  parse(): ExprNode {
    const node = this.parseTernary();
    if (this.peek().type !== "eof") {
      throw new ExprError(`Unexpected token: ${this.peek().raw}`);
    }
    return node;
  }

  /** Parse expression without expecting EOF, return next token and position */
  parseExprLazy(): { token: Token; pos: number } {
    this.parseTernary();
    return { token: this.peek(), pos: this.source.getPos() };
  }


  private parseTernary(): ExprNode {
    let node = this.parseOr();
    if (this.peek().type === "operator" && this.peek().value === "?") {
      this.consume(); // ?
      const consequent = this.parseTernary();
      this.expect("operator", ":");
      const alternate = this.parseTernary();
      node = { type: "ternary", test: node, consequent, alternate };
    }
    return node;
  }

  private parseOr(): ExprNode {
    let node = this.parseAnd();
    while (this.peek().type === "operator" && this.peek().value === "||") {
      this.consume();
      node = { type: "binary", operator: "||", left: node, right: this.parseAnd() };
    }
    return node;
  }

  private parseAnd(): ExprNode {
    let node = this.parseEquality();
    while (this.peek().type === "operator" && this.peek().value === "&&") {
      this.consume();
      node = { type: "binary", operator: "&&", left: node, right: this.parseEquality() };
    }
    return node;
  }

  private parseEquality(): ExprNode {
    let node = this.parseComparison();
    while (this.peek().type === "operator" && ["==", "!=", "===", "!=="].includes(this.peek().value as string)) {
      const op = this.consume().value as string;
      node = { type: "binary", operator: op, left: node, right: this.parseComparison() };
    }
    return node;
  }

  private parseComparison(): ExprNode {
    let node = this.parseAdditive();
    while (this.peek().type === "operator" && ["<", ">", "<=", ">="].includes(this.peek().value as string)) {
      const op = this.consume().value as string;
      node = { type: "binary", operator: op, left: node, right: this.parseAdditive() };
    }
    return node;
  }

  private parseAdditive(): ExprNode {
    let node = this.parseMultiplicative();
    while (this.peek().type === "operator" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.consume().value as string;
      node = { type: "binary", operator: op, left: node, right: this.parseMultiplicative() };
    }
    return node;
  }

  private parseMultiplicative(): ExprNode {
    let node = this.parseUnary();
    while (this.peek().type === "operator" && ["*", "/", "%"].includes(this.peek().value as string)) {
      const op = this.consume().value as string;
      node = { type: "binary", operator: op, left: node, right: this.parseUnary() };
    }
    return node;
  }

  private parseUnary(): ExprNode {
    if (this.peek().type === "operator" && (this.peek().value === "!" || this.peek().value === "-")) {
      const op = this.consume().value as string;
      return { type: "unary", operator: op, operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  /** Parse member access and calls in a single loop to support chaining like foo().bar().baz */
  private parsePostfix(): ExprNode {
    let node = this.parsePrimary();
    while (true) {
      if (this.peek().type === "dot") {
        this.consume(); // .
        const prop = this.expect("identifier").value as string;
        node = { type: "member", object: node, property: prop };
      } else if (this.peek().type === "paren" && this.peek().value === "(") {
        this.consume(); // (
        const args: ExprNode[] = [];
        if (!(this.peek().type === "paren" && this.peek().value === ")")) {
          args.push(this.parseTernary());
          while (this.peek().type === "comma") {
            this.consume();
            args.push(this.parseTernary());
          }
        }
        this.expect("paren", ")");
        node = { type: "call", callee: node, args };
      } else {
        break;
      }
    }
    return node;
  }

  private parsePrimary(): ExprNode {
    const token = this.peek();

    if (token.type === "number" || token.type === "string" || token.type === "boolean") {
      this.consume();
      return { type: "literal", value: token.value };
    }

    if (token.type === "identifier") {
      this.consume();
      return { type: "identifier", name: token.value as string };
    }

    if (token.type === "paren" && token.value === "(") {
      this.consume();
      const node = this.parseTernary();
      this.expect("paren", ")");
      return node;
    }

    throw new ExprError(`Unexpected token: ${token.raw}`);
  }
}

// Derive allowed globals from ExprContext - TypeScript ensures this stays in sync
const EXPR_CONTEXT_REFERENCE: ExprContext = {
  self: {},
  random: () => 0,
  has_fact: () => false,
  roll: () => 0,
  time: { hour: 0, is_day: false, is_night: false },
  response_ms: 0,
  retry_ms: 0,
  idle_ms: 0,
  mentioned: false,
  replied: false,
  replied_to: "",
  is_forward: false,
  is_self: false,
  mentioned_in_dialogue: () => false,
  content: "",
  author: "",
  name: "",
  chars: [],
  messages: () => "",
  group: "",
  duration: () => "",
  date_str: () => "",
  time_str: () => "",
  isodate: () => "",
  isotime: () => "",
  weekday: () => "",
  interaction_type: "",
  channel: { id: "", name: "", description: "", mention: "" },
  server: { id: "", name: "", description: "" },
};
const ALLOWED_GLOBALS = new Set(Object.keys(EXPR_CONTEXT_REFERENCE));

// Methods that compile their first string argument into a RegExp
const REGEX_METHODS = new Set(["match", "search", "replace", "split"]);

// Methods blocked entirely (no useful expression-language interaction)
const BLOCKED_METHODS: Record<string, string> = {
  matchAll: "matchAll() is not available — use match() instead",
};

// Methods rewritten to use safe wrappers at runtime (memory exhaustion prevention)
const WRAPPED_METHODS = new Set(["repeat", "padStart", "padEnd", "replaceAll", "join"]);

// Blocked property names (prevent prototype chain escapes)
// Uses Map because a plain object's __proto__ key collides with the actual prototype
const BLOCKED_PROPERTIES = new Map([
  ["constructor", "Blocked property: .constructor — accessing constructors could allow sandbox escape"],
  ["__proto__", "Blocked property: .__proto__ — accessing prototypes could allow sandbox escape"],
  ["prototype", "Blocked property: .prototype — accessing prototypes could allow sandbox escape"],
  ["__defineGetter__", "Blocked property: .__defineGetter__ — modifying property descriptors is not allowed"],
  ["__defineSetter__", "Blocked property: .__defineSetter__ — modifying property descriptors is not allowed"],
  ["__lookupGetter__", "Blocked property: .__lookupGetter__ — inspecting property descriptors is not allowed"],
  ["__lookupSetter__", "Blocked property: .__lookupSetter__ — inspecting property descriptors is not allowed"],
]);

// =============================================================================
// Safe Method Wrappers (injected at runtime as $s)
// =============================================================================

/** Max characters a string-producing method can output */
const MAX_STRING_OUTPUT = 100_000;

const SAFE_METHODS = {
  repeat(str: unknown, count: unknown): string {
    if (typeof str !== "string") {
      throw new ExprError("repeat() can only be called on a string");
    }
    const n = Number(count);
    if (!Number.isFinite(n) || n < 0 || n !== Math.floor(n)) {
      throw new ExprError("repeat() count must be a non-negative integer");
    }
    const outputLen = str.length * n;
    if (outputLen > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `repeat(${n}) would produce ${outputLen.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`
      );
    }
    return str.repeat(n);
  },

  padStart(str: unknown, len: unknown, fill?: unknown): string {
    if (typeof str !== "string") {
      throw new ExprError("padStart() can only be called on a string");
    }
    const n = Number(len);
    if (!Number.isFinite(n) || n < 0) {
      throw new ExprError("padStart() length must be a non-negative number");
    }
    if (n > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `padStart(${n}) target length exceeds limit (${MAX_STRING_OUTPUT.toLocaleString()})`
      );
    }
    return fill !== undefined ? str.padStart(n, String(fill)) : str.padStart(n);
  },

  padEnd(str: unknown, len: unknown, fill?: unknown): string {
    if (typeof str !== "string") {
      throw new ExprError("padEnd() can only be called on a string");
    }
    const n = Number(len);
    if (!Number.isFinite(n) || n < 0) {
      throw new ExprError("padEnd() length must be a non-negative number");
    }
    if (n > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `padEnd(${n}) target length exceeds limit (${MAX_STRING_OUTPUT.toLocaleString()})`
      );
    }
    return fill !== undefined ? str.padEnd(n, String(fill)) : str.padEnd(n);
  },

  replaceAll(str: unknown, search: unknown, replacement: unknown): string {
    if (typeof str !== "string") {
      throw new ExprError("replaceAll() can only be called on a string");
    }
    const result = str.replaceAll(String(search), String(replacement));
    if (result.length > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `replaceAll() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`
      );
    }
    return result;
  },

  join(arr: unknown, sep?: unknown): string {
    if (!Array.isArray(arr)) {
      throw new ExprError("join() can only be called on an array");
    }
    const result = sep !== undefined ? arr.join(String(sep)) : arr.join();
    if (result.length > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `join() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`
      );
    }
    return result;
  },
};

/**
 * Generate JS code from AST. Since we control the AST structure,
 * the generated code is safe to execute.
 *
 * @param extraGlobals - Optional set of additional allowed identifiers (e.g. for-loop variables in templates)
 */
function generateCode(node: ExprNode, extraGlobals?: Set<string>): string {
  switch (node.type) {
    case "literal":
      if (typeof node.value === "string") {
        return JSON.stringify(node.value);
      }
      return String(node.value);

    case "identifier":
      if (!ALLOWED_GLOBALS.has(node.name) && !extraGlobals?.has(node.name)) {
        throw new ExprError(`Unknown identifier: ${node.name}`);
      }
      return `ctx.${node.name}`;

    case "member": {
      // Block dangerous property names that could escape the sandbox
      const blockedMsg = BLOCKED_PROPERTIES.get(node.property);
      if (blockedMsg) {
        throw new ExprError(blockedMsg);
      }
      // Block methods that are unusable or dangerous
      if (node.property in BLOCKED_METHODS) {
        throw new ExprError(BLOCKED_METHODS[node.property]);
      }
      return `(${generateCode(node.object, extraGlobals)}?.${node.property})`;
    }

    case "call": {
      if (node.callee.type === "member") {
        // Validate regex patterns for methods that compile strings to RegExp
        if (REGEX_METHODS.has(node.callee.property)) {
          const firstArg = node.args[0];
          if (!firstArg || firstArg.type !== "literal" || typeof firstArg.value !== "string") {
            throw new ExprError(
              `${node.callee.property}() requires a string literal pattern ` +
              `(dynamic patterns are not allowed for security)`
            );
          }
          validateRegexPattern(firstArg.value as string);
        }
        // Rewrite memory-dangerous methods to use safe wrappers
        if (WRAPPED_METHODS.has(node.callee.property)) {
          const obj = generateCode(node.callee.object, extraGlobals);
          const args = node.args.map(a => generateCode(a, extraGlobals)).join(", ");
          return `$s.${node.callee.property}(${obj}${args ? ", " + args : ""})`;
        }
      }
      const callee = generateCode(node.callee, extraGlobals);
      const args = node.args.map(a => generateCode(a, extraGlobals)).join(", ");
      return `${callee}(${args})`;
    }

    case "unary":
      return `(${node.operator}${generateCode(node.operand, extraGlobals)})`;

    case "binary":
      return `(${generateCode(node.left, extraGlobals)} ${node.operator} ${generateCode(node.right, extraGlobals)})`;

    case "ternary":
      return `(${generateCode(node.test, extraGlobals)} ? ${generateCode(node.consequent, extraGlobals)} : ${generateCode(node.alternate, extraGlobals)})`;
  }
}

// =============================================================================
// Compilation & Caching
// =============================================================================

const exprCache = new Map<string, (ctx: ExprContext) => boolean>();

export function compileExpr(expr: string): (ctx: ExprContext) => boolean {
  let fn = exprCache.get(expr);
  if (fn) return fn;

  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const code = generateCode(ast);

  // Safe: we generated this code from a validated AST
  // $s provides safe wrappers for memory-dangerous methods (repeat, padStart, padEnd)
  const raw = new Function("ctx", "$s", `return Boolean(${code})`);
  fn = (ctx: ExprContext) => raw(ctx, SAFE_METHODS);

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

// Separate cache for template expressions (returns raw value, supports extraGlobals)
const templateExprCache = new Map<string, (ctx: ExprContext) => unknown>();

/**
 * Compile an expression for use in templates.
 * Returns the raw value (not cast to boolean).
 * Accepts optional extra allowed identifiers (e.g. for-loop variables).
 */
export function compileTemplateExpr(
  expr: string,
  extraGlobals?: Set<string>
): (ctx: ExprContext) => unknown {
  const cacheKey = extraGlobals && extraGlobals.size > 0
    ? `${expr}\0${[...extraGlobals].sort().join(",")}`
    : expr;

  let fn = templateExprCache.get(cacheKey);
  if (fn) return fn;

  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const code = generateCode(ast, extraGlobals);

  const raw = new Function("ctx", "$s", `return (${code})`);
  fn = (ctx: ExprContext) => raw(ctx, SAFE_METHODS);
  templateExprCache.set(cacheKey, fn);
  return fn;
}

// Separate cache for macro expressions (returns raw value, not boolean)
const macroExprCache = new Map<string, (ctx: ExprContext) => unknown>();

function compileMacroExpr(expr: string): (ctx: ExprContext) => unknown {
  let fn = macroExprCache.get(expr);
  if (fn) return fn;

  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const code = generateCode(ast);

  const raw = new Function("ctx", "$s", `return (${code})`);
  fn = (ctx: ExprContext) => raw(ctx, SAFE_METHODS);
  macroExprCache.set(expr, fn);
  return fn;
}

/**
 * Evaluate an expression and return its string value (for macro expansion).
 * Returns "" for null/undefined results.
 */
export function evalMacroValue(expr: string, context: ExprContext): string {
  try {
    const fn = compileMacroExpr(expr);
    const result = fn(context);
    if (result == null) return "";
    return String(result);
  } catch (err) {
    if (err instanceof ExprError) throw err;
    throw new ExprError(`Failed to evaluate macro "${expr}": ${err}`);
  }
}

// =============================================================================
// Comment Stripping
// =============================================================================

/**
 * Strip comments from facts.
 * Comments are lines starting with $# in the FIRST column only.
 * Lines starting with space then $# are NOT comments (escape mechanism).
 */
export function stripComments(facts: string[]): string[] {
  return facts.filter((fact) => !fact.startsWith("$#"));
}

// =============================================================================
// Fact Processing
// =============================================================================

const IF_SIGIL = "$if ";
const RESPOND_SIGIL = "$respond";
const RETRY_SIGIL = "$retry ";
const AVATAR_SIGIL = "$avatar ";
const LOCKED_SIGIL = "$locked";
const EDIT_SIGIL = "$edit ";
const VIEW_SIGIL = "$view ";
const BLACKLIST_SIGIL = "$blacklist ";
const USE_SIGIL = "$use ";
const STREAM_SIGIL = "$stream";
const MEMORY_SIGIL = "$memory";
const CONTEXT_SIGIL = "$context";
const FREEFORM_SIGIL = "$freeform";
const MODEL_SIGIL = "$model ";
const STRIP_SIGIL = "$strip";

/** Memory retrieval scope */
export type MemoryScope = "none" | "channel" | "guild" | "global";

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
  /** True if this fact is a $avatar directive */
  isAvatar: boolean;
  /** For $avatar directives, the URL */
  avatarUrl?: string;
  /** True if this is a pure $locked directive (locks entire entity) */
  isLockedDirective: boolean;
  /** True if this fact has $locked prefix (fact is locked but still visible) */
  isLockedFact: boolean;
  /** True if this fact is a $stream directive */
  isStream: boolean;
  /** For $stream directives, the mode */
  streamMode?: "lines" | "full";
  /** For $stream directives with custom delimiters (default: newline) */
  streamDelimiter?: string[];
  /** True if this fact is a $memory directive */
  isMemory: boolean;
  /** For $memory directives, the scope */
  memoryScope?: MemoryScope;
  /** True if this fact is a $context directive */
  isContext: boolean;
  /** For $context directives, the expression string (e.g. "chars < 16000") */
  contextExpr?: string;
  /** True if this fact is a $freeform directive */
  isFreeform: boolean;
  /** True if this fact is a permission directive ($edit, $view, $blacklist) */
  isPermission: boolean;
  /** True if this fact is a $model directive */
  isModel: boolean;
  /** For $model directives, the model spec (e.g. "google:gemini-2.0-flash") */
  modelSpec?: string;
  /** True if this fact is a $strip directive */
  isStrip: boolean;
  /** For $strip directives, the patterns to strip */
  stripPatterns?: string[];
}

/** Parse expression, expect ':', return position after ':' */
/** Parse expression lazily, expect ':', return position after ':' */
function parseCondition(str: string): number {
  // Use lazy tokenization to avoid parsing content after the colon.
  // This prevents "Unterminated string" errors when content contains apostrophes.
  const tokenizer = new Tokenizer(str);
  const parser = new Parser(tokenizer);
  const { token, pos } = parser.parseExprLazy();
  if (token.type !== "operator" || token.value !== ":") {
    throw new ExprError(`Expected ':'`);
  }
  return pos + 1;
}

/**
 * Parse a fact, detecting $if prefix, $respond, $retry, $locked directives.
 */
export function parseFact(fact: string): ProcessedFact {
  const trimmed = fact.trim();

  // Check for $locked directive or prefix
  const lockedResult = parseLockedDirective(trimmed);
  if (lockedResult !== null) {
    if (lockedResult.isDirective) {
      // Pure $locked directive - locks entire entity
      return {
        content: trimmed,
        conditional: false,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: true,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isPermission: false,
        isModel: false,
        isStrip: false,
      };
    } else {
      // $locked prefix - recursively parse the rest, then mark as locked
      const inner = parseFact(lockedResult.content);
      inner.isLockedFact = true;
      return inner;
    }
  }

  if (trimmed.startsWith(IF_SIGIL)) {
    const rest = trimmed.slice(IF_SIGIL.length);
    const colonEnd = parseCondition(rest);
    const expression = rest.slice(0, colonEnd - 1).trim();
    const content = rest.slice(colonEnd).trim();

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
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isPermission: false,
        isModel: false,
        isStrip: false,
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
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isPermission: false,
        isModel: false,
        isStrip: false,
      };
    }

    // Check if content is a $stream directive
    const streamResultCond = parseStreamDirective(content);
    if (streamResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: true,
        streamMode: streamResultCond.mode,
        streamDelimiter: streamResultCond.delimiter,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isPermission: false,
        isModel: false,
        isStrip: false,
      };
    }

    // Check if content is a $memory directive
    const memoryResultCond = parseMemoryDirective(content);
    if (memoryResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: true,
        memoryScope: memoryResultCond,
        isContext: false,
        isFreeform: false,
        isPermission: false,
        isModel: false,
        isStrip: false,
      };
    }

    // Check if content is a $context directive
    const contextResultCond = parseContextDirective(content);
    if (contextResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: true,
        contextExpr: contextResultCond,
        isFreeform: false,
        isPermission: false,
        isModel: false,
        isStrip: false,
      };
    }

    // Check if content is a $freeform directive
    if (content === FREEFORM_SIGIL) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: true,
        isPermission: false,
        isModel: false,
        isStrip: false,
      };
    }

    // Check if content is a $model directive
    const modelResultCond = parseModelDirective(content);
    if (modelResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isPermission: false,
        isModel: true,
        modelSpec: modelResultCond,
        isStrip: false,
      };
    }

    // Check if content is a $strip directive
    const stripResultCond = parseStripDirective(content);
    if (stripResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isPermission: false,
        isModel: false,
        isStrip: true,
        stripPatterns: stripResultCond,
      };
    }

    // Check if content is a permission directive ($edit, $view, $blacklist, $use)
    if (content.startsWith(EDIT_SIGIL) || content.startsWith(VIEW_SIGIL) || content.startsWith(BLACKLIST_SIGIL) || content.startsWith(USE_SIGIL)) {
      return { content, conditional: true, expression, isRespond: false, isRetry: false, isAvatar: false, isLockedDirective: false, isLockedFact: false, isStream: false, isMemory: false, isContext: false, isFreeform: false, isPermission: true, isModel: false, isStrip: false };
    }

    return { content, conditional: true, expression, isRespond: false, isRetry: false, isAvatar: false, isLockedDirective: false, isLockedFact: false, isStream: false, isMemory: false, isContext: false, isFreeform: false, isPermission: false, isModel: false, isStrip: false };
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
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isPermission: false,
      isModel: false,
      isStrip: false,
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
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isPermission: false,
      isModel: false,
      isStrip: false,
    };
  }

  // Check for $avatar
  const avatarResult = parseAvatarDirective(trimmed);
  if (avatarResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: true,
      avatarUrl: avatarResult,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isPermission: false,
      isModel: false,
      isStrip: false,
    };
  }

  // Check for unconditional $stream
  const streamResult = parseStreamDirective(trimmed);
  if (streamResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: true,
      streamMode: streamResult.mode,
      streamDelimiter: streamResult.delimiter,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isPermission: false,
      isModel: false,
      isStrip: false,
    };
  }

  // Check for unconditional $memory
  const memoryResult = parseMemoryDirective(trimmed);
  if (memoryResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: true,
      memoryScope: memoryResult,
      isContext: false,
      isFreeform: false,
      isPermission: false,
      isModel: false,
      isStrip: false,
    };
  }

  // Check for unconditional $context
  const contextResult = parseContextDirective(trimmed);
  if (contextResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: true,
      contextExpr: contextResult,
      isFreeform: false,
      isPermission: false,
      isModel: false,
      isStrip: false,
    };
  }

  // Check for unconditional $freeform
  if (trimmed === FREEFORM_SIGIL) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
        isFreeform: true,
        isPermission: false,
        isModel: false,
        isStrip: false,
      };
  }

  // Check for unconditional $model
  const modelResult = parseModelDirective(trimmed);
  if (modelResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isPermission: false,
      isModel: true,
      modelSpec: modelResult,
      isStrip: false,
    };
  }

  // Check for unconditional $strip
  const stripResult = parseStripDirective(trimmed);
  if (stripResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isPermission: false,
      isModel: false,
      isStrip: true,
      stripPatterns: stripResult,
    };
  }

  // Check for permission directives ($edit, $view, $blacklist, $use)
  if (trimmed.startsWith(EDIT_SIGIL) || trimmed.startsWith(VIEW_SIGIL) || trimmed.startsWith(BLACKLIST_SIGIL) || trimmed.startsWith(USE_SIGIL)) {
    return { content: trimmed, conditional: false, isRespond: false, isRetry: false, isAvatar: false, isLockedDirective: false, isLockedFact: false, isStream: false, isMemory: false, isContext: false, isFreeform: false, isPermission: true, isModel: false, isStrip: false };
  }

  return { content: trimmed, conditional: false, isRespond: false, isRetry: false, isAvatar: false, isLockedDirective: false, isLockedFact: false, isStream: false, isMemory: false, isContext: false, isFreeform: false, isPermission: false, isModel: false, isStrip: false };
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

/**
 * Parse a $avatar directive.
 * Returns null if not an avatar directive, or the URL.
 */
function parseAvatarDirective(content: string): string | null {
  if (!content.startsWith(AVATAR_SIGIL)) {
    return null;
  }
  const url = content.slice(AVATAR_SIGIL.length).trim();
  if (!url) {
    return null;
  }
  return url;
}

/**
 * Parse a $locked directive or prefix.
 * Returns null if not a locked directive.
 * Returns { isDirective: true } for pure "$locked" (locks entity).
 * Returns { isDirective: false, content: "..." } for "$locked <fact>" (locks that fact).
 */
function parseLockedDirective(content: string): { isDirective: true } | { isDirective: false; content: string } | null {
  if (!content.startsWith(LOCKED_SIGIL)) {
    return null;
  }
  const rest = content.slice(LOCKED_SIGIL.length);
  // Pure $locked directive (nothing after, or just whitespace)
  if (rest.trim() === "") {
    return { isDirective: true };
  }
  // $locked prefix - must have space after sigil
  if (rest.startsWith(" ")) {
    return { isDirective: false, content: rest.trim() };
  }
  // Not a valid $locked (e.g., $lockedOut would not match)
  return null;
}

interface StreamDirectiveResult {
  mode: "lines" | "full";
  delimiter?: string[];
}

/**
 * Parse a $stream directive.
 * Returns null if not a stream directive, or the stream mode and optional delimiter.
 *
 * Modes:
 * - default (no keyword): new message per delimiter, sent when complete (no editing)
 * - "full": message(s) edited progressively as content streams
 *   - Without delimiter: single message for entire response
 *   - With delimiter: new message per delimiter, each edited progressively
 *
 * Syntax:
 * - $stream → new message per newline, sent complete
 * - $stream "delim" → new message per delimiter, sent complete
 * - $stream "a" "b" "c" → new message per any of these delimiters, sent complete
 * - $stream full → single message, edited progressively
 * - $stream full "delim" → new message per delimiter, each edited progressively
 * - $stream full "a" "b" → new message per any delimiter, each edited progressively
 */
function parseStreamDirective(content: string): StreamDirectiveResult | null {
  if (!content.startsWith(STREAM_SIGIL)) {
    return null;
  }
  let rest = content.slice(STREAM_SIGIL.length).trim();

  // Extract all quoted delimiters
  let delimiter: string[] | undefined;
  const quoteMatches = [...rest.matchAll(/["']([^"']+)["']/g)];
  if (quoteMatches.length > 0) {
    delimiter = quoteMatches.map(m => m[1]);
    rest = rest.replace(/["']([^"']+)["']/g, "").trim().toLowerCase();
  } else {
    rest = rest.toLowerCase();
  }

  // Parse mode
  let mode: "lines" | "full" = "lines";
  if (rest === "") {
    mode = "lines";
  } else if (rest === "full") {
    mode = "full";
  } else {
    // Unknown mode
    return null;
  }

  return { mode, delimiter };
}

/**
 * Parse a $model directive.
 * Returns null if not a model directive, or the model spec string.
 * Validates provider:model format.
 */
function parseModelDirective(content: string): string | null {
  if (!content.startsWith(MODEL_SIGIL)) {
    return null;
  }
  const spec = content.slice(MODEL_SIGIL.length).trim();
  if (!spec || !/^[^:]+:.+$/.test(spec)) {
    return null;
  }
  return spec;
}

/**
 * Parse a $strip directive.
 * Returns null if not a strip directive, or the array of patterns to strip.
 *
 * Syntax:
 * - $strip → explicit no-strip (empty array, disables default stripping)
 * - $strip "</blockquote>" → strip this pattern
 * - $strip "a" "b" "c" → strip any of these patterns
 *
 * Supports escape sequences: \n, \t, \\
 */
function parseStripDirective(content: string): string[] | null {
  if (!content.startsWith(STRIP_SIGIL)) {
    return null;
  }
  const rest = content.slice(STRIP_SIGIL.length);
  // Must be bare $strip or $strip followed by space
  if (rest !== "" && !rest.startsWith(" ")) {
    return null;
  }
  const trimmed = rest.trim();

  // Bare $strip → explicit empty (disable stripping)
  if (trimmed === "") {
    return [];
  }

  // Extract all quoted patterns
  const patterns: string[] = [];
  const quoteMatches = [...trimmed.matchAll(/["']([^"']+)["']/g)];
  if (quoteMatches.length === 0) {
    return null; // Has content but no quoted strings → invalid
  }
  for (const m of quoteMatches) {
    // Unescape sequences
    const unescaped = m[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
    patterns.push(unescaped);
  }
  return patterns;
}

/**
 * Parse a $memory directive.
 * Returns null if not a memory directive, or the scope.
 *
 * Syntax:
 * - $memory → defaults to "none" (no retrieval)
 * - $memory none → no memory retrieval (default)
 * - $memory channel → retrieve memories from current channel
 * - $memory guild → retrieve memories from all channels in server
 * - $memory global → retrieve all memories
 */
function parseMemoryDirective(content: string): MemoryScope | null {
  if (!content.startsWith(MEMORY_SIGIL)) {
    return null;
  }
  const rest = content.slice(MEMORY_SIGIL.length).trim().toLowerCase();

  if (rest === "" || rest === "none") {
    return "none";
  }
  if (rest === "channel") {
    return "channel";
  }
  if (rest === "guild") {
    return "guild";
  }
  if (rest === "global") {
    return "global";
  }

  // Unknown scope - not a valid $memory directive
  return null;
}


/**
 * Parse a $context directive.
 * Returns null if not a context directive, or the context expression string.
 *
 * Syntax:
 * - $context 8000 → "chars < 8000" (backwards compat)
 * - $context 8k → "chars < 8000" (backwards compat)
 * - $context chars < 16000 → "chars < 16000"
 * - $context (chars < 4000 || count < 20) && age_h < 12 → expression
 */
function parseContextDirective(content: string): string | null {
  if (!content.startsWith(CONTEXT_SIGIL)) {
    return null;
  }
  const rest = content.slice(CONTEXT_SIGIL.length).trim();

  if (rest === "") {
    return null; // Need a value
  }

  // Backwards compat: parse number with optional 'k' suffix → convert to "chars < N"
  const numMatch = rest.toLowerCase().match(/^(\d+(?:\.\d+)?)(k)?$/);
  if (numMatch) {
    let value = parseFloat(numMatch[1]);
    if (numMatch[2] === "k") {
      value *= 1000;
    }
    const limit = Math.min(Math.floor(value), MAX_CONTEXT_CHAR_LIMIT);
    return `chars < ${limit}`;
  }

  // Otherwise treat as expression
  return rest;
}

// =============================================================================
// Context Expression Compiler
// =============================================================================

/** Variables available in $context expressions */
export interface ContextExprVars {
  /** Cumulative characters including current message */
  chars: number;
  /** Number of messages accumulated so far (0-indexed) */
  count: number;
  /** Current message age in milliseconds */
  age: number;
  /** Current message age in hours */
  age_h: number;
  /** Current message age in minutes */
  age_m: number;
  /** Current message age in seconds */
  age_s: number;
}

const CONTEXT_EXPR_PARAMS = ["chars", "count", "age", "age_h", "age_m", "age_s"] as const;
const CONTEXT_ALLOWED_IDENTS = new Set<string>([...CONTEXT_EXPR_PARAMS, "true", "false", "Infinity", "NaN"]);

/**
 * Compile a $context expression into a reusable predicate.
 * Returns a function that evaluates the expression with the given variables.
 * The expression should return truthy to include the message.
 */
export function compileContextExpr(expr: string): (vars: ContextExprVars) => boolean {
  // Validate identifiers: only allow context-specific variables
  const identPattern = /[a-zA-Z_][a-zA-Z0-9_]*/g;
  let m;
  while ((m = identPattern.exec(expr)) !== null) {
    if (!CONTEXT_ALLOWED_IDENTS.has(m[0])) {
      throw new Error(`Unknown identifier in $context expression: "${m[0]}". Allowed: ${CONTEXT_EXPR_PARAMS.join(", ")}`);
    }
  }

  try {
    const fn = new Function(...CONTEXT_EXPR_PARAMS, `"use strict"; return !!(${expr})`);
    return (vars) => fn(vars.chars, vars.count, vars.age, vars.age_h, vars.age_m, vars.age_s) as boolean;
  } catch (e) {
    throw new Error(`Invalid $context expression: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface EvaluatedFacts {
  /** Facts that apply (excluding directives) */
  facts: string[];
  /** Whether to respond. null means no $respond directives were present (default true). */
  shouldRespond: boolean | null;
  /** The fact/directive that set shouldRespond (for debugging) */
  respondSource: string | null;
  /** If set, re-evaluate after this many milliseconds. Last fired $retry wins. */
  retryMs: number | null;
  /** Avatar URL if $avatar directive was present */
  avatarUrl: string | null;
  /** True if $locked directive present (entity is locked from LLM modification) */
  isLocked: boolean;
  /** Set of fact content strings that are locked (from $locked prefix) */
  lockedFacts: Set<string>;
  /** Stream mode if $stream directive present */
  streamMode: "lines" | "full" | null;
  /** Custom delimiters for streaming (default: newline) */
  streamDelimiter: string[] | null;
  /** Memory retrieval scope (default: "none" = no retrieval) */
  memoryScope: MemoryScope;
  /** Context expression if $context directive present (e.g. "chars < 16000") */
  contextExpr: string | null;
  /** True if $freeform directive present (multi-char responses not split) */
  isFreeform: boolean;
  /** Model spec from $model directive (e.g. "google:gemini-2.0-flash"), last wins */
  modelSpec: string | null;
  /** Strip patterns from $strip directive. null = no directive (use default), [] = explicit no-strip */
  stripPatterns: string[] | null;
}

/**
 * Evaluate a list of facts, returning only those that apply.
 * Non-conditional facts always apply.
 * Conditional facts apply if their expression evaluates to true.
 *
 * Directives (evaluated top to bottom):
 * - $respond / $respond false → control response behavior (last one wins)
 * - $retry <ms> → schedule re-evaluation (early exit)
 * - $locked → lock entity from LLM modification
 * - $locked <fact> → lock specific fact from LLM modification
 */
export function evaluateFacts(
  facts: string[],
  context: ExprContext
): EvaluatedFacts {
  const results: string[] = [];
  let shouldRespond: boolean | null = null;
  let respondSource: string | null = null;
  let retryMs: number | null = null;
  let avatarUrl: string | null = null;
  let isLocked = false;
  const lockedFacts = new Set<string>();
  let streamMode: "lines" | "full" | null = null;
  let streamDelimiter: string[] | null = null;
  let memoryScope: MemoryScope = "none";
  let contextExpr: string | null = null;
  let isFreeform = false;
  let modelSpec: string | null = null;
  let stripPatterns: string[] | null = null;

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

    // Handle $locked directive - locks entire entity
    if (parsed.isLockedDirective) {
      isLocked = true;
      continue;
    }

    // Handle $locked prefix - fact is locked but visible
    if (parsed.isLockedFact) {
      lockedFacts.add(parsed.content);
      results.push(parsed.content);
      continue;
    }

    // Handle $respond directives - last one wins
    if (parsed.isRespond) {
      shouldRespond = parsed.respondValue ?? true;
      respondSource = fact;
      continue;
    }

    // Handle $retry directives - early exit
    if (parsed.isRetry) {
      retryMs = parsed.retryMs ?? null;
      break;
    }

    // Handle $avatar directives - last one wins
    if (parsed.isAvatar) {
      avatarUrl = parsed.avatarUrl ?? null;
      continue;
    }

    // Handle $stream directives - last one wins
    if (parsed.isStream) {
      streamMode = parsed.streamMode ?? null;
      streamDelimiter = parsed.streamDelimiter ?? null;
      continue;
    }

    // Handle $memory directives - last one wins
    if (parsed.isMemory) {
      memoryScope = parsed.memoryScope ?? "none";
      continue;
    }

    // Handle $context directives - last one wins
    if (parsed.isContext) {
      contextExpr = parsed.contextExpr ?? null;
      continue;
    }

    // Handle $freeform directive
    if (parsed.isFreeform) {
      isFreeform = true;
      continue;
    }

    // Handle $model directives - last one wins, strip from LLM context
    if (parsed.isModel) {
      modelSpec = parsed.modelSpec ?? null;
      continue;
    }

    // Handle $strip directives - last one wins, strip from LLM context
    if (parsed.isStrip) {
      stripPatterns = parsed.stripPatterns ?? [];
      continue;
    }

    // Handle permission directives ($edit, $view, $blacklist) - strip from LLM context
    if (parsed.isPermission) {
      continue;
    }

    results.push(parsed.content);
  }

  return { facts: results, shouldRespond, respondSource, retryMs, avatarUrl, isLocked, lockedFacts, streamMode, streamDelimiter, memoryScope, contextExpr, isFreeform, modelSpec, stripPatterns };
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
// Self Context Parsing
// =============================================================================

/** Pattern for "key: value" facts */
const KEY_VALUE_PATTERN = /^([a-z_][a-z0-9_]*)\s*:\s*(.+)$/i;

/**
 * Parse a value string into typed value (number, boolean, or string).
 */
function parseValue(value: string): string | number | boolean {
  const trimmed = value.trim();

  // Boolean
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Number (including decimals)
  const num = parseFloat(trimmed);
  if (!isNaN(num) && String(num) === trimmed) return num;

  // String (default)
  return trimmed;
}

/**
 * Parse facts into a self context object.
 * Facts matching "key: value" pattern are extracted.
 * Other facts are ignored.
 *
 * Uses Object.create(null) so there's no prototype chain -
 * no constructor, __proto__, etc. to worry about.
 */
export function parseSelfContext(facts: string[]): SelfContext {
  const self: SelfContext = Object.create(null);

  for (const fact of facts) {
    // Skip comments
    if (fact.startsWith("$#")) continue;

    // Skip $if directives (we want raw facts)
    if (fact.trim().startsWith("$if ")) continue;

    const match = fact.match(KEY_VALUE_PATTERN);
    if (match) {
      const [, key, value] = match;
      self[key] = parseValue(value);
    }
  }

  return self;
}

// =============================================================================
// Context Factory
// =============================================================================

export interface BaseContextOptions {
  /** Entity's raw facts (used to build self context) */
  facts?: string[];
  /** Function to check if entity has a fact matching pattern */
  has_fact: (pattern: string) => boolean;
  /** Function to get the last N messages from the channel. Format: %a=author, %m=message. Filter: "user", "char", or name. */
  messages?: (n?: number, format?: string, filter?: string) => string;
  response_ms?: number;
  retry_ms?: number;
  idle_ms?: number;
  mentioned?: boolean;
  replied?: boolean;
  /** Name of entity that was replied to (for webhook replies) */
  replied_to?: string;
  is_forward?: boolean;
  /** Whether the message is from this entity's own webhook */
  is_self?: boolean;
  interaction_type?: string;
  /** This entity's name */
  name?: string;
  /** Names of all characters bound to channel */
  chars?: string[];
  /** Explicit group string override (defaults to chars joined) */
  group?: string;
  /** Channel metadata */
  channel?: { id: string; name: string; description: string; mention: string };
  /** Server metadata */
  server?: { id: string; name: string; description: string };
}

/**
 * Check if a name is mentioned in dialogue (quoted text).
 * If content has quotation marks OR multiple paragraphs, only checks within quotes.
 * Otherwise checks the full content (simple single-line messages).
 */
function checkMentionedInDialogue(content: string, name: string): boolean {
  if (!name) return false;

  // Extract all quoted portions (both " and ')
  const quotePattern = /["']([^"']+)["']/g;
  const quotedParts: string[] = [];
  let match;
  while ((match = quotePattern.exec(content)) !== null) {
    quotedParts.push(match[1]);
  }

  // Check if content has multiple paragraphs (contains newlines)
  const hasMultipleParagraphs = content.includes("\n");
  const hasQuotes = quotedParts.length > 0;

  // If there are quotes OR multiple paragraphs, only check within quoted parts
  // (If there are multiple paragraphs but no quotes, nothing to check → return false)
  let textToCheck: string;
  if (hasQuotes || hasMultipleParagraphs) {
    if (!hasQuotes) return false; // Multiple paragraphs but no quotes
    textToCheck = quotedParts.join(" ");
  } else {
    textToCheck = content;
  }

  // Word boundary check for the name
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namePattern = new RegExp(`\\b${escapedName}\\b`, "i");
  return namePattern.test(textToCheck);
}

/**
 * Create a base context with standard globals.
 * Caller should extend with entity-specific data.
 */
export function createBaseContext(options: BaseContextOptions): ExprContext {
  const now = new Date();
  const hour = now.getHours();
  const messages = options.messages ?? (() => "");
  const chars = options.chars ?? [];

  return {
    self: parseSelfContext(options.facts ?? []),
    random: (min?: number, max?: number) => {
      if (min === undefined) return Math.random();
      if (max === undefined) return Math.floor(Math.random() * min) + 1; // 1 to min
      return Math.floor(min + Math.random() * (max - min + 1)); // min to max inclusive
    },
    has_fact: options.has_fact,
    roll: (dice: string) => rollDice(dice),
    time: Object.assign(Object.create(null), {
      hour,
      is_day: hour >= 6 && hour < 18,
      is_night: hour < 6 || hour >= 18,
    }),
    response_ms: options.response_ms ?? 0,
    retry_ms: options.retry_ms ?? 0,
    idle_ms: options.idle_ms ?? 0,
    mentioned: options.mentioned ?? false,
    replied: options.replied ?? false,
    replied_to: options.replied_to ?? "",
    is_forward: options.is_forward ?? false,
    is_self: options.is_self ?? false,
    mentioned_in_dialogue: (name: string) => checkMentionedInDialogue(messages(1, "%m"), name),
    content: messages(1, "%m"),
    author: messages(1, "%a"),
    interaction_type: options.interaction_type,
    name: options.name ?? "",
    chars,
    messages,
    group: options.group ?? chars.join(", "),
    duration: (ms: number) => formatDuration(ms),
    date_str: (offset?: string) => {
      const d = offset ? applyOffset(now, offset) : now;
      return d.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
    },
    time_str: (offset?: string) => {
      const d = offset ? applyOffset(now, offset) : now;
      return d.toLocaleTimeString("en-US");
    },
    isodate: (offset?: string) => {
      const d = offset ? applyOffset(now, offset) : now;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    isotime: (offset?: string) => {
      const d = offset ? applyOffset(now, offset) : now;
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    },
    weekday: (offset?: string) => {
      const d = offset ? applyOffset(now, offset) : now;
      return d.toLocaleDateString("en-US", { weekday: "long" });
    },
    channel: Object.assign(Object.create(null), options.channel ?? { id: "", name: "", description: "", mention: "" }),
    server: Object.assign(Object.create(null), options.server ?? { id: "", name: "", description: "" }),
  };
}

/**
 * Roll20-style dice roller.
 *
 * Supported syntax:
 * - Basic: 2d6, 1d20+5, 3d8-2
 * - Keep highest/lowest: 4d6kh3, 4d6kl1
 * - Drop highest/lowest: 4d6dh1, 4d6dl1
 * - Exploding: 1d6! (reroll and add on max, cap at 100)
 * - Success counting: 8d6>=5 (count dice >= 5)
 */
export function rollDice(expr: string): number {
  const match = expr.match(
    /^(\d+)d(\d+)(kh\d+|kl\d+|dh\d+|dl\d+|!)?([+-]\d+)?(>=\d+|<=\d+|>\d+|<\d+)?$/
  );
  if (!match) {
    throw new ExprError(`Invalid dice expression: ${expr}`);
  }

  const count = parseInt(match[1]);
  const sides = parseInt(match[2]);
  const keepDrop = match[3] ?? "";
  const modifier = match[4] ? parseInt(match[4]) : 0;
  const successExpr = match[5] ?? "";

  // Roll dice
  const dice: number[] = [];
  const isExploding = keepDrop === "!";

  for (let i = 0; i < count; i++) {
    let roll = Math.floor(Math.random() * sides) + 1;
    if (isExploding) {
      let total = roll;
      let explosions = 0;
      while (roll === sides && explosions < 100) {
        roll = Math.floor(Math.random() * sides) + 1;
        total += roll;
        explosions++;
      }
      dice.push(total);
    } else {
      dice.push(roll);
    }
  }

  // Apply keep/drop modifiers
  let filtered = dice.slice();
  if (keepDrop && !isExploding) {
    const n = parseInt(keepDrop.slice(2));
    const sorted = dice.slice().sort((a, b) => a - b);
    if (keepDrop.startsWith("kh")) {
      filtered = sorted.slice(-n);
    } else if (keepDrop.startsWith("kl")) {
      filtered = sorted.slice(0, n);
    } else if (keepDrop.startsWith("dh")) {
      filtered = sorted.slice(0, sorted.length - n);
    } else if (keepDrop.startsWith("dl")) {
      filtered = sorted.slice(n);
    }
  }

  // Success counting
  if (successExpr) {
    const op = successExpr.match(/^(>=|<=|>|<)(\d+)$/)!;
    const threshold = parseInt(op[2]);
    let successes = 0;
    for (const d of filtered) {
      if (
        (op[1] === ">=" && d >= threshold) ||
        (op[1] === "<=" && d <= threshold) ||
        (op[1] === ">" && d > threshold) ||
        (op[1] === "<" && d < threshold)
      ) {
        successes++;
      }
    }
    return successes;
  }

  // Sum + modifier
  let total = modifier;
  for (const d of filtered) {
    total += d;
  }
  return total;
}

// =============================================================================
// Duration & Offset Utilities
// =============================================================================

/**
 * Format a duration in milliseconds as a human-readable string.
 * Picks up to 2 largest non-zero units from: weeks, days, hours, minutes, seconds.
 */
export function formatDuration(ms: number): string {
  if (ms === 0) return "just now";
  if (!isFinite(ms)) return "a long time";

  const absMs = Math.abs(ms);
  const units: [string, number][] = [
    ["week", Math.floor(absMs / 604800000)],
    ["day", Math.floor((absMs % 604800000) / 86400000)],
    ["hour", Math.floor((absMs % 86400000) / 3600000)],
    ["minute", Math.floor((absMs % 3600000) / 60000)],
    ["second", Math.floor((absMs % 60000) / 1000)],
  ];

  const parts: string[] = [];
  for (const [name, value] of units) {
    if (value > 0) {
      parts.push(`${value} ${name}${value !== 1 ? "s" : ""}`);
      if (parts.length === 2) break;
    }
  }

  return parts.length > 0 ? parts.join(" ") : "just now";
}

/** Unit multipliers in milliseconds */
const UNIT_MS: Record<string, number> = {
  w: 604800000, week: 604800000, weeks: 604800000,
  d: 86400000, day: 86400000, days: 86400000,
  h: 3600000, hour: 3600000, hours: 3600000,
  m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000,
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
};

/**
 * Parse an offset string into years, months, and milliseconds.
 * Supports: "3y2mo", "1d", "-1w", "3 years 2 months", "30s", "1h30m"
 */
export function parseOffset(offset: string): { years: number; months: number; ms: number } {
  const trimmed = offset.trim();
  const negative = trimmed.startsWith("-");
  const abs = negative ? trimmed.slice(1) : trimmed;

  let years = 0;
  let months = 0;
  let ms = 0;

  // Match number+unit pairs (e.g. "3y", "2 months", "30s")
  const pattern = /(\d+)\s*(y(?:ears?)?|mo(?:nths?)?|w(?:eeks?)?|d(?:ays?)?|h(?:ours?)?|m(?:in(?:utes?|s)?)?|s(?:ec(?:onds?|s)?)?)\s*/gi;
  let match;
  while ((match = pattern.exec(abs)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "y" || unit === "year" || unit === "years") {
      years += value;
    } else if (unit === "mo" || unit === "month" || unit === "months") {
      months += value;
    } else {
      const mult = UNIT_MS[unit];
      if (mult) ms += value * mult;
    }
  }

  const sign = negative ? -1 : 1;
  return { years: years * sign, months: months * sign, ms: ms * sign };
}

/**
 * Apply an offset string to a date.
 */
function applyOffset(date: Date, offset: string): Date {
  const { years, months, ms } = parseOffset(offset);
  const result = new Date(date.getTime());
  if (years) result.setFullYear(result.getFullYear() + years);
  if (months) result.setMonth(result.getMonth() + months);
  if (ms) result.setTime(result.getTime() + ms);
  return result;
}

// =============================================================================
// Permission Directives
// =============================================================================

export interface EntityPermissions {
  /** True if $locked directive present (entity is locked from LLM modification) */
  isLocked: boolean;
  /** Set of fact content strings that are locked (from $locked prefix) */
  lockedFacts: Set<string>;
  /** User IDs allowed to edit, "everyone" for public, null for owner-only */
  editList: string[] | "everyone" | null;
  /** User IDs allowed to view, "everyone" for public, null for owner-only */
  viewList: string[] | "everyone" | null;
  /** Users/IDs/roles allowed to trigger responses, "everyone" for public, null for no restriction */
  useList: string[] | "everyone" | null;
  /** Users/IDs blocked from all interactions (usernames or Discord IDs) */
  blacklist: string[];
}

/**
 * Parse permission directives from raw facts.
 * This extracts $locked, $edit, and $view directives without evaluating $if conditions.
 * Used for permission checking on commands.
 */
export function parsePermissionDirectives(facts: string[]): EntityPermissions {
  let isLocked = false;
  const lockedFacts = new Set<string>();
  let editList: string[] | "everyone" | null = null;
  let viewList: string[] | "everyone" | null = null;
  let useList: string[] | "everyone" | null = null;
  const blacklist: string[] = [];

  for (const fact of facts) {
    const trimmed = fact.trim();

    // Skip comments
    if (trimmed.startsWith("$#")) continue;

    // Check for $locked
    if (trimmed === LOCKED_SIGIL) {
      isLocked = true;
      continue;
    }
    if (trimmed.startsWith(LOCKED_SIGIL + " ")) {
      const content = trimmed.slice(LOCKED_SIGIL.length + 1).trim();
      lockedFacts.add(content);
      continue;
    }

    // Check for $edit
    if (trimmed.startsWith(EDIT_SIGIL)) {
      const value = trimmed.slice(EDIT_SIGIL.length).trim();
      editList = parseUserList(value);
      continue;
    }

    // Check for $view
    if (trimmed.startsWith(VIEW_SIGIL)) {
      const value = trimmed.slice(VIEW_SIGIL.length).trim();
      viewList = parseUserList(value);
      continue;
    }

    // Check for $blacklist (accumulates multiple lines)
    if (trimmed.startsWith(BLACKLIST_SIGIL)) {
      const value = trimmed.slice(BLACKLIST_SIGIL.length).trim();
      const parsed = parseUserList(value);
      // Ignore $blacklist @everyone (nonsensical)
      if (parsed !== "everyone") {
        blacklist.push(...parsed);
      }
      continue;
    }

    // Check for $use
    if (trimmed.startsWith(USE_SIGIL)) {
      const value = trimmed.slice(USE_SIGIL.length).trim();
      useList = parseUserList(value);
      continue;
    }
  }

  return { isLocked, lockedFacts, editList, viewList, useList, blacklist };
}

/**
 * Parse a user list value.
 * "@everyone" -> "everyone"
 * "user1, user2, user3" -> ["user1", "user2", "user3"]
 */
function parseUserList(value: string): string[] | "everyone" {
  if (value.toLowerCase() === "@everyone" || value.toLowerCase() === "everyone") {
    return "everyone";
  }
  // Split by comma and trim each entry
  return value.split(",").map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Check if a permission entry matches a user.
 * Entries can be Discord IDs (17-19 digits, matching user ID or role IDs) or usernames (case-insensitive).
 */
export function matchesUserEntry(entry: string, userId: string, username: string, userRoles: string[] = []): boolean {
  // Discord IDs are 17-19 digit snowflakes - check user ID and role IDs
  if (/^\d{17,19}$/.test(entry)) {
    return entry === userId || userRoles.includes(entry);
  }
  // Usernames are case-insensitive
  return entry.toLowerCase() === username.toLowerCase();
}

/**
 * Check if a user is blacklisted from an entity.
 * Owner is NEVER blacklisted.
 */
export function isUserBlacklisted(
  permissions: EntityPermissions,
  userId: string,
  username: string,
  ownerId: string | null,
  userRoles: string[] = []
): boolean {
  // Owner is never blocked
  if (ownerId && userId === ownerId) return false;

  return permissions.blacklist.some(entry => matchesUserEntry(entry, userId, username, userRoles));
}

/**
 * Check if a user is allowed to trigger entity responses ($use whitelist).
 * Owner is always allowed.
 * null useList = no restriction (everyone allowed, default).
 * "everyone" = explicitly everyone allowed.
 * Otherwise check the list entries.
 */
export function isUserAllowed(
  permissions: EntityPermissions,
  userId: string,
  username: string,
  ownerId: string | null,
  userRoles: string[] = []
): boolean {
  // Owner always allowed
  if (ownerId && userId === ownerId) return true;

  // No $use directive = no restriction
  if (permissions.useList === null) return true;

  // Explicit everyone
  if (permissions.useList === "everyone") return true;

  // Check list entries
  return permissions.useList.some(entry => matchesUserEntry(entry, userId, username, userRoles));
}
