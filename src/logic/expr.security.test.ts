/**
 * Adversarial sandbox escape tests for the expression evaluator.
 *
 * The evaluator uses: custom parser → AST → code generation → new Function("ctx", ...).
 * Sandbox enforced by: identifier whitelist, blocked properties, no bracket notation,
 * no assignment, no statements. These tests verify every known escape vector is blocked.
 */
import { describe, expect, test } from "bun:test";
import {
  compileExpr,
  evalExpr,
  evalMacroValue,
  ExprError,
  type ExprContext,
  formatDuration,
} from "./expr";

// =============================================================================
// Test Helpers
// =============================================================================

function makeContext(overrides: Partial<ExprContext> = {}): ExprContext {
  const contentOverride = overrides.content;
  const authorOverride = overrides.author;
  const messages = overrides.messages ?? ((n?: number, fmt?: string) => {
    if (fmt === "%m") return contentOverride ?? "";
    if (fmt === "%a") return authorOverride ?? "";
    return authorOverride && contentOverride ? `${authorOverride}: ${contentOverride}` : contentOverride ?? "";
  });
  const chars = overrides.chars ?? [];
  return {
    self: Object.create(null),
    random: () => 0,
    has_fact: () => false,
    roll: () => 7,
    time: Object.assign(Object.create(null), {
      hour: 12,
      is_day: true,
      is_night: false,
    }),
    response_ms: 0,
    retry_ms: 0,
    idle_ms: 0,
    mentioned: false,
    replied: false,
    replied_to: "",
    is_forward: false,
    is_self: false,
    mentioned_in_dialogue: () => false,
    content: messages(1, "%m"),
    author: messages(1, "%a"),
    name: "",
    chars,
    messages,
    group: overrides.group ?? chars.join(", "),
    duration: (ms: number) => formatDuration(ms),
    date_str: () => "",
    time_str: () => "",
    isodate: () => "",
    isotime: () => "",
    weekday: () => "",
    channel: Object.assign(Object.create(null), { id: "", name: "", description: "", mention: "" }),
    server: Object.assign(Object.create(null), { id: "", name: "", description: "" }),
    ...overrides,
  };
}

// =============================================================================
// Prototype Chain Escapes
// =============================================================================

