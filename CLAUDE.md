# Hologram

Discord RP bot with smart state/worldstate/memory/context management. SillyTavern-inspired but with proper knowledge graph and RAG.

## Tech Stack

- **Runtime**: Bun
- **Discord**: Discordeno (Bun-native, memory efficient)
- **LLM**: AI SDK with provider-agnostic `provider:model` spec (default: `google:gemini-3-flash-preview`)
- **Database**: bun:sqlite + sqlite-vec for vectors
- **Embeddings**: Local via @huggingface/transformers (MiniLM, 384-dim)

## Project Structure

```
src/
├── index.ts          # Entry point
├── bot/
│   ├── client.ts     # Discordeno setup
│   ├── commands/     # Slash commands
│   └── events/       # Event handlers
├── ai/
│   ├── models.ts     # Provider abstraction
│   ├── embeddings.ts # Local embeddings
│   ├── context.ts    # Context assembly
│   └── extract.ts    # State extraction
├── db/
│   ├── index.ts      # Database setup
│   ├── schema.ts     # Table definitions
│   ├── entities.ts   # Entity CRUD
│   ├── facts.ts      # Facts + embeddings
│   └── vector.ts     # Vector search
├── memory/           # Tiered memory system
└── world/            # World state, inventory, RNG
```

## Key Concepts

### Model Spec Format
`provider:model` e.g. `google:gemini-3-flash-preview`, `anthropic:claude-3-5-sonnet`

### Memory Tiers
1. **Ephemeral**: Recent Discord messages (in-memory)
2. **Session**: Assembled context for current scene
3. **Persistent**: SQLite (entities, relationships, facts, embeddings)

### Data Model
- Shared DB across guilds (supports unified worlds or multi-world with guild mappings)
- Entities: characters, locations, items, concepts
- Relationships: graph edges between entities
- Facts: RAG-searchable memories with importance scores

## Commands

```bash
bun install      # Install dependencies
bun run dev      # Development with watch
bun run start    # Production
bun run lint     # oxlint
bun run check:types  # TypeScript check
bun test         # Run tests
```

## Environment Variables

```
DISCORD_TOKEN=       # Discord bot token
DISCORD_APP_ID=      # Discord application ID
DEFAULT_MODEL=       # Default LLM (google:gemini-3-flash-preview)
GOOGLE_API_KEY=      # For Gemini
ANTHROPIC_API_KEY=   # For Claude (optional)
OPENAI_API_KEY=      # For OpenAI (optional)
```
