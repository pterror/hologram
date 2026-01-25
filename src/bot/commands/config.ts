import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
  MessageComponentTypes,
  ButtonStyles,
} from "@discordeno/bot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInteraction = any;

import { getWorldState } from "../../world/state";
import {
  DEFAULT_CONFIG,
  PRESETS,
  mergeConfig,
  getConfigValue,
  setConfigValue,
  parseConfigValue,
  type WorldConfig,
} from "../../config";
import { getDb } from "../../db";
import { getOptionValue, getSubcommand, respond, USER_APP_INTEGRATION } from "./index";

export const configCommand: CreateApplicationCommand = {
  name: "config",
  description: "Manage world configuration",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "show",
      description: "Show current configuration",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "section",
          description: "Config section to show (or all)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          choices: [
            { name: "all", value: "all" },
            { name: "chronicle", value: "chronicle" },
            { name: "scenes", value: "scenes" },
            { name: "inventory", value: "inventory" },
            { name: "locations", value: "locations" },
            { name: "time", value: "time" },
            { name: "characterState", value: "characterState" },
            { name: "dice", value: "dice" },
            { name: "relationships", value: "relationships" },
            { name: "context", value: "context" },
          ],
        },
      ],
    },
    {
      name: "set",
      description: "Set a configuration value",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "path",
          description: "Config path (e.g., chronicle.autoExtract)",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "value",
          description: "Value to set",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "preset",
      description: "Apply a configuration preset",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Preset to apply",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "minimal - Just chat, no mechanics", value: "minimal" },
            { name: "simple - Basic RP features", value: "simple" },
            { name: "full - All features enabled", value: "full" },
            { name: "tf - Transformation focused", value: "tf" },
            { name: "tabletop - Dice and combat", value: "tabletop" },
          ],
        },
      ],
    },
    {
      name: "reset",
      description: "Reset configuration to defaults",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "wizard",
      description: "Interactive configuration builder",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleConfigCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";

  // Get current world
  const worldState = getWorldState(channelId);
  if (!worldState) {
    await respond(bot, interaction, "No world initialized. Use `/world init` first.");
    return;
  }

  const db = getDb();

  switch (subcommand) {
    case "show": {
      const section = getOptionValue<string>(interaction, "section") ?? "all";
      const config = getWorldConfig(db, worldState.id);

      let output: string;
      if (section === "all") {
        output = formatConfigOverview(config);
      } else {
        const sectionConfig = config[section as keyof WorldConfig];
        if (sectionConfig === undefined) {
          await respond(bot, interaction, `Unknown section: ${section}`);
          return;
        }
        output = formatConfigSection(section, sectionConfig);
      }

      await respond(bot, interaction, output);
      break;
    }

    case "set": {
      const path = getOptionValue<string>(interaction, "path")!;
      const valueStr = getOptionValue<string>(interaction, "value")!;
      const value = parseConfigValue(valueStr);

      // Validate path exists
      const currentConfig = getWorldConfig(db, worldState.id);
      const currentValue = getConfigValue(currentConfig, path);
      if (currentValue === undefined) {
        await respond(
          bot,
          interaction,
          `Invalid path: \`${path}\`. Use \`/config show\` to see available options.`
        );
        return;
      }

      // Update config
      const newConfig = setConfigValue(currentConfig, path, value);
      saveWorldConfig(db, worldState.id, newConfig);

      await respond(
        bot,
        interaction,
        `Set \`${path}\` = \`${JSON.stringify(value)}\``
      );
      break;
    }

    case "preset": {
      const presetName = getOptionValue<string>(interaction, "name")!;
      const preset = PRESETS[presetName];

      if (!preset) {
        await respond(
          bot,
          interaction,
          `Unknown preset: ${presetName}. Valid: ${Object.keys(PRESETS).join(", ")}`
        );
        return;
      }

      const newConfig = mergeConfig(preset);
      saveWorldConfig(db, worldState.id, newConfig);

      await respond(
        bot,
        interaction,
        `Applied preset: **${presetName}**\n${getPresetDescription(presetName)}`
      );
      break;
    }

    case "reset": {
      saveWorldConfig(db, worldState.id, DEFAULT_CONFIG);
      await respond(bot, interaction, "Configuration reset to defaults.");
      break;
    }

    case "wizard": {
      const config = getWorldConfig(db, worldState.id);
      await respondWithWizard(bot, interaction, config, worldState.id);
      break;
    }

    default:
      await respond(bot, interaction, "Unknown subcommand.");
  }
}

// Wizard state stored in custom_id: "config_wizard:{worldId}:{json_state}"
interface WizardState {
  chronicle: boolean;
  scenes: boolean;
  inventory: boolean;
  locations: boolean;
  time: boolean;
  characterState: boolean;
  dice: boolean;
  relationships: boolean;
}

