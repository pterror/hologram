/**
 * Tests for the safe regex pattern validator.
 *
 * The validator rejects regex patterns that could cause catastrophic backtracking
 * (ReDoS) when used with JS string methods like .match(), .search(), .replace(),
 * .split(). The key invariant: no quantifier may be applied to an expression
 * that itself contains a quantifier.
 */
import { describe, expect, test } from "bun:test";
import { validateRegexPattern } from "./safe-regex";
import { compileExpr, evalExpr, ExprError, type ExprContext } from "./expr";
import { formatDuration } from "./expr";

// =============================================================================
// Test Helpers
// =============================================================================

function expectSafe(pattern: string): void {
  expect(() => validateRegexPattern(pattern)).not.toThrow();
}

function expectUnsafe(pattern: string, messageFragment?: string): void {
  if (messageFragment) {
    expect(() => validateRegexPattern(pattern)).toThrow(messageFragment);
  } else {
    expect(() => validateRegexPattern(pattern)).toThrow(ExprError);
  }
}

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
    Date: Object.freeze(Object.assign(Object.create(null), {
      new: (...args: unknown[]) => {
        if (args.length === 0) return new globalThis.Date();
        if (args.length === 1) return new globalThis.Date(args[0] as string | number);
        const [year, month, ...rest] = args as number[];
        return new globalThis.Date(year, month, ...rest);
      },
      now: () => globalThis.Date.now(),
      parse: (dateString: string) => globalThis.Date.parse(String(dateString)),
      UTC: (year: number, monthIndex?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number) => {
        const args: number[] = [year, monthIndex ?? 0];
        if (date !== undefined) args.push(date);
        if (hours !== undefined) args.push(hours);
        if (minutes !== undefined) args.push(minutes);
        if (seconds !== undefined) args.push(seconds);
        if (ms !== undefined) args.push(ms);
        return (globalThis.Date.UTC as (...args: number[]) => number)(...args);
      },
    })),
    ...overrides,
  };
}

// =============================================================================
// Safe Patterns Accepted
// =============================================================================

