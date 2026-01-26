import { describe, expect, test } from "bun:test";
import {
  compileExpr,
  evalExpr,
  parseFact,
  evaluateFacts,
  parseSelfContext,
  createBaseContext,
  ExprError,
  type ExprContext,
} from "./expr";

// =============================================================================
// Test Helpers
// =============================================================================

function makeContext(overrides: Partial<ExprContext> = {}): ExprContext {
  return {
    self: Object.create(null),
    random: () => false,
    has_fact: () => false,
    roll: () => 7,
    time: Object.assign(Object.create(null), {
      hour: 12,
      is_day: true,
      is_night: false,
    }),
    dt_ms: 0,
    elapsed_ms: 0,
    mentioned: false,
    content: "",
    author: "",
    ...overrides,
  };
}

// =============================================================================
// Tokenizer Tests (via compileExpr)
// =============================================================================

describe("tokenizer", () => {
  test("handles numbers", () => {
    const ctx = makeContext();
    expect(evalExpr("42 > 0", ctx)).toBe(true);
    expect(evalExpr("3.14 > 3", ctx)).toBe(true);
    expect(evalExpr(".5 < 1", ctx)).toBe(true);
  });

  test("handles strings", () => {
    const ctx = makeContext({ content: "hello" });
    expect(evalExpr('content == "hello"', ctx)).toBe(true);
    expect(evalExpr("content == 'hello'", ctx)).toBe(true);
  });

  test("handles escape sequences in strings", () => {
    const ctx = makeContext({ content: 'he said "hi"' });
    expect(evalExpr('content == "he said \\"hi\\""', ctx)).toBe(true);
  });

  test("handles booleans", () => {
    const ctx = makeContext();
    expect(evalExpr("true", ctx)).toBe(true);
    expect(evalExpr("false", ctx)).toBe(false);
    expect(evalExpr("true && true", ctx)).toBe(true);
    expect(evalExpr("true && false", ctx)).toBe(false);
  });

  test("handles operators", () => {
    const ctx = makeContext();
    expect(evalExpr("1 + 2 == 3", ctx)).toBe(true);
    expect(evalExpr("5 - 3 == 2", ctx)).toBe(true);
    expect(evalExpr("2 * 3 == 6", ctx)).toBe(true);
    expect(evalExpr("6 / 2 == 3", ctx)).toBe(true);
    expect(evalExpr("7 % 3 == 1", ctx)).toBe(true);
  });

  test("rejects unexpected characters", () => {
    const ctx = makeContext();
    expect(() => evalExpr("1 @ 2", ctx)).toThrow(ExprError);
    expect(() => evalExpr("$foo", ctx)).toThrow(ExprError);
  });

  test("rejects unterminated strings", () => {
    const ctx = makeContext();
    expect(() => evalExpr('"unterminated', ctx)).toThrow("Unterminated string");
  });
});

// =============================================================================
// Parser Tests
// =============================================================================

