import { describe, test, expect } from "bun:test";
import {
  debugContext,
  formatDebugInfo,
  addTraceStep,
  finishTrace,
  formatTrace,
  exportContext,
  type ContextDebugInfo,
  type ContextTrace,
} from "./debug";
import type { AssembledContext, Message } from "./context";

// Helper to create a minimal AssembledContext
function makeContext(opts: {
  systemPrompt?: string;
  messages?: Message[];
  tokenEstimate?: number;
}): AssembledContext {
  return {
    systemPrompt: opts.systemPrompt ?? "You are a helpful assistant.",
    messages: opts.messages ?? [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ],
    tokenEstimate: opts.tokenEstimate ?? 100,
  };
}

// --- debugContext ---

describe("debugContext", () => {
  test("returns basic token counts", () => {
    const ctx = makeContext({});
    const info = debugContext(ctx);

    expect(info.totalTokens).toBe(ctx.tokenEstimate);
    expect(info.messageCount).toBe(2);
    expect(info.systemPromptTokens).toBeGreaterThan(0);
    expect(info.messagesTokens).toBeGreaterThan(0);
  });

  test("parses sections from markdown headers", () => {
    const ctx = makeContext({
      systemPrompt: [
        "Preamble text here.",
        "",
        "# Character",
        "Alice is a character.",
        "",
        "## World State",
        "The world is at peace.",
      ].join("\n"),
    });
    const info = debugContext(ctx);

    expect(info.sections.length).toBeGreaterThanOrEqual(2);
    const names = info.sections.map((s) => s.name);
    expect(names).toContain("character");
    expect(names).toContain("world_state");
  });

  test("includes preamble section for content before first header", () => {
    const ctx = makeContext({
      systemPrompt: "Some preamble.\n\n# Section\nContent.",
    });
    const info = debugContext(ctx);

    const names = info.sections.map((s) => s.name);
    expect(names[0]).toBe("preamble");
  });

  test("warns on large system prompt", () => {
    const ctx = makeContext({
      systemPrompt: "x".repeat(20000),
    });
    const info = debugContext(ctx);

    expect(info.warnings.some((w) => w.includes("large"))).toBe(true);
  });

  test("warns on very few messages", () => {
    const ctx = makeContext({
      messages: [{ role: "assistant", content: "Hello" }],
    });
    const info = debugContext(ctx);

    expect(info.warnings.some((w) => w.includes("few messages"))).toBe(true);
  });

  test("warns on many messages", () => {
    const messages: Message[] = Array.from({ length: 35 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
    })) as Message[];
    const ctx = makeContext({ messages });
    const info = debugContext(ctx);

    expect(info.warnings.some((w) => w.includes("Many messages"))).toBe(true);
  });

  test("warns when no user message exists", () => {
    const ctx = makeContext({
      messages: [{ role: "assistant", content: "Hello" }],
    });
    const info = debugContext(ctx);

    expect(info.warnings.some((w) => w.includes("No user message"))).toBe(
      true
    );
  });

  test("no warning for no user message when user message exists", () => {
    const ctx = makeContext({
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ],
    });
    const info = debugContext(ctx);

    expect(info.warnings.some((w) => w.includes("No user message"))).toBe(
      false
    );
  });

  test("section previews are truncated at 100 chars", () => {
    const longContent = "A".repeat(200);
    const ctx = makeContext({
      systemPrompt: `# Section\n${longContent}`,
    });
    const info = debugContext(ctx);

    for (const section of info.sections) {
      expect(section.preview.length).toBeLessThanOrEqual(103); // 100 + "..."
    }
  });
});

// --- formatDebugInfo ---

describe("formatDebugInfo", () => {
  test("includes token counts", () => {
    const info: ContextDebugInfo = {
      totalTokens: 500,
      systemPromptTokens: 300,
      messagesTokens: 200,
      messageCount: 5,
      sections: [],
      warnings: [],
    };

    const output = formatDebugInfo(info);
    expect(output).toContain("~500");
    expect(output).toContain("~300");
    expect(output).toContain("5");
    expect(output).toContain("~200");
  });

  test("includes sections when present", () => {
    const info: ContextDebugInfo = {
      totalTokens: 100,
      systemPromptTokens: 50,
      messagesTokens: 50,
      messageCount: 2,
      sections: [
        { name: "character", tokens: 30, preview: "Alice is..." },
        { name: "world_state", tokens: 20, preview: "The world..." },
      ],
      warnings: [],
    };

    const output = formatDebugInfo(info);
    expect(output).toContain("character");
    expect(output).toContain("world_state");
    expect(output).toContain("Sections:");
  });

  test("includes warnings when present", () => {
    const info: ContextDebugInfo = {
      totalTokens: 100,
      systemPromptTokens: 50,
      messagesTokens: 50,
      messageCount: 2,
      sections: [],
      warnings: ["System prompt is large", "Too few messages"],
    };

    const output = formatDebugInfo(info);
    expect(output).toContain("Warnings:");
    expect(output).toContain("System prompt is large");
    expect(output).toContain("Too few messages");
  });

  test("omits sections header when no sections", () => {
    const info: ContextDebugInfo = {
      totalTokens: 100,
      systemPromptTokens: 50,
      messagesTokens: 50,
      messageCount: 2,
      sections: [],
      warnings: [],
    };

    const output = formatDebugInfo(info);
    expect(output).not.toContain("Sections:");
  });

  test("omits warnings header when no warnings", () => {
    const info: ContextDebugInfo = {
      totalTokens: 100,
      systemPromptTokens: 50,
      messagesTokens: 50,
      messageCount: 2,
      sections: [],
      warnings: [],
    };

    const output = formatDebugInfo(info);
    expect(output).not.toContain("Warnings:");
  });
});

