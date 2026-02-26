/**
 * Debug functions for fact evaluation tracing.
 *
 * Pure functions returning structured data — no Discord dependencies.
 */

import {
  evaluateFacts,
  createBaseContext,
  parseFact,
  evalExpr,
  stripComments,
  ExprError,
  type ExprContext,
  type EvaluatedFacts,
} from "../logic/expr";
import type { EvaluatedEntity } from "../ai/context";
import {
  getEntityWithFacts,
  getEntityEvalDefaults,
  type EntityWithFacts,
} from "../db/entities";
import {
  getChannelScopedEntities,
  getGuildScopedEntities,
  countUnreadMessages,
} from "../db/discord";

// =============================================================================
// Types
// =============================================================================

export interface FactTrace {
  raw: string;
  conditional: boolean;
  expression: string | null;
  expressionResult: boolean | null;
  expressionError: string | null;
  category: string;
  included: boolean;
}

export interface EntityTrace {
  entityId: number;
  entityName: string;
  traces: FactTrace[];
  evaluated: EvaluatedFacts;
}

export interface ResponseSimulation {
  entityId: number;
  entityName: string;
  shouldRespond: boolean;
  respondSource: string | null;
  reason: string;
}

// =============================================================================
// Shared: buildEvaluatedEntity
// =============================================================================

/**
 * Build an EvaluatedEntity from a raw entity using a pre-built expression context.
 * Shared between Discord commands and CLI debug tools.
 */
export function buildEvaluatedEntity(
  entity: EntityWithFacts,
  ctx: ExprContext,
): EvaluatedEntity {
  const rawFacts = entity.facts.map(f => f.content);
  const defaults = getEntityEvalDefaults(entity.id);
  const result = evaluateFacts(rawFacts, ctx, defaults);
  return {
    id: entity.id,
    name: entity.name,
    facts: result.facts,
    avatarUrl: result.avatarUrl,
    streamMode: result.streamMode,
    streamDelimiter: result.streamDelimiter,
    memoryScope: result.memoryScope,
    contextExpr: result.contextExpr,
    isFreeform: result.isFreeform,
    modelSpec: result.modelSpec,
    stripPatterns: result.stripPatterns,
    thinkingLevel: result.thinkingLevel,
    template: entity.template,
    systemTemplate: entity.system_template,
    exprContext: ctx,
  };
}

// =============================================================================
// Tracing
// =============================================================================

function categorize(raw: string): string {
  const parsed = parseFact(raw);
  if (parsed.isRespond) return "$respond";
  if (parsed.isRetry) return "$retry";
  if (parsed.isAvatar) return "$avatar";
  if (parsed.isLockedDirective || parsed.isLockedFact) return "$locked";
  if (parsed.isStream) return "$stream";
  if (parsed.isMemory) return "$memory";
  if (parsed.isContext) return "$context";
  if (parsed.isFreeform) return "$freeform";
  if (parsed.isModel) return "$model";
  if (parsed.isStrip) return "$strip";
  if (parsed.isThinking) return "$thinking";
  return "fact";
}

/**
 * Trace fact evaluation for an entity, showing per-fact $if results.
 */
