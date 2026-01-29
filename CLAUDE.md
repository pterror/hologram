# Hologram

Discord bot for collaborative worldbuilding and roleplay, built on an entity-facts model.

## Tech Stack

- **Runtime**: Bun (native SQLite, TypeScript-first)
- **Discord**: Discordeno (Bun-native)
- **LLM**: AI SDK v6 with provider-agnostic `provider:model` spec (default: `google:gemini-3-flash-preview`)
- **Database**: bun:sqlite (8 tables)
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
│   ├── context.ts        # EvaluatedEntity, MessageContext, formatting utils
│   ├── handler.ts        # handleMessage() + re-exports
│   ├── parsing.ts        # Response parsing (XML + Name prefix), name stripping
│   ├── prompt.ts         # expandEntityRefs(), buildSystemPrompt()
│   ├── streaming.ts      # handleMessageStreaming(), stream generators
│   ├── tools.ts          # createTools() factory + $locked permission checks
│   └── embeddings.ts     # Local embeddings (planned)
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
  - is in {{entity:12}}
  - $if mentioned: $respond
```

**Macros:** `{{entity:ID}}` expands to entity name, `{{char}}` expands to current entity name, `{{user}}` expands to literal "user".

### Database (8 tables)

```sql
entities         -- id, name, owned_by, created_at
facts            -- id, entity_id, content, created_at, updated_at
discord_entities -- discord_id, discord_type, entity_id, scope_guild_id, scope_channel_id
fact_embeddings  -- (planned) vector search
messages         -- channel_id, user_id, author_name, content, discord_message_id, created_at
welcomed_users   -- discord_id, welcomed_at (onboarding DM tracking)
webhook_messages -- message_id, entity_id, entity_name (for reply detection)
eval_errors      -- entity_id, owner_id, error_message, condition (deduped error notifications)
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

Response behavior is controlled via `$respond` directives and `$if` conditionals. Expressions are JavaScript (strings need quotes):

```
$respond                           # Always respond
$respond false                     # Never respond
$if mentioned: $respond            # Respond when @mentioned
$if random() < 0.1: $respond       # 10% chance to respond
$if dt_ms > 30000: $respond        # Rate limit: 30s between responses
$if content.includes("hello"): $respond  # String matching (note quotes)
$if messages(10).includes("help"): $respond  # Check last 10 messages
```

### Streaming

Streaming sends LLM responses progressively as they're generated:

```
$stream                            # New message per newline, sent complete
$stream full                       # Single message, edited progressively
$stream "kitten:"                  # New message per custom delimiter, sent complete
$stream "---" "***"               # Split on any of multiple delimiters
$stream full "\n"                  # New message per line, each edited progressively
$stream full "---"                 # New message per delimiter, each edited progressively
$if mentioned: $stream             # Conditional streaming
```

**Modes:**
- Default: Each completed chunk (split by delimiter) becomes a new Discord message
- `full` (no delimiter): One message, continuously edited with accumulated content
- `full` (with delimiter): New message per chunk, each edited progressively as it streams

**Custom delimiters:** Use `$stream "delimiter"` to split on custom text instead of newlines. Multiple delimiters can be specified: `$stream "a" "b" "c"` splits on any of them. E.g., `$stream "kitten:"` sends a new message each time the LLM outputs "kitten:".

**Name: prefix handling:** When an LLM response includes `EntityName:` prefixes at line starts, they are stripped. For single entities in streaming mode, each `Name:` prefix creates a message boundary (separate Discord messages). For non-streaming single entities, all prefixes are stripped into one message.

**Multi-character streaming:** When streaming with multiple characters bound to a channel, the system uses XML tag parsing (`<CharName>...</CharName>`) as the primary format (matching the system prompt). Falls back to `Name:` prefix detection at line starts if the LLM doesn't use XML tags.

### Model Selection

Override the default LLM model per entity using `$model`:

```
$model google:gemini-2.0-flash      # Use specific model
$model anthropic:claude-3-5-sonnet  # Use Anthropic model
$if mentioned: $model openai:gpt-4o # Conditional model selection
```

**Format:** `provider:model` (same as `DEFAULT_MODEL` env var). Last `$model` directive wins.

**Allowlist:** Set `ALLOWED_MODELS` env var to restrict which models entities can use:
```
ALLOWED_MODELS=google:*,anthropic:claude-3-5-sonnet  # Allow all Google + specific Anthropic
```
Comma-separated. Supports `provider:*` wildcards. If unset, all models are allowed. Blocked models trigger a DM to entity editors.

**Error handling:** LLM errors with custom models are reported via DM to entity owner and editors.

### Freeform Multi-Character

By default, when multiple entities are bound to a channel, responses are split using XML tags (`<Name>...</Name>`, with `Name:` prefix format as fallback). Use `$freeform` to allow natural prose responses without structured formatting:

```
$freeform                          # Enable freeform multi-char responses
$if mentioned: $freeform           # Conditional freeform
```

