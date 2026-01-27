# TODO

## Tech Debt

### Dependencies

- **@discordeno/bot** pinned to `22.0.1-next.ff7c51d` - stable v21 has a bug where webhook query params (`wait` + `thread_id`) aren't joined with `&`, breaking thread posts. Fixed in next/beta but not released to stable yet.

### Architecture

- [x] Extract circular dependencies - removed phantom workarounds in `build.ts` and `dice/index.ts` (no actual cycles existed)
- [x] Unify mode/preset system - `/config preset` now uses modes from `plugins/index.ts` as source of truth; legacy PRESETS in defaults.ts kept for backwards compat
- [x] Add extractor timeout - extractors now wrapped with 30s timeout in `plugins/registry.ts`
- [x] Type-safe plugin data - added `definePluginData<T>()` factory for type-safe accessors; delivery plugin updated as example
- [x] Add structured logging - added `src/logger.ts` with levels, timestamps, context; updated core files (index, client, registry, core plugin)
- [x] RAG query caching - added TTL-based LRU cache for embeddings (5 min TTL, 500 max entries)

### Test Coverage

Current: 292 tests across 15 files. Pure-logic modules tested:
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

## Onboarding & Barrier to Entry

Goal: Turn 4-command setup (`/world create` → `/world init` → `/character create` → `/session enable`) into one button click.

### Phase 1: Guild Join Experience ✓

- [x] Add `guildCreate` event handler in `src/bot/client.ts`
- [x] Create welcome embed with:
  - Quick Start button → triggers guided setup
  - Choose Mode button → preset picker (minimal/sillytavern/tabletop/etc)
  - Documentation link
- [x] Send to system channel on join

### Phase 2: Interactive Setup Command ✓

- [x] Add `/setup` slash command (`src/bot/commands/setup.ts`)
- [x] Implement guided flow:
  - `/setup quick` - Auto-create world, apply sillytavern preset, enable session
  - `/setup guided` - Step-by-step with buttons for each action
  - `/setup status` - Show current setup state
  - `/setup reset` - Reset channel setup
- [x] World auto-named after guild

### Phase 3: Smart First-Mention Handling ✓

- [x] In `src/bot/client.ts`, detect first mention with no setup
- [x] Show setup prompt with:
  - [Quick Setup] button → runs setup flow
  - [Just Chat] button → creates minimal world, enables session
- [x] Track "offered setup" per channel to avoid spamming (10 min cooldown)

### Phase 4: Default to Minimal ✓

- [x] Changed `DEFAULT_CONFIG` in `src/config/defaults.ts`:
  - All subsystems disabled by default (chronicle, scenes, inventory, locations, time, relationships)
  - Only core LLM response working out of the box
- [x] Tests updated for new defaults
- [x] Progressive disclosure suggests features via tips

### Phase 5: Zero-Config Quick Start ✓

- [x] Implement "Just Chat" flow in `src/bot/onboarding.ts`:
  - Auto-create world named `{guild_name}` with minimal config
  - Auto-enable session
  - Responds immediately with tip about `/build character`

### Phase 6: Progressive Disclosure ✓

- [x] Added `src/bot/tips.ts` with milestone-based tips:
  - 10 messages → suggest `/build character` if no character
  - 50 messages → suggest enabling chronicle
  - Keyword triggers for locations, dice, inventory
- [x] Tips shown as subtle footer text (`-# Tip: ...`)
- [x] Add `/tips disable|enable|reset|status` command
- [x] Tips tracked per-channel with 20-message cooldown between tips

### Phase 7: Help & Documentation ✓

- [x] Add `/help` command with:
  - Overview of current setup state
  - Feature status summary
  - Essential and feature commands
- [x] Add `/help <topic>` for deep dives:
  - `start`, `characters`, `worlds`, `memory`, `locations`, `inventory`, `combat`, `config`, `commands`

### Phase 8: Mode Descriptions in Discord ✓

- [x] Rich embeds in mode selection showing:
  - Mode name and description
  - Features enabled
  - Example use cases
- [x] Shown in onboarding flow (`onboarding:choose_mode`)
- [x] Config preset command already has descriptions in choices

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

---

## Backlog

### Image Generation ✓

- [x] Image gen to S3-compatible bucket (R2, S3, MinIO, etc.)
- [x] ComfyUI host abstraction (RunComfy, SaladCloud, RunPod, self-hosted)
- [x] Workflow engine with variable substitution
- [x] /imagine command (prompt, portrait, expression)
- [x] Images plugin with [IMAGE:], [PORTRAIT:], [SCENE:] marker extraction
- [x] ImageConfig in WorldConfig, disabled by default

