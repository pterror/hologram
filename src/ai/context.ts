import {
  getEntity,
  type CharacterData,
  type Entity,
} from "../db/entities";
import { getRelationshipsFrom, getRelationshipsTo } from "../db/relationships";
import { getWorldState, formatWorldStateForContext } from "../world/state";
import { formatInventoryForContext } from "../world/inventory";
import { assembleMemoryContext } from "../memory/tiers";
import { getDb } from "../db";
import {
  getActiveScene,
  getSceneCharacters,
  type Scene,
  type SceneCharacter,
} from "../scene";
import {
  formatEntriesForContext,
  searchEntries,
  getRecentEntries,
} from "../chronicle";
import { formatStateForContext } from "../state";
import { getLocation, formatLocationForContext } from "../world/locations";
import { getTimePeriod } from "../world/time";
import {
  allocateBudget,
  ContextPriority,
  estimateTokens,
  type BudgetSection,
} from "./budget";
import { type WorldConfig } from "../config/types";
import { getWorldConfig } from "../config";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  name?: string;
  timestamp?: number;
}

export interface ContextConfig {
  maxTokens?: number; // Approximate token budget
  includeWorldState?: boolean;
  includeCharacters?: boolean;
  includeInventory?: boolean;
  includeRelationships?: boolean;
  includeMemory?: boolean; // RAG + tiered memory
  recentMessageCount?: number;
}

const DEFAULT_CONFIG: Required<ContextConfig> = {
  maxTokens: 8000,
  includeWorldState: true,
  includeCharacters: true,
  includeInventory: true,
  includeRelationships: true,
  includeMemory: true,
  recentMessageCount: 20,
};

export interface AssembledContext {
  systemPrompt: string;
  messages: Message[];
  tokenEstimate: number;
}

// =======================================================
// New scene-aware context assembly
// =======================================================

export interface SceneContextOptions {
  maxTokens?: number;
  historyMessages?: number;
  ragResults?: number;
  includeWorldLore?: boolean;
  includeWorldRules?: boolean;
}

/**
 * Assemble context using the Scene system.
 * This is the primary entry point for context assembly in Phase 7+.
 * It integrates scenes, chronicle, character state, locations, and time.
 */
