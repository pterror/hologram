# Getting Started

Hologram is a Discord bot for collaborative worldbuilding and roleplay. Its core idea is simple: **everything is an entity with facts**.

## Installation

1. [Invite the bot](https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID) to your server
2. Create a character: `/c character YourCharacter`
3. Bind it to a channel: `/b channel YourCharacter`
4. Start chatting!

## Your First Character

Let's create a character named Aria:

```
/c character Aria
```

This creates an entity named "Aria" with a single fact: "is a character".

Now let's give her some personality:

```
/e Aria
```

This opens a modal where you can add facts, one per line:

```
has silver hair and violet eyes
works as a traveling merchant
speaks with a slight accent
is cautious around strangers
carries a worn leather satchel
```

## Binding to a Channel

To make Aria respond in a channel:

```
/b channel Aria
```

Now when users chat in that channel, Aria will respond based on her facts. By default, she responds when @mentioned.

## What's Next?

- [Core Concepts](/guide/concepts) - Understand the entity-facts model
- [Setting Up a Channel](/guide/channel-setup) - Configure how the bot responds
- [Creating a Persona](/guide/personas) - Speak as different characters
- [Commands Reference](/reference/commands) - All available commands
