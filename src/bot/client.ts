import { createBot, Intents } from "@discordeno/bot";
import { info, debug, warn, error } from "../logger";
import { registerCommands, handleInteraction } from "./commands";
import { handleMessage } from "../ai/handler";
import { handleMessageStreaming } from "../ai/streaming";
import { InferenceError } from "../ai/models";
import type { EvaluatedEntity } from "../ai/context";
import { isModelAllowed } from "../ai/models";
import { retrieveRelevantMemories, type MemoryScope } from "../db/memories";
import { resolveDiscordEntity, resolveDiscordEntities, isNewUser, markUserWelcomed, addMessage, updateMessageByDiscordId, deleteMessageByDiscordId, trackWebhookMessage, getWebhookMessageEntity, getMessages, getFilteredMessages, formatMessagesForContext, recordEvalError, isOurWebhookUserId, type MessageData } from "../db/discord";
import { getEntity, getEntityWithFacts, getEntityConfig, getSystemEntity, getFactsForEntity, type EntityWithFacts } from "../db/entities";
import { evaluateFacts, createBaseContext, parsePermissionDirectives, isUserBlacklisted, isUserAllowed, type EvaluatedFactsDefaults, type PermissionDefaults } from "../logic/expr";
import type { EntityConfig } from "../db/entities";
import { executeWebhook, editWebhookMessage, setBot } from "./webhooks";
import "./commands/commands"; // Register all commands
import { ensureHelpEntities } from "./commands/help";

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
      toggles: true,
    },
    message: {
      id: true,
      content: true,
      channelId: true,
      guildId: true,
      author: true,
      member: true,
      mentionedUserIds: true as const,
      messageReference: true,
      messageSnapshots: true as const,
      webhookId: true as const,
      stickerItems: true as const,
      embeds: true as const,
      attachments: true as const,
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
      values: true,
      components: true,
      component: true,
    },
    guild: {
      id: true,
      name: true,
      description: true,
      nsfwLevel: true,
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
      name: true,
      topic: true,
      nsfw: true,
      toggles: true,
    },
    messageReference: {
      messageId: true,
      channelId: true,
      guildId: true,
    },
    sticker: {
      id: true,
      name: true,
      formatType: true,
    },
  },
});

// Initialize webhook module with bot instance
setBot(bot);

let botUserId: bigint | null = null;

// Track last response time per channel (for response_ms in expressions)
const lastResponseTime = new Map<string, number>();

// Track last message time per channel (for idle_ms in expressions)
const lastMessageTime = new Map<string, number>();

// Channel/guild metadata cache with 5-min TTL
interface ChannelMeta { id: string; name: string; description: string; is_nsfw: boolean; type: string; mention: string; fetchedAt: number }
interface GuildMeta { id: string; name: string; description: string; nsfw_level: string; fetchedAt: number }
const channelMetaCache = new Map<string, ChannelMeta>();
const guildMetaCache = new Map<string, GuildMeta>();
const META_TTL_MS = 5 * 60 * 1000;

/** Map Discordeno ChannelTypes enum to human-readable string */
function channelTypeString(type: number): string {
  switch (type) {
    case 0: return "text";
    case 1: return "dm";
    case 2: return "vc";
    case 3: return "dm";
    case 4: return "category";
    case 5: return "announcement";
    case 10: case 11: case 12: return "thread";
    case 13: return "vc";
    case 14: return "directory";
    case 15: return "forum";
    case 16: return "media";
    default: return "text";
  }
}

/** Map GuildNsfwLevel enum to string */
function guildNsfwLevelString(level: number): string {
  switch (level) {
    case 0: return "default";
    case 1: return "explicit";
    case 2: return "safe";
    case 3: return "age_restricted";
    default: return "default";
  }
}

