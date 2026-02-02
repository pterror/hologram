/**
 * Registers Hologram languages and themes with Monaco editor.
 */
import type { editor, languages as monacoLanguages } from 'monaco-editor'
import { hologramLanguage, hologramLanguageConfig } from './hologram-monarch'
import { hologramTemplateLanguage, hologramTemplateLanguageConfig } from './hologram-template-monarch'

export function registerLanguages(monaco: typeof import('monaco-editor')) {
  // Register fact language
  monaco.languages.register({ id: 'hologram' })
  monaco.languages.setMonarchTokensProvider('hologram', hologramLanguage as monacoLanguages.IMonarchLanguage)
  monaco.languages.setLanguageConfiguration('hologram', hologramLanguageConfig)

  // Register template language
  monaco.languages.register({ id: 'hologram-template' })
  monaco.languages.setMonarchTokensProvider('hologram-template', hologramTemplateLanguage as monacoLanguages.IMonarchLanguage)
  monaco.languages.setLanguageConfiguration('hologram-template', hologramTemplateLanguageConfig)

  // Light theme
  monaco.editor.defineTheme('hologram-light', {
    base: 'vs',
    inherit: true,
    rules: [
      // Shared
      { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
      { token: 'string', foreground: '032f62' },
      { token: 'string.escape', foreground: '22863a' },
      { token: 'string.url', foreground: '0366d6' },
      { token: 'number', foreground: '005cc5' },
      { token: 'constant.language', foreground: '005cc5' },
      { token: 'keyword', foreground: 'd73a49' },
      { token: 'keyword.control', foreground: 'd73a49', fontStyle: 'bold' },
      { token: 'keyword.directive', foreground: 'd73a49', fontStyle: 'bold' },
      { token: 'keyword.operator', foreground: 'd73a49' },
      { token: 'keyword.other', foreground: '6f42c1' },
      { token: 'operator', foreground: 'd73a49' },
      { token: 'operator.pipe', foreground: 'd73a49' },
      { token: 'function', foreground: '6f42c1' },
      { token: 'function.filter', foreground: '6f42c1' },
      { token: 'function.macro', foreground: '6f42c1' },
      { token: 'variable.property', foreground: 'e36209' },
      { token: 'variable.object', foreground: '005cc5' },
      { token: 'variable.context', foreground: 'e36209' },
      { token: 'variable.macro', foreground: 'e36209' },
      { token: 'variable.loop', foreground: '005cc5' },
      { token: 'variable.loop.property', foreground: 'e36209' },
      { token: 'constant.macro', foreground: '005cc5' },
      { token: 'tag', foreground: '22863a' },
      { token: 'type', foreground: '6f42c1' },
      { token: 'identifier', foreground: '24292e' },
      { token: 'attribute.name', foreground: '6f42c1' },
      { token: 'delimiter', foreground: '24292e' },
      { token: 'delimiter.macro', foreground: 'd73a49' },
      { token: 'delimiter.expression', foreground: 'd73a49' },
      { token: 'delimiter.tag', foreground: 'd73a49' },
      { token: 'delimiter.tag.xml', foreground: '22863a' },
      { token: 'delimiter.parenthesis', foreground: '24292e' },
    ],
    colors: {},
  } as editor.IStandaloneThemeData)

  // Dark theme
  monaco.editor.defineTheme('hologram-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'string.escape', foreground: 'd7ba7d' },
      { token: 'string.url', foreground: '4fc1ff' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'constant.language', foreground: '569cd6' },
      { token: 'keyword', foreground: 'c586c0' },
      { token: 'keyword.control', foreground: 'c586c0', fontStyle: 'bold' },
      { token: 'keyword.directive', foreground: 'c586c0', fontStyle: 'bold' },
      { token: 'keyword.operator', foreground: 'c586c0' },
      { token: 'keyword.other', foreground: 'dcdcaa' },
      { token: 'operator', foreground: 'd4d4d4' },
      { token: 'operator.pipe', foreground: 'd4d4d4' },
      { token: 'function', foreground: 'dcdcaa' },
      { token: 'function.filter', foreground: 'dcdcaa' },
      { token: 'function.macro', foreground: 'dcdcaa' },
      { token: 'variable.property', foreground: '9cdcfe' },
      { token: 'variable.object', foreground: '4ec9b0' },
      { token: 'variable.context', foreground: '9cdcfe' },
      { token: 'variable.macro', foreground: '9cdcfe' },
      { token: 'variable.loop', foreground: '4ec9b0' },
      { token: 'variable.loop.property', foreground: '9cdcfe' },
      { token: 'constant.macro', foreground: '569cd6' },
      { token: 'tag', foreground: '4ec9b0' },
      { token: 'type', foreground: '4ec9b0' },
      { token: 'identifier', foreground: 'd4d4d4' },
      { token: 'attribute.name', foreground: '9cdcfe' },
      { token: 'delimiter', foreground: 'd4d4d4' },
      { token: 'delimiter.macro', foreground: 'c586c0' },
      { token: 'delimiter.expression', foreground: 'c586c0' },
      { token: 'delimiter.tag', foreground: 'c586c0' },
      { token: 'delimiter.tag.xml', foreground: '4ec9b0' },
      { token: 'delimiter.parenthesis', foreground: 'd4d4d4' },
    ],
    colors: {},
  } as editor.IStandaloneThemeData)
}
