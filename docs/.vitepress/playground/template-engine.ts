/**
 * Browser-compatible Nunjucks template engine.
 * Adapted from src/ai/template.ts — uses in-memory template loading instead of DB.
 */
import nunjucks from 'nunjucks'

// =============================================================================
// Limits
// =============================================================================

const MAX_OUTPUT_LENGTH = 1_000_000
const MAX_LOOP_ITERATIONS = 1000
const MAX_STRING_OUTPUT = 100_000

// =============================================================================
// Error type (mirrors ExprError from src/logic/expr.ts)
// =============================================================================

class TemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateError'
  }
}

// =============================================================================
// Security Patches (applied once at module load)
// =============================================================================

const BLOCKED_PROPS = new Set([
  'constructor', '__proto__', 'prototype',
  '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__',
])

const RECEIVER_SYM = Symbol('hologram.receiver')

const origMemberLookup = nunjucks.runtime.memberLookup
nunjucks.runtime.memberLookup = function (obj: unknown, val: unknown): unknown {
  if (typeof val === 'string' && BLOCKED_PROPS.has(val)) return undefined
  const result = origMemberLookup.call(this, obj, val)
  if (typeof result === 'function' && typeof val === 'string' && WRAPPED_METHODS.has(val)) {
    (result as unknown as Record<symbol, unknown>)[RECEIVER_SYM] = obj
  }
  return result
}

const BLOCKED_METHODS: Record<string, string> = {
  matchAll: 'matchAll() is not available — use match() instead',
}

const WRAPPED_METHODS = new Set(['repeat', 'padStart', 'padEnd', 'replaceAll', 'join'])

const origCallWrap = nunjucks.runtime.callWrap
nunjucks.runtime.callWrap = function (
  obj: unknown, name: string, context: unknown, args: unknown[],
): unknown {
  let methodName: string
  const bracketMatch = name.match(/\["(\w+)"\]$/)
  if (bracketMatch) {
    methodName = bracketMatch[1]
  } else {
    const dotIdx = name.lastIndexOf('.')
    methodName = dotIdx >= 0 ? name.slice(dotIdx + 1) : name
  }

  if (methodName in BLOCKED_METHODS) throw new TemplateError(BLOCKED_METHODS[methodName])
  if (methodName === 'apply' || methodName === 'bind' || methodName === 'call') {
    throw new TemplateError(`${methodName}() is not allowed in templates`)
  }

  if (WRAPPED_METHODS.has(methodName)) {
    let receiver: unknown
    if (typeof obj === 'function') {
      const tagged = obj as unknown as Record<symbol, unknown>
      receiver = tagged[RECEIVER_SYM]
      delete tagged[RECEIVER_SYM]
    }

    if (methodName === 'repeat') {
      const count = typeof args[0] === 'number' ? args[0] : 0
      if (typeof receiver === 'string') {
        const outputLen = receiver.length * count
        if (outputLen > MAX_STRING_OUTPUT) {
          throw new TemplateError(`repeat() would produce ${outputLen.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`)
        }
      } else if (count > MAX_STRING_OUTPUT) {
        throw new TemplateError(`repeat() count ${count.toLocaleString()} exceeds limit (${MAX_STRING_OUTPUT.toLocaleString()})`)
      }
    } else if (methodName === 'padStart' || methodName === 'padEnd') {
      const targetLength = args[0]
      if (typeof targetLength === 'number' && targetLength > MAX_STRING_OUTPUT) {
        throw new TemplateError(`${methodName}() target length ${targetLength.toLocaleString()} exceeds limit (${MAX_STRING_OUTPUT.toLocaleString()})`)
      }
    }

    if (typeof obj === 'function') {
      const result = origCallWrap.call(this, obj, name, context, args)
      if (typeof result === 'string' && result.length > MAX_STRING_OUTPUT) {
        throw new TemplateError(`${methodName}() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`)
      }
      return result
    }
  }

  return origCallWrap.call(this, obj, name, context, args)
}

const origFromIterator = nunjucks.runtime.fromIterator
nunjucks.runtime.fromIterator = function (arr: unknown): unknown {
  const result = origFromIterator(arr)
  if (Array.isArray(result) && result.length > MAX_LOOP_ITERATIONS) {
    throw new TemplateError(`Loop exceeds ${MAX_LOOP_ITERATIONS} iteration limit (got ${result.length})`)
  }
  return result
}

// =============================================================================
// In-Memory Template Loader
// =============================================================================

class MapLoader extends (nunjucks.Loader as { new(): nunjucks.ILoader }) {
  cache: Record<string, unknown> = {}
  private templates = new Map<string, string>()
  private _macroDef: string | null = null

  getSource(name: string): { src: string; path: string; noCache: boolean } | null {
    const src = this.templates.get(name)
    if (src === undefined) return null
    let result = src
    if (this._macroDef && !startsWithExtends(src)) {
      result = this._macroDef + '\n' + src
    }
    return { src: result, path: `memory:${name}`, noCache: true }
  }

