import { describe, expect, test } from "bun:test";
import {
  compileExpr,
  evalExpr,
  evalMacroValue,
  parseFact,
  evaluateFacts,
  parseSelfContext,
  createBaseContext,
  ExprError,
  rollDice,
  formatDuration,
  parseOffset,
  type ExprContext,
} from "./expr";

// =============================================================================
// Test Helpers
// =============================================================================

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
  let textToCheck: string;
  if (hasQuotes || hasMultipleParagraphs) {
    if (!hasQuotes) return false;
    textToCheck = quotedParts.join(" ");
  } else {
    textToCheck = content;
  }

  // Word boundary check for the name
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namePattern = new RegExp(`\\b${escapedName}\\b`, "i");
  return namePattern.test(textToCheck);
}

function makeContext(overrides: Partial<ExprContext> = {}): ExprContext {
  // Support legacy content/author overrides by wrapping in messages function
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
    mentioned_in_dialogue: (name: string) => checkMentionedInDialogue(messages(1, "%m"), name),
    content: messages(1, "%m"),
    author: messages(1, "%a"),
    name: "",
    chars,
    messages,
    group: overrides.group ?? chars.join(", "),
    duration: (ms: number) => formatDuration(ms),
    date_str: () => new Date().toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" }),
    time_str: () => new Date().toLocaleTimeString("en-US"),
    isodate: () => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    },
    isotime: () => {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    },
    weekday: () => new Date().toLocaleDateString("en-US", { weekday: "long" }),
    channel: Object.assign(Object.create(null), { id: "", name: "", description: "", mention: "" }),
    server: Object.assign(Object.create(null), { id: "", name: "", description: "" }),
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

  test("method chaining after function call", () => {
    const ctx = makeContext({ content: "Hello World" });
    expect(evalExpr('content.toLowerCase().startsWith("hello")', ctx)).toBe(true);
    expect(evalExpr('content.toLowerCase().startsWith("world")', ctx)).toBe(false);
    expect(evalExpr('content.toUpperCase().endsWith("WORLD")', ctx)).toBe(true);
  });

  test("property access on string", () => {
    const ctx = makeContext({ content: "hello" });
    expect(evalExpr("content.length == 5", ctx)).toBe(true);
    expect(evalExpr("content.length > 3", ctx)).toBe(true);
  });

  test("multiple method chains", () => {
    const ctx = makeContext({ content: "  Hello  " });
    expect(evalExpr('content.trim().toLowerCase() == "hello"', ctx)).toBe(true);
  });

  test("method with arguments in chain", () => {
    const ctx = makeContext({ content: "hello world" });
    expect(evalExpr('content.split(" ").length == 2', ctx)).toBe(true);
    expect(evalExpr('content.includes("world")', ctx)).toBe(true);
    expect(evalExpr('content.replace("world", "there").includes("there")', ctx)).toBe(true);
  });
});

// =============================================================================
// Security Tests - Identifier Whitelist
// =============================================================================

