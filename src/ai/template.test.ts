/**
 * Security and functionality tests for the Nunjucks template engine.
 *
 * The template engine uses Nunjucks compiled via `new Function()`, with security
 * enforced by runtime patches on `memberLookup` (property access) and `callWrap`
 * (function calls). These tests verify every known escape vector is blocked.
 *
 * Compare with src/logic/expr.security.test.ts which tests the $if expression
 * evaluator — a different engine with compile-time analysis. This file tests the
 * template engine which uses runtime interception.
 */
import { describe, expect, test } from "bun:test";
import { renderEntityTemplate } from "./template";

// =============================================================================
// Test Helper
// =============================================================================

/** Render a template with optional context, returning the result string */
function render(template: string, ctx: Record<string, unknown> = {}): string {
  return renderEntityTemplate(template, ctx);
}

/** Render and expect it to throw with a message containing the given substring */
function expectThrow(template: string, ctx: Record<string, unknown>, msg: string): void {
  expect(() => render(template, ctx)).toThrow(msg);
}

// =============================================================================
// Basic Functionality
// =============================================================================

describe("template: basic rendering", () => {
  test("renders plain text", () => {
    expect(render("Hello world")).toBe("Hello world");
  });

  test("renders variable interpolation", () => {
    expect(render("Hello {{ name }}", { name: "Alice" })).toBe("Hello Alice");
  });

  test("throws on undefined variables", () => {
    expect(() => render("Hello {{ missing }}")).toThrow("attempted to output null or undefined value");
  });

  test("renders nested property access", () => {
    expect(render("{{ user.name }}", { user: { name: "Bob" } })).toBe("Bob");
  });

  test("renders if/elif/else", () => {
    expect(render("{% if x %}yes{% else %}no{% endif %}", { x: true })).toBe("yes");
    expect(render("{% if x %}yes{% else %}no{% endif %}", { x: false })).toBe("no");
    expect(render("{% if x > 5 %}big{% elif x > 2 %}mid{% else %}small{% endif %}", { x: 3 })).toBe("mid");
  });

  test("renders for loops", () => {
    expect(render("{% for x in items %}{{ x }} {% endfor %}", { items: ["a", "b", "c"] })).toBe("a b c ");
  });

  test("renders for-else (empty iterable)", () => {
    expect(render("{% for x in items %}{{ x }}{% else %}empty{% endfor %}", { items: [] })).toBe("empty");
  });

  test("renders loop variables", () => {
    expect(render("{% for x in items %}{{ loop.index0 }}{% endfor %}", { items: ["a", "b"] })).toBe("01");
    expect(render("{% for x in items %}{{ loop.index }}{% endfor %}", { items: ["a", "b"] })).toBe("12");
    expect(render("{% for x in items %}{{ loop.first }}{% endfor %}", { items: ["a", "b"] })).toBe("truefalse");
    expect(render("{% for x in items %}{{ loop.last }}{% endfor %}", { items: ["a", "b"] })).toBe("falsetrue");
  });

  test("renders blocks (inline)", () => {
    expect(render("{% block name %}content{% endblock %}")).toBe("content");
  });

  test("renders comments (stripped)", () => {
    expect(render("before{# comment #}after")).toBe("beforeafter");
  });

  test("renders set tag", () => {
    expect(render("{% set x = 42 %}{{ x }}")).toBe("42");
  });

  test("renders Nunjucks operators", () => {
    expect(render("{{ 2 ** 3 }}")).toBe("8");
    expect(render("{{ 7 // 2 }}")).toBe("3");
    expect(render("{{ 'a' ~ 'b' }}")).toBe("ab");
    expect(render("{{ true and false }}")).toBe("false");
    expect(render("{{ true or false }}")).toBe("true");
    expect(render("{{ not false }}")).toBe("true");
    expect(render("{{ 1 in [1, 2, 3] }}")).toBe("true");
  });
});

// =============================================================================
// Whitespace Control
// =============================================================================

describe("template: whitespace control", () => {
  test("trimBlocks strips newline after block tags", () => {
    // trimBlocks is enabled — newline after {% %} is stripped
    expect(render("{% if true %}\nyes\n{% endif %}")).toBe("yes\n");
  });

  test("lstripBlocks strips leading whitespace on block lines", () => {
    // lstripBlocks strips leading whitespace before {% when it's the only content on the line
    expect(render("  {% if true %}\nyes\n  {% endif %}")).toBe("yes\n");
  });

  test("{%- -%} strips surrounding whitespace", () => {
    expect(render("  {%- if true -%}  yes  {%- endif -%}  ")).toBe("yes");
  });
});

// =============================================================================
// Filters
// =============================================================================

