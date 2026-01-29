import { ApplicationCommandOptionTypes, TextStyles } from "@discordeno/bot";
import {
  registerCommand,
  registerModalHandler,
  respond,
  respondWithModal,
  type CommandContext,
} from "./index";
import {
  createEntity,
  getEntity,
  getEntityByName,
  getEntityWithFacts,
  getEntityWithFactsByName,
  updateEntity,
  deleteEntity,
  transferOwnership,
  addFact,
  setFacts,
  ensureSystemEntity,
  type EntityWithFacts,
} from "../../db/entities";
import {
  getMemoriesForEntity,
  setMemories,
} from "../../db/memories";
import {
  addDiscordEntity,
  resolveDiscordEntity,
  resolveDiscordEntities,
  removeDiscordEntityBinding,
  getChannelScopedEntities,
  getGuildScopedEntities,
  getMessages,
  setChannelForgetTime,
} from "../../db/discord";
import { parsePermissionDirectives, matchesUserEntry, isUserBlacklisted, evaluateFacts, createBaseContext } from "../../logic/expr";
import { formatEntityDisplay, formatEvaluatedEntity, buildMessageHistory } from "../../ai/context";

// =============================================================================
// Text Elision Helper
// =============================================================================

const MAX_OUTPUT_CHARS = 8000;
const ELISION_MARKER = "\n... (elided) ...\n";

/**
 * Elide text that exceeds the max length, keeping beginning and end.
 */
function elideText(text: string, maxLen = MAX_OUTPUT_CHARS): string {
  if (text.length <= maxLen) return text;
  const keepLen = maxLen - ELISION_MARKER.length;
  const halfKeep = Math.floor(keepLen / 2);
  return text.slice(0, halfKeep) + ELISION_MARKER + text.slice(-halfKeep);
}

// =============================================================================
// Permission Helpers
// =============================================================================

/**
 * Check if a user can edit an entity.
 * Owner always can. Blacklist blocks everyone except owner.
 * Otherwise check $edit directive. Default = owner-only.
 */
function canUserEdit(entity: EntityWithFacts, userId: string, username: string): boolean {
  // Owner always can
  if (entity.owned_by === userId) return true;

  // Parse permission directives from raw facts
  const facts = entity.facts.map(f => f.content);
  const permissions = parsePermissionDirectives(facts);

  // Check blacklist first (deny overrides allow)
  if (isUserBlacklisted(permissions, userId, username, entity.owned_by)) return false;

  // Check $edit directive (supports both usernames and Discord IDs)
  if (permissions.editList === "everyone") return true;
  if (permissions.editList && permissions.editList.some(u => matchesUserEntry(u, userId, username))) return true;

  // No $edit directive = owner only
  return false;
}

/**
 * Check if a user can view an entity.
 * Owner always can. Blacklist blocks everyone except owner.
 * Otherwise check $view directive. Default = everyone (public).
 */
function canUserView(entity: EntityWithFacts, userId: string, username: string): boolean {
  // Owner always can
  if (entity.owned_by === userId) return true;

  // Parse permission directives from raw facts
  const facts = entity.facts.map(f => f.content);
  const permissions = parsePermissionDirectives(facts);

  // Check blacklist first (deny overrides allow)
  if (isUserBlacklisted(permissions, userId, username, entity.owned_by)) return false;

  // If no $view directive, default to public (everyone can view)
  if (permissions.viewList === null) return true;

  // Check $view directive (supports both usernames and Discord IDs)
  if (permissions.viewList === "everyone") return true;
  if (permissions.viewList.some(u => matchesUserEntry(u, userId, username))) return true;

  return false;
}

// =============================================================================
// /create - Create entity
// =============================================================================

registerCommand({
  name: "create",
  description: "Create a new entity",
  options: [
    {
      name: "name",
      description: "Name of the entity",
      type: ApplicationCommandOptionTypes.String,
      required: false,
    },
  ],
  async handler(ctx, options) {
    const name = options.name as string | undefined;

    if (name) {
      // Quick create with name
      const entity = createEntity(name, ctx.userId);
      await respond(ctx.bot, ctx.interaction, `Created ${formatEntityDisplay(name, entity.id)}`, true);
    } else {
      // Open modal for details
      await respondWithModal(ctx.bot, ctx.interaction, "create", "Create entity", [
        {
          customId: "name",
          label: "Name",
          style: TextStyles.Short,
          required: true,
          placeholder: "Enter entity name",
        },
        {
          customId: "facts",
          label: "Facts (one per line)",
          style: TextStyles.Paragraph,
          required: false,
          placeholder: "Enter facts about this entity, one per line",
        },
      ]);
    }
  },
});

