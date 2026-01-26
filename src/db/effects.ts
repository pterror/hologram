/**
 * Effects - temporary fact overlays that expire after a duration.
 *
 * When active, effect facts are merged with entity facts.
 * When expired, they're removed automatically.
 */

import { getDb } from "./index";

export interface Effect {
  id: number;
  entity_id: number;
  content: string;
  source: string | null;
  expires_at: string;
  created_at: string;
}

/**
 * Add a temporary effect to an entity.
 */
export function addEffect(
  entityId: number,
  content: string,
  durationMs: number,
  source?: string
): Effect {
  const db = getDb();
  const expiresAt = new Date(Date.now() + durationMs).toISOString();

  const stmt = db.prepare(`
    INSERT INTO effects (entity_id, content, source, expires_at)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `);

  return stmt.get(entityId, content, source ?? null, expiresAt) as Effect;
}

/**
 * Get all active (non-expired) effects for an entity.
 */
export function getActiveEffects(entityId: number): Effect[] {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    SELECT * FROM effects
    WHERE entity_id = ? AND expires_at > ?
    ORDER BY created_at ASC
  `);

  return stmt.all(entityId, now) as Effect[];
}

/**
 * Get active effect facts for an entity (just the content strings).
 */
export function getActiveEffectFacts(entityId: number): string[] {
  return getActiveEffects(entityId).map((e) => e.content);
}

/**
 * Remove a specific effect by ID.
 */
export function removeEffect(effectId: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM effects WHERE id = ?`);
  const result = stmt.run(effectId);
  return result.changes > 0;
}

/**
 * Remove all effects from an entity.
 */
export function clearEffects(entityId: number): number {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM effects WHERE entity_id = ?`);
  const result = stmt.run(entityId);
  return result.changes;
}

/**
 * Remove all effects with a specific source from an entity.
 */
export function clearEffectsBySource(entityId: number, source: string): number {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM effects WHERE entity_id = ? AND source = ?`);
  const result = stmt.run(entityId, source);
  return result.changes;
}

/**
 * Clean up all expired effects across all entities.
 * Should be called periodically.
 */
export function cleanupExpiredEffects(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`DELETE FROM effects WHERE expires_at <= ?`);
  const result = stmt.run(now);
  return result.changes;
}

/**
 * Extend an effect's duration.
 */
export function extendEffect(effectId: number, additionalMs: number): boolean {
  const db = getDb();

  const stmt = db.prepare(`
    UPDATE effects
    SET expires_at = datetime(expires_at, '+' || ? || ' seconds')
    WHERE id = ?
  `);

  const result = stmt.run(Math.floor(additionalMs / 1000), effectId);
  return result.changes > 0;
}

/**
 * Check if an entity has any active effects.
 */
export function hasActiveEffects(entityId: number): boolean {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    SELECT 1 FROM effects
    WHERE entity_id = ? AND expires_at > ?
    LIMIT 1
  `);

  return stmt.get(entityId, now) !== null;
}
