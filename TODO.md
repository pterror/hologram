# TODO

## Tech Debt

### Dependencies

- **@discordeno/bot** pinned to `22.0.1-next.ff7c51d` - stable v21 has a bug where webhook query params (`wait` + `thread_id`) aren't joined with `&`, breaking thread posts. Fixed in next/beta but not released to stable yet.

### Test Coverage

Current: 873 tests across `src/logic/expr.test.ts`, `src/logic/expr.security.test.ts`, `src/logic/expr.date.test.ts`, `src/logic/safe-regex.test.ts`, `src/ai/template.test.ts`, `src/ai/template-output.test.ts`, and `src/ai/template-parity.test.ts`. Covers:
- Expression evaluator (tokenizer, parser, operators, precedence)
- Security (identifier whitelist, injection prevention, prototype access)
- Adversarial sandbox escapes (184 tests): prototype chains, global access, constructors, module system, bracket notation, code injection, statement injection, unsupported syntax, call/apply/bind, string/array method abuse, DoS vectors (ReDoS + memory exhaustion runtime-bounded: repeat, padStart, padEnd, replaceAll, join), unicode tricks, numeric edge cases, known CVE patterns, combined multi-vector attacks, prototype-less objects, evalMacroValue sandbox
- Safe regex validation (148 tests): safe patterns accepted, capturing groups/nested quantifiers/backreferences/lookahead rejected, safety invariant exhaustive, integration with expr evaluator (match/search/replace/split), matchAll blocked, real-world ReDoS patterns
- Accepted risks (documented): quadratic regex bounded by Discord message length, array mutation contained to context, no runtime timeout (mitigated by static analysis), unrestricted safe string methods
- Self context parsing
- Fact parsing and evaluation ($if, $respond, $retry, $locked, $avatar, $stream, $model, $context expression predicates, $strip)
- Permission directives (config-based $edit, $view, $use, $blacklist via defaults; $locked from facts; role ID matching)
- Roll20 dice (kh, kl, dh, dl, exploding, success counting)
- Utility functions (formatDuration, parseOffset)
- New ExprContext functions (duration, date_str, time_str, isodate, isotime, weekday, group, pick)
- Safe Date wrapper (78 tests): Date.new(), Date.now(), Date.parse(), Date.UTC(), instance methods, prototype chain escape prevention, RCE via constructor blocked, edge cases, real-world use cases
- messages() with filter ($user, $char)
- Discord emote edge cases
- Real-world entity evaluation
- Template engine (Nunjucks) security (148 tests): prototype chain escapes, RCE via constructor chains, global object access blocked, built-in constructor access blocked, call/apply/bind blocked, matchAll blocked, string method memory limits, loop iteration cap (1000), output size cap (1MB), ReDoS regex validation, context prototype leakage contained, known CVE patterns, multi-vector combined attacks, filter functionality, whitespace control, structured context rendering, send_as security (not available in plain render, role injection safe, prototype chain blocked)
- Template tests (43 tests): DEFAULT_TEMPLATE snapshot tests (system prompt + messages for single/multi entity, freeform, memories, others, no entities, empty history), adversarial injection (nonce-like markers, template syntax in content), send_as protocol tests (role designation, for-loop, unmarked text interleaving, empty filtering, legacy compat), block invisibility tests (blocks are organizational only), renderSystemPrompt tests, template inheritance

---

### Expression Evaluation Timeout

The expression evaluator (`src/logic/expr.ts`) runs `new Function()` synchronously on the event loop with no timeout. Static analysis (regex validation, blocked methods) mitigates most DoS vectors, but defense-in-depth would benefit from a runtime timeout. Options:
1. Move evaluation to a worker thread with a deadline — comprehensive but adds complexity
2. `Promise.race` with `setTimeout` — doesn't actually interrupt synchronous JS execution
3. Accept the risk — static analysis covers regex and memory exhaustion; remaining vectors (quadratic regex like `(?:a|a)+` on bounded Discord messages) are limited by input size

---

## Architecture

See `docs/postmortem/2026-01-26-ux-critique.md` for full analysis.

### Prompt & Context

- [ ] Strip prompt scaffolding - remove `<defs>` XML tags and unnecessary structure from system prompt
- [ ] Silent failure elimination - when no entities are bound, explain why nothing happened instead of silently returning
- [x] Dynamic token allocation - `$context` now supports expression predicates (`chars`, `count`, `age_h`, etc.) with default `chars < 4000 || count < 20`

### Multi-Character

- [ ] Known but not speaking - non-responding entities bound to a channel should be included in LLM context with a `<known_entity>` marker so the LLM knows they're present but shouldn't speak for them

### Features

