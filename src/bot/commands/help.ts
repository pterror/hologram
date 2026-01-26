/**
 * /help Command
 *
 * In-Discord documentation and current state overview.
 * Features:
 * - Overview with setup status
 * - Topic-based help pages
 * - Interactive navigation
 * - Command reference
 * - Contextual awareness
 */

import {
  type CreateApplicationCommand,
  type ActionRow,
  ApplicationCommandOptionTypes,
  MessageComponentTypes,
  ButtonStyles,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { getOptionValue, getSubcommand, USER_APP_INTEGRATION } from "./index";
import { getWorldState } from "../../world/state";
import { isChannelEnabled } from "../../plugins/core";
import { getWorldConfig } from "../../config/defaults";
import { getDb } from "../../db";

// =============================================================================
// Command Definition
// =============================================================================

export const helpCommand: CreateApplicationCommand = {
  name: "help",
  description: "Get help with Hologram",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "topic",
      description: "View help for a specific topic",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Topic to view",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "Getting Started", value: "start" },
            { name: "Characters", value: "characters" },
            { name: "Worlds", value: "worlds" },
            { name: "Scenes", value: "scenes" },
            { name: "Memory (Chronicle)", value: "memory" },
            { name: "Locations", value: "locations" },
            { name: "Inventory", value: "inventory" },
            { name: "Time System", value: "time" },
            { name: "Dice & Combat", value: "combat" },
            { name: "Relationships", value: "relationships" },
            { name: "Factions", value: "factions" },
            { name: "Personas & Proxies", value: "personas" },
            { name: "Configuration", value: "config" },
            { name: "API Keys (BYOK)", value: "keys" },
            { name: "Quotas", value: "quotas" },
            { name: "All Commands", value: "commands" },
          ],
        },
      ],
    },
    {
      name: "command",
      description: "Get detailed help for a specific command",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Command name (without /)",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "/setup", value: "setup" },
            { name: "/build", value: "build" },
            { name: "/character", value: "character" },
            { name: "/world", value: "world" },
            { name: "/session", value: "session" },
            { name: "/scene", value: "scene" },
            { name: "/config", value: "config" },
            { name: "/chronicle", value: "chronicle" },
            { name: "/location", value: "location" },
            { name: "/time", value: "time" },
            { name: "/roll", value: "roll" },
            { name: "/combat", value: "combat" },
            { name: "/relationship", value: "relationship" },
            { name: "/faction", value: "faction" },
            { name: "/persona", value: "persona" },
            { name: "/proxy", value: "proxy" },
            { name: "/status", value: "status" },
            { name: "/tips", value: "tips" },
            { name: "/keys", value: "keys" },
            { name: "/quota", value: "quota" },
            { name: "/imagine", value: "imagine" },
            { name: "/help", value: "help" },
          ],
        },
      ],
    },
    {
      name: "overview",
      description: "Show setup status and quick start guide",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

// =============================================================================
// Command Handler
// =============================================================================

export async function handleHelpCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";

  switch (subcommand) {
    case "topic": {
      const topic = getOptionValue<string>(interaction, "name") ?? "start";
      await sendTopicHelp(bot, interaction, topic, channelId);
      break;
    }
    case "command": {
      const command = getOptionValue<string>(interaction, "name") ?? "help";
      await sendCommandHelp(bot, interaction, command);
      break;
    }
    case "overview":
    default: {
      await sendOverviewHelp(bot, interaction, channelId);
      break;
    }
  }
}

// =============================================================================
// Help Component Handler
// =============================================================================

export async function handleHelpComponent(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<boolean> {
  const customId = interaction.data?.customId ?? "";

  if (!customId.startsWith("help:")) {
    return false;
  }

  const [, action, value] = customId.split(":");
  const channelId = interaction.channelId?.toString() ?? "";

  switch (action) {
    case "topic": {
      await updateToTopic(bot, interaction, value, channelId);
      return true;
    }
    case "overview": {
      await updateToOverview(bot, interaction, channelId);
      return true;
    }
    case "nav": {
      const topics = Object.keys(TOPICS);
      const currentIndex = topics.indexOf(value);
      // This shouldn't happen but handle gracefully
      if (currentIndex === -1) {
        await updateToTopic(bot, interaction, "start", channelId);
      }
      return true;
    }
    default:
      return false;
  }
}

// =============================================================================
// Overview Help
// =============================================================================

async function sendOverviewHelp(
  bot: HologramBot,
  interaction: HologramInteraction,
  channelId: string
): Promise<void> {
  const embed = buildOverviewEmbed(channelId);
  const components = buildOverviewComponents();

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: { embeds: [embed], components },
  });
}