describe("safe patterns accepted", () => {
  test("empty pattern", () => {
    expectSafe("");
  });

  test("simple literals", () => {
    expectSafe("abc");
    expectSafe("hello world");
    expectSafe("123");
    expectSafe("test_value");
  });

  test("dot", () => {
    expectSafe("a.b");
    expectSafe("...");
  });

  test("anchors", () => {
    expectSafe("^hello");
    expectSafe("world$");
    expectSafe("^exact$");
  });

  test("word boundary", () => {
    expectSafe("\\bhello\\b");
  });

  test("alternation", () => {
    expectSafe("cat|dog");
    expectSafe("a|b|c|d");
    expectSafe("hello|world|test");
  });

  test("character classes", () => {
    expectSafe("[abc]");
    expectSafe("[a-z]");
    expectSafe("[A-Z0-9]");
    expectSafe("[^abc]");
    expectSafe("[\\w\\d]");
    expectSafe("[a-zA-Z_]");
  });

  test("character class with ] as first char", () => {
    expectSafe("[]abc]");
    expectSafe("[^]abc]");
  });

  test("character class with hyphen", () => {
    expectSafe("[-abc]");
    expectSafe("[abc-]");
    expectSafe("[a\\-z]");
  });

  test("shorthand escapes", () => {
    expectSafe("\\d");
    expectSafe("\\D");
    expectSafe("\\w");
    expectSafe("\\W");
    expectSafe("\\s");
    expectSafe("\\S");
    expectSafe("\\t");
    expectSafe("\\n");
    expectSafe("\\r");
  });

  test("escaped special characters", () => {
    expectSafe("\\.");
    expectSafe("\\\\");
    expectSafe("\\[");
    expectSafe("\\]");
    expectSafe("\\(");
    expectSafe("\\)");
    expectSafe("\\{");
    expectSafe("\\}");
    expectSafe("\\+");
    expectSafe("\\*");
    expectSafe("\\?");
    expectSafe("\\^");
    expectSafe("\\$");
    expectSafe("\\|");
    expectSafe("\\-");
    expectSafe("\\/");
  });

  test("quantifiers on simple atoms", () => {
    expectSafe("a+");
    expectSafe("b*");
    expectSafe("c?");
    expectSafe("d{3}");
    expectSafe("e{1,5}");
    expectSafe("f{2,}");
  });

  test("lazy quantifiers", () => {
    expectSafe("a+?");
    expectSafe("b*?");
    expectSafe("c??");
    expectSafe("d{3}?");
    expectSafe("e{1,5}?");
  });

  test("multiple quantifiers at same level (not nested)", () => {
    expectSafe("a+b+c+");
    expectSafe("\\d+\\.\\d+");
    expectSafe("[a-z]+\\s+[0-9]+");
    expectSafe("a*b+c?d{2}");
  });

  test("non-capturing groups without quantifier", () => {
    expectSafe("(?:abc)");
    expectSafe("(?:a|b)");
    expectSafe("(?:hello world)");
  });

  test("non-capturing groups with inner quantifiers (no outer quantifier)", () => {
    expectSafe("(?:a+)");
    expectSafe("(?:a+b*)");
    expectSafe("(?:a+|b+)");
  });

  test("non-capturing groups with outer quantifier (no inner quantifier)", () => {
    expectSafe("(?:ab)+");
    expectSafe("(?:abc){3}");
    expectSafe("(?:ab|cd)+");
    expectSafe("(?:abc)*");
    expectSafe("(?:ab)?");
  });

  test("empty group", () => {
    expectSafe("(?:)");
  });

  test("nested non-capturing groups (safe)", () => {
    expectSafe("(?:(?:ab))");
    expectSafe("(?:(?:a|b))");
  });

  test("alternation with quantified branches (no outer quantifier)", () => {
    expectSafe("(?:a+)|(?:b+)");
    expectSafe("a+|b+|c+");
  });

  test("{ as literal when not valid quantifier syntax", () => {
    expectSafe("a{");
    expectSafe("a{b");
    expectSafe("a{,3}");
    expectSafe("{abc}");
  });

  // Real-world patterns
  test("URL pattern", () => {
    expectSafe("https?://[^\\s]+");
  });

  test("email-like pattern", () => {
    expectSafe("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}");
  });

  test("Discord emote pattern", () => {
    expectSafe("<a?:\\w+:\\d+>");
  });

  test("dice roll pattern", () => {
    expectSafe("\\d+d\\d+");
  });

  test("IP address pattern", () => {
    expectSafe("\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}");
  });

  test("simple word match", () => {
    expectSafe("\\bfoo\\b");
  });

  test("hex color", () => {
    expectSafe("#[0-9a-fA-F]{6}");
  });

  test("digit extraction", () => {
    expectSafe("\\d+");
  });

  test("whitespace split", () => {
    expectSafe("\\s+");
  });

  test("word characters", () => {
    expectSafe("\\w+");
  });

  test("non-greedy anything", () => {
    expectSafe(".*?");
  });
});

// =============================================================================
// Unsafe Patterns Rejected
// =============================================================================

describe("capturing groups rejected", () => {
  test("simple capturing group", () => {
    expectUnsafe("(abc)", "capturing groups are not allowed");
  });

  test("capturing group with quantifier", () => {
    expectUnsafe("(a+)+", "capturing groups are not allowed");
  });

  test("nested capturing group", () => {
    expectUnsafe("((abc))", "capturing groups are not allowed");
  });

  test("capturing group in alternation", () => {
    expectUnsafe("a|(b)", "capturing groups are not allowed");
  });

  test("error message suggests non-capturing group", () => {
    expectUnsafe("(abc)", "Use (?:abc) instead");
  });
});

