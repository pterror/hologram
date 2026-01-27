import { createBot, Intents } from "@discordeno/bot";
import { info, debug, warn, error } from "../logger";
import { registerCommands, handleInteraction } from "./commands";
import { handleMessage, handleMessageStreaming, type EvaluatedEntity } from "../ai/handler";
import { resolveDiscordEntity, resolveDiscordEntities, isNewUser, markUserWelcomed, addMessage, trackWebhookMessage, getWebhookMessageEntity, getMessages, formatMessagesForContext, recordEvalError } from "../db/discord";
import { getEntity, getEntityWithFacts, getSystemEntity, getFactsForEntity, type EntityWithFacts } from "../db/entities";
import { evaluateFacts, createBaseContext, parsePermissionDirectives } from "../logic/expr";
import { executeWebhook, editWebhookMessage, setBot } from "./webhooks";
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
      globalName: true,
    },
    message: {
      id: true,
      content: true,
      channelId: true,
      guildId: true,
      author: true,
      mentionedUserIds: true as const,
      messageReference: true,
      messageSnapshots: true as const,
      webhookId: true as const,
      stickerItems: true as const,
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
    component: {
      type: true,
      customId: true,
      value: true,
      components: true,
    },
    guild: {
      id: true,
      name: true,
    },
    webhook: {
      id: true,
      name: true,
      token: true,
    },
    channel: {
      id: true,
      type: true,
      parentId: true,
    },
    messageReference: {
      messageId: true,
      channelId: true,
      guildId: true,
    },
    sticker: {
      id: true,
      name: true,
    },
  },
});

// Initialize webhook module with bot instance
setBot(bot);

let botUserId: bigint | null = null;

// Track last response time per channel (for dt_ms in expressions)
const lastResponseTime = new Map<string, number>();

// Track consecutive self-response chain depth per channel (resets on real user message)
const responseChainDepth = new Map<string, number>();
const MAX_RESPONSE_CHAIN = process.env.MAX_RESPONSE_CHAIN
  ? parseInt(process.env.MAX_RESPONSE_CHAIN, 10)
  : 3;

// Pending retry timers per channel:entity
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function retryKey(channelId: string, entityId: number): string {
  return `${channelId}:${entityId}`;
}

// Message deduplication
const processedMessages = new Set<string>();
const MAX_PROCESSED = 1000;

