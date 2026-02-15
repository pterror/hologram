import { getDb } from "./index";

// =============================================================================
// Discord Entity Mapping
// =============================================================================

export type DiscordType = "user" | "channel" | "guild";

export interface DiscordEntityMapping {
  id: number;
  discord_id: string;
  discord_type: DiscordType;
  scope_guild_id: string | null;
  scope_channel_id: string | null;
  entity_id: number;
}

/**
 * Add a Discord ID to entity binding (additive - allows multiple entities per channel).
 * Returns null if this exact binding already exists.
 */
export function addDiscordEntity(
  discordId: string,
  discordType: DiscordType,
  entityId: number,
  scopeGuildId?: string,
  scopeChannelId?: string
): DiscordEntityMapping | null {
  const db = getDb();
  try {
    return db.prepare(`
      INSERT INTO discord_entities (discord_id, discord_type, scope_guild_id, scope_channel_id, entity_id)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      discordId,
      discordType,
      scopeGuildId ?? null,
      scopeChannelId ?? null,
      entityId
    ) as DiscordEntityMapping;
  } catch {
    // UNIQUE constraint violation - binding already exists
    return null;
  }
}

/**
 * @deprecated Use addDiscordEntity for additive bindings
 */
export function setDiscordEntity(
  discordId: string,
  discordType: DiscordType,
  entityId: number,
  scopeGuildId?: string,
  scopeChannelId?: string
): DiscordEntityMapping | null {
  return addDiscordEntity(discordId, discordType, entityId, scopeGuildId, scopeChannelId);
}

/**
 * Resolve a Discord ID to ALL matching entities, respecting scope precedence.
 * Returns all entities at the most specific scope level that has bindings.
 *
 * Scope precedence only applies to 'user' bindings (channel > guild > global).
 * For 'channel' and 'guild' bindings, discord_id is the scope itself.
 */
export function resolveDiscordEntities(
  discordId: string,
  discordType: DiscordType,
  guildId?: string,
  channelId?: string
): number[] {
  const db = getDb();

  // For channel/guild bindings, discord_id IS the scope - no precedence needed
  if (discordType === "channel" || discordType === "guild") {
    const rows = db.prepare(`
      SELECT entity_id FROM discord_entities
      WHERE discord_id = ? AND discord_type = ?
    `).all(discordId, discordType) as { entity_id: number }[];
    return rows.map(r => r.entity_id);
  }

  // For user bindings, apply scope precedence (channel > guild > global)
  // Try channel-scoped first
  if (channelId) {
    const channelScoped = db.prepare(`
      SELECT entity_id FROM discord_entities
      WHERE discord_id = ? AND discord_type = ? AND scope_channel_id = ?
    `).all(discordId, discordType, channelId) as { entity_id: number }[];
    if (channelScoped.length > 0) {
      return channelScoped.map(r => r.entity_id);
    }
  }

  // Try guild-scoped
  if (guildId) {
    const guildScoped = db.prepare(`
      SELECT entity_id FROM discord_entities
      WHERE discord_id = ? AND discord_type = ? AND scope_guild_id = ? AND scope_channel_id IS NULL
    `).all(discordId, discordType, guildId) as { entity_id: number }[];
    if (guildScoped.length > 0) {
      return guildScoped.map(r => r.entity_id);
    }
  }

  // Try global
  const globalScoped = db.prepare(`
    SELECT entity_id FROM discord_entities
    WHERE discord_id = ? AND discord_type = ? AND scope_guild_id IS NULL AND scope_channel_id IS NULL
  `).all(discordId, discordType) as { entity_id: number }[];
  return globalScoped.map(r => r.entity_id);
}

/**
 * Resolve a Discord ID to a single entity (first match), respecting scope precedence.
 * Use resolveDiscordEntities for multi-entity support.
 */
export function resolveDiscordEntity(
  discordId: string,
  discordType: DiscordType,
  guildId?: string,
  channelId?: string
): number | null {
  const entities = resolveDiscordEntities(discordId, discordType, guildId, channelId);
  return entities[0] ?? null;
}

/**
 * Get channel-bound entities directly.
 * For channel bindings, discord_id is the channel ID itself, so no scope check needed.
 */
export function getChannelScopedEntities(channelId: string): number[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT entity_id FROM discord_entities
    WHERE discord_id = ? AND discord_type = 'channel'
  `).all(channelId) as { entity_id: number }[];
  return rows.map(r => r.entity_id);
}

/**
 * Get guild-scoped entities directly (bypassing precedence).
 * For guild bindings, discord_id is the guild ID itself, so no scope check needed.
 */
export function getGuildScopedEntities(guildId: string): number[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT entity_id FROM discord_entities
    WHERE discord_id = ? AND discord_type = 'guild'
  `).all(guildId) as { entity_id: number }[];
  return rows.map(r => r.entity_id);
}

/**
 * Remove a specific entity binding from a Discord ID.
 */
export function removeDiscordEntityBinding(
  discordId: string,
  discordType: DiscordType,
  entityId: number,
  scopeGuildId?: string,
  scopeChannelId?: string
): boolean {
  const db = getDb();

  let query = `DELETE FROM discord_entities WHERE discord_id = ? AND discord_type = ? AND entity_id = ?`;
  const params: (string | number | null)[] = [discordId, discordType, entityId];

  if (scopeChannelId) {
    query += ` AND scope_channel_id = ?`;
    params.push(scopeChannelId);
  } else {
    query += ` AND scope_channel_id IS NULL`;
  }

  if (scopeGuildId) {
    query += ` AND scope_guild_id = ?`;
    params.push(scopeGuildId);
  } else {
    query += ` AND scope_guild_id IS NULL`;
  }

  const result = db.prepare(query).run(...params);
  return result.changes > 0;
}

/**
 * Remove ALL entity bindings from a Discord ID at a specific scope.
 */
export function removeDiscordEntity(
  discordId: string,
  discordType: DiscordType,
  scopeGuildId?: string,
  scopeChannelId?: string
): boolean {
  const db = getDb();

  let query = `DELETE FROM discord_entities WHERE discord_id = ? AND discord_type = ?`;
  const params: (string | null)[] = [discordId, discordType];

  if (scopeChannelId) {
    query += ` AND scope_channel_id = ?`;
    params.push(scopeChannelId);
  } else {
    query += ` AND scope_channel_id IS NULL`;
  }

  if (scopeGuildId) {
    query += ` AND scope_guild_id = ?`;
    params.push(scopeGuildId);
  } else {
    query += ` AND scope_guild_id IS NULL`;
  }

  const result = db.prepare(query).run(...params);
  return result.changes > 0;
}

/**
 * List all mappings for a Discord ID.
 */
export function listDiscordMappings(
  discordId: string,
  discordType: DiscordType
): DiscordEntityMapping[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM discord_entities
    WHERE discord_id = ? AND discord_type = ?
  `).all(discordId, discordType) as DiscordEntityMapping[];
}

