import { ApplicationCommandOptionTypes, TextStyles } from "@discordeno/bot";
import {
  registerCommand,
  registerModalHandler,
  respond,
  respondWithModal,
} from "./index";
import {
  createEntity,
  getEntity,
  getEntityByName,
  getEntityWithFacts,
  getEntityWithFactsByName,
  deleteEntity,
  transferOwnership,
  addFact,
  setFacts,
  ensureSystemEntity,
  type EntityWithFacts,
} from "../../db/entities";
import {
  addDiscordEntity,
  resolveDiscordEntity,
  resolveDiscordEntities,
  removeDiscordEntityBinding,
  getMessages,
} from "../../db/discord";
import { parsePermissionDirectives } from "../../logic/expr";

// =============================================================================
// Type aliases for create command
// =============================================================================

const TYPE_ALIASES: Record<string, string> = {
  c: "character",
  char: "character",
  character: "character",
  l: "location",
  loc: "location",
  location: "location",
  i: "item",
  item: "item",
};

// =============================================================================
// Permission Helpers
// =============================================================================

/**
 * Check if a user can edit an entity.
 * Owner always can. Otherwise check $edit directive.
 * Default (no $edit directive) = owner-only.
 */
function canUserEdit(entity: EntityWithFacts, userId: string): boolean {
  // Owner always can
  if (entity.owned_by === userId) return true;

  // Parse permission directives from raw facts
  const facts = entity.facts.map(f => f.content);
  const permissions = parsePermissionDirectives(facts);

  // Check $edit directive
  if (permissions.editList === "everyone") return true;
  if (permissions.editList && permissions.editList.includes(userId)) return true;

  // No $edit directive = owner only
  return false;
}

/**
 * Check if a user can view an entity.
 * Owner always can. Otherwise check $view directive.
 * Default (no $view directive) = everyone can view (public by default).
 */
function canUserView(entity: EntityWithFacts, userId: string): boolean {
  // Owner always can
  if (entity.owned_by === userId) return true;

  // Parse permission directives from raw facts
  const facts = entity.facts.map(f => f.content);
  const permissions = parsePermissionDirectives(facts);

  // If no $view directive, default to public (everyone can view)
  if (permissions.viewList === null) return true;

  // Check $view directive
  if (permissions.viewList === "everyone") return true;
  if (permissions.viewList.includes(userId)) return true;

  return false;
}

// =============================================================================
// /create (/c) - Create entity
// =============================================================================

registerCommand({
  name: "create",
  description: "Create a new entity",
  options: [
    {
      name: "type",
      description: "Entity type (character, location, item) or template name",
      type: ApplicationCommandOptionTypes.String,
      required: true,
    },
    {
      name: "name",
      description: "Name of the entity",
      type: ApplicationCommandOptionTypes.String,
      required: false,
    },
  ],
  async handler(ctx, options) {
    const typeInput = (options.type as string).toLowerCase();
    const type = TYPE_ALIASES[typeInput] ?? typeInput;
    const name = options.name as string | undefined;

    if (name) {
      // Quick create with name
      const entity = createEntity(name, ctx.userId);
      // Add type as a fact
      addFact(entity.id, `is a ${type}`);
      await respond(ctx.bot, ctx.interaction, `Created ${type} "${name}" (id: ${entity.id})`, true);
    } else {
      // Open modal for details
      await respondWithModal(ctx.bot, ctx.interaction, `create:${type}`, `Create ${type}`, [
        {
          customId: "name",
          label: "Name",
          style: TextStyles.Short,
          required: true,
          placeholder: `Enter ${type} name`,
        },
        {
          customId: "facts",
          label: "Facts (one per line)",
          style: TextStyles.Paragraph,
          required: false,
          placeholder: `Enter facts about this ${type}, one per line`,
        },
      ]);
    }
  },
});

registerModalHandler("create", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const type = customId.split(":")[1] ?? "entity";
  const name = values.name;
  const factsText = values.facts ?? "";

  const userId = interaction.user?.id?.toString() ?? "";
  const entity = createEntity(name, userId);

  // Add type fact
  addFact(entity.id, `is a ${type}`);

  // Add user-provided facts
  const facts = factsText.split("\n").map(f => f.trim()).filter(f => f);
  for (const fact of facts) {
    addFact(entity.id, fact);
  }

  await respond(bot, interaction, `Created ${type} "${name}" (id: ${entity.id}) with ${facts.length + 1} facts`, true);
});

// =============================================================================
// /view (/v) - View entity
// =============================================================================

registerCommand({
  name: "view",
  description: "View an entity and its facts",
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
    if (!canUserView(entity, ctx.userId)) {
      await respond(ctx.bot, ctx.interaction, "You don't have permission to view this entity", true);
      return;
    }

    const factsDisplay = entity.facts.length > 0
      ? entity.facts.map(f => `• ${f.content}`).join("\n")
      : "(no facts)";

    await respond(ctx.bot, ctx.interaction,
      `**${entity.name}** (id: ${entity.id})\n\n${factsDisplay}`,
      true
    );
  },
});

// =============================================================================
// /edit (/e) - Edit entity facts
// =============================================================================

registerCommand({
  name: "edit",
  description: "Edit an entity's facts",
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
    if (!canUserEdit(entity, ctx.userId)) {
      await respond(ctx.bot, ctx.interaction, "You don't have permission to edit this entity", true);
      return;
    }

    const currentFacts = entity.facts.map(f => f.content).join("\n");

    await respondWithModal(ctx.bot, ctx.interaction, `edit:${entity.id}`, `Edit: ${entity.name}`, [
      {
        customId: "facts",
        label: "Facts (one per line)",
        style: TextStyles.Paragraph,
        value: currentFacts,
        required: false,
      },
    ]);
  },
});

