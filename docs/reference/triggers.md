# Triggers Reference

Triggers control when the bot responds. Add them as facts on channel-bound entities.

## Trigger Format

```
trigger: <condition> -> <action>
```

## Conditions

### `mention`

Fires when the bot is @mentioned.

```
trigger: mention -> respond
```

This is the default if no triggers are defined.

---

### `pattern "<regex>"`

Fires when the message matches a regular expression.

```
trigger: pattern "hello|hi|hey" -> respond
trigger: pattern "^!" -> respond
trigger: pattern "help" -> respond
```

The pattern is case-insensitive.

---

### `random <chance>`

Fires with a random probability (0.0 to 1.0).

```
trigger: random 0.1 -> respond    # 10% chance
trigger: random 0.05 -> respond   # 5% chance
trigger: random 0.5 -> respond    # 50% chance
```

---

### `llm`

An LLM decides if the character would naturally respond.

```
trigger: llm -> respond
```

Uses a fast, cheap model to evaluate whether the character should join the conversation based on recent messages and the character's personality.

You can specify a model:

```
trigger: llm google:gemini-2.5-flash-lite -> respond
```

---

### `always`

Always fires (use with throttling).

```
trigger: always -> respond
throttle_ms: 60000
```

---

## Actions

### `respond`

Generate and send a response.

```
trigger: mention -> respond
```

---

### `narrate` (planned)

Inject system narration.

```
trigger: pattern "enters" -> narrate
```

---

## Configuration Facts

### `delay_ms`

Wait before evaluating triggers. Useful for batching messages.

```
delay_ms: 5000
```

If more messages arrive during the delay, the timer resets. After the delay, triggers are evaluated against all buffered messages.

**Note:** Mentions bypass the delay and respond immediately.

---

### `throttle_ms`

Minimum time between responses.

```
throttle_ms: 30000
```

Even if triggers fire, the bot won't respond if less than 30 seconds have passed since the last response.

---

### `llm_decide_model`

Model to use for `llm` trigger decisions.

```
llm_decide_model: google:gemini-2.5-flash-lite-preview-06-2025
```

Default: `google:gemini-2.5-flash-lite-preview-06-2025`

---

## Examples

### Responsive NPC

Responds to mentions and name, with some random interjections:

```
trigger: mention -> respond
trigger: pattern "bartender|barkeep" -> respond
trigger: random 0.05 -> respond
throttle_ms: 30000
```

### Quiet Observer

Only responds when the LLM thinks it's appropriate:

```
trigger: llm -> respond
delay_ms: 10000
throttle_ms: 120000
```

### Always Active

Responds to everything (with rate limiting):

```
trigger: always -> respond
throttle_ms: 5000
```

### Keyword Bot

Only responds to specific commands:

```
trigger: pattern "^!help" -> respond
trigger: pattern "^!status" -> respond
trigger: pattern "^!roll" -> respond
```

## Trigger Evaluation

Triggers are evaluated in order. The first one that fires determines the action. If no triggers fire, no response is sent.

```
trigger: mention -> respond      # Checked first
trigger: pattern "help" -> respond  # Checked second
trigger: random 0.1 -> respond   # Checked third
```

If the bot is @mentioned, it responds immediately without checking the other triggers.