async function updateToOverview(
  bot: HologramBot,
  interaction: HologramInteraction,
  channelId: string
): Promise<void> {
  const embed = buildOverviewEmbed(channelId);
  const components = buildOverviewComponents();

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 7, // UpdateMessage
    data: { embeds: [embed], components },
  });
}

function buildOverviewEmbed(channelId: string) {
  const worldState = getWorldState(channelId);
  const enabled = isChannelEnabled(channelId);

  const statusEmoji = (done: boolean) => (done ? "✅" : "⬜");

  let configSummary = "Not configured";
  const enabledFeatures: string[] = [];

  if (worldState) {
    const config = getWorldConfig(worldState.id);

    if (config.chronicle.enabled) enabledFeatures.push("Memory");
    if (config.scenes.enabled) enabledFeatures.push("Scenes");
    if (config.inventory.enabled) enabledFeatures.push("Inventory");
    if (config.locations.enabled) enabledFeatures.push("Locations");
    if (config.time.enabled) enabledFeatures.push("Time");
    if (config.dice.enabled) enabledFeatures.push("Dice");
    if (config.relationships.enabled) enabledFeatures.push("Relationships");
    if (config.characterState.enabled) enabledFeatures.push("Character State");

    configSummary =
      enabledFeatures.length > 0
        ? enabledFeatures.join(", ")
        : "Minimal (no extra features)";
  }

  let characterCount = 0;
  if (worldState) {
    const db = getDb();
    const row = db
      .prepare(
        "SELECT COUNT(*) as count FROM entities WHERE world_id = ? AND type = 'character'"
      )
      .get(worldState.id) as { count: number };
    characterCount = row.count;
  }

  return {
    title: "Hologram Help",
    description:
      "I'm an RP bot with smart context, memory, and world management. " +
      "Select a topic below or use `/help topic <name>` for detailed help.",
    color: 0x5865f2,
    fields: [
      {
        name: "Current Status",
        value: [
          `${statusEmoji(!!worldState)} World: ${worldState?.name ?? "Not created"}`,
          `${statusEmoji(enabled)} Session: ${enabled ? "Enabled" : "Disabled"}`,
          `${statusEmoji(characterCount > 0)} Characters: ${characterCount}`,
          `Features: ${configSummary}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Quick Start",
        value: [
          "`/setup quick` - Set up everything in one click",
          "`/build character` - Create a character with AI help",
          "`/config preset` - Choose a mode (minimal, MUD, tabletop, etc.)",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Essential Commands",
        value: [
          "`/session enable` - Enable responses in this channel",
          "`/character create` - Create a new character",
          "`/character select` - Switch active character",
        ].join("\n"),
        inline: true,
      },
      {
        name: "Feature Commands",
        value: [
          "`/scene` - Manage RP sessions",
          "`/location` - Explore and navigate",
          "`/chronicle` - Search memories",
          "`/roll` - Roll dice",
        ].join("\n"),
        inline: true,
      },
    ],
    footer: {
      text: "Use the menu below to browse help topics",
    },
  };
}

function buildOverviewComponents(): ActionRow[] {
  return [
    {
      type: MessageComponentTypes.ActionRow,
      components: [
        {
          type: MessageComponentTypes.SelectMenu,
          customId: "help:topic:select",
          placeholder: "Select a help topic...",
          options: [
            { label: "Getting Started", value: "start", emoji: { name: "🚀" } },
            { label: "Characters", value: "characters", emoji: { name: "👤" } },
            { label: "Worlds", value: "worlds", emoji: { name: "🌍" } },
            { label: "Scenes", value: "scenes", emoji: { name: "🎬" } },
            { label: "Memory", value: "memory", emoji: { name: "🧠" } },
            { label: "Locations", value: "locations", emoji: { name: "🗺️" } },
            { label: "Inventory", value: "inventory", emoji: { name: "🎒" } },
            { label: "Time", value: "time", emoji: { name: "⏰" } },
            { label: "Dice & Combat", value: "combat", emoji: { name: "🎲" } },
            { label: "Relationships", value: "relationships", emoji: { name: "💕" } },
            { label: "Factions", value: "factions", emoji: { name: "⚔️" } },
            { label: "Personas", value: "personas", emoji: { name: "🎭" } },
            { label: "Configuration", value: "config", emoji: { name: "⚙️" } },
            { label: "API Keys", value: "keys", emoji: { name: "🔑" } },
            { label: "Quotas", value: "quotas", emoji: { name: "📊" } },
            { label: "All Commands", value: "commands", emoji: { name: "📜" } },
          ],
        },
      ],
    } as ActionRow,
  ];
}

// =============================================================================
// Topic Help
// =============================================================================

async function sendTopicHelp(
  bot: HologramBot,
  interaction: HologramInteraction,
  topic: string,
  channelId: string
): Promise<void> {
  const embed = buildTopicEmbed(topic, channelId);
  const components = buildTopicComponents(topic);

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: { embeds: [embed], components },
  });
}

async function updateToTopic(
  bot: HologramBot,
  interaction: HologramInteraction,
  topic: string,
  channelId: string
): Promise<void> {
  // Handle select menu - value comes from interaction.data.values
  let actualTopic = topic;
  if (topic === "select" && interaction.data?.values?.[0]) {
    actualTopic = interaction.data.values[0];
  }

  const embed = buildTopicEmbed(actualTopic, channelId);
  const components = buildTopicComponents(actualTopic);

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 7,
    data: { embeds: [embed], components },
  });
}

function buildTopicEmbed(topic: string, channelId: string) {
  const topicData = TOPICS[topic];
  if (!topicData) {
    return {
      title: "Unknown Topic",
      description: `Topic "${topic}" not found. Use the menu to select a valid topic.`,
      color: 0xff0000,
    };
  }

  // Check if feature is enabled for contextual content
  const worldState = getWorldState(channelId);
  let contextNote = "";

  if (worldState && topicData.configKey) {
    const config = getWorldConfig(worldState.id);
    const configSection = config[topicData.configKey as keyof typeof config];
    if (
      typeof configSection === "object" &&
      configSection !== null &&
      "enabled" in configSection
    ) {
      const isEnabled = (configSection as { enabled: boolean }).enabled;
      if (!isEnabled) {
        contextNote = `\n\n> **Note:** This feature is currently disabled. Enable with:\n> \`/config set ${topicData.configKey}.enabled true\``;
      }
    }
  }

  return {
    title: `Help: ${topicData.title}`,
    description: topicData.content + contextNote,
    color: 0x5865f2,
    footer: {
      text: `Topic ${Object.keys(TOPICS).indexOf(topic) + 1}/${Object.keys(TOPICS).length}`,
    },
  };
}

function buildTopicComponents(currentTopic: string): ActionRow[] {
  const topics = Object.keys(TOPICS);
  const currentIndex = topics.indexOf(currentTopic);
  const prevTopic = currentIndex > 0 ? topics[currentIndex - 1] : null;
  const nextTopic =
    currentIndex < topics.length - 1 ? topics[currentIndex + 1] : null;

  return [
    {
      type: MessageComponentTypes.ActionRow,
      components: [
        {
          type: MessageComponentTypes.Button,
          style: ButtonStyles.Secondary,
          label: "Previous",
          customId: `help:topic:${prevTopic ?? currentTopic}`,
          disabled: !prevTopic,
        },
        {
          type: MessageComponentTypes.Button,
          style: ButtonStyles.Primary,
          label: "Overview",
          customId: "help:overview",
        },
        {
          type: MessageComponentTypes.Button,
          style: ButtonStyles.Secondary,
          label: "Next",
          customId: `help:topic:${nextTopic ?? currentTopic}`,
          disabled: !nextTopic,
        },
      ],
    } as ActionRow,
    {
      type: MessageComponentTypes.ActionRow,
      components: [
        {
          type: MessageComponentTypes.SelectMenu,
          customId: "help:topic:select",
          placeholder: "Jump to topic...",
          options: Object.entries(TOPICS).map(([key, data]) => ({
            label: data.title,
            value: key,
            default: key === currentTopic,
          })),
        },
      ],
    } as ActionRow,
  ];
}

// =============================================================================
// Command Help
// =============================================================================

async function sendCommandHelp(
  bot: HologramBot,
  interaction: HologramInteraction,
  command: string
): Promise<void> {
  const commandData = COMMANDS[command];

  if (!commandData) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: 4,
      data: {
        content: `Unknown command: ${command}`,
        flags: 64,
      },
    });
    return;
  }

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      embeds: [
        {
          title: `/${command}`,
          description: commandData.description,
          color: 0x5865f2,
          fields: [
            ...(commandData.subcommands
              ? [
                  {
                    name: "Subcommands",
                    value: commandData.subcommands,
                    inline: false,
                  },
                ]
              : []),
            ...(commandData.examples
              ? [
                  {
                    name: "Examples",
                    value: commandData.examples,
                    inline: false,
                  },
                ]
              : []),
            ...(commandData.related
              ? [
                  {
                    name: "Related",
                    value: commandData.related,
                    inline: false,
                  },
                ]
              : []),
          ],
          footer: {
            text: "Use /help topic <name> for feature guides",
          },
        },
      ],
    },
  });
}

