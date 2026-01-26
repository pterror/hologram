/**
 * /import Command
 *
 * Import characters from various formats:
 * - URL (JSON, PNG with embedded data, CharX ZIP)
 * - Discord attachment
 */

import { ApplicationCommandOptionTypes } from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";
import { getSubcommand, getOptionValue, respond, respondDeferred, editResponse } from "./index";
import { USER_APP_INTEGRATION } from "./integration";
import { importFromUrl, importFromJson, type ImportFormat } from "../../import";
import { getWorldState } from "../../world/state";

export const importCommand = {
  name: "import",
  description: "Import characters from various formats",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "url",
      description: "Import a character from a URL",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "url",
          description: "URL to import from (JSON, PNG, or CharX)",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "format",
          description: "Force a specific format (default: auto-detect)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "Auto-detect", value: "auto" },
            { name: "CCv1 (TavernAI V1)", value: "ccv1" },
            { name: "CCv2 (Character Card V2)", value: "ccv2" },
            { name: "CharX (ZIP)", value: "charx" },
            { name: "Hologram", value: "hologram" },
          ],
        },
      ],
    },
    {
      name: "attachment",
      description: "Import a character from an attached file",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "file",
          description: "Character file (JSON, PNG, or CharX)",
          type: ApplicationCommandOptionTypes.Attachment,
          required: true,
        },
        {
          name: "format",
          description: "Force a specific format (default: auto-detect)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "Auto-detect", value: "auto" },
            { name: "CCv1 (TavernAI V1)", value: "ccv1" },
            { name: "CCv2 (Character Card V2)", value: "ccv2" },
            { name: "CharX (ZIP)", value: "charx" },
            { name: "Hologram", value: "hologram" },
          ],
        },
      ],
    },
    {
      name: "json",
      description: "Import a character from raw JSON",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "json",
          description: "Character JSON data",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "format",
          description: "Force a specific format (default: auto-detect)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "Auto-detect", value: "auto" },
            { name: "CCv1 (TavernAI V1)", value: "ccv1" },
            { name: "CCv2 (Character Card V2)", value: "ccv2" },
            { name: "Hologram", value: "hologram" },
          ],
        },
      ],
    },
  ],
};

export async function handleImportCommand(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";
  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";

  // Get world for this channel
  const world = getWorldState(channelId);
  const worldId = world?.id;

  switch (subcommand) {
    case "url": {
      const url = getOptionValue<string>(interaction, "url")!;
      const format = getOptionValue<string>(interaction, "format") as ImportFormat | undefined;

      // Validate URL
      try {
        new URL(url);
      } catch {
        await respond(bot, interaction, "Invalid URL provided.", true);
        return;
      }

      // Defer since import may take time
      await respondDeferred(bot, interaction);

      const result = await importFromUrl(url, {
        format,
        worldId,
        creatorId: userId,
      });

      if (result.success) {
        let msg = `Imported **${result.characterName}** (ID: ${result.characterId})`;
        if (result.format) {
          msg += ` from ${result.format.toUpperCase()} format`;
        }
        if (result.warnings && result.warnings.length > 0) {
          msg += `\n\nWarnings:\n${result.warnings.map((w) => `- ${w}`).join("\n")}`;
        }
        await editResponse(bot, interaction, msg);
      } else {
        await editResponse(bot, interaction, `Import failed: ${result.error}`);
      }
      break;
    }

    case "attachment": {
      const fileId = getOptionValue<string>(interaction, "file");
      const format = getOptionValue<string>(interaction, "format") as ImportFormat | undefined;

      // Get attachment from resolved data
      const resolved = interaction.data?.resolved;
      const attachments = resolved?.attachments;

      if (!attachments || !fileId) {
        await respond(bot, interaction, "No file attached.", true);
        return;
      }

      // Find the attachment - attachments is a Collection, iterate values
      let attachmentUrl: string | undefined;
      for (const attachment of attachments.values()) {
        // Access attachment properties via raw data
        const attachmentData = attachment as unknown as { url?: string };
        if (attachmentData.url) {
          attachmentUrl = attachmentData.url;
          break;
        }
      }

      if (!attachmentUrl) {
        await respond(bot, interaction, "Could not retrieve attachment URL.", true);
        return;
      }

      // Defer since import may take time
      await respondDeferred(bot, interaction);

      const result = await importFromUrl(attachmentUrl, {
        format,
        worldId,
        creatorId: userId,
      });

      if (result.success) {
        let msg = `Imported **${result.characterName}** (ID: ${result.characterId})`;
        if (result.format) {
          msg += ` from ${result.format.toUpperCase()} format`;
        }
        if (result.warnings && result.warnings.length > 0) {
          msg += `\n\nWarnings:\n${result.warnings.map((w) => `- ${w}`).join("\n")}`;
        }
        await editResponse(bot, interaction, msg);
      } else {
        await editResponse(bot, interaction, `Import failed: ${result.error}`);
      }
      break;
    }

    case "json": {
      const json = getOptionValue<string>(interaction, "json")!;
      const format = getOptionValue<string>(interaction, "format") as ImportFormat | undefined;

      const result = importFromJson(json, {
        format,
        worldId,
        creatorId: userId,
      });

      if (result.success) {
        let msg = `Imported **${result.characterName}** (ID: ${result.characterId})`;
        if (result.format) {
          msg += ` from ${result.format.toUpperCase()} format`;
        }
        await respond(bot, interaction, msg);
      } else {
        await respond(bot, interaction, `Import failed: ${result.error}`, true);
      }
      break;
    }

    default:
      await respond(bot, interaction, "Unknown subcommand.", true);
  }
}