With `$freeform`, the LLM can write naturally with multiple characters interacting in the same response. The response is sent as a single message (using the first entity's webhook identity) rather than being split per character.

**Context variables:** `mentioned`, `replied`, `is_forward`, `is_self`, `content`, `author`, `dt_ms`, `elapsed_ms`, `time.is_night`, `self.*`

### Context Window

Control how much message history is included in LLM context:

```
$context 16k                       # 16,000 characters of history (default)
$context 8000                      # 8,000 characters
$context 1000k                     # 1,000,000 characters (hard cap)
$if mentioned: $context 32k        # Conditional context size
```

Default is 16k characters. Supports `k` suffix (e.g., `16k` = 16,000). Hard cap is 1M.

### Message Preprocessing

Strip specified strings from message history before sending to LLM using `$strip`:

```
$strip "</blockquote>"             # Strip this pattern from context
$strip "</blockquote>" "<br>"      # Strip multiple patterns
$strip                             # Explicitly disable stripping (even on default models)
$if mentioned: $strip "</blockquote>"  # Conditional stripping
```

**Default behavior:** When no `$strip` directive is present, `</blockquote>` is automatically stripped for `gemini-2.5-flash-preview` models only. All other models default to no stripping. Use bare `$strip` to explicitly disable this default.

Supports escape sequences in patterns: `\n`, `\t`, `\\`.

Other preprocessing:
- **Sticker serialization:** Stickers become `*sent a sticker: name*` appended to message content

### Stickers

Stickers are serialized as `*sent a sticker: name*` and appended to message content. A sticker-only message becomes just the sticker text, e.g. `*sent a sticker: catwave*`.

**Functions:** `random(n)`, `has_fact(pattern)`, `roll(dice)`, `mentioned_in_dialogue(name)`, `messages(n, format)`

The `messages(n, format)` function returns the last N messages (default 1). Format string uses `%a` for author and `%m` for message (default `"%a: %m"`). The `content` and `author` variables are aliases for `messages(1, "%m")` and `messages(1, "%a")`.

### Bindings

Discord channels/users/servers map to entities via `discord_entities`:
- **Scope resolution**: channel-scoped > guild-scoped > global
- **Channel binding**: Entity responds in that channel
- **Server binding**: Entity responds in all channels of that server
- **User binding**: User speaks as that entity (persona)

### Access Control

Control who can interact with entities using permission directives:

```
$blacklist alice                   # Block username from all interactions
$blacklist 123456789012345678      # Block by Discord ID
$blacklist alice, 123456789, bob   # Mixed usernames and IDs
$edit @everyone                    # Anyone can edit
$edit alice, 123456789             # Specific users (username or ID)
$view @everyone                    # Anyone can view
$view alice, bob                   # Specific users only
```

**Behavior:**
- Blacklist blocks view, edit, and entity responses in chat
- Blacklist overrides whitelist (deny wins)
- Owner is never blocked by blacklist
- Default: edit=owner-only, view=everyone, blacklist=empty

## Commands

| Command | Description |
|---------|-------------|
| `/create [name]` | Create entity |
| `/view <entity>` | View entity facts |
| `/edit <entity>` | Edit facts (modal) |
| `/delete <entity>` | Delete entity |
| `/transfer <entity> <user>` | Transfer ownership |
| `/bind <target> <entity>` | Bind channel/user |
| `/unbind <target> <entity>` | Unbind channel/user |
| `/info [status]` | Channel state (default) |
| `/info prompt [entity]` | Show system prompt for entity |
| `/info history [entity]` | Show message history for entity |
| `/forget` | Exclude messages before now from context |

Help is an entity: `/view help`, `/view help:commands`, `/view help:respond`

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
ALLOWED_MODELS=      # Comma-separated allowlist for $model (e.g. "google:*,anthropic:*")
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
- **Never reimplement.** If logic exists elsewhere, import and use it. No local copies of functions, no "simplified versions for this use case." Find the canonical implementation and make it work.
- **Note things down immediately:** problems, tech debt, issues → TODO.md. If you see ANY issue while working - inconsistency, bug, missing feature, tech debt - add it to TODO.md before you forget.
- **Do the work properly.** No undocumented workarounds. No copouts like "this is out of date, leaving it" - fix it or flag it.
- **Update docs after every task.** Keep `docs/`, `README.md`, and `CLAUDE.md` in sync with code changes. Outdated docs are bugs.

## Negative Constraints

Do not:
- Announce actions ("I will now...") - just do them
- Use `--no-verify` - fix the issue or fix the hook
- Assume tools are missing - check if `bun` is available

## Commits

**ALWAYS COMMIT AFTER EVERY TASK. DO NOT WAIT TO BE ASKED.**

This is non-negotiable. When work is done, commit it immediately. Not committing is a failure mode.

Use conventional commits: `type(scope): message`

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`

Before committing: `bun run lint && bun run check:types` must pass.
