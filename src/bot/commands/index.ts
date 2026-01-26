import {
  type CreateApplicationCommand,
  InteractionTypes,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
export { USER_APP_INTEGRATION, GUILD_ONLY_INTEGRATION } from "./integration";
import { characterCommand, handleCharacterCommand, handleCharacterAutocomplete } from "./character";
import { worldCommand, handleWorldCommand } from "./world";
import { memoryCommand, handleMemoryCommand } from "./memory";
import { sessionCommand, handleSessionCommand } from "./session";
import { configCommand, handleConfigCommand, handleConfigWizardComponent } from "./config";
import { sceneCommand, handleSceneCommand } from "./scene";
import { chronicleCommand, handleChronicleCommand } from "./chronicle";
import { statusCommand, handleStatusCommand } from "./status";
import { locationCommand, handleLocationCommand } from "./location";
import { timeCommand, handleTimeCommand } from "./time";
import { rollCommand, rCommand, handleRollCommand, handleRCommand } from "./roll";
import { combatCommand, handleCombatCommand } from "./combat";
import { relationshipCommand, handleRelationshipCommand } from "./relationship";
import { factionCommand, handleFactionCommand } from "./faction";
import { personaCommand, handlePersonaCommand } from "./persona";
import { proxyCommand, handleProxyCommand } from "./proxy";
import { buildCommand, handleBuildCommand, handleBuildWizardComponent } from "./build";
import { setupCommand, handleSetupCommand, handleSetupComponent } from "./setup";
import { tipsCommand, handleTipsCommand } from "./tips";
import { helpCommand, handleHelpCommand, handleHelpComponent } from "./help";
import { imagineCommand, handleImagineCommand } from "./imagine";
import { quotaCommand, handleQuotaCommand } from "./quota";
import { keysCommand, handleKeysCommand, handleKeysModal } from "./keys";
import { exportCommand, handleExportCommand } from "./export";
import { channelCommand, handleChannelCommand } from "./channel";
import { rerollCommand, handleRerollCommand } from "./reroll";
import { importCommand, handleImportCommand } from "./import";
import { notesCommand, handleNotesCommand } from "./notes";
import { debugCommand, handleDebugCommand } from "./debug";
import { handleOnboardingComponent, handleOnboardingModal } from "../onboarding";

// All slash commands
export const commands: CreateApplicationCommand[] = [
  characterCommand,
  worldCommand,
  memoryCommand,
  sessionCommand,
  configCommand,
  sceneCommand,
  chronicleCommand,
  statusCommand,
  locationCommand,
  timeCommand,
  rollCommand,
  rCommand,
  combatCommand,
  relationshipCommand,
  factionCommand,
  personaCommand,
  proxyCommand,
  buildCommand,
  setupCommand,
  tipsCommand,
  helpCommand,
  imagineCommand,
  quotaCommand,
  keysCommand,
  exportCommand,
  channelCommand,
  rerollCommand,
  importCommand,
  notesCommand,
  debugCommand,
];

// Register commands with Discord
export async function registerCommands(bot: HologramBot): Promise<void> {
  console.log("Registering slash commands...");

  try {
    // Register globally (takes up to an hour to propagate)
    // For development, use guild-specific registration instead
    await bot.helpers.upsertGlobalApplicationCommands(commands);
    console.log(`Registered ${commands.length} global commands`);
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
}

// Register commands for a specific guild (instant, good for dev)
export async function registerGuildCommands(
  bot: HologramBot,
  guildId: bigint
): Promise<void> {
  console.log(`Registering commands for guild ${guildId}...`);

  try {
    await bot.helpers.upsertGuildApplicationCommands(guildId, commands);
    console.log(`Registered ${commands.length} guild commands`);
  } catch (error) {
    console.error("Failed to register guild commands:", error);
  }
}

// Handle incoming interactions
export async function handleInteraction(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  // Handle component interactions (buttons, selects)
  if (interaction.type === InteractionTypes.MessageComponent) {
    // Route to appropriate handler based on custom_id prefix
    if (await handleOnboardingComponent(bot, interaction)) {
      return;
    }
    if (await handleSetupComponent(bot, interaction)) {
      return;
    }
    if (await handleConfigWizardComponent(bot, interaction)) {
      return;
    }
    if (await handleBuildWizardComponent(bot, interaction)) {
      return;
    }
    if (await handleHelpComponent(bot, interaction)) {
      return;
    }
    // Unknown component, ignore
    return;
  }

  // Handle modal submissions
  if (interaction.type === InteractionTypes.ModalSubmit) {
    if (await handleKeysModal(bot, interaction)) {
      return;
    }
    if (await handleBuildWizardComponent(bot, interaction)) {
      return;
    }
    if (await handleOnboardingModal(bot, interaction)) {
      return;
    }
    return;
  }

  // Handle autocomplete
  if (interaction.type === InteractionTypes.ApplicationCommandAutocomplete) {
    const commandName = interaction.data?.name;
    switch (commandName) {
      case "character":
        await handleCharacterAutocomplete(bot, interaction);
        break;
      // Add more autocomplete handlers here as needed
    }
    return;
  }

  // Only handle slash commands
  if (interaction.type !== InteractionTypes.ApplicationCommand) {
    return;
  }

  const commandName = interaction.data?.name;
  if (!commandName) return;

  try {
    switch (commandName) {
      case "character":
        await handleCharacterCommand(bot, interaction);
        break;
      case "world":
        await handleWorldCommand(bot, interaction);
        break;
      case "memory":
        await handleMemoryCommand(bot, interaction);
        break;
      case "session":
        await handleSessionCommand(bot, interaction);
        break;
      case "config":
        await handleConfigCommand(bot, interaction);
        break;
      case "scene":
        await handleSceneCommand(bot, interaction);
        break;
      case "chronicle":
        await handleChronicleCommand(bot, interaction);
        break;
      case "status":
        await handleStatusCommand(bot, interaction);
        break;
      case "location":
        await handleLocationCommand(bot, interaction);
        break;
      case "time":
        await handleTimeCommand(bot, interaction);
        break;
      case "roll":
        await handleRollCommand(bot, interaction);
        break;
      case "r":
        await handleRCommand(bot, interaction);
        break;
      case "combat":
        await handleCombatCommand(bot, interaction);
        break;
      case "relationship":
        await handleRelationshipCommand(bot, interaction);
        break;
      case "faction":
        await handleFactionCommand(bot, interaction);
        break;
      case "persona":
        await handlePersonaCommand(bot, interaction);
        break;
      case "proxy":
        await handleProxyCommand(bot, interaction);
        break;
      case "build":
        await handleBuildCommand(bot, interaction);
        break;
      case "setup":
        await handleSetupCommand(bot, interaction);
        break;
      case "tips":
        await handleTipsCommand(bot, interaction);
        break;
      case "help":
        await handleHelpCommand(bot, interaction);
        break;
      case "imagine":
        await handleImagineCommand(bot, interaction);
        break;
      case "quota":
        await handleQuotaCommand(bot, interaction);
        break;
      case "keys":
        await handleKeysCommand(bot, interaction);
        break;
      case "export":
        await handleExportCommand(bot, interaction);
        break;
      case "channel":
        await handleChannelCommand(bot, interaction);
        break;
      case "reroll":
        await handleRerollCommand(bot, interaction);
        break;
      case "import":
        await handleImportCommand(bot, interaction);
        break;
      case "notes":
        await handleNotesCommand(bot, interaction);
        break;
      case "debug":
        await handleDebugCommand(bot, interaction);
        break;
      default:
        await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
          type: 4, // ChannelMessageWithSource
          data: {
            content: `Unknown command: ${commandName}`,
            flags: 64, // Ephemeral
          },
        });
    }
  } catch (error) {
    console.error(`Error handling command ${commandName}:`, error);
    try {
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 4,
        data: {
          content: `Error executing command: ${error instanceof Error ? error.message : "Unknown error"}`,
          flags: 64,
        },
      });
    } catch {
      // Interaction may have already been responded to
    }
  }
}

