# Creating a Persona

A persona lets you speak as a character. When you bind yourself to an entity, your messages are seen from that character's perspective.

## Why Use Personas?

- **Roleplay**: Speak as your character instead of as yourself
- **Multiple Characters**: Switch between different characters
- **Perspective**: The AI sees your messages as coming from your character

## Creating Your Character

### 1. Create the Entity

```
/c character Traveler
```

### 2. Define Who They Are

```
/e Traveler
```

Add facts:

```
is a character
is a wandering adventurer
carries a worn map and compass
is curious about local legends
speaks casually and asks lots of questions
```

### 3. Bind to Yourself

```
/b me Traveler
```

Now your messages in this channel come from Traveler's perspective.

## Scopes

### Channel Scope (Default)

```
/b me Traveler
```

You're Traveler only in this channel. In other channels, you're yourself.

### Server Scope

```
/b me Traveler scope:guild
```

You're Traveler across the entire server.

### Global Scope

```
/b me Traveler scope:global
```

You're Traveler everywhere the bot is active.

## Switching Characters

Just bind to a different entity:

```
/b me Knight
```

Or remove your persona entirely:

```
/b me none
```

(Note: "none" unbinds you - you'll speak as yourself again)

## How It Affects Responses

When you have a persona:

1. Your messages are attributed to your character
2. The AI knows who you are in the story
3. NPCs can remember interactions with your character
4. Facts about your character influence how NPCs respond to you

### Example

Without persona:
```
You: "What's for sale?"
Shopkeeper: "Welcome, stranger! I have potions, weapons, and supplies."
```

With "Knight" persona:
```
Knight: "What's for sale?"
Shopkeeper: "Sir Knight! I have some fine weapons that might suit you,
and healing potions for your travels."
```

The Shopkeeper responds differently because they know they're talking to a knight.

## Tips

- **Keep facts current**: Update your character as they change
- **Be consistent**: Facts shape how others see you
- **Use relationships**: Add facts like "is friends with [entity:5]" to establish connections

## Checking Your Persona

```
/s
```

Shows your current persona in this channel.
