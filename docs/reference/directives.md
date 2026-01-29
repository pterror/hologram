# Directives Reference

Directives are special fact prefixes that control entity behavior. They're processed at evaluation time and (mostly) removed before facts are shown to the LLM.

## Directive Categories

Directives fall into three distinct categories:

| Category | Directives | Purpose |
|----------|------------|---------|
| **Flow Control** | `$if`, `$respond`, `$retry` | When and whether to respond |
| **Output** | `$stream`, `$freeform`, `$model`, `$context`, `$strip` | How and what the LLM produces |
| **Metadata** | `$avatar`, `$memory` | Entity presentation and memory |
| **Permissions** | `$locked`, `$edit`, `$view`, `$blacklist` | Access control |

This separation is intentional. Each category handles a different concern, and directives within a category don't overlap in function.

## Flow Control

### `$if <expr>: <fact or directive>`

Conditionally include a fact or trigger a directive. The expression is evaluated at message time.

**Expressions are JavaScript**, so strings must be quoted:

```
$if time.is_night: glows faintly
$if mentioned: $respond
$if random() < 0.1 && response_ms > 30000: $respond
$if content.includes("hello"): $respond
```

See [Response Control](/reference/triggers) for expression syntax and available variables.

### `$respond` / `$respond false`

Control whether the entity responds to a message. Multiple `$respond` directives are evaluated in order; the last one that applies wins.

```
$respond              # Always respond
$respond false        # Never respond
$if mentioned: $respond   # Respond when @mentioned
```

**Default behavior:** If no `$respond` directive is present, the entity responds when @mentioned or when its name appears in dialogue.

### `$retry <ms>`

Delay evaluation and re-check later. Useful for batching rapid messages or creating "thinking" pauses.

```
$retry 3000                         # Re-evaluate in 3 seconds
$if retry_ms > 2000: $respond     # Then respond if enough time passed
```

When `$retry` fires, evaluation stops immediately. After the delay, facts are re-evaluated with updated `retry_ms`.

## Metadata

### `$avatar <url>`

Set a custom avatar URL for webhook messages.

```
$avatar https://example.com/aria.png
```

If not set, the webhook uses Discord's default avatar.

## Output

### `$strip` / `$strip "<pattern>"`

Strip specified strings from message history before sending to the LLM. Useful for removing Discord formatting artifacts from context.

```
$strip "</blockquote>"             # Strip this pattern from context
$strip "</blockquote>" "<br>"      # Strip multiple patterns
$strip                             # Explicitly disable stripping (even on default models)
$if mentioned: $strip "</blockquote>"  # Conditional stripping
```

**Default behavior:** When no `$strip` directive is present, `</blockquote>` is automatically stripped for `gemini-2.5-flash-preview` models only. All other models default to no stripping. Use bare `$strip` (no arguments) to explicitly disable this default.

Patterns are quoted strings. Supports escape sequences: `\n`, `\t`, `\\`. Multiple `$strip` directives are evaluated in order; the last one wins.

## Permissions

### `$locked`

Prevent the LLM from modifying this entity via tools (`add_fact`, `update_fact`, `remove_fact`).

```
$locked
```

The LLM can still *see* all facts; it just can't change them.

### `$locked <fact>`

Lock a specific fact from LLM modification while keeping it visible.

```
$locked has silver hair
$locked is loyal to the queen
```

The fact content (without the `$locked` prefix) is shown to the LLM, but tool calls targeting that fact will fail.

### `$edit @everyone` / `$edit <usernames>`

Control which Discord users can edit this entity via `/edit`.

```
$edit @everyone           # Anyone can edit
$edit alice, bob          # Only these usernames
```

**Default:** Owner only (the user who created the entity).

### `$view @everyone` / `$view <usernames>`

Control which Discord users can view this entity via `/view`.

```
$view @everyone           # Anyone can view (default)
$view alice, bob          # Only these usernames
```

**Default:** Everyone can view.

## Other Syntax

### Comments (`$#`)

Lines starting with `$#` in the first column are stripped entirely.

```
$# This is a comment - won't be shown to LLM
 $# This is NOT a comment (starts with space) - will be shown
```

### Key-Value Facts

Facts in `key: value` format are parsed into the `self` context for expressions.

```
mood: happy
energy: 0.8
$if self.energy < 0.3: seems tired
```

These are regular facts (shown to the LLM) that also provide expression context.

## Design Rationale

The directive system was built incrementally, which raised concerns about coherence. After review, the current design holds together well:

**Why these categories work:**

1. **Flow control** (`$if`, `$respond`, `$retry`) - All about *when* to respond. `$if` is the conditional mechanism, `$respond` is the decision, `$retry` handles timing. No overlap.

2. **Metadata** (`$avatar`) - Presentation concerns, separate from behavior. Could expand to `$name`, `$color`, etc. without touching other categories.

3. **Permissions** (`$locked`, `$edit`, `$view`) - Access control is orthogonal to behavior. `$locked` controls LLM access; `$edit`/`$view` control Discord user access. These don't interfere with each other or with flow control.

**Why `$retry` isn't a bandaid:**

`$retry` enables behaviors that can't be achieved otherwise:
- "Wait for the conversation to settle before responding"
- "Batch rapid messages into one response"
- "Create thinking/typing delays"

Without `$retry`, rate limiting (`$if response_ms > X`) only works reactively. `$retry` adds proactive delayed responses.

**What would be bandaids:**

- Multiple ways to do the same thing (e.g., `$always` as alias for `$respond`)
- Directives that only exist to work around limitations of other directives
- Overlapping scope between directives

The current set avoids these patterns.