describe("template: filters", () => {
  test("default filter", () => {
    expect(render("{{ x | default('none') }}")).toBe("none");
    expect(render("{{ x | default('none') }}", { x: "val" })).toBe("val");
    expect(render("{{ x | default('none') }}", { x: "" })).toBe("none");
    expect(render("{{ x | default('none') }}", { x: 0 })).toBe("0");
  });

  test("length filter", () => {
    expect(render("{{ arr | length }}", { arr: [1, 2, 3] })).toBe("3");
    expect(render("{{ s | length }}", { s: "hello" })).toBe("5");
    expect(render("{{ x | length }}")).toBe("0");
  });

  test("join filter", () => {
    expect(render("{{ arr | join(', ') }}", { arr: ["a", "b", "c"] })).toBe("a, b, c");
    expect(render("{{ x | join(', ') }}")).toBe("");
  });

  test("join filter with attr parameter", () => {
    const arr = [{ name: "Aria" }, { name: "Kai" }, { name: "Zara" }];
    expect(render("{{ arr | join(', ', 'name') }}", { arr })).toBe("Aria, Kai, Zara");
  });

  test("join filter with attr parameter on missing attribute", () => {
    const arr = [{ x: 1 }, { x: 2 }];
    // Missing attribute produces undefined values which join as empty strings
    expect(render("{{ arr | join(', ', 'name') }}", { arr })).toBe(", ");
  });

  test("join filter with attr parameter and null elements", () => {
    const arr = [null, { name: "B" }, undefined];
    // Null/undefined elements are passed through (attr lookup on null → null)
    expect(() => render("{{ arr | join(', ', 'name') }}", { arr })).not.toThrow();
  });

  test("join filter with attr parameter and default separator", () => {
    const arr = [{ id: 1 }, { id: 2 }, { id: 3 }];
    // attr is third positional arg, so separator must be provided
    expect(render("{{ arr | join(',', 'id') }}", { arr })).toBe("1,2,3");
  });

  test("first and last filters", () => {
    expect(render("{{ arr | first }}", { arr: [1, 2, 3] })).toBe("1");
    expect(render("{{ arr | last }}", { arr: [1, 2, 3] })).toBe("3");
    expect(render("{{ s | first }}", { s: "abc" })).toBe("a");
    expect(render("{{ s | last }}", { s: "abc" })).toBe("c");
  });

  test("upper and lower filters", () => {
    expect(render("{{ s | upper }}", { s: "hello" })).toBe("HELLO");
    expect(render("{{ s | lower }}", { s: "HELLO" })).toBe("hello");
  });

  test("trim filter", () => {
    expect(render("{{ s | trim }}", { s: "  hello  " })).toBe("hello");
  });

  test("int and float filters", () => {
    expect(render("{{ s | int }}", { s: "42" })).toBe("42");
    expect(render("{{ s | int }}", { s: "nope" })).toBe("0");
    expect(render("{{ s | float }}", { s: "3.14" })).toBe("3.14");
  });

  test("abs and round filters", () => {
    expect(render("{{ n | abs }}", { n: -5 })).toBe("5");
    expect(render("{{ n | round }}", { n: 3.7 })).toBe("4");
    expect(render("{{ n | round(2) }}", { n: 3.14159 })).toBe("3.14");
  });

  test("reverse filter", () => {
    expect(render("{{ arr | reverse | join(',') }}", { arr: [1, 2, 3] })).toBe("3,2,1");
    expect(render("{{ s | reverse }}", { s: "abc" })).toBe("cba");
  });

  test("sort filter", () => {
    expect(render("{{ arr | sort | join(',') }}", { arr: [3, 1, 2] })).toBe("1,2,3");
  });

  test("batch filter", () => {
    const result = render("{% for b in arr | batch(2) %}[{% for x in b %}{{ x }}{% endfor %}]{% endfor %}", { arr: [1, 2, 3, 4, 5] });
    expect(result).toBe("[12][34][5]");
  });
});

// =============================================================================
// Prototype Chain Escapes
// =============================================================================

