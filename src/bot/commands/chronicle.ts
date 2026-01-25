import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInteraction = any;

import {
  createEntryWithEmbedding,
  queryEntries,
  searchEntries,
  deleteEntry,
  getEntry,
  typeLabels,
  visibilityLabels,
  type ChronicleType,
  type Visibility,
  type ChronicleEntry,
} from "../../chronicle";
import { getActiveScene, getSceneCharacters } from "../../scene";
import { getWorldState } from "../../world/state";
import { getOptionValue, getSubcommand, USER_APP_INTEGRATION } from "./index";

/** Get the character IDs associated with a user in the current scene */
function getUserCharacterIds(sceneId: number | undefined, userId: string): number[] {
  if (!sceneId) return [];
  const sceneChars = getSceneCharacters(sceneId);
  return sceneChars
    .filter((sc) => sc.playerId === userId)
    .map((sc) => sc.characterId);
}

export const chronicleCommand: CreateApplicationCommand = {
  name: "chronicle",
  description: "Manage world memories and facts",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "remember",
      description: "Add a memory or fact",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "content",
          description: "What to remember",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "type",
          description: "Type of memory",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "Event - Something that happened", value: "event" },
            { name: "Fact - Learned information", value: "fact" },
            { name: "Dialogue - Important conversation", value: "dialogue" },
            { name: "Note - Meta/OOC note", value: "note" },
          ],
        },
        {
          name: "importance",
          description: "Importance (1-10, default 5)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 1,
          maxValue: 10,
        },
        {
          name: "visibility",
          description: "Who can know this",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "Public - Everyone knows", value: "public" },
            { name: "Private - Only you/character", value: "character" },
            { name: "Secret - GM/narrator only", value: "secret" },
          ],
        },
      ],
    },
    {
      name: "recall",
      description: "Search memories",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "query",
          description: "What to search for",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "limit",
          description: "Max results (default 5)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 1,
          maxValue: 20,
        },
      ],
    },
    {
      name: "history",
      description: "Show recent memories",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "limit",
          description: "Number of entries (default 10)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 1,
          maxValue: 50,
        },
        {
          name: "type",
          description: "Filter by type",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "Events", value: "event" },
            { name: "Facts", value: "fact" },
            { name: "Dialogue", value: "dialogue" },
            { name: "Notes", value: "note" },
            { name: "Summaries", value: "summary" },
          ],
        },
      ],
    },
    {
      name: "forget",
      description: "Remove a memory",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "id",
          description: "Memory ID to forget",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "view",
      description: "View a specific memory",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "id",
          description: "Memory ID to view",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
  ],
};

