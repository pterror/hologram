import type { EntityWithFacts } from "../db/entities";

// =============================================================================
// Types
// =============================================================================

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
  /** Custom delimiters for streaming (default: newline) */
  streamDelimiter: string[] | null;
  /** Memory retrieval scope from $memory directive (default: "none") */
  memoryScope: "none" | "channel" | "guild" | "global";
  /** Context character limit from $context directive, if present */
  contextLimit: number | null;
  /** Freeform multi-char responses (no XML parsing) from $freeform directive */
  isFreeform: boolean;
  /** Model spec from $model directive (e.g. "google:gemini-2.0-flash") */
  modelSpec: string | null;
  /** Strip patterns from $strip directive. null = no directive (use default), [] = explicit no-strip */
  stripPatterns: string[] | null;
}

// =============================================================================
// Constants
// =============================================================================

/** Apply strip patterns to text, removing all occurrences of each pattern */
export function applyStripPatterns(text: string, patterns: string[]): string {
  let result = text;
  for (const pattern of patterns) {
    result = result.replaceAll(pattern, "");
  }
  return result;
}

/** Default maximum characters of message history to include in context */
export const DEFAULT_CONTEXT_LIMIT = 16_000;

/** Hard cap on context size (~250k tokens) */
export const MAX_CONTEXT_CHAR_LIMIT = 1_000_000;

// =============================================================================
// Formatting
// =============================================================================

/** Format entity name and ID for LLM context */
export function formatEntityDisplay(name: string, id: number): string {
  return `${name} [${id}]`;
}

/** Format an evaluated entity for LLM context */
export function formatEvaluatedEntity(entity: EvaluatedEntity): string {
  const factLines = entity.facts.join("\n");
  return `<defs for="${entity.name}" id="${entity.id}">\n${factLines}\n</defs>`;
}

/** Format a raw entity for LLM context (used for locations, etc.) */
export function formatRawEntity(entity: EntityWithFacts): string {
  const factLines = entity.facts.map(f => f.content).join("\n");
  return `<defs for="${entity.name}" id="${entity.id}">\n${factLines}\n</defs>`;
}

/**
 * Build message history up to a character limit.
 * Messages should be in DESC order (newest first) from the database.
 * Returns formatted string in chronological order (oldest first).
 */
export function buildMessageHistory(
  messages: Array<{ author_name: string; content: string }>,
  charLimit = DEFAULT_CONTEXT_LIMIT
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
