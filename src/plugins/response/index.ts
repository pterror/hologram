/**
 * Response Gate - Determines which characters should respond to a message
 *
 * Modes:
 * - always: Respond to every message in enabled channel
 * - mention: Only when @mentioned
 * - trigger: Only when trigger phrase matches
 * - chance: Random probability per message
 * - llm: LLM decides if character would speak up
 * - combined: Triggers/mention always work, plus chance/llm fallback
 */

import type { ResponseMode, ResponseConfig } from "../../config/types";
import type { CharacterData, Entity } from "../../db/entities";

export interface ResponseDecision {
  shouldRespond: boolean;
  respondingCharacters: number[]; // Character IDs that should respond
  reason: string;
}

export interface ResponseContext {
  message: string;
  authorName: string;
  isBotMentioned: boolean;
  channelEnabled: boolean;
  config: ResponseConfig;
  characters: Array<Entity<CharacterData>>;
  hasPersona: boolean; // Whether the user has set a persona
}

/**
 * Check if a message matches any trigger phrases for a character
 */
export function matchesTrigger(
  message: string,
  character: Entity<CharacterData>
): boolean {
  const triggers = character.data.triggerPhrases;
  if (!triggers || triggers.length === 0) return false;

  const lowerMessage = message.toLowerCase();
  return triggers.some((trigger) => lowerMessage.includes(trigger.toLowerCase()));
}

/**
 * Roll for chance-based response
 */
export function rollChance(chance: number): boolean {
  return Math.random() < chance;
}

/**
 * Evaluate if a character should respond based on their mode
 */
export function evaluateCharacterResponse(
  ctx: ResponseContext,
  character: Entity<CharacterData>
): { shouldRespond: boolean; reason: string } {
  const mode: ResponseMode = character.data.responseMode ?? ctx.config.defaultMode;
  const chance = character.data.responseChance ?? ctx.config.defaultChance;

  // @mention always triggers if configured
  if (ctx.isBotMentioned && ctx.config.mentionAlwaysResponds) {
    return { shouldRespond: true, reason: "mentioned" };
  }

  switch (mode) {
    case "always":
      if (!ctx.channelEnabled) {
        return { shouldRespond: false, reason: "channel not enabled" };
      }
      return { shouldRespond: true, reason: "always mode" };

    case "mention":
      return {
        shouldRespond: ctx.isBotMentioned,
        reason: ctx.isBotMentioned ? "mentioned" : "not mentioned",
      };

    case "trigger": {
      const matched = matchesTrigger(ctx.message, character);
      return {
        shouldRespond: matched,
        reason: matched ? "trigger matched" : "no trigger match",
      };
    }

    case "chance": {
      if (!ctx.channelEnabled && !ctx.isBotMentioned) {
        return { shouldRespond: false, reason: "channel not enabled" };
      }
      const rolled = rollChance(chance);
      return {
        shouldRespond: rolled,
        reason: rolled ? `chance (${(chance * 100).toFixed(0)}%)` : "chance failed",
      };
    }

    case "llm":
      // LLM eval is handled separately (async, needs model call)
      // For now, return false - the LLM eval middleware will override
      return { shouldRespond: false, reason: "pending llm eval" };

    case "combined": {
      // Trigger always works
      if (matchesTrigger(ctx.message, character)) {
        return { shouldRespond: true, reason: "trigger matched" };
      }
      // Then try chance
      if (ctx.channelEnabled || ctx.isBotMentioned) {
        const rolled = rollChance(chance);
        if (rolled) {
          return { shouldRespond: true, reason: `chance (${(chance * 100).toFixed(0)}%)` };
        }
      }
      return { shouldRespond: false, reason: "no trigger, chance failed" };
    }

    default:
      return { shouldRespond: false, reason: `unknown mode: ${mode}` };
  }
}

/**
 * Main response gate - determines if any characters should respond
 */
export function evaluateResponse(ctx: ResponseContext): ResponseDecision {
  // Check if response system is enabled
  if (!ctx.config.enabled) {
    // Fall back to simple logic: respond if mentioned or channel enabled
    const shouldRespond = ctx.isBotMentioned || ctx.channelEnabled;
    return {
      shouldRespond,
      respondingCharacters: shouldRespond ? ctx.characters.map((c) => c.id) : [],
      reason: shouldRespond ? "response system disabled, using fallback" : "no response",
    };
  }

  // Check persona requirement
  if (ctx.config.requirePersona && !ctx.hasPersona && !ctx.isBotMentioned) {
    return {
      shouldRespond: false,
      respondingCharacters: [],
      reason: "persona required",
    };
  }

  // No characters = no response (unless we should prompt for setup)
  if (ctx.characters.length === 0) {
    return {
      shouldRespond: false,
      respondingCharacters: [],
      reason: "no characters in scene",
    };
  }

  // Evaluate each character
  const responding: number[] = [];
  const reasons: string[] = [];

  for (const character of ctx.characters) {
    const result = evaluateCharacterResponse(ctx, character);
    if (result.shouldRespond) {
      responding.push(character.id);
      reasons.push(`${character.name}: ${result.reason}`);
    }
  }

  if (responding.length === 0) {
    return {
      shouldRespond: false,
      respondingCharacters: [],
      reason: "no characters chose to respond",
    };
  }

  return {
    shouldRespond: true,
    respondingCharacters: responding,
    reason: reasons.join("; "),
  };
}

/**
 * LLM-based response evaluation
 * Returns true if the LLM thinks the character would speak up
 */
export async function evaluateLLMResponse(
  _message: string,
  _character: Entity<CharacterData>,
  _recentContext: string[]
): Promise<boolean> {
  // TODO: Implement LLM eval
  // For now, return false (will be implemented later)
  return false;
}