// Track bot-sent message IDs (for reply detection)
const botMessageIds = new Set<string>();
const MAX_BOT_MESSAGES = 1000;


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
  if (!message.content && !message.stickerItems?.length) return;
  if (!markProcessed(message.id)) return;

  // Serialize stickers as action text appended to content
  let content = message.content ?? "";
  if (message.stickerItems?.length) {
    const stickerText = message.stickerItems
      .map(s => `*sent a sticker: ${s.name}*`)
      .join(" ");
    content = content ? `${content} ${stickerText}` : stickerText;
  }

  // mentionedUserIds is unreliable in Discordeno, parse from content as fallback
  const isMentioned = botUserId !== null && (
    message.mentionedUserIds?.includes(botUserId) ||
    content.includes(`<@${botUserId}>`)
  );
  const channelId = message.channelId.toString();
  const guildId = message.guildId?.toString();
  const messageTime = Date.now();

  // Detect reply to bot and forwarded messages
  const messageRef = message.messageReference;
  const refMessageId = messageRef?.messageId?.toString();
  const isRepliedToBot = refMessageId ? botMessageIds.has(refMessageId) : false;
  const repliedToWebhookEntity = refMessageId ? getWebhookMessageEntity(refMessageId) : undefined;
  const isReplied = isRepliedToBot || !!repliedToWebhookEntity;
  // Forwarded messages have messageSnapshots
  const isForward = (message.messageSnapshots?.length ?? 0) > 0;

  // Track response chain depth to prevent infinite self-response loops
  const isWebhookMessage = !!message.webhookId;
  if (isWebhookMessage) {
    // Check if this is one of our own webhook messages
    const msgId = message.id.toString();
    if (getWebhookMessageEntity(msgId)) {
      // This is our own webhook - increment chain depth
      const depth = (responseChainDepth.get(channelId) ?? 0) + 1;
      responseChainDepth.set(channelId, depth);
      if (MAX_RESPONSE_CHAIN > 0 && depth > MAX_RESPONSE_CHAIN) {
        debug("Response chain limit reached", { channel: channelId, depth, max: MAX_RESPONSE_CHAIN });
        return;
      }
    }
  }

  debug("Mention check", {
    botUserId: botUserId?.toString(),
    mentionedUserIds: message.mentionedUserIds?.map(id => id.toString()),
  });

  // Resolve author name: persona > display name > username
  const authorId = message.author.id.toString();
  const userEntityId = resolveDiscordEntity(authorId, "user", guildId, channelId);
  const userEntity = userEntityId ? getEntity(userEntityId) : null;
  const authorName = userEntity?.name
    ?? message.author.globalName
    ?? message.author.username;

  debug("Message", {
    channel: channelId,
    author: authorName,
    content: content.slice(0, 50),
    mentioned: isMentioned,
    replied: isReplied,
    is_forward: isForward,
  });

  // Store message in history (before response decision so context builds up)
  addMessage(channelId, authorId, authorName, content);

  // Get ALL channel entities (supports multiple characters)
  const channelEntityIds = resolveDiscordEntities(channelId, "channel", guildId, channelId);

  // Also get guild-level entities (bound to server) - only if in a guild
  const guildEntityIds = guildId
    ? resolveDiscordEntities(guildId, "guild", guildId, channelId)
    : [];

  // Combine unique entity IDs (channel bindings + guild bindings)
  const allEntityIds = [...new Set([...channelEntityIds, ...guildEntityIds])];

  // No binding = no response
  if (allEntityIds.length === 0) {
    if (isMentioned) {
      debug("Mentioned but no channel or guild binding - ignoring");
    }
    return;
  }

  // Welcome new users with a DM
  const userId = message.author.id.toString();
  if (isNewUser(userId)) {
    markUserWelcomed(userId);
    sendWelcomeDm(message.author.id).catch(() => {
      // DMs may fail if user has them disabled - that's fine
    });
  }

  // Load all bound entities (channel + guild level)
  const channelEntities: EntityWithFacts[] = [];
  for (const entityId of allEntityIds) {
    const entity = getEntityWithFacts(entityId);
    if (entity) channelEntities.push(entity);
  }

  if (channelEntities.length === 0) return;

  // Evaluate each entity's facts independently
  const respondingEntities: EvaluatedEntity[] = [];
  const retryEntities: { entity: EntityWithFacts; retryMs: number }[] = [];
  const lastResponse = lastResponseTime.get(channelId) ?? 0;

  for (const entity of channelEntities) {
    // Cancel any pending retry for this entity
    const key = retryKey(channelId, entity.id);
    const existingTimer = retryTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      retryTimers.delete(key);
    }

    // Build expression context for this entity
    const facts = entity.facts.map(f => f.content);
    // Check if this is the entity's own webhook message (self-triggered)
    const isSelf = !!message.webhookId &&
      entity.name.toLowerCase() === authorName.toLowerCase();
    const ctx = createBaseContext({
      facts,
      has_fact: (pattern: string) => {
        const regex = new RegExp(pattern, "i");
        return facts.some(f => regex.test(f));
      },
      messages: (n = 1, format?: string) => formatMessagesForContext(getMessages(channelId, n), format),
      dt_ms: lastResponse > 0 ? messageTime - lastResponse : 0,
      elapsed_ms: 0,
      mentioned: isMentioned ?? false,
      replied: isReplied,
      replied_to: repliedToWebhookEntity?.entityName ?? "",
      is_forward: isForward,
      is_self: isSelf,
      name: entity.name,
      chars: channelEntities.map(e => e.name),
    });

    let result;
    try {
      result = evaluateFacts(facts, ctx);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      warn("Fact evaluation failed", {
        entity: entity.name,
        error: errorMsg,
      });

      // Notify all editors of the error (deduped by error message)
      const editors = getEditorsToNotify(entity.owned_by, facts);
      if (editors.length > 0) {
        const isNew = recordEvalError(entity.id, editors[0], errorMsg);
        if (isNew) {
          for (const userId of editors) {
            notifyUserOfError(userId, entity.name, errorMsg).catch(() => {
              // DMs may fail if user has them disabled
            });
          }
        }
      }
      continue;
    }

    debug("Fact evaluation", {
      entity: entity.name,
      shouldRespond: result.shouldRespond,
      respondSource: result.respondSource,
      retryMs: result.retryMs,
      factsCount: result.facts.length,
    });

    if (result.retryMs !== null && result.retryMs > 0) {
      // Entity wants to delay
      retryEntities.push({ entity, retryMs: result.retryMs });
    } else {
      // Default response logic (when no $respond directive):
      // 1. If only one character: respond to mentions or replies
      // 2. Respond if entity's name is mentioned in dialogue (not self-triggered)
      const nameMentioned = ctx.mentioned_in_dialogue(entity.name) && !isSelf;
      const defaultRespond =
        (channelEntities.length === 1 && (isMentioned || isReplied)) ||
        nameMentioned;
      const shouldRespond = result.shouldRespond ?? defaultRespond;

      if (shouldRespond) {
        // Log the trigger source
        const source = result.respondSource
          ?? (nameMentioned ? `name mentioned in: "${content.slice(0, 50)}"`
            : isMentioned ? "bot @mentioned"
            : isReplied ? "reply to bot"
            : "unknown");
        debug("Entity responding", { entity: entity.name, source });

        respondingEntities.push({
          id: entity.id,
          name: entity.name,
          facts: result.facts,
          avatarUrl: result.avatarUrl,
          streamMode: result.streamMode,
        });
      }
    }
  }

  // Respond immediately with entities that are ready
  if (respondingEntities.length > 0) {
    // Reset chain depth only when a real user message triggers a response
    if (!message.webhookId) {
      responseChainDepth.set(channelId, 0);
    }
    await sendResponse(channelId, guildId, authorName, content, isMentioned ?? false, respondingEntities);
  }

  // Schedule per-entity retries (don't block other characters)
  for (const { entity, retryMs } of retryEntities) {
    const key = retryKey(channelId, entity.id);
    debug("Scheduling entity retry", { entity: entity.name, retryMs });
    const timer = setTimeout(() => {
      retryTimers.delete(key);
      processEntityRetry(channelId, guildId, entity.id, authorName, content, messageTime, channelEntities);
    }, retryMs);
    retryTimers.set(key, timer);
  }
};