/**
 * Get entity IDs bound to a Discord ID, optionally filtered by scope.
 * If no scope is provided, returns all bound entities regardless of scope.
 */
export function getBoundEntityIds(
  discordId: string,
  discordType: DiscordType,
  scopeGuildId?: string,
  scopeChannelId?: string
): number[] {
  const db = getDb();

  // If specific scope requested, filter by it
  if (scopeChannelId !== undefined) {
    // Channel scope: exact match (including null for global)
    if (scopeChannelId === null) {
      // Global scope with no guild
      return (db.prepare(`
        SELECT entity_id FROM discord_entities
        WHERE discord_id = ? AND discord_type = ?
          AND scope_channel_id IS NULL AND scope_guild_id IS NULL
      `).all(discordId, discordType) as { entity_id: number }[]).map(r => r.entity_id);
    }
    return (db.prepare(`
      SELECT entity_id FROM discord_entities
      WHERE discord_id = ? AND discord_type = ? AND scope_channel_id = ?
    `).all(discordId, discordType, scopeChannelId) as { entity_id: number }[]).map(r => r.entity_id);
  }

  if (scopeGuildId !== undefined) {
    // Guild scope: guild set, no channel
    if (scopeGuildId === null) {
      // Global scope
      return (db.prepare(`
        SELECT entity_id FROM discord_entities
        WHERE discord_id = ? AND discord_type = ?
          AND scope_guild_id IS NULL AND scope_channel_id IS NULL
      `).all(discordId, discordType) as { entity_id: number }[]).map(r => r.entity_id);
    }
    return (db.prepare(`
      SELECT entity_id FROM discord_entities
      WHERE discord_id = ? AND discord_type = ?
        AND scope_guild_id = ? AND scope_channel_id IS NULL
    `).all(discordId, discordType, scopeGuildId) as { entity_id: number }[]).map(r => r.entity_id);
  }

  // No scope filter: return all bound entities for this target
  return (db.prepare(`
    SELECT entity_id FROM discord_entities
    WHERE discord_id = ? AND discord_type = ?
  `).all(discordId, discordType) as { entity_id: number }[]).map(r => r.entity_id);
}

