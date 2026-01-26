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
  needsPersonaSetup?: boolean; // User needs to set up persona first
  needsCharacterSetup?: boolean; // Channel needs character(s) added
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
 * Note: For 'llm' mode, this returns a pending result. Use evaluateCharacterResponseAsync for full eval.
 */
export function evaluateCharacterResponse(
  ctx: ResponseContext,
  character: Entity<CharacterData>
): { shouldRespond: boolean; reason: string; needsLLMEval?: boolean } {
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
      // LLM eval needs async handling
      return { shouldRespond: false, reason: "pending llm eval", needsLLMEval: true };

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
  if (ctx.config.requirePersona && !ctx.hasPersona) {
    return {
      shouldRespond: false,
      respondingCharacters: [],
      reason: "persona required",
      needsPersonaSetup: true,
    };
  }

  // No characters = no response (unless we should prompt for setup)
  if (ctx.characters.length === 0) {
    return {
      shouldRespond: false,
      respondingCharacters: [],
      reason: "no characters in scene",
      needsCharacterSetup: true,
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
 * Async version of evaluateResponse that handles LLM mode
 */
export async function evaluateResponseAsync(
  ctx: ResponseContext,
  recentMessages: string[] = []
): Promise<ResponseDecision> {
  // First do sync evaluation
  const syncResult = evaluateResponse(ctx);

  // If we got a response or no characters, return sync result
  if (syncResult.shouldRespond || ctx.characters.length === 0) {
    return syncResult;
  }

  // Check if any characters need LLM eval
  const llmCandidates: Array<{ character: Entity<CharacterData>; reason: string }> = [];

  for (const character of ctx.characters) {
    const result = evaluateCharacterResponse(ctx, character);
    if (result.needsLLMEval) {
      llmCandidates.push({ character, reason: result.reason });
    }
  }

  if (llmCandidates.length === 0) {
    return syncResult;
  }

  // Run LLM eval for candidates (in parallel)
  const llmResults = await Promise.all(
    llmCandidates.map(async ({ character }) => {
      const shouldRespond = await evaluateLLMResponse(
        ctx.message,
        character,
        recentMessages,
        { model: ctx.config.llmModel, customPrompt: character.data.llmEvalPrompt }
      );
      return { character, shouldRespond };
    })
  );

  // Collect responding characters
  const responding = llmResults
    .filter((r) => r.shouldRespond)
    .map((r) => r.character.id);

  if (responding.length === 0) {
    return {
      shouldRespond: false,
      respondingCharacters: [],
      reason: "llm eval: no characters chose to respond",
    };
  }

  const names = llmResults
    .filter((r) => r.shouldRespond)
    .map((r) => r.character.name);

  return {
    shouldRespond: true,
    respondingCharacters: responding,
    reason: `llm eval: ${names.join(", ")} chose to respond`,
  };
}

/**
 * LLM-based response evaluation
 * Returns true if the LLM thinks the character would speak up
 */
export async function evaluateLLMResponse(
  message: string,
  character: Entity<CharacterData>,
  recentContext: string[],
  config?: { model?: string; customPrompt?: string }
): Promise<boolean> {
  const { generateText } = await import("ai");
  const { getLanguageModel } = await import("../../ai/models");

  // Use a fast/cheap model for this evaluation
  const modelSpec = config?.model ?? "anthropic:claude-3-5-haiku-20241022";
  const model = getLanguageModel(modelSpec);

  const customPrompt = config?.customPrompt ?? character.data.llmEvalPrompt;

  const systemPrompt = customPrompt ??
    `You are evaluating whether a character would naturally interject in a conversation.
Character: ${character.name}
Personality: ${character.data.persona?.slice(0, 500) ?? "No description"}

Consider:
- Would this character have something to say about this topic?
- Is the message directed at or about them?
- Would they naturally speak up given their personality?

Respond with ONLY "yes" or "no".`;

  const contextStr = recentContext.length > 0
    ? `Recent conversation:\n${recentContext.slice(-5).join("\n")}\n\n`
    : "";

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `${contextStr}New message: "${message}"\n\nWould ${character.name} respond to this?`,
      }],
      maxOutputTokens: 10,
    });

    const answer = result.text.toLowerCase().trim();
    return answer.startsWith("yes") || answer === "y";
  } catch {
    // On error, default to not responding
    return false;
  }
}
