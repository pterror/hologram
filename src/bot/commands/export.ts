import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { getOptionValue, getSubcommand, respond, respondDeferred, editResponse, USER_APP_INTEGRATION } from "./index";
import { findEntityByName, type CharacterData } from "../../db/entities";
import { getWorldState } from "../../world/state";
import {
  exportCharacter,
  exportWorldFull,
  exportChronicle,
  type CharacterExportFormat,
  type CCv2ComplianceLevel,
} from "../../export";

export const exportCommand: CreateApplicationCommand = {
  name: "export",
  description: "Export data from Hologram",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "character",
      description: "Export a character",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Character name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "format",
          description: "Export format",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "CCv2 (Standard)", value: "ccv2" },
            { name: "CCv2 Extended", value: "ccv2-extended" },
            { name: "Hologram Native", value: "hologram" },
          ],
        },
        {
          name: "compliance",
          description: "CCv2 compliance level (ccv2 format only)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "Strict (spec only)", value: "strict" },
            { name: "Lenient (common extensions)", value: "lenient" },
            { name: "Extended (full Hologram data)", value: "extended" },
          ],
        },
      ],
    },
    {
      name: "world",
      description: "Export entire world",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "include_chronicle",
          description: "Include memory/chronicle entries",
          type: ApplicationCommandOptionTypes.Boolean,
          required: false,
        },
        {
          name: "include_facts",
          description: "Include facts/memories",
          type: ApplicationCommandOptionTypes.Boolean,
          required: false,
        },
      ],
    },
    {
      name: "chronicle",
      description: "Export memories/chronicle as JSONL",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "scene_id",
          description: "Filter to specific scene",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
        },
      ],
    },
  ],
};

export async function handleExportCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";
  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";

  // Get user's guilds for permission checking
  const guildId = interaction.guildId?.toString();
  const userGuilds = guildId ? [guildId] : [];

  // Get world context
  const worldState = getWorldState(channelId);

  switch (subcommand) {
    case "character": {
      const name = getOptionValue<string>(interaction, "name")!;
      const format = (getOptionValue<string>(interaction, "format") ?? "hologram") as CharacterExportFormat;
      const compliance = (getOptionValue<string>(interaction, "compliance") ?? "lenient") as CCv2ComplianceLevel;

      // Find character
      const character = findEntityByName<CharacterData>(
        name,
        "character",
        worldState?.id
      );

      if (!character) {
        await respond(bot, interaction, `Character "${name}" not found.`);
        return;
      }

      // Defer response for potentially long export
      await respondDeferred(bot, interaction);

      // Export
      const result = await exportCharacter(character.id, userId, userGuilds, {
        format,
        compliance,
        includeState: true,
        includeEffects: true,
        includeRelationships: true,
        includeFactions: true,
        includeImages: true,
      });

      if (!result.success) {
        await editResponse(bot, interaction, `Export failed: ${result.error}`);
        return;
      }

      // Format response
      if (result.url?.startsWith("```")) {
        // Data embedded in code block (no S3)
        let message = `**Exported ${name}** (${format}):\n${result.url}`;
        if (result.error) {
          message += `\n\n*${result.error}*`;
        }
        await editResponse(bot, interaction, message);
      } else {
        // S3 URL
        await editResponse(
          bot,
          interaction,
          `**Exported ${name}** (${format}):\n${result.url}\n\n*File size: ${formatBytes(result.size ?? 0)}*`
        );
      }
      break;
    }

    case "world": {
      if (!worldState) {
        await respond(bot, interaction, "No world active in this channel. Use `/setup` first.");
        return;
      }

      const includeChronicle = getOptionValue<boolean>(interaction, "include_chronicle") ?? false;
      const includeFacts = getOptionValue<boolean>(interaction, "include_facts") ?? false;

      // Defer response
      await respondDeferred(bot, interaction);

      // Export
      const result = await exportWorldFull(worldState.id, userId, userGuilds, {
        includeChronicle,
        includeFacts,
      });

      if (!result.success) {
        await editResponse(bot, interaction, `Export failed: ${result.error}`);
        return;
      }

      // Format response
      if (result.url?.startsWith("```")) {
        let message = `**Exported world "${worldState.name}"**:\n${result.url}`;
        if (result.error) {
          message += `\n\n*${result.error}*`;
        }
        await editResponse(bot, interaction, message);
      } else {
        await editResponse(
          bot,
          interaction,
          `**Exported world "${worldState.name}"**:\n${result.url}\n\n*File size: ${formatBytes(result.size ?? 0)}*`
        );
      }
      break;
    }

    case "chronicle": {
      if (!worldState) {
        await respond(bot, interaction, "No world active in this channel. Use `/setup` first.");
        return;
      }

      const sceneId = getOptionValue<number>(interaction, "scene_id");

      // Defer response
      await respondDeferred(bot, interaction);

      // Export
      const result = await exportChronicle(worldState.id, userId, userGuilds, {
        sceneId,
      });

      if (!result.success) {
        await editResponse(bot, interaction, `Export failed: ${result.error}`);
        return;
      }

      // Format response
      if (result.url?.startsWith("```")) {
        let message = `**Exported chronicle** (${result.filename}):\n${result.url}`;
        if (result.error) {
          message += `\n\n*${result.error}*`;
        }
        await editResponse(bot, interaction, message);
      } else {
        await editResponse(
          bot,
          interaction,
          `**Exported chronicle** (${result.filename}):\n${result.url}\n\n*File size: ${formatBytes(result.size ?? 0)}*`
        );
      }
      break;
    }

    default:
      await respond(bot, interaction, "Unknown export subcommand.");
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
