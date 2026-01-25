import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInteraction = any;

import {
  getCharacterState,
  setAttribute,
  modifyAttribute,
  setBodyTrait,
  addEffect,
  removeEffectByName,
  getCharacterEffects,
  formatStateForDisplay,
  effectTypeLabels,
  type EffectType,
  type EffectDuration,
} from "../../state";
import { getActiveScene } from "../../scene";
import { getWorldState } from "../../world/state";
import { getEntitiesByType, type CharacterData, type Entity } from "../../db/entities";
import { getOptionValue, getSubcommand, getNestedSubcommand, respond, USER_APP_INTEGRATION } from "./index";

export const statusCommand: CreateApplicationCommand = {
  name: "status",
  description: "View and manage character state",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "view",
      description: "View character status",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character",
          description: "Character name (default: active character)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "attribute",
      description: "Manage attributes",
      type: ApplicationCommandOptionTypes.SubCommandGroup,
      options: [
        {
          name: "set",
          description: "Set an attribute value",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "name",
              description: "Attribute name",
              type: ApplicationCommandOptionTypes.String,
              required: true,
            },
            {
              name: "value",
              description: "Value to set",
              type: ApplicationCommandOptionTypes.Integer,
              required: true,
            },
            {
              name: "character",
              description: "Character name",
              type: ApplicationCommandOptionTypes.String,
              required: false,
            },
          ],
        },
        {
          name: "mod",
          description: "Modify an attribute by amount",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "name",
              description: "Attribute name",
              type: ApplicationCommandOptionTypes.String,
              required: true,
            },
            {
              name: "amount",
              description: "Amount to add (negative to subtract)",
              type: ApplicationCommandOptionTypes.Integer,
              required: true,
            },
            {
              name: "character",
              description: "Character name",
              type: ApplicationCommandOptionTypes.String,
              required: false,
            },
          ],
        },
      ],
    },
    {
      name: "effect",
      description: "Manage effects",
      type: ApplicationCommandOptionTypes.SubCommandGroup,
      options: [
        {
          name: "add",
          description: "Add an effect",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "name",
              description: "Effect name",
              type: ApplicationCommandOptionTypes.String,
              required: true,
            },
            {
              name: "type",
              description: "Effect type",
              type: ApplicationCommandOptionTypes.String,
              required: false,
              choices: [
                { name: "Buff", value: "buff" },
                { name: "Debuff", value: "debuff" },
                { name: "Curse", value: "curse" },
                { name: "Blessing", value: "blessing" },
                { name: "Transformation", value: "transformation" },
                { name: "Custom", value: "custom" },
              ],
            },
            {
              name: "description",
              description: "Effect description",
              type: ApplicationCommandOptionTypes.String,
              required: false,
            },
            {
              name: "duration",
              description: "Duration type",
              type: ApplicationCommandOptionTypes.String,
              required: false,
              choices: [
                { name: "Permanent", value: "permanent" },
                { name: "Temporary", value: "temporary" },
                { name: "Until Cured", value: "until_cured" },
              ],
            },
            {
              name: "character",
              description: "Target character",
              type: ApplicationCommandOptionTypes.String,
              required: false,
            },
          ],
        },
        {
          name: "remove",
          description: "Remove an effect",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "name",
              description: "Effect name to remove",
              type: ApplicationCommandOptionTypes.String,
              required: true,
            },
            {
              name: "character",
              description: "Target character",
              type: ApplicationCommandOptionTypes.String,
              required: false,
            },
          ],
        },
        {
          name: "list",
          description: "List active effects",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "character",
              description: "Character name",
              type: ApplicationCommandOptionTypes.String,
              required: false,
            },
          ],
        },
      ],
    },
    {
      name: "form",
      description: "Manage body/form",
      type: ApplicationCommandOptionTypes.SubCommandGroup,
      options: [
        {
          name: "view",
          description: "View current form",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "character",
              description: "Character name",
              type: ApplicationCommandOptionTypes.String,
              required: false,
            },
          ],
        },
        {
          name: "set",
          description: "Set a body trait",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "trait",
              description: "Trait name (e.g., species, ears, tail)",
              type: ApplicationCommandOptionTypes.String,
              required: true,
            },
            {
              name: "value",
              description: "Trait value",
              type: ApplicationCommandOptionTypes.String,
              required: true,
            },
            {
              name: "character",
              description: "Character name",
              type: ApplicationCommandOptionTypes.String,
              required: false,
            },
          ],
        },
      ],
    },
  ],
};