describe("nested quantifiers rejected", () => {
  test("classic ReDoS: (?:a+)+", () => {
    expectUnsafe("(?:a+)+", "nested quantifier");
  });

  test("classic ReDoS: (?:a+)*", () => {
    expectUnsafe("(?:a+)*", "nested quantifier");
  });

  test("classic ReDoS: (?:a*)+", () => {
    expectUnsafe("(?:a*)+", "nested quantifier");
  });

  test("classic ReDoS: (?:a+){2,}", () => {
    expectUnsafe("(?:a+){2,}", "nested quantifier");
  });

  test("classic ReDoS: (?:a+){2}", () => {
    expectUnsafe("(?:a+){2}", "nested quantifier");
  });

  test("nested with multiple inner quantifiers", () => {
    expectUnsafe("(?:a+b*)+", "nested quantifier");
  });

  test("nested with alternation containing quantifier", () => {
    expectUnsafe("(?:a+|b)+", "nested quantifier");
  });

  test("nested with character class quantified", () => {
    expectUnsafe("(?:[a-z]+)+", "nested quantifier");
  });

  test("nested with dot quantified", () => {
    expectUnsafe("(?:.+)+", "nested quantifier");
  });

  test("nested with shorthand quantified", () => {
    expectUnsafe("(?:\\d+)+", "nested quantifier");
  });

  test("deeply nested groups with quantifiers", () => {
    // (?:(?:a+))+ — inner group has quantifier, outer adds quantifier
    expectUnsafe("(?:(?:a+))+", "nested quantifier");
  });

  test("nested lazy quantifiers", () => {
    expectUnsafe("(?:a+?)+", "nested quantifier");
  });

  test("brace quantifier on group with inner quantifier", () => {
    expectUnsafe("(?:a{3}){3}", "nested quantifier");
  });

  test("error message mentions catastrophic backtracking", () => {
    expectUnsafe("(?:a+)+", "catastrophic backtracking");
  });

  test("error message suggests fix", () => {
    expectUnsafe("(?:a+)+", "Flatten the pattern or remove one quantifier");
  });
});

describe("backreferences rejected", () => {
  test("\\1", () => {
    expectUnsafe("\\1", "backreferences");
  });

  test("\\2 through \\9", () => {
    for (let i = 2; i <= 9; i++) {
      expectUnsafe(`\\${i}`, "backreferences");
    }
  });

  test("backreference error mentions exponential", () => {
    expectUnsafe("\\1", "exponential matching time");
  });
});

describe("lookahead/lookbehind rejected", () => {
  test("positive lookahead (?=...)", () => {
    expectUnsafe("a(?=b)", "lookahead (?=...)");
  });

  test("negative lookahead (?!...)", () => {
    expectUnsafe("a(?!b)", "negative lookahead (?!...)");
  });

  test("positive lookbehind (?<=...)", () => {
    expectUnsafe("(?<=a)b", "lookbehind (?<=...)");
  });

  test("negative lookbehind (?<!...)", () => {
    expectUnsafe("(?<!a)b", "negative lookbehind (?<!...)");
  });
});

describe("named groups rejected", () => {
  test("named group (?<name>...)", () => {
    expectUnsafe("(?<name>abc)", "named groups are not allowed");
  });

  test("error message suggests non-capturing group", () => {
    expectUnsafe("(?<name>abc)", "Use (?:...) instead");
  });
});

describe("unknown escapes rejected", () => {
  test("\\x hex escape", () => {
    expectUnsafe("\\x41", 'unknown escape "\\x"');
  });

  test("\\u unicode escape", () => {
    expectUnsafe("\\u0041", 'unknown escape "\\u"');
  });

  test("\\p unicode property", () => {
    expectUnsafe("\\p{Letter}", 'unknown escape "\\p"');
  });

  test("\\a not an allowed escape", () => {
    expectUnsafe("\\a", 'unknown escape "\\a"');
  });

  test("\\v not an allowed escape", () => {
    expectUnsafe("\\v", 'unknown escape "\\v"');
  });

  test("\\f not an allowed escape", () => {
    expectUnsafe("\\f", 'unknown escape "\\f"');
  });

  test("\\0 not an allowed escape", () => {
    expectUnsafe("\\0", 'unknown escape "\\0"');
  });

  test("error message lists allowed escapes", () => {
    expectUnsafe("\\x41", "Allowed: \\d \\w \\s \\D \\W \\S \\t \\n \\r \\b");
  });
});

