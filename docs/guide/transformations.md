# Transformations

Hologram supports transformation (TF) content - characters can change form, gain or lose traits, and use items with transformative effects.

## How It Works

Transformations use the same entity-facts system as everything else:

1. **Body traits are facts** on the character
2. **TF items** have effects that add/remove/change traits
3. **The LLM** interprets effects and updates facts accordingly

## Character Body Facts

Describe your character's body as facts:

```
Entity: Lyra
Facts:
  is a character
  has shoulder-length black hair
  has green eyes
  has human ears
  has no tail
  has smooth tan skin
  has an average build
```

When transformations happen, these facts get updated.

## Transformation Items

TF items describe their effects as prose:

```
Entity: Vulpine Elixir
Facts:
  is an item
  is a transformation potion
  is a small vial of shimmering orange liquid
  smells faintly of cinnamon
  grants fox ears (orange fur with white tips)
  grants a bushy fox tail (3ft, fluffy)
  $if random(0.3): grants soft fur on arms and legs
  $if random(0.1): grants digitigrade legs with paw pads
  is consumed on use
```

When used:
- Guaranteed effects always apply (fox ears, tail)
- Random effects roll for chance (fur 30%, legs 10%)
- The LLM updates the character's body facts

## After Transformation

```
Entity: Lyra
Facts:
  is a character
  has shoulder-length black hair
  has green eyes
  has large fox ears (orange fur with white tips)
  has a bushy fox tail (3ft, very fluffy)
  has soft orange fur on arms and legs
  has smooth tan skin on torso
  has an average build
```

The old `has human ears` and `has no tail` facts are replaced.

## Loadouts (Saved Forms)

A loadout is just a TF item that isn't consumed:

```
Entity: Lyra's Fox Form
Facts:
  is an item
  is a body loadout
  grants fox ears (orange with white tips)
  grants fox tail (3ft, fluffy)
  grants fur on arms and legs
  removes human ears
  is not consumed on use
```

"Applying" a loadout = using the item. The LLM reads the grants/removes and updates the character.

To save your current form: create a new item with your body traits as `grants X` effects.

## Gradual Transformations

For transformations that happen over time, track progress:

```
Entity: Lyra
Facts:
  is a character
  fox_tf: 0.3
  $if self.fox_tf >= 0.2: has fur emerging on forearms
  $if self.fox_tf >= 0.5: has full fur on arms and legs
  $if self.fox_tf >= 0.8: has fox ears replacing human ears
  $if self.fox_tf >= 1.0: fox transformation complete
```

The LLM can increment `fox_tf` as the story progresses.

## Temporary Effects

Some transformations wear off. These are tracked as effects with duration:

```
Effect: Vulpine Ears (temporary)
  duration: 1 hour
  grants: fox ears (orange with white tips)
```

While active, the effect's facts merge with the character's facts. When it expires, they're removed.

## TF Playground

Create a location for testing transformations:

```
Entity: The Transformation Chamber
Facts:
  is a location
  is a private testing room
  contains a Vulpine Elixir dispenser (infinite supply)
  contains a Feline Serum fountain (infinite supply)
  items here regenerate after use
  transformations here are temporary (revert on exit)
```

## Tips

- **Be specific**: "large fluffy fox ears (orange with white tips)" not just "fox ears"
- **Track partial states**: "has fur on forearms but not hands yet"
- **Include sensations**: "ears twitch when excited", "tail wags unconsciously"
- **Note what's removed**: When ears change, the old ears are gone

The LLM handles the narrative - you just describe what exists.
