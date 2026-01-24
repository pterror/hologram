import { generateText } from "ai";
import { getLanguageModel, DEFAULT_MODEL } from "../ai/models";
import { embed } from "../ai/embeddings";
import {
  createFactWithEmbedding,
  deleteFact,
  updateFactImportance,
  type Fact,
} from "../db/facts";
import { getDb } from "../db";

// Summarize a batch of related facts into a consolidated memory
export async function summarizeFacts(facts: Fact[]): Promise<string | null> {
  if (facts.length === 0) return null;

  const model = getLanguageModel(process.env.SUMMARIZE_MODEL || DEFAULT_MODEL);

  const factList = facts.map((f) => `- ${f.content}`).join("\n");

  try {
    const result = await generateText({
      model,
      system:
        "You are a memory consolidation system. Summarize the following related facts into a single, coherent memory. Preserve important details but remove redundancy. Be concise.",
      prompt: `Facts to consolidate:\n${factList}\n\nConsolidated summary:`,
      maxOutputTokens: 200,
    });

    return result.text.trim();
  } catch (error) {
    console.error("Error summarizing facts:", error);
    return null;
  }
}

// Consolidate old, low-importance facts
export async function consolidateOldFacts(
  maxAgeDays = 7,
  minImportanceToKeep = 7
): Promise<{ consolidated: number; deleted: number }> {
  const db = getDb();
  const cutoffTime = Math.floor(Date.now() / 1000) - maxAgeDays * 24 * 60 * 60;

  // Get old, low-importance facts
  const stmt = db.prepare(`
    SELECT id, entity_id as entityId, content, importance, created_at as createdAt
    FROM facts
    WHERE created_at < ? AND importance < ?
    ORDER BY entity_id, created_at
    LIMIT 100
  `);

  const oldFacts = stmt.all(cutoffTime, minImportanceToKeep) as Fact[];

  if (oldFacts.length < 3) {
    return { consolidated: 0, deleted: 0 };
  }

  // Group by entity
  const byEntity = new Map<number | null, Fact[]>();
  for (const fact of oldFacts) {
    const key = fact.entityId;
    if (!byEntity.has(key)) {
      byEntity.set(key, []);
    }
    byEntity.get(key)!.push(fact);
  }

  let consolidated = 0;
  let deleted = 0;

  // Consolidate each group
  for (const [entityId, facts] of byEntity) {
    if (facts.length < 2) continue;

    const summary = await summarizeFacts(facts);
    if (summary) {
      // Create consolidated fact with higher importance
      const avgImportance = Math.ceil(
        facts.reduce((sum, f) => sum + f.importance, 0) / facts.length
      );
      const newImportance = Math.min(avgImportance + 1, 10);

      const embedding = await embed(summary);
      await createFactWithEmbedding(
        summary,
        embedding,
        entityId ?? undefined,
        newImportance
      );

      // Delete original facts
      for (const fact of facts) {
        deleteFact(fact.id);
        deleted++;
      }

      consolidated++;
    }
  }

  return { consolidated, deleted };
}

// Decay importance of old facts over time
export function decayFactImportance(
  maxAgeDays = 30,
  decayAmount = 1
): number {
  const db = getDb();
  const cutoffTime = Math.floor(Date.now() / 1000) - maxAgeDays * 24 * 60 * 60;

  const stmt = db.prepare(`
    UPDATE facts
    SET importance = MAX(1, importance - ?)
    WHERE created_at < ? AND importance > 1 AND importance < 8
  `);

  const result = stmt.run(decayAmount, cutoffTime);
  return result.changes;
}

// Prune very old, very low importance facts
export function pruneOldFacts(
  maxAgeDays = 90,
  maxImportanceToPrune = 3
): number {
  const db = getDb();
  const cutoffTime = Math.floor(Date.now() / 1000) - maxAgeDays * 24 * 60 * 60;

  // Get IDs to delete
  const selectStmt = db.prepare(`
    SELECT id FROM facts
    WHERE created_at < ? AND importance <= ?
  `);
  const toDelete = selectStmt.all(cutoffTime, maxImportanceToPrune) as {
    id: number;
  }[];

  // Delete facts and their embeddings
  for (const { id } of toDelete) {
    deleteFact(id);
  }

  return toDelete.length;
}

// Boost importance of frequently accessed facts
const factAccessCounts = new Map<number, number>();

export function recordFactAccess(factId: number): void {
  const count = (factAccessCounts.get(factId) ?? 0) + 1;
  factAccessCounts.set(factId, count);

  // Boost importance after multiple accesses
  if (count >= 3) {
    updateFactImportance(factId, Math.min(10, count + 5));
    factAccessCounts.delete(factId);
  }
}

// Summarize conversation history
export async function summarizeConversation(
  messages: Array<{ role: string; content: string; name?: string }>,
  maxLength = 500
): Promise<string | null> {
  if (messages.length < 3) return null;

  const model = getLanguageModel(process.env.SUMMARIZE_MODEL || DEFAULT_MODEL);

  const conversation = messages
    .map((m) => `${m.name || m.role}: ${m.content}`)
    .join("\n");

  try {
    const result = await generateText({
      model,
      system:
        "Summarize this conversation, focusing on: key events that happened, important information revealed, character actions and decisions, and any unresolved situations. Be concise but preserve important details.",
      prompt: `Conversation:\n${conversation}\n\nSummary:`,
      maxOutputTokens: Math.ceil(maxLength / 4),
    });

    return result.text.trim();
  } catch (error) {
    console.error("Error summarizing conversation:", error);
    return null;
  }
}

// Get memory statistics
export function getMemoryStats(): {
  totalFacts: number;
  byImportance: Record<number, number>;
  oldestFact: number | null;
  newestFact: number | null;
} {
  const db = getDb();

  const countStmt = db.prepare("SELECT COUNT(*) as count FROM facts");
  const totalFacts = (countStmt.get() as { count: number }).count;

  const byImportanceStmt = db.prepare(`
    SELECT importance, COUNT(*) as count
    FROM facts
    GROUP BY importance
    ORDER BY importance
  `);
  const byImportanceRows = byImportanceStmt.all() as {
    importance: number;
    count: number;
  }[];
  const byImportance: Record<number, number> = {};
  for (const row of byImportanceRows) {
    byImportance[row.importance] = row.count;
  }

  const oldestStmt = db.prepare(
    "SELECT MIN(created_at) as oldest FROM facts"
  );
  const oldest = (oldestStmt.get() as { oldest: number | null }).oldest;

  const newestStmt = db.prepare(
    "SELECT MAX(created_at) as newest FROM facts"
  );
  const newest = (newestStmt.get() as { newest: number | null }).newest;

  return {
    totalFacts,
    byImportance,
    oldestFact: oldest,
    newestFact: newest,
  };
}
