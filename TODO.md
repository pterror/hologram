# TODO

## Tech Debt

### Architecture

- [ ] Extract circular dependencies - lazy imports in `src/bot/commands/build.ts` and `src/dice/index.ts` should be extracted to shared modules
- [ ] Unify mode/preset system - modes in `plugins/index.ts` and presets in `config/defaults.ts` are synchronized manually; make single source of truth
- [ ] Add extractor timeout - fire-and-forget extractors in `plugins/core/index.ts:177` have no cancellation/timeout mechanism
- [ ] Type-safe plugin data - `ctx.data` Map uses string keys and casting; consider typed plugin data structure
- [ ] Add structured logging - replace console.log/error with logger abstraction (pino or similar)
- [ ] RAG query caching - consider caching similar queries to avoid re-embedding every message

### Test Coverage

Current: 314 tests across 16 files. Pure-logic modules tested:
- `src/ai/budget.ts` - token estimation, budget allocation
- `src/ai/context.ts` - message formatting, timestamp injection
- `src/ai/debug.ts` - context debugging, trace formatting, export
- `src/ai/extract.ts` - extraction prompt parsing, heuristic extraction
- `src/bot/webhooks.ts` - multi-char response parsing
- `src/chronicle/index.ts` - chronicle formatting, perspective filtering, explicit markers
- `src/config/defaults.ts` - config merging, presets
- `src/dice/index.ts` - dice parser (expressions, keep/drop, explode)
- `src/events/conditions.ts` - event condition evaluation (time, season, location, weather)
- `src/personas/index.ts` - persona context formatting
- `src/proxies/index.ts` - proxy matching (prefix/suffix/brackets)
- `src/relationships/index.ts` - affinity labels
- `src/state/index.ts` - outfit context formatting
- `src/wizards/index.ts` - wizard step flow, config-aware flow building
- `src/world/rng.ts` - seeded RNG determinism, distribution, dice notation
- `src/world/time.ts` - time math, calendar, periods, formatting

Remaining modules (DB-dependent, need mocking to test):
- [ ] `src/events/random.ts` - weighted selection, cooldown tracking
- [ ] `src/events/behavior.ts` - state machine transitions
- [ ] `src/combat/index.ts` - initiative ordering, turn management
- [ ] `src/world/locations.ts` - location graph traversal, hierarchy
- [ ] `src/world/inventory.ts` - capacity checks, equipment slot validation
- [ ] `src/memory/graph.ts` - knowledge graph queries

---

## Completed

All integration and feature work from Phases 1-7 is done:

- [x] Message handler integration (scene context, proxy, chronicle, extraction, multi-char)
- [x] Proxy webhook execution (creation, caching, DM fallback)
- [x] Config-aware item wizard (dynamic flows based on WorldConfig)
- [x] Random events system (tables, triggers, conditions, cooldowns, effects)
- [x] Real-time sync (auto-advancement, time-skip narration)
- [x] Inter-message timestamps (relative/absolute/calendar/both formats)
- [x] State extraction pipeline (explicit markers, heuristic, LLM-based)
- [x] Chronicle embeddings virtual table in schema
- [x] Perspective-based chronicle filtering for user queries
- [x] Deduplicate evaluateConditions into shared events/conditions.ts
- [x] Extract respond/editResponse/respondDeferred into shared commands/index.ts
