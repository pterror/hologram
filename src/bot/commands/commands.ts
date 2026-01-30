import { ApplicationCommandOptionTypes, TextStyles, MessageComponentTypes } from "@discordeno/bot";
import {
  registerCommand,
  registerModalHandler,
  respond,
  respondWithModal,
  respondWithV2Modal,
  type CommandContext,
} from "./index";
import {
  createEntity,
  getEntity,
  getEntityByName,
  getEntityWithFacts,
  getEntityWithFactsByName,
  getEntityTemplate,
  setEntityTemplate,
  updateEntity,
  deleteEntity,
  transferOwnership,
  addFact,
  setFacts,
  type EntityWithFacts,
  getPermissionDefaults,
  getEntityEvalDefaults,
  getEntityConfig,
  setEntityConfig,
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
import { parsePermissionDirectives, matchesUserEntry, isUserBlacklisted, isUserAllowed, evaluateFacts, createBaseContext } from "../../logic/expr";
import { formatEntityDisplay } from "../../ai/context";
import type { EvaluatedEntity } from "../../ai/context";
import { preparePromptContext } from "../../ai/prompt";
import { sendResponse } from "../client";
import { debug } from "../../logger";
import { formatMessagesForContext, getFilteredMessages } from "../../db/discord";

// =============================================================================
// Text Helpers
// =============================================================================

/**
 * Split text into chunks fitting maxLen, breaking at newlines when possible.
 */
function chunkContent(content: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt === -1) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt + 1);
  }
  return chunks;
}

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
function canUserEdit(entity: EntityWithFacts, userId: string, username: string, userRoles: string[] = []): boolean {
  // Owner always can
  if (entity.owned_by === userId) return true;

  // Parse permission directives from config columns + raw facts
  const facts = entity.facts.map(f => f.content);
  const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));

  // Check blacklist first (deny overrides allow)
  if (isUserBlacklisted(permissions, userId, username, entity.owned_by, userRoles)) return false;

  // Check $edit directive (supports both usernames, Discord IDs, and role IDs)
  if (permissions.editList === "@everyone") return true;
  if (permissions.editList && permissions.editList.some(u => matchesUserEntry(u, userId, username, userRoles))) return true;

  // No $edit directive = owner only
  return false;
}

/**
 * Check if a user can view an entity.
 * Owner always can. Blacklist blocks everyone except owner.
 * Otherwise check $view directive. Default = owner-only.
 */
function canUserView(entity: EntityWithFacts, userId: string, username: string, userRoles: string[] = []): boolean {
  // Owner always can
  if (entity.owned_by === userId) return true;

  // Parse permission directives from config columns + raw facts
  const facts = entity.facts.map(f => f.content);
  const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));

  // Check blacklist first (deny overrides allow)
  if (isUserBlacklisted(permissions, userId, username, entity.owned_by, userRoles)) return false;

  // If no $view directive, default to owner-only
  if (permissions.viewList === null) return false;

  // Check $view directive (supports both usernames, Discord IDs, and role IDs)
  if (permissions.viewList === "@everyone") return true;
  if (permissions.viewList.some(u => matchesUserEntry(u, userId, username, userRoles))) return true;

  return false;
}

// =============================================================================
// Permissions UI Helpers (V2 Modal with Mentionable Selects)
// =============================================================================

const PERM_FIELDS = ["view", "edit", "use", "blacklist"] as const;
type PermField = (typeof PERM_FIELDS)[number];

const PERM_LABELS: Record<PermField, string> = {
  view: "View",
  edit: "Edit",
  use: "Trigger",
  blacklist: "Blacklist",
};

const PERM_DESCRIPTIONS: Record<PermField, string> = {
  view: "Blank means anyone can view",
  edit: "Blank means anyone can edit",
  use: "Blank means anyone can trigger",
  blacklist: "Blocked from viewing, editing, and triggering",
};

const PERM_CONFIG_KEYS: Record<PermField, string> = {
  view: "config_view",
  edit: "config_edit",
  use: "config_use",
  blacklist: "config_blacklist",
};

/**
 * Build default_values array for a mentionable select from DB value.
 * Skips username entries (can't pre-populate those in a select).
 */