// =============================================================================
// Topic Data
// =============================================================================

interface TopicData {
  title: string;
  content: string;
  configKey?: string;
}

const TOPICS: Record<string, TopicData> = {
  start: {
    title: "Getting Started",
    content: `**Quick Setup**
1. Use \`/setup quick\` to create a world and enable responses
2. Use \`/build character\` to create a character
3. Start chatting!

**Manual Setup**
1. \`/world create <name>\` - Create a world
2. \`/world init <name>\` - Initialize world in this channel
3. \`/session enable\` - Enable bot responses
4. \`/character create <name>\` - Create a character

**Choose Your Mode**
Use \`/config preset\` to select a playstyle:
- **Minimal** - Simple chat
- **SillyTavern** - Character chat with memory
- **MUD** - Text adventure with exploration
- **Tabletop** - Dice and combat
- **Full** - All features enabled`,
  },
  characters: {
    title: "Characters",
    content: `**Creating Characters**
- \`/build character\` - AI-assisted creation wizard
- \`/character create <name>\` - Manual creation

**Managing Characters**
- \`/character list\` - See all characters
- \`/character view <name>\` - View character details
- \`/character edit <name>\` - Edit a character
- \`/character delete <name>\` - Remove a character

**Using Characters**
- \`/character select <name>\` - Switch active character
- Characters appear with their own name/avatar via webhooks

**Output Modes**
- **tagged** - \`**Name:** "dialogue"\`
- **webhooks** - Separate messages with avatars
- **narrator** - Third-person narration`,
  },
  worlds: {
    title: "Worlds",
    content: `**About Worlds**
Worlds are containers for your RP content - characters, locations, memories, and settings. Each Discord server can have multiple worlds.

**Commands**
- \`/world create <name>\` - Create a new world
- \`/world init <name>\` - Use world in this channel
- \`/world info\` - View current world details
- \`/world edit\` - Edit world properties

**Multi-World Setup**
- Create different worlds for different campaigns
- Switch between them with \`/world init\`
- Each world has independent configuration`,
  },
  scenes: {
    title: "Scenes",
    configKey: "scenes",
    content: `**About Scenes**
Scenes are named RP sessions that preserve context. Pause and resume them anytime.

**Commands**
- \`/scene start <name>\` - Start a named session
- \`/scene pause\` - Pause current scene
- \`/scene resume <name>\` - Continue a paused scene
- \`/scene end\` - End current scene
- \`/scene list\` - View all scenes
- \`/scene status\` - Current scene info

**Features**
- Scene context persists between sessions
- Track participants, location, time
- Auto-pause after inactivity (configurable)

**Configuration**
- \`scenes.autoPause\` - Auto-pause after inactivity
- \`scenes.pauseAfterMinutes\` - Inactivity threshold`,
  },
  memory: {
    title: "Memory (Chronicle)",
    configKey: "chronicle",
    content: `**About Chronicle**
The chronicle system stores important events and facts from your RP sessions.

**Commands**
- \`/chronicle recall <query>\` - Search memories
- \`/chronicle history\` - View recent entries
- \`/chronicle add <text>\` - Manually add a memory
- \`/chronicle forget <id>\` - Remove a memory

**Features**
- **Auto-extraction** - Important events saved automatically
- **Perspective-aware** - Characters only "remember" what they witnessed
- **Searchable** - Query memories by content (uses AI embeddings)

**Configuration**
- \`chronicle.autoExtract\` - Automatically save events
- \`chronicle.perspectiveAware\` - Filter by who knows what
- \`chronicle.extractImportance\` - Threshold (1-10)`,
  },
  locations: {
    title: "Locations",
    configKey: "locations",
    content: `**About Locations**
Create and explore a world map with connected locations.

**Commands**
- \`/location go <name>\` - Travel to a location
- \`/location look\` - Examine current location
- \`/location create <name>\` - Create new location
- \`/location connect <from> <to>\` - Connect locations
- \`/location map\` - View all locations

**Features**
- Location descriptions included in AI context
- Track where characters are
- Named connections (paths, doors, portals)
- Optional travel time

**Configuration**
- \`locations.useConnections\` - Named paths
- \`locations.useTravelTime\` - Time to move
- \`locations.trackProperties\` - Indoor/outdoor, etc.`,
  },
  inventory: {
    title: "Inventory",
    configKey: "inventory",
    content: `**About Inventory**
Track items and equipment for characters.

**Features**
- Give items to characters
- Equipment slots (weapon, armor, etc.)
- Optional capacity limits
- Optional item durability

**Configuration**
- \`inventory.useEquipment\` - Enable equipment slots
- \`inventory.useCapacity\` - Weight/slot limits
- \`inventory.useDurability\` - Items can break
- \`inventory.equipmentSlots\` - Custom slot names`,
  },
  time: {
    title: "Time System",
    configKey: "time",
    content: `**About Time**
Track in-game time with optional calendar and day/night cycle.

**Commands**
- \`/time show\` - View current time
- \`/time advance <amount>\` - Move time forward
- \`/time set <time>\` - Set specific time
- \`/time dawn|noon|dusk|night\` - Jump to period

**Modes**
- **narrative** - Time advances as story dictates
- **manual** - Only advances via commands
- **realtime** - Syncs with real time (configurable ratio)

**Configuration**
- \`time.mode\` - narrative/manual/realtime
- \`time.useDayNight\` - Day/night periods
- \`time.useCalendar\` - Custom calendar
- \`time.narrateTimeSkips\` - Announce time changes`,
  },
  combat: {
    title: "Dice & Combat",
    configKey: "dice",
    content: `**Dice Rolling**
- \`/roll 2d6+3\` - Roll with modifiers
- \`/roll 4d6kh3\` - Keep highest 3
- \`/roll d20!\` - Exploding dice
- \`/r d20\` - Quick roll

**Dice Syntax**
- \`NdM\` - Roll N M-sided dice
- \`+X\` / \`-X\` - Modifiers
- \`khN\` / \`klN\` - Keep highest/lowest
- \`!\` or \`!N\` - Exploding on N+
- \`rN\` - Reroll N and below

**Combat System**
- \`/combat start\` - Begin combat
- \`/combat join <character>\` - Add to initiative
- \`/combat next\` - Next turn
- \`/combat status\` - View order
- \`/combat end\` - End combat

**Configuration**
- \`dice.useCombat\` - Enable combat system
- \`dice.useHP\` - Track hit points
- \`dice.useAC\` - Track armor class`,
  },
  relationships: {
    title: "Relationships",
    configKey: "relationships",
    content: `**About Relationships**
Track how characters feel about each other.

**Commands**
- \`/relationship show <char1> <char2>\` - View relationship
- \`/relationship set <char1> <char2> <type>\` - Set relationship
- \`/relationship list <character>\` - All relationships

**Relationship Types**
Default types: knows, friend, enemy, family, romantic, rival

**Affinity System**
Optional numeric affinity (-100 to 100):
- \`/relationship affinity <char1> <char2> <value>\`

**Configuration**
- \`relationships.useAffinity\` - Enable numeric affinity
- \`relationships.affinityRange\` - Min/max values
- \`relationships.relationshipTypes\` - Custom types`,
  },
  factions: {
    title: "Factions",
    configKey: "relationships",
    content: `**About Factions**
Group characters into factions with standing systems.

**Commands**
- \`/faction list\` - View all factions
- \`/faction info <name>\` - Faction details
- \`/faction join <faction> <character>\` - Join faction
- \`/faction leave <faction> <character>\` - Leave faction
- \`/faction standing <faction> <character>\` - Check standing

**Features**
- Characters can belong to multiple factions
- Track standing/reputation per faction
- Faction relationships affect interactions

**Configuration**
Enable factions: \`/config set relationships.useFactions true\``,
  },
  personas: {
    title: "Personas & Proxies",
    content: `**User Personas**
Set how you appear in RP (separate from AI characters):
- \`/persona set <name>\` - Set your display name
- \`/persona show\` - View your persona
- \`/persona clear\` - Remove persona

**Proxy System**
Speak as different characters using prefixes:
- \`/proxy add <name> <prefix>\` - Add proxy (e.g., \`A:\`)
- \`/proxy list\` - View your proxies
- \`/proxy remove <name>\` - Remove proxy

**Usage**
After adding a proxy with prefix \`A:\`:
\`\`\`
A: Hello, I'm speaking as this character!
\`\`\`

**Bracket Syntax**
You can also use brackets:
- \`/proxy add Alice [Alice]\` → \`[Alice] Hello!\``,
  },
  config: {
    title: "Configuration",
    content: `**Quick Config**
- \`/config preset <mode>\` - Apply a preset
- \`/config wizard\` - Interactive toggles

**Manual Config**
- \`/config show [section]\` - View settings
- \`/config set <path> <value>\` - Set option
- \`/config reset\` - Reset to defaults

**Presets**
\`minimal\` \`sillytavern\` \`mud\` \`survival\` \`tits\` \`tabletop\` \`parser\` \`full\`

**Feature Flags**
\`\`\`
chronicle.enabled    - Memory system
scenes.enabled       - Scene management
inventory.enabled    - Item tracking
locations.enabled    - World map
time.enabled         - Time system
dice.enabled         - Dice rolling
relationships.enabled - Relationships
characterState.enabled - HP, forms
\`\`\``,
  },
  keys: {
    title: "API Keys (BYOK)",
    content: `**Bring Your Own Key**
Use your own API keys for LLM and image generation providers.

**Commands**
- \`/keys add <provider> <scope>\` - Add an API key
- \`/keys list [scope]\` - View configured keys
- \`/keys remove <provider> <scope>\` - Remove a key
- \`/keys test <provider>\` - Validate a key
- \`/keys status\` - Show which keys are active

**Scopes**
- **Personal** - Only you use this key
- **Server** - Everyone in this server uses it (requires Manage Server)

**Supported Providers**
- **LLM:** Google (Gemini), Anthropic (Claude), OpenAI (GPT)
- **Images:** RunComfy, SaladCloud, RunPod

**Key Resolution**
Keys are checked in order: your personal key → server key → bot default

**Security**
- Keys are encrypted at rest (AES-256-GCM)
- Keys are never shown after being saved
- Use \`/keys test\` to verify a key works`,
  },
  quotas: {
    title: "Usage Quotas",
    content: `**About Quotas**
The bot can limit usage per user to control costs.

**Commands**
- \`/quota\` - Check your current usage

**What's Tracked**
- LLM tokens (input + output)
- Image generations
- Total cost (in millicents)

**Limits**
Quotas are configured by the bot operator per-world:
- \`quota.limits.llm_tokens\` - Max tokens per period
- \`quota.limits.image_count\` - Max images per period
- \`quota.limits.total_cost\` - Max spend per period

**Periods**
- **Rolling** - Last N days (sliding window)
- **Fixed** - Calendar periods (resets at start)

**BYOK & Quotas**
When using your own API key, usage is still tracked but quotas may be configured differently by the bot operator.`,
  },
  commands: {
    title: "All Commands",
    content: `**Setup & Config**
\`/setup\` \`/config\` \`/tips\` \`/help\`

**World & Session**
\`/world\` \`/session\` \`/scene\`

**Characters**
\`/character\` \`/build\` \`/persona\` \`/proxy\`

**Exploration**
\`/location\` \`/time\` \`/status\`

**Memory**
\`/chronicle\` \`/memory\`

**Social**
\`/relationship\` \`/faction\`

**Gameplay**
\`/roll\` \`/r\` \`/combat\`

**Images**
\`/imagine\`

**Usage & Keys**
\`/quota\` \`/keys\`

Use \`/help command <name>\` for detailed command help.`,
  },
};

