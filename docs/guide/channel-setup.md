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

## Configuring Triggers

By default, characters only respond when @mentioned. You can change this by adding trigger facts.

### Respond to Mentions (Default)

```
trigger: mention -> respond
```

### Respond to Specific Words

```
trigger: pattern "hello|hi|hey" -> respond
trigger: pattern "bartender" -> respond
```

### Random Chance

```
trigger: random 0.1 -> respond
```

The character has a 10% chance to respond to any message.

### LLM Decides

```
trigger: llm -> respond
```

A fast, cheap LLM decides if the character would naturally respond to the conversation.

### Multiple Triggers

You can combine triggers - they're evaluated in order:

```
trigger: mention -> respond
trigger: pattern "bartender" -> respond
trigger: random 0.05 -> respond
```

## Rate Limiting

### Throttling

Prevent spam with a minimum time between responses:

```
throttle_ms: 30000
```

The character won't respond more than once per 30 seconds.

### Delay

Wait before evaluating triggers (useful for batching messages):

```
delay_ms: 5000
```

Wait 5 seconds after a message before deciding to respond. If more messages arrive, the timer resets.

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
trigger: mention -> respond
trigger: pattern "shop|buy|sell|price" -> respond
trigger: random 0.05 -> respond
throttle_ms: 60000
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
trigger: llm -> respond
delay_ms: 10000
throttle_ms: 120000
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