async function processEntityRetry(
  channelId: string,
  guildId: string | undefined,
  entityId: number,
  username: string,
  content: string,
  messageTime: number,
  allChannelEntities: EntityWithFacts[]
) {
  const entity = getEntityWithFacts(entityId);
  if (!entity) return;

  const facts = entity.facts.map(f => f.content);
  const lastResponse = lastResponseTime.get(channelId) ?? 0;
  const now = Date.now();

  const ctx = createBaseContext({
    facts,
    has_fact: (pattern: string) => {
      const regex = new RegExp(pattern, "i");
      return facts.some(f => regex.test(f));
    },
    messages: (n = 1, format?: string) => formatMessagesForContext(getMessages(channelId, n), format),
    dt_ms: lastResponse > 0 ? now - lastResponse : 0,
    elapsed_ms: now - messageTime,
    mentioned: false, // Retry is never from a mention
    replied: false,
    replied_to: "",
    is_forward: false,
    is_self: false, // Retry is never self-triggered
    name: entity.name,
    chars: allChannelEntities.map(e => e.name),
  });

  let result;
  try {
    result = evaluateFacts(facts, ctx);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    warn("Fact evaluation failed during retry", {
      entity: entity.name,
      error: errorMsg,
    });

    // Notify all editors of the error (deduped by error message)
    const editors = getEditorsToNotify(entity.owned_by, facts);
    if (editors.length > 0) {
      const isNew = recordEvalError(entity.id, editors[0], errorMsg);
      if (isNew) {
        for (const userId of editors) {
          notifyUserOfError(userId, entity.name, errorMsg).catch(() => {
            // DMs may fail if user has them disabled
          });
        }
      }
    }
    return;
  }

  // Handle chained $retry
  if (result.retryMs !== null && result.retryMs > 0) {
    const key = retryKey(channelId, entityId);
    debug("Scheduling chained entity retry", { entity: entity.name, retryMs: result.retryMs });
    const timer = setTimeout(() => {
      retryTimers.delete(key);
      processEntityRetry(channelId, guildId, entityId, username, content, messageTime, allChannelEntities);
    }, result.retryMs);
    retryTimers.set(key, timer);
    return;
  }

  // Default for retry: respond if entity's name is mentioned in dialogue
  const defaultRespond = ctx.mentioned_in_dialogue(entity.name);
  const shouldRespond = result.shouldRespond ?? defaultRespond;

  if (!shouldRespond) {
    debug("Entity not responding after retry", { entity: entity.name });
    return;
  }

  // Respond with just this entity (as EvaluatedEntity)
  await sendResponse(channelId, guildId, username, content, false, [{
    id: entity.id,
    name: entity.name,
    facts: result.facts,
    avatarUrl: result.avatarUrl,
    streamMode: result.streamMode,
  }]);
}

