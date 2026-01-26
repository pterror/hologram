import {
  InteractionTypes,
  ApplicationCommandTypes,
  InteractionResponseTypes,
  MessageComponentTypes,
} from "@discordeno/bot";

// Use loose types to avoid desiredProperties conflicts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Interaction = any;
import { info, error } from "../../logger";

// =============================================================================
// Types
// =============================================================================

export interface CommandContext {
  bot: Bot;
  interaction: Interaction;
  channelId: string;
  guildId: string | undefined;
  userId: string;
  username: string;
}

export type CommandHandler = (ctx: CommandContext, options: Record<string, unknown>) => Promise<void>;

interface Command {
  name: string;
  description: string;
  options?: CommandOption[];
  handler: CommandHandler;
}

interface CommandOption {
  name: string;
  description: string;
  type: number;
  required?: boolean;
  choices?: { name: string; value: string }[];
  autocomplete?: boolean;
}

// =============================================================================
// Registry
// =============================================================================

const commands = new Map<string, Command>();

export function registerCommand(command: Command) {
  commands.set(command.name, command);
  // Also register short alias if different
  const alias = getAlias(command.name);
  if (alias && alias !== command.name) {
    commands.set(alias, command);
  }
}

function getAlias(name: string): string | null {
  const aliases: Record<string, string> = {
    create: "c",
    view: "v",
    edit: "e",
    delete: "d",
    bind: "b",
    status: "s",
  };
  return aliases[name] ?? null;
}

// =============================================================================
// Response Helpers
// =============================================================================

export async function respond(
  bot: Bot,
  interaction: Interaction,
  content: string,
  ephemeral = false
) {
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: {
      content,
      flags: ephemeral ? 64 : undefined, // 64 = ephemeral
    },
  });
}

export async function respondWithModal(
  bot: Bot,
  interaction: Interaction,
  customId: string,
  title: string,
  components: Array<{
    customId: string;
    label: string;
    style: number;
    value?: string;
    required?: boolean;
    placeholder?: string;
  }>
) {
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.Modal,
    data: {
      customId,
      title,
      components: components.map(c => ({
        type: MessageComponentTypes.ActionRow,
        components: [{
          type: MessageComponentTypes.InputText,
          customId: c.customId,
          label: c.label,
          style: c.style,
          value: c.value,
          required: c.required ?? true,
          placeholder: c.placeholder,
        }],
      })),
    },
  });
}

export async function defer(bot: Bot, interaction: Interaction, ephemeral = false) {
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.DeferredChannelMessageWithSource,
    data: {
      flags: ephemeral ? 64 : undefined,
    },
  });
}

export async function followUp(bot: Bot, interaction: Interaction, content: string) {
  await bot.helpers.editOriginalInteractionResponse(interaction.token, {
    content,
  });
}

// =============================================================================
// Registration
// =============================================================================

export async function registerCommands(bot: Bot) {
  // Build command definitions for Discord
  const defs = [];
  const seen = new Set<string>();

  for (const [_name, cmd] of commands) {
    // Skip aliases, only register primary names
    if (seen.has(cmd.name)) continue;
    seen.add(cmd.name);

    defs.push({
      name: cmd.name,
      description: cmd.description,
      type: ApplicationCommandTypes.ChatInput,
      options: cmd.options,
    });

    // Also register alias as separate command
    const alias = getAlias(cmd.name);
    if (alias) {
      defs.push({
        name: alias,
        description: cmd.description,
        type: ApplicationCommandTypes.ChatInput,
        options: cmd.options,
      });
    }
  }

  await bot.helpers.upsertGlobalApplicationCommands(defs);
  info("Registered commands", { count: defs.length });
}

// =============================================================================
// Interaction Handler
// =============================================================================

export async function handleInteraction(bot: Bot, interaction: Interaction) {
  // Handle slash commands
  if (interaction.type === InteractionTypes.ApplicationCommand) {
    const name = interaction.data?.name;
    if (!name) return;

    const command = commands.get(name);
    if (!command) {
      await respond(bot, interaction, `Unknown command: ${name}`, true);
      return;
    }

    const ctx: CommandContext = {
      bot,
      interaction,
      channelId: interaction.channelId?.toString() ?? "",
      guildId: interaction.guildId?.toString(),
      userId: interaction.user?.id?.toString() ?? "",
      username: interaction.user?.username ?? "unknown",
    };

    // Parse options
    const options: Record<string, unknown> = {};
    for (const opt of interaction.data?.options ?? []) {
      options[opt.name] = opt.value;
    }

    try {
      await command.handler(ctx, options);
    } catch (err) {
      error("Command error", err, { command: name });
      await respond(bot, interaction, `Error: ${err}`, true);
    }
  }

  // Handle modal submissions
  if (interaction.type === InteractionTypes.ModalSubmit) {
    const customId = interaction.data?.customId;
    if (!customId) return;

    // Parse modal data
    const values: Record<string, string> = {};
    for (const row of interaction.data?.components ?? []) {
      for (const component of row.components ?? []) {
        if (component.customId && component.value !== undefined) {
          values[component.customId] = component.value;
        }
      }
    }

    // Route to appropriate handler based on customId prefix
    await handleModalSubmit(bot, interaction, customId, values);
  }

  // Handle autocomplete
  if (interaction.type === InteractionTypes.ApplicationCommandAutocomplete) {
    await handleAutocomplete(bot, interaction);
  }
}

async function handleAutocomplete(bot: Bot, interaction: Interaction) {
  const focused = interaction.data?.options?.find((o: { focused?: boolean }) => o.focused);
  if (!focused) return;

  const query = (focused.value as string) || "";

  // Import here to avoid circular deps
  const { searchEntities } = await import("../../db/entities");
  const results = searchEntities(query, 25);

  const choices = results.map(e => ({
    name: e.name,
    value: e.name,
  }));

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ApplicationCommandAutocompleteResult,
    data: {
      choices,
    },
  });
}

// Modal submit handlers
const modalHandlers = new Map<string, (bot: Bot, interaction: Interaction, values: Record<string, string>) => Promise<void>>();

export function registerModalHandler(prefix: string, handler: (bot: Bot, interaction: Interaction, values: Record<string, string>) => Promise<void>) {
  modalHandlers.set(prefix, handler);
}

async function handleModalSubmit(bot: Bot, interaction: Interaction, customId: string, values: Record<string, string>) {
  const prefix = customId.split(":")[0];
  const handler = modalHandlers.get(prefix);
  if (handler) {
    await handler(bot, interaction, values);
  }
}
