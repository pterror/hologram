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
| `join` | `{{ arr \| join(", ") }}` | Join array (100KB cap) |
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
| `entities` | `Array<{id, name, facts}>` | Responding entities (facts as `string[]`) |
| `others` | `Array<{id, name, facts}>` | Other referenced entities (facts as `string[]`) |
| `memories` | `Record<number, string[]>` | Entity ID to memory strings |
| `entity_names` | `string` | Comma-separated names of responding entities |
| `freeform` | `boolean` | True if any entity has `$freeform` |
| `history` | `Array<{author, content, author_id, created_at, is_bot, role, embeds, stickers, attachments}>` | Structured message history (chronological) |
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
| `embeds` | `Array<{title?, description?, fields?}>` | Discord embed data |
| `stickers` | `Array<{id, name, format_type}>` | Sticker data (format_type: 1=PNG, 2=APNG, 3=Lottie, 4=GIF) |
| `attachments` | `Array<{filename, url, content_type?}>` | File attachments |

### Role Blocks

Templates use named blocks to define structured chat messages. Three role blocks are available:

| Block | LLM Role | Description |
|-------|----------|-------------|
| `{% block system %}` | `system` | System-role message (entity defs, instructions) |
| `{% block user %}` | `user` | User messages |
| `{% block char %}` | `assistant` | Entity/character messages |

Blocks work inside for loops and conditionals (a Nunjucks extension over Jinja2), so `{% block user %}` and `{% block char %}` can appear inside a history loop:

```
{% block system %}
You are {{ entities[0].name }}.
{{ entities[0].facts | join("\n") }}
{% endblock %}

{% for msg in history %}
  {% if msg.role == "assistant" %}
    {% block char %}{{ msg.author }}: {{ msg.content }}{% endblock %}
  {% else %}
    {% block user %}{{ msg.author }}: {{ msg.content }}{% endblock %}
  {% endif %}
{% endfor %}
```

**Behavior:**
- Each block renders into a message with the corresponding LLM role
- Blocks inside for loops produce one message per iteration
- Empty blocks (whitespace-only) are filtered out
- Content outside any role block is ignored
- If no role blocks are present, the entire output is the system prompt (legacy behavior)

**Overriding blocks via inheritance:** Use `{% extends "entity-name" %}` and `{{ super() }}` to override specific role blocks while inheriting the rest:

```
{% extends "base-entity" %}
{% block system %}
Custom system prompt for {{ entities[0].name }}.
{{ super() }}
{% endblock %}
```

**Security:** Role blocks are wrapped with cryptographic nonce markers (256-bit random hex) at render time. Template context values are strings, not template code — Discord user messages containing marker-like text cannot trigger the parser.

### Template Inheritance

Templates can inherit from other entities' templates:

```
{% extends "base-entity-name" %}

{% block custom_section %}
Custom content here
{% endblock %}
```

The parent template is loaded by looking up the entity by name and reading its template. The child template overrides parent `{% block %}` sections. Nunjucks provides built-in circular inheritance detection.

**Note:** The parent template runs with the same context as the child (entities, history, etc. come from the current render call, not from the parent entity).

### Full Prompt Control

When a template uses role blocks (`{% block system %}`, `{% block user %}`, `{% block char %}`), its output is parsed into a structured system prompt + message array. Without role blocks, the entire output is the system prompt and only the latest message is sent as user content. The built-in default template uses role blocks to produce proper role-based chat messages.

```
{% block system %}
You are {{ entities[0].name }}.
{% endblock %}
{% for msg in history %}
  {% if msg.role == "assistant" %}
    {% block char %}{{ msg.author }}: {{ msg.content }}{% endblock %}
  {% else %}
    {% block user %}{{ msg.author }}: {{ msg.content }}{% endblock %}
  {% endif %}
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
{# Custom system prompt template #}
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

{# Include message history with formatting #}
Recent conversation:
{% for msg in history %}
{{ msg.author }}: {{ msg.content }}
{% endfor %}
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

The following Nunjucks features are not yet available and will be implemented in a future update:

- `{% include %}` — template inclusion
- `{% macro %}` — reusable template macros
- `{% set %}` — variable assignment

## Known Limitations

Templates are per-entity and control the entire system prompt. A template on one entity could manipulate how other entities' facts are presented **in the same LLM call** (when entities share the same template). Mitigation:

- Template-based grouping separates entities with different templates
- Only the entity owner/editors can set a template (same permission model as facts)
- Entities sharing a template are presumed to be managed by the same owner

</div>
