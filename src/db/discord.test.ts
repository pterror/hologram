import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";

// =============================================================================
// In-memory DB mock for DB-backed tests
// =============================================================================

let testDb: Database;

mock.module("./index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

import {
  parseMessageData,
  addDiscordEntity,
  resolveDiscordEntities,
  resolveDiscordEntity,
  getChannelScopedEntities,
  getGuildScopedEntities,
  removeDiscordEntityBinding,
  removeDiscordEntity,
  setDiscordConfig,
  getDiscordConfig,
  deleteDiscordConfig,
  resolveDiscordConfig,
  addMessage,
  getMessages,
  countUnreadMessages,
  trackWebhookMessage,
  getWebhookMessageEntity,
  recordEvalError,
  getUnnotifiedErrors,
  markErrorsNotified,
  clearEntityErrors,
  isNewUser,
  markUserWelcomed,
  setChannelForgetTime,
  type MessageData,
  type EmbedData,
  type AttachmentData,
  type StickerData,
} from "./discord";

function createTestSchema(db: Database) {
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owned_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      template TEXT,
      system_template TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL,
      discord_type TEXT NOT NULL CHECK (discord_type IN ('user', 'channel', 'guild')),
      scope_guild_id TEXT,
      scope_channel_id TEXT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      UNIQUE (discord_id, discord_type, scope_guild_id, scope_channel_id, entity_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_config (
      discord_id TEXT NOT NULL,
      discord_type TEXT NOT NULL CHECK (discord_type IN ('channel', 'guild')),
      config_bind TEXT,
      config_persona TEXT,
      config_blacklist TEXT,
      PRIMARY KEY (discord_id, discord_type)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      discord_message_id TEXT,
      data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_messages (
      message_id TEXT PRIMARY KEY,
      entity_id INTEGER NOT NULL,
      entity_name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_forgets (
      channel_id TEXT PRIMARY KEY,
      forget_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL UNIQUE,
      webhook_id TEXT NOT NULL,
      webhook_token TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS welcomed_users (
      discord_id TEXT PRIMARY KEY,
      welcomed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      error_message TEXT NOT NULL,
      condition TEXT,
      notified_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (entity_id, error_message)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_discord_entities_lookup ON discord_entities(discord_id, discord_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_discord_id ON messages(discord_message_id)`);
}

/** Create a test entity and return its ID */
function createEntity(name: string, ownedBy?: string): number {
  const row = testDb.prepare(`
    INSERT INTO entities (name, owned_by) VALUES (?, ?) RETURNING id
  `).get(name, ownedBy ?? null) as { id: number };
  return row.id;
}

/** Insert a message with an explicit timestamp for deterministic ordering */
function insertMessage(
  channelId: string,
  authorId: string,
  authorName: string,
  content: string,
  discordMessageId: string | null,
  timestamp: string
): void {
  testDb.prepare(`
    INSERT INTO messages (channel_id, author_id, author_name, content, discord_message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(channelId, authorId, authorName, content, discordMessageId, timestamp);
}

// =============================================================================
// Pure function tests (no DB needed)
// =============================================================================

describe("parseMessageData", () => {
  test("null input returns null", () => {
    expect(parseMessageData(null)).toBeNull();
  });

  test("empty string returns null", () => {
    expect(parseMessageData("")).toBeNull();
  });

  test("invalid JSON returns null", () => {
    expect(parseMessageData("{bad json")).toBeNull();
    expect(parseMessageData("undefined")).toBeNull();
    expect(parseMessageData("not json at all")).toBeNull();
  });

  test("empty object parses", () => {
    expect(parseMessageData("{}")).toEqual({});
  });

  test("is_bot flag", () => {
    const result = parseMessageData('{"is_bot":true}');
    expect(result).toEqual({ is_bot: true });
  });

  test("full embed object", () => {
    const embed: EmbedData = {
      title: "Test Embed",
      type: "rich",
      description: "A description",
      url: "https://example.com",
      timestamp: 1700000000000,
      color: 0xFF0000,
      footer: { text: "Footer text", icon_url: "https://example.com/icon.png" },
      image: { url: "https://example.com/image.png", height: 100, width: 200 },
      thumbnail: { url: "https://example.com/thumb.png", height: 50, width: 50 },
      video: { url: "https://example.com/video.mp4", height: 720, width: 1280 },
      provider: { name: "YouTube", url: "https://youtube.com" },
      author: { name: "Author", url: "https://example.com/author", icon_url: "https://example.com/author.png" },
      fields: [
        { name: "Field 1", value: "Value 1", inline: true },
        { name: "Field 2", value: "Value 2" },
      ],
    };
    const data: MessageData = { embeds: [embed] };
    const result = parseMessageData(JSON.stringify(data));
    expect(result).toEqual(data);
    expect(result!.embeds![0].footer!.text).toBe("Footer text");
    expect(result!.embeds![0].image!.width).toBe(200);
    expect(result!.embeds![0].fields![0].inline).toBe(true);
    expect(result!.embeds![0].fields![1].inline).toBeUndefined();
  });

  test("sparse embed with only some fields", () => {
    const data: MessageData = {
      embeds: [
        { description: "Just a description" },
        { title: "Just a title", fields: [] },
        { image: { url: "https://example.com/img.png" } },
      ],
    };
    const result = parseMessageData(JSON.stringify(data));
    expect(result!.embeds!.length).toBe(3);
    expect(result!.embeds![0].title).toBeUndefined();
    expect(result!.embeds![0].description).toBe("Just a description");
    expect(result!.embeds![1].description).toBeUndefined();
    expect(result!.embeds![2].image!.url).toBe("https://example.com/img.png");
  });

  test("full attachment object", () => {
    const attachment: AttachmentData = {
      filename: "photo.png",
      url: "https://cdn.example.com/photo.png",
      content_type: "image/png",
      title: "My Photo",
      description: "A nice photo",
      size: 123456,
      height: 1080,
      width: 1920,
      ephemeral: false,
      duration_secs: undefined,
    };
    const data: MessageData = { attachments: [attachment] };
    const result = parseMessageData(JSON.stringify(data));
    expect(result!.attachments![0].filename).toBe("photo.png");
    expect(result!.attachments![0].size).toBe(123456);
    expect(result!.attachments![0].height).toBe(1080);
    expect(result!.attachments![0].width).toBe(1920);
    expect(result!.attachments![0].description).toBe("A nice photo");
  });

  test("voice message attachment with duration", () => {
    const data: MessageData = {
      attachments: [{
        filename: "voice-message.ogg",
        url: "https://cdn.example.com/voice.ogg",
        content_type: "audio/ogg",
        size: 54321,
        duration_secs: 12.5,
      }],
    };
    const result = parseMessageData(JSON.stringify(data));
    expect(result!.attachments![0].duration_secs).toBe(12.5);
  });

  test("sticker data", () => {
    const sticker: StickerData = {
      id: "123456789",
      name: "wave",
      format_type: 1, // PNG
    };
    const data: MessageData = { stickers: [sticker] };
    const result = parseMessageData(JSON.stringify(data));
    expect(result!.stickers![0].id).toBe("123456789");
    expect(result!.stickers![0].name).toBe("wave");
    expect(result!.stickers![0].format_type).toBe(1);
  });

  test("combined embeds, stickers, and attachments", () => {
    const data: MessageData = {
      is_bot: true,
      embeds: [{ title: "An Embed", type: "rich" }],
      stickers: [{ id: "999", name: "smile", format_type: 4 }],
      attachments: [{ filename: "doc.pdf", url: "https://example.com/doc.pdf", content_type: "application/pdf", size: 1024 }],
    };
    const result = parseMessageData(JSON.stringify(data));
    expect(result!.is_bot).toBe(true);
    expect(result!.embeds!.length).toBe(1);
    expect(result!.stickers!.length).toBe(1);
    expect(result!.attachments!.length).toBe(1);
    expect(result!.embeds![0].title).toBe("An Embed");
    expect(result!.stickers![0].format_type).toBe(4); // GIF
    expect(result!.attachments![0].content_type).toBe("application/pdf");
  });

  test("legacy data without new fields still parses", () => {
    // Old format from before the expanded types
    const legacy = JSON.stringify({
      is_bot: true,
      embeds: [{ title: "Old", description: "embed" }],
      attachments: [{ filename: "f.txt", url: "https://x.com/f.txt" }],
    });
    const result = parseMessageData(legacy);
    expect(result!.embeds![0].title).toBe("Old");
    expect(result!.embeds![0].type).toBeUndefined();
    expect(result!.embeds![0].color).toBeUndefined();
    expect(result!.attachments![0].filename).toBe("f.txt");
    expect(result!.attachments![0].size).toBeUndefined();
    expect(result!.attachments![0].height).toBeUndefined();
  });
});

// =============================================================================
// DB-backed tests (use mocked in-memory DB)
// =============================================================================

describe("addDiscordEntity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("creates a channel binding and returns it", () => {
    const entityId = createEntity("Aria");
    const result = addDiscordEntity("chan-1", "channel", entityId);
    expect(result).not.toBeNull();
    expect(result!.discord_id).toBe("chan-1");
    expect(result!.discord_type).toBe("channel");
    expect(result!.entity_id).toBe(entityId);
  });

  test("returns null for duplicate scoped user binding", () => {
    const entityId = createEntity("Aria");
    addDiscordEntity("user-1", "user", entityId, "guild-1", "chan-1");
    const dup = addDiscordEntity("user-1", "user", entityId, "guild-1", "chan-1");
    expect(dup).toBeNull();
  });

  test("allows multiple entities per channel", () => {
    const e1 = createEntity("Aria");
    const e2 = createEntity("Bob");
    const r1 = addDiscordEntity("chan-1", "channel", e1);
    const r2 = addDiscordEntity("chan-1", "channel", e2);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1!.entity_id).toBe(e1);
    expect(r2!.entity_id).toBe(e2);
  });

  test("creates user binding with scope", () => {
    const entityId = createEntity("Persona");
    const result = addDiscordEntity("user-1", "user", entityId, "guild-1", "chan-1");
    expect(result).not.toBeNull();
    expect(result!.scope_guild_id).toBe("guild-1");
    expect(result!.scope_channel_id).toBe("chan-1");
  });
});

describe("resolveDiscordEntities", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("channel type: returns all bound entities", () => {
    const e1 = createEntity("A");
    const e2 = createEntity("B");
    addDiscordEntity("chan-1", "channel", e1);
    addDiscordEntity("chan-1", "channel", e2);
    const result = resolveDiscordEntities("chan-1", "channel");
    expect(result).toContain(e1);
    expect(result).toContain(e2);
    expect(result.length).toBe(2);
  });

  test("guild type: returns all bound entities", () => {
    const e1 = createEntity("A");
    addDiscordEntity("guild-1", "guild", e1);
    const result = resolveDiscordEntities("guild-1", "guild");
    expect(result).toEqual([e1]);
  });

  test("user type: channel scope wins over guild scope", () => {
    const eChannel = createEntity("ChannelPersona");
    const eGuild = createEntity("GuildPersona");
    addDiscordEntity("user-1", "user", eGuild, "guild-1");
    addDiscordEntity("user-1", "user", eChannel, "guild-1", "chan-1");
    const result = resolveDiscordEntities("user-1", "user", "guild-1", "chan-1");
    expect(result).toEqual([eChannel]);
  });

  test("user type: guild scope wins over global", () => {
    const eGlobal = createEntity("GlobalPersona");
    const eGuild = createEntity("GuildPersona");
    addDiscordEntity("user-1", "user", eGlobal);
    addDiscordEntity("user-1", "user", eGuild, "guild-1");
    const result = resolveDiscordEntities("user-1", "user", "guild-1");
    expect(result).toEqual([eGuild]);
  });

  test("user type: falls back to global when no scoped bindings", () => {
    const eGlobal = createEntity("GlobalPersona");
    addDiscordEntity("user-1", "user", eGlobal);
    const result = resolveDiscordEntities("user-1", "user", "guild-1", "chan-1");
    expect(result).toEqual([eGlobal]);
  });

  test("returns empty array when no bindings", () => {
    expect(resolveDiscordEntities("unknown", "channel")).toEqual([]);
    expect(resolveDiscordEntities("unknown", "user", "g", "c")).toEqual([]);
  });
});

describe("resolveDiscordEntity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns first entity ID", () => {
    const e1 = createEntity("A");
    addDiscordEntity("chan-1", "channel", e1);
    expect(resolveDiscordEntity("chan-1", "channel")).toBe(e1);
  });

  test("returns null when no binding", () => {
    expect(resolveDiscordEntity("missing", "channel")).toBeNull();
  });
});

describe("getChannelScopedEntities", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns entities bound to channel", () => {
    const e1 = createEntity("A");
    const e2 = createEntity("B");
    addDiscordEntity("chan-1", "channel", e1);
    addDiscordEntity("chan-1", "channel", e2);
    const result = getChannelScopedEntities("chan-1");
    expect(result.length).toBe(2);
    expect(result).toContain(e1);
    expect(result).toContain(e2);
  });

  test("returns empty for unbound channel", () => {
    expect(getChannelScopedEntities("no-channel")).toEqual([]);
  });
});

