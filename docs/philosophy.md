# Design Philosophy

This document captures the reasoning behind Hologram's architecture decisions.

## Core Premise: Everything is an Entity

There is no fundamental distinction between characters, locations, items, or concepts. All are entities with attached facts. The "type" of something emerges from its facts, not from a schema.

```
Entity: Aria
Facts:
  - is a character
  - has silver hair
```

```
Entity: The Tavern
Facts:
  - is a location
  - smells of ale and woodsmoke
```

**Why?** Rigid schemas create friction. What if something is both a character and an item (a sentient sword)? What if a location can move (a ship)? The entity-facts model handles edge cases naturally - just add the relevant facts.

## Facts are Prose, Not Structure

Facts are freeform natural language, not structured data.

```
# Good - prose the LLM can read naturally
has large fluffy fox ears (orange fur with white tips)
has a bushy fox tail, about 3 feet long

# Bad - structured syntax adds parsing overhead
body:ears: type=fox, color=orange, size=large, fluffy=true
body:tail: type=fox, length=3ft
```

**Why?** LLMs work best with prose. Structured syntax requires the model to parse format AND understand meaning. Prose lets it focus on meaning. The model reads "has fluffy orange fox ears" the same way a human would.

## Colocation Over Fragmentation

Keep related information together on one entity rather than splitting across multiple linked entities.

```
# Good - all body facts on the character
Entity: Aria
Facts:
  - has fox ears
  - has a fox tail
  - has fur on arms

# Bad - body parts as separate entities
Entity: Aria
Facts:
  - has body part {{entity:20}}
  - has body part {{entity:21}}

Entity: Aria's Ears (id: 20)
Facts:
  - type: fox
  - color: orange
```

**Why?** The fragmented approach requires multiple "leaps in logic" - the LLM must fetch multiple entities, understand their relationships, then coordinate changes across them. The colocated approach shows everything in one context. The LLM sees all body facts together, reasons about them together, modifies them in place.

This isn't about engineering complexity - the nested approach isn't "overengineered". It's about cognitive load for the LLM. Fragmented data is harder to reason about.

## Composable Primitives Over Enums

Configuration uses composable boolean/numeric conditions rather than enum modes.

```
# Good - composable conditions
$if mentioned: $respond
$if random() < 0.1: $respond

# Bad - enum modes
response_mode: mention_or_random
```

**Why?** Enums force predefined combinations. "What if you want mention + random?" With composable primitives, you just add both conditions. New combinations emerge without code changes.

## Dogfooding

Use the system to build the system. Help is an entity with facts, not special-cased code.

```
Entity: help
Facts:
  - is the help system
  - topics: start, commands, response control...

Entity: help:triggers
Facts:
  - is help for response control
  - $if <condition>: $respond
  ...
```

**Why?** If the abstraction is good enough, it should be good enough for our own use. Dogfooding validates the design and keeps us honest about ergonomics.

## No Cutting Corners

If state needs to persist, use the database. No "resets on restart is fine" or in-memory shortcuts.

```
# Bad - in-memory tracking
const welcomedUsers = new Set<string>();
// "resets on restart, that's fine"

# Good - database table
CREATE TABLE welcomed_users (
  discord_id TEXT PRIMARY KEY,
  welcomed_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Why?** Shortcuts accumulate. Each one is "fine" in isolation, but together they create a fragile system that behaves differently after restarts, loses user state, and is hard to reason about. Do it right the first time.

## Flexibility in Expression

Support multiple styles for the same thing. Don't force one "correct" way.

```
# Discrete facts - easy to modify piece by piece
is a character
has silver hair
has violet eyes
is cautious around strangers

