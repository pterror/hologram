import {
  type Bot,
  type Interaction,
  InteractionResponseTypes,
  ApplicationCommandOptionTypes,
  DiscordApplicationIntegrationType,
  DiscordInteractionContextType,
} from "@discordeno/bot";
import { getActiveScene } from "../../scene";
import { getEntity } from "../../db/entities";
import {
  startCombat,
  getActiveCombat,
  endCombat,
  addParticipant,
  removeParticipant,
  nextTurn,
  rollInitiative,
  applyDamage,
  applyHealing,
  addCondition,
  removeCondition,
  getCombatLog,
  formatCombatForDisplay,
} from "../../combat";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyBot = Bot<any, any>;
type AnyInteraction = Interaction;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const combatCommand = {
  name: "combat",
  description: "Manage combat encounters",
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
      name: "start",
      description: "Start combat in the current scene",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "end",
      description: "End the current combat",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "status",
      description: "Show current combat status",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "next",
      description: "Advance to the next turn",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "initiative",
      description: "Re-roll initiative for all participants",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "join",
      description: "Add a character to combat",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character",
          description: "Character ID to add",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "initiative",
          description: "Set initiative (auto-rolled if omitted)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
        },
        {
          name: "hp",
          description: "Set HP (uses character attribute if omitted)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
        },
        {
          name: "ac",
          description: "Set AC (uses character attribute if omitted)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
        },
      ],
    },
    {
      name: "leave",
      description: "Remove a character from combat",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character",
          description: "Character ID to remove",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
      ],
    },
    {
      name: "damage",
      description: "Deal damage to a character",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character",
          description: "Character ID to damage",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "amount",
          description: "Amount of damage",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
          minValue: 0,
        },
      ],
    },
    {
      name: "heal",
      description: "Heal a character",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "character",
          description: "Character ID to heal",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "amount",
          description: "Amount to heal",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
          minValue: 0,
        },
      ],
    },
    {
      name: "condition",
      description: "Add or remove a condition",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "action",
          description: "Add or remove",
          type: ApplicationCommandOptionTypes.String,
          required: true,
          choices: [
            { name: "Add", value: "add" },
            { name: "Remove", value: "remove" },
          ],
        },
        {
          name: "character",
          description: "Character ID",
          type: ApplicationCommandOptionTypes.Integer,
          required: true,
        },
        {
          name: "name",
          description: "Condition name (e.g., stunned, prone, poisoned)",
          type: ApplicationCommandOptionTypes.String,
          required: true,
        },
      ],
    },
    {
      name: "log",
      description: "Show recent combat log",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "count",
          description: "Number of entries to show (default 10)",
          type: ApplicationCommandOptionTypes.Integer,
          required: false,
          minValue: 1,
          maxValue: 50,
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

export async function handleCombatCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const subcommand = interaction.data?.options?.[0]?.name;

  const respond = async (content: string, ephemeral = false) => {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content, flags: ephemeral ? 64 : 0 },
    });
  };

  // Most commands require an active scene
  const scene = getActiveScene(channelId);

  switch (subcommand) {
    case "start": {
      if (!scene) {
        await respond("No active scene. Start one with `/scene start` first.", true);
        return;
      }

      const existing = getActiveCombat(scene.id);
      if (existing) {
        await respond("Combat is already active in this scene. Use `/combat end` first.", true);
        return;
      }

      const combat = startCombat(scene.id);
      await respond(`⚔️ **Combat started!** (Round ${combat.round})\n\nUse \`/combat join <character>\` to add participants.`);
      return;
    }

    case "end": {
      if (!scene) {
        await respond("No active scene.", true);
        return;
      }

      const combat = getActiveCombat(scene.id);
      if (!combat) {
        await respond("No active combat to end.", true);
        return;
      }

      endCombat(combat.id);
      await respond("🏁 **Combat ended.**");
      return;
    }

    case "status": {
      if (!scene) {
        await respond("No active scene.", true);
        return;
      }

      const combat = getActiveCombat(scene.id);
      if (!combat) {
        await respond("No active combat.", true);
        return;
      }

      await respond(formatCombatForDisplay(combat.id));
      return;
    }

    case "next": {
      if (!scene) {
        await respond("No active scene.", true);
        return;
      }

      const combat = getActiveCombat(scene.id);
      if (!combat) {
        await respond("No active combat.", true);
        return;
      }

      const result = nextTurn(combat.id);
      const entity = result.participant
        ? getEntity(result.participant.characterId)
        : null;
      const name = entity?.name ?? "Unknown";

      let msg = "";
      if (result.newRound) {
        msg += `📢 **Round ${result.combat.round}!**\n`;
      }
      msg += `▶ **${name}**'s turn`;

      if (result.participant && result.participant.hp !== null && result.participant.maxHp !== null) {
        msg += ` (HP: ${result.participant.hp}/${result.participant.maxHp})`;
      }

      if (result.participant && result.participant.conditions.length > 0) {
        msg += ` [${result.participant.conditions.join(", ")}]`;
      }

      await respond(msg);
      return;
    }

    case "initiative": {
      if (!scene) {
        await respond("No active scene.", true);
        return;
      }

      const combat = getActiveCombat(scene.id);
      if (!combat) {
        await respond("No active combat.", true);
        return;
      }

      const participants = rollInitiative(combat.id);
      if (participants.length === 0) {
        await respond("No participants to roll initiative for.", true);
        return;
      }

      const lines = ["🎲 **Initiative rolled!**\n"];
      for (const p of participants) {
        const entity = getEntity(p.characterId);
        lines.push(`${p.initiative} - **${entity?.name ?? `Character ${p.characterId}`}**`);
      }

      await respond(lines.join("\n"));
      return;
    }

    case "join": {
      if (!scene) {
        await respond("No active scene.", true);
        return;
      }

      const combat = getActiveCombat(scene.id);
      if (!combat) {
        await respond("No active combat. Use `/combat start` first.", true);
        return;
      }

      const characterId = getSubOpt<number>(interaction, "character");
      if (!characterId) {
        await respond("Please provide a character ID.", true);
        return;
      }

      const entity = getEntity(characterId);
      if (!entity) {
        await respond(`Character ${characterId} not found.`, true);
        return;
      }

      const initiative = getSubOpt<number>(interaction, "initiative");
      const hp = getSubOpt<number>(interaction, "hp");
      const ac = getSubOpt<number>(interaction, "ac");

      const participant = addParticipant(combat.id, characterId, {
        initiative: initiative ?? undefined,
        hp: hp ?? undefined,
        ac: ac ?? undefined,
      });

      let msg = `**${entity.name}** joined combat! (Initiative: ${participant.initiative})`;
      if (participant.hp !== null) {
        msg += ` | HP: ${participant.hp}/${participant.maxHp ?? "?"}`;
      }
      if (participant.ac !== null) {
        msg += ` | AC: ${participant.ac}`;
      }

      await respond(msg);
      return;
    }

    case "leave": {
      if (!scene) {
        await respond("No active scene.", true);
        return;
      }

      const combat = getActiveCombat(scene.id);
      if (!combat) {
        await respond("No active combat.", true);
        return;
      }

      const characterId = getSubOpt<number>(interaction, "character");
      if (!characterId) {
        await respond("Please provide a character ID.", true);
        return;
      }

      const entity = getEntity(characterId);
      const removed = removeParticipant(combat.id, characterId);

      if (removed) {
        await respond(`**${entity?.name ?? `Character ${characterId}`}** left combat.`);
      } else {
        await respond("Character not found in combat.", true);
      }
      return;
    }

    case "damage": {
      if (!scene) {
        await respond("No active scene.", true);
        return;
      }

      const combat = getActiveCombat(scene.id);
      if (!combat) {
        await respond("No active combat.", true);
        return;
      }

      const characterId = getSubOpt<number>(interaction, "character");
      const amount = getSubOpt<number>(interaction, "amount");

      if (!characterId || amount === undefined) {
        await respond("Please provide character and damage amount.", true);
        return;
      }

      const result = applyDamage(combat.id, characterId, amount);
      if (!result) {
        await respond("Character not found in combat or has no HP.", true);
        return;
      }

      const entity = getEntity(characterId);
      const name = entity?.name ?? `Character ${characterId}`;
      let msg = `💥 **${name}** takes **${amount}** damage! (HP: ${result.participant.hp}/${result.participant.maxHp ?? "?"})`;
      if (result.downed) {
        msg += `\n☠️ **${name} is downed!**`;
      }

      await respond(msg);
      return;
    }

    case "heal": {
      if (!scene) {
        await respond("No active scene.", true);
        return;
      }

      const combat = getActiveCombat(scene.id);
      if (!combat) {
        await respond("No active combat.", true);
        return;
      }

      const characterId = getSubOpt<number>(interaction, "character");
      const amount = getSubOpt<number>(interaction, "amount");

      if (!characterId || amount === undefined) {
        await respond("Please provide character and heal amount.", true);
        return;
      }

      const result = applyHealing(combat.id, characterId, amount);
      if (!result) {
        await respond("Character not found in combat or has no HP.", true);
        return;
      }

      const entity = getEntity(characterId);
      const name = entity?.name ?? `Character ${characterId}`;
      await respond(`💚 **${name}** heals **${amount}** HP! (HP: ${result.hp}/${result.maxHp ?? "?"})`);
      return;
    }

    case "condition": {
      if (!scene) {
        await respond("No active scene.", true);
        return;
      }

      const combat = getActiveCombat(scene.id);
      if (!combat) {
        await respond("No active combat.", true);
        return;
      }

      const action = getSubOpt<string>(interaction, "action");
      const characterId = getSubOpt<number>(interaction, "character");
      const conditionName = getSubOpt<string>(interaction, "name");

      if (!action || !characterId || !conditionName) {
        await respond("Please provide action, character, and condition name.", true);
        return;
      }

      const entity = getEntity(characterId);
      const name = entity?.name ?? `Character ${characterId}`;

      if (action === "add") {
        const ok = addCondition(combat.id, characterId, conditionName);
        if (ok) {
          await respond(`**${name}** gains condition: **${conditionName}**`);
        } else {
          await respond("Character not found in combat.", true);
        }
      } else {
        const ok = removeCondition(combat.id, characterId, conditionName);
        if (ok) {
          await respond(`**${name}** loses condition: **${conditionName}**`);
        } else {
          await respond("Condition not found or character not in combat.", true);
        }
      }
      return;
    }

    case "log": {
      if (!scene) {
        await respond("No active scene.", true);
        return;
      }

      const combat = getActiveCombat(scene.id);
      if (!combat) {
        await respond("No active combat.", true);
        return;
      }

      const count = getSubOpt<number>(interaction, "count") ?? 10;
      const entries = getCombatLog(combat.id, count);

      if (entries.length === 0) {
        await respond("No combat log entries.", true);
        return;
      }

      const lines = ["**Combat Log:**\n"];
      for (const entry of entries) {
        const prefix = `R${entry.round}`;
        lines.push(`\`${prefix}\` ${entry.details ?? entry.action}`);
      }

      await respond(lines.join("\n"));
      return;
    }

    default:
      await respond("Unknown combat subcommand.", true);
  }
}
