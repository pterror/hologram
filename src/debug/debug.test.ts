import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";

// =============================================================================
// In-memory DB mock
// =============================================================================

let testDb: Database;

mock.module("../db/index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

// Mock embeddings module (avoid loading actual ML model in tests)
mock.module("../ai/embeddings", () => ({
  isEmbeddingModelLoaded: () => false,
  MODEL_NAME: "test-model",
  EMBEDDING_DIMENSIONS: 384,
  getEmbeddingCacheStats: () => ({ size: 0, maxSize: 500, ttlMs: 300000 }),
  embed: async (_text: string) => new Float32Array(384).fill(0.1),
  cosineSimilarity: (_a: Float32Array, _b: Float32Array) => 0.85,
  clearEmbeddingCache: () => {},
}));

import {
  getEmbeddingStatus,
  getEmbeddingCoverage,
  getBindingGraph,
  getMemoryStats,
  getEvalErrors,
  getActiveEffectsDebug,
  getMessageStats,
  traceFacts,
  simulateResponse,
  buildEvaluatedEntity,
} from "./index";

import { createBaseContext } from "../logic/expr";

function testContext(overrides: Partial<Parameters<typeof createBaseContext>[0]> = {}) {
  return createBaseContext({
    facts: [],
    has_fact: () => false,
    messages: () => "",
    response_ms: 0,
    retry_ms: 0,
    idle_ms: 0,
    unread_count: 0,
    mentioned: false,
    replied: false,
    replied_to: "",
    is_forward: false,
    is_self: false,
    is_hologram: false,
    interaction_type: "",
    name: "",
    chars: [],
    channel: { id: "", name: "", description: "", is_nsfw: false, type: "text", mention: "" },
    server: { id: "", name: "", description: "", nsfw_level: "default" },
    ...overrides,
  });
}

import { createEntity, addFact, getEntityWithFacts, setEntityConfig } from "../db/entities";
import {
  addDiscordEntity,
  addMessage,
  recordEvalError,
} from "../db/discord";

function createTestSchema(db: Database) {
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owned_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      template TEXT,
      system_template TEXT,
      config_context TEXT,
      config_model TEXT,
      config_respond TEXT,
      config_stream_mode TEXT,
      config_stream_delimiters TEXT,
      config_avatar TEXT,
      config_memory TEXT,
      config_freeform INTEGER DEFAULT 0,
      config_strip TEXT,
      config_view TEXT,
      config_edit TEXT,
      config_use TEXT,
      config_blacklist TEXT,
      config_thinking TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL,
      discord_type TEXT NOT NULL CHECK (discord_type IN ('user', 'channel', 'guild')),
      scope_guild_id TEXT,
      scope_channel_id TEXT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      UNIQUE (discord_id, discord_type, scope_guild_id, scope_channel_id, entity_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      source_message_id TEXT,
      source_channel_id TEXT,
      source_guild_id TEXT,
      frecency REAL DEFAULT 1.0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Use regular tables instead of vec0 virtual tables for testing
  db.exec(`
    CREATE TABLE IF NOT EXISTS fact_embeddings (
      fact_id INTEGER PRIMARY KEY,
      embedding BLOB
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_embeddings (
      memory_id INTEGER PRIMARY KEY,
      embedding BLOB
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      discord_message_id TEXT,
      data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_messages (
      message_id TEXT PRIMARY KEY,
      entity_id INTEGER NOT NULL,
      entity_name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      error_message TEXT NOT NULL,
      condition TEXT,
      notified_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (entity_id, error_message)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_forgets (
      channel_id TEXT PRIMARY KEY,
      forget_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_config (
      discord_id TEXT NOT NULL,
      discord_type TEXT NOT NULL CHECK (discord_type IN ('channel', 'guild')),
      config_bind TEXT,
      config_persona TEXT,
      config_blacklist TEXT,
      PRIMARY KEY (discord_id, discord_type)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL UNIQUE,
      webhook_id TEXT NOT NULL,
      webhook_token TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS welcomed_users (
      discord_id TEXT PRIMARY KEY,
      welcomed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_effects_entity ON effects(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_effects_expires ON effects(expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_entity ON entity_memories(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_discord_id ON messages(discord_message_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_errors_owner ON eval_errors(owner_id, notified_at)`);
}

// =============================================================================
// Embeddings Debug
// =============================================================================

describe("getEmbeddingStatus", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns status with model info", () => {
    const status = getEmbeddingStatus();
    expect(status.modelName).toBe("test-model");
    expect(status.dimensions).toBe(384);
    expect(status.loaded).toBe(false);
    expect(status.cache.max).toBe(500);
  });
});

