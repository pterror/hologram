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

// Patch memberLookup: block dangerous property access
const origMemberLookup = nunjucks.runtime.memberLookup;
nunjucks.runtime.memberLookup = function (
  obj: unknown,
  val: unknown,
): unknown {
  if (typeof val === "string" && BLOCKED_PROPS.has(val)) {
    return undefined; // Silent block — matches expr.ts behavior
  }
  return origMemberLookup.call(this, obj, val);
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

  // Wrap memory-dangerous methods
  if (WRAPPED_METHODS.has(methodName) && typeof obj === "function") {
    // obj here is the bound method — but we need to intercept the result
    const result = origCallWrap.call(this, obj, name, context, args);
    if (typeof result === "string" && result.length > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `${methodName}() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`,
      );
    }
    return result;
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

  getSource(name: string): { src: string; path: string; noCache: boolean } | null {
    const entity = getEntityByName(name);
    if (!entity) return null;
    const template = getEntityTemplate(entity.id);
    if (!template) return null;
    return { src: template, path: `entity:${entity.id}:${name}`, noCache: true };
  }
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

/** Valid roles for _msg() markers */
const VALID_ROLES = new Set(["system", "user", "assistant"]);

/** Marker format: <<<HMSG:{nonce}:{base64(JSON)}>>> */
const MARKER_PREFIX = "<<<HMSG:";
const MARKER_SUFFIX = ">>>";

export interface ParsedTemplateMessage {
  role: "system" | "user" | "assistant";
  content: string;
  author?: string;
  author_id?: string;
}

export interface ParsedTemplateOutput {
  /** Content before first _msg() marker (system prompt) */
  systemPrompt: string;
  /** Content between _msg() markers (structured messages) */
  messages: ParsedTemplateMessage[];
}

/**
 * Create a _msg() function bound to a specific nonce.
 * Emits <<<HMSG:{nonce}:{base64(JSON)}>>> markers in template output.
 */
function makeMsgFunction(nonce: string): (role: string, opts?: { author?: string; author_id?: string }) => string {
  return (role: string, opts?: { author?: string; author_id?: string }): string => {
    if (!VALID_ROLES.has(role)) {
      throw new ExprError(`_msg() role must be "system", "user", or "assistant", got "${role}"`);
    }
    const payload = JSON.stringify({ role, ...opts });
    const encoded = Buffer.from(payload).toString("base64");
    return `${MARKER_PREFIX}${nonce}:${encoded}${MARKER_SUFFIX}`;
  };
}

/**
 * Parse structured output from a rendered template.
 * Splits on nonce-based markers to extract system prompt + messages.
 */
export function parseStructuredOutput(rendered: string, nonce: string): ParsedTemplateOutput {
  const markerPattern = new RegExp(
    `<<<HMSG:${nonce}:([A-Za-z0-9+/=]+)>>>`,
    "g",
  );

  // Find all markers
  const markers: Array<{ index: number; length: number; payload: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(rendered)) !== null) {
    markers.push({
      index: match.index,
      length: match[0].length,
      payload: match[1],
    });
  }

  // No markers → entire output is systemPrompt (legacy compat)
  if (markers.length === 0) {
    return { systemPrompt: rendered.trim(), messages: [] };
  }

  // Content before first marker → systemPrompt
  const systemPrompt = rendered.slice(0, markers[0].index).trim();

  // Content between markers → messages
  const messages: ParsedTemplateMessage[] = [];
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const contentStart = marker.index + marker.length;
    const contentEnd = i + 1 < markers.length ? markers[i + 1].index : rendered.length;
    const content = rendered.slice(contentStart, contentEnd).trim();

    // Decode marker payload
    const decoded = JSON.parse(Buffer.from(marker.payload, "base64").toString("utf-8"));
    const role = decoded.role as "system" | "user" | "assistant";

    // Skip empty-content messages
    if (!content) continue;

    const msg: ParsedTemplateMessage = { role, content };
    if (decoded.author) msg.author = decoded.author;
    if (decoded.author_id) msg.author_id = decoded.author_id;
    messages.push(msg);
  }

  return { systemPrompt, messages };
}

/**
 * Render a template and parse structured output.
 * Injects _msg() into the template context for structured message emission.
 * Returns parsed system prompt + messages.
 */
// =============================================================================
// Default Template (Nunjucks)
// =============================================================================

/**
 * Default template that produces structured system prompt + role-based messages
 * using the _msg() protocol.
 *
 * System prompt section: entity defs, memories, multi-entity guidance
 * Message section: _msg() markers with role-based history
 */
export const DEFAULT_TEMPLATE = `\
{%- if entities | length == 0 and others | length == 0 -%}
You are a helpful assistant. Respond naturally to the user.
{%- else -%}
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
{%- for entity in others -%}
{%- if entities | length > 0 or not loop.first %}


{% endif -%}
<defs for="{{ entity.name }}" id="{{ entity.id }}">
{{ entity.facts | join("\\n") }}
</defs>
{%- endfor -%}
{%- if entities | length > 1 -%}
{%- if freeform %}


You are writing as: {{ entity_names }}. They may interact naturally in your response. Not everyone needs to respond to every message - only include those who would naturally engage. If none would respond, reply with only: none
{%- else %}


You are: {{ entity_names }}. Format your response with XML tags:
<{{ entities[0].name }}>*waves* Hello there!</{{ entities[0].name }}>
<{{ entities[1].name }}>Nice to meet you.</{{ entities[1].name }}>

Wrap everyone's dialogue in their name tag. They may interact naturally.

Not everyone needs to respond to every message. Only respond as those who would naturally engage with what was said. If none would respond, reply with only <none/>.
{%- endif -%}
{%- endif -%}
{%- endif -%}
{%- for msg in history -%}
{{ _msg(msg.role, {author: msg.author, author_id: msg.author_id}) }}
{{ msg.author }}: {{ msg.content }}
{%- endfor -%}`;

export function renderStructuredTemplate(
  source: string,
  ctx: Record<string, unknown>,
): ParsedTemplateOutput {
  const nonce = randomBytes(32).toString("hex");
  ctx._msg = makeMsgFunction(nonce);
  const rendered = renderEntityTemplate(source, ctx);
  return parseStructuredOutput(rendered, nonce);
}
