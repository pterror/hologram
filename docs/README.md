# Hologram

A Discord bot for collaborative worldbuilding and roleplay, built on a simple but powerful entity-facts model.

## Core Concept

Everything in Hologram is an **entity** with **facts**. Characters, locations, items, worlds - all entities. Facts are statements attached to entities that describe them.

```
Entity: Aria
Facts:
  - is a character
  - has silver hair
  - carries a worn leather journal
  - is in [entity:12] (The Tavern)
```

No rigid schemas. No predefined categories. Just entities and their facts.

## Quick Start

1. **Create a character**: `/create character Aria`
2. **Add facts**: `/edit Aria` → Add facts like "is friendly", "works as a bartender"
3. **Bind to channel**: `/bind channel Aria` → Aria now responds in this channel
4. **Chat**: Just talk - Aria responds based on her facts

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `/create <type> [name]` | `/c` | Create entity (character, location, item) |
| `/view <entity>` | `/v` | View entity and its facts |
| `/edit <entity>` | `/e` | Edit entity facts |
| `/delete <entity>` | `/d` | Delete entity (owner only) |
| `/bind <target> <entity>` | `/b` | Bind channel/user to entity |
| `/status` | `/s` | View current channel state |

**Help is an entity**: `/v help`, `/v help:commands`, `/v help:triggers`, etc.

### Type Shortcuts

When creating entities, you can use shortcuts:
- `c`, `char`, `character` → character
- `l`, `loc`, `location` → location
- `i`, `item` → item

Example: `/c c Aria` creates a character named Aria.

## Triggers

Triggers control when and how the bot responds. Configure them as facts on channel entities.

### Trigger Format

```
trigger: <condition> -> <action>
```

### Conditions

| Condition | Description | Example |
|-----------|-------------|---------|
| `mention` | Bot is @mentioned | `trigger: mention -> respond` |
| `pattern "<regex>"` | Message matches pattern | `trigger: pattern "hello\|hi" -> respond` |
| `random <0.0-1.0>` | Random chance | `trigger: random 0.1 -> respond` |
| `llm` | LLM decides if response fits | `trigger: llm -> respond` |
| `llm <model>` | LLM decides using specific model | `trigger: llm google:gemini-2.5-flash -> respond` |
| `always` | Always trigger | `trigger: always -> respond` |

### Actions

| Action | Description |
|--------|-------------|
| `respond` | Generate and send a response |
| `narrate` | System narration (planned) |

### Configuration Facts

| Fact | Description | Default |
|------|-------------|---------|
| `delay_ms: <number>` | Wait before evaluating triggers | 0 |
| `throttle_ms: <number>` | Minimum time between responses | 0 |
| `llm_decide_model: <model>` | Model for LLM trigger decisions | gemini-2.5-flash-lite |

### Examples

**Respond only to mentions:**
```
trigger: mention -> respond
```

**Respond to mentions OR 10% of messages:**
```
trigger: mention -> respond
trigger: random 0.1 -> respond
```

**Let LLM decide, with 5 second delay to batch messages:**
```
trigger: llm -> respond
delay_ms: 5000
```

**Respond to specific keywords:**
```
trigger: pattern "help|question|how do" -> respond
```

**Rate limited responses:**
```
trigger: mention -> respond
throttle_ms: 30000
```

## Bindings

Bindings connect Discord channels and users to entities.

### Channel Binding

```
/bind channel <entity>
```

When a channel is bound to an entity (usually a character), that entity:
- Receives messages from the channel
- Responds based on its facts and triggers

### User Binding (Personas)

```
/bind me <entity>
```

Bind yourself to an entity to speak as that character. Your messages appear with that entity's context.

### Binding Scope

Bindings can have different scopes:
- **Channel**: Only in this channel
- **Guild**: Across the server
- **Global**: Everywhere

```
/bind channel Aria scope:channel    # This channel only
/bind me Traveler scope:guild       # This server
/bind me Narrator scope:global      # Everywhere
```

## Facts

Facts are freeform text attached to entities. The system interprets certain patterns:

### Special Fact Patterns

| Pattern | Meaning |
|---------|---------|
| `is a <type>` | Entity type (character, location, item) |
| `is in [entity:<id>]` | Containment (location) |
| `trigger: ...` | Response trigger |
| `delay_ms: <n>` | Response delay |
| `throttle_ms: <n>` | Response throttle |

### Best Practices

- Use present tense: "is friendly" not "was friendly"
- Be specific: "has a scar above left eye" not "has scars"
- Include personality: "speaks formally", "tends to ramble"
- Note relationships: "distrusts strangers", "loyal to the guild"

## Architecture

```
Discord Message
    ↓
Channel Entity Lookup
    ↓
Trigger Evaluation (mention? pattern? random? llm?)
    ↓
LLM Call (system: entity facts, user: recent messages)
    ↓
Tool Calls (add/update/remove facts)
    ↓
Response
```

### Data Model

```
entities
├── id
├── name
└── created_by

facts
├── id
├── entity_id
└── content

discord_entities
├── discord_id
├── discord_type (user/channel)
├── entity_id
├── scope_guild_id
└── scope_channel_id

messages
├── channel_id
├── user_id
├── author_name
└── content
```

## Model Configuration

Default model: `google:gemini-3-flash-preview`

Models use `provider:model` format:
- `google:gemini-3-flash-preview`
- `google:gemini-2.5-flash-lite-preview-06-2025`
- `anthropic:claude-sonnet-4-20250514`
- `openai:gpt-4o`

## Environment Variables

```bash
DISCORD_TOKEN=        # Required: Discord bot token
DEFAULT_MODEL=        # Default LLM model
GOOGLE_API_KEY=       # For Google/Gemini models
ANTHROPIC_API_KEY=    # For Anthropic/Claude models
OPENAI_API_KEY=       # For OpenAI models
```
