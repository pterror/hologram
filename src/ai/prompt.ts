import {
  getEntityWithFacts,
  type EntityWithFacts,
} from "../db/entities";
import {
  formatEntityDisplay,
  DEFAULT_CONTEXT_EXPR,
  type EvaluatedEntity,
} from "./context";
import { getMessages, getWebhookMessageEntity, parseMessageData, resolveDiscordEntity, type EmbedData, type AttachmentData, type StickerData } from "../db/discord";
import { evalMacroValue, formatDuration, rollDice, compileContextExpr, parseFact, stripComments, ExprError, type ExprContext } from "../logic/expr";
import { DEFAULT_MODEL } from "./models";
import { DEFAULT_TEMPLATE, renderStructuredTemplate, renderSystemPrompt } from "./template";
import {
  applyStripPatterns,
  type StructuredMessage,
} from "./context";

// =============================================================================
// Template-Safe Data Helpers
// =============================================================================

/** Add empty-string defaults for optional embed properties so templates can safely output them */
function withEmbedDefaults(embeds: EmbedData[]): EmbedData[] {
  return embeds.map(e => ({
    title: "",
    type: "",
    description: "",
    url: "",
    ...e,
  }));
}

/** Add empty-string defaults for optional attachment properties */
function withAttachmentDefaults(attachments: AttachmentData[]): AttachmentData[] {
  return attachments.map(a => ({
    content_type: "",
    title: "",
    description: "",
    ...a,
  }));
}

// =============================================================================
// JSON Serialization Helpers
// =============================================================================

export type WithToJSON<T> = T & { toJSON(): string };

/** Add toJSON() to an array and each element within it (closures reference original plain objects to avoid infinite recursion) */
export function withToJSON<T extends object>(arr: T[]): WithToJSON<T>[] & { toJSON(): string } {
  const result = arr.map(item => {
    const copy = { ...item } as WithToJSON<T>;
    copy.toJSON = () => JSON.stringify(item);
    return copy;
  }) as WithToJSON<T>[] & { toJSON(): string };
  result.toJSON = () => JSON.stringify(arr);
  return result;
}

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

      // Date/time macros - delegate to ExprContext when available for consistency
      if (lower === "date") {
        if (exprContext) return exprContext.date_str();
        const now = new Date();
        return now.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
      }

      if (lower === "time") {
        if (exprContext) return exprContext.time_str();
        return new Date().toLocaleTimeString("en-US");
      }

      if (lower === "weekday") {
        if (exprContext) return exprContext.weekday();
        return new Date().toLocaleDateString("en-US", { weekday: "long" });
      }

      if (lower === "isodate") {
        if (exprContext) return exprContext.isodate();
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      }

      if (lower === "isotime") {
        if (exprContext) return exprContext.isotime();
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
 * Collapse consecutive messages with the same role into a single message.
 * Content is joined with newline. Empty messages are preserved (they may
 * carry structural meaning to the template author).
 */
function collapseMessages(messages: StructuredMessage[]): StructuredMessage[] {
  if (messages.length <= 1) return messages;
  const result: StructuredMessage[] = [messages[0]];
  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1];
    if (messages[i].role === prev.role) {
      prev.content += "\n" + messages[i].content;
    } else {
      result.push({ ...messages[i] });
    }
  }
  return result;
}

/**
 * Process raw facts for non-responding entities (others, user persona).
 * Strips comments, $if prefixes, and directive-only facts.
 * Responding entities go through evaluateFacts() which handles this,
 * but others/user entities use raw DB facts and need manual processing.
 */
