# Expression Evaluator Security Reference

Comprehensive analysis of every construct the expression evaluator allows, what attack surface each exposes, and why it is or is not dangerous.

Last audited: 2026-01-30

## Architecture

```
Source string → Tokenizer → Parser → AST → Code Generator → new Function("ctx", "$s", ...)
```

Security is enforced at multiple layers:

1. **Tokenizer**: Fixed token types (numbers, strings, booleans, identifiers, operators, parens, dots, commas)
2. **Parser**: Restricted 7-node AST (no statements, no assignment, no bracket notation)
3. **Code generator**: Identifier whitelist, blocked properties/methods, regex validation, method wrapping
4. **Runtime**: `new Function` scope isolation, safe method wrappers (`$s`), prototype-less objects

---

## Context Variables

Every identifier must exist in `ALLOWED_GLOBALS` (derived from `ExprContext`). Generated code prefixes all identifiers with `ctx.` so they resolve against the context object, never global scope.

### Strings

| Variable | Controlled By | Notes |
|----------|--------------|-------|
| `content` | **User** (Discord message) | Attacker controls value. Max ~4000 chars (Discord limit). |
| `author` | **User** (Discord username) | Attacker controls. |
| `replied_to` | **User** | Name of entity replied to. |
| `interaction_type` | **User** | |
| `name` | Entity owner | This entity's name. |
| `group` | System | Comma-joined bound character names. |

