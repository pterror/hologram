import { getDb } from "../db";
import type { Scene } from "../scene";
import type { WorldConfig } from "../config/types";
import { getWorldConfig } from "../config";
import { evaluateConditions, type EventConditions } from "./conditions";

export type { EventConditions };

// === Types ===

export type EventTrigger = "time_advance" | "message" | "location_enter" | "interval" | "manual";

export interface EventEffects {
  weatherChange?: string;
  spawnCharacter?: number;   // Entity ID of character to add to scene
  advanceTime?: { hours?: number; minutes?: number };
  chronicleEntry?: { type: string; importance: number };
}

export interface RandomEventTable {
  id: number;
  worldId: number | null;
  name: string;
  trigger: EventTrigger;
  enabled: boolean;
  chance: number;
  cooldownMinutes: number | null;
  lastFiredAt: number | null;
  conditions: EventConditions | null;
  data: Record<string, unknown> | null;
  createdAt: number;
}

export interface RandomEventEntry {
  id: number;
  tableId: number;
  weight: number;
  content: string;
  type: string;
  effects: EventEffects | null;
  createdAt: number;
}

export interface RandomEventResult {
  table: RandomEventTable;
  entry: RandomEventEntry;
}

// === Row mapping ===

interface TableRow {
  id: number;
  world_id: number | null;
  name: string;
  trigger: string;
  enabled: number;
  chance: number;
  cooldown_minutes: number | null;
  last_fired_at: number | null;
  conditions: string | null;
  data: string | null;
  created_at: number;
}

interface EntryRow {
  id: number;
  table_id: number;
  weight: number;
  content: string;
  type: string;
  effects: string | null;
  created_at: number;
}

function mapTableRow(row: TableRow): RandomEventTable {
  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    trigger: row.trigger as EventTrigger,
    enabled: row.enabled === 1,
    chance: row.chance,
    cooldownMinutes: row.cooldown_minutes,
    lastFiredAt: row.last_fired_at,
    conditions: row.conditions ? JSON.parse(row.conditions) : null,
    data: row.data ? JSON.parse(row.data) : null,
    createdAt: row.created_at,
  };
}

function mapEntryRow(row: EntryRow): RandomEventEntry {
  return {
    id: row.id,
    tableId: row.table_id,
    weight: row.weight,
    content: row.content,
    type: row.type,
    effects: row.effects ? JSON.parse(row.effects) : null,
    createdAt: row.created_at,
  };
}

// === CRUD ===

/** Create a random event table */
export function createEventTable(
  worldId: number,
  name: string,
  trigger: EventTrigger,
  chance: number,
  options?: {
    cooldownMinutes?: number;
    conditions?: EventConditions;
    data?: Record<string, unknown>;
  }
): RandomEventTable {
  const db = getDb();
  const row = db.prepare(`
    INSERT INTO random_event_tables (world_id, name, trigger, chance, cooldown_minutes, conditions, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    worldId,
    name,
    trigger,
    chance,
    options?.cooldownMinutes ?? null,
    options?.conditions ? JSON.stringify(options.conditions) : null,
    options?.data ? JSON.stringify(options.data) : null
  ) as TableRow;

  return mapTableRow(row);
}

/** Get a table by ID */
export function getEventTable(id: number): RandomEventTable | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM random_event_tables WHERE id = ?").get(id) as TableRow | null;
  return row ? mapTableRow(row) : null;
}

/** List tables for a world */
export function listEventTables(worldId: number): RandomEventTable[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM random_event_tables WHERE world_id = ? ORDER BY name"
  ).all(worldId) as TableRow[];
  return rows.map(mapTableRow);
}

/** Toggle a table's enabled state */
export function setTableEnabled(id: number, enabled: boolean): boolean {
  const db = getDb();
  const result = db.prepare(
    "UPDATE random_event_tables SET enabled = ? WHERE id = ?"
  ).run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

/** Delete a table (cascades to entries) */
export function deleteEventTable(id: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM random_event_tables WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Add an entry to a table */
export function addEventEntry(
  tableId: number,
  content: string,
  options?: {
    weight?: number;
    type?: string;
    effects?: EventEffects;
  }
): RandomEventEntry {
  const db = getDb();
  const row = db.prepare(`
    INSERT INTO random_event_entries (table_id, weight, content, type, effects)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    tableId,
    options?.weight ?? 1,
    content,
    options?.type ?? "narration",
    options?.effects ? JSON.stringify(options.effects) : null
  ) as EntryRow;

  return mapEntryRow(row);
}

/** List entries for a table */
export function listEventEntries(tableId: number): RandomEventEntry[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM random_event_entries WHERE table_id = ? ORDER BY weight DESC"
  ).all(tableId) as EntryRow[];
  return rows.map(mapEntryRow);
}