export async function getChannelMetadata(channelId: string): Promise<Omit<ChannelMeta, "fetchedAt">> {
  const cached = channelMetaCache.get(channelId);
  if (cached && Date.now() - cached.fetchedAt < META_TTL_MS) {
    return cached;
  }
  try {
    const ch = await bot.helpers.getChannel(BigInt(channelId));
    const meta: ChannelMeta = {
      id: channelId,
      name: (ch as any).name ?? "",
      description: (ch as any).topic ?? "",
      is_nsfw: !!(ch as any).nsfw,
      type: channelTypeString((ch as any).type ?? 0),
      mention: `<#${channelId}>`,
      fetchedAt: Date.now(),
    };
    channelMetaCache.set(channelId, meta);
    return meta;
  } catch {
    return { id: channelId, name: "", description: "", is_nsfw: false, type: "text", mention: `<#${channelId}>` };
  }
}

export async function getGuildMetadata(guildId: string): Promise<Omit<GuildMeta, "fetchedAt">> {
  const cached = guildMetaCache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < META_TTL_MS) {
    return cached;
  }
  try {
    const g = await bot.helpers.getGuild(BigInt(guildId));
    const meta: GuildMeta = {
      id: guildId,
      name: (g as any).name ?? "",
      description: (g as any).description ?? "",
      nsfw_level: guildNsfwLevelString((g as any).nsfwLevel ?? 0),
      fetchedAt: Date.now(),
    };
    guildMetaCache.set(guildId, meta);
    return meta;
  } catch {
    return { id: guildId, name: "", description: "", nsfw_level: "default" };
  }
}

// Track consecutive self-response chain depth per channel (resets on real user message)
const responseChainDepth = new Map<string, number>();
const MAX_RESPONSE_CHAIN = process.env.MAX_RESPONSE_CHAIN
  ? parseInt(process.env.MAX_RESPONSE_CHAIN, 10)
  : 3;

// Pending retry timers per channel:entity
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Convert entity config columns to evaluateFacts defaults */
function configToDefaults(config: EntityConfig | null): EvaluatedFactsDefaults {
  if (!config) return {};
  return {
    contextExpr: config.config_context,
    modelSpec: config.config_model,
    avatarUrl: config.config_avatar,
    streamMode: config.config_stream_mode as "lines" | "full" | null,
    streamDelimiter: config.config_stream_delimiters ? JSON.parse(config.config_stream_delimiters) : null,
    memoryScope: (config.config_memory as "none" | "channel" | "guild" | "global") ?? "none",
    isFreeform: !!config.config_freeform,
    stripPatterns: config.config_strip ? JSON.parse(config.config_strip) : null,
    shouldRespond: config.config_respond === "true" ? true : config.config_respond === "false" ? false : null,
  };
}

/** Convert entity config columns to permission defaults */
function configToPermissionDefaults(config: EntityConfig | null): PermissionDefaults {
  if (!config) return {};
  return {
    editList: config.config_edit ? JSON.parse(config.config_edit) : null,
    viewList: config.config_view ? JSON.parse(config.config_view) : null,
    useList: config.config_use ? JSON.parse(config.config_use) : null,
    blacklist: config.config_blacklist ? JSON.parse(config.config_blacklist) : [],
  };
}

function retryKey(channelId: string, entityId: number): string {
  return `${channelId}:${entityId}`;
}

// Message deduplication
const processedMessages = new Set<string>();
const MAX_PROCESSED = 1000;

// Track bot-sent message IDs (for reply detection)
const botMessageIds = new Set<string>();
const MAX_BOT_MESSAGES = 1000;

// In-memory tracking of our own webhook messages (for recursion limit)
// This must be updated synchronously when we send, before yielding control
const ownWebhookMessageIds = new Set<string>();
const MAX_OWN_WEBHOOK_IDS = 1000;

function isOwnWebhookMessage(messageId: string): boolean {
  // Check in-memory first (handles race condition), then DB
  return ownWebhookMessageIds.has(messageId) || !!getWebhookMessageEntity(messageId);
}

