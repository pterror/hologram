# Response Control Reference

Control when the bot responds using `$respond` directives and `$if` conditionals.

## Basic Syntax

### Always respond

```
$respond
```

### Never respond (suppress)

```
$respond false
```

### Conditional response

```
$if <condition>: $respond
```

## Conditions

Conditions are **JavaScript expressions** with access to context variables.

::: tip String Quoting
Since expressions are JavaScript, strings must be quoted: `"hello"` not `hello`.

```
# Correct
$if content.includes("hello"): $respond

# Wrong - hello is treated as an undefined variable
$if content.includes(hello): $respond
```
:::

### Context Variables

| Variable | Type | Description |
|----------|------|-------------|
| `mentioned` | boolean | Bot was @mentioned |
| `is_self` | boolean | Message is from this entity's own webhook |
| `content` | string | Message content (alias for `messages(1, "%m")`) |
| `author` | string | Message author name (alias for `messages(1, "%a")`) |
| `response_ms` | number | Milliseconds since last response |
| `retry_ms` | number | Milliseconds since triggering message (for retries) |
| `idle_ms` | number | Milliseconds since any message in channel |
| `random()` | function | Float [0,1), or int with `random(max)` [1,max] / `random(min,max)` [min,max] |
| `has_fact(pattern)` | function | Check if entity has matching fact |
| `mentioned_in_dialogue(name)` | function | Check if name appears in quoted dialogue |
| `messages(n, format)` | function | Last n messages. Format: `%a`=author, `%m`=message (default `"%a: %m"`) |
| `time.hour` | number | Current hour (0-23) |
| `time.is_day` | boolean | 6am-6pm |
| `time.is_night` | boolean | 6pm-6am |
| `channel.id` | string | Channel snowflake ID |
| `channel.name` | string | Channel name |
| `channel.description` | string | Channel topic |
| `channel.mention` | string | Channel mention (e.g. `<#123>`) |
| `server.id` | string | Server snowflake ID |
| `server.name` | string | Server name |
| `server.description` | string | Server description |
| `self.*` | varies | Entity's own `key: value` facts |

### Examples

Respond when mentioned:
```
$if mentioned: $respond
```

Respond 10% of the time:
```
$if random() < 0.1: $respond
```

Respond to keywords:
```
$if content.includes("hello"): $respond
```

Check conversation history:
```
$if messages(10).includes("help"): $respond
```

Respond only at night:
```
$if time.is_night: $respond
```

Minimum 30 seconds between responses:
```
$if response_ms > 30000: $respond
```

## Default Behavior

If no `$respond` directive is present, the bot responds when @mentioned.

To respond to all messages, add:
```
$respond
```

To never respond (disable the entity), add:
```
$respond false
```

## Multiple Conditions

Multiple `$if` lines are evaluated in order. The last matching `$respond` wins.

```
$respond false
$if mentioned: $respond
$if random() < 0.1: $respond
```

This suppresses responses by default, but responds if mentioned OR 10% randomly.

## Delayed Response with $retry

Schedule a re-evaluation after a delay:

```
$retry 5000
```

This is useful for batching messages or creating "thinking" delays.

Example - wait 3 seconds then respond if no new messages:
```
$retry 3000
$if retry_ms > 2000: $respond
```

## Examples

### Respond to mentions only (default)

No special facts needed, or explicitly:
```
$if mentioned: $respond
```

### Responsive NPC

Responds to mentions, name patterns, and occasionally randomly:
```
$if mentioned: $respond
$if content.match(/bartender|barkeep/i): $respond
$if random() < 0.05: $respond
```

### Rate-limited responses

Respond to everything, but only once per minute:
```
$if response_ms > 60000: $respond
```

### Quiet observer

Small chance to respond, with minimum spacing:
```
$if random() < 0.05 && response_ms > 120000: $respond
```

### Night owl

Only active at night:
```
$if time.is_night && mentioned: $respond
```

### Keyword bot

Only responds to specific patterns:
```
$respond false
$if content.startsWith("!help"): $respond
$if content.startsWith("!roll"): $respond
```

### Name-triggered character

Responds when their name is mentioned in dialogue (not from self):
```
$if mentioned_in_dialogue(name) && !is_self: $respond
```

### Character aware of other characters

Responds when another character is mentioned:
```
$if mentioned_in_dialogue("Alice"): $respond
$if mentioned_in_dialogue("Bob"): $respond
```

## Self Context

Facts in `key: value` format are accessible via `self.*`:

```
mood: happy
energy: 0.8
$if self.energy > 0.5: $respond
```

This lets entities have dynamic behavior based on their state.