export function processRawFacts(rawFacts: string[]): string[] {
  const uncommented = stripComments(rawFacts);
  const result: string[] = [];
  for (const fact of uncommented) {
    const parsed = parseFact(fact);
    // Skip directive-only facts (they're instructions, not descriptive content)
    if (
      parsed.isRespond || parsed.isRetry || parsed.isAvatar ||
      parsed.isLockedDirective || parsed.isStream || parsed.isMemory ||
      parsed.isContext || parsed.isFreeform || parsed.isModel || parsed.isStrip ||
      parsed.isThinking
    ) {
      continue;
    }
    result.push(parsed.content);
  }
  return result;
}

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
  systemTemplate?: string | null,
  userEntityId?: number | null,
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
    embeds: EmbedData[] & { toJSON(): string };
    stickers: StickerData[] & { toJSON(): string };
    attachments: AttachmentData[] & { toJSON(): string };
    toJSON(): string;
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

    const embeds = withToJSON(withEmbedDefaults(data?.embeds ?? []));
    const stickers = withToJSON(data?.stickers ?? []);
    const attachments = withToJSON(withAttachmentDefaults(data?.attachments ?? []));
    const entry: HistoryEntry = {
      author: m.author_name,
      content,
      author_id: m.author_id,
      created_at: m.created_at,
      is_bot: data?.is_bot ?? false,
      role,
      embeds,
      stickers,
      attachments,
      toJSON: () => JSON.stringify({ author: entry.author, content: entry.content, author_id: entry.author_id, created_at: entry.created_at, is_bot: entry.is_bot, role: entry.role, embeds: data?.embeds ?? [], stickers: data?.stickers ?? [], attachments: data?.attachments ?? [] }),
    };
    history.push(entry);
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

  /** Create an array with a toString override that joins with newlines */
  function withJoinToString<T>(arr: T[]): T[] {
    const result = [...arr];
    (result as T[] & { toString: () => string }).toString = () => result.join("\n");
    return result;
  }

  templateCtx.entities = respondingEntities.map(e => {
    const facts = withJoinToString(e.facts);
    return { id: e.id, name: e.name, facts };
  });

  templateCtx.others = otherEntities.map(e => {
    const facts = withJoinToString(processRawFacts(e.facts.map(f => f.content)));
    return { id: e.id, name: e.name, facts };
  });

  const memoriesObj: Record<number, string[]> = {};
  if (entityMemories) {
    for (const [entityId, mems] of entityMemories) {
      memoriesObj[entityId] = withJoinToString(mems.map(m => m.content));
    }
  }
  templateCtx.memories = memoriesObj;
  templateCtx.entity_names = respondingEntities.map(e => e.name).join(", ");
  templateCtx.freeform = respondingEntities.some(e => e.isFreeform);
  templateCtx.history = history;
  templateCtx._single_entity = isSingleEntity;

  // Evaluation metadata (computed during fact evaluation, available to templates)
  templateCtx.model = respondingEntities[0]?.modelSpec ?? DEFAULT_MODEL;
  templateCtx.maxPrompt = contextExpr;
  templateCtx.respondingNames = respondingEntities.map(e => e.name);

  // char = first responding entity, user = user entity from others
  if (respondingEntities.length > 0) {
    const first = respondingEntities[0];
    const charFacts = withJoinToString(first.facts);
    templateCtx.char = { id: first.id, name: first.name, facts: charFacts, toString: () => first.name };
  }

  // Find user entity in others (by userEntityId if available)
  const userEntity = userEntityId
    ? otherEntities.find(e => e.id === userEntityId)
    : undefined;
  if (userEntity) {
    const userFacts = withJoinToString(processRawFacts(userEntity.facts.map(f => f.content)));
    templateCtx.user = { id: userEntity.id, name: userEntity.name, facts: userFacts, toString: () => userEntity.name };
  } else {
    templateCtx.user = { id: 0, name: "user", facts: withJoinToString([]), toString: () => "user" };
  }

  // Render dedicated system prompt (AI SDK `system` parameter)
  let systemPrompt: string;
  try {
    systemPrompt = renderSystemPrompt(templateCtx, systemTemplate ?? undefined);
  } catch (err) {
    const entityName = respondingEntities[0]?.name ?? "unknown";
    throw new ExprError(
      `Template error in entity "${entityName}" (system template): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Render structured messages template
  const templateSource = template ?? DEFAULT_TEMPLATE;
  let output: ReturnType<typeof renderStructuredTemplate>;
  try {
    output = renderStructuredTemplate(templateSource, templateCtx);
  } catch (err) {
    const entityName = respondingEntities[0]?.name ?? "unknown";
    throw new ExprError(
      `Template error in entity "${entityName}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

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

  // Collapse consecutive same-role messages into one
  messages = collapseMessages(messages);

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
  const systemTemplate = entities[0]?.systemTemplate ?? null;
  const { systemPrompt, messages } = buildPromptAndMessages(
    entities, other, entityMemories, template, channelId, contextExpr, effectiveStripPatterns, systemTemplate, userEntityId,
  );

  return { systemPrompt, messages, other, contextExpr, effectiveStripPatterns };
}
