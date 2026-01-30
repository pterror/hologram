import {
  getEntityWithFacts,
  type EntityWithFacts,
} from "../db/entities";
import {
  formatEntityDisplay,
  formatEvaluatedEntity,
  formatRawEntity,
  DEFAULT_CONTEXT_LIMIT,
  type EvaluatedEntity,
} from "./context";
import { evalMacroValue, formatDuration, rollDice, type ExprContext } from "../logic/expr";
import { DEFAULT_MODEL } from "./models";

// =============================================================================
// Entity Reference Expansion
// =============================================================================

/** Unified macro pattern: matches {{...}} */
const MACRO_PATTERN = /\{\{(.+?)\}\}/g;

/** Trim sentinel for {{trim}} macro */
const TRIM_SENTINEL = "\x00TRIM\x00";

/** Metadata for convenience macro expansion */
export interface MacroMeta {
  modelSpec: string | null;
  contextLimit: number | null;
  respondingNames: string[];
}

/**
 * Expand all macros in an entity's facts:
 * - {{entity:ID}} -> entity name with ID
 * - {{char}} -> current entity's name
 * - {{user}} -> literal "user"
 * - Convenience macros (date, time, random:, roll:, etc.)
 * - {{expr}} -> evaluated expression (e.g. {{channel.name}}, {{self.health}})
 *
 * @param entity - The entity whose facts to process (mutates facts in place)
 * @param seenIds - Set of entity IDs already in context (modified in place)
 * @param exprContext - Optional expression context for evaluating arbitrary macros
 * @param evalMeta - Optional metadata for convenience macros
 * @returns Array of newly referenced entities to add to context
 */
export function expandEntityRefs(
  entity: { name: string; facts: string[] },
  seenIds: Set<number>,
  exprContext?: ExprContext,
  evalMeta?: MacroMeta
): EntityWithFacts[] {
  const referencedEntities: EntityWithFacts[] = [];

  for (let i = 0; i < entity.facts.length; i++) {
    let hasTrim = false;

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

      // --- Parameterized macros ---

      // {{random: A,B,C}} -> random item from list
      if (trimmed.toLowerCase().startsWith("random:")) {
        const items = trimmed.slice(7).split(",").map(s => s.trim()).filter(Boolean);
        if (items.length > 0) {
          return items[Math.floor(Math.random() * items.length)];
        }
        return match;
      }

      // {{roll: 2d6+3}} -> dice roll
      if (trimmed.toLowerCase().startsWith("roll:")) {
        try {
          return String(rollDice(trimmed.slice(5).trim()));
        } catch {
          return match;
        }
      }

      // {{newline}} or {{newline::N}}
      if (trimmed.toLowerCase() === "newline") {
        return "\n";
      }
      if (trimmed.toLowerCase().startsWith("newline::")) {
        const n = parseInt(trimmed.slice(9));
        return isNaN(n) ? "\n" : "\n".repeat(n);
      }

      // {{space}} or {{space::N}}
      if (trimmed.toLowerCase() === "space") {
        return " ";
      }
      if (trimmed.toLowerCase().startsWith("space::")) {
        const n = parseInt(trimmed.slice(7));
        return isNaN(n) ? " " : " ".repeat(n);
      }

      // --- Simple text macros ---
      const lower = trimmed.toLowerCase();

      if (lower === "noop") return "";

      if (lower === "trim") {
        hasTrim = true;
        return TRIM_SENTINEL;
      }

      if (lower === "date") {
        const now = new Date();
        return now.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
      }

      if (lower === "time") {
        return new Date().toLocaleTimeString("en-US");
      }

      if (lower === "weekday") {
        return new Date().toLocaleDateString("en-US", { weekday: "long" });
      }

      if (lower === "isodate") {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      }

      if (lower === "isotime") {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      }

      if (lower === "idle_duration" || lower === "idleduration") {
        if (exprContext) return formatDuration(exprContext.idle_ms);
        return match;
      }

      if (lower === "group") {
        if (exprContext) return exprContext.group;
        return match;
      }

      if (lower === "lastmessage") {
        if (exprContext) return exprContext.messages(1);
        return match;
      }

      if (lower === "lastusermessage") {
        if (exprContext) return exprContext.messages(1, "%a: %m", "user");
        return match;
      }

      if (lower === "lastcharmessage") {
        if (exprContext) return exprContext.messages(1, "%a: %m", "char");
        return match;
      }

      if (lower === "model") {
        return evalMeta?.modelSpec ?? DEFAULT_MODEL;
      }

      if (lower === "maxprompt") {
        return String(evalMeta?.contextLimit ?? DEFAULT_CONTEXT_LIMIT);
      }

      if (lower === "charifnotgroup") {
        if (exprContext) return exprContext.chars.length <= 1 ? entity.name : "";
        return entity.name;
      }

      if (lower === "notchar") {
        if (exprContext) {
          return exprContext.chars
            .filter(c => c.toLowerCase() !== entity.name.toLowerCase())
            .join(", ");
        }
        return "";
      }

      if (lower === "groupnotmuted") {
        return evalMeta?.respondingNames.join(", ") ?? "";
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

    // Post-process: if trim sentinel was inserted, trim the fact and remove sentinels
    if (hasTrim) {
      entity.facts[i] = entity.facts[i].replaceAll(TRIM_SENTINEL, "").trim();
    }
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
