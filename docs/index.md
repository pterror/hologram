---
layout: home

hero:
  name: Hologram
  text: Collaborative Worldbuilding
  tagline: A Discord bot where everything is an entity with facts
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: View on GitHub
      link: https://github.com/pterror/hologram

features:
  - icon: 🎭
    title: Everything is an Entity
    details: Characters, locations, items - all entities with attached facts. No rigid schemas, just flexible descriptions.
  - icon: 🔗
    title: Simple Bindings
    details: Bind channels to characters for AI responses. Bind yourself to a persona to speak as different characters.
  - icon: ⚡
    title: Conditional Logic
    details: Use $if expressions for random effects, time-based behavior, and dynamic facts.
  - icon: ✨
    title: Transformations
    details: Characters can change form with TF items, gradual progress tracking, and saved loadouts.
---

## Quick Example

```
Entity: Aria
Facts:
  - is a character
  - has silver hair and violet eyes
  - works as a traveling merchant
  - speaks with a slight accent
  - is cautious around strangers
```

Bind Aria to a channel, and she'll respond based on her facts. That's it.

## Transformation Example

```
Entity: Vulpine Elixir
Facts:
  - is a transformation potion
  - grants fox ears (orange with white tips)
  - grants a fluffy fox tail
  - $if random(0.3): grants soft fur on arms
  - is consumed on use
```

Items can have guaranteed and random effects. The character's body facts update when used.

## Getting Started

1. **Create a character**: `/c character Aria`
2. **Add personality**: `/e Aria` → Add facts describing who Aria is
3. **Bind to channel**: `/b channel Aria`
4. **Chat**: Just talk - Aria responds in character

[Read the full guide →](/guide/)
