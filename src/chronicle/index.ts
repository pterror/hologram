import { getDb } from "../db";
import { VectorDatabase } from "../db/vector";
import { embed } from "../ai/embeddings";

// Chronicle entry types
export type ChronicleType =
  | "event"      // Something happened (arrived, found, fought)
  | "fact"       // Learned information (lore, character details)
  | "dialogue"   // Important conversation (promises, revelations)
  | "thought"    // Character's internal state (feelings, plans)
  | "note"       // Meta/OOC notes (user annotations)
  | "summary";   // Consolidated summary of multiple entries

// Visibility levels
export type Visibility =
  | "public"     // All characters know (world events, public actions)
  | "character"  // Only specific character knows (thoughts, private observations)
  | "secret";    // Only narrator/GM knows (hidden plot points)

// Source of the entry
export type EntrySource =
  | "auto"       // LLM auto-extracted
  | "explicit"   // User marked with ```memory or similar
  | "summary"    // Generated summary
  | "user";      // Manually added via command

export interface ChronicleEntry {
  id: number;
  sceneId: number | null;
  worldId: number;
  type: ChronicleType;
  content: string;
  importance: number;         // 1-10
  perspective: string;        // character_id, "narrator", or "shared"
  visibility: Visibility;
  source: EntrySource;
  sourceMessageId: string | null;
  createdAt: number;
}

export interface CreateEntryOptions {
  sceneId?: number;
  worldId: number;
  type: ChronicleType;
  content: string;
  importance?: number;
  perspective?: string;       // Default: "shared"
  visibility?: Visibility;    // Default: "public"
  source?: EntrySource;       // Default: "auto"
  sourceMessageId?: string;
}

// Vector database for chronicle semantic search
let vectorDb: VectorDatabase | null = null;

const CHRONICLE_EMBEDDINGS_TABLE = "chronicle_embeddings";

function getVectorDb(): VectorDatabase {
  if (!vectorDb) {
    vectorDb = new VectorDatabase(getDb());
  }
  return vectorDb;
}

/** Create a new chronicle entry */
export function createEntry(options: CreateEntryOptions): ChronicleEntry {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO chronicle (scene_id, world_id, type, content, importance, perspective, visibility, source, source_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id, scene_id, world_id, type, content, importance, perspective, visibility, source, source_message_id, created_at
  `);

  const row = stmt.get(
    options.sceneId ?? null,
    options.worldId,
    options.type,
    options.content,
    options.importance ?? 5,
    options.perspective ?? "shared",
    options.visibility ?? "public",
    options.source ?? "auto",
    options.sourceMessageId ?? null
  ) as {
    id: number;
    scene_id: number | null;
    world_id: number;
    type: string;
    content: string;
    importance: number;
    perspective: string;
    visibility: string;
    source: string;
    source_message_id: string | null;
    created_at: number;
  };

  return {
    id: row.id,
    sceneId: row.scene_id,
    worldId: row.world_id,
    type: row.type as ChronicleType,
    content: row.content,
    importance: row.importance,
    perspective: row.perspective,
    visibility: row.visibility as Visibility,
    source: row.source as EntrySource,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
  };
}

/** Create entry and add embedding for RAG */
export async function createEntryWithEmbedding(
  options: CreateEntryOptions
): Promise<ChronicleEntry> {
  const entry = createEntry(options);

  // Add embedding for semantic search
  try {
    const embedding = await embed(entry.content);
    const vdb = getVectorDb();
    vdb.insert(CHRONICLE_EMBEDDINGS_TABLE, entry.id, embedding);
  } catch (error) {
    console.error("Failed to create embedding for chronicle entry:", error);
  }

  return entry;
}

/** Get a chronicle entry by ID */
export function getEntry(id: number): ChronicleEntry | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, scene_id, world_id, type, content, importance, perspective, visibility, source, source_message_id, created_at
    FROM chronicle WHERE id = ?
  `);

  const row = stmt.get(id) as {
    id: number;
    scene_id: number | null;
    world_id: number;
    type: string;
    content: string;
    importance: number;
    perspective: string;
    visibility: string;
    source: string;
    source_message_id: string | null;
    created_at: number;
  } | null;

  if (!row) return null;

  return {
    id: row.id,
    sceneId: row.scene_id,
    worldId: row.world_id,
    type: row.type as ChronicleType,
    content: row.content,
    importance: row.importance,
    perspective: row.perspective,
    visibility: row.visibility as Visibility,
    source: row.source as EntrySource,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
  };
}

