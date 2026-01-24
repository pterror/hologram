import {
  type Bot,
  type Interaction,
  InteractionResponseTypes,
  ApplicationCommandOptionTypes,
  DiscordApplicationIntegrationType,
  DiscordInteractionContextType,
} from "@discordeno/bot";
import {
  getLocation,
  getLocationsInWorld,
  getConnectedLocations,
  getChildLocations,
  addConnection,
  removeConnection,
  revealConnection,
  createNewLocation,
  formatLocationForDisplay,
  generateTextMap,
} from "../../world/locations";
import { getActiveScene, updateScene, type Scene } from "../../scene";
import { type LocationType } from "../../db/entities";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyBot = Bot<any, any>;
type AnyInteraction = Interaction;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const locationCommand = {
  name: "location",
  description: "Manage locations and travel",
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
      name: "look",
      description: "View current location details",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "go",
      description: "Travel to a connected location",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "destination",
          description: "Name or ID of the location to travel to",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "map",
      description: "Show nearby connected locations",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "depth",
          description: "How many connections deep to show (default: 2)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 1,
          maxValue: 5,
        },
      ],
    },
    {
      name: "create",
      description: "Create a new location",
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
          description: "Location description",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "type",
          description: "Location type (default: location)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "Location", value: "location" },
            { name: "Region", value: "region" },
            { name: "Zone", value: "zone" },
            { name: "World", value: "world" },
          ],
        },
        {
          name: "parent",
          description: "Parent location ID (for hierarchy)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
        },
      ],
    },
    {
      name: "connect",
      description: "Connect two locations",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "from",
          description: "Source location ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "to",
          description: "Target location ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "type",
          description: "Connection type (e.g., door, path, portal)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
        {
          name: "bidirectional",
          description: "Can travel both ways? (default: true)",
          type: ApplicationCommandOptionTypes.Boolean,
          required: false,
        },
        {
          name: "travel_time",
          description: "Travel time in minutes",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
        },
        {
          name: "hidden",
          description: "Is the connection hidden? (default: false)",
          type: ApplicationCommandOptionTypes.Boolean,
          required: false,
        },
      ],
    },
    {
      name: "disconnect",
      description: "Remove a connection between locations",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "from",
          description: "Source location ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "to",
          description: "Target location ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "discover",
      description: "Reveal a hidden connection",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "from",
          description: "Source location ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "to",
          description: "Target location ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "list",
      description: "List all locations",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "type",
          description: "Filter by location type",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "Location", value: "location" },
            { name: "Region", value: "region" },
            { name: "Zone", value: "zone" },
            { name: "World", value: "world" },
          ],
        },
      ],
    },
    {
      name: "children",
      description: "List child locations of a parent",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "parent",
          description: "Parent location ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
  ],
};

export async function handleLocationCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const subcommand = interaction.data?.options?.[0];
  if (!subcommand) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Invalid command.", flags: 64 },
    });
    return;
  }

  const channelId = interaction.channelId?.toString() ?? "";
  const scene = getActiveScene(channelId);

  switch (subcommand.name) {
    case "look":
      await handleLook(bot, interaction, scene);
      break;
    case "go":
      await handleGo(bot, interaction, scene, subcommand.options);
      break;
    case "map":
      await handleMap(bot, interaction, scene, subcommand.options);
      break;
    case "create":
      await handleCreate(bot, interaction, scene, subcommand.options);
      break;
    case "connect":
      await handleConnect(bot, interaction, subcommand.options);
      break;
    case "disconnect":
      await handleDisconnect(bot, interaction, subcommand.options);
      break;
    case "discover":
      await handleDiscover(bot, interaction, subcommand.options);
      break;
    case "list":
      await handleList(bot, interaction, scene, subcommand.options);
      break;
    case "children":
      await handleChildren(bot, interaction, scene, subcommand.options);
      break;
    default:
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: InteractionResponseTypes.ChannelMessageWithSource,
        data: { content: "Unknown subcommand.", flags: 64 },
      });
  }
}