// --- Trace functions ---

describe("addTraceStep", () => {
  test("adds step to trace", () => {
    const trace: ContextTrace = {
      timestamp: Date.now(),
      channelId: "test",
      steps: [],
      finalTokens: 0,
    };

    const start = Date.now();
    addTraceStep(trace, "character", start, 150, "Added Alice");

    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0].step).toBe("character");
    expect(trace.steps[0].tokensAdded).toBe(150);
    expect(trace.steps[0].details).toBe("Added Alice");
    expect(trace.steps[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test("adds multiple steps", () => {
    const trace: ContextTrace = {
      timestamp: Date.now(),
      channelId: "test",
      steps: [],
      finalTokens: 0,
    };

    addTraceStep(trace, "system", Date.now(), 100);
    addTraceStep(trace, "character", Date.now(), 200);
    addTraceStep(trace, "messages", Date.now(), 300);

    expect(trace.steps).toHaveLength(3);
  });

  test("details are optional", () => {
    const trace: ContextTrace = {
      timestamp: Date.now(),
      channelId: "test",
      steps: [],
      finalTokens: 0,
    };

    addTraceStep(trace, "system", Date.now(), 100);
    expect(trace.steps[0].details).toBeUndefined();
  });
});

describe("finishTrace", () => {
  test("sets final token count", () => {
    const trace: ContextTrace = {
      timestamp: Date.now(),
      channelId: "test",
      steps: [],
      finalTokens: 0,
    };

    finishTrace(trace, 500);
    expect(trace.finalTokens).toBe(500);
  });
});

// --- formatTrace ---

describe("formatTrace", () => {
  test("includes timestamp", () => {
    const trace: ContextTrace = {
      timestamp: 1700000000000, // Fixed timestamp
      channelId: "test",
      steps: [],
      finalTokens: 0,
    };

    const output = formatTrace(trace);
    expect(output).toContain("Context Trace @");
  });

  test("formats steps with cumulative tokens", () => {
    const trace: ContextTrace = {
      timestamp: Date.now(),
      channelId: "test",
      steps: [
        { step: "system", durationMs: 5, tokensAdded: 100 },
        { step: "character", durationMs: 3, tokensAdded: 200 },
      ],
      finalTokens: 300,
    };

    const output = formatTrace(trace);
    expect(output).toContain("system: +100 tokens");
    expect(output).toContain("100 total");
    expect(output).toContain("character: +200 tokens");
    expect(output).toContain("300 total");
    expect(output).toContain("Final: 300 tokens");
  });

  test("includes step details when present", () => {
    const trace: ContextTrace = {
      timestamp: Date.now(),
      channelId: "test",
      steps: [
        {
          step: "character",
          durationMs: 3,
          tokensAdded: 200,
          details: "Alice (42 tokens)",
        },
      ],
      finalTokens: 200,
    };

    const output = formatTrace(trace);
    expect(output).toContain("Alice (42 tokens)");
  });
});

// --- exportContext ---

describe("exportContext", () => {
  test("exports valid JSON", () => {
    const ctx = makeContext({});
    const json = exportContext(ctx);
    const parsed = JSON.parse(json);

    expect(parsed.systemPrompt).toBe(ctx.systemPrompt);
    expect(parsed.tokenEstimate).toBe(ctx.tokenEstimate);
  });

  test("includes message metadata", () => {
    const ctx = makeContext({
      messages: [
        { role: "user", content: "Hello world" },
        { role: "assistant", content: "Hi!" },
      ],
    });
    const parsed = JSON.parse(exportContext(ctx));

    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].role).toBe("user");
    expect(parsed.messages[0].contentLength).toBe(11);
    expect(parsed.messages[1].role).toBe("assistant");
  });

  test("truncates long content preview at 200 chars", () => {
    const longContent = "A".repeat(500);
    const ctx = makeContext({
      messages: [{ role: "user", content: longContent }],
    });
    const parsed = JSON.parse(exportContext(ctx));

    expect(parsed.messages[0].contentPreview.length).toBeLessThanOrEqual(203); // 200 + "..."
    expect(parsed.messages[0].contentLength).toBe(500);
  });

  test("includes name when present", () => {
    const ctx = makeContext({
      messages: [{ role: "user", content: "Hi", name: "Alice" }],
    });
    const parsed = JSON.parse(exportContext(ctx));

    expect(parsed.messages[0].name).toBe("Alice");
  });

  test("does not include raw content", () => {
    const ctx = makeContext({
      messages: [{ role: "user", content: "Secret message" }],
    });
    const json = exportContext(ctx);
    const parsed = JSON.parse(json);

    // Should have contentPreview and contentLength, not raw content
    expect(parsed.messages[0]).not.toHaveProperty("content");
    expect(parsed.messages[0]).toHaveProperty("contentPreview");
    expect(parsed.messages[0]).toHaveProperty("contentLength");
  });
});
