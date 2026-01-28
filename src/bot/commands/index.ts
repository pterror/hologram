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
import { info, warn, error } from "../../logger";
import { searchEntities, searchEntitiesOwnedBy, getEntitiesWithFacts } from "../../db/entities";
import { parsePermissionDirectives } from "../../logic/expr";
import { getBoundEntityIds, type DiscordType } from "../../db/discord";

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
      components: components.map(c => {
        const textInput: Record<string, unknown> = {
          type: MessageComponentTypes.TextInput,
          customId: c.customId,
          label: c.label,
          style: c.style,
          required: c.required ?? true,
        };
        if (c.value !== undefined) textInput.value = c.value;
        if (c.placeholder !== undefined) textInput.placeholder = c.placeholder;

        return {
          type: MessageComponentTypes.ActionRow,
          components: [textInput],
        };
      }),
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

  for (const [_name, cmd] of commands) {
    defs.push({
      name: cmd.name,
      description: cmd.description,
      type: ApplicationCommandTypes.ChatInput,
      options: cmd.options,
    });
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
  const commandName = interaction.data?.name;
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";

  let results;

  // Filter based on command - only show entities the user can actually use
  if (commandName === "delete" || commandName === "transfer") {
    // These commands require ownership - no permission check needed
    results = searchEntitiesOwnedBy(query, userId, 25);
  } else if (commandName === "unbind") {
    // Unbind shows only entities bound to the selected target
    const options = interaction.data?.options ?? [];
    const targetOption = options.find((o: { name: string }) => o.name === "target");
    const target = targetOption?.value as string | undefined;

    // If target not yet selected, show all editable entities as fallback
    if (!target) {
      const allResults = searchEntities(query, 100);
      const entitiesWithFacts = getEntitiesWithFacts(allResults.map(e => e.id));
      results = allResults.filter(entity => {
        if (entity.owned_by === userId) return true;
        const entityWithFacts = entitiesWithFacts.get(entity.id);
        if (!entityWithFacts) return false;
        const facts = entityWithFacts.facts.map(f => f.content);
        const permissions = parsePermissionDirectives(facts);
        if (permissions.editList === "everyone") return true;
        if (permissions.editList?.some(u => u.toLowerCase() === username.toLowerCase())) return true;
        return false;
      }).slice(0, 25);
    } else {
      // Determine discordId and discordType based on target
      const channelId = interaction.channelId?.toString() ?? "";
      const guildId = interaction.guildId?.toString();

      let discordId: string;
      let discordType: DiscordType;
      if (target === "channel") {
        discordId = channelId;
        discordType = "channel";
      } else if (target === "server") {
        discordId = guildId ?? "";
        discordType = "guild";
      } else {
        discordId = userId;
        discordType = "user";
      }

      // Get all entities bound to this target (any scope)
      const boundEntityIds = getBoundEntityIds(discordId, discordType);

      // Get entity details and filter by search query and edit permission
      const entitiesWithFacts = getEntitiesWithFacts(boundEntityIds);
      const queryLower = query.toLowerCase();
      results = [];
      for (const [entityId, entityWithFacts] of entitiesWithFacts) {
        // Filter by search query
        if (query && !entityWithFacts.name.toLowerCase().includes(queryLower)) continue;

        // Check edit permission
        if (entityWithFacts.owned_by !== userId) {
          const facts = entityWithFacts.facts.map(f => f.content);
          const permissions = parsePermissionDirectives(facts);
          if (permissions.editList !== "everyone" &&
              !permissions.editList?.some(u => u.toLowerCase() === username.toLowerCase())) {
            continue;
          }
        }

        results.push({ id: entityId, name: entityWithFacts.name, owned_by: entityWithFacts.owned_by });
      }
      results = results.slice(0, 25);
    }
  } else if (commandName === "edit" || commandName === "bind") {
    // These commands require edit permission - batch load facts
    const allResults = searchEntities(query, 100);
    const entitiesWithFacts = getEntitiesWithFacts(allResults.map(e => e.id));

    results = allResults.filter(entity => {
      if (entity.owned_by === userId) return true;
      const entityWithFacts = entitiesWithFacts.get(entity.id);
      if (!entityWithFacts) return false;
      const facts = entityWithFacts.facts.map(f => f.content);
      const permissions = parsePermissionDirectives(facts);
      if (permissions.editList === "everyone") return true;
      if (permissions.editList?.some(u => u.toLowerCase() === username.toLowerCase())) return true;
      return false;
    }).slice(0, 25);
  } else if (commandName === "view") {
    // View requires view permission - batch load facts
    const allResults = searchEntities(query, 100);
    const entitiesWithFacts = getEntitiesWithFacts(allResults.map(e => e.id));

    results = allResults.filter(entity => {
      if (entity.owned_by === userId) return true;
      const entityWithFacts = entitiesWithFacts.get(entity.id);
      if (!entityWithFacts) return false;
      const facts = entityWithFacts.facts.map(f => f.content);
      const permissions = parsePermissionDirectives(facts);
      // No $view directive = public by default
      if (permissions.viewList === null) return true;
      if (permissions.viewList === "everyone") return true;
      if (permissions.viewList.some(u => u.toLowerCase() === username.toLowerCase())) return true;
      return false;
    }).slice(0, 25);
  } else {
    // Fallback - show all
    results = searchEntities(query, 25);
  }

  const choices = results.map(e => ({
    name: e.name,
    value: e.name,
  }));

  try {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ApplicationCommandAutocompleteResult,
      data: {
        choices,
      },
    });
  } catch (err) {
    // Interaction may have expired (3s timeout) - log but don't crash
    warn("Autocomplete response failed (interaction may have expired)", { err });
  }
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
