# SillyTavern Migration Guide

This guide helps SillyTavern (ST) users migrate their character cards and workflows to Hologram's entity-facts model.

## Conceptual Differences

SillyTavern uses a **character card** model: a single structured card with fixed fields (description, personality, scenario, first message, example dialogue). Each card is a self-contained character definition loaded into one chat.

Hologram uses an **entity-facts** model: every entity (character, location, item, concept) is a flat list of freeform facts. There are no fixed fields. Facts can include behavioral directives (`$respond`, `$stream`, `$if`), and entities can reference each other with `{{entity:ID}}`. Multiple entities can be bound to a single Discord channel and respond simultaneously.

Key differences:

- **Server-side only.** Hologram is a Discord bot. There is no local UI -- interaction happens in Discord channels.
- **No fixed fields.** Description, personality, scenario are all just facts. You write them however you want.
- **Multiple entities per channel.** Bind several characters to one channel and they all participate. ST group chats require manual configuration; Hologram handles it natively.
- **Identity via Discord webhooks.** Each entity posts as a separate Discord user (name + avatar), not as the bot itself.
- **LLM can modify facts.** The LLM has tools to add, update, and remove facts on entities during conversation (unless locked with `$locked`).
- **No local model support.** Hologram uses cloud LLM providers (Google, Anthropic, OpenAI, etc.) via the AI SDK.

## Macro Equivalence

### Direct Equivalents

| SillyTavern Macro | Hologram Equivalent | Notes |
|---|---|---|
| `{{char}}` | `{{char}}` | Expands to current entity name |
| `{{user}}` | `{{user}}` | Expands to literal "user" |
| `{{group}}` | `{{group}}` | Comma-separated names of all characters bound to channel |
| `{{groupNotMuted}}` | `{{groupNotMuted}}` | Names of entities that are currently responding (have `$respond` active) |
| `{{charIfNotGroup}}` | `{{charIfNotGroup}}` | Entity name if solo, empty string if multiple entities in channel |
| `{{notChar}}` | `{{notChar}}` | Comma-separated names of other entities in channel (excludes current) |
| `{{time}}` | `{{time}}` | Current time (e.g. "6:00:00 PM") |
| `{{date}}` | `{{date}}` | Current date (e.g. "Thu Jan 30 2026") |
| `{{weekday}}` | `{{weekday}}` | Day of week (e.g. "Thursday") |
| `{{isotime}}` | `{{isotime}}` | ISO time "18:00" |
| `{{isodate}}` | `{{isodate}}` | ISO date "2026-01-30" |
| `{{idle_duration}}` / `{{idleDuration}}` | `{{idle_duration}}` / `{{idleDuration}}` | Human-readable time since last message in channel |
| `{{lastMessage}}` | `{{lastMessage}}` | Last message in channel (formatted as "author: content") |
| `{{lastUserMessage}}` | `{{lastUserMessage}}` | Last user (non-entity) message |
| `{{lastCharMessage}}` | `{{lastCharMessage}}` | Last entity message |
| `{{model}}` | `{{model}}` | Current model spec (e.g. "google:gemini-3-flash-preview") |
| `{{maxPrompt}}` | `{{maxPrompt}}` | Context character limit (default 16000) |
| `{{newline}}` / `{{newline::N}}` | `{{newline}}` / `{{newline::N}}` | Insert newline(s) |
| `{{space}}` / `{{space::N}}` | `{{space}}` / `{{space::N}}` | Insert space(s) |
| `{{noop}}` | `{{noop}}` | Expands to empty string |
| `{{trim}}` | `{{trim}}` | Trims whitespace around the fact after expansion |
| `{{random:A,B,C}}` | `{{random:A,B,C}}` | Random item from comma-separated list |
| `{{roll:2d6}}` | `{{roll:2d6}}` | Dice roll (supports `2d6+3`, `4d6kh3`, `1d6!`, `8d6>=5`) |

### Expression Macros (Hologram-Specific)

Any expression can be used inside `{{...}}`. These have no ST equivalent but extend what macros can do:

| Hologram Macro | Description |
|---|---|
| `{{self.health}}` | Value of a `key: value` fact on the entity (e.g. fact `health: 50`) |
| `{{channel.name}}` | Current Discord channel name |
| `{{channel.description}}` | Channel topic/description |
| `{{server.name}}` | Discord server name |
| `{{name}}` | This entity's name (same as `{{char}}`) |
| `{{messages(5)}}` | Last 5 messages formatted as "author: content" |
| `{{messages(3, "%m")}}` | Last 3 messages, content only |
| `{{duration(idle_ms)}}` | Format milliseconds as human-readable duration |

