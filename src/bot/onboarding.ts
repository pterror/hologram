/**
 * Onboarding System
 *
 * Handles:
 * - Guild join welcome messages
 * - Quick setup flow
 * - Mode selection
 * - First-mention guidance
 */

import { ButtonStyles, MessageComponentTypes } from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "./types";
import { createWorld, initWorldState, linkGuildToWorld, getWorldState } from "../world/state";
import { enableChannel, isChannelEnabled } from "../plugins/core";
import { getModes } from "../plugins";
import { setWorldConfig } from "../config/defaults";
import { getDb } from "../db";
import { info } from "../logger";
import { createScene, getActiveScene, addCharacterToScene } from "../scene";
import { createCharacter, findEntityByName, type CharacterData } from "../db/entities";

// =============================================================================
// Welcome Embed
// =============================================================================

/** Send welcome message to a channel (typically system channel on guild join) */
export async function sendWelcomeMessage(
  bot: HologramBot,
  channelId: bigint,
  _guildName: string
): Promise<void> {
  await bot.helpers.sendMessage(channelId, {
    embeds: [
      {
        title: "Welcome to Hologram!",
        description:
          "I'm an RP bot with smart context, memory, and world management. " +
          "Let me help you get set up.",
        color: 0x5865f2, // Discord blurple
        fields: [
          {
            name: "Quick Start",
            value: "Click **Quick Setup** to create a world and character in seconds.",
            inline: false,
          },
          {
            name: "Choose Your Style",
            value:
              "Different modes for different playstyles: simple chat, text adventure, " +
              "tabletop RPG, and more.",
            inline: false,
          },
        ],
        footer: {
          text: "Use /help anytime to see what I can do",
        },
      },
    ],
    components: [
      {
        type: MessageComponentTypes.ActionRow,
        components: [
          {
            type: MessageComponentTypes.Button,
            style: ButtonStyles.Primary,
            label: "Quick Setup",
            customId: "onboarding:quick_setup",
            emoji: { name: "🚀" },
          },
          {
            type: MessageComponentTypes.Button,
            style: ButtonStyles.Secondary,
            label: "Choose Mode",
            customId: "onboarding:choose_mode",
            emoji: { name: "🎮" },
          },
          {
            type: MessageComponentTypes.Button,
            style: ButtonStyles.Link,
            label: "Documentation",
            url: "https://github.com/pterror/hologram#readme",
            emoji: { name: "📖" },
          },
        ],
      },
    ],
  });
}

// =============================================================================
// First-Mention Prompt
// =============================================================================

/** Check if channel/guild needs setup and offer guidance */
export async function checkAndOfferSetup(
  bot: HologramBot,
  channelId: string,
  _guildId: string | undefined
): Promise<boolean> {
  // Check if already set up
  const worldState = getWorldState(channelId);
  const enabled = isChannelEnabled(channelId);

  if (worldState && enabled) {
    return false; // Already set up
  }

  // Don't spam - check if we've offered setup recently (last 10 minutes)
  const cacheKey = `setup_offered:${channelId}`;
  if (setupOfferCache.has(cacheKey)) {
    return false;
  }
  setupOfferCache.set(cacheKey, Date.now());

  // Offer setup
  await bot.helpers.sendMessage(BigInt(channelId), {
    embeds: [
      {
        title: "Let's get started!",
        description:
          "I'm not set up in this channel yet. Want me to help you get started?",
        color: 0x5865f2,
      },
    ],
    components: [
      {
        type: MessageComponentTypes.ActionRow,
        components: [
          {
            type: MessageComponentTypes.Button,
            style: ButtonStyles.Primary,
            label: "Quick Setup",
            customId: `onboarding:quick_setup:${channelId}`,
            emoji: { name: "🚀" },
          },
          {
            type: MessageComponentTypes.Button,
            style: ButtonStyles.Secondary,
            label: "Just Chat",
            customId: `onboarding:just_chat:${channelId}`,
            emoji: { name: "💬" },
          },
        ],
      },
    ],
  });

  return true;
}

// Simple cache to avoid spamming setup offers
const setupOfferCache = new Map<string, number>();

// Clean up old cache entries every 10 minutes
setInterval(() => {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [key, time] of setupOfferCache) {
    if (time < tenMinutesAgo) {
      setupOfferCache.delete(key);
    }
  }
}, 10 * 60 * 1000);

// =============================================================================
// Quick Setup Flow
// =============================================================================

