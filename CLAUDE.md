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
│   ├── prompt.ts         # expandEntityRefs(), buildPromptAndMessages(), DEFAULT_TEMPLATE
│   ├── streaming.ts      # handleMessageStreaming(), stream generators
│   ├── template.ts       # Nunjucks template engine with runtime security patches
│   ├── tools.ts          # createTools() factory + $locked permission checks
│   └── embeddings.ts     # Local embeddings (planned)
├── logic/
│   ├── expr.ts           # $if expression evaluator + $respond control
│   └── safe-regex.ts     # Regex pattern validator (ReDoS prevention)
└── bot/
    ├── client.ts         # Discordeno setup + message handling
    └── commands/
        ├── index.ts      # Command registry + interaction router
        └── commands.ts   # 7 slash commands

docs/
├── README.md             # User documentation
├── reference/            # Fact patterns, triggers reference
├── guide/                # Migration guides (SillyTavern)
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

**Macros:** `{{entity:ID}}` expands to entity name, `{{char}}` expands to current entity name, `{{user}}` expands to literal "user". Any expression works: `{{channel.name}}`, `{{self.health}}`, etc.

**Convenience macros:** `{{date}}`, `{{time}}`, `{{weekday}}`, `{{isodate}}`, `{{isotime}}`, `{{group}}`, `{{model}}`, `{{maxPrompt}}`, `{{idle_duration}}`, `{{lastMessage}}`, `{{lastUserMessage}}`, `{{lastCharMessage}}`, `{{charIfNotGroup}}`, `{{notChar}}`, `{{groupNotMuted}}`, `{{random: A,B,C}}`, `{{roll: 2d6}}`, `{{newline}}`, `{{space}}`, `{{noop}}`, `{{trim}}`

### Database (8 tables)

