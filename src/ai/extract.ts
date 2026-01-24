import { generateObject } from "ai";
import { z } from "zod";
import { getLanguageModel, DEFAULT_MODEL } from "./models";

// Schema for extracted state changes
const StateChangeSchema = z.object({
  // Location changes
  locationChange: z
    .object({
      newLocation: z.string().describe("Name of the new location"),
      description: z.string().optional().describe("Brief description if new"),
    })
    .optional()
    .describe("If characters moved to a new location"),

  // Time changes
  timeChange: z
    .object({
      hoursElapsed: z.number().optional().describe("Hours that passed"),
      newPeriod: z
        .enum(["morning", "afternoon", "evening", "night"])
        .optional()
        .describe("If time of day changed significantly"),
    })
    .optional()
    .describe("If significant time passed"),

  // Inventory changes
  inventoryChanges: z
    .array(
      z.object({
        action: z.enum(["gained", "lost", "used"]),
        item: z.string().describe("Item name"),
        quantity: z.number().optional().default(1),
        description: z.string().optional().describe("Item description if new"),
      })
    )
    .optional()
    .describe("Items gained, lost, or used"),

  // Important facts to remember
  newFacts: z
    .array(
      z.object({
        content: z.string().describe("The fact to remember"),
        importance: z
          .number()
          .min(1)
          .max(10)
          .describe("1-10 importance score"),
        relatedEntity: z
          .string()
          .optional()
          .describe("Character/location this relates to"),
      })
    )
    .optional()
    .describe("Important facts revealed that should be remembered"),

  // Relationship changes
  relationshipChanges: z
    .array(
      z.object({
        entity1: z.string(),
        entity2: z.string(),
        change: z.string().describe("How the relationship changed"),
      })
    )
    .optional()
    .describe("Changes in relationships between characters"),

  // Character state changes
  characterChanges: z
    .array(
      z.object({
        character: z.string(),
        change: z.string().describe("What changed about the character"),
      })
    )
    .optional()
    .describe("Changes to character state (mood, condition, etc.)"),
});

export type StateChange = z.infer<typeof StateChangeSchema>;

// Extract state changes from an exchange
export async function extractStateChanges(
  userMessage: string,
  assistantResponse: string,
  context?: string
): Promise<StateChange | null> {
  const model = getLanguageModel(process.env.EXTRACT_MODEL || DEFAULT_MODEL);

  const prompt = `Analyze this roleplay exchange and extract any state changes that occurred.

${context ? `Context:\n${context}\n\n` : ""}User message: ${userMessage}

Assistant response: ${assistantResponse}

Extract any changes to:
- Location (if characters moved)
- Time (if significant time passed)
- Inventory (items gained, lost, or used)
- Important facts that should be remembered
- Relationships between characters
- Character states (mood, condition, etc.)

Only include changes that actually happened in this exchange. If nothing changed, return empty/null fields.`;

  try {
    const result = await generateObject({
      model,
      schema: StateChangeSchema,
      prompt,
    });

    return result.object;
  } catch (error) {
    console.error("Error extracting state changes:", error);
    return null;
  }
}

