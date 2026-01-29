# Installation

## Prerequisites

- [Bun](https://bun.sh/) runtime
- Discord bot token
- LLM API key (OpenAI, Anthropic, or Google)

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/exo-place/hologram.git
   cd hologram
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your tokens
   ```

4. Initialize database:
   ```bash
   bun run db:init
   ```

5. Start the bot:
   ```bash
   bun run dev
   ```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your Discord bot token |
| `DISCORD_APP_ID` | Discord application ID |
| `LLM_PROVIDER` | Default: `google:gemini-3-flash-preview` |
