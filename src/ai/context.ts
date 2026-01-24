import {
  getEntity,
  type CharacterData,
  type Entity,
} from "../db/entities";
import { getRelationshipsFrom, getRelationshipsTo } from "../db/relationships";
import { getWorldState, formatWorldStateForContext } from "../world/state";
import { formatInventoryForContext } from "../world/inventory";

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
  recentMessageCount?: number;
}

const DEFAULT_CONFIG: Required<ContextConfig> = {
  maxTokens: 8000,
  includeWorldState: true,
  includeCharacters: true,
  includeInventory: true,
  includeRelationships: true,
  recentMessageCount: 20,
};

// Simple token estimation (4 chars ≈ 1 token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface AssembledContext {
  systemPrompt: string;
  messages: Message[];
  tokenEstimate: number;
}

export function assembleContext(
  channelId: string,
  recentMessages: Message[],
  activeCharacterId?: number,
  config: ContextConfig = {}
): AssembledContext {
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

  // 5. Relationships (if enabled and budget allows)
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

  // Build system prompt
  const systemPrompt = sections.join("\n\n");

  // 6. Recent messages (fit as many as budget allows)
  const messages: Message[] = [];
  const truncatedMessages = recentMessages.slice(-cfg.recentMessageCount);

  for (const msg of truncatedMessages) {
    const msgTokens = estimateTokens(msg.content) + 10; // +10 for role/name overhead
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

function formatCharacterForContext(
  character: Entity<CharacterData>
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
  characters: Entity<CharacterData>[]
): string {
  const lines: string[] = ["## Other Characters Present"];

  for (const char of characters) {
    lines.push(`\n### ${char.name}`);
    // Just include a brief summary for other characters
    const briefPersona = char.data.persona.slice(0, 200);
    lines.push(
      briefPersona + (char.data.persona.length > 200 ? "..." : "")
    );
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
