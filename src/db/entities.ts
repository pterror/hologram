import { getDb } from "./index";

export type EntityType = "character" | "location" | "item" | "concept" | "faction";

export interface Entity<T = Record<string, unknown>> {
  id: number;
  worldId: number | null;  // Legacy: primary world (use entity_worlds for multi-world)
  type: EntityType;
  name: string;
  data: T;
  creatorId: string | null;
  createdAt: number;
}

export interface CharacterData {
  persona: string;
  scenario?: string;
  exampleDialogue?: string;
  systemPrompt?: string;

  // Response behavior (overrides world defaults)
  responseMode?: "always" | "mention" | "trigger" | "chance" | "llm" | "combined";
  triggerPhrases?: string[]; // ["Hey Aria", "Aria,", "yo aria"]
  responseChance?: number; // 0.0-1.0 for chance/combined mode
  llmEvalPrompt?: string; // Custom "would I respond?" prompt

  [key: string]: unknown;
}

export type LocationType = "location" | "region" | "zone" | "world";

export interface LocationConnection {
  targetId: number;
  type?: string;            // "door", "path", "portal", "hidden", etc.
  bidirectional?: boolean;  // Default true
  travelTime?: number;      // Minutes
  description?: string;     // "A narrow passage leads north"
  hidden?: boolean;         // Not shown until discovered
}

export interface LocationData {
  description: string;
  connectedTo?: number[]; // IDs of connected locations (legacy)

  // Hierarchy
  parentId?: number;          // Region/zone this is inside
  locationType?: LocationType;

  // Connections (new format)
  connections?: LocationConnection[];

  // Properties
  properties?: Record<string, boolean | string | number>;
  // e.g., { indoor: true, lightLevel: "dim", temperature: "cold" }

  // Ambience
  ambience?: string;          // Default scene ambience when here
  enterMessage?: string;      // Shown when arriving

  [key: string]: unknown;
}

export type ItemType = "consumable" | "equipment" | "quest" | "currency" | "misc";

export interface ItemData {
  description: string;
  stats?: Record<string, number>;

  // Item type and properties
  type?: ItemType;
  weight?: number;
  slots?: number;              // Inventory slots it takes

  // Equipment properties
  equipSlot?: string;          // Which slot it equips to
  durability?: number;
  maxDurability?: number;

  // Consumable properties
  uses?: number;
  maxUses?: number;
  effect?: string;             // Description of what it does

  // Equipment requirements
  requirements?: {
    species?: string[];        // Must be one of these species
    bodyType?: string[];       // Must have one of these body types
    size?: string[];           // Must be one of these sizes
    attributes?: Record<string, number>;  // Must have at least these attribute values
    flags?: string[];          // Must have these flags
    notFlags?: string[];       // Must NOT have these flags
  };
  incompatible?: "cannot_equip" | "reduced_stats" | "cosmetic_only" | "transforms";

  // Transformation properties
  transformation?: {
    effects: Array<{
      name: string;
      type: string;
      description?: string;
      duration?: string;
      modifiers?: Record<string, number>;
      bodyChanges?: Record<string, unknown>;
      flags?: string[];
    }>;
    target: "self" | "other" | "any";
    reversible?: boolean;
    reverseItem?: number;      // Item ID that reverses this
  };

  [key: string]: unknown;
}

export interface FactionData {
  description: string;
  parentFactionId?: number;    // For sub-factions
  motto?: string;
  alignment?: string;          // "lawful", "chaotic", etc.
  headquarters?: number;       // Location entity ID
  [key: string]: unknown;
}

/** Options for creating an entity */
export interface CreateEntityOptions {
  worldId?: number;
  creatorId?: string;
  /** Additional worlds this entity should be visible in (primary is worldId) */
  additionalWorlds?: number[];
}

// Create
export function createEntity<T extends Record<string, unknown>>(
  type: EntityType,
  name: string,
  data: T,
  worldIdOrOptions?: number | CreateEntityOptions
): Entity<T> {
  const db = getDb();

  // Handle both old signature (worldId) and new signature (options)
  const options: CreateEntityOptions =
    typeof worldIdOrOptions === "number"
      ? { worldId: worldIdOrOptions }
      : worldIdOrOptions ?? {};

  const { worldId, creatorId, additionalWorlds = [] } = options;

  // Insert entity
  const stmt = db.prepare(`
    INSERT INTO entities (world_id, type, name, data, creator_id)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id, world_id as worldId, type, name, data, creator_id as creatorId, created_at as createdAt
  `);
  const row = stmt.get(
    worldId ?? null,
    type,
    name,
    JSON.stringify(data),
    creatorId ?? null
  ) as {
    id: number;
    worldId: number | null;
    type: EntityType;
    name: string;
    data: string;
    creatorId: string | null;
    createdAt: number;
  };

  // Create entity_worlds link for primary world
  if (worldId !== undefined) {
    db.prepare(
      `INSERT INTO entity_worlds (entity_id, world_id, is_primary) VALUES (?, ?, 1)`
    ).run(row.id, worldId);
  }

  // Create entity_worlds links for additional worlds
  for (const additionalWorldId of additionalWorlds) {
    db.prepare(
      `INSERT OR IGNORE INTO entity_worlds (entity_id, world_id, is_primary) VALUES (?, ?, 0)`
    ).run(row.id, additionalWorldId);
  }

  return {
    ...row,
    data: JSON.parse(row.data) as T,
  };
}

