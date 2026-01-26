/**
 * ComfyUI Workflow Engine
 *
 * Handles loading workflow templates and substituting variables.
 * Workflows can be bundled (built-in) or custom (user-uploaded).
 */

import type { ComfyWorkflow } from "./hosts";
import type { ImageConfig } from "../config/types";

// === Interfaces ===

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  workflow: Record<string, unknown>; // ComfyUI API format JSON
  variables: WorkflowVariable[];
  outputNodeId: string; // Node ID that produces the output image
}

export interface WorkflowVariable {
  name: string; // e.g., "prompt", "negative_prompt", "seed"
  nodeId: string; // Node ID in workflow to modify
  field: string; // Field path in node inputs (e.g., "inputs.text")
  type: "string" | "number" | "boolean" | "lora" | "image";
  required: boolean;
  default?: unknown;
  description?: string;
}

// === Built-in Workflows ===

/**
 * Basic portrait workflow using Illustrious XL
 * Variables: prompt, negative_prompt, width, height, seed
 */
const PORTRAIT_WORKFLOW: WorkflowTemplate = {
  id: "portrait",
  name: "Character Portrait",
  description: "Generate a character portrait using Illustrious XL",
  outputNodeId: "9",
  variables: [
    {
      name: "prompt",
      nodeId: "6",
      field: "inputs.text",
      type: "string",
      required: true,
      description: "Positive prompt describing the character",
    },
    {
      name: "negative_prompt",
      nodeId: "7",
      field: "inputs.text",
      type: "string",
      required: false,
      default: "lowres, bad anatomy, bad hands, text, error, missing fingers, cropped, worst quality, low quality, jpeg artifacts",
      description: "Negative prompt for things to avoid",
    },
    {
      name: "width",
      nodeId: "5",
      field: "inputs.width",
      type: "number",
      required: false,
      default: 1024,
    },
    {
      name: "height",
      nodeId: "5",
      field: "inputs.height",
      type: "number",
      required: false,
      default: 1024,
    },
    {
      name: "seed",
      nodeId: "3",
      field: "inputs.seed",
      type: "number",
      required: false,
      default: -1, // Random
    },
    {
      name: "steps",
      nodeId: "3",
      field: "inputs.steps",
      type: "number",
      required: false,
      default: 25,
    },
    {
      name: "cfg",
      nodeId: "3",
      field: "inputs.cfg",
      type: "number",
      required: false,
      default: 7,
    },
  ],
  workflow: {
    "3": {
      class_type: "KSampler",
      inputs: {
        cfg: 7,
        denoise: 1,
        latent_image: ["5", 0],
        model: ["4", 0],
        negative: ["7", 0],
        positive: ["6", 0],
        sampler_name: "euler_ancestral",
        scheduler: "normal",
        seed: -1,
        steps: 25,
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: "illustriousXL_v01.safetensors",
      },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        batch_size: 1,
        height: 1024,
        width: 1024,
      },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["4", 1],
        text: "",
      },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["4", 1],
        text: "lowres, bad anatomy, bad hands, text, error",
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "portrait",
        images: ["8", 0],
      },
    },
  },
};

/**
 * Scene illustration workflow
 * Similar to portrait but optimized for wider aspect ratios
 */
const SCENE_WORKFLOW: WorkflowTemplate = {
  id: "scene",
  name: "Scene Illustration",
  description: "Generate a scene illustration",
  outputNodeId: "9",
  variables: [
    {
      name: "prompt",
      nodeId: "6",
      field: "inputs.text",
      type: "string",
      required: true,
      description: "Scene description",
    },
    {
      name: "negative_prompt",
      nodeId: "7",
      field: "inputs.text",
      type: "string",
      required: false,
      default: "lowres, bad anatomy, text, error, worst quality, low quality, jpeg artifacts",
    },
    {
      name: "width",
      nodeId: "5",
      field: "inputs.width",
      type: "number",
      required: false,
      default: 1344, // 21:9 aspect
    },
    {
      name: "height",
      nodeId: "5",
      field: "inputs.height",
      type: "number",
      required: false,
      default: 768,
    },
    {
      name: "seed",
      nodeId: "3",
      field: "inputs.seed",
      type: "number",
      required: false,
      default: -1,
    },
  ],
  workflow: PORTRAIT_WORKFLOW.workflow, // Same base workflow, different defaults
};

export const BUILTIN_WORKFLOWS: WorkflowTemplate[] = [
  PORTRAIT_WORKFLOW,
  SCENE_WORKFLOW,
];

// === Workflow Loading ===

/**
 * Load a workflow template by ID
 * First checks built-in workflows, then custom workflows path
 */
export function loadWorkflow(id: string, _config?: ImageConfig): WorkflowTemplate | null {
  // Check built-in workflows
  const builtin = BUILTIN_WORKFLOWS.find((w) => w.id === id);
  if (builtin) {
    return builtin;
  }

  // TODO: Load from custom workflows path (config.customWorkflowsPath)
  // TODO: Load from database (per-world custom workflows)

  return null;
}

/**
 * List all available workflows
 */
export function listWorkflows(_config?: ImageConfig): WorkflowTemplate[] {
  // TODO: Include custom workflows from config path and database
  return [...BUILTIN_WORKFLOWS];
}

// === Variable Substitution ===

/**
 * Deep clone an object
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Set a value at a nested path in an object
 * e.g., setPath(obj, "inputs.text", "hello") sets obj.inputs.text = "hello"
 */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Prepare a workflow for execution by substituting variables
 */
export function prepareWorkflow(
  template: WorkflowTemplate,
  variables: Record<string, unknown>
): ComfyWorkflow {
  // Clone the workflow to avoid modifying the template
  const workflow = deepClone(template.workflow);

  // Substitute each variable
  for (const variable of template.variables) {
    const value = variables[variable.name] ?? variable.default;

    // Skip if no value and not required
    if (value === undefined) {
      if (variable.required) {
        throw new Error(`Required variable '${variable.name}' not provided`);
      }
      continue;
    }

    // Get the node
    const node = workflow[variable.nodeId] as Record<string, unknown> | undefined;
    if (!node) {
      throw new Error(`Node '${variable.nodeId}' not found in workflow`);
    }

    // Set the value at the field path
    setPath(node, variable.field, value);
  }

  // Handle random seed (-1 means random)
  for (const variable of template.variables) {
    if (variable.name === "seed") {
      const node = workflow[variable.nodeId] as Record<string, Record<string, unknown>>;
      const currentSeed = node?.inputs?.seed;
      if (currentSeed === -1) {
        node.inputs.seed = Math.floor(Math.random() * 2147483647);
      }
    }
  }

  return {
    workflow,
    outputNodeId: template.outputNodeId,
  };
}

/**
 * Validate that all required variables are provided
 */
export function validateVariables(
  template: WorkflowTemplate,
  variables: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  for (const variable of template.variables) {
    if (variable.required && variables[variable.name] === undefined) {
      errors.push(`Missing required variable: ${variable.name}`);
    }

    const value = variables[variable.name];
    if (value !== undefined) {
      // Type validation
      switch (variable.type) {
        case "string":
          if (typeof value !== "string") {
            errors.push(`Variable '${variable.name}' must be a string`);
          }
          break;
        case "number":
          if (typeof value !== "number") {
            errors.push(`Variable '${variable.name}' must be a number`);
          }
          break;
        case "boolean":
          if (typeof value !== "boolean") {
            errors.push(`Variable '${variable.name}' must be a boolean`);
          }
          break;
      }
    }
  }

  return errors;
}