describe("identifier whitelist", () => {
  test("allows known globals", () => {
    const ctx = makeContext({ mentioned: true, response_ms: 100 });
    expect(evalExpr("mentioned", ctx)).toBe(true);
    expect(evalExpr("response_ms > 50", ctx)).toBe(true);
    expect(evalExpr("retry_ms >= 0", ctx)).toBe(true);
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

  test("blocks constructor in method chain", () => {
    const ctx = makeContext({ content: "test" });
    expect(() => evalExpr("content.toLowerCase().constructor", ctx)).toThrow("Blocked property access: constructor");
    expect(() => evalExpr("content.constructor.constructor", ctx)).toThrow("Blocked property access: constructor");
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
      "$# this is a comment",
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
    expect(() => parseFact("$if random() < 0.5 has wings")).toThrow("Expected ':'");
  });

  test("handles colon inside string in $if expression", () => {
    const result = parseFact('$if name == "foo:bar": $respond');
    expect(result.conditional).toBe(true);
    expect(result.expression).toBe('name == "foo:bar"');
    expect(result.isRespond).toBe(true);
  });

  test("handles ternary with colon in $if expression", () => {
    const result = parseFact("$if a ? b : c: some fact");
    expect(result.conditional).toBe(true);
    expect(result.expression).toBe("a ? b : c");
    expect(result.content).toBe("some fact");
  });

  test("handles apostrophe in content (not expression)", () => {
    // BUG: Eager tokenization was parsing content after colon,
    // seeing the apostrophe in "It's" as start of unterminated string
    const result = parseFact("$if true: It's adorable.");
    expect(result.conditional).toBe(true);
    expect(result.expression).toBe("true");
    expect(result.content).toBe("It's adorable.");
  });

  test("handles multiple apostrophes in content", () => {
    const result = parseFact("$if mentioned: She's sure that it's working.");
    expect(result.conditional).toBe(true);
    expect(result.expression).toBe("mentioned");
    expect(result.content).toBe("She's sure that it's working.");
  });

  test("handles Discord emote in expression followed by apostrophe in content", () => {
    const result = parseFact('$if messages(5).includes("<:nnsob:123>"): It\'s an emote.');
    expect(result.conditional).toBe(true);
    expect(result.expression).toBe('messages(5).includes("<:nnsob:123>")');
    expect(result.content).toBe("It's an emote.");
  });

  test("handles unbalanced quotes in content", () => {
    // Content after colon shouldn't be tokenized as expression
    const result = parseFact('$if true: He said "hello and left');
    expect(result.conditional).toBe(true);
    expect(result.content).toBe('He said "hello and left');
  });

  test("handles colons in content after expression", () => {
    const result = parseFact("$if true: time: 12:34:56");
    expect(result.conditional).toBe(true);
    expect(result.content).toBe("time: 12:34:56");
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
      "$# this is a comment",
      "visible fact",
      "$# another comment",
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
      messages: (n, fmt) => fmt === "%m" ? "hello" : fmt === "%a" ? "Bob" : "Bob: hello",
    });

    expect(ctx.self.name).toBe("Alice");
    expect(ctx.self.level).toBe(5);
    expect(ctx.mentioned).toBe(true);
    expect(ctx.content).toBe("hello");
    expect(ctx.author).toBe("Bob");
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

  test("is_self variable works", () => {
    const ctx1 = makeContext({ is_self: true });
    const ctx2 = makeContext({ is_self: false });
    expect(evalExpr("is_self", ctx1)).toBe(true);
    expect(evalExpr("is_self", ctx2)).toBe(false);
    expect(evalExpr("!is_self", ctx1)).toBe(false);
    expect(evalExpr("!is_self", ctx2)).toBe(true);
  });

  test("mentioned_in_dialogue function checks quoted text", () => {
    // With quotes, only checks within quotes
    const ctx = makeContext({ content: '<Alice> "Hey Bob, how are you?"' });
    expect(evalExpr('mentioned_in_dialogue("Bob")', ctx)).toBe(true);
    expect(evalExpr('mentioned_in_dialogue("bob")', ctx)).toBe(true); // case insensitive
    expect(evalExpr('mentioned_in_dialogue("Alice")', ctx)).toBe(false); // Alice is outside quotes
  });

  test("mentioned_in_dialogue falls back to full content when no quotes", () => {
    // Without quotes, checks full content
    const ctx = makeContext({ content: "Hey Alice, how are you?" });
    expect(evalExpr('mentioned_in_dialogue("Alice")', ctx)).toBe(true);
    expect(evalExpr('mentioned_in_dialogue("Bob")', ctx)).toBe(false);
  });

  test("mentioned_in_dialogue excludes partial matches", () => {
    const ctx = makeContext({ content: '"Alice went to Aliceland"' });
    expect(evalExpr('mentioned_in_dialogue("Alice")', ctx)).toBe(true);
    expect(evalExpr('mentioned_in_dialogue("Alic")', ctx)).toBe(false); // word boundary
  });

  test("mentioned_in_dialogue handles multiple quotes", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n, fmt) => fmt === "%m" ? '<Alice> "Hello" <Bob> "Hey Alice!"' : "",
    });
    // Alice is mentioned in second quote
    expect(ctx.mentioned_in_dialogue("Alice")).toBe(true);
    // Hello is in first quote
    expect(ctx.mentioned_in_dialogue("Hello")).toBe(true);
    // Bob is outside quotes (in narration tag)
    expect(ctx.mentioned_in_dialogue("Bob")).toBe(false);
  });

  test("mentioned_in_dialogue handles single quotes", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n, fmt) => fmt === "%m" ? "<Alice> 'Hey Bob!'" : "",
    });
    expect(ctx.mentioned_in_dialogue("Bob")).toBe(true);
    expect(ctx.mentioned_in_dialogue("Alice")).toBe(false);
  });

  test("mentioned_in_dialogue with multiple paragraphs requires quotes", () => {
    // Multiple paragraphs without quotes - name should NOT match
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n, fmt) => fmt === "%m" ? "Alice walked into the room.\nShe looked around." : "",
    });
    expect(ctx.mentioned_in_dialogue("Alice")).toBe(false);
    expect(ctx.mentioned_in_dialogue("She")).toBe(false);

    // Multiple paragraphs with quotes - only check within quotes
    const ctx2 = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n, fmt) => fmt === "%m" ? 'Alice walked in.\n"Hey Bob!" she said.' : "",
    });
    expect(ctx2.mentioned_in_dialogue("Bob")).toBe(true);
    expect(ctx2.mentioned_in_dialogue("Alice")).toBe(false); // Outside quotes
  });

  test("is_self and mentioned_in_dialogue combined", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n, fmt) => fmt === "%m" ? "Hey Alice!" : "",
      is_self: false,
      name: "Alice",
    });
    // Common pattern: respond when name mentioned but not self-triggered
    expect(evalExpr('mentioned_in_dialogue("Alice") && !is_self', ctx)).toBe(true);

    const selfCtx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n, fmt) => fmt === "%m" ? "Hey Alice!" : "",
      is_self: true,
      name: "Alice",
    });
    expect(evalExpr('mentioned_in_dialogue("Alice") && !is_self', selfCtx)).toBe(false);
  });
});

