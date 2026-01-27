import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getLanguageModel, DEFAULT_MODEL } from "./models";
import { info, debug, error } from "../logger";
import {
  getEntityWithFacts,
  addFact,
  updateFactByContent,
  removeFactByContent,
  type EntityWithFacts,
} from "../db/entities";
import {
  resolveDiscordEntity,
  getMessages,
} from "../db/discord";

// =============================================================================
// Types
// =============================================================================

/** Entity with pre-evaluated facts (directives processed and removed) */
export interface EvaluatedEntity {
  id: number;
  name: string;
  /** Facts with directives ($if, $respond, $avatar, etc.) processed and removed */
  facts: string[];
  /** Avatar URL from $avatar directive, if present */
  avatarUrl: string | null;
}

export interface MessageContext {
  channelId: string;
  guildId?: string;
  userId: string;
  username: string;
  content: string;
  isMentioned: boolean;
  /** Pre-evaluated responding entities (facts already processed) */
  respondingEntities?: EvaluatedEntity[];
}

export interface CharacterResponse {
  entityId: number;
  name: string;
  content: string;
  avatarUrl?: string;
}

export interface ResponseResult {
  response: string;
  characterResponses?: CharacterResponse[];
  factsAdded: number;
  factsUpdated: number;
  factsRemoved: number;
}

// =============================================================================
// Tool Definitions
// =============================================================================

const tools = {
  add_fact: tool({
    description: "Add a new fact to an entity. Use this when something new is learned or happens.",
    inputSchema: z.object({
      entityId: z.number().describe("The entity ID to add the fact to"),
      content: z.string().describe("The fact content"),
    }),
    execute: async ({ entityId, content }) => {
      const fact = addFact(entityId, content);
      debug("Tool: add_fact", { entityId, content, factId: fact.id });
      return { success: true, factId: fact.id };
    },
  }),

  update_fact: tool({
    description: "Update an existing fact. Use this when a fact changes.",
    inputSchema: z.object({
      entityId: z.number().describe("The entity ID"),
      oldContent: z.string().describe("The exact current fact text to match"),
      newContent: z.string().describe("The new fact content"),
    }),
    execute: async ({ entityId, oldContent, newContent }) => {
      const fact = updateFactByContent(entityId, oldContent, newContent);
      debug("Tool: update_fact", { entityId, oldContent, newContent, success: !!fact });
      return { success: !!fact };
    },
  }),

  remove_fact: tool({
    description: "Remove a fact that is no longer true.",
    inputSchema: z.object({
      entityId: z.number().describe("The entity ID"),
      content: z.string().describe("The exact fact text to remove"),
    }),
    execute: async ({ entityId, content }) => {
      const success = removeFactByContent(entityId, content);
      debug("Tool: remove_fact", { entityId, content, success });
      return { success };
    },
  }),
};

// =============================================================================
// Context Building
// =============================================================================

/** Format an evaluated entity for LLM context */
function formatEvaluatedEntity(entity: EvaluatedEntity): string {
  const factLines = entity.facts.join("\n");
  return `<facts entity="${entity.name}" id="${entity.id}">\n${factLines}\n</facts>`;
}

/** Format a raw entity for LLM context (used for locations, etc.) */
function formatRawEntity(entity: EntityWithFacts): string {
  const factLines = entity.facts.map(f => f.content).join("\n");
  return `<facts entity="${entity.name}" id="${entity.id}">\n${factLines}\n</facts>`;
}

function buildSystemPrompt(
  respondingEntities: EvaluatedEntity[],
  otherEntities: EntityWithFacts[]
): string {
  if (respondingEntities.length === 0 && otherEntities.length === 0) {
    return "You are a helpful assistant. Respond naturally to the user.";
  }

  const contextParts: string[] = [];
  for (const e of respondingEntities) {
    contextParts.push(formatEvaluatedEntity(e));
  }
  for (const e of otherEntities) {
    contextParts.push(formatRawEntity(e));
  }
  const context = contextParts.join("\n\n");

  // Identify character entities for multi-char guidance
  const characters = respondingEntities.filter(e =>
    e.facts.some(f => f.includes("is a character"))
  );

  let multiCharGuidance = "";
  if (characters.length > 1) {
    const names = characters.map(c => c.name).join(", ");
    multiCharGuidance = `\n\nMultiple characters are present: ${names}. Format your response with XML tags:
<${characters[0]?.name ?? "Name"}>*waves* Hello there!</${characters[0]?.name ?? "Name"}>
<${characters[1]?.name ?? "Other"}>Nice to meet you.</${characters[1]?.name ?? "Other"}>

Wrap each character's dialogue in their name tag. Characters may interact naturally.`;
  }

  return `${context}

You have access to tools to modify facts about entities. Use them sparingly:
- Something new is learned (add_fact)
- A fact changes (update_fact)
- A fact is no longer true (remove_fact)

Respond naturally in character based on the facts provided.${multiCharGuidance}`;
}

