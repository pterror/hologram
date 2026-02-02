/**
 * Nunjucks-based template engine with runtime security patches.
 *
 * Supported syntax (full Nunjucks):
 *   {{ expr }}                           — expression output
 *   {% if expr %}...{% elif %}...{% else %}...{% endif %}
 *   {% for var in expr %}...{% else %}...{% endfor %}
 *   {% block name %}...{% endblock %}    — named blocks (inline)
 *   {{ value | filter }}                 — pipe filters
 *   {%- tag -%}                          — whitespace control
 *   {# comment #}
 *
 * Security: All property access goes through runtime.memberLookup,
 * all function calls through runtime.callWrap. We patch both to block
 * prototype chain traversal and dangerous methods.
 */

import { randomBytes } from "crypto";
import nunjucks from "nunjucks";
import { ExprError } from "../logic/expr";
import { validateRegexPattern } from "../logic/safe-regex";
import { getEntityByName, getEntityTemplate } from "../db/entities";

// =============================================================================
// Limits
// =============================================================================

/** Maximum output length in bytes */
const MAX_OUTPUT_LENGTH = 1_000_000;

/** Maximum iterations per for-loop (via fromIterator cap) */
const MAX_LOOP_ITERATIONS = 1000;

/** Max characters a string-producing method can output */
const MAX_STRING_OUTPUT = 100_000;

// =============================================================================
// Security Patches (applied once at module load)
// =============================================================================

/** Properties blocked on all objects (prevent prototype chain escapes) */
const BLOCKED_PROPS = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

/** Symbol used to thread the method receiver from memberLookup to callWrap */
const RECEIVER_SYM = Symbol("hologram.receiver");

// Patch memberLookup: block dangerous property access, tag receivers for wrapped methods
const origMemberLookup = nunjucks.runtime.memberLookup;
nunjucks.runtime.memberLookup = function (
  obj: unknown,
  val: unknown,
): unknown {
  if (typeof val === "string" && BLOCKED_PROPS.has(val)) {
    return undefined; // Silent block — matches expr.ts behavior
  }
  const result = origMemberLookup.call(this, obj, val);
  // Tag wrapped method wrappers with their receiver so callWrap can
  // compute exact output sizes before allocating (e.g. str.length * count)
  if (typeof result === "function" && typeof val === "string" && WRAPPED_METHODS.has(val)) {
    (result as unknown as Record<symbol, unknown>)[RECEIVER_SYM] = obj;
  }
  return result;
};

/** Methods blocked entirely */
const BLOCKED_METHODS: Record<string, string> = {
  matchAll: "matchAll() is not available — use match() instead",
};

/** Methods that compile their first string argument into a RegExp */
const REGEX_METHODS = new Set(["match", "search", "replace", "split"]);

/** Methods rewritten to use safe wrappers (memory exhaustion prevention) */
const WRAPPED_METHODS = new Set([
  "repeat",
  "padStart",
  "padEnd",
  "replaceAll",
  "join",
]);

// Patch callWrap: block dangerous methods, validate regex, wrap memory-dangerous methods
const origCallWrap = nunjucks.runtime.callWrap;
nunjucks.runtime.callWrap = function (
  obj: unknown,
  name: string,
  context: unknown,
  args: unknown[],
): unknown {
  // Extract the method name from "obj.method" or 'obj["method"]' style names
  let methodName: string;
  const bracketMatch = name.match(/\["(\w+)"\]$/);
  if (bracketMatch) {
    methodName = bracketMatch[1];
  } else {
    const dotIdx = name.lastIndexOf(".");
    methodName = dotIdx >= 0 ? name.slice(dotIdx + 1) : name;
  }

  // Block dangerous methods
  if (methodName in BLOCKED_METHODS) {
    throw new ExprError(BLOCKED_METHODS[methodName]);
  }

  // Block .apply(), .bind(), .call()
  if (
    methodName === "apply" ||
    methodName === "bind" ||
    methodName === "call"
  ) {
    throw new ExprError(`${methodName}() is not allowed in templates`);
  }

  // Validate regex for methods that compile strings to RegExp
  if (REGEX_METHODS.has(methodName) && args.length > 0) {
    const pattern = args[0];
    if (typeof pattern === "string") {
      validateRegexPattern(pattern);
    }
  }

  // Wrap memory-dangerous methods — pre-validate using exact output size
  // where possible to reject before the JS engine allocates the string
  if (WRAPPED_METHODS.has(methodName)) {
    let receiver: unknown;
    if (typeof obj === "function") {
      const tagged = obj as unknown as Record<symbol, unknown>;
      receiver = tagged[RECEIVER_SYM];
      delete tagged[RECEIVER_SYM];
    }

    if (methodName === "repeat") {
      const count = typeof args[0] === "number" ? args[0] : 0;
      if (typeof receiver === "string") {
        // Exact: output is receiver.length * count
        const outputLen = receiver.length * count;
        if (outputLen > MAX_STRING_OUTPUT) {
          throw new ExprError(
            `repeat() would produce ${outputLen.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`,
          );
        }
      } else if (count > MAX_STRING_OUTPUT) {
        // Fallback: no receiver info, at least block absurd counts
        throw new ExprError(
          `repeat() count ${count.toLocaleString()} exceeds limit (${MAX_STRING_OUTPUT.toLocaleString()})`,
        );
      }
    } else if (methodName === "padStart" || methodName === "padEnd") {
      // Exact: output is max(receiver.length, targetLength)
      const targetLength = args[0];
      if (typeof targetLength === "number" && targetLength > MAX_STRING_OUTPUT) {
        throw new ExprError(
          `${methodName}() target length ${targetLength.toLocaleString()} exceeds limit (${MAX_STRING_OUTPUT.toLocaleString()})`,
        );
      }
    }

    if (typeof obj === "function") {
      const result = origCallWrap.call(this, obj, name, context, args);
      if (typeof result === "string" && result.length > MAX_STRING_OUTPUT) {
        throw new ExprError(
          `${methodName}() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`,
        );
      }
      return result;
    }
  }

  return origCallWrap.call(this, obj, name, context, args);
};