registerModalHandler("create", async (bot, interaction, values) => {
  const name = values.name;
  const factsText = values.facts ?? "";

  const userId = interaction.user?.id?.toString() ?? "";
  const entity = createEntity(name, userId);

  // Add user-provided facts
  const facts = factsText.split("\n").map(f => f.trim()).filter(f => f);
  for (const fact of facts) {
    addFact(entity.id, fact);
  }

  await respond(bot, interaction, `Created ${formatEntityDisplay(name, entity.id)} with ${facts.length} facts`, true);
});

// =============================================================================
// /view - View entity
// =============================================================================

registerCommand({
  name: "view",
  description: "View an entity and its facts or memories",
  options: [
    {
      name: "entity",
      description: "Entity name or ID",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "type",
      description: "What to view (default: all)",
      type: ApplicationCommandOptionTypes.String,
      required: false,
      choices: [
        { name: "All (facts + memories)", value: "all" },
        { name: "Facts only", value: "facts" },
        { name: "Memories only", value: "memories" },
      ],
    },
  ],
  async handler(ctx, options) {
    const input = options.entity as string;
    const viewType = (options.type as string) ?? "all";

    // Try by ID first, then by name
    let entity: EntityWithFacts | null = null;
    const id = parseInt(input);
    if (!isNaN(id)) {
      entity = getEntityWithFacts(id);
    }
    if (!entity) {
      entity = getEntityWithFactsByName(input);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${input}`, true);
      return;
    }

    // Check view permission
    if (!canUserView(entity, ctx.userId, ctx.username)) {
      await respond(ctx.bot, ctx.interaction, "You don't have permission to view this entity", true);
      return;
    }

    const parts: string[] = [formatEntityDisplay(entity.name, entity.id)];

    // Show facts if requested
    if (viewType === "all" || viewType === "facts") {
      const factsDisplay = entity.facts.length > 0
        ? entity.facts.map(f => `• ${f.content}`).join("\n")
        : "(no facts)";
      if (viewType === "all") {
        parts.push(`\n**Facts:**\n${factsDisplay}`);
      } else {
        parts.push(`\n${factsDisplay}`);
      }
    }

    // Show memories if requested
    if (viewType === "all" || viewType === "memories") {
      const memories = getMemoriesForEntity(entity.id);
      const memoriesDisplay = memories.length > 0
        ? memories.map(m => `• ${m.content} (frecency: ${m.frecency.toFixed(2)})`).join("\n")
        : "(no memories)";
      if (viewType === "all") {
        parts.push(`\n**Memories:**\n${memoriesDisplay}`);
      } else {
        parts.push(`\n${memoriesDisplay}`);
      }
    }

    await respond(ctx.bot, ctx.interaction, elideText(parts.join("")), true);
  },
});

// =============================================================================
// /edit - Edit entity facts
// =============================================================================

registerCommand({
  name: "edit",
  description: "Edit an entity's facts or memories",
  options: [
    {
      name: "entity",
      description: "Entity name or ID",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "type",
      description: "What to edit (default: facts)",
      type: ApplicationCommandOptionTypes.String,
      required: false,
      choices: [
        { name: "Facts", value: "facts" },
        { name: "Memories", value: "memories" },
      ],
    },
  ],
  async handler(ctx, options) {
    const input = options.entity as string;
    const editType = (options.type as string) ?? "facts";

    let entity: EntityWithFacts | null = null;
    const id = parseInt(input);
    if (!isNaN(id)) {
      entity = getEntityWithFacts(id);
    }
    if (!entity) {
      entity = getEntityWithFactsByName(input);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${input}`, true);
      return;
    }

    // Check edit permission
    if (!canUserEdit(entity, ctx.userId, ctx.username)) {
      await respond(ctx.bot, ctx.interaction, "You don't have permission to edit this entity", true);
      return;
    }

    // Get content based on type
    const currentContent = editType === "memories"
      ? getMemoriesForEntity(entity.id).map(m => m.content).join("\n")
      : entity.facts.map(f => f.content).join("\n");

    // Discord modal: max 5 text inputs, 4000 chars each = 20,000 total
    const MAX_FIELD_LENGTH = 4000;
    const MAX_FIELDS = 5;

    if (currentContent.length > MAX_FIELD_LENGTH * MAX_FIELDS) {
      await respond(ctx.bot, ctx.interaction,
        `Entity "${entity.name}" has too much content to edit via modal (${currentContent.length}/${MAX_FIELD_LENGTH * MAX_FIELDS} chars).`,
        true
      );
      return;
    }

    // Split content into chunks that fit in 4000 chars, breaking at newlines
    const chunks: string[] = [];
    let remaining = currentContent;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_FIELD_LENGTH) {
        chunks.push(remaining);
        break;
      }
      // Find last newline within limit
      let splitAt = remaining.lastIndexOf("\n", MAX_FIELD_LENGTH);
      if (splitAt === -1) splitAt = MAX_FIELD_LENGTH; // No newline, hard split
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt + 1); // Skip the newline
    }

    // Build modal fields - name first, then content
    const fields: Array<{
      customId: string;
      label: string;
      style: number;
      value?: string;
      required?: boolean;
      placeholder?: string;
    }> = [];

    // Name field for renaming (only for facts)
    if (editType === "facts") {
      fields.push({
        customId: "name",
        label: "Name",
        style: TextStyles.Short,
        value: entity.name,
        required: true,
      });
    }

    // Content fields
    const contentLabel = editType === "memories" ? "Memories" : "Facts";
    const contentFields = chunks.map((chunk, i) => ({
      customId: `${editType}${i}`,
      label: chunks.length === 1 ? `${contentLabel} (one per line)` : `${contentLabel} (part ${i + 1}/${chunks.length})`,
      style: TextStyles.Paragraph,
      value: chunk,
      required: false,
    }));

    // If no content, still show one field
    if (contentFields.length === 0) {
      contentFields.push({
        customId: `${editType}0`,
        label: `${contentLabel} (one per line)`,
        style: TextStyles.Paragraph,
        value: "",
        required: false,
      });
    }

    fields.push(...contentFields);

    const modalId = editType === "memories" ? `edit-memories:${entity.id}` : `edit:${entity.id}`;
    const modalTitle = editType === "memories" ? `Edit Memories: ${entity.name}` : `Edit: ${entity.name}`;
    await respondWithModal(ctx.bot, ctx.interaction, modalId, modalTitle, fields);
  },
});

