# Usage Quotas Design

Per-user quota system for LLM and image generation usage tracking.

## Goals

- Track granular usage per user (LLM tokens, image generations)
- Support rolling window quotas (preferred) and fixed period
- Enable cost-based limits across mixed usage types
- Minimal overhead for quota checks

## Schema

Single append-only usage table with type discriminator:

```sql
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  guild_id TEXT,              -- nullable for DMs
  type TEXT NOT NULL,         -- 'llm' | 'image'
  model TEXT NOT NULL,        -- 'google:gemini-3-flash-preview' | 'comfyui:flux'
  tokens_in INTEGER,          -- LLM only
  tokens_out INTEGER,         -- LLM only
  cost_millicents INTEGER,    -- normalized cost unit
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_usage_user_window ON usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_guild ON usage(guild_id, created_at);
```

No materialized totals table — aggregate query is fast enough at Discord bot scale with the compound index.

## Quota Periods

```ts
type QuotaPeriod =
  | { type: 'rolling'; days: number }   // look back N days from now
  | { type: 'fixed'; days: number };    // reset every N days from anchor

function getWindowStart(period: QuotaPeriod, anchor?: number): number {
  const now = Date.now();
  if (period.type === 'rolling') {
    return now - period.days * 86400_000;
  }
  // Fixed: find current period start from anchor
  const a = anchor ?? now;
  const elapsed = now - a;
  const periodMs = period.days * 86400_000;
  return a + Math.floor(elapsed / periodMs) * periodMs;
}
```

Rolling window is the default — no "reset day" gaming, smoother UX.

## Quota Config

```ts
interface QuotaConfig {
  enabled: boolean;
  period: QuotaPeriod;
  limits: {
    llm_tokens?: number;     // output tokens per period
    image_count?: number;    // images per period
    total_cost?: number;     // millicents per period (unified cap)
  };
  // Per-guild overrides (optional)
  guild_overrides?: Record<string, Partial<QuotaConfig['limits']>>;
}
```

Add to WorldConfig as `quota?: QuotaConfig`.

## Usage Query

Same query works for both period types:

```sql
SELECT
  COALESCE(SUM(CASE WHEN type = 'llm' THEN tokens_out ELSE 0 END), 0) as llm_tokens,
  COALESCE(SUM(CASE WHEN type = 'image' THEN 1 ELSE 0 END), 0) as image_count,
  COALESCE(SUM(cost_millicents), 0) as total_cost
FROM usage
WHERE user_id = ? AND created_at > ?
```

## Cost Normalization

Normalize all costs to millicents (1/1000 of a cent) for precision:

| Model | Input (per 1M) | Output (per 1M) | Image (each) |
|-------|----------------|-----------------|--------------|
| gemini-3-flash | $0.075 | $0.30 | — |
| claude-sonnet | $3.00 | $15.00 | — |
| comfyui:flux | — | — | ~$0.01 |

Store as integer millicents to avoid float issues.

## Enforcement Points

1. **LLM calls** (`src/ai/models.ts` or core plugin)
   - Check quota before calling
   - Log usage after response with actual token counts

2. **Image generation** (`src/plugins/images/`)
   - Check quota before generation
   - Log usage after successful generation

## API

```ts
// src/quota/index.ts

interface UsageEntry {
  user_id: string;
  guild_id?: string;
  type: 'llm' | 'image';
  model: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_millicents: number;
}

// Log usage after successful operation
function logUsage(db: Database, entry: UsageEntry): void;

// Check if user is within quota (returns remaining or null if unlimited)
interface QuotaStatus {
  llm_tokens: { used: number; limit?: number; remaining?: number };
  image_count: { used: number; limit?: number; remaining?: number };
  total_cost: { used: number; limit?: number; remaining?: number };
  exceeded: boolean;
}
function checkQuota(db: Database, userId: string, config: QuotaConfig): QuotaStatus;

// Middleware-friendly check (throws if exceeded)
function enforceQuota(db: Database, userId: string, config: QuotaConfig, type: 'llm' | 'image'): void;
```

## User Feedback

When quota exceeded, return friendly message:

```
You've reached your daily limit of 100 images. Limit resets in 14 hours.
```

For rolling window:
```
You've used 50,000 tokens in the last 24 hours (limit: 50,000). Try again later.
```

## Files to Create/Modify

- `src/db/schema.ts` — add usage table + migration
- `src/quota/index.ts` — quota logic (logUsage, checkQuota, enforceQuota)
- `src/config/types.ts` — add QuotaConfig to WorldConfig
- `src/config/defaults.ts` — add quota defaults (disabled by default)
- `src/plugins/core/index.ts` — integrate quota check before LLM
- `src/plugins/images/index.ts` — integrate quota check before image gen
- `src/bot/commands/quota.ts` — `/quota status` command (optional)

## Future Enhancements

- Per-guild quotas (guild admins set limits for their server)
- Quota tiers (free/premium user classes)
- Usage analytics dashboard
- Cost alerts (80% warning)
