/**
 * Benchmark for maxSimilarityMatrix at various scales.
 *
 * Usage: bun run scripts/bench-similarity.ts
 */

import { maxSimilarityMatrix } from "../src/ai/embeddings";

const D = 384; // all-MiniLM-L6-v2 dimensions

/** Generate a random L2-normalized Float32Array of dimension D */
function randomNormalizedVector(): Float32Array {
  const v = new Float32Array(D);
  let norm = 0;
  for (let i = 0; i < D; i++) {
    v[i] = Math.random() * 2 - 1;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < D; i++) v[i] /= norm;
  return v;
}

function generateVectors(n: number): Float32Array[] {
  const vecs: Float32Array[] = [];
  for (let i = 0; i < n; i++) vecs.push(randomNormalizedVector());
  return vecs;
}

interface BenchResult {
  M: number;
  N: number;
  ops: number;
  medianMs: number;
  opsPerSec: string;
  throughput: string;
}

function bench(M: number, N: number, warmup = 3, iterations = 10): BenchResult {
  const queries = generateVectors(M);
  const targets = generateVectors(N);
  const ops = M * N * D;

  // Warmup
  for (let i = 0; i < warmup; i++) maxSimilarityMatrix(queries, targets);

  // Timed runs
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    maxSimilarityMatrix(queries, targets);
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const medianMs = times[Math.floor(times.length / 2)];
  const gflops = (ops / medianMs / 1e6).toFixed(2);
  const mPairs = (M * N / medianMs / 1e3).toFixed(1);

  return { M, N, ops, medianMs: Math.round(medianMs * 100) / 100, opsPerSec: `${gflops} GFLOP/s`, throughput: `${mPairs}M pairs/s` };
}

// Run benchmarks at various scales
const scales: [number, number][] = [
  [10, 50],      // typical: small channel, few memories
  [20, 100],     // moderate: default context, growing memories
  [50, 500],     // large: bigger context, many memories
  [100, 1000],   // heavy: large context window
  [500, 1000],   // extreme: very large context
  [1000, 1000],  // max: 1k x 1k
  [1000, 5000],  // beyond: stress test
];

console.log(`maxSimilarityMatrix benchmark (D=${D})\n`);
console.log("  M (queries) × N (targets)  │  median ms  │  throughput      │  GFLOP/s");
console.log("─────────────────────────────┼─────────────┼─────────────────┼──────────");

for (const [M, N] of scales) {
  const r = bench(M, N);
  const label = `${String(r.M).padStart(5)} × ${String(r.N).padStart(5)}`;
  const ms = String(r.medianMs).padStart(9);
  const tp = r.throughput.padStart(15);
  const gf = r.opsPerSec.padStart(8);
  console.log(`  ${label}          │ ${ms} ms │ ${tp} │ ${gf}`);
}