// =============================================================================
// Edge Cases - Discord Emotes
// =============================================================================

describe("Discord emote edge cases", () => {
  test("emote in expression string", () => {
    const ctx = makeContext({
      messages: () => "hey <:smile:123456789012345678> nice",
    });
    expect(evalExpr('messages().includes("<:smile:123456789012345678>")', ctx)).toBe(true);
  });

  test("multiple emotes in messages check", () => {
    const ctx = makeContext({
      messages: () => "<:a:123> <:b:456> <:c:789>",
    });
    expect(evalExpr('messages().includes("<:a:123>")', ctx)).toBe(true);
    expect(evalExpr('messages().includes("<:b:456>")', ctx)).toBe(true);
    expect(evalExpr('messages().includes("<:d:000>")', ctx)).toBe(false);
  });

  test("animated emote format", () => {
    const ctx = makeContext({
      messages: () => "look <a:animated:12345>",
    });
    expect(evalExpr('messages().includes("<a:animated:12345>")', ctx)).toBe(true);
  });

  test("$if with emote followed by content with apostrophe", () => {
    // Tests that apostrophes in content after emote conditions don't break parsing
    const facts = [
      '$if messages(5).includes("<:emote:123456789>"): <:emote:123456789> is an emote. It\'s adorable.',
    ];
    const ctx = makeContext({
      messages: () => "test <:emote:123456789> test",
    });
    const result = evaluateFacts(facts, ctx);
    expect(result.facts).toContain("<:emote:123456789> is an emote. It's adorable.");
  });
});

// =============================================================================
// Edge Cases - Complex Expressions
// =============================================================================

describe("complex expression edge cases", () => {
  test("deeply nested boolean logic", () => {
    const ctx = makeContext({
      mentioned: true,
      replied: false,
      is_self: false,
      is_forward: false,
    });
    expect(evalExpr("((mentioned || replied) && !is_self) || is_forward", ctx)).toBe(true);
    expect(evalExpr("(mentioned && (replied || !is_self)) && !is_forward", ctx)).toBe(true);
  });

  test("chained comparisons", () => {
    const ctx = makeContext({ response_ms: 5000 });
    expect(evalExpr("response_ms > 1000 && response_ms < 10000", ctx)).toBe(true);
    expect(evalExpr("response_ms >= 5000 && response_ms <= 5000", ctx)).toBe(true);
  });

  test("arithmetic in conditions", () => {
    const ctx = makeContext({ response_ms: 30000 });
    expect(evalExpr("response_ms / 1000 > 20", ctx)).toBe(true);
    expect(evalExpr("response_ms % 10000 == 0", ctx)).toBe(true);
    expect(evalExpr("(response_ms / 1000) * 2 == 60", ctx)).toBe(true);
  });

  test("string methods with arguments", () => {
    const ctx = makeContext({ content: "Hello World!" });
    expect(evalExpr('content.startsWith("Hello")', ctx)).toBe(true);
    expect(evalExpr('content.endsWith("!")', ctx)).toBe(true);
    expect(evalExpr('content.slice(0, 5) == "Hello"', ctx)).toBe(true);
    expect(evalExpr("content.indexOf(\"World\") == 6", ctx)).toBe(true);
  });

  test("ternary with method calls", () => {
    const ctx = makeContext({ content: "LOUD" });
    expect(evalExpr('content == content.toUpperCase() ? true : false', ctx)).toBe(true);
    const ctx2 = makeContext({ content: "quiet" });
    expect(evalExpr('content == content.toUpperCase() ? true : false', ctx2)).toBe(false);
  });

  test("multiple function calls", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: (p) => p === "wings" || p === "can fly",
    });
    expect(evalExpr('has_fact("wings") && has_fact("can fly")', ctx)).toBe(true);
    expect(evalExpr('has_fact("wings") && has_fact("gills")', ctx)).toBe(false);
  });
});

// =============================================================================
// Permission Directives
// =============================================================================