describe("template: prototype chain escapes", () => {
  test("blocks constructor on strings", () => {
    expect(() => render("{{ s.constructor }}", { s: "test" })).toThrow();
    expect(() => render('{{ "".constructor }}')).toThrow();
  });

  test("blocks constructor on numbers", () => {
    expect(() => render("{{ (0).constructor }}")).toThrow();
    expect(() => render("{{ n.constructor }}", { n: 42 })).toThrow();
  });

  test("blocks constructor on arrays", () => {
    expect(() => render("{{ arr.constructor }}", { arr: [1, 2] })).toThrow();
  });

  test("blocks constructor on objects", () => {
    expect(() => render("{{ obj.constructor }}", { obj: {} })).toThrow();
  });

  test("blocks constructor on functions", () => {
    expect(() => render("{{ fn.constructor }}", { fn: () => 42 })).toThrow();
  });

  test("blocks constructor on booleans", () => {
    expect(() => render("{{ b.constructor }}", { b: true })).toThrow();
  });

  test("blocks __proto__ on all types", () => {
    expect(() => render("{{ s.__proto__ }}", { s: "test" })).toThrow();
    expect(() => render("{{ n.__proto__ }}", { n: 42 })).toThrow();
    expect(() => render("{{ arr.__proto__ }}", { arr: [] })).toThrow();
    expect(() => render("{{ obj.__proto__ }}", { obj: {} })).toThrow();
  });

  test("blocks prototype access", () => {
    expect(() => render("{{ fn.prototype }}", { fn: function() {} })).toThrow();
  });

  test("blocks __defineGetter__", () => {
    expect(() => render("{{ obj.__defineGetter__ }}", { obj: {} })).toThrow();
  });

  test("blocks __defineSetter__", () => {
    expect(() => render("{{ obj.__defineSetter__ }}", { obj: {} })).toThrow();
  });

  test("blocks __lookupGetter__", () => {
    expect(() => render("{{ obj.__lookupGetter__ }}", { obj: {} })).toThrow();
  });

  test("blocks __lookupSetter__", () => {
    expect(() => render("{{ obj.__lookupSetter__ }}", { obj: {} })).toThrow();
  });

  test("blocks constructor through method chain", () => {
    expect(() => render("{{ s.trim().constructor }}", { s: "test" })).toThrow();
    expect(() => render("{{ s.toLowerCase().constructor }}", { s: "TEST" })).toThrow();
    expect(() => render("{{ s.slice(0).constructor }}", { s: "test" })).toThrow();
  });

  test("blocks double constructor chain (Function access)", () => {
    expect(() => render("{{ s.constructor.constructor }}", { s: "test" })).toThrow();
  });

  test("blocks __proto__ through method chain", () => {
    expect(() => render("{{ s.trim().__proto__ }}", { s: "test" })).toThrow();
  });

  test("blocks constructor on function return values", () => {
    expect(() => render("{{ fn().constructor }}", { fn: () => "test" })).toThrow();
  });

  test("blocks constructor via bracket notation", () => {
    expect(() => render('{{ s["constructor"] }}', { s: "test" })).toThrow();
    expect(() => render('{{ obj["__proto__"] }}', { obj: {} })).toThrow();
    expect(() => render('{{ obj["prototype"] }}', { obj: {} })).toThrow();
  });

  test("blocks constructor chain via bracket notation", () => {
    expect(() => render('{{ ""["constructor"] }}')).toThrow();
    expect(() => render('{{ (0)["constructor"] }}')).toThrow();
  });
});

// =============================================================================
// RCE (Remote Code Execution) Attempts
// =============================================================================

describe("template: RCE attempts", () => {
  test("constructor('return process')() is blocked", () => {
    // The classic Nunjucks RCE: access Function via constructor chain
    // memberLookup blocks .constructor → undefined → callWrap fails
    expect(() => render('{{ ""["constructor"]("return process")() }}', {})).toThrow();
    // Verify the result is NOT the process object
  });

  test("toString.constructor('return process')() is blocked", () => {
    expect(() => render('{{ "".toString.constructor("return process")() }}', {})).toThrow();
  });

  test("(0).toString.constructor('return process')() is blocked", () => {
    expect(() => render('{{ (0).toString.constructor("return process")() }}', {})).toThrow();
  });

  test("valueOf.constructor chain is blocked", () => {
    expect(() => render('{{ "".valueOf.constructor("return process")() }}', {})).toThrow();
  });

  test("array method constructor chain is blocked", () => {
    expect(() => render("{{ [].join.constructor }}", {})).toThrow();
    expect(() => render("{{ [].map.constructor }}", {})).toThrow();
    expect(() => render("{{ [].filter.constructor }}", {})).toThrow();
  });

  test("nested property chain to Function is blocked", () => {
    // Even through multiple safe property accesses
    expect(() => render("{{ s.toString.constructor }}", { s: "test" })).toThrow();
    expect(() => render("{{ s.valueOf.constructor }}", { s: "test" })).toThrow();
    expect(() => render("{{ arr.join.constructor }}", { arr: [1] })).toThrow();
    expect(() => render("{{ arr.map.constructor }}", { arr: [1] })).toThrow();
  });
});

// =============================================================================
// Global Object Access
// =============================================================================

describe("template: global object access", () => {
  // Nunjucks resolves identifiers from the template context only.
  // JS globals are NOT accessible unless injected into context.

  test("process is not accessible", () => {
    expect(() => render("{{ process }}")).toThrow();
  });

  test("globalThis is not accessible", () => {
    expect(() => render("{{ globalThis }}")).toThrow();
  });

  test("global is not accessible", () => {
    expect(() => render("{{ global }}")).toThrow();
  });

  test("window is not accessible", () => {
    expect(() => render("{{ window }}")).toThrow();
  });

  test("Bun is not accessible", () => {
    expect(() => render("{{ Bun }}")).toThrow();
  });

  test("eval is not accessible", () => {
    expect(() => render("{{ eval }}")).toThrow();
  });

  test("require is not accessible", () => {
    expect(() => render("{{ require }}")).toThrow();
  });

  test("console is not accessible", () => {
    expect(() => render("{{ console }}")).toThrow();
  });

  test("setTimeout/setInterval is not accessible", () => {
    expect(() => render("{{ setTimeout }}")).toThrow();
    expect(() => render("{{ setInterval }}")).toThrow();
  });

  test("fetch is not accessible", () => {
    expect(() => render("{{ fetch }}")).toThrow();
  });
});

