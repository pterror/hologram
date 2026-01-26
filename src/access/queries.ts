/**
 * Access Control Database Queries
 *
 * Low-level database operations for the access control system.
 */

import { getDb } from "../db";
import type {
  Role,
  AccessorType,
  EntityAccessGrant,
  UserWorldAccess,
  GuildWorldAccess,
  EntityWorldLink,
} from "./types";

// === Entity Access Grants ===

/** Get all access grants for an entity */
export function getEntityAccessGrants(entityId: number): EntityAccessGrant[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT entity_id as entityId, accessor_type as accessorType,
              accessor_id as accessorId, role, created_at as createdAt
       FROM entity_access WHERE entity_id = ?`
    )
    .all(entityId) as EntityAccessGrant[];
  return rows;
}

/** Get access grant for specific accessor on entity */
export function getEntityAccessGrant(
  entityId: number,
  accessorType: AccessorType,
  accessorId: string
): EntityAccessGrant | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT entity_id as entityId, accessor_type as accessorType,
              accessor_id as accessorId, role, created_at as createdAt
       FROM entity_access
       WHERE entity_id = ? AND accessor_type = ? AND accessor_id = ?`
    )
    .get(entityId, accessorType, accessorId) as EntityAccessGrant | null;
  return row;
}

/** Grant access to an entity */
export function grantEntityAccess(
  entityId: number,
  accessorType: AccessorType,
  accessorId: string,
  role: Role
): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO entity_access (entity_id, accessor_type, accessor_id, role)
     VALUES (?, ?, ?, ?)`
  ).run(entityId, accessorType, accessorId, role);
}

/** Revoke access from an entity */
export function revokeEntityAccess(
  entityId: number,
  accessorType: AccessorType,
  accessorId: string
): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `DELETE FROM entity_access
       WHERE entity_id = ? AND accessor_type = ? AND accessor_id = ?`
    )
    .run(entityId, accessorType, accessorId);
  return result.changes > 0;
}

/** Check if entity has any explicit access grants (triggers restrictive mode) */
export function entityHasExplicitAccess(entityId: number): boolean {
  const db = getDb();
  const row = db
    .prepare(`SELECT 1 FROM entity_access WHERE entity_id = ? LIMIT 1`)
    .get(entityId);
  return !!row;
}

// === User World Access ===

/** Get all world access for a user */
export function getUserWorldAccess(userId: string): UserWorldAccess[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT user_id as userId, world_id as worldId, role, created_at as createdAt
       FROM user_worlds WHERE user_id = ?`
    )
    .all(userId) as UserWorldAccess[];
  return rows;
}

/** Get user's role for a specific world */
export function getUserWorldRole(
  userId: string,
  worldId: number
): Role | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT role FROM user_worlds WHERE user_id = ? AND world_id = ?`
    )
    .get(userId, worldId) as { role: Role } | null;
  return row?.role ?? null;
}

/** Grant user access to a world */
export function grantUserWorldAccess(
  userId: string,
  worldId: number,
  role: Role
): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO user_worlds (user_id, world_id, role)
     VALUES (?, ?, ?)`
  ).run(userId, worldId, role);
}

/** Revoke user's world access */
export function revokeUserWorldAccess(
  userId: string,
  worldId: number
): boolean {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM user_worlds WHERE user_id = ? AND world_id = ?`)
    .run(userId, worldId);
  return result.changes > 0;
}

// === Guild World Access ===

/** Get guild's role for a specific world */
export function getGuildWorldRole(
  guildId: string,
  worldId: number
): Role | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT role FROM guild_worlds WHERE guild_id = ? AND world_id = ?`)
    .get(guildId, worldId) as { role: Role } | null;
  return row?.role ?? null;
}