// Patch fromIterator: cap loop iteration count
const origFromIterator = nunjucks.runtime.fromIterator;
nunjucks.runtime.fromIterator = function (arr: unknown): unknown {
  const result = origFromIterator(arr);
  if (Array.isArray(result) && result.length > MAX_LOOP_ITERATIONS) {
    throw new ExprError(
      `Loop exceeds ${MAX_LOOP_ITERATIONS} iteration limit (got ${result.length})`,
    );
  }
  return result;
};

// =============================================================================
// Template Loader (Entity-Name Resolution)
// =============================================================================

class EntityTemplateLoader extends nunjucks.Loader {
  cache: Record<string, unknown> = {};
  private internalTemplates = new Map<string, string>();

  getSource(name: string): { src: string; path: string; noCache: boolean } | null {
    const internal = this.internalTemplates.get(name);
    if (internal !== undefined) {
      return { src: internal, path: `internal:${name}`, noCache: true };
    }
    const entity = getEntityByName(name);
    if (!entity) return null;
    const template = getEntityTemplate(entity.id);
    if (!template) return null;
    return { src: template, path: `entity:${entity.id}:${name}`, noCache: true };
  }

  setInternal(name: string, source: string) { this.internalTemplates.set(name, source); }
  clearInternal(name: string) { this.internalTemplates.delete(name); }
}

// =============================================================================
// Environment Setup
// =============================================================================

const loader = new EntityTemplateLoader();
const env = new nunjucks.Environment(loader, {
  autoescape: false, // No HTML escaping (we're generating LLM prompts)
  trimBlocks: true, // Strip newline after block tags
  lstripBlocks: true, // Strip leading whitespace on block-only lines
  throwOnUndefined: false, // Undefined variables render as empty string
});

// =============================================================================
// Built-in Filters
// =============================================================================

env.addFilter("default", (val: unknown, def: unknown) =>
  val == null || val === "" ? def : val,
);

env.addFilter("length", (val: unknown) => {
  if (Array.isArray(val)) return val.length;
  if (typeof val === "string") return val.length;
  return 0;
});

env.addFilter("join", (arr: unknown, sep?: unknown) => {
  if (!Array.isArray(arr)) return "";
  const result = sep !== undefined ? arr.join(String(sep)) : arr.join();
  if (result.length > MAX_STRING_OUTPUT) {
    throw new ExprError(
      `join() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`,
    );
  }
  return result;
});

env.addFilter("first", (val: unknown) => {
  if (Array.isArray(val)) return val[0];
  if (typeof val === "string") return val[0];
  return undefined;
});

env.addFilter("last", (val: unknown) => {
  if (Array.isArray(val)) return val[val.length - 1];
  if (typeof val === "string") return val[val.length - 1];
  return undefined;
});

env.addFilter("upper", (val: unknown) =>
  typeof val === "string" ? val.toUpperCase() : val,
);

env.addFilter("lower", (val: unknown) =>
  typeof val === "string" ? val.toLowerCase() : val,
);

env.addFilter("trim", (val: unknown) =>
  typeof val === "string" ? val.trim() : val,
);

env.addFilter("nl2br", (val: unknown) =>
  // Identity for LLM prompts — no HTML conversion needed
  val,
);