async function handleLook(
  bot: AnyBot,
  interaction: AnyInteraction,
  scene: Scene | null
): Promise<void> {
  if (!scene?.locationId) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: "No active scene with a location. Use `/scene start` first.",
        flags: 64,
      },
    });
    return;
  }

  const location = getLocation(scene.locationId);
  if (!location) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Current location not found.", flags: 64 },
    });
    return;
  }

  const display = formatLocationForDisplay(location);
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: display },
  });
}

interface CommandOption {
  name: string;
  value?: string | number | boolean;
}

async function handleGo(
  bot: AnyBot,
  interaction: AnyInteraction,
  scene: Scene | null,
  options?: CommandOption[]
): Promise<void> {
  if (!scene?.locationId) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: "No active scene with a location. Use `/scene start` first.",
        flags: 64,
      },
    });
    return;
  }

  const destination = options?.find((o) => o.name === "destination")?.value as string;
  if (!destination) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Please specify a destination.", flags: 64 },
    });
    return;
  }

  const connections = getConnectedLocations(scene.locationId);

  // Try to find by ID or name
  let targetConn = connections.find(
    (c) => c.location.id.toString() === destination ||
           c.location.name.toLowerCase() === destination.toLowerCase()
  );

  // Partial name match
  if (!targetConn) {
    targetConn = connections.find(
      (c) => c.location.name.toLowerCase().includes(destination.toLowerCase())
    );
  }

  if (!targetConn) {
    const availableExits = connections.map((c) => c.location.name).join(", ");
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: `Cannot travel to "${destination}". Available exits: ${availableExits || "none"}`,
        flags: 64,
      },
    });
    return;
  }

  // Update scene location
  const updatedScene: Scene = { ...scene, locationId: targetConn.location.id };
  updateScene(updatedScene);

  const newLocation = targetConn.location;
  let response = `**Traveled to ${newLocation.name}**`;
  if (targetConn.connection.travelTime) {
    response += ` (${targetConn.connection.travelTime} minutes)`;
  }
  response += "\n\n" + (newLocation.data.enterMessage ?? newLocation.data.description);

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: response },
  });
}

async function handleMap(
  bot: AnyBot,
  interaction: AnyInteraction,
  scene: Scene | null,
  options?: CommandOption[]
): Promise<void> {
  if (!scene?.locationId) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: "No active scene with a location. Use `/scene start` first.",
        flags: 64,
      },
    });
    return;
  }

  const depth = (options?.find((o) => o.name === "depth")?.value as number) ?? 2;
  const map = generateTextMap(scene.locationId, depth);

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: "```\n" + map + "\n```" },
  });
}

async function handleCreate(
  bot: AnyBot,
  interaction: AnyInteraction,
  scene: Scene | null,
  options?: CommandOption[]
): Promise<void> {
  const name = options?.find((o) => o.name === "name")?.value as string;
  const description = options?.find((o) => o.name === "description")?.value as string;
  const locationType = (options?.find((o) => o.name === "type")?.value as LocationType) ?? "location";
  const parentId = options?.find((o) => o.name === "parent")?.value as number | undefined;

  if (!name || !description) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Name and description are required.", flags: 64 },
    });
    return;
  }

  const worldId = scene?.worldId ?? 0;
  const location = createNewLocation(name, description, worldId, {
    parentId,
    locationType,
  });

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: {
      content: `Created location **${location.name}** (ID: ${location.id}, Type: ${locationType})`,
    },
  });
}

