import { generateText, stepCountIs } from "ai";
import { getLanguageModel, DEFAULT_MODEL, InferenceError } from "./models";
import { debug, error } from "../logger";
import { getEntityWithFacts, type EntityWithFacts } from "../db/entities";
import { resolveDiscordEntity, getMessages } from "../db/discord";
import {
  applyStripPatterns,
  buildMessageHistory,
  DEFAULT_CONTEXT_LIMIT,
  type EvaluatedEntity,
  type MessageContext,
} from "./context";
import { expandEntityRefs, buildSystemPrompt } from "./prompt";
import { createTools } from "./tools";
import { stripNamePrefix, parseMultiEntityResponse, parseNamePrefixResponse, type EntityResponse } from "./parsing";

// =============================================================================
// Constants
// =============================================================================

/** Number of messages to fetch from DB (we'll trim by char limit) */
const MESSAGE_FETCH_LIMIT = 100;

export interface ResponseResult {
  response: string;
  entityResponses?: EntityResponse[];
  factsAdded: number;
  factsUpdated: number;
  factsRemoved: number;
  memoriesSaved: number;
  memoriesUpdated: number;
  memoriesRemoved: number;
}

// =============================================================================
// Main Handler
// =============================================================================

export async function handleMessage(ctx: MessageContext): Promise<ResponseResult | null> {
  const { channelId, guildId, userId, isMentioned, respondingEntities } = ctx;

  // Separate evaluated responding entities from other raw entities
  const evaluated: EvaluatedEntity[] = respondingEntities ?? [];
  const other: EntityWithFacts[] = [];

  // Expand {{entity:ID}} refs in facts and collect referenced entities
  const seenIds = new Set(evaluated.map(e => e.id));
  for (const entity of evaluated) {
    other.push(...expandEntityRefs(entity, seenIds));
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
  const history = getMessages(channelId, MESSAGE_FETCH_LIMIT);

  // Determine context limit from entities (first non-null wins)
  const contextLimit = evaluated.find(e => e.contextLimit !== null)?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;

  // Build prompts
  const systemPrompt = buildSystemPrompt(evaluated, other, ctx.entityMemories);
  let userMessage = buildMessageHistory(history, contextLimit);

  // Apply strip patterns to message history
  const entityStripPatterns = evaluated[0]?.stripPatterns;
  const modelSpec_ = evaluated[0]?.modelSpec ?? DEFAULT_MODEL;
  const effectiveStripPatterns = entityStripPatterns !== null
    ? entityStripPatterns
    : modelSpec_.includes("gemini-2.5-flash-preview")
      ? ["</blockquote>"]
      : [];
  if (effectiveStripPatterns.length > 0) {
    userMessage = applyStripPatterns(userMessage, effectiveStripPatterns);
  }

  debug("Calling LLM", {
    respondingEntities: evaluated.map(e => e.name),
    otherEntities: other.map(e => e.name),
    contextLimit,
    systemPrompt,
    userMessage,
  });

  // Track tool usage
  let factsAdded = 0;
  let factsUpdated = 0;
  let factsRemoved = 0;
  let memoriesSaved = 0;
  let memoriesUpdated = 0;
  let memoriesRemoved = 0;

  const modelSpec = evaluated[0]?.modelSpec ?? DEFAULT_MODEL;

  try {
    const model = getLanguageModel(modelSpec);
    const tools = createTools(channelId, guildId);

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
          if (call.toolName === "save_memory") memoriesSaved++;
          if (call.toolName === "update_memory") memoriesUpdated++;
          if (call.toolName === "remove_memory") memoriesRemoved++;
        }
      },
    });

    debug("LLM response", {
      text: result.text,
      factsAdded,
      factsUpdated,
      factsRemoved,
      memoriesSaved,
      memoriesUpdated,
      memoriesRemoved,
    });

    // Check for <none/> or "none" sentinel (LLM decided none should respond)
    const trimmedText = result.text.trim().toLowerCase();
    if (trimmedText === "<none/>" || trimmedText === "none") {
      debug("LLM returned none - no response");
      return null;
    }

    // Strip "Name:" prefix from single-entity responses
    let responseText = result.text;
    if (evaluated.length === 1) {
      responseText = stripNamePrefix(responseText, evaluated[0].name);
    }

    // Parse multi-entity response (skip if any entity has $freeform)
    const isFreeform = evaluated.some(e => e.isFreeform);
    const entityResponses = isFreeform ? undefined
      : (parseMultiEntityResponse(responseText, evaluated)
        ?? parseNamePrefixResponse(responseText, evaluated));

    return {
      response: responseText,
      entityResponses,
      factsAdded,
      factsUpdated,
      factsRemoved,
      memoriesSaved,
      memoriesUpdated,
      memoriesRemoved,
    };
  } catch (err) {
    error("LLM error", err);
    throw new InferenceError(
      err instanceof Error ? err.message : String(err),
      modelSpec,
      err,
    );
  }
}
