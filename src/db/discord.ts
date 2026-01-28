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
 */
export function resolveDiscordEntities(
  discordId: string,
  discordType: DiscordType,
  guildId?: string,
  channelId?: string
): number[] {
  const db = getDb();

  // Try channel-scoped first (returns ALL channel-scoped entities)
  if (channelId) {
    const channelScoped = db.prepare(`
      SELECT entity_id FROM discord_entities
      WHERE discord_id = ? AND discord_type = ? AND scope_channel_id = ?
    `).all(discordId, discordType, channelId) as { entity_id: number }[];
    if (channelScoped.length > 0) {
      return channelScoped.map(r => r.entity_id);
    }
  }

  // Try guild-scoped (returns ALL guild-scoped entities)
  if (guildId) {
    const guildScoped = db.prepare(`
      SELECT entity_id FROM discord_entities
      WHERE discord_id = ? AND discord_type = ? AND scope_guild_id = ? AND scope_channel_id IS NULL
    `).all(discordId, discordType, guildId) as { entity_id: number }[];
    if (guildScoped.length > 0) {
      return guildScoped.map(r => r.entity_id);
    }
  }

  // Try global (returns ALL global entities)
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
 * Get channel-scoped entities directly (bypassing precedence).
 */
export function getChannelScopedEntities(channelId: string): number[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT entity_id FROM discord_entities
    WHERE discord_id = ? AND discord_type = 'channel' AND scope_channel_id = ?
  `).all(channelId, channelId) as { entity_id: number }[];
  return rows.map(r => r.entity_id);
}

/**
 * Get guild-scoped entities directly (bypassing precedence).
 */
export function getGuildScopedEntities(guildId: string): number[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT entity_id FROM discord_entities
    WHERE discord_id = ? AND discord_type = 'channel' AND scope_guild_id = ? AND scope_channel_id IS NULL
  `).all(guildId, guildId) as { entity_id: number }[];
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
// Message History
// =============================================================================

export interface Message {
  id: number;
  channel_id: string;
  author_id: string;
  author_name: string;
  content: string;
  created_at: string;
}

export function addMessage(
  channelId: string,
  authorId: string,
  authorName: string,
  content: string
): Message {
  const db = getDb();
  return db.prepare(`
    INSERT INTO messages (channel_id, author_id, author_name, content)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `).get(channelId, authorId, authorName, content) as Message;
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

export function clearMessages(channelId: string): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM messages WHERE channel_id = ?`).run(channelId);
  return result.changes;
}

// =============================================================================
// Channel Forget Time
// =============================================================================

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

