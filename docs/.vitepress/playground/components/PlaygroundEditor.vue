<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, shallowRef } from 'vue'
import CopyButton from './CopyButton.vue'

const props = withDefaults(defineProps<{
  modelValue: string
  language?: string
  height?: string
}>(), {
  language: 'hologram',
  height: '300px',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const container = ref<HTMLElement | null>(null)
const editorInstance = shallowRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let observer: MutationObserver | null = null
let isSettingValue = false

function getTheme(): string {
  return document.documentElement.classList.contains('dark')
    ? 'hologram-dark'
    : 'hologram-light'
}

onMounted(async () => {
  // Import only Monaco core editor (skips built-in language contributions
  // like TypeScript, CSS, HTML, JSON to avoid bundling their large workers)
  const monaco = await import('monaco-editor/esm/vs/editor/editor.api.js')

  // Configure Monaco workers — only the base editor worker is needed
  self.MonacoEnvironment = {
    getWorker(_workerId: string, _label: string) {
      return new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
        { type: 'module' },
      )
    },
  }

  // Register custom languages and themes
  const { registerLanguages } = await import('../languages/register')
  registerLanguages(monaco as typeof import('monaco-editor'))

  if (!container.value) return

  const editor = monaco.editor.create(container.value, {
    value: props.modelValue,
    language: props.language,
    theme: getTheme(),
    minimap: { enabled: false },
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    fontSize: 13,
    fontFamily: 'var(--vp-font-family-mono), monospace',
    tabSize: 2,
    automaticLayout: true,
    padding: { top: 8, bottom: 8 },
    renderLineHighlight: 'none',
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
    },
  })

  editorInstance.value = editor

  // Emit debounced changes
  editor.onDidChangeModelContent(() => {
    if (isSettingValue) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      emit('update:modelValue', editor.getValue())
    }, 300)
  })

  // Watch for dark mode toggle
  observer = new MutationObserver(() => {
    monaco.editor.setTheme(getTheme())
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
})

// Sync external value changes into editor
watch(() => props.modelValue, (newVal) => {
  const editor = editorInstance.value
  if (editor && editor.getValue() !== newVal) {
    isSettingValue = true
    editor.setValue(newVal)
    isSettingValue = false
  }
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  observer?.disconnect()
  editorInstance.value?.dispose()
})
</script>

<template>
  <div class="playground-editor-wrap">
    <div ref="container" :style="{ height }" />
    <CopyButton class="copy-btn" :text="modelValue" />
  </div>
</template>
