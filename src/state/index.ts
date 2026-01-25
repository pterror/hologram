import { getDb } from "../db";

// Effect types
export type EffectType =
  | "buff"
  | "debuff"
  | "curse"
  | "blessing"
  | "transformation"
  | "custom";

// Effect duration types
export type EffectDuration =
  | "instant"
  | "temporary"
  | "permanent"
  | "until_cured";

// Effect visibility
export type EffectVisibility = "visible" | "hidden" | "partial";

export interface Effect {
  id: number;
  characterId: number;
  sceneId: number | null;
  name: string;
  type: EffectType;
  description: string | null;
  duration: EffectDuration;
  expiresAt: number | null;
  turnsRemaining: number | null;
  modifiers: Record<string, number> | null;    // Attribute modifiers
  bodyChanges: Record<string, unknown> | null; // Form changes
  flags: string[] | null;                      // Status flags
  stacks: number;
  maxStacks: number | null;
  sourceType: string | null;
  sourceId: number | null;
  visibility: EffectVisibility;
  visibleDescription: string | null;
  createdAt: number;
}

export interface OutfitItem {
  name: string;
  slot?: string;        // "body", "feet", "head", etc.
  description?: string;
}

export interface OutfitData {
  description?: string;   // Freeform text: "A flowing red dress with gold trim"
  items?: OutfitItem[];   // Structured clothing items
}

export interface CharacterState {
  id: number;
  characterId: number;
  sceneId: number | null;
  attributes: Record<string, number>;
  body: Record<string, unknown>;
  outfit: OutfitData | null;
  updatedAt: number;
}

// Character state management

/** Get character state for a scene */
export function getCharacterState(
  characterId: number,
  sceneId: number | null
): CharacterState | null {
  const db = getDb();

  const stmt = db.prepare(`
    SELECT id, character_id, scene_id, attributes, body, outfit, updated_at
    FROM character_state
    WHERE character_id = ? AND (scene_id = ? OR (scene_id IS NULL AND ? IS NULL))
  `);

  const row = stmt.get(characterId, sceneId, sceneId) as {
    id: number;
    character_id: number;
    scene_id: number | null;
    attributes: string | null;
    body: string | null;
    outfit: string | null;
    updated_at: number;
  } | null;

  if (!row) return null;

  return {
    id: row.id,
    characterId: row.character_id,
    sceneId: row.scene_id,
    attributes: row.attributes ? JSON.parse(row.attributes) : {},
    body: row.body ? JSON.parse(row.body) : {},
    outfit: row.outfit ? JSON.parse(row.outfit) : null,
    updatedAt: row.updated_at,
  };
}

/** Create or update character state */
export function setCharacterState(
  characterId: number,
  sceneId: number | null,
  updates: {
    attributes?: Record<string, number>;
    body?: Record<string, unknown>;
    outfit?: OutfitData | null;
  }
): CharacterState {
  const db = getDb();

  const existing = getCharacterState(characterId, sceneId);

  if (existing) {
    // Update
    const newAttributes = updates.attributes !== undefined
      ? { ...existing.attributes, ...updates.attributes }
      : existing.attributes;
    const newBody = updates.body !== undefined
      ? { ...existing.body, ...updates.body }
      : existing.body;
    const newOutfit = updates.outfit !== undefined
      ? updates.outfit
      : existing.outfit;

    const stmt = db.prepare(`
      UPDATE character_state
      SET attributes = ?, body = ?, outfit = ?, updated_at = unixepoch()
      WHERE id = ?
      RETURNING id, character_id, scene_id, attributes, body, outfit, updated_at
    `);

    const row = stmt.get(
      JSON.stringify(newAttributes),
      JSON.stringify(newBody),
      newOutfit ? JSON.stringify(newOutfit) : null,
      existing.id
    ) as {
      id: number;
      character_id: number;
      scene_id: number | null;
      attributes: string;
      body: string;
      outfit: string | null;
      updated_at: number;
    };

    return {
      id: row.id,
      characterId: row.character_id,
      sceneId: row.scene_id,
      attributes: JSON.parse(row.attributes),
      body: JSON.parse(row.body),
      outfit: row.outfit ? JSON.parse(row.outfit) : null,
      updatedAt: row.updated_at,
    };
  } else {
    // Create
    const stmt = db.prepare(`
      INSERT INTO character_state (character_id, scene_id, attributes, body, outfit)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id, character_id, scene_id, attributes, body, outfit, updated_at
    `);

    const row = stmt.get(
      characterId,
      sceneId,
      JSON.stringify(updates.attributes ?? {}),
      JSON.stringify(updates.body ?? {}),
      updates.outfit ? JSON.stringify(updates.outfit) : null
    ) as {
      id: number;
      character_id: number;
      scene_id: number | null;
      attributes: string;
      body: string;
      outfit: string | null;
      updated_at: number;
    };

    return {
      id: row.id,
      characterId: row.character_id,
      sceneId: row.scene_id,
      attributes: JSON.parse(row.attributes),
      body: JSON.parse(row.body),
      outfit: row.outfit ? JSON.parse(row.outfit) : null,
      updatedAt: row.updated_at,
    };
  }
}

