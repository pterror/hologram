/**
 * BYOK (Bring Your Own Key) - API Key Management
 *
 * Handles encrypted storage and resolution of user/guild API keys.
 * Uses AES-256-GCM with scrypt-derived per-key encryption.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { getDb } from "../db";

// =============================================================================
// Types
// =============================================================================

export type LLMProvider = "google" | "anthropic" | "openai";
export type ImageProvider =
  | "runcomfy"
  | "runcomfy-serverless"
  | "saladcloud"
  | "runpod";
export type Provider = LLMProvider | ImageProvider;

export const LLM_PROVIDERS: LLMProvider[] = ["google", "anthropic", "openai"];
export const IMAGE_PROVIDERS: ImageProvider[] = [
  "runcomfy",
  "runcomfy-serverless",
  "saladcloud",
  "runpod",
];
export const ALL_PROVIDERS: Provider[] = [...LLM_PROVIDERS, ...IMAGE_PROVIDERS];

export interface ApiKeyRecord {
  id: number;
  guildId: string | null;
  userId: string | null;
  provider: Provider;
  keyName: string | null;
  lastUsedAt: number | null;
  lastValidatedAt: number | null;
  validationStatus: "valid" | "invalid" | "pending" | "expired";
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedKey {
  key: string;
  source: "user" | "guild" | "env";
  keyId?: number;
}

type KeyScope = { guildId: string } | { userId: string };

// =============================================================================
// Master Key Management
// =============================================================================

let masterKeyCache: Buffer | null = null;

function getMasterKey(): Buffer | null {
  if (masterKeyCache) return masterKeyCache;

  const masterKeyHex = process.env.BYOK_MASTER_KEY;
  if (!masterKeyHex) {
    return null; // BYOK disabled
  }

  if (masterKeyHex.length !== 64) {
    throw new Error(
      "BYOK_MASTER_KEY must be 32 bytes (64 hex chars). Generate with: openssl rand -hex 32"
    );
  }

  masterKeyCache = Buffer.from(masterKeyHex, "hex");
  return masterKeyCache;
}

export function isByokEnabled(): boolean {
  return getMasterKey() !== null;
}

// =============================================================================
// Encryption
// =============================================================================

export function encryptKey(plaintext: string): {
  encrypted: string;
  salt: string;
  nonce: string;
} {
  const masterKey = getMasterKey();
  if (!masterKey) {
    throw new Error("BYOK_MASTER_KEY not configured");
  }

  const salt = randomBytes(16);
  const nonce = randomBytes(12);

  // Derive per-key encryption key using scrypt
  const derivedKey = scryptSync(masterKey, salt, 32);

  const cipher = createCipheriv("aes-256-gcm", derivedKey, nonce);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return {
    encrypted: encrypted.toString("base64"),
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
  };
}

export function decryptKey(
  encrypted: string,
  salt: string,
  nonce: string
): string {
  const masterKey = getMasterKey();
  if (!masterKey) {
    throw new Error("BYOK_MASTER_KEY not configured");
  }

  const saltBuf = Buffer.from(salt, "base64");
  const nonceBuf = Buffer.from(nonce, "base64");
  const encryptedBuf = Buffer.from(encrypted, "base64");

  // Auth tag is last 16 bytes
  const authTag = encryptedBuf.subarray(-16);
  const ciphertext = encryptedBuf.subarray(0, -16);

  const derivedKey = scryptSync(masterKey, saltBuf, 32);
  const decipher = createDecipheriv("aes-256-gcm", derivedKey, nonceBuf);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}

// =============================================================================
// Key CRUD Operations
// =============================================================================

function mapKeyRow(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: row.id as number,
    guildId: row.guild_id as string | null,
    userId: row.user_id as string | null,
    provider: row.provider as Provider,
    keyName: row.key_name as string | null,
    lastUsedAt: row.last_used_at as number | null,
    lastValidatedAt: row.last_validated_at as number | null,
    validationStatus: row.validation_status as ApiKeyRecord["validationStatus"],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export function storeApiKey(
  scope: KeyScope,
  provider: Provider,
  apiKey: string,
  keyName?: string
): ApiKeyRecord {
  const db = getDb();
  const { encrypted, salt, nonce } = encryptKey(apiKey);

  const guildId = "guildId" in scope ? scope.guildId : null;
  const userId = "userId" in scope ? scope.userId : null;

  const row = db
    .prepare(
      `
    INSERT INTO api_keys (guild_id, user_id, provider, key_name, encrypted_key, salt, nonce)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET
      encrypted_key = excluded.encrypted_key,
      salt = excluded.salt,
      nonce = excluded.nonce,
      validation_status = 'pending',
      updated_at = unixepoch()
    RETURNING id, guild_id, user_id, provider, key_name, last_used_at,
              last_validated_at, validation_status, created_at, updated_at
  `
    )
    .get(
      guildId,
      userId,
      provider,
      keyName ?? null,
      encrypted,
      salt,
      nonce
    ) as Record<string, unknown>;

  return mapKeyRow(row);
}

export function deleteApiKey(
  scope: KeyScope,
  provider: Provider,
  keyName?: string
): boolean {
  const db = getDb();
  const guildId = "guildId" in scope ? scope.guildId : null;
  const userId = "userId" in scope ? scope.userId : null;

  const result = db
    .prepare(
      `
    DELETE FROM api_keys
    WHERE guild_id IS ? AND user_id IS ? AND provider = ? AND key_name IS ?
  `
    )
    .run(guildId, userId, provider, keyName ?? null);

  return result.changes > 0;
}

export function listApiKeys(scope: KeyScope): ApiKeyRecord[] {
  const db = getDb();
  const guildId = "guildId" in scope ? scope.guildId : null;
  const userId = "userId" in scope ? scope.userId : null;

  const rows = db
    .prepare(
      `
    SELECT id, guild_id, user_id, provider, key_name, last_used_at,
           last_validated_at, validation_status, created_at, updated_at
    FROM api_keys
    WHERE guild_id IS ? AND user_id IS ?
    ORDER BY provider, key_name
  `
    )
    .all(guildId, userId) as Array<Record<string, unknown>>;

  return rows.map(mapKeyRow);
}

export function getApiKeyById(keyId: number): ApiKeyRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `
    SELECT id, guild_id, user_id, provider, key_name, last_used_at,
           last_validated_at, validation_status, created_at, updated_at
    FROM api_keys WHERE id = ?
  `
    )
    .get(keyId) as Record<string, unknown> | undefined;

  return row ? mapKeyRow(row) : null;
}

// =============================================================================
// Key Resolution
// =============================================================================

const ENV_KEY_MAP: Record<Provider, string> = {
  google: "GOOGLE_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  runcomfy: "RUNCOMFY_API_KEY",
  "runcomfy-serverless": "RUNCOMFY_SERVERLESS_API_KEY",
  saladcloud: "SALADCLOUD_API_KEY",
  runpod: "RUNPOD_API_KEY",
};

function getEnvKeyForProvider(provider: Provider): string | undefined {
  return process.env[ENV_KEY_MAP[provider]];
}

function updateLastUsed(keyId: number): void {
  const db = getDb();
  db.prepare("UPDATE api_keys SET last_used_at = unixepoch() WHERE id = ?").run(
    keyId
  );
}

/**
 * Resolve API key with priority: user -> guild -> env
 * Keys marked as 'invalid' are skipped.
 */
