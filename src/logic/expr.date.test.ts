/**
 * Adversarial tests for Date access in expressions.
 *
 * The expression evaluator exposes a safe Date wrapper that provides:
 * - Date.new() / Date.new(timestamp) / Date.new(dateString) / Date.new(year, month, ...)
 * - Date.now() - current timestamp in ms
 * - Date.parse(string) - parse date string to timestamp
 * - Date.UTC(...) - create UTC timestamp from components
 *
 * These tests verify that Date functionality works correctly AND that
 * all prototype chain escapes are blocked.
 *
 * Note: evalExpr() wraps results in Boolean() for $if conditions.
 * We use evalRaw() for tests that need raw values.
 */
import { describe, expect, test } from "bun:test";
import { createBaseContext, evalExpr, evalRaw, type ExprContext } from "./expr";

// =============================================================================
// Test Helpers
// =============================================================================

function makeContext(overrides: Partial<ExprContext> = {}): ExprContext {
  return createBaseContext({
    facts: [],
    has_fact: () => false,
    ...overrides,
  });
}

// =============================================================================
// Date.new() - Constructor
// =============================================================================

describe("Date.new() - constructor", () => {
  test("Date.new() returns current date", () => {
    const ctx = makeContext();
    const before = Date.now();
    const result = evalRaw("Date.new().getTime()", ctx) as number;
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  test("Date.new() returns a Date object", () => {
    const ctx = makeContext();
    // Check that it has Date methods
    expect(typeof evalRaw("Date.new().getFullYear()", ctx)).toBe("number");
    expect(typeof evalRaw("Date.new().getMonth()", ctx)).toBe("number");
    expect(typeof evalRaw("Date.new().getDate()", ctx)).toBe("number");
    expect(typeof evalRaw("Date.new().getHours()", ctx)).toBe("number");
    expect(typeof evalRaw("Date.new().getMinutes()", ctx)).toBe("number");
    expect(typeof evalRaw("Date.new().getSeconds()", ctx)).toBe("number");
  });

  test("Date.new(timestamp) creates date from milliseconds", () => {
    const ctx = makeContext();
    // Unix epoch
    expect(evalRaw("Date.new(0).getTime()", ctx)).toBe(0);
    // Known timestamp: 2024-01-15T12:00:00.000Z = 1705320000000
    expect(evalRaw("Date.new(1705320000000).toISOString()", ctx)).toBe("2024-01-15T12:00:00.000Z");
  });

  test("Date.new(dateString) parses date strings", () => {
    const ctx = makeContext();
    expect(evalRaw('Date.new("2024-01-15").getFullYear()', ctx)).toBe(2024);
    expect(evalRaw('Date.new("2024-01-15").getMonth()', ctx)).toBe(0); // January = 0
    expect(evalRaw('Date.new("2024-01-15").getDate()', ctx)).toBe(15);
  });

  test("Date.new(year, month, ...) creates date from components", () => {
    const ctx = makeContext();
    // Month is 0-indexed in JS Date
    expect(evalRaw("Date.new(2024, 0, 15).getFullYear()", ctx)).toBe(2024);
    expect(evalRaw("Date.new(2024, 0, 15).getMonth()", ctx)).toBe(0);
    expect(evalRaw("Date.new(2024, 0, 15).getDate()", ctx)).toBe(15);

    // With time components
    expect(evalRaw("Date.new(2024, 0, 15, 14, 30, 45).getHours()", ctx)).toBe(14);
    expect(evalRaw("Date.new(2024, 0, 15, 14, 30, 45).getMinutes()", ctx)).toBe(30);
    expect(evalRaw("Date.new(2024, 0, 15, 14, 30, 45).getSeconds()", ctx)).toBe(45);
  });

  test("Date.new() with invalid string returns Invalid Date", () => {
    const ctx = makeContext();
    // Invalid date string results in NaN for getTime()
    expect(evalRaw('Date.new("not a date").getTime()', ctx)).toBeNaN();
  });
});

// =============================================================================
// Date.now() - Current Timestamp
// =============================================================================

describe("Date.now() - current timestamp", () => {
  test("Date.now() returns current timestamp in ms", () => {
    const ctx = makeContext();
    const before = Date.now();
    const result = evalRaw("Date.now()", ctx) as number;
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  test("Date.now() returns a number", () => {
    const ctx = makeContext();
    expect(typeof evalRaw("Date.now()", ctx)).toBe("number");
  });

  test("Date.now() can be used in calculations", () => {
    const ctx = makeContext();
    // Should be roughly equal (within 1 second)
    expect(evalRaw("Date.now() - Date.now()", ctx) as number).toBeLessThan(1000);
  });
});

// =============================================================================
// Date.parse() - Parse Date String
// =============================================================================

describe("Date.parse() - parse date string", () => {
  test("Date.parse() parses ISO date strings", () => {
    const ctx = makeContext();
    expect(evalRaw('Date.parse("2024-01-15T12:00:00.000Z")', ctx)).toBe(1705320000000);
  });

  test("Date.parse() parses simple date strings", () => {
    const ctx = makeContext();
    const result = evalRaw('Date.parse("2024-01-15")', ctx);
    expect(typeof result).toBe("number");
    expect(result).not.toBeNaN();
  });

  test("Date.parse() returns NaN for invalid strings", () => {
    const ctx = makeContext();
    expect(evalRaw('Date.parse("not a date")', ctx)).toBeNaN();
    expect(evalRaw('Date.parse("")', ctx)).toBeNaN();
  });
});

// =============================================================================
// Date.UTC() - UTC Timestamp from Components
// =============================================================================

describe("Date.UTC() - UTC timestamp from components", () => {
  test("Date.UTC() creates UTC timestamp", () => {
    const ctx = makeContext();
    // Month is 0-indexed
    expect(evalRaw("Date.UTC(2024, 0, 15, 12, 0, 0, 0)", ctx)).toBe(1705320000000);
  });

  test("Date.UTC() with minimal args", () => {
    const ctx = makeContext();
    // Just year and month
    const result = evalRaw("Date.UTC(2024, 0)", ctx);
    expect(typeof result).toBe("number");
    expect(result).not.toBeNaN();
  });

  test("Date.UTC() returns timestamp usable with Date.new()", () => {
    const ctx = makeContext();
    expect(evalRaw('Date.new(Date.UTC(2024, 0, 15, 12, 0, 0)).toISOString()', ctx)).toBe("2024-01-15T12:00:00.000Z");
  });
});

// =============================================================================
// Date Instance Methods (Safe Methods)
// =============================================================================

describe("Date instance methods", () => {
  test("getFullYear() works", () => {
    const ctx = makeContext();
    expect(evalRaw('Date.new("2024-01-15").getFullYear()', ctx)).toBe(2024);
  });

  test("getMonth() works (0-indexed)", () => {
    const ctx = makeContext();
    expect(evalRaw('Date.new("2024-01-15").getMonth()', ctx)).toBe(0);
    expect(evalRaw('Date.new("2024-12-15").getMonth()', ctx)).toBe(11);
  });

  test("getDate() works", () => {
    const ctx = makeContext();
    expect(evalRaw('Date.new("2024-01-15").getDate()', ctx)).toBe(15);
  });

  test("getDay() works (0=Sunday)", () => {
    const ctx = makeContext();
    // 2024-01-15 is a Monday
    expect(evalRaw('Date.new("2024-01-15").getDay()', ctx)).toBe(1);
  });

  test("getHours() works", () => {
    const ctx = makeContext();
    expect(evalRaw("Date.new(2024, 0, 15, 14, 30).getHours()", ctx)).toBe(14);
  });

  test("getMinutes() works", () => {
    const ctx = makeContext();
    expect(evalRaw("Date.new(2024, 0, 15, 14, 30).getMinutes()", ctx)).toBe(30);
  });

  test("getSeconds() works", () => {
    const ctx = makeContext();
    expect(evalRaw("Date.new(2024, 0, 15, 14, 30, 45).getSeconds()", ctx)).toBe(45);
  });

  test("getMilliseconds() works", () => {
    const ctx = makeContext();
    expect(evalRaw("Date.new(2024, 0, 15, 14, 30, 45, 123).getMilliseconds()", ctx)).toBe(123);
  });

  test("getTime() works", () => {
    const ctx = makeContext();
    expect(evalRaw("Date.new(0).getTime()", ctx)).toBe(0);
  });

  test("toISOString() works", () => {
    const ctx = makeContext();
    expect(evalRaw("Date.new(0).toISOString()", ctx)).toBe("1970-01-01T00:00:00.000Z");
  });

  test("toDateString() works", () => {
    const ctx = makeContext();
    const result = evalRaw("Date.new(2024, 0, 15).toDateString()", ctx) as string;
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).toContain("2024");
  });

  test("toTimeString() works", () => {
    const ctx = makeContext();
    const result = evalRaw("Date.new(2024, 0, 15, 14, 30).toTimeString()", ctx) as string;
    expect(result).toContain("14:30");
  });

  test("toLocaleString() works", () => {
    const ctx = makeContext();
    const result = evalRaw("Date.new(2024, 0, 15).toLocaleString()", ctx);
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  test("toLocaleDateString() works", () => {
    const ctx = makeContext();
    const result = evalRaw("Date.new(2024, 0, 15).toLocaleDateString()", ctx);
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  test("toLocaleTimeString() works", () => {
    const ctx = makeContext();
    const result = evalRaw("Date.new(2024, 0, 15, 14, 30).toLocaleTimeString()", ctx);
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  test("valueOf() works (returns timestamp)", () => {
    const ctx = makeContext();
    expect(evalRaw("Date.new(0).valueOf()", ctx)).toBe(0);
  });

  test("toString() works", () => {
    const ctx = makeContext();
    const result = evalRaw("Date.new(2024, 0, 15).toString()", ctx) as string;
    expect(typeof result).toBe("string");
    expect(result).toContain("2024");
  });

  test("getTimezoneOffset() works", () => {
    const ctx = makeContext();
    const result = evalRaw("Date.new().getTimezoneOffset()", ctx);
    expect(typeof result).toBe("number");
  });

  test("getUTC* methods work", () => {
    const ctx = makeContext();
    expect(evalRaw('Date.new("2024-01-15T12:00:00Z").getUTCFullYear()', ctx)).toBe(2024);
    expect(evalRaw('Date.new("2024-01-15T12:00:00Z").getUTCMonth()', ctx)).toBe(0);
    expect(evalRaw('Date.new("2024-01-15T12:00:00Z").getUTCDate()', ctx)).toBe(15);
    expect(evalRaw('Date.new("2024-01-15T12:00:00Z").getUTCHours()', ctx)).toBe(12);
    expect(evalRaw('Date.new("2024-01-15T12:00:00Z").getUTCMinutes()', ctx)).toBe(0);
    expect(evalRaw('Date.new("2024-01-15T12:00:00Z").getUTCSeconds()', ctx)).toBe(0);
  });
});

// =============================================================================
// SECURITY: Prototype Chain Escapes - MUST ALL FAIL
// =============================================================================

describe("SECURITY: prototype chain escapes on Date wrapper", () => {
  test("Date.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.constructor", ctx)).toThrow("Blocked property: .constructor");
  });

  test("Date.__proto__ is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.__proto__", ctx)).toThrow("Blocked property: .__proto__");
  });

  test("Date.prototype is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.prototype", ctx)).toThrow("Blocked property: .prototype");
  });

  test("Date.new.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new.constructor", ctx)).toThrow("Blocked property: .constructor");
  });

  test("Date.now.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.now.constructor", ctx)).toThrow("Blocked property: .constructor");
  });

  test("Date.parse.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.parse.constructor", ctx)).toThrow("Blocked property: .constructor");
  });

  test("Date.UTC.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.UTC.constructor", ctx)).toThrow("Blocked property: .constructor");
  });
});

