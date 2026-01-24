import { createBot, Intents } from "@discordeno/bot";
import { handleMessage } from "./events/message";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN environment variable is required");
}

export const bot = createBot({
  token,
  intents:
    Intents.Guilds |
    Intents.GuildMessages |
    Intents.MessageContent |
    Intents.DirectMessages,
  desiredProperties: {
    user: {
      id: true,
      username: true,
      bot: true as const,
    },
    message: {
      id: true,
      content: true,
      channelId: true,
      guildId: true,
      author: true,
      mentionedUserIds: true as const,
    },
  },
});

let botUserId: bigint | null = null;

// Event handlers
bot.events.ready = (payload) => {
  console.log(`Logged in as ${payload.user.username}`);
  botUserId = payload.user.id;
};

bot.events.messageCreate = async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Ignore messages without content
  if (!message.content) return;

  // Check if bot is mentioned
  const isBotMentioned =
    botUserId !== null && message.mentionedUserIds?.includes(botUserId);

  console.log(
    `[${message.guildId ?? "DM"}] ${message.author.username}: ${message.content}`
  );

  // Handle the message
  const response = await handleMessage(
    message.channelId.toString(),
    message.guildId?.toString(),
    message.author.id.toString(),
    message.author.username,
    message.content,
    isBotMentioned ?? false
  );

  // Send response if we got one
  if (response) {
    try {
      await bot.helpers.sendMessage(message.channelId, {
        content: response,
      });
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }
};

export async function startBot() {
  console.log("Starting Hologram bot...");
  await bot.start();
}