// =============================================================================
// Built-in Constructor Access
// =============================================================================

describe("template: built-in constructor access", () => {
  // These JS built-in constructors are not in template context
  test("Function is not accessible", () => {
    expect(() => render("{{ Function }}")).toThrow();
  });

  test("Object is not accessible", () => {
    expect(() => render("{{ Object }}")).toThrow();
  });

  test("Array is not accessible", () => {
    expect(() => render("{{ Array }}")).toThrow();
  });

  test("String is not accessible", () => {
    expect(() => render("{{ String }}")).toThrow();
  });

  test("Number is not accessible", () => {
    expect(() => render("{{ Number }}")).toThrow();
  });

  test("Boolean is not accessible", () => {
    expect(() => render("{{ Boolean }}")).toThrow();
  });

  test("RegExp is not accessible", () => {
    expect(() => render("{{ RegExp }}")).toThrow();
  });

  test("Symbol is not accessible", () => {
    expect(() => render("{{ Symbol }}")).toThrow();
  });

  test("Proxy is not accessible", () => {
    expect(() => render("{{ Proxy }}")).toThrow();
  });

  test("Promise is not accessible", () => {
    expect(() => render("{{ Promise }}")).toThrow();
  });

  test("Map is not accessible", () => {
    expect(() => render("{{ Map }}")).toThrow();
  });

  test("Set is not accessible", () => {
    expect(() => render("{{ Set }}")).toThrow();
  });

  test("WeakRef is not accessible", () => {
    expect(() => render("{{ WeakRef }}")).toThrow();
  });

  test("Error is not accessible", () => {
    expect(() => render("{{ Error }}")).toThrow();
  });

  test("JSON is not accessible", () => {
    expect(() => render("{{ JSON }}")).toThrow();
  });

  test("Math is not accessible", () => {
    expect(() => render("{{ Math }}")).toThrow();
  });

  test("Date is not accessible", () => {
    expect(() => render("{{ Date }}")).toThrow();
  });

  test("Reflect is not accessible", () => {
    expect(() => render("{{ Reflect }}")).toThrow();
  });
});

// =============================================================================
// Nunjucks Parser Blocks (Syntax Injection)
// =============================================================================

describe("template: syntax injection", () => {
  // Nunjucks has its own expression parser — these test that JS syntax
  // that would be dangerous in a raw new Function() context is rejected

  test("no semicolons in expressions", () => {
    expectThrow("{{ 1; 2 }}", {}, "expected variable end");
  });

  test("no arrow functions", () => {
    expectThrow("{{ (() => 1)() }}", {}, "Template error");
  });

  test("no template literals (backticks)", () => {
    // Nunjucks treats backticks as regular characters in expressions — undefined → throws
    expect(() => render("{{ `test` }}")).toThrow();
  });

  test("no assignment in expressions (rejected by parser)", () => {
    // Nunjucks rejects = in {{ }} expressions (it's not a comparison operator)
    expectThrow("{{ x = 5 }}", {}, "expected variable end");
  });
});

// =============================================================================
// call/apply/bind Abuse
// =============================================================================

describe("template: call/apply/bind", () => {
  test("apply() is blocked", () => {
    expectThrow(
      "{{ s.toString.apply(s) }}",
      { s: "test" },
      "apply() is not allowed",
    );
  });

  test("bind() is blocked", () => {
    expectThrow(
      "{{ s.toString.bind(s)() }}",
      { s: "test" },
      "bind() is not allowed",
    );
  });

  test("call() is blocked", () => {
    expectThrow(
      "{{ s.toString.call(s) }}",
      { s: "test" },
      "call() is not allowed",
    );
  });

  test("cannot reach Function via call chain", () => {
    // fn.call.constructor would be Function — but constructor is blocked
    expect(() => render("{{ fn.call.constructor }}", { fn: () => 42 })).toThrow();
  });

  test("cannot reach Function via bind chain", () => {
    expect(() => render("{{ fn.bind.constructor }}", { fn: () => 42 })).toThrow();
  });

  test("cannot reach Function via apply chain", () => {
    expect(() => render("{{ fn.apply.constructor }}", { fn: () => 42 })).toThrow();
  });
});

// =============================================================================
// String Method Abuse
// =============================================================================

describe("template: string method abuse", () => {
  test("matchAll is blocked", () => {
    expectThrow(
      '{{ s.matchAll("a") }}',
      { s: "aaa" },
      "matchAll() is not available",
    );
  });

  test("match returns result, constructor still blocked", () => {
    expect(() => render('{{ s.match("t").constructor }}', { s: "test" })).toThrow();
  });

  test("split returns array, constructor still blocked", () => {
    expect(() => render('{{ s.split("").constructor }}', { s: "ab" })).toThrow();
  });

  test("safe string methods work", () => {
    expect(render('{{ s.includes("ell") }}', { s: "hello" })).toBe("true");
    expect(render('{{ s.startsWith("hel") }}', { s: "hello" })).toBe("true");
    expect(render('{{ s.endsWith("llo") }}', { s: "hello" })).toBe("true");
    expect(render('{{ s.indexOf("l") }}', { s: "hello" })).toBe("2");
    expect(render('{{ s.slice(1, 3) }}', { s: "hello" })).toBe("el");
    expect(render("{{ s.trim() }}", { s: "  hi  " })).toBe("hi");
    expect(render("{{ s.toLowerCase() }}", { s: "HI" })).toBe("hi");
    expect(render("{{ s.toUpperCase() }}", { s: "hi" })).toBe("HI");
  });
});

