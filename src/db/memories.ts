/**
 * Entity Memories - LLM-curated long-term memory with frecency-based retrieval.
 *
 * Memories are saved by LLMs for important events worth recalling.
 * Retrieved via frecency pre-filter + vector similarity search.
 */

import { getDb } from "./index";
import { embed, cosineSimilarity } from "../ai/embeddings";

// =============================================================================
// Types
// =============================================================================

export interface Memory {
  id: number;
  entity_id: number;
  content: string;
  source_message_id: string | null;
  source_channel_id: string | null;
  source_guild_id: string | null;
  frecency: number;
  created_at: string;
  updated_at: string;
}

export type MemoryScope = "none" | "channel" | "guild" | "global";

/** Minimum cosine similarity for a memory to be included in retrieval results */
const MIN_SIMILARITY_THRESHOLD = 0.1;

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Add a memory for an entity.
 * Automatically generates and stores the embedding.
 */
export async function addMemory(
  entityId: number,
  content: string,
  sourceMessageId?: string,
  sourceChannelId?: string,
  sourceGuildId?: string
): Promise<Memory> {
  const db = getDb();

  const memory = db.prepare(`
    INSERT INTO entity_memories (entity_id, content, source_message_id, source_channel_id, source_guild_id)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    entityId,
    content,
    sourceMessageId ?? null,
    sourceChannelId ?? null,
    sourceGuildId ?? null
  ) as Memory;

  // Generate and store embedding
  const embedding = await embed(content);
  await storeMemoryEmbedding(memory.id, embedding);

  return memory;
}

/**
 * Get a memory by ID.
 */
export function getMemory(id: number): Memory | null {
  const db = getDb();
  return db.prepare(`SELECT * FROM entity_memories WHERE id = ?`).get(id) as Memory | null;
}

/**
 * Get all memories for an entity.
 */
export function getMemoriesForEntity(entityId: number): Memory[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM entity_memories
    WHERE entity_id = ?
    ORDER BY frecency DESC, created_at DESC
  `).all(entityId) as Memory[];
}

/**
 * Update a memory by ID.
 * Regenerates the embedding.
 */
export async function updateMemory(id: number, content: string): Promise<Memory | null> {
  const db = getDb();
  const memory = db.prepare(`
    UPDATE entity_memories
    SET content = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    RETURNING *
  `).get(content, id) as Memory | null;

  if (memory) {
    const embedding = await embed(content);
    await storeMemoryEmbedding(memory.id, embedding);
  }

  return memory;
}

/**
 * Update a memory by content match (like facts).
 * Regenerates the embedding.
 */
export async function updateMemoryByContent(
  entityId: number,
  oldContent: string,
  newContent: string
): Promise<Memory | null> {
  const db = getDb();
  const memory = db.prepare(`
    UPDATE entity_memories
    SET content = ?, updated_at = CURRENT_TIMESTAMP
    WHERE entity_id = ? AND content = ?
    RETURNING *
  `).get(newContent, entityId, oldContent) as Memory | null;

  if (memory) {
    const embedding = await embed(newContent);
    await storeMemoryEmbedding(memory.id, embedding);
  }

  return memory;
}

/**
 * Remove a memory by ID.
 */
export function removeMemory(id: number): boolean {
  const db = getDb();
  // Remove embedding first
  db.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(id);
  const result = db.prepare(`DELETE FROM entity_memories WHERE id = ?`).run(id);
  return result.changes > 0;
}

/**
 * Remove a memory by content match.
 */
export function removeMemoryByContent(entityId: number, content: string): boolean {
  const db = getDb();
  // Get the memory ID first for embedding cleanup
  const memory = db.prepare(`
    SELECT id FROM entity_memories WHERE entity_id = ? AND content = ?
  `).get(entityId, content) as { id: number } | null;

  if (!memory) return false;

  db.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(memory.id);
  const result = db.prepare(`DELETE FROM entity_memories WHERE id = ?`).run(memory.id);
  return result.changes > 0;
}

/**
 * Set all memories for an entity (clear and replace).
 * Used by /edit command.
 */
export async function setMemories(entityId: number, contents: string[]): Promise<Memory[]> {
  const db = getDb();

  // Get existing memory IDs for embedding cleanup
  const existingIds = db.prepare(`
    SELECT id FROM entity_memories WHERE entity_id = ?
  `).all(entityId) as { id: number }[];

  // Clear existing embeddings and memories
  for (const { id } of existingIds) {
    db.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(id);
  }
  db.prepare(`DELETE FROM entity_memories WHERE entity_id = ?`).run(entityId);

  // Add new memories
  const memories: Memory[] = [];
  for (const content of contents) {
    const memory = db.prepare(`
      INSERT INTO entity_memories (entity_id, content)
      VALUES (?, ?)
      RETURNING *
    `).get(entityId, content) as Memory;

    const embedding = await embed(content);
    await storeMemoryEmbedding(memory.id, embedding);
    memories.push(memory);
  }

  return memories;
}

// =============================================================================
// Scope-Based Retrieval
// =============================================================================

/**
 * Get memories for an entity filtered by scope.
 */