describe("permission directives", () => {
  test("$edit with usernames", () => {
    const facts = ["$edit alice, bob, carol", "some fact"];
    const result = parsePermissionDirectives(facts);
    expect(result.editList).toEqual(["alice", "bob", "carol"]);
  });

  test("$edit @everyone", () => {
    const facts = ["$edit @everyone"];
    const result = parsePermissionDirectives(facts);
    expect(result.editList).toBe("everyone");
  });

  test("$edit everyone (without @)", () => {
    const facts = ["$edit everyone"];
    const result = parsePermissionDirectives(facts);
    expect(result.editList).toBe("everyone");
  });

  test("$view with usernames", () => {
    const facts = ["$view alice, bob"];
    const result = parsePermissionDirectives(facts);
    expect(result.viewList).toEqual(["alice", "bob"]);
  });

  test("$view @everyone", () => {
    const facts = ["$view @everyone"];
    const result = parsePermissionDirectives(facts);
    expect(result.viewList).toBe("everyone");
  });

  test("$locked directive", () => {
    const facts = ["$locked"];
    const result = parsePermissionDirectives(facts);
    expect(result.isLocked).toBe(true);
    expect(result.lockedFacts.size).toBe(0);
  });

  test("$locked prefix on fact", () => {
    const facts = ["$locked this is protected", "$locked another protected"];
    const result = parsePermissionDirectives(facts);
    expect(result.isLocked).toBe(false);
    expect(result.lockedFacts.has("this is protected")).toBe(true);
    expect(result.lockedFacts.has("another protected")).toBe(true);
  });

  test("multiple permission directives", () => {
    const facts = [
      "$edit alice, bob",
      "$view @everyone",
      "$locked secret fact",
      "normal fact",
    ];
    const result = parsePermissionDirectives(facts);
    expect(result.editList).toEqual(["alice", "bob"]);
    expect(result.viewList).toBe("everyone");
    expect(result.lockedFacts.has("secret fact")).toBe(true);
  });

  test("ignores comments in permission parsing", () => {
    const facts = [
      "$# $edit everyone",
      "$edit alice",
    ];
    const result = parsePermissionDirectives(facts);
    expect(result.editList).toEqual(["alice"]);
  });
});

// =============================================================================
// $avatar Directive
// =============================================================================

describe("$avatar directive", () => {
  test("parses avatar URL", () => {
    const result = parseFact("$avatar https://example.com/avatar.png");
    expect(result.isAvatar).toBe(true);
    expect(result.avatarUrl).toBe("https://example.com/avatar.png");
  });

  test("handles URL with query params", () => {
    const result = parseFact("$avatar https://cdn.example.com/img.png?size=128&format=webp");
    expect(result.isAvatar).toBe(true);
    expect(result.avatarUrl).toBe("https://cdn.example.com/img.png?size=128&format=webp");
  });

  test("avatar in evaluateFacts", () => {
    const facts = ["$avatar https://example.com/avatar.png", "some fact"];
    const ctx = makeContext();
    const result = evaluateFacts(facts, ctx);
    expect(result.avatarUrl).toBe("https://example.com/avatar.png");
    expect(result.facts).toEqual(["some fact"]);
  });

  test("last avatar wins", () => {
    const facts = [
      "$avatar https://example.com/first.png",
      "$avatar https://example.com/second.png",
    ];
    const ctx = makeContext();
    const result = evaluateFacts(facts, ctx);
    expect(result.avatarUrl).toBe("https://example.com/second.png");
  });
});

// =============================================================================
// $locked in evaluateFacts
// =============================================================================

describe("$locked in evaluateFacts", () => {
  test("$locked sets isLocked flag", () => {
    const facts = ["$locked", "some fact"];
    const ctx = makeContext();
    const result = evaluateFacts(facts, ctx);
    expect(result.isLocked).toBe(true);
    expect(result.facts).toEqual(["some fact"]);
  });

  test("$locked prefix adds to lockedFacts and includes in facts", () => {
    const facts = ["$locked protected content", "normal content"];
    const ctx = makeContext();
    const result = evaluateFacts(facts, ctx);
    expect(result.isLocked).toBe(false);
    expect(result.lockedFacts.has("protected content")).toBe(true);
    expect(result.facts).toContain("protected content");
    expect(result.facts).toContain("normal content");
  });

  test("$lockedOther is not a directive", () => {
    const facts = ["$lockedOther"];
    const ctx = makeContext();
    const result = evaluateFacts(facts, ctx);
    expect(result.isLocked).toBe(false);
    expect(result.facts).toContain("$lockedOther");
  });

  test("$locked $if evaluates condition", () => {
    const facts = ["$locked $if mentioned: secret info"];
    const ctx = makeContext({ mentioned: true });
    const result = evaluateFacts(facts, ctx);
    expect(result.facts).toContain("secret info");
    expect(result.lockedFacts.has("secret info")).toBe(true);
  });

  test("$locked $if does not include when condition false", () => {
    const facts = ["$locked $if mentioned: secret info"];
    const ctx = makeContext({ mentioned: false });
    const result = evaluateFacts(facts, ctx);
    expect(result.facts).not.toContain("secret info");
    expect(result.lockedFacts.has("secret info")).toBe(false);
  });

  test("$locked $if with complex condition", () => {
    const facts = ["$locked $if response_ms > 1000 && !is_self: rate limited response"];
    const ctx = makeContext({ response_ms: 5000, is_self: false });
    const result = evaluateFacts(facts, ctx);
    expect(result.facts).toContain("rate limited response");
    expect(result.lockedFacts.has("rate limited response")).toBe(true);
  });
});

// =============================================================================
// Error Messages
// =============================================================================