registerModalHandler("edit", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);


  // Get new name from modal
  const newName = values.name?.trim();
  if (!newName) {
    await respond(bot, interaction, `Name cannot be empty (received keys: ${Object.keys(values).join(", ")})`, true);
    return;
  }

  // Combine all fact fields (facts0, facts1, etc.)
  const factParts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const part = values[`facts${i}`];
    if (part !== undefined) factParts.push(part);
  }
  const factsText = factParts.join("\n");

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission (defense in depth)
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  const facts = factsText.split("\n").map(f => f.trim()).filter(f => f);

  // Prevent accidentally clearing all facts with empty submission
  if (facts.length === 0) {
    await respond(bot, interaction, "Cannot clear all facts. Use /delete to remove an entity.", true);
    return;
  }

  // Update name if changed
  const nameChanged = newName !== entity.name;
  if (nameChanged) {
    updateEntity(entityId, newName);
  }

  setFacts(entityId, facts);

  const message = nameChanged
    ? `Renamed "${entity.name}" to "${newName}" and updated with ${facts.length} facts`
    : `Updated "${entity.name}" with ${facts.length} facts`;
  await respond(bot, interaction, message, true);
});

registerModalHandler("edit-memories", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  // Combine all memory fields (memories0, memories1, etc.)
  const memoryParts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const part = values[`memories${i}`];
    if (part !== undefined) memoryParts.push(part);
  }
  const memoriesText = memoryParts.join("\n");

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission (defense in depth)
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  const memories = memoriesText.split("\n").map(m => m.trim()).filter(m => m);

  // Update memories (clear and replace)
  await setMemories(entityId, memories);

  await respond(bot, interaction, `Updated "${entity.name}" with ${memories.length} memories`, true);
});

// =============================================================================
// /delete - Delete entity
// =============================================================================

