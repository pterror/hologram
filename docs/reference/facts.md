# Fact Patterns Reference

Facts are freeform text attached to entities. Most facts are just descriptions, but some patterns have special meaning.

## Entity Types

Declare what kind of entity this is:

```
is a character
is a location
is a item
is a concept
```

These are conventions - the system doesn't enforce types.

## Location / Containment

Describe where something is:

```
is in {{entity:12}}
is in {{entity:12}} (The Tavern)
```

The <code v-pre>{{entity:N}}</code> syntax references another entity by ID. The parenthetical note is optional but helpful for readability.

## Macros

Special patterns that expand when facts are processed:

### Core Macros

| Macro | Expands To |
|-------|------------|
| <code v-pre>{{entity:ID}}</code> | Entity name with ID (e.g., "Aria [#12]") |
| <code v-pre>{{char}}</code> | Current entity's name |
| <code v-pre>{{user}}</code> | Literal "user" |
| <code v-pre>{{expression}}</code> | Any valid expression result |

### Date/Time Macros

| Macro | Expands To |
|-------|------------|
| <code v-pre>{{date}}</code> | Current date (e.g., "Thu Jan 30 2026") |
| <code v-pre>{{time}}</code> | Current time (e.g., "6:00:00 PM") |
| <code v-pre>{{weekday}}</code> | Day of week (e.g., "Thursday") |
| <code v-pre>{{isodate}}</code> | ISO date (e.g., "2026-01-30") |
| <code v-pre>{{isotime}}</code> | ISO time (e.g., "18:00") |

### Context Macros

| Macro | Expands To |
|-------|------------|
| <code v-pre>{{group}}</code> | All bound character names (comma-separated) |
| <code v-pre>{{model}}</code> | Current LLM model spec |
| <code v-pre>{{maxPrompt}}</code> | Context character limit |
| <code v-pre>{{idle_duration}}</code> | Human-readable idle time (e.g., "5 minutes") |
| <code v-pre>{{charIfNotGroup}}</code> | Entity name if solo, empty if group |
| <code v-pre>{{notChar}}</code> | All bound chars except current entity |
| <code v-pre>{{groupNotMuted}}</code> | Names of responding entities only |

### Message History Macros

| Macro | Expands To |
|-------|------------|
| <code v-pre>{{lastMessage}}</code> | Last message (author: content) |
| <code v-pre>{{lastUserMessage}}</code> | Last human message |
| <code v-pre>{{lastCharMessage}}</code> | Last entity/bot message |

### Parameterized Macros

| Macro | Expands To |
|-------|------------|
| <code v-pre>{{random: A,B,C}}</code> | Random item from comma-separated list |
| <code v-pre>{{roll: 2d6+3}}</code> | Dice roll (roll20 syntax: kh, kl, dh, dl, !, >=) |
| <code v-pre>{{newline}}</code> | Single newline |
| <code v-pre>{{newline::N}}</code> | N newlines |
| <code v-pre>{{space}}</code> | Single space |
| <code v-pre>{{space::N}}</code> | N spaces |

### Utility Macros

| Macro | Expands To |
|-------|------------|
| <code v-pre>{{noop}}</code> | Empty string (useful in conditionals) |
| <code v-pre>{{trim}}</code> | Trims whitespace from the fact |

### Examples

```
{{char}} loves adventure
refers to the player as {{user}}
is friends with {{entity:5}}
is currently in {{channel.name}}
has {{self.health}} health points
the current date is {{date}}
group members: {{group}}
{{random: happy, sad, excited, pensive}} mood today
rolled a {{roll: 1d20}} for initiative
```

For a character named "Aria", the first fact would expand to "Aria loves adventure".

Any valid expression works inside <code v-pre>{{}}</code> — including `self.*`, `channel.*`, `server.*`, and function calls. If the expression errors, the original <code v-pre>{{}}</code> text is kept.

## Response Control

Control when the entity responds (see [Response Control](/reference/triggers)):

```
$respond
$respond false
$if mentioned: $respond
$if random() < 0.1: $respond
$if content.match(/hello/i): $respond
```

## Conditional Facts

Facts can be conditional using `$if`:

```
$if time.is_night: glows faintly
$if random() < 0.3: is in a good mood
$if self.energy > 0.5: seems energetic
```

## Writing Good Facts

### Be Specific

```
# Good
has a jagged scar running from left eyebrow to cheek
carries a leather-bound journal filled with sketches

# Vague
has scars
has a journal
```

### Use Present Tense

```
# Good
is cautious around strangers
speaks with a slight accent

# Past tense (avoid)
was once a soldier
used to live in the mountains
```