describe("getEmbeddingCoverage", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("reports zero coverage for entity with no embeddings", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "has silver hair");
    addFact(entity.id, "is a character");

    const coverage = getEmbeddingCoverage(entity.id);
    expect(coverage.entityId).toBe(entity.id);
    expect(coverage.facts.total).toBe(2);
    expect(coverage.facts.withEmbedding).toBe(0);
    expect(coverage.facts.missingIds).toHaveLength(2);
    expect(coverage.memories.total).toBe(0);
  });

  test("reports coverage when embeddings exist", () => {
    const entity = createEntity("Aria", "owner1");
    const fact1 = addFact(entity.id, "has silver hair");
    addFact(entity.id, "is a character");

    // Insert a fake embedding for one fact
    testDb.prepare("INSERT INTO fact_embeddings (fact_id, embedding) VALUES (?, ?)").run(
      fact1.id, new Float32Array(384).fill(0.1),
    );

    const coverage = getEmbeddingCoverage(entity.id);
    expect(coverage.facts.withEmbedding).toBe(1);
    expect(coverage.facts.missingIds).toHaveLength(1);
  });

  test("handles entity with no facts", () => {
    const entity = createEntity("Empty", "owner1");
    const coverage = getEmbeddingCoverage(entity.id);
    expect(coverage.facts.total).toBe(0);
    expect(coverage.facts.withEmbedding).toBe(0);
    expect(coverage.facts.missingIds).toHaveLength(0);
  });
});

// =============================================================================
// State Debug
// =============================================================================

describe("getBindingGraph", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns all bindings when no filter", () => {
    const entity = createEntity("Aria", "owner1");
    addDiscordEntity("channel-1", "channel", entity.id);
    addDiscordEntity("guild-1", "guild", entity.id);

    const graph = getBindingGraph();
    expect(graph.total).toBe(2);
    expect(graph.bindings[0].entityName).toBe("Aria");
  });

  test("filters by guild", () => {
    const entity = createEntity("Aria", "owner1");
    addDiscordEntity("channel-1", "channel", entity.id);
    addDiscordEntity("guild-1", "guild", entity.id);

    const graph = getBindingGraph("guild-1");
    expect(graph.total).toBe(1);
    expect(graph.bindings[0].discordId).toBe("guild-1");
  });

  test("returns empty graph for no bindings", () => {
    const graph = getBindingGraph();
    expect(graph.total).toBe(0);
    expect(graph.bindings).toHaveLength(0);
  });
});

describe("getMemoryStats", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns stats for entity with no memories", () => {
    const entity = createEntity("Aria", "owner1");
    const stats = getMemoryStats(entity.id);
    expect(stats.total).toBe(0);
    expect(stats.frecency).toBeNull();
    expect(stats.embeddingCount).toBe(0);
  });

  test("returns stats for entity with memories", () => {
    const entity = createEntity("Aria", "owner1");
    testDb.prepare(`
      INSERT INTO entity_memories (entity_id, content, source_channel_id, frecency) VALUES (?, ?, ?, ?)
    `).run(entity.id, "met user at tavern", "ch-1", 1.5);
    testDb.prepare(`
      INSERT INTO entity_memories (entity_id, content, source_guild_id, frecency) VALUES (?, ?, ?, ?)
    `).run(entity.id, "likes cats", "guild-1", 0.8);
    testDb.prepare(`
      INSERT INTO entity_memories (entity_id, content, frecency) VALUES (?, ?, ?)
    `).run(entity.id, "global memory", 2.0);

    const stats = getMemoryStats(entity.id);
    expect(stats.total).toBe(3);
    expect(stats.frecency).not.toBeNull();
    expect(stats.frecency!.min).toBe(0.8);
    expect(stats.frecency!.max).toBe(2.0);
    expect(stats.scopeBreakdown.channel).toBe(1);
    expect(stats.scopeBreakdown.guild).toBe(1);
    expect(stats.scopeBreakdown.global).toBe(1);
  });
});