describe("getGuildScopedEntities", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns entities bound to guild", () => {
    const e1 = createEntity("A");
    addDiscordEntity("guild-1", "guild", e1);
    expect(getGuildScopedEntities("guild-1")).toEqual([e1]);
  });

  test("returns empty for unbound guild", () => {
    expect(getGuildScopedEntities("no-guild")).toEqual([]);
  });
});

describe("removeDiscordEntityBinding", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("removes specific binding and returns true", () => {
    const e1 = createEntity("A");
    const e2 = createEntity("B");
    addDiscordEntity("chan-1", "channel", e1);
    addDiscordEntity("chan-1", "channel", e2);
    expect(removeDiscordEntityBinding("chan-1", "channel", e1)).toBe(true);
    expect(getChannelScopedEntities("chan-1")).toEqual([e2]);
  });

  test("returns false for non-existent binding", () => {
    expect(removeDiscordEntityBinding("chan-1", "channel", 999)).toBe(false);
  });

  test("removes scoped user binding", () => {
    const e1 = createEntity("Persona");
    addDiscordEntity("user-1", "user", e1, "guild-1", "chan-1");
    expect(removeDiscordEntityBinding("user-1", "user", e1, "guild-1", "chan-1")).toBe(true);
    expect(resolveDiscordEntities("user-1", "user", "guild-1", "chan-1")).toEqual([]);
  });
});

