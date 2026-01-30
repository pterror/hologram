# TODO

## Tech Debt

### Dependencies

- **@discordeno/bot** pinned to `22.0.1-next.ff7c51d` - stable v21 has a bug where webhook query params (`wait` + `thread_id`) aren't joined with `&`, breaking thread posts. Fixed in next/beta but not released to stable yet.

### Test Coverage

Current: 188 tests in `src/logic/expr.test.ts`. Covers:
- Expression evaluator (tokenizer, parser, operators, precedence)
- Security (identifier whitelist, injection prevention, prototype access)
- Self context parsing
- Fact parsing and evaluation ($if, $respond, $retry, $locked, $avatar, $stream, $model, $context, $strip)
- Permission directives ($edit, $view, $blacklist, $locked)
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

## Low Priority

- [ ] Regex support in `$if` expressions - would need tokenizer extension for `/pattern/` literals; low priority because regex is opaque and hard to read
- [ ] `$emojis` macro - expand to list of custom guild emojis for LLM context
- [ ] Hearing distance / proximity awareness between entities
