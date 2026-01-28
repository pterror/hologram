import { generateText, streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getLanguageModel, DEFAULT_MODEL } from "./models";
import { debug, error } from "../logger";
import {
  getEntityWithFacts,
  getFactsForEntity,
  addFact,
  updateFactByContent,
  removeFactByContent,
  type EntityWithFacts,
} from "../db/entities";
import {
  addMemory,
  updateMemoryByContent,
  removeMemoryByContent,
} from "../db/memories";
import {
  resolveDiscordEntity,
  getMessages,
} from "../db/discord";
import { parseFact } from "../logic/expr";

// =============================================================================
// Constants
// =============================================================================

/** Maximum characters of message history to include in context */
const MESSAGE_HISTORY_CHAR_LIMIT = 16_000;

/** Number of messages to fetch from DB (we'll trim by char limit) */
const MESSAGE_FETCH_LIMIT = 100;

// =============================================================================
// Types
// =============================================================================

/** Entity with pre-evaluated facts (directives processed and removed) */
export interface EvaluatedEntity {
  id: number;
  name: string;
  /** Facts with directives ($if, $respond, $avatar, etc.) processed and removed */
  facts: string[];
  /** Avatar URL from $avatar directive, if present */
  avatarUrl: string | null;
  /** Stream mode from $stream directive, if present */
  streamMode: "lines" | "full" | null;
  /** Custom delimiter for streaming (default: newline) */
  streamDelimiter: string | null;
  /** Memory retrieval scope from $memory directive (default: "none") */
  memoryScope: "none" | "channel" | "guild" | "global";
  /** Context character limit from $context directive, if present */
  contextLimit: number | null;
}

export interface MessageContext {
  channelId: string;
  guildId?: string;
  userId: string;
  username: string;
  content: string;
  isMentioned: boolean;
  /** Pre-evaluated responding entities (facts already processed) */
  respondingEntities?: EvaluatedEntity[];
  /** Retrieved memories per entity (entity id -> memories) */
  entityMemories?: Map<number, Array<{ content: string }>>;
}

export interface CharacterResponse {
  entityId: number;
  name: string;
  content: string;
  avatarUrl?: string;
  streamMode?: "lines" | "full" | null;
  streamDelimiter?: string | null;
}

export interface ResponseResult {
  response: string;
  characterResponses?: CharacterResponse[];
  factsAdded: number;
  factsUpdated: number;
  factsRemoved: number;
  memoriesSaved: number;
  memoriesUpdated: number;
  memoriesRemoved: number;
}

// =============================================================================
// Display Helpers
// =============================================================================

/** Format entity name and ID for LLM context */
export function formatEntityDisplay(name: string, id: number): string {
  return `${name} [${id}]`;
}

// =============================================================================
// Permission Checking
// =============================================================================

const LOCKED_SIGIL = "$locked";

/**
 * Check if an entity is locked from LLM modification.
 * Returns { locked: false } if not locked.
 * Returns { locked: true, reason: string } if locked.
 */
function checkEntityLocked(entityId: number): { locked: false } | { locked: true; reason: string } {
  const facts = getFactsForEntity(entityId);
  for (const fact of facts) {
    const trimmed = fact.content.trim();
    // Pure $locked directive (entity-level lock)
    if (trimmed === LOCKED_SIGIL) {
      return { locked: true, reason: "Entity is locked" };
    }
  }
  return { locked: false };
}

/**
 * Check if a specific fact is locked from LLM modification.
 * This checks both entity-level locks and fact-level $locked prefix.
 */
function checkFactLocked(entityId: number, factContent: string): { locked: false } | { locked: true; reason: string } {
  const facts = getFactsForEntity(entityId);
  for (const fact of facts) {
    const trimmed = fact.content.trim();
    // Pure $locked directive (entity-level lock)
    if (trimmed === LOCKED_SIGIL) {
      return { locked: true, reason: "Entity is locked" };
    }
    // Check if this is the locked version of the fact we're trying to modify
    if (trimmed.startsWith(LOCKED_SIGIL + " ")) {
      const lockedContent = parseFact(trimmed.slice(LOCKED_SIGIL.length + 1).trim()).content;
      if (lockedContent === factContent) {
        return { locked: true, reason: "Fact is locked" };
      }
    }
  }
  return { locked: false };
}

