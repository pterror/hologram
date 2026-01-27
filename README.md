# Hologram

Discord bot for collaborative worldbuilding and roleplay, built on an entity-facts model.

## Core Concept

Everything is an **entity** with **facts**. Characters, locations, items, even help topics - all entities.

```
Entity: Aria
Facts:
  - is a character
  - has silver hair
  - speaks with a gentle voice
  - $if mentioned: $respond
```

Bind an entity to a channel and it comes alive - responding to messages, maintaining character, and evolving through play.

## Quick Start

1. Create an entity: `/create Aria`
2. Add facts via `/edit Aria`
3. Bind to a channel: `/bind #rp Aria`
4. Start chatting!

## Commands

| Command | Description |
|---------|-------------|
| `/create [name]` | Create entity |
| `/view <entity>` | View entity facts |
| `/edit <entity>` | Edit facts (modal) |
| `/delete <entity>` | Delete entity |
| `/transfer <entity> <user>` | Transfer ownership |
| `/bind <target> <entity>` | Bind channel/user/server to entity |
| `/unbind <target> <entity>` | Remove binding |
| `/status` | Show channel bindings |

**Help is an entity**: `/view help`, `/view help:commands`, `/view help:respond`

## Response Control

Control when entities respond using `$respond` directives and `$if` conditions:

```
$respond                              # Always respond
$respond false                        # Never respond
$if mentioned: $respond               # Respond when @mentioned
$if replied: $respond                 # Respond to replies
$if random() < 0.1: $respond          # 10% chance
$if content.includes("hello"): $respond  # Keyword trigger
$if dt_ms > 30000: $respond           # Rate limit (30s cooldown)
```

### Context Variables

| Variable | Description |
|----------|-------------|
| `mentioned` | Bot was @mentioned |
| `replied` | Message is a reply to bot |
| `is_forward` | Message is forwarded |
| `is_self` | Message from own webhook |
| `content` | Message content |
| `author` | Message author name |
| `dt_ms` | Ms since last response |
| `time.is_night` | Between 6pm-6am |
| `self.*` | Entity's own fact values |

### Functions

| Function | Description |
|----------|-------------|
| `random(n)` | Random int 1-n, or float 0-1 |
| `has_fact(pattern)` | Check if entity has matching fact |
| `roll(dice)` | Roll dice (e.g. "2d6+3") |
| `messages(n, format)` | Last n messages |

## Bindings

Bind entities to Discord channels, users, or servers:

- **Channel binding**: Entity responds in that channel
- **Server binding**: Entity responds in all channels of that server
- **User binding**: User speaks as that entity (persona)

Scope precedence: channel > server > global

## Setup

### 1. Discord Bot

1. Create app at [Discord Developer Portal](https://discord.com/developers/applications)
2. Go to **Bot** tab, click **Reset Token**, copy it
3. Enable **Message Content Intent**
4. Invite with `bot` + `applications.commands` scopes

### 2. LLM API Key

| Provider | Get Key | Env Variable |
|----------|---------|--------------|
| Google AI | [aistudio.google.com](https://aistudio.google.com/apikey) | `GOOGLE_API_KEY` |
| Anthropic | [console.anthropic.com](https://console.anthropic.com/) | `ANTHROPIC_API_KEY` |
| OpenAI | [platform.openai.com](https://platform.openai.com/api-keys) | `OPENAI_API_KEY` |

### 3. Run

```bash
bun install
cp .env.example .env  # Edit with your tokens
bun run dev
```

## Environment Variables

```bash
DISCORD_TOKEN=        # Required
DEFAULT_MODEL=google:gemini-3-flash-preview
GOOGLE_API_KEY=       # For google:* models
ANTHROPIC_API_KEY=    # Optional
OPENAI_API_KEY=       # Optional
LOG_LEVEL=info        # debug, info, warn, error
```

## Development

```bash
bun run dev          # Development with watch
bun run start        # Production
bun run lint         # oxlint
bun run check:types  # TypeScript check
```

## License

MIT