function buildDefaultValues(value: string[] | "@everyone" | null): Array<{ id: string; type: "user" | "role" }> {
  if (!value || value === "@everyone" || !Array.isArray(value)) return [];
  const defaults: Array<{ id: string; type: "user" | "role" }> = [];
  for (const entry of value) {
    if (entry.startsWith("role:")) {
      defaults.push({ id: entry.slice(5), type: "role" });
    } else if (/^\d{17,19}$/.test(entry)) {
      defaults.push({ id: entry, type: "user" });
    }
    // Skip username strings — can't pre-populate in select
  }
  return defaults;
}

/**
 * Build Label components (type 18) wrapping MentionableSelects for a V2 modal.
 * For view/edit, null DB values default to showing the owner pre-selected.
 */
function buildPermissionsLabels(entityId: number, ownerId: string): unknown[] {
  const defaults = getPermissionDefaults(entityId);

  return PERM_FIELDS.map(field => {
    const value = field === "blacklist" ? defaults.blacklist : defaults[`${field}List`];

    // For view/edit, null means owner-only — pre-populate with owner
    let defaultValues: Array<{ id: string; type: "user" | "role" }>;
    if (value === null && (field === "view" || field === "edit")) {
      defaultValues = [{ id: ownerId, type: "user" }];
    } else {
      defaultValues = buildDefaultValues(value as string[] | "@everyone" | null);
    }

    const select: Record<string, unknown> = {
      type: MessageComponentTypes.MentionableSelect,
      customId: `perm_${field}`,
      required: false,
      minValues: 0,
      maxValues: 25,
    };
    if (defaultValues.length > 0) {
      select.defaultValues = defaultValues;
    }

    return {
      type: MessageComponentTypes.Label,
      label: PERM_LABELS[field],
      description: PERM_DESCRIPTIONS[field],
      component: select,
    };
  });
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
      // Set owner-only defaults for view and edit
      setEntityConfig(entity.id, {
        config_view: JSON.stringify([ctx.userId]),
        config_edit: JSON.stringify([ctx.userId]),
      });
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

  // Set owner-only defaults for view and edit
  setEntityConfig(entity.id, {
    config_view: JSON.stringify([userId]),
    config_edit: JSON.stringify([userId]),
  });

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
    if (!canUserView(entity, ctx.userId, ctx.username, ctx.userRoles)) {
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
  description: "Edit an entity's facts and memories",
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
      description: "What to edit (default: both)",
      type: ApplicationCommandOptionTypes.String,
      required: false,
      choices: [
        { name: "Both", value: "both" },
        { name: "Facts only", value: "facts" },
        { name: "Memories only", value: "memories" },
        { name: "Template", value: "template" },
        { name: "Config", value: "config" },
        { name: "Permissions", value: "permissions" },
      ],
    },
  ],
  async handler(ctx, options) {
    const input = options.entity as string;
    const editType = (options.type as string) ?? "both";

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
    if (!canUserEdit(entity, ctx.userId, ctx.username, ctx.userRoles)) {
      await respond(ctx.bot, ctx.interaction, "You don't have permission to edit this entity", true);
      return;
    }

    // Discord modal: max 5 text inputs, 4000 chars each
    const MAX_FIELD_LENGTH = 4000;
    const MAX_FIELDS = 5;

    const fields: Array<{
      customId: string;
      label: string;
      style: number;
      value?: string;
      required?: boolean;
      placeholder?: string;
    }> = [];

    if (editType === "template") {
      // Template editing - single text area, no name field
      const currentTemplate = getEntityTemplate(entity.id) ?? "";
      const MAX_FIELD_LENGTH = 4000;
      const MAX_FIELDS = 5;

      if (currentTemplate.length > MAX_FIELD_LENGTH * MAX_FIELDS) {
        await respond(ctx.bot, ctx.interaction,
          `Template is too long to edit via modal (${currentTemplate.length}/${MAX_FIELD_LENGTH * MAX_FIELDS} chars).`,
          true
        );
        return;
      }

      const chunks = currentTemplate ? chunkContent(currentTemplate, MAX_FIELD_LENGTH) : [];
      const templateFields = chunks.length > 0
        ? chunks.map((chunk, i) => ({
            customId: `template${i}`,
            label: chunks.length === 1 ? "Template" : `Template (part ${i + 1}/${chunks.length})`,
            style: TextStyles.Paragraph,
            value: chunk,
            required: false,
          }))
        : [{
            customId: "template0",
            label: "Template",
            style: TextStyles.Paragraph,
            value: "",
            required: false,
            placeholder: "Custom system prompt template (Nunjucks-like syntax)",
          }];

      await respondWithModal(ctx.bot, ctx.interaction, `edit-template:${entity.id}`, `Edit Template: ${entity.name}`, templateFields);
      return;
    }

    if (editType === "config") {
      // Config editing - 5 text fields for entity settings
      const config = getEntityConfig(entity.id);

      // Format stream config for display
      let streamDisplay = "";
      if (config?.config_stream_mode) {
        streamDisplay = config.config_stream_mode;
        if (config.config_stream_delimiters) {
          const delims = JSON.parse(config.config_stream_delimiters) as string[];
          streamDisplay += " " + delims.map(d => `"${d}"`).join(" ");
        }
      }

      const configFields = [
        {
          customId: "model",
          label: "Model",
          style: TextStyles.Short,
          value: config?.config_model ?? "",
          required: false,
          placeholder: "provider:model (e.g. google:gemini-3-flash-preview)",
        },
        {
          customId: "context",
          label: "Context",
          style: TextStyles.Short,
          value: config?.config_context ?? "",
          required: false,
          placeholder: "chars < 4000 || count < 20",
        },
        {
          customId: "stream",
          label: "Stream",
          style: TextStyles.Short,
          value: streamDisplay,
          required: false,
          placeholder: 'lines, full, full "\\n", "delimiter"',
        },
        {
          customId: "avatar",
          label: "Avatar URL",
          style: TextStyles.Short,
          value: config?.config_avatar ?? "",
          required: false,
          placeholder: "https://example.com/avatar.png",
        },
        {
          customId: "memory",
          label: "Memory scope",
          style: TextStyles.Short,
          value: config?.config_memory ?? "",
          required: false,
          placeholder: "none, channel, guild, global",
        },
      ];

      await respondWithModal(ctx.bot, ctx.interaction, `edit-config:${entity.id}`, `Config: ${entity.name}`, configFields);
      return;
    }

    if (editType === "permissions") {
      // Permissions editing — V2 modal with mentionable select menus
      const labels = buildPermissionsLabels(entity.id, entity.owned_by ?? "");
      await respondWithV2Modal(ctx.bot, ctx.interaction, `edit-permissions:${entity.id}`, `Permissions: ${entity.name}`, labels);
      return;
    }

    if (editType === "both") {
      const factsContent = entity.facts.map(f => f.content).join("\n");
      const memoriesContent = getMemoriesForEntity(entity.id).map(m => m.content).join("\n");

      const factsChunks = factsContent ? chunkContent(factsContent, MAX_FIELD_LENGTH) : [];
      const memoriesChunks = memoriesContent ? chunkContent(memoriesContent, MAX_FIELD_LENGTH) : [];

      // Ensure at least one field each
      if (factsChunks.length === 0) factsChunks.push("");
      if (memoriesChunks.length === 0) memoriesChunks.push("");

      const totalFields = 1 + factsChunks.length + memoriesChunks.length; // 1 for name
      if (totalFields > MAX_FIELDS) {
        await respond(ctx.bot, ctx.interaction,
          `Too much content for combined edit (${totalFields} fields needed, max ${MAX_FIELDS}). ` +
          `Use \`/edit type:facts\` or \`/edit type:memories\` to edit separately.`,
          true
        );
        return;
      }

      // Name field
      fields.push({
        customId: "name",
        label: "Name",
        style: TextStyles.Short,
        value: entity.name,
        required: true,
      });

      // Facts fields
      for (let i = 0; i < factsChunks.length; i++) {
        fields.push({
          customId: `facts${i}`,
          label: factsChunks.length === 1 ? "Facts (one per line)" : `Facts (part ${i + 1}/${factsChunks.length})`,
          style: TextStyles.Paragraph,
          value: factsChunks[i],
          required: false,
        });
      }

      // Memories fields
      for (let i = 0; i < memoriesChunks.length; i++) {
        fields.push({
          customId: `memories${i}`,
          label: memoriesChunks.length === 1 ? "Memories (one per line)" : `Memories (part ${i + 1}/${memoriesChunks.length})`,
          style: TextStyles.Paragraph,
          value: memoriesChunks[i],
          required: false,
          placeholder: memoriesChunks[i] === "" ? "LLM-curated memories (optional)" : undefined,
        });
      }

      await respondWithModal(ctx.bot, ctx.interaction, `edit-both:${entity.id}`, `Edit: ${entity.name}`, fields);
    } else {
      // Single-type edit (facts or memories)
      const currentContent = editType === "memories"
        ? getMemoriesForEntity(entity.id).map(m => m.content).join("\n")
        : entity.facts.map(f => f.content).join("\n");

      if (currentContent.length > MAX_FIELD_LENGTH * MAX_FIELDS) {
        await respond(ctx.bot, ctx.interaction,
          `Entity "${entity.name}" has too much content to edit via modal (${currentContent.length}/${MAX_FIELD_LENGTH * MAX_FIELDS} chars).`,
          true
        );
        return;
      }

      const chunks = currentContent ? chunkContent(currentContent, MAX_FIELD_LENGTH) : [];

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
    }
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

registerModalHandler("edit-template", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  // Combine all template fields (template0, template1, etc.)
  const templateParts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const part = values[`template${i}`];
    if (part !== undefined) templateParts.push(part);
  }
  const templateText = templateParts.join("\n").trim();

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

  // Empty/blank = clear template (revert to default)
  if (!templateText) {
    setEntityTemplate(entityId, null);
    await respond(bot, interaction, `Cleared template for "${entity.name}" (using default formatting)`, true);
    return;
  }

  // Save template
  setEntityTemplate(entityId, templateText);
  await respond(bot, interaction, `Updated template for "${entity.name}" (${templateText.length} chars)`, true);
});

