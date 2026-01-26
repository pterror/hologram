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
import { error, warn } from "../../logger";
import {
  enforceQuota,
  logUsage,
  calculateLLMCost,
  QuotaExceededError,
} from "../../quota";

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

/** Check if we should respond */
const gateMiddleware: Middleware = {
  name: "core:gate",
  priority: MiddlewarePriority.SCENE - 40,
  fn: async (ctx, next) => {
    const shouldRespond = isChannelEnabled(ctx.channelId) || ctx.isBotMentioned;
    if (!shouldRespond) {
      // Don't continue the chain - no response needed
      return;
    }
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

    const historyMessages = ctx.config?.context.historyMessages ?? 20;
    const messages = formatMessagesForAI(ctx.history.slice(-historyMessages));

    const result = await generateText({
      model,
      system: ctx.systemPrompt || "You are a helpful assistant in a roleplay scenario.",
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

    // Add response to history
    const gameTime = ctx.scene ? { ...ctx.scene.time } : undefined;
    addToHistory(ctx.channelId, {
      role: "assistant",
      content: ctx.response,
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
