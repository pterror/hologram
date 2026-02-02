# Editor Setup

Hologram provides a VS Code extension for syntax highlighting entity facts and Nunjucks templates.

## VS Code

### Install

From the repository root:

```bash
ln -s $(pwd)/editors/vscode ~/.vscode/extensions/hologram-syntax
```

Restart VS Code after linking. The extension activates for `.holo` and `.njk` files.

### `.holo` — Entity Facts

<div v-pre>

Syntax highlighting for entity fact files, with support for:

- **Directives** — `$respond`, `$model`, `$stream`, `$context`, `$strip`, `$freeform`, `$locked`, `$memory`, `$retry`, `$avatar`
- **Conditionals** — `$if <expr>: <directive>`
- **Macros** — `{{char}}`, `{{entity:12}}`, `{{random: a,b,c}}`, `{{roll: 2d6}}`, `{{channel.name}}`, etc.
- **Key-value facts** — `key: value` pairs
- **Comments** — `$#` lines
- **Expressions** — strings, numbers, booleans, operators, functions, dot access

</div>

### `.njk` — Nunjucks Templates

<div v-pre>

Syntax highlighting for custom templates (the files in `src/templates/` and templates edited via `/edit entity type:Template`), with Hologram-specific awareness of:

- **Nunjucks syntax** — `{{ expr }}`, `{% tag %}`, `{# comment #}`, whitespace control (`{%- -%}`)
- **Control flow** — `if`/`elif`/`else`/`endif`, `for`/`endfor`, `block`/`endblock`, `extends`, `call`/`endcall`, `macro`/`endmacro`, `set`
- **Template context** — `entities`, `others`, `memories`, `history`, `char`, `user`, `entity_names`, `freeform`, `_single_entity`
- **Expression context** — `mentioned`, `replied`, `replied_to`, `is_forward`, `is_self`, `content`, `author`, `name`, `chars`, `group`, `response_ms`, `retry_ms`, `idle_ms`, `interaction_type`
- **Context objects** — `self.*`, `channel.*`, `server.*`, `time.*`
- **Filters** — `default`, `length`, `join`, `first`, `last`, `upper`, `lower`, `trim`, `nl2br`, `int`, `float`, `abs`, `round`, `reverse`, `sort`, `batch`
- **Functions** — `random()`, `has_fact()`, `roll()`, `messages()`, `duration()`, `mentioned_in_dialogue()`, `date_str()`, `time_str()`, `isodate()`, `isotime()`, `weekday()`, `send_as()`, `caller()`
- **Loop variables** — `loop.index`, `loop.index0`, `loop.first`, `loop.last`, `loop.length`
- **XML tags** — `<defs>`, `<memories>` with attributes

</div>

::: tip
See [Custom Templates](/reference/templates) for full template documentation, and [Triggers](/reference/triggers) for the complete expression context reference.
:::