// =============================================================================
// Entity Reference Expansion
// =============================================================================

/** Pattern for entity references: {{entity:ID}} */
const ENTITY_REF_PATTERN = /\{\{entity:(\d+)\}\}/g;

/**
 * Expand all {{entity:ID}} references in an entity's facts.
 * Replaces references with entity names and collects referenced entities.
 *
 * @param entity - The entity whose facts to process (mutates facts in place)
 * @param seenIds - Set of entity IDs already in context (modified in place)
 * @returns Array of newly referenced entities to add to context
 */
function expandEntityRefs(
  entity: { facts: string[] },
  seenIds: Set<number>
): EntityWithFacts[] {
  const referencedEntities: EntityWithFacts[] = [];

  for (let i = 0; i < entity.facts.length; i++) {
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
// Tool Definitions
// =============================================================================

/** Create tools with context for memory source tracking */
function createTools(channelId?: string, guildId?: string) {
  return {
    add_fact: tool({
      description: "Add a new permanent fact to an entity. Use sparingly - only for defining traits that won't change.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID to add the fact to"),
        content: z.string().describe("The fact content"),
      }),
      execute: async ({ entityId, content }) => {
        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: add_fact blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const fact = addFact(entityId, content);
        debug("Tool: add_fact", { entityId, content, factId: fact.id });
        return { success: true, factId: fact.id };
      },
    }),

    update_fact: tool({
      description: "Update an existing permanent fact. Use when a defining trait changes.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID"),
        oldContent: z.string().describe("The exact current fact text to match"),
        newContent: z.string().describe("The new fact content"),
      }),
      execute: async ({ entityId, oldContent, newContent }) => {
        // Check if entity or specific fact is locked
        const lockCheck = checkFactLocked(entityId, oldContent);
        if (lockCheck.locked) {
          debug("Tool: update_fact blocked", { entityId, oldContent, newContent, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const fact = updateFactByContent(entityId, oldContent, newContent);
        debug("Tool: update_fact", { entityId, oldContent, newContent, success: !!fact });
        return { success: !!fact };
      },
    }),

    remove_fact: tool({
      description: "Remove a permanent fact that is no longer true.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID"),
        content: z.string().describe("The exact fact text to remove"),
      }),
      execute: async ({ entityId, content }) => {
        // Check if entity or specific fact is locked
        const lockCheck = checkFactLocked(entityId, content);
        if (lockCheck.locked) {
          debug("Tool: remove_fact blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const success = removeFactByContent(entityId, content);
        debug("Tool: remove_fact", { entityId, content, success });
        return { success };
      },
    }),

    save_memory: tool({
      description: "Save a memory for an entity. Use for important events, conversations, or information worth recalling later. More appropriate than facts for things that happened.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID"),
        content: z.string().describe("The memory content - what happened or was learned"),
      }),
      execute: async ({ entityId, content }) => {
        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: save_memory blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const memory = await addMemory(entityId, content, undefined, channelId, guildId);
        debug("Tool: save_memory", { entityId, content, memoryId: memory.id });
        return { success: true, memoryId: memory.id };
      },
    }),

    update_memory: tool({
      description: "Update an existing memory by content match.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID"),
        oldContent: z.string().describe("The exact current memory text to match"),
        newContent: z.string().describe("The new memory content"),
      }),
      execute: async ({ entityId, oldContent, newContent }) => {
        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: update_memory blocked", { entityId, oldContent, newContent, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const memory = await updateMemoryByContent(entityId, oldContent, newContent);
        debug("Tool: update_memory", { entityId, oldContent, newContent, success: !!memory });
        return { success: !!memory };
      },
    }),

    remove_memory: tool({
      description: "Remove a memory by content match.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID"),
        content: z.string().describe("The exact memory text to remove"),
      }),
      execute: async ({ entityId, content }) => {
        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: remove_memory blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const success = removeMemoryByContent(entityId, content);
        debug("Tool: remove_memory", { entityId, content, success });
        return { success };
      },
    }),
  };
}

// =============================================================================
// Context Building
// =============================================================================

