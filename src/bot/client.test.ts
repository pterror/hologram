/**
 * Tests for Discordeno desiredProperties configuration.
 *
 * Validates that transformer configs produce the expected object shapes.
 * Regression tests: missing desiredProperties entries caused transformers to
 * silently strip all properties, producing empty objects.
 */
import { describe, expect, test } from "bun:test";

// =============================================================================
// Transformer replicas (can't import from @discordeno/bot due to single export)
// =============================================================================

/**
 * Replicates Discordeno's transformAttachment logic
 * (from @discordeno/bot/dist/transformers/attachment.js).
 */
function transformAttachment(bot: any, payload: any): any {
  const props = bot.transformers.desiredProperties.attachment;
  const attachment: any = {};
  if (props.id && payload.id) attachment.id = bot.transformers.snowflake(payload.id);
  if (props.filename && payload.filename) attachment.filename = payload.filename;
  if (props.title && payload.title) attachment.title = payload.title;
  if (props.contentType && payload.content_type) attachment.contentType = payload.content_type;
  if (props.size) attachment.size = payload.size;
  if (props.url && payload.url) attachment.url = payload.url;
  if (props.proxyUrl && payload.proxy_url) attachment.proxyUrl = payload.proxy_url;
  if (props.height && payload.height) attachment.height = payload.height;
  if (props.width && payload.width) attachment.width = payload.width;
  if (props.ephemeral && payload.ephemeral) attachment.ephemeral = payload.ephemeral;
  if (props.description && payload.description) attachment.description = payload.description;
  if (props.duration_secs && payload.duration_secs) attachment.duration_secs = payload.duration_secs;
  if (props.waveform && payload.waveform) attachment.waveform = payload.waveform;
  if (props.flags) attachment.flags = payload.flags;
  return bot.transformers.customizers.attachment(bot, payload, attachment);
}

/**
 * Replicates Discordeno's transformMember logic (roles portion only)
 * (from @discordeno/bot/dist/transformers/member.js).
 */
function transformMember(bot: any, payload: any): any {
  const props = bot.transformers.desiredProperties.member;
  const member: any = {};
  if (props.id && payload.user?.id) member.id = bot.transformers.snowflake(payload.user.id);
  if (props.roles && payload.roles) member.roles = payload.roles.map((id: string) => bot.transformers.snowflake(id));
  if (props.nick && payload.nick) member.nick = payload.nick;
  if (props.joinedAt && payload.joined_at) member.joinedAt = Date.parse(payload.joined_at);
  return bot.transformers.customizers.member(bot, payload, member);
}

// =============================================================================
// Extraction helpers (mirror client.ts logic)
// =============================================================================

/** Maps a Discordeno attachment to our AttachmentData shape (mirrors client.ts) */
function extractAttachment(a: any) {
  return {
    filename: a.filename ?? "unknown",
    url: a.url ?? "",
    ...(a.contentType && { content_type: a.contentType }),
    ...(a.title && { title: a.title }),
    ...(a.description && { description: a.description }),
    ...(a.size != null && { size: a.size }),
    ...(a.height != null && { height: a.height }),
    ...(a.width != null && { width: a.width }),
    ...(a.ephemeral != null && { ephemeral: a.ephemeral }),
    ...(a.duration_secs != null && { duration_secs: a.duration_secs }),
  };
}

/** Extracts member roles to string[] (mirrors client.ts) */
function extractMemberRoles(member: any): string[] {
  return (member?.roles ?? []).map((r: bigint) => r.toString());
}

// =============================================================================
// Mock bot factory
// =============================================================================

function mockBot(desiredProps: Record<string, Record<string, boolean>>) {
  return {
    transformers: {
      desiredProperties: desiredProps,
      snowflake: (id: string) => BigInt(id),
      customizers: {
        attachment: (_bot: any, _payload: any, result: any) => result,
        member: (_bot: any, _payload: any, result: any) => result,
      },
    },
  };
}

// =============================================================================
// Configs (must match client.ts desiredProperties)
// =============================================================================

const ATTACHMENT_PROPS = {
  id: true,
  filename: true,
  url: true,
  contentType: true,
  title: true,
  description: true,
  size: true,
  height: true,
  width: true,
  ephemeral: true,
  duration_secs: true,
};

const MEMBER_PROPS = {
  roles: true,
};

// =============================================================================
// Attachment tests
// =============================================================================

const SAMPLE_ATTACHMENT = {
  id: "123456",
  filename: "photo.png",
  url: "https://cdn.discordapp.com/attachments/1/2/photo.png",
  proxy_url: "https://media.discordapp.net/attachments/1/2/photo.png",
  size: 12345,
};

describe("desiredProperties.attachment", () => {
  test("with correct config, attachment properties are preserved", () => {
    const bot = mockBot({ attachment: ATTACHMENT_PROPS });
    const transformed = transformAttachment(bot, SAMPLE_ATTACHMENT);
    const result = extractAttachment(transformed);

    expect(result.filename).toBe("photo.png");
    expect(result.url).toBe("https://cdn.discordapp.com/attachments/1/2/photo.png");
    expect(result.size).toBe(12345);
  });

  test("with correct config, optional fields are preserved", () => {
    const bot = mockBot({ attachment: ATTACHMENT_PROPS });
    const payload = {
      ...SAMPLE_ATTACHMENT,
      content_type: "audio/ogg",
      description: "Voice message",
      duration_secs: 5.2,
      height: 100,
      width: 200,
    };

    const transformed = transformAttachment(bot, payload);
    const result = extractAttachment(transformed);

    expect(result.filename).toBe("photo.png");
    expect(result.url).toBe("https://cdn.discordapp.com/attachments/1/2/photo.png");
    expect(result.content_type).toBe("audio/ogg");
    expect(result.description).toBe("Voice message");
    expect(result.duration_secs).toBe(5.2);
    expect(result.height).toBe(100);
    expect(result.width).toBe(200);
  });

  test("without attachment config, properties are stripped (the bug)", () => {
    const bot = mockBot({ attachment: {} }); // no properties enabled
    const transformed = transformAttachment(bot, SAMPLE_ATTACHMENT);
    const result = extractAttachment(transformed);

    expect(result.filename).toBe("unknown");
    expect(result.url).toBe("");
    expect(result.size).toBeUndefined();
  });
});

// =============================================================================
// Member tests
// =============================================================================

const SAMPLE_MEMBER = {
  user: { id: "111" },
  roles: ["222", "333"],
  nick: "Nickname",
  joined_at: "2024-01-01T00:00:00Z",
};

describe("desiredProperties.member", () => {
  test("with correct config, member.roles is preserved", () => {
    const bot = mockBot({ member: MEMBER_PROPS });
    const transformed = transformMember(bot, SAMPLE_MEMBER);
    const roles = extractMemberRoles(transformed);

    expect(roles).toEqual(["222", "333"]);
  });

  test("without member config, roles are stripped (same class of bug)", () => {
    const bot = mockBot({ member: {} }); // no properties enabled
    const transformed = transformMember(bot, SAMPLE_MEMBER);
    const roles = extractMemberRoles(transformed);

    expect(roles).toEqual([]); // silently empty — permission checks would fail
  });
});