env.addFilter("int", (val: unknown) => {
  const n = parseInt(String(val));
  return isNaN(n) ? 0 : n;
});

env.addFilter("float", (val: unknown) => {
  const n = parseFloat(String(val));
  return isNaN(n) ? 0.0 : n;
});

env.addFilter("abs", (val: unknown) =>
  typeof val === "number" ? Math.abs(val) : val,
);

env.addFilter("round", (val: unknown, precision?: unknown) => {
  if (typeof val !== "number") return val;
  const p =
    typeof precision === "number" ? precision : 0;
  const factor = Math.pow(10, p);
  return Math.round(val * factor) / factor;
});

env.addFilter("reverse", (val: unknown) => {
  if (Array.isArray(val)) return val.slice().reverse();
  if (typeof val === "string") return val.split("").reverse().join("");
  return val;
});

env.addFilter("sort", (val: unknown) => {
  if (!Array.isArray(val)) return val;
  return val.slice().sort();
});

env.addFilter("batch", (val: unknown, n: unknown) => {
  if (!Array.isArray(val)) return val;
  const size = typeof n === "number" ? n : 1;
  const batches: unknown[][] = [];
  for (let i = 0; i < val.length; i += size) {
    batches.push(val.slice(i, i + size));
  }
  return batches;
});

// =============================================================================
// Public API
// =============================================================================

/**
 * Render a template string with the given context.
 * Throws ExprError on security violations or output limits.
 */