/** Helper to send a message (webhook or regular) and optionally track it */
async function sendStreamMessage(
  channelId: string,
  content: string,
  entity?: EvaluatedEntity
): Promise<string | null> {
  if (entity) {
    // Try webhook first
    const ids = await executeWebhook(channelId, content, entity.name, entity.avatarUrl ?? undefined);
    if (ids && ids[0]) {
      return ids[0];
    }
    // Fall back to regular message with name prefix
    try {
      const sent = await bot.helpers.sendMessage(BigInt(channelId), {
        content: `**${entity.name}:** ${content}`,
      });
      return sent.id.toString();
    } catch (err) {
      error("Failed to send stream message", err);
      return null;
    }
  } else {
    // No entity - regular message
    try {
      const sent = await bot.helpers.sendMessage(BigInt(channelId), { content });
      return sent.id.toString();
    } catch (err) {
      error("Failed to send stream message", err);
      return null;
    }
  }
}

/** Helper to edit a message (webhook or regular) */
async function editStreamMessage(
  channelId: string,
  messageId: string,
  content: string,
  entity?: EvaluatedEntity
): Promise<boolean> {
  if (entity) {
    // Try webhook edit first
    const success = await editWebhookMessage(channelId, messageId, content);
    if (success) return true;
    // Fall back to regular edit with name prefix
    try {
      await bot.helpers.editMessage(BigInt(channelId), BigInt(messageId), {
        content: `**${entity.name}:** ${content}`,
      });
      return true;
    } catch {
      return false;
    }
  } else {
    // No entity - regular edit
    try {
      await bot.helpers.editMessage(BigInt(channelId), BigInt(messageId), { content });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Handle streaming response with different modes.
 */
async function handleStreamingResponse(
  channelId: string,
  entities: EvaluatedEntity[],
  streamMode: "lines" | "full" | "lines_full",
  ctx: {
    channelId: string;
    guildId?: string;
    userId: string;
    username: string;
    content: string;
    isMentioned: boolean;
  }
): Promise<void> {
  const allMessageIds: string[] = [];

  // Track current message per entity (for editing)
  const entityMessages = new Map<string, { messageId: string; content: string }>();
  // Track current line message (for lines_full mode)
  let currentLineMessage: { messageId: string; content: string } | null = null;
  // Single message for full mode
  let fullMessage: { messageId: string; content: string } | null = null;

  const isSingleEntity = entities.length === 1;
  const entity = isSingleEntity ? entities[0] : null;

  for await (const event of handleMessageStreaming({
    ...ctx,
    entities,
    streamMode,
  })) {
    switch (event.type) {
      case "line": {
        // Single entity: new message per line
        if (entity) {
          const msgId = await sendStreamMessage(channelId, event.content, entity);
          if (msgId) allMessageIds.push(msgId);
          currentLineMessage = null;
        }
        break;
      }

      case "delta": {
        // Single entity: edit or create message
        if (entity) {
          if (streamMode === "full") {
            // Edit single message with full content
            if (fullMessage) {
              fullMessage.content = event.fullContent;
              await editStreamMessage(channelId, fullMessage.messageId, event.fullContent, entity);
            } else {
              const msgId = await sendStreamMessage(channelId, event.fullContent, entity);
              if (msgId) {
                fullMessage = { messageId: msgId, content: event.fullContent };
                allMessageIds.push(msgId);
              }
            }
          } else if (streamMode === "lines_full") {
            // Edit current line message
            if (currentLineMessage) {
              currentLineMessage.content = event.fullContent;
              await editStreamMessage(channelId, currentLineMessage.messageId, event.fullContent, entity);
            } else {
              const msgId = await sendStreamMessage(channelId, event.fullContent, entity);
              if (msgId) {
                currentLineMessage = { messageId: msgId, content: event.fullContent };
                allMessageIds.push(msgId);
              }
            }
          }
        }
        break;
      }

      case "char_start": {
        // Multi-character: prepare for new character
        entityMessages.delete(event.name);
        break;
      }

      case "char_line": {
        // Multi-character: new line for this character
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity) {
          if (streamMode === "lines") {
            // New message per line
            const msgId = await sendStreamMessage(channelId, event.content, charEntity);
            if (msgId) allMessageIds.push(msgId);
          } else {
            // For full/lines_full, accumulate and edit
            const existing = entityMessages.get(event.name);
            const newContent = existing ? `${existing.content}\n${event.content}` : event.content;
            if (existing) {
              existing.content = newContent;
              await editStreamMessage(channelId, existing.messageId, newContent, charEntity);
            } else {
              const msgId = await sendStreamMessage(channelId, newContent, charEntity);
              if (msgId) {
                entityMessages.set(event.name, { messageId: msgId, content: newContent });
                allMessageIds.push(msgId);
              }
            }
          }
        }
        break;
      }

      case "char_delta": {
        // Multi-character: delta update for this character
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity && (streamMode === "full" || streamMode === "lines_full")) {
          const existing = entityMessages.get(event.name);
          if (existing) {
            existing.content = event.content;
            await editStreamMessage(channelId, existing.messageId, event.content, charEntity);
          } else {
            const msgId = await sendStreamMessage(channelId, event.content, charEntity);
            if (msgId) {
              entityMessages.set(event.name, { messageId: msgId, content: event.content });
              allMessageIds.push(msgId);
            }
          }
        }
        break;
      }

      case "char_end": {
        // Multi-character: finalize character response
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity) {
          const existing = entityMessages.get(event.name);
          if (existing) {
            // Final edit with complete content
            await editStreamMessage(channelId, existing.messageId, event.content, charEntity);
          } else if (event.content) {
            // No message created yet, create one
            const msgId = await sendStreamMessage(channelId, event.content, charEntity);
            if (msgId) allMessageIds.push(msgId);
          }
        }
        break;
      }

      case "done": {
        debug("Streaming complete", { fullTextLength: event.fullText.length });
        break;
      }
    }
  }

  // Track all messages for reply detection
  if (allMessageIds.length > 0) {
    if (isSingleEntity && entity) {
      trackWebhookMessages(allMessageIds, entity.id, entity.name);
    } else {
      // For multi-char, track per character
      for (const [name, msg] of entityMessages) {
        const charEntity = entities.find(e => e.name === name);
        if (charEntity) {
          trackWebhookMessage(msg.messageId, charEntity.id, charEntity.name);
        }
      }
    }
  }
}