describe("SECURITY: prototype chain escapes on Date instances", () => {
  test("Date.new().constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new().constructor", ctx)).toThrow("Blocked property: .constructor");
  });

  test("Date.new().__proto__ is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new().__proto__", ctx)).toThrow("Blocked property: .__proto__");
  });

  test("Date.new().prototype is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new().prototype", ctx)).toThrow("Blocked property: .prototype");
  });

  test("Date.new().constructor.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new().constructor.constructor", ctx)).toThrow("Blocked property: .constructor");
  });

  test("Date.new().toString.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new().toString.constructor", ctx)).toThrow("Blocked property: .constructor");
  });

  test("Date.new().getTime.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new().getTime.constructor", ctx)).toThrow("Blocked property: .constructor");
  });

  test("Date.new().toISOString.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new().toISOString.constructor", ctx)).toThrow("Blocked property: .constructor");
  });

  test("Date.new().valueOf.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new().valueOf.constructor", ctx)).toThrow("Blocked property: .constructor");
  });
});

describe("SECURITY: Function construction attempts via Date", () => {
  test("cannot access Function via Date.new().constructor.constructor", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new().constructor.constructor", ctx)).toThrow();
  });

  test("cannot create Function via constructor chain", () => {
    const ctx = makeContext();
    // Classic RCE payload - MUST fail at .constructor
    expect(() => evalRaw('Date.new().constructor.constructor("return process")()', ctx)).toThrow();
  });

  test("cannot access Function via Date.now.constructor.constructor", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.now.constructor.constructor", ctx)).toThrow();
  });

  test("cannot access globalThis via Date", () => {
    const ctx = makeContext();
    // Try various paths to globalThis
    expect(() => evalRaw("Date.constructor", ctx)).toThrow();
    expect(() => evalRaw("Date.new().constructor", ctx)).toThrow();
  });
});

