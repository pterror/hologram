/**
 * Images Plugin
 *
 * Handles image generation from LLM responses:
 * - Parses [IMAGE: prompt] markers from responses
 * - Queues image generation asynchronously
 * - Stores results and can edit messages to add embeds
 */

import type { Plugin, Extractor } from "../types";
import type { QuotaConfig } from "../../config/types";
import { features } from "../../config";
import {
  generateImage,
  createImageContext,
  isImageGenerationAvailable,
  DiscordStorage,
} from "../../images";
import { getDb } from "../../db";
import { debug, error, warn } from "../../logger";
import {
  enforceQuota,
  logUsage,
  calculateImageCost,
  QuotaExceededError,
} from "../../quota";

// =============================================================================
// Marker Parsing
// =============================================================================

interface ImageMarker {
  prompt: string;
  type?: "portrait" | "scene" | "custom";
  character?: string;
}

/**
 * Parse [IMAGE: prompt] markers from text
 * Supports formats:
 * - [IMAGE: a beautiful sunset]
 * - [PORTRAIT: character name]
 * - [SCENE: the village square at dawn]
 */
function parseImageMarkers(text: string): ImageMarker[] {
  const markers: ImageMarker[] = [];

  // [IMAGE: prompt]
  const imageRegex = /\[IMAGE:\s*([^\]]+)\]/gi;
  let match;
  while ((match = imageRegex.exec(text)) !== null) {
    markers.push({
      prompt: match[1].trim(),
      type: "custom",
    });
  }

  // [PORTRAIT: character or prompt]
  const portraitRegex = /\[PORTRAIT:\s*([^\]]+)\]/gi;
  while ((match = portraitRegex.exec(text)) !== null) {
    markers.push({
      prompt: match[1].trim(),
      type: "portrait",
    });
  }

  // [SCENE: prompt]
  const sceneRegex = /\[SCENE:\s*([^\]]+)\]/gi;
  while ((match = sceneRegex.exec(text)) !== null) {
    markers.push({
      prompt: match[1].trim(),
      type: "scene",
    });
  }

  return markers;
}

/**
 * Remove image markers from text (for clean display)
 */
export function stripImageMarkers(text: string): string {
  return text
    .replace(/\[IMAGE:\s*[^\]]+\]/gi, "")
    .replace(/\[PORTRAIT:\s*[^\]]+\]/gi, "")
    .replace(/\[SCENE:\s*[^\]]+\]/gi, "")
    .replace(/\n{3,}/g, "\n\n") // Clean up extra newlines
    .trim();
}

// =============================================================================
// Extractors
// =============================================================================

/** Parse and queue image generation from LLM response markers */
const imageMarkerExtractor: Extractor = {
  name: "images:markers",
  shouldRun: (ctx) =>
    ctx.response !== null &&
    ctx.scene !== null &&
    ctx.config !== null &&
    features.images(ctx.config) &&
    features.imageLLMMarkers(ctx.config),
  fn: async (ctx) => {
    if (!ctx.response || !ctx.scene || !ctx.config) return;

    const markers = parseImageMarkers(ctx.response);
    if (markers.length === 0) return;

    debug(`Found ${markers.length} image markers in response`);

    // Check if image generation is available
    if (!isImageGenerationAvailable(ctx.config.images)) {
      warn("Image markers found but image generation is not configured");
      return;
    }

    const imageCtx = createImageContext(ctx.config.images, {
      userId: ctx.authorId,
      guildId: ctx.guildId,
    });
    if (!imageCtx) {
      warn("Failed to create image context");
      return;
    }

    const db = getDb();

    // Process each marker (fire-and-forget, don't block response)
    for (const marker of markers) {
      generateImageFromMarker(marker, ctx.scene.worldId, imageCtx, db, {
        userId: ctx.authorId,
        guildId: ctx.guildId,
        quotaConfig: ctx.config.quota,
      }).catch((err) => {
        error("Failed to generate image from marker", err);
      });
    }
  },
};

interface UserContext {
  userId: string;
  guildId?: string;
  quotaConfig?: QuotaConfig;
}

/**
 * Generate image from a parsed marker
 * This runs asynchronously after the response is sent
 */
async function generateImageFromMarker(
  marker: ImageMarker,
  worldId: number,
  imageCtx: NonNullable<ReturnType<typeof createImageContext>>,
  db: ReturnType<typeof getDb>,
  userCtx: UserContext
): Promise<void> {
  // Check quota before generating
  if (userCtx.quotaConfig?.enabled) {
    try {
      enforceQuota(userCtx.userId, userCtx.quotaConfig, "image", userCtx.guildId);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        warn(`Image quota exceeded for user ${userCtx.userId}: ${err.message}`);
        return; // Silently skip - user was already notified about quota on LLM if applicable
      }
      throw err;
    }
  }

  try {
    // Determine workflow based on marker type
    const workflow = marker.type === "scene" ? "scene" : "portrait";

    // Build variables based on marker type
    const variables: Record<string, unknown> = {
      prompt: marker.prompt,
    };

    // Generate the image
    const result = await generateImage(
      { workflow, variables },
      {
        enabled: true,
        host: "selfhosted", // Will be overridden by imageCtx.host
        defaultWidth: marker.type === "scene" ? 1344 : 1024,
        defaultHeight: marker.type === "scene" ? 768 : 1024,
        defaultWorkflow: workflow,
        allowLLMMarkers: true,
        storage: "discord",
      },
      imageCtx.storage,
      imageCtx.host
    );

    // Store in database
    db.prepare(
      `INSERT INTO generated_images (world_id, image_type, workflow_id, variables, url, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      worldId,
      marker.type || "custom",
      result.workflow,
      JSON.stringify(result.variables),
      result.url,
      result.width,
      result.height
    );

    // Log usage after successful generation
    if (userCtx.quotaConfig?.enabled) {
      const model = `comfyui:${result.workflow}`;
      logUsage({
        user_id: userCtx.userId,
        guild_id: userCtx.guildId,
        type: "image",
        model,
        cost_millicents: calculateImageCost(model),
      });
    }

    debug(`Generated image from marker: ${result.url}`);

    // If using Discord storage with pending URLs, the image data is available
    // to be attached to a follow-up message
    if (DiscordStorage.isPendingUrl(result.url)) {
      const parsed = DiscordStorage.parsePendingUrl(result.url);
      if (parsed && imageCtx.storage instanceof DiscordStorage) {
        const pending = imageCtx.storage.getPending(parsed.id);
        if (pending) {
          debug(`Image pending for Discord embed: ${parsed.filename}`);
          // The image data is now available for the delivery plugin to use
          // This would require coordination with the delivery system
        }
      }
    }
  } catch (err) {
    error("Image generation from marker failed", err);
  }
}

// =============================================================================
// Plugin Definition
// =============================================================================

export const imagePlugin: Plugin = {
  id: "images",
  name: "Image Generation",
  description: "Generate images from LLM response markers",
  dependencies: ["core"],

  extractors: [imageMarkerExtractor],
};

export default imagePlugin;