# Prose description - faster to write, SillyTavern style
is a character
Aria is a traveling merchant with silver hair and violet eyes. She's cautious around strangers but warms up quickly once trust is established.
```

**Why?** Users have different preferences and existing content. Some have character cards written as prose. Some prefer structured facts. Both should work. The system shouldn't impose style preferences.

## LLM as Actor, Not Parser

The LLM's job is to understand and respond, not to parse structured formats or follow complex protocols.

- Give it prose it can read naturally
- Give it tools with clear semantics
- Let it decide what to do based on understanding, not format matching

**Why?** LLMs are good at language understanding and generation. They're mediocre at following rigid syntactic rules. Play to their strengths.

## LLM Interpretation: Messy but Pragmatic

Some things rely on LLM interpretation rather than deterministic parsing:

```
# TF item effects - LLM interprets these
grants fox ears (orange with white tips)
removes human ears
```

The LLM reads "grants fox ears", understands it should add a fox ears fact to the character, and calls the appropriate tool. This is **messy** - the LLM might interpret things inconsistently, miss edge cases, or hallucinate details.

**Why accept it?** The alternative is a full scripting system with explicit commands:

```
# Hypothetical explicit scripting
$add_fact target: grants fox ears
$remove_fact target: has human ears
```

This is more reliable but adds complexity: another syntax to learn, more parsing code, edge cases around targeting and conditions. For now, LLM interpretation is the lesser evil - it works well enough and keeps the system simple.

**Future option:** If interpretation problems accumulate, we can add optional explicit scripting. But only if the pain justifies the complexity. Don't prematurely optimize for precision we don't need yet.

## Randomness Requires System Support

LLMs can't generate true randomness. For chance-based mechanics (TF item effects, random events), the system must provide randomness via tools.

```typescript
roll_effects({ effects: [
  { chance: 1.0, desc: "fox ears" },
  { chance: 0.3, desc: "digitigrade legs" },
]}) -> { results: [true, false] }
```

**Why?** If you tell an LLM "roll for 30% chance", it will either always succeed, always fail, or pick based on narrative preference - not true randomness. The system rolls, the LLM applies the results.

### Two Timing Contexts

Randomness appears in two places with different timing:

1. **Response control** (before LLM): `$if random() < 0.1: $respond`
   - System evaluates before deciding to invoke LLM
   - LLM never sees this - it either gets called or doesn't

2. **In-response rolls** (during LLM): TF effects, loot drops, skill checks
   - LLM is generating a response and needs a random outcome
   - Must call a tool to get true randomness

Same random mechanic, different entry points. Response control gates LLM invocation; tools provide randomness during generation.

## Conditions are Evaluated, Not Interpreted

Response conditions are evaluated by the system, not left to LLM interpretation.

```
$if random() < 0.1: $respond
```

The system rolls the 10% chance, not the LLM. The LLM doesn't see "maybe respond 10% of the time" - it either gets asked to respond or it doesn't.

**Why?** Consistency and predictability. If the LLM interprets "10% chance", you get varying behavior based on mood, context, and model. System evaluation gives consistent behavior.

## Logic via $if Expressions

Facts are data. But sometimes facts are conditional - they only apply when certain conditions are true. Rather than a custom DSL or embedded scripting, we use restricted JavaScript boolean expressions.

```
# Character definition
is a character
has silver hair

# Conditional traits
$if random() < 0.3: has fox ears
$if time.is_night: eyes glow faintly

# Response control
$if mentioned: $respond
$if response_ms >= 30000 && random() < 0.1: $respond
$if retry_ms < 1000: $respond false
```

### Why JS Expressions?

- **Known syntax** - not a custom DSL to learn
- **Composable** - `&&`, `||`, `!` combine naturally
- **Safe** - restricted to boolean expressions, no loops/assignment
- **Performant** - compiled once, cached, fast evaluation

### The Problem We're Solving

We need logic. Options considered:

1. **LLM as logic layer** - describe intent, LLM executes. *Rejected: indirection causes hallucination when deterministic logic is available.*

2. **Custom DSL** - invent syntax for conditions. *Rejected: another language to learn and maintain.*

3. **Full scripting (Lua/JS)** - powerful but sandbox security is hard. *Rejected: complexity and risk.*

4. **Structured data** - enums for condition types. *Rejected: opaque, doesn't nest, hard to fit in facts.*

5. **Restricted JS expressions** - boolean expressions with safe globals. *Chosen.*

### Context Variables

Expressions have access to:

```typescript
interface ExprContext {
  // Entity's own "key: value" facts, parsed
  self: Record<string, string | number | boolean>;

