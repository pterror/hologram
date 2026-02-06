# Creating a Persona

A persona lets you speak as a character. When you bind yourself to an entity, your messages are seen from that character's perspective.

## Why Use Personas?

- **Roleplay**: Speak as your character instead of as yourself
- **Multiple Characters**: Switch between different characters
- **Perspective**: The AI sees your messages as coming from your character

## Creating Your Character

### 1. Create the Entity

```
/create Traveler
```

### 2. Define Who They Are

```
/edit Traveler
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
/bind me Traveler
```

Now your messages in this channel come from Traveler's perspective.

## Scopes

### Channel Scope

```
/bind "Me (this channel)" Traveler
```

You're Traveler only in this channel. In other channels, you're yourself.

### Server Scope

```
/bind "Me (this server)" Traveler
```

You're Traveler across the entire server.

### Global Scope

```
/bind "Me (global)" Traveler
```

You're Traveler everywhere the bot is active.

## Switching Characters

Just bind to a different entity:

```
/bind "Me (this channel)" Knight
```

Or remove your persona entirely:

```
/unbind "Me (this channel)" Traveler
```

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
- **Use relationships**: Add facts like <code v-pre>"is friends with {{entity:5}}"</code> to establish connections

## Checking Your Persona

```
/debug
```

Shows your current persona in this channel.
