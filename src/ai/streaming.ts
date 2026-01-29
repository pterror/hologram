import { streamText, stepCountIs } from "ai";
import { getLanguageModel, DEFAULT_MODEL, InferenceError } from "./models";
import { debug, error } from "../logger";
import { getEntityWithFacts, type EntityWithFacts } from "../db/entities";
import { resolveDiscordEntity, getMessages } from "../db/discord";
import {
  applyStripPatterns,
  buildMessageHistory,
  DEFAULT_CONTEXT_LIMIT,
  type EvaluatedEntity,
  type MessageContext,
} from "./context";
import { expandEntityRefs, buildSystemPrompt } from "./prompt";
import { createTools } from "./tools";
import {
  stripNamePrefixFromStream,
  namePrefixSource,
  NAME_BOUNDARY,
} from "./parsing";

// =============================================================================
// Types
// =============================================================================

export interface StreamingContext extends MessageContext {
  /** Entities to stream for */
  entities: EvaluatedEntity[];
  /** Stream mode */
  streamMode: "lines" | "full";
  /** Custom delimiters (default: newline for lines mode, none for full mode) */
  delimiter?: string[];
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
  | { type: "char_line_start"; name: string }  // lines full: new line starting for entity
  | { type: "char_line_delta"; name: string; delta: string; content: string }  // lines full: delta within current line
  | { type: "char_line_end"; name: string; content: string }  // lines full: line complete for entity
  | { type: "char_end"; name: string; content: string }
  | { type: "done"; fullText: string };

// =============================================================================
// Delimiter Utilities
// =============================================================================

/**
 * Find the first occurrence of any delimiter in a buffer.
 * Returns the index and length of the matched delimiter, or { index: -1, length: 0 } if none found.
 */
export function findFirstDelimiter(buffer: string, delimiters: string[]): { index: number; length: number } {
  let bestIndex = -1;
  let bestLength = 0;
  for (const delim of delimiters) {
    const idx = buffer.indexOf(delim);
    if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
      bestLength = delim.length;
    }
  }
  return { index: bestIndex, length: bestLength };
}

/**
 * Split a string on any of multiple delimiters (first match wins at each position).
 */
export function splitOnDelimiters(content: string, delimiters: string[]): string[] {
  const results: string[] = [];
  let remaining = content;
  while (remaining.length > 0) {
    const { index, length } = findFirstDelimiter(remaining, delimiters);
    if (index === -1) {
      results.push(remaining);
      break;
    }
    results.push(remaining.slice(0, index));
    remaining = remaining.slice(index + length);
  }
  return results;
}

// =============================================================================
// Streaming Handler
// =============================================================================

/**
 * Handle a message with streaming.
 * Yields events based on stream mode and character count.
 *
 * Single entity:
 * - "lines": yields { type: "line" } for each complete line
 * - "full": yields { type: "delta" } for each text chunk
 * - "lines_full": yields { type: "line" } when line completes, { type: "delta" } within line
 *
 * Multiple entities (heuristic XML parsing):
 * - Parses <Name>...</Name> tags as they stream
 * - yields char_start, char_delta/char_line, char_end events
 */
