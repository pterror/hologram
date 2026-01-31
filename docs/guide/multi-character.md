# Multi-Character Scenes

Hologram supports multiple characters responding in the same channel, each with their own personality and appearance via Discord webhooks.

## Setup

### 1. Create Characters

Create each character as a separate entity:

```
/create Aria
/create Marcus
```

### 2. Add Facts

Edit each character with their distinct personality and traits:

```
/edit Aria
```

Facts for Aria:
```
is a character
has silver hair
is cheerful and optimistic
speaks with enthusiasm
```

```
/edit Marcus
```

Facts for Marcus:
```
is a character
is a gruff warrior
speaks tersely
distrusts magic
```

### 3. Bind to Channel

Bind multiple characters to the same channel:

```
/bind channel Aria
/bind channel Marcus
```

Both characters are now active in the channel.

## Response Behavior

### Who Responds?

Each character evaluates their `$respond` conditions independently. Common patterns:

**Respond when mentioned by name:**
```
$if content.toLowerCase().match("\\b" + name.toLowerCase() + "\\b"): $respond
```

**Respond when @mentioned or replied to:**
```
$if mentioned || replied: $respond
```

**Only respond if alone in channel:**
```
$if chars.length === 1: $respond
```

### Response Format

When multiple characters respond, the AI uses `Name:` prefixes to separate their dialogue:

```
Aria: *waves excitedly* Oh, hello there! What brings you to our tavern?
Marcus: *grunts* Another traveler. State your business.
```

### Selective Response

Even when multiple characters pass their `$respond` conditions, the AI decides who should actually speak based on context. If someone says "Hey Aria, what do you think?" the AI will likely only respond as Aria, not Marcus.

If no character would naturally respond to a message, the AI returns `none` and no response is sent. This prevents awkward replies to messages that weren't directed at any character.

### Webhook Display

Each character's response is sent as a separate Discord message using webhooks. The message shows:
- Character name as the username
- Character avatar (if set via `$avatar` fact)
- Their dialogue content

This creates a natural conversation flow where each character has their own distinct message.

## Advanced Patterns

### Turn-Taking

Make characters take turns based on who was mentioned:

```
$if mentioned || (replied_to == name): $respond
```

### Reactive Characters

Have a character react when another specific character speaks:

```
$if content.toLowerCase().includes("marcus") && !mentioned: $respond
```

### Shy Characters

Lower response rate unless directly addressed:

```
$if mentioned: $respond
$if random() < 0.2 && chars.length > 1: $respond
```

### Custom Avatars

Set character avatars with the `$avatar` directive:

```
$avatar https://example.com/aria-avatar.png
is a character
has silver hair
```

## Tips

- **Keep facts distinct**: Give each character unique traits so the AI can differentiate them
- **Use response conditions**: Without `$respond` conditions, all characters may respond to every message
- **Test incrementally**: Start with one character, then add more
- **Name mentions**: The `name` variable in expressions holds the current character's name
- **Check `chars`**: Use `chars.length` to know how many characters are in the channel

## Example: Tavern Scene

### The Barmaid
```
$if mentioned || replied: $respond
$if chars.length === 1 && random() < 0.3: $respond
$avatar https://example.com/barmaid.png
is a cheerful barmaid named Ella
works at the Rusty Tankard
knows all the local gossip
greets newcomers warmly
```

### The Mysterious Stranger
```
$if mentioned || content.toLowerCase().includes("stranger"): $respond
$if random() < 0.1 && chars.length > 1: $respond
$avatar https://example.com/stranger.png
is a mysterious hooded figure
sits alone in the corner
speaks in riddles
knows things they shouldn't
```

### The Drunk Regular
```
$if mentioned || content.toLowerCase().includes("drunk"): $respond
$if random() < 0.2 && time.hour >= 18: $respond
$avatar https://example.com/drunk.png
is the town drunk named Old Pete
tells exaggerated stories
interrupts conversations randomly
becomes philosophical when very drunk
```

Bind all three to a channel for an immersive tavern experience!
