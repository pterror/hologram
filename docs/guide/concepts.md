# Core Concepts

## Entities

Everything in Hologram is an **entity**. Characters, locations, items, even the help system - all entities.

An entity is just a name with an ID:

```
Entity: Aria (id: 1)
Entity: The Tavern (id: 2)
Entity: Magic Sword (id: 3)
```

There's no fundamental difference between a character and a location. The difference emerges from the facts you attach.

## Facts

Facts are statements attached to entities. They describe what something is.

```
Entity: Aria
Facts:
  - is a character
  - has silver hair
  - works as a merchant
  - is in {{entity:2}}
```

Facts are freeform text. You can write anything. Some patterns have special meaning (like <code v-pre>is in {{entity:2}}</code> for location), but most facts are just descriptions that shape how the AI responds.

### Good Facts

- Use present tense: "is friendly" not "was friendly"
- Be specific: "has a scar above left eye" not "has scars"
- Include personality: "speaks formally", "tends to ramble"
- Note relationships: "distrusts strangers", "loyal to the guild"

### Special Patterns

| Pattern | Meaning |
|---------|---------|
| `is a character` | Entity type |
| `is a location` | Entity type |
| `is a item` | Entity type |
| <code v-pre>is in {{entity:12}}</code> | Location/containment |
| `$if condition: fact` | Conditional fact |
| `$respond` | Control when entity responds |
| `$stream` | Enable line-based streaming |
| `$locked` | Prevent AI from modifying entity |
| `$edit @everyone` | Allow anyone to edit |

See [Permissions](/guide/permissions) for full permission system documentation.

## Bindings

Bindings connect Discord to entities.

### Channel Binding

```
/bind channel Aria
```

When a channel is bound to an entity (usually a character), that entity:
- Receives messages from the channel
- Responds based on its facts and triggers
- Can learn and update its facts through conversation

### Server Binding

```
/bind server Narrator
```

When a server is bound to an entity:
- That entity responds in all channels of the server
- Channel-specific bindings take priority (override server binding)
- Useful for server-wide narrators or assistants

### User Binding (Persona)

```
/bind me Traveler
```

When you bind yourself to an entity:
- Your messages come from that entity's perspective
- The AI sees you as that character
- Useful for roleplaying as specific characters

### Binding Types

**Channel/Server bindings** - where the entity responds:
```
/bind "This channel" Aria       # Aria responds in this channel
/bind "This server" Narrator    # Narrator responds server-wide
```

**User bindings (personas)** - where you speak as an entity:

| Target | Where it applies |
|--------|------------------|
| `Me (this channel)` | Only in this channel |
| `Me (this server)` | Across the entire server |
| `Me (global)` | Everywhere the bot is |

```
/bind "Me (this channel)" Traveler  # Here only
/bind "Me (this server)" Knight     # Server-wide
/bind "Me (global)" Narrator        # Everywhere
```

## How It Works

When a message arrives:

1. **Lookup**: Find the channel's bound entity
2. **Triggers**: Check if any triggers fire (mention, pattern, etc.)
3. **Context**: Gather entity facts + recent messages
4. **LLM**: Send to language model for response
5. **Learning**: LLM can add/update facts via tool calls

The AI doesn't just respond - it can learn. If someone tells Aria "I'm looking for a rare gem", she might add a fact: "met a traveler seeking rare gems".