describe("removeDiscordEntity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("removes all entities at a scope", () => {
    const e1 = createEntity("A");
    const e2 = createEntity("B");
    addDiscordEntity("chan-1", "channel", e1);
    addDiscordEntity("chan-1", "channel", e2);
    expect(removeDiscordEntity("chan-1", "channel")).toBe(true);
    expect(getChannelScopedEntities("chan-1")).toEqual([]);
  });

  test("returns false when nothing to remove", () => {
    expect(removeDiscordEntity("empty", "channel")).toBe(false);
  });
});

describe("discord config", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("setDiscordConfig creates and getDiscordConfig retrieves", () => {
    setDiscordConfig("chan-1", "channel", {
      config_bind: JSON.stringify(["user-1", "role:admin"]),
      config_persona: null,
      config_blacklist: null,
    });
    const config = getDiscordConfig("chan-1", "channel");
    expect(config).not.toBeNull();
    expect(config!.discord_id).toBe("chan-1");
    expect(JSON.parse(config!.config_bind!)).toEqual(["user-1", "role:admin"]);
    expect(config!.config_persona).toBeNull();
  });

  test("setDiscordConfig upserts on conflict", () => {
    setDiscordConfig("chan-1", "channel", { config_bind: JSON.stringify(["a"]) });
    setDiscordConfig("chan-1", "channel", { config_bind: JSON.stringify(["b"]) });
    const config = getDiscordConfig("chan-1", "channel");
    expect(JSON.parse(config!.config_bind!)).toEqual(["b"]);
  });

  test("deleteDiscordConfig removes config", () => {
    setDiscordConfig("chan-1", "channel", { config_bind: JSON.stringify(["a"]) });
    expect(deleteDiscordConfig("chan-1", "channel")).toBe(true);
    expect(getDiscordConfig("chan-1", "channel")).toBeNull();
  });

  test("deleteDiscordConfig returns false when nothing to delete", () => {
    expect(deleteDiscordConfig("missing", "channel")).toBe(false);
  });
});