registerCommand({
  name: "delete",
  description: "Delete an entity (owner only)",
  options: [
    {
      name: "entity",
      description: "Entity name or ID",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
  ],
  async handler(ctx, options) {
    const input = options.entity as string;

    let entity = null;
    const id = parseInt(input);
    if (!isNaN(id)) {
      entity = getEntity(id);
    }
    if (!entity) {
      entity = getEntityByName(input);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${input}`, true);
      return;
    }

    // Check ownership
    if (entity.owned_by !== ctx.userId) {
      await respond(ctx.bot, ctx.interaction, "You can only delete entities you own", true);
      return;
    }

    deleteEntity(entity.id);
    await respond(ctx.bot, ctx.interaction, `Deleted "${entity.name}"`, true);
  },
});

// =============================================================================
// /transfer - Transfer entity ownership
// =============================================================================

registerCommand({
  name: "transfer",
  description: "Transfer entity ownership to another user",
  options: [
    {
      name: "entity",
      description: "Entity name or ID",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "user",
      description: "User to transfer ownership to",
      type: ApplicationCommandOptionTypes.User,
      required: true,
    },
  ],
  async handler(ctx, options) {
    const input = options.entity as string;
    const newOwnerId = options.user as string;

    let entity = null;
    const id = parseInt(input);
    if (!isNaN(id)) {
      entity = getEntity(id);
    }
    if (!entity) {
      entity = getEntityByName(input);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${input}`, true);
      return;
    }

    // Only current owner can transfer
    if (entity.owned_by !== ctx.userId) {
      await respond(ctx.bot, ctx.interaction, "You can only transfer entities you own", true);
      return;
    }

    // Prevent transferring to self
    if (newOwnerId === ctx.userId) {
      await respond(ctx.bot, ctx.interaction, "You already own this entity", true);
      return;
    }

    transferOwnership(entity.id, newOwnerId);
    await respond(ctx.bot, ctx.interaction, `Transferred "${entity.name}" to <@${newOwnerId}>`, true);
  },
});

// =============================================================================
// /bind - Bind Discord thing to entity
// =============================================================================

registerCommand({
  name: "bind",
  description: "Bind a Discord channel, server, or user to an entity",
  options: [
    {
      name: "target",
      description: "What to bind (channel, server, or 'me')",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      choices: [
        { name: "This channel", value: "channel" },
        { name: "This server", value: "server" },
        { name: "Me (user)", value: "me" },
      ],
    },
    {
      name: "entity",
      description: "Entity name or ID to bind to",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "scope",
      description: "Scope of binding",
      type: ApplicationCommandOptionTypes.String,
      required: false,
      choices: [
        { name: "This channel only", value: "channel" },
        { name: "This server", value: "guild" },
        { name: "Global (everywhere)", value: "global" },
      ],
    },
  ],
  async handler(ctx, options) {
    const target = options.target as string;
    const entityInput = options.entity as string;
    const scope = (options.scope as string) ?? "channel";

    // Find entity
    let entity = null;
    const id = parseInt(entityInput);
    if (!isNaN(id)) {
      entity = getEntity(id);
    }
    if (!entity) {
      entity = getEntityByName(entityInput);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${entityInput}`, true);
      return;
    }

    // Determine what to bind
    let discordId: string;
    let discordType: "user" | "channel" | "guild";
    if (target === "channel") {
      discordId = ctx.channelId;
      discordType = "channel";
    } else if (target === "server") {
      if (!ctx.guildId) {
        await respond(ctx.bot, ctx.interaction, "Cannot bind to server in DMs", true);
        return;
      }
      discordId = ctx.guildId;
      discordType = "guild";
    } else {
      discordId = ctx.userId;
      discordType = "user";
    }

    // Determine scope
    let scopeGuildId: string | undefined;
    let scopeChannelId: string | undefined;
    if (scope === "channel") {
      scopeChannelId = ctx.channelId;
    } else if (scope === "guild") {
      scopeGuildId = ctx.guildId;
    }
    // global = no scope

    const result = addDiscordEntity(discordId, discordType, entity.id, scopeGuildId, scopeChannelId);

    const scopeDesc = scope === "global" ? "globally" : scope === "guild" ? "in this server" : "in this channel";
    const targetDesc = target === "channel" ? "This channel" : target === "server" ? "This server" : "You";

    if (!result) {
      await respond(ctx.bot, ctx.interaction, `"${entity.name}" is already bound ${scopeDesc}`, true);
      return;
    }

    await respond(ctx.bot, ctx.interaction, `${targetDesc} bound to "${entity.name}" ${scopeDesc}`, true);
  },
});

// =============================================================================
// /unbind - Remove entity binding
// =============================================================================

registerCommand({
  name: "unbind",
  description: "Remove an entity binding from a channel, server, or user",
  options: [
    {
      name: "target",
      description: "What to unbind from",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      choices: [
        { name: "This channel", value: "channel" },
        { name: "This server", value: "server" },
        { name: "Me (user)", value: "me" },
      ],
    },
    {
      name: "entity",
      description: "Entity name or ID to unbind",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "scope",
      description: "Scope of binding to remove",
      type: ApplicationCommandOptionTypes.String,
      required: false,
      choices: [
        { name: "This channel only", value: "channel" },
        { name: "This server", value: "guild" },
        { name: "Global (everywhere)", value: "global" },
      ],
    },
  ],
  async handler(ctx, options) {
    const target = options.target as string;
    const entityInput = options.entity as string;
    const scope = (options.scope as string) ?? "channel";

    // Find entity
    let entity = null;
    const id = parseInt(entityInput);
    if (!isNaN(id)) {
      entity = getEntity(id);
    }
    if (!entity) {
      entity = getEntityByName(entityInput);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${entityInput}`, true);
      return;
    }

    // Determine what to unbind
    let discordId: string;
    let discordType: "user" | "channel" | "guild";
    if (target === "channel") {
      discordId = ctx.channelId;
      discordType = "channel";
    } else if (target === "server") {
      if (!ctx.guildId) {
        await respond(ctx.bot, ctx.interaction, "Cannot unbind from server in DMs", true);
        return;
      }
      discordId = ctx.guildId;
      discordType = "guild";
    } else {
      discordId = ctx.userId;
      discordType = "user";
    }

    // Determine scope
    let scopeGuildId: string | undefined;
    let scopeChannelId: string | undefined;
    if (scope === "channel") {
      scopeChannelId = ctx.channelId;
    } else if (scope === "guild") {
      scopeGuildId = ctx.guildId;
    }

    const removed = removeDiscordEntityBinding(discordId, discordType, entity.id, scopeGuildId, scopeChannelId);

    const scopeDesc = scope === "global" ? "globally" : scope === "guild" ? "from this server" : "from this channel";
    const targetDesc = target === "channel" ? "Channel" : target === "server" ? "Server" : "You";

    if (!removed) {
      await respond(ctx.bot, ctx.interaction, `"${entity.name}" was not bound ${scopeDesc}`, true);
      return;
    }

    await respond(ctx.bot, ctx.interaction, `${targetDesc} unbound from "${entity.name}" ${scopeDesc}`, true);
  },
});

