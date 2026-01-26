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

    -- Character state (per-scene dynamic state)
    CREATE TABLE IF NOT EXISTS character_state (
      id INTEGER PRIMARY KEY,
      character_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
      scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
      attributes JSON,
      body JSON,
      outfit JSON,
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(character_id, scene_id)
    );

    CREATE INDEX IF NOT EXISTS idx_char_state_char ON character_state(character_id);
    CREATE INDEX IF NOT EXISTS idx_char_state_scene ON character_state(scene_id);

    -- Active effects on characters
    CREATE TABLE IF NOT EXISTS character_effects (
      id INTEGER PRIMARY KEY,
      character_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
      scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      duration TEXT DEFAULT 'permanent',
      expires_at INTEGER,
      turns_remaining INTEGER,
      modifiers JSON,
      body_changes JSON,
      flags JSON,
      stacks INTEGER DEFAULT 1,
      max_stacks INTEGER,
      source_type TEXT,
      source_id INTEGER,
      visibility TEXT DEFAULT 'visible',
      visible_description TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_effects_char ON character_effects(character_id);
    CREATE INDEX IF NOT EXISTS idx_effects_scene ON character_effects(scene_id);

    -- Equipment slots (what's equipped where)
    CREATE TABLE IF NOT EXISTS character_equipment (
      id INTEGER PRIMARY KEY,
      character_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
      scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
      slot TEXT NOT NULL,
      item_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
      equipped_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(character_id, scene_id, slot)
    );

    CREATE INDEX IF NOT EXISTS idx_equipment_char ON character_equipment(character_id);

    -- Scheduled events (time system)
    CREATE TABLE IF NOT EXISTS scheduled_events (
      id INTEGER PRIMARY KEY,
      scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
      world_id INTEGER REFERENCES worlds(id),
      trigger_day INTEGER NOT NULL,
      trigger_hour INTEGER NOT NULL,
      trigger_minute INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      recurring TEXT,
      data JSON,
      fired BOOLEAN DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_events_scene ON scheduled_events(scene_id, fired);
    CREATE INDEX IF NOT EXISTS idx_events_trigger ON scheduled_events(trigger_day, trigger_hour, trigger_minute);

    -- Combat encounters
    CREATE TABLE IF NOT EXISTS combats (
      id INTEGER PRIMARY KEY,
      scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
      active BOOLEAN DEFAULT 1,
      round INTEGER DEFAULT 1,
      current_turn INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_combats_scene ON combats(scene_id, active);

    -- Combat participants
    CREATE TABLE IF NOT EXISTS combat_participants (
      id INTEGER PRIMARY KEY,
      combat_id INTEGER REFERENCES combats(id) ON DELETE CASCADE,
      character_id INTEGER REFERENCES entities(id),
      initiative INTEGER DEFAULT 0,
      hp INTEGER,
      max_hp INTEGER,
      ac INTEGER,
      conditions JSON DEFAULT '[]',
      is_active BOOLEAN DEFAULT 1,
      turn_order INTEGER DEFAULT 0,
      UNIQUE(combat_id, character_id)
    );

    CREATE INDEX IF NOT EXISTS idx_combat_parts ON combat_participants(combat_id);

    -- Combat log
    CREATE TABLE IF NOT EXISTS combat_log (
      id INTEGER PRIMARY KEY,
      combat_id INTEGER REFERENCES combats(id) ON DELETE CASCADE,
      round INTEGER,
      turn INTEGER,
      actor_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_combat_log ON combat_log(combat_id);

    -- Faction membership
    CREATE TABLE IF NOT EXISTS faction_members (
      id INTEGER PRIMARY KEY,
      faction_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
      character_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
      rank TEXT,
      standing INTEGER DEFAULT 0,
      is_public BOOLEAN DEFAULT 1,
      joined_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(faction_id, character_id)
    );

    CREATE INDEX IF NOT EXISTS idx_faction_members_faction ON faction_members(faction_id);
    CREATE INDEX IF NOT EXISTS idx_faction_members_char ON faction_members(character_id);

    -- User personas (SillyTavern-style user identity)
    CREATE TABLE IF NOT EXISTS user_personas (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      world_id INTEGER REFERENCES worlds(id),
      name TEXT NOT NULL,
      persona TEXT,
      avatar TEXT,
      data JSON,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, world_id)
    );

    CREATE INDEX IF NOT EXISTS idx_personas_user ON user_personas(user_id);

    -- User proxies (PluralKit-style character proxying)
    CREATE TABLE IF NOT EXISTS user_proxies (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      world_id INTEGER REFERENCES worlds(id),
      name TEXT NOT NULL,
      prefix TEXT,
      suffix TEXT,
      bracket_open TEXT,
      bracket_close TEXT,
      avatar TEXT,
      persona TEXT,
      data JSON,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_proxies_user ON user_proxies(user_id);

    -- Random event tables (probability-based event templates)
    CREATE TABLE IF NOT EXISTS random_event_tables (
      id INTEGER PRIMARY KEY,
      world_id INTEGER REFERENCES worlds(id),
      name TEXT NOT NULL,
      trigger TEXT NOT NULL,       -- "time_advance" | "message" | "location_enter" | "manual"
      enabled BOOLEAN DEFAULT 1,
      chance REAL NOT NULL,        -- 0.0-1.0, checked per trigger
      cooldown_minutes INTEGER,    -- Min game-time between fires
      last_fired_at INTEGER,       -- Game-time (day*1440 + hour*60 + minute) when last fired
      conditions JSON,             -- Optional: timeOfDay, season, location, weather, etc.
      data JSON,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_random_tables_world ON random_event_tables(world_id, enabled);

    -- Random event entries (weighted outcomes within a table)
    CREATE TABLE IF NOT EXISTS random_event_entries (
      id INTEGER PRIMARY KEY,
      table_id INTEGER REFERENCES random_event_tables(id) ON DELETE CASCADE,
      weight INTEGER DEFAULT 1,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'narration',  -- "narration" | "weather_change" | "npc_arrival" | "item_drop" | "effect"
      effects JSON,                   -- Side effects: weatherChange, spawnCharacter, advanceTime, etc.
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_random_entries_table ON random_event_entries(table_id);

    -- NPC behavior tracks (independent state machine layers per character)
    -- e.g., "mood" (happy/sad/angry), "activity" (idle/shopping/napping), "energy" (rested/tired)
    CREATE TABLE IF NOT EXISTS behavior_tracks (
      id INTEGER PRIMARY KEY,
      world_id INTEGER REFERENCES worlds(id),
      character_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
      name TEXT NOT NULL,                -- "mood", "activity", "energy"
      description TEXT,                  -- "Governs emotional state"
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(character_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_behavior_tracks_char ON behavior_tracks(character_id);

    -- States within a track
    CREATE TABLE IF NOT EXISTS behavior_states (
      id INTEGER PRIMARY KEY,
      track_id INTEGER REFERENCES behavior_tracks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,                -- "idle", "shopping", "napping", "happy", "angry"
      description TEXT,                  -- "relaxing at home"
      min_duration_minutes INTEGER,      -- Min real minutes before transitioning
      max_duration_minutes INTEGER,      -- Max real minutes before transitioning
      conditions JSON,                   -- Optional: only valid during certain times, weather, etc.
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(track_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_behavior_states_track ON behavior_states(track_id);

    -- Transitions between states (within the same track)
    CREATE TABLE IF NOT EXISTS behavior_transitions (
      id INTEGER PRIMARY KEY,
      from_state_id INTEGER REFERENCES behavior_states(id) ON DELETE CASCADE,
      to_state_id INTEGER REFERENCES behavior_states(id) ON DELETE CASCADE,
      weight INTEGER DEFAULT 1,          -- Relative probability
      narration TEXT NOT NULL,            -- "Alice yawns and heads to bed"
      conditions JSON,                   -- Optional conditions (timeOfDay, etc.)
      effects JSON,                      -- Optional side effects (weatherChange, etc.)
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_behavior_trans_from ON behavior_transitions(from_state_id);

    -- Current state per track per character (runtime)
    CREATE TABLE IF NOT EXISTS character_behaviors (
      character_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
      track_id INTEGER REFERENCES behavior_tracks(id) ON DELETE CASCADE,
      current_state_id INTEGER REFERENCES behavior_states(id),
      state_entered_at INTEGER DEFAULT (unixepoch()),  -- Real timestamp
      game_time_entered INTEGER DEFAULT 0,             -- Game-time in minutes
      PRIMARY KEY (character_id, track_id)
    );

    -- Wizard sessions (multi-step creation flows)
    CREATE TABLE IF NOT EXISTS wizard_sessions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      world_id INTEGER,
      step INTEGER DEFAULT 0,
      data JSON DEFAULT '{}',
      ai_suggestions JSON,
      created_at INTEGER DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wizard_user ON wizard_sessions(user_id, channel_id);

    -- Generated images (image generation results)
    CREATE TABLE IF NOT EXISTS generated_images (
      id INTEGER PRIMARY KEY,
      world_id INTEGER NOT NULL REFERENCES worlds(id),
      entity_id INTEGER REFERENCES entities(id),
      entity_type TEXT,                -- "character" | "location" | "scene"
      image_type TEXT NOT NULL,        -- "portrait" | "expression" | "scene" | "custom"
      workflow_id TEXT NOT NULL,       -- Workflow used to generate
      variables TEXT NOT NULL,         -- JSON of workflow variables
      url TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_gen_images_world ON generated_images(world_id);
    CREATE INDEX IF NOT EXISTS idx_gen_images_entity ON generated_images(entity_id, entity_type);
    CREATE INDEX IF NOT EXISTS idx_gen_images_type ON generated_images(image_type);

    -- Custom image workflows (per-world)
    CREATE TABLE IF NOT EXISTS image_workflows (
      id INTEGER PRIMARY KEY,
      world_id INTEGER NOT NULL REFERENCES worlds(id),
      workflow_id TEXT NOT NULL,       -- User-defined ID (e.g., "my-custom-portrait")
      name TEXT NOT NULL,
      description TEXT,
      workflow TEXT NOT NULL,          -- ComfyUI workflow JSON
      variables TEXT NOT NULL,         -- JSON array of WorkflowVariable
      output_node_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(world_id, workflow_id)
    );

    CREATE INDEX IF NOT EXISTS idx_img_workflows_world ON image_workflows(world_id);
  `);
}

export function initVectorTable(db: Database) {
  // Vector tables for semantic search (384-dim for MiniLM)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fact_embeddings
    USING vec0(embedding float[384])
  `);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chronicle_embeddings
    USING vec0(embedding float[384])
  `);
}

/** Run migrations for existing databases */
export function runMigrations(db: Database) {
  // Check if columns exist and add them if not
  const worldsInfo = db.prepare("PRAGMA table_info(worlds)").all() as Array<{
    name: string;
  }>;
  const worldColumns = new Set(worldsInfo.map((c) => c.name));

  if (!worldColumns.has("config")) {
    db.exec("ALTER TABLE worlds ADD COLUMN config JSON");
  }
  if (!worldColumns.has("lore")) {
    db.exec("ALTER TABLE worlds ADD COLUMN lore TEXT");
  }
  if (!worldColumns.has("rules")) {
    db.exec("ALTER TABLE worlds ADD COLUMN rules TEXT");
  }

  // character_state migrations
  const stateInfo = db.prepare("PRAGMA table_info(character_state)").all() as Array<{
    name: string;
  }>;
  const stateColumns = new Set(stateInfo.map((c) => c.name));

  if (!stateColumns.has("outfit")) {
    db.exec("ALTER TABLE character_state ADD COLUMN outfit JSON");
  }
}
