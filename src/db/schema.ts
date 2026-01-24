import type { Database } from "bun:sqlite";

export function initSchema(db: Database) {
  db.exec(`
    -- Worlds: shared across guilds
    CREATE TABLE IF NOT EXISTS worlds (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      lore TEXT,
      rules TEXT,
      config JSON,
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

    -- Scenes: active play sessions
    CREATE TABLE IF NOT EXISTS scenes (
      id INTEGER PRIMARY KEY,
      world_id INTEGER REFERENCES worlds(id),
      channel_id TEXT NOT NULL,
      location_id INTEGER REFERENCES entities(id),
      time_day INTEGER DEFAULT 1,
      time_hour INTEGER DEFAULT 8,
      time_minute INTEGER DEFAULT 0,
      weather TEXT,
      ambience TEXT,
      status TEXT DEFAULT 'active',
      config JSON,
      created_at INTEGER DEFAULT (unixepoch()),
      last_active_at INTEGER DEFAULT (unixepoch()),
      ended_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_scenes_channel ON scenes(channel_id, status);
    CREATE INDEX IF NOT EXISTS idx_scenes_world ON scenes(world_id);

    -- Scene participants
    CREATE TABLE IF NOT EXISTS scene_characters (
      scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
      character_id INTEGER REFERENCES entities(id),
      is_ai BOOLEAN DEFAULT 1,
      is_active BOOLEAN DEFAULT 0,
      is_present BOOLEAN DEFAULT 1,
      player_id TEXT,
      joined_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (scene_id, character_id)
    );

    CREATE INDEX IF NOT EXISTS idx_scene_chars_scene ON scene_characters(scene_id);

    -- Chronicle: perspective-aware memory system
    CREATE TABLE IF NOT EXISTS chronicle (
      id INTEGER PRIMARY KEY,
      scene_id INTEGER REFERENCES scenes(id),
      world_id INTEGER REFERENCES worlds(id),
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 5,
      perspective TEXT NOT NULL,
      visibility TEXT DEFAULT 'public',
      source TEXT DEFAULT 'auto',
      source_message_id TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_chronicle_scene ON chronicle(scene_id);
    CREATE INDEX IF NOT EXISTS idx_chronicle_world ON chronicle(world_id);
    CREATE INDEX IF NOT EXISTS idx_chronicle_perspective ON chronicle(perspective);
    CREATE INDEX IF NOT EXISTS idx_chronicle_importance ON chronicle(importance DESC);
    CREATE INDEX IF NOT EXISTS idx_chronicle_type ON chronicle(type);

    -- Webhook cache for character impersonation
    CREATE TABLE IF NOT EXISTS character_webhooks (
      id INTEGER PRIMARY KEY,
      channel_id TEXT NOT NULL,
      character_id INTEGER REFERENCES entities(id),
      webhook_id TEXT NOT NULL,
      webhook_token TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(channel_id, character_id)
    );

    CREATE INDEX IF NOT EXISTS idx_webhooks_channel ON character_webhooks(channel_id);
  `);
}

export function initVectorTable(db: Database) {
  // Vector table for semantic search (384-dim for MiniLM)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fact_embeddings
    USING vec0(embedding float[384])
  `);
}

/** Run migrations for existing databases */
export function runMigrations(db: Database) {
  // Check if columns exist and add them if not
  const worldsInfo = db.prepare("PRAGMA table_info(worlds)").all() as Array<{
    name: string;
  }>;
  const columns = new Set(worldsInfo.map((c) => c.name));

  if (!columns.has("config")) {
    db.exec("ALTER TABLE worlds ADD COLUMN config JSON");
  }
  if (!columns.has("lore")) {
    db.exec("ALTER TABLE worlds ADD COLUMN lore TEXT");
  }
  if (!columns.has("rules")) {
    db.exec("ALTER TABLE worlds ADD COLUMN rules TEXT");
  }
}
