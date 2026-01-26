import { getDb } from "./index";
import { getActiveEffectFacts } from "./effects";

// =============================================================================
// Entity Operations
// =============================================================================

export interface Entity {
  id: number;
  name: string;
  created_by: string | null;
  created_at: string;
}

export function createEntity(name: string, createdBy?: string): Entity {
  const db = getDb();
  const row = db.prepare(`
    INSERT INTO entities (name, created_by)
    VALUES (?, ?)
    RETURNING id, name, created_by, created_at
  `).get(name, createdBy ?? null) as Entity;
  return row;
}

export function getEntity(id: number): Entity | null {
  const db = getDb();
  return db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id) as Entity | null;
}

export function getEntityByName(name: string): Entity | null {
  const db = getDb();
  return db.prepare(`SELECT * FROM entities WHERE name = ? COLLATE NOCASE`).get(name) as Entity | null;
}

export function updateEntity(id: number, name: string): Entity | null {
  const db = getDb();
  return db.prepare(`
    UPDATE entities SET name = ? WHERE id = ?
    RETURNING id, name, created_by, created_at
  `).get(name, id) as Entity | null;
}

export function deleteEntity(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM entities WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function listEntities(limit = 100, offset = 0): Entity[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM entities ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset) as Entity[];
}

export function searchEntities(query: string, limit = 20): Entity[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM entities
    WHERE name LIKE ? COLLATE NOCASE
    ORDER BY name
    LIMIT ?
  `).all(`%${query}%`, limit) as Entity[];
}

// =============================================================================
// Fact Operations
// =============================================================================

export interface Fact {
  id: number;
  entity_id: number;
  content: string;
  created_at: string;
  updated_at: string;
}

export function addFact(entityId: number, content: string): Fact {
  const db = getDb();
  return db.prepare(`
    INSERT INTO facts (entity_id, content)
    VALUES (?, ?)
    RETURNING id, entity_id, content, created_at, updated_at
  `).get(entityId, content) as Fact;
}

export function getFact(id: number): Fact | null {
  const db = getDb();
  return db.prepare(`SELECT * FROM facts WHERE id = ?`).get(id) as Fact | null;
}

export function getFactsForEntity(entityId: number): Fact[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM facts WHERE entity_id = ? ORDER BY created_at
  `).all(entityId) as Fact[];
}

export function updateFact(id: number, content: string): Fact | null {
  const db = getDb();
  return db.prepare(`
    UPDATE facts SET content = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    RETURNING id, entity_id, content, created_at, updated_at
  `).get(content, id) as Fact | null;
}

export function removeFact(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM facts WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function setFacts(entityId: number, contents: string[]): Fact[] {
  const db = getDb();
  // Clear existing facts
  db.prepare(`DELETE FROM facts WHERE entity_id = ?`).run(entityId);
  // Add new facts
  const insert = db.prepare(`
    INSERT INTO facts (entity_id, content)
    VALUES (?, ?)
    RETURNING id, entity_id, content, created_at, updated_at
  `);
  return contents.map(content => insert.get(entityId, content) as Fact);
}

// =============================================================================
// Combined View
// =============================================================================

export interface EntityWithFacts extends Entity {
  facts: Fact[];
}

export function getEntityWithFacts(id: number): EntityWithFacts | null {
  const entity = getEntity(id);
  if (!entity) return null;
  const facts = getFactsForEntity(id);
  return { ...entity, facts };
}

export function getEntityWithFactsByName(name: string): EntityWithFacts | null {
  const entity = getEntityByName(name);
  if (!entity) return null;
  const facts = getFactsForEntity(entity.id);
  return { ...entity, facts };
}

/**
 * Get all fact content strings for an entity, including active effects.
 * Effects are appended after permanent facts.
 */
export function getAllFactContent(entityId: number): string[] {
  const facts = getFactsForEntity(entityId).map((f) => f.content);
  const effects = getActiveEffectFacts(entityId);
  return [...facts, ...effects];
}

// =============================================================================
// Context Formatting
// =============================================================================

export function formatEntityForContext(entity: EntityWithFacts): string {
  const factLines = entity.facts.map(f => f.content).join("\n");
  return `<facts entity="${entity.name}">\n${factLines}\n</facts>`;
}

export function formatEntitiesForContext(entities: EntityWithFacts[]): string {
  return entities.map(formatEntityForContext).join("\n\n");
}

// =============================================================================
// System Entities
// =============================================================================

export function getSystemEntity(name: string): Entity | null {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM entities
    WHERE name = ? COLLATE NOCASE AND created_by = 'system'
  `).get(name) as Entity | null;
}

export function ensureSystemEntity(name: string, facts: string[]): EntityWithFacts {
  let entity = getSystemEntity(name);
  if (!entity) {
    entity = createEntity(name, "system");
    for (const fact of facts) {
      addFact(entity.id, fact);
    }
  }
  return getEntityWithFacts(entity.id)!;
}
