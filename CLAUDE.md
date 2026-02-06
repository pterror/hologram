# Hologram

Discord bot for collaborative worldbuilding and roleplay, built on an entity-facts model.

## Tech Stack

- **Runtime**: Bun (native SQLite, TypeScript-first)
- **Discord**: Discordeno (Bun-native)
- **LLM**: AI SDK v6 with provider-agnostic `provider:model` spec (default: `google:gemini-3-flash-preview`)
- **Database**: bun:sqlite (9 tables)
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
│   ├── parsing.ts        # Response parsing (Name prefix), name stripping
│   ├── prompt.ts         # expandEntityRefs(), buildPromptAndMessages()
│   ├── streaming.ts      # handleMessageStreaming(), stream generators
│   ├── template.ts       # Nunjucks template engine, DEFAULT_TEMPLATE, runtime security patches
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
├── playground/           # Interactive playground pages (facts.md, templates.md)
├── .vitepress/
│   ├── config.ts         # VitePress config (sidebar, Vite aliases for playground)
│   ├── theme/            # Custom theme extending default (playground styles)
│   └── playground/       # Playground implementation
│       ├── shims/        # Browser shims (ai-context.ts)
│       ├── languages/    # Monarch tokenizers for Monaco (hologram, hologram-template)
│       ├── presets/      # Preset examples for fact and template playgrounds
│       ├── components/   # Vue components (editors, output, presets)
│       ├── fact-evaluator.ts      # Browser wrapper for evaluateFacts()
│       ├── template-engine.ts     # Browser-compatible Nunjucks renderer
│       └── template-evaluator.ts  # Template context builder for playground
└── archive/              # Old docs from previous architecture

editors/
└── vscode/               # VS Code extension: .holo + .njk syntax highlighting
    ├── README.md
    ├── package.json
    └── syntaxes/
        ├── hologram.tmLanguage.json
        └── hologram-template.tmLanguage.json
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

**Macros:** `{{entity:ID}}` expands to entity name, `{{char}}` expands to current entity name, `{{user}}` expands to literal "user". Any expression works: `{{channel.name}}`, `{{self.health}}`, etc. See `src/ai/prompt.ts` for macro expansion and `docs/reference/` for the full list.

### Database (9 tables)

```sql
entities         -- id, name, owned_by, created_at, template, system_template
facts            -- id, entity_id, content, created_at, updated_at
discord_entities -- discord_id, discord_type, entity_id, scope_guild_id, scope_channel_id
discord_config   -- discord_id, discord_type, config_bind, config_persona, config_blacklist (bind permissions)
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

### Variable Unification

Variables are shared between `$if` expressions and templates. The unification is one-directional: templates receive everything from `ExprContext` plus template-specific additions.

- **Base context** is defined in `createBaseContext()` in `src/logic/expr.ts`. Adding a variable there makes it available to both `$if` expressions and Nunjucks templates automatically.
- **Template-only context** (entities, others, memories, history, char, user, etc.) is added in `src/ai/template.ts` during rendering. These are only available in templates, not `$if` expressions.
- **Fact macros** (`{{entity:ID}}`, `{{char}}`, `{{random:A,B,C}}`, etc.) are expanded in `src/ai/prompt.ts` via string replacement before evaluation — they're a separate mechanism from expression variables.

### Custom Templates

Nunjucks templates override the default system prompt formatting per entity. Implementation in `src/ai/template.ts`.

**Two-layer system prompt:** The LLM receives two distinct system instruction channels:
1. **Dedicated system parameter** — rendered from per-entity system template (or empty default), passed as the AI SDK `system` field.
2. **System-role messages** — system-role entries in the messages array from the main template. Carry entity definitions, memories, and response instructions.

**`send_as` macro:** Templates use `{% call send_as(role) %}...{% endcall %}` to designate message roles. The macro is automatically injected at render time. Unmarked text becomes system-role messages. No `send_as` calls = entire output is a single system message.

**Template inheritance:** `{% extends "entity-name" %}` loads another entity's template as parent. Child templates inherit the `send_as` macro from their root parent. Nunjucks has built-in circular inheritance detection.

**Key behaviors:**
- `null` template (default) = use built-in `DEFAULT_TEMPLATE`
- Entities with different templates get separate LLM calls
- Entities with the same template (including null) share a call
- Limits: 1000 iterations per for-loop, 1MB output
- `{% include %}` — not yet implemented (see TODO.md)

### Bindings

Discord channels/users/servers map to entities via `discord_entities`:
- **Scope resolution**: channel-scoped > guild-scoped > global
- **Channel binding**: Entity responds in that channel
- **Server binding**: Entity responds in all channels of that server
- **User binding**: User speaks as that entity (persona)

Bind permissions are two-layer: entity-side (edit/use permission) + server-side (per-channel/guild allowlists in `discord_config`). See `src/bot/commands/commands.ts` for implementation.

### Access Control

Permission lists are stored as JSON arrays in entity config columns. Role IDs use a `role:` prefix to distinguish from user IDs. Legacy plain snowflakes and usernames still work for permission checks.

- 0 selections on view/edit/use = `"@everyone"` (stored as `JSON.stringify("@everyone")`)
- 0 selections on blacklist = no blacklist (stored as `null`)
- New entities default to owner pre-selected in view and edit

## Commands

| Command | Description |
|---------|-------------|
| `/create [name]` | Create entity |
| `/view <entity>` | View entity facts |
| `/edit <entity>` | Edit facts + memories (modal) |
| `/edit <entity> type:config` | Edit model, context, stream, avatar, memory |
| `/edit <entity> type:System Prompt` | Edit per-entity system prompt template |
| `/edit <entity> type:permissions` | Edit view, edit, use, blacklist |
| `/delete <entity>` | Delete entity |
| `/transfer <entity> <user>` | Transfer ownership |
| `/bind <target> <entity>` | Bind channel/user (requires entity edit/use + location permission) |
| `/unbind <target> <entity>` | Unbind channel/user (same permissions as bind) |
| `/config <scope>` | Configure channel/server bind permissions (Manage Channels) |
| `/debug [status]` | Channel state (default) |
| `/debug prompt [entity]` | Show system prompt for entity |
| `/debug context [entity]` | Show message context for entity |
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
- **Always write tests for new features.** Every new feature, bug fix, or behavior change must include corresponding tests. Tests go in `*.test.ts` files next to the code they test. Run `bun test` to execute.

## Negative Constraints

Do not:
- Announce actions ("I will now...") - just do them
- Use `--no-verify` - fix the issue or fix the hook
- Assume tools are missing - check if `bun` is available
- Use `as any` type assertions or `type Foo = any` aliases - they hide type errors and indicate missing/wrong types. Fix the underlying type issue instead (add proper desiredProperties, use correct property paths like `toggles.nsfw` instead of `nsfw`, etc.). For Discordeno types, use `typeof bot` from `src/bot/client.ts` to get the fully-resolved `Bot<TProps, TBehavior>` without manually threading generics.

## Commits

**ALWAYS COMMIT AFTER EVERY TASK. DO NOT WAIT TO BE ASKED.**

This is non-negotiable. When work is done, commit it immediately. Not committing is a failure mode.

Use conventional commits: `type(scope): message`

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`

Before committing: `bun run lint && bun run check:types` must pass.