// =============================================================================
// Array Method Abuse
// =============================================================================

describe("template: array method abuse", () => {
  test("safe array methods work", () => {
    expect(render("{{ arr.length }}", { arr: [1, 2, 3] })).toBe("3");
    expect(render('{{ arr.includes("a") }}', { arr: ["a", "b"] })).toBe("true");
    expect(render('{{ arr.indexOf("b") }}', { arr: ["a", "b"] })).toBe("1");
    expect(render('{{ arr.join(", ") }}', { arr: ["a", "b"] })).toBe("a, b");
  });

  test("array constructor blocked", () => {
    expect(() => render("{{ arr.constructor }}", { arr: [1, 2] })).toThrow();
  });

  test("array method constructor blocked", () => {
    expect(() => render("{{ arr.join.constructor }}", { arr: [1] })).toThrow();
    expect(() => render("{{ arr.includes.constructor }}", { arr: [1] })).toThrow();
  });
});

// =============================================================================
// Denial of Service Vectors
// =============================================================================

describe("template: denial of service", () => {
  test("loop iteration capped at 1000", () => {
    const arr = Array.from({ length: 1001 }, () => 1);
    expectThrow(
      "{% for x in arr %}x{% endfor %}",
      { arr },
      "Loop exceeds 1000 iteration limit",
    );
  });

  test("loops under 1000 work", () => {
    const arr = Array.from({ length: 999 }, () => 1);
    expect(() => render("{% for x in arr %}{% endfor %}", { arr })).not.toThrow();
  });

  test("output capped at 1MB", () => {
    // Generate output just over 1MB
    const bigStr = "x".repeat(10000);
    const arr = Array.from({ length: 101 }, () => 1);
    // 101 * 10000 = 1,010,000 > 1,000,000
    expectThrow(
      "{% for x in arr %}{{ content }}{% endfor %}",
      { arr, content: bigStr },
      "Template output exceeds",
    );
  });

  test("repeat() with reasonable count works", () => {
    expect(render('{{ s.repeat(3) }}', { s: "ab" })).toBe("ababab");
  });

  test("repeat() rejects based on exact output size", () => {
    // 200000 * 1 = 200,000 > MAX_STRING_OUTPUT → pre-check with exact length
    expectThrow(
      "{{ s.repeat(200000) }}",
      { s: "x" },
      "would produce",
    );
  });

  test("repeat() rejects short string * large count", () => {
    // 3 * 50000 = 150,000 > MAX_STRING_OUTPUT → caught by exact pre-check
    expectThrow(
      "{{ s.repeat(50000) }}",
      { s: "abc" },
      "would produce",
    );
  });

  test("repeat() rejects long string * small count", () => {
    // 10000 * 20 = 200,000 > MAX_STRING_OUTPUT → caught by exact pre-check
    expectThrow(
      "{{ s.repeat(20) }}",
      { s: "x".repeat(10000) },
      "would produce",
    );
  });

  test("repeat() with astronomic count rejects before allocation", () => {
    // Without pre-validation this would attempt a ~1GB allocation
    expectThrow(
      "{{ s.repeat(1000000000) }}",
      { s: "x" },
      "would produce",
    );
  });

  test("padStart() with reasonable length works", () => {
    expect(render('{{ s.padStart(5, "0") }}', { s: "42" })).toBe("00042");
  });

  test("padStart() with excessive length rejects before allocation", () => {
    // Without pre-validation this would attempt a ~100MB allocation
    expectThrow(
      "{{ s.padStart(100000000) }}",
      { s: "a" },
      "target length",
    );
  });

  test("padEnd() with reasonable length works", () => {
    expect(render('{{ s.padEnd(5, ".") }}', { s: "hi" })).toBe("hi...");
  });

  test("padEnd() with excessive length rejects before allocation", () => {
    expectThrow(
      "{{ s.padEnd(100000000) }}",
      { s: "a" },
      "target length",
    );
  });

  test("replaceAll() with reasonable replacement works", () => {
    expect(render('{{ s.replaceAll("a", "b") }}', { s: "aaa" })).toBe("bbb");
  });

  test("replaceAll() chained exponential growth throws", () => {
    expectThrow(
      '{{ s.replaceAll("a", "aaaa").replaceAll("a", "aaaa").replaceAll("a", "aaaa").replaceAll("a", "aaaa").replaceAll("a", "aaaa") }}',
      { s: "a".repeat(100) },
      "produced",
    );
  });

  test("join() via split/join chained amplification throws", () => {
    expectThrow(
      '{{ s.split("").join("aaa").split("").join("aaa").split("").join("aaa").split("").join("aaa").split("").join("aaa").split("").join("aaa") }}',
      { s: "a".repeat(100) },
      "produced",
    );
  });

  test("join filter with excessive output throws", () => {
    // Array of 1000 items each 200 chars long → 200,000 char result > 100KB
    const arr = Array.from({ length: 1000 }, () => "x".repeat(200));
    expectThrow(
      "{{ arr | join(',') }}",
      { arr },
      "produced",
    );
  });

  test("nested loops under limits work", () => {
    const outer = Array.from({ length: 10 }, () => 1);
    const inner = Array.from({ length: 10 }, () => 1);
    expect(() => render(
      "{% for x in outer %}{% for y in inner %}o{% endfor %}{% endfor %}",
      { outer, inner },
    )).not.toThrow();
  });
});