export async function assembleSceneContext(
  channelId: string,
  recentMessages: Message[],
  activeCharacterIds: number[],
  options: SceneContextOptions = {}
): Promise<AssembledContext> {
  const scene = getActiveScene(channelId);

  // Fall back to legacy assembly if no active scene
  if (!scene) {
    return assembleContext(
      channelId,
      recentMessages,
      activeCharacterIds[0],
      {
        maxTokens: options.maxTokens,
        recentMessageCount: options.historyMessages,
      }
    );
  }

  // Get config
  const worldConfig = getWorldConfig(scene.worldId);
  const maxTokens = options.maxTokens ?? worldConfig.context.maxTokens;
  const historyMessages = options.historyMessages ?? worldConfig.context.historyMessages;
  const ragResults = options.ragResults ?? worldConfig.context.ragResults;

  // Build all context sections
  const sections: BudgetSection[] = [];

  // 1. World rules (never cut)
  const worldRules = buildWorldRulesSection(scene.worldId, worldConfig, options);
  if (worldRules) {
    sections.push({
      name: "worldRules",
      content: worldRules,
      priority: ContextPriority.SYSTEM_INSTRUCTIONS,
      canTruncate: false,
    });
  }

  // 2. Active character persona(s)
  for (const charId of activeCharacterIds) {
    const character = getEntity<CharacterData>(charId);
    if (character) {
      const charSection = formatCharacterForContext(character, scene.id);
      sections.push({
        name: `character_${charId}`,
        content: charSection,
        priority: ContextPriority.CHARACTER_PERSONA,
        canTruncate: true,
        minTokens: 200,
      });
    }
  }

  // 3. Scene state (location, time, weather)
  const sceneSection = formatSceneState(scene);
  if (sceneSection) {
    sections.push({
      name: "scene",
      content: sceneSection,
      priority: ContextPriority.WORLD_STATE,
      canTruncate: true,
      minTokens: 50,
    });
  }

  // 4. Inventory for active characters
  for (const charId of activeCharacterIds) {
    const invSection = formatInventoryForContext(charId, scene.id);
    if (invSection && invSection !== "Inventory: Empty") {
      sections.push({
        name: `inventory_${charId}`,
        content: invSection,
        priority: ContextPriority.INVENTORY,
        canTruncate: true,
        minTokens: 30,
      });
    }
  }

  // 5. Other characters present (not being voiced)
  const sceneChars = getSceneCharacters(scene.id);
  const otherChars = sceneChars
    .filter((sc: SceneCharacter) => sc.isPresent && !activeCharacterIds.includes(sc.characterId))
    .map((sc: SceneCharacter) => getEntity<CharacterData>(sc.characterId))
    .filter((c): c is Entity<CharacterData> => c !== null);

  if (otherChars.length > 0) {
    const othersSection = formatOtherCharactersForContext(otherChars, scene.id);
    sections.push({
      name: "otherCharacters",
      content: othersSection,
      priority: ContextPriority.OTHER_CHARACTERS,
      canTruncate: true,
      minTokens: 30,
    });
  }

  // 6. Relationships for active characters
  for (const charId of activeCharacterIds) {
    const relSection = formatRelationshipsForContext(charId);
    if (relSection) {
      sections.push({
        name: `relationships_${charId}`,
        content: relSection,
        priority: ContextPriority.RELATIONSHIPS,
        canTruncate: true,
        minTokens: 30,
      });
    }
  }

  // 7. Chronicle memory (perspective-aware)
  const memorySection = await buildChronicleSection(
    scene,
    activeCharacterIds,
    recentMessages,
    ragResults
  );
  if (memorySection) {
    sections.push({
      name: "chronicle",
      content: memorySection,
      priority: ContextPriority.RAG_RESULTS,
      canTruncate: true,
      minTokens: 50,
    });
  }

  // 8. World lore (if enabled)
  if (options.includeWorldLore ?? worldConfig.context.includeWorldLore) {
    const loreSection = buildWorldLoreSection(scene.worldId);
    if (loreSection) {
      sections.push({
        name: "worldLore",
        content: loreSection,
        priority: ContextPriority.RECENT_EVENTS,
        canTruncate: true,
        minTokens: 50,
      });
    }
  }

  // Allocate budget
  const budgetResult = allocateBudget(sections, maxTokens);

  // Build system prompt from allocated sections
  const systemPrompt = budgetResult.sections
    .map((s) => s.content)
    .join("\n\n");

  // Fit recent messages into remaining budget
  const messagesBudget = maxTokens - budgetResult.totalTokens;
  const messages: Message[] = [];
  const truncatedMessages = recentMessages.slice(-historyMessages);
  let msgBudget = messagesBudget;

  for (const msg of truncatedMessages) {
    const msgTokens = estimateTokens(msg.content) + 10;
    if (msgTokens < msgBudget) {
      messages.push(msg);
      msgBudget -= msgTokens;
    }
  }

  return {
    systemPrompt,
    messages,
    tokenEstimate: maxTokens - msgBudget,
  };
}

// =======================================================
// Section builders
// =======================================================

function buildWorldRulesSection(
  worldId: number,
  config: WorldConfig,
  options: SceneContextOptions
): string | null {
  if (!(options.includeWorldRules ?? config.context.includeWorldRules)) {
    return null;
  }

  const db = getDb();
  const row = db.prepare("SELECT rules FROM worlds WHERE id = ?").get(worldId) as { rules: string | null } | null;
  if (!row?.rules) return null;

  return `## Game Rules\n${row.rules}`;
}

function buildWorldLoreSection(worldId: number): string | null {
  const db = getDb();
  const row = db.prepare("SELECT lore FROM worlds WHERE id = ?").get(worldId) as { lore: string | null } | null;
  if (!row?.lore) return null;

  return `## World Lore\n${row.lore}`;
}