/** Perform quick setup: create world, enable session, prompt for character */
export async function performQuickSetup(
  bot: HologramBot,
  interaction: HologramInteraction,
  modeId?: string
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const guildId = interaction.guildId?.toString();

  // Get guild name for world
  let worldName = "My World";
  if (guildId) {
    try {
      const guild = await bot.helpers.getGuild(BigInt(guildId));
      worldName = guild.name ?? "My World";
    } catch {
      // Fallback to generic name
    }
  }

  // Check if world already exists for this guild
  let worldId: number | null = null;
  if (guildId) {
    const db = getDb();
    const existing = db
      .prepare("SELECT world_id FROM guild_worlds WHERE guild_id = ?")
      .get(guildId) as { world_id: number } | null;
    if (existing) {
      worldId = existing.world_id;
    }
  }

  // Create world if needed
  if (!worldId) {
    const world = createWorld(worldName, "A world for roleplay adventures.");
    worldId = world.id;

    if (guildId) {
      linkGuildToWorld(guildId, worldId);
    }

    info("Quick setup: created world", { worldId, worldName, guildId });
  }

  // Apply mode config if specified
  if (modeId) {
    const modes = getModes();
    const mode = modes.find((m) => m.id === modeId);
    if (mode?.config) {
      setWorldConfig(worldId, mode.config);
      info("Quick setup: applied mode", { worldId, modeId });
    }
  }

  // Initialize world for this channel
  initWorldState(channelId, worldId);

  // Enable session
  enableChannel(channelId);

  // Create a scene if scenes are enabled (or if not specified, create one anyway)
  const existingScene = getActiveScene(channelId);
  if (!existingScene) {
    createScene(worldId, channelId, {
      time: { day: 1, hour: 9, minute: 0 },  // Pleasant morning start
    });
    info("Quick setup: created scene", { channelId, worldId });
  }

  info("Quick setup: completed", { channelId, worldId });

  // Respond with success and next steps
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4, // ChannelMessageWithSource
    data: {
      embeds: [
        {
          title: "You're all set!",
          description:
            "I've created a world and enabled responses in this channel. " +
            "Now let's create a character for me to play!",
          color: 0x57f287, // Green
          fields: [
            {
              name: "Next Step",
              value:
                "Use `/build character` to create a character with AI assistance, " +
                "or `/character create` for manual creation.",
              inline: false,
            },
            {
              name: "Quick Tips",
              value:
                "• Mention me or just type to chat\n" +
                "• Use `/config preset` to change modes\n" +
                "• Use `/help` for more commands",
              inline: false,
            },
          ],
        },
      ],
      components: [
        {
          type: MessageComponentTypes.ActionRow,
          components: [
            {
              type: MessageComponentTypes.Button,
              style: ButtonStyles.Primary,
              label: "Create Character",
              customId: "onboarding:create_character",
              emoji: { name: "✨" },
            },
            {
              type: MessageComponentTypes.Button,
              style: ButtonStyles.Secondary,
              label: "Skip for Now",
              customId: "onboarding:skip_character",
            },
          ],
        },
      ],
    },
  });
}

/** Just Chat flow: minimal setup, respond immediately */
export async function performJustChat(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const guildId = interaction.guildId?.toString();

  // Get guild name for world
  let worldName = "Quick Chat";
  if (guildId) {
    try {
      const guild = await bot.helpers.getGuild(BigInt(guildId));
      worldName = guild.name ?? "Quick Chat";
    } catch {
      // Fallback
    }
  }

  // Check if world already exists
  let worldId: number | null = null;
  if (guildId) {
    const db = getDb();
    const existing = db
      .prepare("SELECT world_id FROM guild_worlds WHERE guild_id = ?")
      .get(guildId) as { world_id: number } | null;
    if (existing) {
      worldId = existing.world_id;
    }
  }

  // Create minimal world
  if (!worldId) {
    const world = createWorld(worldName);
    worldId = world.id;

    // Apply minimal mode
    const modes = getModes();
    const minimal = modes.find((m) => m.id === "minimal");
    if (minimal?.config) {
      setWorldConfig(worldId, minimal.config);
    }

    if (guildId) {
      linkGuildToWorld(guildId, worldId);
    }
  }

  // Initialize and enable
  initWorldState(channelId, worldId);
  enableChannel(channelId);

  // Create a scene for consistency
  const existingScene = getActiveScene(channelId);
  if (!existingScene) {
    createScene(worldId, channelId);
  }

  info("Just chat: setup complete", { channelId, worldId });

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      content:
        "Ready to chat! Just type or mention me to start. " +
        "Use `/build character` anytime to customize who I am.",
      flags: 64, // Ephemeral
    },
  });
}

