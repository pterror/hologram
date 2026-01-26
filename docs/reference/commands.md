# Commands Reference

All commands have short aliases for quick access.

## Entity Management

### `/create` (alias: `/c`)

Create a new entity.

```
/c <type> [name]
```

**Type shortcuts:**
- `c`, `char`, `character` → character
- `l`, `loc`, `location` → location
- `i`, `item` → item

**Examples:**
```
/c character Aria      # Create character named Aria
/c c Aria              # Same thing
/c location Tavern     # Create location
/c l Tavern            # Same thing
/c item Sword          # Create item
```

If you omit the name, a modal opens for details.

---

### `/view` (alias: `/v`)

View an entity and its facts.

```
/v <entity>
```

**Examples:**
```
/v Aria                # View by name
/v help                # View help entity
/v help:triggers       # View triggers help
```

---

### `/edit` (alias: `/e`)

Edit an entity's facts.

```
/e <entity>
```

Opens a modal with current facts. Edit them (one per line) and submit.

**Examples:**
```
/e Aria                # Edit Aria's facts
```

---

### `/delete` (alias: `/d`)

Delete an entity you created.

```
/d <entity>
```

Only the creator can delete an entity.

**Examples:**
```
/d Aria                # Delete Aria
```

---

## Bindings

### `/bind` (alias: `/b`)

Bind a Discord channel or yourself to an entity.

```
/b <target> <entity> [scope]
```

**Targets:**
- `channel` - Bind this channel
- `me` - Bind yourself

**Scopes:**
- `channel` - This channel only (default)
- `guild` - This server
- `global` - Everywhere

**Examples:**
```
/b channel Aria              # Aria responds in this channel
/b me Traveler               # Speak as Traveler here
/b me Knight scope:guild     # Speak as Knight server-wide
/b channel Narrator scope:global  # Narrator everywhere
```

---

## Status

### `/status` (alias: `/s`)

View current channel state.

```
/s
```

Shows:
- Channel binding (which entity responds)
- Your persona (if any)
- Recent message count

---

## Help

Help is an entity! View it with `/v`:

```
/v help              # Overview
/v help:start        # Getting started guide
/v help:commands     # Command reference
/v help:triggers     # Trigger system
/v help:facts        # Fact patterns
/v help:bindings     # Binding system
/v help:models       # LLM configuration
```
