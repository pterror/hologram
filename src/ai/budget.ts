// Token budget management with priority-based allocation

export interface BudgetSection {
  name: string;
  content: string;
  priority: number; // Higher = more important, gets budget first
  minTokens?: number; // Minimum tokens to include (or skip entirely)
  canTruncate?: boolean; // Whether content can be truncated
}

export interface BudgetResult {
  sections: Array<{ name: string; content: string; tokens: number }>;
  totalTokens: number;
  droppedSections: string[];
  truncatedSections: string[];
}

// Estimate tokens (rough: 4 chars ≈ 1 token)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// More accurate token estimation for messages
export function estimateMessageTokens(
  messages: Array<{ role: string; content: string; name?: string }>
): number {
  let total = 0;
  for (const msg of messages) {
    // Role + content + overhead
    total += 4; // Message overhead
    total += estimateTokens(msg.content);
    if (msg.name) {
      total += estimateTokens(msg.name) + 1;
    }
  }
  return total;
}

// Allocate budget to sections by priority
export function allocateBudget(
  sections: BudgetSection[],
  totalBudget: number,
  reserveForMessages = 2000
): BudgetResult {
  const availableBudget = totalBudget - reserveForMessages;
  const result: BudgetResult = {
    sections: [],
    totalTokens: 0,
    droppedSections: [],
    truncatedSections: [],
  };

  // Sort by priority (highest first)
  const sorted = [...sections].sort((a, b) => b.priority - a.priority);

  let remainingBudget = availableBudget;

  for (const section of sorted) {
    const tokens = estimateTokens(section.content);
    const minTokens = section.minTokens ?? Math.min(100, tokens);

    if (tokens <= remainingBudget) {
      // Fits entirely
      result.sections.push({
        name: section.name,
        content: section.content,
        tokens,
      });
      remainingBudget -= tokens;
      result.totalTokens += tokens;
    } else if (section.canTruncate && remainingBudget >= minTokens) {
      // Truncate to fit
      const truncated = truncateToTokens(section.content, remainingBudget);
      const truncatedTokens = estimateTokens(truncated);

      result.sections.push({
        name: section.name,
        content: truncated,
        tokens: truncatedTokens,
      });
      remainingBudget -= truncatedTokens;
      result.totalTokens += truncatedTokens;
      result.truncatedSections.push(section.name);
    } else {
      // Drop entirely
      result.droppedSections.push(section.name);
    }
  }

  return result;
}

// Truncate content to approximately fit token budget
function truncateToTokens(content: string, maxTokens: number): string {
  const targetChars = maxTokens * 4;
  if (content.length <= targetChars) return content;

  // Try to truncate at sentence boundary
  const truncated = content.slice(0, targetChars);
  const lastPeriod = truncated.lastIndexOf(".");
  const lastNewline = truncated.lastIndexOf("\n");
  const breakPoint = Math.max(lastPeriod, lastNewline);

  if (breakPoint > targetChars * 0.7) {
    return truncated.slice(0, breakPoint + 1) + "\n[truncated]";
  }

  return truncated + "... [truncated]";
}

// Priority levels for different context types
export const ContextPriority = {
  CHARACTER_PERSONA: 100, // Always include active character
  SYSTEM_INSTRUCTIONS: 95, // Critical instructions
  WORLD_STATE: 80, // Current location, time
  INVENTORY: 70, // Character's items
  ACTIVE_SCENE: 65, // Scene description
  RELATIONSHIPS: 60, // Character relationships
  RECENT_EVENTS: 55, // Session events
  RAG_RESULTS: 50, // Retrieved memories
  OTHER_CHARACTERS: 40, // Other characters in scene
  SESSION_NOTES: 30, // Temporary notes
} as const;

// Build sections with priorities for context assembly
export function buildContextSections(params: {
  characterSection?: string;
  worldSection?: string;
  inventorySection?: string;
  relationshipsSection?: string;
  memorySection?: string;
  otherCharactersSection?: string;
  sceneSection?: string;
  eventsSection?: string;
  customInstructions?: string;
}): BudgetSection[] {
  const sections: BudgetSection[] = [];

  if (params.customInstructions) {
    sections.push({
      name: "instructions",
      content: params.customInstructions,
      priority: ContextPriority.SYSTEM_INSTRUCTIONS,
      canTruncate: false,
    });
  }

  if (params.characterSection) {
    sections.push({
      name: "character",
      content: params.characterSection,
      priority: ContextPriority.CHARACTER_PERSONA,
      canTruncate: true,
      minTokens: 200,
    });
  }

  if (params.worldSection) {
    sections.push({
      name: "world",
      content: params.worldSection,
      priority: ContextPriority.WORLD_STATE,
      canTruncate: true,
      minTokens: 50,
    });
  }

  if (params.sceneSection) {
    sections.push({
      name: "scene",
      content: params.sceneSection,
      priority: ContextPriority.ACTIVE_SCENE,
      canTruncate: true,
      minTokens: 50,
    });
  }

  if (params.inventorySection) {
    sections.push({
      name: "inventory",
      content: params.inventorySection,
      priority: ContextPriority.INVENTORY,
      canTruncate: true,
      minTokens: 30,
    });
  }

  if (params.relationshipsSection) {
    sections.push({
      name: "relationships",
      content: params.relationshipsSection,
      priority: ContextPriority.RELATIONSHIPS,
      canTruncate: true,
      minTokens: 30,
    });
  }

  if (params.eventsSection) {
    sections.push({
      name: "events",
      content: params.eventsSection,
      priority: ContextPriority.RECENT_EVENTS,
      canTruncate: true,
      minTokens: 30,
    });
  }

  if (params.memorySection) {
    sections.push({
      name: "memory",
      content: params.memorySection,
      priority: ContextPriority.RAG_RESULTS,
      canTruncate: true,
      minTokens: 50,
    });
  }

  if (params.otherCharactersSection) {
    sections.push({
      name: "otherCharacters",
      content: params.otherCharactersSection,
      priority: ContextPriority.OTHER_CHARACTERS,
      canTruncate: true,
      minTokens: 30,
    });
  }

  return sections;
}