// =============================================================================
// Discord Config (per-channel/guild bind permissions)
// =============================================================================

export interface DiscordConfig {
  discord_id: string;
  discord_type: "channel" | "guild";
  config_bind: string | null;
  config_persona: string | null;
  config_blacklist: string | null;
}

export interface ResolvedDiscordConfig {
  bind: string[] | null;
  persona: string[] | null;
  blacklist: string[] | null;
}

export function getDiscordConfig(discordId: string, discordType: "channel" | "guild"): DiscordConfig | null {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM discord_config WHERE discord_id = ? AND discord_type = ?
  `).get(discordId, discordType) as DiscordConfig | null;
}

export function setDiscordConfig(
  discordId: string,
  discordType: "channel" | "guild",
  config: { config_bind?: string | null; config_persona?: string | null; config_blacklist?: string | null }
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO discord_config (discord_id, discord_type, config_bind, config_persona, config_blacklist)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(discord_id, discord_type) DO UPDATE SET
      config_bind = excluded.config_bind,
      config_persona = excluded.config_persona,
      config_blacklist = excluded.config_blacklist
  `).run(
    discordId,
    discordType,
    config.config_bind ?? null,
    config.config_persona ?? null,
    config.config_blacklist ?? null,
  );
}

export function deleteDiscordConfig(discordId: string, discordType: "channel" | "guild"): boolean {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM discord_config WHERE discord_id = ? AND discord_type = ?
  `).run(discordId, discordType);
  return result.changes > 0;
}

/**
 * Resolve discord config with scope precedence: channel > guild > default.
 * Returns parsed allowlists. null = no restriction (everyone allowed).
 */
export function resolveDiscordConfig(channelId: string | undefined, guildId: string | undefined): ResolvedDiscordConfig {
  const defaultConfig: ResolvedDiscordConfig = { bind: null, persona: null, blacklist: null };

  // Try channel-scoped first
  if (channelId) {
    const channelConfig = getDiscordConfig(channelId, "channel");
    if (channelConfig) {
      return {
        bind: channelConfig.config_bind ? JSON.parse(channelConfig.config_bind) : null,
        persona: channelConfig.config_persona ? JSON.parse(channelConfig.config_persona) : null,
        blacklist: channelConfig.config_blacklist ? JSON.parse(channelConfig.config_blacklist) : null,
      };
    }
  }

  // Try guild-scoped
  if (guildId) {
    const guildConfig = getDiscordConfig(guildId, "guild");
    if (guildConfig) {
      return {
        bind: guildConfig.config_bind ? JSON.parse(guildConfig.config_bind) : null,
        persona: guildConfig.config_persona ? JSON.parse(guildConfig.config_persona) : null,
        blacklist: guildConfig.config_blacklist ? JSON.parse(guildConfig.config_blacklist) : null,
      };
    }
  }

  return defaultConfig;
}

// =============================================================================
// Message History
// =============================================================================

export interface Message {
  id: number;
  channel_id: string;
  author_id: string;
  author_name: string;
  content: string;
  discord_message_id: string | null;
  data: string | null;
  created_at: string;
}

export interface StickerData {
  id: string;          // bigint → string for JSON
  name: string;
  format_type: number; // StickerFormatTypes enum value (1=PNG, 2=APNG, 3=Lottie, 4=GIF)
}

export interface EmbedFooterData {
  text: string;
  icon_url?: string;
}

export interface EmbedImageData {
  url: string;
  height?: number;
  width?: number;
}

export interface EmbedVideoData {
  url?: string;
  height?: number;
  width?: number;
}

export interface EmbedProviderData {
  name?: string;
  url?: string;
}

export interface EmbedAuthorData {
  name: string;
  url?: string;
  icon_url?: string;
}

export interface EmbedFieldData {
  name: string;
  value: string;
  inline?: boolean;
}

export interface EmbedData {
  title?: string;
  type?: string;
  description?: string;
  url?: string;
  timestamp?: number;
  color?: number;
  footer?: EmbedFooterData;
  image?: EmbedImageData;
  thumbnail?: EmbedImageData;
  video?: EmbedVideoData;
  provider?: EmbedProviderData;
  author?: EmbedAuthorData;
  fields?: EmbedFieldData[];
}

export interface AttachmentData {
  filename: string;
  url: string;
  content_type?: string;
  title?: string;
  description?: string;
  size?: number;
  height?: number;
  width?: number;
  ephemeral?: boolean;
  duration_secs?: number;
}

export interface MessageData {
  is_bot?: boolean;
  is_forward?: boolean;
  embeds?: EmbedData[];
  stickers?: StickerData[];
  attachments?: AttachmentData[];
}

export function parseMessageData(raw: string | null): MessageData | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as MessageData; }
  catch { return null; }
}

export function addMessage(
  channelId: string,
  authorId: string,
  authorName: string,
  content: string,
  discordMessageId?: string,
  data?: MessageData
): Message {
  const db = getDb();
  return db.prepare(`
    INSERT INTO messages (channel_id, author_id, author_name, content, discord_message_id, data)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(channelId, authorId, authorName, content, discordMessageId ?? null, data ? JSON.stringify(data) : null) as Message;
}

