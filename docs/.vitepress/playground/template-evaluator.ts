/**
 * Builds template context and renders templates for the playground.
 */
import {
  renderStructuredTemplate,
  DEFAULT_TEMPLATE,
  type ParsedTemplateOutput,
} from './template-engine'

export interface PlaygroundEntity {
  id: number
  name: string
  factsText: string
}

export interface PlaygroundHistoryMessage {
  author: string
  content: string
  role: 'user' | 'assistant'
}

export interface TemplateInput {
  template: string
  entities: PlaygroundEntity[]
  others: PlaygroundEntity[]
  memories: Record<number, string[]>
  history: PlaygroundHistoryMessage[]
  freeform: boolean
}

export interface TemplateEvalResult {
  output: ParsedTemplateOutput
  error: string | null
}

function makeFactsArray(text: string): string[] & { toString(): string } {
  const arr = text.split('\n').filter(l => l.trim() !== '')
  // Nunjucks templates use `entity.facts | join("\n")` — this toString makes
  // plain {{ entity.facts }} also work.
  ;(arr as unknown as { toString: () => string }).toString = () => arr.join('\n')
  return arr as string[] & { toString(): string }
}

function makeEntity(e: PlaygroundEntity) {
  return {
    id: e.id,
    name: e.name,
    facts: makeFactsArray(e.factsText),
    toString: () => e.name,
  }
}

export function evaluateTemplate(input: TemplateInput): TemplateEvalResult {
  try {
    const entities = input.entities.map(makeEntity)
    const others = input.others.map(makeEntity)

    // Build memories object: entity id -> string[] with toString
    const memories: Record<number, string[] & { toString(): string }> = {}
    for (const [id, mems] of Object.entries(input.memories)) {
      const arr = mems.filter(Boolean)
      ;(arr as unknown as { toString: () => string }).toString = () => arr.join('\n')
      memories[Number(id)] = arr as string[] & { toString(): string }
    }

    const history = input.history.map(msg => ({
      author: msg.author,
      content: msg.content,
      entity_id: msg.role === 'assistant' ? (entities.find(e => e.name === msg.author)?.id ?? null) : null,
      author_id: '0',
      created_at: new Date().toISOString(),
      is_bot: msg.role === 'assistant',
      embeds: [],
      stickers: [],
      attachments: [],
      components: [],
    }))

    const char = entities[0] ?? { id: 0, name: 'Entity', facts: makeFactsArray(''), toString: () => 'Entity' }
    const user = others.find(o => o.name.toLowerCase() === 'user')
      ?? { id: 0, name: 'user', facts: makeFactsArray(''), toString: () => 'user' }

    const now = new Date()
    const hour = now.getHours()

    const respondingObjs = entities.map(e => ({ ...e, responding: true }))
    const otherObjs = others.map(e => ({ ...e, responding: false }))

    const ctx: Record<string, unknown> = {
      // Template-specific variables
      entities: [...respondingObjs, ...otherObjs],
      others: otherObjs,
      memories,
      entity_names: entities.map(e => e.name).join(', '),
      freeform: input.freeform,
      history,
      responders: Object.fromEntries(respondingObjs.map(e => [e.id, e])),
      char,
      user,
      _single_entity: entities.length === 1,
      // ExprContext variables (mirroring what the real bot provides)
      channel: { id: '1234567890', name: 'general', description: '', is_nsfw: false, type: 'text', mention: '<#1234567890>' },
      server: { id: '9876543210', name: 'My Server', description: '', nsfw_level: 'default' },
      name: char.name,
      chars: entities.map(e => e.name),
      group: entities.map(e => e.name).join(', '),
      mentioned: false,
      replied: false,
      is_forward: false,
      is_self: false,
      is_hologram: false,
      content: history.length > 0 ? history[history.length - 1].content : '',
      author: history.length > 0 ? history[history.length - 1].author : '',
      time: { hour, is_day: hour >= 6 && hour < 18, is_night: hour < 6 || hour >= 18 },
      self: {},
      response_ms: 0,
      idle_ms: 0,
      retry_ms: 0,
      unread_count: 0,
    }

    const source = input.template || DEFAULT_TEMPLATE
    const output = renderStructuredTemplate(source, ctx)
    return { output, error: null }
  } catch (err) {
    return {
      output: { messages: [] },
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export { DEFAULT_TEMPLATE }