All expose `String.prototype` (see [String Methods](#string-methods) below).

### Numbers

| Variable | Controlled By |
|----------|--------------|
| `response_ms` | System |
| `retry_ms` | System |
| `idle_ms` | System |
| `unread_count` | System |

`Number.prototype` methods (`toString`, `toFixed`, `toExponential`, `toPrecision`, `valueOf`, `toLocaleString`) all produce bounded-length strings. **SAFE.**

### Booleans

| Variable | Controlled By |
|----------|--------------|
| `mentioned` | System |
| `replied` | System |
| `is_forward` | System |
| `is_self` | System |

`Boolean.prototype` has only `toString()` and `valueOf()`. **SAFE.**

### Functions

| Variable | Returns | Notes |
|----------|---------|-------|
| `random(min?, max?)` | number | System implementation, attacker controls args |
| `has_fact(pattern)` | boolean | System implementation |
| `roll(dice)` | number | System implementation |
| `mentioned_in_dialogue(name)` | boolean | System implementation |
| `messages(n?, format?, filter?)` | string | Returns up to MAX_CONTEXT_CHAR_LIMIT (1M chars) |
| `duration(ms)` | string | System implementation |
| `date_str(offset?)` | string | |
| `time_str(offset?)` | string | |
| `isodate(offset?)` | string | |
| `isotime(offset?)` | string | |
| `weekday(offset?)` | string | |

All are closures created by `createBaseContext()`. Implementations are system-controlled. Return values are data. Attacker controls arguments but not the function body. See [Function Methods](#function-methods) for prototype surface.

### Objects (prototype-less)

| Variable | Properties | Created Via |
|----------|-----------|-------------|
| `self` | Dynamic from entity facts (`key: value` pattern) | `Object.create(null)` |
| `time` | `hour`, `is_day`, `is_night` | `Object.create(null)` |
| `channel` | `id`, `name`, `description`, `mention` | `Object.create(null)` |
| `server` | `id`, `name`, `description` | `Object.create(null)` |

All created with `Object.create(null)` — **no prototype chain**. No `toString`, `valueOf`, `hasOwnProperty`, `constructor`, `__proto__`, or any Object.prototype method exists on these objects. Property access on undefined keys returns `undefined`. **SAFE.** This is the strongest possible defense against prototype pollution.

### Arrays

| Variable | Contents |
|----------|----------|
| `chars` | Names of all characters bound to channel |

Regular JavaScript array with full `Array.prototype` access. Contents are system-controlled (entity names). See [Array Methods](#array-methods) below.

---

## Operators

### Supported

| Operator | Type | Risk |
|----------|------|------|
| `&&`, `\|\|` | Logical | SAFE — short-circuits, returns operand |
| `===`, `!==` | Strict comparison | SAFE — no coercion |
| `==`, `!=` | Loose comparison | SAFE — triggers `.valueOf()`/`.toString()` coercion, but only on context values |
| `<`, `>`, `<=`, `>=` | Comparison | SAFE |
| `+` | Addition / string concat | SAFE — output bounded by operand sizes (see [Growth Bounds](#growth-bounds)) |
| `-`, `*`, `/`, `%` | Arithmetic | SAFE — numeric only |
| `!` | Logical NOT | SAFE |
| `-` (unary) | Negation | SAFE |
| `? :` | Ternary | SAFE — only one branch evaluated |

### Deliberately Excluded

| Operator | Why |
|----------|-----|
| `=`, `+=`, `-=`, etc. | Assignment — would allow mutation |
| `&`, `\|`, `^`, `~`, `<<`, `>>` | Bitwise — no use case, reduces surface |
| `**` | Exponentiation — no use case |
| `++`, `--` | Mutation operators |
| `??` | Not in OPERATORS list |
| `?.` | Not in OPERATORS list (codegen uses it internally) |
| `,` (operator) | Only valid inside function call argument lists |
| `in`, `instanceof`, `typeof`, `void`, `delete` | Parsed as identifiers, rejected by whitelist |

---

## Syntax Constructs

### Supported

| Construct | Generated Code | Notes |
|-----------|---------------|-------|
| Number literals | `42`, `3.14` | Decimal only. No hex/octal/binary/exponential/BigInt. |
| String literals | `JSON.stringify(value)` | Double or single quotes. `JSON.stringify` escapes all special characters — prevents code injection. |
| Boolean literals | `true`, `false` | |
| Identifiers | `ctx.name` | Validated against `ALLOWED_GLOBALS`, prefixed with `ctx.` |
| Member access | `(obj?.prop)` | Dot notation only. Property checked against blocked lists. Uses `?.` in codegen. |
| Function calls | `fn(args)` | Supports chaining: `foo().bar()`. Regex/wrapped method checks on specific methods. |
| Unary ops | `(!x)`, `(-x)` | Only `!` and `-` |
| Binary ops | `(a op b)` | All operators above |
| Ternary | `(test ? a : b)` | |
| Parentheses | `(expr)` | Precedence grouping |

### Deliberately Unsupported (and why it matters)

| Construct | Why It Matters |
|-----------|---------------|
| **Bracket notation** `obj[expr]` | Would allow `self["con"+"structor"]` to bypass blocked property checks |
| **Array/Object literals** | Would allow creating objects with controlled prototype |
| **Template literals** | Backtick not recognized — blocks string interpolation |
| **Arrow functions** | `=>` not recognized — blocks all callback injection (critical for Array methods) |
| **Function expressions** | Braces not in syntax |
| **Assignment** | `=` only recognized as part of comparison operators |
| **Statements** | `if`, `for`, `while`, `return`, etc. parsed as identifiers, rejected by whitelist |
| **`new` keyword** | Parsed as identifier, rejected |
| **Semicolons** | Not in tokenizer — prevents statement chaining |
| **Spread** `...` | Not in tokenizer |

---

## String Methods

Full analysis of `String.prototype`. Accessible on: `content`, `author`, `name`, `group`, `replied_to`, `interaction_type`, return values of `messages()` etc., and string properties of `channel.*` / `server.*` / `self.*`.

### Safe (output bounded by input)

| Method | Returns | Why Safe |
|--------|---------|----------|
| `charAt(i)` | string | Returns single char or `""` |
| `charCodeAt(i)` | number | |
| `codePointAt(i)` | number | |
| `at(i)` | string | Returns single char |
| `indexOf(s, from?)` | number | O(n) linear scan |
| `lastIndexOf(s, from?)` | number | O(n) linear scan |
| `includes(s, from?)` | boolean | O(n) linear scan |
| `startsWith(s, from?)` | boolean | O(m) where m = search length |
| `endsWith(s, end?)` | boolean | O(m) |
| `slice(start, end?)` | string | Output <= input length |
| `substring(start, end?)` | string | Output <= input length |
| `trim()` | string | Output <= input |
| `trimStart()` / `trimEnd()` | string | Output <= input |
| `toLowerCase()` / `toUpperCase()` | string | Output = input length |
| `toLocaleLowerCase()` / `toLocaleUpperCase()` | string | Output = input length |
| `normalize(form?)` | string | Output bounded by input * constant (Unicode normalization). Worst case ~18x for extreme NFD. |
| `toString()` / `valueOf()` | string | Returns the string itself |
| `localeCompare(other)` | number | Returns -1, 0, or 1 |
| `isWellFormed()` | boolean | ES2024 |
| `toWellFormed()` | string | ES2024, output = input length |
| `replaceAll(search, replacement)` | string | **Wrapped** — see [Wrapped at Runtime](#wrapped-at-runtime-memory-exhaustion-prevention). Chained calls produce exponential growth (each level multiplies all matches). |
| `length` | number | Property, not method |

### Wrapped at Runtime (memory exhaustion prevention)

Rewritten at code generation time to call `$s.method(obj, args)`. Wrappers enforce `MAX_STRING_OUTPUT = 100,000` characters.

| Method | Wrapper Behavior |
|--------|-----------------|
| `repeat(n)` | Validates: string target, non-negative integer count, output length <= 100K chars |
| `padStart(len, fill?)` | Validates: string target, non-negative length <= 100K chars |
| `padEnd(len, fill?)` | Same as padStart |
| `replaceAll(search, replacement)` | Runs native replaceAll, then checks output length <= 100K chars. Prevents chained exponential growth (`replaceAll("a","aaaa")` chains produce 4^n amplification) |
| `join(separator?)` | Validates: array target, output length <= 100K chars. Prevents `split("").join("xxx")` chained amplification |

### Regex-Validated at Compile Time (ReDoS prevention)

First argument must be a **string literal** (rejects variables/expressions). Pattern validated by `safe-regex.ts`.

| Method | Post-Validation Risk |
|--------|---------------------|
| `match(pattern)` | Returns array or null. Pattern complexity bounded by validation. |
| `search(pattern)` | Returns number. Same. Note: returns 0 for match at position 0, which is falsy in `$if` (correctness issue, not security). |
| `replace(pattern, replacement)` | Returns string. Callback as second arg impossible (no arrow functions). |
| `split(pattern)` | Returns array. Element count bounded by input length. |

### Blocked Entirely

| Method | Reason | Error Message |
|--------|--------|---------------|
| `matchAll` | Returns iterator, unusable in expression language (no `for...of`, no spread). Bypass risk if unvalidated. | "matchAll() is not available — use match() instead" |

### Not Reachable (require callbacks)

These exist on `String.prototype` but cannot be used because the parser does not support arrow functions or function expressions:

- `replace(pattern, fn)` — callback form unreachable
- `replaceAll(pattern, fn)` — callback form unreachable

### Inherited from Object.prototype

| Property/Method | Status |
|----------------|--------|
| `constructor` | **BLOCKED** — "accessing constructors could allow sandbox escape" |
| `__proto__` | **BLOCKED** — "accessing prototypes could allow sandbox escape" |
| `prototype` | **BLOCKED** |
| `__defineGetter__` / `__defineSetter__` | **BLOCKED** |
| `__lookupGetter__` / `__lookupSetter__` | **BLOCKED** |
| `hasOwnProperty(key)` | Accessible, returns boolean. SAFE. |
| `isPrototypeOf(obj)` | Accessible, returns boolean. SAFE. |
| `propertyIsEnumerable(key)` | Accessible, returns boolean. SAFE. |

---

## Array Methods

Accessible on `chars` and return values of `match()` and `split()`.

### Safe (no callback, bounded output)

| Method | Returns | Notes |
|--------|---------|-------|
| `length` | number | |
| `includes(value)` | boolean | O(n) |
| `indexOf(value)` | number | O(n) |
| `lastIndexOf(value)` | number | O(n) |
| `join(separator?)` | string | **Wrapped** — output checked against 100K limit. See [Wrapped at Runtime](#wrapped-at-runtime-memory-exhaustion-prevention). |
| `toString()` | string | Same as `join(",")` — not wrapped, but `chars` is small |
| `at(index)` | element | |
| `slice(start?, end?)` | array | Output <= input |
| `concat(...items)` | array | Linear growth |
| `flat(depth?)` | array | `chars` is 1D, so no-op |
| `toReversed()` | array | ES2023, output = input |
| `toSorted()` | array | ES2023, no callback expressible (default string sort) |
| `toSpliced(start, count, ...items)` | array | ES2023 |
| `with(index, value)` | array | ES2023 |

### Mutating (contained side effects)

These mutate the array in place. Context is rebuilt per message, so mutations don't persist. However, an earlier `$if` expression could mutate `chars` and affect a later `$if` within the same `evaluateFacts()` call.

| Method | Effect |
|--------|--------|
| `push(item)` | Adds element, returns new length |
| `pop()` | Removes last element |
| `shift()` | Removes first element |
| `unshift(item)` | Adds to front |
| `splice(start, count, ...items)` | Remove/insert |
| `sort()` | Sorts in place (default string comparison, no callback expressible) |
| `reverse()` | Reverses in place |
| `fill(value)` | Fills with value |
| `copyWithin(target, start, end?)` | Copies within array |

**Accepted risk**: Mutations contained to current evaluation. No persistent side effects.

### Not Reachable (require callbacks)

`map`, `filter`, `find`, `findIndex`, `findLast`, `findLastIndex`, `reduce`, `reduceRight`, `forEach`, `some`, `every`, `flatMap`, `toSorted(comparator)` — all require arrow functions which the parser does not support.

---

## Function Methods

Accessible on: `random`, `has_fact`, `roll`, `mentioned_in_dialogue`, `messages`, `duration`, `date_str`, `time_str`, `isodate`, `isotime`, `weekday`.

| Property/Method | Risk |
|----------------|------|
| `name` | SAFE — returns function name string, read-only |
| `length` | SAFE — returns arity, read-only |
| `call(thisArg, ...args)` | SAFE — rebinding `this` on closures has no effect; `constructor` blocked on return value |
| `apply(thisArg, args)` | SAFE — same as `call` |
| `bind(thisArg, ...args)` | SAFE — returns new function; `constructor` blocked on it |
| `toString()` | SAFE — returns `"function () { [native code] }"` or similar |
| `constructor` | **BLOCKED** — this IS `Function`, which allows arbitrary code execution |
| `prototype` | **BLOCKED** |
| `__proto__` | **BLOCKED** |

The critical block is `constructor`. The path `has_fact.call.constructor` reaches `Function` itself — but `.constructor` is blocked at compile time on all property access, so this never executes.

---

## Generated Code & new Function Scope

### Code Generation

| AST Node | Output | Injection Risk |
|----------|--------|---------------|
| String literal | `JSON.stringify(value)` | **None** — JSON.stringify escapes all special chars |
| Number literal | `String(value)` on parsed float | **None** |
| Boolean literal | `true` / `false` | **None** |
| Identifier | `ctx.name` | **None** — whitelist validated, prefixed |
| Member | `(obj?.prop)` | **None** — property name checked against blocked lists |
| Call | `callee(args)` | **None** — no user-controlled code in structure |
| Call (wrapped) | `$s.method(obj, args)` | **None** — $s is system-controlled |

### new Function Scope

```typescript
const raw = new Function("ctx", "$s", `return Boolean(${code})`);
fn = (ctx: ExprContext) => raw(ctx, SAFE_METHODS);
```

- `ctx`: ExprContext — all access controlled by whitelist
- `$s`: SAFE_METHODS — system-controlled wrappers
- **Global scope**: `new Function` runs in global scope (not module scope). JavaScript builtins like `Object`, `Function`, `eval`, `globalThis`, `process`, etc. are technically accessible. **However**, no generated code path produces a bare identifier — every identifier is validated against `ALLOWED_GLOBALS` and prefixed with `ctx.`. The only bare identifier in the template is `Boolean` (hardcoded, not user-controlled).

### Can Generated Code Escape?

For escape, an attacker would need to:

1. **Inject code into the generated string** — Impossible: strings use `JSON.stringify`, numbers/booleans are already parsed, identifiers are prefixed
2. **Reach a dangerous global** — Impossible: no bare identifiers (all prefixed with `ctx.`), no bracket notation
3. **Get to `Function` constructor** — Impossible: `.constructor` blocked on all property access at compile time

---

## Regex Validation (safe-regex.ts)

### Safety Invariant

**No quantifier may be applied to an expression that itself contains a quantifier.** Tracked via `hasQuantifier` boolean on each AST node. This single rule prevents all exponential backtracking.

### Blocked

| Construct | Why |
|-----------|-----|
| Capturing groups `(abc)` | Enable backtracking |
| Nested quantifiers `(?:a+)+` | Exponential backtracking |
| Backreferences `\1` | Exponential matching time |
| Lookahead `(?=...)` / `(?!...)` | Pathological interaction with backtracking |
| Lookbehind `(?<=...)` / `(?<!...)` | Same |
| Named groups `(?<n>...)` | Are capturing groups |
| Unknown escapes `\x`, `\u`, `\p`, etc. | Prevents parser differential bugs |
| Dynamic patterns (variables) | Pattern must be string literal in source |

### Allowed

Literals, dot, anchors (`^`, `$`, `\b`), alternation, character classes, non-capturing groups `(?:...)`, single-level quantifiers (`+`, `*`, `?`, `{n}`, `{n,m}`, `{n,}`), lazy quantifiers, whitelisted escapes (`\d \D \w \W \s \S \t \n \r \b` + escaped special chars).

### Accepted Risk: Quadratic Patterns

Patterns like `(?:a|a)+` have O(n^2) matching time (polynomial, not exponential). With Discord's ~4000 char message limit, worst case is ~16M operations (~100ms). Accepted because:
- Not catastrophic (seconds, not minutes/hours)
- Bounded by input size which we don't control but Discord limits
- Eliminating would require full alternation overlap analysis (complex, diminishing returns)

---

## Growth Bounds

Without assignment operators, no expression can capture intermediate results. Every reference to a context variable (e.g., `content`) produces the original value. This means:

**Total output of any expression is bounded by: `(number of variable references) * (largest single value)`**

| Expression Type | Max References (in 4000-char fact) | Max Single Value | Max Output |
|-----------------|------------------------------------|--------------------|------------|
| `content + content + ...` | ~500 (`content` = 7 chars + operator) | ~4,000 chars | ~2M chars |
| `name + name + ...` | ~660 (`name` = 4 chars + operator) | varies | varies |
| `messages() + messages() + ...` | ~330 (`messages()` = 10 chars + op) | 1M chars (MAX_CONTEXT_CHAR_LIMIT) | ~330M chars |
| `.concat()` chains | ~230 (`.concat(content)` = 16 chars) | 4,000 chars | ~920K chars |

The `messages()` case is the theoretical worst: ~330 references * 1M = 330M chars (~660MB). In practice, `messages()` returns far less than 1M (typical: a few KB). The hard cap `MAX_CONTEXT_CHAR_LIMIT` is 1M, but actual channel history is usually much smaller.

**Why `concat` is NOT exponential**: `content.concat(content).concat(content)` produces `3 * content.length`, not `2^3 * content.length`. Each `.concat(content)` adds one copy of the original `content`, not one copy of the accumulated result. Without variables, there's no way to "double" a value.

**Exception: methods that transform accumulated results.** `replaceAll` and `split/join` chains operate on the accumulated intermediate string, not the original. `content.replaceAll("a","aaaa").replaceAll("a","aaaa")` chains produce 4^n growth because each level multiplies the output of the previous level. These are wrapped with runtime output size limits (100K chars).

---

## Accepted Risks Summary

Each is documented in `src/logic/expr.security.test.ts` in the "accepted risks" test section.

| Risk | Severity | Bound | Notes |
|------|----------|-------|-------|
| Quadratic regex `(?:a\|a)+` | Low | Discord message length (~4000 chars) | ~100ms worst case |
| Array mutation via push/sort | Low | Context rebuilt per message | No persistent side effects |
| No runtime expression timeout | Medium | Static analysis covers known vectors | Worker thread timeout is possible future hardening |
| Unrestricted safe string methods | Low | Methods are individually safe (bounded output) | Full whitelist is possible future hardening |
| `messages()` in growth expressions | Low | MAX_CONTEXT_CHAR_LIMIT (1M) * practical expression size | Theoretical 330M output, practical <1M |

---

## Defense-in-Depth Layers

| Layer | What It Prevents |
|-------|-----------------|
| Tokenizer (fixed token types) | Template literals, regex literals, spread, destructuring |
| Parser (7-node AST) | Statements, assignment, bracket notation, arrow functions, `new` |
| Identifier whitelist (`ALLOWED_GLOBALS`) | Access to `globalThis`, `process`, `eval`, `Function`, `Object`, etc. |
| `ctx.` prefix on all identifiers | Bare global access from generated code |
| Blocked properties (`Map`) | `constructor`, `__proto__`, `prototype`, `__define/lookupGetter/Setter__` |
| Blocked methods | `matchAll` |
| Wrapped methods (`$s`) | `repeat`, `padStart`, `padEnd`, `replaceAll`, `join` — bounded to 100K chars |
| Regex validation (`safe-regex.ts`) | Catastrophic backtracking patterns |
| String literal requirement | Dynamic regex patterns |
| Prototype-less objects (`Object.create(null)`) | Prototype chain traversal on self, time, channel, server |
| `JSON.stringify` for string codegen | Code injection through string content |
| Optional chaining (`?.`) in codegen | Runtime errors from undefined property access |
| `Boolean()` / closure wrapping | Clean function signature, $s not exposed to expression language |
