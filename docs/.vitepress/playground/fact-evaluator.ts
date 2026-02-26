/**
 * Browser-safe wrapper around evaluateFacts + createBaseContext from src/logic/expr.ts.
 * Vite resolves the import via alias (src/ai/context → shim).
 */
import {
  evaluateFacts,
  createBaseContext,
  type EvaluatedFacts,
} from '../../../src/logic/expr'

export interface FactContextOverrides {
  mentioned?: boolean
  replied?: boolean
  is_forward?: boolean
  is_self?: boolean
  is_hologram?: boolean
  content?: string
  author?: string
  name?: string
  chars?: string[]
  response_ms?: number
  idle_ms?: number
  retry_ms?: number
  unread_count?: number
  channel_name?: string
  channel_is_nsfw?: boolean
  server_name?: string
}

export interface FactEvalResult {
  result: EvaluatedFacts
  error: string | null
}

export function evaluateFactsInBrowser(
  factsText: string,
  overrides: FactContextOverrides,
): FactEvalResult {
  const lines = factsText.split('\n').filter(l => l.trim() !== '')

  try {
    const ctx = createBaseContext({
      facts: lines,
      has_fact: (pattern: string) => {
        try {
          const regex = new RegExp(pattern, 'i')
          return lines.some(f => regex.test(f))
        } catch {
          return lines.some(f => f.toLowerCase().includes(pattern.toLowerCase()))
        }
      },
      messages: (n?: number, format?: string, _filter?: string) => {
        const content = overrides.content ?? 'Hello!'
        const author = overrides.author ?? 'User'
        const fmt = format ?? '%a: %m'
        return fmt.replace(/%a/g, author).replace(/%m/g, content)
      },
      response_ms: overrides.response_ms ?? 0,
      retry_ms: overrides.retry_ms ?? 0,
      idle_ms: overrides.idle_ms ?? 0,
      unread_count: overrides.unread_count ?? 0,
      mentioned: overrides.mentioned ?? false,
      replied: overrides.replied ?? false,
      replied_to: '',
      is_forward: overrides.is_forward ?? false,
      is_self: overrides.is_self ?? false,
      is_hologram: overrides.is_hologram ?? false,
      interaction_type: '',
      name: overrides.name ?? 'Entity',
      chars: overrides.chars ?? ['Entity'],
      channel: {
        id: '1234567890',
        name: overrides.channel_name ?? 'general',
        description: '',
        is_nsfw: overrides.channel_is_nsfw ?? false,
        type: 'text',
        mention: '<#1234567890>',
      },
      server: {
        id: '9876543210',
        name: overrides.server_name ?? 'My Server',
        description: '',
        nsfw_level: 'default',
      },
    })

    const result = evaluateFacts(lines, ctx)
    return { result, error: null }
  } catch (err) {
    return {
      result: {
        facts: [],
        shouldRespond: null,
        respondSource: null,
        retryMs: null,
        avatarUrl: null,
        isLocked: false,
        lockedFacts: new Set(),
        streamMode: null,
        streamDelimiter: null,
        memoryScope: 'none',
        contextExpr: null,
        isFreeform: false,
        modelSpec: null,
        stripPatterns: null,
        thinkingLevel: null,
      },
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export type { EvaluatedFacts }