export async function handleChronicleCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const subcommand = getSubcommand(interaction);

  // Get world context
  const worldState = getWorldState(channelId);
  if (!worldState) {
    await respond(bot, interaction, "No world initialized. Use `/world init` first.");
    return;
  }

  // Get active scene if any
  const scene = getActiveScene(channelId);

  switch (subcommand) {
    case "remember": {
      const content = getOptionValue<string>(interaction, "content")!;
      const type = (getOptionValue<string>(interaction, "type") ?? "fact") as ChronicleType;
      const importance = getOptionValue<number>(interaction, "importance") ?? 5;
      const visibility = (getOptionValue<string>(interaction, "visibility") ?? "public") as Visibility;

      const entry = await createEntryWithEmbedding({
        worldId: worldState.id,
        sceneId: scene?.id,
        type,
        content,
        importance,
        visibility,
        source: "user",
        perspective: visibility === "character" ? (interaction.user?.id?.toString() ?? "shared") : "shared",
      });

      await respond(
        bot,
        interaction,
        `Remembered! (ID: ${entry.id})\n**[${typeLabels[type]}]** ${content}\nImportance: ${importance}/10 | Visibility: ${visibilityLabels[visibility]}`
      );
      break;
    }

    case "recall": {
      const query = getOptionValue<string>(interaction, "query")!;
      const limit = getOptionValue<number>(interaction, "limit") ?? 5;

      await respondDeferred(bot, interaction);

      const userId = interaction.user?.id?.toString() ?? "";
      const userCharIds = getUserCharacterIds(scene?.id, userId);

      const entries = await searchEntries({
        query,
        worldId: worldState.id,
        sceneId: scene?.id,
        limit,
        characterIds: userCharIds.length > 0 ? userCharIds : undefined,
        additionalPerspectives: userId ? [userId] : undefined,
        includeShared: true,
      });

      if (entries.length === 0) {
        await editResponse(bot, interaction, `No memories found matching "${query}".`);
        return;
      }

      let response = `**Memories matching "${query}":**\n`;
      for (const entry of entries) {
        response += formatEntry(entry);
      }

      await editResponse(bot, interaction, response);
      break;
    }

    case "history": {
      const limit = getOptionValue<number>(interaction, "limit") ?? 10;
      const typeFilter = getOptionValue<string>(interaction, "type") as ChronicleType | undefined;

      const histUserId = interaction.user?.id?.toString() ?? "";
      const histCharIds = getUserCharacterIds(scene?.id, histUserId);

      const entries = queryEntries({
        worldId: worldState.id,
        sceneId: scene?.id,
        types: typeFilter ? [typeFilter] : undefined,
        limit,
        characterIds: histCharIds.length > 0 ? histCharIds : undefined,
        additionalPerspectives: histUserId ? [histUserId] : undefined,
        includeShared: true,
      });

      if (entries.length === 0) {
        await respond(bot, interaction, "No memories recorded yet.");
        return;
      }

      let response = `**Recent Memories${typeFilter ? ` (${typeLabels[typeFilter]})` : ""}:**\n`;
      for (const entry of entries) {
        response += formatEntry(entry);
      }

      await respond(bot, interaction, response);
      break;
    }

    case "forget": {
      const id = getOptionValue<number>(interaction, "id")!;

      const entry = getEntry(id);
      if (!entry || entry.worldId !== worldState.id) {
        await respond(bot, interaction, `Memory #${id} not found.`);
        return;
      }

      deleteEntry(id);
      await respond(bot, interaction, `Forgot memory #${id}: "${truncate(entry.content, 50)}"`);
      break;
    }

    case "view": {
      const id = getOptionValue<number>(interaction, "id")!;

      const entry = getEntry(id);
      if (!entry || entry.worldId !== worldState.id) {
        await respond(bot, interaction, `Memory #${id} not found.`);
        return;
      }

      const date = new Date(entry.createdAt * 1000).toLocaleString();
      let response = `**Memory #${entry.id}**\n`;
      response += `**Type:** ${typeLabels[entry.type]}\n`;
      response += `**Visibility:** ${visibilityLabels[entry.visibility]}\n`;
      response += `**Importance:** ${entry.importance}/10\n`;
      response += `**Created:** ${date}\n`;
      response += `**Source:** ${entry.source}\n`;
      if (entry.sceneId) {
        response += `**Scene ID:** ${entry.sceneId}\n`;
      }
      response += `\n${entry.content}`;

      await respond(bot, interaction, response);
      break;
    }

    default:
      await respond(bot, interaction, "Unknown subcommand.");
  }
}

function formatEntry(entry: ChronicleEntry): string {
  const typeIcon = getTypeIcon(entry.type);
  const visIcon = entry.visibility !== "public" ? ` [${entry.visibility}]` : "";
  return `\n${typeIcon} **#${entry.id}**${visIcon}: ${truncate(entry.content, 100)}`;
}

function getTypeIcon(type: ChronicleType): string {
  switch (type) {
    case "event": return ">";
    case "fact": return "*";
    case "dialogue": return '"';
    case "thought": return "~";
    case "note": return "#";
    case "summary": return "+";
    default: return "-";
  }
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

async function respond(
  bot: AnyBot,
  interaction: AnyInteraction,
  content: string
): Promise<void> {
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: { content },
  });
}

async function respondDeferred(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 5, // DeferredChannelMessageWithSource
  });
}

async function editResponse(
  bot: AnyBot,
  interaction: AnyInteraction,
  content: string
): Promise<void> {
  await bot.helpers.editOriginalInteractionResponse(interaction.token, {
    content,
  });
}