describe("resolveDiscordConfig", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns defaults when no config exists", () => {
    const result = resolveDiscordConfig("chan-1", "guild-1");
    expect(result).toEqual({ bind: null, persona: null, blacklist: null });
  });

  test("uses channel config when available", () => {
    setDiscordConfig("chan-1", "channel", {
      config_bind: JSON.stringify(["user-1"]),
      config_persona: JSON.stringify(["user-2"]),
      config_blacklist: null,
    });
    const result = resolveDiscordConfig("chan-1", "guild-1");
    expect(result.bind).toEqual(["user-1"]);
    expect(result.persona).toEqual(["user-2"]);
    expect(result.blacklist).toBeNull();
  });

  test("falls back to guild config when no channel config", () => {
    setDiscordConfig("guild-1", "guild", {
      config_bind: JSON.stringify(["role:moderator"]),
      config_persona: null,
      config_blacklist: null,
    });
    const result = resolveDiscordConfig("chan-1", "guild-1");
    expect(result.bind).toEqual(["role:moderator"]);
  });

  test("channel config takes priority over guild config", () => {
    setDiscordConfig("guild-1", "guild", {
      config_bind: JSON.stringify(["guild-user"]),
    });
    setDiscordConfig("chan-1", "channel", {
      config_bind: JSON.stringify(["channel-user"]),
    });
    const result = resolveDiscordConfig("chan-1", "guild-1");
    expect(result.bind).toEqual(["channel-user"]);
  });

  test("returns defaults when both channelId and guildId are undefined", () => {
    const result = resolveDiscordConfig(undefined, undefined);
    expect(result).toEqual({ bind: null, persona: null, blacklist: null });
  });

  test("parses @everyone string from config", () => {
    // In practice, 0 selections stores JSON.stringify("@everyone") which is a string, not array.
    // The runtime type doesn't match the declared string[] | null — test the actual behavior.
    setDiscordConfig("chan-1", "channel", {
      config_bind: JSON.stringify("@everyone"),
    });
    const result = resolveDiscordConfig("chan-1", undefined);
    expect(result.bind as unknown).toBe("@everyone");
  });
});