registerModalHandler("edit", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);
  const factsText = values.facts ?? "";

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission (defense in depth)
  const userId = interaction.user?.id?.toString() ?? "";
  if (!canUserEdit(entity, userId)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  const facts = factsText.split("\n").map(f => f.trim()).filter(f => f);
  setFacts(entityId, facts);

  await respond(bot, interaction, `Updated "${entity.name}" with ${facts.length} facts`, true);
});

// =============================================================================
// /delete (/d) - Delete entity
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
// /bind (/b) - Bind Discord thing to entity
// =============================================================================

registerCommand({
  name: "bind",
  description: "Bind a Discord channel or user to an entity",
  options: [
    {
      name: "target",
      description: "What to bind (channel, user, or 'me')",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      choices: [
        { name: "This channel", value: "channel" },
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
    let discordType: "user" | "channel";
    if (target === "channel") {
      discordId = ctx.channelId;
      discordType = "channel";
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
    const targetDesc = target === "channel" ? "This channel" : "You";

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
  description: "Remove an entity binding from a channel or user",
  options: [
    {
      name: "target",
      description: "What to unbind from",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      choices: [
        { name: "This channel", value: "channel" },
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
    let discordType: "user" | "channel";
    if (target === "channel") {
      discordId = ctx.channelId;
      discordType = "channel";
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
    const targetDesc = target === "channel" ? "Channel" : "You";

    if (!removed) {
      await respond(ctx.bot, ctx.interaction, `"${entity.name}" was not bound ${scopeDesc}`, true);
      return;
    }

    await respond(ctx.bot, ctx.interaction, `${targetDesc} unbound from "${entity.name}" ${scopeDesc}`, true);
  },
});

// =============================================================================
// /status (/s) - View channel state
// =============================================================================

registerCommand({
  name: "status",
  description: "View current channel state",
  options: [],
  async handler(ctx, _options) {
    const lines: string[] = [];

    // Check channel bindings (now supports multiple)
    const channelEntityIds = resolveDiscordEntities(ctx.channelId, "channel", ctx.guildId, ctx.channelId);
    if (channelEntityIds.length > 0) {
      const entityNames: string[] = [];
      for (const entityId of channelEntityIds) {
        const entity = getEntity(entityId);
        if (entity) entityNames.push(entity.name);
      }
      lines.push(`**Channel bound to:** ${entityNames.join(", ")}`);

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
      lines.push("**Channel:** Not bound to any entity");
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

    // Message count
    const messages = getMessages(ctx.channelId, 10);
    lines.push(`**Recent messages:** ${messages.length}`);

    await respond(ctx.bot, ctx.interaction, lines.join("\n"), true);
  },
});

// =============================================================================
// Help Entities (seeded on first access via /view)
// =============================================================================

const HELP_ENTITY_FACTS: Record<string, string[]> = {
  help: [
    "is the help system",
    "topics: start, commands, expressions, patterns, facts, bindings, models",
    "use `/v help:<topic>` for details",
    "---",
    "**Hologram** - Collaborative worldbuilding and roleplay",
    "Everything is an **entity** with **facts**.",
    "---",
    "New here? Try `/v help:start`",
  ],
  "help:start": [
    "is the getting started guide",
    "---",
    "**Setting up a channel:**",
    "1. `/c character Aria` - Create a character",
    "2. `/e Aria` - Add facts like personality, appearance",
    "3. `/b channel Aria` - Bind Aria to this channel",
    "4. Chat! Aria responds when @mentioned",
    "---",
    "**Creating a persona (speak as a character):**",
    "1. `/c character MyChar` - Create your character",
    "2. `/e MyChar` - Add your character's facts",
    "3. `/b me MyChar` - Bind yourself to this character",
    "4. Your messages now come from MyChar's perspective",
    "---",
    "**Tips:**",
    "• Use `/s` to see current channel state",
    "• Use `/v <entity>` to view any entity",
    "• Control responses with `$if` (`/v help:expressions`)",
  ],
  "help:commands": [
    "is help for commands",
    "---",
    "**Commands** (7 total)",
    "`/create` (`/c`) - Create entity",
    "`/view` (`/v`) - View entity facts",
    "`/edit` (`/e`) - Edit entity facts",
    "`/delete` (`/d`) - Delete entity",
    "`/bind` (`/b`) - Bind channel/user to entity",
    "`/unbind` - Remove entity binding",
    "`/status` (`/s`) - Channel state",
    "---",
    "**Type shortcuts:** `c`/`char`, `l`/`loc`, `i`",
    "---",
    "**Examples:**",
    "`/c c Aria` - Create character",
    "`/v Aria` - View facts",
    "`/b channel Aria` - Bind to channel",
  ],
  "help:expressions": [
    "is help for $if expressions and response control",
    "---",
    "**Syntax:** `$if <expr>: <fact or directive>`",
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
    "---",
    "See `/v help:patterns` for common examples",
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
    "**Special patterns:**",
    "• `is a character/location/item`",
    "• `is in [entity:12]`",
    "• `$if condition: $respond`",
  ],
  "help:bindings": [
    "is help for bindings",
    "---",
    "**Bindings** - Connect Discord to entities",
    "---",
    "`/b channel <entity>` - Add entity to channel",
    "`/unbind channel <entity>` - Remove entity",
    "`/b me <entity>` - Speak as entity",
    "---",
    "**Multiple characters:** Bind several entities to one channel. Each evaluates `$respond` independently.",
    "---",
    "**Scopes:** channel (default), guild, global",
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