If past events matter, frame them as present knowledge:

```
remembers serving as a soldier
still carries habits from mountain life
```

### Include Personality

```
speaks formally and chooses words carefully
tends to ramble when nervous
laughs easily but rarely smiles
avoids eye contact with authority figures
```

### Note Relationships

```
is friends with {{entity:5}} (Marcus)
distrusts the city guard
is loyal to the merchant guild
owes a debt to {{entity:8}}
```

### Describe Appearance

```
has silver hair tied in a loose braid
wears a faded blue cloak
is tall and thin
has calloused hands from years of smithing
```

### Include Knowledge

```
knows the secret paths through the forest
can identify most herbs by smell
speaks three languages
has memorized the city's patrol schedules
```

### Note Possessions

```
carries a worn leather satchel
owns a small shop on Market Street
wears a ring given by their mother
keeps a hidden dagger in their boot
```

## Example: Complete Character (Structured)

```
is a character
is named Aria
has silver hair and violet eyes
is a traveling merchant in her late twenties
speaks with a slight eastern accent
is cautious around strangers but warms up quickly
carries a worn leather satchel full of trinkets
knows the value of most trade goods by sight
remembers the war that destroyed her hometown
is looking for her lost brother
is currently staying at {{entity:12}} (The Crossroads Inn)
```

## Example: Complete Character (SillyTavern Style)

You can also use a single prose description instead of discrete facts. This works fine, though it's harder to update individual details later:

```
is a character
Aria is a traveling merchant in her late twenties with silver hair and violet eyes. She speaks with a slight eastern accent, likely from the provinces beyond the mountains. Cautious around strangers but warms up quickly once trust is established, she has a talent for reading people and situations. She carries a worn leather satchel full of trinkets and oddities collected from her travels, and always seems to know the exact value of anything she sees. The war that destroyed her hometown left her searching for her lost brother, following rumors and leads wherever they take her. Currently staying at the Crossroads Inn while she gathers supplies for the next leg of her journey.
```

Both approaches work - use whichever fits your style. Discrete facts are easier to modify piece by piece; prose descriptions are faster to write if you already have a character in mind.

## Example: Location

```
is a location
is named The Rusty Anchor
is a tavern on the harbor district
smells of salt air and spilled ale
is dimly lit by oil lamps
has a reputation for discretion
is owned by {{entity:15}} (One-Eyed Pete)
is where sailors gather to trade rumors
has a secret room in the cellar
```

## Example: Item

```
is a item
is named Moonblade
is an ancient elven sword
glows faintly in darkness
was forged during the Second Age
is currently carried by {{entity:3}} (Aria)
is said to reveal hidden truths
```

## Body Descriptions & Transformations

For characters with detailed or changing bodies (TiTS-style), keep all body facts on the character entity. This lets the LLM see and modify everything in one place.

### Basic Body Description

```
is a character
has shoulder-length black hair
has green eyes
has human ears
has no tail
has smooth tan skin
has an average build
```

### Detailed Body Description

```
is a character
has long silver hair, usually braided
has heterochromatic eyes (left blue, right gold)
has pointed elven ears
has a slender athletic build
has pale smooth skin
has small breasts
has a feminine figure with wide hips
```

### After Transformation

When a transformation occurs, the LLM updates the relevant facts:

```
is a character
has long silver hair, usually braided
has heterochromatic eyes (left blue, right gold)
has large fluffy fox ears (orange fur with white tips)
has a slender athletic build
has soft orange fur covering arms and legs
has smooth pale skin on torso
has a bushy fox tail (3ft long, very fluffy, orange with white tip)
has small breasts
has a feminine figure with wide hips
has digitigrade legs with padded paws
```

### Transformation Items

Describe TF items with their effects:

```
is a item
is named Vulpine Elixir
is a transformation potion
is a small vial of shimmering orange liquid
smells faintly of cinnamon
effects: grants fox ears and tail
effects: spreads soft fur on extremities
effects: may cause digitigrade leg transformation (uncommon)
effects: increases hearing sensitivity
is consumed on use
```

### Tips for Body Facts

- **Be specific**: "large fluffy fox ears (orange with white tips)" not just "fox ears"
- **Note changes**: When something transforms, update or replace the old fact
- **Keep related facts together**: All ear facts, all tail facts, etc.
- **Include sensations**: "ears twitch when excited", "tail wags unconsciously"
- **Track partial states**: "has fur on forearms but not hands yet"

The LLM will use `add_fact`, `update_fact`, and `remove_fact` tools to track changes as transformations happen in the story.