async function handleConnect(
  bot: AnyBot,
  interaction: AnyInteraction,
  options?: CommandOption[]
): Promise<void> {
  const fromId = options?.find((o) => o.name === "from")?.value as number;
  const toId = options?.find((o) => o.name === "to")?.value as number;
  const type = options?.find((o) => o.name === "type")?.value as string | undefined;
  const bidirectional = (options?.find((o) => o.name === "bidirectional")?.value as boolean) ?? true;
  const travelTime = options?.find((o) => o.name === "travel_time")?.value as number | undefined;
  const hidden = (options?.find((o) => o.name === "hidden")?.value as boolean) ?? false;

  if (!fromId || !toId) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Both from and to location IDs are required.", flags: 64 },
    });
    return;
  }

  const success = addConnection(fromId, toId, {
    type,
    bidirectional,
    travelTime,
    hidden,
  });

  if (!success) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Failed to connect locations. Check that both IDs are valid.", flags: 64 },
    });
    return;
  }

  const fromLoc = getLocation(fromId);
  const toLoc = getLocation(toId);
  let response = `Connected **${fromLoc?.name ?? fromId}** → **${toLoc?.name ?? toId}**`;
  if (type) response += ` (${type})`;
  if (bidirectional) response += " [bidirectional]";
  if (hidden) response += " [hidden]";
  if (travelTime) response += ` [${travelTime} min]`;

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: response },
  });
}

async function handleDisconnect(
  bot: AnyBot,
  interaction: AnyInteraction,
  options?: CommandOption[]
): Promise<void> {
  const fromId = options?.find((o) => o.name === "from")?.value as number;
  const toId = options?.find((o) => o.name === "to")?.value as number;

  if (!fromId || !toId) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Both from and to location IDs are required.", flags: 64 },
    });
    return;
  }

  const success = removeConnection(fromId, toId);

  if (!success) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "No connection found between those locations.", flags: 64 },
    });
    return;
  }

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: `Removed connection from ${fromId} to ${toId}.` },
  });
}

async function handleDiscover(
  bot: AnyBot,
  interaction: AnyInteraction,
  options?: CommandOption[]
): Promise<void> {
  const fromId = options?.find((o) => o.name === "from")?.value as number;
  const toId = options?.find((o) => o.name === "to")?.value as number;

  if (!fromId || !toId) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Both from and to location IDs are required.", flags: 64 },
    });
    return;
  }

  const success = revealConnection(fromId, toId);

  if (!success) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "No hidden connection found between those locations.", flags: 64 },
    });
    return;
  }

  const toLoc = getLocation(toId);
  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: `Discovered a hidden path to **${toLoc?.name ?? toId}**!` },
  });
}

async function handleList(
  bot: AnyBot,
  interaction: AnyInteraction,
  scene: Scene | null,
  options?: CommandOption[]
): Promise<void> {
  const worldId = scene?.worldId ?? 0;
  const typeFilter = options?.find((o) => o.name === "type")?.value as LocationType | undefined;

  const locations = getLocationsInWorld(worldId);
  const filtered = typeFilter
    ? locations.filter((loc) => loc.data.locationType === typeFilter)
    : locations;

  if (filtered.length === 0) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "No locations found.", flags: 64 },
    });
    return;
  }

  const lines = filtered.map((loc) => {
    const type = loc.data.locationType ?? "location";
    const parent = loc.data.parentId ? ` (in ${loc.data.parentId})` : "";
    return `- **${loc.name}** (ID: ${loc.id}, ${type})${parent}`;
  });

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: `**Locations:**\n${lines.join("\n")}` },
  });
}

async function handleChildren(
  bot: AnyBot,
  interaction: AnyInteraction,
  scene: Scene | null,
  options?: CommandOption[]
): Promise<void> {
  const parentId = options?.find((o) => o.name === "parent")?.value as number;

  if (!parentId) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Parent location ID is required.", flags: 64 },
    });
    return;
  }

  const parent = getLocation(parentId);
  if (!parent) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Parent location not found.", flags: 64 },
    });
    return;
  }

  const worldId = scene?.worldId ?? parent.worldId ?? 0;
  const children = getChildLocations(parentId, worldId);

  if (children.length === 0) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: `**${parent.name}** has no child locations.`, flags: 64 },
    });
    return;
  }

  const lines = children.map((loc) => {
    const type = loc.data.locationType ?? "location";
    return `- **${loc.name}** (ID: ${loc.id}, ${type})`;
  });

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: InteractionResponseTypes.ChannelMessageWithSource,
    data: { content: `**Children of ${parent.name}:**\n${lines.join("\n")}` },
  });
}