describe("error messages", () => {
  test("unterminated string error", () => {
    const ctx = makeContext();
    expect(() => evalExpr('"hello', ctx)).toThrow("Unterminated string");
    expect(() => evalExpr("'hello", ctx)).toThrow("Unterminated string");
  });

  test("unexpected character error", () => {
    const ctx = makeContext();
    expect(() => evalExpr("1 @ 2", ctx)).toThrow("Unexpected character: @");
    expect(() => evalExpr("$foo", ctx)).toThrow("Unexpected character: $");
  });

  test("unknown identifier error", () => {
    const ctx = makeContext();
    expect(() => evalExpr("unknownVar", ctx)).toThrow("Unknown identifier: unknownVar");
  });

  test("blocked property error", () => {
    const ctx = makeContext();
    expect(() => evalExpr("self.constructor", ctx)).toThrow("Blocked property access: constructor");
    expect(() => evalExpr("self.__proto__", ctx)).toThrow("Blocked property access: __proto__");
  });

  test("expected colon error in $if", () => {
    expect(() => parseFact("$if true has wings")).toThrow("Expected ':'");
  });

  test("invalid dice expression error", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    expect(() => evalExpr('roll("notdice")', ctx)).toThrow("Invalid dice expression");
  });
});

// =============================================================================
// Numeric Edge Cases
// =============================================================================

describe("numeric edge cases", () => {
  test("zero", () => {
    const ctx = makeContext({ response_ms: 0 });
    expect(evalExpr("response_ms == 0", ctx)).toBe(true);
    expect(evalExpr("response_ms > 0", ctx)).toBe(false);
    expect(evalExpr("response_ms >= 0", ctx)).toBe(true);
  });

  test("negative numbers", () => {
    const ctx = makeContext();
    expect(evalExpr("-5 < 0", ctx)).toBe(true);
    expect(evalExpr("-5 + 10 == 5", ctx)).toBe(true);
    expect(evalExpr("-(-5) == 5", ctx)).toBe(true);
  });

  test("large numbers", () => {
    const ctx = makeContext({ response_ms: 86400000 }); // 24 hours in ms
    expect(evalExpr("response_ms > 60000", ctx)).toBe(true);
    expect(evalExpr("response_ms / 1000 / 60 / 60 == 24", ctx)).toBe(true);
  });

  test("decimal precision", () => {
    const ctx = makeContext();
    expect(evalExpr("0.1 + 0.2 > 0.29", ctx)).toBe(true);
    expect(evalExpr("0.1 + 0.2 < 0.31", ctx)).toBe(true);
  });
});

// =============================================================================
// String Edge Cases
// =============================================================================

describe("string edge cases", () => {
  test("empty string", () => {
    const ctx = makeContext({ content: "" });
    expect(evalExpr('content == ""', ctx)).toBe(true);
    expect(evalExpr("content.length == 0", ctx)).toBe(true);
    expect(evalExpr('content.includes("")', ctx)).toBe(true);
  });

  test("whitespace only", () => {
    const ctx = makeContext({ content: "   " });
    expect(evalExpr("content.trim() == ''", ctx)).toBe(true);
    expect(evalExpr("content.length == 3", ctx)).toBe(true);
  });

  test("unicode characters", () => {
    const ctx = makeContext({ content: "Hello 🌍 World 日本語" });
    expect(evalExpr('content.includes("🌍")', ctx)).toBe(true);
    expect(evalExpr('content.includes("日本語")', ctx)).toBe(true);
  });

  test("newlines in content", () => {
    const ctx = makeContext({ content: "line1\nline2\nline3" });
    // Note: \n in expression string is interpreted as escape sequence for 'n'
    // so includes("\\n") actually searches for 'n', not newline
    expect(evalExpr('content.includes("n")', ctx)).toBe(true);
    // The content has actual newline characters
    expect(ctx.content.includes("\n")).toBe(true);
  });

  test("special regex characters in string", () => {
    const ctx = makeContext({ content: "test.*+?^${}()|[]" });
    expect(evalExpr('content.includes(".*")', ctx)).toBe(true);
    expect(evalExpr('content.includes("[]")', ctx)).toBe(true);
  });
});

// =============================================================================
// Real World Entity Test (sanitized)
// =============================================================================

