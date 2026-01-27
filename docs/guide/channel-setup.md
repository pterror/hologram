# Setting Up a Channel

This guide walks through setting up a channel where an AI character responds.

## Basic Setup

### 1. Create a Character

```
/c character Bartender
```

### 2. Add Personality

```
/e Bartender
```

Add facts in the modal:

```
is a character
runs the local tavern
is friendly and talkative
knows all the local gossip
speaks with a warm, welcoming tone
```

### 3. Bind to Channel

```
/b channel Bartender
```

Done! The Bartender now responds when @mentioned in this channel.

## Server-Wide Setup

To have an entity respond across all channels in a server:

```
/b server Narrator
```

This is useful for:
- Server-wide narrators
- Assistants that should be available everywhere
- Default characters that respond unless a channel has its own binding

Channel bindings take priority over server bindings, so you can override the default in specific channels.

## Configuring Response Behavior

By default, characters only respond when @mentioned. You can change this with `$respond` directives.

### Respond to Everything

```
$respond
```

### Respond to Mentions Only (Default)

```
$if mentioned: $respond
```

### Respond to Specific Words

```
$if content.match(/hello|hi|hey/i): $respond
$if content.match(/bartender/i): $respond
```

### Random Chance

```
$if random() < 0.1: $respond
```

The character has a 10% chance to respond to any message.

### Multiple Conditions

You can combine conditions - they're evaluated in order, last match wins:

```
$if mentioned: $respond
$if content.match(/bartender/i): $respond
$if random() < 0.05: $respond
```

## Rate Limiting

### Minimum Time Between Responses

Prevent spam by checking time since last response:

```
$if dt_ms > 30000: $respond
```

The character won't respond more than once per 30 seconds.

### Delay Before Responding

Use `$retry` to wait before evaluating (useful for batching messages):

```
$retry 5000
$if elapsed_ms > 4000: $respond
```

Wait ~5 seconds after a message before responding. If a new message arrives, the timer resets.

## Example: Active NPC

A character that's part of the conversation:

```
/c character Shopkeeper
/e Shopkeeper
```

Facts:
```
is a character
owns the general store
is grumpy but fair
responds to questions about items and prices
$if mentioned: $respond
$if content.match(/shop|buy|sell|price/i): $respond
$if random() < 0.05 && dt_ms > 60000: $respond
```

## Example: Narrator

A character that occasionally adds flavor:

```
/c character Narrator
/e Narrator
```

Facts:
```
is a narrator
describes the scene and atmosphere
speaks in third person
only interjects when something interesting happens
$if random() < 0.05 && dt_ms > 120000: $respond
```

## Checking Status

See the current channel configuration:

```
/s
```

This shows:
- What entity the channel is bound to
- Your current persona (if any)
- Recent message count
