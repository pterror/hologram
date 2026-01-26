/**
 * ComfyUI host interface and implementations
 *
 * Hosts are services that can execute ComfyUI workflows.
 * Each host implements the same interface but may have different
 * capabilities, pricing, and setup requirements.
 */

import type { ImageConfig } from "../config/types";

// === Interfaces ===

export interface ComfyUIHost {
  readonly name: string;
  execute(workflow: ComfyWorkflow): Promise<ExecutionResult>;
  getStatus?(jobId: string): Promise<JobStatus>;
}

export interface ComfyWorkflow {
  workflow: Record<string, unknown>; // ComfyUI workflow JSON (API format)
  outputNodeId?: string; // Node to get output from (defaults to SaveImage nodes)
  /**
   * For RunComfy Serverless: use overrides mode instead of full workflow.
   * When true, `workflow` is treated as node-keyed overrides for the cloud-saved workflow.
   * When false/undefined, `workflow` is sent as a complete dynamic workflow.
   */
  useOverrides?: boolean;
}

export interface ExecutionResult {
  images: GeneratedImageData[];
  metadata?: Record<string, unknown>;
}

export interface GeneratedImageData {
  data: Buffer;
  contentType: string;
  filename: string;
}

export interface JobStatus {
  status: "pending" | "running" | "completed" | "failed";
  progress?: number; // 0-100
  error?: string;
}

// === RunComfy Host (Legacy API) ===