**Future enhancements:**
- [ ] Expression workflow with Qwen image understanding
- [ ] Custom workflow upload via command
- [ ] Auto-portrait on character creation
- [ ] Scene illustration triggers on location change

### Usage Quotas ✓

Per-user quota system for LLM and image generation. See `docs/design/quotas.md`.

- [x] Add `usage` table to schema with migration
- [x] Create `src/quota/index.ts` (logUsage, checkQuota, enforceQuota)
- [x] Add QuotaConfig to WorldConfig + defaults
- [x] Integrate quota check in core plugin (LLM calls)
- [x] Integrate quota check in images plugin
- [x] Add `/quota status` command

### BYOK (Bring Your Own Key) ✓

Allow users and guilds to provide their own API keys for LLM and image providers.

- [x] Add `api_keys` table with encrypted storage (AES-256-GCM)
- [x] Create `src/ai/keys.ts` (encrypt, decrypt, store, resolve)
- [x] Key resolution: user key → guild key → env var fallback
- [x] Update `src/ai/models.ts` for custom key injection
- [x] Integrate key resolution in LLM middleware
- [x] Update image hosts to use resolved keys
- [x] Add `/keys` command (add, list, remove, test, status)
- [x] Track key_source in usage table
- [x] Permission check (MANAGE_GUILD for server keys)

**Environment:** Set `BYOK_MASTER_KEY` (32-byte hex) to enable.

### Entity Permissions

**Design decisions made:**
- Default: creator-only access (no `$edit`/`$view` = only creator can edit/view)
- Creator always has edit access regardless of `$edit` list
- `$locked` (LLM modification) and `$edit` (user modification) are orthogonal

**Open questions:**
- [ ] Should channel-bound entities inherit permissions from the channel entity?

**Implementation:**
- [ ] `$locked` - prevent LLM tool calls from modifying entity
- [ ] `$locked` prefix on fact - prevent LLM from modifying that specific fact
- [ ] `$edit @everyone` / `$edit user1, user2` - Discord users who can edit
- [ ] `$view @everyone` / `$view user1, user2` - Discord users who can view
- [ ] `/transfer <entity> <user>` - transfer entity ownership

### Architecture Rethink (High Priority)

See `docs/postmortem/2026-01-26-ux-critique.md` for full analysis.

**Core Problem:** Over-engineered scaffolding. SillyTavern works with zero scaffolding. We have 7 formatters adding markdown headers and structure that the LLM doesn't need.

- [ ] Strip prompt scaffolding - remove markdown headers, sections, structure
- [ ] Per-character memory - each character should have their own fact/memory store
- [x] Example dialogue as user/assistant messages (correct, matches SillyTavern)
- [ ] Collapse concepts: world/scene/session/channel → simpler model
- [ ] Command consolidation: 28 commands → ~10 essential
- [ ] Silent failure elimination - always explain why nothing happened
- [ ] Dynamic token allocation - not hardcoded 20-message window

**Refactors:**
- [ ] Character location system - characters should have locations, not just scenes
- [ ] Remove 'active character in channel' concept
- [ ] Add hearing distance / proximity awareness
- [ ] Audit TiTS-style transformation/form functionality

**Features:**
- [ ] Shareable world/character template presets
- [ ] Clone/fork functionality with permissions
- [ ] Zero-command start (mention → "who should I be?" → works)

### Multi-Character Enhancements

- [ ] Known but not speaking - non-responding characters should be included in LLM context with a `<known_entity>` marker so the LLM knows they're present but shouldn't speak for them

### Very Low Priority

- [ ] `[entity:id]` syntax inconsistent - uses bracket syntax while everything else uses `$` sigils (`$if`, `$respond`, `$avatar`)
- [ ] Regex support in `$if` expressions - would need tokenizer extension for `/pattern/` literals; low priority because regex is opaque and hard to read
- [ ] `$emojis` macro - expand to list of custom guild emojis for LLM context; needs macro system or special-case handling

### Plugin Ideas

- [ ] D&D support as plugin
  - 5e SRD integration (monsters, spells, conditions)
  - Character sheets, stat blocks
  - Combat automation with dice plugin
- [ ] CYOA support as plugin
  - Branching narrative tracking
  - Choice points and consequences
  - State persistence for story branches
