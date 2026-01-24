import { getDb } from "./index";

export interface Relationship {
  id: number;
  sourceId: number;
  targetId: number;
  type: string;
  data: Record<string, unknown> | null;
  createdAt: number;
}

// Common relationship types
export const RelTypes = {
  KNOWS: "knows",
  OWNS: "owns",
  LOCATED_AT: "located_at",
  CONNECTED_TO: "connected_to",
  RELATED_TO: "related_to",
} as const;

export function createRelationship(
  sourceId: number,
  targetId: number,
  type: string,
  data?: Record<string, unknown>
): Relationship {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO relationships (source_id, target_id, type, data)
    VALUES (?, ?, ?, ?)
    RETURNING id, source_id as sourceId, target_id as targetId, type, data, created_at as createdAt
  `);
  const row = stmt.get(
    sourceId,
    targetId,
    type,
    data ? JSON.stringify(data) : null
  ) as {
    id: number;
    sourceId: number;
    targetId: number;
    type: string;
    data: string | null;
    createdAt: number;
  };
  return {
    ...row,
    data: row.data ? JSON.parse(row.data) : null,
  };
}

export function getRelationshipsFrom(
  sourceId: number,
  type?: string
): Relationship[] {
  const db = getDb();
  let query = `
    SELECT id, source_id as sourceId, target_id as targetId, type, data, created_at as createdAt
    FROM relationships WHERE source_id = ?
  `;
  const params: (number | string)[] = [sourceId];

  if (type) {
    query += " AND type = ?";
    params.push(type);
  }

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as {
    id: number;
    sourceId: number;
    targetId: number;
    type: string;
    data: string | null;
    createdAt: number;
  }[];

  return rows.map((row) => ({
    ...row,
    data: row.data ? JSON.parse(row.data) : null,
  }));
}

export function getRelationshipsTo(
  targetId: number,
  type?: string
): Relationship[] {
  const db = getDb();
  let query = `
    SELECT id, source_id as sourceId, target_id as targetId, type, data, created_at as createdAt
    FROM relationships WHERE target_id = ?
  `;
  const params: (number | string)[] = [targetId];

  if (type) {
    query += " AND type = ?";
    params.push(type);
  }

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as {
    id: number;
    sourceId: number;
    targetId: number;
    type: string;
    data: string | null;
    createdAt: number;
  }[];

  return rows.map((row) => ({
    ...row,
    data: row.data ? JSON.parse(row.data) : null,
  }));
}

export function getRelationshipsBetween(
  entityId1: number,
  entityId2: number
): Relationship[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, source_id as sourceId, target_id as targetId, type, data, created_at as createdAt
    FROM relationships
    WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
  `);
  const rows = stmt.all(entityId1, entityId2, entityId2, entityId1) as {
    id: number;
    sourceId: number;
    targetId: number;
    type: string;
    data: string | null;
    createdAt: number;
  }[];

  return rows.map((row) => ({
    ...row,
    data: row.data ? JSON.parse(row.data) : null,
  }));
}

export function deleteRelationship(id: number): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM relationships WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

export function deleteRelationshipsBetween(
  sourceId: number,
  targetId: number,
  type?: string
): number {
  const db = getDb();
  let query = "DELETE FROM relationships WHERE source_id = ? AND target_id = ?";
  const params: (number | string)[] = [sourceId, targetId];

  if (type) {
    query += " AND type = ?";
    params.push(type);
  }

  const stmt = db.prepare(query);
  const result = stmt.run(...params);
  return result.changes;
}