/** Format an evaluated entity for LLM context */
function formatEvaluatedEntity(entity: EvaluatedEntity): string {
  const factLines = entity.facts.join("\n");
  return `<facts entity="${entity.name}" id="${entity.id}">\n${factLines}\n</facts>`;
}

/** Format a raw entity for LLM context (used for locations, etc.) */
function formatRawEntity(entity: EntityWithFacts): string {
  const factLines = entity.facts.map(f => f.content).join("\n");
  return `<facts entity="${entity.name}" id="${entity.id}">\n${factLines}\n</facts>`;
}

function buildSystemPrompt(
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
      contextParts.push(`<memories entity="${e.name}" id="${e.id}">\n${memoryLines}\n</memories>`);
    }
  }
  for (const e of otherEntities) {
    contextParts.push(formatRawEntity(e));
  }
  const context = contextParts.join("\n\n");

  let multiCharGuidance = "";
  if (respondingEntities.length > 1) {
    const names = respondingEntities.map(c => c.name).join(", ");
    multiCharGuidance = `\n\nMultiple characters are present: ${names}. Format your response with XML tags:
<${respondingEntities[0]?.name ?? "Name"}>*waves* Hello there!</${respondingEntities[0]?.name ?? "Name"}>
<${respondingEntities[1]?.name ?? "Other"}>Nice to meet you.</${respondingEntities[1]?.name ?? "Other"}>

Wrap each character's dialogue in their name tag. Characters may interact naturally.

Not every character needs to respond to every message. Only respond as characters who would naturally engage with what was said. If no character would respond, reply with only <none/>.`;
  }

  return `${context}

You have access to tools to modify facts and memories about entities.

**Facts** are permanent defining traits. Use very sparingly:
- Core personality, appearance, abilities
- Key relationships that define the character
- Use add_fact / update_fact / remove_fact

**Memories** are important events worth recalling. Use sparingly:
- Significant conversations or promises
- Events that shaped the character
- Things learned that may be relevant later
- Use save_memory / update_memory / remove_memory

Most interactions don't need saving. Only save what matters long-term.

Respond naturally in character based on the facts and memories provided.${multiCharGuidance}`;
}

/**
 * Build message history up to a character limit.
 * Messages should be in DESC order (newest first) from the database.
 * Returns formatted string in chronological order (oldest first).
 */
function buildMessageHistory(
  messages: Array<{ author_name: string; content: string }>,
  charLimit = MESSAGE_HISTORY_CHAR_LIMIT
): string {
  const lines: string[] = [];
  let totalChars = 0;

  // Process newest to oldest, accumulating until we hit the limit
  for (const m of messages) {
    const line = `${m.author_name}: ${m.content}`;
    const lineLen = line.length + 1; // +1 for newline

    if (totalChars + lineLen > charLimit && lines.length > 0) {
      break; // Would exceed limit, stop (but always include at least one message)
    }

    lines.push(line);
    totalChars += lineLen;
  }

  // Reverse to chronological order (oldest first)
  return lines.reverse().join("\n");
}

/**
 * Parse LLM response into per-character segments using XML tags.
 * Format: <CharName>content</CharName>
 * Returns undefined if no valid tags found.
 */
function parseMultiCharacterResponse(
  response: string,
  entities: EvaluatedEntity[]
): CharacterResponse[] | undefined {
  if (entities.length <= 1) return undefined;

  type ParsedResponse = CharacterResponse & { position: number };
  const results: ParsedResponse[] = [];

  // Match XML tags for each entity: <Name>content</Name>
  for (const entity of entities) {
    // Escape special regex chars in name
    const escapedName = entity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`<${escapedName}>([\\s\\S]*?)</${escapedName}>`, "gi");
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(response)) !== null) {
      const content = match[1].trim();
      if (content) {
        results.push({
          entityId: entity.id,
          name: entity.name,
          content,
          avatarUrl: entity.avatarUrl ?? undefined,
          streamMode: entity.streamMode,
          position: match.index,
        });
      }
    }
  }

  // No tags found - return undefined to use single response
  if (results.length === 0) {
    return undefined;
  }

  // Sort by position in original response to maintain order
  results.sort((a, b) => a.position - b.position);

  // Remove position from results
  return results.map(({ position: _, ...rest }) => rest);
}