function stateFromConfig(config: WorldConfig): WizardState {
  return {
    chronicle: config.chronicle.enabled,
    scenes: config.scenes.enabled,
    inventory: config.inventory.enabled,
    locations: config.locations.enabled,
    time: config.time.enabled,
    characterState: config.characterState.enabled,
    dice: config.dice.enabled,
    relationships: config.relationships.enabled,
  };
}

function encodeWizardId(worldId: number, state: WizardState): string {
  // Encode as bits to keep custom_id short (100 char limit)
  const bits =
    (state.chronicle ? 1 : 0) |
    (state.scenes ? 2 : 0) |
    (state.inventory ? 4 : 0) |
    (state.locations ? 8 : 0) |
    (state.time ? 16 : 0) |
    (state.characterState ? 32 : 0) |
    (state.dice ? 64 : 0) |
    (state.relationships ? 128 : 0);
  return `cfgwiz:${worldId}:${bits}`;
}

function decodeWizardId(customId: string): { worldId: number; state: WizardState } | null {
  const match = customId.match(/^cfgwiz:(\d+):(\d+)/);
  if (!match) return null;

  const worldId = parseInt(match[1], 10);
  const bits = parseInt(match[2], 10);

  return {
    worldId,
    state: {
      chronicle: (bits & 1) !== 0,
      scenes: (bits & 2) !== 0,
      inventory: (bits & 4) !== 0,
      locations: (bits & 8) !== 0,
      time: (bits & 16) !== 0,
      characterState: (bits & 32) !== 0,
      dice: (bits & 64) !== 0,
      relationships: (bits & 128) !== 0,
    },
  };
}

async function respondWithWizard(
  bot: AnyBot,
  interaction: AnyInteraction,
  config: WorldConfig,
  worldId: number
): Promise<void> {
  const state = stateFromConfig(config);
  const baseId = encodeWizardId(worldId, state);

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: {
      content: formatWizardMessage(state),
      components: buildWizardComponents(baseId, state),
    },
  });
}

function formatWizardMessage(state: WizardState): string {
  const lines = [
    "**Configuration Wizard**",
    "Toggle features on/off, then click Apply.\n",
  ];

  const features = [
    ["Chronicle", state.chronicle, "Memory & fact extraction"],
    ["Scenes", state.scenes, "Scene lifecycle management"],
    ["Inventory", state.inventory, "Items & equipment"],
    ["Locations", state.locations, "Places & connections"],
    ["Time", state.time, "Time tracking & calendar"],
    ["Character State", state.characterState, "Attributes, forms, effects"],
    ["Dice", state.dice, "Dice rolling & combat"],
    ["Relationships", state.relationships, "Affinity & factions"],
  ] as const;

  for (const [name, enabled, desc] of features) {
    const icon = enabled ? "+" : "-";
    lines.push(`${icon} **${name}**: ${desc}`);
  }

  return lines.join("\n");
}

function buildWizardComponents(
  baseId: string,
  state: WizardState
): Array<{
  type: MessageComponentTypes;
  components: Array<unknown>;
}> {
  const features: Array<[keyof WizardState, string]> = [
    ["chronicle", "Chronicle"],
    ["scenes", "Scenes"],
    ["inventory", "Inventory"],
    ["locations", "Locations"],
    ["time", "Time"],
    ["characterState", "Char State"],
    ["dice", "Dice"],
    ["relationships", "Relations"],
  ];

  // Row 1: First 4 toggles
  const row1 = features.slice(0, 4).map(([key, label]) => ({
    type: MessageComponentTypes.Button,
    style: state[key] ? ButtonStyles.Success : ButtonStyles.Secondary,
    label: label,
    customId: `${baseId}:toggle:${key}`,
  }));

  // Row 2: Next 4 toggles
  const row2 = features.slice(4, 8).map(([key, label]) => ({
    type: MessageComponentTypes.Button,
    style: state[key] ? ButtonStyles.Success : ButtonStyles.Secondary,
    label: label,
    customId: `${baseId}:toggle:${key}`,
  }));

  // Row 3: Quick presets
  const row3 = [
    {
      type: MessageComponentTypes.Button,
      style: ButtonStyles.Primary,
      label: "All On",
      customId: `${baseId}:all_on`,
    },
    {
      type: MessageComponentTypes.Button,
      style: ButtonStyles.Primary,
      label: "All Off",
      customId: `${baseId}:all_off`,
    },
    {
      type: MessageComponentTypes.Button,
      style: ButtonStyles.Success,
      label: "Apply",
      customId: `${baseId}:apply`,
    },
    {
      type: MessageComponentTypes.Button,
      style: ButtonStyles.Danger,
      label: "Cancel",
      customId: `${baseId}:cancel`,
    },
  ];

  return [
    { type: MessageComponentTypes.ActionRow, components: row1 },
    { type: MessageComponentTypes.ActionRow, components: row2 },
    { type: MessageComponentTypes.ActionRow, components: row3 },
  ];
}

