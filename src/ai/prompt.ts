import {
  getEntityWithFacts,
  type EntityWithFacts,
} from "../db/entities";
import {
  formatEntityDisplay,
  formatEvaluatedEntity,
  formatRawEntity,
  type EvaluatedEntity,
} from "./context";
import { evalMacroValue, type ExprContext } from "../logic/expr";

// =============================================================================
// Entity Reference Expansion
// =============================================================================

/** Unified macro pattern: matches {{...}} */
const MACRO_PATTERN = /\{\{(.+?)\}\}/g;

/**
 * Expand all macros in an entity's facts:
 * - {{entity:ID}} -> entity name with ID
 * - {{char}} -> current entity's name
 * - {{user}} -> literal "user"
 * - {{expr}} -> evaluated expression (e.g. {{channel.name}}, {{self.health}})
 *
 * @param entity - The entity whose facts to process (mutates facts in place)
 * @param seenIds - Set of entity IDs already in context (modified in place)
 * @param exprContext - Optional expression context for evaluating arbitrary macros
 * @returns Array of newly referenced entities to add to context
 */
export function expandEntityRefs(
  entity: { name: string; facts: string[] },
  seenIds: Set<number>,
  exprContext?: ExprContext
): EntityWithFacts[] {
  const referencedEntities: EntityWithFacts[] = [];

  for (let i = 0; i < entity.facts.length; i++) {
    entity.facts[i] = entity.facts[i].replace(MACRO_PATTERN, (match, inner: string) => {
      const trimmed = inner.trim();

      // {{entity:ID}} -> entity name with ID
      const entityMatch = trimmed.match(/^entity:(\d+)$/);
      if (entityMatch) {
        const refId = parseInt(entityMatch[1]);
        const refEntity = getEntityWithFacts(refId);
        if (refEntity) {
          if (!seenIds.has(refId)) {
            referencedEntities.push(refEntity);
            seenIds.add(refId);
          }
          return formatEntityDisplay(refEntity.name, refId);
        }
        return match;
      }

      // {{char}} -> entity name
      if (trimmed.toLowerCase() === "char") {
        return entity.name;
      }

      // {{user}} -> literal "user"
      if (trimmed.toLowerCase() === "user") {
        return "user";
      }

      // Otherwise: evaluate as expression
      if (exprContext) {
        try {
          return evalMacroValue(trimmed, exprContext);
        } catch {
          // On error, keep original {{...}} text
          return match;
        }
      }

      return match;
    });
  }

  return referencedEntities;
}

// =============================================================================
// System Prompt Building
// =============================================================================

export function buildSystemPrompt(
  respondingEntities: EvaluatedEntity[],
  otherEntities: EntityWithFacts[],
  entityMemories?: Map<number, Array<{ content: string }>>
): string {
  if (respondingEntities.length === 0 && otherEntities.length === 0) {
    return "You are a helpful assistant. Respond naturally to the user.";
  }

  const contextParts: string[] = [];
  for (const e of respondingEntities) {
    contextParts.push(formatEvaluatedEntity(e));
    // Add memories if present
    const memories = entityMemories?.get(e.id);
    if (memories && memories.length > 0) {
      const memoryLines = memories.map(m => m.content).join("\n");
      contextParts.push(`<memories for="${e.name}" id="${e.id}">\n${memoryLines}\n</memories>`);
    }
  }
  for (const e of otherEntities) {
    contextParts.push(formatRawEntity(e));
  }
  const context = contextParts.join("\n\n");

  let multiEntityGuidance = "";
  if (respondingEntities.length > 1) {
    const names = respondingEntities.map(c => c.name).join(", ");
    const isFreeform = respondingEntities.some(e => e.isFreeform);

    if (isFreeform) {
      // Freeform mode: no structured format required
      multiEntityGuidance = `\n\nYou are writing as: ${names}. They may interact naturally in your response. Not everyone needs to respond to every message - only include those who would naturally engage. If none would respond, reply with only: none`;
    } else {
      // Structured mode: use XML tags
      multiEntityGuidance = `\n\nYou are: ${names}. Format your response with XML tags:
<${respondingEntities[0]?.name ?? "Name"}>*waves* Hello there!</${respondingEntities[0]?.name ?? "Name"}>
<${respondingEntities[1]?.name ?? "Other"}>Nice to meet you.</${respondingEntities[1]?.name ?? "Other"}>

Wrap everyone's dialogue in their name tag. They may interact naturally.

Not everyone needs to respond to every message. Only respond as those who would naturally engage with what was said. If none would respond, reply with only <none/>.`;
    }
  }

  return `${context}${multiEntityGuidance}`;
}