/** Get all guild-world links for a world */
export function getGuildsForWorld(worldId: number): GuildWorldAccess[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT guild_id as guildId, world_id as worldId, role, data
       FROM guild_worlds WHERE world_id = ?`
    )
    .all(worldId) as Array<{
    guildId: string;
    worldId: number;
    role: string | null;
    data: string | null;
  }>;
  return rows.map((r) => ({
    guildId: r.guildId,
    worldId: r.worldId,
    role: (r.role ?? "owner") as Role,
    data: r.data ? JSON.parse(r.data) : null,
  }));
}

// === Entity-World Links ===

/** Get all worlds an entity is in */
export function getEntityWorlds(entityId: number): EntityWorldLink[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT entity_id as entityId, world_id as worldId, is_primary as isPrimary
       FROM entity_worlds WHERE entity_id = ?`
    )
    .all(entityId) as Array<{
    entityId: number;
    worldId: number;
    isPrimary: number;
  }>;
  return rows.map((r) => ({
    entityId: r.entityId,
    worldId: r.worldId,
    isPrimary: !!r.isPrimary,
  }));
}

/** Get all entities in a world */
export function getWorldEntities(
  worldId: number,
  type?: string
): Array<{ entityId: number; isPrimary: boolean }> {
  const db = getDb();
  let query = `
    SELECT ew.entity_id as entityId, ew.is_primary as isPrimary
    FROM entity_worlds ew
    JOIN entities e ON e.id = ew.entity_id
    WHERE ew.world_id = ?
  `;
  const params: (number | string)[] = [worldId];

  if (type) {
    query += " AND e.type = ?";
    params.push(type);
  }

  const rows = db.prepare(query).all(...params) as Array<{
    entityId: number;
    isPrimary: number;
  }>;
  return rows.map((r) => ({
    entityId: r.entityId,
    isPrimary: !!r.isPrimary,
  }));
}

/** Link an entity to a world */
export function linkEntityToWorld(
  entityId: number,
  worldId: number,
  isPrimary: boolean = false
): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO entity_worlds (entity_id, world_id, is_primary)
     VALUES (?, ?, ?)`
  ).run(entityId, worldId, isPrimary ? 1 : 0);
}

/** Unlink an entity from a world */
export function unlinkEntityFromWorld(
  entityId: number,
  worldId: number
): boolean {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM entity_worlds WHERE entity_id = ? AND world_id = ?`)
    .run(entityId, worldId);
  return result.changes > 0;
}

/** Set the primary world for an entity */
export function setEntityPrimaryWorld(
  entityId: number,
  worldId: number
): void {
  const db = getDb();
  // Clear existing primary flags
  db.prepare(
    `UPDATE entity_worlds SET is_primary = 0 WHERE entity_id = ?`
  ).run(entityId);
  // Set new primary
  db.prepare(
    `UPDATE entity_worlds SET is_primary = 1 WHERE entity_id = ? AND world_id = ?`
  ).run(entityId, worldId);
}

/** Get the primary world for an entity */
export function getEntityPrimaryWorld(entityId: number): number | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT world_id FROM entity_worlds WHERE entity_id = ? AND is_primary = 1`
    )
    .get(entityId) as { world_id: number } | null;
  return row?.world_id ?? null;
}

// === Creator Lookups ===

/** Get entity creator */
export function getEntityCreator(entityId: number): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT creator_id FROM entities WHERE id = ?`)
    .get(entityId) as { creator_id: string | null } | null;
  return row?.creator_id ?? null;
}

/** Get world creator */
export function getWorldCreator(worldId: number): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT creator_id FROM worlds WHERE id = ?`)
    .get(worldId) as { creator_id: string | null } | null;
  return row?.creator_id ?? null;
}

/** Get entity's parent (for location hierarchy) */
export function getEntityParent(entityId: number): number | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT data FROM entities WHERE id = ?`)
    .get(entityId) as { data: string } | null;
  if (!row) return null;
  try {
    const data = JSON.parse(row.data);
    return data.parentId ?? null;
  } catch {
    return null;
  }
}
