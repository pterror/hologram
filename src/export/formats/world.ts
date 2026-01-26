/**
 * World Export
 *
 * Exports entire worlds including all entities, relationships, and optional chronicle.
 */

import { getDb } from "../../db";
import {
  getEntitiesByType,
  type Entity,
  type CharacterData,
  type LocationData,
  type ItemData,
  type FactionData,
} from "../../db/entities";
import type {
  WorldExport,
  RelationshipExport,
  FactExport,
  ChronicleExportEntry,
  WorldExportOptions,
} from "../types";
import type { WorldConfig } from "../../config/types";

/**
 * Export a complete world with all its entities.
 */
export function exportWorld(
  worldId: number,
  options: WorldExportOptions = {}
): WorldExport | null {
  const db = getDb();

  // Get world record
  const world = db
    .prepare(
      `SELECT id, name, description, lore, rules, config, data, creator_id
       FROM worlds WHERE id = ?`
    )
    .get(worldId) as {
    id: number;
    name: string;
    description: string | null;
    lore: string | null;
    rules: string | null;
    config: string | null;
    data: string | null;
    creator_id: string | null;
  } | null;

  if (!world) {
    return null;
  }

  // Get all entities by type
  const characters = getEntitiesByType<CharacterData>("character", worldId);
  const locations = getEntitiesByType<LocationData>("location", worldId);
  const items = getEntitiesByType<ItemData>("item", worldId);
  const concepts = getEntitiesByType("concept", worldId);
  const factions = getEntitiesByType<FactionData>("faction", worldId);

  // Get all entity IDs for relationship lookup
  const allEntityIds = [
    ...characters.map((e) => e.id),
    ...locations.map((e) => e.id),
    ...items.map((e) => e.id),
    ...concepts.map((e) => e.id),
    ...factions.map((e) => e.id),
  ];

  // Get relationships for all entities
  const relationships = getRelationshipsForEntities(allEntityIds);

  const result: WorldExport = {
    version: "1.0",
    exportedAt: Date.now(),
    world: {
      id: world.id,
      name: world.name,
      description: world.description,
      lore: world.lore,
      rules: world.rules,
      config: world.config ? (JSON.parse(world.config) as WorldConfig) : null,
      data: world.data ? JSON.parse(world.data) : {},
      creatorId: world.creator_id,
    },
    entities: {
      characters,
      locations,
      items,
      concepts,
      factions,
    },
    relationships,
  };

  // Optionally include facts
  if (options.includeFacts) {
    result.facts = getFacts(worldId);
  }

  // Optionally include chronicle
  if (options.includeChronicle) {
    result.chronicle = getChronicle(worldId);
  }

  return result;
}

function getRelationshipsForEntities(entityIds: number[]): RelationshipExport[] {
  if (entityIds.length === 0) return [];

  const db = getDb();
  const placeholders = entityIds.map(() => "?").join(",");

  const rows = db
    .prepare(
      `SELECT r.source_id, r.target_id, e.name as targetName, e.type as targetType,
              r.type as relationshipType, r.data
       FROM relationships r
       JOIN entities e ON e.id = r.target_id
       WHERE r.source_id IN (${placeholders})`
    )
    .all(...entityIds) as Array<{
    source_id: number;
    target_id: number;
    targetName: string;
    targetType: string;
    relationshipType: string;
    data: string | null;
  }>;

  return rows.map((row) => ({
    targetId: row.target_id,
    targetName: row.targetName,
    targetType: row.targetType,
    relationshipType: row.relationshipType,
    data: row.data ? JSON.parse(row.data) : null,
  }));
}

function getFacts(worldId: number): FactExport[] {
  const db = getDb();

  // Get facts for entities in this world
  const rows = db
    .prepare(
      `SELECT f.id, f.entity_id, f.content, f.importance, f.created_at
       FROM facts f
       LEFT JOIN entities e ON e.id = f.entity_id
       WHERE e.world_id = ? OR f.entity_id IS NULL`
    )
    .all(worldId) as Array<{
    id: number;
    entity_id: number | null;
    content: string;
    importance: number;
    created_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    entityId: row.entity_id,
    content: row.content,
    importance: row.importance,
    createdAt: row.created_at,
  }));
}

function getChronicle(worldId: number): ChronicleExportEntry[] {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT id, scene_id, type, content, importance, perspective, visibility, source, created_at
       FROM chronicle
       WHERE world_id = ?
       ORDER BY created_at ASC`
    )
    .all(worldId) as Array<{
    id: number;
    scene_id: number | null;
    type: string;
    content: string;
    importance: number;
    perspective: string;
    visibility: string;
    source: string;
    created_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    sceneId: row.scene_id,
    type: row.type,
    content: row.content,
    importance: row.importance,
    perspective: row.perspective,
    visibility: row.visibility,
    source: row.source,
    createdAt: row.created_at,
  }));
}

/**
 * Validate a world export structure.
 */
export function validateWorldExport(data: unknown): data is WorldExport {
  if (!data || typeof data !== "object") return false;

  const d = data as Record<string, unknown>;
  if (d.version !== "1.0") return false;
  if (!d.world || typeof d.world !== "object") return false;
  if (!d.entities || typeof d.entities !== "object") return false;

  return true;
}