function formatSceneState(scene: Scene): string | null {
  const lines: string[] = [];

  // Time
  const period = getTimePeriod(scene.time.hour);
  const timeHour = scene.time.hour % 12 || 12;
  const ampm = scene.time.hour < 12 ? "AM" : "PM";
  lines.push(`## Current State`);
  lines.push(`Time: Day ${scene.time.day + 1}, ${timeHour}:${scene.time.minute.toString().padStart(2, "0")} ${ampm} (${period.name})`);

  if (scene.weather) {
    lines.push(`Weather: ${scene.weather}`);
  }

  // Location
  if (scene.locationId) {
    const location = getLocation(scene.locationId);
    if (location) {
      lines.push("");
      lines.push(formatLocationForContext(location));
    }
  }

  // Ambience
  if (scene.ambience) {
    lines.push("");
    lines.push(`*${scene.ambience}*`);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

async function buildChronicleSection(
  scene: Scene,
  activeCharacterIds: number[],
  recentMessages: Message[],
  maxResults: number
): Promise<string | null> {
  // Get the last user message for semantic search
  const lastUserMessage = [...recentMessages]
    .reverse()
    .find((m) => m.role === "user");
  const query = lastUserMessage?.content ?? "";

  let entries;

  if (query) {
    // Semantic search with perspective filtering
    entries = await searchEntries({
      query,
      sceneId: scene.id,
      worldId: scene.worldId,
      characterIds: activeCharacterIds,
      includeShared: true,
      includeNarrator: false,
      limit: maxResults,
    });
  } else {
    // Fall back to recent entries
    entries = getRecentEntries(scene.id, maxResults);
  }

  // Filter by visibility: active chars can see "public" and their own "character" entries
  const visible = entries.filter((e) => {
    if (e.visibility === "public") return true;
    if (e.visibility === "character") {
      return activeCharacterIds.includes(Number(e.perspective));
    }
    return false;
  });

  if (visible.length === 0) return null;

  return formatEntriesForContext(visible);
}

// =======================================================
// Character formatting (enhanced with state)
// =======================================================

function formatCharacterForContext(
  character: Entity<CharacterData>,
  sceneId?: number
): string {
  const lines: string[] = [];

  lines.push(`# Character: ${character.name}`);
  lines.push("");
  lines.push("## Persona");
  lines.push(character.data.persona);

  if (character.data.scenario) {
    lines.push("");
    lines.push("## Current Scenario");
    lines.push(character.data.scenario);
  }

  // Character state (attributes, body, effects)
  if (sceneId !== undefined) {
    const stateSection = formatStateForContext(character.id, sceneId);
    if (stateSection) {
      lines.push("");
      lines.push("## Current State");
      lines.push(stateSection);
    }
  }

  if (character.data.exampleDialogue) {
    lines.push("");
    lines.push("## Example Dialogue");
    lines.push(character.data.exampleDialogue);
  }

  if (character.data.systemPrompt) {
    lines.push("");
    lines.push("## Instructions");
    lines.push(character.data.systemPrompt);
  }

  return lines.join("\n");
}

function formatOtherCharactersForContext(
  characters: Entity<CharacterData>[],
  sceneId?: number
): string {
  const lines: string[] = ["## Other Characters Present"];

  for (const char of characters) {
    lines.push(`\n### ${char.name}`);
    // Brief persona
    const briefPersona = char.data.persona.slice(0, 200);
    lines.push(
      briefPersona + (char.data.persona.length > 200 ? "..." : "")
    );

    // Include visible state for other characters
    if (sceneId !== undefined) {
      const stateSection = formatStateForContext(char.id, sceneId);
      if (stateSection) {
        lines.push(stateSection);
      }
    }
  }

  return lines.join("\n");
}

function formatRelationshipsForContext(entityId: number): string | null {
  const outgoing = getRelationshipsFrom(entityId);
  const incoming = getRelationshipsTo(entityId);

  if (outgoing.length === 0 && incoming.length === 0) {
    return null;
  }

  const lines: string[] = ["## Relationships"];

  for (const rel of outgoing) {
    const target = getEntity(rel.targetId);
    if (target) {
      lines.push(`- ${rel.type} → ${target.name}`);
    }
  }

  for (const rel of incoming) {
    const source = getEntity(rel.sourceId);
    if (source) {
      lines.push(`- ${source.name} → ${rel.type}`);
    }
  }

  return lines.join("\n");
}

// =======================================================
// Legacy context assembly (kept for backward compatibility)
// =======================================================

/**
 * Legacy context assembly using channel-based world state.
 * Use assembleSceneContext for new code.
 */
export async function assembleContext(
  channelId: string,
  recentMessages: Message[],
  activeCharacterId?: number,
  config: ContextConfig = {}
): Promise<AssembledContext> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const sections: string[] = [];
  let tokenBudget = cfg.maxTokens;

  // 1. Active character persona (highest priority)
  if (activeCharacterId && cfg.includeCharacters) {
    const character = getEntity<CharacterData>(activeCharacterId);
    if (character) {
      const characterSection = formatCharacterForContext(character);
      const tokens = estimateTokens(characterSection);
      if (tokens < tokenBudget) {
        sections.push(characterSection);
        tokenBudget -= tokens;
      }
    }
  }

  // 2. World state
  if (cfg.includeWorldState) {
    const worldState = getWorldState(channelId);
    if (worldState) {
      const worldSection = formatWorldStateForContext(worldState);
      const tokens = estimateTokens(worldSection);
      if (tokens < tokenBudget) {
        sections.push(worldSection);
        tokenBudget -= tokens;
      }
    }
  }

  // 3. Active character's inventory
  if (activeCharacterId && cfg.includeInventory) {
    const inventorySection = formatInventoryForContext(activeCharacterId);
    const tokens = estimateTokens(inventorySection);
    if (tokens < tokenBudget) {
      sections.push(inventorySection);
      tokenBudget -= tokens;
    }
  }

  // 4. Other active characters in scene
  if (cfg.includeCharacters) {
    const worldState = getWorldState(channelId);
    if (worldState && worldState.activeCharacterIds.length > 0) {
      const otherCharacters = worldState.activeCharacterIds
        .filter((id) => id !== activeCharacterId)
        .map((id) => getEntity<CharacterData>(id))
        .filter((c): c is Entity<CharacterData> => c !== null);

      if (otherCharacters.length > 0) {
        const othersSection = formatOtherCharactersForContext(otherCharacters);
        const tokens = estimateTokens(othersSection);
        if (tokens < tokenBudget) {
          sections.push(othersSection);
          tokenBudget -= tokens;
        }
      }
    }
  }

  // 5. Relationships
  if (activeCharacterId && cfg.includeRelationships) {
    const relSection = formatRelationshipsForContext(activeCharacterId);
    if (relSection) {
      const tokens = estimateTokens(relSection);
      if (tokens < tokenBudget) {
        sections.push(relSection);
        tokenBudget -= tokens;
      }
    }
  }

  // 6. Memory context (RAG + tiered memory)
  if (cfg.includeMemory) {
    const lastUserMessage = [...recentMessages]
      .reverse()
      .find((m) => m.role === "user");
    const query = lastUserMessage?.content || "";

    if (query) {
      const memorySection = await assembleMemoryContext(
        channelId,
        query,
        activeCharacterId
      );
      if (memorySection) {
        const tokens = estimateTokens(memorySection);
        if (tokens < tokenBudget) {
          sections.push(memorySection);
          tokenBudget -= tokens;
        }
      }
    }
  }

  // Build system prompt
  const systemPrompt = sections.join("\n\n");

  // 7. Recent messages
  const messages: Message[] = [];
  const truncatedMessages = recentMessages.slice(-cfg.recentMessageCount);

  for (const msg of truncatedMessages) {
    const msgTokens = estimateTokens(msg.content) + 10;
    if (msgTokens < tokenBudget) {
      messages.push(msg);
      tokenBudget -= msgTokens;
    }
  }

  const totalTokens = cfg.maxTokens - tokenBudget;

  return {
    systemPrompt,
    messages,
    tokenEstimate: totalTokens,
  };
}

// Format messages for AI SDK
export function formatMessagesForAI(
  messages: Message[]
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.name ? `${m.name}: ${m.content}` : m.content,
    }));
}
