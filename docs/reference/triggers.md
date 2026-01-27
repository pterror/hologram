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

Conditions are JavaScript-like expressions with access to context variables.

### Context Variables

| Variable | Type | Description |
|----------|------|-------------|
| `mentioned` | boolean | Bot was @mentioned |
| `content` | string | Message content |
| `author` | string | Message author name |
| `dt_ms` | number | Milliseconds since last response |
| `elapsed_ms` | number | Milliseconds since message (for retries) |
| `random(n)` | function | Returns true with probability n (0.0-1.0) |
| `has_fact(pattern)` | function | Check if entity has matching fact |
| `time.hour` | number | Current hour (0-23) |
| `time.is_day` | boolean | 6am-6pm |
| `time.is_night` | boolean | 6pm-6am |
| `self.*` | varies | Entity's own `key: value` facts |

### Examples

Respond when mentioned:
```
$if mentioned: $respond
```

Respond 10% of the time:
```
$if random(0.1): $respond
```

Respond to keywords:
```
$if content.includes("hello"): $respond
```

Respond only at night:
```
$if time.is_night: $respond
```

Minimum 30 seconds between responses:
```
$if dt_ms > 30000: $respond
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
$if random(0.1): $respond
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
$if elapsed_ms > 2000: $respond
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
$if random(0.05): $respond
```

### Rate-limited responses

Respond to everything, but only once per minute:
```
$if dt_ms > 60000: $respond
```

### Quiet observer

Small chance to respond, with minimum spacing:
```
$if random(0.05) && dt_ms > 120000: $respond
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

## Self Context

Facts in `key: value` format are accessible via `self.*`:

```
mood: happy
energy: 0.8
$if self.energy > 0.5: $respond
```

This lets entities have dynamic behavior based on their state.
