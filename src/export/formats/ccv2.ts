/**
 * CCv2 Character Card Export
 *
 * Converts Hologram characters to the Character Card V2 specification
 * for compatibility with SillyTavern and other tools.
 *
 * @see https://github.com/malfoyslastname/character-card-spec-v2
 */

import type { Entity, CharacterData } from "../../db/entities";
import type {
  TavernCardV2,
  CCv2ComplianceLevel,
  HologramCharacterExport,
} from "../types";

/**
 * Convert a Hologram character to CCv2 format.
 */
export function toTavernCardV2(
  character: Entity<CharacterData>,
  compliance: CCv2ComplianceLevel = "lenient",
  extendedData?: Partial<HologramCharacterExport>
): TavernCardV2 {
  const data = character.data;

  // Build the CCv2 card
  const card: TavernCardV2 = {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      // Required V1 fields
      name: character.name,
      description: data.persona || "",
      personality: extractPersonality(data.persona),
      scenario: data.scenario || "",
      first_mes: (data.firstMessage as string) || "",
      mes_example: data.exampleDialogue || "",

      // V2 fields
      creator_notes: "",
      system_prompt: data.systemPrompt || "",
      post_history_instructions: (data.ujb as string) || (data.postHistoryInstructions as string) || "",
      alternate_greetings: (data.greetings as string[]) || [],
      tags: (data.tags as string[]) || [],
      creator: "",
      character_version: "1.0",
      extensions: {} as Record<string, unknown>,
    },
  };

  // Add extensions based on compliance level
  if (compliance !== "strict") {
    // Common extensions
    if (data.avatar) {
      card.data.extensions["avatar_uri"] = data.avatar;
    }
  }

  if (compliance === "extended" && extendedData) {
    // Full Hologram data in namespaced extensions
    card.data.extensions["hologram/character"] = {
      id: character.id,
      creatorId: character.creatorId,
      createdAt: character.createdAt,
      originalData: data,
    };

    if (extendedData.worlds) {
      card.data.extensions["hologram/worlds"] = extendedData.worlds;
    }

    if (extendedData.state) {
      card.data.extensions["hologram/state"] = extendedData.state;
    }

    if (extendedData.effects && extendedData.effects.length > 0) {
      card.data.extensions["hologram/effects"] = extendedData.effects;
    }

    if (extendedData.relationships && extendedData.relationships.length > 0) {
      card.data.extensions["hologram/relationships"] = extendedData.relationships;
    }

    if (extendedData.factions && extendedData.factions.length > 0) {
      card.data.extensions["hologram/factions"] = extendedData.factions;
    }

    if (extendedData.generatedImages && extendedData.generatedImages.length > 0) {
      card.data.extensions["hologram/images"] = extendedData.generatedImages;
    }
  }

  return card;
}

/**
 * Extract personality traits from persona text.
 * CCv2 expects a separate personality field, but Hologram combines them.
 */
function extractPersonality(persona: string | undefined): string {
  if (!persona) return "";

  // Try to find personality section in common formats
  const patterns = [
    /personality:\s*(.+?)(?=\n\n|\n[A-Z]|$)/is,
    /traits:\s*(.+?)(?=\n\n|\n[A-Z]|$)/is,
    /character(?:istics)?:\s*(.+?)(?=\n\n|\n[A-Z]|$)/is,
  ];

  for (const pattern of patterns) {
    const match = persona.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  // If no explicit section, return first paragraph as personality
  const firstParagraph = persona.split(/\n\n/)[0];
  return firstParagraph.length < 500 ? firstParagraph : "";
}

/**
 * Parse a CCv2 card back to Hologram CharacterData.
 */
export function fromTavernCardV2(card: TavernCardV2): CharacterData {
  const ccData = card.data;

  // Combine description and personality for persona
  let persona = ccData.description;
  if (ccData.personality && !ccData.description.includes(ccData.personality)) {
    persona += `\n\nPersonality: ${ccData.personality}`;
  }

  const data: CharacterData = {
    persona,
    scenario: ccData.scenario || undefined,
    exampleDialogue: ccData.mes_example || undefined,
    systemPrompt: ccData.system_prompt || undefined,
  };

  // Optional fields
  if (ccData.first_mes) {
    data.firstMessage = ccData.first_mes;
  }
  if (ccData.alternate_greetings.length > 0) {
    data.greetings = ccData.alternate_greetings;
  }
  if (ccData.tags.length > 0) {
    data.tags = ccData.tags;
  }
  if (ccData.post_history_instructions) {
    data.ujb = ccData.post_history_instructions;
  }

  // Restore Hologram-specific data from extensions
  const hologramChar = ccData.extensions["hologram/character"] as
    | { originalData?: CharacterData }
    | undefined;
  if (hologramChar?.originalData) {
    // Merge original data, preferring CCv2 fields for standard stuff
    return {
      ...hologramChar.originalData,
      ...data,
    };
  }

  return data;
}

/**
 * Validate that a card conforms to CCv2 spec.
 */
export function validateTavernCardV2(card: unknown): card is TavernCardV2 {
  if (!card || typeof card !== "object") return false;

  const c = card as Record<string, unknown>;
  if (c.spec !== "chara_card_v2") return false;
  if (c.spec_version !== "2.0") return false;

  const data = c.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return false;

  // Required fields
  const required = ["name", "description", "personality", "scenario", "first_mes", "mes_example"];
  for (const field of required) {
    if (typeof data[field] !== "string") return false;
  }

  return true;
}