describe("parser", () => {
  test("operator precedence", () => {
    const ctx = makeContext();
    // * binds tighter than +
    expect(evalExpr("2 + 3 * 4 == 14", ctx)).toBe(true);
    expect(evalExpr("(2 + 3) * 4 == 20", ctx)).toBe(true);
  });

  test("comparison operators", () => {
    const ctx = makeContext();
    expect(evalExpr("1 < 2", ctx)).toBe(true);
    expect(evalExpr("2 > 1", ctx)).toBe(true);
    expect(evalExpr("2 <= 2", ctx)).toBe(true);
    expect(evalExpr("2 >= 2", ctx)).toBe(true);
    expect(evalExpr("2 == 2", ctx)).toBe(true);
    expect(evalExpr("2 != 3", ctx)).toBe(true);
  });

  test("logical operators", () => {
    const ctx = makeContext();
    expect(evalExpr("true && true", ctx)).toBe(true);
    expect(evalExpr("true && false", ctx)).toBe(false);
    expect(evalExpr("false || true", ctx)).toBe(true);
    expect(evalExpr("false || false", ctx)).toBe(false);
    expect(evalExpr("!false", ctx)).toBe(true);
    expect(evalExpr("!true", ctx)).toBe(false);
  });

  test("ternary operator", () => {
    const ctx = makeContext();
    expect(evalExpr("true ? 1 : 2", ctx)).toBe(true); // 1 is truthy
    expect(evalExpr("false ? 1 : 0", ctx)).toBe(false); // 0 is falsy
    expect(evalExpr("true ? true : false", ctx)).toBe(true);
    expect(evalExpr("false ? true : false", ctx)).toBe(false);
  });

  test("nested ternary", () => {
    const ctx = makeContext();
    expect(evalExpr("true ? true : false ? true : false", ctx)).toBe(true);
    expect(evalExpr("false ? true : true ? true : false", ctx)).toBe(true);
  });

  test("member access", () => {
    const self = Object.create(null);
    self.foo = 42;
    self.bar = "hello";
    const ctx = makeContext({ self });
    expect(evalExpr("self.foo == 42", ctx)).toBe(true);
    expect(evalExpr('self.bar == "hello"', ctx)).toBe(true);
  });

  test("function calls", () => {
    const ctx = makeContext({
      random: (n: number) => n > 0.5,
      has_fact: (p: string) => p === "poisoned",
    });
    expect(evalExpr("random(0.6)", ctx)).toBe(true);
    expect(evalExpr("random(0.4)", ctx)).toBe(false);
    expect(evalExpr('has_fact("poisoned")', ctx)).toBe(true);
    expect(evalExpr('has_fact("healthy")', ctx)).toBe(false);
  });

  test("nested member and call", () => {
    const ctx = makeContext();
    expect(evalExpr("time.is_day", ctx)).toBe(true);
    expect(evalExpr("time.hour == 12", ctx)).toBe(true);
  });

  test("rejects trailing tokens", () => {
    const ctx = makeContext();
    expect(() => evalExpr("1 2", ctx)).toThrow("Unexpected token");
  });
});

// =============================================================================
// Security Tests - Identifier Whitelist
// =============================================================================

describe("identifier whitelist", () => {
  test("allows known globals", () => {
    const ctx = makeContext({ mentioned: true, dt_ms: 100 });
    expect(evalExpr("mentioned", ctx)).toBe(true);
    expect(evalExpr("dt_ms > 50", ctx)).toBe(true);
    expect(evalExpr("elapsed_ms >= 0", ctx)).toBe(true);
  });

  test("rejects unknown identifiers", () => {
    const ctx = makeContext();
    expect(() => evalExpr("process", ctx)).toThrow("Unknown identifier: process");
    expect(() => evalExpr("require", ctx)).toThrow("Unknown identifier: require");
    expect(() => evalExpr("global", ctx)).toThrow("Unknown identifier: global");
    expect(() => evalExpr("globalThis", ctx)).toThrow("Unknown identifier: globalThis");
    expect(() => evalExpr("eval", ctx)).toThrow("Unknown identifier: eval");
    expect(() => evalExpr("Function", ctx)).toThrow("Unknown identifier: Function");
    expect(() => evalExpr("Object", ctx)).toThrow("Unknown identifier: Object");
    expect(() => evalExpr("Array", ctx)).toThrow("Unknown identifier: Array");
    expect(() => evalExpr("constructor", ctx)).toThrow("Unknown identifier: constructor");
    expect(() => evalExpr("__proto__", ctx)).toThrow("Unknown identifier: __proto__");
  });
});

// =============================================================================
// Security Tests - Injection Prevention
// =============================================================================

