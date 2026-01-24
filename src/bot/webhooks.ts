import { getDb } from "../db";
import { getEntity, type CharacterData } from "../db/entities";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBot = any;

export interface CharacterWebhook {
  id: number;
  channelId: string;
  characterId: number;
  webhookId: string;
  webhookToken: string;
  createdAt: number;
}

/** Get cached webhook for a character in a channel */
export function getCachedWebhook(
  channelId: string,
  characterId: number
): CharacterWebhook | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, channel_id, character_id, webhook_id, webhook_token, created_at
    FROM character_webhooks
    WHERE channel_id = ? AND character_id = ?
  `);

  const row = stmt.get(channelId, characterId) as {
    id: number;
    channel_id: string;
    character_id: number;
    webhook_id: string;
    webhook_token: string;
    created_at: number;
  } | null;

  if (!row) return null;

  return {
    id: row.id,
    channelId: row.channel_id,
    characterId: row.character_id,
    webhookId: row.webhook_id,
    webhookToken: row.webhook_token,
    createdAt: row.created_at,
  };
}

/** Cache a webhook for a character */
export function cacheWebhook(
  channelId: string,
  characterId: number,
  webhookId: string,
  webhookToken: string
): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO character_webhooks (channel_id, character_id, webhook_id, webhook_token)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(channelId, characterId, webhookId, webhookToken);
}

/** Delete cached webhook */
export function deleteCachedWebhook(channelId: string, characterId: number): void {
  const db = getDb();
  const stmt = db.prepare(`
    DELETE FROM character_webhooks WHERE channel_id = ? AND character_id = ?
  `);
  stmt.run(channelId, characterId);
}

/** Get or create a webhook for a character in a channel */
export async function getOrCreateWebhook(
  bot: AnyBot,
  channelId: string,
  characterId: number
): Promise<{ webhookId: string; webhookToken: string } | null> {
  // Check cache first
  const cached = getCachedWebhook(channelId, characterId);
  if (cached) {
    // Verify webhook still exists
    try {
      await bot.helpers.getWebhook(BigInt(cached.webhookId));
      return { webhookId: cached.webhookId, webhookToken: cached.webhookToken };
    } catch {
      // Webhook was deleted, remove from cache
      deleteCachedWebhook(channelId, characterId);
    }
  }

  // Get character for webhook name
  const character = getEntity<CharacterData>(characterId);
  if (!character) return null;

  // Create new webhook
  try {
    const webhook = await bot.helpers.createWebhook(BigInt(channelId), {
      name: character.name,
      // Avatar could be added here if character has one
    });

    const webhookId = webhook.id.toString();
    const webhookToken = webhook.token;

    // Cache it
    cacheWebhook(channelId, characterId, webhookId, webhookToken);

    return { webhookId, webhookToken };
  } catch (error) {
    console.error("Failed to create webhook:", error);
    return null;
  }
}

/** Send a message as a character using webhook */
export async function sendAsCharacter(
  bot: AnyBot,
  channelId: string,
  characterId: number,
  content: string,
  options?: {
    avatarUrl?: string;
  }
): Promise<boolean> {
  const character = getEntity<CharacterData>(characterId);
  if (!character) return false;

  const webhook = await getOrCreateWebhook(bot, channelId, characterId);
  if (!webhook) return false;

  try {
    await bot.helpers.executeWebhook(BigInt(webhook.webhookId), webhook.webhookToken, {
      content,
      username: character.name,
      avatarUrl: options?.avatarUrl ?? (character.data.avatar as string | undefined),
    });
    return true;
  } catch (error) {
    console.error("Failed to send webhook message:", error);
    return false;
  }
}

/** Multi-character output modes */
export type MultiCharMode = "tagged" | "webhooks" | "narrator" | "auto";

/** Format multi-character output based on mode */
export function formatMultiCharOutput(
  responses: Array<{ characterId: number; characterName: string; content: string }>,
  mode: MultiCharMode
): string {
  if (mode === "narrator") {
    // Third-person narration style
    return responses
      .map((r) => `${r.characterName} ${r.content}`)
      .join("\n\n");
  }

  // Tagged mode (default fallback)
  return responses
    .map((r) => `**${r.characterName}:** ${r.content}`)
    .join("\n\n");
}

/** Send responses for multiple characters */
export async function sendMultiCharResponse(
  bot: AnyBot,
  channelId: string,
  responses: Array<{ characterId: number; characterName: string; content: string }>,
  mode: MultiCharMode
): Promise<void> {
  if (mode === "webhooks" || mode === "auto") {
    // Try webhooks first
    let allSucceeded = true;

    for (const response of responses) {
      const success = await sendAsCharacter(bot, channelId, response.characterId, response.content);
      if (!success) {
        allSucceeded = false;
        break;
      }
    }

    if (allSucceeded) return;

    // Fall through to tagged mode if webhooks failed
    if (mode === "webhooks") {
      console.warn("Webhooks failed, but mode is set to webhooks - some messages may not have sent");
      return;
    }
  }

  // Tagged or narrator mode - send as single message
  const formattedContent = formatMultiCharOutput(responses, mode === "narrator" ? "narrator" : "tagged");

  try {
    await bot.helpers.sendMessage(BigInt(channelId), {
      content: formattedContent,
    });
  } catch (error) {
    console.error("Failed to send multi-char response:", error);
  }
}

/** Check if webhooks are available in a channel */
export async function canUseWebhooks(
  bot: AnyBot,
  channelId: string,
  guildId?: string
): Promise<boolean> {
  // Webhooks don't work in DMs
  if (!guildId) return false;

  try {
    // Try to get channel - if we can access it, check permissions
    const channel = await bot.helpers.getChannel(BigInt(channelId));
    if (!channel) return false;

    // Check if it's a DM channel type
    if (channel.type === 1 || channel.type === 3) return false; // DM or Group DM

    // Could add permission check here, but createWebhook will fail anyway if no perms
    return true;
  } catch {
    return false;
  }
}

/** Clean up old/unused webhooks for a channel */
export async function cleanupWebhooks(
  bot: AnyBot,
  channelId: string
): Promise<number> {
  const db = getDb();

  // Get all cached webhooks for this channel
  const stmt = db.prepare(`
    SELECT webhook_id, character_id FROM character_webhooks WHERE channel_id = ?
  `);
  const cached = stmt.all(channelId) as Array<{ webhook_id: string; character_id: number }>;

  let deleted = 0;

  for (const entry of cached) {
    try {
      // Try to delete the webhook
      await bot.helpers.deleteWebhook(BigInt(entry.webhook_id));
      deleteCachedWebhook(channelId, entry.character_id);
      deleted++;
    } catch {
      // Webhook might already be deleted
      deleteCachedWebhook(channelId, entry.character_id);
      deleted++;
    }
  }

  return deleted;
}
