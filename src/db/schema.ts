import type { Database } from "bun:sqlite";

export function initSchema(db: Database) {
  db.exec(`
    -- Worlds: shared across guilds
    CREATE TABLE IF NOT EXISTS worlds (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      data JSON,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Guild-to-world mapping
    CREATE TABLE IF NOT EXISTS guild_worlds (
      guild_id TEXT NOT NULL,
      world_id INTEGER REFERENCES worlds(id),
      role TEXT,
      data JSON,
      PRIMARY KEY (guild_id, world_id)
    );

    -- Entities: characters, locations, items, concepts
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY,
      world_id INTEGER REFERENCES worlds(id),
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      data JSON NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_entities_world ON entities(world_id);
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

    -- Relationships between entities
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY,
      source_id INTEGER REFERENCES entities(id),
      target_id INTEGER REFERENCES entities(id),
      type TEXT NOT NULL,
      data JSON,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id);
    CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id);

    -- Facts/memories (RAG-searchable)
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY,
      entity_id INTEGER REFERENCES entities(id),
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 5,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id);
    CREATE INDEX IF NOT EXISTS idx_facts_importance ON facts(importance DESC);
  `);
}

export function initVectorTable(db: Database) {
  // Vector table for semantic search (384-dim for MiniLM)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fact_embeddings
    USING vec0(embedding float[384])
  `);
}
