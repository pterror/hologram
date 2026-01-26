# Hologram

Discord RP bot with smart state/worldstate/memory/context management. SillyTavern-inspired with knowledge graph, perspective-aware memory, and configurable world simulation.

## Tech Stack

- **Runtime**: Bun (native SQLite, TypeScript-first)
- **Discord**: Discordeno (Bun-native, zero-cache default)
- **LLM**: AI SDK with provider-agnostic `provider:model` spec (default: `google:gemini-3-flash-preview`)
- **Database**: bun:sqlite + sqlite-vec for vectors (28 tables: 26 regular + 2 virtual)
- **Embeddings**: Local via @huggingface/transformers (MiniLM, 384-dim)
- **Linting**: oxlint
- **Testing**: bun:test (292 tests across 15 files)

## Project Structure

```
src/
├── index.ts                    # Entry point
├── plugins/                    # Plugin system (middleware-based message handling)
│   ├── types.ts                # Plugin, Middleware, Extractor, Formatter interfaces
│   ├── registry.ts             # Plugin registration + middleware chain
│   ├── handler.ts              # Message handler entry point
│   ├── index.ts                # Loads built-in plugins + defines modes
│   ├── core/index.ts           # History, gate, context assembly, LLM, extraction
│   ├── scene/index.ts          # Scene loading, state formatting
│   ├── character/index.ts      # Persona + relationships formatters
│   ├── identity/index.ts       # Proxy + persona middleware
│   ├── chronicle/index.ts      # Memory extraction + RAG formatter
│   ├── time/index.ts           # Realtime sync + random events
│   ├── inventory/index.ts      # Inventory formatter + extractor
│   ├── world/index.ts          # World rules + lore formatters
│   └── delivery/index.ts       # Multi-char response parsing
├── bot/
│   ├── client.ts               # Discordeno setup, event wiring, guild join handler
│   ├── webhooks.ts             # Per-character webhook impersonation
│   ├── onboarding.ts           # Guild welcome, quick setup, mode selection
│   ├── tips.ts                 # Progressive disclosure system
│   └── commands/               # 21 slash commands
│       ├── index.ts            # Command registry + interaction router
│       ├── build.ts            # /build - LLM-assisted wizard (character/world/location/item)
│       ├── character.ts        # /character create|edit|list|delete|view
│       ├── chronicle.ts        # /chronicle recall|history|add|forget
│       ├── combat.ts           # /combat start|join|leave|next|end|status
│       ├── config.ts           # /config show|set|preset|reset (interactive wizard)
│       ├── faction.ts          # /faction list|info|join|leave|standing
│       ├── help.ts             # /help [topic] - in-Discord documentation
│       ├── location.ts         # /location go|look|create|connect|map
│       ├── memory.ts           # /memory add|search|forget (legacy facts)
│       ├── persona.ts          # /persona set|show|clear
│       ├── proxy.ts            # /proxy list|add|remove|set
│       ├── relationship.ts     # /relationship show|set|list|affinity
│       ├── roll.ts             # /roll + /r (dice expressions)
│       ├── scene.ts            # /scene start|pause|resume|end|status|list
│       ├── session.ts          # /session enable|disable|model|character
│       ├── setup.ts            # /setup quick|guided|status|reset
│       ├── status.ts           # /status (character state, effects, form)
│       ├── time.ts             # /time show|advance|set|dawn|noon|dusk|night
│       ├── tips.ts             # /tips enable|disable|status|reset
│       └── world.ts            # /world create|edit|info|link
├── ai/
│   ├── models.ts               # Provider abstraction (provider:model spec)
│   ├── embeddings.ts           # Local embeddings via @huggingface/transformers
│   ├── context.ts              # Context assembly (perspective-aware, budget-managed)
│   ├── budget.ts               # Token budget allocation with priority sections
│   ├── extract.ts              # State/fact extraction prompts
│   ├── extraction-pipeline.ts  # Post-response extraction (chronicle, state, effects)
│   └── debug.ts                # Context debug formatting
├── chronicle/
│   └── index.ts                # Perspective-aware memory (query, search, store, embed)
├── combat/
│   └── index.ts                # Turn-based combat (initiative, HP, AC, conditions)
├── config/
│   ├── types.ts                # WorldConfig + all subsystem config interfaces
│   ├── defaults.ts             # DEFAULT_CONFIG, mergeConfig(), presets
│   └── index.ts                # Config CRUD (get/set per world)
├── db/
│   ├── index.ts                # Database setup + initialization
│   ├── schema.ts               # 26 tables + 2 virtual tables + migrations
│   ├── entities.ts             # Entity CRUD (characters, locations, items, concepts)
│   ├── facts.ts                # Legacy facts + embeddings
│   ├── relationships.ts        # Relationship CRUD with affinity
│   └── vector.ts               # VectorDatabase (sqlite-vec wrapper)
├── dice/
│   └── index.ts                # Dice parser (NdM+X, kh/kl, exploding, reroll, pools)
├── events/
│   ├── scheduler.ts            # Background event scheduler (time-based + random)
│   ├── random.ts               # Random event table evaluation
│   └── behavior.ts             # NPC behavior state machine transitions
├── factions/
│   └── index.ts                # Faction membership + standing
├── memory/
│   ├── tiers.ts                # Tiered memory manager
│   ├── graph.ts                # Knowledge graph queries
│   ├── rag.ts                  # RAG retrieval (embed query → KNN → facts/chronicle)
│   └── consolidate.ts          # Memory consolidation/summarization
├── personas/
│   └── index.ts                # User persona management + context formatting
├── proxies/
│   └── index.ts                # PluralKit-style message proxying (prefix/suffix/bracket)
├── relationships/
│   └── index.ts                # Affinity labels, relationship formatting
├── scene/
│   └── index.ts                # Scene lifecycle (create, pause, resume, end)
├── state/
│   └── index.ts                # Character state (attributes, body, outfit, effects, equipment)
├── wizards/
│   └── index.ts                # Multi-step wizard session management
└── world/
    ├── state.ts                # World state management
    ├── inventory.ts            # Inventory system (items, equipment, capacity)
    ├── locations.ts            # Location graph (hierarchy, connections, properties)
    ├── time.ts                 # Time system (calendar, day/night, periods, formatting)
    └── rng.ts                  # Seeded RNG for consistency

test/
└── setup.ts                    # Test preload: mocks @huggingface/transformers (native deps)
bunfig.toml                     # [test] preload for native module mocking
```