// =============================================================================
// /info - View channel state and debug info
// =============================================================================

registerCommand({
  name: "info",
  description: "View channel state and debug info",
  options: [
    {
      name: "status",
      description: "View current channel state (default)",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "prompt",
      description: "Show system prompt that would be sent to the LLM",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "entity",
          description: "Entity to simulate (defaults to channel-bound entity)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          autocomplete: true,
        },
      ],
    },
    {
      name: "history",
      description: "Show message history that would be sent to the LLM",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "entity",
          description: "Entity to simulate (defaults to channel-bound entity)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          autocomplete: true,
        },
      ],
    },
  ],
  async handler(ctx, options) {
    // Get subcommand from nested options
    const subcommand = (options._subcommand as string) ?? "status";

    if (subcommand === "prompt") {
      await handleInfoPrompt(ctx, options);
    } else if (subcommand === "history") {
      await handleInfoHistory(ctx, options);
    } else {
      await handleInfoStatus(ctx);
    }
  },
});

async function handleInfoStatus(ctx: CommandContext) {
  const lines: string[] = [];

  // Check channel bindings (direct query, not precedence-based)
  const channelEntityIds = getChannelScopedEntities(ctx.channelId);
  if (channelEntityIds.length > 0) {
    const entityNames: string[] = [];
    for (const entityId of channelEntityIds) {
      const entity = getEntity(entityId);
      if (entity) entityNames.push(entity.name);
    }
    lines.push(`**Channel:** ${entityNames.join(", ")}`);

    // Show location for first entity that has one
    for (const entityId of channelEntityIds) {
      const entity = getEntityWithFacts(entityId);
      if (entity) {
        const locationFact = entity.facts.find(f => f.content.startsWith("is in "));
        if (locationFact) {
          lines.push(`**Location:** ${locationFact.content.replace("is in ", "")}`);
          break;
        }
      }
    }
  } else {
    lines.push("**Channel:** No bindings");
  }

  // Check server bindings (direct query)
  if (ctx.guildId) {
    const serverEntityIds = getGuildScopedEntities(ctx.guildId);
    if (serverEntityIds.length > 0) {
      const entityNames: string[] = [];
      for (const entityId of serverEntityIds) {
        const entity = getEntity(entityId);
        if (entity) entityNames.push(entity.name);
      }
      lines.push(`**Server:** ${entityNames.join(", ")}`);
    } else {
      lines.push("**Server:** No bindings");
    }
  }

  // Check user binding
  const userEntityId = resolveDiscordEntity(ctx.userId, "user", ctx.guildId, ctx.channelId);
  if (userEntityId) {
    const userEntity = getEntityWithFacts(userEntityId);
    if (userEntity) {
      lines.push(`**Your persona:** ${userEntity.name}`);
    }
  } else {
    lines.push(`**Your persona:** ${ctx.username} (default)`);
  }

  // Show hints
  const hints: string[] = [];
  const hasChannelBindings = channelEntityIds.length > 0;
  const hasServerBindings = ctx.guildId ? getGuildScopedEntities(ctx.guildId).length > 0 : false;
  const hasPersona = userEntityId !== null;

  if (!hasChannelBindings && !hasServerBindings) {
    hints.push("`/bind This channel <entity>` or `/bind This server <entity>` to add bindings");
  } else {
    hints.push("`/unbind` to remove bindings");
  }
  if (!hasPersona) {
    hints.push("`/bind Me (user) <entity>` to set a persona");
  }

  if (hints.length > 0) {
    lines.push("");
    lines.push(hints.join(", ") + ".");
  }

  await respond(ctx.bot, ctx.interaction, lines.join("\n"), true);
}

