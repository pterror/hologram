# Custom Templates

<div v-pre>

Custom templates let you control the system prompt formatting for an entity. By default, entities use the built-in `DEFAULT_TEMPLATE`. A custom template replaces this entirely.

Powered by [Nunjucks](https://mozilla.github.io/nunjucks/) with runtime security patches.

## Editing

```
/edit <entity> type:Template
```

Submit an empty template to clear it and revert to default formatting.

## Syntax

Full Nunjucks template syntax:

```
{{ expr }}                                    — expression output
{% if expr %}...{% elif expr %}...{% else %}...{% endif %}
{% for var in expr %}...{% else %}...{% endfor %}
{% extends "entity-name" %}                  — template inheritance (loads another entity's template)
{% block name %}...{% endblock %}             — named blocks (rendered inline, or overrides parent blocks)
{{ value | filter }}                          — pipe filters
{%- tag -%}                                  — whitespace control
{# comment #}
```

### Operators

Nunjucks operators available in expressions:

| Operator | Description |
|----------|-------------|
| `and` | Logical AND |
| `or` | Logical OR |
| `not` | Logical NOT |
| `in` | Containment test |
| `is` | Identity test |
| `~` | String concatenation |
| `**` | Exponentiation |
| `//` | Floor division |

Standard comparison and arithmetic operators also work: `==`, `!=`, `<`, `>`, `<=`, `>=`, `+`, `-`, `*`, `/`, `%`.

### Whitespace Control

Add `-` to strip whitespace around block tags:

```
{%- if true -%}   — strips whitespace before and after
{%- for x in arr -%}
```

By default, `trimBlocks` and `lstripBlocks` are enabled — the newline after a block tag and leading whitespace on block-only lines are automatically stripped.

## Filters

| Filter | Usage | Description |
|--------|-------|-------------|
| `default` | `{{ x \| default("none") }}` | Return default if null/undefined/empty |
| `length` | `{{ arr \| length }}` | Array or string length |
| `join` | `{{ arr \| join(", ", "name") }}` | Join array, optional attr pluck (100KB cap) |
| `first` | `{{ arr \| first }}` | First element |
| `last` | `{{ arr \| last }}` | Last element |
| `upper` | `{{ s \| upper }}` | Uppercase |
| `lower` | `{{ s \| lower }}` | Lowercase |
| `trim` | `{{ s \| trim }}` | Strip whitespace |
| `nl2br` | `{{ s \| nl2br }}` | Identity (no HTML conversion) |
| `int` | `{{ s \| int }}` | Parse as integer |
| `float` | `{{ s \| float }}` | Parse as float |
| `abs` | `{{ n \| abs }}` | Absolute value |
| `round` | `{{ n \| round(2) }}` | Round to precision |
| `reverse` | `{{ arr \| reverse }}` | Reverse array/string |
| `sort` | `{{ arr \| sort }}` | Sort array |
| `batch` | `{{ arr \| batch(3) }}` | Group into n-sized chunks |

## Template Context

All standard expression context variables are available (see `ExprContext`), plus:

| Variable | Type | Description |
|----------|------|-------------|
| `entities` | `Array<{id, name, facts}>` | Responding entities (facts have `toString() → join('\n')`) |
| `others` | `Array<{id, name, facts}>` | Other referenced entities (facts have `toString() → join('\n')`) |
| `memories` | `Record<number, string[]>` | Entity ID to memory strings (arrays have `toString() → join('\n')`) |
| `entity_names` | `string` | Comma-separated names of responding entities |
| `freeform` | `boolean` | True if any entity has `$freeform` |
| `history` | `Array<{author, content, author_id, created_at, is_bot, role, embeds, stickers, attachments}>` | Structured message history (chronological) |
| `char` | `{id, name, facts}` | First responding entity (`toString() → name`) |
| `user` | `{id, name, facts}` | User entity from others (`toString() → name`, defaults to `{name: "user"}`) |
| `_single_entity` | `boolean` | True when exactly one entity is responding |

### Structured Messages

The `history` variable provides the raw message history as structured objects:

| Field | Type | Description |
|-------|------|-------------|
| `author` | `string` | Display name of the message author |
| `content` | `string` | Message content |
| `author_id` | `string` | Discord user ID of the author |
| `created_at` | `string` | ISO timestamp of the message |
| `is_bot` | `boolean` | Whether the author is a Discord bot |
| `role` | `"user" \| "assistant"` | `"assistant"` for entity messages, `"user"` for human messages |
| `embeds` | `EmbedData[]` | Discord embed data (see below) |
| `stickers` | `Array<{id, name, format_type}>` | Sticker data (format_type: 1=PNG, 2=APNG, 3=Lottie, 4=GIF) |
| `attachments` | `AttachmentData[]` | File attachments (see below) |
| `toJSON()` | `string` | JSON string of the full message object |

All history entries and their `embeds`, `stickers`, and `attachments` arrays have a `toJSON()` method that returns a JSON string, for use in templates:

```
{{ msg.toJSON() }}              {# Full message as JSON #}
{{ msg.embeds.toJSON() }}       {# Just embeds as JSON #}
{{ msg.attachments.toJSON() }}  {# Just attachments as JSON #}
```

#### Embed Fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string?` | Embed title |
| `type` | `string?` | Embed type (`"rich"`, `"image"`, `"video"`, `"gifv"`, `"article"`, `"link"`) |
| `description` | `string?` | Embed description |
| `url` | `string?` | Embed URL |
| `timestamp` | `number?` | Embed timestamp |
| `color` | `number?` | Color code (integer) |
| `footer` | `{text, icon_url?}?` | Footer information |
| `image` | `{url, height?, width?}?` | Image information |
| `thumbnail` | `{url, height?, width?}?` | Thumbnail information |
| `video` | `{url?, height?, width?}?` | Video information |
| `provider` | `{name?, url?}?` | Provider information |
| `author` | `{name, url?, icon_url?}?` | Author information |
| `fields` | `Array<{name, value, inline?}>?` | Embed fields |

#### Attachment Fields

| Field | Type | Description |
|-------|------|-------------|
| `filename` | `string` | Name of the attached file |
| `url` | `string` | Source URL of the file |
| `content_type` | `string?` | MIME type |
| `title` | `string?` | File title |
| `description` | `string?` | Alt text / description (max 1024 chars) |
| `size` | `number?` | File size in bytes |
| `height` | `number?` | Image/video height in pixels |
| `width` | `number?` | Image/video width in pixels |
| `ephemeral` | `boolean?` | Whether the attachment is ephemeral |
| `duration_secs` | `number?` | Audio duration for voice messages |

### `send_as` Macro

The `send_as(role)` macro designates message roles in the LLM conversation. It is automatically injected into templates at render time — you don't need to define it.

Use `{% call send_as(role) %}...{% endcall %}` to wrap content that should be sent as a specific role:

| Role | Description |
|------|-------------|
| `"system"` | System-role message |
| `"user"` | User messages |
| `"assistant"` | Entity/character messages |

**Unmarked text** (outside any `send_as` call) automatically becomes system-role messages. This means entity definitions and instructions can be written as plain template text.

```
{#- Entity defs (unmarked → system-role) -#}
You are {{ entities[0].name }}.
{{ entities[0].facts }}

{#- History (send_as → proper roles) -#}
{% for msg in history %}
{% call send_as(msg.role) -%}
{{ msg.author }}: {{ msg.content }}
{%- endcall %}
{% endfor %}
```

**Behavior:**
- `send_as` calls produce messages with the specified role
- Empty `send_as` calls (whitespace-only) are filtered out
- Unmarked text between, before, or after `send_as` calls → system-role messages
- No `send_as` calls at all → entire output is a single system message (legacy behavior)

**Blocks are organizational only:** `{% block name %}` is for template inheritance — block names have no role semantics. Content inside blocks renders as unmarked text unless wrapped in `send_as`.

**Security:** `send_as` markers use cryptographic nonce markers (256-bit random hex) at render time. Template context values are strings, not template code — Discord user messages containing marker-like text cannot trigger the parser.

### Template Inheritance

Templates can inherit from other entities' templates:

```
{% extends "base-entity-name" %}

{% block custom_section %}
Custom content here
{% endblock %}
```

The parent template is loaded by looking up the entity by name and reading its template. The child template overrides parent `{% block %}` sections. Nunjucks provides built-in circular inheritance detection. Child templates in an inheritance chain inherit the `send_as` macro from their root parent.

**Note:** The parent template runs with the same context as the child (entities, history, etc. come from the current render call, not from the parent entity).

### Per-Entity System Prompt

Each entity can have a custom system prompt template (separate from the main template):

```
/edit <entity> type:System Prompt
```

This controls the AI SDK `system` parameter — the top-level system instruction the LLM sees before any messages. Empty = use global default (currently empty).

### Full Prompt Control

Templates produce structured message arrays using `send_as` for role designation. Unmarked text becomes system-role messages. The built-in default template uses `send_as(msg.role)` for history and unmarked text for entity definitions.

```
{#- Unmarked text → system-role message -#}
You are {{ entities[0].name }}.
{{ entities[0].facts }}
{#- History → proper roles via send_as -#}
{% for msg in history %}
{% call send_as(msg.role) -%}
{{ msg.author }}: {{ msg.content }}
{%- endcall %}
{% endfor %}
```

### For-loop Variables

Inside `{% for %}` blocks, Nunjucks provides the `loop` variable:

| Variable | Description |
|----------|-------------|
| `loop.index` | 1-based index |
| `loop.index0` | 0-based index |
| `loop.first` | True for first iteration |
| `loop.last` | True for last iteration |
| `loop.length` | Total number of items |

## Example

```
{# Custom template — entity defs are unmarked (→ system role) #}
{% for entity in entities %}
You are {{ entity.name }}.

{% for fact in entity.facts %}
- {{ fact }}
{% endfor %}

{% if memories[entity.id] %}
Memories:
{% for memory in memories[entity.id] %}
- {{ memory }}
{% endfor %}
{% endif %}
{% endfor %}

{% for other in others %}
{{ other.name }} is nearby.
{% for fact in other.facts %}
- {{ fact }}
{% endfor %}
{% endfor %}

{% if freeform %}
Write naturally with all characters.
{% endif %}

{# Message history with proper roles via send_as #}
{% for msg in history %}
{% call send_as(msg.role) -%}
{{ msg.author }}: {{ msg.content }}
{%- endcall %}
{% endfor %}
```

### Array toString

Facts and memories arrays have `toString()` overrides that join with newlines, so `{{ char.facts }}` outputs the same as `{{ char.facts | join("\n") }}`:

```
{{ char.name }}'s facts:
{{ char.facts }}
```

### Using Filters

```
{{ entity_names | upper }}
{{ entities | length }} entities responding
{% for entity in entities %}
{{ entity.facts | join("\n") }}
{% endfor %}
{% for batch in others | batch(3) %}
Group: {% for e in batch %}{{ e.name }}{% if not loop.last %}, {% endif %}{% endfor %}
{% endfor %}
```

### Whitespace Control Example

```
{%- for entity in entities -%}
{{ entity.name }}: {{ entity.facts | join(", ") }}
{%- endfor -%}
```

## Security

Templates use Nunjucks with runtime security patches:

- **Property access:** `constructor`, `__proto__`, `prototype`, and related properties are blocked (return `undefined`)
- **Method calls:** `.apply()`, `.bind()`, `.call()` are blocked; `.matchAll()` is blocked
- **Regex validation:** `.match()`, `.search()`, `.replace()`, `.split()` validate patterns against ReDoS
- **Memory limits:** `.repeat()`, `.padStart()`, `.padEnd()`, `.replaceAll()`, `.join()` are capped at 100KB output
- **Loop limit:** 1000 iterations per for-loop
- **Output limit:** 1MB maximum template output

## Limits

- **Loop iterations:** 1000 per for-loop
- **Output size:** 1MB maximum
- **String methods:** 100KB per method call output

## Grouping Behavior

Entities with different templates get **separate LLM calls**. Entities with the same template (including null/default) share a call as before. This prevents one entity's template from controlling how another entity's facts are presented.

## Deferred Features

The following Nunjucks feature is not yet available:

- `{% include %}` — template inclusion

## Known Limitations

Templates are per-entity and control the entire system prompt. A template on one entity could manipulate how other entities' facts are presented **in the same LLM call** (when entities share the same template). Mitigation:

- Template-based grouping separates entities with different templates
- Only the entity owner/editors can set a template (same permission model as facts)
- Entities sharing a template are presumed to be managed by the same owner

::: tip Try it out
Test template rendering interactively in the [Template Rendering Playground](/playground/templates).
:::

</div>