```sql
entities         -- id, name, owned_by, created_at, template
facts            -- id, entity_id, content, created_at, updated_at
discord_entities -- discord_id, discord_type, entity_id, scope_guild_id, scope_channel_id
fact_embeddings  -- (planned) vector search
messages         -- channel_id, user_id, author_name, content, discord_message_id, data, created_at
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
LLM Call (system: entity facts, messages: role-based user/assistant history)
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
$if response_ms > 30000: $respond  # Rate limit: 30s between responses
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

**Context variables:** `mentioned`, `replied`, `is_forward`, `is_self`, `content`, `author`, `response_ms`, `retry_ms`, `idle_ms`, `time.is_night`, `self.*`, `channel.*`, `server.*`, `group`, `name`, `chars`

### Custom Templates

Override the default system prompt formatting per entity using custom templates (Nunjucks syntax). Edit via `/edit entity type:Template`. Powered by Nunjucks with runtime security patches.

```
{{ expr }}                           — expression output
{% if expr %}...{% elif expr %}...{% else %}...{% endif %}
{% for var in expr %}...{% else %}...{% endfor %}
{% extends "entity-name" %}          — template inheritance (loads another entity's template)
{% block name %}...{% endblock %}    — named blocks (renders inline, or overrides parent blocks)
{{ value | filter }}                 — pipe filters
{%- tag -%}                          — whitespace control (strip leading/trailing)
{# comment #}
```

**Operators:** `and`, `or`, `not`, `in`, `is`, `~` (concat), `**` (power), `//` (floor div)

**Filters:** `default(val)`, `length`, `join(sep)`, `first`, `last`, `upper`, `lower`, `trim`, `nl2br`, `int`, `float`, `abs`, `round(precision)`, `reverse`, `sort`, `batch(n)`

**Template context variables** (in addition to standard expr context):
- `entities` — array of responding entities `[{id, name, facts}]`
- `others` — array of other entities `[{id, name, facts}]` (facts as `string[]`)
- `memories` — object mapping entity ID to array of memory strings
- `entity_names` — comma-separated names of responding entities
- `freeform` — boolean, true if any entity has `$freeform`
- `history` — array of structured messages `[{author, content, author_id, created_at, is_bot, role, embeds, stickers, attachments}]` (chronological order). `role` is `"assistant"` for entity messages, `"user"` for human messages. `stickers` are `[{id, name, format_type}]` objects.
- `_msg(role, opts?)` — function that emits structured message markers. See "Structured Output Protocol" below.
- `_single_entity` — boolean, true when exactly one entity is responding (used by default template)

**Full prompt control:** When a template uses `_msg()`, its output is parsed into a structured system prompt + message array sent to the LLM. Without `_msg()`, the entire output is the system prompt and only the latest message is sent as user content. The built-in default template uses `_msg()` to produce proper role-based chat messages.

**Structured output protocol (`_msg()`):** Call `_msg(role, opts?)` in templates to emit structured chat messages. `role` must be `"system"`, `"user"`, or `"assistant"`. Optional `opts` can include `{author, author_id}`. Content before the first `_msg()` call becomes the system prompt. Content between calls becomes individual messages.

```
{# System prompt content goes here #}
You are {{ entities[0].name }}.

{# Then emit structured messages #}
{% for msg in history %}
{{ _msg(msg.role, {author: msg.author, author_id: msg.author_id}) }}
{{ msg.author }}: {{ msg.content }}
{% endfor %}
```

**Template inheritance (`{% extends %}`):** Templates can inherit from other entities' templates using `{% extends "entity-name" %}`. The parent template is loaded by looking up the entity by name and reading its template. Override parent blocks with `{% block name %}...{% endblock %}`. Nunjucks has built-in circular inheritance detection.

**Behavior:**
- `null` template (default) = use built-in `DEFAULT_TEMPLATE` (Nunjucks template that replicates standard formatting with `_msg()` structured output)
- Empty submission via `/edit type:template` clears template back to default
- Entities with different templates get separate LLM calls
- Entities with the same template (including null) share a call as before
- Limits: 1000 iterations per for-loop, 1MB output

**Deferred (TODO.md):** `{% include %}`, `{% macro %}`, `{% set %}` — not yet implemented.

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

Stickers are stored as structured objects `{id, name, format_type}` in the message `data` JSON column (`format_type`: 1=PNG, 2=APNG, 3=Lottie, 4=GIF). Legacy DB rows with string-only sticker names are normalized on read via `normalizeStickers()`. Stickers are serialized as `*sent a sticker: name*` and appended to message content for LLM context. A sticker-only message becomes just the sticker text, e.g. `*sent a sticker: catwave*`.

**Functions:** `random(n)`, `has_fact(pattern)`, `roll(dice)`, `mentioned_in_dialogue(name)`, `messages(n, format, filter)`, `duration(ms)`, `date_str(offset?)`, `time_str(offset?)`, `isodate(offset?)`, `isotime(offset?)`, `weekday(offset?)`

The `messages(n, format, filter)` function returns the last N messages (default 1). Format string uses `%a` for author and `%m` for message (default `"%a: %m"`). Filter: `"$user"` for human messages (excludes bots), `"$char"` for entity messages, `"$bot"` for other Discord bot messages, or an author name. The `content` and `author` variables are aliases for `messages(1, "%m")` and `messages(1, "%a")`.

The `roll(dice)` function supports roll20-style syntax: basic (`2d6+3`), keep highest/lowest (`4d6kh3`, `4d6kl1`), drop highest/lowest (`4d6dh1`, `4d6dl1`), exploding (`1d6!`), and success counting (`8d6>=5`).

Date/time functions accept optional offset strings: `"1d"`, `"-1w"`, `"3y2mo"`, `"1h30m"`, `"3 years 2 months"`.

**Safe regex validation:** String methods `.match()`, `.search()`, `.replace()`, `.split()` compile patterns to RegExp. All patterns are validated at compile time by `src/logic/safe-regex.ts` — capturing groups, nested quantifiers, backreferences, and lookahead/behind are rejected to prevent ReDoS. Patterns must be string literals (no dynamic patterns). See `docs/reference/safe-regex.md`.

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
$blacklist 123456789012345678      # Block by Discord ID or role ID
$blacklist alice, 123456789, bob   # Mixed usernames and IDs
$edit @everyone                    # Anyone can edit
$edit alice, 123456789             # Specific users (username, user ID, or role ID)
$view @everyone                    # Anyone can view
$view alice, bob                   # Specific users only
$use @everyone                     # Anyone can trigger responses
$use alice, 123456789              # Restrict who can trigger
```

**Behavior:**
- Blacklist blocks view, edit, and entity responses in chat
- Blacklist overrides whitelist (deny wins)
- Owner is never blocked by blacklist
- All permission directives accept usernames, Discord user IDs, and role IDs
- Default: edit=owner-only, view=owner-only, use=everyone, blacklist=empty

## Commands

| Command | Description |
|---------|-------------|
| `/create [name]` | Create entity |
| `/view <entity>` | View entity facts |
| `/edit <entity>` | Edit facts + memories (modal) |
| `/delete <entity>` | Delete entity |
| `/transfer <entity> <user>` | Transfer ownership |
| `/bind <target> <entity>` | Bind channel/user |
| `/unbind <target> <entity>` | Unbind channel/user |
| `/debug [status]` | Channel state (default) |
| `/debug prompt [entity]` | Show system prompt for entity |
| `/debug history [entity]` | Show message history for entity |
| `/trigger <entity>` | Manually trigger entity response |
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
GOOGLE_GENERATIVE_AI_API_KEY=  # For google:* models
ANTHROPIC_API_KEY=             # For anthropic:* models (optional)
OPENAI_API_KEY=                # For openai:* models (optional)
# + 14 more providers, each with standard env var (see .env.example)
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
