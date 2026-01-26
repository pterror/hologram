# BYOK (Bring Your Own Key) Design

Allow users and guilds to provide their own API keys for LLM and image generation providers.

## Goals

- Enable users to use their own API keys for providers
- Support both personal (user) and server-wide (guild) keys
- Secure storage with encryption at rest
- Transparent key resolution with clear priority
- Track which key was used for billing/analytics

## Key Resolution Order

1. **User key** - Personal key for the specific provider
2. **Guild key** - Server-wide key (requires MANAGE_GUILD permission to set)
3. **Environment variable** - Bot operator's default key

Keys marked as `invalid` are skipped in resolution.

## Schema

Single table for all API keys with scope discrimination:

```sql
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY,
  guild_id TEXT,                    -- NULL for user keys
  user_id TEXT,                     -- NULL for guild keys
  provider TEXT NOT NULL,           -- 'google', 'anthropic', 'openai', etc.
  key_name TEXT,                    -- Optional label ('primary', 'backup')
  encrypted_key TEXT NOT NULL,      -- Base64-encoded AES-256-GCM payload
  salt TEXT NOT NULL,               -- Per-key salt (16 bytes, base64)
  nonce TEXT NOT NULL,              -- Per-key nonce/IV (12 bytes, base64)
  last_used_at INTEGER,
  last_validated_at INTEGER,
  validation_status TEXT DEFAULT 'pending',  -- 'valid', 'invalid', 'pending', 'expired'
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(guild_id, provider, key_name),
  UNIQUE(user_id, provider, key_name),
  CHECK((guild_id IS NULL) != (user_id IS NULL))  -- XOR: exactly one scope
);

CREATE INDEX idx_api_keys_guild ON api_keys(guild_id, provider);
CREATE INDEX idx_api_keys_user ON api_keys(user_id, provider);
```

The XOR constraint ensures each key is either user-scoped OR guild-scoped, never both or neither.

## Encryption

Keys are encrypted at rest using AES-256-GCM with per-key salt:

```ts
function encryptKey(plaintext: string): { encrypted: string; salt: string; nonce: string } {
  const masterKey = getMasterKey();  // From BYOK_MASTER_KEY env var
  const salt = randomBytes(16);
  const nonce = randomBytes(12);

  // Derive per-key encryption key using scrypt
  const derivedKey = scryptSync(masterKey, salt, 32);

  const cipher = createCipheriv("aes-256-gcm", derivedKey, nonce);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),  // 16 bytes appended
  ]);

  return {
    encrypted: encrypted.toString("base64"),
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
  };
}
```

Master key is derived from `BYOK_MASTER_KEY` environment variable (32-byte hex string).

## Supported Providers

### LLM Providers
| Provider | Env Var | Validation Endpoint |
|----------|---------|---------------------|
| `google` | `GOOGLE_API_KEY` | `GET /v1beta/models?key=X` |
| `anthropic` | `ANTHROPIC_API_KEY` | `POST /v1/messages` (check 401/403) |
| `openai` | `OPENAI_API_KEY` | `GET /v1/models` |

### Image Providers
| Provider | Env Var | Validation Endpoint |
|----------|---------|---------------------|
| `runcomfy` | `RUNCOMFY_API_KEY` | `GET /v1/runs` |
| `runcomfy-serverless` | `RUNCOMFY_SERVERLESS_API_KEY` | Deployment-specific |
| `saladcloud` | `SALADCLOUD_API_KEY` | `GET /organizations` |
| `runpod` | `RUNPOD_API_KEY` | GraphQL `myself { id }` |

## API

```ts
// src/ai/keys.ts

type LLMProvider = "google" | "anthropic" | "openai";
type ImageProvider = "runcomfy" | "runcomfy-serverless" | "saladcloud" | "runpod";
type Provider = LLMProvider | ImageProvider;

interface ResolvedKey {
  key: string;
  source: "user" | "guild" | "env";
  keyId?: number;  // For DB keys, to track usage
}

// Store a new key (encrypts automatically)
function storeApiKey(
  scope: { guildId: string } | { userId: string },
  provider: Provider,
  apiKey: string,
  keyName?: string
): ApiKeyRecord;

// Resolve key with priority chain
function resolveApiKey(
  provider: Provider,
  userId: string,
  guildId?: string
): ResolvedKey | null;

// Validate key against provider API
async function validateApiKey(provider: Provider, apiKey: string): Promise<boolean>;

// Update validation status after test
function updateValidationStatus(keyId: number, status: "valid" | "invalid" | "pending" | "expired"): void;

// Check if BYOK is enabled
function isByokEnabled(): boolean;  // True if BYOK_MASTER_KEY is set
```

