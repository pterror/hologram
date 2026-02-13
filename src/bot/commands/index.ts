import {
  InteractionTypes,
  ApplicationCommandTypes,
  InteractionResponseTypes,
  MessageComponentTypes,
} from "@discordeno/bot";
import type { CreateApplicationCommand, TextInputComponent, TextStyles } from "@discordeno/bot";

import type { bot } from "../client";
type Bot = typeof bot;
type Interaction = Parameters<NonNullable<Bot["events"]["interactionCreate"]>>[0];
import { info, warn, error } from "../../logger";
import { searchEntities, searchEntitiesOwnedBy, getEntitiesWithFacts, getPermissionDefaults } from "../../db/entities";
import { parsePermissionDirectives, matchesUserEntry, isUserBlacklisted, isUserAllowed } from "../../logic/expr";
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
  userRoles: string[];
}

export type CommandHandler = (ctx: CommandContext, options: Record<string, unknown>) => Promise<void>;

interface Command {
  name: string;
  description: string;
  options?: CommandOption[];
  defaultMemberPermissions?: string;
  /** Skip auto-defer for commands that may respond with a modal */
  noDefer?: boolean;
  handler: CommandHandler;
}

interface CommandOption {
  name: string;
  description: string;
  type: number;
  required?: boolean;
  choices?: { name: string; value: string }[];
  autocomplete?: boolean;
  options?: CommandOption[];  // For SubCommand/SubCommandGroup
}

// =============================================================================
// Registry
// =============================================================================

const commands = new Map<string, Command>();

/** Track which interactions have been deferred so respond() uses editOriginalInteractionResponse */
const deferredInteractions = new Set<string>();

export function registerCommand(command: Command) {
  commands.set(command.name, command);
}

// =============================================================================
// Response Helpers
// =============================================================================

const DISCORD_MESSAGE_LIMIT = 2000;

/**
 * Split content into chunks that fit Discord's message limit.
 * Tries to split at newlines when possible.
 */
function splitContent(content: string): string[] {
  if (content.length <= DISCORD_MESSAGE_LIMIT) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MESSAGE_LIMIT) {
      chunks.push(remaining);
      break;
    }

    // Find last newline within limit
    let splitIndex = remaining.lastIndexOf("\n", DISCORD_MESSAGE_LIMIT);
    if (splitIndex === -1 || splitIndex < DISCORD_MESSAGE_LIMIT / 2) {
      // No good newline, hard split at limit
      splitIndex = DISCORD_MESSAGE_LIMIT;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n/, ""); // Remove leading newline
  }

  return chunks;
}

export async function respond(
  bot: Bot,
  interaction: Interaction,
  content: string,
  ephemeral = false
) {
  const chunks = splitContent(content);
  const flags = ephemeral ? 64 : undefined; // 64 = ephemeral
  const interactionKey = interaction.id.toString();
  const isDeferred = deferredInteractions.has(interactionKey);

  if (isDeferred) {
    deferredInteractions.delete(interactionKey);
    // Edit the deferred response with first chunk
    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: chunks[0],
    });
  } else {
    // Send first chunk as initial response
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: chunks[0],
        flags,
      },
    });
  }

  // Send remaining chunks as follow-ups
  for (let i = 1; i < chunks.length; i++) {
    await bot.helpers.sendFollowupMessage(interaction.token, {
      content: chunks[i],
      flags,
    });
  }
}

export async function respondWithModal(
  bot: Bot,
  interaction: Interaction,
  customId: string,
  title: string,
  components: Array<{
    customId: string;
    label: string;
    style: TextStyles;
    value?: string;
    required?: boolean;
    placeholder?: string;
  }>
) {
  // Discord modal titles are limited to 45 characters
  const truncatedTitle = title.length > 45 ? title.slice(0, 42) + "..." : title;

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.Modal,
    data: {
      customId,
      title: truncatedTitle,
      components: components.map(c => {
        const textInput: TextInputComponent = {
          type: MessageComponentTypes.TextInput,
          customId: c.customId,
          label: c.label,
          style: c.style,
          required: c.required ?? true,
          value: c.value,
          placeholder: c.placeholder,
        };

        return {
          type: MessageComponentTypes.ActionRow as const,
          components: [textInput],
        };
      }),
    },
  });
}

/**
 * Send a Components V2 modal with Label-wrapped interactive components.
 * Labels (type 18) replace ActionRows in V2 modals.
 */
