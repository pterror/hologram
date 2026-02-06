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

Bind a Discord channel, server, or yourself to an entity.

```
/bind <target> <entity>
```

**Targets:**
- `This channel` - Entity responds in this channel
- `This server` - Entity responds in all channels of this server
- `Me (this channel)` - Speak as entity in this channel only
- `Me (this server)` - Speak as entity server-wide
- `Me (global)` - Speak as entity everywhere

**Examples:**
```
/bind "This channel" Aria           # Aria responds here
/bind "This server" Narrator        # Narrator responds server-wide
/bind "Me (this channel)" Traveler  # Speak as Traveler here
/bind "Me (this server)" Knight     # Speak as Knight server-wide
```

---

### `/unbind`

Remove an entity binding from a channel, server, or yourself.

```
/unbind <target> <entity>
```

**Targets:**
- `This channel` - Unbind from this channel
- `This server` - Unbind from this server
- `Me (this channel)` - Remove channel-specific persona
- `Me (this server)` - Remove server-wide persona
- `Me (global)` - Remove global persona

**Examples:**
```
/unbind "This channel" Aria           # Remove Aria from this channel
/unbind "Me (this channel)" Traveler  # Stop speaking as Traveler here
/unbind "Me (this server)" Knight     # Remove server-wide persona
```

---

## Status

### `/debug`

View current channel state or debug information.

```
/debug [status|prompt|context]
```

Shows:
- Channel binding (which entity responds)
- Your persona (if any)
- Recent message count

---

## Trigger

### `/trigger`

Manually trigger an entity to respond in the current channel. Bypasses the normal response logic (`$respond` / `$if`) - the entity will always respond.

```
/trigger <entity>
```

Respects `$use` and `$blacklist` permissions - you must be allowed to trigger the entity.

**Examples:**
```
/trigger Aria              # Force Aria to respond now
```

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
