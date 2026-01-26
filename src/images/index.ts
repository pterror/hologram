/**
 * Image Generation Module
 *
 * High-level API for generating images using ComfyUI workflows.
 * Handles workflow execution, storage, and database integration.
 */

import type { ImageConfig } from "../config/types";
import { getComfyHost, type ComfyUIHost, type GeneratedImageData, type HostContext } from "./hosts";
import {
  loadWorkflow,
  prepareWorkflow,
  validateVariables,
  listWorkflows as listWorkflowTemplates,
  type WorkflowTemplate,
} from "./workflows";
import { getImageStorage, type ImageStorage } from "./storage";
import { debug, error } from "../logger";

// === Types ===

export interface GeneratedImage {
  url: string;
  width: number;
  height: number;
  workflow: string;
  variables: Record<string, unknown>;
  generatedAt: number;
}

export interface GenerateOptions {
  workflow?: string; // Workflow ID (default: config.defaultWorkflow)
  variables: Record<string, unknown>;
  width?: number;
  height?: number;
}

export interface CharacterInfo {
  name: string;
  description: string;
  appearance?: string;
}

// === Main API ===

/**
 * Generate an image using a ComfyUI workflow
 */
export async function generateImage(
  options: GenerateOptions,
  config: ImageConfig,
  storage: ImageStorage,
  host?: ComfyUIHost
): Promise<GeneratedImage> {
  const workflowId = options.workflow || config.defaultWorkflow;
  debug(`Generating image with workflow: ${workflowId}`);

  // Load workflow template
  const template = loadWorkflow(workflowId, config);
  if (!template) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  // Merge options with defaults
  const variables = {
    ...options.variables,
    width: options.width || options.variables.width || config.defaultWidth,
    height: options.height || options.variables.height || config.defaultHeight,
  };

  // Validate variables
  const errors = validateVariables(template, variables);
  if (errors.length > 0) {
    throw new Error(`Invalid variables: ${errors.join(", ")}`);
  }

  // Prepare workflow with variables
  const workflow = prepareWorkflow(template, variables);

  // Get host if not provided
  const comfyHost = host || getComfyHost(config);

  // Execute workflow
  debug(`Executing workflow on ${comfyHost.name}`);
  const result = await comfyHost.execute(workflow);

  if (result.images.length === 0) {
    throw new Error("Workflow produced no images");
  }

  // Upload the first image
  const image = result.images[0];
  const url = await uploadImage(image, storage);

  return {
    url,
    width: (variables.width as number) || config.defaultWidth,
    height: (variables.height as number) || config.defaultHeight,
    workflow: workflowId,
    variables,
    generatedAt: Date.now(),
  };
}

/**
 * Upload an image to storage
 */
async function uploadImage(image: GeneratedImageData, storage: ImageStorage): Promise<string> {
  debug(`Uploading image to ${storage.name}: ${image.filename}`);
  const url = await storage.upload(image.data, image.filename, image.contentType);
  debug(`Uploaded: ${url}`);
  return url;
}

// === Convenience Functions ===

/**
 * Generate a character portrait
 */
export async function generatePortrait(
  character: CharacterInfo,
  config: ImageConfig,
  storage: ImageStorage,
  host?: ComfyUIHost
): Promise<GeneratedImage> {
  // Build prompt from character info
  const promptParts: string[] = [];

  if (character.appearance) {
    promptParts.push(character.appearance);
  } else {
    promptParts.push(`portrait of ${character.name}`);
    if (character.description) {
      promptParts.push(character.description);
    }
  }

  // Add quality tags
  promptParts.push("masterpiece", "best quality", "detailed face");

  const prompt = promptParts.join(", ");

  return generateImage(
    {
      workflow: "portrait",
      variables: { prompt },
    },
    config,
    storage,
    host
  );
}

/**
 * Generate a character expression variant
 */
export async function generateExpression(
  character: CharacterInfo,
  expression: string,
  config: ImageConfig,
  storage: ImageStorage,
  host?: ComfyUIHost
): Promise<GeneratedImage> {
  // Build prompt with expression
  const promptParts: string[] = [];

  if (character.appearance) {
    promptParts.push(character.appearance);
  } else {
    promptParts.push(`portrait of ${character.name}`);
    if (character.description) {
      promptParts.push(character.description);
    }
  }

  // Add expression
  promptParts.push(`${expression} expression`, `looking ${expression}`);

  // Add quality tags
  promptParts.push("masterpiece", "best quality", "detailed face");

  const prompt = promptParts.join(", ");

  return generateImage(
    {
      workflow: "portrait",
      variables: { prompt },
    },
    config,
    storage,
    host
  );
}

/**
 * Generate a scene illustration
 */
export async function generateScene(
  prompt: string,
  characters: CharacterInfo[] | undefined,
  config: ImageConfig,
  storage: ImageStorage,
  host?: ComfyUIHost
): Promise<GeneratedImage> {
  const promptParts: string[] = [prompt];

  // Add character descriptions if provided
  if (characters && characters.length > 0) {
    for (const char of characters) {
      if (char.appearance) {
        promptParts.push(char.appearance);
      } else if (char.description) {
        promptParts.push(`${char.name}: ${char.description}`);
      }
    }
  }

  // Add quality tags
  promptParts.push("masterpiece", "best quality", "detailed background");

  const fullPrompt = promptParts.join(", ");

  return generateImage(
    {
      workflow: "scene",
      variables: { prompt: fullPrompt },
      width: 1344,
      height: 768,
    },
    config,
    storage,
    host
  );
}

// === Utility Functions ===

/**
 * Check if image generation is available
 */
export function isImageGenerationAvailable(config: ImageConfig): boolean {
  if (!config.enabled) return false;
  if (config.host === "none") return false;

  // Check for required environment variables based on host
  switch (config.host) {
    case "runcomfy":
      return !!process.env.RUNCOMFY_API_KEY;
    case "runcomfy-serverless":
      return (
        !!process.env.RUNCOMFY_SERVERLESS_API_KEY &&
        !!process.env.RUNCOMFY_SERVERLESS_DEPLOYMENT_ID
      );
    case "saladcloud":
      return !!process.env.SALADCLOUD_API_KEY && !!process.env.SALADCLOUD_ORG_NAME;
    case "runpod":
      return !!process.env.RUNPOD_API_KEY && !!process.env.RUNPOD_COMFY_ENDPOINT_ID;
    case "selfhosted":
      return !!(config.hostEndpoint || process.env.COMFYUI_ENDPOINT);
    default:
      return false;
  }
}

/**
 * List available workflows
 */
export function listWorkflows(config?: ImageConfig): WorkflowTemplate[] {
  return listWorkflowTemplates(config);
}

/**
 * Create image generation context for a request.
 * Supports BYOK - pass userId and guildId to resolve user/guild API keys.
 */
export function createImageContext(
  config: ImageConfig,
  context?: HostContext
): { host: ComfyUIHost; storage: ImageStorage } | null {
  if (!isImageGenerationAvailable(config)) {
    debug("Image generation not available");
    return null;
  }

  try {
    const host = getComfyHost(config, context);
    const storage = getImageStorage(config);
    return { host, storage };
  } catch (err) {
    error("Failed to create image context", err);
    return null;
  }
}

// === Re-exports ===

export { getComfyHost, type ComfyUIHost, type GeneratedImageData, type HostContext } from "./hosts";
export { loadWorkflow, prepareWorkflow, type WorkflowTemplate, type WorkflowVariable } from "./workflows";
export { getImageStorage, type ImageStorage, S3Storage, DiscordStorage, MemoryStorage } from "./storage";