// =============================================================================
// Mode Selection
// =============================================================================

/** Get detailed mode info for display */
function getModeDetails(modeId: string): { features: string[]; examples: string } {
  const details: Record<string, { features: string[]; examples: string }> = {
    minimal: {
      features: ["Basic chat", "Tagged output"],
      examples: "Simple character conversations",
    },
    sillytavern: {
      features: ["Memory", "Scenes", "Webhooks", "Relationships"],
      examples: "Character roleplay with persistent memory",
    },
    mud: {
      features: ["Locations", "Inventory", "Equipment", "Time", "Memory"],
      examples: "Text adventure exploration",
    },
    survival: {
      features: ["Inventory", "Attributes (hunger, thirst)", "Transformation", "Random events"],
      examples: "Survival/resource management RP",
    },
    tits: {
      features: ["Regions", "Inventory", "Forms", "Effects", "Memory"],
      examples: "Adult adventure with transformation",
    },
    tabletop: {
      features: ["Dice (advanced)", "Combat", "HP/AC", "Initiative", "Equipment"],
      examples: "D&D-style tabletop RP",
    },
    parser: {
      features: ["Locations", "Inventory", "Strict commands"],
      examples: "Classic text adventure (Zork-style)",
    },
    full: {
      features: ["Everything enabled", "All mechanics", "Maximum complexity"],
      examples: "Full-featured RP with all systems",
    },
  };
  return details[modeId] ?? { features: ["Custom"], examples: "Custom configuration" };
}

/** Show mode selection embed */
export async function showModeSelection(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const modes = getModes();

  // Create a select menu with modes
  const modeOptions = modes.map((mode) => ({
    label: mode.name,
    value: mode.id,
    description: (mode.description ?? "").slice(0, 100),
    emoji: getModeEmoji(mode.id),
  }));

  // Build rich mode descriptions
  const modeFields = modes.map((mode) => {
    const details = getModeDetails(mode.id);
    return {
      name: `${getModeEmoji(mode.id).name} ${mode.name}`,
      value: [
        mode.description ?? "",
        `**Features:** ${details.features.join(", ")}`,
        `*${details.examples}*`,
      ].join("\n"),
      inline: false,
    };
  });

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      embeds: [
        {
          title: "Choose Your Mode",
          description:
            "Each mode enables different features for different playstyles. " +
            "You can change this later with `/config preset` or `/config wizard`.\n\n" +
            "**Recommended for beginners:** SillyTavern (good balance of features)",
          color: 0x5865f2,
          fields: modeFields,
          footer: {
            text: "Select a mode below to continue setup",
          },
        },
      ],
      components: [
        {
          type: MessageComponentTypes.ActionRow,
          components: [
            {
              type: MessageComponentTypes.SelectMenu,
              customId: "onboarding:select_mode",
              placeholder: "Select a mode...",
              options: modeOptions,
            },
          ],
        },
      ],
    },
  });
}

/** Get emoji for mode */
function getModeEmoji(modeId: string): { name: string } {
  const emojis: Record<string, string> = {
    minimal: "💬",
    sillytavern: "🎭",
    mud: "🗺️",
    survival: "🏕️",
    tits: "🌟",
    tabletop: "🎲",
    parser: "📝",
    full: "⚡",
  };
  return { name: emojis[modeId] ?? "🎮" };
}

// =============================================================================
// Component Handler
// =============================================================================

