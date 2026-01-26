/**
 * Delivery Plugin
 *
 * Handles response delivery:
 * - Multi-character response parsing
 * - Webhook segment creation
 * - Narration handling
 */

import type { Plugin, Middleware, PluginContext } from "../types";
import { MiddlewarePriority } from "../types";
import { parseMultiCharResponse, type MultiCharMode } from "../../bot/webhooks";
import { getEntity, type CharacterData } from "../../db/entities";
import { definePluginData } from "../registry";

// =============================================================================
// Types
// =============================================================================

/** Per-character segment of a multi-character response */
export interface CharacterSegment {
  characterId: number;
  characterName: string;
  content: string;
}

/** Delivery result stored in context */
export interface DeliveryResult {
  response: string;
  narration?: string;
  segments?: CharacterSegment[];
  multiCharMode?: MultiCharMode;
}

/** Type-safe accessor for delivery result */
const deliveryData = definePluginData<DeliveryResult>("delivery:result");

/** Get delivery result from context */
export function getDeliveryResult(ctx: PluginContext): DeliveryResult | undefined {
  return deliveryData.get(ctx);
}

// =============================================================================
// Middleware
// =============================================================================

/** Parse response and prepare for delivery */
const deliveryMiddleware: Middleware = {
  name: "delivery:prepare",
  priority: MiddlewarePriority.DELIVERY,
  fn: async (ctx, next) => {
    if (!ctx.response) {
      await next();
      return;
    }

    const result: DeliveryResult = {
      response: ctx.response,
    };

    // Combine narration parts
    if (ctx.narrationParts.length > 0) {
      result.narration = ctx.narrationParts.join("\n\n");
    }

    // Parse multi-character response for webhook delivery
    const multiCharMode = ctx.config?.multiCharMode;
    result.multiCharMode = multiCharMode;

    if (ctx.activeCharacterIds.length > 1) {
      // Build name→ID map for active characters
      const nameToId = new Map<string, number>();
      for (const charId of ctx.activeCharacterIds) {
        const charEntity = getEntity<CharacterData>(charId);
        if (charEntity) {
          nameToId.set(charEntity.name, charId);
        }
      }

      const parsed = parseMultiCharResponse(
        ctx.response,
        Array.from(nameToId.keys())
      );

      if (parsed) {
        result.segments = parsed.map((seg) => ({
          characterId: nameToId.get(seg.characterName) ?? ctx.activeCharacterIds[0],
          characterName: seg.characterName,
          content: seg.content,
        }));
      }
    } else if (ctx.activeCharacterIds.length === 1) {
      // Single character - create segment for webhook delivery
      const charEntity = getEntity<CharacterData>(ctx.activeCharacterIds[0]);
      if (charEntity) {
        result.segments = [
          {
            characterId: ctx.activeCharacterIds[0],
            characterName: charEntity.name,
            content: ctx.response,
          },
        ];
      }
    }

    // Store result for retrieval
    deliveryData.set(ctx, result);

    await next();
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const deliveryPlugin: Plugin = {
  id: "delivery",
  name: "Delivery",
  description: "Response parsing and delivery preparation",
  dependencies: ["core"],

  middleware: [deliveryMiddleware],
};

export default deliveryPlugin;
