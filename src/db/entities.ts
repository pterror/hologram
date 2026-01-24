import { getDb } from "./index";

export type EntityType = "character" | "location" | "item" | "concept";

export interface Entity<T = Record<string, unknown>> {
  id: number;
  worldId: number | null;
  type: EntityType;
  name: string;
  data: T;
  createdAt: number;
}

export interface CharacterData {
  persona: string;
  scenario?: string;
  exampleDialogue?: string;
  systemPrompt?: string;
  [key: string]: unknown;
}

export interface LocationData {
  description: string;
  connectedTo?: number[]; // IDs of connected locations
  [key: string]: unknown;
}

export interface ItemData {
  description: string;
  stats?: Record<string, number>;
  [key: string]: unknown;
}

// Create
export function createEntity<T extends Record<string, unknown>>(
  type: EntityType,
  name: string,
  data: T,
  worldId?: number
): Entity<T> {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO entities (world_id, type, name, data)
    VALUES (?, ?, ?, ?)
    RETURNING id, world_id as worldId, type, name, data, created_at as createdAt
  `);
  const row = stmt.get(worldId ?? null, type, name, JSON.stringify(data)) as {
    id: number;
    worldId: number | null;
    type: EntityType;
    name: string;
    data: string;
    createdAt: number;
  };
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
    SELECT id, world_id as worldId, type, name, data, created_at as createdAt
    FROM entities WHERE id = ?
  `);
  const row = stmt.get(id) as {
    id: number;
    worldId: number | null;
    type: EntityType;
    name: string;
    data: string;
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
    stmt = db.prepare(`
      SELECT id, world_id as worldId, type, name, data, created_at as createdAt
      FROM entities WHERE type = ? AND world_id = ?
      ORDER BY name
    `);
    rows = stmt.all(type, worldId);
  } else {
    stmt = db.prepare(`
      SELECT id, world_id as worldId, type, name, data, created_at as createdAt
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
  let query = `
    SELECT id, world_id as worldId, type, name, data, created_at as createdAt
    FROM entities WHERE name = ?
  `;
  const params: (string | number)[] = [name];

  if (type) {
    query += " AND type = ?";
    params.push(type);
  }
  if (worldId !== undefined) {
    query += " AND world_id = ?";
    params.push(worldId);
  }

  const stmt = db.prepare(query);
  const row = stmt.get(...params) as {
    id: number;
    worldId: number | null;
    type: EntityType;
    name: string;
    data: string;
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
    RETURNING id, world_id as worldId, type, name, data, created_at as createdAt
  `);
  const row = stmt.get(newName, JSON.stringify(newData), id) as {
    id: number;
    worldId: number | null;
    type: EntityType;
    name: string;
    data: string;
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