  set(name: string, source: string) { this.templates.set(name, source) }
  remove(name: string) { this.templates.delete(name) }
  setMacroDef(def: string | null) { this._macroDef = def }
}

// =============================================================================
// Environment Setup
// =============================================================================

const loader = new MapLoader()
const env = new nunjucks.Environment(loader as unknown as nunjucks.ILoader, {
  autoescape: false,
  trimBlocks: true,
  lstripBlocks: true,
  throwOnUndefined: false,
})

// Built-in filters
env.addFilter('default', (val: unknown, def: unknown) => val == null || val === '' ? def : val)
env.addFilter('length', (val: unknown) => {
  if (Array.isArray(val)) return val.length
  if (typeof val === 'string') return val.length
  return 0
})
env.addFilter('join', (arr: unknown, sep?: unknown, attr?: unknown) => {
  if (!Array.isArray(arr)) return ''
  const items = attr !== undefined ? arr.map(v => v != null ? v[String(attr)] : v) : arr
  const result = sep !== undefined ? items.join(String(sep)) : items.join()
  if (result.length > MAX_STRING_OUTPUT) {
    throw new TemplateError(`join() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`)
  }
  return result
})
env.addFilter('first', (val: unknown) => {
  if (Array.isArray(val)) return val[0]
  if (typeof val === 'string') return val[0]
  return undefined
})
env.addFilter('last', (val: unknown) => {
  if (Array.isArray(val)) return val[val.length - 1]
  if (typeof val === 'string') return val[val.length - 1]
  return undefined
})
env.addFilter('upper', (val: unknown) => typeof val === 'string' ? val.toUpperCase() : val)
env.addFilter('lower', (val: unknown) => typeof val === 'string' ? val.toLowerCase() : val)
env.addFilter('trim', (val: unknown) => typeof val === 'string' ? val.trim() : val)
env.addFilter('nl2br', (val: unknown) => val)
env.addFilter('int', (val: unknown) => { const n = parseInt(String(val)); return isNaN(n) ? 0 : n })
env.addFilter('float', (val: unknown) => { const n = parseFloat(String(val)); return isNaN(n) ? 0.0 : n })
env.addFilter('abs', (val: unknown) => typeof val === 'number' ? Math.abs(val) : val)
env.addFilter('round', (val: unknown, precision?: unknown) => {
  if (typeof val !== 'number') return val
  const p = typeof precision === 'number' ? precision : 0
  const factor = Math.pow(10, p)
  return Math.round(val * factor) / factor
})
env.addFilter('reverse', (val: unknown) => {
  if (Array.isArray(val)) return val.slice().reverse()
  if (typeof val === 'string') return val.split('').reverse().join('')
  return val
})
env.addFilter('sort', (val: unknown) => {
  if (!Array.isArray(val)) return val
  return val.slice().sort()
})
env.addFilter('batch', (val: unknown, n: unknown) => {
  if (!Array.isArray(val)) return val
  const size = typeof n === 'number' ? n : 1
  const batches: unknown[][] = []
  for (let i = 0; i < val.length; i += size) {
    batches.push(val.slice(i, i + size))
  }
  return batches
})

// =============================================================================
// Structured Output Protocol
// =============================================================================

const MARKER_OPEN_PREFIX = '<<<HMSG:'
const MARKER_CLOSE_PREFIX = '<<<HMSG_END:'
const MARKER_SUFFIX = '>>>'
const VALID_ROLE = /^\w+$/

