import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { debug } from "../logger";

// Singleton pipeline instance
let extractor: FeatureExtractionPipeline | null = null;
let initPromise: Promise<FeatureExtractionPipeline> | null = null;

export const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

// =============================================================================
// Embedding Cache (TTL-based LRU)
// =============================================================================

interface CacheEntry {
  embedding: Float32Array;
  expiresAt: number;
}

/** Cache configuration */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 500;

/** Simple hash function for cache keys */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/** Embedding cache with TTL and size limit */
const embeddingCache = new Map<string, CacheEntry>();

/** Get cached embedding if valid */
function getCachedEmbedding(text: string): Float32Array | null {
  const key = hashString(text);
  const entry = embeddingCache.get(key);

  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    embeddingCache.delete(key);
    return null;
  }

  return entry.embedding;
}

/** Store embedding in cache */
function cacheEmbedding(text: string, embedding: Float32Array): void {
  const key = hashString(text);

  // Evict oldest entries if cache is full
  if (embeddingCache.size >= CACHE_MAX_SIZE) {
    const keysToDelete: string[] = [];
    const now = Date.now();

    // First, remove expired entries
    for (const [k, v] of embeddingCache) {
      if (now > v.expiresAt) {
        keysToDelete.push(k);
      }
    }

    for (const k of keysToDelete) {
      embeddingCache.delete(k);
    }

    // If still full, remove oldest (first) entry
    if (embeddingCache.size >= CACHE_MAX_SIZE) {
      const firstKey = embeddingCache.keys().next().value;
      if (firstKey) embeddingCache.delete(firstKey);
    }
  }

  embeddingCache.set(key, {
    embedding,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/** Clear the embedding cache */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

/** Get cache statistics */
export function getEmbeddingCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return { size: embeddingCache.size, maxSize: CACHE_MAX_SIZE, ttlMs: CACHE_TTL_MS };
}

// Initialize the embedding pipeline (lazy, singleton)
async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;

  if (!initPromise) {
    debug("Loading embedding model", { model: MODEL_NAME });
    initPromise = pipeline("feature-extraction", MODEL_NAME, {
      dtype: "fp32",
    }).then((ext) => {
      extractor = ext as FeatureExtractionPipeline;
      debug("Embedding model loaded", { model: MODEL_NAME });
      return extractor;
    });
  }

  return initPromise;
}

// Generate embedding for a single text (with caching)
export async function embed(text: string): Promise<Float32Array> {
  // Check cache first
  const cached = getCachedEmbedding(text);
  if (cached) {
    return cached;
  }

  // Generate new embedding
  const ext = await getExtractor();
  const result = await ext(text, { pooling: "mean", normalize: true });

  // Result is a Tensor, convert to Float32Array
  const data = result.data as Float32Array;

  // Cache the result
  cacheEmbedding(text, data);

  return data;
}

// Generate embeddings for multiple texts (batched)
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const ext = await getExtractor();
  const results: Float32Array[] = [];

  // Process in batches to avoid memory issues
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    for (const text of batch) {
      const result = await ext(text, { pooling: "mean", normalize: true });
      results.push(result.data as Float32Array);
    }
  }

  return results;
}

// Check if the embedding model is loaded (synchronous, no init)
export function isEmbeddingModelLoaded(): boolean {
  return extractor !== null;
}

// Preload the model (call during startup for faster first query)
export async function preloadEmbeddingModel(): Promise<void> {
  await getExtractor();
}

// Compute cosine similarity between two embeddings
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Embeddings must have same dimensions");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  // If vectors are already normalized (which they should be), this simplifies
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Compute max dot-product similarity between two sets of embedding vectors.
 * For each vector in `targets`, returns the maximum dot product across all
 * vectors in `queries`. Assumes all vectors are L2-normalized (so dot product
 * equals cosine similarity).
 *
 * Uses flat Float32Array matrices with index arithmetic for cache-friendly
 * memory access. Scales to 1k+ × 1k+ at 384 dimensions.
 *
 * @param queries - Array of query embeddings (M vectors of D dimensions)
 * @param targets - Array of target embeddings (N vectors of D dimensions)
 * @returns Float32Array of length N with max similarity per target
 */
export function maxSimilarityMatrix(
  queries: Float32Array[],
  targets: Float32Array[],
): Float32Array {
  const M = queries.length;
  const N = targets.length;
  const D = queries[0].length;

  // Stack into flat typed arrays: qMat[i*D..], tMat[j*D..]
  const qMat = new Float32Array(M * D);
  for (let i = 0; i < M; i++) qMat.set(queries[i], i * D);
  const tMat = new Float32Array(N * D);
  for (let j = 0; j < N; j++) tMat.set(targets[j], j * D);

  const maxSims = new Float32Array(N).fill(-Infinity);

  for (let i = 0; i < M; i++) {
    const qOff = i * D;
    for (let j = 0; j < N; j++) {
      const tOff = j * D;
      let dot = 0;
      for (let d = 0; d < D; d++) dot += qMat[qOff + d] * tMat[tOff + d];
      if (dot > maxSims[j]) maxSims[j] = dot;
    }
  }

  return maxSims;
}