// Lightweight heuristic extraction (no LLM call)
export function extractStateChangesHeuristic(
  response: string
): Partial<StateChange> {
  const changes: Partial<StateChange> = {};

  // Location detection
  const locationPatterns = [
    /(?:arrive[sd]? (?:at|in)|enter(?:s|ed)?|reach(?:es|ed)?|(?:go|went|walk(?:s|ed)?|head(?:s|ed)?) (?:to|into|towards?))\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
    /(?:now (?:in|at)|inside|standing in)\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
  ];

  for (const pattern of locationPatterns) {
    const match = pattern.exec(response);
    if (match) {
      changes.locationChange = { newLocation: match[1] };
      break;
    }
  }

  // Time detection
  const timePatterns = [
    /(\d+)\s+hours?\s+(?:pass(?:es|ed)?|later)/i,
    /(?:by|until)\s+(morning|afternoon|evening|night)/i,
    /(?:the next|following)\s+(morning|day|night)/i,
  ];

  for (const pattern of timePatterns) {
    const match = pattern.exec(response);
    if (match) {
      if (/\d+/.test(match[1])) {
        changes.timeChange = { hoursElapsed: parseInt(match[1], 10) };
      } else {
        changes.timeChange = {
          newPeriod: match[1].toLowerCase() as
            | "morning"
            | "afternoon"
            | "evening"
            | "night",
        };
      }
      break;
    }
  }

  // Item detection
  const itemPatterns = [
    { pattern: /(?:pick(?:s|ed)? up|grab(?:s|bed)?|take(?:s|n)?|receive[sd]?|gain(?:s|ed)?|find(?:s)?|found)\s+(?:a\s+|an\s+|the\s+)?([a-z]+(?:\s+[a-z]+)*)/gi, action: "gained" as const },
    { pattern: /(?:drop(?:s|ped)?|lose[sd]?|lost|give(?:s|n)?|gave)\s+(?:a\s+|an\s+|the\s+)?([a-z]+(?:\s+[a-z]+)*)/gi, action: "lost" as const },
    { pattern: /(?:use[sd]?|consume[sd]?|drink(?:s)?|drank|eat(?:s)?|ate)\s+(?:a\s+|an\s+|the\s+)?([a-z]+(?:\s+[a-z]+)*)/gi, action: "used" as const },
  ];

  const inventoryChanges: NonNullable<StateChange["inventoryChanges"]> = [];
  for (const { pattern, action } of itemPatterns) {
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const item = match[1].trim();
      if (item.length > 2 && item.length < 30) {
        inventoryChanges.push({ action, item, quantity: 1 });
      }
    }
  }
  if (inventoryChanges.length > 0) {
    changes.inventoryChanges = inventoryChanges;
  }

  // Important fact detection
  const factPatterns = [
    /(?:reveal(?:s|ed)?|discover(?:s|ed)?|learn(?:s|ed)?|realize[sd]?|find(?:s)? out)\s+that\s+(.+?)(?:\.|$)/gi,
    /(?:it (?:turns out|seems)|apparently|actually)\s+(.+?)(?:\.|$)/gi,
  ];

  const facts: NonNullable<StateChange["newFacts"]> = [];
  for (const pattern of factPatterns) {
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const content = match[1].trim();
      if (content.length > 10 && content.length < 200) {
        facts.push({ content, importance: 6 });
      }
    }
  }
  if (facts.length > 0) {
    changes.newFacts = facts;
  }

  return changes;
}

// Apply extracted state changes
export interface StateApplicator {
  onLocationChange?: (
    newLocation: string,
    description?: string
  ) => Promise<void>;
  onTimeChange?: (
    hoursElapsed?: number,
    newPeriod?: string
  ) => Promise<void>;
  onInventoryChange?: (
    action: "gained" | "lost" | "used",
    item: string,
    quantity: number,
    description?: string
  ) => Promise<void>;
  onNewFact?: (
    content: string,
    importance: number,
    relatedEntity?: string
  ) => Promise<void>;
  onRelationshipChange?: (
    entity1: string,
    entity2: string,
    change: string
  ) => Promise<void>;
}

export async function applyStateChanges(
  changes: StateChange,
  applicator: StateApplicator
): Promise<void> {
  if (changes.locationChange && applicator.onLocationChange) {
    await applicator.onLocationChange(
      changes.locationChange.newLocation,
      changes.locationChange.description
    );
  }

  if (changes.timeChange && applicator.onTimeChange) {
    await applicator.onTimeChange(
      changes.timeChange.hoursElapsed,
      changes.timeChange.newPeriod
    );
  }

  if (changes.inventoryChanges && applicator.onInventoryChange) {
    for (const change of changes.inventoryChanges) {
      await applicator.onInventoryChange(
        change.action,
        change.item,
        change.quantity ?? 1,
        change.description
      );
    }
  }

  if (changes.newFacts && applicator.onNewFact) {
    for (const fact of changes.newFacts) {
      await applicator.onNewFact(
        fact.content,
        fact.importance,
        fact.relatedEntity
      );
    }
  }

  if (changes.relationshipChanges && applicator.onRelationshipChange) {
    for (const change of changes.relationshipChanges) {
      await applicator.onRelationshipChange(
        change.entity1,
        change.entity2,
        change.change
      );
    }
  }
}