// Read
export function getEntity<T = Record<string, unknown>>(
  id: number
): Entity<T> | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, world_id as worldId, type, name, data, creator_id as creatorId, created_at as createdAt
    FROM entities WHERE id = ?
  `);
  const row = stmt.get(id) as {
    id: number;
    worldId: number | null;
    type: EntityType;
    name: string;
    data: string;
    creatorId: string | null;
    createdAt: number;
  } | null;
  if (!row) return null;
  return {
    ...row,
    data: JSON.parse(row.data) as T,
  };
}

export function getEntitiesByType<T = Record<string, unknown>>(
  type: EntityType,
  worldId?: number
): Entity<T>[] {
  const db = getDb();
  let stmt;
  let rows;
  if (worldId !== undefined) {
    // Use entity_worlds for multi-world support, falling back to world_id for legacy
    stmt = db.prepare(`
      SELECT DISTINCT e.id, e.world_id as worldId, e.type, e.name, e.data,
             e.creator_id as creatorId, e.created_at as createdAt
      FROM entities e
      LEFT JOIN entity_worlds ew ON e.id = ew.entity_id
      WHERE e.type = ? AND (ew.world_id = ? OR e.world_id = ?)
      ORDER BY e.name
    `);
    rows = stmt.all(type, worldId, worldId);
  } else {
    stmt = db.prepare(`
      SELECT id, world_id as worldId, type, name, data,
             creator_id as creatorId, created_at as createdAt
      FROM entities WHERE type = ?
      ORDER BY name
    `);
    rows = stmt.all(type);
  }
  return (rows as { data: string }[]).map((row) => ({
    ...row,
    data: JSON.parse(row.data) as T,
  })) as Entity<T>[];
}

export function findEntityByName<T = Record<string, unknown>>(
  name: string,
  type?: EntityType,
  worldId?: number
): Entity<T> | null {
  const db = getDb();

  // If worldId provided, use entity_worlds for multi-world support
  if (worldId !== undefined) {
    let query = `
      SELECT DISTINCT e.id, e.world_id as worldId, e.type, e.name, e.data,
             e.creator_id as creatorId, e.created_at as createdAt
      FROM entities e
      LEFT JOIN entity_worlds ew ON e.id = ew.entity_id
      WHERE e.name = ? AND (ew.world_id = ? OR e.world_id = ?)
    `;
    const params: (string | number)[] = [name, worldId, worldId];

    if (type) {
      query += " AND e.type = ?";
      params.push(type);
    }

    const stmt = db.prepare(query);
    const row = stmt.get(...params) as {
      id: number;
      worldId: number | null;
      type: EntityType;
      name: string;
      data: string;
      creatorId: string | null;
      createdAt: number;
    } | null;
    if (!row) return null;
    return {
      ...row,
      data: JSON.parse(row.data) as T,
    };
  }

  // No worldId, search globally
  let query = `
    SELECT id, world_id as worldId, type, name, data,
           creator_id as creatorId, created_at as createdAt
    FROM entities WHERE name = ?
  `;
  const params: (string | number)[] = [name];

  if (type) {
    query += " AND type = ?";
    params.push(type);
  }

  const stmt = db.prepare(query);
  const row = stmt.get(...params) as {
    id: number;
    worldId: number | null;
    type: EntityType;
    name: string;
    data: string;
    creatorId: string | null;
    createdAt: number;
  } | null;
  if (!row) return null;
  return {
    ...row,
    data: JSON.parse(row.data) as T,
  };
}

// Update
export function updateEntity<T extends Record<string, unknown>>(
  id: number,
  updates: { name?: string; data?: Partial<T> }
): Entity<T> | null {
  const db = getDb();
  const existing = getEntity<T>(id);
  if (!existing) return null;

  const newName = updates.name ?? existing.name;
  const newData = updates.data
    ? { ...existing.data, ...updates.data }
    : existing.data;

  const stmt = db.prepare(`
    UPDATE entities SET name = ?, data = ? WHERE id = ?
    RETURNING id, world_id as worldId, type, name, data, creator_id as creatorId, created_at as createdAt
  `);
  const row = stmt.get(newName, JSON.stringify(newData), id) as {
    id: number;
    worldId: number | null;
    type: EntityType;
    name: string;
    data: string;
    creatorId: string | null;
    createdAt: number;
  };
  return {
    ...row,
    data: JSON.parse(row.data) as T,
  };
}

// Delete
export function deleteEntity(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM entities WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

// Convenience functions for specific types
export const createCharacter = (
  name: string,
  data: CharacterData,
  worldId?: number
) => createEntity("character", name, data, worldId);

export const getCharacters = (worldId?: number) =>
  getEntitiesByType<CharacterData>("character", worldId);

export const createLocation = (
  name: string,
  data: LocationData,
  worldId?: number
) => createEntity("location", name, data, worldId);

export const getLocations = (worldId?: number) =>
  getEntitiesByType<LocationData>("location", worldId);

export const createItem = (name: string, data: ItemData, worldId?: number) =>
  createEntity("item", name, data, worldId);

export const getItems = (worldId?: number) =>
  getEntitiesByType<ItemData>("item", worldId);
