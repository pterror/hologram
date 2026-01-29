import { tool } from "ai";
import { z } from "zod";
import { debug } from "../logger";
import {
  getFactsForEntity,
  addFact,
  updateFactByContent,
  removeFactByContent,
} from "../db/entities";
import {
  addMemory,
  updateMemoryByContent,
  removeMemoryByContent,
} from "../db/memories";
import { parseFact } from "../logic/expr";

// =============================================================================
// Permission Checking
// =============================================================================

export const LOCKED_SIGIL = "$locked";

/**
 * Check if an entity is locked from LLM modification.
 * Returns { locked: false } if not locked.
 * Returns { locked: true, reason: string } if locked.
 */
export function checkEntityLocked(entityId: number): { locked: false } | { locked: true; reason: string } {
  const facts = getFactsForEntity(entityId);
  for (const fact of facts) {
    const trimmed = fact.content.trim();
    // Pure $locked directive (entity-level lock)
    if (trimmed === LOCKED_SIGIL) {
      return { locked: true, reason: "Entity is locked" };
    }
  }
  return { locked: false };
}

/**
 * Check if a specific fact is locked from LLM modification.
 * This checks both entity-level locks and fact-level $locked prefix.
 */
export function checkFactLocked(entityId: number, factContent: string): { locked: false } | { locked: true; reason: string } {
  const facts = getFactsForEntity(entityId);
  for (const fact of facts) {
    const trimmed = fact.content.trim();
    // Pure $locked directive (entity-level lock)
    if (trimmed === LOCKED_SIGIL) {
      return { locked: true, reason: "Entity is locked" };
    }
    // Check if this is the locked version of the fact we're trying to modify
    if (trimmed.startsWith(LOCKED_SIGIL + " ")) {
      const lockedContent = parseFact(trimmed.slice(LOCKED_SIGIL.length + 1).trim()).content;
      if (lockedContent === factContent) {
        return { locked: true, reason: "Fact is locked" };
      }
    }
  }
  return { locked: false };
}

// =============================================================================
// Tool Definitions
// =============================================================================

/** Create tools with context for memory source tracking */
export function createTools(channelId?: string, guildId?: string) {
  return {
    add_fact: tool({
      description: "Add a permanent defining trait to an entity. Use very sparingly - only for core personality, appearance, abilities, or key relationships. Most interactions don't need facts saved.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID to add the fact to"),
        content: z.string().describe("The fact content"),
      }),
      execute: async ({ entityId, content }) => {
        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: add_fact blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const fact = addFact(entityId, content);
        debug("Tool: add_fact", { entityId, content, factId: fact.id });
        return { success: true, factId: fact.id };
      },
    }),

    update_fact: tool({
      description: "Update an existing permanent fact when a core defining trait changes. Facts are for personality, appearance, abilities, key relationships - not events.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID"),
        oldContent: z.string().describe("The exact current fact text to match"),
        newContent: z.string().describe("The new fact content"),
      }),
      execute: async ({ entityId, oldContent, newContent }) => {
        // Check if entity or specific fact is locked
        const lockCheck = checkFactLocked(entityId, oldContent);
        if (lockCheck.locked) {
          debug("Tool: update_fact blocked", { entityId, oldContent, newContent, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const fact = updateFactByContent(entityId, oldContent, newContent);
        debug("Tool: update_fact", { entityId, oldContent, newContent, success: !!fact });
        return { success: !!fact };
      },
    }),

    remove_fact: tool({
      description: "Remove a permanent defining trait that is no longer true. Facts are core traits - if something happened, it's a memory, not a fact.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID"),
        content: z.string().describe("The exact fact text to remove"),
      }),
      execute: async ({ entityId, content }) => {
        // Check if entity or specific fact is locked
        const lockCheck = checkFactLocked(entityId, content);
        if (lockCheck.locked) {
          debug("Tool: remove_fact blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const success = removeFactByContent(entityId, content);
        debug("Tool: remove_fact", { entityId, content, success });
        return { success };
      },
    }),

    save_memory: tool({
      description: "Save a memory of something that happened. Use sparingly for significant conversations, promises, or events that shaped the entity. Most interactions don't need saving - only what matters long-term.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID"),
        content: z.string().describe("The memory content - what happened or was learned"),
      }),
      execute: async ({ entityId, content }) => {
        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: save_memory blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const memory = await addMemory(entityId, content, undefined, channelId, guildId);
        debug("Tool: save_memory", { entityId, content, memoryId: memory.id });
        return { success: true, memoryId: memory.id };
      },
    }),

    update_memory: tool({
      description: "Update an existing memory when details change or need correction. Memories are events and experiences, not defining traits.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID"),
        oldContent: z.string().describe("The exact current memory text to match"),
        newContent: z.string().describe("The new memory content"),
      }),
      execute: async ({ entityId, oldContent, newContent }) => {
        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: update_memory blocked", { entityId, oldContent, newContent, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const memory = await updateMemoryByContent(entityId, oldContent, newContent);
        debug("Tool: update_memory", { entityId, oldContent, newContent, success: !!memory });
        return { success: !!memory };
      },
    }),

    remove_memory: tool({
      description: "Remove a memory that is no longer relevant or was incorrect.",
      inputSchema: z.object({
        entityId: z.number().describe("The entity ID"),
        content: z.string().describe("The exact memory text to remove"),
      }),
      execute: async ({ entityId, content }) => {
        // Check if entity is locked
        const lockCheck = checkEntityLocked(entityId);
        if (lockCheck.locked) {
          debug("Tool: remove_memory blocked", { entityId, content, reason: lockCheck.reason });
          return { success: false, error: lockCheck.reason };
        }

        const success = removeMemoryByContent(entityId, content);
        debug("Tool: remove_memory", { entityId, content, success });
        return { success };
      },
    }),
  };
}