export function traceFacts(
  entityId: number,
  channelId: string,
  _guildId?: string,
): EntityTrace | null {
  const entity = getEntityWithFacts(entityId);
  if (!entity) return null;

  const rawFacts = entity.facts.map(f => f.content);
  const defaults = getEntityEvalDefaults(entityId);
  const mockContext = createBaseContext({
    facts: rawFacts,
    has_fact: (pattern: string) => rawFacts.some(f => new RegExp(pattern, "i").test(f)),
    messages: () => "",
    response_ms: 0,
    retry_ms: 0,
    idle_ms: 0,
    unread_count: countUnreadMessages(channelId, entityId),
    mentioned: false,
    replied: false,
    replied_to: "",
    is_forward: false,
    is_self: false,
    is_hologram: false,
    interaction_type: "",
    name: entity.name,
    chars: [],
    channel: { id: channelId, name: "", description: "", is_nsfw: false, type: "text", mention: "" },
    server: { id: "", name: "", description: "", nsfw_level: "default" },
  });

  const uncommented = stripComments(rawFacts);
  const traces: FactTrace[] = [];

  for (const fact of uncommented) {
    const parsed = parseFact(fact);
    let expressionResult: boolean | null = null;
    let expressionError: string | null = null;

    if (parsed.conditional && parsed.expression) {
      try {
        expressionResult = evalExpr(parsed.expression, mockContext);
      } catch (err) {
        expressionError = err instanceof ExprError ? err.message : String(err);
        expressionResult = false;
      }
    }

    const included = parsed.conditional ? (expressionResult ?? false) : true;

    traces.push({
      raw: fact,
      conditional: parsed.conditional,
      expression: parsed.expression ?? null,
      expressionResult,
      expressionError,
      category: categorize(fact),
      included,
    });
  }

  let evaluated: EvaluatedFacts;
  try {
    evaluated = evaluateFacts(rawFacts, mockContext, defaults);
  } catch {
    // If evaluation throws (e.g. bad $if expression), return partial result
    evaluated = {
      facts: traces.filter(t => t.included && t.category === "fact").map(t => t.raw),
      shouldRespond: null,
      respondSource: null,
      retryMs: null,
      avatarUrl: null,
      isLocked: false,
      lockedFacts: new Set(),
      streamMode: null,
      streamDelimiter: null,
      memoryScope: "none",
      contextExpr: null,
      isFreeform: false,
      modelSpec: null,
      stripPatterns: null,
      thinkingLevel: null,
    };
  }

  return {
    entityId,
    entityName: entity.name,
    traces,
    evaluated,
  };
}

/**
 * Simulate which entities would respond in a channel.
 */
export function simulateResponse(
  channelId: string,
  guildId?: string,
): ResponseSimulation[] {
  const results: ResponseSimulation[] = [];

  // Gather all entity IDs that could respond
  const channelEntityIds = getChannelScopedEntities(channelId);
  const guildEntityIds = guildId ? getGuildScopedEntities(guildId) : [];
  const allIds = [...new Set([...channelEntityIds, ...guildEntityIds])];

  for (const entityId of allIds) {
    const entity = getEntityWithFacts(entityId);
    if (!entity) continue;

    const rawFacts = entity.facts.map(f => f.content);
    const defaults = getEntityEvalDefaults(entityId);
    const mockContext = createBaseContext({
      facts: rawFacts,
      has_fact: (pattern: string) => rawFacts.some(f => new RegExp(pattern, "i").test(f)),
      messages: () => "",
      response_ms: 0,
      retry_ms: 0,
      idle_ms: 0,
      unread_count: countUnreadMessages(channelId, entityId),
      mentioned: false,
      replied: false,
      replied_to: "",
      is_forward: false,
      is_self: false,
      is_hologram: false,
      interaction_type: "",
      name: entity.name,
      chars: [],
      channel: { id: channelId, name: "", description: "", is_nsfw: false, type: "text", mention: "" },
      server: { id: "", name: "", description: "", nsfw_level: "default" },
    });

    const evaluated = evaluateFacts(rawFacts, mockContext, defaults);

    let reason: string;
    if (evaluated.shouldRespond === null) {
      reason = "no $respond directive (default: true)";
    } else if (evaluated.respondSource) {
      reason = `set by: ${evaluated.respondSource}`;
    } else {
      reason = evaluated.shouldRespond ? "default: true" : "default: false";
    }

    results.push({
      entityId,
      entityName: entity.name,
      shouldRespond: evaluated.shouldRespond ?? true,
      respondSource: evaluated.respondSource,
      reason,
    });
  }

  return results;
}
