import { getDb } from "../db";
import type { QuotaConfig, QuotaPeriod, QuotaLimits } from "../config/types";

export type { QuotaConfig, QuotaPeriod, QuotaLimits };

// === Types ===

export interface UsageEntry {
  user_id: string;
  guild_id?: string;
  type: "llm" | "image";
  model: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_millicents: number;
  key_source?: "user" | "guild" | "env";
  key_id?: number;
}

export interface QuotaStatus {
  llm_tokens: { used: number; limit?: number; remaining?: number };
  image_count: { used: number; limit?: number; remaining?: number };
  total_cost: { used: number; limit?: number; remaining?: number };
  exceeded: boolean;
  period_start: number;
}

export class QuotaExceededError extends Error {
  constructor(
    public readonly type: "llm_tokens" | "image_count" | "total_cost",
    public readonly used: number,
    public readonly limit: number,
    public readonly periodType: "rolling" | "fixed",
    public readonly periodDays: number
  ) {
    const typeLabel = {
      llm_tokens: "tokens",
      image_count: "images",
      total_cost: "cost",
    }[type];
    super(
      `Quota exceeded: ${used.toLocaleString()} / ${limit.toLocaleString()} ${typeLabel} used`
    );
    this.name = "QuotaExceededError";
  }

  toUserMessage(): string {
    const typeLabel = {
      llm_tokens: "tokens",
      image_count: "images",
      total_cost: "credits",
    }[this.type];

    if (this.periodType === "rolling") {
      return `You've used ${this.used.toLocaleString()} ${typeLabel} in the last ${this.periodDays} day${this.periodDays === 1 ? "" : "s"} (limit: ${this.limit.toLocaleString()}). Try again later.`;
    }
    return `You've reached your ${typeLabel} limit of ${this.limit.toLocaleString()}. Limit resets at the start of the next period.`;
  }
}

// === Period Calculation ===

/**
 * Get the start of the current quota window.
 * @param period - The quota period configuration
 * @param anchor - For fixed periods, the anchor timestamp (default: 0 = Unix epoch)
 * @returns Unix timestamp in seconds
 */
export function getWindowStart(period: QuotaPeriod, anchor = 0): number {
  const nowSec = Math.floor(Date.now() / 1000);
  const periodSec = period.days * 86400;

  if (period.type === "rolling") {
    return nowSec - periodSec;
  }

  // Fixed: find current period start from anchor
  const elapsed = nowSec - anchor;
  return anchor + Math.floor(elapsed / periodSec) * periodSec;
}

// === Usage Logging ===

/**
 * Log a usage entry after a successful operation.
 */
export function logUsage(entry: UsageEntry): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO usage (user_id, guild_id, type, model, tokens_in, tokens_out, cost_millicents, key_source, key_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.user_id,
    entry.guild_id ?? null,
    entry.type,
    entry.model,
    entry.tokens_in ?? null,
    entry.tokens_out ?? null,
    entry.cost_millicents,
    entry.key_source ?? null,
    entry.key_id ?? null
  );
}

// === Quota Checking ===

/**
 * Get current usage within the quota period.
 */