async function resolveTargetEntity(
  ctx: CommandContext,
  entityInput: string | undefined,
  commandHint: string
): Promise<EntityWithFacts | null> {
  if (entityInput) {
    // User specified an entity
    const id = parseInt(entityInput);
    let entity: EntityWithFacts | null = null;
    if (!isNaN(id)) {
      entity = getEntityWithFacts(id);
    }
    if (!entity) {
      entity = getEntityWithFactsByName(entityInput);
    }
    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${entityInput}`, true);
      return null;
    }
    return entity;
  }

  // Use first channel-bound entity
  const channelEntityIds = resolveDiscordEntities(ctx.channelId, "channel", ctx.guildId, ctx.channelId);
  if (channelEntityIds.length > 0) {
    const entity = getEntityWithFacts(channelEntityIds[0]);
    if (entity) return entity;
  }

  await respond(ctx.bot, ctx.interaction, `No entity bound to this channel. Specify an entity with \`/info ${commandHint} entity:<name>\``, true);
  return null;
}

async function handleInfoPrompt(ctx: CommandContext, options: Record<string, unknown>) {
  const entityInput = options.entity as string | undefined;
  const targetEntity = await resolveTargetEntity(ctx, entityInput, "prompt");
  if (!targetEntity) return;

  // Evaluate facts through expr.ts with a mock context (no triggers active)
  const contextParts: string[] = [formatEvaluatedEntityFromRaw(targetEntity)];

  // Add user entity if bound
  const userEntityId = resolveDiscordEntity(ctx.userId, "user", ctx.guildId, ctx.channelId);
  if (userEntityId) {
    const userEntity = getEntityWithFacts(userEntityId);
    if (userEntity) {
      contextParts.push(formatEvaluatedEntityFromRaw(userEntity));
    }
  }

  const systemPrompt = elideText(contextParts.join("\n\n"));
  const output = `**System prompt for ${targetEntity.name}:**\n\`\`\`\n${systemPrompt}\n\`\`\``;
  await respond(ctx.bot, ctx.interaction, output, true);
}

/** Evaluate an entity's facts with a mock context and format for display */
function formatEvaluatedEntityFromRaw(entity: EntityWithFacts): string {
  const rawFacts = entity.facts.map(f => f.content);
  const mockContext = createBaseContext({
    facts: rawFacts,
    has_fact: (pattern: string) => rawFacts.some(f => new RegExp(pattern, "i").test(f)),
    name: entity.name,
  });
  const evaluated = evaluateFacts(rawFacts, mockContext);
  return formatEvaluatedEntity({
    id: entity.id,
    name: entity.name,
    facts: evaluated.facts,
    avatarUrl: evaluated.avatarUrl,
    streamMode: evaluated.streamMode,
    streamDelimiter: evaluated.streamDelimiter,
    memoryScope: evaluated.memoryScope,
    contextLimit: evaluated.contextLimit,
    isFreeform: evaluated.isFreeform,
  });
}

async function handleInfoHistory(ctx: CommandContext, options: Record<string, unknown>) {
  const entityInput = options.entity as string | undefined;
  const targetEntity = await resolveTargetEntity(ctx, entityInput, "history");
  if (!targetEntity) return;

  const messages = getMessages(ctx.channelId, 100);
  const userMessage = elideText(buildMessageHistory(messages));
  const output = `**Message history for ${targetEntity.name}:**\n\`\`\`\n${userMessage}\n\`\`\``;
  await respond(ctx.bot, ctx.interaction, output, true);
}