function buildUserMessage(messages: Array<{ author_name: string; content: string }>): string {
  return messages.map(m => `${m.author_name}: ${m.content}`).join("\n");
}

/**
 * Parse LLM response into per-character segments using XML tags.
 * Format: <CharName>content</CharName>
 * Returns undefined if no valid tags found.
 */
function parseMultiCharacterResponse(
  response: string,
  entities: EvaluatedEntity[]
): CharacterResponse[] | undefined {
  if (entities.length <= 1) return undefined;

  type ParsedResponse = CharacterResponse & { position: number };
  const results: ParsedResponse[] = [];

  // Match XML tags for each entity: <Name>content</Name>
  for (const entity of entities) {
    // Escape special regex chars in name
    const escapedName = entity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`<${escapedName}>([\\s\\S]*?)</${escapedName}>`, "gi");
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(response)) !== null) {
      const content = match[1].trim();
      if (content) {
        results.push({
          entityId: entity.id,
          name: entity.name,
          content,
          avatarUrl: entity.avatarUrl ?? undefined,
          position: match.index,
        });
      }
    }
  }

  // No tags found - return undefined to use single response
  if (results.length === 0) {
    return undefined;
  }

  // Sort by position in original response to maintain order
  results.sort((a, b) => a.position - b.position);

  // Remove position from results
  return results.map(({ position: _, ...rest }) => rest);
}

// =============================================================================
// Main Handler
// =============================================================================

export async function handleMessage(ctx: MessageContext): Promise<ResponseResult | null> {
  const { channelId, guildId, userId, isMentioned, respondingEntities } = ctx;

  // Separate evaluated responding entities from other raw entities
  const evaluated: EvaluatedEntity[] = respondingEntities ?? [];
  const other: EntityWithFacts[] = [];

  // Add location entities for each responding character
  const seenIds = new Set(evaluated.map(e => e.id));
  for (const entity of evaluated) {
    const locationFact = entity.facts.find(f => /^is in \[entity:(\d+)\]/.test(f));
    if (locationFact) {
      const match = locationFact.match(/^is in \[entity:(\d+)\]/);
      if (match) {
        const locationId = parseInt(match[1]);
        if (!seenIds.has(locationId)) {
          const locationEntity = getEntityWithFacts(locationId);
          if (locationEntity) {
            other.push(locationEntity);
            seenIds.add(locationId);
          }
        }
      }
    }
  }

  // Add user entity if bound
  const userEntityId = resolveDiscordEntity(userId, "user", guildId, channelId);
  if (userEntityId && !seenIds.has(userEntityId)) {
    const userEntity = getEntityWithFacts(userEntityId);
    if (userEntity) {
      other.push(userEntity);
      seenIds.add(userEntityId);
    }
  }

  // Decide whether to respond
  const shouldRespond = isMentioned || evaluated.length > 0 || other.length > 0;
  if (!shouldRespond) {
    debug("Not responding - not mentioned and no entities");
    return null;
  }

  // Get message history
  const history = getMessages(channelId, 20);

  // Build prompts
  const systemPrompt = buildSystemPrompt(evaluated, other);
  const userMessage = buildUserMessage(
    history.slice().reverse().map(m => ({ author_name: m.author_name, content: m.content }))
  );

  debug("Calling LLM", {
    respondingEntities: evaluated.length,
    otherEntities: other.length,
    historyMessages: history.length,
    systemPromptLength: systemPrompt.length,
  });

  // Track tool usage
  let factsAdded = 0;
  let factsUpdated = 0;
  let factsRemoved = 0;

  try {
    const model = getLanguageModel(DEFAULT_MODEL);

    const result = await generateText({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools,
      stopWhen: stepCountIs(5), // Allow up to 5 tool call rounds
      onStepFinish: ({ toolCalls }) => {
        for (const call of toolCalls ?? []) {
          if (call.toolName === "add_fact") factsAdded++;
          if (call.toolName === "update_fact") factsUpdated++;
          if (call.toolName === "remove_fact") factsRemoved++;
        }
      },
    });

    info("LLM response", {
      textLength: result.text.length,
      factsAdded,
      factsUpdated,
      factsRemoved,
    });

    // Parse multi-character response if multiple entities
    const characterResponses = parseMultiCharacterResponse(result.text, evaluated);

    return {
      response: result.text,
      characterResponses,
      factsAdded,
      factsUpdated,
      factsRemoved,
    };
  } catch (err) {
    error("LLM error", err);
    return null;
  }
}