/** Handle wizard button clicks */
export async function handleConfigWizardComponent(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<boolean> {
  const customId = interaction.data?.customId;
  if (!customId?.startsWith("cfgwiz:")) return false;

  const decoded = decodeWizardId(customId);
  if (!decoded) return false;

  const { worldId, state } = decoded;
  const action = customId.split(":").slice(3).join(":");

  let newState = { ...state };
  let done = false;
  let message = "";

  if (action.startsWith("toggle:")) {
    const key = action.replace("toggle:", "") as keyof WizardState;
    if (key in newState) {
      newState[key] = !newState[key];
    }
  } else if (action === "all_on") {
    newState = {
      chronicle: true,
      scenes: true,
      inventory: true,
      locations: true,
      time: true,
      characterState: true,
      dice: true,
      relationships: true,
    };
  } else if (action === "all_off") {
    newState = {
      chronicle: false,
      scenes: false,
      inventory: false,
      locations: false,
      time: false,
      characterState: false,
      dice: false,
      relationships: false,
    };
  } else if (action === "apply") {
    // Save config
    const db = getDb();
    const currentConfig = getWorldConfig(db, worldId);
    const updatedConfig: WorldConfig = {
      ...currentConfig,
      chronicle: { ...currentConfig.chronicle, enabled: state.chronicle },
      scenes: { ...currentConfig.scenes, enabled: state.scenes },
      inventory: { ...currentConfig.inventory, enabled: state.inventory },
      locations: { ...currentConfig.locations, enabled: state.locations },
      time: { ...currentConfig.time, enabled: state.time },
      characterState: { ...currentConfig.characterState, enabled: state.characterState },
      dice: { ...currentConfig.dice, enabled: state.dice },
      relationships: { ...currentConfig.relationships, enabled: state.relationships },
    };
    saveWorldConfig(db, worldId, updatedConfig);
    done = true;
    message = "Configuration saved!";
  } else if (action === "cancel") {
    done = true;
    message = "Configuration wizard cancelled.";
  }

  if (done) {
    // Update message to show result, remove components
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: 7, // UpdateMessage
      data: {
        content: message,
        components: [],
      },
    });
  } else {
    // Update message with new state
    const newBaseId = encodeWizardId(worldId, newState);
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: 7, // UpdateMessage
      data: {
        content: formatWizardMessage(newState),
        components: buildWizardComponents(newBaseId, newState),
      },
    });
  }

  return true;
}

function getWorldConfig(db: ReturnType<typeof getDb>, worldId: number): WorldConfig {
  const row = db
    .prepare("SELECT config FROM worlds WHERE id = ?")
    .get(worldId) as { config: string | null } | null;

  if (!row?.config) {
    return DEFAULT_CONFIG;
  }

  try {
    const partial = JSON.parse(row.config);
    return mergeConfig(partial);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveWorldConfig(
  db: ReturnType<typeof getDb>,
  worldId: number,
  config: WorldConfig
): void {
  db.prepare("UPDATE worlds SET config = ? WHERE id = ?").run(
    JSON.stringify(config),
    worldId
  );
}

function formatConfigOverview(config: WorldConfig): string {
  const lines = ["**World Configuration**\n"];

  lines.push(`**Output Mode:** ${config.multiCharMode}`);
  lines.push("");

  // Show enabled/disabled status for each subsystem
  const subsystems = [
    ["Chronicle", config.chronicle.enabled],
    ["Scenes", config.scenes.enabled],
    ["Inventory", config.inventory.enabled],
    ["Locations", config.locations.enabled],
    ["Time", config.time.enabled],
    ["Character State", config.characterState.enabled],
    ["Dice", config.dice.enabled],
    ["Relationships", config.relationships.enabled],
  ] as const;

  lines.push("**Subsystems:**");
  for (const [name, enabled] of subsystems) {
    const status = enabled ? "ON" : "OFF";
    lines.push(`- ${name}: ${status}`);
  }

  lines.push("");
  lines.push("*Use `/config show <section>` for details*");

  return lines.join("\n");
}

function formatConfigSection(name: string, config: unknown): string {
  const lines = [`**${name} Configuration**\n`];

  if (typeof config === "object" && config !== null) {
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        lines.push(`**${key}:**`);
        for (const [subKey, subValue] of Object.entries(value)) {
          lines.push(`  ${subKey}: \`${JSON.stringify(subValue)}\``);
        }
      } else {
        lines.push(`${key}: \`${JSON.stringify(value)}\``);
      }
    }
  } else {
    lines.push(`Value: \`${JSON.stringify(config)}\``);
  }

  return lines.join("\n");
}

function getPresetDescription(name: string): string {
  switch (name) {
    case "minimal":
      return "All mechanics disabled. Simple character chat.";
    case "simple":
      return "Basic RP features. Chronicle, scenes, inventory, locations, time, relationships.";
    case "full":
      return "All features enabled including dice, combat, factions, effects.";
    case "tf":
      return "Transformation focused. Forms, effects, and attributes enabled.";
    case "tabletop":
      return "Tabletop RPG style. Dice, combat, HP/AC, manual time.";
    default:
      return "";
  }
}