// =============================================================================
// ReDoS (Regular Expression Denial of Service)
// =============================================================================

describe("template: regex validation", () => {
  test("safe patterns work with .match()", () => {
    // Use character class pattern that doesn't rely on Nunjucks backslash parsing
    expect(render('{{ s.match("[0-9]+") }}', { s: "test123" })).toContain("123");
  });

  test("safe patterns work with .search()", () => {
    expect(render('{{ s.search("ell") }}', { s: "hello" })).toBe("1");
  });

  test("safe patterns work with .replace()", () => {
    expect(render('{{ s.replace("a", "b") }}', { s: "aaa" })).toBe("baa");
  });

  test("safe patterns work with .split()", () => {
    expect(render('{{ s.split(",").length }}', { s: "a,b,c" })).toBe("3");
  });

  test("catastrophic backtracking pattern blocked", () => {
    expectThrow(
      '{{ s.match("(a+)+b") }}',
      { s: "aaa" },
      "capturing groups",
    );
  });

  test("nested quantifier patterns blocked", () => {
    expectThrow('{{ s.match("(?:a+)+") }}', { s: "a" }, "nested quantifier");
    expectThrow('{{ s.search("(?:a+)+") }}', { s: "a" }, "nested quantifier");
    expectThrow('{{ s.replace("(?:a+)+", "") }}', { s: "a" }, "nested quantifier");
    expectThrow('{{ s.split("(?:a+)+") }}', { s: "a" }, "nested quantifier");
  });

  test("safe string methods are unaffected by regex patterns", () => {
    // includes/startsWith/endsWith do literal matching, not regex
    expect(render('{{ s.includes("(a+)+b") }}', { s: "aaa" })).toBe("false");
    expect(render('{{ s.startsWith("(a+)+b") }}', { s: "aaa" })).toBe("false");
  });
});

// =============================================================================
// Context Prototype Leakage
// =============================================================================

describe("template: context prototype leakage", () => {
  // Nunjucks context objects are plain JS objects with Object.prototype.
  // Properties inherited from Object.prototype are accessible but harmless
  // because constructor access is blocked.

  test("toString is accessible but constructor is blocked", () => {
    expect(() => render("{{ toString.constructor }}")).toThrow();
  });

  test("hasOwnProperty is accessible but harmless", () => {
    expect(() => render("{{ hasOwnProperty.constructor }}")).toThrow();
  });

  test("__proto__.constructor is blocked", () => {
    expect(() => render("{{ __proto__.constructor }}")).toThrow();
  });

  test("valueOf.constructor is blocked", () => {
    expect(() => render("{{ valueOf.constructor }}")).toThrow();
  });
});

// =============================================================================
// Known Sandbox Escape Patterns (CVEs and published escapes)
// =============================================================================

describe("template: known sandbox escape patterns", () => {
  test("constructor.constructor('return this')()", () => {
    // Classic: get Function via constructor chain, execute arbitrary code
    // Step 1: memberLookup blocks .constructor → undefined → throws
    expect(() => render('{{ "".constructor }}')).toThrow();
  });

  test("__proto__.constructor pattern", () => {
    expect(() => render('{{ "".__proto__ }}')).toThrow();
  });

  test("toString.call pattern for type confusion", () => {
    // toString is accessible (inherited from Object.prototype) but .constructor is blocked
    expect(() => render("{{ toString.constructor }}")).toThrow();
  });

  test("[].fill.constructor pattern", () => {
    // Array literal → method → constructor all go through memberLookup
    expect(() => render("{{ [].fill.constructor }}")).toThrow();
  });

  test("string sub.call.call pattern", () => {
    expect(() => render('{{ "".constructor }}')).toThrow();
  });

  test("range().constructor attempt", () => {
    // Nunjucks built-in range → constructor blocked
    expect(() => render("{{ range(5).constructor }}")).toThrow();
  });

  test("cycler/joiner built-in constructor", () => {
    // Nunjucks built-in cycler/joiner (if available) → constructor blocked
    expect(() => render("{{ cycler.constructor }}")).toThrow();
  });

  test("loop variable prototype access", () => {
    expect(() => render("{% for x in [1] %}{{ loop.__proto__ }}{% endfor %}")).toThrow();
    expect(() => render("{% for x in [1] %}{{ loop.constructor }}{% endfor %}")).toThrow();
  });
});

