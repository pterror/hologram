import { getDb } from "../db";
import { debug, error } from "../logger";

interface CachedWebhook {
  webhookId: string;
  webhookToken: string;
}

// In-memory cache for hot path
const webhookCache = new Map<string, CachedWebhook>();

// Default avatar when entity doesn't have $avatar
const DEFAULT_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

// Bot instance set by client.ts to avoid circular import
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let bot: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setBot(b: any): void {
  bot = b;
}

/**
 * Get or create a webhook for a channel.
 * Returns null if webhook creation fails (permissions, etc.)
 */
export async function getOrCreateWebhook(channelId: string): Promise<CachedWebhook | null> {
  if (!bot) {
    error("Bot not initialized for webhooks");
    return null;
  }
  // Check memory cache first
  const cached = webhookCache.get(channelId);
  if (cached) {
    debug("Using cached webhook", { channelId, webhookId: cached.webhookId });
    return cached;
  }

  // Check database
  const db = getDb();
  const row = db.prepare(`
    SELECT webhook_id, webhook_token FROM webhooks WHERE channel_id = ?
  `).get(channelId) as { webhook_id: string; webhook_token: string } | null;

  if (row) {
    const webhook = { webhookId: row.webhook_id, webhookToken: row.webhook_token };
    webhookCache.set(channelId, webhook);
    return webhook;
  }

  // Create new webhook
  try {
    // Check if we can find an existing Hologram webhook
    const existingWebhooks = await bot.helpers.getChannelWebhooks(BigInt(channelId));
    const ours = existingWebhooks.find((w: { name?: string }) => w.name === "Hologram");

    if (ours && ours.token) {
      const webhook = { webhookId: ours.id.toString(), webhookToken: ours.token };
      db.prepare(`
        INSERT INTO webhooks (channel_id, webhook_id, webhook_token)
        VALUES (?, ?, ?)
      `).run(channelId, webhook.webhookId, webhook.webhookToken);
      webhookCache.set(channelId, webhook);
      debug("Found existing webhook", { channelId, webhookId: webhook.webhookId });
      return webhook;
    }

    // Create new webhook
    const created = await bot.helpers.createWebhook(BigInt(channelId), {
      name: "Hologram",
    });

    if (!created.token) {
      error("Webhook created without token", { channelId });
      return null;
    }

    const webhook = { webhookId: created.id.toString(), webhookToken: created.token };
    db.prepare(`
      INSERT INTO webhooks (channel_id, webhook_id, webhook_token)
      VALUES (?, ?, ?)
    `).run(channelId, webhook.webhookId, webhook.webhookToken);
    webhookCache.set(channelId, webhook);

    debug("Created webhook", { channelId, webhookId: webhook.webhookId });
    return webhook;
  } catch (err: unknown) {
    const allProps: Record<string, unknown> = {};
    if (err && typeof err === "object") {
      for (const key of Object.getOwnPropertyNames(err)) {
        allProps[key] = (err as Record<string, unknown>)[key];
      }
    }
    error("Failed to create webhook", err, { errorProps: allProps, channelId });
    return null;
  }
}

// Discord's max message length
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Sanitize username for Discord webhook.
 * Discord forbids "discord" (case-insensitive) in webhook usernames.
 */
function sanitizeUsername(username: string): string {
  // Replace "discord" with "d_scord" (case-insensitive, preserving case)
  return username.replace(/discord/gi, (match) => {
    // Preserve the case pattern: replace 'i' with '_'
    return match[0] + "_" + match.slice(2);
  });
}

/**
 * Split content into chunks that fit Discord's message limit.
 * Tries to split at newlines or spaces when possible.
 */
function splitContent(content: string): string[] {
  if (content.length <= MAX_MESSAGE_LENGTH) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (newline or space)
    let splitAt = MAX_MESSAGE_LENGTH;
    const lastNewline = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    const lastSpace = remaining.lastIndexOf(" ", MAX_MESSAGE_LENGTH);

    if (lastNewline > MAX_MESSAGE_LENGTH * 0.5) {
      splitAt = lastNewline + 1; // Include the newline in current chunk
    } else if (lastSpace > MAX_MESSAGE_LENGTH * 0.5) {
      splitAt = lastSpace + 1; // Include the space in current chunk
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Execute webhook with custom username and avatar.
 * Returns array of sent message IDs on success, null on failure.
 * Automatically splits long messages into multiple webhook calls.
 */
export async function executeWebhook(
  channelId: string,
  content: string,
  username: string,
  avatarUrl?: string
): Promise<string[] | null> {
  if (!bot) {
    error("Bot not initialized for webhooks");
    return null;
  }

  const webhook = await getOrCreateWebhook(channelId);
  if (!webhook) return null;

  // Sanitize username (Discord forbids "discord" in webhook usernames)
  const safeUsername = sanitizeUsername(username);

  // Split content if too long
  const chunks = splitContent(content);

  debug("Executing webhook", {
    webhookId: webhook.webhookId,
    username: safeUsername,
    contentLength: content.length,
    chunks: chunks.length,
    hasAvatar: !!avatarUrl,
    avatarUrl: avatarUrl ?? DEFAULT_AVATAR,
    contentPreview: content.slice(0, 100) + (content.length > 100 ? "..." : ""),
  });

  try {
    const messageIds: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const result = await bot!.helpers.executeWebhook(
        BigInt(webhook.webhookId),
        webhook.webhookToken,
        {
          content: chunk,
          username: safeUsername,
          avatarUrl: avatarUrl ?? DEFAULT_AVATAR,
          wait: true,
        }
      );
      if (result?.id) {
        messageIds.push(result.id.toString());
      }
      debug("Webhook chunk sent", { chunk: i + 1, of: chunks.length, messageId: result?.id?.toString() });
    }
    debug("Webhook executed successfully", { messageIds });
    return messageIds;
  } catch (err: unknown) {
    // Try to extract all properties from the error
    const allProps: Record<string, unknown> = {};
    if (err && typeof err === "object") {
      for (const key of Object.getOwnPropertyNames(err)) {
        allProps[key] = (err as Record<string, unknown>)[key];
      }
    }
    error("Failed to execute webhook", err, {
      errorProps: allProps,
      webhookId: webhook.webhookId,
      username: safeUsername,
      contentLength: content.length,
    });
    // Webhook may have been deleted - clear cache and try once more
    webhookCache.delete(channelId);
    const db = getDb();
    db.prepare(`DELETE FROM webhooks WHERE channel_id = ?`).run(channelId);
    return null;
  }
}

/**
 * Clear webhook cache entry (e.g., when webhook is deleted externally).
 */
export function clearWebhookCache(channelId: string): void {
  webhookCache.delete(channelId);
  const db = getDb();
  db.prepare(`DELETE FROM webhooks WHERE channel_id = ?`).run(channelId);
}
