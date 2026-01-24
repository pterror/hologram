import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInteraction = any;
import {
  createWorld,
  initWorldState,
  getWorldState,
  setLocation,
  setWeather,
  advanceTime,
  formatTime,
  linkGuildToWorld,
} from "../../world/state";
import {
  createLocation,
  getLocations,
  findEntityByName,
  type LocationData,
} from "../../db/entities";
import { getOptionValue, getSubcommand, USER_APP_INTEGRATION } from "./index";

export const worldCommand: CreateApplicationCommand = {
  name: "world",
  description: "Manage world state",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "create",
      description: "Create a new world",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "World name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "description",
          description: "World description",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "init",
      description: "Initialize world state for this channel",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "world",
          description: "World name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "status",
      description: "Show current world state",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "location",
      description: "Create or go to a location",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Location name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "description",
          description: "Location description (for creating new)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "time",
      description: "Advance time",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "minutes",
          description: "Minutes to advance",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "weather",
      description: "Set weather",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "description",
          description: "Weather description",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "locations",
      description: "List all locations",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleWorldCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";
  const guildId = interaction.guildId?.toString();

  switch (subcommand) {
    case "create": {
      const name = getOptionValue<string>(interaction, "name")!;
      const description = getOptionValue<string>(interaction, "description");

      const world = createWorld(name, description);

      // Link to guild if in a guild
      if (guildId) {
        linkGuildToWorld(guildId, world.id);
      }

      await respond(
        bot,
        interaction,
        `Created world **${world.name}** (ID: ${world.id})`
      );
      break;
    }

    case "init": {
      const worldName = getOptionValue<string>(interaction, "world")!;

      // Find world by name - simple approach
      const db = await import("../../db").then((m) => m.getDb());
      const stmt = db.prepare("SELECT id FROM worlds WHERE name = ?");
      const worldRow = stmt.get(worldName) as { id: number } | null;

      if (!worldRow) {
        await respond(bot, interaction, `World "${worldName}" not found.`);
        return;
      }

      const state = initWorldState(channelId, worldRow.id);
      if (state) {
        await respond(
          bot,
          interaction,
          `Initialized world **${state.name}** for this channel.`
        );
      } else {
        await respond(bot, interaction, `Failed to initialize world.`);
      }
      break;
    }

    case "status": {
      const state = getWorldState(channelId);
      if (!state) {
        await respond(
          bot,
          interaction,
          "No world initialized. Use `/world init` first."
        );
        return;
      }

      const lines = [
        `# ${state.name}`,
        state.description ?? "",
        "",
        `**Time:** ${formatTime(state.time)}`,
      ];

      if (state.weather) {
        lines.push(`**Weather:** ${state.weather}`);
      }

      if (state.currentLocationId) {
        const location = await import("../../db/entities").then((m) =>
          m.getEntity<LocationData>(state.currentLocationId!)
        );
        if (location) {
          lines.push(`**Location:** ${location.name}`);
          lines.push(location.data.description);
        }
      }

      await respond(bot, interaction, lines.join("\n"));
      break;
    }

    case "location": {
      const name = getOptionValue<string>(interaction, "name")!;
      const description = getOptionValue<string>(interaction, "description");

      const state = getWorldState(channelId);
      if (!state) {
        await respond(bot, interaction, "No world initialized.");
        return;
      }

      let location = findEntityByName<LocationData>(name, "location", state.id);

      if (!location && description) {
        // Create new location
        location = createLocation(name, { description }, state.id);
        await respond(
          bot,
          interaction,
          `Created and moved to **${location.name}**.`
        );
      } else if (location) {
        // Move to existing location
        setLocation(channelId, location.id);
        await respond(bot, interaction, `Moved to **${location.name}**.`);
      } else {
        await respond(
          bot,
          interaction,
          `Location "${name}" not found. Provide a description to create it.`
        );
        return;
      }
      break;
    }

    case "time": {
      const minutes = getOptionValue<number>(interaction, "minutes")!;

      const state = advanceTime(channelId, minutes);
      if (!state) {
        await respond(bot, interaction, "No world initialized.");
        return;
      }

      await respond(
        bot,
        interaction,
        `Time advanced. Now: **${formatTime(state.time)}**`
      );
      break;
    }

    case "weather": {
      const description = getOptionValue<string>(interaction, "description")!;

      const state = setWeather(channelId, description);
      if (!state) {
        await respond(bot, interaction, "No world initialized.");
        return;
      }

      await respond(bot, interaction, `Weather set to: **${description}**`);
      break;
    }

    case "locations": {
      const state = getWorldState(channelId);
      if (!state) {
        await respond(bot, interaction, "No world initialized.");
        return;
      }

      const locations = getLocations(state.id);
      if (locations.length === 0) {
        await respond(bot, interaction, "No locations defined yet.");
        return;
      }

      const list = locations
        .map((l) => {
          const current = l.id === state.currentLocationId ? " ← here" : "";
          return `- **${l.name}**${current}: ${l.data.description.slice(0, 50)}...`;
        })
        .join("\n");

      await respond(bot, interaction, `**Locations:**\n${list}`);
      break;
    }

    default:
      await respond(bot, interaction, "Unknown subcommand.");
  }
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