export function updateMessageByDiscordId(
  discordMessageId: string,
  newContent: string,
  newData?: MessageData
): boolean {
  const db = getDb();
  if (newData) {
    // Merge new data with existing data (preserves fields not in newData)
    const existing = db.prepare(`
      SELECT data FROM messages WHERE discord_message_id = ?
    `).get(discordMessageId) as { data: string | null } | undefined;
    const existingData = existing?.data ? parseMessageData(existing.data) : {};
    const mergedData = { ...existingData, ...newData };
    const result = db.prepare(`
      UPDATE messages SET content = ?, data = ? WHERE discord_message_id = ?
    `).run(newContent, JSON.stringify(mergedData), discordMessageId);
    return result.changes > 0;
  }
  const result = db.prepare(`
    UPDATE messages SET content = ? WHERE discord_message_id = ?
  `).run(newContent, discordMessageId);
  return result.changes > 0;
}

/**
 * Merge new data into an existing message without touching content.
 * Used for embed-only MESSAGE_UPDATE events where content is unchanged.
 */
export function mergeMessageData(
  discordMessageId: string,
  newData: MessageData
): boolean {
  const db = getDb();
  const existing = db.prepare(`
    SELECT data FROM messages WHERE discord_message_id = ?
  `).get(discordMessageId) as { data: string | null } | undefined;
  if (!existing) return false;
  const existingData = existing.data ? parseMessageData(existing.data) : {};
  const mergedData = { ...existingData, ...newData };
  const result = db.prepare(`
    UPDATE messages SET data = ? WHERE discord_message_id = ?
  `).run(JSON.stringify(mergedData), discordMessageId);
  return result.changes > 0;
}

