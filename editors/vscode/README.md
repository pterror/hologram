# Hologram VS Code Extension

Syntax highlighting for Hologram entity facts (`.holo`) and Nunjucks templates (`.njk`).

## Install

Symlink for development:

```bash
ln -s $(pwd)/editors/vscode ~/.vscode/extensions/hologram-syntax
```

## `.holo` — Entity Facts

Highlights `$if` conditionals, directives (`$respond`, `$model`, `$stream`, `$context`, `$strip`, `$freeform`, `$locked`, `$memory`, `$retry`, `$avatar`), `{{macros}}`, key-value facts, strings, numbers, booleans, operators, and `$#` comments.

## `.njk` — Nunjucks Templates

Highlights Hologram-specific Nunjucks templates with awareness of all available context variables, filters, and functions.

### Nunjucks syntax

- `{# comment #}` — comment blocks
- `{{ expr }}` / `{{- expr -}}` — expression output with whitespace control
- `{% tag %}` / `{%- tag -%}` — control tags: `if`, `elif`, `else`, `endif`, `for`, `endfor`, `block`, `endblock`, `extends`, `call`, `endcall`, `macro`, `endmacro`, `set`

### Template context variables

| Variable | Type | Description |
|----------|------|-------------|
| `entities` | `[{id, name, facts}]` | Responding entities |
| `others` | `[{id, name, facts}]` | Referenced/user entities |
| `memories` | `{entity_id: string[]}` | Memories per entity |
| `entity_names` | `string` | Comma-separated responding entity names |
| `freeform` | `boolean` | True if any entity has `$freeform` |
| `history` | `[{author, content, role, ...}]` | Message history |
| `char` | `{id, name, facts}` | First responding entity |
| `user` | `{id, name, facts}` | User entity |
| `_single_entity` | `boolean` | True when one entity responding |

### Expression context variables

Inherited from `$if` expression evaluator — available in templates too:

| Variable | Type | Description |
|----------|------|-------------|
| `mentioned` | `boolean` | Bot was @mentioned |
| `replied` | `boolean` | Message is a reply to the bot |
| `replied_to` | `string` | Name of entity replied to |
| `is_forward` | `boolean` | Forwarded message |
| `is_self` | `boolean` | From entity's own webhook |
| `content` | `string` | Message content |
| `author` | `string` | Message author |
| `interaction_type` | `string` | Interaction type if applicable |
| `name` | `string` | Current entity name |
| `chars` | `string[]` | All character names bound to channel |
| `group` | `string` | Comma-separated character names |
| `response_ms` | `number` | Ms since last response |
| `retry_ms` | `number` | Ms since triggering message |
| `idle_ms` | `number` | Ms since any message |
| `unread_count` | `number` | Messages since this entity's last reply |

### Context objects (dot access)

- `self.*` — entity's key-value fact properties
- `channel.id`, `channel.name`, `channel.description`, `channel.is_nsfw`, `channel.type`, `channel.mention`
- `server.id`, `server.name`, `server.description`, `server.nsfw_level`
- `time.hour`, `time.is_day`, `time.is_night`

### Filters

`default`, `length`, `join`, `first`, `last`, `upper`, `lower`, `trim`, `nl2br`, `int`, `float`, `abs`, `round`, `reverse`, `sort`, `batch`

### Functions

`random()`, `has_fact()`, `roll()`, `messages()`, `duration()`, `mentioned_in_dialogue()`, `date_str()`, `time_str()`, `isodate()`, `isotime()`, `weekday()`, `send_as()`, `caller()`

### Loop variables

`loop.index`, `loop.index0`, `loop.first`, `loop.last`, `loop.length`, `loop.revindex`, `loop.revindex0`

### XML semantic tags

`<defs for="name" id="id">`, `<memories for="name" id="id">` — used in default template for entity definitions and memories.
