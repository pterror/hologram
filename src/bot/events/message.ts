import { generateText } from "ai";
import { getLanguageModel, DEFAULT_MODEL } from "../../ai/models";
import {
  assembleContext,
  assembleSceneContext,
  formatMessagesForAI,
  type Message,
} from "../../ai/context";
import { processMessageForMemory } from "../../memory/tiers";
import { getActiveScene, getActiveCharacters, touchScene } from "../../scene";
import { parseProxyMessage, formatProxyForContext } from "../../proxies";
import { getPersona, formatPersonaForContext } from "../../personas";
import { getWorldConfig } from "../../config";
import { syncRealtimeIfNeeded, buildTimeSkipNarrationPrompt } from "../../world/time";
import { checkRandomEvents, applyEventEffects } from "../../events/random";
import { parseMultiCharResponse, type MultiCharMode } from "../webhooks";
import { getEntity, type CharacterData } from "../../db/entities";

// In-memory message history per channel
const channelMessages = new Map<string, Message[]>();
const MAX_HISTORY = 50;

// Channel configuration (which channels the bot responds in)
const activeChannels = new Set<string>();

export function enableChannel(channelId: string): void {
  activeChannels.add(channelId);
}

export function disableChannel(channelId: string): void {
  activeChannels.delete(channelId);
}

export function isChannelEnabled(channelId: string): boolean {
  return activeChannels.has(channelId);
}

// Get or initialize message history for a channel
function getChannelHistory(channelId: string): Message[] {
  let history = channelMessages.get(channelId);
  if (!history) {
    history = [];
    channelMessages.set(channelId, history);
  }
  return history;
}