/** Delete an entry */
export function deleteEventEntry(id: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM random_event_entries WHERE id = ?").run(id);
  return result.changes > 0;
}

// === Engine ===

/** Convert TimeState-like values to total game-minutes for cooldown tracking */
function toGameMinutes(day: number, hour: number, minute: number): number {
  return day * 24 * 60 + hour * 60 + minute;
}

/** Check all random event tables for a given trigger and return any fired events */
export function checkRandomEvents(
  scene: Scene,
  trigger: EventTrigger,
  config?: WorldConfig
): RandomEventResult[] {
  const worldConfig = config ?? getWorldConfig(scene.worldId);

  if (!worldConfig.time.enabled || !worldConfig.time.useRandomEvents) {
    return [];
  }

  // Skip message trigger if not configured
  if (trigger === "message" && !worldConfig.time.randomEventCheckOnMessage) {
    return [];
  }

  const db = getDb();

  // Get all enabled tables matching this trigger for this world
  const tables = db.prepare(`
    SELECT * FROM random_event_tables
    WHERE world_id = ? AND enabled = 1 AND trigger = ?
  `).all(scene.worldId, trigger) as TableRow[];

  const results: RandomEventResult[] = [];
  const currentGameMinutes = toGameMinutes(scene.time.day, scene.time.hour, scene.time.minute);

  const calendar = worldConfig.time.useCalendar ? worldConfig.time.calendar : undefined;

  for (const tableRow of tables) {
    const table = mapTableRow(tableRow);

    // Check cooldown
    if (table.cooldownMinutes && table.lastFiredAt !== null) {
      if (currentGameMinutes - table.lastFiredAt < table.cooldownMinutes) {
        continue;
      }
    }

    // Check conditions
    if (table.conditions && !evaluateConditions(table.conditions, scene, worldConfig, calendar)) {
      continue;
    }

    // Roll probability
    if (Math.random() > table.chance) {
      continue;
    }

    // Select a weighted random entry
    const entry = selectWeightedEntry(table.id);
    if (!entry) continue;

    // Update last_fired_at
    db.prepare(
      "UPDATE random_event_tables SET last_fired_at = ? WHERE id = ?"
    ).run(currentGameMinutes, table.id);

    results.push({ table, entry });
  }

  return results;
}

/** Force-roll from a specific table (bypasses chance and cooldown) */
export function rollFromTable(tableId: number): RandomEventEntry | null {
  return selectWeightedEntry(tableId);
}

/** Select a weighted random entry from a table */
function selectWeightedEntry(tableId: number): RandomEventEntry | null {
  const db = getDb();
  const entries = db.prepare(
    "SELECT * FROM random_event_entries WHERE table_id = ?"
  ).all(tableId) as EntryRow[];

  if (entries.length === 0) return null;

  // Calculate total weight
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight <= 0) return null;

  // Weighted random selection
  let roll = Math.random() * totalWeight;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) {
      return mapEntryRow(entry);
    }
  }

  // Fallback (shouldn't reach here)
  return mapEntryRow(entries[entries.length - 1]);
}

/** Apply side effects from an event entry to the scene */
export function applyEventEffects(
  scene: Scene,
  entry: RandomEventEntry
): string[] {
  const applied: string[] = [];
  const effects = entry.effects;
  if (!effects) return applied;

  const db = getDb();

  // Weather change
  if (effects.weatherChange) {
    db.prepare("UPDATE scenes SET weather = ? WHERE id = ?").run(effects.weatherChange, scene.id);
    applied.push(`Weather changed to ${effects.weatherChange}`);
  }

  // Spawn character (add to scene)
  if (effects.spawnCharacter) {
    db.prepare(`
      INSERT OR IGNORE INTO scene_characters (scene_id, character_id, is_ai, is_active, is_present)
      VALUES (?, ?, 1, 0, 1)
    `).run(scene.id, effects.spawnCharacter);
    applied.push(`Character ${effects.spawnCharacter} entered the scene`);
  }

  // Chronicle entry
  if (effects.chronicleEntry) {
    db.prepare(`
      INSERT INTO chronicle (scene_id, world_id, type, content, importance, perspective, visibility, source)
      VALUES (?, ?, ?, ?, ?, 'narrator', 'public', 'auto')
    `).run(
      scene.id,
      scene.worldId,
      effects.chronicleEntry.type,
      entry.content,
      effects.chronicleEntry.importance
    );
    applied.push("Chronicle entry created");
  }

  // Time advancement is returned but not applied here (caller handles it
  // to avoid recursive triggers)
  if (effects.advanceTime) {
    applied.push(
      `Time should advance by ${effects.advanceTime.hours ?? 0}h ${effects.advanceTime.minutes ?? 0}m`
    );
  }

  return applied;
}