describe("SECURITY: call/apply/bind on Date methods", () => {
  // These would allow rebinding methods to arbitrary contexts
  test("Date.new.call.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new.call.constructor", ctx)).toThrow();
  });

  test("Date.new.apply.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new.apply.constructor", ctx)).toThrow();
  });

  test("Date.new.bind.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new.bind.constructor", ctx)).toThrow();
  });
});

describe("SECURITY: toJSON and toString prototype access", () => {
  test("Date.new().toJSON() works (returns ISO string)", () => {
    const ctx = makeContext();
    expect(evalRaw("Date.new(0).toJSON()", ctx)).toBe("1970-01-01T00:00:00.000Z");
  });

  test("Date.new().toJSON.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new().toJSON.constructor", ctx)).toThrow();
  });

  test("Date.new().toString.constructor is blocked", () => {
    const ctx = makeContext();
    expect(() => evalRaw("Date.new().toString.constructor", ctx)).toThrow();
  });
});

// =============================================================================
// Edge Cases and Robustness
// =============================================================================

describe("Date edge cases", () => {
  test("Date.new() with very old dates", () => {
    const ctx = makeContext();
    expect(evalRaw("Date.new(1900, 0, 1).getFullYear()", ctx)).toBe(1900);
  });

  test("Date.new() with far future dates", () => {
    const ctx = makeContext();
    expect(evalRaw("Date.new(3000, 0, 1).getFullYear()", ctx)).toBe(3000);
  });

  test("Date.new() with negative timestamps (before epoch)", () => {
    const ctx = makeContext();
    // December 31, 1969
    expect(evalRaw("Date.new(-86400000).getFullYear()", ctx)).toBe(1969);
  });

  test("Date operations with timezone-aware methods", () => {
    const ctx = makeContext();
    // Ensure UTC and local methods both work
    expect(evalRaw('Date.new("2024-06-15T12:00:00Z").getUTCMonth()', ctx)).toBe(5); // June = 5
    // Local time depends on system timezone, just verify it returns a number
    expect(typeof evalRaw('Date.new("2024-06-15T12:00:00Z").getMonth()', ctx)).toBe("number");
  });

  test("Date comparison works", () => {
    const ctx = makeContext();
    // Earlier date has smaller timestamp
    expect(evalExpr('Date.new("2024-01-01").getTime() < Date.new("2024-12-31").getTime()', ctx)).toBe(true);
  });

  test("Date arithmetic works", () => {
    const ctx = makeContext();
    // One day in ms = 86400000
    const oneDayMs = 86400000;
    expect(evalRaw(`Date.new(${oneDayMs}).getTime() - Date.new(0).getTime()`, ctx)).toBe(oneDayMs);
  });

  test("Date.new() handles leap years", () => {
    const ctx = makeContext();
    // 2024 is a leap year - Feb 29 should be valid
    expect(evalRaw("Date.new(2024, 1, 29).getDate()", ctx)).toBe(29);
    // 2023 is not - Feb 29 becomes Mar 1
    expect(evalRaw("Date.new(2023, 1, 29).getMonth()", ctx)).toBe(2); // March = 2
  });

  test("Date.new() handles month overflow", () => {
    const ctx = makeContext();
    // Month 12 (13th month) becomes January next year
    expect(evalRaw("Date.new(2024, 12, 1).getFullYear()", ctx)).toBe(2025);
    expect(evalRaw("Date.new(2024, 12, 1).getMonth()", ctx)).toBe(0);
  });

  test("Date.new() handles day overflow", () => {
    const ctx = makeContext();
    // Day 32 in January becomes February
    expect(evalRaw("Date.new(2024, 0, 32).getMonth()", ctx)).toBe(1);
    expect(evalRaw("Date.new(2024, 0, 32).getDate()", ctx)).toBe(1);
  });
});

