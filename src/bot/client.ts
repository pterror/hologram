import { createBot, Intents } from "@discordeno/bot";
import { initPluginSystem, initPlugins } from "../plugins";
import { handleMessage } from "../plugins/handler";
import { registerCommands, handleInteraction } from "./commands";
import { startEventScheduler } from "../events/scheduler";
import { sendMultiCharResponse } from "./webhooks";
import { sendWelcomeMessage, checkAndOfferSetup } from "./onboarding";
import { checkForTip, buildTipContext, incrementMessageCount } from "./tips";
import { getWorldState } from "../world/state";
import { info, error, debug } from "../logger";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN environment variable is required");
}

export const bot = createBot({
  token,
  intents:
    Intents.Guilds |
    Intents.GuildMessages |
    Intents.MessageContent |
    Intents.DirectMessages,
  desiredProperties: {
    user: {
      id: true,
      username: true,
      bot: true as const,
    },
    message: {
      id: true,
      content: true,
      channelId: true,
      guildId: true,
      author: true,
      mentionedUserIds: true as const,
    },
    member: {
      id: true,
      nick: true,
      permissions: true,
    },
    channel: {
      type: true,
    },
    webhook: {
      id: true,
      token: true,
    },
    interaction: {
      id: true,
      type: true,
      data: true,
      channelId: true,
      guildId: true,
      user: true,
      token: true,
      member: true,
    },
    guild: {
      id: true,
      name: true,
      systemChannelId: true,
    },
  },
});

let botUserId: bigint | null = null;

// Track startup state - guildCreate fires for all existing guilds on startup
let isInitialStartup = true;

// Message deduplication to prevent double responses
const processedMessages = new Set<string>();
const MAX_PROCESSED_MESSAGES = 1000;

function markMessageProcessed(messageId: bigint): boolean {
  const id = messageId.toString();
  if (processedMessages.has(id)) {
    return false; // Already processed
  }
  processedMessages.add(id);
  // Cleanup old messages to prevent memory leak
  if (processedMessages.size > MAX_PROCESSED_MESSAGES) {
    const iterator = processedMessages.values();
    for (let i = 0; i < MAX_PROCESSED_MESSAGES / 2; i++) {
      const value = iterator.next().value;
      if (value) processedMessages.delete(value);
    }
  }
  return true;
}

// Event handlers
bot.events.ready = async (payload) => {
  info("Bot logged in", { username: payload.user.username });
  botUserId = payload.user.id;

  // Initialize plugin system
  await initPluginSystem();
  await initPlugins();
  info("Plugin system initialized");

  // Register slash commands
  await registerCommands(bot);

  // Start background event scheduler (random events + NPC behavior ticks)
  startEventScheduler({
    sendMessage: (channelId, options) => bot.helpers.sendMessage(channelId, options),
  });

  // Mark initial startup complete after a delay
  // This allows all cached guilds to fire guildCreate without triggering welcome messages
  setTimeout(() => {
    isInitialStartup = false;
    info("Initial startup complete, will now welcome new guilds");
  }, 5000);
};

// Handle guild join - send welcome message (only for new guilds, not on startup)
bot.events.guildCreate = async (guild) => {
  // Skip welcome message during initial startup (existing guilds fire guildCreate on connect)
  if (isInitialStartup) {
    debug("Skipping welcome for existing guild during startup", {
      guildId: guild.id.toString(),
      name: guild.name
    });
    return;
  }

  info("Joined new guild", { guildId: guild.id.toString(), name: guild.name });

  // Send welcome message to system channel if available
  if (guild.systemChannelId) {
    try {
      await sendWelcomeMessage(bot, guild.systemChannelId, guild.name ?? "your server");
      info("Sent welcome message", { guildId: guild.id.toString() });
    } catch (err) {
      error("Failed to send welcome message", err, { guildId: guild.id.toString() });
    }
  }
};

bot.events.messageCreate = async (message) => {
  // Ignore bot messages (includes webhook messages from other bots)
  if (message.author.bot) return;

  // Ignore messages without content
  if (!message.content) return;

  // Deduplicate messages to prevent double processing
  if (!markMessageProcessed(message.id)) {
    debug("Skipping duplicate message", { messageId: message.id.toString() });
    return;
  }

  // Check if bot is mentioned
  const isBotMentioned =
    botUserId !== null && message.mentionedUserIds?.includes(botUserId);

  debug("Message received", {
    guild: message.guildId?.toString() ?? "DM",
    author: message.author.username,
    content: message.content.slice(0, 100),
  });

  // If bot is mentioned but no setup exists, offer setup instead of generic response
  if (isBotMentioned && message.guildId) {
    const setupOffered = await checkAndOfferSetup(
      bot,
      message.channelId.toString(),
      message.guildId.toString()
    );
    if (setupOffered) {
      // We offered setup, don't proceed with normal handling
      return;
    }
  }

  // Start typing indicator while processing
  // Typing indicator lasts 10 seconds, so we refresh it every 8 seconds
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  const startTyping = async () => {
    try {
      await bot.helpers.triggerTypingIndicator(message.channelId);
      typingInterval = setInterval(async () => {
        try {
          await bot.helpers.triggerTypingIndicator(message.channelId);
        } catch {
          // Ignore typing errors
        }
      }, 8000);
    } catch {
      // Ignore typing errors
    }
  };
  const stopTyping = () => {
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  };

  // Start typing before processing
  await startTyping();

  // Handle the message
  const result = await handleMessage(
    message.channelId.toString(),
    message.guildId?.toString(),
    message.author.id.toString(),
    message.author.username,
    message.content,
    isBotMentioned ?? false
  );

  // Stop typing indicator
  stopTyping();

  // Send response if we got one
  if (result) {
    try {
      // Send time-skip narration first (if any)
      if (result.narration) {
        await bot.helpers.sendMessage(message.channelId, {
          content: `*${result.narration}*`,
        });
      }

      // Track message for tips
      const channelIdStr = message.channelId.toString();
      incrementMessageCount(channelIdStr);

      // Check for tips to append
      const worldState = getWorldState(channelIdStr);
      const tipContext = buildTipContext(channelIdStr, worldState?.id ?? null);
      const tip = checkForTip(channelIdStr, message.content, tipContext);

      // Route response through multi-char delivery when available
      const mode = result.multiCharMode ?? "tagged";
      if (result.segments && result.segments.length > 0 && mode !== "tagged") {
        await sendMultiCharResponse(
          bot,
          channelIdStr,
          result.segments,
          mode
        );
        // Send tip separately for multi-char responses
        if (tip) {
          await bot.helpers.sendMessage(message.channelId, {
            content: `\n-# ${tip}`,
          });
        }
      } else {
        // Append tip to response as small text footer
        let responseContent = result.response;
        if (tip) {
          responseContent += `\n\n-# ${tip}`;
        }
        await bot.helpers.sendMessage(message.channelId, {
          content: responseContent,
        });
      }
    } catch (err) {
      error("Failed to send message", err, { channelId: message.channelId.toString() });
    }
  }
};

// Handle slash command interactions
bot.events.interactionCreate = async (interaction) => {
  await handleInteraction(bot, interaction);
};

export async function startBot() {
  info("Starting Hologram bot");
  await bot.start();
}
