# Help System Design

## Current State

The `/help` command exists with:
- Overview showing current setup status
- 9 topics: start, characters, worlds, memory, locations, inventory, combat, config, commands
- Static content per topic

## Proposed Enhancements

### 1. Additional Topics

Add missing topics:
- `time` - Time system, calendar, day/night
- `relationships` - Affinity, relationship types
- `factions` - Faction membership, standing
- `personas` - User personas and proxy system
- `scenes` - Dedicated scene topic (currently in "worlds")

### 2. Contextual Awareness

Show different content based on enabled features:
- If chronicle disabled, show how to enable instead of commands
- If feature enabled, show relevant commands
- Highlight features user hasn't tried yet

### 3. Interactive Navigation

Add buttons to navigate between topics:
```
[< Previous] [Topics List] [Next >]
```

Or a select menu for topic navigation within the embed.

### 4. Command Reference Subcommand

Add `/help command <name>` for detailed command help:
```
/help command roll
```
Shows:
- Full syntax
- All subcommands/options
- Examples
- Related commands

### 5. Search (Future)

```
/help search <query>
```
Searches across all help content.

### 6. Error Message Integration

When commands fail, include contextual help:
```
No world initialized. Use '/world init' first.
Tip: Use '/help start' for setup guide.
```

## Implementation Plan

### Phase 1: Add Missing Topics
- Add `time`, `relationships`, `factions`, `personas` topics
- Split `scenes` out of `worlds`

### Phase 2: Interactive Navigation
- Add topic select menu to overview
- Add navigation buttons to topic pages

### Phase 3: Command Reference
- Add `/help command <name>` subcommand
- Generate from command definitions where possible

### Phase 4: Contextual Awareness
- Check world config before showing topic content
- Adapt content based on enabled features

## Topic Content Outline

### Time
- About time system
- Time modes (narrative, manual, realtime)
- Commands: /time show|advance|set
- Day/night periods
- Calendar configuration

### Relationships
- Relationship types
- Affinity system
- Commands: /relationship show|set|list
- Configuration options

### Factions
- Faction membership
- Standing system
- Commands: /faction list|info|join|leave|standing

### Personas
- User personas vs characters
- Proxy system (prefix/suffix/brackets)
- Commands: /persona, /proxy
- Use cases

### Scenes (expanded)
- Scene lifecycle
- Pause/resume
- Scene boundaries
- Multiple participants
- Commands: /scene start|pause|resume|end|status|list

## Command Details Format

For `/help command <name>`:

```
/roll - Roll dice

Syntax:
  /roll <expression>
  /r <expression>

Examples:
  /roll 2d6+3      → Roll 2d6 and add 3
  /roll 4d6kh3     → Roll 4d6, keep highest 3
  /roll d20!       → Exploding d20
  /roll 3d6>=5     → Count successes ≥5

Options:
  • kh/kl - Keep highest/lowest
  • ! - Exploding dice
  • r - Reroll
  • >= - Success counting

Related:
  /combat - Turn-based combat
  /config set dice.enabled true - Enable dice
```

## Files to Modify

- `src/bot/commands/help.ts` - Main implementation
- `src/bot/commands/index.ts` - Add command handler routing if needed
