import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInteraction = any;
import { storeFact, retrieveRelevantFacts } from "../../memory/rag";
import { getImportantFacts, deleteFact, getFact } from "../../db/facts";
import { getMemoryStats } from "../../memory/consolidate";
import { getActiveCharacter } from "../events/message";
import { getOptionValue, getSubcommand } from "./index";

export const memoryCommand: CreateApplicationCommand = {
  name: "memory",
  description: "Manage memories and facts",
  options: [
    {
      name: "add",
      description: "Add a new memory/fact",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "content",
          description: "The memory content",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "importance",
          description: "Importance score (1-10)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 1,
          maxValue: 10,
        },
      ],
    },
    {
      name: "search",
      description: "Search memories semantically",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "query",
          description: "Search query",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "limit",
          description: "Max results",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 1,
          maxValue: 20,
        },
      ],
    },
    {
      name: "important",
      description: "List important memories",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "min_importance",
          description: "Minimum importance (default 7)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 1,
          maxValue: 10,
        },
      ],
    },
    {
      name: "forget",
      description: "Delete a memory by ID",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "id",
          description: "Memory ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "stats",
      description: "Show memory statistics",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleMemoryCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";

  switch (subcommand) {
    case "add": {
      const content = getOptionValue<string>(interaction, "content")!;
      const importance = getOptionValue<number>(interaction, "importance") ?? 5;

      // Optionally link to active character
      const activeCharacterId = getActiveCharacter(channelId);

      await respond(bot, interaction, "Storing memory...", true);

      try {
        const fact = await storeFact(content, activeCharacterId, importance);
        await editResponse(
          bot,
          interaction,
          `Stored memory (ID: ${fact.id}, importance: ${importance})`
        );
      } catch (error) {
        await editResponse(
          bot,
          interaction,
          `Failed to store memory: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
      break;
    }

    case "search": {
      const query = getOptionValue<string>(interaction, "query")!;
      const limit = getOptionValue<number>(interaction, "limit") ?? 5;

      await respond(bot, interaction, "Searching...", true);

      try {
        const results = await retrieveRelevantFacts(query, limit);

        if (results.length === 0) {
          await editResponse(bot, interaction, "No relevant memories found.");
          return;
        }

        const list = results
          .map((r, i) => {
            const score = (r.relevanceScore * 100).toFixed(0);
            return `${i + 1}. [${score}%] ${r.fact.content.slice(0, 100)}${r.fact.content.length > 100 ? "..." : ""} (ID: ${r.fact.id})`;
          })
          .join("\n");

        await editResponse(bot, interaction, `**Search Results:**\n${list}`);
      } catch (error) {
        await editResponse(
          bot,
          interaction,
          `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
      break;
    }

    case "important": {
      const minImportance =
        getOptionValue<number>(interaction, "min_importance") ?? 7;

      const facts = getImportantFacts(minImportance, 15);

      if (facts.length === 0) {
        await respond(bot, interaction, "No important memories found.");
        return;
      }

      const list = facts
        .map(
          (f) =>
            `- [${f.importance}] ${f.content.slice(0, 80)}${f.content.length > 80 ? "..." : ""} (ID: ${f.id})`
        )
        .join("\n");

      await respond(bot, interaction, `**Important Memories:**\n${list}`);
      break;
    }

    case "forget": {
      const id = getOptionValue<number>(interaction, "id")!;

      const fact = getFact(id);
      if (!fact) {
        await respond(bot, interaction, `Memory ID ${id} not found.`);
        return;
      }

      deleteFact(id);
      await respond(
        bot,
        interaction,
        `Deleted memory: "${fact.content.slice(0, 50)}..."`
      );
      break;
    }

    case "stats": {
      const stats = getMemoryStats();

      const importanceBreakdown = Object.entries(stats.byImportance)
        .map(([imp, count]) => `  ${imp}: ${count}`)
        .join("\n");

      const oldest = stats.oldestFact
        ? new Date(stats.oldestFact * 1000).toLocaleDateString()
        : "N/A";
      const newest = stats.newestFact
        ? new Date(stats.newestFact * 1000).toLocaleDateString()
        : "N/A";

      const info = [
        "**Memory Statistics:**",
        `Total facts: ${stats.totalFacts}`,
        `Oldest: ${oldest}`,
        `Newest: ${newest}`,
        "",
        "**By Importance:**",
        importanceBreakdown,
      ].join("\n");

      await respond(bot, interaction, info);
      break;
    }

    default:
      await respond(bot, interaction, "Unknown subcommand.");
  }
}

async function respond(
  bot: AnyBot,
  interaction: AnyInteraction,
  content: string,
  ephemeral = false
): Promise<void> {
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      content,
      flags: ephemeral ? 64 : 0,
    },
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
