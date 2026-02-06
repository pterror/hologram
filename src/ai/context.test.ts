import { describe, expect, test } from "bun:test";
import {
  normalizeMessagesForProvider,
  applyStripPatterns,
  formatEntityDisplay,
  formatEvaluatedEntity,
  type StructuredMessage,
  type EvaluatedEntity,
} from "./context";

/** Create a minimal EvaluatedEntity for testing formatting functions */
function makeEntity(overrides: Partial<EvaluatedEntity> & { name: string; id: number; facts: string[] }): EvaluatedEntity {
  return {
    avatarUrl: null,
    streamMode: null,
    streamDelimiter: null,
    memoryScope: "none",
    contextExpr: null,
    isFreeform: false,
    modelSpec: null,
    stripPatterns: null,
    template: null,
    systemTemplate: null,
    ...overrides,
  };
}

describe("normalizeMessagesForProvider", () => {
  const systemMsg: StructuredMessage = { role: "system", content: "You are helpful" };
  const userMsg: StructuredMessage = { role: "user", content: "Hello" };
  const assistantMsg: StructuredMessage = { role: "assistant", content: "Hi there" };

  test("returns same array reference for non-Google providers", () => {
    const messages = [systemMsg, userMsg, assistantMsg];
    expect(normalizeMessagesForProvider(messages, "anthropic")).toBe(messages);
    expect(normalizeMessagesForProvider(messages, "openai")).toBe(messages);
    expect(normalizeMessagesForProvider(messages, "mistral")).toBe(messages);
  });

  test("returns same array reference for Google when no system messages", () => {
    const messages = [userMsg, assistantMsg];
    expect(normalizeMessagesForProvider(messages, "google")).toBe(messages);
  });

  test("converts system messages to user for google provider", () => {
    const messages = [systemMsg, userMsg, assistantMsg];
    const result = normalizeMessagesForProvider(messages, "google");
    expect(result).toEqual([
      { role: "user", content: "You are helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
  });

  test("converts system messages to user for google-vertex provider", () => {
    const messages = [systemMsg, userMsg];
    const result = normalizeMessagesForProvider(messages, "google-vertex");
    expect(result).toEqual([
      { role: "user", content: "You are helpful" },
      { role: "user", content: "Hello" },
    ]);
  });

  test("handles empty array", () => {
    const empty: StructuredMessage[] = [];
    expect(normalizeMessagesForProvider(empty, "google")).toBe(empty);
    expect(normalizeMessagesForProvider(empty, "anthropic")).toBe(empty);
  });

  test("handles all-system messages for google", () => {
    const messages: StructuredMessage[] = [
      { role: "system", content: "first" },
      { role: "system", content: "second" },
    ];
    const result = normalizeMessagesForProvider(messages, "google");
    expect(result).toEqual([
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ]);
  });

  test("preserves user and assistant messages unchanged for google", () => {
    const messages = [userMsg, assistantMsg, systemMsg];
    const result = normalizeMessagesForProvider(messages, "google");
    expect(result[0]).toEqual(userMsg);
    expect(result[1]).toEqual(assistantMsg);
    expect(result[2]).toEqual({ role: "user", content: "You are helpful" });
  });

  test("does not mutate original messages", () => {
    const original: StructuredMessage = { role: "system", content: "test" };
    const messages = [original];
    normalizeMessagesForProvider(messages, "google");
    expect(original.role).toBe("system");
  });
});

describe("applyStripPatterns", () => {
  test("removes single pattern", () => {
    expect(applyStripPatterns("hello world", ["world"])).toBe("hello ");
  });

  test("removes multiple patterns", () => {
    expect(applyStripPatterns("<b>hello</b>", ["<b>", "</b>"])).toBe("hello");
  });

  test("empty patterns returns unchanged", () => {
    expect(applyStripPatterns("hello", [])).toBe("hello");
  });

  test("removes all occurrences of pattern", () => {
    expect(applyStripPatterns("aXbXcX", ["X"])).toBe("abc");
  });

  test("handles pattern not found", () => {
    expect(applyStripPatterns("hello", ["xyz"])).toBe("hello");
  });

  test("handles empty string input", () => {
    expect(applyStripPatterns("", ["test"])).toBe("");
  });

  test("removes HTML-like tags", () => {
    expect(applyStripPatterns("<blockquote>text</blockquote>", ["<blockquote>", "</blockquote>"])).toBe("text");
  });
});

describe("formatEntityDisplay", () => {
  test("formats name and ID", () => {
    expect(formatEntityDisplay("Aria", 42)).toBe("Aria [42]");
  });

  test("formats with large ID", () => {
    expect(formatEntityDisplay("Test Entity", 99999)).toBe("Test Entity [99999]");
  });
});

describe("formatEvaluatedEntity", () => {
  test("formats entity with facts", () => {
    const entity = makeEntity({ name: "Aria", id: 1, facts: ["is a character", "has silver hair"] });
    expect(formatEvaluatedEntity(entity)).toBe(
      '<defs for="Aria" id="1">\nis a character\nhas silver hair\n</defs>'
    );
  });

  test("formats entity with single fact", () => {
    const entity = makeEntity({ name: "Item", id: 10, facts: ["is a sword"] });
    expect(formatEvaluatedEntity(entity)).toBe(
      '<defs for="Item" id="10">\nis a sword\n</defs>'
    );
  });

  test("formats entity with no facts", () => {
    const entity = makeEntity({ name: "Empty", id: 5, facts: [] });
    expect(formatEvaluatedEntity(entity)).toBe('<defs for="Empty" id="5">\n\n</defs>');
  });
});
