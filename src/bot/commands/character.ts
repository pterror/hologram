import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../types";

import {
  createCharacter,
  getCharacters,
  updateEntity,
  deleteEntity,
  findEntityByName,
  type CharacterData,
} from "../../db/entities";
import { setActiveCharacter, getActiveCharacterLegacy as getActiveCharacter } from "../../plugins/scene";
import { getOptionValue, getSubcommand, respond } from "./index";
import { USER_APP_INTEGRATION } from "./integration";

export const characterCommand: CreateApplicationCommand = {
  name: "character",
  description: "Manage characters",
  ...USER_APP_INTEGRATION,
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
          autocomplete: true,
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
          autocomplete: true,
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
          autocomplete: true,
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
            { name: "image_prompt", value: "imagePrompt" },
            { name: "image_negative", value: "imageNegative" },
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
          autocomplete: true,
        },
      ],
    },
    {
      name: "trigger",
      description: "Manage character trigger phrases",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Character name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          autocomplete: true,
        },
        {
          name: "action",
          description: "Add, remove, or list triggers",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "list", value: "list" },
            { name: "add", value: "add" },
            { name: "remove", value: "remove" },
            { name: "clear", value: "clear" },
          ],
        },
        {
          name: "phrase",
          description: "Trigger phrase (for add/remove)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "mode",
      description: "Set character response mode",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Character name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          autocomplete: true,
        },
        {
          name: "response_mode",
          description: "When the character responds",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "always - respond to all messages", value: "always" },
            { name: "mention - only when @mentioned", value: "mention" },
            { name: "trigger - only when trigger phrase used", value: "trigger" },
            { name: "chance - random probability", value: "chance" },
            { name: "llm - AI decides", value: "llm" },
            { name: "combined - triggers + chance/llm", value: "combined" },
          ],
        },
        {
          name: "chance",
          description: "Response chance 0-100% (for chance/combined mode)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 0,
          maxValue: 100,
        },
      ],
    },
    {
      name: "image",
      description: "Set character image generation prompts",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "name",
          description: "Character name",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          autocomplete: true,
        },
        {
          name: "prompt",
          description: "Base image prompt for the character",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
        {
          name: "negative",
          description: "Negative prompt (things to avoid)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
        {
          name: "clear",
          description: "Clear the image prompt",
          type: ApplicationCommandOptionTypes.Boolean,
          required: false,
        },
      ],
    },
  ],
};

