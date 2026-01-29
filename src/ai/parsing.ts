import type { EvaluatedEntity } from "./context";

// =============================================================================
// Types
// =============================================================================

export interface EntityResponse {
  entityId: number;
  name: string;
  content: string;
  avatarUrl?: string;
  streamMode?: "lines" | "full" | null;
  streamDelimiter?: string[] | null;
}

// =============================================================================
// Name Prefix Stripping
// =============================================================================

/**
 * Build regex source for matching an entity name prefix with optional bold/italic
 * markdown wrapping and colon. Handles: Name:, *Name:*, *Name*:, **Name:**, **Name**:
 * @param escapedName regex-escaped entity name (may include capture groups)
 */
export function namePrefixSource(escapedName: string): string {
  return `\\*{0,2}${escapedName}(?::\\*{0,2}|\\*{1,2}:)`;
}

/**
 * Strip "Name:" prefix from single-entity responses at every line start.
 * Handles optional bold/italic markdown wrapping around the name.
 * Case-insensitive, multiline (handles multiple lines like "Alice: hi\nAlice: bye").
 */
export function stripNamePrefix(text: string, entityName: string): string {
  const escaped = entityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${namePrefixSource(escaped)}\\s*`, "gim");
  return text.replace(pattern, "");
}

/** Sentinel character used to mark Name: boundaries in the stream */
export const NAME_BOUNDARY = "\0";

/**
 * Wraps a text stream to strip "Name:" prefixes at every line start.
 * Buffers at line boundaries to detect and remove prefixes before yielding.
 *
 * When boundaryChar is set, inserts it at Name: boundaries (replacing the
 * preceding newline). This allows downstream code to split on the boundary
 * character to create separate messages for each Name: segment.
 */
export async function* stripNamePrefixFromStream(
  textStream: AsyncIterable<string>,
  entityName: string,
  boundaryChar: string | null = null
): AsyncGenerator<string, void, unknown> {
  let buffer = "";
  let atLineStart = true;
  let skipSpaces = false;
  let isFirst = true;
  let pendingNewline = false;
  const escaped = entityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixRegex = new RegExp(`^${namePrefixSource(escaped)}`, "i");
  const maxPrefixLen = entityName.length + 5; // longest: **Name:**

  for await (const delta of textStream) {
    buffer += delta;
    let output = "";

    while (buffer.length > 0) {
      // After stripping a prefix, skip whitespace before content
      if (skipSpaces) {
        let i = 0;
        while (i < buffer.length && buffer[i] === " ") i++;
        if (i === buffer.length) { buffer = ""; break; }
        buffer = buffer.slice(i);
        skipSpaces = false;
      }

      if (atLineStart) {
        const prefixMatch = buffer.match(prefixRegex);
        if (prefixMatch) {
          // Name: boundary detected (possibly with bold/italic markers)
          if (isFirst) {
            isFirst = false;
            pendingNewline = false;
          } else if (boundaryChar) {
            // Insert boundary marker instead of the pending newline
            output += boundaryChar;
            pendingNewline = false;
          } else if (pendingNewline) {
            // No boundary marker, just output the newline normally
            output += "\n";
            pendingNewline = false;
          }
          buffer = buffer.slice(prefixMatch[0].length);
          atLineStart = false;
          skipSpaces = true;
          continue;
        }
        // Not enough data to rule out a prefix
        if (buffer.length < maxPrefixLen) break;
        // Not a Name: prefix — output pending newline
        if (pendingNewline) {
          output += "\n";
          pendingNewline = false;
        }
        isFirst = false;
        atLineStart = false;
      }

      // Output content up to next newline, holding newline for boundary check
      const nlIdx = buffer.indexOf("\n");
      if (nlIdx !== -1) {
        output += buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        if (boundaryChar) {
          // Hold the newline to check if next line starts with Name:
          pendingNewline = true;
        } else {
          // No boundary tracking, output newline immediately
          output += "\n";
        }
        atLineStart = true;
      } else {
        output += buffer;
        buffer = "";
      }
    }

    if (output) yield output;
  }

  // Flush remaining
  if (pendingNewline) {
    let out = "\n";
    if (buffer) out += buffer;
    yield out;
  } else if (buffer) {
    yield buffer;
  }
}

// =============================================================================
// Multi-Entity Response Parsing
// =============================================================================

/**
 * Parse LLM response into per-entity segments using XML tags.
 * Format: <Name>content</Name>
 * Returns undefined if no valid tags found.
 */
export function parseMultiEntityResponse(
  response: string,
  entities: EvaluatedEntity[]
): EntityResponse[] | undefined {
  if (entities.length <= 1) return undefined;

  type ParsedResponse = EntityResponse & { position: number };
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
          content: stripNamePrefix(content, entity.name),
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

/**
 * Parse LLM response into per-entity segments using "Name:" prefix format.
 * Each entity's content starts with "Name:" at the beginning of a line.
 * Returns undefined if no valid name prefixes found.
 */
export function parseNamePrefixResponse(
  response: string,
  entities: EvaluatedEntity[]
): EntityResponse[] | undefined {
  if (entities.length <= 1) return undefined;

  // Build regex matching any entity name at line start (with optional bold/italic)
  const names = entities.map(e => e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`^${namePrefixSource(`(${names.join("|")})`)}\\s*`, "gim");

  // Find all name prefix positions (both match start and content start)
  const matches: Array<{ name: string; matchIndex: number; contentStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(response)) !== null) {
    matches.push({ name: match[1], matchIndex: match.index, contentStart: match.index + match[0].length });
  }

  if (matches.length === 0) return undefined;

  // Extract content between consecutive name prefixes
  const results: EntityResponse[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].contentStart;
    const end = i + 1 < matches.length ? matches[i + 1].matchIndex : response.length;
    const content = response.slice(start, end).trim();
    if (!content) continue;

    // Find matching entity (case-insensitive)
    const entity = entities.find(e => e.name.toLowerCase() === matches[i].name.toLowerCase());
    if (entity) {
      results.push({
        entityId: entity.id,
        name: entity.name,
        content,
        avatarUrl: entity.avatarUrl ?? undefined,
        streamMode: entity.streamMode,
      });
    }
  }

  return results.length > 0 ? results : undefined;
}
