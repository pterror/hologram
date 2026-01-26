/**
 * /keys command - BYOK (Bring Your Own Key) management
 *
 * Allows users and guild admins to configure their own API keys
 * for LLM and image generation providers.
 */

import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
  MessageComponentTypes,
  TextStyles,
  InteractionTypes,
  BitwisePermissionFlags,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { respond, getSubcommand, getOptionValue, USER_APP_INTEGRATION } from "./index";
import {
  storeApiKey,
  deleteApiKey,
  listApiKeys,
  resolveApiKey,
  validateApiKey,
  updateValidationStatus,
  isByokEnabled,
  type Provider,
  type ApiKeyRecord,
  ALL_PROVIDERS,
  LLM_PROVIDERS,
} from "../../ai/keys";

// Provider display names
const PROVIDER_NAMES: Record<Provider, string> = {
  google: "Google (Gemini)",
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  runcomfy: "RunComfy",
  "runcomfy-serverless": "RunComfy Serverless",
  saladcloud: "SaladCloud",
  runpod: "RunPod",
};

// Provider choices for command options
const PROVIDER_CHOICES = ALL_PROVIDERS.map((p) => ({
  name: PROVIDER_NAMES[p],
  value: p,
}));

export const keysCommand: CreateApplicationCommand = {
  name: "keys",
  description: "Manage API keys for LLM and image providers (BYOK)",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "add",
      description: "Add or update an API key",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "provider",
          description: "The provider to add a key for",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: PROVIDER_CHOICES,
        },
        {
          name: "scope",
          description: "Who can use this key",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "Personal (just me)", value: "user" },
            { name: "Server (this guild)", value: "guild" },
          ],
        },
      ],
    },
    {
      name: "list",
      description: "List configured API keys",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "scope",
          description: "Which keys to show",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "My personal keys", value: "user" },
            { name: "Server keys", value: "guild" },
            { name: "All", value: "all" },
          ],
        },
      ],
    },
    {
      name: "remove",
      description: "Remove an API key",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "provider",
          description: "The provider to remove",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: PROVIDER_CHOICES,
        },
        {
          name: "scope",
          description: "Which key to remove",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "My personal key", value: "user" },
            { name: "Server key", value: "guild" },
          ],
        },
      ],
    },
    {
      name: "test",
      description: "Test an API key",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "provider",
          description: "The provider to test",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: PROVIDER_CHOICES,
        },
      ],
    },
    {
      name: "status",
      description: "Show BYOK status and which keys are active",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleKeysCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";
  const guildId = interaction.guildId?.toString();

  // Check if BYOK is enabled
  if (subcommand !== "status" && !isByokEnabled()) {
    await respond(
      bot,
      interaction,
      "BYOK (Bring Your Own Key) is not enabled. The bot operator needs to set `BYOK_MASTER_KEY`.",
      true
    );
    return;
  }

  switch (subcommand) {
    case "add":
      await handleAdd(bot, interaction, userId, guildId);
      break;
    case "list":
      await handleList(bot, interaction, userId, guildId);
      break;
    case "remove":
      await handleRemove(bot, interaction, userId, guildId);
      break;
    case "test":
      await handleTest(bot, interaction, userId, guildId);
      break;
    case "status":
      await handleStatus(bot, interaction, userId, guildId);
      break;
    default:
      await respond(bot, interaction, "Unknown subcommand.", true);
  }
}

// =============================================================================
// Subcommand Handlers
// =============================================================================

async function handleAdd(
  bot: HologramBot,
  interaction: HologramInteraction,
  userId: string,
  guildId?: string
): Promise<void> {
  const provider = getOptionValue<string>(interaction, "provider") as Provider;
  const scope = getOptionValue<string>(interaction, "scope")!;

  // Check permissions for guild scope
  if (scope === "guild") {
    if (!guildId) {
      await respond(bot, interaction, "Server keys can only be added in a server.", true);
      return;
    }

    // Check if user has MANAGE_GUILD permission
    const memberPerms = interaction.member?.permissions;
    if (memberPerms) {
      const hasPermission =
        memberPerms.contains(BitwisePermissionFlags.MANAGE_GUILD) ||
        memberPerms.contains(BitwisePermissionFlags.ADMINISTRATOR);
      if (!hasPermission) {
        await respond(
          bot,
          interaction,
          "You need **Manage Server** permission to add server keys.",
          true
        );
        return;
      }
    }
  }

  // Open modal for API key input
  const providerName = PROVIDER_NAMES[provider];
  const scopeLabel = scope === "guild" ? "server" : "personal";

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 9, // Modal
    data: {
      customId: `keys_add:${provider}:${scope}:${guildId ?? ""}`,
      title: `Add ${providerName} API Key`,
      components: [
        {
          type: MessageComponentTypes.ActionRow,
          components: [
            {
              type: 4, // TextInput
              customId: "api_key",
              label: `${providerName} API Key (${scopeLabel})`,
              style: TextStyles.Short,
              placeholder: "Paste your API key here...",
              required: true,
              minLength: 10,
              maxLength: 200,
            },
          ],
        },
      ],
    },
  });
}