// =============================================================================
// Integration with Existing Expression Features
// =============================================================================

describe("Date integration with expressions", () => {
  test("Date in ternary expression", () => {
    const ctx = makeContext();
    expect(evalExpr("Date.now() > 0 ? true : false", ctx)).toBe(true);
  });

  test("Date in boolean expression", () => {
    const ctx = makeContext();
    expect(evalExpr("Date.now() > 0 && Date.now() < Date.now() + 1000", ctx)).toBe(true);
  });

  test("Date with string methods", () => {
    const ctx = makeContext();
    expect(evalExpr('Date.new(0).toISOString().includes("1970")', ctx)).toBe(true);
    expect(evalExpr('Date.new(0).toISOString().startsWith("1970")', ctx)).toBe(true);
  });

  test("Date with arithmetic", () => {
    const ctx = makeContext();
    // Add one hour in ms
    const oneHour = 3600000;
    expect(evalExpr(`Date.new(Date.now() + ${oneHour}).getTime() > Date.now()`, ctx)).toBe(true);
  });

  test("Date timestamp in calculations", () => {
    const ctx = makeContext();
    // One day = 86400000 ms
    expect(evalExpr("Date.now() / 86400000 > 0", ctx)).toBe(true);
  });
});

// =============================================================================
// Real-World Use Cases
// =============================================================================

