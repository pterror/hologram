# Hologram

Discord RP bot with smart state/worldstate/memory/context management.

Inspired by SillyTavern but with proper knowledge graph, RAG, and tiered memory systems for sophisticated context assembly.

## Features

- **Freeform character system** - Not locked to CCv2 spec
- **World state** - Location, time, weather tracking
- **Inventory** - Items with consistent descriptions and stats
- **Knowledge graph** - Entities and relationships in SQLite
- **RAG** - Semantic search over memories via sqlite-vec
- **Tiered memory** - Ephemeral → Session → Persistent
- **Context assembly** - Smart selection of what fits in the LLM window
- **Multi-provider LLM** - AI SDK with `provider:model` spec

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your tokens

# Run in development
bun run dev
```

## Environment Variables

```
DISCORD_TOKEN=       # Discord bot token
DISCORD_APP_ID=      # Discord application ID
DEFAULT_MODEL=       # Default LLM (google:gemini-3-flash-preview)
GOOGLE_API_KEY=      # For Gemini
```

## Tech Stack

- **Runtime**: Bun
- **Discord**: Discordeno
- **LLM**: AI SDK (Google, Anthropic, OpenAI)
- **Database**: bun:sqlite + sqlite-vec
- **Embeddings**: Local via @huggingface/transformers

## Development

```bash
bun run dev          # Development with watch
bun run lint         # Run oxlint
bun run check:types  # TypeScript check
bun test             # Run tests
```

## License

MIT