export class RunComfyHost implements ComfyUIHost {
  readonly name = "runcomfy";
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.runcomfy.com/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async execute(workflow: ComfyWorkflow): Promise<ExecutionResult> {
    // Submit workflow
    const submitRes = await fetch(`${this.baseUrl}/workflows/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        workflow: workflow.workflow,
      }),
    });

    if (!submitRes.ok) {
      const error = await submitRes.text();
      throw new Error(`RunComfy submit failed: ${error}`);
    }

    const { run_id } = (await submitRes.json()) as { run_id: string };

    // Poll for completion
    const result = await this.pollForCompletion(run_id);
    return result;
  }

  private async pollForCompletion(
    runId: string,
    maxAttempts = 120,
    intervalMs = 2000
  ): Promise<ExecutionResult> {
    for (let i = 0; i < maxAttempts; i++) {
      const statusRes = await fetch(`${this.baseUrl}/runs/${runId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!statusRes.ok) {
        throw new Error(`RunComfy status check failed: ${await statusRes.text()}`);
      }

      const status = (await statusRes.json()) as {
        status: string;
        outputs?: Array<{ url: string; filename: string }>;
        error?: string;
      };

      if (status.status === "failed") {
        throw new Error(`RunComfy execution failed: ${status.error}`);
      }

      if (status.status === "completed" && status.outputs) {
        // Fetch all output images
        const images: GeneratedImageData[] = await Promise.all(
          status.outputs.map(async (output) => {
            const imgRes = await fetch(output.url);
            if (!imgRes.ok) {
              throw new Error(`Failed to fetch image: ${output.url}`);
            }
            const data = Buffer.from(await imgRes.arrayBuffer());
            const contentType = imgRes.headers.get("content-type") || "image/png";
            return {
              data,
              contentType,
              filename: output.filename,
            };
          })
        );

        return { images };
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error("RunComfy execution timed out");
  }

  async getStatus(jobId: string): Promise<JobStatus> {
    const res = await fetch(`${this.baseUrl}/runs/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`RunComfy status check failed: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      status: string;
      progress?: number;
      error?: string;
    };

    return {
      status: data.status as JobStatus["status"],
      progress: data.progress,
      error: data.error,
    };
  }
}

// === RunComfy Serverless Host ===

export class RunComfyServerlessHost implements ComfyUIHost {
  readonly name = "runcomfy-serverless";
  private readonly apiKey: string;
  private readonly deploymentId: string;
  private readonly baseUrl = "https://api.runcomfy.net/prod/v1";
  private readonly overrideMapping?: Record<string, string>;

  constructor(
    apiKey: string,
    deploymentId: string,
    overrideMapping?: Record<string, string>
  ) {
    this.apiKey = apiKey;
    this.deploymentId = deploymentId;
    this.overrideMapping = overrideMapping;
  }

  /**
   * Transform flat variables into nested overrides format using the mapping.
   * e.g. { prompt: "hello" } with mapping { prompt: "2.inputs.text" }
   * becomes { "2": { "inputs": { "text": "hello" } } }
   */
  private buildOverrides(variables: Record<string, unknown>): Record<string, unknown> {
    if (!this.overrideMapping) {
      // No mapping - assume variables are already in overrides format
      return variables;
    }

    const overrides: Record<string, Record<string, Record<string, unknown>>> = {};

    for (const [varName, value] of Object.entries(variables)) {
      const path = this.overrideMapping[varName];
      if (!path) continue;

      // Parse path like "2.inputs.text"
      const parts = path.split(".");
      if (parts.length !== 3 || parts[1] !== "inputs") {
        // Skip invalid paths
        continue;
      }

      const [nodeId, , inputName] = parts;

      if (!overrides[nodeId]) {
        overrides[nodeId] = { inputs: {} };
      }
      overrides[nodeId].inputs[inputName] = value;
    }

    return overrides;
  }

  async execute(workflow: ComfyWorkflow): Promise<ExecutionResult> {
    // Build request body based on mode
    let body: Record<string, unknown>;

    if (workflow.useOverrides) {
      // Overrides mode: transform variables using mapping
      const overrides = this.buildOverrides(workflow.workflow as Record<string, unknown>);
      body = { overrides };
    } else {
      // Dynamic workflow mode: send full workflow JSON
      body = { workflow_api_json: workflow.workflow };
    }

    const submitRes = await fetch(
      `${this.baseUrl}/deployments/${this.deploymentId}/inference`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!submitRes.ok) {
      const error = await submitRes.text();
      throw new Error(`RunComfy Serverless submit failed: ${error}`);
    }

    const result = (await submitRes.json()) as {
      run_id?: string;
      id?: string;
      status?: string;
      outputs?: Array<{ url: string; filename?: string }>;
      images?: Array<{ url: string; filename?: string }>;
      error?: string;
    };

    // If we got a run_id, poll for completion
    const runId = result.run_id || result.id;
    if (runId && result.status !== "completed") {
      return this.pollForCompletion(runId);
    }

    // Synchronous response - extract images directly
    const outputs = result.outputs || result.images;
    if (!outputs?.length) {
      throw new Error("RunComfy Serverless returned no images");
    }

    const images: GeneratedImageData[] = await Promise.all(
      outputs.map(async (output, i) => {
        const imgRes = await fetch(output.url);
        if (!imgRes.ok) {
          throw new Error(`Failed to fetch image: ${output.url}`);
        }
        const data = Buffer.from(await imgRes.arrayBuffer());
        const contentType = imgRes.headers.get("content-type") || "image/png";
        return {
          data,
          contentType,
          filename: output.filename || `output_${i}.png`,
        };
      })
    );

    return { images };
  }

  private async pollForCompletion(
    runId: string,
    maxAttempts = 120,
    intervalMs = 2000
  ): Promise<ExecutionResult> {
    for (let i = 0; i < maxAttempts; i++) {
      const statusRes = await fetch(
        `${this.baseUrl}/deployments/${this.deploymentId}/runs/${runId}`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        }
      );

      if (!statusRes.ok) {
        throw new Error(`RunComfy Serverless status check failed: ${await statusRes.text()}`);
      }

      const status = (await statusRes.json()) as {
        status: string;
        outputs?: Array<{ url: string; filename?: string }>;
        images?: Array<{ url: string; filename?: string }>;
        error?: string;
      };

      if (status.status === "failed" || status.status === "error") {
        throw new Error(`RunComfy Serverless execution failed: ${status.error}`);
      }

      if (status.status === "completed" || status.status === "success") {
        const outputs = status.outputs || status.images;
        if (!outputs?.length) {
          throw new Error("RunComfy Serverless returned no images");
        }

        const images: GeneratedImageData[] = await Promise.all(
          outputs.map(async (output, i) => {
            const imgRes = await fetch(output.url);
            if (!imgRes.ok) {
              throw new Error(`Failed to fetch image: ${output.url}`);
            }
            const data = Buffer.from(await imgRes.arrayBuffer());
            const contentType = imgRes.headers.get("content-type") || "image/png";
            return {
              data,
              contentType,
              filename: output.filename || `output_${i}.png`,
            };
          })
        );

        return { images };
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error("RunComfy Serverless execution timed out");
  }

  async getStatus(jobId: string): Promise<JobStatus> {
    const res = await fetch(
      `${this.baseUrl}/deployments/${this.deploymentId}/runs/${jobId}`,
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      }
    );

    if (!res.ok) {
      throw new Error(`RunComfy Serverless status check failed: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      status: string;
      progress?: number;
      error?: string;
    };

    const statusMap: Record<string, JobStatus["status"]> = {
      pending: "pending",
      queued: "pending",
      running: "running",
      processing: "running",
      completed: "completed",
      success: "completed",
      failed: "failed",
      error: "failed",
    };

    return {
      status: statusMap[data.status] || "pending",
      progress: data.progress,
      error: data.error,
    };
  }
}

// === SaladCloud Host ===

export class SaladCloudHost implements ComfyUIHost {
  readonly name = "saladcloud";
  private readonly apiKey: string;
  private readonly orgName: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, orgName: string, endpoint?: string) {
    this.apiKey = apiKey;
    this.orgName = orgName;
    this.baseUrl = endpoint || "https://api.salad.com/api/public";
  }

  async execute(workflow: ComfyWorkflow): Promise<ExecutionResult> {
    // SaladCloud's ComfyUI API is stateless - single request/response
    const res = await fetch(
      `${this.baseUrl}/organizations/${this.orgName}/inference-endpoints/comfyui/jobs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Salad-Api-Key": this.apiKey,
        },
        body: JSON.stringify({
          input: {
            workflow_api: workflow.workflow,
          },
        }),
      }
    );

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`SaladCloud execution failed: ${error}`);
    }