registerModalHandler("edit-config", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  const model = values.model?.trim() || null;
  const context = values.context?.trim() || null;
  const avatar = values.avatar?.trim() || null;
  const memory = values.memory?.trim() || null;

  // Parse stream config: "lines", "full", 'full "\n"', '"delimiter"'
  const streamRaw = values.stream?.trim() || "";
  let streamMode: string | null = null;
  let streamDelimiters: string | null = null;

  if (streamRaw) {
    // Extract quoted delimiters
    const delimRegex = /"([^"]+)"/g;
    const delims: string[] = [];
    let match;
    while ((match = delimRegex.exec(streamRaw)) !== null) {
      // Process escape sequences
      delims.push(match[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\"));
    }

    // Extract mode (text before first quote, or the whole string if no quotes)
    const modeStr = streamRaw.replace(/"[^"]*"/g, "").trim().toLowerCase();

    if (modeStr === "full" || modeStr === "lines" || modeStr === "") {
      streamMode = modeStr || (delims.length > 0 ? "lines" : "lines");
      if (modeStr === "") streamMode = "lines";
    } else {
      streamMode = modeStr;
    }

    if (delims.length > 0) {
      streamDelimiters = JSON.stringify(delims);
    }
  }

  // Validate memory scope
  if (memory && !["none", "channel", "guild", "global"].includes(memory)) {
    await respond(bot, interaction, `Invalid memory scope: "${memory}". Use: none, channel, guild, global`, true);
    return;
  }

  setEntityConfig(entityId, {
    config_model: model,
    config_context: context,
    config_stream_mode: streamMode,
    config_stream_delimiters: streamDelimiters,
    config_avatar: avatar,
    config_memory: memory,
  });

  const changes: string[] = [];
  if (model) changes.push(`model: ${model}`);
  if (context) changes.push(`context: ${context}`);
  if (streamRaw) changes.push(`stream: ${streamRaw}`);
  if (avatar) changes.push("avatar: set");
  if (memory) changes.push(`memory: ${memory}`);
  if (changes.length === 0) changes.push("all cleared");

  await respond(bot, interaction, `Updated config for "${entity.name}": ${changes.join(", ")}`, true);
});