describe("getEvalErrors", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns empty list when no errors", () => {
    const errors = getEvalErrors();
    expect(errors).toHaveLength(0);
  });

  test("returns errors with entity names", () => {
    const entity = createEntity("Aria", "owner1");
    recordEvalError(entity.id, "owner1", "Unknown identifier: foo", "foo > 1");

    const errors = getEvalErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].entityName).toBe("Aria");
    expect(errors[0].errorMessage).toBe("Unknown identifier: foo");
    expect(errors[0].condition).toBe("foo > 1");
  });

  test("filters by entity", () => {
    const e1 = createEntity("Aria", "owner1");
    const e2 = createEntity("Bob", "owner1");
    recordEvalError(e1.id, "owner1", "error A");
    recordEvalError(e2.id, "owner1", "error B");

    const errors = getEvalErrors(e1.id);
    expect(errors).toHaveLength(1);
    expect(errors[0].entityName).toBe("Aria");
  });
});

describe("getActiveEffectsDebug", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns empty list when no effects", () => {
    const entity = createEntity("Aria", "owner1");
    const effects = getActiveEffectsDebug(entity.id);
    expect(effects).toHaveLength(0);
  });

  test("returns active effects with remaining time", () => {
    const entity = createEntity("Aria", "owner1");
    const futureTime = new Date(Date.now() + 60000).toISOString();
    testDb.prepare(`
      INSERT INTO effects (entity_id, content, source, expires_at) VALUES (?, ?, ?, ?)
    `).run(entity.id, "is glowing", "spell", futureTime);

    const effects = getActiveEffectsDebug(entity.id);
    expect(effects).toHaveLength(1);
    expect(effects[0].content).toBe("is glowing");
    expect(effects[0].source).toBe("spell");
    expect(effects[0].remainingMs).toBeGreaterThan(0);
  });

  test("excludes expired effects", () => {
    const entity = createEntity("Aria", "owner1");
    const pastTime = new Date(Date.now() - 60000).toISOString();
    testDb.prepare(`
      INSERT INTO effects (entity_id, content, expires_at) VALUES (?, ?, ?)
    `).run(entity.id, "was glowing", pastTime);

    const effects = getActiveEffectsDebug(entity.id);
    expect(effects).toHaveLength(0);
  });
});

describe("getMessageStats", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns stats for channel with messages", () => {
    addMessage("ch-1", "user-1", "Alice", "hello");
    addMessage("ch-1", "user-1", "Alice", "world");
    addMessage("ch-1", "user-2", "Bob", "hi");

    const stats = getMessageStats("ch-1");
    expect(stats.totalMessages).toBe(3);
    expect(stats.postForgetCount).toBe(3);
    expect(stats.forgetTime).toBeNull();
    expect(stats.authorBreakdown).toHaveLength(2);
    expect(stats.authorBreakdown[0].name).toBe("Alice");
    expect(stats.authorBreakdown[0].count).toBe(2);
  });

  test("returns zero for empty channel", () => {
    const stats = getMessageStats("ch-empty");
    expect(stats.totalMessages).toBe(0);
    expect(stats.authorBreakdown).toHaveLength(0);
  });
});

// =============================================================================
// Evaluation Debug
// =============================================================================

describe("traceFacts", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns null for nonexistent entity", () => {
    const result = traceFacts(999, "ch-1");
    expect(result).toBeNull();
  });

  test("traces unconditional facts", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "has silver hair");
    addFact(entity.id, "is a character");

    const result = traceFacts(entity.id, "ch-1");
    expect(result).not.toBeNull();
    expect(result!.entityName).toBe("Aria");
    expect(result!.traces).toHaveLength(2);
    expect(result!.traces[0].conditional).toBe(false);
    expect(result!.traces[0].included).toBe(true);
    expect(result!.traces[0].category).toBe("fact");
  });

  test("traces conditional facts with $if", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "$if mentioned: $respond");
    addFact(entity.id, "$if true: glows faintly");
    addFact(entity.id, "$if false: is invisible");

    const result = traceFacts(entity.id, "ch-1");
    expect(result).not.toBeNull();

    // $if mentioned: $respond — mentioned is false in mock context
    expect(result!.traces[0].conditional).toBe(true);
    expect(result!.traces[0].expression).toBe("mentioned");
    expect(result!.traces[0].expressionResult).toBe(false);
    expect(result!.traces[0].included).toBe(false);
    expect(result!.traces[0].category).toBe("$respond");

    // $if true: glows faintly
    expect(result!.traces[1].expressionResult).toBe(true);
    expect(result!.traces[1].included).toBe(true);

    // $if false: is invisible
    expect(result!.traces[2].expressionResult).toBe(false);
    expect(result!.traces[2].included).toBe(false);
  });

  test("handles expression errors gracefully", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "$if badvar123: broken");

    const result = traceFacts(entity.id, "ch-1");
    expect(result).not.toBeNull();
    expect(result!.traces[0].expressionError).not.toBeNull();
    expect(result!.traces[0].expressionResult).toBe(false);
    expect(result!.traces[0].included).toBe(false);
  });

  test("strips comments before tracing", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "$# this is a comment");
    addFact(entity.id, "visible fact");

    const result = traceFacts(entity.id, "ch-1");
    expect(result).not.toBeNull();
    expect(result!.traces).toHaveLength(1);
    expect(result!.traces[0].raw).toBe("visible fact");
  });

  test("categorizes directive facts", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "$respond");
    addFact(entity.id, "$memory channel");
    addFact(entity.id, "$stream full");
    addFact(entity.id, "$model google:gemini-3-flash-preview");
    addFact(entity.id, "$locked");

    const result = traceFacts(entity.id, "ch-1");
    expect(result).not.toBeNull();
    expect(result!.traces[0].category).toBe("$respond");
    expect(result!.traces[1].category).toBe("$memory");
    expect(result!.traces[2].category).toBe("$stream");
    expect(result!.traces[3].category).toBe("$model");
    expect(result!.traces[4].category).toBe("$locked");
  });
});