// Add message to history
function addToHistory(channelId: string, message: Message): void {
  const history = getChannelHistory(channelId);
  history.push(message);
  // Trim to max size
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

// Per-channel active character (legacy fallback for sceneless channels)
const channelActiveCharacter = new Map<string, number>();

export function setActiveCharacter(
  channelId: string,
  characterId: number
): void {
  channelActiveCharacter.set(channelId, characterId);
}

export function getActiveCharacter(channelId: string): number | undefined {
  return channelActiveCharacter.get(channelId);
}

/** Per-character segment of a multi-character response */
export interface CharacterSegment {
  characterId: number;
  characterName: string;
  content: string;
}

/** Result from message handling, may include time-skip narration */
export interface MessageResult {
  response: string;
  narration?: string; // Time-skip narration to send as a separate message before the response
  segments?: CharacterSegment[]; // Parsed per-character segments for webhook delivery
  multiCharMode?: MultiCharMode; // Delivery mode for multi-char responses
}

export async function handleMessage(
  channelId: string,
  guildId: string | undefined,
  authorId: string,
  authorName: string,
  content: string,
  isBotMentioned: boolean
): Promise<MessageResult | null> {
  // Get active scene (if any)
  const scene = getActiveScene(channelId);
  const worldId = scene?.worldId;
  const gameTime = scene ? { ...scene.time } : undefined;

  // --- Proxy interception ---
  // Check if message matches a proxy pattern (e.g., "a: Hello" or "[Hello]")
  let effectiveName = authorName;
  let effectiveContent = content;
  let userContext: string | undefined;

  const proxyMatch = parseProxyMessage(authorId, content, worldId);
  if (proxyMatch) {
    effectiveName = proxyMatch.proxy.name;
    effectiveContent = proxyMatch.content;
    userContext = formatProxyForContext(proxyMatch.proxy);
  } else {
    // No proxy - check for user persona
    const persona = getPersona(authorId, worldId);
    if (persona) {
      effectiveName = persona.name;
      userContext = formatPersonaForContext(persona);
    }
  }

  // Add user message to history (with proxy-rewritten attribution)
  addToHistory(channelId, {
    role: "user",
    content: effectiveContent,
    name: effectiveName,
    timestamp: Date.now(),
    gameTime,
  });

  // Check if we should respond
  const shouldRespond = isChannelEnabled(channelId) || isBotMentioned;
  if (!shouldRespond) {
    return null;
  }

  // --- Realtime sync: auto-advance game time based on real-time gap ---
  const narrationParts: string[] = [];
  const worldConfig = scene ? getWorldConfig(scene.worldId) : undefined;

  if (scene && worldConfig) {
    const syncResult = syncRealtimeIfNeeded(scene, worldConfig);

    if (syncResult.advanced) {
      // Generate time-skip narration if configured and gap is significant
      const narrationPrompt = buildTimeSkipNarrationPrompt(scene, syncResult, worldConfig);
      if (narrationPrompt) {
        try {
          const model = getLanguageModel(process.env.DEFAULT_MODEL || DEFAULT_MODEL);
          const narrationResult = await generateText({
            model,
            system: narrationPrompt,
            messages: [{ role: "user", content: "Narrate the passage of time." }],
          });
          narrationParts.push(narrationResult.text);
        } catch (err) {
          console.error("Error generating time-skip narration:", err);
        }
      }

      // Check random events triggered by time advancement
      const timeEvents = checkRandomEvents(scene, "time_advance", worldConfig);
      for (const event of timeEvents) {
        applyEventEffects(scene, event.entry);
        narrationParts.push(event.entry.content);
      }
    }

    // Check random events triggered per-message (independent of time sync)
    const messageEvents = checkRandomEvents(scene, "message", worldConfig);
    for (const event of messageEvents) {
      applyEventEffects(scene, event.entry);
      narrationParts.push(event.entry.content);
    }

    // Record combined narration in history
    if (narrationParts.length > 0) {
      addToHistory(channelId, {
        role: "assistant",
        content: `*${narrationParts.join("\n\n")}*`,
        timestamp: Date.now(),
        gameTime: syncResult.advanced ? syncResult.newTime : scene.time,
      });
    }
  }

  const narration = narrationParts.length > 0 ? narrationParts.join("\n\n") : undefined;

  // --- Determine active AI character IDs ---
  let activeCharacterIds: number[] = [];

  if (scene) {
    // Scene system: get AI characters being voiced
    const activeChars = getActiveCharacters(scene.id);
    activeCharacterIds = activeChars.map((c) => c.characterId);
  }

  // Legacy fallback: per-channel character map
  if (activeCharacterIds.length === 0) {
    const legacyCharId = channelActiveCharacter.get(channelId);
    if (legacyCharId !== undefined) {
      activeCharacterIds = [legacyCharId];
    }
  }

  // --- Assemble context ---
  const history = getChannelHistory(channelId);

  let context;
  if (scene) {
    // Scene-aware context assembly (Phase 7+)
    context = await assembleSceneContext(channelId, history, activeCharacterIds, {
      userContext,
    });
  } else {
    // Legacy context assembly
    context = await assembleContext(
      channelId,
      history,
      activeCharacterIds[0],
    );
  }

  // --- Call LLM ---
  try {
    const model = getLanguageModel(process.env.DEFAULT_MODEL || DEFAULT_MODEL);

    const result = await generateText({
      model,
      system: context.systemPrompt || "You are a helpful assistant in a roleplay scenario.",
      messages: formatMessagesForAI(context.messages),
    });

    const response = result.text;

    // Add assistant response to history (re-read scene time - may have advanced during LLM call)
    const currentScene = getActiveScene(channelId);
    addToHistory(channelId, {
      role: "assistant",
      content: response,
      timestamp: Date.now(),
      gameTime: currentScene ? { ...currentScene.time } : gameTime,
    });

    // Touch scene lastActiveAt (lightweight - only updates timestamp)
    if (currentScene) {
      touchScene(currentScene.id);
    }

    // Process for memory extraction (fire and forget)
    processMessageForMemory(
      channelId,
      effectiveContent,
      response,
      activeCharacterIds[0]
    ).catch((err) => console.error("Error processing message for memory:", err));

    // Parse multi-character response for webhook delivery
    let segments: CharacterSegment[] | undefined;
    const multiCharMode = worldConfig?.multiCharMode;

    if (activeCharacterIds.length > 1) {
      // Build name→ID map for active characters
      const nameToId = new Map<string, number>();
      for (const charId of activeCharacterIds) {
        const charEntity = getEntity<CharacterData>(charId);
        if (charEntity) {
          nameToId.set(charEntity.name, charId);
        }
      }

      const parsed = parseMultiCharResponse(response, Array.from(nameToId.keys()));
      if (parsed) {
        segments = parsed.map((seg) => ({
          characterId: nameToId.get(seg.characterName) ?? activeCharacterIds[0],
          characterName: seg.characterName,
          content: seg.content,
        }));
      }
    } else if (activeCharacterIds.length === 1) {
      // Single character - create segment for webhook delivery
      const charEntity = getEntity<CharacterData>(activeCharacterIds[0]);
      if (charEntity) {
        segments = [{
          characterId: activeCharacterIds[0],
          characterName: charEntity.name,
          content: response,
        }];
      }
    }

    return { response, narration, segments, multiCharMode };
  } catch (error) {
    console.error("Error generating response:", error);
    return null;
  }
}

// Clear history for a channel
export function clearHistory(channelId: string): void {
  channelMessages.delete(channelId);
}
