/**
 * Character Plugin
 *
 * Handles character persona formatting for context.
 * - Formats active character personas
 * - Includes character state (attributes, body, outfit)
 * - Includes relationships
 */

import type { Plugin, Formatter, ContextSection } from "../types";
import { ContextPriority } from "../types";
import { getEntity, type CharacterData } from "../../db/entities";
import { getRelationshipsFrom, getRelationshipsTo } from "../../db/relationships";
import { formatStateForContext, getResolvedOutfit } from "../../state";
import { getEquippedItems } from "../../world/inventory";

// =============================================================================
// Formatters
// =============================================================================

/** Format active character personas */
const characterPersonaFormatter: Formatter = {
  name: "character:persona",
  shouldRun: (ctx) => ctx.activeCharacterIds.length > 0,
  fn: (ctx) => {
    const sections: ContextSection[] = [];
    const worldConfig = ctx.config;

    for (const charId of ctx.activeCharacterIds) {
      const character = getEntity<CharacterData>(charId);
      if (!character) continue;

      const lines: string[] = [];
      lines.push(`# Character: ${character.name}`);
      lines.push("");
      lines.push("## Persona");
      lines.push(character.data.persona);

      if (character.data.scenario) {
        lines.push("");
        lines.push("## Current Scenario");
        lines.push(character.data.scenario);
      }

      // Character state (attributes, body, outfit, effects)
      if (ctx.scene) {
        // Resolve outfit: equipment-derived if available, else freeform
        let equippedClothing:
          | Array<{ slot: string; name: string; description?: string }>
          | undefined;

        if (
          worldConfig?.inventory.enabled &&
          worldConfig.inventory.useEquipment
        ) {
          const equipped = getEquippedItems(character.id, ctx.scene.id);
          if (equipped.length > 0) {
            equippedClothing = equipped.map((e) => ({
              slot: e.slot,
              name: e.item.name,
              description: e.item.description,
            }));
          }
        }

        const resolvedOutfit = getResolvedOutfit(
          character.id,
          ctx.scene.id,
          equippedClothing
        );
        const stateSection = formatStateForContext(
          character.id,
          ctx.scene.id,
          resolvedOutfit
        );

        if (stateSection) {
          lines.push("");
          lines.push("## Current State");
          lines.push(stateSection);
        }
      }

      // Example dialogue is now injected as actual messages, not in system prompt
      // See the core:llm middleware for example dialogue handling

      if (character.data.systemPrompt) {
        lines.push("");
        lines.push("## Instructions");
        lines.push(character.data.systemPrompt);
      }

      sections.push({
        name: `character:persona:${charId}`,
        content: lines.join("\n"),
        priority: ContextPriority.CHARACTER_PERSONA,
        canTruncate: true,
        minTokens: 200,
      });
    }

    return sections;
  },
};

/** Format relationships for active characters */
const relationshipsFormatter: Formatter = {
  name: "character:relationships",
  shouldRun: (ctx) =>
    ctx.activeCharacterIds.length > 0 &&
    (ctx.config?.relationships.enabled ?? true),
  fn: (ctx) => {
    const sections: ContextSection[] = [];

    for (const charId of ctx.activeCharacterIds) {
      const outgoing = getRelationshipsFrom(charId);
      const incoming = getRelationshipsTo(charId);

      if (outgoing.length === 0 && incoming.length === 0) continue;

      const lines: string[] = ["## Relationships"];

      for (const rel of outgoing) {
        const target = getEntity(rel.targetId);
        if (target) {
          lines.push(`- ${rel.type} → ${target.name}`);
        }
      }

      for (const rel of incoming) {
        const source = getEntity(rel.sourceId);
        if (source) {
          lines.push(`- ${source.name} → ${rel.type}`);
        }
      }

      sections.push({
        name: `character:relationships:${charId}`,
        content: lines.join("\n"),
        priority: ContextPriority.RELATIONSHIPS,
        canTruncate: true,
        minTokens: 30,
      });
    }

    return sections;
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const characterPlugin: Plugin = {
  id: "character",
  name: "Character",
  description: "Character personas, state, and relationships",
  dependencies: ["core"],

  formatters: [characterPersonaFormatter, relationshipsFormatter],
};

export default characterPlugin;