describe("Date real-world use cases", () => {
  test("check if current time is within business hours", () => {
    const ctx = makeContext();
    // Just verify it returns a boolean - result depends on current time
    const result = evalExpr("Date.new().getHours() >= 9 && Date.new().getHours() < 17", ctx);
    expect(typeof result).toBe("boolean");
  });

  test("calculate age from birth year", () => {
    const ctx = makeContext();
    const currentYear = new Date().getFullYear();
    expect(evalRaw(`Date.new().getFullYear() - 2000`, ctx)).toBe(currentYear - 2000);
  });

  test("check if today is a weekend", () => {
    const ctx = makeContext();
    // Sunday = 0, Saturday = 6
    const result = evalExpr("Date.new().getDay() == 0 || Date.new().getDay() == 6", ctx);
    expect(typeof result).toBe("boolean");
  });

  test("format a specific date", () => {
    const ctx = makeContext();
    const result = evalRaw('Date.new("2024-12-25").toLocaleDateString()', ctx);
    expect(typeof result).toBe("string");
  });

  test("check time elapsed since epoch", () => {
    const ctx = makeContext();
    // Should be well over 50 years (in ms)
    expect(evalExpr("Date.now() > 50 * 365 * 24 * 60 * 60 * 1000", ctx)).toBe(true);
  });
});
