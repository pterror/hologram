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
import { getMessages, getWebhookMessageEntity, parseMessageData, normalizeStickers } from "../db/discord";
import { evalMacroValue, formatDuration, rollDice, type ExprContext } from "../logic/expr";
import { DEFAULT_MODEL } from "./models";
import { renderEntityTemplate, renderStructuredTemplate } from "./template";
import {
  applyStripPatterns,
  type StructuredMessage,
} from "./context";

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
        if (exprContext) return exprContext.messages(1, "%a: %m", "$user");
        return match;
      }

      if (lower === "lastcharmessage") {
        if (exprContext) return exprContext.messages(1, "%a: %m", "$char");
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
  entityMemories?: Map<number, Array<{ content: string }>>,
  template?: string | null,
  channelId?: string,
): string {
  // Use custom template if provided
  if (template) {
    return renderWithTemplate(template, respondingEntities, otherEntities, entityMemories, channelId);
  }

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

// =============================================================================
// Template Rendering
// =============================================================================

/** Number of messages to fetch from DB for template context */
const MESSAGE_FETCH_LIMIT = 100;

/**
 * Render a system prompt using a custom Nunjucks template.
 * The template context includes the first entity's exprContext variables
 * plus template-specific variables (entities, others, memories, messages, etc.).
 */
function renderWithTemplate(
  templateSource: string,
  respondingEntities: EvaluatedEntity[],
  otherEntities: EntityWithFacts[],
  entityMemories?: Map<number, Array<{ content: string }>>,
  channelId?: string,
): string {
  const firstEntity = respondingEntities[0];
  const baseCtx = firstEntity?.exprContext;

  // Build template context — flat Record for Nunjucks (no prototype chain)
  const templateCtx: Record<string, unknown> = {};

  // Copy base expr context properties (if available)
  if (baseCtx) {
    for (const key of Object.keys(baseCtx)) {
      templateCtx[key] = baseCtx[key];
    }
    // Also copy prototype-chain properties from Object.create(null) objects
    // ExprContext uses index signature, so own properties cover everything
  }

  templateCtx.entities = respondingEntities.map(e => ({
    id: e.id,
    name: e.name,
    facts: e.facts,
  }));

  templateCtx.others = otherEntities.map(e => ({
    id: e.id,
    name: e.name,
    facts: e.facts.map(f => f.content),
  }));

  // Build memories map: entity id -> array of content strings
  const memoriesObj: Record<number, string[]> = Object.create(null);
  if (entityMemories) {
    for (const [entityId, mems] of entityMemories) {
      memoriesObj[entityId] = mems.map(m => m.content);
    }
  }
  templateCtx.memories = memoriesObj;

  templateCtx.entity_names = respondingEntities.map(e => e.name).join(", ");
  templateCtx.freeform = respondingEntities.some(e => e.isFreeform);

  // Structured messages for template use (enriched with message data)
  if (channelId) {
    const history = getMessages(channelId, MESSAGE_FETCH_LIMIT);
    templateCtx.history = history.reverse().map(m => {
      const data = parseMessageData(m.data);
      const isEntity = !!m.discord_message_id && !!getWebhookMessageEntity(m.discord_message_id);
      return {
        author: m.author_name,
        content: m.content,
        author_id: m.author_id,
        created_at: m.created_at,
        is_bot: data?.is_bot ?? false,
        role: isEntity ? "assistant" as const : "user" as const,
        embeds: data?.embeds ?? [],
        stickers: normalizeStickers(data?.stickers ?? []),
        attachments: data?.attachments ?? [],
      };
    });
  } else {
    templateCtx.history = [];
  }

  return renderEntityTemplate(templateSource, templateCtx);
}

// =============================================================================
// Default Template (Nunjucks)
// =============================================================================

/**
 * Default template that replicates buildSystemPrompt() + buildStructuredMessages()
 * output using the structured _msg() protocol.
 *
 * System prompt section: entity defs, memories, multi-entity guidance
 * Message section: _msg() markers with role-based history
 */
export const DEFAULT_TEMPLATE = `\
{%- if entities | length == 0 and others | length == 0 -%}
You are a helpful assistant. Respond naturally to the user.
{%- else -%}
{%- for entity in entities -%}
{%- if not loop.first %}


{% endif -%}
<defs for="{{ entity.name }}" id="{{ entity.id }}">
{{ entity.facts | join("\\n") }}
</defs>
{%- if memories[entity.id] and memories[entity.id] | length > 0 %}


<memories for="{{ entity.name }}" id="{{ entity.id }}">
{{ memories[entity.id] | join("\\n") }}
</memories>
{%- endif -%}
{%- endfor -%}
{%- for entity in others -%}
{%- if entities | length > 0 or not loop.first %}


{% endif -%}
<defs for="{{ entity.name }}" id="{{ entity.id }}">
{{ entity.facts | join("\\n") }}
</defs>
{%- endfor -%}
{%- if entities | length > 1 -%}
{%- if freeform %}


You are writing as: {{ entity_names }}. They may interact naturally in your response. Not everyone needs to respond to every message - only include those who would naturally engage. If none would respond, reply with only: none
{%- else %}


You are: {{ entity_names }}. Format your response with XML tags:
<{{ entities[0].name }}>*waves* Hello there!</{{ entities[0].name }}>
<{{ entities[1].name }}>Nice to meet you.</{{ entities[1].name }}>

Wrap everyone's dialogue in their name tag. They may interact naturally.

Not everyone needs to respond to every message. Only respond as those who would naturally engage with what was said. If none would respond, reply with only <none/>.
{%- endif -%}
{%- endif -%}
{%- endif -%}
{%- for msg in history -%}
{{ _msg(msg.role, {author: msg.author, author_id: msg.author_id}) }}
{%- if msg.role == "assistant" and _single_entity -%}
{{ msg.content }}
{%- else -%}
{{ msg.author }}: {{ msg.content }}
{%- endif -%}
{%- endfor -%}`;

// =============================================================================
// Unified Prompt + Messages Builder
// =============================================================================

/**
 * Build system prompt and structured messages from entities and history.
 * Uses renderStructuredTemplate() with either a custom template or DEFAULT_TEMPLATE.
 * Replaces the separate buildSystemPrompt() + buildStructuredMessages() calls.
 *
 * @param respondingEntities - Evaluated entities that will respond
 * @param otherEntities - Other entities in context (referenced, user persona, etc.)
 * @param entityMemories - Retrieved memories per entity
 * @param template - Custom template source (null = use DEFAULT_TEMPLATE)
 * @param channelId - Channel to fetch history from
 * @param contextLimit - Maximum characters of history to include
 * @param stripPatterns - Patterns to strip from message content
 */
export function buildPromptAndMessages(
  respondingEntities: EvaluatedEntity[],
  otherEntities: EntityWithFacts[],
  entityMemories: Map<number, Array<{ content: string }>> | undefined,
  template: string | null,
  channelId: string,
  contextLimit: number,
  stripPatterns: string[],
): { systemPrompt: string; messages: StructuredMessage[] } {
  // Fetch history from DB (DESC order, newest first)
  const rawHistory = getMessages(channelId, MESSAGE_FETCH_LIMIT);

  const isSingleEntity = respondingEntities.length <= 1;

  // Build history objects trimmed to char limit (process newest-first)
  interface HistoryEntry {
    author: string;
    content: string;
    author_id: string;
    created_at: string;
    is_bot: boolean;
    role: "user" | "assistant";
    embeds: Array<{ title?: string; description?: string; fields?: Array<{ name: string; value: string }> }>;
    stickers: Array<{ id: string; name: string; format_type: number }>;
    attachments: Array<{ filename: string; url: string; content_type?: string }>;
  }
  const history: HistoryEntry[] = [];
  let totalChars = 0;

  for (const m of rawHistory) {
    const data = parseMessageData(m.data);
    const isEntity = !!m.discord_message_id && !!getWebhookMessageEntity(m.discord_message_id);
    const role = isEntity ? "assistant" as const : "user" as const;

    // Calculate char length using same logic as buildStructuredMessages
    const formattedContent = (isEntity && isSingleEntity) ? m.content : `${m.author_name}: ${m.content}`;
    const len = formattedContent.length + 1; // +1 for newline
    if (totalChars + len > contextLimit && history.length > 0) break;

    // Apply strip patterns to raw content
    let content = m.content;
    if (stripPatterns.length > 0) {
      content = applyStripPatterns(content, stripPatterns);
    }

    history.push({
      author: m.author_name,
      content,
      author_id: m.author_id,
      created_at: m.created_at,
      is_bot: data?.is_bot ?? false,
      role,
      embeds: data?.embeds ?? [],
      stickers: normalizeStickers(data?.stickers ?? []),
      attachments: data?.attachments ?? [],
    });
    totalChars += len;
  }

  // Reverse to chronological order
  history.reverse();

  // Build template context
  const firstEntity = respondingEntities[0];
  const baseCtx = firstEntity?.exprContext;
  const templateCtx: Record<string, unknown> = {};

  if (baseCtx) {
    for (const key of Object.keys(baseCtx)) {
      templateCtx[key] = baseCtx[key];
    }
  }

  templateCtx.entities = respondingEntities.map(e => ({
    id: e.id,
    name: e.name,
    facts: e.facts,
  }));

  templateCtx.others = otherEntities.map(e => ({
    id: e.id,
    name: e.name,
    facts: e.facts.map(f => f.content),
  }));

  const memoriesObj: Record<number, string[]> = Object.create(null);
  if (entityMemories) {
    for (const [entityId, mems] of entityMemories) {
      memoriesObj[entityId] = mems.map(m => m.content);
    }
  }
  templateCtx.memories = memoriesObj;
  templateCtx.entity_names = respondingEntities.map(e => e.name).join(", ");
  templateCtx.freeform = respondingEntities.some(e => e.isFreeform);
  templateCtx.history = history;
  templateCtx._single_entity = isSingleEntity;

  // Render with structured template
  const templateSource = template ?? DEFAULT_TEMPLATE;
  const output = renderStructuredTemplate(templateSource, templateCtx);

  // Convert to StructuredMessage[]
  let messages: StructuredMessage[];
  if (output.messages.length > 0) {
    // Template used _msg() → use structured messages
    // Fold system-role messages into the system prompt
    const systemParts = output.systemPrompt ? [output.systemPrompt] : [];
    messages = [];
    for (const m of output.messages) {
      if (m.role === "system") {
        systemParts.push(m.content);
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }
    const systemPrompt = systemParts.join("\n\n");

    // AI SDK requires first message to be user role
    if (messages.length > 0 && messages[0].role === "assistant") {
      messages.unshift({ role: "user", content: "(continued)" });
    }

    return { systemPrompt, messages };
  }

  // Template didn't use _msg() → legacy behavior: latest message as user content
  const latest = rawHistory[0];
  let latestContent = latest ? `${latest.author_name}: ${latest.content}` : "";
  if (stripPatterns.length > 0) {
    latestContent = applyStripPatterns(latestContent, stripPatterns);
  }
  messages = [{ role: "user", content: latestContent }];

  return { systemPrompt: output.systemPrompt, messages };
}
