/**
 * Debug functions for RAG/embedding inspection.
 *
 * Pure functions returning structured data — no Discord dependencies.
 */

import {
  isEmbeddingModelLoaded,
  MODEL_NAME,
  EMBEDDING_DIMENSIONS,
  getEmbeddingCacheStats,
  embed,
  cosineSimilarity,
} from "../ai/embeddings";
import { getDb } from "../db/index";
import { getFactsForEntity } from "../db/entities";
import { getMemoriesForEntity, searchMemoriesBySimilarity } from "../db/memories";

// =============================================================================
// Types
// =============================================================================

export interface EmbeddingStatus {
  loaded: boolean;
  modelName: string;
  dimensions: number;
  cache: { size: number; max: number; ttl: number };
}

export interface EmbedTestResult {
  dimensions: number;
  elapsedMs: number;
}

export interface SimilarityTestResult {
  similarity: number;
  elapsedMs: number;
}

export interface EmbeddingCoverage {
  entityId: number;
  facts: { total: number; withEmbedding: number; missingIds: number[] };
  memories: { total: number; withEmbedding: number; missingIds: number[] };
}

export interface RagResult {
  content: string;
  similarity: number;
  type: "memory" | "fact";
  id: number;
}

// =============================================================================
// Functions
// =============================================================================

export function getEmbeddingStatus(): EmbeddingStatus {
  const cache = getEmbeddingCacheStats();
  return {
    loaded: isEmbeddingModelLoaded(),
    modelName: MODEL_NAME,
    dimensions: EMBEDDING_DIMENSIONS,
    cache: { size: cache.size, max: cache.maxSize, ttl: cache.ttlMs },
  };
}

export async function testEmbed(text: string): Promise<EmbedTestResult> {
  const start = performance.now();
  const result = await embed(text);
  const elapsedMs = Math.round(performance.now() - start);
  return { dimensions: result.length, elapsedMs };
}

export async function testSimilarity(a: string, b: string): Promise<SimilarityTestResult> {
  const start = performance.now();
  const [embA, embB] = await Promise.all([embed(a), embed(b)]);
  const similarity = cosineSimilarity(embA, embB);
  const elapsedMs = Math.round(performance.now() - start);
  return { similarity, elapsedMs };
}

export function getEmbeddingCoverage(entityId: number): EmbeddingCoverage {
  const db = getDb();

  // Facts
  const facts = getFactsForEntity(entityId);
  const factIds = facts.map(f => f.id);
  const factEmbeddings = factIds.length > 0
    ? (db.prepare(
        `SELECT fact_id FROM fact_embeddings WHERE fact_id IN (${factIds.map(() => "?").join(",")})`
      ).all(...factIds) as { fact_id: number }[]).map(r => r.fact_id)
    : [];
  const factEmbeddingSet = new Set(factEmbeddings);
  const missingFactIds = factIds.filter(id => !factEmbeddingSet.has(id));

  // Memories
  const memories = getMemoriesForEntity(entityId);
  const memoryIds = memories.map(m => m.id);
  const memoryEmbeddings = memoryIds.length > 0
    ? (db.prepare(
        `SELECT memory_id FROM memory_embeddings WHERE memory_id IN (${memoryIds.map(() => "?").join(",")})`
      ).all(...memoryIds) as { memory_id: number }[]).map(r => r.memory_id)
    : [];
  const memoryEmbeddingSet = new Set(memoryEmbeddings);
  const missingMemoryIds = memoryIds.filter(id => !memoryEmbeddingSet.has(id));

  return {
    entityId,
    facts: { total: facts.length, withEmbedding: factEmbeddings.length, missingIds: missingFactIds },
    memories: { total: memories.length, withEmbedding: memoryEmbeddings.length, missingIds: missingMemoryIds },
  };
}

export async function testRagRetrieval(
  entityId: number,
  query: string,
  scope: "channel" | "guild" | "global" = "global",
  channelId?: string,
  guildId?: string,
): Promise<RagResult[]> {
  const results: RagResult[] = [];

  // Memory search via existing pipeline (wrap single query in array)
  const memoryResults = await searchMemoriesBySimilarity(
    entityId, [query], scope, channelId, guildId,
  );
  for (const { memory, similarity } of memoryResults) {
    results.push({ content: memory.content, similarity, type: "memory", id: memory.id });
  }

  // Fact search (not yet in main pipeline — query fact_embeddings directly)
  const db = getDb();
  const facts = getFactsForEntity(entityId);
  const factIds = facts.map(f => f.id);
  if (factIds.length > 0) {
    const queryEmbedding = await embed(query);
    const placeholders = factIds.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT fact_id, embedding FROM fact_embeddings WHERE fact_id IN (${placeholders})`
    ).all(...factIds) as { fact_id: number; embedding: Uint8Array | Float32Array }[];

    const factMap = new Map(facts.map(f => [f.id, f.content]));
    for (const row of rows) {
      // sqlite-vec returns Uint8Array blobs — convert to Float32Array
      const emb = row.embedding instanceof Float32Array
        ? row.embedding
        : new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const similarity = cosineSimilarity(queryEmbedding, emb);
      results.push({
        content: factMap.get(row.fact_id) ?? "",
        similarity,
        type: "fact",
        id: row.fact_id,
      });
    }
  }

  // Sort all results by similarity descending
  results.sort((a, b) => b.similarity - a.similarity);
  return results;
}