## Architecture

### Plugin System (`src/plugins/`)

The message pipeline is middleware-based. Plugins register middleware, extractors, and formatters.

```
Discord message → createContext() → runMiddleware() → getDeliveryResult()

Middleware chain (sorted by priority):
  identity:proxy     [100]  → rewrite user identity (proxy/persona)
  core:history       [150]  → load message history
  scene:load         [200]  → load scene + config
  time:sync          [300]  → realtime sync + narration
  time:events        [400]  → random events
  core:context       [800]  → run formatters → build system prompt
  core:llm           [900]  → call LLM
  core:extraction    [1000] → fire extractors (async)
  delivery:prepare   [1100] → parse multi-char response
```

### Modes (Plugin Presets)

Modes define which plugins are active and their config:

| Mode | Description |
|------|-------------|
| `minimal` | Simple chat, no mechanics |
| `sillytavern` | Character chat + memory |
| `mud` | Locations + inventory + exploration |
| `survival` | Hunger/thirst/stamina + random events |
| `tits` | Adult adventure + transformation |
| `tabletop` | Dice + combat + turn-based |
| `parser` | Classic text adventure (strict commands) |
| `full` | Everything enabled |

### Database (26 tables + 2 virtual)

**Core**: worlds, guild_worlds, entities, relationships, facts
**Scenes**: scenes, scene_characters
**Memory**: chronicle, fact_embeddings (vec0), chronicle_embeddings (vec0)
**Characters**: character_state, character_effects, character_equipment, character_webhooks
**Combat**: combats, combat_participants, combat_log
**Social**: faction_members, user_personas, user_proxies
**Events**: scheduled_events, random_event_tables, random_event_entries
**Behavior**: behavior_tracks, behavior_states, behavior_transitions, character_behaviors
**Wizard**: wizard_sessions

### Configuration System (`src/config/types.ts`)