describe("addMessage / getMessages", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("adds and retrieves messages in DESC order", () => {
    insertMessage("chan-1", "user-1", "Alice", "Hello", null, "2024-01-01 10:00:00");
    insertMessage("chan-1", "user-2", "Bob", "Hi there", null, "2024-01-01 10:01:00");
    const messages = getMessages("chan-1");
    expect(messages.length).toBe(2);
    // getMessages returns DESC order
    expect(messages[0].author_name).toBe("Bob");
    expect(messages[1].author_name).toBe("Alice");
  });

  test("respects limit parameter", () => {
    addMessage("chan-1", "u1", "A", "1");
    addMessage("chan-1", "u1", "A", "2");
    addMessage("chan-1", "u1", "A", "3");
    const messages = getMessages("chan-1", 2);
    expect(messages.length).toBe(2);
  });

  test("returns empty for unknown channel", () => {
    expect(getMessages("missing")).toEqual([]);
  });

  test("only returns messages for the specified channel", () => {
    addMessage("chan-1", "u1", "A", "hello");
    addMessage("chan-2", "u1", "A", "world");
    expect(getMessages("chan-1").length).toBe(1);
    expect(getMessages("chan-2").length).toBe(1);
  });

  test("stores discord_message_id and data", () => {
    const msg = addMessage("chan-1", "u1", "A", "test", "discord-123", { is_bot: true });
    expect(msg.discord_message_id).toBe("discord-123");
    expect(msg.data).toBe('{"is_bot":true}');
  });
});

