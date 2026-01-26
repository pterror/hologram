import { createBot, Intents } from "@discordeno/bot";
import { info, debug, error } from "../logger";
import { registerCommands, handleInteraction } from "./commands";
import { handleMessage } from "../ai/handler";
import {
  parseTriggerConfig,
  evaluateTriggers,
  addToBuffer,
  getBufferedMessages,
  setBufferTimer,
  hasActiveTimer,
  canRespondThrottle,
  markResponseTime,
  getThrottleRemainingMs,
  type TriggerAction,
} from "../ai/response-decision";
import { resolveDiscordEntity } from "../db/discord";
import { getEntityWithFacts } from "../db/entities";
import "./commands/commands"; // Register all commands
import { ensureHelpEntities } from "./commands/commands";

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
    },
    message: {
      id: true,
      content: true,
      channelId: true,
      guildId: true,
      author: true,
      mentionedUserIds: true as const,
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
    },
  },
});

let botUserId: bigint | null = null;

// Message deduplication
const processedMessages = new Set<string>();
const MAX_PROCESSED = 1000;

function markProcessed(messageId: bigint): boolean {
  const id = messageId.toString();
  if (processedMessages.has(id)) return false;
  processedMessages.add(id);
  if (processedMessages.size > MAX_PROCESSED) {
    const iter = processedMessages.values();
    for (let i = 0; i < MAX_PROCESSED / 2; i++) {
      const v = iter.next().value;
      if (v) processedMessages.delete(v);
    }
  }
  return true;
}

bot.events.ready = async (payload) => {
  info("Bot ready", { username: payload.user.username });
  botUserId = payload.user.id;

  // Seed help entities
  ensureHelpEntities();

  await registerCommands(bot);
};

bot.events.messageCreate = async (message) => {
  // Ignore own messages
  if (botUserId && message.author.id === botUserId) return;
  if (!message.content) return;
  if (!markProcessed(message.id)) return;

  const isMentioned = botUserId !== null && message.mentionedUserIds?.includes(botUserId);
  const channelId = message.channelId.toString();
  const guildId = message.guildId?.toString();

  debug("Message", {
    channel: channelId,
    author: message.author.username,
    content: message.content.slice(0, 50),
    mentioned: isMentioned,
  });

  // Get channel entity and config
  const channelEntityId = resolveDiscordEntity(channelId, "channel", guildId, channelId);

  // No binding = no response (unless mentioned and we want to offer setup, but skip for now)
  if (!channelEntityId) {
    if (isMentioned) {
      debug("Mentioned but no channel binding - ignoring");
    }
    return;
  }

  const channelEntity = getEntityWithFacts(channelEntityId);
  if (!channelEntity) return;

  // Parse trigger config from channel facts
  const config = parseTriggerConfig(channelEntity.facts);

  // Always add to buffer for context
  addToBuffer(channelId, message.author.username, message.content);

  // Check throttle
  if (!canRespondThrottle(channelId, config.throttleMs)) {
    const remaining = getThrottleRemainingMs(channelId, config.throttleMs);
    debug("Throttled", { channelId, remainingMs: remaining });
    return;
  }

  // Build trigger context
  const triggerCtx = {
    isMentioned: isMentioned ?? false,
    content: message.content,
    characterName: channelEntity.name,
    recentMessages: getBufferedMessages(channelId).slice(-10),
  };

  // If delay is configured, use buffering for non-immediate triggers
  if (config.delayMs > 0) {
    // Mentions bypass delay
    if (isMentioned) {
      const action = await evaluateTriggers(config, triggerCtx);
      if (action) {
        await executeAction(action, channelId, guildId, message.author.username, message.content, true);
      }
      return;
    }

    // Buffer other messages
    if (hasActiveTimer(channelId)) {
      debug("Delay timer already active, buffering message");
      return;
    }

    debug("Starting delay timer", { delayMs: config.delayMs });
    setBufferTimer(channelId, async () => {
      await processDelayedTriggers(channelId, guildId, channelEntity.name, config);
    }, config.delayMs);
    return;
  }

  // No delay - evaluate triggers immediately
  const action = await evaluateTriggers(config, triggerCtx);
  if (!action) {
    debug("No trigger matched");
    return;
  }

  await executeAction(action, channelId, guildId, message.author.username, message.content, isMentioned ?? false);
};

async function processDelayedTriggers(
  channelId: string,
  guildId: string | undefined,
  characterName: string,
  config: ReturnType<typeof parseTriggerConfig>
) {
  // Check throttle again
  if (!canRespondThrottle(channelId, config.throttleMs)) {
    debug("Throttled after delay");
    return;
  }

  const bufferedMessages = getBufferedMessages(channelId);
  if (bufferedMessages.length === 0) {
    debug("No messages in buffer after delay");
    return;
  }

  // Get the last message for context
  const lastMsg = bufferedMessages[bufferedMessages.length - 1];

  // Evaluate triggers with buffered context
  const triggerCtx = {
    isMentioned: false, // Mentions bypassed delay
    content: lastMsg.content,
    characterName,
    recentMessages: bufferedMessages.slice(-10),
  };

  const action = await evaluateTriggers(config, triggerCtx);
  if (!action) {
    debug("No trigger matched after delay");
    return;
  }

  await executeAction(action, channelId, guildId, lastMsg.authorName, lastMsg.content, false);
}

async function executeAction(
  action: TriggerAction,
  channelId: string,
  guildId: string | undefined,
  username: string,
  content: string,
  isMentioned: boolean
) {
  switch (action.type) {
    case "respond":
      await sendResponse(channelId, guildId, username, content, isMentioned);
      break;

    case "narrate":
      // TODO: Implement narration (system message injection)
      debug("Narrate action not yet implemented", { template: action.template });
      break;
  }
}

async function sendResponse(
  channelId: string,
  guildId: string | undefined,
  username: string,
  content: string,
  isMentioned: boolean
) {
  // Start typing indicator
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  try {
    await bot.helpers.triggerTypingIndicator(BigInt(channelId));
    typingInterval = setInterval(async () => {
      try {
        await bot.helpers.triggerTypingIndicator(BigInt(channelId));
      } catch {
        // Ignore typing errors
      }
    }, 8000);
  } catch {
    // Ignore typing errors
  }

  // Handle message via LLM
  const result = await handleMessage({
    channelId,
    guildId,
    userId: "", // We don't have this in delayed context, but handler will resolve from buffer
    username,
    content,
    isMentioned,
  });

  // Stop typing
  if (typingInterval) {
    clearInterval(typingInterval);
  }

  // Mark response time for throttling
  markResponseTime(channelId);

  if (result) {
    try {
      await bot.helpers.sendMessage(BigInt(channelId), {
        content: result.response,
      });
    } catch (err) {
      error("Failed to send message", err);
    }
  }
}

bot.events.interactionCreate = async (interaction) => {
  await handleInteraction(bot, interaction);
};

export async function startBot() {
  info("Starting bot");
  await bot.start();
}