/** Delete a chronicle entry */
export function deleteEntry(id: number): boolean {
  const db = getDb();

  // Remove from vector db
  try {
    const vdb = getVectorDb();
    vdb.delete(CHRONICLE_EMBEDDINGS_TABLE, id);
  } catch {
    // Ignore vector db errors
  }

  const stmt = db.prepare("DELETE FROM chronicle WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

/** Query options for perspective-aware retrieval */
export interface QueryOptions {
  worldId: number;
  sceneId?: number;
  // Perspective filtering
  characterIds?: number[];     // Character entity IDs whose perspective to include
  additionalPerspectives?: string[]; // Extra perspective strings (e.g., Discord user ID)
  includeNarrator?: boolean;   // Include narrator entries
  includeShared?: boolean;     // Include shared entries (default true)
  // Type filtering
  types?: ChronicleType[];
  // Visibility filtering (for narrator mode, can see all)
  narratorMode?: boolean;      // If true, ignores visibility filters
  // Limits
  limit?: number;
  minImportance?: number;
}

/** Get entries matching query options (non-semantic) */
export function queryEntries(options: QueryOptions): ChronicleEntry[] {
  const db = getDb();

  let query = `
    SELECT id, scene_id, world_id, type, content, importance, perspective, visibility, source, source_message_id, created_at
    FROM chronicle
    WHERE world_id = ?
  `;
  const params: (number | string)[] = [options.worldId];

  // Scene filter
  if (options.sceneId !== undefined) {
    query += " AND scene_id = ?";
    params.push(options.sceneId);
  }

  // Importance filter
  if (options.minImportance !== undefined) {
    query += " AND importance >= ?";
    params.push(options.minImportance);
  }

  // Type filter
  if (options.types && options.types.length > 0) {
    const placeholders = options.types.map(() => "?").join(", ");
    query += ` AND type IN (${placeholders})`;
    params.push(...options.types);
  }

  // Perspective and visibility filtering
  if (!options.narratorMode) {
    // Collect all perspective IDs (character entity IDs + additional strings like Discord user IDs)
    const allPerspectives: string[] = [
      ...(options.characterIds?.map(String) ?? []),
      ...(options.additionalPerspectives ?? []),
    ];

    // Build perspective conditions
    const perspectiveConds: string[] = [];

    if (options.includeShared !== false) {
      perspectiveConds.push("perspective = 'shared'");
    }

    if (options.includeNarrator) {
      perspectiveConds.push("perspective = 'narrator'");
    }

    if (allPerspectives.length > 0) {
      const placeholders = allPerspectives.map(() => "?").join(", ");
      perspectiveConds.push(`perspective IN (${placeholders})`);
      params.push(...allPerspectives);
    }

    if (perspectiveConds.length > 0) {
      query += ` AND (${perspectiveConds.join(" OR ")})`;
    }

    // Visibility filtering
    // Public entries are always visible
    // Character entries only visible if perspective matches
    // Secret entries only visible in narrator mode
    query += " AND (visibility = 'public'";

    if (allPerspectives.length > 0) {
      const placeholders = allPerspectives.map(() => "?").join(", ");
      query += ` OR (visibility = 'character' AND perspective IN (${placeholders}))`;
      params.push(...allPerspectives);
    }

    query += ")";
  }

  // Order and limit
  query += " ORDER BY importance DESC, created_at DESC";

  if (options.limit) {
    query += " LIMIT ?";
    params.push(options.limit);
  }

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as Array<{
    id: number;
    scene_id: number | null;
    world_id: number;
    type: string;
    content: string;
    importance: number;
    perspective: string;
    visibility: string;
    source: string;
    source_message_id: string | null;
    created_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    sceneId: row.scene_id,
    worldId: row.world_id,
    type: row.type as ChronicleType,
    content: row.content,
    importance: row.importance,
    perspective: row.perspective,
    visibility: row.visibility as Visibility,
    source: row.source as EntrySource,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
  }));
}

/** Semantic search options */
export interface SearchOptions extends QueryOptions {
  query: string;
  topK?: number;
}

