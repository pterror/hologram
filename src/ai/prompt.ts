import {
  getEntityWithFacts,
  type EntityWithFacts,
} from "../db/entities";
import {
  formatEntityDisplay,
  DEFAULT_CONTEXT_EXPR,
  type EvaluatedEntity,
} from "./context";
import { getMessages, getWebhookMessageEntity, parseMessageData, normalizeStickers, resolveDiscordEntity } from "../db/discord";
import { evalMacroValue, formatDuration, rollDice, compileContextExpr, type ExprContext } from "../logic/expr";
import { DEFAULT_MODEL } from "./models";
import { DEFAULT_TEMPLATE, renderStructuredTemplate, renderSystemPrompt } from "./template";
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
  contextExpr: string | null;
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
        return evalMeta?.contextExpr ?? DEFAULT_CONTEXT_EXPR;
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

/** Number of messages to fetch from DB for template context */
const MESSAGE_FETCH_LIMIT = 100;

// =============================================================================
// Unified Prompt + Messages Builder
// =============================================================================

/**
 * Build system prompt and structured messages from entities and history.
 * Uses renderStructuredTemplate() with either a custom template or DEFAULT_TEMPLATE.
 *
 * @param respondingEntities - Evaluated entities that will respond
 * @param otherEntities - Other entities in context (referenced, user persona, etc.)
 * @param entityMemories - Retrieved memories per entity
 * @param template - Custom template source (null = use DEFAULT_TEMPLATE)
 * @param channelId - Channel to fetch history from
 * @param contextExpr - Context expression for message filtering (e.g. "chars < 16000")
 * @param stripPatterns - Patterns to strip from message content
 */
export function buildPromptAndMessages(
  respondingEntities: EvaluatedEntity[],
  otherEntities: EntityWithFacts[],
  entityMemories: Map<number, Array<{ content: string }>> | undefined,
  template: string | null,
  channelId: string,
  contextExpr: string,
  stripPatterns: string[],
): { systemPrompt: string; messages: StructuredMessage[] } {
  // Fetch history from DB (DESC order, newest first)
  const rawHistory = getMessages(channelId, MESSAGE_FETCH_LIMIT);

  const isSingleEntity = respondingEntities.length <= 1;

  // Compile context expression for per-message filtering
  const contextFilter = compileContextExpr(contextExpr);
  const now = Date.now();

  // Build history objects filtered by context expression (process newest-first)
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

    // Calculate char length for context expression
    const formattedContent = `${m.author_name}: ${m.content}`;
    const len = formattedContent.length + 1; // +1 for newline
    const msgAge = now - new Date(m.created_at).getTime();

    // Evaluate context expression — stop when it returns false (after at least one message)
    const shouldInclude = contextFilter({
      chars: totalChars + len,
      count: history.length,
      age: msgAge,
      age_h: msgAge / 3_600_000,
      age_m: msgAge / 60_000,
      age_s: msgAge / 1000,
    });
    if (!shouldInclude && history.length > 0) break;

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

  // Render dedicated system prompt (AI SDK `system` parameter)
  const systemPrompt = renderSystemPrompt(templateCtx);

  // Render structured messages template
  const templateSource = template ?? DEFAULT_TEMPLATE;
  const output = renderStructuredTemplate(templateSource, templateCtx);

  // Convert to StructuredMessage[]
  let messages: StructuredMessage[] = output.messages.map(m => ({ role: m.role, content: m.content }));

  if (messages.length === 0) {
    // Template didn't use role blocks → legacy behavior: latest message as user content
    // (parseStructuredOutput already wrapped the output as a system message)
    const latest = rawHistory[0];
    let latestContent = latest ? `${latest.author_name}: ${latest.content}` : "";
    if (stripPatterns.length > 0) {
      latestContent = applyStripPatterns(latestContent, stripPatterns);
    }
    messages.push({ role: "user", content: latestContent });
  }

  // AI SDK requires first non-system message to be user role
  const firstNonSystem = messages.findIndex(m => m.role !== "system");
  if (firstNonSystem >= 0 && messages[firstNonSystem].role === "assistant") {
    messages.splice(firstNonSystem, 0, { role: "user", content: "(continued)" });
  }

  return { systemPrompt, messages };
}

// =============================================================================
// Shared Prompt Preparation
// =============================================================================

export interface PreparedPromptContext {
  /** Dedicated system prompt for AI SDK `system` parameter */
  systemPrompt: string;
  messages: StructuredMessage[];
  other: EntityWithFacts[];
  contextExpr: string;
  effectiveStripPatterns: string[];
}

/**
 * Prepare the full prompt context from evaluated entities.
 * Extracts the shared logic between handleMessage and handleMessageStreaming:
 * - Expand entity refs and macros
 * - Resolve user entity
 * - Determine context limit and strip patterns
 * - Build system prompt and structured messages via template engine
 */
export function preparePromptContext(
  entities: EvaluatedEntity[],
  channelId: string,
  guildId: string | undefined,
  userId: string,
  entityMemories?: Map<number, Array<{ content: string }>>,
): PreparedPromptContext {
  const other: EntityWithFacts[] = [];

  // Expand {{entity:ID}} refs and other macros in facts, collect referenced entities
  const seenIds = new Set(entities.map(e => e.id));
  const respondingNames = entities.map(e => e.name);
  for (const entity of entities) {
    other.push(...expandEntityRefs(entity, seenIds, entity.exprContext, {
      modelSpec: entity.modelSpec,
      contextExpr: entity.contextExpr,
      respondingNames,
    }));
  }

  // Add user entity if bound
  const userEntityId = resolveDiscordEntity(userId, "user", guildId, channelId);
  if (userEntityId && !seenIds.has(userEntityId)) {
    const userEntity = getEntityWithFacts(userEntityId);
    if (userEntity) {
      other.push(userEntity);
      seenIds.add(userEntityId);
    }
  }

  // Determine context expression from entities (first non-null wins)
  const contextExpr = entities.find(e => e.contextExpr !== null)?.contextExpr ?? DEFAULT_CONTEXT_EXPR;

  // Determine effective strip patterns
  const entityStripPatterns = entities[0]?.stripPatterns;
  const modelSpec_ = entities[0]?.modelSpec ?? DEFAULT_MODEL;
  const effectiveStripPatterns = entityStripPatterns !== null
    ? entityStripPatterns
    : modelSpec_.includes("gemini-2.5-flash-preview")
      ? ["</blockquote>"]
      : [];

  // Build messages via template engine
  const template = entities[0]?.template ?? null;
  const { systemPrompt, messages } = buildPromptAndMessages(
    entities, other, entityMemories, template, channelId, contextExpr, effectiveStripPatterns,
  );

  return { systemPrompt, messages, other, contextExpr, effectiveStripPatterns };
}
