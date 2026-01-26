# Export

Export your characters, worlds, and memories for backup or use with other tools like SillyTavern.

## Quick Start

```
/export character "Alice"              # Export a character
/export character "Alice" format:ccv2  # Export as SillyTavern card
/export world                          # Export entire world
/export chronicle                      # Export memories as JSONL
```

## Commands

| Command | Description |
|---------|-------------|
| `/export character <name>` | Export a character in various formats |
| `/export world` | Export the current world with all entities |
| `/export chronicle` | Export chronicle/memories as JSONL |

## Character Export

Export individual characters in different formats for backup or import into other tools.

### Formats

| Format | Description | Use Case |
|--------|-------------|----------|
| `hologram` | Native Hologram format | Full backup with all data |
| `ccv2` | Character Card V2 | SillyTavern, other tools |
| `ccv2-extended` | CCv2 with Hologram extensions | SillyTavern + re-import to Hologram |

### CCv2 Compliance Levels

When exporting as `ccv2`, you can choose how strictly to follow the spec:

| Level | Description |
|-------|-------------|
| `strict` | Only spec-defined fields (maximum compatibility) |
| `lenient` | Includes common extensions like avatar_uri |
| `extended` | Full Hologram data in namespaced extensions |

### Examples

```
# Default format (Hologram native)
/export character "Alice"

# SillyTavern-compatible
/export character "Alice" format:ccv2

# CCv2 with strict spec compliance
/export character "Alice" format:ccv2 compliance:strict

# CCv2 with full Hologram data preserved
/export character "Alice" format:ccv2-extended
```

## World Export

Export an entire world including all characters, locations, items, and relationships.

### Options

| Option | Description |
|--------|-------------|
| `include_chronicle` | Include memory/chronicle entries |
| `include_facts` | Include legacy facts |

### Examples

```
# Basic world export
/export world

# Include memories
/export world include_chronicle:true

# Full export with everything
/export world include_chronicle:true include_facts:true
```

## Chronicle Export

Export chronicle entries (memories) as JSONL for analysis or backup.

### Options

| Option | Description |
|--------|-------------|
| `scene_id` | Filter to a specific scene |

### Examples

```
# All chronicle entries
/export chronicle

# Only entries from scene 42
/export chronicle scene_id:42
```

### JSONL Format

Each line is a JSON object:
```json
{"id": 1, "type": "event", "content": "Alice met Bob", "importance": 7, ...}
{"id": 2, "type": "dialogue", "content": "They discussed the plan", ...}
```

## Permissions

Export access is based on ownership and roles:

| Role | Can Export |
|------|------------|
| Creator | Always (your own creations) |
| Owner | Everything in the world |
| Admin | Everything in the world |
| Editor | Only their own creations |
| Member | Only their own creations |
| Viewer | Nothing |

### How Ownership Works

- **Characters** - Tracked by creator (who made them)
- **Worlds** - Tracked by creator + guild roles
- **Multi-world entities** - Exportable if you have access via any world

## Output

### With S3 Storage (Recommended)

If the bot has S3 storage configured, you get a download link:
```
Exported Alice (ccv2):
https://exports.example.com/exports/2024/01/15/abc123-Alice.json

File size: 4.2 KB
```

Links are public and permanent.

### Without S3 Storage

Data is embedded directly in Discord (may be truncated for large exports):
```
Exported Alice (hologram):
```json
{
  "name": "Alice",
  "persona": "...",
  ...
}
```
*Output truncated. Configure S3 for full exports.*
```

## CCv2 Specification

Character Card V2 is a community standard for character definitions. Key fields:

| Field | Description |
|-------|-------------|
| `name` | Character name |
| `description` | Character description/persona |
| `personality` | Personality traits |
| `scenario` | Default scenario |
| `first_mes` | First message/greeting |
| `mes_example` | Example dialogue |
| `system_prompt` | System prompt override |
| `extensions` | Tool-specific data |

Hologram stores extended data in `extensions["hologram/*"]` namespaces when using `ccv2-extended` or `extended` compliance.

## Importing

Currently, import is not implemented via slash commands. To import:

1. **CCv2 cards** - Use `/build character` and paste the persona
2. **Hologram exports** - Database restore (operator task)
3. **Chronicle JSONL** - Manual processing

## Troubleshooting

### "You don't have permission to export"

You're not the creator and don't have owner/admin access to the world. Check with the world owner.

### "Character not found"

The character doesn't exist or isn't in the current world. Try:
- Check spelling
- Use `/character list` to see available characters
- Make sure you're in the right channel/world

### "Output truncated"

The export is too large for Discord. Ask the bot operator to configure S3 storage for full exports.

### "Export failed"

Generic error. Check:
- Bot has necessary permissions
- S3 storage is correctly configured (if used)
- Character/world data isn't corrupted