export async function* handleMessageStreaming(
  ctx: StreamingContext
): AsyncGenerator<StreamEvent, void, unknown> {
  const { channelId, guildId, entities, streamMode, delimiter } = ctx;

  // Expand {{entity:ID}} refs and other macros in facts, collect referenced entities
  const other: EntityWithFacts[] = [];
  const seenIds = new Set(entities.map(e => e.id));
  for (const entity of entities) {
    other.push(...expandEntityRefs(entity, seenIds, entity.exprContext));
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
  const history = getMessages(channelId, 100);

  // Determine context limit from entities (first non-null wins)
  const contextLimit = entities.find(e => e.contextLimit !== null)?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;

  // Build prompts
  const systemPrompt = buildSystemPrompt(entities, other, ctx.entityMemories);
  let userMessage = buildMessageHistory(history, contextLimit);

  // Apply strip patterns to message history
  const entityStripPatterns = entities[0]?.stripPatterns;
  const modelSpec_ = entities[0]?.modelSpec ?? DEFAULT_MODEL;
  const effectiveStripPatterns = entityStripPatterns !== null
    ? entityStripPatterns
    : modelSpec_.includes("gemini-2.5-flash-preview")
      ? ["</blockquote>"]
      : [];
  if (effectiveStripPatterns.length > 0) {
    userMessage = applyStripPatterns(userMessage, effectiveStripPatterns);
  }

  debug("Calling LLM (streaming)", {
    entities: entities.map(e => e.name),
    streamMode,
    contextLimit,
    hasMemories: !!ctx.entityMemories?.size,
  });

  const modelSpec = entities[0]?.modelSpec ?? DEFAULT_MODEL;

  try {
    const model = getLanguageModel(modelSpec);
    const tools = createTools(channelId, guildId);

    const result = streamText({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools,
      stopWhen: stepCountIs(5),
    });

    // Wrap textStream to accumulate full text (avoids ReadableStream locked
    // error when accessing result.text after consuming textStream)
    let accumulatedText = "";
    const trackedStream = (async function* () {
      for await (const chunk of result.textStream) {
        accumulatedText += chunk;
        yield chunk;
      }
    })();

    // Use different streaming logic based on single vs multiple entities
    // In freeform mode, treat multi-entity like single (no XML parsing)
    const isFreeform = entities.some(e => e.isFreeform);
    if (entities.length === 1 || isFreeform) {
      yield* streamSingleEntity(trackedStream, streamMode, delimiter, entities[0]?.name);
    } else {
      yield* streamMultiEntityNamePrefix(trackedStream, entities, streamMode, delimiter);
    }

    // Yield done event with accumulated text
    yield { type: "done", fullText: accumulatedText };

  } catch (err) {
    error("LLM streaming error", err);
    throw new InferenceError(
      err instanceof Error ? err.message : String(err),
      modelSpec,
      err,
    );
  }
}

// =============================================================================
// Single Entity Streaming
// =============================================================================

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
  delimiter: string[] | undefined,
  entityName?: string
): AsyncGenerator<StreamEvent, void, unknown> {
  // Wrap stream to strip "Name:" prefixes and insert boundary markers
  const processedStream = entityName
    ? stripNamePrefixFromStream(textStream, entityName, NAME_BOUNDARY)
    : textStream;

  let buffer = "";
  let fullContent = "";
  let lineContent = "";  // For full mode with delimiter
  let lineStarted = false;

  // For full mode: split on user delimiters + NAME_BOUNDARY (if entity name present)
  const fullDelimiters = entityName
    ? [...(delimiter ?? []), NAME_BOUNDARY]
    : delimiter;
  const hasFullDelimiter = fullDelimiters !== undefined && fullDelimiters.length > 0;

  for await (const delta of processedStream) {
    buffer += delta;
    fullContent += delta;

    if (streamMode === "full" && !hasFullDelimiter) {
      // Full mode without delimiter: single message, emit every delta
      yield { type: "delta", content: delta, fullContent };
    } else if (streamMode === "full" && hasFullDelimiter) {
      // Full mode with delimiter: new message per chunk, each edited progressively
      let match: { index: number; length: number };
      while ((match = findFirstDelimiter(buffer, fullDelimiters!)).index !== -1) {
        const chunk = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match.length);

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
      const effectiveDelims = entityName
        ? [...(delimiter ?? ["\n"]), NAME_BOUNDARY]
        : (delimiter ?? ["\n"]);
      let match: { index: number; length: number };
      while ((match = findFirstDelimiter(buffer, effectiveDelims)).index !== -1) {
        const chunk = buffer.slice(0, match.index).trim();
        buffer = buffer.slice(match.index + match.length);

        if (chunk && chunk !== "<none/>") {
          yield { type: "line", content: chunk };
        }
      }
    }
  }

  // Handle remaining content
  if (streamMode === "lines") {
    const remaining = buffer.trim();
    if (remaining && remaining !== "<none/>") {
      yield { type: "line", content: remaining };
    }
  } else if (streamMode === "full" && hasFullDelimiter) {
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

// =============================================================================
// Multi-Entity Streaming (XML)
// =============================================================================

/**
 * Stream events for multiple entities with heuristic XML parsing.
 * Parses <Name>content</Name> tags as they stream.
 *
 * Modes:
 * - "lines": new message per delimiter, sent when complete (emits "char_line" events)
 * - "full" without delimiter: single message per entity, edited progressively (emits "char_delta" events)
 * - "full" with delimiter: new message per delimiter, each edited progressively
 *   (emits "char_line_start", "char_line_delta", "char_line_end" events)
 */
async function* streamMultiEntity(
  textStream: AsyncIterable<string>,
  entities: EvaluatedEntity[],
  streamMode: "lines" | "full",
  delimiter: string[] | undefined
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
        // Inside an entity tag - look for closing tag
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
              const effectiveDelims = delimiter ?? ["\n"];
              const chunks = splitOnDelimiters(content, effectiveDelims);
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
            const effectiveDelims = delimiter ?? ["\n"];
            let delimMatch: { index: number; length: number };
            while ((delimMatch = findFirstDelimiter(buffer, effectiveDelims)).index !== -1) {
              const chunk = buffer.slice(0, delimMatch.index);
              const matchedDelim = buffer.slice(delimMatch.index, delimMatch.index + delimMatch.length);
              buffer = buffer.slice(delimMatch.index + delimMatch.length);
              currentChar.content += chunk + matchedDelim;

              const trimmed = chunk.trim();
              if (trimmed) {
                yield { type: "char_line", name: currentChar.name, content: trimmed };
              }
            }
          } else if (streamMode === "full" && hasDelimiter) {
            // Full mode with delimiter: emit deltas within each line
            let delimMatch: { index: number; length: number };
            while ((delimMatch = findFirstDelimiter(buffer, delimiter)).index !== -1) {
              const chunk = buffer.slice(0, delimMatch.index);
              const matchedDelim = buffer.slice(delimMatch.index, delimMatch.index + delimMatch.length);
              buffer = buffer.slice(delimMatch.index + delimMatch.length);
              currentChar.content += chunk + matchedDelim;

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

// =============================================================================
// Multi-Entity Streaming (Name Prefix)
// =============================================================================

/**
 * Stream events for multiple entities using "Name:" prefix format.
 * Detects "Name:" at start of text or after newline to switch between entities.
 * Falls back to XML-based streaming if no Name: prefixes are detected.
 *
 * Modes:
 * - "lines": new message per delimiter, sent when complete (emits "char_line" events)
 * - "full" without delimiter: single message per entity, edited progressively (emits "char_delta" events)
 * - "full" with delimiter: new message per delimiter, each edited progressively
 *   (emits "char_line_start", "char_line_delta", "char_line_end" events)
 */
async function* streamMultiEntityNamePrefix(
  textStream: AsyncIterable<string>,
  entities: EvaluatedEntity[],
  streamMode: "lines" | "full",
  delimiter: string[] | undefined
): AsyncGenerator<StreamEvent, void, unknown> {
  let buffer = "";
  let currentChar: { name: string; entityId: number; avatarUrl?: string; content: string; lineContent: string; lineStarted: boolean } | null = null;
  let detectedFormat: "name_prefix" | "xml" | null = null;

  const hasDelimiter = delimiter !== undefined;

  // Build entity lookup map (case-insensitive)
  const entityMap = new Map<string, EvaluatedEntity>();
  for (const entity of entities) {
    entityMap.set(entity.name.toLowerCase(), entity);
  }

  // Build regex for "Name:" at line start (case-insensitive, handles bold/italic)
  const names = entities.map(e => e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const namePrefixPattern = new RegExp(`^${namePrefixSource(`(${names.join("|")})`)}\\s*`, "im");
  // Also build XML tag pattern for fallback detection
  const xmlOpenPattern = new RegExp(`<(${names.join("|")})>`, "i");

  /** Emit content for current character based on stream mode */
  function* emitCharContent(
    char: NonNullable<typeof currentChar>,
    content: string,
    isDelta: boolean
  ): Generator<StreamEvent> {
    if (!content) return;
    char.content += content;

    if (streamMode === "lines") {
      const effectiveDelims = delimiter ?? ["\n"];
      let remaining = char.lineContent + content;
      char.lineContent = "";
      let delimMatch: { index: number; length: number };
      while ((delimMatch = findFirstDelimiter(remaining, effectiveDelims)).index !== -1) {
        const chunk = remaining.slice(0, delimMatch.index).trim();
        remaining = remaining.slice(delimMatch.index + delimMatch.length);
        if (chunk) {
          yield { type: "char_line", name: char.name, content: chunk };
        }
      }
      if (isDelta) {
        char.lineContent = remaining;
      } else {
        const trimmed = remaining.trim();
        if (trimmed) {
          yield { type: "char_line", name: char.name, content: trimmed };
        }
      }
    } else if (streamMode === "full" && hasDelimiter) {
      if (isDelta) {
        let remaining = content;
        let delimMatch: { index: number; length: number };
        while ((delimMatch = findFirstDelimiter(remaining, delimiter)).index !== -1) {
          const chunk = remaining.slice(0, delimMatch.index);
          remaining = remaining.slice(delimMatch.index + delimMatch.length);
          char.lineContent += chunk;
          const trimmed = char.lineContent.trim();
          if (trimmed) {
            if (!char.lineStarted) {
              yield { type: "char_line_start", name: char.name };
            }
            yield { type: "char_line_end", name: char.name, content: trimmed };
          }
          char.lineContent = "";
          char.lineStarted = false;
        }
        if (remaining) {
          if (!char.lineStarted) {
            yield { type: "char_line_start", name: char.name };
            char.lineStarted = true;
          }
          char.lineContent += remaining;
          const trimmed = char.lineContent.trim();
          if (trimmed) {
            yield { type: "char_line_delta", name: char.name, delta: remaining, content: trimmed };
          }
        }
      } else {
        // Final flush
        char.lineContent += content;
        const trimmed = char.lineContent.trim();
        if (trimmed) {
          if (!char.lineStarted) {
            yield { type: "char_line_start", name: char.name };
          }
          yield { type: "char_line_end", name: char.name, content: trimmed };
        }
      }
    } else {
      // Full mode without delimiter
      yield { type: "char_delta", name: char.name, delta: content, content: char.content };
    }
  }

  for await (const delta of textStream) {
    buffer += delta;

    // Early format detection: check first meaningful content
    if (detectedFormat === null && buffer.trim().length > 0) {
      if (namePrefixPattern.test(buffer)) {
        detectedFormat = "name_prefix";
      } else if (xmlOpenPattern.test(buffer)) {
        // Fall back to XML streaming
        detectedFormat = "xml";
        // Re-yield using XML-based streaming with remaining buffer + stream
        async function* prependBuffer(buf: string, stream: AsyncIterable<string>): AsyncIterable<string> {
          yield buf;
          yield* stream;
        }
        yield* streamMultiEntity(prependBuffer(buffer, textStream), entities, streamMode, delimiter);
        return;
      }
      // If neither detected yet, keep buffering
      if (detectedFormat === null) continue;
    }

    if (detectedFormat !== "name_prefix") continue;

    // Process buffer for Name: prefixes
    while (buffer.length > 0) {
      const match = buffer.match(namePrefixPattern);
      if (match && match.index !== undefined) {
        // Text before the match belongs to current character
        if (match.index > 0 && currentChar) {
          const beforeText = buffer.slice(0, match.index);
          yield* emitCharContent(currentChar, beforeText, true);
        }

        // End previous character
        if (currentChar) {
          // Flush remaining line content
          if (currentChar.lineContent.trim()) {
            if (streamMode === "lines") {
              yield { type: "char_line", name: currentChar.name, content: currentChar.lineContent.trim() };
            } else if (streamMode === "full" && hasDelimiter && currentChar.lineStarted) {
              yield { type: "char_line_end", name: currentChar.name, content: currentChar.lineContent.trim() };
            }
          }
          yield { type: "char_end", name: currentChar.name, content: currentChar.content.trim() };
        }

        // Start new character
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

        buffer = buffer.slice(match.index + match[0].length);
      } else {
        // No name prefix found in buffer
        if (currentChar) {
          // Check if buffer might contain a partial name prefix at the end
          const hasNewline = buffer.includes("\n");
          if (hasNewline) {
            // Process up to last newline, keep the rest for potential name detection
            const lastNewline = buffer.lastIndexOf("\n");
            const processable = buffer.slice(0, lastNewline + 1);
            buffer = buffer.slice(lastNewline + 1);
            yield* emitCharContent(currentChar, processable, true);
          } else {
            // No newline - buffer might be mid-content, keep it
            // But if it's getting long, emit what we have
            const maxNameLen = Math.max(...entities.map(e => e.name.length)) + 2;
            if (buffer.length > maxNameLen * 2) {
              yield* emitCharContent(currentChar, buffer, true);
              buffer = "";
            }
          }
        }
        break;
      }
    }
  }

  // Flush remaining buffer and close current character
  if (currentChar) {
    if (buffer.trim()) {
      yield* emitCharContent(currentChar, buffer, false);
    }
    if (currentChar.content.trim()) {
      yield { type: "char_end", name: currentChar.name, content: currentChar.content.trim() };
    }
  }
}
