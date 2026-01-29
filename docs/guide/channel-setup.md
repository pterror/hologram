# Setting Up a Channel

This guide walks through setting up a channel where an AI character responds.

## Basic Setup

### 1. Create a Character

```
/create Bartender
```

### 2. Add Personality

```
/edit Bartender
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
/bind channel Bartender
```

Done! The Bartender now responds when @mentioned in this channel.

## Server-Wide Setup

To have an entity respond across all channels in a server:

```
/bind server Narrator
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

## Streaming Responses

By default, the AI generates a complete response and sends it as a single message. You can enable **streaming** to send responses progressively as they're generated.

### Stream Modes

```
$stream              # New message per line, sent when complete
$stream full         # Single message, edited as content streams
```

**Default mode** - Each completed line becomes a separate Discord message. Creates a natural, conversational feel.

**full** - One message that gets progressively edited with the full response. Useful for seeing the complete thought form.

### Custom Delimiters

You can use a custom delimiter instead of newlines:

```
$stream "kitten:"        # New message each time LLM outputs "kitten:"
$stream full "\n"        # New message per line, each edited as it streams
$stream full "---"       # New message per "---", each edited as it streams
```

When `full` mode has a delimiter, it creates a new message for each chunk AND edits that message progressively as content streams in. This gives you the benefits of both modes.

### Conditional Streaming

You can make streaming conditional:

```
$if mentioned: $stream full
```

### Multi-Character Streaming

Streaming works with multiple characters too! The system parses XML tags as they stream:

```xml
<Aria>*waves* Hello there!</Aria>
<Marcus>Good to see you.</Marcus>
```

Each character's response streams independently to their own message.

### Notes

- Works with webhooks or regular messages (falls back automatically)
- `full` mode edits messages, which has rate limits
- For very long responses, `lines` mode is most reliable

## Rate Limiting

### Minimum Time Between Responses

Prevent spam by checking time since last response:

```
$if response_ms > 30000: $respond
```

The character won't respond more than once per 30 seconds.

### Delay Before Responding

Use `$retry` to wait before evaluating (useful for batching messages):

```
$retry 5000
$if retry_ms > 4000: $respond
```

Wait ~5 seconds after a message before responding. If a new message arrives, the timer resets.

## Example: Active NPC

A character that's part of the conversation:

```
/create Shopkeeper
/edit Shopkeeper
```

Facts:
```
is a character
owns the general store
is grumpy but fair
responds to questions about items and prices
$if mentioned: $respond
$if content.match(/shop|buy|sell|price/i): $respond
$if random() < 0.05 && response_ms > 60000: $respond
```

## Example: Narrator

A character that occasionally adds flavor:

```
/create Narrator
/edit Narrator
```

Facts:
```
is a narrator
describes the scene and atmosphere
speaks in third person
only interjects when something interesting happens
$if random() < 0.05 && response_ms > 120000: $respond
```

## Checking Status

See the current channel configuration:

```
/info
```

This shows:
- What entity the channel is bound to
- Your current persona (if any)
- Recent message count