All features are optional. `WorldConfig` has 9 subsystem configs:
- `chronicle` - Perspective-aware memory extraction
- `scenes` - Scene lifecycle and boundaries
- `inventory` - Items, equipment, capacity, durability
- `locations` - Hierarchy, connections, properties, travel time
- `time` - Calendar, day/night, realtime sync, random events
- `characterState` - Attributes, body/form, effects
- `dice` - Dice syntax, combat integration
- `relationships` - Affinity, factions, relationship types
- `context` - Token budget, history depth, RAG results, timestamps

Presets match modes: `minimal`, `sillytavern`, `mud`, `survival`, `tits`, `tabletop`, `parser`, `full`

### Key Concepts

- **Model spec**: `provider:model` e.g. `google:gemini-3-flash-preview`
- **Perspective**: Chronicle entries filtered by who witnessed them (public/character/secret)
- **Scenes**: Persistent play sessions with location, time, weather, participants
- **Chronicle**: Perspective-aware memory with auto-extraction, explicit markers, and periodic summaries
- **Webhook impersonation**: Each AI character gets their own Discord identity via webhooks
- **Proxy system**: Users send as different characters via prefix/suffix/bracket syntax
- **Behavior tracks**: NPC state machines with weighted transitions and conditions
- **Onboarding**: Guild join welcome → Quick Setup button → world + session auto-created
- **Progressive disclosure**: Tips suggest features based on usage milestones (10/50/100 messages)

### Memory Tiers
1. **Ephemeral**: Recent Discord messages (configurable window)
2. **Session**: Active scene state (location, time, participants, effects)
3. **Persistent**: SQLite (entities, relationships, chronicle with embeddings)

## Dev Commands

```bash
bun install          # Install dependencies
bun run dev          # Development with watch
bun run start        # Production
bun run lint         # oxlint
bun run check:types  # TypeScript check (tsgo --noEmit, ~10x faster)
bun test             # Run tests (292 tests, 15 files)
```

## Environment Variables

```
DISCORD_TOKEN=       # Discord bot token
DISCORD_APP_ID=      # Discord application ID
DEFAULT_MODEL=       # Default LLM (google:gemini-3-flash-preview)
GOOGLE_API_KEY=      # For Gemini
ANTHROPIC_API_KEY=   # For Claude (optional)
OPENAI_API_KEY=      # For OpenAI (optional)
BYOK_MASTER_KEY=     # 32-byte hex key for BYOK encryption (optional, generate with: openssl rand -hex 32)
```

## BYOK (Bring Your Own Key)

Users and guilds can provide their own API keys for LLM and image providers. Keys are encrypted at rest with AES-256-GCM.

**Resolution order:** user key → guild key → environment variable

**Commands:** `/keys add|list|remove|test|status`

**Supported providers:** Google, Anthropic, OpenAI (LLM) + RunComfy, SaladCloud, RunPod (images)

## Testing

- Tests use `bun:test` with preload (`bunfig.toml` → `test/setup.ts`)
- `test/setup.ts` mocks `@huggingface/transformers` to avoid native deps (sharp, onnxruntime-node) in Nix sandbox
- Pure logic tests only (no DB, no Discord) — parsers, formatters, math, config merging
- Test files live alongside source: `src/module/index.test.ts`

## Core Rules

- **Note things down immediately:** problems, tech debt, or issues spotted MUST be added to TODO.md backlog
- **Do the work properly.** Don't leave workarounds or hacks undocumented.

## Negative Constraints

Do not:
- Announce actions ("I will now...") - just do them
- Leave work uncommitted
- Use `--no-verify` - fix the issue or fix the hook
- Assume tools are missing - check if `bun` is available in the environment

## Design Principles

**Everything optional.** Each subsystem can be disabled entirely. Graceful degradation.

**Unify, don't multiply.** One interface for multiple cases > separate interfaces.

**Simplicity over cleverness.** Plain objects > class hierarchies. Built-in APIs > extra dependencies. Functions > abstractions until you need the abstraction.

**Explicit over implicit.** Log when skipping. Show what's at stake before refusing.

**Freeform over rigid.** Body traits, effects, attributes are arbitrary strings/values. No rigid CCv2 schema.

## Commit Convention

Use conventional commits: `type(scope): message`

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`

Scope is optional but recommended.
