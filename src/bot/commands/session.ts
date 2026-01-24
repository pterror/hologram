import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInteraction = any;
import {
  enableChannel,
  disableChannel,
  isChannelEnabled,
  clearHistory,
  getActiveCharacter,
} from "../events/message";
import { getWorldState } from "../../world/state";
import {
  getSessionMemory,
  clearSession,
  setSceneDescription,
  formatSessionDebug,
} from "../../memory/tiers";
import { assembleContext } from "../../ai/context";
import { debugContext, formatDebugInfo } from "../../ai/debug";
import { getOptionValue, getSubcommand } from "./index";

export const sessionCommand: CreateApplicationCommand = {
  name: "session",
  description: "Manage RP session",
  options: [
    {
      name: "enable",
      description: "Enable bot responses in this channel",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "disable",
      description: "Disable bot responses in this channel",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "status",
      description: "Show session status",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "clear",
      description: "Clear session history and state",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "scene",
      description: "Set scene description",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "description",
          description: "Scene description",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "debug",
      description: "Show context debug info",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleSessionCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";

  switch (subcommand) {
    case "enable": {
      enableChannel(channelId);
      await respond(
        bot,
        interaction,
        "Bot responses **enabled** for this channel."
      );
      break;
    }

    case "disable": {
      disableChannel(channelId);
      await respond(
        bot,
        interaction,
        "Bot responses **disabled** for this channel."
      );
      break;
    }

    case "status": {
      const enabled = isChannelEnabled(channelId);
      const activeCharId = getActiveCharacter(channelId);
      const worldState = getWorldState(channelId);
      const session = getSessionMemory(channelId);

      const lines = [
        "**Session Status:**",
        `Channel enabled: ${enabled ? "Yes" : "No"}`,
        `Active character ID: ${activeCharId ?? "None"}`,
        `World initialized: ${worldState ? worldState.name : "No"}`,
        `Scene: ${session.sceneDescription ?? "Not set"}`,
        `Recent events: ${session.recentEvents.length}`,
        `Session notes: ${session.tempFacts.length}`,
      ];

      await respond(bot, interaction, lines.join("\n"));
      break;
    }

    case "clear": {
      clearHistory(channelId);
      clearSession(channelId);
      await respond(
        bot,
        interaction,
        "Cleared message history and session state."
      );
      break;
    }

    case "scene": {
      const description = getOptionValue<string>(interaction, "description")!;
      setSceneDescription(channelId, description);
      await respond(bot, interaction, `Scene set: ${description}`);
      break;
    }

    case "debug": {
      await respond(bot, interaction, "Assembling context for debug...", true);

      try {
        const activeCharId = getActiveCharacter(channelId);
        // Assemble context with empty messages just to see system prompt
        const context = await assembleContext(channelId, [], activeCharId);
        const debugInfo = debugContext(context);
        const formatted = formatDebugInfo(debugInfo);

        // Add session debug
        const sessionDebug = formatSessionDebug(channelId);

        await editResponse(
          bot,
          interaction,
          `\`\`\`\n${formatted}\n\nSession:\n${sessionDebug}\n\`\`\``
        );
      } catch (error) {
        await editResponse(
          bot,
          interaction,
          `Debug failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
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
