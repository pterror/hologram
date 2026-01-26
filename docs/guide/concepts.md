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
  - is in [entity:2]
```

Facts are freeform text. You can write anything. Some patterns have special meaning (like `is in [entity:2]` for location), but most facts are just descriptions that shape how the AI responds.

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
| `is in [entity:12]` | Location/containment |
| `trigger: ...` | Response trigger (see [Triggers](/reference/triggers)) |

## Bindings

Bindings connect Discord to entities.

### Channel Binding

```
/b channel Aria
```

When a channel is bound to an entity (usually a character), that entity:
- Receives messages from the channel
- Responds based on its facts and triggers
- Can learn and update its facts through conversation

### User Binding (Persona)

```
/b me Traveler
```

When you bind yourself to an entity:
- Your messages come from that entity's perspective
- The AI sees you as that character
- Useful for roleplaying as specific characters

### Scopes

Bindings can have different scopes:

| Scope | Meaning |
|-------|---------|
| `channel` | Only in this channel (default) |
| `guild` | Across the entire server |
| `global` | Everywhere the bot is |

```
/b channel Aria              # This channel only
/b me Traveler scope:guild   # This server
/b me Narrator scope:global  # Everywhere
```

## How It Works

When a message arrives:

1. **Lookup**: Find the channel's bound entity
2. **Triggers**: Check if any triggers fire (mention, pattern, etc.)
3. **Context**: Gather entity facts + recent messages
4. **LLM**: Send to language model for response
5. **Learning**: LLM can add/update facts via tool calls

The AI doesn't just respond - it can learn. If someone tells Aria "I'm looking for a rare gem", she might add a fact: "met a traveler seeking rare gems".