describe("injection prevention", () => {
  test("no bracket notation", () => {
    const ctx = makeContext();
    // Bracket notation is not supported by the parser
    expect(() => evalExpr('self["constructor"]', ctx)).toThrow();
    expect(() => evalExpr("self[0]", ctx)).toThrow();
  });

  test("blocks constructor access", () => {
    const ctx = makeContext();
    expect(() => evalExpr("self.constructor", ctx)).toThrow("Blocked property access: constructor");
    expect(() => evalExpr("random.constructor", ctx)).toThrow("Blocked property access: constructor");
    expect(() => evalExpr("time.constructor", ctx)).toThrow("Blocked property access: constructor");
  });

  test("blocks __proto__ access", () => {
    const ctx = makeContext();
    expect(() => evalExpr("self.__proto__", ctx)).toThrow("Blocked property access: __proto__");
  });

  test("blocks prototype access", () => {
    const ctx = makeContext();
    expect(() => evalExpr("random.prototype", ctx)).toThrow("Blocked property access: prototype");
  });

  test("string escaping prevents code injection", () => {
    const ctx = makeContext();
    // Malicious payloads in strings should be safely escaped
    expect(() => evalExpr('"test"); process.exit(1); ("', ctx)).toThrow();
    expect(() => evalExpr('"${process.exit(1)}"', ctx)).not.toThrow();
    // The string should be literal, not template
    const ctx2 = makeContext({ content: "${process.exit(1)}" });
    expect(evalExpr('content == "${process.exit(1)}"', ctx2)).toBe(true);
  });

  test("no semicolons allowed", () => {
    const ctx = makeContext();
    expect(() => evalExpr("true; false", ctx)).toThrow();
  });

  test("no assignment operators", () => {
    const ctx = makeContext();
    // = alone isn't an operator in our parser
    expect(() => evalExpr("self.foo = 1", ctx)).toThrow();
  });

  test("comment-like sequences don't break parsing", () => {
    const ctx = makeContext({ content: "// not a comment" });
    expect(evalExpr('content == "// not a comment"', ctx)).toBe(true);
    const ctx2 = makeContext({ content: "/* also not */" });
    expect(evalExpr('content == "/* also not */"', ctx2)).toBe(true);
  });
});

// =============================================================================
// Self Context Parsing
// =============================================================================

describe("parseSelfContext", () => {
  test("parses key: value facts", () => {
    const self = parseSelfContext([
      "name: Alice",
      "age: 25",
      "active: true",
      "score: 3.14",
    ]);
    expect(self.name).toBe("Alice");
    expect(self.age).toBe(25);
    expect(self.active).toBe(true);
    expect(self.score).toBe(3.14);
  });

  test("ignores non key-value facts", () => {
    const self = parseSelfContext([
      "is a character",
      "has blue eyes",
      "level: 5",
    ]);
    expect(Object.keys(self)).toEqual(["level"]);
    expect(self.level).toBe(5);
  });

  test("ignores comments", () => {
    const self = parseSelfContext([
      "# this is a comment",
      "name: Bob",
    ]);
    expect(self.name).toBe("Bob");
    expect(Object.keys(self).length).toBe(1);
  });

  test("ignores $if directives", () => {
    const self = parseSelfContext([
      "$if random(0.5): has wings",
      "speed: 10",
    ]);
    expect(Object.keys(self)).toEqual(["speed"]);
  });

  test("no prototype pollution", () => {
    const self = parseSelfContext([
      "__proto__: evil",
      "constructor: bad",
      "toString: oops",
    ]);
    // These should be regular properties, not prototype modifications
    // Cast to any since TS thinks constructor/toString have special types
    expect((self as any).__proto__).toBe("evil");
    expect((self as any).constructor).toBe("bad");
    expect((self as any).toString).toBe("oops");
    // Object prototype should be unaffected
    expect(({} as any).__proto__).not.toBe("evil");
  });
});

// =============================================================================
// Fact Parsing
// =============================================================================

