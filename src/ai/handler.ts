import { generateText, stepCountIs } from "ai";
import { getLanguageModel, DEFAULT_MODEL, InferenceError } from "./models";
import { debug, error } from "../logger";
import {
  type EvaluatedEntity,
  type MessageContext,
} from "./context";
import { preparePromptContext } from "./prompt";
import { createTools } from "./tools";
import { stripNamePrefix, parseMultiEntityResponse, parseNamePrefixResponse, type EntityResponse } from "./parsing";

// =============================================================================
// Types
// =============================================================================

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

  const evaluated: EvaluatedEntity[] = respondingEntities ?? [];

  // Prepare prompt context (expand refs, resolve user entity, build prompt)
  const { systemPrompt, messages: llmMessages, other, contextLimit } = preparePromptContext(
    evaluated, channelId, guildId, userId, ctx.entityMemories,
  );

  // Decide whether to respond
  const shouldRespond = isMentioned || evaluated.length > 0 || other.length > 0;
  if (!shouldRespond) {
    debug("Not responding - not mentioned and no entities");
    return null;
  }

  debug("Calling LLM", {
    respondingEntities: evaluated.map(e => e.name),
    otherEntities: other.map(e => e.name),
    contextLimit,
    systemPrompt,
    messageCount: llmMessages.length,
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
      messages: llmMessages,
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