/** Handle onboarding button/select interactions */
export async function handleOnboardingComponent(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<boolean> {
  const customId = interaction.data?.customId ?? "";

  if (!customId.startsWith("onboarding:")) {
    return false;
  }

  const [, action] = customId.split(":");

  switch (action) {
    case "quick_setup": {
      await performQuickSetup(bot, interaction);
      return true;
    }

    case "just_chat": {
      await performJustChat(bot, interaction);
      return true;
    }

    case "choose_mode": {
      await showModeSelection(bot, interaction);
      return true;
    }

    case "select_mode": {
      // Get selected mode from select menu
      const values = interaction.data?.values;
      const modeId = values?.[0];
      if (modeId) {
        await performQuickSetup(bot, interaction, modeId);
      }
      return true;
    }

    case "create_character": {
      // Show character creation options
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: "Create Your Character",
              description: "Choose how you'd like to create your character:",
              color: 0x5865f2,
              fields: [
                {
                  name: "🤖 AI-Assisted (Recommended)",
                  value: "Use `/build character` - Describe what you want and I'll help create it.",
                  inline: false,
                },
                {
                  name: "📝 Manual",
                  value: "Use `/character create` - Full control over name, persona, and scenario.",
                  inline: false,
                },
                {
                  name: "📥 Import",
                  value: "Use `/import` - Import a character card (PNG, JSON, CharX) from SillyTavern or other tools.",
                  inline: false,
                },
              ],
            },
          ],
          components: [
            {
              type: MessageComponentTypes.ActionRow,
              components: [
                {
                  type: MessageComponentTypes.Button,
                  style: ButtonStyles.Primary,
                  label: "Quick Character",
                  customId: "onboarding:quick_character",
                  emoji: { name: "⚡" },
                },
              ],
            },
          ],
          flags: 64,
        },
      });
      return true;
    }

    case "quick_character": {
      // Open modal for quick character creation
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 9, // Modal
        data: {
          customId: "onboarding:character_modal",
          title: "Quick Character Creation",
          components: [
            {
              type: MessageComponentTypes.ActionRow,
              components: [
                {
                  type: MessageComponentTypes.InputText,
                  customId: "name",
                  label: "Character Name",
                  style: 1, // Short
                  placeholder: "e.g., Luna, Kai, Marcus",
                  required: true,
                  maxLength: 50,
                },
              ],
            },
            {
              type: MessageComponentTypes.ActionRow,
              components: [
                {
                  type: MessageComponentTypes.InputText,
                  customId: "persona",
                  label: "Persona (Who is this character?)",
                  style: 2, // Paragraph
                  placeholder: "A friendly tavern keeper with a mysterious past...",
                  required: true,
                  minLength: 20,
                  maxLength: 1000,
                },
              ],
            },
          ],
        },
      });
      return true;
    }

    case "skip_character": {
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 4,
        data: {
          content:
            "No problem! I'll respond as a helpful assistant. " +
            "Use `/build character` whenever you're ready to customize who I am.",
          flags: 64,
        },
      });
      return true;
    }

    default:
      return false;
  }
}

/** Handle onboarding modal submissions */
export async function handleOnboardingModal(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<boolean> {
  const customId = interaction.data?.customId ?? "";

  if (customId !== "onboarding:character_modal") {
    return false;
  }

  // Extract fields from modal
  const components = interaction.data?.components ?? [];
  let name = "";
  let persona = "";

  for (const row of components) {
    const comp = row.components?.[0];
    if (comp) {
      if (comp.customId === "name") {
        name = comp.value ?? "";
      } else if (comp.customId === "persona") {
        persona = comp.value ?? "";
      }
    }
  }

  if (!name || !persona) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: 4,
      data: {
        content: "Please provide both a name and persona for your character.",
        flags: 64,
      },
    });
    return true;
  }

  // Check for existing character with same name
  const existing = findEntityByName(name, "character");
  if (existing) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: 4,
      data: {
        content: `A character named "${name}" already exists. Please choose a different name.`,
        flags: 64,
      },
    });
    return true;
  }

  const channelId = interaction.channelId?.toString() ?? "";
  const worldState = getWorldState(channelId);

  // Create the character
  const character = createCharacter(name, { persona }, worldState?.id);
  info("Quick character created", { characterId: character.id, name, channelId });

  // Add to active scene if exists
  const scene = getActiveScene(channelId);
  if (scene) {
    addCharacterToScene(scene.id, character.id, { isAI: true, isActive: true });
    info("Character added to scene", { sceneId: scene.id, characterId: character.id });
  }

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      embeds: [
        {
          title: `${name} is ready!`,
          description: `Your character has been created and is now active in this channel.`,
          color: 0x57f287, // Green
          fields: [
            {
              name: "Persona",
              value: persona.length > 200 ? persona.slice(0, 200) + "..." : persona,
              inline: false,
            },
            {
              name: "Next Steps",
              value:
                "• Just chat to interact with your character\n" +
                "• Use `/character edit` to customize further\n" +
                "• Use `/character image` to set visual prompts",
              inline: false,
            },
          ],
        },
      ],
    },
  });

  return true;
}
