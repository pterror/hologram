import {
  type CreateApplicationCommand,
  ApplicationCommandOptionTypes,
} from "@discordeno/bot";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBot = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInteraction = any;

import {
  createScene,
  getActiveScene,
  listPausedScenes,
  pauseScene,
  resumeScene,
  endScene,
  formatTime,
  formatSceneForContext,
  addCharacterToScene,
  removeCharacterFromScene,
  setActiveCharacter,
  getSceneCharacters,
  type Scene,
} from "../../scene";
import { getWorldState } from "../../world/state";
import {
  getEntity,
  getEntitiesByType,
  type CharacterData,
  type LocationData,
  type Entity,
} from "../../db/entities";
import { getOptionValue, getSubcommand, respond, USER_APP_INTEGRATION } from "./index";

export const sceneCommand: CreateApplicationCommand = {
  name: "scene",
  description: "Manage RP scenes",
  ...USER_APP_INTEGRATION,
  options: [
    {
      name: "start",
      description: "Start a new scene",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "location",
          description: "Starting location name",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
        {
          name: "ambience",
          description: "Scene ambience/mood description",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "pause",
      description: "Pause the current scene",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "resume",
      description: "Resume a paused scene",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "id",
          description: "Scene ID to resume (from /scene list)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
        },
      ],
    },
    {
      name: "end",
      description: "End the current scene permanently",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "status",
      description: "Show current scene status",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "list",
      description: "List paused scenes",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "cast",
      description: "Manage characters in the scene",
      type: ApplicationCommandOptionTypes.SubCommandGroup,
      options: [
        {
          name: "add",
          description: "Add a character to the scene",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "character",
              description: "Character name",
              type: ApplicationCommandOptionTypes.String,
              required: true,
            },
            {
              name: "voice",
              description: "AI should voice this character",
              type: ApplicationCommandOptionTypes.Boolean,
              required: false,
            },
          ],
        },
        {
          name: "remove",
          description: "Remove a character from the scene",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "character",
              description: "Character name",
              type: ApplicationCommandOptionTypes.String,
              required: true,
            },
          ],
        },
        {
          name: "voice",
          description: "Set which character AI is voicing",
          type: ApplicationCommandOptionTypes.SubCommand,
          options: [
            {
              name: "character",
              description: "Character name",
              type: ApplicationCommandOptionTypes.String,
              required: true,
            },
          ],
        },
        {
          name: "list",
          description: "List characters in the scene",
          type: ApplicationCommandOptionTypes.SubCommand,
        },
      ],
    },
  ],
};