export async function handleCharacterCommand(
  bot: HologramBot,
  interaction: HologramInteraction
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

      // Response settings
      const mode = character.data.responseMode ?? "default";
      const triggers = character.data.triggerPhrases ?? [];
      const chance = character.data.responseChance;

      info.push("", "**Response Settings:**");
      info.push(`Mode: ${mode}`);
      if (triggers.length > 0) {
        info.push(`Triggers: ${triggers.map((t) => `\`${t}\``).join(", ")}`);
      }
      if (chance !== undefined) {
        info.push(`Chance: ${(chance * 100).toFixed(0)}%`);
      }

      // Image settings
      if (character.data.imagePrompt || character.data.imageNegative) {
        info.push("", "**Image Generation:**");
        if (character.data.imagePrompt) {
          const prompt = character.data.imagePrompt.length > 200
            ? character.data.imagePrompt.slice(0, 200) + "..."
            : character.data.imagePrompt;
          info.push(`Prompt: ${prompt}`);
        }
        if (character.data.imageNegative) {
          info.push(`Negative: ${character.data.imageNegative}`);
        }
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

    case "trigger": {
      const name = getOptionValue<string>(interaction, "name")!;
      const action = getOptionValue<string>(interaction, "action")!;
      const phrase = getOptionValue<string>(interaction, "phrase");

      const character = findEntityByName<CharacterData>(name, "character");
      if (!character) {
        await respond(bot, interaction, `Character "${name}" not found.`);
        return;
      }

      const triggers = character.data.triggerPhrases ?? [];

      switch (action) {
        case "list": {
          if (triggers.length === 0) {
            await respond(bot, interaction, `**${name}** has no trigger phrases.`);
          } else {
            await respond(
              bot,
              interaction,
              `**${name}**'s triggers:\n${triggers.map((t) => `- \`${t}\``).join("\n")}`
            );
          }
          break;
        }
        case "add": {
          if (!phrase) {
            await respond(bot, interaction, "Please provide a phrase to add.");
            return;
          }
          if (triggers.includes(phrase)) {
            await respond(bot, interaction, `Trigger "${phrase}" already exists.`);
            return;
          }
          const newTriggers = [...triggers, phrase];
          updateEntity<CharacterData>(character.id, {
            data: { triggerPhrases: newTriggers },
          });
          await respond(bot, interaction, `Added trigger \`${phrase}\` to **${name}**.`);
          break;
        }
        case "remove": {
          if (!phrase) {
            await respond(bot, interaction, "Please provide a phrase to remove.");
            return;
          }
          if (!triggers.includes(phrase)) {
            await respond(bot, interaction, `Trigger "${phrase}" not found.`);
            return;
          }
          const filtered = triggers.filter((t) => t !== phrase);
          updateEntity<CharacterData>(character.id, {
            data: { triggerPhrases: filtered },
          });
          await respond(bot, interaction, `Removed trigger \`${phrase}\` from **${name}**.`);
          break;
        }
        case "clear": {
          updateEntity<CharacterData>(character.id, {
            data: { triggerPhrases: [] },
          });
          await respond(bot, interaction, `Cleared all triggers from **${name}**.`);
          break;
        }
      }
      break;
    }

    case "mode": {
      const name = getOptionValue<string>(interaction, "name")!;
      const mode = getOptionValue<string>(interaction, "response_mode")!;
      const chance = getOptionValue<number>(interaction, "chance");

      const character = findEntityByName<CharacterData>(name, "character");
      if (!character) {
        await respond(bot, interaction, `Character "${name}" not found.`);
        return;
      }

      const updates: Partial<CharacterData> = {
        responseMode: mode as CharacterData["responseMode"],
      };

      if (chance !== undefined) {
        updates.responseChance = chance / 100; // Convert from 0-100 to 0-1
      }

      updateEntity<CharacterData>(character.id, { data: updates });

      let msg = `Set **${name}**'s response mode to **${mode}**`;
      if (chance !== undefined) {
        msg += ` with ${chance}% chance`;
      }
      await respond(bot, interaction, msg + ".");
      break;
    }

    case "image": {
      const name = getOptionValue<string>(interaction, "name")!;
      const prompt = getOptionValue<string>(interaction, "prompt");
      const negative = getOptionValue<string>(interaction, "negative");
      const clear = getOptionValue<boolean>(interaction, "clear");

      const character = findEntityByName<CharacterData>(name, "character");
      if (!character) {
        await respond(bot, interaction, `Character "${name}" not found.`);
        return;
      }

      // Clear prompts if requested
      if (clear) {
        updateEntity<CharacterData>(character.id, {
          data: { imagePrompt: undefined, imageNegative: undefined },
        });
        await respond(bot, interaction, `Cleared image prompts for **${name}**.`);
        break;
      }

      // Show current prompts if no changes provided
      if (!prompt && !negative) {
        const lines = [`**${name}**'s image settings:`];
        if (character.data.imagePrompt) {
          lines.push(`**Prompt:** ${character.data.imagePrompt}`);
        } else {
          lines.push("**Prompt:** Not set");
        }
        if (character.data.imageNegative) {
          lines.push(`**Negative:** ${character.data.imageNegative}`);
        }
        lines.push("", "Use `/imagine character` to generate images with these prompts.");
        await respond(bot, interaction, lines.join("\n"));
        break;
      }

      // Update prompts
      const updates: Partial<CharacterData> = {};
      if (prompt) updates.imagePrompt = prompt;
      if (negative) updates.imageNegative = negative;

      updateEntity<CharacterData>(character.id, { data: updates });

      const parts: string[] = [];
      if (prompt) parts.push("prompt");
      if (negative) parts.push("negative prompt");
      await respond(bot, interaction, `Updated **${name}**'s image ${parts.join(" and ")}.`);
      break;
    }

    default:
      await respond(bot, interaction, "Unknown subcommand.");
  }
}

/** Handle autocomplete for character name */
export async function handleCharacterAutocomplete(
  bot: HologramBot,
  interaction: HologramInteraction
): Promise<void> {
  // Get the focused option value
  const focusedOption = interaction.data?.options?.[0]?.options?.find(
    (opt) => (opt as unknown as { focused?: boolean }).focused
  );
  const query = (focusedOption?.value as string)?.toLowerCase() ?? "";

  // Get all characters
  const characters = getCharacters();

  // Filter by query
  const matches = characters
    .filter((c) => c.name.toLowerCase().includes(query))
    .slice(0, 25) // Discord limit
    .map((c) => ({
      name: c.name,
      value: c.name,
    }));

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: 8, // ApplicationCommandAutocompleteResult
    data: {
      choices: matches,
    },
  });
}