describe("parseFact", () => {
  test("parses simple facts", () => {
    const result = parseFact("has blue eyes");
    expect(result.content).toBe("has blue eyes");
    expect(result.conditional).toBe(false);
  });

  test("parses $if facts", () => {
    const result = parseFact("$if random(0.5): has wings");
    expect(result.content).toBe("has wings");
    expect(result.conditional).toBe(true);
    expect(result.expression).toBe("random(0.5)");
  });

  test("parses $respond directive", () => {
    const result = parseFact("$respond");
    expect(result.isRespond).toBe(true);
    expect(result.respondValue).toBe(true);
  });

  test("parses $respond false", () => {
    const result = parseFact("$respond false");
    expect(result.isRespond).toBe(true);
    expect(result.respondValue).toBe(false);
  });

  test("parses conditional $respond", () => {
    const result = parseFact("$if mentioned: $respond");
    expect(result.conditional).toBe(true);
    expect(result.isRespond).toBe(true);
    expect(result.respondValue).toBe(true);
  });

  test("parses $retry directive", () => {
    const result = parseFact("$retry 5000");
    expect(result.isRetry).toBe(true);
    expect(result.retryMs).toBe(5000);
  });

  test("throws on invalid $if (missing colon)", () => {
    expect(() => parseFact("$if random(0.5) has wings")).toThrow("missing colon");
  });
});

// =============================================================================
// Fact Evaluation
// =============================================================================

describe("evaluateFacts", () => {
  test("returns all non-conditional facts", () => {
    const ctx = makeContext();
    const result = evaluateFacts(["has eyes", "has ears"], ctx);
    expect(result.facts).toEqual(["has eyes", "has ears"]);
  });

  test("filters conditional facts", () => {
    const ctx = makeContext({ mentioned: true });
    const result = evaluateFacts([
      "always visible",
      "$if mentioned: only when mentioned",
      "$if !mentioned: only when not mentioned",
    ], ctx);
    expect(result.facts).toEqual(["always visible", "only when mentioned"]);
  });

  test("strips comments", () => {
    const ctx = makeContext();
    const result = evaluateFacts([
      "# this is a comment",
      "visible fact",
      "# another comment",
    ], ctx);
    expect(result.facts).toEqual(["visible fact"]);
  });

  test("handles $respond directives", () => {
    const ctx = makeContext({ mentioned: true });
    const result = evaluateFacts([
      "some fact",
      "$if mentioned: $respond",
    ], ctx);
    expect(result.shouldRespond).toBe(true);
  });

  test("$respond false suppresses response", () => {
    const ctx = makeContext();
    const result = evaluateFacts([
      "some fact",
      "$respond false",
    ], ctx);
    expect(result.shouldRespond).toBe(false);
  });

  test("last $respond wins", () => {
    const ctx = makeContext();
    const result = evaluateFacts([
      "$respond false",
      "$respond",
    ], ctx);
    expect(result.shouldRespond).toBe(true);
  });

  test("handles $retry directive", () => {
    const ctx = makeContext();
    const result = evaluateFacts([
      "some fact",
      "$retry 3000",
    ], ctx);
    expect(result.retryMs).toBe(3000);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("integration", () => {
  test("createBaseContext builds proper context", () => {
    const ctx = createBaseContext({
      facts: ["name: Alice", "level: 5"],
      has_fact: (p) => p === "poisoned",
      mentioned: true,
      content: "hello",
    });

    expect(ctx.self.name).toBe("Alice");
    expect(ctx.self.level).toBe(5);
    expect(ctx.mentioned).toBe(true);
    expect(ctx.content).toBe("hello");
    expect(typeof ctx.random).toBe("function");
    expect(typeof ctx.time.hour).toBe("number");
  });

  test("real-world expression: self-reference", () => {
    const ctx = createBaseContext({
      facts: ["fox_tf: 0.7"],
      has_fact: () => false,
    });
    expect(evalExpr("self.fox_tf >= 0.5", ctx)).toBe(true);
    expect(evalExpr("self.fox_tf >= 0.8", ctx)).toBe(false);
  });

  test("real-world expression: time-based", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    // time.is_day and time.is_night should be mutually exclusive
    expect(evalExpr("time.is_day || time.is_night", ctx)).toBe(true);
    expect(evalExpr("time.is_day && time.is_night", ctx)).toBe(false);
  });

  test("expression caching works", () => {
    const fn1 = compileExpr("1 + 1 == 2");
    const fn2 = compileExpr("1 + 1 == 2");
    expect(fn1).toBe(fn2); // Same cached function
  });
});