// =============================================================================
// Permissions Modal Handler (V2 Modal with Mentionable Selects)
// =============================================================================

registerModalHandler("edit-permissions", async (bot, interaction, _values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  // Parse V2 components: Labels (type 18) wrap selects with .component (singular)
  // Also handle ActionRow fallback (.components plural) for forward compatibility
  const resolved = interaction.data?.resolved;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: any[] = interaction.data?.components ?? [];

  const selectValues: Record<string, string[]> = {};
  for (const comp of components) {
    // Label (type 18): has `component` (singular) with the nested select
    const inner = comp.component;
    if (inner?.customId) {
      selectValues[inner.customId] = inner.values ?? [];
    }
    // ActionRow fallback: has `components` (plural)
    for (const child of comp.components ?? []) {
      if (child.customId && child.values) {
        selectValues[child.customId] = child.values;
      }
    }
  }

  // Build entries with role: prefix using resolved data
  const buildEntries = (values: string[]): string[] => {
    return values.map(id => {
      const isRole = resolved?.roles?.has?.(BigInt(id)) ?? false;
      return isRole ? `role:${id}` : id;
    });
  };

  // Save all fields
  for (const field of PERM_FIELDS) {
    const values = selectValues[`perm_${field}`] ?? [];
    const entries = buildEntries(values);
    const configKey = PERM_CONFIG_KEYS[field];

    if (field === "blacklist") {
      setEntityConfig(entityId, {
        [configKey]: entries.length > 0 ? JSON.stringify(entries) : null,
      });
    } else {
      setEntityConfig(entityId, {
        [configKey]: entries.length > 0 ? JSON.stringify(entries) : JSON.stringify("@everyone"),
      });
    }
  }

  await respond(bot, interaction, `Updated permissions for "${entity.name}"`, true);
});