/** Update a single attribute */
export function setAttribute(
  characterId: number,
  sceneId: number | null,
  name: string,
  value: number
): CharacterState {
  return setCharacterState(characterId, sceneId, {
    attributes: { [name]: value },
  });
}

/** Modify an attribute by delta */
export function modifyAttribute(
  characterId: number,
  sceneId: number | null,
  name: string,
  delta: number
): CharacterState {
  const state = getCharacterState(characterId, sceneId);
  const currentValue = state?.attributes[name] ?? 0;
  return setAttribute(characterId, sceneId, name, currentValue + delta);
}

/** Update body traits */
export function setBodyTrait(
  characterId: number,
  sceneId: number | null,
  trait: string,
  value: unknown
): CharacterState {
  return setCharacterState(characterId, sceneId, {
    body: { [trait]: value },
  });
}

// Outfit management

/** Set outfit (freeform description and/or structured items) */
export function setOutfit(
  characterId: number,
  sceneId: number | null,
  outfit: OutfitData | null
): CharacterState {
  return setCharacterState(characterId, sceneId, { outfit });
}

/** Set outfit from a plain text description */
export function setOutfitDescription(
  characterId: number,
  sceneId: number | null,
  description: string
): CharacterState {
  const existing = getCharacterState(characterId, sceneId);
  const outfit: OutfitData = { ...existing?.outfit, description };
  return setCharacterState(characterId, sceneId, { outfit });
}

/**
 * Resolve the character's current outfit.
 * If equipped items are provided (from inventory/equipment system), those
 * take precedence for structured items. The freeform description is always
 * preserved as a fallback/supplement.
 */
export function getResolvedOutfit(
  characterId: number,
  sceneId: number | null,
  equippedClothing?: Array<{ slot: string; name: string; description?: string }>
): OutfitData | null {
  const state = getCharacterState(characterId, sceneId);
  const freeform = state?.outfit;

  // If we have equipped clothing items, build outfit from those
  if (equippedClothing && equippedClothing.length > 0) {
    return {
      // Equipment-derived items take precedence
      items: equippedClothing.map((e) => ({
        name: e.name,
        slot: e.slot,
        description: e.description,
      })),
      // Preserve freeform description as supplement
      description: freeform?.description,
    };
  }

  // Fall back to freeform outfit
  return freeform ?? null;
}

/** Format outfit for LLM context */
export function formatOutfitForContext(outfit: OutfitData | null): string {
  if (!outfit) return "";

  const lines: string[] = [];

  if (outfit.items && outfit.items.length > 0) {
    const itemList = outfit.items
      .map((i) => i.slot ? `${i.name} (${i.slot})` : i.name)
      .join(", ");
    lines.push(`Wearing: ${itemList}`);
  }

  if (outfit.description) {
    lines.push(`Outfit: ${outfit.description}`);
  }

  return lines.join("\n");
}

// Effect management