export async function handleStatusCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const subcommand = getSubcommand(interaction);
  const nestedSubcommand = getNestedSubcommand(interaction);

  // Get world context
  const worldState = getWorldState(channelId);
  if (!worldState) {
    await respond(bot, interaction, "No world initialized. Use `/world init` first.");
    return;
  }

  // Get active scene
  const scene = getActiveScene(channelId);
  const sceneId = scene?.id ?? null;

  // Helper to resolve character
  const resolveCharacter = (name?: string): Entity<CharacterData> | null => {
    if (name) {
      const characters = getEntitiesByType<CharacterData>("character", worldState.id);
      return characters.find(
        (c: Entity<CharacterData>) => c.name.toLowerCase() === name.toLowerCase()
      ) ?? null;
    }
    // Could return active character from scene, for now require name
    return null;
  };

  switch (subcommand) {
    case "view": {
      const charName = getOptionValue<string>(interaction, "character");
      const character = resolveCharacter(charName);

      if (!character) {
        await respond(
          bot,
          interaction,
          charName
            ? `Character "${charName}" not found.`
            : "Please specify a character name."
        );
        return;
      }

      const status = formatStateForDisplay(character.id, sceneId);
      await respond(bot, interaction, `**${character.name}'s Status:**\n${status}`);
      break;
    }

    // Attribute subcommand group
    case "set": {
      if (nestedSubcommand === "set" || subcommand === "set") {
        // This is attribute set
        const attrName = getOptionValue<string>(interaction, "name")!;
        const value = getOptionValue<number>(interaction, "value")!;
        const charName = getOptionValue<string>(interaction, "character");
        const character = resolveCharacter(charName);

        if (!character) {
          await respond(bot, interaction, "Please specify a character name.");
          return;
        }

        setAttribute(character.id, sceneId, attrName, value);
        await respond(
          bot,
          interaction,
          `Set **${character.name}**'s ${attrName} to ${value}.`
        );
      }
      break;
    }

    case "mod": {
      const attrName = getOptionValue<string>(interaction, "name")!;
      const amount = getOptionValue<number>(interaction, "amount")!;
      const charName = getOptionValue<string>(interaction, "character");
      const character = resolveCharacter(charName);

      if (!character) {
        await respond(bot, interaction, "Please specify a character name.");
        return;
      }

      const state = modifyAttribute(character.id, sceneId, attrName, amount);
      const newValue = state.attributes[attrName];
      const sign = amount >= 0 ? "+" : "";
      await respond(
        bot,
        interaction,
        `Modified **${character.name}**'s ${attrName}: ${sign}${amount} = ${newValue}`
      );
      break;
    }

    // Effect subcommand group
    case "add": {
      const effectName = getOptionValue<string>(interaction, "name")!;
      const effectType = (getOptionValue<string>(interaction, "type") ?? "custom") as EffectType;
      const description = getOptionValue<string>(interaction, "description");
      const duration = (getOptionValue<string>(interaction, "duration") ?? "permanent") as EffectDuration;
      const charName = getOptionValue<string>(interaction, "character");
      const character = resolveCharacter(charName);

      if (!character) {
        await respond(bot, interaction, "Please specify a character name.");
        return;
      }

      const effect = addEffect(character.id, sceneId, {
        name: effectName,
        type: effectType,
        description,
        duration,
      });

      await respond(
        bot,
        interaction,
        `Added **${effectTypeLabels[effectType]}** to ${character.name}: ${effect.name}${description ? ` - ${description}` : ""}`
      );
      break;
    }

    case "remove": {
      const effectName = getOptionValue<string>(interaction, "name")!;
      const charName = getOptionValue<string>(interaction, "character");
      const character = resolveCharacter(charName);

      if (!character) {
        await respond(bot, interaction, "Please specify a character name.");
        return;
      }

      const removed = removeEffectByName(character.id, sceneId, effectName);
      if (removed) {
        await respond(bot, interaction, `Removed "${effectName}" from ${character.name}.`);
      } else {
        await respond(bot, interaction, `Effect "${effectName}" not found on ${character.name}.`);
      }
      break;
    }

    case "list": {
      const charName = getOptionValue<string>(interaction, "character");
      const character = resolveCharacter(charName);

      if (!character) {
        await respond(bot, interaction, "Please specify a character name.");
        return;
      }

      const effects = getCharacterEffects(character.id, sceneId);
      if (effects.length === 0) {
        await respond(bot, interaction, `${character.name} has no active effects.`);
        return;
      }

      let response = `**${character.name}'s Effects:**\n`;
      for (const effect of effects) {
        const stackText = effect.stacks > 1 ? ` (x${effect.stacks})` : "";
        const typeText = effectTypeLabels[effect.type];
        response += `\n- **${effect.name}**${stackText} [${typeText}]`;
        if (effect.description) {
          response += `\n  ${effect.description}`;
        }
      }

      await respond(bot, interaction, response);
      break;
    }

    // Form subcommand group - "view" handled via nested
    default: {
      // Check for form subcommand group
      const options = interaction.data?.options;
      if (options?.[0]?.name === "form" && options[0].options?.[0]) {
        const formSubcommand = options[0].options[0].name;
        const formOptions = options[0].options[0].options ?? [];

        const charName = formOptions.find((o: {name: string}) => o.name === "character")?.value as string | undefined;
        const character = resolveCharacter(charName);

        if (formSubcommand === "view") {
          if (!character) {
            await respond(bot, interaction, "Please specify a character name.");
            return;
          }

          const state = getCharacterState(character.id, sceneId);
          const body = state?.body ?? {};

          if (Object.keys(body).length === 0) {
            await respond(bot, interaction, `${character.name} has no form traits set.`);
            return;
          }

          let response = `**${character.name}'s Form:**\n`;
          for (const [trait, value] of Object.entries(body)) {
            response += `\n- ${trait}: ${value}`;
          }

          await respond(bot, interaction, response);
          return;
        }

        if (formSubcommand === "set") {
          if (!character) {
            await respond(bot, interaction, "Please specify a character name.");
            return;
          }

          const trait = formOptions.find((o: {name: string}) => o.name === "trait")?.value as string;
          const value = formOptions.find((o: {name: string}) => o.name === "value")?.value as string;

          setBodyTrait(character.id, sceneId, trait, value);
          await respond(
            bot,
            interaction,
            `Set **${character.name}**'s ${trait} to "${value}".`
          );
          return;
        }
      }

      // Check for attribute subcommand group
      if (options?.[0]?.name === "attribute" && options[0].options?.[0]) {
        const attrSubcommand = options[0].options[0].name;
        const attrOptions = options[0].options[0].options ?? [];

        const charName = attrOptions.find((o: {name: string}) => o.name === "character")?.value as string | undefined;
        const character = resolveCharacter(charName);

        if (!character) {
          await respond(bot, interaction, "Please specify a character name.");
          return;
        }

        if (attrSubcommand === "set") {
          const name = attrOptions.find((o: {name: string}) => o.name === "name")?.value as string;
          const value = attrOptions.find((o: {name: string}) => o.name === "value")?.value as number;

          setAttribute(character.id, sceneId, name, value);
          await respond(bot, interaction, `Set **${character.name}**'s ${name} to ${value}.`);
          return;
        }

        if (attrSubcommand === "mod") {
          const name = attrOptions.find((o: {name: string}) => o.name === "name")?.value as string;
          const amount = attrOptions.find((o: {name: string}) => o.name === "amount")?.value as number;

          const state = modifyAttribute(character.id, sceneId, name, amount);
          const newValue = state.attributes[name];
          const sign = amount >= 0 ? "+" : "";
          await respond(
            bot,
            interaction,
            `Modified **${character.name}**'s ${name}: ${sign}${amount} = ${newValue}`
          );
          return;
        }
      }

      // Check for effect subcommand group
      if (options?.[0]?.name === "effect" && options[0].options?.[0]) {
        const effectSubcommand = options[0].options[0].name;
        const effectOptions = options[0].options[0].options ?? [];

        const charName = effectOptions.find((o: {name: string}) => o.name === "character")?.value as string | undefined;
        const character = resolveCharacter(charName);

        if (effectSubcommand === "list") {
          if (!character) {
            await respond(bot, interaction, "Please specify a character name.");
            return;
          }

          const effects = getCharacterEffects(character.id, sceneId);
          if (effects.length === 0) {
            await respond(bot, interaction, `${character.name} has no active effects.`);
            return;
          }

          let response = `**${character.name}'s Effects:**\n`;
          for (const effect of effects) {
            const stackText = effect.stacks > 1 ? ` (x${effect.stacks})` : "";
            const typeText = effectTypeLabels[effect.type];
            response += `\n- **${effect.name}**${stackText} [${typeText}]`;
            if (effect.description) {
              response += `\n  ${effect.description}`;
            }
          }

          await respond(bot, interaction, response);
          return;
        }

        if (effectSubcommand === "add") {
          if (!character) {
            await respond(bot, interaction, "Please specify a character name.");
            return;
          }

          const effectName = effectOptions.find((o: {name: string}) => o.name === "name")?.value as string;
          const effectType = (effectOptions.find((o: {name: string}) => o.name === "type")?.value ?? "custom") as EffectType;
          const description = effectOptions.find((o: {name: string}) => o.name === "description")?.value as string | undefined;
          const duration = (effectOptions.find((o: {name: string}) => o.name === "duration")?.value ?? "permanent") as EffectDuration;

          const effect = addEffect(character.id, sceneId, {
            name: effectName,
            type: effectType,
            description,
            duration,
          });

          await respond(
            bot,
            interaction,
            `Added **${effectTypeLabels[effectType]}** to ${character.name}: ${effect.name}${description ? ` - ${description}` : ""}`
          );
          return;
        }

        if (effectSubcommand === "remove") {
          if (!character) {
            await respond(bot, interaction, "Please specify a character name.");
            return;
          }

          const effectName = effectOptions.find((o: {name: string}) => o.name === "name")?.value as string;

          const removed = removeEffectByName(character.id, sceneId, effectName);
          if (removed) {
            await respond(bot, interaction, `Removed "${effectName}" from ${character.name}.`);
          } else {
            await respond(bot, interaction, `Effect "${effectName}" not found on ${character.name}.`);
          }
          return;
        }
      }

      await respond(bot, interaction, "Unknown subcommand.");
    }
  }
}