## Usage Tracking

Extended `usage` table to track key source:

```sql
ALTER TABLE usage ADD COLUMN key_source TEXT;  -- 'user', 'guild', 'env'
ALTER TABLE usage ADD COLUMN key_id INTEGER;   -- Reference to api_keys.id
```

This enables:
- Analytics on BYOK adoption
- Cost attribution per key
- Different quota treatment for BYOK users

## Command Interface

```
/keys add <provider> <scope>    - Opens modal for secure key input
/keys list [scope]              - View configured keys (user/guild/all)
/keys remove <provider> <scope> - Remove a key
/keys test <provider>           - Validate the resolved key
/keys status                    - Show BYOK status and active keys per provider
```

Guild scope requires `MANAGE_GUILD` permission.

Keys are entered via Discord modal (TextInput component) - never visible in chat history.

## Integration Points

### LLM Middleware (`src/plugins/core/index.ts`)

```ts
const llmMiddleware: Middleware = {
  fn: async (ctx, next) => {
    const modelSpec = process.env.DEFAULT_MODEL || DEFAULT_MODEL;
    const { providerName } = parseModelSpec(modelSpec);

    // Resolve API key
    const resolved = resolveApiKey(providerName, ctx.authorId, ctx.guildId);
    if (!resolved) {
      ctx.response = `No API key configured for ${providerName}.`;
      return next();
    }

    // Create model with resolved key
    const model = getLanguageModel(modelSpec, resolved.key);

    // ... call LLM ...

    // Track key source in usage
    logUsage({
      ...entry,
      key_source: resolved.source,
      key_id: resolved.keyId,
    });
  }
};
```

### Image Hosts (`src/images/hosts.ts`)

```ts
function getComfyHost(config: ImageConfig, context?: { userId?: string; guildId?: string }): ComfyUIHost {
  const { userId, guildId } = context || {};

  switch (config.host) {
    case "runcomfy": {
      const resolved = userId ? resolveApiKey("runcomfy", userId, guildId) : null;
      const apiKey = resolved?.key || process.env.RUNCOMFY_API_KEY;
      if (!apiKey) throw new Error("RunComfy API key not configured");
      return new RunComfyHost(apiKey);
    }
    // ... other hosts
  }
}
```

## Security Considerations

1. **Encryption at rest** - All keys encrypted with AES-256-GCM
2. **Per-key derivation** - Each key has unique salt/nonce
3. **Master key rotation** - Requires re-encryption of all keys (not implemented)
4. **No key display** - Keys never shown after storage
5. **Modal input** - Keys entered via modal, not visible in chat
6. **Permission check** - Guild keys require MANAGE_GUILD
7. **Validation tracking** - Invalid keys marked and skipped

## Environment

```bash
# Required for BYOK functionality
# Generate with: openssl rand -hex 32
BYOK_MASTER_KEY=your-64-char-hex-key
```

If not set, BYOK is disabled and only environment variable keys are used.

## Files

| File | Purpose |
|------|---------|
| `src/ai/keys.ts` | Encryption, storage, resolution |
| `src/ai/models.ts` | Factory functions for custom keys |
| `src/bot/commands/keys.ts` | `/keys` command + modal handler |
| `src/db/schema.ts` | `api_keys` table |
| `src/plugins/core/index.ts` | LLM key resolution |
| `src/images/hosts.ts` | Image host key resolution |
| `src/quota/index.ts` | `key_source` tracking |

## Future Enhancements

- Key rotation (re-encrypt all keys with new master key)
- Key expiration (auto-invalidate after N days)
- Usage alerts per key
- Key sharing (invite users to use your key)
- Rate limit handling (retry with fallback key)