/** Add an effect to a character */
export function addEffect(
  characterId: number,
  sceneId: number | null,
  effect: {
    name: string;
    type: EffectType;
    description?: string;
    duration?: EffectDuration;
    expiresAt?: number;
    turnsRemaining?: number;
    modifiers?: Record<string, number>;
    bodyChanges?: Record<string, unknown>;
    flags?: string[];
    stacks?: number;
    maxStacks?: number;
    sourceType?: string;
    sourceId?: number;
    visibility?: EffectVisibility;
    visibleDescription?: string;
  }
): Effect {
  const db = getDb();

  // Check for existing stackable effect
  if (effect.stacks !== undefined || effect.maxStacks !== undefined) {
    const existing = getEffectByName(characterId, sceneId, effect.name);
    if (existing && existing.maxStacks !== null) {
      const newStacks = Math.min(existing.stacks + (effect.stacks ?? 1), existing.maxStacks);
      return updateEffectStacks(existing.id, newStacks);
    }
  }

  const stmt = db.prepare(`
    INSERT INTO character_effects (
      character_id, scene_id, name, type, description, duration,
      expires_at, turns_remaining, modifiers, body_changes, flags,
      stacks, max_stacks, source_type, source_id, visibility, visible_description
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);

  const row = stmt.get(
    characterId,
    sceneId,
    effect.name,
    effect.type,
    effect.description ?? null,
    effect.duration ?? "permanent",
    effect.expiresAt ?? null,
    effect.turnsRemaining ?? null,
    effect.modifiers ? JSON.stringify(effect.modifiers) : null,
    effect.bodyChanges ? JSON.stringify(effect.bodyChanges) : null,
    effect.flags ? JSON.stringify(effect.flags) : null,
    effect.stacks ?? 1,
    effect.maxStacks ?? null,
    effect.sourceType ?? null,
    effect.sourceId ?? null,
    effect.visibility ?? "visible",
    effect.visibleDescription ?? null
  ) as RawEffect;

  return parseEffect(row);
}

interface RawEffect {
  id: number;
  character_id: number;
  scene_id: number | null;
  name: string;
  type: string;
  description: string | null;
  duration: string;
  expires_at: number | null;
  turns_remaining: number | null;
  modifiers: string | null;
  body_changes: string | null;
  flags: string | null;
  stacks: number;
  max_stacks: number | null;
  source_type: string | null;
  source_id: number | null;
  visibility: string;
  visible_description: string | null;
  created_at: number;
}

function parseEffect(row: RawEffect): Effect {
  return {
    id: row.id,
    characterId: row.character_id,
    sceneId: row.scene_id,
    name: row.name,
    type: row.type as EffectType,
    description: row.description,
    duration: row.duration as EffectDuration,
    expiresAt: row.expires_at,
    turnsRemaining: row.turns_remaining,
    modifiers: row.modifiers ? JSON.parse(row.modifiers) : null,
    bodyChanges: row.body_changes ? JSON.parse(row.body_changes) : null,
    flags: row.flags ? JSON.parse(row.flags) : null,
    stacks: row.stacks,
    maxStacks: row.max_stacks,
    sourceType: row.source_type,
    sourceId: row.source_id,
    visibility: row.visibility as EffectVisibility,
    visibleDescription: row.visible_description,
    createdAt: row.created_at,
  };
}

/** Get an effect by name */
export function getEffectByName(
  characterId: number,
  sceneId: number | null,
  name: string
): Effect | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM character_effects
    WHERE character_id = ? AND (scene_id = ? OR (scene_id IS NULL AND ? IS NULL)) AND name = ?
  `);

  const row = stmt.get(characterId, sceneId, sceneId, name) as RawEffect | null;
  if (!row) return null;
  return parseEffect(row);
}

/** Update effect stacks */
export function updateEffectStacks(effectId: number, stacks: number): Effect {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE character_effects SET stacks = ? WHERE id = ?
    RETURNING *
  `);
  const row = stmt.get(stacks, effectId) as RawEffect;
  return parseEffect(row);
}

/** Get all effects for a character */
export function getCharacterEffects(
  characterId: number,
  sceneId: number | null
): Effect[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM character_effects
    WHERE character_id = ? AND (scene_id = ? OR scene_id IS NULL)
    ORDER BY created_at DESC
  `);

  const rows = stmt.all(characterId, sceneId) as RawEffect[];
  return rows.map(parseEffect);
}

/** Remove an effect */
export function removeEffect(effectId: number): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM character_effects WHERE id = ?");
  const result = stmt.run(effectId);
  return result.changes > 0;
}

/** Remove effect by name */
export function removeEffectByName(
  characterId: number,
  sceneId: number | null,
  name: string
): boolean {
  const db = getDb();
  const stmt = db.prepare(`
    DELETE FROM character_effects
    WHERE character_id = ? AND (scene_id = ? OR (scene_id IS NULL AND ? IS NULL)) AND name = ?
  `);
  const result = stmt.run(characterId, sceneId, sceneId, name);
  return result.changes > 0;
}

/** Get computed attributes (base + modifiers from effects) */
export function getComputedAttributes(
  characterId: number,
  sceneId: number | null
): Record<string, number> {
  const state = getCharacterState(characterId, sceneId);
  const effects = getCharacterEffects(characterId, sceneId);

  const computed = { ...state?.attributes };

  for (const effect of effects) {
    if (effect.modifiers) {
      for (const [attr, mod] of Object.entries(effect.modifiers)) {
        computed[attr] = (computed[attr] ?? 0) + mod * effect.stacks;
      }
    }
  }

  return computed;
}

/** Get computed body (base + changes from effects) */
export function getComputedBody(
  characterId: number,
  sceneId: number | null
): Record<string, unknown> {
  const state = getCharacterState(characterId, sceneId);
  const effects = getCharacterEffects(characterId, sceneId);

  const computed = { ...state?.body };

  for (const effect of effects) {
    if (effect.bodyChanges) {
      Object.assign(computed, effect.bodyChanges);
    }
  }

  return computed;
}

