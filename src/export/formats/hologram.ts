/**
 * Hologram Native Export Format
 *
 * Exports characters in Hologram's native JSON format with full data fidelity.
 */

import { getDb } from "../../db";
import { getEntity, type Entity, type CharacterData } from "../../db/entities";
import { getEntityWorlds } from "../../access/queries";
import type {
  HologramCharacterExport,
  CharacterStateExport,
  EffectExport,
  EquipmentExport,
  RelationshipExport,
  FactionMembershipExport,
  GeneratedImageExport,
  CharacterExportOptions,
} from "../types";

/**
 * Export a character in Hologram native format.
 */
export function exportCharacter(
  characterId: number,
  options: CharacterExportOptions = {}
): HologramCharacterExport | null {
  const character = getEntity<CharacterData>(characterId);
  if (!character || character.type !== "character") {
    return null;
  }

  const {
    includeState = true,
    includeEffects = true,
    includeRelationships = true,
    includeFactions = true,
    includeImages = true,
  } = options;

  const result: HologramCharacterExport = {
    version: "1.0",
    exportedAt: Date.now(),
    character: {
      id: character.id,
      name: character.name,
      data: character.data,
      creatorId: character.creatorId,
      createdAt: character.createdAt,
    },
  };

  // Get worlds the character is in
  const entityWorlds = getEntityWorlds(characterId);
  if (entityWorlds.length > 0) {
    const db = getDb();
    result.worlds = entityWorlds.map((ew) => {
      const world = db
        .prepare("SELECT name FROM worlds WHERE id = ?")
        .get(ew.worldId) as { name: string } | null;
      return {
        worldId: ew.worldId,
        worldName: world?.name ?? "Unknown",
        isPrimary: ew.isPrimary,
      };
    });
  }

  // Get character state (most recent)
  if (includeState) {
    result.state = getCharacterState(characterId);
  }

  // Get active effects
  if (includeEffects) {
    result.effects = getCharacterEffects(characterId);
  }

  // Get equipment
  if (includeState) {
    result.equipment = getCharacterEquipment(characterId);
  }

  // Get relationships
  if (includeRelationships) {
    result.relationships = getCharacterRelationships(characterId);
  }

  // Get faction memberships
  if (includeFactions) {
    result.factions = getCharacterFactions(characterId);
  }

  // Get generated images
  if (includeImages) {
    result.generatedImages = getCharacterImages(characterId);
  }

  return result;
}

function getCharacterState(characterId: number): CharacterStateExport | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT attributes, body, outfit FROM character_state
       WHERE character_id = ? ORDER BY updated_at DESC LIMIT 1`
    )
    .get(characterId) as {
    attributes: string | null;
    body: string | null;
    outfit: string | null;
  } | null;

  if (!row) return null;

  return {
    attributes: row.attributes ? JSON.parse(row.attributes) : null,
    body: row.body ? JSON.parse(row.body) : null,
    outfit: row.outfit ? JSON.parse(row.outfit) : null,
  };
}

function getCharacterEffects(characterId: number): EffectExport[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT name, type, description, duration, modifiers, body_changes, flags
       FROM character_effects WHERE character_id = ?`
    )
    .all(characterId) as Array<{
    name: string;
    type: string;
    description: string | null;
    duration: string;
    modifiers: string | null;
    body_changes: string | null;
    flags: string | null;
  }>;

  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    description: row.description,
    duration: row.duration,
    modifiers: row.modifiers ? JSON.parse(row.modifiers) : null,
    bodyChanges: row.body_changes ? JSON.parse(row.body_changes) : null,
    flags: row.flags ? JSON.parse(row.flags) : null,
  }));
}

function getCharacterEquipment(characterId: number): EquipmentExport[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ce.slot, ce.item_id, e.name as itemName
       FROM character_equipment ce
       JOIN entities e ON e.id = ce.item_id
       WHERE ce.character_id = ?`
    )
    .all(characterId) as Array<{
    slot: string;
    item_id: number;
    itemName: string;
  }>;

  return rows.map((row) => ({
    slot: row.slot,
    itemId: row.item_id,
    itemName: row.itemName,
  }));
}

function getCharacterRelationships(characterId: number): RelationshipExport[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.target_id, e.name as targetName, e.type as targetType,
              r.type as relationshipType, r.data
       FROM relationships r
       JOIN entities e ON e.id = r.target_id
       WHERE r.source_id = ?`
    )
    .all(characterId) as Array<{
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

function getCharacterFactions(characterId: number): FactionMembershipExport[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT fm.faction_id, e.name as factionName, fm.rank, fm.standing
       FROM faction_members fm
       JOIN entities e ON e.id = fm.faction_id
       WHERE fm.character_id = ?`
    )
    .all(characterId) as Array<{
    faction_id: number;
    factionName: string;
    rank: string | null;
    standing: number;
  }>;

  return rows.map((row) => ({
    factionId: row.faction_id,
    factionName: row.factionName,
    rank: row.rank,
    standing: row.standing,
  }));
}

function getCharacterImages(characterId: number): GeneratedImageExport[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT url, image_type, width, height, created_at
       FROM generated_images
       WHERE entity_id = ? AND entity_type = 'character'
       ORDER BY created_at DESC`
    )
    .all(characterId) as Array<{
    url: string;
    image_type: string;
    width: number | null;
    height: number | null;
    created_at: number;
  }>;

  return rows.map((row) => ({
    url: row.url,
    imageType: row.image_type,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  }));
}

/**
 * Import a character from Hologram native format.
 */
export function importCharacter(
  data: HologramCharacterExport,
  worldId?: number,
  creatorId?: string
): Entity<CharacterData> | null {
  // This would be used for import functionality
  // For now, just validate the format
  if (data.version !== "1.0" || !data.character) {
    return null;
  }

  // Import logic would go here
  // For now, return null as import is not implemented
  return null;
}
