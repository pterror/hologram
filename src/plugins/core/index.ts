/**
 * Core Plugin
 *
 * Essential middleware that every bot needs:
 * - Message history management
 * - Channel enable/disable
 * - LLM calling
 * - Response delivery
 *
 * This plugin has no dependencies and provides the backbone.
 */

import { generateText } from "ai";
import type { Plugin, Middleware } from "../types";
import { MiddlewarePriority } from "../types";
import { getLanguageModel, parseModelSpec, DEFAULT_MODEL } from "../../ai/models";
import { resolveApiKey, type LLMProvider } from "../../ai/keys";
import { runFormatters, runExtractors } from "../registry";
import { formatMessagesForAI, type Message } from "../../ai/context";
import { allocateBudget } from "../../ai/budget";
import { error, warn, debug } from "../../logger";
import {
  enforceQuota,
  logUsage,
  calculateLLMCost,
  QuotaExceededError,
} from "../../quota";
import { evaluateResponse, evaluateResponseAsync, type ResponseContext } from "../response";
import { getEntity, type CharacterData } from "../../db/entities";
import { getPersona } from "../../personas";
import { DEFAULT_RESPONSE } from "../../config/defaults";

// =============================================================================
// Example Dialogue Parsing
// =============================================================================

/**
 * Parse example dialogue into user/assistant message pairs.
 * Supports formats:
 * - {{user}}: message / {{char}}: message
 * - <START>\nUser: message\nCharacter: message
 * - User: message\n\nCharacter: message
 */
function parseExampleDialogue(
  dialogue: string,
  characterName: string
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Normalize line endings
  const text = dialogue.replace(/\r\n/g, "\n").trim();
  if (!text) return messages;

  // Split by <START> markers (SillyTavern format) or double newlines
  const segments = text.split(/<START>|<start>/);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    // Try to parse as structured dialogue
    // Match patterns like: {{user}}: text, {{char}}: text, User: text, CharName: text
    const lines = trimmed.split("\n");
    let currentRole: "user" | "assistant" | null = null;
    let currentContent: string[] = [];

    for (const line of lines) {
      // Check for role markers
      const userMatch = line.match(/^(?:\{\{user\}\}|user|you):\s*/i);
      const charMatch = line.match(/^(?:\{\{char\}\}|char|assistant|bot|ai):\s*/i) ||
        new RegExp(`^${escapeRegex(characterName)}:\\s*`, "i").exec(line);

      if (userMatch) {
        // Flush previous content
        if (currentRole && currentContent.length > 0) {
          messages.push({ role: currentRole, content: currentContent.join("\n").trim() });
        }
        currentRole = "user";
        currentContent = [line.slice(userMatch[0].length)];
      } else if (charMatch) {
        // Flush previous content
        if (currentRole && currentContent.length > 0) {
          messages.push({ role: currentRole, content: currentContent.join("\n").trim() });
        }
        currentRole = "assistant";
        currentContent = [line.slice(charMatch[0].length)];
      } else if (currentRole) {
        // Continue previous message
        currentContent.push(line);
      }
    }

    // Flush final content
    if (currentRole && currentContent.length > 0) {
      messages.push({ role: currentRole, content: currentContent.join("\n").trim() });
    }
  }

  // Filter out empty messages
  return messages.filter((m) => m.content.trim().length > 0);
}

/** Escape special regex characters */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =============================================================================
// In-memory state
// =============================================================================

/** Message history per channel */
const channelMessages = new Map<string, Message[]>();
const MAX_HISTORY = 50;

/** Enabled channels */
const activeChannels = new Set<string>();

// =============================================================================
// Channel management (exported for commands)
// =============================================================================

export function enableChannel(channelId: string): void {
  activeChannels.add(channelId);
}

export function disableChannel(channelId: string): void {
  activeChannels.delete(channelId);
}

export function isChannelEnabled(channelId: string): boolean {
  return activeChannels.has(channelId);
}

export function clearHistory(channelId: string): void {
  channelMessages.delete(channelId);
}

export interface RerollResult {
  success: boolean;
  response?: string;
  error?: string;
}

/** Store last message metadata per channel for reroll */
const lastMessageMeta = new Map<string, {
  authorId: string;
  authorName: string;
  guildId?: string;
  content: string;
}>();

/** Called by history middleware to track last user message */
export function trackLastUserMessage(
  channelId: string,
  authorId: string,
  authorName: string,
  guildId: string | undefined,
  content: string
): void {
  lastMessageMeta.set(channelId, { authorId, authorName, guildId, content });
}

/**
 * Reroll the last AI response with optional guidance
 */
