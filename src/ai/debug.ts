// Context debugging and inspection tools

import type { AssembledContext } from "./context";
import { estimateTokens } from "./budget";

export interface ContextDebugInfo {
  totalTokens: number;
  systemPromptTokens: number;
  messagesTokens: number;
  messageCount: number;
  sections: Array<{
    name: string;
    tokens: number;
    preview: string;
  }>;
  warnings: string[];
}

// Analyze assembled context
export function debugContext(context: AssembledContext): ContextDebugInfo {
  const warnings: string[] = [];

  // Parse sections from system prompt
  const sections: Array<{ name: string; tokens: number; preview: string }> = [];
  const sectionRegex = /^#{1,2}\s+(.+)$/gm;
  const systemPrompt = context.systemPrompt;

  let lastIndex = 0;
  let lastSectionName = "preamble";
  let match;

  while ((match = sectionRegex.exec(systemPrompt)) !== null) {
    // Save previous section
    if (match.index > lastIndex) {
      const content = systemPrompt.slice(lastIndex, match.index).trim();
      if (content) {
        sections.push({
          name: lastSectionName,
          tokens: estimateTokens(content),
          preview: content.slice(0, 100) + (content.length > 100 ? "..." : ""),
        });
      }
    }
    lastSectionName = match[1].toLowerCase().replace(/[^a-z0-9]+/g, "_");
    lastIndex = match.index;
  }

  // Save last section
  if (lastIndex < systemPrompt.length) {
    const content = systemPrompt.slice(lastIndex).trim();
    if (content) {
      sections.push({
        name: lastSectionName,
        tokens: estimateTokens(content),
        preview: content.slice(0, 100) + (content.length > 100 ? "..." : ""),
      });
    }
  }

  const systemPromptTokens = estimateTokens(context.systemPrompt);
  const messagesTokens = context.messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + 10,
    0
  );

  // Warnings
  if (systemPromptTokens > 4000) {
    warnings.push(
      `System prompt is large (${systemPromptTokens} tokens), may impact response quality`
    );
  }

  if (context.messages.length < 2) {
    warnings.push("Very few messages in context, conversation may lack flow");
  }

  if (context.messages.length > 30) {
    warnings.push(
      "Many messages in context, consider summarizing older messages"
    );
  }

  const lastUserMessage = [...context.messages]
    .reverse()
    .find((m) => m.role === "user");
  if (!lastUserMessage) {
    warnings.push("No user message in context");
  }

  return {
    totalTokens: context.tokenEstimate,
    systemPromptTokens,
    messagesTokens,
    messageCount: context.messages.length,
    sections,
    warnings,
  };
}

// Format debug info for display
export function formatDebugInfo(info: ContextDebugInfo): string {
  const lines: string[] = [];

  lines.push("=== Context Debug ===");
  lines.push(`Total tokens: ~${info.totalTokens}`);
  lines.push(`System prompt: ~${info.systemPromptTokens} tokens`);
  lines.push(`Messages: ${info.messageCount} (~${info.messagesTokens} tokens)`);

  if (info.sections.length > 0) {
    lines.push("\nSections:");
    for (const section of info.sections) {
      lines.push(`  - ${section.name}: ~${section.tokens} tokens`);
    }
  }

  if (info.warnings.length > 0) {
    lines.push("\nWarnings:");
    for (const warning of info.warnings) {
      lines.push(`  ⚠ ${warning}`);
    }
  }

  return lines.join("\n");
}

// Trace what went into context assembly
export interface ContextTrace {
  timestamp: number;
  channelId: string;
  steps: Array<{
    step: string;
    durationMs: number;
    tokensAdded: number;
    details?: string;
  }>;
  finalTokens: number;
}

const traces = new Map<string, ContextTrace[]>();
const MAX_TRACES = 10;

export function startTrace(channelId: string): ContextTrace {
  const trace: ContextTrace = {
    timestamp: Date.now(),
    channelId,
    steps: [],
    finalTokens: 0,
  };

  // Store trace
  let channelTraces = traces.get(channelId);
  if (!channelTraces) {
    channelTraces = [];
    traces.set(channelId, channelTraces);
  }
  channelTraces.push(trace);

  // Limit stored traces
  if (channelTraces.length > MAX_TRACES) {
    channelTraces.shift();
  }

  return trace;
}

export function addTraceStep(
  trace: ContextTrace,
  step: string,
  startTime: number,
  tokensAdded: number,
  details?: string
): void {
  trace.steps.push({
    step,
    durationMs: Date.now() - startTime,
    tokensAdded,
    details,
  });
}

export function finishTrace(trace: ContextTrace, finalTokens: number): void {
  trace.finalTokens = finalTokens;
}

export function getRecentTraces(channelId: string): ContextTrace[] {
  return traces.get(channelId) ?? [];
}

export function formatTrace(trace: ContextTrace): string {
  const lines: string[] = [];
  const date = new Date(trace.timestamp);

  lines.push(`=== Context Trace @ ${date.toISOString()} ===`);

  let cumulativeTokens = 0;
  for (const step of trace.steps) {
    cumulativeTokens += step.tokensAdded;
    lines.push(
      `${step.step}: +${step.tokensAdded} tokens (${step.durationMs}ms) → ${cumulativeTokens} total`
    );
    if (step.details) {
      lines.push(`    ${step.details}`);
    }
  }

  lines.push(`Final: ${trace.finalTokens} tokens`);

  return lines.join("\n");
}

// Export context to JSON for inspection
export function exportContext(context: AssembledContext): string {
  return JSON.stringify(
    {
      systemPrompt: context.systemPrompt,
      messages: context.messages.map((m) => ({
        role: m.role,
        name: m.name,
        contentLength: m.content.length,
        contentPreview:
          m.content.slice(0, 200) + (m.content.length > 200 ? "..." : ""),
      })),
      tokenEstimate: context.tokenEstimate,
    },
    null,
    2
  );
}
