import {
  type CreateApplicationCommand,
  InteractionTypes,
  ApplicationCommandOptionTypes,
  DiscordApplicationIntegrationType,
  DiscordInteractionContextType,
} from "@discordeno/bot";

// User app integration - works in DMs and guilds
export const USER_APP_INTEGRATION = {
  integrationTypes: [
    DiscordApplicationIntegrationType.GuildInstall,
    DiscordApplicationIntegrationType.UserInstall,
  ],
  contexts: [
    DiscordInteractionContextType.Guild,
    DiscordInteractionContextType.BotDm,
  ],
};

// Guild-only integration - requires server install
export const GUILD_ONLY_INTEGRATION = {
  integrationTypes: [DiscordApplicationIntegrationType.GuildInstall],
  contexts: [DiscordInteractionContextType.Guild],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInteraction = any;
import { characterCommand, handleCharacterCommand } from "./character";
import { worldCommand, handleWorldCommand } from "./world";
import { memoryCommand, handleMemoryCommand } from "./memory";
import { sessionCommand, handleSessionCommand } from "./session";
import { configCommand, handleConfigCommand, handleConfigWizardComponent } from "./config";
import { sceneCommand, handleSceneCommand } from "./scene";
import { chronicleCommand, handleChronicleCommand } from "./chronicle";

// All slash commands
export const commands: CreateApplicationCommand[] = [
  characterCommand,
  worldCommand,
  memoryCommand,
  sessionCommand,
  configCommand,
  sceneCommand,
  chronicleCommand,
];

// Register commands with Discord
export async function registerCommands(bot: AnyBot): Promise<void> {
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
  bot: AnyBot,
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
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  // Handle component interactions (buttons, selects)
  if (interaction.type === InteractionTypes.MessageComponent) {
    // Route to appropriate handler based on custom_id prefix
    if (await handleConfigWizardComponent(bot, interaction)) {
      return;
    }
    // Unknown component, ignore
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
  interaction: AnyInteraction,
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
export function getSubcommand(interaction: AnyInteraction): string | undefined {
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

// Get nested subcommand (for subcommand groups)
export function getNestedSubcommand(
  interaction: AnyInteraction
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
