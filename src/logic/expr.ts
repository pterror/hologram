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
  dt_ms: number;
  /** Milliseconds since triggering message */
  elapsed_ms: number;
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
  /** Get the last N messages from the channel. Format: %a=author, %m=message (default "%a: %m") */
  messages: (n?: number, format?: string) => string;
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
  dt_ms: 0,
  elapsed_ms: 0,
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
  interaction_type: "",
};
const ALLOWED_GLOBALS = new Set(Object.keys(EXPR_CONTEXT_REFERENCE));

// Blocked property names (prevent prototype chain escapes)
const BLOCKED_PROPERTIES = new Set([
  "constructor", "__proto__", "prototype",
  "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
]);

/**
 * Generate JS code from AST. Since we control the AST structure,
 * the generated code is safe to execute.
 */
function generateCode(node: ExprNode): string {
  switch (node.type) {
    case "literal":
      if (typeof node.value === "string") {
        return JSON.stringify(node.value);
      }
      return String(node.value);

    case "identifier":
      if (!ALLOWED_GLOBALS.has(node.name)) {
        throw new ExprError(`Unknown identifier: ${node.name}`);
      }
      return `ctx.${node.name}`;

    case "member":
      // Block dangerous property names that could escape the sandbox
      if (BLOCKED_PROPERTIES.has(node.property)) {
        throw new ExprError(`Blocked property access: ${node.property}`);
      }
      return `(${generateCode(node.object)}?.${node.property})`;

    case "call":
      const callee = generateCode(node.callee);
      const args = node.args.map(generateCode).join(", ");
      return `${callee}(${args})`;

    case "unary":
      return `(${node.operator}${generateCode(node.operand)})`;

    case "binary":
      return `(${generateCode(node.left)} ${node.operator} ${generateCode(node.right)})`;

    case "ternary":
      return `(${generateCode(node.test)} ? ${generateCode(node.consequent)} : ${generateCode(node.alternate)})`;
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
  fn = new Function("ctx", `return Boolean(${code})`) as (ctx: ExprContext) => boolean;

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
const AVATAR_SIGIL = "$avatar ";
const LOCKED_SIGIL = "$locked";
const EDIT_SIGIL = "$edit ";
const VIEW_SIGIL = "$view ";
const BLACKLIST_SIGIL = "$blacklist ";
const STREAM_SIGIL = "$stream";
const MEMORY_SIGIL = "$memory";
const CONTEXT_SIGIL = "$context";
const FREEFORM_SIGIL = "$freeform";

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
  /** For $stream directives with custom delimiter (default: newline) */
  streamDelimiter?: string;
  /** True if this fact is a $memory directive */
  isMemory: boolean;
  /** For $memory directives, the scope */
  memoryScope?: MemoryScope;
  /** True if this fact is a $context directive */
  isContext: boolean;
  /** For $context directives, the character limit */
  contextLimit?: number;
  /** True if this fact is a $freeform directive */
  isFreeform: boolean;
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
        contextLimit: contextResultCond,
        isFreeform: false,
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
      };
    }

    return { content, conditional: true, expression, isRespond: false, isRetry: false, isAvatar: false, isLockedDirective: false, isLockedFact: false, isStream: false, isMemory: false, isContext: false, isFreeform: false };
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
      contextLimit: contextResult,
      isFreeform: false,
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
    };
  }

  return { content: trimmed, conditional: false, isRespond: false, isRetry: false, isAvatar: false, isLockedDirective: false, isLockedFact: false, isStream: false, isMemory: false, isContext: false, isFreeform: false };
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
  delimiter?: string;
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
 * - $stream full → single message, edited progressively
 * - $stream full "delim" → new message per delimiter, each edited progressively
 */
function parseStreamDirective(content: string): StreamDirectiveResult | null {
  if (!content.startsWith(STREAM_SIGIL)) {
    return null;
  }
  let rest = content.slice(STREAM_SIGIL.length).trim();

  // Check for quoted delimiter at the end
  let delimiter: string | undefined;
  const quoteMatch = rest.match(/["']([^"']+)["']$/);
  if (quoteMatch) {
    delimiter = quoteMatch[1];
    rest = rest.slice(0, quoteMatch.index).trim().toLowerCase();
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
 * Returns null if not a context directive, or the character limit.
 *
 * Syntax:
 * - $context 8000 → 8000 characters
 * - $context 8k → 8000 characters
 * - $context 200k → 200000 characters (capped at MAX_CONTEXT_CHAR_LIMIT)
 */
function parseContextDirective(content: string): number | null {
  if (!content.startsWith(CONTEXT_SIGIL)) {
    return null;
  }
  const rest = content.slice(CONTEXT_SIGIL.length).trim().toLowerCase();

  if (rest === "") {
    return null; // Need a value
  }

  // Parse number with optional 'k' suffix
  const match = rest.match(/^(\d+(?:\.\d+)?)(k)?$/);
  if (!match) {
    return null;
  }

  let value = parseFloat(match[1]);
  if (match[2] === "k") {
    value *= 1000;
  }

  // Cap at hard maximum
  return Math.min(Math.floor(value), MAX_CONTEXT_CHAR_LIMIT);
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
  /** Custom delimiter for streaming (default: newline) */
  streamDelimiter: string | null;
  /** Memory retrieval scope (default: "none" = no retrieval) */
  memoryScope: MemoryScope;
  /** Context character limit if $context directive present */
  contextLimit: number | null;
  /** True if $freeform directive present (multi-char responses not split) */
  isFreeform: boolean;
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
  let streamDelimiter: string | null = null;
  let memoryScope: MemoryScope = "none";
  let contextLimit: number | null = null;
  let isFreeform = false;

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
      contextLimit = parsed.contextLimit ?? null;
      continue;
    }

    // Handle $freeform directive
    if (parsed.isFreeform) {
      isFreeform = true;
      continue;
    }

    results.push(parsed.content);
  }

  return { facts: results, shouldRespond, respondSource, retryMs, avatarUrl, isLocked, lockedFacts, streamMode, streamDelimiter, memoryScope, contextLimit, isFreeform };
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
    if (fact.startsWith("#")) continue;

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
  /** Function to get the last N messages from the channel. Format: %a=author, %m=message */
  messages?: (n?: number, format?: string) => string;
  dt_ms?: number;
  elapsed_ms?: number;
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
    dt_ms: options.dt_ms ?? 0,
    elapsed_ms: options.elapsed_ms ?? 0,
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
    chars: options.chars ?? [],
    messages,
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
  const blacklist: string[] = [];

  for (const fact of facts) {
    const trimmed = fact.trim();

    // Skip comments
    if (trimmed.startsWith("#")) continue;

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
  }

  return { isLocked, lockedFacts, editList, viewList, blacklist };
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
 * Entries can be Discord IDs (17-19 digits) or usernames (case-insensitive).
 */
export function matchesUserEntry(entry: string, userId: string, username: string): boolean {
  // Discord IDs are 17-19 digit snowflakes
  if (/^\d{17,19}$/.test(entry)) {
    return entry === userId;
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
  ownerId: string | null
): boolean {
  // Owner is never blocked
  if (ownerId && userId === ownerId) return false;

  return permissions.blacklist.some(entry => matchesUserEntry(entry, userId, username));
}