describe("simulateResponse", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns empty for channel with no bindings", () => {
    const results = simulateResponse("ch-empty");
    expect(results).toHaveLength(0);
  });

  test("simulates response for channel-bound entity", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "is a character");
    addFact(entity.id, "$respond");
    addDiscordEntity("ch-1", "channel", entity.id);

    const results = simulateResponse("ch-1");
    expect(results).toHaveLength(1);
    expect(results[0].entityName).toBe("Aria");
    expect(results[0].shouldRespond).toBe(true);
  });

  test("reports entities that would not respond", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "$respond false");
    addDiscordEntity("ch-1", "channel", entity.id);

    const results = simulateResponse("ch-1");
    expect(results).toHaveLength(1);
    expect(results[0].shouldRespond).toBe(false);
  });

  test("combines channel and guild bindings", () => {
    const e1 = createEntity("Aria", "owner1");
    const e2 = createEntity("Bob", "owner1");
    addFact(e1.id, "is a character");
    addFact(e2.id, "is a character");
    addDiscordEntity("ch-1", "channel", e1.id);
    addDiscordEntity("guild-1", "guild", e2.id);

    const results = simulateResponse("ch-1", "guild-1");
    expect(results).toHaveLength(2);
    const names = results.map(r => r.entityName).sort();
    expect(names).toEqual(["Aria", "Bob"]);
  });
});

describe("buildEvaluatedEntity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("evaluates entity facts into an EvaluatedEntity", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "has silver hair");
    addFact(entity.id, "$respond");
    addFact(entity.id, "$if true: glows faintly");

    const ewf = getEntityWithFacts(entity.id)!;
    const ctx = testContext({ facts: ewf.facts.map(f => f.content) });
    const evaluated = buildEvaluatedEntity(ewf, ctx);

    expect(evaluated.id).toBe(entity.id);
    expect(evaluated.name).toBe("Aria");
    expect(evaluated.facts).toContain("has silver hair");
    expect(evaluated.facts).toContain("glows faintly");
    expect(evaluated.exprContext).toBeDefined();
  });

  test("passes channel metadata through", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "is a character");

    const ewf = getEntityWithFacts(entity.id)!;
    const ctx = testContext({
      facts: ewf.facts.map(f => f.content),
      channel: { id: "ch-1", name: "general", description: "", is_nsfw: false, type: "text", mention: "<#ch-1>" },
    });
    const evaluated = buildEvaluatedEntity(ewf, ctx);

    expect(evaluated.exprContext?.channel.name).toBe("general");
  });

  test("applies entity config defaults", () => {
    const entity = createEntity("Aria", "owner1");
    addFact(entity.id, "is a character");
    setEntityConfig(entity.id, { config_model: "google:gemini-3-flash-preview" });

    const ewf = getEntityWithFacts(entity.id)!;
    const ctx = testContext({ facts: ewf.facts.map(f => f.content) });
    const evaluated = buildEvaluatedEntity(ewf, ctx);

    expect(evaluated.modelSpec).toBe("google:gemini-3-flash-preview");
  });
});
