# TODO

## Tech Debt

### Dependencies

- **@discordeno/bot** pinned to `22.0.1-next.ff7c51d` - stable v21 has a bug where webhook query params (`wait` + `thread_id`) aren't joined with `&`, breaking thread posts. Fixed in next/beta but not released to stable yet.

### ReDoS Vulnerability in Expression Evaluator

**Severity: Medium.** JS string methods `.match()`, `.replace()`, `.search()`, `.split()` implicitly compile their string argument into a RegExp. Entity authors control the pattern (via `$if` expressions), so a malicious or careless author can write catastrophic backtracking patterns like `(a+)+b` that hang the event loop when a user sends pathological input. Safe alternatives like `.includes()`, `.startsWith()`, `.endsWith()`, `.indexOf()` do literal string matching.

Options:
1. Block regex-accepting methods (`match`, `search`, `replace`, `split`) in `BLOCKED_PROPERTIES` — breaking change for existing entities that use them
2. Run expression evaluation in a worker with a timeout — complex but comprehensive
3. Wrap regex-accepting method calls with a safe-regex check at compile time — requires AST-level method name detection
4. Document the risk and rely on entity author trust — least effort, weakest mitigation

### Test Coverage

Current: 382 tests across `src/logic/expr.test.ts` and `src/logic/expr.security.test.ts`. Covers:
- Expression evaluator (tokenizer, parser, operators, precedence)
- Security (identifier whitelist, injection prevention, prototype access)
- Adversarial sandbox escapes (166 tests): prototype chains, global access, constructors, module system, bracket notation, code injection, statement injection, unsupported syntax, call/apply/bind, string/array method abuse, DoS vectors, unicode tricks, numeric edge cases, known CVE patterns, combined multi-vector attacks, prototype-less objects, evalMacroValue sandbox
- Self context parsing
- Fact parsing and evaluation ($if, $respond, $retry, $locked, $avatar, $stream, $model, $context, $strip)
- Permission directives ($edit, $view, $use, $blacklist, $locked, role ID matching)
- Roll20 dice (kh, kl, dh, dl, exploding, success counting)
- Utility functions (formatDuration, parseOffset)
- New ExprContext functions (duration, date_str, time_str, isodate, isotime, weekday, group)
- messages() with filter ($user, $char)
- Discord emote edge cases
- Real-world entity evaluation

---

## Architecture

See `docs/postmortem/2026-01-26-ux-critique.md` for full analysis.

### Prompt & Context

- [ ] Strip prompt scaffolding - remove `<defs>` XML tags and unnecessary structure from system prompt
- [ ] Silent failure elimination - when no entities are bound, explain why nothing happened instead of silently returning
- [ ] Dynamic token allocation - adapt context window based on conversation rather than hardcoded 16k char default

### Multi-Character

- [ ] Known but not speaking - non-responding entities bound to a channel should be included in LLM context with a `<known_entity>` marker so the LLM knows they're present but shouldn't speak for them

### Features

- [ ] Zero-command start - mention with no binding → prompt "who should I be?" → auto-create and respond
- [ ] Shareable entity template presets
- [ ] Clone/fork functionality with permissions
- [ ] Channel permission inheritance - should channel-bound entities inherit permissions from the channel entity?

---

## Backlog

### Bot Message Visibility

Other Discord bots' messages are partially invisible in message history:

- **Embed-only messages are dropped:** `client.ts:223` bails on `!message.content && !message.stickerItems?.length`. Bots like Nekotina that respond entirely via embeds (title/description/fields) produce no `content`, so they're silently dropped. The conversation history has gaps where bot interactions happened but aren't recorded.
- **Text-content bot messages are included but unlabeled:** Bots that do send regular `content` are stored and appear in LLM context identically to human users (`BotName: message`). The LLM has no way to distinguish them from humans.
- **No `isBot` check exists anywhere:** Only the bot's own user ID is filtered (`client.ts:222`). Discord's `message.author.bot` flag is never inspected.
- **`$user` filter misclassifies bot messages:** In `messages(n, fmt, "$user")`, bot messages count as "user" messages since they have no `webhook_messages` entry. Only Hologram's own webhook messages are classified as `$char`.

Possible improvements:
- Serialize embed-only messages minimally (e.g. `BotName [bot]: embed title - embed description`) so they appear in history
- Add `[bot]` suffix to author names for `message.author.bot === true` so the LLM can distinguish them
- Add `$bot` filter to `messages()` function for entity-level control
- Consider a `$ignore_bots` directive to let entities opt out of seeing bot messages entirely
- Default behavior TBD: most bot embeds (leaderboards, stats, game results) are noise for RP context, but some are conversational

---

## Low Priority

- [ ] Regex support in `$if` expressions - would need tokenizer extension for `/pattern/` literals; low priority because regex is opaque and hard to read
- [ ] `$emojis` macro - expand to list of custom guild emojis for LLM context
- [ ] Hearing distance / proximity awareness between entities
