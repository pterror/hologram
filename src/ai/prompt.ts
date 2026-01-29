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

// =============================================================================
// Entity Reference Expansion
// =============================================================================

/** Pattern for entity references: {{entity:ID}} */
const ENTITY_REF_PATTERN = /\{\{entity:(\d+)\}\}/g;
/** Pattern for {{char}} macro (current entity name) */
const CHAR_PATTERN = /\{\{char\}\}/gi;
/** Pattern for {{user}} macro (literal "user") */
const USER_PATTERN = /\{\{user\}\}/gi;

/**
 * Expand all macros in an entity's facts:
 * - {{entity:ID}} -> entity name with ID
 * - {{char}} -> current entity's name
 * - {{user}} -> literal "user"
 *
 * @param entity - The entity whose facts to process (mutates facts in place)
 * @param seenIds - Set of entity IDs already in context (modified in place)
 * @returns Array of newly referenced entities to add to context
 */
export function expandEntityRefs(
  entity: { name: string; facts: string[] },
  seenIds: Set<number>
): EntityWithFacts[] {
  const referencedEntities: EntityWithFacts[] = [];

  for (let i = 0; i < entity.facts.length; i++) {
    // Expand {{char}} -> entity name
    entity.facts[i] = entity.facts[i].replace(CHAR_PATTERN, entity.name);
    // Expand {{user}} -> literal "user"
    entity.facts[i] = entity.facts[i].replace(USER_PATTERN, "user");
    // Expand {{entity:ID}} -> entity name with ID
    entity.facts[i] = entity.facts[i].replace(ENTITY_REF_PATTERN, (match, idStr) => {
      const refId = parseInt(idStr);
      const refEntity = getEntityWithFacts(refId);
      if (refEntity) {
        // Add to context if not already seen
        if (!seenIds.has(refId)) {
          referencedEntities.push(refEntity);
          seenIds.add(refId);
        }
        // Keep ID so LLM can use it in tool calls (add_fact, update_fact, etc.)
        return formatEntityDisplay(refEntity.name, refId);
      }
      return match; // Keep original if entity not found
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
