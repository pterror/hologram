import { getDb } from "../db";

export interface UserPersona {
  id: number;
  userId: string;
  worldId: number | null;
  name: string;
  persona: string | null;
  avatar: string | null;
  data: Record<string, unknown> | null;
  createdAt: number;
}

interface PersonaRow {
  id: number;
  user_id: string;
  world_id: number | null;
  name: string;
  persona: string | null;
  avatar: string | null;
  data: string | null;
  created_at: number;
}

function mapRow(row: PersonaRow): UserPersona {
  return {
    id: row.id,
    userId: row.user_id,
    worldId: row.world_id,
    name: row.name,
    persona: row.persona,
    avatar: row.avatar,
    data: row.data ? JSON.parse(row.data) : null,
    createdAt: row.created_at,
  };
}

/**
 * Get the active persona for a user in a given world.
 * Falls back to the global persona (worldId = NULL) if no world-specific one exists.
 */
export function getPersona(userId: string, worldId?: number | null): UserPersona | null {
  const db = getDb();

  // Try world-specific first
  if (worldId !== undefined && worldId !== null) {
    const row = db.prepare(
      "SELECT * FROM user_personas WHERE user_id = ? AND world_id = ?"
    ).get(userId, worldId) as PersonaRow | null;
    if (row) return mapRow(row);
  }

  // Fall back to global persona
  const row = db.prepare(
    "SELECT * FROM user_personas WHERE user_id = ? AND world_id IS NULL"
  ).get(userId) as PersonaRow | null;

  return row ? mapRow(row) : null;
}

/** Set or update a user's persona for a world (or global if worldId is null) */
export function setPersona(
  userId: string,
  name: string,
  options?: {
    worldId?: number | null;
    persona?: string;
    avatar?: string;
    data?: Record<string, unknown>;
  }
): UserPersona {
  const db = getDb();
  const worldId = options?.worldId ?? null;
  const persona = options?.persona ?? null;
  const avatar = options?.avatar ?? null;
  const data = options?.data ? JSON.stringify(options.data) : null;

  const row = db.prepare(`
    INSERT INTO user_personas (user_id, world_id, name, persona, avatar, data)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, world_id) DO UPDATE SET
      name = excluded.name,
      persona = COALESCE(excluded.persona, user_personas.persona),
      avatar = COALESCE(excluded.avatar, user_personas.avatar),
      data = COALESCE(excluded.data, user_personas.data)
    RETURNING *
  `).get(userId, worldId, name, persona, avatar, data) as PersonaRow;

  return mapRow(row);
}

/** Update just the persona text */
export function updatePersonaText(
  userId: string,
  persona: string,
  worldId?: number | null
): boolean {
  const db = getDb();
  let result;
  if (worldId !== undefined && worldId !== null) {
    result = db.prepare(
      "UPDATE user_personas SET persona = ? WHERE user_id = ? AND world_id = ?"
    ).run(persona, userId, worldId);
  } else {
    result = db.prepare(
      "UPDATE user_personas SET persona = ? WHERE user_id = ? AND world_id IS NULL"
    ).run(persona, userId);
  }
  return result.changes > 0;
}

/** Update just the avatar URL */
export function updatePersonaAvatar(
  userId: string,
  avatar: string,
  worldId?: number | null
): boolean {
  const db = getDb();
  let result;
  if (worldId !== undefined && worldId !== null) {
    result = db.prepare(
      "UPDATE user_personas SET avatar = ? WHERE user_id = ? AND world_id = ?"
    ).run(avatar, userId, worldId);
  } else {
    result = db.prepare(
      "UPDATE user_personas SET avatar = ? WHERE user_id = ? AND world_id IS NULL"
    ).run(avatar, userId);
  }
  return result.changes > 0;
}

/** Clear/delete a user's persona */
export function clearPersona(userId: string, worldId?: number | null): boolean {
  const db = getDb();
  let result;
  if (worldId !== undefined && worldId !== null) {
    result = db.prepare(
      "DELETE FROM user_personas WHERE user_id = ? AND world_id = ?"
    ).run(userId, worldId);
  } else {
    result = db.prepare(
      "DELETE FROM user_personas WHERE user_id = ? AND world_id IS NULL"
    ).run(userId);
  }
  return result.changes > 0;
}

/** List all personas for a user (across worlds) */
export function listPersonas(userId: string): UserPersona[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM user_personas WHERE user_id = ? ORDER BY created_at ASC"
  ).all(userId) as PersonaRow[];

  return rows.map(mapRow);
}

/** Format persona for AI context */
export function formatPersonaForContext(persona: UserPersona): string {
  const lines: string[] = [`## User: ${persona.name}`];

  if (persona.persona) {
    lines.push(persona.persona);
  }

  return lines.join("\n");
}
