import { getDb } from "../db";
import { debug, error } from "../logger";

interface CachedWebhook {
  webhookId: string;
  webhookToken: string;
}

// In-memory cache for hot path
const webhookCache = new Map<string, CachedWebhook>();

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
  } catch (err) {
    error("Failed to create webhook", err);
    return null;
  }
}

/**
 * Execute webhook with custom username and avatar.
 * Returns true on success, false on failure.
 */
export async function executeWebhook(
  channelId: string,
  content: string,
  username: string,
  avatarUrl?: string
): Promise<boolean> {
  if (!bot) {
    error("Bot not initialized for webhooks");
    return false;
  }

  const webhook = await getOrCreateWebhook(channelId);
  if (!webhook) return false;

  try {
    debug("Executing webhook", {
      webhookId: webhook.webhookId,
      username,
      contentLength: content.length,
      hasAvatar: !!avatarUrl,
    });
    await bot!.helpers.executeWebhook(
      BigInt(webhook.webhookId),
      webhook.webhookToken,
      {
        content,
        username,
        avatarUrl,
        wait: true, // Wait for confirmation to get better error messages
      }
    );
    debug("Webhook executed successfully");
    return true;
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
      username,
      contentLength: content.length,
    });
    // Webhook may have been deleted - clear cache and try once more
    webhookCache.delete(channelId);
    const db = getDb();
    db.prepare(`DELETE FROM webhooks WHERE channel_id = ?`).run(channelId);
    return false;
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