describe("prototype chain escapes", () => {

  test("blocks constructor on every context type", () => {
    expect(() => compileExpr("self.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("random.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("time.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("content.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("chars.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("channel.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("server.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("group.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("name.constructor")).toThrow("Blocked property access: constructor");
  });

  test("blocks __proto__ on every context type", () => {
    expect(() => compileExpr("self.__proto__")).toThrow("Blocked property access: __proto__");
    expect(() => compileExpr("content.__proto__")).toThrow("Blocked property access: __proto__");
    expect(() => compileExpr("chars.__proto__")).toThrow("Blocked property access: __proto__");
    expect(() => compileExpr("time.__proto__")).toThrow("Blocked property access: __proto__");
    expect(() => compileExpr("channel.__proto__")).toThrow("Blocked property access: __proto__");
  });

  test("blocks prototype access", () => {
    expect(() => compileExpr("random.prototype")).toThrow("Blocked property access: prototype");
    expect(() => compileExpr("has_fact.prototype")).toThrow("Blocked property access: prototype");
    expect(() => compileExpr("roll.prototype")).toThrow("Blocked property access: prototype");
    expect(() => compileExpr("messages.prototype")).toThrow("Blocked property access: prototype");
  });

  test("blocks __defineGetter__", () => {
    expect(() => compileExpr("self.__defineGetter__")).toThrow("Blocked property access: __defineGetter__");
    expect(() => compileExpr("content.__defineGetter__")).toThrow("Blocked property access: __defineGetter__");
  });

  test("blocks __defineSetter__", () => {
    expect(() => compileExpr("self.__defineSetter__")).toThrow("Blocked property access: __defineSetter__");
  });

  test("blocks __lookupGetter__", () => {
    expect(() => compileExpr("self.__lookupGetter__")).toThrow("Blocked property access: __lookupGetter__");
  });

  test("blocks __lookupSetter__", () => {
    expect(() => compileExpr("self.__lookupSetter__")).toThrow("Blocked property access: __lookupSetter__");
  });

  test("blocks constructor through method chain", () => {
    expect(() => compileExpr("content.trim().constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("content.toLowerCase().constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("content.slice(0).constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("content.replace('a', 'b').constructor")).toThrow("Blocked property access: constructor");
  });

  test("blocks double constructor chain (Function access)", () => {
    expect(() => compileExpr("content.constructor.constructor")).toThrow("Blocked property access: constructor");
  });

  test("blocks __proto__ through method chain", () => {
    expect(() => compileExpr("content.trim().__proto__")).toThrow("Blocked property access: __proto__");
  });

  test("blocks constructor on function return values", () => {
    expect(() => compileExpr("random().constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("has_fact('test').constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("messages().constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("roll('1d6').constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("duration(1000).constructor")).toThrow("Blocked property access: constructor");
  });
});

// =============================================================================
// Global Object Access
// =============================================================================

describe("global object access", () => {

  test("rejects this (would be global in non-strict new Function)", () => {
    expect(() => compileExpr("this")).toThrow("Unknown identifier: this");
  });

  test("rejects globalThis", () => {
    expect(() => compileExpr("globalThis")).toThrow("Unknown identifier: globalThis");
  });

  test("rejects window", () => {
    expect(() => compileExpr("window")).toThrow("Unknown identifier: window");
  });

  test("rejects global (Node.js)", () => {
    expect(() => compileExpr("global")).toThrow("Unknown identifier: global");
  });

  test("rejects Bun", () => {
    expect(() => compileExpr("Bun")).toThrow("Unknown identifier: Bun");
  });

  test("rejects process", () => {
    expect(() => compileExpr("process")).toThrow("Unknown identifier: process");
  });

  test("rejects arguments (would access Function arguments)", () => {
    expect(() => compileExpr("arguments")).toThrow("Unknown identifier: arguments");
  });

  test("rejects undefined (not in whitelist)", () => {
    expect(() => compileExpr("undefined")).toThrow("Unknown identifier: undefined");
  });

  test("rejects NaN", () => {
    expect(() => compileExpr("NaN")).toThrow("Unknown identifier: NaN");
  });

  test("rejects Infinity", () => {
    expect(() => compileExpr("Infinity")).toThrow("Unknown identifier: Infinity");
  });
});

// =============================================================================
// Built-in Constructor Access
// =============================================================================

describe("built-in constructor access", () => {
  test("rejects Function", () => {
    expect(() => compileExpr("Function")).toThrow("Unknown identifier: Function");
  });

  test("rejects Object", () => {
    expect(() => compileExpr("Object")).toThrow("Unknown identifier: Object");
  });

  test("rejects Array", () => {
    expect(() => compileExpr("Array")).toThrow("Unknown identifier: Array");
  });

  test("rejects String", () => {
    expect(() => compileExpr("String")).toThrow("Unknown identifier: String");
  });

  test("rejects Number", () => {
    expect(() => compileExpr("Number")).toThrow("Unknown identifier: Number");
  });

  test("rejects Boolean", () => {
    // Note: "true" and "false" are boolean literals, not the Boolean constructor
    expect(() => compileExpr("Boolean")).toThrow("Unknown identifier: Boolean");
  });

  test("rejects RegExp", () => {
    expect(() => compileExpr("RegExp")).toThrow("Unknown identifier: RegExp");
  });

  test("rejects Symbol", () => {
    expect(() => compileExpr("Symbol")).toThrow("Unknown identifier: Symbol");
  });

  test("rejects Proxy", () => {
    expect(() => compileExpr("Proxy")).toThrow("Unknown identifier: Proxy");
  });

  test("rejects Promise", () => {
    expect(() => compileExpr("Promise")).toThrow("Unknown identifier: Promise");
  });

  test("rejects Map", () => {
    expect(() => compileExpr("Map")).toThrow("Unknown identifier: Map");
  });

  test("rejects Set", () => {
    expect(() => compileExpr("Set")).toThrow("Unknown identifier: Set");
  });

  test("rejects WeakRef", () => {
    expect(() => compileExpr("WeakRef")).toThrow("Unknown identifier: WeakRef");
  });

  test("rejects Error", () => {
    expect(() => compileExpr("Error")).toThrow("Unknown identifier: Error");
  });

  test("rejects eval", () => {
    expect(() => compileExpr("eval")).toThrow("Unknown identifier: eval");
  });

  test("rejects parseInt/parseFloat", () => {
    expect(() => compileExpr("parseInt")).toThrow("Unknown identifier: parseInt");
    expect(() => compileExpr("parseFloat")).toThrow("Unknown identifier: parseFloat");
  });
});

// =============================================================================
// Module / Import System
// =============================================================================

describe("module system access", () => {
  test("rejects require", () => {
    expect(() => compileExpr("require")).toThrow("Unknown identifier: require");
  });

  test("rejects import (as identifier)", () => {
    // import is a keyword but our tokenizer reads it as identifier
    expect(() => compileExpr("import")).toThrow("Unknown identifier: import");
  });

  test("rejects module", () => {
    expect(() => compileExpr("module")).toThrow("Unknown identifier: module");
  });

  test("rejects exports", () => {
    expect(() => compileExpr("exports")).toThrow("Unknown identifier: exports");
  });

  test("rejects __filename", () => {
    expect(() => compileExpr("__filename")).toThrow("Unknown identifier: __filename");
  });

  test("rejects __dirname", () => {
    expect(() => compileExpr("__dirname")).toThrow("Unknown identifier: __dirname");
  });
});

// =============================================================================
// Bracket Notation (Computed Property Access)
// =============================================================================

describe("bracket notation bypass", () => {
  const ctx = makeContext();

  test("no bracket notation on identifiers", () => {
    expect(() => evalExpr('self["constructor"]', ctx)).toThrow();
    expect(() => evalExpr('self["__proto__"]', ctx)).toThrow();
  });

  test("no bracket notation with concatenation", () => {
    expect(() => evalExpr('self["con" + "structor"]', ctx)).toThrow();
  });

  test("no bracket notation on strings", () => {
    expect(() => evalExpr('content["constructor"]', ctx)).toThrow();
    expect(() => evalExpr("content[0]", ctx)).toThrow();
  });

  test("no bracket notation on arrays", () => {
    expect(() => evalExpr("chars[0]", ctx)).toThrow();
    expect(() => evalExpr('chars["length"]', ctx)).toThrow();
  });

  test("no bracket notation on function returns", () => {
    expect(() => evalExpr('messages()["constructor"]', ctx)).toThrow();
  });

  test("no bracket notation with variable", () => {
    expect(() => evalExpr("self[name]", ctx)).toThrow();
  });
});

// =============================================================================
// Code Injection via String Literals
// =============================================================================

describe("code injection via strings", () => {
  test("semicolons in strings are safe (literal not code)", () => {
    const ctx = makeContext({ content: "test; process.exit(1)" });
    expect(evalExpr('content.includes(";")', ctx)).toBe(true);
    // The string content is data, not executed
  });

  test("closing paren + semicollon injection", () => {
    expect(() => evalExpr('"test"); process.exit(1); ("', makeContext())).toThrow();
  });

  test("template literal syntax in strings is literal", () => {
    const ctx = makeContext({ content: "${process.exit(1)}" });
    expect(evalExpr('content == "${process.exit(1)}"', ctx)).toBe(true);
    // ${} in our string literals is just literal text, not template interpolation
  });

  test("newline injection in string", () => {
    // Backslash-n in our strings is the escaped character 'n', not a newline
    // But even if it were, it wouldn't escape the string context
    const ctx = makeContext();
    expect(() => evalExpr('"line1\\nline2"', ctx)).not.toThrow();
  });

  test("null byte in string", () => {
    const ctx = makeContext();
    expect(() => evalExpr('"test\\0test"', ctx)).not.toThrow();
  });

  test("backslash at end of string", () => {
    const ctx = makeContext();
    // Parser should handle escaped closing quote
    expect(() => evalExpr('"test\\\\"', ctx)).not.toThrow();
  });

  test("JSON.stringify properly escapes string content for codegen", () => {
    // Verify that strings with special JS characters don't break the generated code
    const ctx = makeContext({ content: 'a"b\'c\\d\ne' });
    // Should not throw - content is safely escaped in generated code
    expect(evalExpr("content.length > 0", ctx)).toBe(true);
  });
});

// =============================================================================
// Statement Injection
// =============================================================================

describe("statement injection", () => {
  const ctx = makeContext();

  test("no semicolons (statement separator)", () => {
    expect(() => evalExpr("true; false", ctx)).toThrow();
    expect(() => evalExpr("true; process.exit(1)", ctx)).toThrow();
  });

  test("no assignment operators", () => {
    expect(() => evalExpr("self.x = 1", ctx)).toThrow();
  });

  test("no var/let/const declarations", () => {
    // These would be parsed as identifiers and rejected
    expect(() => compileExpr("var")).toThrow("Unknown identifier: var");
    expect(() => compileExpr("let")).toThrow("Unknown identifier: let");
    // const starts with 'con' so it would be parsed as an identifier
    expect(() => compileExpr("const")).toThrow("Unknown identifier: const");
  });

  test("no return statement", () => {
    expect(() => compileExpr("return")).toThrow("Unknown identifier: return");
  });

  test("no throw statement", () => {
    expect(() => compileExpr("throw")).toThrow("Unknown identifier: throw");
  });

  test("no while/for loops", () => {
    expect(() => compileExpr("while")).toThrow("Unknown identifier: while");
    expect(() => compileExpr("for")).toThrow("Unknown identifier: for");
  });

  test("no if statement (not $if)", () => {
    // 'if' as first token would fail because identifier 'if' is unknown
    expect(() => compileExpr("if")).toThrow("Unknown identifier: if");
  });

  test("no new keyword", () => {
    expect(() => compileExpr("new")).toThrow("Unknown identifier: new");
  });

  test("no delete keyword", () => {
    expect(() => compileExpr("delete")).toThrow("Unknown identifier: delete");
  });

  test("no typeof keyword", () => {
    expect(() => compileExpr("typeof")).toThrow("Unknown identifier: typeof");
  });

  test("no void keyword", () => {
    expect(() => compileExpr("void")).toThrow("Unknown identifier: void");
  });

  test("no in keyword", () => {
    expect(() => compileExpr("in")).toThrow("Unknown identifier: in");
  });

  test("no instanceof keyword", () => {
    expect(() => compileExpr("instanceof")).toThrow("Unknown identifier: instanceof");
  });

  test("no yield keyword", () => {
    expect(() => compileExpr("yield")).toThrow("Unknown identifier: yield");
  });

  test("no await keyword", () => {
    expect(() => compileExpr("await")).toThrow("Unknown identifier: await");
  });

  test("no async keyword", () => {
    expect(() => compileExpr("async")).toThrow("Unknown identifier: async");
  });

  test("no class keyword", () => {
    expect(() => compileExpr("class")).toThrow("Unknown identifier: class");
  });

  test("no with keyword", () => {
    expect(() => compileExpr("with")).toThrow("Unknown identifier: with");
  });

  test("no debugger keyword", () => {
    expect(() => compileExpr("debugger")).toThrow("Unknown identifier: debugger");
  });
});

// =============================================================================
// Syntax Not Supported by Parser
// =============================================================================

describe("unsupported syntax", () => {
  const ctx = makeContext();

  test("no template literals (backticks)", () => {
    expect(() => evalExpr("`template`", ctx)).toThrow();
  });

  test("no regex literals", () => {
    // Forward slash is not an operator or valid token start
    expect(() => evalExpr("/regex/", ctx)).toThrow();
  });

  test("no arrow functions", () => {
    // => is not a recognized operator
    expect(() => evalExpr("(x) => x", ctx)).toThrow();
  });

  test("no spread operator", () => {
    expect(() => evalExpr("...chars", ctx)).toThrow();
  });

  test("no destructuring", () => {
    expect(() => evalExpr("{a, b} = self", ctx)).toThrow();
  });

  test("no comma operator for multiple expressions", () => {
    // Comma at top level should fail (it's only valid inside function call args)
    expect(() => evalExpr("1, 2", ctx)).toThrow();
  });

  test("no optional chaining operator (?.) - dot is separate", () => {
    // Our parser uses ?. in codegen but ? is a ternary operator in expressions
    // ?. as syntax is not in OPERATORS
    // "self?.foo" would parse ? as ternary start, then fail
    expect(() => evalExpr("self?.foo", ctx)).toThrow();
  });

  test("no nullish coalescing (??)", () => {
    expect(() => evalExpr("self.x ?? 0", ctx)).toThrow();
  });

  test("no bitwise operators", () => {
    expect(() => evalExpr("1 & 2", ctx)).toThrow();
    expect(() => evalExpr("1 | 2", ctx)).toThrow();
    expect(() => evalExpr("1 ^ 2", ctx)).toThrow();
    expect(() => evalExpr("~1", ctx)).toThrow();
    expect(() => evalExpr("1 << 2", ctx)).toThrow();
    expect(() => evalExpr("4 >> 1", ctx)).toThrow();
  });

  test("no tagged template literals", () => {
    expect(() => evalExpr("String.raw`test`", ctx)).toThrow();
  });

  test("no exponentiation operator", () => {
    expect(() => evalExpr("2 ** 3", ctx)).toThrow();
  });

  test("no increment/decrement", () => {
    expect(() => evalExpr("response_ms++", ctx)).toThrow();
    expect(() => evalExpr("++response_ms", ctx)).toThrow();
    expect(() => evalExpr("response_ms--", ctx)).toThrow();
  });

  test("no compound assignment", () => {
    expect(() => evalExpr("response_ms += 1", ctx)).toThrow();
    expect(() => evalExpr("response_ms -= 1", ctx)).toThrow();
    expect(() => evalExpr("response_ms *= 2", ctx)).toThrow();
  });
});

// =============================================================================
// Function Constructor Access via Chaining
// =============================================================================

describe("Function constructor via chaining", () => {

  test("string.constructor.constructor (Function access)", () => {
    expect(() => compileExpr("content.constructor")).toThrow("Blocked property access: constructor");
  });

  test("number return value constructor", () => {
    expect(() => compileExpr("response_ms.constructor")).toThrow("Blocked property access: constructor");
  });

  test("array constructor", () => {
    expect(() => compileExpr("chars.constructor")).toThrow("Blocked property access: constructor");
  });

  test("boolean constructor", () => {
    expect(() => compileExpr("mentioned.constructor")).toThrow("Blocked property access: constructor");
  });

  test("function constructor", () => {
    expect(() => compileExpr("random.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("has_fact.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("roll.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("messages.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("duration.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("mentioned_in_dialogue.constructor")).toThrow("Blocked property access: constructor");
  });

  test("nested object constructor", () => {
    expect(() => compileExpr("time.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("channel.constructor")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("server.constructor")).toThrow("Blocked property access: constructor");
  });
});

// =============================================================================
// call/apply/bind Abuse
// =============================================================================

describe("call/apply/bind usage", () => {
  const ctx = makeContext();

  test("call on allowed functions does not escape", () => {
    // These should evaluate without escaping - call/apply are not blocked
    // because they can't reach Function constructor (which IS blocked)
    expect(() => evalExpr("has_fact.call", ctx)).not.toThrow();
  });

  test("cannot reach Function via call chain", () => {
    // has_fact.call.constructor would be Function - but constructor is blocked
    expect(() => compileExpr("has_fact.call.constructor")).toThrow("Blocked property access: constructor");
  });

  test("cannot reach Function via bind chain", () => {
    expect(() => compileExpr("has_fact.bind.constructor")).toThrow("Blocked property access: constructor");
  });

  test("cannot reach Function via apply chain", () => {
    expect(() => compileExpr("has_fact.apply.constructor")).toThrow("Blocked property access: constructor");
  });

  test("toString.constructor is blocked", () => {
    expect(() => compileExpr("content.toString.constructor")).toThrow("Blocked property access: constructor");
  });

  test("valueOf.constructor is blocked", () => {
    expect(() => compileExpr("content.valueOf.constructor")).toThrow("Blocked property access: constructor");
  });
});

// =============================================================================
// String Method Abuse for Code Execution
// =============================================================================

describe("string method abuse", () => {
  const ctx = makeContext({ content: "test" });

  test("replace with function callback is not possible (no arrow functions)", () => {
    // Can't define a callback - parser doesn't support arrow functions or function expressions
    expect(() => evalExpr('content.replace("t", (x) => x.toUpperCase())', ctx)).toThrow();
  });

  test("match returns array, constructor still blocked", () => {
    expect(() => compileExpr('content.match("test").constructor')).toThrow("Blocked property access: constructor");
  });

  test("split returns array, constructor still blocked", () => {
    expect(() => compileExpr('content.split("").constructor')).toThrow("Blocked property access: constructor");
  });

  test("string fromCharCode not accessible (String not in whitelist)", () => {
    expect(() => compileExpr("String")).toThrow("Unknown identifier: String");
  });
});

// =============================================================================
// Array Method Abuse
// =============================================================================

describe("array method abuse", () => {
  const ctx = makeContext({ chars: ["Alice", "Bob"] });

  test("no array callback methods (no arrow functions)", () => {
    // map, filter, find, reduce all need callback functions
    expect(() => evalExpr("chars.map(x => x)", ctx)).toThrow();
    expect(() => evalExpr("chars.filter(x => x)", ctx)).toThrow();
    expect(() => evalExpr("chars.find(x => x)", ctx)).toThrow();
    expect(() => evalExpr("chars.reduce((a, b) => a + b)", ctx)).toThrow();
    expect(() => evalExpr("chars.forEach(x => x)", ctx)).toThrow();
    expect(() => evalExpr("chars.some(x => x)", ctx)).toThrow();
    expect(() => evalExpr("chars.every(x => x)", ctx)).toThrow();
  });

  test("safe array methods work", () => {
    expect(evalExpr("chars.length == 2", ctx)).toBe(true);
    expect(evalExpr('chars.includes("Alice")', ctx)).toBe(true);
    expect(evalExpr('chars.indexOf("Bob") == 1', ctx)).toBe(true);
    expect(evalExpr('chars.join(", ").includes("Alice")', ctx)).toBe(true);
  });

  test("array constructor blocked", () => {
    expect(() => compileExpr("chars.constructor")).toThrow("Blocked property access: constructor");
  });
});

// =============================================================================
// Denial of Service Vectors
// =============================================================================

describe("denial of service vectors", () => {
  const ctx = makeContext({ content: "aaaaaaaaaaa" });

  test("deeply nested parentheses parse without stack overflow", () => {
    // 50 levels deep - should parse fine
    const expr = "(" .repeat(50) + "true" + ")".repeat(50);
    expect(() => evalExpr(expr, ctx)).not.toThrow();
    expect(evalExpr(expr, ctx)).toBe(true);
  });

  test("long chain of binary operators", () => {
    // 100 chained additions
    const expr = Array(100).fill("1").join(" + ") + " > 0";
    expect(evalExpr(expr, ctx)).toBe(true);
  });

  test("long chain of logical operators", () => {
    const expr = Array(100).fill("true").join(" && ");
    expect(evalExpr(expr, ctx)).toBe(true);
  });

  test("long chain of method calls", () => {
    // Chain .trim() many times - should work but is bounded
    const expr = "content" + ".trim()".repeat(20) + '.length > 0';
    expect(() => evalExpr(expr, ctx)).not.toThrow();
  });

  test("very long string literal", () => {
    const longStr = "a".repeat(10000);
    expect(() => compileExpr(`"${longStr}".length > 0`)).not.toThrow();
  });

  test("repeat() could cause memory issues but is bounded by runtime", () => {
    // This is a runtime concern, not a parser concern
    // The expression itself is valid; resource limits are enforced externally
    expect(() => compileExpr('content.repeat(10).length > 0')).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // ReDoS (Regular Expression Denial of Service)
  //
  // JS string methods .match(), .replace(), .search(), .split() implicitly
  // compile their string argument into a RegExp. An entity author controls
  // the pattern (via $if expressions), and Discord users control the input
  // string (message content). Catastrophic backtracking patterns like
  // (a+)+b, (a|a)+b, (a+){2,}b can hang the event loop.
  //
  // Attack surface: entity author writes a vulnerable regex pattern,
  // then ANY user message matching the pathological input shape hangs the bot.
  // ---------------------------------------------------------------------------

  test("ReDoS: .match() accepts string that becomes regex", () => {
    // This demonstrates the attack surface: match() compiles strings as regex
    const redosCtx = makeContext({ content: "test123" });
    // Benign pattern works fine
    expect(evalExpr('content.match("\\\\d+").length > 0', redosCtx)).toBe(true);
  });

  test("ReDoS: .search() accepts string that becomes regex", () => {
    const redosCtx = makeContext({ content: "hello" });
    expect(evalExpr('content.search("ell") == 1', redosCtx)).toBe(true);
  });

  test("ReDoS: .replace() accepts string that becomes regex", () => {
    const redosCtx = makeContext({ content: "aaa" });
    expect(evalExpr('content.replace("a", "b") == "baa"', redosCtx)).toBe(true);
  });

  test("ReDoS: .split() accepts string that becomes regex", () => {
    const redosCtx = makeContext({ content: "a,b,c" });
    expect(evalExpr('content.split(",").length == 3', redosCtx)).toBe(true);
  });

  test("ReDoS: catastrophic backtracking pattern completes on small input", () => {
    // (a+)+b is a classic ReDoS pattern. With input "aaaaaaaaaaX" (11 chars)
    // it's still fast. With 25+ chars it would hang for seconds/minutes.
    // This test uses small input to verify the pattern IS reachable without
    // actually causing a hang.
    const redosCtx = makeContext({ content: "aaaaaX" }); // 6 chars - fast
    const start = performance.now();
    // match() returns null (no match), which is falsy
    expect(evalExpr('content.match("(a+)+b")', redosCtx)).toBe(false);
    const elapsed = performance.now() - start;
    // Should complete in under 100ms with this small input
    expect(elapsed).toBeLessThan(100);
    // NOTE: with content "a".repeat(30) + "X", this would hang for minutes.
    // This is a real vulnerability - see TODO.md.
  });

  test("ReDoS: nested quantifier patterns are reachable", () => {
    // Other classic ReDoS patterns that are all reachable via match/search
    const redosCtx = makeContext({ content: "aaa" });
    // (a|a)+$ - alternation with overlap
    expect(() => evalExpr('content.match("(a|a)+$")', redosCtx)).not.toThrow();
    // (a+){2,} - nested quantifiers
    expect(() => evalExpr('content.match("(a+){2,}")', redosCtx)).not.toThrow();
    // (.*a){8} - greedy with backreference-like
    expect(() => evalExpr('content.match("(.*a){8}")', redosCtx)).not.toThrow();
  });

  test("ReDoS: safe string methods do NOT use regex", () => {
    // These methods do literal string matching, not regex - safe from ReDoS
    const redosCtx = makeContext({ content: "aaaaaa" });
    expect(evalExpr('content.includes("(a+)+b")', redosCtx)).toBe(false); // literal search
    expect(evalExpr('content.startsWith("(a+)+b")', redosCtx)).toBe(false); // literal
    expect(evalExpr('content.endsWith("(a+)+b")', redosCtx)).toBe(false); // literal
    expect(evalExpr('content.indexOf("(a+)+b") == -1', redosCtx)).toBe(true); // literal
  });
});

// =============================================================================
// Unicode and Encoding Tricks
// =============================================================================

describe("unicode and encoding tricks", () => {
  const ctx = makeContext();

  test("unicode escape sequences not supported in identifiers", () => {
    // \\u0063onstructor = constructor - but our tokenizer only reads [a-zA-Z_][a-zA-Z0-9_]*
    // The backslash would be rejected as unexpected character
    expect(() => evalExpr("\\u0063onstructor", ctx)).toThrow();
  });

  test("unicode identifiers with non-ASCII letters rejected", () => {
    // Our tokenizer only allows [a-zA-Z_] starts, not Unicode letter categories
    expect(() => evalExpr("cöñstructör", ctx)).toThrow();
  });

  test("zero-width characters in identifiers rejected", () => {
    // Zero-width space (U+200B) is not [a-zA-Z_]
    expect(() => evalExpr("sel\u200Bf", ctx)).toThrow();
  });

  test("homoglyph attack: Cyrillic 'с' (U+0441) vs Latin 'c'", () => {
    // Cyrillic с would not match ASCII 'c' in our [a-zA-Z_] pattern
    expect(() => evalExpr("\u0441onstructor", ctx)).toThrow();
  });

  test("fullwidth characters rejected", () => {
    // Fullwidth letters (U+FF41 etc.) are not in [a-zA-Z_]
    expect(() => evalExpr("\uFF43ontent", ctx)).toThrow();
  });
});

// =============================================================================
// Numeric Edge Cases for Escapes
// =============================================================================

describe("numeric edge cases for escapes", () => {
  const ctx = makeContext();

  test("hex literals not supported", () => {
    // 0x... - '0' is parsed as a number, then 'x' causes issues
    expect(() => evalExpr("0x41 == 65", ctx)).toThrow();
  });

  test("octal literals not supported", () => {
    expect(() => evalExpr("0o10 == 8", ctx)).toThrow();
  });

  test("binary literals not supported", () => {
    expect(() => evalExpr("0b101 == 5", ctx)).toThrow();
  });

  test("exponential notation not supported", () => {
    // 1e3 - '1' is parsed, then 'e' starts identifier 'e3'
    expect(() => evalExpr("1e3 == 1000", ctx)).toThrow();
  });

  test("underscore numeric separators not supported", () => {
    expect(() => evalExpr("1_000 == 1000", ctx)).toThrow();
  });

  test("BigInt literals not supported", () => {
    expect(() => evalExpr("42n > 0", ctx)).toThrow();
  });
});

// =============================================================================
// Timing / Side Channel Attacks
// =============================================================================

describe("side effects and mutation", () => {
  test("expressions cannot mutate context", () => {
    const ctx = makeContext({ content: "original" });
    // Expressions are read-only - no assignment operator
    expect(() => evalExpr("content = 'modified'", ctx)).toThrow();
    expect(ctx.content).toBe("original");
  });

  test("method calls that mutate arrays are possible but contained", () => {
    const chars = ["Alice", "Bob"];
    const ctx = makeContext({ chars });
    // push returns new length - this technically mutates the array
    // but is contained to the context and doesn't escape the sandbox
    evalExpr('chars.push("Carol") > 0', ctx);
    // Mutation happened but is contained
    expect(chars.length).toBe(3);
  });

  test("sort mutates in place but is contained", () => {
    const chars = ["Charlie", "Alice", "Bob"];
    const ctx = makeContext({ chars });
    evalExpr("chars.sort().length > 0", ctx);
    // Mutation is contained to context
    expect(chars[0]).toBe("Alice");
  });
});

// =============================================================================
// Edge Cases in Code Generation
// =============================================================================

describe("code generation safety", () => {
  test("string with quotes is properly escaped", () => {
    // JSON.stringify handles double quotes
    const ctx = makeContext({ content: 'he said "hello"' });
    expect(evalExpr('content.includes("hello")', ctx)).toBe(true);
  });

  test("string with backslashes is properly escaped", () => {
    const ctx = makeContext({ content: "path\\to\\file" });
    expect(evalExpr("content.length > 0", ctx)).toBe(true);
  });

  test("empty expression fails gracefully", () => {
    expect(() => compileExpr("")).toThrow();
  });

  test("whitespace-only expression fails gracefully", () => {
    expect(() => compileExpr("   ")).toThrow();
  });

  test("expression caching does not allow cache poisoning", () => {
    // Two different expressions should not share cache
    const fn1 = compileExpr("true");
    const fn2 = compileExpr("false");
    expect(fn1).not.toBe(fn2);

    const ctx = makeContext();
    expect(fn1(ctx)).toBe(true);
    expect(fn2(ctx)).toBe(false);
  });

  test("literal number stringification is safe", () => {
    const ctx = makeContext();
    expect(evalExpr("42 == 42", ctx)).toBe(true);
    expect(evalExpr("3.14 > 3", ctx)).toBe(true);
    expect(evalExpr("0 == 0", ctx)).toBe(true);
  });

  test("boolean literal stringification is safe", () => {
    const ctx = makeContext();
    expect(evalExpr("true == true", ctx)).toBe(true);
    expect(evalExpr("false == false", ctx)).toBe(true);
  });
});

// =============================================================================
// Specific Known CVE Patterns
// =============================================================================

describe("known sandbox escape patterns", () => {
  const ctx = makeContext({ content: "test" });

  test("constructor.constructor('return this')()", () => {
    // Classic: get Function via constructor chain, execute arbitrary code
    expect(() => compileExpr("content.constructor")).toThrow("Blocked property access: constructor");
  });

  test("__proto__.constructor pattern", () => {
    expect(() => compileExpr("content.__proto__")).toThrow("Blocked property access: __proto__");
  });

  test("toString.call pattern for type confusion", () => {
    // toString is not blocked (it's a normal method), but constructor IS
    // So toString().constructor would be blocked
    expect(() => compileExpr("content.toString().constructor")).toThrow("Blocked property access: constructor");
  });

  test("[].fill.constructor('return this')()", () => {
    // Bracket notation not supported + constructor blocked
    expect(() => evalExpr("[].fill.constructor", ctx)).toThrow();
  });

  test("''.sub.call.call pattern", () => {
    // Empty string literal doesn't have methods accessible this way
    // The key is that constructor is always blocked
    expect(() => compileExpr('"".constructor')).toThrow("Blocked property access: constructor");
  });

  test("Object.keys/entries/values not accessible", () => {
    expect(() => compileExpr("Object")).toThrow("Unknown identifier: Object");
  });

  test("Reflect not accessible", () => {
    expect(() => compileExpr("Reflect")).toThrow("Unknown identifier: Reflect");
  });

  test("JSON.parse not accessible", () => {
    expect(() => compileExpr("JSON")).toThrow("Unknown identifier: JSON");
  });

  test("Math not accessible", () => {
    expect(() => compileExpr("Math")).toThrow("Unknown identifier: Math");
  });

  test("Date not accessible", () => {
    expect(() => compileExpr("Date")).toThrow("Unknown identifier: Date");
  });

  test("console not accessible", () => {
    expect(() => compileExpr("console")).toThrow("Unknown identifier: console");
  });

  test("setTimeout/setInterval not accessible", () => {
    expect(() => compileExpr("setTimeout")).toThrow("Unknown identifier: setTimeout");
    expect(() => compileExpr("setInterval")).toThrow("Unknown identifier: setInterval");
  });

  test("fetch not accessible", () => {
    expect(() => compileExpr("fetch")).toThrow("Unknown identifier: fetch");
  });

  test("atob/btoa not accessible", () => {
    expect(() => compileExpr("atob")).toThrow("Unknown identifier: atob");
    expect(() => compileExpr("btoa")).toThrow("Unknown identifier: btoa");
  });

  test("structuredClone not accessible", () => {
    expect(() => compileExpr("structuredClone")).toThrow("Unknown identifier: structuredClone");
  });
});

// =============================================================================
// Prototype-less Objects (Object.create(null))
// =============================================================================

describe("prototype-less context objects", () => {
  test("self has no prototype (Object.create(null))", () => {
    const ctx = makeContext();
    // self is created with Object.create(null)
    expect(Object.getPrototypeOf(ctx.self)).toBe(null);
  });

  test("time has no prototype", () => {
    const ctx = makeContext();
    expect(Object.getPrototypeOf(ctx.time)).toBe(null);
  });

  test("channel has no prototype", () => {
    const ctx = makeContext();
    expect(Object.getPrototypeOf(ctx.channel)).toBe(null);
  });

  test("server has no prototype", () => {
    const ctx = makeContext();
    expect(Object.getPrototypeOf(ctx.server)).toBe(null);
  });

  test("self.hasOwnProperty does not exist on null-prototype object", () => {
    const ctx = makeContext();
    expect((ctx.self as any).hasOwnProperty).toBeUndefined();
  });

  test("self.toString does not exist on null-prototype object", () => {
    const ctx = makeContext();
    expect((ctx.self as any).toString).toBeUndefined();
  });
});

// =============================================================================
// evalMacroValue Specific Escapes
// =============================================================================

describe("evalMacroValue sandbox", () => {
  const ctx = makeContext({ content: "test" });

  test("cannot execute arbitrary code via macro expression", () => {
    expect(() => evalMacroValue("process", ctx)).toThrow(ExprError);
    expect(() => evalMacroValue("globalThis", ctx)).toThrow(ExprError);
    expect(() => evalMacroValue("this", ctx)).toThrow(ExprError);
  });

  test("cannot access constructor via macro", () => {
    expect(() => evalMacroValue("content.constructor", ctx)).toThrow(ExprError);
  });

  test("returns safe string for allowed expressions", () => {
    expect(evalMacroValue("content", ctx)).toBe("test");
    expect(evalMacroValue("content.length", ctx)).toBe("4");
    expect(evalMacroValue("mentioned", ctx)).toBe("false");
  });

  test("safe for undefined member access (returns empty string)", () => {
    expect(evalMacroValue("self.nonexistent", ctx)).toBe("");
  });
});

// =============================================================================
// Multi-vector Combined Attacks
// =============================================================================

describe("combined attack vectors", () => {

  test("method chain + constructor attempt", () => {
    expect(() => compileExpr("content.trim().toLowerCase().constructor")).toThrow("Blocked property access: constructor");
  });

  test("ternary + constructor attempt", () => {
    expect(() => compileExpr("true ? content.constructor : false")).toThrow("Blocked property access: constructor");
    expect(() => compileExpr("false ? true : content.constructor")).toThrow("Blocked property access: constructor");
  });

  test("negation + constructor", () => {
    expect(() => compileExpr("!content.constructor")).toThrow("Blocked property access: constructor");
  });

  test("arithmetic + constructor", () => {
    expect(() => compileExpr("content.length + content.constructor")).toThrow("Blocked property access: constructor");
  });

  test("comparison + constructor", () => {
    expect(() => compileExpr("content.constructor == true")).toThrow("Blocked property access: constructor");
  });

  test("function call + constructor on result", () => {
    expect(() => compileExpr("has_fact('test').constructor")).toThrow("Blocked property access: constructor");
  });

  test("nested function call + prototype", () => {
    expect(() => compileExpr("random.call.prototype")).toThrow("Blocked property access: prototype");
  });
});