// =============================================================================
// /forget - Clear message history from context
// =============================================================================

registerCommand({
  name: "forget",
  description: "Forget message history before now (excludes from LLM context)",
  options: [],
  async handler(ctx, _options) {
    setChannelForgetTime(ctx.channelId);
    await respond(ctx.bot, ctx.interaction, "Done. Messages before now will be excluded from context.", true);
  },
});

// =============================================================================
// Help Entities (seeded on first access via /view)
// =============================================================================

const HELP_ENTITY_FACTS: Record<string, string[]> = {
  help: [
    "is the help system",
    "topics: start, commands, expressions, patterns, facts, bindings, permissions, models",
    "use `/view help:<topic>` for details",
    "---",
    "**Hologram** - Collaborative worldbuilding and roleplay",
    "Everything is an **entity** with **facts**.",
    "---",
    "New here? Try `/view help:start`",
  ],
  "help:start": [
    "is the getting started guide",
    "---",
    "**Setting up a channel:**",
    "1. `/create Aria` - Create an entity",
    "2. `/edit Aria` - Add facts like personality, appearance",
    "3. `/bind channel Aria` - Bind Aria to this channel",
    "4. Chat! Aria responds when @mentioned",
    "---",
    "**Creating a persona:**",
    "1. `/create MyChar` - Create your entity",
    "2. `/edit MyChar` - Add your entity's facts",
    "3. `/bind me MyChar` - Bind yourself to this entity",
    "4. Your messages now come from MyChar's perspective",
    "---",
    "**Tips:**",
    "• Use `/info` to see current channel state",
    "• Use `/view <entity>` to view any entity",
    "• Control responses with `$if` (`/view help:expressions`)",
  ],
  "help:commands": [
    "is help for commands",
    "---",
    "**Commands** (9 total)",
    "`/create` - Create entity",
    "`/view` - View entity facts",
    "`/edit` - Edit entity facts",
    "`/delete` - Delete entity",
    "`/transfer` - Transfer entity ownership",
    "`/bind` - Bind channel/user to entity",
    "`/unbind` - Remove entity binding",
    "`/info` - Channel state and debug",
    "`/forget` - Forget history before now",
    "---",
    "**Info subcommands:**",
    "`/info status` - Channel state (default)",
    "`/info prompt [entity]` - Show system prompt",
    "`/info history [entity]` - Show message history",
    "---",
    "**Examples:**",
    "`/create Aria` - Create entity",
    "`/view Aria` - View facts",
    "`/bind channel Aria` - Bind to channel",
  ],
  "help:expressions": [
    "is help for $if expressions and response control",
    "---",
    "**Syntax:** `$if <expr>: <fact or directive>`",
    "Expressions are JavaScript. Strings need quotes: `\"hello\"` not `hello`",
    "---",
    "**Directives:**",
    "• `$respond` - respond to this message",
    "• `$respond false` - suppress response",
    "• `$retry <ms>` - re-evaluate after delay",
    "---",
    "**Operators:**",
    "`&&` `||` `!` `==` `!=` `<` `>` `<=` `>=`",
    "`+` `-` `*` `/` `%` `? :`",
    "---",
    "**Context variables:**",
    "• `mentioned`, `replied`, `is_forward` - message flags",
    "• `is_self` - message from this entity's webhook",
    "• `content`, `author` - message data",
    "• `name` - this entity's name",
    "• `chars` - array of all bound character names",
    "• `dt_ms` - ms since last response",
    "• `elapsed_ms` - ms since trigger (for $retry)",
    "---",
    "**Time:** `time.hour`, `time.is_day`, `time.is_night`",
    "**Self:** `self.key` from `key: value` facts",
    "---",
    "**Functions:**",
    "• `random()` - float 0-1",
    "• `random(n)` - int 1-n",
    "• `has_fact(\"pattern\")` - regex match",
    "• `roll(\"2d6+3\")` - dice roll",
    "• `mentioned_in_dialogue(name)` - name in dialogue (not XML tags)",
    "• `messages(n, fmt)` - last n messages (fmt: %a=author, %m=message)",
    "---",
    "`content` and `author` are aliases for `messages(1, \"%m\")` and `messages(1, \"%a\")`",
    "---",
    "See `/view help:patterns` for common examples",
  ],
  "help:patterns": [
    "is help for common $if patterns",
    "---",
    "**Recommended defaults:**",
    '`$if chars.length === 1 && (mentioned || replied): $respond`',
    '`$if content.toLowerCase().match("\\\\b" + name + "\\\\b"): $respond`',
    "---",
    "**Response triggers:**",
    "`$respond` - always respond",
    "`$respond false` - never respond",
    "`$if mentioned: $respond` - only @mentions",
    "`$if mentioned || replied: $respond` - mentions or replies",
    "---",
    "**Rate limiting:**",
    "`$if dt_ms > 30000: $respond` - 30s cooldown",
    "`$if dt_ms > 60000 || mentioned: $respond` - 1min unless mentioned",
    "---",
    "**Randomness:**",
    "`$if random() < 0.1: $respond` - 10% chance",
    "`$if random() < 0.3 && !mentioned: $respond` - 30% lurk",
    "---",
    "**Time-based:**",
    "`$if time.is_night: becomes more mysterious`",
    "`$if time.hour >= 22 || time.hour < 6: $respond false`",
    "---",
    "**Multi-character:**",
    "`$if chars.length === 1: $respond` - only if alone",
    "`$if chars.length > 1 && mentioned: $respond` - need mention in group",
    "---",
    "**Name in dialogue:**",
    '`$if mentioned_in_dialogue(name) && !is_self: $respond`',
    "Responds when name appears in chat (not from self)",
    "---",
    "**Delayed response:**",
    "`$retry 5000` - wait 5s then re-evaluate",
    "`$if elapsed_ms > 10000: $respond` - after 10s delay",
  ],
  "help:facts": [
    "is help for facts",
    "---",
    "**Facts** - Define entities",
    "Facts are freeform text.",
    "---",
    "**Two styles:**",
    "• Discrete facts (easy to update individually)",
    "• Single prose description (SillyTavern style)",
    "Both work fine!",
    "---",
    "**Macros:**",
    "• `{{entity:12}}` - entity reference (expands to name)",
    "• `{{char}}` - current entity's name",
    "• `{{user}}` - literal \"user\"",
    "• `$if condition: $respond` - response control",
    "---",
    "**Permissions:** See `/view help:permissions`",
  ],
  "help:bindings": [
    "is help for bindings",
    "---",
    "**Bindings** - Connect Discord to entities",
    "---",
    "`/bind channel <entity>` - Add entity to channel",
    "`/unbind channel <entity>` - Remove entity",
    "`/bind me <entity>` - Speak as entity",
    "---",
    "**Multiple entities:** Bind several entities to one channel. Each evaluates `$respond` independently.",
    "---",
    "**Scopes:** channel (default), guild, global",
  ],
  "help:permissions": [
    "is help for entity permissions",
    "---",
    "**Ownership** - Each entity has an owner",
    "• Creator owns by default",
    "• Owner always has full access",
    "• `/transfer <entity> <user>` - Transfer ownership",
    "---",
    "**Blacklist** - Block specific users",
    "• `$blacklist username` - Block by username",
    "• `$blacklist 123456789012345678` - Block by Discord ID",
    "• `$blacklist user1, 123456789, user2` - Mixed",
    "• Blocked users cannot view, edit, or receive responses",
    "• Owner is never blocked",
    "---",
    "**LLM Lock** - Prevent AI modifications",
    "• `$locked` - Lock entire entity",
    "• `$locked has silver hair` - Lock specific fact",
    "AI can still see locked facts, but cannot modify them.",
    "---",
    "**User Access** - Control who can edit/view",
    "• `$edit @everyone` - Anyone can edit",
    "• `$edit alice, bob` - Usernames (case-insensitive)",
    "• `$edit 123456789012345678` - Discord IDs",
    "• `$view @everyone` - Anyone can view",
    "• `$view alice, 123456789` - Mixed usernames and IDs",
    "---",
    "**Defaults:**",
    "• Blacklist: empty (nobody blocked)",
    "• Edit: owner only",
    "• View: everyone (public)",
    "• LLM: not locked",
  ],
  "help:models": [
    "is help for models",
    "---",
    "**Models** - `provider:model` format",
    "---",
    "• `google:gemini-3-flash-preview`",
    "• `google:gemini-2.5-flash-lite-preview-06-2025`",
    "• `anthropic:claude-sonnet-4-20250514`",
    "• `openai:gpt-4o`",
  ],
};

export function ensureHelpEntities(): void {
  for (const [name, facts] of Object.entries(HELP_ENTITY_FACTS)) {
    ensureSystemEntity(name, facts);
  }
}