export function getUsage(
  userId: string,
  windowStart: number,
  guildId?: string
): { llm_tokens: number; image_count: number; total_cost: number } {
  const db = getDb();

  // If guildId provided, filter by guild; otherwise, all usage for user
  const whereClause = guildId
    ? "user_id = ? AND created_at > ? AND guild_id = ?"
    : "user_id = ? AND created_at > ?";
  const params = guildId
    ? [userId, windowStart, guildId]
    : [userId, windowStart];

  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'llm' THEN tokens_out ELSE 0 END), 0) as llm_tokens,
      COALESCE(SUM(CASE WHEN type = 'image' THEN 1 ELSE 0 END), 0) as image_count,
      COALESCE(SUM(cost_millicents), 0) as total_cost
    FROM usage
    WHERE ${whereClause}
  `).get(...params) as {
    llm_tokens: number;
    image_count: number;
    total_cost: number;
  };

  return row;
}

/**
 * Check if user is within quota limits.
 */
export function checkQuota(
  userId: string,
  config: QuotaConfig,
  guildId?: string
): QuotaStatus {
  if (!config.enabled) {
    return {
      llm_tokens: { used: 0 },
      image_count: { used: 0 },
      total_cost: { used: 0 },
      exceeded: false,
      period_start: 0,
    };
  }

  const windowStart = getWindowStart(config.period);
  const usage = getUsage(userId, windowStart, guildId);

  // Apply guild overrides if present
  const limits = guildId && config.guild_overrides?.[guildId]
    ? { ...config.limits, ...config.guild_overrides[guildId] }
    : config.limits;

  const llm_tokens = {
    used: usage.llm_tokens,
    limit: limits.llm_tokens,
    remaining: limits.llm_tokens !== undefined
      ? Math.max(0, limits.llm_tokens - usage.llm_tokens)
      : undefined,
  };

  const image_count = {
    used: usage.image_count,
    limit: limits.image_count,
    remaining: limits.image_count !== undefined
      ? Math.max(0, limits.image_count - usage.image_count)
      : undefined,
  };

  const total_cost = {
    used: usage.total_cost,
    limit: limits.total_cost,
    remaining: limits.total_cost !== undefined
      ? Math.max(0, limits.total_cost - usage.total_cost)
      : undefined,
  };

  const exceeded =
    (llm_tokens.limit !== undefined && usage.llm_tokens >= llm_tokens.limit) ||
    (image_count.limit !== undefined && usage.image_count >= image_count.limit) ||
    (total_cost.limit !== undefined && usage.total_cost >= total_cost.limit);

  return {
    llm_tokens,
    image_count,
    total_cost,
    exceeded,
    period_start: windowStart,
  };
}

/**
 * Enforce quota before an operation. Throws QuotaExceededError if exceeded.
 */
export function enforceQuota(
  userId: string,
  config: QuotaConfig,
  type: "llm" | "image",
  guildId?: string
): void {
  if (!config.enabled) return;

  const status = checkQuota(userId, config, guildId);

  // Check type-specific limit
  if (type === "llm" && status.llm_tokens.limit !== undefined) {
    if (status.llm_tokens.used >= status.llm_tokens.limit) {
      throw new QuotaExceededError(
        "llm_tokens",
        status.llm_tokens.used,
        status.llm_tokens.limit,
        config.period.type,
        config.period.days
      );
    }
  }

  if (type === "image" && status.image_count.limit !== undefined) {
    if (status.image_count.used >= status.image_count.limit) {
      throw new QuotaExceededError(
        "image_count",
        status.image_count.used,
        status.image_count.limit,
        config.period.type,
        config.period.days
      );
    }
  }

  // Check total cost limit
  if (status.total_cost.limit !== undefined) {
    if (status.total_cost.used >= status.total_cost.limit) {
      throw new QuotaExceededError(
        "total_cost",
        status.total_cost.used,
        status.total_cost.limit,
        config.period.type,
        config.period.days
      );
    }
  }
}

// === Cost Calculation ===

/** Model cost table in millicents (1/1000 of a cent) */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // Google
  "google:gemini-3-flash-preview": { input: 0.075, output: 0.30 },
  "google:gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "google:gemini-2.5-pro": { input: 1.25, output: 10.0 },
  // Anthropic
  "anthropic:claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "anthropic:claude-haiku-3-5-20241022": { input: 0.80, output: 4.0 },
  // OpenAI
  "openai:gpt-4o": { input: 2.50, output: 10.0 },
  "openai:gpt-4o-mini": { input: 0.15, output: 0.60 },
};

/** Default cost per million tokens if model not in table */
const DEFAULT_COST = { input: 1.0, output: 5.0 };

/**
 * Calculate cost in millicents for an LLM call.
 * Costs are per million tokens, converted to millicents.
 */
export function calculateLLMCost(
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  const costs = MODEL_COSTS[model] ?? DEFAULT_COST;
  // costs are per 1M tokens in dollars, convert to millicents
  // $1 = 100 cents = 100,000 millicents
  const inputCost = (tokensIn / 1_000_000) * costs.input * 100_000;
  const outputCost = (tokensOut / 1_000_000) * costs.output * 100_000;
  return Math.ceil(inputCost + outputCost);
}

/** Fixed cost per image in millicents */
const IMAGE_COSTS: Record<string, number> = {
  "comfyui:flux": 1000,         // ~$0.01
  "comfyui:sdxl": 500,          // ~$0.005
  default: 1000,
};

/**
 * Calculate cost in millicents for an image generation.
 */
export function calculateImageCost(model: string): number {
  return IMAGE_COSTS[model] ?? IMAGE_COSTS.default;
}

// === Formatting ===

/**
 * Format quota status for display (e.g., /quota command).
 */
export function formatQuotaStatus(status: QuotaStatus, config: QuotaConfig): string {
  const lines: string[] = [];

  const periodDesc = config.period.type === "rolling"
    ? `Rolling ${config.period.days}-day window`
    : `${config.period.days}-day fixed period`;

  lines.push(`**Quota Status** (${periodDesc})`);
  lines.push("");

  if (status.llm_tokens.limit !== undefined) {
    const pct = Math.round((status.llm_tokens.used / status.llm_tokens.limit) * 100);
    const bar = progressBar(pct);
    lines.push(`**LLM Tokens:** ${status.llm_tokens.used.toLocaleString()} / ${status.llm_tokens.limit.toLocaleString()}`);
    lines.push(`${bar} ${pct}%`);
  }

  if (status.image_count.limit !== undefined) {
    const pct = Math.round((status.image_count.used / status.image_count.limit) * 100);
    const bar = progressBar(pct);
    lines.push(`**Images:** ${status.image_count.used} / ${status.image_count.limit}`);
    lines.push(`${bar} ${pct}%`);
  }

  if (status.total_cost.limit !== undefined) {
    const pct = Math.round((status.total_cost.used / status.total_cost.limit) * 100);
    const bar = progressBar(pct);
    const usedDollars = (status.total_cost.used / 100_000).toFixed(3);
    const limitDollars = (status.total_cost.limit / 100_000).toFixed(2);
    lines.push(`**Cost:** $${usedDollars} / $${limitDollars}`);
    lines.push(`${bar} ${pct}%`);
  }

  if (status.exceeded) {
    lines.push("");
    lines.push("**Quota exceeded.** Wait for the period to reset or contact an admin.");
  }

  return lines.join("\n");
}

function progressBar(percent: number, width = 10): string {
  const filled = Math.min(width, Math.round((percent / 100) * width));
  const empty = width - filled;
  return `[${"=".repeat(filled)}${" ".repeat(empty)}]`;
}