    const result = (await res.json()) as {
      output?: {
        images?: Array<{ url: string; filename?: string }>;
      };
    };

    if (!result.output?.images?.length) {
      throw new Error("SaladCloud returned no images");
    }

    // Fetch all output images
    const images: GeneratedImageData[] = await Promise.all(
      result.output.images.map(async (img, i) => {
        const imgRes = await fetch(img.url);
        if (!imgRes.ok) {
          throw new Error(`Failed to fetch image: ${img.url}`);
        }
        const data = Buffer.from(await imgRes.arrayBuffer());
        const contentType = imgRes.headers.get("content-type") || "image/png";
        return {
          data,
          contentType,
          filename: img.filename || `output_${i}.png`,
        };
      })
    );

    return { images };
  }
}

// === RunPod Host ===

export class RunPodHost implements ComfyUIHost {
  readonly name = "runpod";
  private readonly apiKey: string;
  private readonly endpointId: string;
  private readonly baseUrl = "https://api.runpod.ai/v2";

  constructor(apiKey: string, endpointId: string) {
    this.apiKey = apiKey;
    this.endpointId = endpointId;
  }

  async execute(workflow: ComfyWorkflow): Promise<ExecutionResult> {
    // Submit to RunPod serverless endpoint
    const submitRes = await fetch(`${this.baseUrl}/${this.endpointId}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: {
          workflow: workflow.workflow,
        },
      }),
    });

    if (!submitRes.ok) {
      const error = await submitRes.text();
      throw new Error(`RunPod submit failed: ${error}`);
    }

    const { id } = (await submitRes.json()) as { id: string };

    // Poll for completion
    return this.pollForCompletion(id);
  }

  private async pollForCompletion(
    jobId: string,
    maxAttempts = 120,
    intervalMs = 2000
  ): Promise<ExecutionResult> {
    for (let i = 0; i < maxAttempts; i++) {
      const statusRes = await fetch(`${this.baseUrl}/${this.endpointId}/status/${jobId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!statusRes.ok) {
        throw new Error(`RunPod status check failed: ${await statusRes.text()}`);
      }

      const status = (await statusRes.json()) as {
        status: string;
        output?: {
          images?: Array<{ url?: string; base64?: string; filename?: string }>;
        };
        error?: string;
      };

      if (status.status === "FAILED") {
        throw new Error(`RunPod execution failed: ${status.error}`);
      }

      if (status.status === "COMPLETED" && status.output?.images) {
        const images: GeneratedImageData[] = await Promise.all(
          status.output.images.map(async (img, i) => {
            let data: Buffer;
            let contentType = "image/png";

            if (img.base64) {
              data = Buffer.from(img.base64, "base64");
            } else if (img.url) {
              const imgRes = await fetch(img.url);
              if (!imgRes.ok) {
                throw new Error(`Failed to fetch image: ${img.url}`);
              }
              data = Buffer.from(await imgRes.arrayBuffer());
              contentType = imgRes.headers.get("content-type") || "image/png";
            } else {
              throw new Error("RunPod image has no url or base64 data");
            }

            return {
              data,
              contentType,
              filename: img.filename || `output_${i}.png`,
            };
          })
        );

        return { images };
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error("RunPod execution timed out");
  }

  async getStatus(jobId: string): Promise<JobStatus> {
    const res = await fetch(`${this.baseUrl}/${this.endpointId}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`RunPod status check failed: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      status: string;
      error?: string;
    };

    const statusMap: Record<string, JobStatus["status"]> = {
      IN_QUEUE: "pending",
      IN_PROGRESS: "running",
      COMPLETED: "completed",
      FAILED: "failed",
    };

    return {
      status: statusMap[data.status] || "pending",
      error: data.error,
    };
  }
}

// === Self-Hosted Host ===

export class SelfHostedHost implements ComfyUIHost {
  readonly name = "selfhosted";
  private readonly endpoint: string;

  constructor(endpoint: string) {
    // Remove trailing slash
    this.endpoint = endpoint.replace(/\/$/, "");
  }

  async execute(workflow: ComfyWorkflow): Promise<ExecutionResult> {
    // Queue the prompt
    const queueRes = await fetch(`${this.endpoint}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow.workflow }),
    });

    if (!queueRes.ok) {
      const error = await queueRes.text();
      throw new Error(`ComfyUI queue failed: ${error}`);
    }

    const { prompt_id } = (await queueRes.json()) as { prompt_id: string };

    // Poll for completion via history
    return this.pollForCompletion(prompt_id);
  }

  private async pollForCompletion(
    promptId: string,
    maxAttempts = 120,
    intervalMs = 1000
  ): Promise<ExecutionResult> {
    for (let i = 0; i < maxAttempts; i++) {
      const historyRes = await fetch(`${this.endpoint}/history/${promptId}`);

      if (!historyRes.ok) {
        throw new Error(`ComfyUI history check failed: ${await historyRes.text()}`);
      }

      const history = (await historyRes.json()) as Record<
        string,
        {
          status?: { completed?: boolean; status_str?: string };
          outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string }> }>;
        }
      >;

      const entry = history[promptId];
      if (!entry) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }

      if (entry.status?.status_str === "error") {
        throw new Error("ComfyUI execution failed");
      }

      if (entry.status?.completed && entry.outputs) {
        // Collect all images from all output nodes
        const allImages: Array<{ filename: string; subfolder: string }> = [];
        for (const nodeOutput of Object.values(entry.outputs)) {
          if (nodeOutput.images) {
            allImages.push(...nodeOutput.images);
          }
        }

        if (allImages.length === 0) {
          throw new Error("ComfyUI returned no images");
        }

        // Fetch images from ComfyUI
        const images: GeneratedImageData[] = await Promise.all(
          allImages.map(async (img) => {
            const params = new URLSearchParams({
              filename: img.filename,
              subfolder: img.subfolder || "",
              type: "output",
            });
            const imgRes = await fetch(`${this.endpoint}/view?${params}`);
            if (!imgRes.ok) {
              throw new Error(`Failed to fetch image: ${img.filename}`);
            }
            const data = Buffer.from(await imgRes.arrayBuffer());
            const contentType = imgRes.headers.get("content-type") || "image/png";
            return {
              data,
              contentType,
              filename: img.filename,
            };
          })
        );

        return { images };
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error("ComfyUI execution timed out");
  }
}

// === Factory ===

export function getComfyHost(config: ImageConfig): ComfyUIHost {
  switch (config.host) {
    case "runcomfy": {
      const apiKey = process.env.RUNCOMFY_API_KEY;
      if (!apiKey) {
        throw new Error("RUNCOMFY_API_KEY environment variable is required");
      }
      return new RunComfyHost(apiKey);
    }

    case "runcomfy-serverless": {
      const apiKey = process.env.RUNCOMFY_SERVERLESS_API_KEY;
      const deploymentId = process.env.RUNCOMFY_SERVERLESS_DEPLOYMENT_ID;
      if (!apiKey || !deploymentId) {
        throw new Error(
          "RUNCOMFY_SERVERLESS_API_KEY and RUNCOMFY_SERVERLESS_DEPLOYMENT_ID environment variables are required"
        );
      }
      // Config mapping takes precedence over env var default
      let mapping = config.serverlessOverrideMapping;
      if (!mapping && process.env.RUNCOMFY_SERVERLESS_OVERRIDE_MAPPING) {
        try {
          mapping = JSON.parse(process.env.RUNCOMFY_SERVERLESS_OVERRIDE_MAPPING);
        } catch {
          throw new Error("RUNCOMFY_SERVERLESS_OVERRIDE_MAPPING is not valid JSON");
        }
      }
      return new RunComfyServerlessHost(apiKey, deploymentId, mapping);
    }

    case "saladcloud": {
      const apiKey = process.env.SALADCLOUD_API_KEY;
      const orgName = process.env.SALADCLOUD_ORG_NAME;
      if (!apiKey || !orgName) {
        throw new Error(
          "SALADCLOUD_API_KEY and SALADCLOUD_ORG_NAME environment variables are required"
        );
      }
      return new SaladCloudHost(apiKey, orgName, config.hostEndpoint);
    }

    case "runpod": {
      const apiKey = process.env.RUNPOD_API_KEY;
      const endpointId = process.env.RUNPOD_COMFY_ENDPOINT_ID;
      if (!apiKey || !endpointId) {
        throw new Error(
          "RUNPOD_API_KEY and RUNPOD_COMFY_ENDPOINT_ID environment variables are required"
        );
      }
      return new RunPodHost(apiKey, endpointId);
    }

    case "selfhosted": {
      const endpoint = config.hostEndpoint || process.env.COMFYUI_ENDPOINT;
      if (!endpoint) {
        throw new Error(
          "hostEndpoint config or COMFYUI_ENDPOINT environment variable is required"
        );
      }
      return new SelfHostedHost(endpoint);
    }

    case "none":
      throw new Error("No image generation host configured");

    default:
      throw new Error(`Unknown image host: ${config.host}`);
  }
}
