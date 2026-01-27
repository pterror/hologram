import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { getLanguageModel, DEFAULT_MODEL } from "./models";
import { info, debug, error } from "../logger";
import {
  getEntityWithFacts,
  addFact,
  updateFactByContent,
  removeFactByContent,
  formatEntitiesForContext,
  type EntityWithFacts,
} from "../db/entities";
import {
  resolveDiscordEntity,
  getMessages,
} from "../db/discord";

// =============================================================================
// Types
// =============================================================================

export interface MessageContext {
  channelId: string;
  guildId?: string;
  userId: string;
  username: string;
  content: string;
  isMentioned: boolean;
}

export interface ResponseResult {
  response: string;
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

function buildSystemPrompt(entities: EntityWithFacts[]): string {
  if (entities.length === 0) {
    return "You are a helpful assistant. Respond naturally to the user.";
  }

  const context = formatEntitiesForContext(entities);
  return `${context}

You have access to tools to modify facts about entities. Use them when:
- Something new is learned (add_fact)
- A fact changes (update_fact)
- A fact is no longer true (remove_fact)

Respond naturally in character based on the facts provided.`;
}

function buildUserMessage(messages: Array<{ author_name: string; content: string }>): string {
  return messages.map(m => `${m.author_name}: ${m.content}`).join("\n");
}

// =============================================================================
// Main Handler
// =============================================================================

export async function handleMessage(ctx: MessageContext): Promise<ResponseResult | null> {
  const { channelId, guildId, userId, isMentioned } = ctx;

  // Resolve channel and user entities
  const channelEntityId = resolveDiscordEntity(channelId, "channel", guildId, channelId);
  const userEntityId = resolveDiscordEntity(userId, "user", guildId, channelId);

  // Gather entities for context
  const entities: EntityWithFacts[] = [];

  // Add channel entity if bound
  if (channelEntityId) {
    const channelEntity = getEntityWithFacts(channelEntityId);
    if (channelEntity) {
      entities.push(channelEntity);

      // Check if channel is in a location, add that too
      const locationFact = channelEntity.facts.find(f => f.content.match(/^is in \[entity:(\d+)\]/));
      if (locationFact) {
        const match = locationFact.content.match(/^is in \[entity:(\d+)\]/);
        if (match) {
          const locationEntity = getEntityWithFacts(parseInt(match[1]));
          if (locationEntity) entities.push(locationEntity);
        }
      }
    }
  }

  // Add user entity if bound
  if (userEntityId) {
    const userEntity = getEntityWithFacts(userEntityId);
    if (userEntity) entities.push(userEntity);
  }

  // Decide whether to respond
  const shouldRespond = isMentioned || channelEntityId !== null;
  if (!shouldRespond) {
    debug("Not responding - not mentioned and no channel binding");
    return null;
  }

  // Get message history
  const history = getMessages(channelId, 20);

  // Build prompts
  const systemPrompt = buildSystemPrompt(entities);
  const userMessage = buildUserMessage(
    history.slice().reverse().map(m => ({ author_name: m.author_name, content: m.content }))
  );

  debug("Calling LLM", {
    entities: entities.length,
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

    return {
      response: result.text,
      factsAdded,
      factsUpdated,
      factsRemoved,
    };
  } catch (err) {
    error("LLM error", err);
    return null;
  }
}