async function sendResponse(
  channelId: string,
  guildId: string | undefined,
  username: string,
  content: string,
  isMentioned: boolean,
  respondingEntities?: EvaluatedEntity[]
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

  const stopTyping = () => {
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  };

  // Handle message via LLM
  try {
    // Check for streaming mode
    const streamMode = respondingEntities?.[0]?.streamMode;
    const useStreaming = streamMode && respondingEntities && respondingEntities.length > 0;

    if (useStreaming) {
      debug("Using streaming mode", { mode: streamMode, entities: respondingEntities.map(e => e.name) });

      // Stop typing - we'll be sending messages as we stream
      stopTyping();

      await handleStreamingResponse(channelId, respondingEntities, streamMode, {
        channelId,
        guildId,
        userId: "",
        username,
        content,
        isMentioned,
      });

      // Mark response time
      lastResponseTime.set(channelId, Date.now());
      return;
    }

    // Non-streaming path
    const result = await handleMessage({
      channelId,
      guildId,
      userId: "",
      username,
      content,
      isMentioned,
      respondingEntities,
    });

    // Mark response time
    lastResponseTime.set(channelId, Date.now());

    if (!result) {
      stopTyping();
      return;
    }

    // Stop typing before sending response (indicator will expire naturally)
    stopTyping();

    // Use webhooks when we have responding entities (custom name/avatar)
    if (respondingEntities && respondingEntities.length > 0) {
      if (result.characterResponses && result.characterResponses.length > 0) {
        // Multi-character: send separate webhook message for each
        for (const charResponse of result.characterResponses) {
          // Find the entity for this character response
          const entity = respondingEntities.find(e => e.name === charResponse.name);
          const messageIds = await executeWebhook(
            channelId,
            charResponse.content,
            charResponse.name,
            charResponse.avatarUrl
          );
          if (messageIds && entity) {
            trackWebhookMessages(messageIds, entity.id, entity.name);
          } else if (!messageIds) {
            await sendFallbackMessage(channelId, charResponse.name, charResponse.content);
          }
        }
      } else {
        // Single entity: send via webhook with entity's name
        const entity = respondingEntities[0];
        const messageIds = await executeWebhook(
          channelId,
          result.response,
          entity.name,
          entity.avatarUrl ?? undefined
        );
        if (messageIds) {
          trackWebhookMessages(messageIds, entity.id, entity.name);
        } else {
          await sendFallbackMessage(channelId, entity.name, result.response);
        }
      }
    } else {
      // No entities - use regular message
      await sendRegularMessage(channelId, result.response);
    }
  } finally {
    // Safety net - ensure typing is stopped even on error
    if (typingInterval) {
      clearInterval(typingInterval);
    }
  }
}

