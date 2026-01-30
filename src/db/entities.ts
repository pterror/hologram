import { getDb } from "./index";
import { getActiveEffectFacts } from "./effects";
import type { EvaluatedFactsDefaults, MemoryScope } from "../logic/expr";

// =============================================================================
// Entity Operations
// =============================================================================

export interface Entity {
  id: number;
  name: string;
  owned_by: string | null;
  created_at: string;
  template: string | null;
}

export function createEntity(name: string, ownedBy?: string): Entity {
  const db = getDb();
  const row = db.prepare(`
    INSERT INTO entities (name, owned_by)
    VALUES (?, ?)
    RETURNING id, name, owned_by, created_at
  `).get(name, ownedBy ?? null) as Entity;
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
    RETURNING id, name, owned_by, created_at
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

/**
 * Search entities owned by a specific user.
 * Used for commands that require ownership (delete, transfer).
 */
export function searchEntitiesOwnedBy(query: string, userId: string, limit = 20): Entity[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM entities
    WHERE name LIKE ? COLLATE NOCASE AND owned_by = ?
    ORDER BY name
    LIMIT ?
  `).all(`%${query}%`, userId, limit) as Entity[];
}

// =============================================================================
// Entity Config (directive storage in columns)
// =============================================================================

export interface EntityConfig {
  config_context: string | null;
  config_model: string | null;
  config_respond: string | null;
  config_stream_mode: string | null;
  config_stream_delimiters: string | null;
  config_avatar: string | null;
  config_memory: string | null;
  config_freeform: number;
  config_strip: string | null;
  config_view: string | null;
  config_edit: string | null;
  config_use: string | null;
  config_blacklist: string | null;
}

const CONFIG_COLUMNS = `
  config_context, config_model, config_respond,
  config_stream_mode, config_stream_delimiters,
  config_avatar, config_memory, config_freeform,
  config_strip, config_view, config_edit, config_use, config_blacklist
`.trim();

export function getEntityConfig(entityId: number): EntityConfig | null {
  const db = getDb();
  return db.prepare(`SELECT ${CONFIG_COLUMNS} FROM entities WHERE id = ?`).get(entityId) as EntityConfig | null;
}

export function setEntityConfig(entityId: number, config: Partial<EntityConfig>): void {
  const db = getDb();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(config)) {
    sets.push(`${key} = ?`);
    values.push((value as string | number | null) ?? null);
  }
  if (sets.length === 0) return;
  values.push(entityId);
  db.prepare(`UPDATE entities SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

/** Convert config columns to permission defaults for parsePermissionDirectives */
export function getPermissionDefaults(entityId: number): {
  editList: string[] | "@everyone" | null;
  viewList: string[] | "@everyone" | null;
  useList: string[] | "@everyone" | null;
  blacklist: string[];
} {
  const config = getEntityConfig(entityId);
  if (!config) return { editList: null, viewList: null, useList: null, blacklist: [] };
  return {
    editList: config.config_edit ? JSON.parse(config.config_edit) : null,
    viewList: config.config_view ? JSON.parse(config.config_view) : null,
    useList: config.config_use ? JSON.parse(config.config_use) : null,
    blacklist: config.config_blacklist ? JSON.parse(config.config_blacklist) : [],
  };
}

/** Convert config columns to evaluateFacts defaults */
export function getEntityEvalDefaults(entityId: number): EvaluatedFactsDefaults {
  const config = getEntityConfig(entityId);
  if (!config) return {};
  return {
    contextExpr: config.config_context,
    modelSpec: config.config_model,
    avatarUrl: config.config_avatar,
    streamMode: config.config_stream_mode as "lines" | "full" | null,
    streamDelimiter: config.config_stream_delimiters ? JSON.parse(config.config_stream_delimiters) : null,
    memoryScope: (config.config_memory as MemoryScope) ?? "none",
    isFreeform: !!config.config_freeform,
    stripPatterns: config.config_strip ? JSON.parse(config.config_strip) : null,
    shouldRespond: config.config_respond === "true" ? true : config.config_respond === "false" ? false : null,
  };
}

// =============================================================================
// Template Operations
// =============================================================================

export function getEntityTemplate(id: number): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT template FROM entities WHERE id = ?`).get(id) as { template: string | null } | null;
  return row?.template ?? null;
}

export function setEntityTemplate(id: number, template: string | null): void {
  const db = getDb();
  db.prepare(`UPDATE entities SET template = ? WHERE id = ?`).run(template, id);
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

export function updateFactByContent(entityId: number, oldContent: string, newContent: string): Fact | null {
  const db = getDb();
  return db.prepare(`
    UPDATE facts SET content = ?, updated_at = CURRENT_TIMESTAMP
    WHERE entity_id = ? AND content = ?
    RETURNING id, entity_id, content, created_at, updated_at
  `).get(newContent, entityId, oldContent) as Fact | null;
}

export function removeFact(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM facts WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function removeFactByContent(entityId: number, content: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM facts WHERE entity_id = ? AND content = ?`).run(entityId, content);
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
 * Batch load entities with their facts.
 * Much more efficient than calling getEntityWithFacts in a loop.
 */
export function getEntitiesWithFacts(ids: number[]): Map<number, EntityWithFacts> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");

  const entities = db.prepare(`
    SELECT * FROM entities WHERE id IN (${placeholders})
  `).all(...ids) as Entity[];

  const facts = db.prepare(`
    SELECT * FROM facts WHERE entity_id IN (${placeholders}) ORDER BY created_at
  `).all(...ids) as Fact[];

  // Group facts by entity_id
  const factsByEntity = new Map<number, Fact[]>();
  for (const fact of facts) {
    const existing = factsByEntity.get(fact.entity_id) || [];
    existing.push(fact);
    factsByEntity.set(fact.entity_id, existing);
  }

  // Build result map
  const result = new Map<number, EntityWithFacts>();
  for (const entity of entities) {
    result.set(entity.id, {
      ...entity,
      facts: factsByEntity.get(entity.id) || [],
    });
  }
  return result;
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
  return `<facts entity="${entity.name}" id="${entity.id}">\n${factLines}\n</facts>`;
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
    WHERE name = ? COLLATE NOCASE AND owned_by = 'system'
  `).get(name) as Entity | null;
}

export function getSystemEntities(): Entity[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM entities WHERE owned_by = 'system'
  `).all() as Entity[];
}

export function ensureSystemEntity(name: string, facts: string[]): EntityWithFacts {
  let entity = getSystemEntity(name);
  if (!entity) {
    entity = createEntity(name, "system");
  }
  // Always update facts to latest
  setFacts(entity.id, facts);
  return getEntityWithFacts(entity.id)!;
}

/**
 * Transfer ownership of an entity to a new user.
 */
export function transferOwnership(entityId: number, newOwnerId: string): Entity | null {
  const db = getDb();
  return db.prepare(`
    UPDATE entities SET owned_by = ? WHERE id = ?
    RETURNING id, name, owned_by, created_at
  `).get(newOwnerId, entityId) as Entity | null;
}
