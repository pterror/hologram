/**
 * Chronicle Export (JSONL)
 *
 * Exports chronicle/memory entries in JSONL format (one JSON object per line).
 */

import { getDb } from "../../db";
import type { ChronicleExportEntry } from "../types";

export interface ChronicleExportOptions {
  worldId: number;
  sceneId?: number;
  types?: string[];
  perspectives?: string[];
  startDate?: number;
  endDate?: number;
}

/**
 * Get chronicle entries for export.
 */
export function getChronicleEntries(
  options: ChronicleExportOptions
): ChronicleExportEntry[] {
  const db = getDb();

  let query = `
    SELECT id, scene_id, type, content, importance, perspective, visibility, source, created_at
    FROM chronicle
    WHERE world_id = ?
  `;
  const params: (number | string)[] = [options.worldId];

  if (options.sceneId !== undefined) {
    query += " AND scene_id = ?";
    params.push(options.sceneId);
  }

  if (options.types && options.types.length > 0) {
    query += ` AND type IN (${options.types.map(() => "?").join(",")})`;
    params.push(...options.types);
  }

  if (options.perspectives && options.perspectives.length > 0) {
    query += ` AND perspective IN (${options.perspectives.map(() => "?").join(",")})`;
    params.push(...options.perspectives);
  }

  if (options.startDate !== undefined) {
    query += " AND created_at >= ?";
    params.push(options.startDate);
  }

  if (options.endDate !== undefined) {
    query += " AND created_at <= ?";
    params.push(options.endDate);
  }

  query += " ORDER BY created_at ASC";

  const rows = db.prepare(query).all(...params) as Array<{
    id: number;
    scene_id: number | null;
    type: string;
    content: string;
    importance: number;
    perspective: string;
    visibility: string;
    source: string;
    created_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    sceneId: row.scene_id,
    type: row.type,
    content: row.content,
    importance: row.importance,
    perspective: row.perspective,
    visibility: row.visibility,
    source: row.source,
    createdAt: row.created_at,
  }));
}

/**
 * Export chronicle entries as JSONL string.
 */
export function exportChronicleAsJsonl(
  options: ChronicleExportOptions
): string {
  const entries = getChronicleEntries(options);
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

/**
 * Export chronicle entries as a generator (for streaming large exports).
 */
export function* streamChronicleJsonl(
  options: ChronicleExportOptions
): Generator<string> {
  const entries = getChronicleEntries(options);
  for (const entry of entries) {
    yield JSON.stringify(entry) + "\n";
  }
}

/**
 * Parse JSONL chronicle export back to entries.
 */
export function parseChronicleJsonl(jsonl: string): ChronicleExportEntry[] {
  const lines = jsonl.trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as ChronicleExportEntry);
}
