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
      role: msg.role,
      author_id: '0',
      created_at: new Date().toISOString(),
      is_bot: msg.role === 'assistant',
      embeds: [],
      stickers: [],
      attachments: [],
    }))

    const char = entities[0] ?? { id: 0, name: 'Entity', facts: makeFactsArray(''), toString: () => 'Entity' }
    const user = others.find(o => o.name.toLowerCase() === 'user')
      ?? { id: 0, name: 'user', facts: makeFactsArray(''), toString: () => 'user' }

    const ctx: Record<string, unknown> = {
      entities,
      others,
      memories,
      entity_names: entities.map(e => e.name).join(', '),
      freeform: input.freeform,
      history,
      char,
      user,
      _single_entity: entities.length === 1,
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