export function renderEntityTemplate(
  source: string,
  ctx: Record<string, unknown>,
): string {
  try {
    const result = env.renderString(source, ctx);
    if (result.length > MAX_OUTPUT_LENGTH) {
      throw new ExprError(
        `Template output exceeds ${MAX_OUTPUT_LENGTH.toLocaleString()} character limit`,
      );
    }
    return result;
  } catch (err) {
    if (err instanceof ExprError) throw err;
    // Wrap Nunjucks errors in ExprError for consistent error handling
    throw new ExprError(
      `Template error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// =============================================================================
// Nonce-Based Structured Output Protocol
// =============================================================================

/** Marker format: <<<HMSG:{nonce}:{base64(JSON)}>>> (open) / <<<HMSG:{nonce}:END>>> (close) */
const MARKER_PREFIX = "<<<HMSG:";
const MARKER_SUFFIX = ">>>";

export interface ParsedTemplateMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ParsedTemplateOutput {
  /** All messages including system-role segments */
  messages: ParsedTemplateMessage[];
}

/**
 * Parse structured output from a rendered template.
 * Matches open/close nonce marker pairs to extract a flat list of messages.
 * Content outside marker pairs is ignored. No markers = legacy single system message.
 */
export function parseStructuredOutput(rendered: string, nonce: string): ParsedTemplateOutput {
  const markerPattern = new RegExp(
    `${escapeRegExp(MARKER_PREFIX)}${escapeRegExp(nonce)}:([A-Za-z0-9+/=]+)${escapeRegExp(MARKER_SUFFIX)}`,
    "g",
  );

  // Find all markers (both open and close)
  const allMarkers: Array<{ index: number; length: number; payload: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(rendered)) !== null) {
    allMarkers.push({
      index: match.index,
      length: match[0].length,
      payload: match[1],
    });
  }

  // No markers → entire output is a single system message (legacy compat)
  if (allMarkers.length === 0) {
    const trimmed = rendered.trim();
    return { messages: trimmed ? [{ role: "system", content: trimmed }] : [] };
  }

  const messages: ParsedTemplateMessage[] = [];

  // Process open/close pairs sequentially
  let i = 0;
  while (i < allMarkers.length) {
    const marker = allMarkers[i];

    // Close marker without open → skip
    if (marker.payload === "END") {
      i++;
      continue;
    }

    // Open marker — expect next marker to be close
    const contentStart = marker.index + marker.length;
    let contentEnd = rendered.length;
    if (i + 1 < allMarkers.length && allMarkers[i + 1].payload === "END") {
      contentEnd = allMarkers[i + 1].index;
      i += 2; // Skip both open and close
    } else {
      i++; // Orphaned open marker — take content until next marker or end
    }

    const content = rendered.slice(contentStart, contentEnd).trim();
    if (!content) continue;

    const decoded = JSON.parse(Buffer.from(marker.payload, "base64").toString("utf-8"));
    const role = decoded.role as "system" | "user" | "assistant";
    messages.push({ role, content });
  }

  return { messages };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =============================================================================
// Default Templates (Nunjucks)
// =============================================================================

/**
 * Template for the dedicated system parameter (AI SDK `system` field).
 * Rendered separately from the conversation messages template.
 *
 * This is distinct from system-role messages in the conversation — those carry
 * entity definitions, memories, and instructions. This top-level system field
 * provides framing context that the LLM sees before any messages.
 */
export const SYSTEM_PROMPT_TEMPLATE = "";

/**
 * Default template using role blocks (system, user, char).
 *
 * Produces system-role messages (entity defs, memories, multi-entity guidance)
 * followed by user/assistant chat messages from history.
 *
 * The Nunjucks env has trimBlocks + lstripBlocks enabled, so block tags on
 * their own lines can be freely indented without affecting output.
 *
 * renderStructuredTemplate() generates a child template that wraps each
 * role block with nonce markers via {{ super() }}.
 */
export const DEFAULT_TEMPLATE = `\
{#- Entity definitions -#}
{% block system -%}
{%- if entities | length == 0 and others | length == 0 -%}
You are a helpful assistant. Respond naturally to the user.
{%- else -%}

  {#- Responding entities -#}
  {%- for entity in entities -%}
    {%- if not loop.first %}


    {% endif -%}
<defs for="{{ entity.name }}" id="{{ entity.id }}">
{{ entity.facts | join("\\n") }}
</defs>
    {%- if memories[entity.id] and memories[entity.id] | length > 0 %}


<memories for="{{ entity.name }}" id="{{ entity.id }}">
{{ memories[entity.id] | join("\\n") }}
</memories>
    {%- endif -%}
  {%- endfor -%}

  {#- Referenced and user entities -#}
  {%- for entity in others -%}
    {%- if entities | length > 0 or not loop.first %}


    {% endif -%}
<defs for="{{ entity.name }}" id="{{ entity.id }}">
{{ entity.facts | join("\\n") }}
</defs>
  {%- endfor -%}

  {#- Multi-entity response format -#}
  {%- if entities | length > 1 -%}
    {%- if freeform %}


You are writing as: {{ entity_names }}. They may interact naturally in your response. Not everyone needs to respond to every message - only include those who would naturally engage. If none would respond, reply with only: none
    {%- else %}


You are: {{ entity_names }}. Format your response with name prefixes:
{{ entities[0].name }}: *waves* Hello there!
{{ entities[1].name }}: Nice to meet you.

Start each character's dialogue on a new line with their name followed by a colon. They may interact naturally.

Not everyone needs to respond to every message. Only respond as those who would naturally engage with what was said. If none would respond, reply with only: none
    {%- endif -%}
  {%- endif -%}

{%- endif -%}
{%- endblock %}
{#- Message history -#}
{%- for msg in history -%}
  {%- if msg.role == "assistant" %}
{% block char %}{{ msg.author }}: {{ msg.content }}{% endblock %}
  {%- else %}
{% block user %}{{ msg.author }}: {{ msg.content }}{% endblock %}
  {%- endif -%}
{%- endfor -%}`;

/**
 * Render a template and parse structured output.
 * Generates a child template that extends the source and wraps each role block
 * (system, user, char) with nonce markers via {{ super() }}.
 * Returns a flat list of messages (system, user, assistant).
 */
export function renderStructuredTemplate(
  source: string,
  ctx: Record<string, unknown>,
): ParsedTemplateOutput {
  const nonce = randomBytes(32).toString("hex");

  // Register user template under a unique internal name
  const parentName = `_render_${nonce}`;
  loader.setInternal(parentName, source);

  // Generate child that wraps role blocks with nonce markers
  const open = (role: string): string => {
    const payload = JSON.stringify({ role });
    const encoded = Buffer.from(payload).toString("base64");
    return `${MARKER_PREFIX}${nonce}:${encoded}${MARKER_SUFFIX}`;
  };
  const close = `${MARKER_PREFIX}${nonce}:END${MARKER_SUFFIX}`;

  const childSource =
    `{% extends "${parentName}" %}` +
    `{% block system %}${open("system")}{{ super() }}${close}{% endblock %}` +
    `{% block user %}${open("user")}{{ super() }}${close}{% endblock %}` +
    `{% block char %}${open("assistant")}{{ super() }}${close}{% endblock %}`;

  try {
    const rendered = renderEntityTemplate(childSource, ctx);
    return parseStructuredOutput(rendered, nonce);
  } finally {
    loader.clearInternal(parentName);
  }
}

/**
 * Render the dedicated system prompt template.
 * Returns the string for the AI SDK `system` parameter, separate from messages.
 */
export function renderSystemPrompt(
  ctx: Record<string, unknown>,
  template?: string,
): string {
  const source = template ?? SYSTEM_PROMPT_TEMPLATE;
  return renderEntityTemplate(source, ctx).trim();
}