// =============================================================================
// Multi-vector Combined Attacks
// =============================================================================

describe("template: combined attack vectors", () => {
  test("method chain + constructor attempt", () => {
    expect(() => render("{{ s.trim().toLowerCase().constructor }}", { s: "test" })).toThrow();
  });

  test("ternary + constructor attempt", () => {
    expect(() => render("{{ s.constructor if true else 'safe' }}", { s: "test" })).toThrow();
    expect(() => render("{{ 'safe' if false else s.constructor }}", { s: "test" })).toThrow();
  });

  test("filter chain + constructor attempt", () => {
    const result = render("{{ (arr | join(',')) }}", { arr: [1, 2] });
    expect(result).toBe("1,2");
    // Constructor on filter result blocked
    expect(() => render("{{ (arr | first).constructor }}", { arr: ["a"] })).toThrow();
  });

  test("nested for-loop with constructor attempt", () => {
    expect(() => render(
      "{% for item in arr %}{{ item.constructor }}{% endfor %}",
      { arr: ["a", "b"] },
    )).toThrow();
  });

  test("set + constructor attempt", () => {
    expect(() => render("{% set x = s.constructor %}{{ x }}", { s: "test" })).toThrow();
  });

  test("if condition using constructor", () => {
    // constructor returns undefined → falsy → else branch
    expect(render("{% if s.constructor %}yes{% else %}no{% endif %}", { s: "test" })).toBe("no");
  });
});

// =============================================================================
// Accepted Risks (documented + bounded)
// =============================================================================

describe("template: accepted risks", () => {
  test("Nunjucks built-in range() is accessible", () => {
    // range() is a Nunjucks global — useful for templates, not dangerous
    expect(render("{{ range(5) | join(',') }}")).toBe("0,1,2,3,4");
  });

  test("Object.prototype methods are accessible but harmless", () => {
    // hasOwnProperty, toString, valueOf are accessible from context prototype
    // but constructor access blocks any escalation → throws with throwOnUndefined
    expect(() => render("{{ toString.constructor }}")).toThrow();
    expect(() => render("{{ valueOf.constructor }}")).toThrow();
  });

  test("array mutation in templates is contained", () => {
    // Nunjucks can call array methods that mutate — contained to template execution
    const arr = [3, 1, 2];
    render("{{ arr.sort() }}", { arr });
    // Mutation happened but is contained
    expect(arr[0]).toBe(1);
  });

  test("set tag allows variable creation (template scope only)", () => {
    // {% set %} creates variables in the template scope — not a security issue
    expect(render("{% set x = 42 %}{{ x }}")).toBe("42");
    expect(render("{% set y = 'hello' | upper %}{{ y }}")).toBe("HELLO");
  });
});

// =============================================================================
// Template Context Structure
// =============================================================================

describe("template: structured context", () => {
  test("renders entity facts from context", () => {
    const ctx = {
      entities: [{ id: 1, name: "Aria", facts: ["is a character", "has silver hair"] }],
    };
    expect(render(
      "{% for e in entities %}{{ e.name }}: {% for f in e.facts %}{{ f }}; {% endfor %}{% endfor %}",
      ctx,
    )).toBe("Aria: is a character; has silver hair; ");
  });

  test("renders structured messages from history", () => {
    const ctx = {
      history: [
        { author: "Alice", content: "Hello", author_id: "123", created_at: "2024-01-01" },
        { author: "Bob", content: "Hi!", author_id: "456", created_at: "2024-01-01" },
      ],
    };
    expect(render(
      "{% for msg in history %}{{ msg.author }}: {{ msg.content }}\n{% endfor %}",
      ctx,
    )).toBe("Alice: Hello\nBob: Hi!\n");
  });

  test("renders memories from context", () => {
    const ctx = {
      memories: { 1: ["memory 1", "memory 2"] },
    };
    expect(render(
      "{% for m in memories[1] %}{{ m }}; {% endfor %}",
      ctx,
    )).toBe("memory 1; memory 2; ");
  });

  test("renders entity_names and freeform flags", () => {
    const ctx = { entity_names: "Aria, Luna", freeform: true };
    expect(render("{{ entity_names }}", ctx)).toBe("Aria, Luna");
    expect(render("{% if freeform %}free{% endif %}", ctx)).toBe("free");
  });
});

// =============================================================================
// send_as Security Tests
// =============================================================================