// =============================================================================
// Command Data
// =============================================================================

interface CommandData {
  description: string;
  subcommands?: string;
  examples?: string;
  related?: string;
}

const COMMANDS: Record<string, CommandData> = {
  setup: {
    description: "Set up Hologram in this channel with guided or quick options.",
    subcommands: `\`quick\` - One-click setup with defaults
\`guided\` - Step-by-step interactive setup
\`status\` - Check current setup state
\`reset\` - Reset channel setup`,
    examples: `/setup quick
/setup guided`,
    related: "`/config` `/world` `/session`",
  },
  build: {
    description: "AI-assisted creation wizards for characters, worlds, locations, and items.",
    subcommands: `\`character\` - Create a character with AI suggestions
\`world\` - Create a world
\`location\` - Create a location
\`item\` - Create an item (if inventory enabled)`,
    examples: `/build character
/build world`,
    related: "`/character create` `/world create`",
  },
  character: {
    description: "Create and manage AI characters.",
    subcommands: `\`create <name>\` - Create a character
\`list\` - List all characters
\`view <name>\` - View character details
\`edit <name>\` - Edit a character
\`delete <name>\` - Delete a character
\`select <name>\` - Set active character`,
    examples: `/character create Alice
/character select Alice
/character view Alice`,
    related: "`/build character` `/persona` `/proxy`",
  },
  world: {
    description: "Create and manage worlds.",
    subcommands: `\`create <name>\` - Create a new world
\`init <name>\` - Use world in this channel
\`info\` - View current world
\`edit\` - Edit world properties
\`link\` - Link world to guild`,
    examples: `/world create "My Campaign"
/world init "My Campaign"`,
    related: "`/setup` `/config`",
  },
  session: {
    description: "Manage the bot session in this channel.",
    subcommands: `\`enable\` - Enable bot responses
\`disable\` - Disable bot responses
\`status\` - View session state
\`clear\` - Clear message history
\`scene <desc>\` - Set scene description
\`debug\` - Show context debug info`,
    examples: `/session enable
/session debug`,
    related: "`/setup` `/scene`",
  },
  scene: {
    description: "Manage named RP sessions.",
    subcommands: `\`start <name>\` - Start a new scene
\`pause\` - Pause current scene
\`resume <name>\` - Resume a scene
\`end\` - End current scene
\`list\` - View all scenes
\`status\` - Current scene info`,
    examples: `/scene start "Tavern Meeting"
/scene pause
/scene resume "Tavern Meeting"`,
    related: "`/session` `/location`",
  },
  config: {
    description: "Configure world settings and features.",
    subcommands: `\`show [section]\` - View configuration
\`set <path> <value>\` - Set a value
\`preset <mode>\` - Apply a preset
\`wizard\` - Interactive toggles
\`reset\` - Reset to defaults`,
    examples: `/config preset sillytavern
/config set chronicle.enabled true
/config wizard`,
    related: "`/setup` `/help topic config`",
  },
  chronicle: {
    description: "Search and manage memories.",
    subcommands: `\`recall <query>\` - Search memories
\`history\` - View recent entries
\`add <text>\` - Add a memory
\`forget <id>\` - Remove a memory`,
    examples: `/chronicle recall "the dragon attack"
/chronicle add "Alice learned the secret password"`,
    related: "`/memory` `/config set chronicle.enabled`",
  },
  location: {
    description: "Navigate and manage locations.",
    subcommands: `\`go <name>\` - Travel to location
\`look\` - Examine current location
\`create <name>\` - Create location
\`connect <from> <to>\` - Connect locations
\`map\` - View all locations`,
    examples: `/location go "Town Square"
/location create "Dark Forest"
/location connect "Town Square" "Dark Forest"`,
    related: "`/build location` `/time`",
  },
  time: {
    description: "View and control in-game time.",
    subcommands: `\`show\` - View current time
\`advance <amount>\` - Move time forward
\`set <time>\` - Set specific time
\`dawn\` / \`noon\` / \`dusk\` / \`night\` - Jump to period`,
    examples: `/time show
/time advance 2 hours
/time dusk`,
    related: "`/scene` `/config set time.enabled`",
  },
  roll: {
    description: "Roll dice with full expression support.",
    subcommands: `\`<expression>\` - Roll dice

**Syntax:**
• \`NdM\` - Roll N M-sided dice
• \`+X\` / \`-X\` - Add/subtract
• \`khN\` / \`klN\` - Keep highest/lowest
• \`!\` - Exploding dice
• \`rN\` - Reroll N and below`,
    examples: `/roll 2d6+3
/roll 4d6kh3
/roll d20!
/r d20 (quick roll)`,
    related: "`/combat` `/config set dice.enabled`",
  },
  combat: {
    description: "Turn-based combat with initiative tracking.",
    subcommands: `\`start\` - Begin combat
\`join <character>\` - Add to initiative
\`leave <character>\` - Remove from combat
\`next\` - Next turn
\`status\` - View initiative order
\`end\` - End combat`,
    examples: `/combat start
/combat join Alice
/combat next`,
    related: "`/roll` `/config set dice.useCombat`",
  },
  relationship: {
    description: "Manage character relationships.",
    subcommands: `\`show <char1> <char2>\` - View relationship
\`set <char1> <char2> <type>\` - Set type
\`list <character>\` - All relationships
\`affinity <char1> <char2> <value>\` - Set affinity`,
    examples: `/relationship show Alice Bob
/relationship set Alice Bob friend`,
    related: "`/faction` `/character`",
  },
  faction: {
    description: "Manage factions and membership.",
    subcommands: `\`list\` - View all factions
\`info <name>\` - Faction details
\`join <faction> <character>\` - Join
\`leave <faction> <character>\` - Leave
\`standing <faction> <character>\` - Check standing`,
    examples: `/faction list
/faction join "Thieves Guild" Alice`,
    related: "`/relationship` `/character`",
  },
  persona: {
    description: "Set your display name for RP.",
    subcommands: `\`set <name>\` - Set persona name
\`show\` - View current persona
\`clear\` - Remove persona`,
    examples: `/persona set "Sir Reginald"`,
    related: "`/proxy` `/character`",
  },
  proxy: {
    description: "Speak as characters using prefixes.",
    subcommands: `\`add <name> <prefix>\` - Add proxy
\`list\` - View proxies
\`remove <name>\` - Remove proxy
\`set <name>\` - Set active proxy`,
    examples: `/proxy add Alice "A:"
Then type: A: Hello!`,
    related: "`/persona` `/character`",
  },
  status: {
    description: "View character state, effects, and equipment.",
    subcommands: `(no subcommands - shows current character status)`,
    examples: `/status`,
    related: "`/character` `/combat`",
  },
  tips: {
    description: "Manage helpful tip suggestions.",
    subcommands: `\`enable\` - Turn on tips
\`disable\` - Turn off tips
\`status\` - Check if enabled
\`reset\` - Reset seen tips`,
    examples: `/tips disable
/tips reset`,
    related: "`/help` `/config`",
  },
  help: {
    description: "Get help with Hologram.",
    subcommands: `\`overview\` - Setup status and quick start
\`topic <name>\` - Detailed topic help
\`command <name>\` - Command reference`,
    examples: `/help
/help topic characters
/help command roll`,
    related: "`/tips` `/setup`",
  },
  keys: {
    description: "Manage API keys for LLM and image providers (BYOK).",
    subcommands: `\`add <provider> <scope>\` - Add/update an API key (opens secure modal)
\`list [scope]\` - View configured keys (user/guild/all)
\`remove <provider> <scope>\` - Remove an API key
\`test <provider>\` - Validate the resolved key
\`status\` - Show BYOK status and active keys`,
    examples: `/keys add google user
/keys add anthropic guild
/keys list all
/keys test google
/keys status`,
    related: "`/quota` `/config`",
  },
  quota: {
    description: "Check your usage quota status.",
    subcommands: `(no subcommands - shows your current usage)

Displays:
• LLM tokens used vs limit
• Images generated vs limit
• Total cost vs limit
• Period information`,
    examples: `/quota`,
    related: "`/keys` `/config`",
  },
  imagine: {
    description: "Generate images using AI (ComfyUI workflows).",
    subcommands: `\`prompt <text>\` - Generate from text prompt
\`portrait <character>\` - Generate character portrait
\`expression <character> <emotion>\` - Character expression
\`workflows\` - List available workflows`,
    examples: `/imagine prompt "a sunset over mountains"
/imagine portrait Alice
/imagine expression Alice happy
/imagine workflows`,
    related: "`/keys` `/character`",
  },
};
