# Commands Reference

## Entity Management

### `/create`

Create a new entity.

```
/create [name]
```

**Examples:**
```
/create Aria           # Create entity named Aria
/create                # Opens modal for name entry
```

---

### `/view`

View an entity and its facts.

```
/view <entity>
```

**Examples:**
```
/view Aria             # View by name
/view help             # View help entity
/view help:triggers    # View triggers help
```

---

### `/edit`

Edit an entity's facts and memories.

```
/edit <entity>
/edit <entity> type:facts       # Facts only (more space)
/edit <entity> type:memories    # Memories only (more space)
```

Opens a modal with name, facts, and memories. Edit them (one per line) and submit. Use `type:facts` or `type:memories` to edit one at a time when content is too large for the combined modal.

**Examples:**
```
/edit Aria             # Edit Aria's facts and memories
/edit Aria type:facts  # Edit only facts (up to 4 fields)
```

---

### `/delete`

Delete an entity you own.

```
/delete <entity>
```

Only the owner can delete an entity.

**Examples:**
```
/delete Aria           # Delete Aria
```

---

### `/transfer`

Transfer entity ownership to another user.

```
/transfer <entity> <user>
```

Only the current owner can transfer an entity.

**Examples:**
```
/transfer Aria @username  # Transfer Aria to another user
```

---

## Bindings

### `/bind`

Bind a Discord channel or yourself to an entity.

```
/bind <target> <entity> [scope]
```

**Targets:**
- `channel` - Bind this channel
- `server` - Bind this server
- `me` - Bind yourself

**Scopes:**
- `channel` - This channel only (default)
- `guild` - This server
- `global` - Everywhere

**Examples:**
```
/bind channel Aria              # Aria responds in this channel
/bind me Traveler               # Speak as Traveler here
/bind me Knight scope:guild     # Speak as Knight server-wide
/bind channel Narrator scope:global  # Narrator everywhere
```

---

### `/unbind`

Remove an entity binding from a channel or yourself.

```
/unbind <target> <entity> [scope]
```

**Targets:**
- `channel` - Unbind from this channel
- `server` - Unbind from this server
- `me` - Unbind yourself

**Scopes:**
- `channel` - This channel only (default)
- `guild` - This server
- `global` - Global binding

**Examples:**
```
/unbind channel Aria             # Remove Aria from this channel
/unbind me Traveler              # Stop speaking as Traveler
/unbind me Knight scope:guild    # Remove server-wide persona
```

---

## Status

### `/info`

View current channel state or debug information.

```
/info [status|prompt|history]
```

Shows:
- Channel binding (which entity responds)
- Your persona (if any)
- Recent message count

---

## Help

Help is an entity! View it with `/view`:

```
/view help              # Overview
/view help:start        # Getting started guide
/view help:commands     # Command reference
/view help:expressions  # Response control ($if)
/view help:patterns     # Common expression patterns
/view help:facts        # Fact patterns
/view help:bindings     # Binding system
/view help:permissions  # Entity permissions
/view help:models       # LLM configuration
```