describe("real world: complex entity with apostrophes", () => {
  // Simulates a real entity with various $if conditions and apostrophes in content
  const entityFacts = [
    "$edit user1, user2",
    "$avatar https://example.com/avatar.png",
    "entity is a friendly bot",
    "responds in short messages",
    "### Rules",
    '$if mentioned_in_dialogue("buddy") && !is_self: $respond',
    "### Server Emotes",
    '$if messages(5).includes("<:happy:123456>"): <:happy:123456> is a happy face emote.',
    '$if messages(5).includes("<:sad:789012>"): <:sad:789012> is a sad face. It\'s quite expressive!',
    "$if true: There's always something to say. It's nice to chat!",
    "### Terms",
    '$if messages(5).includes("hello"): "Hello" is a common greeting.',
    "### Memory",
    "The entity's favorite color is blue.",
    "Users have been asking about the bot's features, which it finds flattering.",
  ];

  test("parses all facts without error", () => {
    const ctx = makeContext({
      messages: () => "test message",
      is_self: false,
    });
    // This should not throw - especially the apostrophes in content
    expect(() => evaluateFacts(entityFacts, ctx)).not.toThrow();
  });

  test("responds when name mentioned in dialogue", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n, fmt) => fmt === "%m" ? '"Hey buddy, come here!"' : "User",
      is_self: false,
    });
    const result = evaluateFacts(entityFacts, ctx);
    expect(result.shouldRespond).toBe(true);
  });

  test("does not respond when is_self", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n, fmt) => fmt === "%m" ? '"Hey buddy!"' : "User",
      is_self: true,
    });
    const result = evaluateFacts(entityFacts, ctx);
    expect(result.shouldRespond).toBe(null); // Condition not met
  });

  test("includes emote info when emote in messages", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: () => "look at this <:happy:123456>",
      is_self: false,
    });
    const result = evaluateFacts(entityFacts, ctx);
    expect(result.facts.some(f => f.includes("happy face emote"))).toBe(true);
  });

  test("includes always-true fact with apostrophes", () => {
    const ctx = makeContext({
      messages: () => "random message",
      is_self: false,
    });
    const result = evaluateFacts(entityFacts, ctx);
    expect(result.facts.some(f => f.includes("There's always"))).toBe(true);
    expect(result.facts.some(f => f.includes("It's nice"))).toBe(true);
  });

  test("includes term definition when keyword mentioned", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: () => "hello there friend",
      is_self: false,
    });
    const result = evaluateFacts(entityFacts, ctx);
    expect(result.facts.some(f => f.includes("common greeting"))).toBe(true);
  });

  test("gets avatar URL", () => {
    const ctx = makeContext({
      messages: () => "test",
      is_self: false,
    });
    const result = evaluateFacts(entityFacts, ctx);
    expect(result.avatarUrl).toBe("https://example.com/avatar.png");
  });

  test("handles possessive apostrophes in content", () => {
    const ctx = makeContext({
      messages: () => "test",
      is_self: false,
    });
    const result = evaluateFacts(entityFacts, ctx);
    // These facts have possessive apostrophes that shouldn't break parsing
    expect(result.facts.some(f => f.includes("entity's favorite"))).toBe(true);
    expect(result.facts.some(f => f.includes("bot's features"))).toBe(true);
  });
});

// =============================================================================
// messages() Function
// =============================================================================

describe("messages() function", () => {
  test("default call returns last message formatted", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n = 1, fmt = "%a: %m") => {
        const msgs = [{ a: "Alice", m: "Hello!" }];
        return msgs.slice(0, n).map(msg =>
          fmt.replace("%a", msg.a).replace("%m", msg.m)
        ).join("\n");
      },
    });
    expect(evalExpr('messages().includes("Alice")', ctx)).toBe(true);
    expect(evalExpr('messages().includes("Hello")', ctx)).toBe(true);
  });

  test("messages with custom format", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n = 1, fmt = "%a: %m") => {
        if (fmt === "%m") return "Hello!";
        if (fmt === "%a") return "Alice";
        return "Alice: Hello!";
      },
    });
    expect(evalExpr('messages(1, "%m") == "Hello!"', ctx)).toBe(true);
    expect(evalExpr('messages(1, "%a") == "Alice"', ctx)).toBe(true);
  });

  test("messages(n) returns multiple", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n = 1) => {
        const all = ["Alice: Hi", "Bob: Hello", "Carol: Hey"];
        return all.slice(0, n).join("\n");
      },
    });
    expect(evalExpr('messages(1).includes("Alice")', ctx)).toBe(true);
    expect(evalExpr('messages(1).includes("Bob")', ctx)).toBe(false);
    expect(evalExpr('messages(2).includes("Bob")', ctx)).toBe(true);
    expect(evalExpr('messages(3).includes("Carol")', ctx)).toBe(true);
  });

  test("content is alias for messages(1, %m)", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n = 1, fmt = "%a: %m") => {
        if (fmt === "%m") return "the message content";
        return "Author: the message content";
      },
    });
    expect(ctx.content).toBe("the message content");
    expect(evalExpr('content == "the message content"', ctx)).toBe(true);
  });

  test("author is alias for messages(1, %a)", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n = 1, fmt = "%a: %m") => {
        if (fmt === "%a") return "TheAuthor";
        return "TheAuthor: message";
      },
    });
    expect(ctx.author).toBe("TheAuthor");
    expect(evalExpr('author == "TheAuthor"', ctx)).toBe(true);
  });
});

// =============================================================================
// New Context Variables
// =============================================================================

