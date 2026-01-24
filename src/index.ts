import { getDb, closeDb } from "./db";
import { startBot } from "./bot/client";

// Initialize database
console.log("Initializing database...");
getDb();

// Start bot
await startBot();

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  closeDb();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down...");
  closeDb();
  process.exit(0);
});