  // Randomness
  random: (chance: number) => boolean;
  roll: (dice: string) => number;

  // Entity state
  has_fact: (pattern: string) => boolean;

  // Time
  time: { hour: number; is_day: boolean; is_night: boolean };
  response_ms: number;       // ms since last response in channel
  retry_ms: number;  // ms since triggering message
  unread_count: number;      // messages since this entity's last reply

  // Message context
  mentioned: boolean;
  content: string;
  author: string;

  // Interaction context (for items)
  interaction_type?: string;
}
```

Facts matching `key: value` pattern are parsed into `self`:

```
fox_tf: 0.3           → self.fox_tf = 0.3
is_poisoned: true     → self.is_poisoned = true
name: Aria            → self.name = "Aria"
```

### Line Position

`$if` directives are only recognized at the start of a line (leading whitespace is trimmed). This means regular facts can mention the syntax without being interpreted as conditionals:

```
# This is a conditional - $if at start
$if mentioned: $respond

# This is a regular fact - $if not at start
Instructions can use $if syntax like: $if mentioned: $respond
```

This allows entities to contain instructions or documentation about the syntax without triggering evaluation.

### $respond Directive

The `$respond` directive controls whether to respond. Evaluated top to bottom, last fired value wins:

- **No `$respond` in facts** → respond by default
- **`$respond`** or **`$respond true`** → respond
- **`$respond false`** → don't respond

```
# Only respond when mentioned
$if mentioned: $respond

# Respond to mentions OR randomly, but not too fast
$if mentioned: $respond
$if random() < 0.1: $respond
$if retry_ms < 1000: $respond false

# Respect mute
$if has_fact("muted"): $respond false
```

### $retry Directive

The `$retry <ms>` directive schedules a re-evaluation after the specified delay. Useful for delayed responses:

```
# Wait 5 seconds before responding
$if retry_ms < 5000: $respond false
$if retry_ms < 5000: $retry 5000

# Throttle: don't respond if we responded recently, but retry later
$if response_ms < 30000: $respond false
$if response_ms < 30000: $retry 30000
```

When `$retry` fires, evaluation stops immediately and the system schedules a re-evaluation.

This replaces `trigger:`, `delay_ms`, `throttle_ms` with two primitives:

```
# Old
trigger: mention -> respond
trigger: random 0.1 -> respond
delay_ms: 5000
throttle_ms: 30000

# New
$if mentioned: $respond
$if random() < 0.1: $respond
$if retry_ms < 5000: $respond false
$if retry_ms < 5000: $retry 5000
$if response_ms < 30000: $respond false
$if response_ms < 30000: $retry 30000
```

### Comments

Lines starting with `$#` in the first column are comments:

```
$# This is a comment
is a character
 $# This is NOT a comment (starts with space)
plays #1 hits
```

### Processing Model

1. Message arrives, add to buffer
2. Evaluate all `$if` conditions with current context
3. Collect results:
   - `$respond` / `$respond true` → flag respond
   - `$respond false` → flag no-respond (overrides)
   - text → add to facts
4. If should respond (and no `$respond false`):
   - Call LLM with collected facts

Delay is handled via `retry_ms` - re-evaluate periodically until condition passes or times out.

## Progressive Complexity

Simple things should be simple. Complex things should be possible.

```
# Simple - create and bind a character
/create Aria
/bind channel Aria

# Complex - detailed character with custom response control
/create Aria
/edit Aria
  is a character
  has human ears
  has no tail
  $if mentioned: $respond
  $if content.match(/aria|merchant/i): $respond
  $if random() < 0.1 && response_ms > 30000: $respond
```

**Why?** New users shouldn't face a wall of configuration. Start simple, add complexity as needed. The same system handles both cases.