describe("new context variables", () => {
  test("idle_ms works in expressions", () => {
    const ctx = makeContext({ idle_ms: 5000 });
    expect(evalExpr("idle_ms > 3000", ctx)).toBe(true);
    expect(evalExpr("idle_ms < 10000", ctx)).toBe(true);
    expect(evalExpr("idle_ms == 5000", ctx)).toBe(true);
  });

  test("channel.* variables work in expressions", () => {
    const channel = Object.assign(Object.create(null), {
      id: "123456",
      name: "general",
      description: "Main chat channel",
      mention: "<#123456>",
    });
    const ctx = makeContext({ channel });
    expect(evalExpr('channel.name == "general"', ctx)).toBe(true);
    expect(evalExpr('channel.description.includes("Main")', ctx)).toBe(true);
    expect(evalExpr('channel.id == "123456"', ctx)).toBe(true);
  });

  test("server.* variables work in expressions", () => {
    const server = Object.assign(Object.create(null), {
      id: "789",
      name: "My Server",
      description: "A cool server",
    });
    const ctx = makeContext({ server });
    expect(evalExpr('server.name == "My Server"', ctx)).toBe(true);
    expect(evalExpr('server.description.includes("cool")', ctx)).toBe(true);
  });
});

// =============================================================================
// evalMacroValue
// =============================================================================

describe("evalMacroValue", () => {
  test("returns string value of expression", () => {
    const ctx = makeContext({ name: "Aria" });
    expect(evalMacroValue("name", ctx)).toBe("Aria");
  });

  test("returns numeric value as string", () => {
    const ctx = makeContext({ response_ms: 5000 });
    expect(evalMacroValue("response_ms", ctx)).toBe("5000");
  });

  test("returns empty string for undefined member", () => {
    const ctx = makeContext();
    expect(evalMacroValue("self.nonexistent", ctx)).toBe("");
  });

  test("evaluates complex expressions", () => {
    const self = Object.create(null);
    self.health = 75;
    const ctx = makeContext({ self });
    expect(evalMacroValue("self.health", ctx)).toBe("75");
  });

  test("evaluates channel.name", () => {
    const channel = Object.assign(Object.create(null), {
      id: "123",
      name: "roleplay",
      description: "",
      mention: "<#123>",
    });
    const ctx = makeContext({ channel });
    expect(evalMacroValue("channel.name", ctx)).toBe("roleplay");
  });

  test("throws ExprError on invalid expression", () => {
    const ctx = makeContext();
    expect(() => evalMacroValue("invalid_var", ctx)).toThrow(ExprError);
  });
});

// =============================================================================
// Roll20 Dice
// =============================================================================

describe("roll20 dice", () => {
  test("basic roll", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("2d6");
      expect(result).toBeGreaterThanOrEqual(2);
      expect(result).toBeLessThanOrEqual(12);
    }
  });

  test("keep highest", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("4d6kh3");
      expect(result).toBeGreaterThanOrEqual(3);
      expect(result).toBeLessThanOrEqual(18);
    }
  });

  test("keep lowest", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("4d6kl1");
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(6);
    }
  });

  test("drop highest", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("4d6dh1");
      expect(result).toBeGreaterThanOrEqual(3);
      expect(result).toBeLessThanOrEqual(18);
    }
  });

  test("drop lowest", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("4d6dl1");
      expect(result).toBeGreaterThanOrEqual(3);
      expect(result).toBeLessThanOrEqual(18);
    }
  });

  test("exploding dice", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("1d6!");
      expect(result).toBeGreaterThanOrEqual(1);
      // Can exceed 6 due to explosions
    }
  });

  test("success counting >=", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("8d6>=5");
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(8);
    }
  });

  test("success counting >", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("4d6>4");
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(4);
    }
  });

  test("success counting <=", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("4d6<=2");
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(4);
    }
  });

  test("success counting <", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("4d6<3");
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(4);
    }
  });

  test("modifier", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("1d20+5");
      expect(result).toBeGreaterThanOrEqual(6);
      expect(result).toBeLessThanOrEqual(25);
    }
  });

  test("negative modifier", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice("1d20-5");
      expect(result).toBeGreaterThanOrEqual(-4);
      expect(result).toBeLessThanOrEqual(15);
    }
  });

  test("invalid expression throws", () => {
    expect(() => rollDice("invalid")).toThrow("Invalid dice expression");
    expect(() => rollDice("d6")).toThrow("Invalid dice expression");
    expect(() => rollDice("")).toThrow("Invalid dice expression");
  });
});

// =============================================================================
// formatDuration
// =============================================================================

describe("formatDuration", () => {
  test("zero returns just now", () => {
    expect(formatDuration(0)).toBe("just now");
  });

  test("1 second", () => {
    expect(formatDuration(1000)).toBe("1 second");
  });

  test("multiple seconds", () => {
    expect(formatDuration(5000)).toBe("5 seconds");
  });

  test("1 minute", () => {
    expect(formatDuration(60000)).toBe("1 minute");
  });

  test("1 hour", () => {
    expect(formatDuration(3600000)).toBe("1 hour");
  });

  test("1 hour 30 minutes", () => {
    expect(formatDuration(5400000)).toBe("1 hour 30 minutes");
  });

  test("1 minute 30 seconds", () => {
    expect(formatDuration(90000)).toBe("1 minute 30 seconds");
  });

  test("1 day", () => {
    expect(formatDuration(86400000)).toBe("1 day");
  });

  test("1 week", () => {
    expect(formatDuration(604800000)).toBe("1 week");
  });

  test("2 weeks 3 days", () => {
    expect(formatDuration(604800000 * 2 + 86400000 * 3)).toBe("2 weeks 3 days");
  });

  test("Infinity returns a long time", () => {
    expect(formatDuration(Infinity)).toBe("a long time");
  });

  test("picks at most 2 units", () => {
    // 1 week, 2 days, 3 hours - should only show first 2
    const ms = 604800000 + 2 * 86400000 + 3 * 3600000;
    expect(formatDuration(ms)).toBe("1 week 2 days");
  });
});