registerModalHandler("edit-both", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  const newName = values.name?.trim();
  if (!newName) {
    await respond(bot, interaction, `Name cannot be empty (received keys: ${Object.keys(values).join(", ")})`, true);
    return;
  }

  // Combine fact fields (facts0, facts1, etc.)
  const factParts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const part = values[`facts${i}`];
    if (part !== undefined) factParts.push(part);
  }
  const factsText = factParts.join("\n");

  // Combine memory fields (memories0, memories1, etc.)
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

  const facts = factsText.split("\n").map(f => f.trim()).filter(f => f);
  const memories = memoriesText.split("\n").map(m => m.trim()).filter(m => m);

  // Prevent accidentally clearing all facts
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
  await setMemories(entityId, memories);

  const namePart = nameChanged ? `Renamed "${entity.name}" to "${newName}", updated` : `Updated "${entity.name}"`;
  await respond(bot, interaction, `${namePart} with ${facts.length} facts and ${memories.length} memories`, true);
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
// /debug - View channel state and debug info
// =============================================================================

registerCommand({
  name: "debug",
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

  await respond(ctx.bot, ctx.interaction, `No entity bound to this channel. Specify an entity with \`/debug ${commandHint} entity:<name>\``, true);
  return null;
}

async function handleInfoPrompt(ctx: CommandContext, options: Record<string, unknown>) {
  const entityInput = options.entity as string | undefined;
  const targetEntity = await resolveTargetEntity(ctx, entityInput, "prompt");
  if (!targetEntity) return;

  // Evaluate facts with a mock context (no triggers active)
  const evaluated = buildEvaluatedEntity(targetEntity);

  // Use the actual template pipeline to build messages
  const { systemPrompt } = preparePromptContext(
    [evaluated], ctx.channelId, ctx.guildId, ctx.userId,
  );

  await respond(ctx.bot, ctx.interaction, elideText(systemPrompt || "(no system prompt)"), true);
}

/** Build an EvaluatedEntity from a raw entity using a mock expression context */
function buildEvaluatedEntity(entity: EntityWithFacts): EvaluatedEntity {
  const rawFacts = entity.facts.map(f => f.content);
  const mockContext = createBaseContext({
    facts: rawFacts,
    has_fact: (pattern: string) => rawFacts.some(f => new RegExp(pattern, "i").test(f)),
    name: entity.name,
  });
  const result = evaluateFacts(rawFacts, mockContext);
  return {
    id: entity.id,
    name: entity.name,
    facts: result.facts,
    avatarUrl: result.avatarUrl,
    streamMode: result.streamMode,
    streamDelimiter: result.streamDelimiter,
    memoryScope: result.memoryScope,
    contextExpr: result.contextExpr,
    isFreeform: result.isFreeform,
    modelSpec: result.modelSpec,
    stripPatterns: result.stripPatterns,
    template: entity.template,
    exprContext: mockContext,
  };
}

async function handleInfoHistory(ctx: CommandContext, options: Record<string, unknown>) {
  const entityInput = options.entity as string | undefined;
  const targetEntity = await resolveTargetEntity(ctx, entityInput, "history");
  if (!targetEntity) return;

  // Evaluate facts with a mock context (no triggers active)
  const evaluated = buildEvaluatedEntity(targetEntity);

  // Use the actual template pipeline to build structured messages
  const { messages } = preparePromptContext(
    [evaluated], ctx.channelId, ctx.guildId, ctx.userId,
  );

  // Show all messages (system, user, assistant) — the full conversation the LLM sees
  const formatted = messages.map(m => `[${m.role}] ${m.content}`).join("\n\n");
  await respond(ctx.bot, ctx.interaction, elideText(formatted || "(no messages)"), true);
}

// =============================================================================
// /trigger - Manually trigger an entity response
// =============================================================================

registerCommand({
  name: "trigger",
  description: "Manually trigger an entity to respond in this channel",
  options: [
    {
      name: "entity",
      description: "Entity name",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
  ],
  async handler(ctx, options) {
    const input = options.entity as string;

    // Resolve entity
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

    // Check permissions
    const facts = entity.facts.map(f => f.content);
    const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));

    if (isUserBlacklisted(permissions, ctx.userId, ctx.username, entity.owned_by, ctx.userRoles)) {
      await respond(ctx.bot, ctx.interaction, "You don't have permission to trigger this entity", true);
      return;
    }

    if (!isUserAllowed(permissions, ctx.userId, ctx.username, entity.owned_by, ctx.userRoles)) {
      await respond(ctx.bot, ctx.interaction, "You don't have permission to trigger this entity", true);
      return;
    }

    // Get last message from channel for context
    const lastMessages = getMessages(ctx.channelId, 1);
    const lastAuthor = lastMessages.length > 0 ? lastMessages[0].author_name : ctx.username;
    const lastContent = lastMessages.length > 0 ? lastMessages[0].content : "";

    // Evaluate facts (ignore shouldRespond - we always trigger)
    const ctx2 = createBaseContext({
      facts,
      has_fact: (pattern: string) => {
        const regex = new RegExp(pattern, "i");
        return facts.some(f => regex.test(f));
      },
      messages: (n = 1, format?: string, filter?: string) =>
        filter
          ? formatMessagesForContext(getFilteredMessages(ctx.channelId, n, filter), format)
          : formatMessagesForContext(getMessages(ctx.channelId, n), format),
      mentioned: true, // Treat as mentioned for fact evaluation
      name: entity.name,
      chars: [entity.name],
    });

    let result;
    try {
      result = evaluateFacts(facts, ctx2, getEntityEvalDefaults(entity.id));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await respond(ctx.bot, ctx.interaction, `Fact evaluation error: ${errorMsg}`, true);
      return;
    }

    // Respond ephemeral then trigger
    await respond(ctx.bot, ctx.interaction, `Triggering **${entity.name}**...`, true);

    debug("Manual trigger", { entity: entity.name, user: ctx.username });

    await sendResponse(ctx.channelId, ctx.guildId, lastAuthor, lastContent, true, [{
      id: entity.id,
      name: entity.name,
      facts: result.facts,
      avatarUrl: result.avatarUrl,
      streamMode: result.streamMode,
      streamDelimiter: result.streamDelimiter,
      memoryScope: result.memoryScope,
      contextExpr: result.contextExpr,
      isFreeform: result.isFreeform,
      modelSpec: result.modelSpec,
      stripPatterns: result.stripPatterns,
      template: entity.template,
      exprContext: ctx2,
    }]);
  },
});

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