export interface ParsedTemplateMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ParsedTemplateOutput {
  messages: ParsedTemplateMessage[]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseStructuredOutput(rendered: string, nonce: string): ParsedTemplateOutput {
  const openPattern = new RegExp(
    `${escapeRegExp(MARKER_OPEN_PREFIX)}${escapeRegExp(nonce)}:(\\w+)${escapeRegExp(MARKER_SUFFIX)}`, 'g',
  )
  const closePattern = new RegExp(
    `${escapeRegExp(MARKER_CLOSE_PREFIX)}${escapeRegExp(nonce)}${escapeRegExp(MARKER_SUFFIX)}`, 'g',
  )

  interface Marker { index: number; length: number; type: 'open' | 'close'; role?: string }
  const allMarkers: Marker[] = []

  let match: RegExpExecArray | null
  while ((match = openPattern.exec(rendered)) !== null) {
    const role = match[1]
    if (VALID_ROLE.test(role)) {
      allMarkers.push({ index: match.index, length: match[0].length, type: 'open', role })
    }
  }
  while ((match = closePattern.exec(rendered)) !== null) {
    allMarkers.push({ index: match.index, length: match[0].length, type: 'close' })
  }

  if (allMarkers.length === 0) {
    const trimmed = rendered.trim()
    return { messages: trimmed ? [{ role: 'system', content: trimmed }] : [] }
  }

  allMarkers.sort((a, b) => a.index - b.index)

  const messages: ParsedTemplateMessage[] = []
  let cursor = 0
  let i = 0

  while (i < allMarkers.length) {
    const marker = allMarkers[i]
    const unmarked = rendered.slice(cursor, marker.index).trim()
    if (unmarked) messages.push({ role: 'system', content: unmarked })

    if (marker.type === 'close') {
      cursor = marker.index + marker.length
      i++
      continue
    }

    const contentStart = marker.index + marker.length
    const role = marker.role as 'system' | 'user' | 'assistant'

    if (i + 1 < allMarkers.length && allMarkers[i + 1].type === 'close') {
      const contentEnd = allMarkers[i + 1].index
      const content = rendered.slice(contentStart, contentEnd).trim()
      if (content) messages.push({ role, content })
      cursor = allMarkers[i + 1].index + allMarkers[i + 1].length
      i += 2
    } else {
      const nextIdx = i + 1 < allMarkers.length ? allMarkers[i + 1].index : rendered.length
      const content = rendered.slice(contentStart, nextIdx).trim()
      if (content) messages.push({ role, content })
      cursor = nextIdx
      i++
    }
  }

  const trailing = rendered.slice(cursor).trim()
  if (trailing) messages.push({ role: 'system', content: trailing })

  return { messages }
}

function buildSendAsMacro(nonce: string): string {
  return `{% macro send_as(role) %}${MARKER_OPEN_PREFIX}${nonce}:{{ role }}${MARKER_SUFFIX}{{ caller() }}${MARKER_CLOSE_PREFIX}${nonce}${MARKER_SUFFIX}{% endmacro %}`
}

function startsWithExtends(source: string): boolean {
  const stripped = source.replace(/^\s*(\{#[\s\S]*?#\}\s*)*/g, '')
  return /^\{%[-\s]*extends\s/.test(stripped)
}

// =============================================================================
// Default Template (inline copy from src/templates/default.njk)
// =============================================================================

export const DEFAULT_TEMPLATE = `{#- Entity Definitions -#}
{% block definitions %}
  {% if entities | length > 0 or others | length > 0 %}
    {#- Responding entities -#}
    {% for entity in entities %}
      {{- "\\n\\n" if not loop.first -}}
<defs for="{{ entity.name }}" id="{{ entity.id }}">
{{ entity.facts | join("\\n") }}
</defs>
      {% if memories[entity.id] and memories[entity.id] | length > 0 %}

<memories for="{{ entity.name }}" id="{{ entity.id }}">
{{ memories[entity.id] | join("\\n") }}
</memories>
      {% endif %}
    {% endfor %}

    {#- Referenced and User Entities -#}
    {% for entity in others %}
      {{- "\\n\\n" if entities | length > 0 or not loop.first -}}
<defs for="{{ entity.name }}" id="{{ entity.id }}">
{{ entity.facts | join("\\n") }}
</defs>
    {% endfor %}

    {#- Multi-Entity Response Format -#}
    {% if entities | length > 1 %}
      {{- "\\n" -}}
      {% if freeform -%}
        You are writing as: {{ entities | join(", ", "name") }}. They may interact naturally in your response. Not everyone needs to respond to every message - only include those who would naturally engage. If none would respond, reply with only: none
      {%- else %}
You are: {{ entities | join(", ", "name") }}. Format your response with name prefixes:
{{ entities[0].name }}: Hello there!
{{ entities[1].name }}: Nice to meet you.

Start each character's dialogue on a new line with their name followed by a colon. They may interact naturally.

Not everyone needs to respond to every message. Only respond as those who would naturally engage with what was said. If none would respond, reply with only: none
      {% endif %}
    {% endif %}
  {% endif %}
{% endblock definitions %}

{#- Message history -#}
{% block history %}
  {{- "\\n" -}}
  {% for msg in history %}
    {{- "\\n" if not loop.first -}}
    {% call send_as(msg.role) -%}
      {{ msg.author }}: {{ msg.content }}
    {%- endcall %}
  {% endfor %}
{% endblock history %}`

// =============================================================================
// Public API
// =============================================================================

function renderEntityTemplate(source: string, ctx: Record<string, unknown>): string {
  try {
    const result = env.renderString(source, ctx)
    if (result.length > MAX_OUTPUT_LENGTH) {
      throw new TemplateError(`Template output exceeds ${MAX_OUTPUT_LENGTH.toLocaleString()} character limit`)
    }
    return result
  } catch (err) {
    if (err instanceof TemplateError) throw err
    throw new TemplateError(`Template error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function generateNonce(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

export function renderStructuredTemplate(
  source: string,
  ctx: Record<string, unknown>,
): ParsedTemplateOutput {
  const nonce = generateNonce()
  const macroDef = buildSendAsMacro(nonce)

  let augmented: string
  if (startsWithExtends(source)) {
    augmented = source
  } else {
    augmented = macroDef + '\n' + source
  }

  const parentName = `_render_${nonce}`
  loader.set(parentName, augmented)
  loader.setMacroDef(macroDef)

  try {
    const rendered = renderEntityTemplate(`{% extends "${parentName}" %}`, ctx)
    return parseStructuredOutput(rendered, nonce)
  } finally {
    loader.remove(parentName)
    loader.setMacroDef(null)
  }
}