async function handleList(
  bot: HologramBot,
  interaction: HologramInteraction,
  userId: string,
  guildId?: string
): Promise<void> {
  const scope = getOptionValue<string>(interaction, "scope") ?? "all";
  const lines: string[] = ["**API Keys**"];

  if (scope === "user" || scope === "all") {
    const userKeys = listApiKeys({ userId });
    if (userKeys.length > 0) {
      lines.push("\n**Personal Keys:**");
      for (const key of userKeys) {
        lines.push(formatKeyLine(key));
      }
    } else if (scope === "user") {
      lines.push("\n*No personal keys configured*");
    }
  }

  if ((scope === "guild" || scope === "all") && guildId) {
    const guildKeys = listApiKeys({ guildId });
    if (guildKeys.length > 0) {
      lines.push("\n**Server Keys:**");
      for (const key of guildKeys) {
        lines.push(formatKeyLine(key));
      }
    } else if (scope === "guild") {
      lines.push("\n*No server keys configured*");
    }
  }

  if (!guildId && (scope === "guild" || scope === "all")) {
    lines.push("\n*Server keys only available in servers*");
  }

  if (lines.length === 1) {
    lines.push("\n*No keys configured*");
  }

  await respond(bot, interaction, lines.join("\n"), true);
}

async function handleRemove(
  bot: HologramBot,
  interaction: HologramInteraction,
  userId: string,
  guildId?: string
): Promise<void> {
  const provider = getOptionValue<string>(interaction, "provider") as Provider;
  const scope = getOptionValue<string>(interaction, "scope")!;
  const providerName = PROVIDER_NAMES[provider];

  if (scope === "guild") {
    if (!guildId) {
      await respond(bot, interaction, "Not in a server.", true);
      return;
    }

    // Check permissions
    const memberPerms = interaction.member?.permissions;
    if (memberPerms) {
      const hasPermission =
        memberPerms.contains(BitwisePermissionFlags.MANAGE_GUILD) ||
        memberPerms.contains(BitwisePermissionFlags.ADMINISTRATOR);
      if (!hasPermission) {
        await respond(
          bot,
          interaction,
          "You need **Manage Server** permission to remove server keys.",
          true
        );
        return;
      }
    }
  }

  const scopeObj = scope === "guild" ? { guildId: guildId! } : { userId };
  const deleted = deleteApiKey(scopeObj, provider);

  if (deleted) {
    const scopeLabel = scope === "guild" ? "server" : "personal";
    await respond(bot, interaction, `Removed ${scopeLabel} ${providerName} key.`, true);
  } else {
    await respond(bot, interaction, `No ${providerName} key found to remove.`, true);
  }
}

async function handleTest(
  bot: HologramBot,
  interaction: HologramInteraction,
  userId: string,
  guildId?: string
): Promise<void> {
  const provider = getOptionValue<string>(interaction, "provider") as Provider;
  const providerName = PROVIDER_NAMES[provider];

  // Defer response as validation may take time
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 5, // DeferredChannelMessageWithSource
    data: { flags: 64 }, // Ephemeral
  });

  const resolved = resolveApiKey(provider, userId, guildId);
  if (!resolved) {
    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: `No ${providerName} key configured. Add one with \`/keys add\`.`,
    });
    return;
  }

  const sourceLabel =
    resolved.source === "user"
      ? "personal"
      : resolved.source === "guild"
        ? "server"
        : "environment";

  const isValid = await validateApiKey(provider, resolved.key);

  if (isValid) {
    if (resolved.keyId) {
      updateValidationStatus(resolved.keyId, "valid");
    }
    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: `${providerName} key (${sourceLabel}) is **valid**.`,
    });
  } else {
    if (resolved.keyId) {
      updateValidationStatus(resolved.keyId, "invalid");
    }
    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: `${providerName} key (${sourceLabel}) is **invalid**. Check the key and try again.`,
    });
  }
}