function trackOwnWebhookMessage(messageId: string, entityId: number, entityName: string): void {
  // Add to in-memory set immediately (synchronous)
  ownWebhookMessageIds.add(messageId);
  if (ownWebhookMessageIds.size > MAX_OWN_WEBHOOK_IDS) {
    const iter = ownWebhookMessageIds.values();
    for (let i = 0; i < MAX_OWN_WEBHOOK_IDS / 2; i++) {
      const v = iter.next().value;
      if (v) ownWebhookMessageIds.delete(v);
    }
  }
  // Also persist to DB for reply detection
  trackWebhookMessage(messageId, entityId, entityName);
}

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
  const hasEmbeds = (message.embeds?.length ?? 0) > 0;
  const hasAttachments = (message.attachments?.length ?? 0) > 0;
  if (!message.content && !message.stickerItems?.length && !hasEmbeds && !hasAttachments) return;
  if (!markProcessed(message.id)) return;

  // Store raw content — sticker/embed/attachment serialization happens at prompt time
  const content = message.content ?? "";

  // mentionedUserIds is unreliable in Discordeno, parse from content as fallback
  const isBotMentioned = botUserId !== null && (
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

  // Check if any mentioned user ID is one of our webhook IDs
  // (handles reply-with-@ping to webhook entity messages)
  let isWebhookMentioned = false;
  if (!isBotMentioned && message.mentionedUserIds?.length) {
    for (const uid of message.mentionedUserIds) {
      if (isOurWebhookUserId(uid.toString())) {
        isWebhookMentioned = true;
        break;
      }
    }
  }
  const isMentioned = isBotMentioned || isWebhookMentioned;

  // Track response chain depth to prevent infinite self-response loops
  const isWebhookMessage = !!message.webhookId;
  if (isWebhookMessage) {
    // Check if this is one of our own webhook messages (in-memory first, then DB)
    const msgId = message.id.toString();
    if (isOwnWebhookMessage(msgId)) {
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

  // Extract member roles (BigInt[] → string[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authorRoles: string[] = ((message as any).member?.roles ?? []).map((r: bigint) => r.toString());

  debug("Message", {
    channel: channelId,
    author: authorName,
    content: content.slice(0, 50),
    mentioned: isMentioned,
    replied: isReplied,
    is_forward: isForward,
  });

  // Build structured message data blob
  const isBot = !!message.author.toggles?.bot;
  const msgData: MessageData = {};
  if (isBot) msgData.is_bot = true;
  if (hasEmbeds) {
    msgData.embeds = message.embeds!.map(e => ({
      ...(e.title && { title: e.title }),
      ...(e.description && { description: e.description }),
      ...(e.fields?.length && { fields: e.fields.map(f => ({ name: f.name, value: f.value })) }),
    }));
  }
  if (message.stickerItems?.length) {
    msgData.stickers = message.stickerItems.map(s => ({
      id: s.id.toString(),
      name: s.name,
      format_type: (s as any).formatType ?? 0,
    }));
  }
  if (hasAttachments) {
    msgData.attachments = message.attachments!.map(a => ({
      filename: (a as any).filename ?? "unknown",
      url: (a as any).url ?? "",
      ...((a as any).contentType && { content_type: (a as any).contentType }),
    }));
  }
  const hasData = Object.keys(msgData).length > 0;

  // Store message in history (before response decision so context builds up)
  addMessage(channelId, authorId, authorName, content, message.id.toString(), hasData ? msgData : undefined);

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

  // Compute idle_ms (time since any message in channel)
  const lastMsg = lastMessageTime.get(channelId) ?? 0;
  const idleMs = lastMsg > 0 ? messageTime - lastMsg : Infinity;
  lastMessageTime.set(channelId, messageTime);

  // Fetch channel/guild metadata (cached)
  const channelMeta = await getChannelMetadata(channelId);
  const guildMeta = guildId
    ? await getGuildMetadata(guildId)
    : { id: "", name: "", description: "", nsfw_level: "default" };

  for (const entity of channelEntities) {
    // Cancel any pending retry for this entity
    const key = retryKey(channelId, entity.id);
    const existingTimer = retryTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      retryTimers.delete(key);
    }

    // Load entity config columns
    const entityConfig = getEntityConfig(entity.id);

    // Check if message author is blacklisted from this entity
    const facts = entity.facts.map(f => f.content);
    const permissions = parsePermissionDirectives(facts, configToPermissionDefaults(entityConfig));
    if (isUserBlacklisted(permissions, authorId, authorName, entity.owned_by, authorRoles)) {
      debug("User blacklisted from entity", { entity: entity.name, user: authorName });
      continue;
    }

    // Check $use whitelist
    if (!isUserAllowed(permissions, authorId, authorName, entity.owned_by, authorRoles)) {
      debug("User not in $use whitelist", { entity: entity.name, user: authorName });
      continue;
    }

    // Build expression context for this entity
    // Check if this is the entity's own webhook message (self-triggered)
    const isSelf = !!message.webhookId &&
      entity.name.toLowerCase() === authorName.toLowerCase();
    const ctx = createBaseContext({
      facts,
      has_fact: (pattern: string) => {
        const regex = new RegExp(pattern, "i");
        return facts.some(f => regex.test(f));
      },
      messages: (n = 1, format?: string, filter?: string) =>
        filter
          ? formatMessagesForContext(getFilteredMessages(channelId, n, filter), format)
          : formatMessagesForContext(getMessages(channelId, n), format),
      response_ms: lastResponse > 0 ? messageTime - lastResponse : Infinity,
      retry_ms: 0,
      idle_ms: idleMs,
      mentioned: isMentioned ?? false,
      replied: isReplied,
      replied_to: repliedToWebhookEntity?.entityName ?? "",
      is_forward: isForward,
      is_self: isSelf,
      name: entity.name,
      chars: channelEntities.map(e => e.name),
      channel: channelMeta,
      server: guildMeta,
    });

    let result;
    try {
      result = evaluateFacts(facts, ctx, configToDefaults(entityConfig));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      warn("Fact evaluation failed", {
        entity: entity.name,
        error: errorMsg,
      });

      // Notify all editors of the error (deduped by error message)
      const editors = getEditorsToNotify(entity.id, entity.owned_by, facts);
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
      // 1. If only one character: respond to @mentions (ambiguous with multiple chars)
      // 2. Respond if reply is specifically to this entity's message (unambiguous)
      // 3. Respond if entity's name is mentioned in dialogue (not self-triggered)
      const nameMentioned = ctx.mentioned_in_dialogue(entity.name) && !isSelf;
      const repliedToThis = repliedToWebhookEntity?.entityName.toLowerCase() === entity.name.toLowerCase();
      const defaultRespond =
        (channelEntities.length === 1 && isMentioned) ||
        repliedToThis ||
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
          streamDelimiter: result.streamDelimiter,
          memoryScope: result.memoryScope,
          contextExpr: result.contextExpr,
          isFreeform: result.isFreeform,
          modelSpec: result.modelSpec,
          stripPatterns: result.stripPatterns,
          template: entity.template,
          systemTemplate: entity.system_template,
          exprContext: ctx,
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

    // Group entities by template so entities with different templates get separate LLM calls
    const templateGroups = new Map<string | null, EvaluatedEntity[]>();
    for (const entity of respondingEntities) {
      const key = entity.template ?? null;
      const group = templateGroups.get(key) ?? [];
      group.push(entity);
      templateGroups.set(key, group);
    }

    for (const [, groupEntities] of templateGroups) {
      await sendResponse(channelId, guildId, authorName, content, isMentioned ?? false, groupEntities);
    }
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

  // Compute idle_ms for retry context
  const lastMsg = lastMessageTime.get(channelId) ?? 0;
  const retryIdleMs = lastMsg > 0 ? now - lastMsg : Infinity;

  // Fetch channel/guild metadata (cached)
  const channelMeta = await getChannelMetadata(channelId);
  const guildMeta = guildId
    ? await getGuildMetadata(guildId)
    : { id: "", name: "", description: "", nsfw_level: "default" };

  const ctx = createBaseContext({
    facts,
    has_fact: (pattern: string) => {
      const regex = new RegExp(pattern, "i");
      return facts.some(f => regex.test(f));
    },
    messages: (n = 1, format?: string, filter?: string) =>
      filter
        ? formatMessagesForContext(getFilteredMessages(channelId, n, filter), format)
        : formatMessagesForContext(getMessages(channelId, n), format),
    response_ms: lastResponse > 0 ? now - lastResponse : Infinity,
    retry_ms: now - messageTime,
    idle_ms: retryIdleMs,
    mentioned: false, // Retry is never from a mention
    replied: false,
    replied_to: "",
    is_forward: false,
    is_self: false, // Retry is never self-triggered
    name: entity.name,
    chars: allChannelEntities.map(e => e.name),
    channel: channelMeta,
    server: guildMeta,
  });

  const retryConfig = getEntityConfig(entityId);
  let result;
  try {
    result = evaluateFacts(facts, ctx, configToDefaults(retryConfig));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    warn("Fact evaluation failed during retry", {
      entity: entity.name,
      error: errorMsg,
    });

    // Notify all editors of the error (deduped by error message)
    const editors = getEditorsToNotify(entity.id, entity.owned_by, facts);
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
    streamDelimiter: result.streamDelimiter,
    memoryScope: result.memoryScope,
    contextExpr: result.contextExpr,
    isFreeform: result.isFreeform,
    modelSpec: result.modelSpec,
    stripPatterns: result.stripPatterns,
    template: entity.template,
    systemTemplate: entity.system_template,
    exprContext: ctx,
  }]);
}

/** Helper to send a message (webhook or regular) and immediately track it */
async function sendStreamMessage(
  channelId: string,
  content: string,
  entity?: EvaluatedEntity
): Promise<string | null> {
  if (!content.trim()) return null;
  if (entity) {
    // Try webhook first
    const ids = await executeWebhook(channelId, content, entity.name, entity.avatarUrl ?? undefined);
    if (ids && ids[0]) {
      // Track immediately to prevent race condition with messageCreate
      trackOwnWebhookMessage(ids[0], entity.id, entity.name);
      return ids[0];
    }
    // Fall back to regular message with name prefix
    try {
      const sent = await bot.helpers.sendMessage(BigInt(channelId), {
        content: `**${entity.name}:** ${content}`,
      });
      // Bot messages skip messageCreate, store in history manually
      addMessage(channelId, sent.author.id.toString(), entity.name, content, sent.id.toString());
      return sent.id.toString();
    } catch (err) {
      error("Failed to send stream message", err);
      return null;
    }
  } else {
    // No entity - regular message
    try {
      const sent = await bot.helpers.sendMessage(BigInt(channelId), { content });
      // Bot messages skip messageCreate, store in history manually
      const authorName = sent.author.globalName ?? sent.author.username;
      addMessage(channelId, sent.author.id.toString(), authorName, content, sent.id.toString());
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
  streamMode: "lines" | "full",
  delimiter: string[] | undefined,
  ctx: {
    channelId: string;
    guildId?: string;
    userId: string;
    username: string;
    content: string;
    isMentioned: boolean;
    entityMemories?: Map<number, Array<{ content: string }>>;
  }
): Promise<void> {
  const allMessageIds: string[] = [];

  // Track current message per entity (for editing in full mode)
  const entityMessages = new Map<string, { messageId: string; content: string }>();
  // Track entities that already sent messages via char_line/char_line_delta/char_line_end
  // so char_end doesn't duplicate them
  const charLinesSent = new Set<string>();
  // Single message for full mode
  let fullMessage: { messageId: string; content: string } | null = null;
  // Current line message for "lines full" mode
  let currentLineMessage: { messageId: string; content: string } | null = null;
  // Track current line messages per character for multi-char "lines full" mode
  const charLineMessages = new Map<string, { messageId: string; content: string }>();

  const isSingleEntity = entities.length === 1;
  const entity = isSingleEntity ? entities[0] : null;

  for await (const event of handleMessageStreaming({
    ...ctx,
    entities,
    streamMode,
    delimiter,
  })) {
    switch (event.type) {
      case "line": {
        // Single entity lines mode: new message per chunk
        if (entity) {
          const msgId = await sendStreamMessage(channelId, event.content, entity);
          if (msgId) allMessageIds.push(msgId);
        }
        break;
      }

      case "line_start": {
        // Single entity lines full mode: prepare for new line
        currentLineMessage = null;
        break;
      }

      case "line_delta": {
        // Single entity lines full mode: delta within current line
        if (entity) {
          if (currentLineMessage) {
            currentLineMessage.content = event.content;
            await editStreamMessage(channelId, currentLineMessage.messageId, event.content, entity);
          } else {
            const msgId = await sendStreamMessage(channelId, event.content, entity);
            if (msgId) {
              currentLineMessage = { messageId: msgId, content: event.content };
              allMessageIds.push(msgId);
            }
          }
        }
        break;
      }

      case "line_end": {
        // Single entity lines full mode: finalize current line
        if (entity && currentLineMessage) {
          await editStreamMessage(channelId, currentLineMessage.messageId, event.content, entity);
          // Update DB — messageUpdate skips own messages
          updateMessageByDiscordId(currentLineMessage.messageId, event.content);
        } else if (entity && !currentLineMessage) {
          // Line was too short for delta, send final content
          const msgId = await sendStreamMessage(channelId, event.content, entity);
          if (msgId) allMessageIds.push(msgId);
        }
        currentLineMessage = null;
        break;
      }

      case "delta": {
        // Single entity full mode: edit or create message
        if (entity && streamMode === "full") {
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
        }
        break;
      }

      case "char_start": {
        // Multi-character: prepare for new character
        entityMessages.delete(event.name);
        charLineMessages.delete(event.name);
        charLinesSent.delete(event.name);
        break;
      }

      case "char_line": {
        // Multi-character lines mode: new line/chunk for this character
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity) {
          // New message per chunk
          const msgId = await sendStreamMessage(channelId, event.content, charEntity);
          if (msgId) {
            allMessageIds.push(msgId);
            charLinesSent.add(event.name);
          }
        }
        break;
      }

      case "char_line_start": {
        // Multi-character lines full mode: new line starting for character
        charLineMessages.delete(event.name);
        break;
      }

      case "char_line_delta": {
        // Multi-character lines full mode: delta within current line
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity) {
          const existing = charLineMessages.get(event.name);
          if (existing) {
            existing.content = event.content;
            await editStreamMessage(channelId, existing.messageId, event.content, charEntity);
          } else {
            const msgId = await sendStreamMessage(channelId, event.content, charEntity);
            if (msgId) {
              charLineMessages.set(event.name, { messageId: msgId, content: event.content });
              allMessageIds.push(msgId);
              charLinesSent.add(event.name);
            }
          }
        }
        break;
      }

      case "char_line_end": {
        // Multi-character lines full mode: finalize current line
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity) {
          const existing = charLineMessages.get(event.name);
          if (existing) {
            await editStreamMessage(channelId, existing.messageId, event.content, charEntity);
            // Update DB — messageUpdate skips own messages
            updateMessageByDiscordId(existing.messageId, event.content);
          } else {
            // Line was too short for delta, send final content
            const msgId = await sendStreamMessage(channelId, event.content, charEntity);
            if (msgId) {
              allMessageIds.push(msgId);
              charLinesSent.add(event.name);
            }
          }
          charLineMessages.delete(event.name);
        }
        break;
      }

      case "char_delta": {
        // Multi-character full mode: delta update for this character
        const charEntity = entities.find(e => e.name === event.name);
        if (charEntity && streamMode === "full") {
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
            // Final edit with complete content (full mode)
            await editStreamMessage(channelId, existing.messageId, event.content, charEntity);
            // Update DB — messageUpdate skips own messages
            updateMessageByDiscordId(existing.messageId, event.content);
          } else if (event.content && !charLinesSent.has(event.name)) {
            // No message created yet via any path, create one
            const msgId = await sendStreamMessage(channelId, event.content, charEntity);
            if (msgId) allMessageIds.push(msgId);
          }
        }
        charLinesSent.delete(event.name);
        break;
      }

      case "done": {
        // Update single-entity full mode message with final content
        if (fullMessage) {
          updateMessageByDiscordId(fullMessage.messageId, fullMessage.content);
        }
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
          trackOwnWebhookMessage(msg.messageId, charEntity.id, charEntity.name);
        }
      }
    }
  }
}

