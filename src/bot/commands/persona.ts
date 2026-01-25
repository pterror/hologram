import {
  type Bot,
  type Interaction,
  InteractionResponseTypes,
  ApplicationCommandOptionTypes,
  DiscordApplicationIntegrationType,
  DiscordInteractionContextType,
} from "@discordeno/bot";
import { getActiveScene } from "../../scene";
import {
  getPersona,
  setPersona,
  updatePersonaText,
  updatePersonaAvatar,
  clearPersona,
  listPersonas,
} from "../../personas";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyBot = Bot<any, any>;
type AnyInteraction = Interaction;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const personaCommand = {
  name: "persona",
  description: "Manage your user persona (how the AI sees you)",
  integrationTypes: [
    DiscordApplicationIntegrationType.GuildInstall,
    DiscordApplicationIntegrationType.UserInstall,
  ],
  contexts: [
    DiscordInteractionContextType.Guild,
    DiscordInteractionContextType.BotDm,
  ],
  options: [
    {
      name: "show",
      description: "Show your current persona",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "set",
      description: "Set your persona name and description",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Your character/persona name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "description",
          description: "Description of your persona (appearance, personality, etc.)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
        {
          name: "world_specific",
          description: "Only apply to the current world (default: global)",
          type: ApplicationCommandOptionTypes.Boolean,
          required: false,
        },
      ],
    },
    {
      name: "describe",
      description: "Update just the description of your existing persona",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "text",
          description: "Your persona description",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "avatar",
      description: "Set your persona avatar URL",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "url",
          description: "Avatar image URL",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "clear",
      description: "Remove your persona",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "world_specific",
          description: "Only clear the world-specific persona",
          type: ApplicationCommandOptionTypes.Boolean,
          required: false,
        },
      ],
    },
    {
      name: "list",
      description: "List all your personas across worlds",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

function getSubOpt<T>(interaction: AnyInteraction, name: string): T | undefined {
  const options = interaction.data?.options ?? [];
  if (options.length === 0) return undefined;
  const sub = options[0];
  if (!sub.options) return undefined;
  const opt = sub.options.find((o: { name: string }) => o.name === name);
  return opt?.value as T | undefined;
}

export async function handlePersonaCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";
  const subcommand = interaction.data?.options?.[0]?.name;

  const scene = getActiveScene(channelId);
  const worldId = scene?.worldId ?? null;

  const respond = async (content: string, ephemeral = false) => {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content, flags: ephemeral ? 64 : 0 },
    });
  };

  switch (subcommand) {
    case "show": {
      const persona = getPersona(userId, worldId);
      if (!persona) {
        await respond(
          "You don't have a persona set. Use `/persona set <name>` to create one.",
          true
        );
        return;
      }

      const lines: string[] = [];
      lines.push(`**Your Persona:** ${persona.name}`);
      if (persona.worldId) {
        lines.push(`*(World-specific)*`);
      } else {
        lines.push(`*(Global)*`);
      }
      if (persona.persona) {
        lines.push(`\n${persona.persona}`);
      }
      if (persona.avatar) {
        lines.push(`\nAvatar: ${persona.avatar}`);
      }

      await respond(lines.join("\n"), true);
      return;
    }

    case "set": {
      const name = getSubOpt<string>(interaction, "name")!;
      const description = getSubOpt<string>(interaction, "description");
      const worldSpecific = getSubOpt<boolean>(interaction, "world_specific") ?? false;

      const targetWorldId = worldSpecific ? worldId : null;

      if (worldSpecific && !worldId) {
        await respond("No active world in this channel. Cannot create world-specific persona.", true);
        return;
      }

      const persona = setPersona(userId, name, {
        worldId: targetWorldId,
        persona: description ?? undefined,
      });

      let msg = `Persona set: **${persona.name}**`;
      if (targetWorldId) {
        msg += " *(world-specific)*";
      } else {
        msg += " *(global)*";
      }
      if (description) {
        msg += `\n${description}`;
      }

      await respond(msg, true);
      return;
    }

    case "describe": {
      const text = getSubOpt<string>(interaction, "text")!;

      // Try world-specific first, then global
      let updated = false;
      if (worldId) {
        updated = updatePersonaText(userId, text, worldId);
      }
      if (!updated) {
        updated = updatePersonaText(userId, text);
      }

      if (!updated) {
        await respond(
          "No persona found to update. Use `/persona set <name>` first.",
          true
        );
        return;
      }

      await respond("Persona description updated.", true);
      return;
    }

    case "avatar": {
      const url = getSubOpt<string>(interaction, "url")!;

      let updated = false;
      if (worldId) {
        updated = updatePersonaAvatar(userId, url, worldId);
      }
      if (!updated) {
        updated = updatePersonaAvatar(userId, url);
      }

      if (!updated) {
        await respond(
          "No persona found to update. Use `/persona set <name>` first.",
          true
        );
        return;
      }

      await respond("Persona avatar updated.", true);
      return;
    }

    case "clear": {
      const worldSpecific = getSubOpt<boolean>(interaction, "world_specific") ?? false;

      let cleared;
      if (worldSpecific && worldId) {
        cleared = clearPersona(userId, worldId);
      } else {
        cleared = clearPersona(userId);
      }

      if (cleared) {
        await respond(
          worldSpecific ? "World-specific persona cleared." : "Global persona cleared.",
          true
        );
      } else {
        await respond("No persona found to clear.", true);
      }
      return;
    }

    case "list": {
      const personas = listPersonas(userId);
      if (personas.length === 0) {
        await respond("You have no personas. Use `/persona set <name>` to create one.", true);
        return;
      }

      const lines = ["**Your Personas:**\n"];
      for (const p of personas) {
        let line = `**${p.name}**`;
        if (p.worldId) {
          line += ` (World ${p.worldId})`;
        } else {
          line += " (Global)";
        }
        if (p.persona) {
          const preview = p.persona.length > 80
            ? p.persona.slice(0, 80) + "..."
            : p.persona;
          line += `\n  ${preview}`;
        }
        lines.push(line);
      }

      await respond(lines.join("\n"), true);
      return;
    }

    default:
      await respond("Unknown subcommand.", true);
  }
}