describe("unterminated constructs", () => {
  test("unterminated character class", () => {
    expectUnsafe("[abc", "unterminated character class");
  });

  test("unterminated character class with escapes", () => {
    expectUnsafe("[\\d\\w", "unterminated character class");
  });

  test("unterminated group", () => {
    expectUnsafe("(?:abc", "unterminated group");
  });

  test("trailing backslash", () => {
    expectUnsafe("abc\\", "trailing backslash");
  });

  test("unmatched closing paren", () => {
    expectUnsafe("abc)", 'unexpected ")"');
  });

  test("group opened with nothing inside", () => {
    expectUnsafe("(", "unterminated group");
  });
});

describe("anchor quantification rejected", () => {
  test("\\b+", () => {
    expectUnsafe("\\b+", "anchor");
  });

  test("^+", () => {
    expectUnsafe("^+", "anchor");
  });

  test("$+", () => {
    expectUnsafe("$+", "anchor");
  });

  test("\\b*", () => {
    expectUnsafe("\\b*", "anchor");
  });

  test("\\b{2}", () => {
    expectUnsafe("\\b{2}", "anchor");
  });

  test("anchors without quantifiers are fine", () => {
    expectSafe("^hello$");
    expectSafe("\\bhello\\b");
  });
});

// =============================================================================
// Safety Invariant Exhaustive
// =============================================================================

