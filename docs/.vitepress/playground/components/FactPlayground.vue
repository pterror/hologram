<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import PlaygroundPresets from './PlaygroundPresets.vue'
import PlaygroundEditor from './PlaygroundEditor.vue'
import ContextEditor from './ContextEditor.vue'
import CopyButton from './CopyButton.vue'
import { factPresets, type FactPreset } from '../presets/fact-presets'
import { evaluateFactsInBrowser, type FactEvalResult } from '../fact-evaluator'

const presetIndex = ref(0)
const factsText = ref(factPresets[0].facts)
const context = ref({ ...factPresets[0].context })
const result = ref<FactEvalResult | null>(null)

function applyPreset(idx: number) {
  presetIndex.value = idx
  const preset = factPresets[idx]
  factsText.value = preset.facts
  context.value = { ...preset.context }
}

function evaluate() {
  const chars = context.value.chars
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  result.value = evaluateFactsInBrowser(factsText.value, {
    ...context.value,
    chars,
  })
}

// Re-evaluate on any change
watch([factsText, context], evaluate, { immediate: true, deep: true })

const directives = computed(() => {
  if (!result.value?.result) return []
  const r = result.value.result
  const items: Array<{ label: string; value: string; cls: string }> = []

  const respondStr = r.shouldRespond === null ? 'default (true)' : String(r.shouldRespond)
  items.push({
    label: '$respond',
    value: respondStr + (r.respondSource ? ` — from: ${r.respondSource}` : ''),
    cls: r.shouldRespond === false ? 'directive-false' : r.shouldRespond === null ? 'directive-null' : 'directive-true',
  })

  if (r.streamMode) {
    let streamStr = r.streamMode
    if (r.streamDelimiter) streamStr += ` (delimiters: ${r.streamDelimiter.map(d => JSON.stringify(d)).join(', ')})`
    items.push({ label: '$stream', value: streamStr, cls: 'directive-true' })
  }

  if (r.modelSpec) items.push({ label: '$model', value: r.modelSpec, cls: 'directive-true' })
  if (r.contextExpr) items.push({ label: '$context', value: r.contextExpr, cls: 'directive-true' })
  if (r.avatarUrl) items.push({ label: '$avatar', value: r.avatarUrl, cls: 'directive-true' })
  if (r.isFreeform) items.push({ label: '$freeform', value: 'true', cls: 'directive-true' })
  if (r.isLocked) items.push({ label: '$locked', value: 'true', cls: 'directive-true' })
  if (r.memoryScope !== 'none') items.push({ label: '$memory', value: r.memoryScope, cls: 'directive-true' })
  if (r.retryMs !== null) items.push({ label: '$retry', value: `${r.retryMs}ms`, cls: 'directive-true' })
  if (r.stripPatterns !== null) {
    const val = r.stripPatterns.length === 0 ? 'disabled' : r.stripPatterns.map(p => JSON.stringify(p)).join(', ')
    items.push({ label: '$strip', value: val, cls: 'directive-true' })
  }

  return items
})

const factsOutput = computed(() =>
  result.value?.result?.facts?.join('\n') ?? ''
)
</script>

<template>
  <div class="playground-container">
    <PlaygroundPresets
      :presets="factPresets"
      :model-value="presetIndex"
      @update:model-value="applyPreset"
    />

    <PlaygroundEditor
      v-model="factsText"
      language="hologram"
      height="250px"
    />

    <ContextEditor
      v-model="context"
    />

    <div v-if="result?.error" class="playground-error">
      {{ result.error }}
    </div>

    <div v-if="result?.result">
      <p class="playground-section-title">Surviving Facts</p>
      <div class="surviving-facts">
        <template v-if="result.result.facts.length > 0">{{ factsOutput }}</template>
      </div>
      <CopyButton v-if="factsOutput" :text="factsOutput" style="margin-top: 4px" />
    </div>

    <div v-if="directives.length > 0">
      <p class="playground-section-title">Directives</p>
      <table class="directives-table">
        <thead>
          <tr>
            <th>Directive</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in directives" :key="d.label">
            <td>{{ d.label }}</td>
            <td :class="d.cls">{{ d.value }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