async function handleStatus(
  bot: HologramBot,
  interaction: HologramInteraction,
  userId: string,
  guildId?: string
): Promise<void> {
  const lines: string[] = ["**BYOK Status**"];

  if (!isByokEnabled()) {
    lines.push("\nBYOK is **disabled**. The bot operator needs to set `BYOK_MASTER_KEY`.");
    lines.push("\nUsing environment variable keys only.");
  } else {
    lines.push("\nBYOK is **enabled**.");
    lines.push("\n**Active Keys by Provider:**");

    for (const provider of ALL_PROVIDERS) {
      const resolved = resolveApiKey(provider, userId, guildId);
      const providerName = PROVIDER_NAMES[provider];
      const category = LLM_PROVIDERS.includes(provider as typeof LLM_PROVIDERS[number])
        ? "LLM"
        : "Image";

      if (resolved) {
        const sourceLabel =
          resolved.source === "user"
            ? "personal key"
            : resolved.source === "guild"
              ? "server key"
              : "env var";
        lines.push(`- ${providerName} [${category}]: ${sourceLabel}`);
      } else {
        lines.push(`- ${providerName} [${category}]: *not configured*`);
      }
    }
  }

  await respond(bot, interaction, lines.join("\n"), true);
}

// =============================================================================
// Modal Handler
// =============================================================================

/**
 * Handle modal submissions for key input.
 * Returns true if this interaction was handled.
 */
export async function handleKeysModal(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<boolean> {
  // Check if this is a modal submission
  if (interaction.type !== InteractionTypes.ModalSubmit) {
    return false;
  }

  const customId = interaction.data?.customId;
  if (!customId?.startsWith("keys_add:")) {
    return false;
  }

  // Parse custom ID: keys_add:provider:scope:guildId
  const parts = customId.split(":");
  if (parts.length < 3) {
    return false;
  }

  const [, provider, scope, storedGuildId] = parts;
  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";
  const guildId = storedGuildId || undefined;
  const providerName = PROVIDER_NAMES[provider as Provider];

  // Extract API key from modal
  const components = interaction.data?.components ?? [];
  let apiKey = "";
  for (const row of components) {
    if (!("components" in row) || !row.components) continue;
    for (const comp of row.components) {
      if (comp.customId === "api_key") {
        apiKey = comp.value ?? "";
      }
    }
  }

  if (!apiKey.trim()) {
    await respond(bot, interaction, "No API key provided.", true);
    return true;
  }

  // Defer for validation
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 5, // DeferredChannelMessageWithSource
    data: { flags: 64 },
  });

  // Validate key
  const isValid = await validateApiKey(provider as Provider, apiKey.trim());

  // Store key
  const scopeObj = scope === "guild" && guildId ? { guildId } : { userId };
  const record = storeApiKey(scopeObj, provider as Provider, apiKey.trim());
  updateValidationStatus(record.id, isValid ? "valid" : "invalid");

  const scopeLabel = scope === "guild" ? "server" : "personal";
  if (isValid) {
    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: `${providerName} API key saved as ${scopeLabel} key. Key is **valid**.`,
    });
  } else {
    await bot.helpers.editOriginalInteractionResponse(interaction.token, {
      content: `${providerName} API key saved as ${scopeLabel} key, but **validation failed**. The key may be invalid or rate-limited. You can test it again with \`/keys test\`.`,
    });
  }

  return true;
}

// =============================================================================
// Helpers
// =============================================================================

function formatKeyLine(key: ApiKeyRecord): string {
  const providerName = PROVIDER_NAMES[key.provider];
  const status = formatStatus(key.validationStatus);
  const lastUsed = key.lastUsedAt
    ? `last used <t:${key.lastUsedAt}:R>`
    : "never used";
  return `- ${providerName} ${status} (${lastUsed})`;
}

function formatStatus(status: string): string {
  switch (status) {
    case "valid":
      return "";
    case "invalid":
      return "[INVALID]";
    case "expired":
      return "[expired]";
    default:
      return "[pending]";
  }
}