export async function respondWithV2Modal(
  bot: Bot,
  interaction: Interaction,
  customId: string,
  title: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  labels: any[]
) {
  const truncatedTitle = title.length > 45 ? title.slice(0, 42) + "..." : title;

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.Modal,
    data: {
      customId,
      title: truncatedTitle,
      components: labels,
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
  const defs: CreateApplicationCommand[] = [];

  for (const [_name, cmd] of commands) {
    const def: CreateApplicationCommand = {
      name: cmd.name,
      description: cmd.description,
      type: ApplicationCommandTypes.ChatInput,
      options: cmd.options,
    };
    if (cmd.defaultMemberPermissions) {
      def.defaultMemberPermissions = cmd.defaultMemberPermissions;
    }
    defs.push(def);
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

    // Defer response unless command may respond with a modal
    if (!command.noDefer) {
      await defer(bot, interaction, true);
      deferredInteractions.add(interaction.id.toString());
    }

    const ctx: CommandContext = {
      bot,
      interaction,
      channelId: interaction.channelId?.toString() ?? "",
      guildId: interaction.guildId?.toString(),
      userId: interaction.user?.id?.toString() ?? "",
      username: interaction.user?.username ?? "unknown",
      userRoles: (interaction.member?.roles ?? []).map((r: bigint) => r.toString()),
    };

    // Parse options (handles subcommands)
    const options: Record<string, unknown> = {};
    for (const opt of interaction.data?.options ?? []) {
      if (opt.type === 1) {
        // SubCommand - store subcommand name and parse nested options
        options._subcommand = opt.name;
        for (const nestedOpt of opt.options ?? []) {
          options[nestedOpt.name] = nestedOpt.value;
        }
      } else {
        options[opt.name] = opt.value;
      }
    }

    try {
      await command.handler(ctx, options);
    } catch (err) {
      error("Command error", err, { command: name });
      try {
        await respond(bot, interaction, `Error: ${err}`, true);
      } catch {
        // Interaction may have expired
      }
    }
  }

  // Handle modal submissions
  if (interaction.type === InteractionTypes.ModalSubmit) {
    const customId = interaction.data?.customId;
    if (!customId) return;

    // Defer response — modal submissions always respond with text
    await defer(bot, interaction, true);
    deferredInteractions.add(interaction.id.toString());

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

  // Handle message component interactions (select menus, buttons, etc.)
  if (interaction.type === InteractionTypes.MessageComponent) {
    const customId = interaction.data?.customId;
    if (customId) {
      await handleComponentInteraction(bot, interaction, customId);
    }
  }

  // Handle autocomplete
  if (interaction.type === InteractionTypes.ApplicationCommandAutocomplete) {
    await handleAutocomplete(bot, interaction);
  }
}

async function handleAutocomplete(bot: Bot, interaction: Interaction) {
  // Find focused option - may be in top-level options or nested in subcommand
  let focused = interaction.data?.options?.find((o: { focused?: boolean }) => o.focused);

  // If not found at top level, look in subcommand options
  if (!focused) {
    for (const opt of interaction.data?.options ?? []) {
      if (opt.type === 1) {
        // SubCommand
        focused = opt.options?.find((o: { focused?: boolean }) => o.focused);
        if (focused) break;
      }
    }
  }
  if (!focused) return;

  const query = (focused.value as string) || "";
  const commandName = interaction.data?.name;
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  const userRoles: string[] = (interaction.member?.roles ?? []).map((r: bigint) => r.toString());

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

    // If target not yet selected, show entities user can edit or use as fallback
    if (!target) {
      const allResults = searchEntities(query, 100);
      const entitiesWithFacts = getEntitiesWithFacts(allResults.map(e => e.id));
      results = allResults.filter(entity => {
        if (entity.owned_by === userId) return true;
        const entityWithFacts = entitiesWithFacts.get(entity.id);
        if (!entityWithFacts) return false;
        const facts = entityWithFacts.facts.map(f => f.content);
        const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));
        if (isUserBlacklisted(permissions, userId, username, entity.owned_by, userRoles)) return false;
        if (permissions.editList === "@everyone") return true;
        if (permissions.editList?.some(u => matchesUserEntry(u, userId, username, userRoles))) return true;
        if (isUserAllowed(permissions, userId, username, entity.owned_by, userRoles)) return true;
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

      // Get entity details and filter by search query and edit/use permission
      const isPersonaTarget = target.startsWith("me:");
      const entitiesWithFacts = getEntitiesWithFacts(boundEntityIds);
      const queryLower = query.toLowerCase();
      results = [];
      for (const [entityId, entityWithFacts] of entitiesWithFacts) {
        // Filter by search query
        if (query && !entityWithFacts.name.toLowerCase().includes(queryLower)) continue;

        // Check permission: edit for channel/server, use for persona
        if (entityWithFacts.owned_by !== userId) {
          const facts = entityWithFacts.facts.map(f => f.content);
          const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entityId));
          if (isUserBlacklisted(permissions, userId, username, entityWithFacts.owned_by, userRoles)) continue;
          if (isPersonaTarget) {
            if (!isUserAllowed(permissions, userId, username, entityWithFacts.owned_by, userRoles)) continue;
          } else {
            if (permissions.editList !== "@everyone" &&
                !permissions.editList?.some(u => matchesUserEntry(u, userId, username, userRoles))) {
              continue;
            }
          }
        }

        results.push({ id: entityId, name: entityWithFacts.name, owned_by: entityWithFacts.owned_by });
      }
      results = results.slice(0, 25);
    }
  } else if (commandName === "bind") {
    // Check if target is already selected to filter more precisely
    const options = interaction.data?.options ?? [];
    const targetOption = options.find((o: { name: string }) => o.name === "target");
    const target = targetOption?.value as string | undefined;
    const isPersonaTarget = target?.startsWith("me:");

    const allResults = searchEntities(query, 100);
    const entitiesWithFacts = getEntitiesWithFacts(allResults.map(e => e.id));

    results = allResults.filter(entity => {
      if (entity.owned_by === userId) return true;
      const entityWithFacts = entitiesWithFacts.get(entity.id);
      if (!entityWithFacts) return false;
      const facts = entityWithFacts.facts.map(f => f.content);
      const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));
      if (isUserBlacklisted(permissions, userId, username, entity.owned_by, userRoles)) return false;

      if (isPersonaTarget) {
        // Persona bind: check use permission
        return isUserAllowed(permissions, userId, username, entity.owned_by, userRoles);
      }
      // Channel/server bind (or target not yet selected): check edit permission
      if (permissions.editList === "@everyone") return true;
      if (permissions.editList?.some(u => matchesUserEntry(u, userId, username, userRoles))) return true;
      return false;
    }).slice(0, 25);
  } else if (commandName === "edit") {
    // Edit requires edit permission - batch load facts
    const allResults = searchEntities(query, 100);
    const entitiesWithFacts = getEntitiesWithFacts(allResults.map(e => e.id));

    results = allResults.filter(entity => {
      if (entity.owned_by === userId) return true;
      const entityWithFacts = entitiesWithFacts.get(entity.id);
      if (!entityWithFacts) return false;
      const facts = entityWithFacts.facts.map(f => f.content);
      const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));
      if (isUserBlacklisted(permissions, userId, username, entity.owned_by, userRoles)) return false;
      if (permissions.editList === "@everyone") return true;
      if (permissions.editList?.some(u => matchesUserEntry(u, userId, username, userRoles))) return true;
      return false;
    }).slice(0, 25);
  } else if (commandName === "view" || commandName === "debug") {
    // View and debug require view permission - batch load facts
    const allResults = searchEntities(query, 100);
    const entitiesWithFacts = getEntitiesWithFacts(allResults.map(e => e.id));

    results = allResults.filter(entity => {
      if (entity.owned_by === userId) return true;
      const entityWithFacts = entitiesWithFacts.get(entity.id);
      if (!entityWithFacts) return false;
      const facts = entityWithFacts.facts.map(f => f.content);
      const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));
      if (isUserBlacklisted(permissions, userId, username, entity.owned_by, userRoles)) return false;
      // No $view directive = owner-only by default
      if (permissions.viewList === null) return false;
      if (permissions.viewList === "@everyone") return true;
      if (permissions.viewList.some(u => matchesUserEntry(u, userId, username, userRoles))) return true;
      return false;
    }).slice(0, 25);
  } else if (commandName === "trigger") {
    // Trigger requires $use whitelist check - batch load facts
    const allResults = searchEntities(query, 100);
    const entitiesWithFacts = getEntitiesWithFacts(allResults.map(e => e.id));

    results = allResults.filter(entity => {
      if (entity.owned_by === userId) return true;
      const entityWithFacts = entitiesWithFacts.get(entity.id);
      if (!entityWithFacts) return false;
      const facts = entityWithFacts.facts.map(f => f.content);
      const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));
      if (isUserBlacklisted(permissions, userId, username, entity.owned_by, userRoles)) return false;
      if (!isUserAllowed(permissions, userId, username, entity.owned_by, userRoles)) return false;
      return true;
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

// Component interaction handlers (for select menus, buttons, etc.)
const componentHandlers = new Map<string, (bot: Bot, interaction: Interaction) => Promise<void>>();

export function registerComponentHandler(prefix: string, handler: (bot: Bot, interaction: Interaction) => Promise<void>) {
  componentHandlers.set(prefix, handler);
}

async function handleComponentInteraction(bot: Bot, interaction: Interaction, customId: string) {
  const prefix = customId.split(":")[0];
  const handler = componentHandlers.get(prefix);
  if (handler) {
    try {
      await handler(bot, interaction);
    } catch (err) {
      error("Component handler error", err, { customId });
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: InteractionResponseTypes.UpdateMessage,
        data: { content: `Error: ${err}` },
      });
    }
  }
}

// =============================================================================
// Component Response Helpers
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function respondWithComponents(bot: Bot, interaction: Interaction, content: string, components: any[], ephemeral = true) {
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: {
      content,
      components,
      flags: ephemeral ? 64 : undefined,
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function updateMessageWithComponents(bot: Bot, interaction: Interaction, content: string, components: any[]) {
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.UpdateMessage,
    data: {
      content,
      components,
    },
  });
}