// Helper to get option value from interaction
export function getOptionValue<T>(
  interaction: HologramInteraction,
  name: string
): T | undefined {
  const options = interaction.data?.options;
  if (!options) return undefined;

  // Check top-level options
  for (const opt of options) {
    if (opt.name === name) {
      return opt.value as T;
    }
    // Check nested options (for subcommands)
    if (opt.options) {
      for (const subOpt of opt.options) {
        if (subOpt.name === name) {
          return subOpt.value as T;
        }
      }
    }
  }

  return undefined;
}

// Get subcommand name
export function getSubcommand(interaction: HologramInteraction): string | undefined {
  const options = interaction.data?.options;
  if (!options || options.length === 0) return undefined;

  const first = options[0];
  if (
    first.type === ApplicationCommandOptionTypes.SubCommand ||
    first.type === ApplicationCommandOptionTypes.SubCommandGroup
  ) {
    return first.name;
  }

  return undefined;
}

// Shared interaction response helpers
export async function respond(
  bot: HologramBot,
  interaction: HologramInteraction,
  content: string,
  ephemeral = false
): Promise<void> {
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      content,
      flags: ephemeral ? 64 : 0,
    },
  });
}

export async function respondDeferred(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 5, // DeferredChannelMessageWithSource
  });
}

export async function editResponse(
  bot: HologramBot,
  interaction: HologramInteraction,
  content: string
): Promise<void> {
  await bot.helpers.editOriginalInteractionResponse(interaction.token, {
    content,
  });
}

// Get nested subcommand (for subcommand groups)
export function getNestedSubcommand(
  interaction: HologramInteraction
): string | undefined {
  const options = interaction.data?.options;
  if (!options || options.length === 0) return undefined;

  const first = options[0];
  if (
    first.type === ApplicationCommandOptionTypes.SubCommandGroup &&
    first.options &&
    first.options.length > 0
  ) {
    return first.options[0].name;
  }

  return undefined;
}