- [ ] Zero-command start - mention with no binding → prompt "who should I be?" → auto-create and respond
- [ ] Shareable entity template presets
- [ ] Clone/fork functionality with permissions
- [ ] Channel permission inheritance - should channel-bound entities inherit permissions from the channel entity?
- [ ] Mentionable select for permissions UI - use Discord's [mentionable select](https://discord.com/developers/docs/components/reference#mentionable-select) for `$edit`, `$view`, `$use`, `$blacklist`. 0 selections = @everyone, placeholder text explains "if blank, everyone can view/edit/use"

---

## Backlog

### Bot Message Visibility

Mostly resolved by the structured messages refactor:

- ~~**Embed-only messages are dropped**~~ — Now serialized as `title — description` into content, with full embed data in `data` JSON blob.
- **Text-content bot messages are included but unlabeled:** Bots that send regular `content` are stored identically to human users (`BotName: message`). The LLM has no way to distinguish them in the message history. The `data.is_bot` flag is stored but not yet surfaced in LLM context formatting (only in template `history` objects and `$user`/`$bot` filters).
- ~~**No `isBot` check exists anywhere**~~ — `message.author.toggles.bot` is now checked and stored as `data.is_bot`.
- ~~**`$user` filter misclassifies bot messages**~~ — `$user` now excludes bot messages; new `$bot` filter added.

Remaining improvements:
- Add `[bot]` suffix to author names in LLM context so models can distinguish bots from humans
- Consider a `$ignore_bots` directive to let entities opt out of seeing bot messages entirely
- Default behavior TBD: most bot embeds (leaderboards, stats, game results) are noise for RP context, but some are conversational

---

### Template Poisoning Risk

Custom templates control the entire system prompt. A malicious template on one entity could manipulate how other entities' facts are presented in the same LLM call (e.g., injecting instructions, hiding facts, reframing context). Mitigated by:
- Template-based grouping (entities with different templates get separate calls)
- Only entity owner/editors can set a template (same permission model as facts)
- Entities sharing a template are presumed to trust the same author

Future consideration: channel-level or server-level templates as an alternative scope that reduces cross-entity influence.

---

### Deferred Template Features

Template engine migrated to Nunjucks with runtime security patches. Entity-name-based template loader implemented for `{% extends %}`.

- [x] `{% extends "base-prompt" %}` — template inheritance, resolves entity name to template source
- [ ] `{% include "shared-facts" %}` — template inclusion
- [x] `{% macro %}` — reusable template macros (send_as is a macro; user-defined macros work via Nunjucks)
- [x] `{% set %}` — variable assignment within templates (supported by Nunjucks)

---

### Structured Messages Refactor

Current state: message history uses role-based `user`/`assistant` messages via `preparePromptContext()` in `prompt.ts` (shared by handler.ts, streaming.ts, and debug commands). Both custom templates and the built-in `DEFAULT_TEMPLATE` produce structured output via `send_as()` macro protocol (plain-text nonce markers). Templates get rich structured `history` objects with `is_bot`, `role`, `embeds`, `stickers` (now `{id, name, format_type}` objects), `attachments`. Bot messages are tracked via `data` JSON column.

- [x] **Role-based messages**: Model responses are `assistant` messages using AI SDK structured messages array. `buildPromptAndMessages()` in `prompt.ts` assigns roles based on `webhook_messages` lookup.
- [x] **JSON blob storage**: `data TEXT` column on `messages` table stores `MessageData` JSON (is_bot, embeds, stickers, attachments). SQLite `json_extract()` used for `$user`/`$bot` classification.
- [x] **Template integration**: Templates get rich history objects (`msg.is_bot`, `msg.embeds`, `msg.stickers`, `msg.attachments`).
- [x] **API-specific formatting via `{% extends %}`**: Template inheritance with entity-name-based loader (`{% extends "base-prompt" %}` resolves to that entity's template). Enables API-specific message/attachment blocks.
- [x] **`$user`/`$char`/`$bot` classification**: `$user` excludes bot messages via `json_extract(data, '$.is_bot')`. New `$bot` filter for other Discord bot messages.
- [x] **Embed serialization**: Embed-only messages serialized into content (`title — description`) and stored with full embed data in `data` blob.

---

## Low Priority

- [ ] In-memory test DB — `buildPromptAndMessages()` and the full prompt pipeline (`preparePromptContext` → handler/streaming) require DB access (`getMessages`, `getWebhookMessageEntity`, etc.) and can't be tested statically. A `:memory:` SQLite instance with test fixtures would enable integration tests for edge cases like the 0-messages fallback and empty-history scenarios
- [ ] Regex literal support in `$if` expressions - `/pattern/` syntax as alternative to string-based `.match()`. Low priority since `.match("pattern")` now works with safe regex validation
- [ ] `$emojis` macro - expand to list of custom guild emojis for LLM context
- [ ] Hearing distance / proximity awareness between entities
