import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInteraction = any;
import {
  createCharacter,
  getCharacters,
  updateEntity,
  deleteEntity,
  findEntityByName,
  type CharacterData,
} from "../../db/entities";
import { setActiveCharacter, getActiveCharacter } from "../events/message";
import { getOptionValue, getSubcommand } from "./index";

export const characterCommand: CreateApplicationCommand = {
  name: "character",
  description: "Manage characters",
  options: [
    {
      name: "create",
      description: "Create a new character",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Character name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "persona",
          description: "Character persona/description",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "scenario",
          description: "Current scenario or goals",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "list",
      description: "List all characters",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "select",
      description: "Select active character for this channel",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Character name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "info",
      description: "Show character details",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Character name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "edit",
      description: "Edit a character",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Character name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
        {
          name: "field",
          description: "Field to edit",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "persona", value: "persona" },
            { name: "scenario", value: "scenario" },
            { name: "example_dialogue", value: "exampleDialogue" },
            { name: "system_prompt", value: "systemPrompt" },
          ],
        },
        {
          name: "value",
          description: "New value",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "delete",
      description: "Delete a character",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Character name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
  ],
};

export async function handleCharacterCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const subcommand = getSubcommand(interaction);
  const channelId = interaction.channelId?.toString() ?? "";

  switch (subcommand) {
    case "create": {
      const name = getOptionValue<string>(interaction, "name")!;
      const persona = getOptionValue<string>(interaction, "persona")!;
      const scenario = getOptionValue<string>(interaction, "scenario");

      const existing = findEntityByName(name, "character");
      if (existing) {
        await respond(bot, interaction, `Character "${name}" already exists.`);
        return;
      }

      const character = createCharacter(name, {
        persona,
        scenario,
      });

      await respond(
        bot,
        interaction,
        `Created character **${character.name}** (ID: ${character.id})`
      );
      break;
    }

    case "list": {
      const characters = getCharacters();
      if (characters.length === 0) {
        await respond(bot, interaction, "No characters found.");
        return;
      }

      const activeId = getActiveCharacter(channelId);
      const list = characters
        .map((c) => {
          const active = c.id === activeId ? " ✓" : "";
          return `- **${c.name}**${active}`;
        })
        .join("\n");

      await respond(bot, interaction, `**Characters:**\n${list}`);
      break;
    }

    case "select": {
      const name = getOptionValue<string>(interaction, "name")!;
      const character = findEntityByName<CharacterData>(name, "character");

      if (!character) {
        await respond(bot, interaction, `Character "${name}" not found.`);
        return;
      }

      setActiveCharacter(channelId, character.id);
      await respond(
        bot,
        interaction,
        `Selected **${character.name}** as active character for this channel.`
      );
      break;
    }

    case "info": {
      const name = getOptionValue<string>(interaction, "name")!;
      const character = findEntityByName<CharacterData>(name, "character");

      if (!character) {
        await respond(bot, interaction, `Character "${name}" not found.`);
        return;
      }

      const info = [
        `# ${character.name}`,
        "",
        "**Persona:**",
        character.data.persona,
      ];

      if (character.data.scenario) {
        info.push("", "**Scenario:**", character.data.scenario);
      }
      if (character.data.exampleDialogue) {
        info.push("", "**Example Dialogue:**", character.data.exampleDialogue);
      }
      if (character.data.systemPrompt) {
        info.push("", "**System Prompt:**", character.data.systemPrompt);
      }

      await respond(bot, interaction, info.join("\n"));
      break;
    }

    case "edit": {
      const name = getOptionValue<string>(interaction, "name")!;
      const field = getOptionValue<string>(interaction, "field")!;
      const value = getOptionValue<string>(interaction, "value")!;

      const character = findEntityByName<CharacterData>(name, "character");
      if (!character) {
        await respond(bot, interaction, `Character "${name}" not found.`);
        return;
      }

      const updated = updateEntity<CharacterData>(character.id, {
        data: { [field]: value },
      });

      if (updated) {
        await respond(bot, interaction, `Updated **${name}**'s ${field}.`);
      } else {
        await respond(bot, interaction, `Failed to update character.`);
      }
      break;
    }

    case "delete": {
      const name = getOptionValue<string>(interaction, "name")!;
      const character = findEntityByName(name, "character");

      if (!character) {
        await respond(bot, interaction, `Character "${name}" not found.`);
        return;
      }

      deleteEntity(character.id);
      await respond(bot, interaction, `Deleted character **${name}**.`);
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