export async function handleSceneCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const subcommand = getSubcommand(interaction);

  // Get world context
  const worldState = getWorldState(channelId);
  if (!worldState && subcommand !== "list") {
    await respond(bot, interaction, "No world initialized. Use `/world init` first.");
    return;
  }

  switch (subcommand) {
    case "start": {
      // Check for existing active scene
      const existing = getActiveScene(channelId);
      if (existing) {
        await respond(
          bot,
          interaction,
          "There's already an active scene. Use `/scene pause` or `/scene end` first."
        );
        return;
      }

      const locationName = getOptionValue<string>(interaction, "location");
      const ambience = getOptionValue<string>(interaction, "ambience");

      // Find location if specified
      let locationId: number | undefined;
      if (locationName && worldState) {
        const locations = getEntitiesByType<LocationData>("location", worldState.id);
        const location = locations.find(
          (l: Entity<LocationData>) => l.name.toLowerCase() === locationName.toLowerCase()
        );
        if (location) {
          locationId = location.id;
        }
      }

      const scene = createScene(worldState!.id, channelId, {
        locationId,
        ambience: ambience ?? undefined,
        time: worldState!.time,
        weather: worldState!.weather ?? undefined,
      });

      let response = `**Scene started!** (ID: ${scene.id})\n`;
      response += formatSceneForContext(scene);
      response += "\n\nUse `/scene cast add <character>` to add characters.";

      await respond(bot, interaction, response);
      break;
    }

    case "pause": {
      const scene = pauseScene(channelId);
      if (!scene) {
        await respond(bot, interaction, "No active scene to pause.");
        return;
      }

      await respond(
        bot,
        interaction,
        `Scene paused. (ID: ${scene.id})\nUse \`/scene resume ${scene.id}\` to continue later.`
      );
      break;
    }

    case "resume": {
      const sceneId = getOptionValue<number>(interaction, "id");

      if (sceneId) {
        const scene = resumeScene(sceneId);
        if (!scene) {
          await respond(bot, interaction, `Scene ${sceneId} not found or not paused.`);
          return;
        }

        let response = `**Scene resumed!** (ID: ${scene.id})\n`;
        response += formatSceneForContext(scene);
        await respond(bot, interaction, response);
      } else {
        // Resume most recent paused scene
        const pausedScenes = listPausedScenes(channelId);
        if (pausedScenes.length === 0) {
          await respond(bot, interaction, "No paused scenes to resume.");
          return;
        }

        const scene = resumeScene(pausedScenes[0].id);
        if (!scene) {
          await respond(bot, interaction, "Failed to resume scene.");
          return;
        }

        let response = `**Scene resumed!** (ID: ${scene.id})\n`;
        response += formatSceneForContext(scene);
        await respond(bot, interaction, response);
      }
      break;
    }

    case "end": {
      const scene = endScene(channelId);
      if (!scene) {
        await respond(bot, interaction, "No active scene to end.");
        return;
      }

      await respond(bot, interaction, `Scene ended. Duration: ${formatSceneDuration(scene)}`);
      break;
    }

    case "status": {
      const scene = getActiveScene(channelId);
      if (!scene) {
        await respond(bot, interaction, "No active scene. Use `/scene start` to begin.");
        return;
      }

      const characters = getSceneCharacters(scene.id);
      let response = formatSceneForContext(scene);

      if (characters.length > 0) {
        response += "\n\n**Characters:**";
        for (const char of characters) {
          const entity = getEntity<CharacterData>(char.characterId);
          if (entity) {
            const status = char.isActive ? " (voicing)" : "";
            const type = char.isAI ? "AI" : "Player";
            response += `\n- ${entity.name} [${type}]${status}`;
          }
        }
      }

      await respond(bot, interaction, response);
      break;
    }

    case "list": {
      const pausedScenes = listPausedScenes(channelId);
      if (pausedScenes.length === 0) {
        await respond(bot, interaction, "No paused scenes.");
        return;
      }

      let response = "**Paused Scenes:**\n";
      for (const scene of pausedScenes) {
        const time = formatTime(scene.time);
        const date = new Date(scene.lastActiveAt * 1000).toLocaleDateString();
        response += `\n**ID ${scene.id}** - ${time} (paused ${date})`;
      }
      response += "\n\nUse `/scene resume <id>` to continue.";

      await respond(bot, interaction, response);
      break;
    }

    // Cast subcommand group
    case "add": {
      const scene = getActiveScene(channelId);
      if (!scene) {
        await respond(bot, interaction, "No active scene. Use `/scene start` first.");
        return;
      }

      const characterName = getOptionValue<string>(interaction, "character")!;
      const voice = getOptionValue<boolean>(interaction, "voice") ?? true;

      // Find character
      const characters = getEntitiesByType<CharacterData>("character", scene.worldId);
      const character = characters.find(
        (c: Entity<CharacterData>) => c.name.toLowerCase() === characterName.toLowerCase()
      );

      if (!character) {
        await respond(
          bot,
          interaction,
          `Character "${characterName}" not found. Use \`/character list\` to see available characters.`
        );
        return;
      }

      addCharacterToScene(scene.id, character.id, { isAI: true, isActive: voice });
      await respond(
        bot,
        interaction,
        `Added **${character.name}** to the scene${voice ? " (voicing)" : ""}.`
      );
      break;
    }

    case "remove": {
      const scene = getActiveScene(channelId);
      if (!scene) {
        await respond(bot, interaction, "No active scene.");
        return;
      }

      const characterName = getOptionValue<string>(interaction, "character")!;
      const characters = getEntitiesByType<CharacterData>("character", scene.worldId);
      const character = characters.find(
        (c: Entity<CharacterData>) => c.name.toLowerCase() === characterName.toLowerCase()
      );

      if (!character) {
        await respond(bot, interaction, `Character "${characterName}" not found.`);
        return;
      }

      removeCharacterFromScene(scene.id, character.id);
      await respond(bot, interaction, `Removed **${character.name}** from the scene.`);
      break;
    }

    case "voice": {
      const scene = getActiveScene(channelId);
      if (!scene) {
        await respond(bot, interaction, "No active scene.");
        return;
      }

      const characterName = getOptionValue<string>(interaction, "character")!;
      const characters = getEntitiesByType<CharacterData>("character", scene.worldId);
      const character = characters.find(
        (c: Entity<CharacterData>) => c.name.toLowerCase() === characterName.toLowerCase()
      );

      if (!character) {
        await respond(bot, interaction, `Character "${characterName}" not found.`);
        return;
      }

      // Clear other active voices and set this one
      const sceneChars = getSceneCharacters(scene.id);
      for (const sc of sceneChars) {
        if (sc.isActive && sc.characterId !== character.id) {
          setActiveCharacter(scene.id, sc.characterId, false);
        }
      }
      setActiveCharacter(scene.id, character.id, true);

      await respond(bot, interaction, `Now voicing **${character.name}**.`);
      break;
    }

    default: {
      // Check for nested subcommand (cast group)
      const options = interaction.data?.options;
      if (options?.[0]?.name === "cast" && options[0].options?.[0]) {
        const castSubcommand = options[0].options[0].name;

        switch (castSubcommand) {
          case "add":
          case "remove":
          case "voice":
            // These are handled above through getSubcommand
            break;
          case "list": {
            const scene = getActiveScene(channelId);
            if (!scene) {
              await respond(bot, interaction, "No active scene.");
              return;
            }

            const characters = getSceneCharacters(scene.id);
            if (characters.length === 0) {
              await respond(bot, interaction, "No characters in scene. Use `/scene cast add <character>`.");
              return;
            }

            let response = "**Scene Cast:**\n";
            for (const char of characters) {
              const entity = getEntity<CharacterData>(char.characterId);
              if (entity) {
                const status = char.isActive ? " **[voicing]**" : "";
                const type = char.isAI ? "AI" : "Player";
                response += `\n- ${entity.name} (${type})${status}`;
              }
            }

            await respond(bot, interaction, response);
            return;
          }
        }
      }

      await respond(bot, interaction, "Unknown subcommand.");
    }
  }
}

function formatSceneDuration(scene: Scene): string {
  const start = scene.createdAt;
  const end = scene.endedAt ?? Math.floor(Date.now() / 1000);
  const minutes = Math.floor((end - start) / 60);

  if (minutes < 60) {
    return `${minutes} minutes`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}m`;
}

