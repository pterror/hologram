/**
 * Monarch tokenizer for Hologram Nunjucks template syntax (.njk files).
 * Translated from editors/vscode/syntaxes/hologram-template.tmLanguage.json.
 */
import type { languages } from 'monaco-editor'

export const hologramTemplateLanguage: languages.IMonarchLanguage = {
  defaultToken: '',
  ignoreCase: false,

  tagKeywords: [
    'if', 'elif', 'else', 'endif', 'for', 'endfor',
    'block', 'endblock', 'extends', 'call', 'endcall',
    'macro', 'endmacro', 'set', 'raw', 'endraw',
  ],

  filters: [
    'default', 'length', 'join', 'first', 'last',
    'upper', 'lower', 'trim', 'nl2br', 'int', 'float',
    'abs', 'round', 'reverse', 'sort', 'batch',
  ],

  contextVariables: [
    'entities', 'others', 'memories', 'entity_names', 'freeform',
    'history', 'char', 'user', '_single_entity',
    'mentioned', 'replied', 'replied_to', 'is_forward', 'is_self',
    'content', 'author', 'interaction_type', 'name', 'chars',
    'group', 'response_ms', 'retry_ms', 'idle_ms',
  ],

  contextObjects: ['self', 'channel', 'server', 'time'],

  functions: [
    'random', 'has_fact', 'roll', 'messages', 'duration',
    'mentioned_in_dialogue', 'date_str', 'time_str', 'isodate', 'isotime', 'weekday',
    'send_as', 'caller',
  ],

  operatorWords: ['and', 'or', 'not', 'in', 'is'],

  tokenizer: {
    root: [
      // Comment blocks: {# ... #}
      [/\{#-?/, { token: 'comment', next: '@commentBlock' }],

      // Expression blocks: {{ ... }}
      [/\{\{-?/, { token: 'delimiter.expression', next: '@expressionBlock' }],

      // Tag blocks: {% ... %}
      [/\{%-?/, { token: 'delimiter.tag', next: '@tagBlock' }],

      // XML tags: <defs ...> </defs> <memories ...> </memories>
      [/(<)(\/?)(defs|memories)\b/, ['delimiter.tag.xml', 'delimiter.tag.xml', { token: 'tag', next: '@xmlTag' }]],

      // Plain text
      [/./, ''],
    ],

    commentBlock: [
      [/-?#\}/, { token: 'comment', next: '@pop' }],
      [/./, 'comment'],
      [/\n/, 'comment'],
    ],

    expressionBlock: [
      [/-?\}\}/, { token: 'delimiter.expression', next: '@pop' }],
      { include: '@expressionTokens' },
    ],

    tagBlock: [
      [/-?%\}/, { token: 'delimiter.tag', next: '@pop' }],
      [/\b(?:if|elif|else|endif|for|endfor|block|endblock|extends|call|endcall|macro|endmacro|set|raw|endraw)\b/, 'keyword'],
      { include: '@expressionTokens' },
    ],

    xmlTag: [
      [/>/, { token: 'delimiter.tag.xml', next: '@pop' }],
      [/\b([a-zA-Z_][a-zA-Z0-9_-]*)(=)("[^"]*"|'[^']*')/, ['attribute.name', 'delimiter', 'string']],
      [/\s+/, ''],
    ],

    expressionTokens: [
      // Strings
      [/"/, { token: 'string', next: '@stringDouble' }],
      [/'/, { token: 'string', next: '@stringSingle' }],

      // Numbers
      [/\b\d+(?:\.\d+)?\b/, 'number'],

      // Booleans / null
      [/\b(?:true|false|none|null)\b/, 'constant.language'],

      // Word operators
      [/\b(?:and|or|not|in|is)\b/, 'keyword.operator'],

      // Symbol operators
      [/<=|>=|==|!=|\|\||&&|\*\*|\/\/|[<>!~+\-*/%]/, 'operator'],

      // Filters
      [/(\|)\s*(default|length|join|first|last|upper|lower|trim|nl2br|int|float|abs|round|reverse|sort|batch)\b/, ['operator.pipe', 'function.filter']],

      // Functions
      [/\b(?:random|has_fact|roll|messages|duration|mentioned_in_dialogue|date_str|time_str|isodate|isotime|weekday|send_as|caller)\s*(?=\()/, 'function'],

      // Loop variables
      [/\b(loop)\.(index|index0|first|last|length|revindex|revindex0)\b/, ['variable.loop', 'variable.loop.property']],

      // Context objects (before dot)
      [/\b(?:self|channel|server|time)(?=\.)/, 'variable.object'],

      // Context variables
      [/\b(?:entities|others|memories|entity_names|freeform|history|char|user|_single_entity|mentioned|replied|replied_to|is_forward|is_self|content|author|interaction_type|name|chars|group|response_ms|retry_ms|idle_ms)\b/, 'variable.context'],

      // send_as (not followed by parens)
      [/\bsend_as\b(?!\s*\()/, 'function.macro'],

      // Property access
      [/(\.)([a-zA-Z_][a-zA-Z0-9_]*)/, ['delimiter', 'variable.property']],

      // Delimiters
      [/[()]/, 'delimiter.parenthesis'],
      [/,/, 'delimiter'],
      [/\s+/, ''],
      [/[a-zA-Z_]\w*/, 'identifier'],
    ],

    stringDouble: [
      [/\\[nrt\\"']/, 'string.escape'],
      [/"/, { token: 'string', next: '@pop' }],
      [/./, 'string'],
    ],

    stringSingle: [
      [/\\[nrt\\"']/, 'string.escape'],
      [/'/, { token: 'string', next: '@pop' }],
      [/./, 'string'],
    ],
  },
}

export const hologramTemplateLanguageConfig: languages.LanguageConfiguration = {
  comments: {
    blockComment: ['{#', '#}'],
  },
  brackets: [
    ['{{', '}}'],
    ['{%', '%}'],
    ['{#', '#}'],
    ['(', ')'],
    ['<', '>'],
  ],
  autoClosingPairs: [
    { open: '{{', close: '}}' },
    { open: '{%', close: '%}' },
    { open: '{#', close: '#}' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '<', close: '>' },
  ],
  surroundingPairs: [
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '(', close: ')' },
  ],
}