export async function rerollLastResponse(
  channelId: string,
  guidance?: string
): Promise<RerollResult> {
  const history = getChannelHistory(channelId);
  const meta = lastMessageMeta.get(channelId);

  if (history.length === 0 || !meta) {
    return { success: false, error: "No message history in this channel." };
  }

  // Find the last assistant message
  let lastAssistantIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx === -1) {
    return { success: false, error: "No AI response to reroll." };
  }

  // Remove the last assistant message from history
  history.splice(lastAssistantIdx, 1);

  // Re-run the message with guidance appended
  const { createContext, runMiddleware } = await import("../registry");
  const { getDeliveryResult } = await import("../delivery");

  const content = guidance
    ? `${meta.content}\n\n[Reroll guidance: ${guidance}]`
    : meta.content;

  const ctx = createContext({
    channelId,
    guildId: meta.guildId,
    authorId: meta.authorId,
    authorName: meta.authorName,
    content,
    isBotMentioned: true, // Treat as mentioned to ensure response
  });

  try {
    await runMiddleware(ctx);
    const result = getDeliveryResult(ctx);

    if (!result?.response) {
      return { success: false, error: "No response generated." };
    }

    return { success: true, response: result.response };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// =============================================================================
// History management
// =============================================================================

function getChannelHistory(channelId: string): Message[] {
  let history = channelMessages.get(channelId);
  if (!history) {
    history = [];
    channelMessages.set(channelId, history);
  }
  return history;
}

function addToHistory(channelId: string, message: Message): void {
  const history = getChannelHistory(channelId);
  history.push(message);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

// =============================================================================
// Middleware
// =============================================================================

/** Load message history into context */
const historyMiddleware: Middleware = {
  name: "core:history",
  priority: MiddlewarePriority.SCENE - 50, // Before scene, after identity
  fn: async (ctx, next) => {
    // Load history
    ctx.history = [...getChannelHistory(ctx.channelId)];

    // Track last user message for reroll
    trackLastUserMessage(
      ctx.channelId,
      ctx.authorId,
      ctx.effectiveName,
      ctx.guildId,
      ctx.content
    );

    // Add current message to history
    const gameTime = ctx.scene ? { ...ctx.scene.time } : undefined;
    addToHistory(ctx.channelId, {
      role: "user",
      content: ctx.content,
      name: ctx.effectiveName,
      timestamp: Date.now(),
      gameTime,
    });

    await next();
  },
};

/** Check if we should respond (runs after scene loads) */
const gateMiddleware: Middleware = {
  name: "core:gate",
  priority: MiddlewarePriority.SCENE + 10, // After scene loads
  fn: async (ctx, next) => {
    // Get characters for response evaluation
    const characters = ctx.activeCharacterIds
      .map((id) => getEntity<CharacterData>(id))
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // Check if user has a persona
    const userPersona = getPersona(ctx.authorId, ctx.worldId);
    const hasPersona = userPersona !== null;

    // Get response config (from world config or defaults)
    const responseConfig = ctx.config?.response ?? DEFAULT_RESPONSE;

    // Build response context
    const responseCtx: ResponseContext = {
      message: ctx.content,
      authorName: ctx.effectiveName,
      isBotMentioned: ctx.isBotMentioned,
      channelEnabled: isChannelEnabled(ctx.channelId),
      config: responseConfig,
      characters,
      hasPersona,
    };

    // Check if any characters use LLM mode
    const hasLLMMode = characters.some(
      (c) => (c.data.responseMode ?? responseConfig.defaultMode) === "llm"
    );

    // Evaluate response (use async if LLM mode is needed)
    const recentMessages = ctx.history
      .slice(-5)
      .map((m) => `${m.name ?? m.role}: ${m.content}`);

    const decision = hasLLMMode
      ? await evaluateResponseAsync(responseCtx, recentMessages)
      : evaluateResponse(responseCtx);

    debug("Response gate decision", {
      shouldRespond: decision.shouldRespond,
      reason: decision.reason,
      characters: decision.respondingCharacters,
    });

    // Store setup flags if needed (for delivery to send prompts)
    if (decision.needsPersonaSetup) {
      ctx.data.set("needsPersonaSetup", true);
    }
    if (decision.needsCharacterSetup) {
      ctx.data.set("needsCharacterSetup", true);
    }

    if (!decision.shouldRespond) {
      // If setup is needed and bot was mentioned, send a helpful prompt
      if (ctx.isBotMentioned && (decision.needsPersonaSetup || decision.needsCharacterSetup)) {
        if (decision.needsPersonaSetup) {
          ctx.response = "Before we can roleplay, I need to know who you are! Use `/persona set` to create your character identity.";
        } else if (decision.needsCharacterSetup) {
          ctx.response = "This channel doesn't have any characters set up yet. Use `/scene start` and `/scene cast add` to add characters, or `/setup` for guided setup.";
        }
        // Continue the chain to deliver the message
        await next();
        return;
      }
      // Don't continue the chain - no response needed
      return;
    }

    // Store which characters should respond (for delivery)
    ctx.data.set("respondingCharacters", decision.respondingCharacters);

    await next();
  },
};

/** Assemble context from formatters */
const contextMiddleware: Middleware = {
  name: "core:context",
  priority: MiddlewarePriority.CONTEXT,
  fn: async (ctx, next) => {
    // Run all formatters to get context sections
    const sections = await runFormatters(ctx);

    // Allocate budget
    const maxTokens = ctx.config?.context.maxTokens ?? 8000;
    const budgetResult = allocateBudget(
      sections.map((s) => ({
        name: s.name,
        content: s.content,
        priority: s.priority,
        canTruncate: s.canTruncate,
        minTokens: s.minTokens,
      })),
      maxTokens
    );

    // Build system prompt
    ctx.systemPrompt = budgetResult.sections.map((s) => s.content).join("\n\n");

    await next();
  },
};

/** Call the LLM */
const llmMiddleware: Middleware = {
  name: "core:llm",
  priority: MiddlewarePriority.LLM,
  fn: async (ctx, next) => {
    const modelSpec = process.env.DEFAULT_MODEL || DEFAULT_MODEL;
    const { providerName } = parseModelSpec(modelSpec);

    // Resolve API key (user -> guild -> env)
    const resolved = resolveApiKey(
      providerName as LLMProvider,
      ctx.authorId,
      ctx.guildId
    );

    if (!resolved) {
      ctx.response = `No API key configured for ${providerName}. Use \`/keys add\` to set one up.`;
      await next();
      return;
    }

    const model = getLanguageModel(modelSpec, resolved.key);

    // Check quota before LLM call
    if (ctx.config?.quota?.enabled) {
      try {
        enforceQuota(ctx.authorId, ctx.config.quota, "llm", ctx.guildId);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          ctx.response = err.toUserMessage();
          warn(`Quota exceeded for user ${ctx.authorId}: ${err.message}`);
          await next();
          return;
        }
        throw err;
      }
    }

    // No system prompt = no character configured, don't respond
    if (!ctx.systemPrompt) {
      // Don't set a response - middleware chain will naturally end
      // The channel should prompt for setup via onboarding
      return;
    }

    const historyMessages = ctx.config?.context.historyMessages ?? 20;
    const presetNotes = ctx.config?.context.presetNotes ?? [];

    // Build system prompt with preset notes at depth="system"
    let systemPrompt = ctx.systemPrompt;
    const systemNotes = presetNotes
      .filter((n) => n.depth === "system")
      .map((n) => n.content);
    if (systemNotes.length > 0) {
      systemPrompt += "\n\n" + systemNotes.join("\n\n");
    }

    // Format messages and inject preset notes at specified depths
    const rawMessages = ctx.history.slice(-historyMessages);
    let messages = formatMessagesForAI(rawMessages);

    // Parse and prepend example dialogues from active characters
    const exampleMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const charId of ctx.activeCharacterIds) {
      const character = getEntity<CharacterData>(charId);
      if (character?.data.exampleDialogue) {
        const parsed = parseExampleDialogue(character.data.exampleDialogue, character.name);
        exampleMessages.push(...parsed);
      }
    }
    if (exampleMessages.length > 0) {
      messages = [...exampleMessages, ...messages];
    }

    // Inject preset notes at specific depths
    const depthNotes = presetNotes.filter((n) => typeof n.depth === "number" || n.depth === "start");
    for (const note of depthNotes) {
      const depth = note.depth === "start" ? messages.length : note.depth;
      // Insert at position (from bottom) - depth 0 = end, depth 1 = before last message, etc.
      const insertIndex = Math.max(0, messages.length - (depth as number));
      messages = [
        ...messages.slice(0, insertIndex),
        { role: "user" as const, content: `[Author's Note: ${note.content}]` },
        ...messages.slice(insertIndex),
      ];
    }

    // Need at least one message to respond to
    if (messages.length === 0) {
      warn("No messages in history, cannot generate response");
      return;
    }

    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
    });

    ctx.response = result.text;

    // Log usage after successful call
    if (ctx.config?.quota?.enabled && result.usage) {
      const tokensIn = result.usage.inputTokens ?? 0;
      const tokensOut = result.usage.outputTokens ?? 0;
      logUsage({
        user_id: ctx.authorId,
        guild_id: ctx.guildId,
        type: "llm",
        model: modelSpec,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_millicents: calculateLLMCost(modelSpec, tokensIn, tokensOut),
        key_source: resolved.source,
        key_id: resolved.keyId,
      });
    }

    // Add response to history with character name if available
    const gameTime = ctx.scene ? { ...ctx.scene.time } : undefined;
    let assistantName: string | undefined;
    if (ctx.activeCharacterIds.length > 0) {
      const charEntity = getEntity<CharacterData>(ctx.activeCharacterIds[0]);
      assistantName = charEntity?.name;
    }
    addToHistory(ctx.channelId, {
      role: "assistant",
      content: ctx.response,
      name: assistantName,
      timestamp: Date.now(),
      gameTime,
    });

    await next();
  },
};

/** Run extractors after LLM response */
const extractionMiddleware: Middleware = {
  name: "core:extraction",
  priority: MiddlewarePriority.EXTRACTION,
  fn: async (ctx, next) => {
    if (ctx.response) {
      // Fire and forget - don't block response
      runExtractors(ctx).catch((err) =>
        error("Extraction pipeline failed", err)
      );
    }
    await next();
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const corePlugin: Plugin = {
  id: "core",
  name: "Core",
  description: "Essential message handling, history, and LLM integration",

  middleware: [
    historyMiddleware,
    gateMiddleware,
    contextMiddleware,
    llmMiddleware,
    extractionMiddleware,
  ],
};

export default corePlugin;