// =============================================================================
// parseOffset
// =============================================================================

describe("parseOffset", () => {
  test("1d", () => {
    const result = parseOffset("1d");
    expect(result.ms).toBe(86400000);
    expect(result.years).toBe(0);
    expect(result.months).toBe(0);
  });

  test("3y2mo", () => {
    const result = parseOffset("3y2mo");
    expect(result.years).toBe(3);
    expect(result.months).toBe(2);
    expect(result.ms).toBe(0);
  });

  test("1h30m", () => {
    const result = parseOffset("1h30m");
    expect(result.ms).toBe(5400000);
  });

  test("negative offset", () => {
    const result = parseOffset("-1w");
    expect(result.ms).toBe(-604800000);
  });

  test("verbose units", () => {
    const result = parseOffset("3 years");
    expect(result.years).toBe(3);
  });

  test("verbose months", () => {
    const result = parseOffset("2 months");
    expect(result.months).toBe(2);
  });

  test("seconds", () => {
    const result = parseOffset("30s");
    expect(result.ms).toBe(30000);
  });

  test("combined ms units", () => {
    const result = parseOffset("1w2d");
    expect(result.ms).toBe(604800000 + 2 * 86400000);
  });
});

// =============================================================================
// New ExprContext Functions
// =============================================================================

describe("new ExprContext functions", () => {
  test("duration formats ms as human-readable", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    expect(ctx.duration(5400000)).toBe("1 hour 30 minutes");
    expect(ctx.duration(0)).toBe("just now");
    expect(ctx.duration(Infinity)).toBe("a long time");
  });

  test("date_str returns non-empty string", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    expect(ctx.date_str()).toBeTruthy();
    expect(typeof ctx.date_str()).toBe("string");
  });

  test("time_str returns non-empty string", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    expect(ctx.time_str()).toBeTruthy();
    expect(typeof ctx.time_str()).toBe("string");
  });

  test("isodate returns YYYY-MM-DD format", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    expect(ctx.isodate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("isotime returns HH:MM format", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    expect(ctx.isotime()).toMatch(/^\d{2}:\d{2}$/);
  });

  test("weekday returns a valid day name", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    expect(days).toContain(ctx.weekday());
  });

  test("date functions accept offset", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    // Should not throw with offset
    expect(typeof ctx.date_str("1d")).toBe("string");
    expect(typeof ctx.time_str("-1h")).toBe("string");
    expect(ctx.isodate("1y")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ctx.isotime("30m")).toMatch(/^\d{2}:\d{2}$/);
    expect(typeof ctx.weekday("1d")).toBe("string");
  });

  test("group returns comma-separated chars", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      chars: ["Alice", "Bob", "Carol"],
    });
    expect(ctx.group).toBe("Alice, Bob, Carol");
  });

  test("group is empty when no chars", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      chars: [],
    });
    expect(ctx.group).toBe("");
  });

  test("group works in expressions", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      chars: ["Alice", "Bob"],
    });
    expect(evalExpr('group.includes("Alice")', ctx)).toBe(true);
    expect(evalExpr('group.includes("Bob")', ctx)).toBe(true);
    expect(evalExpr('group.includes("Carol")', ctx)).toBe(false);
  });

  test("duration works in expressions", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    expect(evalExpr('duration(60000) == "1 minute"', ctx)).toBe(true);
  });

  test("isodate works in expressions", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    const result = evalMacroValue("isodate()", ctx);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("weekday works in expressions", () => {
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
    });
    const result = evalMacroValue("weekday()", ctx);
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    expect(days).toContain(result);
  });
});

// =============================================================================
// messages() with filter
// =============================================================================

describe("messages() with filter", () => {
  test("filter parameter is passed through", () => {
    let lastFilter: string | undefined;
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n = 1, fmt?: string, filter?: string) => {
        lastFilter = filter;
        return "test";
      },
    });
    ctx.messages(1, "%m", "user");
    expect(lastFilter).toBe("user");

    ctx.messages(1, "%m", "char");
    expect(lastFilter).toBe("char");
  });

  test("messages without filter works normally", () => {
    let lastFilter: string | undefined;
    const ctx = createBaseContext({
      facts: [],
      has_fact: () => false,
      messages: (n = 1, fmt?: string, filter?: string) => {
        lastFilter = filter;
        return "test";
      },
    });
    ctx.messages(1, "%m");
    expect(lastFilter).toBeUndefined();
  });
});

// =============================================================================
// Import parsePermissionDirectives for permission tests
// =============================================================================

import { parsePermissionDirectives } from "./expr";