### Not Applicable

These ST macros have no Hologram equivalent because they reference ST-specific concepts:

| SillyTavern Macro | Reason |
|---|---|
| `{{description}}` | No fixed "description" field. Write description facts directly. |
| `{{personality}}` | No fixed "personality" field. Write personality facts directly. |
| `{{scenario}}` | No fixed "scenario" field. Use facts or a separate scenario entity. |
| `{{persona}}` | No user persona card. Users speak as themselves or bind a persona entity. |
| `{{mesExamples}}` | No separate example dialogue field. Use facts for examples. |
| `{{lastMessageId}}` | Message IDs are internal to Discord, not exposed in facts. |
| `{{summary}}` | No built-in summarization. Use `$memory` for persistent recall. |
| `{{isMobile}}` | Server-side bot; client device is irrelevant. |
| `{{systemPrompt}}` | System prompt is auto-built from entity facts. Not directly editable. |
| `{{input}}` | No input field. Messages come from Discord. |
| `{{banned::word}}` | No token banning. Constrain behavior via facts instead. |
| Instruct macros (`{{instructSystem}}`, etc.) | Prompt formatting is handled by the LLM provider, not user-configurable. |

## Pattern Conversions

### Character Card to Entity + Facts

A SillyTavern character card:

```
Name: Aria
Description: A silver-haired elf who guards the northern forest.
Personality: Stoic, loyal, wary of strangers.
Scenario: Aria is stationed at the forest gate.
First Message: *Aria raises her bow.* "State your purpose."
```

Becomes a Hologram entity created with `/create Aria`, then `/edit Aria`:

```
is a silver-haired elf who guards the northern forest
is stoic, loyal, and wary of strangers
is stationed at the forest gate
$respond
```

There is no "first message" field. The entity responds when users message in the bound channel. To set a greeting behavior, use a conditional:

```
$if idle_ms > 3600000: greets newcomers with "*raises her bow.* State your purpose."
```

### Example Dialogue to Facts

ST example dialogue:

```
<START>
{{user}}: What's your name?
{{char}}: *adjusts her bow* I am Aria, warden of the northern gate.
<START>
{{user}}: Are you friendly?
{{char}}: *narrows her eyes* That depends entirely on your intentions.
```

In Hologram, example dialogue is not a separate section. Instead, express the behavioral patterns as facts:

```
speaks formally and with suspicion toward strangers
uses action descriptions between asterisks
refers to herself as "warden of the northern gate"
```

If you want to preserve exact example exchanges, include them as a fact:

```
example dialogue: User: "What's your name?" Aria: "*adjusts her bow* I am Aria, warden of the northern gate."
```

### Author's Note to Facts

ST author's notes inject text at a specific depth in the context. In Hologram, all facts are part of the system prompt. Write the same guidance as a fact:

```
[Write 2-3 paragraphs per response. Focus on sensory details.]
```

Facts are always in the system prompt, so there is no depth configuration.

### World Info / Lorebook to Entities

ST world info entries with keywords and conditional activation map to Hologram's entity reference system.

A ST world info entry:

```
Keywords: northern forest, gate, border
Content: The northern forest is an ancient woodland...
```

Becomes a Hologram entity created with `/create Northern Forest`, then `/edit Northern Forest`:

```
is an ancient woodland at the kingdom's border
is guarded by elven wardens
the gate is the only safe passage through
```

Then reference it from character facts:

```
guards {{entity:15}}
```

Where `15` is the Northern Forest entity's ID. The `{{entity:15}}` macro expands to the entity name and pulls its facts into the LLM context automatically.

For conditional inclusion (like ST's keyword activation), use `$if`:

```
$if content.includes("forest"): the northern woods are ancient and dangerous
```

## Quick Reference: ST Workflow to Hologram

| SillyTavern | Hologram |
|---|---|
| Import character card | `/create Name`, then `/edit Name` to add facts |
| Set description/personality | Add facts (no field distinction) |
| Set scenario | Add facts, or create a location entity and reference with `{{entity:ID}}` |
| Configure greeting | Use `$if idle_ms > N:` conditional fact |
| Add world info | Create entities, reference with `{{entity:ID}}` |
| Set up group chat | `/bind #channel Entity1`, `/bind #channel Entity2` |
| Choose model | Set `$model provider:model` as a fact |
| Adjust context size | Set `$context 32k` as a fact |
| Lock character from edits | Add `$locked` as a fact |
| Set response trigger | Add `$respond` or `$if mentioned: $respond` as facts |