export function resolveApiKey(
  provider: Provider,
  userId: string,
  guildId?: string
): ResolvedKey | null {
  const db = getDb();

  // Try user key first (if BYOK is enabled)
  if (isByokEnabled()) {
    const userRow = db
      .prepare(
        `
      SELECT id, encrypted_key, salt, nonce FROM api_keys
      WHERE user_id = ? AND provider = ? AND validation_status != 'invalid'
      ORDER BY key_name NULLS FIRST LIMIT 1
    `
      )
      .get(userId, provider) as
      | { id: number; encrypted_key: string; salt: string; nonce: string }
      | undefined;

    if (userRow) {
      updateLastUsed(userRow.id);
      return {
        key: decryptKey(userRow.encrypted_key, userRow.salt, userRow.nonce),
        source: "user",
        keyId: userRow.id,
      };
    }

    // Try guild key
    if (guildId) {
      const guildRow = db
        .prepare(
          `
        SELECT id, encrypted_key, salt, nonce FROM api_keys
        WHERE guild_id = ? AND provider = ? AND validation_status != 'invalid'
        ORDER BY key_name NULLS FIRST LIMIT 1
      `
        )
        .get(guildId, provider) as
        | { id: number; encrypted_key: string; salt: string; nonce: string }
        | undefined;

      if (guildRow) {
        updateLastUsed(guildRow.id);
        return {
          key: decryptKey(guildRow.encrypted_key, guildRow.salt, guildRow.nonce),
          source: "guild",
          keyId: guildRow.id,
        };
      }
    }
  }

  // Fall back to environment variable
  const envKey = getEnvKeyForProvider(provider);
  if (envKey) {
    return { key: envKey, source: "env" };
  }

  return null;
}

// =============================================================================
// Key Validation
// =============================================================================

export function updateValidationStatus(
  keyId: number,
  status: "valid" | "invalid" | "pending" | "expired"
): void {
  const db = getDb();
  db.prepare(
    `
    UPDATE api_keys SET validation_status = ?, last_validated_at = unixepoch()
    WHERE id = ?
  `
  ).run(status, keyId);
}

/**
 * Validate an API key against the provider's API.
 * Returns true if the key is valid, false otherwise.
 */
export async function validateApiKey(
  provider: Provider,
  apiKey: string
): Promise<boolean> {
  switch (provider) {
    case "google":
      return validateGoogleKey(apiKey);
    case "anthropic":
      return validateAnthropicKey(apiKey);
    case "openai":
      return validateOpenAIKey(apiKey);
    case "runcomfy":
    case "runcomfy-serverless":
      return validateRunComfyKey(apiKey);
    case "saladcloud":
      return validateSaladCloudKey(apiKey);
    case "runpod":
      return validateRunPodKey(apiKey);
    default:
      return true; // Assume valid for unknown providers
  }
}

async function validateGoogleKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { method: "GET" }
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function validateAnthropicKey(apiKey: string): Promise<boolean> {
  try {
    // Anthropic doesn't have a cheap validation endpoint.
    // We check for auth errors without actually completing a request.
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      }),
    });
    // 401/403 = invalid key, anything else means key works
    return res.status !== 401 && res.status !== 403;
  } catch {
    return false;
  }
}

async function validateOpenAIKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function validateRunComfyKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.runcomfy.com/v1/runs", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    // 401/403 = invalid key
    return res.status !== 401 && res.status !== 403;
  } catch {
    return false;
  }
}

async function validateSaladCloudKey(apiKey: string): Promise<boolean> {
  try {
    // SaladCloud API validation
    const res = await fetch("https://api.salad.com/api/public/organizations", {
      method: "GET",
      headers: {
        "Salad-Api-Key": apiKey,
      },
    });
    return res.status !== 401 && res.status !== 403;
  } catch {
    return false;
  }
}

async function validateRunPodKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.runpod.io/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: "{ myself { id } }",
      }),
    });
    return res.status !== 401 && res.status !== 403;
  } catch {
    return false;
  }
}
