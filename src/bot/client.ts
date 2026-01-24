import { createBot, Intents } from "@discordeno/bot";

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
      mentions: true,
    },
  },
});

// Event handlers
bot.events.ready = (payload) => {
  console.log(`Logged in as ${payload.user.username}`);
};

bot.events.messageCreate = async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Ignore messages without content
  if (!message.content) return;

  // For now, just log messages - context assembly and LLM call will go here
  console.log(
    `[${message.guildId}] ${message.author.username}: ${message.content}`
  );

  // TODO: Check if bot is mentioned or in RP channel
  // TODO: Assemble context
  // TODO: Call LLM
  // TODO: Extract state changes
  // TODO: Send response
};

export async function startBot() {
  console.log("Starting Hologram bot...");
  await bot.start();
}
