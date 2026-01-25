import {
  type Bot,
  type Interaction,
  InteractionResponseTypes,
  ApplicationCommandOptionTypes,
  DiscordApplicationIntegrationType,
  DiscordInteractionContextType,
  MessageComponentTypes,
  TextStyles,
} from "@discordeno/bot";
import { getActiveScene } from "../../scene";
import { createEntity } from "../../db/entities";
import {
  createWizardSession,
  getWizardSession,
  updateWizardSession,
  cancelWizard,
  getCurrentStep,
  getTotalSteps,
  formatWizardProgress,
  encodeWizardAction,
  decodeWizardAction,
  isWizardComplete,
  type WizardSession,
  type WizardType,
} from "../../wizards";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyBot = Bot<any, any>;
type AnyInteraction = Interaction;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const buildCommand = {
  name: "build",
  description: "Guided creation wizards for characters, worlds, locations, and items",
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
      name: "character",
      description: "Start the character creation wizard",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "world",
      description: "Start the world creation wizard",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "location",
      description: "Start the location creation wizard",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "item",
      description: "Start the item creation wizard",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "cancel",
      description: "Cancel the active wizard",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
  ],
};

export async function handleBuildCommand(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<void> {
  const channelId = interaction.channelId?.toString() ?? "";
  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";
  const subcommand = interaction.data?.options?.[0]?.name;

  const scene = getActiveScene(channelId);
  const worldId = scene?.worldId;

  if (subcommand === "cancel") {
    // Import dynamically to avoid circular dep
    const { cancelUserSession } = await import("../../wizards");
    const cancelled = cancelUserSession(userId, channelId);
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: cancelled ? "Wizard cancelled." : "No active wizard to cancel.",
        flags: 64,
      },
    });
    return;
  }

  const wizardType = subcommand as WizardType;
  if (!["character", "world", "location", "item"].includes(wizardType)) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: "Unknown wizard type.", flags: 64 },
    });
    return;
  }

  // Create wizard session
  const session = createWizardSession(wizardType, userId, channelId, {
    worldId,
    expiresInMinutes: 30,
  });

  await sendWizardStep(bot, interaction, session, false);
}

/** Send the current wizard step as a message with components */
async function sendWizardStep(
  bot: AnyBot,
  interaction: AnyInteraction,
  session: WizardSession,
  isUpdate: boolean
): Promise<void> {
  const step = getCurrentStep(session);
  const total = getTotalSteps(session.type);

  if (!step || session.step >= total) {
    // Wizard complete - show preview
    await sendWizardPreview(bot, interaction, session, isUpdate);
    return;
  }

  const progress = formatWizardProgress(session);
  const content = `${progress}\n\n**${step.prompt}**${step.required ? "" : " *(optional)*"}`;

  const components = buildStepComponents(session);

  const responseType = isUpdate ? 7 : InteractionResponseTypes.ChannelMessageWithSource;

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: responseType,
    data: {
      content,
      components,
      flags: 64,
    },
  });
}

/** Build Discord components for the current wizard step */
function buildStepComponents(session: WizardSession): any[] {
  const step = getCurrentStep(session);
  if (!step) return [];

  const buttons: any[] = [];

  // Enter answer button (opens modal)
  buttons.push({
    type: MessageComponentTypes.Button,
    style: 1, // Primary
    label: "Enter Answer",
    customId: encodeWizardAction(session.id, "enter"),
  });

  // Skip button (for optional steps)
  if (!step.required) {
    buttons.push({
      type: MessageComponentTypes.Button,
      style: 2, // Secondary
      label: "Skip",
      customId: encodeWizardAction(session.id, "skip"),
    });
  }

  // Cancel button
  buttons.push({
    type: MessageComponentTypes.Button,
    style: 4, // Danger
    label: "Cancel",
    customId: encodeWizardAction(session.id, "cancel"),
  });

  return [
    {
      type: MessageComponentTypes.ActionRow,
      components: buttons,
    },
  ];
}

/** Send the wizard preview with create/cancel buttons */
async function sendWizardPreview(
  bot: AnyBot,
  interaction: AnyInteraction,
  session: WizardSession,
  isUpdate: boolean
): Promise<void> {
  const lines: string[] = [];
  const typeName = session.type.charAt(0).toUpperCase() + session.type.slice(1);
  lines.push(`**${typeName} Preview:**\n`);

  for (const [key, value] of Object.entries(session.data)) {
    if (value !== undefined && value !== null && value !== "") {
      const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, " $1");
      const preview = String(value).length > 200
        ? String(value).slice(0, 200) + "..."
        : String(value);
      lines.push(`**${label}:** ${preview}`);
    }
  }

  const complete = isWizardComplete(session);

  const buttons: any[] = [];

  if (complete) {
    buttons.push({
      type: MessageComponentTypes.Button,
      style: 3, // Success
      label: "Create",
      customId: encodeWizardAction(session.id, "create"),
    });
  }

  // Back button to edit
  buttons.push({
    type: MessageComponentTypes.Button,
    style: 2, // Secondary
    label: "Edit (Go Back)",
    customId: encodeWizardAction(session.id, "back"),
  });

  buttons.push({
    type: MessageComponentTypes.Button,
    style: 4, // Danger
    label: "Cancel",
    customId: encodeWizardAction(session.id, "cancel"),
  });

  const responseType = isUpdate ? 7 : InteractionResponseTypes.ChannelMessageWithSource;

  await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
    type: responseType,
    data: {
      content: lines.join("\n"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components: buttons.length > 0 ? [{ type: MessageComponentTypes.ActionRow, components: buttons } as any] : [],
      flags: 64,
    },
  });
}

