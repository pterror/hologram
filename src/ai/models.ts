import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

const providerMap = {
  anthropic,
  google,
  openai,
};

type ProviderName = keyof typeof providerMap;

const providerNames = new Set(Object.keys(providerMap)) as Set<ProviderName>;

function isProviderName(name: string): name is ProviderName {
  return providerNames.has(name as ProviderName);
}

function parseModelSpec(modelSpec: string): {
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
    throw new Error(
      `Unknown provider: ${providerName}. Available: ${[...providerNames].join(", ")}`
    );
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
  process.env.DEFAULT_MODEL || "google:gemini-2.0-flash";
