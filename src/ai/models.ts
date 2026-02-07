import { anthropic } from "@ai-sdk/anthropic";
import { azure } from "@ai-sdk/azure";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { cerebras } from "@ai-sdk/cerebras";
import { cohere } from "@ai-sdk/cohere";
import { deepinfra } from "@ai-sdk/deepinfra";
import { deepseek } from "@ai-sdk/deepseek";
import { fireworks } from "@ai-sdk/fireworks";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { huggingface } from "@ai-sdk/huggingface";
import { mistral } from "@ai-sdk/mistral";
import { openai } from "@ai-sdk/openai";
import { perplexity } from "@ai-sdk/perplexity";
import { togetherai } from "@ai-sdk/togetherai";
import { vertex } from "@ai-sdk/google-vertex";
import { xai } from "@ai-sdk/xai";

const providerMap = {
  "amazon-bedrock": bedrock,
  anthropic,
  azure,
  cerebras,
  cohere,
  deepinfra,
  deepseek,
  fireworks,
  google,
  "google-vertex": vertex,
  groq,
  huggingface,
  mistral,
  openai,
  perplexity,
  togetherai,
  xai,
};

const providerNames = new Set(Object.keys(providerMap) as (keyof typeof providerMap)[]);

function isProviderName(name: string): name is keyof typeof providerMap {
  return providerNames.has(name as keyof typeof providerMap);
}

export function parseModelSpec(modelSpec: string): {
  providerName: string;
  modelName: string;
} {
  const matches = modelSpec.match(/^([^:]+):(.+)$/);
  if (!matches) {
    throw new Error(
      `Invalid model spec: ${modelSpec}. Expected format: provider:model`
    );
  }
  const [, providerName, modelName] = matches;
  return { providerName, modelName };
}

function getProvider(providerName: string) {
  if (!isProviderName(providerName)) {
    throw new Error(`Unknown provider: ${providerName}`);
  }
  return providerMap[providerName];
}

export function getLanguageModel(modelSpec: string) {
  const { providerName, modelName } = parseModelSpec(modelSpec);
  const provider = getProvider(providerName);
  if (!("languageModel" in provider)) {
    throw new Error(
      `Provider '${providerName}' does not support language models`
    );
  }
  return provider.languageModel(modelName);
}

export function getTextEmbeddingModel(modelSpec: string) {
  const { providerName, modelName } = parseModelSpec(modelSpec);
  const provider = getProvider(providerName);
  if (!("textEmbeddingModel" in provider)) {
    throw new Error(
      `Provider '${providerName}' does not support embedding models`
    );
  }
  return provider.textEmbeddingModel(modelName);
}

export const DEFAULT_MODEL =
  process.env.DEFAULT_MODEL || "google:gemini-3-flash-preview";

// =============================================================================
// Model Allowlist
// =============================================================================

/** Parsed ALLOWED_MODELS entries (supports "provider:model" exact or "provider:*" wildcard) */
const ALLOWED_MODELS: string[] | null = process.env.ALLOWED_MODELS
  ? process.env.ALLOWED_MODELS.split(",").map(s => s.trim()).filter(s => s.length > 0)
  : null;

/**
 * Check if a model spec is allowed by the ALLOWED_MODELS allowlist.
 * Returns true if no allowlist is configured, or if the spec matches an entry.
 * Supports exact match ("google:gemini-2.0-flash") and provider wildcard ("google:*").
 */
export function isModelAllowed(modelSpec: string): boolean {
  if (!ALLOWED_MODELS) return true;
  const { providerName } = parseModelSpec(modelSpec);
  return ALLOWED_MODELS.some(entry => {
    if (entry === modelSpec) return true;
    if (entry.endsWith(":*")) {
      return entry.slice(0, -2) === providerName;
    }
    return false;
  });
}

// =============================================================================
// Thinking / Reasoning
// =============================================================================

import type { JSONObject } from "@ai-sdk/provider";
import type { ThinkingLevel } from "../logic/expr";

/** Map abstract thinking levels to OpenAI reasoning effort */
const OPENAI_REASONING_MAP: Record<ThinkingLevel, string> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

/**
 * Build provider-specific `providerOptions` for thinking/reasoning.
 * Returns `undefined` when thinking is not explicitly configured (null level)
 * or when the provider has no known thinking support.
 */
export function buildThinkingOptions(
  providerName: string,
  thinkingLevel: ThinkingLevel | null,
): Record<string, JSONObject> | undefined {
  if (thinkingLevel == null) return undefined;

  switch (providerName) {
    case "google":
    case "google-vertex":
      return {
        [providerName === "google-vertex" ? "vertex" : "google"]: {
          thinkingConfig: { thinkingLevel },
        },
      };
    case "anthropic":
      return {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: 10_000 },
        },
      };
    case "openai":
      return {
        openai: {
          reasoningEffort: OPENAI_REASONING_MAP[thinkingLevel],
        },
      };
    default:
      return undefined;
  }
}

// =============================================================================
// Inference Error
// =============================================================================

/** Error thrown when LLM inference fails, carrying the model spec for error reporting */
export class InferenceError extends Error {
  modelSpec: string;
  constructor(message: string, modelSpec: string, cause?: unknown) {
    super(message, { cause });
    this.name = "InferenceError";
    this.modelSpec = modelSpec;
  }
}