// =============================================================================
// Main Handler
// =============================================================================

export async function handleMessage(ctx: MessageContext): Promise<ResponseResult | null> {
  const { channelId, guildId, userId, isMentioned, respondingEntities } = ctx;

  // Separate evaluated responding entities from other raw entities
  const evaluated: EvaluatedEntity[] = respondingEntities ?? [];
  const other: EntityWithFacts[] = [];

  // Expand {{entity:ID}} refs in facts and collect referenced entities
  const seenIds = new Set(evaluated.map(e => e.id));
  for (const entity of evaluated) {
    other.push(...expandEntityRefs(entity, seenIds));
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

  // Decide whether to respond
  const shouldRespond = isMentioned || evaluated.length > 0 || other.length > 0;
  if (!shouldRespond) {
    debug("Not responding - not mentioned and no entities");
    return null;
  }

  // Get message history
  const history = getMessages(channelId, MESSAGE_FETCH_LIMIT);

  // Determine context limit from entities (first non-null wins)
  const contextLimit = evaluated.find(e => e.contextLimit !== null)?.contextLimit ?? MESSAGE_HISTORY_CHAR_LIMIT;

  // Build prompts
  const systemPrompt = buildSystemPrompt(evaluated, other, ctx.entityMemories);
  const userMessage = buildMessageHistory(history, contextLimit);

  debug("Calling LLM", {
    respondingEntities: evaluated.map(e => e.name),
    otherEntities: other.map(e => e.name),
    contextLimit,
    systemPrompt,
    userMessage,
  });

  // Track tool usage
  let factsAdded = 0;
  let factsUpdated = 0;
  let factsRemoved = 0;
  let memoriesSaved = 0;
  let memoriesUpdated = 0;
  let memoriesRemoved = 0;

  try {
    const model = getLanguageModel(DEFAULT_MODEL);
    const tools = createTools(channelId, guildId);

    const result = await generateText({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools,
      stopWhen: stepCountIs(5), // Allow up to 5 tool call rounds
      onStepFinish: ({ toolCalls }) => {
        for (const call of toolCalls ?? []) {
          if (call.toolName === "add_fact") factsAdded++;
          if (call.toolName === "update_fact") factsUpdated++;
          if (call.toolName === "remove_fact") factsRemoved++;
          if (call.toolName === "save_memory") memoriesSaved++;
          if (call.toolName === "update_memory") memoriesUpdated++;
          if (call.toolName === "remove_memory") memoriesRemoved++;
        }
      },
    });

    debug("LLM response", {
      text: result.text,
      factsAdded,
      factsUpdated,
      factsRemoved,
      memoriesSaved,
      memoriesUpdated,
      memoriesRemoved,
    });

    // Check for <none/> sentinel (LLM decided no character should respond)
    if (result.text.trim() === "<none/>") {
      debug("LLM returned <none/> - no response");
      return null;
    }

    // Parse multi-character response if multiple entities
    const characterResponses = parseMultiCharacterResponse(result.text, evaluated);

    return {
      response: result.text,
      characterResponses,
      factsAdded,
      factsUpdated,
      factsRemoved,
      memoriesSaved,
      memoriesUpdated,
      memoriesRemoved,
    };
  } catch (err) {
    error("LLM error", err);
    return null;
  }
}

// =============================================================================
// Streaming Handler
// =============================================================================

export interface StreamingContext extends MessageContext {
  /** Entities to stream for */
  entities: EvaluatedEntity[];
  /** Stream mode */
  streamMode: "lines" | "full";
  /** Custom delimiter (default: newline for lines mode, none for full mode) */
  delimiter?: string;
}

/** Stream event types */
export type StreamEvent =
  | { type: "delta"; content: string; fullContent: string }
  | { type: "line"; content: string }
  | { type: "line_start" }  // lines full: new line starting
  | { type: "line_delta"; delta: string; content: string }  // lines full: delta within current line
  | { type: "line_end"; content: string }  // lines full: line complete
  | { type: "char_start"; name: string; entityId: number; avatarUrl?: string }
  | { type: "char_delta"; name: string; delta: string; content: string }
  | { type: "char_line"; name: string; content: string }
  | { type: "char_line_start"; name: string }  // lines full: new line starting for character
  | { type: "char_line_delta"; name: string; delta: string; content: string }  // lines full: delta within current line
  | { type: "char_line_end"; name: string; content: string }  // lines full: line complete for character
  | { type: "char_end"; name: string; content: string }
  | { type: "done"; fullText: string };

/**
 * Handle a message with streaming.
 * Yields events based on stream mode and character count.
 *
 * Single entity:
 * - "lines": yields { type: "line" } for each complete line
 * - "full": yields { type: "delta" } for each text chunk
 * - "lines_full": yields { type: "line" } when line completes, { type: "delta" } within line
 *
 * Multi-character (heuristic XML parsing):
 * - Parses <CharName>...</CharName> tags as they stream
 * - yields char_start, char_delta/char_line, char_end events
 */
export async function* handleMessageStreaming(
  ctx: StreamingContext
): AsyncGenerator<StreamEvent, void, unknown> {
  const { channelId, guildId, entities, streamMode, delimiter } = ctx;

  // Expand {{entity:ID}} refs in facts and collect referenced entities
  const other: EntityWithFacts[] = [];
  const seenIds = new Set(entities.map(e => e.id));
  for (const entity of entities) {
    other.push(...expandEntityRefs(entity, seenIds));
  }

  // Add user entity if bound
  const userEntityId = resolveDiscordEntity(ctx.userId, "user", guildId, channelId);
  if (userEntityId && !seenIds.has(userEntityId)) {
    const userEntity = getEntityWithFacts(userEntityId);
    if (userEntity) {
      other.push(userEntity);
      seenIds.add(userEntityId);
    }
  }

  // Get message history
  const history = getMessages(channelId, MESSAGE_FETCH_LIMIT);

  // Determine context limit from entities (first non-null wins)
  const contextLimit = entities.find(e => e.contextLimit !== null)?.contextLimit ?? MESSAGE_HISTORY_CHAR_LIMIT;

  // Build prompts
  const systemPrompt = buildSystemPrompt(entities, other, ctx.entityMemories);
  const userMessage = buildMessageHistory(history, contextLimit);

  debug("Calling LLM (streaming)", {
    entities: entities.map(e => e.name),
    streamMode,
    contextLimit,
    hasMemories: !!ctx.entityMemories?.size,
  });

  try {
    const model = getLanguageModel(DEFAULT_MODEL);
    const tools = createTools(channelId, guildId);

    const result = streamText({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools,
      stopWhen: stepCountIs(5),
    });

    // Use different streaming logic based on single vs multi-character
    if (entities.length === 1) {
      yield* streamSingleEntity(result.textStream, streamMode, delimiter);
    } else {
      yield* streamMultiCharacter(result.textStream, entities, streamMode, delimiter);
    }

    // Yield done event with full text
    const fullText = await result.text;
    yield { type: "done", fullText };

    // Process tool calls
    const toolCalls = await result.toolCalls;
    for (const call of toolCalls) {
      debug("Tool call (streaming)", { tool: call.toolName });
    }

  } catch (err) {
    error("LLM streaming error", err);
  }
}

/**
 * Stream events for a single entity.
 *
 * Modes:
 * - "lines": new message per delimiter, sent when complete (emits "line" events)
 * - "full" without delimiter: single message, edited progressively (emits "delta" events)
 * - "full" with delimiter: new message per delimiter, each edited progressively
 *   (emits "line_start", "line_delta", "line_end" events)
 */
async function* streamSingleEntity(
  textStream: AsyncIterable<string>,
  streamMode: "lines" | "full",
  delimiter: string | undefined
): AsyncGenerator<StreamEvent, void, unknown> {
  let buffer = "";
  let fullContent = "";
  let lineContent = "";  // For full mode with delimiter
  let lineStarted = false;

  const hasDelimiter = delimiter !== undefined;

  for await (const delta of textStream) {
    buffer += delta;
    fullContent += delta;

    if (streamMode === "full" && !hasDelimiter) {
      // Full mode without delimiter: single message, emit every delta
      yield { type: "delta", content: delta, fullContent };
    } else if (streamMode === "full" && hasDelimiter) {
      // Full mode with delimiter: new message per chunk, each edited progressively
      let delimIndex: number;
      while ((delimIndex = buffer.indexOf(delimiter)) !== -1) {
        const chunk = buffer.slice(0, delimIndex);
        buffer = buffer.slice(delimIndex + delimiter.length);

        // Complete current line
        lineContent += chunk;
        const trimmed = lineContent.trim();
        if (trimmed && trimmed !== "<none/>") {
          if (!lineStarted) {
            yield { type: "line_start" };
          }
          yield { type: "line_end", content: trimmed };
        }
        lineContent = "";
        lineStarted = false;
      }

      // Emit delta for partial content in buffer
      if (buffer) {
        if (!lineStarted) {
          yield { type: "line_start" };
          lineStarted = true;
        }
        lineContent += buffer;
        const trimmed = lineContent.trim();
        if (trimmed && trimmed !== "<none/>") {
          yield { type: "line_delta", delta: buffer, content: trimmed };
        }
        buffer = "";
      }
    } else {
      // Lines mode: split on delimiter, emit complete chunks
      const effectiveDelim = delimiter ?? "\n";
      let delimIndex: number;
      while ((delimIndex = buffer.indexOf(effectiveDelim)) !== -1) {
        const chunk = buffer.slice(0, delimIndex).trim();
        buffer = buffer.slice(delimIndex + effectiveDelim.length);

        if (chunk && chunk !== "<none/>") {
          yield { type: "line", content: chunk };
        }
      }
    }
  }

  // Handle remaining buffer
  const remaining = buffer.trim();
  if (remaining && remaining !== "<none/>") {
    if (streamMode === "lines") {
      yield { type: "line", content: remaining };
    } else if (streamMode === "full" && hasDelimiter) {
      lineContent += buffer;
      const trimmed = lineContent.trim();
      if (trimmed && trimmed !== "<none/>") {
        if (!lineStarted) {
          yield { type: "line_start" };
        }
        yield { type: "line_end", content: trimmed };
      }
    }
    // For full mode without delimiter, already emitted as deltas
  }
}

/**
 * Stream events for multiple characters with heuristic XML parsing.
 * Parses <CharName>content</CharName> tags as they stream.
 *
 * Modes:
 * - "lines": new message per delimiter, sent when complete (emits "char_line" events)
 * - "full" without delimiter: single message per char, edited progressively (emits "char_delta" events)
 * - "full" with delimiter: new message per delimiter, each edited progressively
 *   (emits "char_line_start", "char_line_delta", "char_line_end" events)
 */
async function* streamMultiCharacter(
  textStream: AsyncIterable<string>,
  entities: EvaluatedEntity[],
  streamMode: "lines" | "full",
  delimiter: string | undefined
): AsyncGenerator<StreamEvent, void, unknown> {
  let buffer = "";
  let currentChar: { name: string; entityId: number; avatarUrl?: string; content: string; lineContent: string; lineStarted: boolean } | null = null;

  const hasDelimiter = delimiter !== undefined;

  // Build entity lookup map (case-insensitive)
  const entityMap = new Map<string, EvaluatedEntity>();
  for (const entity of entities) {
    entityMap.set(entity.name.toLowerCase(), entity);
  }

  // Build regex for opening tags
  const names = entities.map(e => e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const openTagPattern = new RegExp(`<(${names.join("|")})>`, "i");
  const closeTagPattern = (name: string) => new RegExp(`</${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`, "i");

  for await (const delta of textStream) {
    buffer += delta;

    // Process buffer
    while (buffer.length > 0) {
      if (currentChar === null) {
        // Look for opening tag
        const match = buffer.match(openTagPattern);
        if (match) {
          const tagEnd = match.index! + match[0].length;
          buffer = buffer.slice(tagEnd);
          const charName = match[1];
          const entity = entityMap.get(charName.toLowerCase());
          if (entity) {
            currentChar = {
              name: entity.name,
              entityId: entity.id,
              avatarUrl: entity.avatarUrl ?? undefined,
              content: "",
              lineContent: "",
              lineStarted: false,
            };
            yield { type: "char_start", name: entity.name, entityId: entity.id, avatarUrl: entity.avatarUrl ?? undefined };
          }
        } else {
          // No tag found yet, might be partial - keep minimal buffer
          const maxTagLen = Math.max(...names.map(n => n.length)) + 2; // <Name>
          if (buffer.length > maxTagLen && !buffer.includes("<")) {
            buffer = "";
          }
          break;
        }
      } else {
        // Inside a character tag - look for closing tag
        const closeMatch = buffer.match(closeTagPattern(currentChar.name));
        if (closeMatch) {
          // Found closing tag
          const content = buffer.slice(0, closeMatch.index!);
          buffer = buffer.slice(closeMatch.index! + closeMatch[0].length);

          // Emit remaining content
          if (content.trim()) {
            currentChar.content += content;
            if (streamMode === "lines") {
              // Emit any remaining chunks
              const effectiveDelim = delimiter ?? "\n";
              const chunks = content.split(effectiveDelim);
              for (const chunk of chunks) {
                const trimmed = chunk.trim();
                if (trimmed) {
                  yield { type: "char_line", name: currentChar.name, content: trimmed };
                }
              }
            } else if (streamMode === "full" && hasDelimiter) {
              // Full mode with delimiter: emit final line
              currentChar.lineContent += content;
              const trimmed = currentChar.lineContent.trim();
              if (trimmed) {
                if (!currentChar.lineStarted) {
                  yield { type: "char_line_start", name: currentChar.name };
                }
                yield { type: "char_line_end", name: currentChar.name, content: trimmed };
              }
            } else {
              // Full mode without delimiter: emit delta
              yield { type: "char_delta", name: currentChar.name, delta: content, content: currentChar.content };
            }
          }

          yield { type: "char_end", name: currentChar.name, content: currentChar.content.trim() };
          currentChar = null;
        } else {
          // No closing tag yet - emit content progressively
          if (streamMode === "lines") {
            // Lines mode: emit complete chunks
            const effectiveDelim = delimiter ?? "\n";
            let delimIndex: number;
            while ((delimIndex = buffer.indexOf(effectiveDelim)) !== -1) {
              const chunk = buffer.slice(0, delimIndex);
              buffer = buffer.slice(delimIndex + effectiveDelim.length);
              currentChar.content += chunk + effectiveDelim;

              const trimmed = chunk.trim();
              if (trimmed) {
                yield { type: "char_line", name: currentChar.name, content: trimmed };
              }
            }
          } else if (streamMode === "full" && hasDelimiter) {
            // Full mode with delimiter: emit deltas within each line
            let delimIndex: number;
            while ((delimIndex = buffer.indexOf(delimiter)) !== -1) {
              const chunk = buffer.slice(0, delimIndex);
              buffer = buffer.slice(delimIndex + delimiter.length);
              currentChar.content += chunk + delimiter;

              // Complete current line
              currentChar.lineContent += chunk;
              const trimmed = currentChar.lineContent.trim();
              if (trimmed) {
                if (!currentChar.lineStarted) {
                  yield { type: "char_line_start", name: currentChar.name };
                }
                yield { type: "char_line_end", name: currentChar.name, content: trimmed };
              }
              currentChar.lineContent = "";
              currentChar.lineStarted = false;
            }

            // Emit delta for partial line content
            if (buffer && !buffer.includes("<")) {
              if (!currentChar.lineStarted) {
                yield { type: "char_line_start", name: currentChar.name };
                currentChar.lineStarted = true;
              }
              currentChar.content += buffer;
              currentChar.lineContent += buffer;
              const trimmed = currentChar.lineContent.trim();
              if (trimmed) {
                yield { type: "char_line_delta", name: currentChar.name, delta: buffer, content: trimmed };
              }
              buffer = "";
            }
          } else {
            // Full mode without delimiter: emit deltas
            // Check if this might be a partial closing tag
            const mightBeClosing = buffer.includes("<");
            if (!mightBeClosing) {
              currentChar.content += buffer;
              yield { type: "char_delta", name: currentChar.name, delta: buffer, content: currentChar.content };
              buffer = "";
            }
          }
          break;
        }
      }
    }
  }

  // Handle any remaining content in currentChar
  if (currentChar && currentChar.content.trim()) {
    yield { type: "char_end", name: currentChar.name, content: currentChar.content.trim() };
  }
}
