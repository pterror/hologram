/**
 * Monarch tokenizer for Hologram fact syntax (.holo files).
 * Translated from editors/vscode/syntaxes/hologram.tmLanguage.json.
 */
import type { languages } from 'monaco-editor'

export const hologramLanguage: languages.IMonarchLanguage = {
  defaultToken: '',
  ignoreCase: false,

  keywords: ['true', 'false'],

  directives: [
    '$respond', '$model', '$stream', '$context', '$strip',
    '$retry', '$avatar', '$freeform', '$locked', '$memory',
  ],

  operators: ['<=', '>=', '==', '!=', '||', '&&', '<', '>', '!'],

  functions: [
    'random', 'has_fact', 'roll', 'messages', 'duration',
    'mentioned_in_dialogue', 'date_str', 'time_str', 'isodate', 'isotime', 'weekday',
  ],

  contextObjects: ['self', 'channel', 'server', 'time'],

  macroConstants: [
    'char', 'user', 'date', 'time', 'weekday', 'isodate', 'isotime',
    'group', 'model', 'maxPrompt', 'idle_duration',
    'lastMessage', 'lastUserMessage', 'lastCharMessage',
    'charIfNotGroup', 'notChar', 'groupNotMuted',
    'newline', 'space', 'noop', 'trim',
  ],

  tokenizer: {
    root: [
      // Comments
      [/^\$#.*$/, 'comment'],

      // Conditional: $if expr: directive-or-fact
      [/^(\$if)\b/, { token: 'keyword.control', next: '@condition' }],

      // Directives at start of line
      [/^(\$respond)(?:\s+(true|false))?\s*$/, ['keyword.directive', 'constant.language']],
      [/^(\$model)\s+([a-zA-Z0-9_-]+:[a-zA-Z0-9._-]+)\s*$/, ['keyword.directive', 'type']],
      [/^(\$stream)\b/, { token: 'keyword.directive', next: '@streamArgs' }],
      [/^(\$context)\s+/, { token: 'keyword.directive', next: '@expression' }],
      [/^(\$strip)\b/, { token: 'keyword.directive', next: '@stripArgs' }],
      [/^(\$retry)\s+(\d+)\s*$/, ['keyword.directive', 'number']],
      [/^(\$avatar)\s+(\S+)\s*$/, ['keyword.directive', 'string.url']],
      [/^(\$(?:freeform|locked|memory))\b/, { token: 'keyword.directive', next: '@expression' }],

      // Macro: {{...}}
      [/\{\{/, { token: 'delimiter.macro', next: '@macro' }],

      // Key-value facts: key: value
      [/^([a-z_][a-z0-9_]*)(\s*:\s*)/, ['variable.property', 'delimiter', '@value']],

      // Default: plain fact text
      [/./, 'string'],
    ],

    condition: [
      [/:/, { token: 'delimiter', next: '@conditionBody' }],
      { include: '@expressionTokens' },
      [/$/, { token: '', next: '@pop' }],
    ],

    conditionBody: [
      [/(\$respond)(?:\s+(true|false))?\s*$/, ['keyword.directive', 'constant.language', '@pop']],
      [/(\$model)\s+([a-zA-Z0-9_-]+:[a-zA-Z0-9._-]+)\s*$/, ['keyword.directive', 'type', '@pop']],
      [/(\$stream)\b/, { token: 'keyword.directive', switchTo: '@streamArgs' }],
      [/(\$context)\s+/, { token: 'keyword.directive', switchTo: '@expression' }],
      [/(\$strip)\b/, { token: 'keyword.directive', switchTo: '@stripArgs' }],
      [/(\$retry)\s+(\d+)\s*$/, ['keyword.directive', 'number', '@pop']],
      [/(\$avatar)\s+(\S+)\s*$/, ['keyword.directive', 'string.url', '@pop']],
      [/(\$(?:freeform|locked|memory))\b/, { token: 'keyword.directive', switchTo: '@expression' }],
      [/\{\{/, { token: 'delimiter.macro', next: '@macro' }],
      [/./, 'string'],
      [/$/, { token: '', next: '@pop' }],
    ],

    streamArgs: [
      [/\b(full)\b/, 'keyword.other'],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/$/, { token: '', next: '@pop' }],
      [/\s+/, ''],
    ],

    stripArgs: [
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/$/, { token: '', next: '@pop' }],
      [/\s+/, ''],
    ],

    macro: [
      [/\}\}/, { token: 'delimiter.macro', next: '@pop' }],
      [/entity:\d+/, 'tag'],
      [/\b(?:char|user|date|time|weekday|isodate|isotime|group|model|maxPrompt|idle_duration|lastMessage|lastUserMessage|lastCharMessage|charIfNotGroup|notChar|groupNotMuted|newline|space|noop|trim)\b/, 'constant.macro'],
      [/(random|roll)(:)/, ['function', 'delimiter']],
      [/(self|channel|server|time)(\.)/, ['variable.object', 'delimiter']],
      [/[^}]+/, 'variable.macro'],
    ],

    value: [
      [/\{\{/, { token: 'delimiter.macro', next: '@macro' }],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/$/, { token: '', next: '@pop' }],
      [/./, 'string'],
    ],

    expression: [
      { include: '@expressionTokens' },
      [/$/, { token: '', next: '@pop' }],
    ],

    expressionTokens: [
      [/\{\{/, { token: 'delimiter.macro', next: '@macro' }],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/\b\d+(?:\.\d+)?[kK]?\b/, 'number'],
      [/\b(?:true|false)\b/, 'constant.language'],
      [/<=|>=|==|!=|\|\||&&|[<>!]/, 'operator'],
      [/\b(?:random|has_fact|roll|messages|duration|mentioned_in_dialogue|date_str|time_str|isodate|isotime|weekday)\s*(?=\()/, 'function'],
      [/\b(self|channel|server|time)(\.)/, ['variable.object', 'delimiter']],
      [/<\/?(?:defs|memories)\b[^>]*>/, 'tag'],
      [/[()]/, 'delimiter.parenthesis'],
      [/,/, 'delimiter'],
      [/\s+/, ''],
      [/[a-zA-Z_]\w*/, 'identifier'],
    ],
  },
}

export const hologramLanguageConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: '$#',
  },
  brackets: [
    ['{{', '}}'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{{', close: '}}' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
}