export function deleteMessageByDiscordId(discordMessageId: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM messages WHERE discord_message_id = ?
  `).run(discordMessageId);
  return result.changes > 0;
}

export function getMessages(channelId: string, limit = 50): Message[] {
  const db = getDb();
  const forgetTime = getChannelForgetTime(channelId);

  if (forgetTime) {
    return db.prepare(`
      SELECT * FROM messages
      WHERE channel_id = ? AND created_at > ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(channelId, forgetTime, limit) as Message[];
  }

  return db.prepare(`
    SELECT * FROM messages
    WHERE channel_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(channelId, limit) as Message[];
}

/**
 * Get filtered messages from a channel.
 * @param filter - "$char" for webhook/entity messages, "$user" for non-webhook messages,
 *   or any other string for case-insensitive author name match.
 *
 * Webhook detection is reliable here: all entity messages in the messages table
 * arrived via webhook (and have webhook_messages entries). Bot fallback messages
 * (sent when webhooks fail) are sent as the bot user and never enter the messages table.
 */
export function getFilteredMessages(
  channelId: string,
  limit: number,
  filter: string
): Message[] {
  const db = getDb();
  const forgetTime = getChannelForgetTime(channelId);

  const timeClause = forgetTime ? ` AND m.created_at > ?` : "";
  const timeParams = forgetTime ? [forgetTime] : [];

  if (filter === "$char") {
    // Only messages that have a corresponding webhook_messages entry
    return db.prepare(`
      SELECT m.* FROM messages m
      INNER JOIN webhook_messages wm ON wm.message_id = m.discord_message_id
      WHERE m.channel_id = ?${timeClause}
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(channelId, ...timeParams, limit) as Message[];
  }

  if (filter === "$user") {
    // Non-entity, non-bot messages
    return db.prepare(`
      SELECT m.* FROM messages m
      LEFT JOIN webhook_messages wm ON wm.message_id = m.discord_message_id
      WHERE m.channel_id = ? AND wm.message_id IS NULL
        AND COALESCE(json_extract(m.data, '$.is_bot'), 0) = 0${timeClause}
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(channelId, ...timeParams, limit) as Message[];
  }

  if (filter === "$bot") {
    // Bot messages that aren't our entities
    return db.prepare(`
      SELECT m.* FROM messages m
      LEFT JOIN webhook_messages wm ON wm.message_id = m.discord_message_id
      WHERE m.channel_id = ? AND wm.message_id IS NULL
        AND json_extract(m.data, '$.is_bot') = 1${timeClause}
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(channelId, ...timeParams, limit) as Message[];
  }

  // Filter by author name (case-insensitive)
  return db.prepare(`
    SELECT * FROM messages
    WHERE channel_id = ? AND author_name = ? COLLATE NOCASE${timeClause}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(channelId, filter, ...timeParams, limit) as Message[];
}

export function clearMessages(channelId: string): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM messages WHERE channel_id = ?`).run(channelId);
  return result.changes;
}

// =============================================================================
// Channel Forget Time
// =============================================================================

/**
 * Count messages in a channel since the given entity's last reply.
 * Uses webhook_messages to identify which messages belong to the entity.
 * Returns Infinity if the entity has never replied in the channel.
 */
export function countUnreadMessages(channelId: string, entityId: number): number {
  const db = getDb();
  const forgetTime = getChannelForgetTime(channelId);

  const timeClause = forgetTime ? ` AND m.created_at > ?` : "";
  const timeParams = forgetTime ? [forgetTime] : [];

  const row = db.prepare(`
    SELECT COUNT(*) as count FROM messages m
    WHERE m.channel_id = ?${timeClause}
      AND m.created_at > COALESCE(
        (SELECT MAX(m2.created_at)
         FROM messages m2
         JOIN webhook_messages wm ON wm.message_id = m2.discord_message_id
         WHERE m2.channel_id = ? AND wm.entity_id = ?),
        ''
      )
  `).get(channelId, ...timeParams, channelId, entityId) as { count: number };

  // If entity has never replied, COALESCE produces '' which is < all timestamps,
  // so count includes all messages — but we want Infinity for "never replied"
  const hasReplied = db.prepare(`
    SELECT 1 FROM messages m
    JOIN webhook_messages wm ON wm.message_id = m.discord_message_id
    WHERE m.channel_id = ? AND wm.entity_id = ?
    LIMIT 1
  `).get(channelId, entityId);

  return hasReplied ? row.count : Infinity;
}

/**
 * Get the forget timestamp for a channel.
 * Messages before this time are excluded from context.
 */
export function getChannelForgetTime(channelId: string): string | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT forget_at FROM channel_forgets WHERE channel_id = ?
  `).get(channelId) as { forget_at: string } | null;
  return row?.forget_at ?? null;
}

/**
 * Set the forget timestamp for a channel to now.
 * Returns the timestamp that was set.
 */
export function setChannelForgetTime(channelId: string): string {
  const db = getDb();
  // Use SQLite's CURRENT_TIMESTAMP format to match messages table
  // (ISO format "2024-01-15T10:30:45Z" doesn't compare correctly with "2024-01-15 10:30:45")
  const row = db.prepare(`
    INSERT INTO channel_forgets (channel_id, forget_at)
    VALUES (?, CURRENT_TIMESTAMP)
    ON CONFLICT(channel_id) DO UPDATE SET forget_at = CURRENT_TIMESTAMP
    RETURNING forget_at
  `).get(channelId) as { forget_at: string };
  return row.forget_at;
}

/**
 * Clear the forget timestamp for a channel.
 * Returns true if a timestamp was cleared.
 */
export function clearChannelForgetTime(channelId: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM channel_forgets WHERE channel_id = ?`).run(channelId);
  return result.changes > 0;
}