describe("countUnreadMessages", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns Infinity when entity has never replied", () => {
    const entityId = createEntity("Aria");
    insertMessage("chan-1", "u1", "Alice", "Hello", null, "2024-01-01 10:00:00");
    insertMessage("chan-1", "u1", "Alice", "Anyone?", null, "2024-01-01 10:01:00");
    expect(countUnreadMessages("chan-1", entityId)).toBe(Infinity);
  });

  test("returns 0 when no messages since entity's last reply", () => {
    const entityId = createEntity("Aria");
    // User message
    insertMessage("chan-1", "u1", "Alice", "Hello", null, "2024-01-01 10:00:00");
    // Entity's reply (via webhook)
    insertMessage("chan-1", "bot", "Aria", "Hi!", "msg-1", "2024-01-01 10:01:00");
    trackWebhookMessage("msg-1", entityId, "Aria");
    expect(countUnreadMessages("chan-1", entityId)).toBe(0);
  });

  test("returns correct count of messages since last reply", () => {
    const entityId = createEntity("Aria");
    // Entity's reply
    insertMessage("chan-1", "bot", "Aria", "Earlier reply", "msg-1", "2024-01-01 10:00:00");
    trackWebhookMessage("msg-1", entityId, "Aria");
    // Three messages after the reply
    insertMessage("chan-1", "u1", "Alice", "msg 1", null, "2024-01-01 10:01:00");
    insertMessage("chan-1", "u2", "Bob", "msg 2", null, "2024-01-01 10:02:00");
    insertMessage("chan-1", "u1", "Alice", "msg 3", null, "2024-01-01 10:03:00");
    expect(countUnreadMessages("chan-1", entityId)).toBe(3);
  });

  test("counts from the most recent reply, not first", () => {
    const entityId = createEntity("Aria");
    // First reply
    insertMessage("chan-1", "bot", "Aria", "reply 1", "msg-1", "2024-01-01 10:00:00");
    trackWebhookMessage("msg-1", entityId, "Aria");
    // Messages between replies
    insertMessage("chan-1", "u1", "Alice", "between", null, "2024-01-01 10:01:00");
    // Second reply
    insertMessage("chan-1", "bot", "Aria", "reply 2", "msg-2", "2024-01-01 10:02:00");
    trackWebhookMessage("msg-2", entityId, "Aria");
    // One new message
    insertMessage("chan-1", "u1", "Alice", "after", null, "2024-01-01 10:03:00");
    expect(countUnreadMessages("chan-1", entityId)).toBe(1);
  });

  test("does not count messages from other channels", () => {
    const entityId = createEntity("Aria");
    insertMessage("chan-1", "bot", "Aria", "reply", "msg-1", "2024-01-01 10:00:00");
    trackWebhookMessage("msg-1", entityId, "Aria");
    insertMessage("chan-2", "u1", "Alice", "other channel", null, "2024-01-01 10:01:00");
    expect(countUnreadMessages("chan-1", entityId)).toBe(0);
  });

  test("respects channel forget time", () => {
    const entityId = createEntity("Aria");
    // Old message before forget
    insertMessage("chan-1", "u1", "Alice", "old", null, "2024-01-01 09:00:00");
    // Set forget time
    testDb.prepare(`INSERT INTO channel_forgets (channel_id, forget_at) VALUES (?, ?)`).run("chan-1", "2024-01-01 10:00:00");
    // New message after forget
    insertMessage("chan-1", "u1", "Alice", "new", null, "2024-01-01 10:01:00");
    // Entity never replied after forget → Infinity
    expect(countUnreadMessages("chan-1", entityId)).toBe(Infinity);
  });

  test("returns 0 for empty channel", () => {
    const entityId = createEntity("Aria");
    // Entity replied but no messages after
    insertMessage("chan-1", "bot", "Aria", "reply", "msg-1", "2024-01-01 10:00:00");
    trackWebhookMessage("msg-1", entityId, "Aria");
    expect(countUnreadMessages("chan-1", entityId)).toBe(0);
  });
});