/** Get all flags from effects */
export function getActiveFlags(
  characterId: number,
  sceneId: number | null
): string[] {
  const effects = getCharacterEffects(characterId, sceneId);
  const flags = new Set<string>();

  for (const effect of effects) {
    if (effect.flags) {
      for (const flag of effect.flags) {
        flags.add(flag);
      }
    }
  }

  return Array.from(flags);
}

/** Check if character has a specific flag */
export function hasFlag(
  characterId: number,
  sceneId: number | null,
  flag: string
): boolean {
  return getActiveFlags(characterId, sceneId).includes(flag);
}

// Formatting for display/context

/** Format character state for display */
export function formatStateForDisplay(
  characterId: number,
  sceneId: number | null,
  options?: { showHidden?: boolean; outfit?: OutfitData | null }
): string {
  const lines: string[] = [];

  // Attributes
  const attrs = getComputedAttributes(characterId, sceneId);
  if (Object.keys(attrs).length > 0) {
    lines.push("**Attributes:**");
    for (const [name, value] of Object.entries(attrs)) {
      lines.push(`  ${name}: ${value}`);
    }
  }

  // Body
  const body = getComputedBody(characterId, sceneId);
  if (Object.keys(body).length > 0) {
    lines.push("\n**Form:**");
    for (const [trait, value] of Object.entries(body)) {
      lines.push(`  ${trait}: ${value}`);
    }
  }

  // Outfit
  const outfit = options?.outfit ?? getCharacterState(characterId, sceneId)?.outfit;
  if (outfit) {
    lines.push("\n**Outfit:**");
    if (outfit.description) {
      lines.push(`  ${outfit.description}`);
    }
    if (outfit.items && outfit.items.length > 0) {
      for (const item of outfit.items) {
        const slot = item.slot ? ` [${item.slot}]` : "";
        lines.push(`  ${item.name}${slot}`);
      }
    }
  }

  // Effects
  const effects = getCharacterEffects(characterId, sceneId);
  const visibleEffects = options?.showHidden
    ? effects
    : effects.filter((e) => e.visibility !== "hidden");

  if (visibleEffects.length > 0) {
    lines.push("\n**Active Effects:**");
    for (const effect of visibleEffects) {
      const stackText = effect.stacks > 1 ? ` (x${effect.stacks})` : "";
      const desc = effect.visibility === "partial" && effect.visibleDescription
        ? effect.visibleDescription
        : effect.description ?? "";
      lines.push(`  ${effect.name}${stackText}: ${desc}`);
    }
  }

  // Flags
  const flags = getActiveFlags(characterId, sceneId);
  if (flags.length > 0) {
    lines.push(`\n**Status:** ${flags.join(", ")}`);
  }

  return lines.join("\n") || "No state data.";
}

/**
 * Format state for context assembly.
 * Optionally accepts a resolved outfit to avoid re-querying state.
 */
export function formatStateForContext(
  characterId: number,
  sceneId: number | null,
  resolvedOutfit?: OutfitData | null
): string {
  const lines: string[] = [];

  const state = getCharacterState(characterId, sceneId);

  const attrs = getComputedAttributes(characterId, sceneId);
  if (Object.keys(attrs).length > 0) {
    const attrList = Object.entries(attrs)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push(`Status: ${attrList}`);
  }

  const body = getComputedBody(characterId, sceneId);
  if (Object.keys(body).length > 0) {
    const bodyList = Object.entries(body)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push(`Form: ${bodyList}`);
  }

  // Outfit (from resolved or from state)
  const outfit = resolvedOutfit !== undefined ? resolvedOutfit : state?.outfit;
  const outfitText = formatOutfitForContext(outfit ?? null);
  if (outfitText) {
    lines.push(outfitText);
  }

  const effects = getCharacterEffects(characterId, sceneId);
  const visibleEffects = effects.filter((e) => e.visibility !== "hidden");
  if (visibleEffects.length > 0) {
    const effectList = visibleEffects
      .map((e) => e.name + (e.stacks > 1 ? ` x${e.stacks}` : ""))
      .join(", ");
    lines.push(`Effects: ${effectList}`);
  }

  return lines.join("\n");
}

/** Type labels */
export const effectTypeLabels: Record<EffectType, string> = {
  buff: "Buff",
  debuff: "Debuff",
  curse: "Curse",
  blessing: "Blessing",
  transformation: "Transformation",
  custom: "Effect",
};