export function getMemoriesForScope(
  entityId: number,
  scope: MemoryScope,
  channelId?: string,
  guildId?: string
): Memory[] {
  if (scope === "none") return [];

  const db = getDb();

  if (scope === "global") {
    return db.prepare(`
      SELECT * FROM entity_memories
      WHERE entity_id = ?
      ORDER BY frecency DESC
    `).all(entityId) as Memory[];
  }

  if (scope === "guild" && guildId) {
    return db.prepare(`
      SELECT * FROM entity_memories
      WHERE entity_id = ? AND source_guild_id = ?
      ORDER BY frecency DESC
    `).all(entityId, guildId) as Memory[];
  }

  if (scope === "channel" && channelId) {
    return db.prepare(`
      SELECT * FROM entity_memories
      WHERE entity_id = ? AND source_channel_id = ?
      ORDER BY frecency DESC
    `).all(entityId, channelId) as Memory[];
  }

  // Fallback: return empty if scope params missing
  return [];
}

// =============================================================================
// Frecency Operations
// =============================================================================

/**
 * Boost frecency for a memory (called when retrieved/accessed).
 * Uses formula: frecency = frecency * decay + boost
 */
export function boostMemoryFrecency(memoryId: number, boost: number = 0.1): void {
  const db = getDb();
  db.prepare(`
    UPDATE entity_memories
    SET frecency = frecency * 0.95 + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(boost, memoryId);
}

/**
 * Decay all frecency scores (run periodically).
 */
export function decayAllFrecency(decayFactor: number = 0.99): void {
  const db = getDb();
  db.prepare(`
    UPDATE entity_memories
    SET frecency = frecency * ?
  `).run(decayFactor);
}

/**
 * Cleanup memories with very low frecency.
 */
export function cleanupLowFrecencyMemories(threshold: number = 0.01): number {
  const db = getDb();

  // Get IDs of memories to delete
  const toDelete = db.prepare(`
    SELECT id FROM entity_memories WHERE frecency < ?
  `).all(threshold) as { id: number }[];

  // Delete embeddings and memories
  for (const { id } of toDelete) {
    db.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(id);
  }

  const result = db.prepare(`DELETE FROM entity_memories WHERE frecency < ?`).run(threshold);
  return result.changes;
}

// =============================================================================
// Embedding Operations
// =============================================================================

/**
 * Store embedding for a memory.
 */
export async function storeMemoryEmbedding(memoryId: number, embedding: Float32Array): Promise<void> {
  const db = getDb();

  // Delete existing embedding if any
  db.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(memoryId);

  // Insert new embedding
  // vec0 expects the embedding as a blob
  db.prepare(`
    INSERT INTO memory_embeddings (memory_id, embedding)
    VALUES (?, ?)
  `).run(memoryId, embedding);
}

/**
 * Get embedding for a memory.
 */
export function getMemoryEmbedding(memoryId: number): Float32Array | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT embedding FROM memory_embeddings WHERE memory_id = ?
  `).get(memoryId) as { embedding: Uint8Array | Float32Array } | null;

  if (!row?.embedding) return null;
  // sqlite-vec returns Uint8Array blobs — convert to Float32Array
  if (row.embedding instanceof Float32Array) return row.embedding;
  return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
}

// =============================================================================
// Semantic Search
// =============================================================================

/**
 * Search memories by semantic similarity.
 * Pre-filters by scope and frecency, then ranks by embedding similarity.
 */
export async function searchMemoriesBySimilarity(
  entityId: number,
  queryText: string,
  scope: MemoryScope,
  channelId?: string,
  guildId?: string,
  limit: number = 20,
  candidateLimit: number = 20
): Promise<Array<{ memory: Memory; similarity: number }>> {
  if (scope === "none") return [];

  // 1. Pre-filter by scope, take top candidates by frecency
  const candidates = getMemoriesForScope(entityId, scope, channelId, guildId)
    .slice(0, candidateLimit);

  if (candidates.length === 0) return [];

  // 2. Generate query embedding
  const queryEmbedding = await embed(queryText);

  // 3. Score each candidate by similarity
  const scored: Array<{ memory: Memory; similarity: number }> = [];

  for (const memory of candidates) {
    const memoryEmbedding = getMemoryEmbedding(memory.id);
    if (!memoryEmbedding) continue;

    const similarity = cosineSimilarity(queryEmbedding, memoryEmbedding);
    scored.push({ memory, similarity });
  }

  // 4. Sort by similarity, filter below threshold, return top results
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.filter(s => s.similarity >= MIN_SIMILARITY_THRESHOLD).slice(0, limit);
}

/**
 * Retrieve relevant memories and boost their frecency.
 * Main entry point for memory retrieval in the message pipeline.
 */
export async function retrieveRelevantMemories(
  entityId: number,
  conversationContext: string,
  scope: MemoryScope,
  channelId?: string,
  guildId?: string,
  limit: number = 20
): Promise<Memory[]> {
  const results = await searchMemoriesBySimilarity(
    entityId,
    conversationContext,
    scope,
    channelId,
    guildId,
    limit
  );

  // Boost frecency for retrieved memories
  for (const { memory } of results) {
    boostMemoryFrecency(memory.id);
  }

  return results.map(r => r.memory);
}

// =============================================================================
// Context Formatting
// =============================================================================

/**
 * Format memories for inclusion in LLM context.
 */
export function formatMemoriesForContext(entityName: string, entityId: number, memories: Memory[]): string {
  if (memories.length === 0) return "";

  const memoryLines = memories.map(m => m.content).join("\n");
  return `<memories entity="${entityName}" id="${entityId}">\n${memoryLines}\n</memories>`;
}
