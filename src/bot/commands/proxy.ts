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
  getUserProxies,
  getProxyByName,
  createProxy,
  deleteProxy,
  updateProxy,
  parseProxyMessage,
  formatProxyTrigger,
} from "../../proxies";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyBot = Bot<any, any>;
type AnyInteraction = Interaction;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const proxyCommand = {
  name: "proxy",
  description: "Manage PluralKit-style character proxies",
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
      name: "list",
      description: "List your proxies",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "add",
      description: "Add a new proxy character",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Proxy character name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "prefix",
          description: "Trigger prefix (e.g., 'a:' to proxy messages starting with a:)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
        {
          name: "avatar",
          description: "Avatar URL for webhook display",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "remove",
      description: "Remove a proxy character",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Proxy name to remove",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "prefix",
      description: "Set a proxy's trigger prefix",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Proxy name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "value",
          description: "Prefix text (e.g., 'a:') or 'none' to clear",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "suffix",
      description: "Set a proxy's trigger suffix",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Proxy name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "value",
          description: "Suffix text (e.g., '-a') or 'none' to clear",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "brackets",
      description: "Set a proxy's bracket triggers",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Proxy name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "open",
          description: "Opening bracket (e.g., '[' or '{{')",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "close",
          description: "Closing bracket (e.g., ']' or '}}') or 'none' to clear",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "avatar",
      description: "Set a proxy's avatar URL",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Proxy name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "url",
          description: "Avatar URL or 'none' to clear",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "persona",
      description: "Set a proxy's persona description",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Proxy name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "text",
          description: "Persona description",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "test",
      description: "Test which proxy would match a message",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "message",
          description: "Test message text",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
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

export async function handleProxyCommand(
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
    case "list": {
      const proxies = getUserProxies(userId, worldId);
      if (proxies.length === 0) {
        await respond("You have no proxies. Use `/proxy add <name>` to create one.", true);
        return;
      }

      const lines = ["**Your Proxies:**\n"];
      for (const p of proxies) {
        let line = `**${p.name}** (ID: ${p.id})`;
        const trigger = formatProxyTrigger(p);
        line += `\n  ${trigger}`;
        if (p.avatar) line += "\n  Has avatar";
        if (p.persona) {
          const preview = p.persona.length > 60
            ? p.persona.slice(0, 60) + "..."
            : p.persona;
          line += `\n  ${preview}`;
        }
        lines.push(line);
      }

      await respond(lines.join("\n"), true);
      return;
    }

    case "add": {
      const name = getSubOpt<string>(interaction, "name")!;
      const prefix = getSubOpt<string>(interaction, "prefix");
      const avatar = getSubOpt<string>(interaction, "avatar");

      const existing = getProxyByName(userId, name);
      if (existing) {
        await respond(`A proxy named **${name}** already exists.`, true);
        return;
      }

      const proxy = createProxy(userId, name, {
        worldId,
        prefix: prefix ?? undefined,
        avatar: avatar ?? undefined,
      });

      let msg = `Proxy created: **${proxy.name}** (ID: ${proxy.id})`;
      if (prefix) msg += `\nPrefix: \`${prefix}text\``;
      if (!prefix) msg += "\nNo trigger set yet. Use `/proxy prefix`, `/proxy suffix`, or `/proxy brackets` to set one.";

      await respond(msg, true);
      return;
    }

    case "remove": {
      const name = getSubOpt<string>(interaction, "name")!;
      const proxy = getProxyByName(userId, name);
      if (!proxy) {
        await respond(`No proxy named **${name}** found.`, true);
        return;
      }

      deleteProxy(proxy.id);
      await respond(`Proxy **${name}** removed.`, true);
      return;
    }

    case "prefix": {
      const name = getSubOpt<string>(interaction, "name")!;
      const value = getSubOpt<string>(interaction, "value")!;

      const proxy = getProxyByName(userId, name);
      if (!proxy) {
        await respond(`No proxy named **${name}** found.`, true);
        return;
      }

      const prefix = value === "none" ? null : value;
      updateProxy(proxy.id, { prefix });
      await respond(
        prefix
          ? `**${name}** prefix set: \`${prefix}text\``
          : `**${name}** prefix cleared.`,
        true
      );
      return;
    }

    case "suffix": {
      const name = getSubOpt<string>(interaction, "name")!;
      const value = getSubOpt<string>(interaction, "value")!;

      const proxy = getProxyByName(userId, name);
      if (!proxy) {
        await respond(`No proxy named **${name}** found.`, true);
        return;
      }

      const suffix = value === "none" ? null : value;
      updateProxy(proxy.id, { suffix });
      await respond(
        suffix
          ? `**${name}** suffix set: \`text${suffix}\``
          : `**${name}** suffix cleared.`,
        true
      );
      return;
    }

    case "brackets": {
      const name = getSubOpt<string>(interaction, "name")!;
      const open = getSubOpt<string>(interaction, "open")!;
      const close = getSubOpt<string>(interaction, "close")!;

      const proxy = getProxyByName(userId, name);
      if (!proxy) {
        await respond(`No proxy named **${name}** found.`, true);
        return;
      }

      if (close === "none") {
        updateProxy(proxy.id, { bracketOpen: null, bracketClose: null });
        await respond(`**${name}** brackets cleared.`, true);
      } else {
        updateProxy(proxy.id, { bracketOpen: open, bracketClose: close });
        await respond(
          `**${name}** brackets set: \`${open}text${close}\``,
          true
        );
      }
      return;
    }

    case "avatar": {
      const name = getSubOpt<string>(interaction, "name")!;
      const url = getSubOpt<string>(interaction, "url")!;

      const proxy = getProxyByName(userId, name);
      if (!proxy) {
        await respond(`No proxy named **${name}** found.`, true);
        return;
      }

      const avatar = url === "none" ? null : url;
      updateProxy(proxy.id, { avatar });
      await respond(
        avatar
          ? `**${name}** avatar updated.`
          : `**${name}** avatar cleared.`,
        true
      );
      return;
    }

    case "persona": {
      const name = getSubOpt<string>(interaction, "name")!;
      const text = getSubOpt<string>(interaction, "text")!;

      const proxy = getProxyByName(userId, name);
      if (!proxy) {
        await respond(`No proxy named **${name}** found.`, true);
        return;
      }

      updateProxy(proxy.id, { persona: text });
      await respond(`**${name}** persona updated.`, true);
      return;
    }

    case "test": {
      const message = getSubOpt<string>(interaction, "message")!;

      const result = parseProxyMessage(userId, message, worldId);
      if (!result) {
        await respond("No proxy matched this message.", true);
        return;
      }

      await respond(
        `Matched proxy: **${result.proxy.name}**\nParsed content: ${result.content}`,
        true
      );
      return;
    }

    default:
      await respond("Unknown subcommand.", true);
  }
}
