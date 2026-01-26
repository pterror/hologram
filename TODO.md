# TODO

## Tech Debt

### Architecture

- [x] Extract circular dependencies - removed phantom workarounds in `build.ts` and `dice/index.ts` (no actual cycles existed)
- [x] Unify mode/preset system - `/config preset` now uses modes from `plugins/index.ts` as source of truth; legacy PRESETS in defaults.ts kept for backwards compat
- [x] Add extractor timeout - extractors now wrapped with 30s timeout in `plugins/registry.ts`
- [x] Type-safe plugin data - added `definePluginData<T>()` factory for type-safe accessors; delivery plugin updated as example
- [x] Add structured logging - added `src/logger.ts` with levels, timestamps, context; updated core files (index, client, registry, core plugin)
- [x] RAG query caching - added TTL-based LRU cache for embeddings (5 min TTL, 500 max entries)

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
