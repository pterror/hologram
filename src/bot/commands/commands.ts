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
  addFact,
  setFacts,
  ensureSystemEntity,
  type EntityWithFacts,
} from "../../db/entities";
import {
  setDiscordEntity,
  resolveDiscordEntity,
  getMessages,
} from "../../db/discord";

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
      await respond(ctx.bot, ctx.interaction, `Created ${type} "${name}" (id: ${entity.id})`);
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

  await respond(bot, interaction, `Created ${type} "${name}" (id: ${entity.id}) with ${facts.length + 1} facts`);
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

    const factsDisplay = entity.facts.length > 0
      ? entity.facts.map(f => `• ${f.content}`).join("\n")
      : "(no facts)";

    await respond(ctx.bot, ctx.interaction,
      `**${entity.name}** (id: ${entity.id})\n\n${factsDisplay}`
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

    // TODO: Permission check - only owner can edit

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

  const entity = getEntity(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  const facts = factsText.split("\n").map(f => f.trim()).filter(f => f);
  setFacts(entityId, facts);

  await respond(bot, interaction, `Updated "${entity.name}" with ${facts.length} facts`);
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
    if (entity.created_by !== ctx.userId) {
      await respond(ctx.bot, ctx.interaction, "You can only delete entities you created", true);
      return;
    }

    deleteEntity(entity.id);
    await respond(ctx.bot, ctx.interaction, `Deleted "${entity.name}"`);
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

    setDiscordEntity(discordId, discordType, entity.id, scopeGuildId, scopeChannelId);

    const scopeDesc = scope === "global" ? "globally" : scope === "guild" ? "in this server" : "in this channel";
    const targetDesc = target === "channel" ? "This channel" : "You";
    await respond(ctx.bot, ctx.interaction, `${targetDesc} bound to "${entity.name}" ${scopeDesc}`);
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

    // Check channel binding
    const channelEntityId = resolveDiscordEntity(ctx.channelId, "channel", ctx.guildId, ctx.channelId);
    if (channelEntityId) {
      const channelEntity = getEntityWithFacts(channelEntityId);
      if (channelEntity) {
        lines.push(`**Channel bound to:** ${channelEntity.name}`);
        const locationFact = channelEntity.facts.find(f => f.content.startsWith("is in "));
        if (locationFact) {
          lines.push(`**Location:** ${locationFact.content.replace("is in ", "")}`);
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

    await respond(ctx.bot, ctx.interaction, lines.join("\n"));
  },
});

// =============================================================================
// Help Entities (seeded on first access via /view)
// =============================================================================

const HELP_ENTITY_FACTS: Record<string, string[]> = {
  help: [
    "is the help system",
    "use `/v help:<topic>` for: commands, triggers, facts, bindings, models",
    "---",
    "**Hologram** - Collaborative worldbuilding and roleplay",
    "Everything is an **entity** with **facts**.",
    "---",
    "**Quick Start:**",
    "1. `/c character Aria` - Create a character",
    "2. `/e Aria` - Add personality facts",
    "3. `/b channel Aria` - Bind to this channel",
    "4. Chat - Aria responds based on her facts",
  ],
  "help:commands": [
    "is help for commands",
    "---",
    "**Commands** (6 total)",
    "`/create` (`/c`) - Create entity",
    "`/view` (`/v`) - View entity facts",
    "`/edit` (`/e`) - Edit entity facts",
    "`/delete` (`/d`) - Delete entity",
    "`/bind` (`/b`) - Bind channel/user",
    "`/status` (`/s`) - Channel state",
    "---",
    "**Type shortcuts:** `c`/`char`, `l`/`loc`, `i`",
    "---",
    "**Examples:**",
    "`/c c Aria` - Create character",
    "`/v Aria` - View facts",
    "`/b channel Aria` - Bind to channel",
  ],
  "help:triggers": [
    "is help for triggers",
    "---",
    "**Triggers** - Control when the bot responds",
    "Format: `trigger: <condition> -> <action>`",
    "---",
    "**Conditions:**",
    "• `mention` - Bot is @mentioned",
    "• `pattern \"regex\"` - Message matches",
    "• `random 0.1` - 10% chance",
    "• `llm` - LLM decides",
    "• `always` - Always trigger",
    "---",
    "**Config:**",
    "• `delay_ms: 5000`",
    "• `throttle_ms: 30000`",
  ],
  "help:facts": [
    "is help for facts",
    "---",
    "**Facts** - Define entities",
    "Facts are freeform text.",
    "---",
    "**Special patterns:**",
    "• `is a character/location/item`",
    "• `is in [entity:12]`",
    "• `trigger: ... -> ...`",
    "---",
    "**Tips:**",
    "• Present tense: \"is friendly\"",
    "• Be specific: \"scar above left eye\"",
    "• Include personality",
  ],
  "help:bindings": [
    "is help for bindings",
    "---",
    "**Bindings** - Connect Discord to entities",
    "---",
    "`/b channel <entity>` - Entity responds here",
    "`/b me <entity>` - Speak as entity",
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