/** Handle wizard component interactions (buttons and modals) */
export async function handleBuildWizardComponent(
  bot: AnyBot,
  interaction: AnyInteraction
): Promise<boolean> {
  const customId = interaction.data?.customId;
  if (!customId?.startsWith("wizard:")) return false;

  const decoded = decodeWizardAction(customId);
  if (!decoded) return false;

  const { sessionId, action } = decoded;
  const session = getWizardSession(sessionId);

  if (!session) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: 7, // UpdateMessage
      data: {
        content: "This wizard session has expired.",
        components: [],
      },
    });
    return true;
  }

  // Verify the user is the session owner
  const userId = interaction.user?.id?.toString() ?? interaction.member?.id?.toString() ?? "";
  if (session.userId !== userId) {
    await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: {
        content: "This wizard belongs to someone else.",
        flags: 64,
      },
    });
    return true;
  }

  switch (action) {
    case "enter": {
      // Open a modal for text input
      const step = getCurrentStep(session);
      if (!step) return true;

      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 9, // Modal
        data: {
          title: `${session.type.charAt(0).toUpperCase() + session.type.slice(1)}: ${step.name}`,
          customId: encodeWizardAction(session.id, "modal_submit"),
          components: [
            {
              type: MessageComponentTypes.ActionRow,
              components: [
                {
                  type: 4, // TextInput
                  customId: "wizard_input",
                  label: step.name,
                  style: step.inputType === "text" ? TextStyles.Paragraph : TextStyles.Short,
                  placeholder: step.prompt,
                  required: step.required,
                  maxLength: 2000,
                },
              ],
            },
          ],
        },
      });
      return true;
    }

    case "modal_submit": {
      // Modal was submitted - get the value
      const components = interaction.data?.components ?? [];
      let value = "";
      for (const row of components) {
        for (const comp of (row as any).components ?? []) {
          if (comp.customId === "wizard_input") {
            value = comp.value ?? "";
          }
        }
      }

      const step = getCurrentStep(session);
      if (!step) return true;

      // Store the value and advance
      const newData: Record<string, unknown> = {};
      if (value.trim()) {
        newData[step.field] = value.trim();
      }

      const updated = updateWizardSession(session.id, {
        step: session.step + 1,
        data: newData,
      });

      if (updated) {
        await sendWizardStep(bot, interaction, updated, true);
      }
      return true;
    }

    case "skip": {
      // Skip current optional step
      const updated = updateWizardSession(session.id, {
        step: session.step + 1,
      });
      if (updated) {
        await sendWizardStep(bot, interaction, updated, true);
      }
      return true;
    }

    case "back": {
      // Go back one step
      const newStep = Math.max(0, session.step - 1);
      const updated = updateWizardSession(session.id, { step: newStep });
      if (updated) {
        await sendWizardStep(bot, interaction, updated, true);
      }
      return true;
    }

    case "create": {
      // Create the entity
      const result = await createFromWizard(session);
      cancelWizard(session.id);

      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 7, // UpdateMessage
        data: {
          content: result,
          components: [],
        },
      });
      return true;
    }

    case "cancel": {
      cancelWizard(session.id);
      await bot.helpers.sendInteractionResponse(interaction.id, interaction.token, {
        type: 7, // UpdateMessage
        data: {
          content: "Wizard cancelled.",
          components: [],
        },
      });
      return true;
    }

    default:
      return false;
  }
}

/** Create an entity from wizard session data */
async function createFromWizard(session: WizardSession): Promise<string> {
  const { data, type, worldId } = session;
  const name = String(data.name ?? "Unnamed");

  switch (type) {
    case "character": {
      const entity = createEntity("character", name, {
        persona: data.persona ?? "",
        scenario: data.scenario,
        exampleDialogue: data.exampleDialogue,
      }, worldId ?? undefined);
      return `**Character created!** ${entity.name} (ID: ${entity.id})`;
    }

    case "world": {
      const { getDb } = await import("../../db");
      const db = getDb();
      const desc = String(data.description ?? "");
      const lore = data.lore ? String(data.lore) : null;
      const rules = data.rules ? String(data.rules) : null;
      const row = db.prepare(`
        INSERT INTO worlds (name, description, lore, rules)
        VALUES (?, ?, ?, ?)
        RETURNING id
      `).get(name, desc, lore, rules) as { id: number };
      return `**World created!** ${name} (ID: ${row.id})`;
    }

    case "location": {
      const entity = createEntity("location", name, {
        description: data.description ?? "",
        locationType: data.locationType ?? "location",
        ambience: data.ambience,
      }, worldId ?? undefined);
      return `**Location created!** ${entity.name} (ID: ${entity.id})`;
    }

    case "item": {
      const entity = createEntity("item", name, {
        description: data.description ?? "",
        type: data.itemType ?? "misc",
        effect: data.effect,
      }, worldId ?? undefined);
      return `**Item created!** ${entity.name} (ID: ${entity.id})`;
    }
  }
}