describe("trackWebhookMessage / getWebhookMessageEntity", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("tracks and retrieves webhook message", () => {
    trackWebhookMessage("msg-1", 42, "Aria");
    const result = getWebhookMessageEntity("msg-1");
    expect(result).toEqual({ entityId: 42, entityName: "Aria" });
  });

  test("returns null for unknown message", () => {
    expect(getWebhookMessageEntity("nonexistent")).toBeNull();
  });

  test("overwrites on duplicate message_id", () => {
    trackWebhookMessage("msg-1", 1, "First");
    trackWebhookMessage("msg-1", 2, "Second");
    const result = getWebhookMessageEntity("msg-1");
    expect(result).toEqual({ entityId: 2, entityName: "Second" });
  });
});

describe("eval error tracking", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("records error and returns true for new error", () => {
    const entityId = createEntity("Aria", "owner-1");
    expect(recordEvalError(entityId, "owner-1", "ReferenceError: x is not defined")).toBe(true);
  });

  test("returns false for duplicate error", () => {
    const entityId = createEntity("Aria", "owner-1");
    recordEvalError(entityId, "owner-1", "some error");
    expect(recordEvalError(entityId, "owner-1", "some error")).toBe(false);
  });

  test("allows different error messages for same entity", () => {
    const entityId = createEntity("Aria", "owner-1");
    expect(recordEvalError(entityId, "owner-1", "error A")).toBe(true);
    expect(recordEvalError(entityId, "owner-1", "error B")).toBe(true);
  });

  test("gets unnotified errors for owner", () => {
    const e1 = createEntity("Aria", "owner-1");
    const e2 = createEntity("Bob", "owner-1");
    recordEvalError(e1, "owner-1", "error 1");
    recordEvalError(e2, "owner-1", "error 2");
    const errors = getUnnotifiedErrors("owner-1");
    expect(errors.length).toBe(2);
    expect(errors.every(e => e.notified_at === null)).toBe(true);
  });

  test("markErrorsNotified updates notified_at", () => {
    const entityId = createEntity("Aria", "owner-1");
    recordEvalError(entityId, "owner-1", "error");
    const before = getUnnotifiedErrors("owner-1");
    expect(before.length).toBe(1);
    markErrorsNotified(before.map(e => e.id));
    const after = getUnnotifiedErrors("owner-1");
    expect(after.length).toBe(0);
  });

  test("clearEntityErrors removes all errors for entity", () => {
    const entityId = createEntity("Aria", "owner-1");
    recordEvalError(entityId, "owner-1", "error 1");
    recordEvalError(entityId, "owner-1", "error 2");
    clearEntityErrors(entityId);
    expect(getUnnotifiedErrors("owner-1").length).toBe(0);
  });
});

describe("isNewUser / markUserWelcomed", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("returns true for user with no bindings and not welcomed", () => {
    expect(isNewUser("new-user")).toBe(true);
  });

  test("returns false after marking user as welcomed", () => {
    markUserWelcomed("user-1");
    expect(isNewUser("user-1")).toBe(false);
  });

  test("returns false if user has existing entity bindings", () => {
    const entityId = createEntity("Persona");
    addDiscordEntity("user-1", "user", entityId);
    expect(isNewUser("user-1")).toBe(false);
  });

  test("markUserWelcomed is idempotent", () => {
    markUserWelcomed("user-1");
    markUserWelcomed("user-1"); // should not throw
    expect(isNewUser("user-1")).toBe(false);
  });
});

describe("setChannelForgetTime", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    createTestSchema(testDb);
  });

  test("sets and returns a forget timestamp", () => {
    const ts = setChannelForgetTime("chan-1");
    expect(typeof ts).toBe("string");
    expect(ts.length).toBeGreaterThan(0);
  });

  test("getMessages excludes messages before forget time", () => {
    insertMessage("chan-1", "u1", "A", "old message", null, "2024-01-01 09:00:00");
    testDb.prepare(`INSERT INTO channel_forgets (channel_id, forget_at) VALUES (?, ?)`).run("chan-1", "2024-01-01 10:00:00");
    insertMessage("chan-1", "u1", "A", "new message", null, "2024-01-01 10:01:00");
    const messages = getMessages("chan-1");
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe("new message");
  });
});