export async function sendResponse(
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
    // Retrieve memories for entities that have memory enabled
    const entityMemories = new Map<number, Array<{ content: string }>>();
    if (respondingEntities) {
      // Build conversation context from recent messages for semantic search
      const recentMessages = getMessages(channelId, 10);
      const conversationContext = recentMessages
        .slice().reverse()
        .map(m => `${m.author_name}: ${m.content}`)
        .join("\n");

      for (const entity of respondingEntities) {
        if (entity.memoryScope !== "none") {
          const memories = await retrieveRelevantMemories(
            entity.id,
            conversationContext,
            entity.memoryScope as MemoryScope,
            channelId,
            guildId,
            5 // limit
          );
          if (memories.length > 0) {
            entityMemories.set(entity.id, memories.map(m => ({ content: m.content })));
            debug("Retrieved memories", { entity: entity.name, count: memories.length });
          }
        }
      }
    }

    // Validate model allowlist
    const entityModelSpec = respondingEntities?.[0]?.modelSpec;
    if (entityModelSpec && !isModelAllowed(entityModelSpec)) {
      debug("Model not allowed", { model: entityModelSpec });
      // DM owner about blocked model
      const entity = respondingEntities?.[0];
      if (entity) {
        const entityData = getEntityWithFacts(entity.id);
        if (entityData) {
          const editors = getEditorsToNotify(entity.id, entityData.owned_by, entityData.facts.map(f => f.content));
          const errorMsg = `Model "${entityModelSpec}" is not in the allowed models list`;
          const isNew = recordEvalError(entity.id, editors[0] ?? "", errorMsg);
          if (isNew) {
            for (const uid of editors) {
              notifyUserOfError(uid, entity.name, errorMsg).catch(() => {});
            }
          }
        }
      }
      stopTyping();
      return;
    }

    // Check for streaming mode
    const streamMode = respondingEntities?.[0]?.streamMode;
    const useStreaming = streamMode && respondingEntities && respondingEntities.length > 0;

    if (useStreaming) {
      const streamDelimiter = respondingEntities[0]?.streamDelimiter ?? undefined;
      debug("Using streaming mode", { mode: streamMode, delimiter: streamDelimiter, entities: respondingEntities.map(e => e.name) });

      // Stop typing - we'll be sending messages as we stream
      stopTyping();

      try {
        await handleStreamingResponse(channelId, respondingEntities, streamMode, streamDelimiter, {
          channelId,
          guildId,
          userId: "",
          username,
          content,
          isMentioned,
          entityMemories,
        });

        // Mark response time
        lastResponseTime.set(channelId, Date.now());
        return;
      } catch (streamErr) {
        warn("Streaming failed, falling back to non-streaming", {
          error: streamErr instanceof Error ? streamErr.message : String(streamErr),
        });
        // Fall through to non-streaming path below
      }
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
      entityMemories,
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
      if (result.entityResponses && result.entityResponses.length > 0) {
        // Multiple entities: send separate webhook message for each
        for (const entityResponse of result.entityResponses) {
          // Find the entity for this response
          const entity = respondingEntities.find(e => e.name === entityResponse.name);
          const messageIds = await executeWebhook(
            channelId,
            entityResponse.content,
            entityResponse.name,
            entityResponse.avatarUrl
          );
          if (messageIds && entity) {
            trackWebhookMessages(messageIds, entity.id, entity.name);
          } else if (!messageIds) {
            await sendFallbackMessage(channelId, entityResponse.name, entityResponse.content);
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
  } catch (err) {
    if (err instanceof InferenceError) {
      // DM owner + editors about LLM error
      const entity = respondingEntities?.[0];
      if (entity) {
        const entityData = getEntityWithFacts(entity.id);
        if (entityData) {
          const editors = getEditorsToNotify(entity.id, entityData.owned_by, entityData.facts.map(f => f.content));
          const errorMsg = `LLM error with model "${err.modelSpec}": ${err.message}`;
          const isNew = recordEvalError(entity.id, editors[0] ?? "", errorMsg);
          if (isNew) {
            for (const uid of editors) {
              notifyUserOfError(uid, entity.name, errorMsg).catch(() => {});
            }
          }
        }
      }
    } else {
      error("Unexpected error in sendResponse", err);
    }
  } finally {
    // Safety net - ensure typing is stopped even on error
    if (typingInterval) {
      clearInterval(typingInterval);
    }
  }
}

/** Send a regular message (no webhook) and track for reply detection.
 * Stores in message history since bot messages bypass messageCreate. */
async function sendRegularMessage(channelId: string, content: string): Promise<void> {
  if (!content.trim()) return;
  try {
    const sent = await bot.helpers.sendMessage(BigInt(channelId), { content });
    trackBotMessage(sent.id);
    // Bot messages skip messageCreate (filtered by botUserId check),
    // so store in history manually for LLM context
    const authorName = sent.author.globalName ?? sent.author.username;
    addMessage(channelId, sent.author.id.toString(), authorName, content, sent.id.toString());
  } catch (err) {
    error("Failed to send message", err);
  }
}

/** Send fallback message with character name prefix.
 * Stores in message history since bot messages bypass messageCreate. */
async function sendFallbackMessage(channelId: string, name: string, content: string): Promise<void> {
  if (!content.trim()) return;
  try {
    const sent = await bot.helpers.sendMessage(BigInt(channelId), {
      content: `**${name}:** ${content}`,
    });
    trackBotMessage(sent.id);
    // Bot messages skip messageCreate (filtered by botUserId check),
    // so store in history manually for LLM context
    addMessage(channelId, sent.author.id.toString(), name, content, sent.id.toString());
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

/** Track webhook message IDs with entity association for reply detection and recursion limit */
function trackWebhookMessages(messageIds: string[], entityId: number, entityName: string): void {
  for (const id of messageIds) {
    trackOwnWebhookMessage(id, entityId, entityName);
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
 * Includes owner + anyone in the $edit list (but not "@everyone").
 */
function getEditorsToNotify(entityId: number, ownerId: string | null, facts: string[]): string[] {
  const editors = new Set<string>();

  if (ownerId) {
    editors.add(ownerId);
  }

  const permissions = parsePermissionDirectives(facts, configToPermissionDefaults(getEntityConfig(entityId)));
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

bot.events.messageUpdate = async (message) => {
  // Ignore own messages and messages with no content (embed-only updates)
  if (botUserId && message.author?.id === botUserId) return;
  if (!message.content) return;

  const discordMessageId = message.id.toString();

  // Skip own webhook messages
  if (isOwnWebhookMessage(discordMessageId)) return;

  const updated = updateMessageByDiscordId(discordMessageId, message.content);
  if (updated) {
    debug("Message updated", { messageId: discordMessageId, content: message.content.slice(0, 50) });
  }
};

bot.events.messageDelete = async (payload) => {
  const discordMessageId = payload.id.toString();
  const deleted = deleteMessageByDiscordId(discordMessageId);
  if (deleted) {
    debug("Message deleted from history", { messageId: discordMessageId });
  }
};

bot.events.interactionCreate = async (interaction) => {
  await handleInteraction(bot, interaction);
};

export async function startBot() {
  info("Starting bot");
  await bot.start();
}