/** Send a regular message (no webhook) and track for reply detection */
async function sendRegularMessage(channelId: string, content: string): Promise<void> {
  try {
    const sent = await bot.helpers.sendMessage(BigInt(channelId), { content });
    trackBotMessage(sent.id);
  } catch (err) {
    error("Failed to send message", err);
  }
}

/** Send fallback message with character name prefix */
async function sendFallbackMessage(channelId: string, name: string, content: string): Promise<void> {
  try {
    const sent = await bot.helpers.sendMessage(BigInt(channelId), {
      content: `**${name}:** ${content}`,
    });
    trackBotMessage(sent.id);
  } catch (err) {
    error("Failed to send fallback message", err);
  }
}

/** Track bot message ID for reply detection */
function trackBotMessage(messageId: bigint): void {
  botMessageIds.add(messageId.toString());
  if (botMessageIds.size > MAX_BOT_MESSAGES) {
    const iter = botMessageIds.values();
    for (let i = 0; i < MAX_BOT_MESSAGES / 2; i++) {
      const v = iter.next().value;
      if (v) botMessageIds.delete(v);
    }
  }
}

/** Track webhook message IDs with entity association for reply detection */
function trackWebhookMessages(messageIds: string[], entityId: number, entityName: string): void {
  for (const id of messageIds) {
    trackWebhookMessage(id, entityId, entityName);
  }
}

async function sendWelcomeDm(userId: bigint): Promise<void> {
  // Get the help:start entity content
  const helpEntity = getSystemEntity("help:start");
  if (!helpEntity) {
    debug("No help:start entity found for welcome DM");
    return;
  }

  const facts = getFactsForEntity(helpEntity.id);
  const content = facts
    .map(f => f.content)
    .filter(c => !c.startsWith("is ") && c !== "---")
    .join("\n");

  if (!content) return;

  // Create DM channel and send
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dmChannel = await bot.helpers.getDmChannel(userId) as any;
  await bot.helpers.sendMessage(dmChannel.id, {
    content: `**Welcome to Hologram!**\n\n${content}`,
  });

  debug("Sent welcome DM", { userId: userId.toString() });
}

/**
 * Get all user IDs that should be notified of errors for an entity.
 * Includes owner + anyone in the $edit list (but not "everyone").
 */
function getEditorsToNotify(ownerId: string | null, facts: string[]): string[] {
  const editors = new Set<string>();

  if (ownerId) {
    editors.add(ownerId);
  }

  const permissions = parsePermissionDirectives(facts);
  if (Array.isArray(permissions.editList)) {
    for (const userId of permissions.editList) {
      editors.add(userId);
    }
  }

  return [...editors];
}

async function notifyUserOfError(userId: string, entityName: string, errorMsg: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dmChannel = await bot.helpers.getDmChannel(BigInt(userId)) as any;
  await bot.helpers.sendMessage(dmChannel.id, {
    content: `**Condition error in ${entityName}**\n\`\`\`\n${errorMsg}\n\`\`\`\nUse \`/edit ${entityName}\` to fix the condition.`,
  });

  debug("Sent error DM", { userId, entityName });
}

bot.events.interactionCreate = async (interaction) => {
  await handleInteraction(bot, interaction);
};

export async function startBot() {
  info("Starting bot");
  await bot.start();
}