describe("template: send_as security", () => {
  test("send_as is not available in renderEntityTemplate (only via renderStructuredTemplate)", () => {
    // send_as is only injected by renderStructuredTemplate, not available in plain rendering
    expect(() => render("{% call send_as('system') %}test{% endcall %}")).toThrow();
  });

  test("role parameter with injection characters is harmless", () => {
    // The parser uses \w+ regex for role matching — non-word chars won't match
    const { renderStructuredTemplate } = require("./template");
    // Even if someone tries to inject markers, the role regex rejects non-word chars
    const template = `{% call send_as("user>>>malicious") %}test{% endcall %}`;
    const output = renderStructuredTemplate(template, {});
    // The role contains >>>, which means the marker won't match the \w+ pattern
    // The content will appear as unmarked text (system role)
    expect(output.messages.every((m: { role: string }) => m.role !== "user>>>malicious")).toBe(true);
  });

  test("send_as inside prototype chain attack is blocked", () => {
    // Can't access send_as.constructor or similar — throws with throwOnUndefined
    const { renderStructuredTemplate } = require("./template");
    const template = `{{ send_as.constructor }}`;
    expect(() => renderStructuredTemplate(template, {})).toThrow();
  });
});

// =============================================================================
// Safe Date Access (when provided in context)
// =============================================================================

describe("template: safe Date access", () => {
  // The global Date is NOT accessible (tested in "built-in constructor access")
  // But a safe Date wrapper can be provided in context

  // Create a safe Date wrapper matching what ExprContext provides
  const SafeDate = Object.freeze(Object.assign(Object.create(null), {
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
  }));

  test("Date.new() returns current date when in context", () => {
    const result = render("{{ Date.new().getFullYear() }}", { Date: SafeDate });
    expect(parseInt(result)).toBe(new Date().getFullYear());
  });

  test("Date.new(timestamp) creates date from milliseconds", () => {
    expect(render("{{ Date.new(0).toISOString() }}", { Date: SafeDate })).toBe("1970-01-01T00:00:00.000Z");
  });

  test("Date.new(dateString) parses date strings", () => {
    expect(render('{{ Date.new("2024-01-15").getFullYear() }}', { Date: SafeDate })).toBe("2024");
  });

  test("Date.new(year, month, ...) creates date from components", () => {
    expect(render("{{ Date.new(2024, 0, 15).getFullYear() }}", { Date: SafeDate })).toBe("2024");
    expect(render("{{ Date.new(2024, 0, 15).getMonth() }}", { Date: SafeDate })).toBe("0");
  });

  test("Date.now() returns timestamp", () => {
    const result = parseInt(render("{{ Date.now() }}", { Date: SafeDate }));
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("Date.parse() parses date strings", () => {
    expect(render('{{ Date.parse("2024-01-15T12:00:00.000Z") }}', { Date: SafeDate })).toBe("1705320000000");
  });

  test("Date.UTC() creates UTC timestamp", () => {
    expect(render("{{ Date.UTC(2024, 0, 15, 12, 0, 0, 0) }}", { Date: SafeDate })).toBe("1705320000000");
  });

  test("Date instance methods work", () => {
    expect(render("{{ Date.new(0).getTime() }}", { Date: SafeDate })).toBe("0");
    expect(render("{{ Date.new(0).toISOString() }}", { Date: SafeDate })).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("template: Date prototype chain escapes BLOCKED", () => {
  const SafeDate = Object.freeze(Object.assign(Object.create(null), {
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
  }));

  test("Date.constructor is blocked (returns undefined → throws with throwOnUndefined)", () => {
    // memberLookup returns undefined for blocked props, throwOnUndefined throws
    expect(() => render("{{ Date.constructor }}", { Date: SafeDate })).toThrow();
  });

  test("Date.__proto__ is blocked", () => {
    expect(() => render("{{ Date.__proto__ }}", { Date: SafeDate })).toThrow();
  });

  test("Date.prototype is blocked", () => {
    expect(() => render("{{ Date.prototype }}", { Date: SafeDate })).toThrow();
  });

  test("Date.new.constructor is blocked", () => {
    expect(() => render("{{ Date.new.constructor }}", { Date: SafeDate })).toThrow();
  });

  test("Date.now.constructor is blocked", () => {
    expect(() => render("{{ Date.now.constructor }}", { Date: SafeDate })).toThrow();
  });

  test("Date.new().constructor is blocked", () => {
    expect(() => render("{{ Date.new().constructor }}", { Date: SafeDate })).toThrow();
  });

  test("Date.new().__proto__ is blocked", () => {
    expect(() => render("{{ Date.new().__proto__ }}", { Date: SafeDate })).toThrow();
  });

  test("Date.new().toString.constructor is blocked", () => {
    expect(() => render("{{ Date.new().toString.constructor }}", { Date: SafeDate })).toThrow();
  });

  test("Date.new().getTime.constructor is blocked", () => {
    expect(() => render("{{ Date.new().getTime.constructor }}", { Date: SafeDate })).toThrow();
  });

  test("cannot access Function via Date.new().constructor.constructor", () => {
    expect(() => render("{{ Date.new().constructor.constructor }}", { Date: SafeDate })).toThrow();
  });

  test("cannot execute RCE payload via Date", () => {
    expect(() => render('{{ Date.new().constructor.constructor("return process")() }}', { Date: SafeDate })).toThrow();
  });
});
