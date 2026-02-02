/**
 * Tests for Discordeno desiredProperties configuration.
 *
 * Validates that the transformer config produces the expected object shapes.
 * Regression test: missing `desiredProperties.attachment` caused all attachment
 * properties to be stripped, producing `{filename: "unknown", url: ""}`.
 */
import { describe, expect, test } from "bun:test";

/**
 * Replicates Discordeno's transformAttachment logic (from @discordeno/bot/dist/transformers/attachment.js).
 * The actual function can't be imported directly due to package export restrictions.
 *
 * The transformer conditionally copies properties based on `desiredProperties.attachment`.
 * If a property isn't listed, it's silently dropped — producing empty objects.
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

/** Maps a Discordeno attachment to our AttachmentData shape (mirrors client.ts extraction) */
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

// Our desiredProperties.attachment config (must match client.ts)
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

function mockBot(attachmentProps: Record<string, boolean>) {
  return {
    transformers: {
      desiredProperties: { attachment: attachmentProps },
      snowflake: (id: string) => BigInt(id),
      customizers: { attachment: (_bot: any, _payload: any, attachment: any) => attachment },
    },
  };
}

const SAMPLE_PAYLOAD = {
  id: "123456",
  filename: "photo.png",
  url: "https://cdn.discordapp.com/attachments/1/2/photo.png",
  proxy_url: "https://media.discordapp.net/attachments/1/2/photo.png",
  size: 12345,
};

describe("desiredProperties.attachment", () => {
  test("with correct config, attachment properties are preserved", () => {
    const bot = mockBot(ATTACHMENT_PROPS);
    const transformed = transformAttachment(bot, SAMPLE_PAYLOAD);
    const result = extractAttachment(transformed);

    expect(result.filename).toBe("photo.png");
    expect(result.url).toBe("https://cdn.discordapp.com/attachments/1/2/photo.png");
    expect(result.size).toBe(12345);
  });

  test("with correct config, optional fields are preserved", () => {
    const bot = mockBot(ATTACHMENT_PROPS);
    const payload = {
      ...SAMPLE_PAYLOAD,
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
    const bot = mockBot({}); // no properties enabled — the original bug
    const transformed = transformAttachment(bot, SAMPLE_PAYLOAD);
    const result = extractAttachment(transformed);

    // All fields fall back to defaults
    expect(result.filename).toBe("unknown");
    expect(result.url).toBe("");
    expect(result.size).toBeUndefined();
  });
});