/** Search chronicle entries semantically */
export async function searchEntries(
  options: SearchOptions
): Promise<ChronicleEntry[]> {
  // Get embedding for query
  const queryEmbedding = await embed(options.query);

  const vdb = getVectorDb();

  // Get semantic matches
  const topK = options.topK ?? options.limit ?? 10;
  const matches = vdb.search(CHRONICLE_EMBEDDINGS_TABLE, queryEmbedding, topK * 2); // Get extra for filtering

  if (matches.length === 0) {
    return [];
  }

  // Get full entries for matches
  const matchedIds = matches.map((m: { rowid: number }) => m.rowid);
  const entries = matchedIds
    .map((id: number) => getEntry(id))
    .filter((e: ChronicleEntry | null): e is ChronicleEntry => e !== null);

  // Apply perspective and visibility filtering
  const filtered = entries.filter((entry) => {
    // World filter
    if (entry.worldId !== options.worldId) return false;

    // Scene filter
    if (options.sceneId !== undefined && entry.sceneId !== options.sceneId) {
      return false;
    }

    // Type filter
    if (options.types && !options.types.includes(entry.type)) {
      return false;
    }

    // Importance filter
    if (options.minImportance !== undefined && entry.importance < options.minImportance) {
      return false;
    }

    // Narrator mode sees everything
    if (options.narratorMode) return true;

    // Collect all perspective strings
    const allPerspectives = [
      ...(options.characterIds?.map(String) ?? []),
      ...(options.additionalPerspectives ?? []),
    ];

    // Perspective check
    const validPerspective =
      entry.perspective === "shared" ||
      (options.includeNarrator && entry.perspective === "narrator") ||
      allPerspectives.includes(entry.perspective);

    if (!validPerspective && entry.perspective !== "shared") {
      return false;
    }

    // Visibility check
    if (entry.visibility === "secret") return false;
    if (entry.visibility === "character") {
      if (!allPerspectives.includes(entry.perspective)) {
        return false;
      }
    }

    return true;
  });

  // Return limited results
  return filtered.slice(0, options.limit ?? 10);
}

/** Get recent entries for a scene */
export function getRecentEntries(
  worldId: number,
  sceneId?: number,
  limit: number = 20
): ChronicleEntry[] {
  return queryEntries({
    worldId,
    sceneId,
    narratorMode: true, // Get all for summarization
    limit,
  });
}

/** Format entries for context */
export function formatEntriesForContext(
  entries: ChronicleEntry[],
  options?: { includeType?: boolean; includeImportance?: boolean }
): string {
  if (entries.length === 0) return "";

  const lines = ["## Memory"];

  for (const entry of entries) {
    let line = `- ${entry.content}`;

    if (options?.includeType) {
      line = `- [${entry.type}] ${entry.content}`;
    }

    if (options?.includeImportance) {
      line += ` (${entry.importance}/10)`;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

/** Parse explicit memory markers from text */
export function parseExplicitMemories(text: string): Array<{
  content: string;
  type?: ChronicleType;
  importance?: number;
}> {
  const memories: Array<{
    content: string;
    type?: ChronicleType;
    importance?: number;
  }> = [];

  // Match ```memory blocks
  const memoryBlockRegex = /```memory\n([\s\S]*?)```/g;
  let match;
  while ((match = memoryBlockRegex.exec(text)) !== null) {
    memories.push({ content: match[1].trim(), type: "note" });
  }

  // Match [[remember: ...]] markers
  const rememberRegex = /\[\[remember:\s*(.*?)\]\]/gi;
  while ((match = rememberRegex.exec(text)) !== null) {
    memories.push({ content: match[1].trim() });
  }

  // Match [[fact: ...]] markers
  const factRegex = /\[\[fact:\s*(.*?)\]\]/gi;
  while ((match = factRegex.exec(text)) !== null) {
    memories.push({ content: match[1].trim(), type: "fact" });
  }

  return memories;
}

/** Type labels for display */
export const typeLabels: Record<ChronicleType, string> = {
  event: "Event",
  fact: "Fact",
  dialogue: "Dialogue",
  thought: "Thought",
  note: "Note",
  summary: "Summary",
};

/** Visibility labels for display */
export const visibilityLabels: Record<Visibility, string> = {
  public: "Public",
  character: "Private",
  secret: "Secret",
};
