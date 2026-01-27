# Hologram

Discord bot for collaborative worldbuilding and roleplay, built on an entity-facts model.

## Tech Stack

- **Runtime**: Bun (native SQLite, TypeScript-first)
- **Discord**: Discordeno (Bun-native)
- **LLM**: AI SDK v5 with provider-agnostic `provider:model` spec (default: `google:gemini-3-flash-preview`)
- **Database**: bun:sqlite (7 tables)
- **Linting**: oxlint
- **Type checking**: tsgo

## Project Structure

```
src/
├── index.ts              # Entry point
├── logger.ts             # Logging utilities
├── db/
│   ├── index.ts          # Database setup + schema
│   ├── entities.ts       # Entity/fact CRUD
│   └── discord.ts        # Discord ID mapping + message history
├── ai/
│   ├── models.ts         # Provider abstraction (provider:model spec)
│   ├── embeddings.ts     # Local embeddings (planned)
│   └── handler.ts        # LLM message handler with tool calls
├── logic/
│   └── expr.ts           # $if expression evaluator + $respond control
└── bot/
    ├── client.ts         # Discordeno setup + message handling
    └── commands/
        ├── index.ts      # Command registry + interaction router
        └── commands.ts   # 7 slash commands

docs/
├── README.md             # User documentation
└── archive/              # Old docs from previous architecture
```

## Architecture

### Core Model

Everything is an **entity** with **facts**. No distinction between character/location/item - all entities.

```
Entity: Aria
Facts:
  - is a character
  - has silver hair
  - is in [entity:12]
  - $if mentioned: $respond
```

### Database (7 tables)

```sql
entities         -- id, name, owned_by, created_at
facts            -- id, entity_id, content, created_at, updated_at
discord_entities -- discord_id, discord_type, entity_id, scope_guild_id, scope_channel_id
fact_embeddings  -- (planned) vector search
messages         -- channel_id, user_id, author_name, content, created_at
welcomed_users   -- discord_id, welcomed_at (onboarding DM tracking)
webhook_messages -- message_id, entity_id, entity_name (for reply detection)
```

### Message Pipeline

```
Discord Message
    ↓
Channel Entity Lookup (via discord_entities)
    ↓
Fact Evaluation ($if conditions, $respond directives)
    ↓
LLM Call (system: entity facts, user: recent messages)
    ↓
Tool Calls (add_fact, update_fact, remove_fact)
    ↓
Response
```

### Response Control

Response behavior is controlled via `$respond` directives and `$if` conditionals:

```
$respond                           # Always respond
$respond false                     # Never respond
$if mentioned: $respond            # Respond when @mentioned
$if random() < 0.1: $respond          # 10% chance to respond
$if dt_ms > 30000: $respond        # Rate limit: 30s between responses
```

**Context variables:** `mentioned`, `replied`, `is_forward`, `is_self`, `content`, `author`, `dt_ms`, `elapsed_ms`, `time.is_night`, `self.*`
**Functions:** `random(n)`, `has_fact(pattern)`, `roll(dice)`, `mentioned_in_dialogue(name)`

### Bindings

Discord channels/users map to entities via `discord_entities`:
- **Scope resolution**: channel-scoped > guild-scoped > global
- **Channel binding**: Entity responds in that channel
- **User binding**: User speaks as that entity (persona)

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `/create <type> [name]` | `/c` | Create entity |
| `/view <entity>` | `/v` | View entity facts |
| `/edit <entity>` | `/e` | Edit facts (modal) |
| `/delete <entity>` | `/d` | Delete entity |
| `/bind <target> <entity>` | `/b` | Bind channel/user |
| `/unbind <target> <entity>` | `/ub` | Unbind channel/user |
| `/status` | `/s` | Channel state |

Help is an entity: `/v help`, `/v help:commands`, `/v help:respond`

## Dev Commands

```bash
bun install          # Install dependencies
bun run dev          # Development with watch
bun run start        # Production
bun run lint         # oxlint
bun run check:types  # TypeScript check
```

## Environment Variables

```
DISCORD_TOKEN=       # Required: Discord bot token
DEFAULT_MODEL=       # Default LLM (google:gemini-3-flash-preview)
GOOGLE_API_KEY=      # For Google/Gemini
ANTHROPIC_API_KEY=   # For Anthropic/Claude (optional)
OPENAI_API_KEY=      # For OpenAI (optional)
LOG_LEVEL=           # debug, info (default), warn, error
```

## Logging

Use structured logger from `src/logger.ts`:

```typescript
import { debug, info, warn, error } from "./logger";

debug("Message", { key: "value" });  // Only shown when LOG_LEVEL=debug
info("Message", { key: "value" });
warn("Message", { key: "value" });
error("Message", err, { key: "value" });
```

- **Never use `console.log`** - use the logger functions
- Set `LOG_LEVEL=debug` for verbose output during development
- Context objects are automatically JSON-serialized

## Design Principles

**Everything is an entity.** Characters, locations, items, even help topics.

**Facts are freeform.** No rigid schema. Patterns emerge from conventions.

**Conditions are composable.** Multiple `$if` conditions, all boolean, evaluated in order.

**Dogfooding.** Help system is implemented via entities with facts.

## Core Rules

- **No cutting corners. Ever.** If state needs to persist, use the database. If something needs tracking, track it properly. No "resets on restart is fine" or in-memory shortcuts for persistent data.
- **Note things down immediately:** problems, tech debt, issues → TODO.md
- **Do the work properly.** No undocumented workarounds.

## Negative Constraints

Do not:
- Announce actions ("I will now...") - just do them
- Leave work uncommitted
- Use `--no-verify` - fix the issue or fix the hook
- Assume tools are missing - check if `bun` is available

## Commit Convention

Use conventional commits: `type(scope): message`

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`
