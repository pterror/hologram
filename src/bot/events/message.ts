import { generateText } from "ai";
import { getLanguageModel, DEFAULT_MODEL } from "../../ai/models";
import {
  assembleContext,
  formatMessagesForAI,
  type Message,
} from "../../ai/context";

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

// Per-channel active character
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

export async function handleMessage(
  channelId: string,
  guildId: string | undefined,
  authorId: string,
  authorName: string,
  content: string,
  isBotMentioned: boolean
): Promise<string | null> {
  // Add user message to history
  addToHistory(channelId, {
    role: "user",
    content,
    name: authorName,
    timestamp: Date.now(),
  });

  // Check if we should respond
  const shouldRespond = isChannelEnabled(channelId) || isBotMentioned;
  if (!shouldRespond) {
    return null;
  }

  // Get active character for this channel
  const activeCharacterId = getActiveCharacter(channelId);

  // Assemble context
  const history = getChannelHistory(channelId);
  const context = assembleContext(channelId, history, activeCharacterId);

  // Call LLM
  try {
    const model = getLanguageModel(process.env.DEFAULT_MODEL || DEFAULT_MODEL);

    const result = await generateText({
      model,
      system: context.systemPrompt || "You are a helpful assistant in a roleplay scenario.",
      messages: formatMessagesForAI(context.messages),
    });

    const response = result.text;

    // Add assistant response to history
    addToHistory(channelId, {
      role: "assistant",
      content: response,
      timestamp: Date.now(),
    });

    return response;
  } catch (error) {
    console.error("Error generating response:", error);
    return null;
  }
}

// Clear history for a channel
export function clearHistory(channelId: string): void {
  channelMessages.delete(channelId);
}
