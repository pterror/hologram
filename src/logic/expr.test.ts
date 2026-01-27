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
    random: () => 0,
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
      random: () => 0.5, // Always returns 0.5
      has_fact: (p: string) => p === "poisoned",
    });
    expect(evalExpr("random() < 0.6", ctx)).toBe(true);
    expect(evalExpr("random() < 0.4", ctx)).toBe(false);
    expect(evalExpr('has_fact("poisoned")', ctx)).toBe(true);
    expect(evalExpr('has_fact("healthy")', ctx)).toBe(false);
  });

  test("random with arguments", () => {
    // Mock that tracks calls
    let lastArgs: number[] = [];
    const ctx = makeContext({
      random: (min?: number, max?: number) => {
        lastArgs = [min ?? -1, max ?? -1];
        return 0.5;
      },
    });

    evalExpr("random()", ctx);
    expect(lastArgs).toEqual([-1, -1]);

    evalExpr("random(10)", ctx);
    expect(lastArgs).toEqual([10, -1]);

    evalExpr("random(5, 15)", ctx);
    expect(lastArgs).toEqual([5, 15]);
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
      "$if random() < 0.5: has wings",
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
    const result = parseFact("$if random() < 0.5: has wings");
    expect(result.content).toBe("has wings");
    expect(result.conditional).toBe(true);
    expect(result.expression).toBe("random() < 0.5");
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
    expect(() => parseFact("$if random() < 0.5 has wings")).toThrow("missing colon");
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

  test("random() returns values in correct ranges", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });

    // Test many times to check range bounds
    for (let i = 0; i < 100; i++) {
      const r0 = ctx.random();
      expect(r0).toBeGreaterThanOrEqual(0);
      expect(r0).toBeLessThan(1);

      const r10 = ctx.random(10);
      expect(r10).toBeGreaterThanOrEqual(1);
      expect(r10).toBeLessThanOrEqual(10);
      expect(Number.isInteger(r10)).toBe(true);

      const r5_15 = ctx.random(5, 15);
      expect(r5_15).toBeGreaterThanOrEqual(5);
      expect(r5_15).toBeLessThanOrEqual(15);
      expect(Number.isInteger(r5_15)).toBe(true);
    }
  });

  test("roll() returns values in correct ranges", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });

    // Test dice rolls
    for (let i = 0; i < 100; i++) {
      const d6 = ctx.roll("1d6");
      expect(d6).toBeGreaterThanOrEqual(1);
      expect(d6).toBeLessThanOrEqual(6);
      expect(Number.isInteger(d6)).toBe(true);

      const twod6 = ctx.roll("2d6");
      expect(twod6).toBeGreaterThanOrEqual(2);
      expect(twod6).toBeLessThanOrEqual(12);
      expect(Number.isInteger(twod6)).toBe(true);

      const d6plus3 = ctx.roll("1d6+3");
      expect(d6plus3).toBeGreaterThanOrEqual(4);
      expect(d6plus3).toBeLessThanOrEqual(9);
      expect(Number.isInteger(d6plus3)).toBe(true);

      const d6minus2 = ctx.roll("1d6-2");
      expect(d6minus2).toBeGreaterThanOrEqual(-1);
      expect(d6minus2).toBeLessThanOrEqual(4);
      expect(Number.isInteger(d6minus2)).toBe(true);
    }
  });

  test("roll() throws on invalid dice expression", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });

    expect(() => ctx.roll("invalid")).toThrow("Invalid dice expression");
    expect(() => ctx.roll("d6")).toThrow("Invalid dice expression");
    expect(() => ctx.roll("1d")).toThrow("Invalid dice expression");
  });

  test("random() and roll() work in expressions", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });

    // These should all evaluate without error
    for (let i = 0; i < 20; i++) {
      const r1 = evalExpr("random() < 0.5", ctx);
      expect(typeof r1).toBe("boolean");

      const r2 = evalExpr("random(100) < 50", ctx);
      expect(typeof r2).toBe("boolean");

      const r3 = evalExpr('roll("1d6") >= 1', ctx);
      expect(r3).toBe(true);

      const r4 = evalExpr('roll("1d6") <= 6', ctx);
      expect(r4).toBe(true);

      const r5 = evalExpr('roll("2d6+3") >= 5', ctx);
      expect(r5).toBe(true);
    }
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