describe("safety invariant: quantifier nesting", () => {
  test("same level quantifiers: a+b+c+ (safe)", () => {
    expectSafe("a+b+c+");
  });

  test("quantifier inside group, no outer: (?:a+) (safe)", () => {
    expectSafe("(?:a+)");
  });

  test("quantifier outside group, none inside: (?:ab)+ (safe)", () => {
    expectSafe("(?:ab)+");
  });

  test("quantifier both inside and outside: (?:a+)+ (unsafe)", () => {
    expectUnsafe("(?:a+)+");
  });

  test("optional group with inner quantifier: (?:a+)? (unsafe - still nested)", () => {
    expectUnsafe("(?:a+)?", "nested quantifier");
  });

  test("brace quantifier nesting: (?:a{3}){3} (unsafe - false positive but safe alternative exists)", () => {
    expectUnsafe("(?:a{3}){3}", "nested quantifier");
  });

  test("alternation hides quantifier from outer: (?:a+)|(?:b+) (safe — no outer quantifier)", () => {
    expectSafe("(?:a+)|(?:b+)");
  });

  test("alternation with outer quantifier on quantified branch: (?:a+|b)+ (unsafe)", () => {
    expectUnsafe("(?:a+|b)+", "nested quantifier");
  });

  test("alternation where all branches are quantified, with outer: (?:a+|b+)+ (unsafe)", () => {
    expectUnsafe("(?:a+|b+)+", "nested quantifier");
  });

  test("three levels: (?:(?:a+)+)+ (unsafe at first nesting)", () => {
    expectUnsafe("(?:(?:a+)+)+");
  });

  test("polynomial but accepted: (?:a|a)+ (v1 allows this)", () => {
    // This is polynomial O(n^2) not exponential - accepted in v1
    expectSafe("(?:a|a)+");
  });

  test("dot-star in group with outer quantifier: (?:.*)+", () => {
    expectUnsafe("(?:.*)+", "nested quantifier");
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("edge cases", () => {
  test("very long safe pattern", () => {
    const pattern = "a".repeat(1000);
    expectSafe(pattern);
  });

  test("many alternations", () => {
    const pattern = Array.from({ length: 50 }, (_, i) => `opt${i}`).join("|");
    expectSafe(pattern);
  });

  test("many character class entries", () => {
    const pattern = "[" + "abcdefghijklmnopqrstuvwxyz".split("").join("") + "]";
    expectSafe(pattern);
  });

  test("empty alternation branches", () => {
    expectSafe("a|");
    expectSafe("|a");
    expectSafe("||");
  });

  test("dot with quantifier", () => {
    expectSafe(".+");
    expectSafe(".*");
    expectSafe(".?");
    expectSafe(".{3,5}");
  });

  test("escaped characters with quantifiers", () => {
    expectSafe("\\d+");
    expectSafe("\\w*");
    expectSafe("\\s?");
    expectSafe("\\D{2,4}");
  });

  test("character class with quantifier", () => {
    expectSafe("[abc]+");
    expectSafe("[a-z]*");
    expectSafe("[^\\d]?");
  });

  test("brace as literal (not quantifier)", () => {
    expectSafe("a{");
    expectSafe("a{b}");
    expectSafe("a{,}");
    expectSafe("a{,3}");
  });

  test("consecutive groups", () => {
    expectSafe("(?:a)(?:b)(?:c)");
  });

  test("group immediately followed by literal", () => {
    expectSafe("(?:ab)cd");
  });

  test("multiple groups with quantifiers at same level", () => {
    expectSafe("(?:ab)+(?:cd)+");
  });

  test("nested groups without quantifiers", () => {
    expectSafe("(?:(?:(?:abc)))");
  });

  test("trailing backslash inside character class", () => {
    expectUnsafe("[abc\\", "trailing backslash");
  });

  test("quantifier at pattern start", () => {
    expectUnsafe("+abc", "quantifier without preceding element");
    expectUnsafe("*abc", "quantifier without preceding element");
    expectUnsafe("?abc", "quantifier without preceding element");
  });

  test("brace quantifier at start with valid syntax", () => {
    expectUnsafe("{3}abc", "quantifier without preceding element");
  });

  test("unknown group type", () => {
    expectUnsafe("(?P<name>abc)", 'unknown group type');
  });
});

// =============================================================================
// Integration with Expression Evaluator
// =============================================================================

describe("integration with expr evaluator", () => {
  test("content.match() with safe pattern compiles", () => {
    expect(() => compileExpr('content.match("\\\\d+")')).not.toThrow();
  });

  test("content.match() with unsafe pattern throws", () => {
    expect(() => compileExpr('content.match("(a+)+")')).toThrow(ExprError);
    expect(() => compileExpr('content.match("(a+)+")')).toThrow("capturing groups");
  });

  test("content.match() with nested quantifier via non-capturing group throws", () => {
    expect(() => compileExpr('content.match("(?:a+)+")')).toThrow("nested quantifier");
  });

  test("content.search() with safe pattern compiles", () => {
    expect(() => compileExpr('content.search("hello")')).not.toThrow();
  });

  test("content.search() with unsafe pattern throws", () => {
    expect(() => compileExpr('content.search("(a+)+")')).toThrow(ExprError);
  });

  test("content.replace() with safe pattern compiles", () => {
    expect(() => compileExpr('content.replace("\\\\d+", "NUM")')).not.toThrow();
  });

  test("content.replace() with unsafe pattern throws", () => {
    expect(() => compileExpr('content.replace("(a+)+", "")')).toThrow(ExprError);
  });

  test("content.split() with safe pattern compiles", () => {
    expect(() => compileExpr('content.split("\\\\s+")')).not.toThrow();
  });

  test("content.split() with unsafe pattern throws", () => {
    expect(() => compileExpr('content.split("(a+)+")')).toThrow(ExprError);
  });

  test("dynamic pattern (variable) rejected at compile time", () => {
    expect(() => compileExpr("content.match(name)")).toThrow("string literal pattern");
  });

  test("dynamic pattern from expression rejected", () => {
    expect(() => compileExpr('content.match(content + "test")')).toThrow("string literal pattern");
  });

  test("numeric argument rejected", () => {
    expect(() => compileExpr("content.match(42)")).toThrow("string literal pattern");
  });

  test("no argument rejected", () => {
    expect(() => compileExpr("content.match()")).toThrow("string literal pattern");
  });

  test("non-regex methods are NOT validated", () => {
    // includes, startsWith, etc. do literal matching — no regex danger
    expect(() => compileExpr('content.includes("(a+)+")')).not.toThrow();
    expect(() => compileExpr('content.startsWith("(a+)+")')).not.toThrow();
    expect(() => compileExpr('content.endsWith("(a+)+")')).not.toThrow();
    expect(() => compileExpr('content.indexOf("(a+)+")')).not.toThrow();
  });

  test("safe match pattern evaluates correctly", () => {
    const ctx = makeContext({ content: "test123abc" });
    expect(evalExpr('content.match("\\\\d+").length > 0', ctx)).toBe(true);
  });

  test("safe search evaluates correctly", () => {
    const ctx = makeContext({ content: "hello" });
    expect(evalExpr('content.search("ell") == 1', ctx)).toBe(true);
  });

  test("safe replace evaluates correctly", () => {
    const ctx = makeContext({ content: "aaa" });
    expect(evalExpr('content.replace("a", "b") == "baa"', ctx)).toBe(true);
  });

  test("safe split evaluates correctly", () => {
    const ctx = makeContext({ content: "a,b,c" });
    expect(evalExpr('content.split(",").length == 3', ctx)).toBe(true);
  });

  test("match on messages() return value", () => {
    expect(() => compileExpr('messages(5).match("\\\\w+")')).not.toThrow();
  });

  test("match on method chain result", () => {
    expect(() => compileExpr('content.trim().match("\\\\d+")')).not.toThrow();
  });

  test("match on group variable", () => {
    expect(() => compileExpr('group.match("Alice")')).not.toThrow();
  });

  test("regex validation does not affect chained method calls", () => {
    // match().length should work with safe pattern
    const ctx = makeContext({ content: "abc123" });
    expect(evalExpr('content.match("\\\\d+").length > 0', ctx)).toBe(true);
  });

  test("match with backreference rejected", () => {
    expect(() => compileExpr('content.match("(a)\\\\1")')).toThrow("capturing groups");
  });

  test("match with lookahead rejected", () => {
    expect(() => compileExpr('content.match("a(?=b)")')).toThrow("lookahead");
  });

  test("matchAll is blocked (use match instead)", () => {
    expect(() => compileExpr('content.matchAll("\\\\d+")')).toThrow("matchAll() is not available");
  });
});

// =============================================================================
// Real-world ReDoS Patterns (all should be rejected)
// =============================================================================

describe("real-world ReDoS patterns rejected", () => {
  test("email ReDoS: ([a-zA-Z]+)*@", () => {
    expectUnsafe("([a-zA-Z]+)*@");
  });

  test("URL ReDoS: (https?://.*)*", () => {
    expectUnsafe("(https?://.*)*");
  });

  test("classic: (a+)+", () => {
    expectUnsafe("(a+)+");
  });

  test("classic: (a|a)+", () => {
    // This uses capturing group → rejected on that basis
    expectUnsafe("(a|a)+", "capturing groups");
  });

  test("classic: (a+){2,}", () => {
    expectUnsafe("(a+){2,}");
  });

  test("classic: (.*a){8}", () => {
    expectUnsafe("(.*a){8}");
  });

  test("classic: ([a-zA-Z0-9])+(.)+", () => {
    expectUnsafe("([a-zA-Z0-9])+(.)+");
  });

  test("npm package: (?:a+){2}", () => {
    expectUnsafe("(?:a+){2}", "nested quantifier");
  });

  test("ReDoS via star-plus: (?:a*)+", () => {
    expectUnsafe("(?:a*)+", "nested quantifier");
  });

  test("ReDoS via question-star: (?:a?)*", () => {
    // a? has quantifier, outer * adds another
    expectUnsafe("(?:a?)*", "nested quantifier");
  });

  test("ReDoS via brace-star: (?:a{1,3})*", () => {
    expectUnsafe("(?:a{1,3})*", "nested quantifier");
  });
});