// =============================================================================
// Context Building
// =============================================================================

/**
 * Format messages for context.
 * Format string: %a = author, %m = message (default: "%a: %m")
 */
export function formatMessagesForContext(messages: Message[], format = "%a: %m"): string {
  // Messages come in DESC order, reverse for chronological
  return messages
    .slice()
    .reverse()
    .map(m => format.replace(/%[am]/g, c => c === "%a" ? m.author_name : m.content))
    .join("\n");
}

// =============================================================================
// User Onboarding Tracking
// =============================================================================

export function isNewUser(userId: string): boolean {
  const db = getDb();

  // Check if already welcomed
  const welcomed = db.prepare(`
    SELECT 1 FROM welcomed_users WHERE discord_id = ? LIMIT 1
  `).get(userId);
  if (welcomed) return false;

  // Check if user has any entity mappings (existing user)
  const hasMapping = db.prepare(`
    SELECT 1 FROM discord_entities WHERE discord_id = ? AND discord_type = 'user' LIMIT 1
  `).get(userId);

  return !hasMapping;
}

export function markUserWelcomed(userId: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO welcomed_users (discord_id) VALUES (?)
  `).run(userId);
}

// =============================================================================
// Webhook Identity
// =============================================================================

/**
 * Check if a Discord user ID belongs to one of our webhooks.
 * Used to detect when a user @-mentions a webhook entity (e.g., reply with @ping ON).
 */
export function isOurWebhookUserId(userId: string): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT 1 FROM webhooks WHERE webhook_id = ? LIMIT 1`).get(userId);
  return !!row;
}

// =============================================================================
// Webhook Message Tracking (for reply detection)
// =============================================================================

export interface WebhookMessageInfo {
  entityId: number;
  entityName: string;
}

/**
 * Track a webhook message for reply detection.
 */
export function trackWebhookMessage(
  messageId: string,
  entityId: number,
  entityName: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO webhook_messages (message_id, entity_id, entity_name)
    VALUES (?, ?, ?)
  `).run(messageId, entityId, entityName);
}

/**
 * Look up entity info for a webhook message.
 */
export function getWebhookMessageEntity(messageId: string): WebhookMessageInfo | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT entity_id, entity_name FROM webhook_messages WHERE message_id = ?
  `).get(messageId) as { entity_id: number; entity_name: string } | null;

  if (!row) return null;
  return { entityId: row.entity_id, entityName: row.entity_name };
}

// =============================================================================
// Evaluation Error Tracking (for DM notifications)
// =============================================================================

export interface EvalError {
  id: number;
  entity_id: number;
  owner_id: string;
  error_message: string;
  condition: string | null;
  notified_at: string | null;
  created_at: string;
}

/**
 * Record an evaluation error for an entity.
 * Returns true if this is a new error (not seen before), false if duplicate.
 */
export function recordEvalError(
  entityId: number,
  ownerId: string,
  errorMessage: string,
  condition?: string
): boolean {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO eval_errors (entity_id, owner_id, error_message, condition)
      VALUES (?, ?, ?, ?)
    `).run(entityId, ownerId, errorMessage, condition ?? null);
    return true;
  } catch {
    // UNIQUE constraint violation - error already recorded
    return false;
  }
}

/**
 * Get unnotified errors for an owner.
 */
export function getUnnotifiedErrors(ownerId: string): EvalError[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM eval_errors
    WHERE owner_id = ? AND notified_at IS NULL
    ORDER BY created_at DESC
  `).all(ownerId) as EvalError[];
}

/**
 * Mark errors as notified.
 */
export function markErrorsNotified(errorIds: number[]): void {
  if (errorIds.length === 0) return;
  const db = getDb();
  const placeholders = errorIds.map(() => "?").join(",");
  db.prepare(`
    UPDATE eval_errors SET notified_at = CURRENT_TIMESTAMP
    WHERE id IN (${placeholders})
  `).run(...errorIds);
}

/**
 * Clear all errors for an entity (e.g., when facts are edited).
 */
export function clearEntityErrors(entityId: number): void {
  const db = getDb();
  db.prepare(`DELETE FROM eval_errors WHERE entity_id = ?`).run(entityId);
}

