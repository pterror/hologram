<script setup lang="ts">
import { ref, watch, reactive } from 'vue'
import PlaygroundPresets from './PlaygroundPresets.vue'
import PlaygroundEditor from './PlaygroundEditor.vue'
import PlaygroundOutput from './PlaygroundOutput.vue'
import CopyButton from './CopyButton.vue'
import { templatePresets, type TemplatePreset } from '../presets/template-presets'
import { evaluateTemplate, type TemplateEvalResult, type PlaygroundEntity, type PlaygroundHistoryMessage } from '../template-evaluator'

const presetIndex = ref(0)
const templateText = ref(templatePresets[0].template)
const entities = ref<PlaygroundEntity[]>(JSON.parse(JSON.stringify(templatePresets[0].entities)))
const others = ref<PlaygroundEntity[]>(JSON.parse(JSON.stringify(templatePresets[0].others)))
const memories = ref<Record<number, string[]>>(JSON.parse(JSON.stringify(templatePresets[0].memories)))
const history = ref<PlaygroundHistoryMessage[]>(JSON.parse(JSON.stringify(templatePresets[0].history)))
const freeform = ref(templatePresets[0].freeform)
const result = ref<TemplateEvalResult | null>(null)
const memoriesText = ref('')

function applyPreset(idx: number) {
  presetIndex.value = idx
  const preset = templatePresets[idx]
  templateText.value = preset.template
  entities.value = JSON.parse(JSON.stringify(preset.entities))
  others.value = JSON.parse(JSON.stringify(preset.others))
  memories.value = JSON.parse(JSON.stringify(preset.memories))
  history.value = JSON.parse(JSON.stringify(preset.history))
  freeform.value = preset.freeform
  syncMemoriesText()
}

function syncMemoriesText() {
  const lines: string[] = []
  for (const [id, mems] of Object.entries(memories.value)) {
    const entity = entities.value.find(e => e.id === Number(id))
    const name = entity?.name ?? `Entity ${id}`
    lines.push(`# ${name} (id: ${id})`)
    for (const m of mems) lines.push(m)
    lines.push('')
  }
  memoriesText.value = lines.join('\n').trim()
}

function parseMemoriesText(text: string) {
  const result: Record<number, string[]> = {}
  let currentId: number | null = null
  for (const line of text.split('\n')) {
    const headerMatch = line.match(/^#\s*.+?\(id:\s*(\d+)\)/)
    if (headerMatch) {
      currentId = parseInt(headerMatch[1], 10)
      result[currentId] = []
    } else if (currentId !== null && line.trim()) {
      result[currentId].push(line.trim())
    }
  }
  memories.value = result
}

syncMemoriesText()

function evaluate() {
  result.value = evaluateTemplate({
    template: templateText.value,
    entities: entities.value,
    others: others.value,
    memories: memories.value,
    history: history.value,
    freeform: freeform.value,
  })
}

watch([templateText, entities, others, memories, history, freeform], evaluate, { immediate: true, deep: true })

function addHistoryMessage() {
  history.value.push({ author: 'User', content: '', role: 'user' })
}

function removeHistoryMessage(idx: number) {
  history.value.splice(idx, 1)
}
</script>

<template>
  <div class="playground-container">
    <PlaygroundPresets
      :presets="templatePresets"
      :model-value="presetIndex"
      @update:model-value="applyPreset"
    />

    <div class="playground-split">
      <div class="playground-panel">
        <h3>Template</h3>
        <PlaygroundEditor
          v-model="templateText"
          language="hologram-template"
          height="350px"
        />
      </div>

      <div class="playground-panel">
        <h3>Entities</h3>
        <div class="entity-editor">
          <div
            v-for="(entity, i) in entities"
            :key="'e-' + i"
            class="entity-editor-item"
          >
            <label>{{ entity.name }} (id: {{ entity.id }}) — responding</label>
            <input
              type="text"
              :value="entity.name"
              placeholder="Name"
              @input="entity.name = ($event.target as HTMLInputElement).value"
            />
            <textarea
              :value="entity.factsText"
              placeholder="Facts (one per line)"
              @input="entity.factsText = ($event.target as HTMLTextAreaElement).value"
            />
          </div>
          <div
            v-for="(entity, i) in others"
            :key="'o-' + i"
            class="entity-editor-item"
          >
            <label>{{ entity.name }} (id: {{ entity.id }}) — other</label>
            <input
              type="text"
              :value="entity.name"
              placeholder="Name"
              @input="entity.name = ($event.target as HTMLInputElement).value"
            />
            <textarea
              :value="entity.factsText"
              placeholder="Facts (one per line)"
              @input="entity.factsText = ($event.target as HTMLTextAreaElement).value"
            />
          </div>
        </div>

        <div v-if="memoriesText || Object.keys(memories).length > 0">
          <h3>Memories</h3>
          <div class="entity-editor-item">
            <label>Format: # Name (id: N) followed by memory lines</label>
            <textarea
              :value="memoriesText"
              rows="4"
              @input="parseMemoriesText(($event.target as HTMLTextAreaElement).value); memoriesText = ($event.target as HTMLTextAreaElement).value"
            />
          </div>
        </div>

        <h3>History</h3>
        <div class="entity-editor">
          <div
            v-for="(msg, i) in history"
            :key="'h-' + i"
            class="entity-editor-item"
            style="display: flex; gap: 6px; align-items: start; flex-wrap: wrap;"
          >
            <select
              :value="msg.role"
              style="padding: 4px; border: 1px solid var(--vp-c-divider); border-radius: 4px; background: var(--vp-c-bg); color: var(--vp-c-text-1); font-size: 12px;"
              @change="msg.role = ($event.target as HTMLSelectElement).value as 'user' | 'assistant'"
            >
              <option value="user">user</option>
              <option value="assistant">assistant</option>
            </select>
            <input
              type="text"
              :value="msg.author"
              placeholder="Author"
              style="width: 80px;"
              @input="msg.author = ($event.target as HTMLInputElement).value"
            />
            <input
              type="text"
              :value="msg.content"
              placeholder="Content"
              style="flex: 1; min-width: 120px;"
              @input="msg.content = ($event.target as HTMLInputElement).value"
            />
            <button
              class="copy-btn"
              style="color: var(--vp-c-danger-1);"
              @click="removeHistoryMessage(i)"
            >
              x
            </button>
          </div>
          <button class="copy-btn" @click="addHistoryMessage">+ Add message</button>
        </div>

        <div class="context-field context-field-toggle" style="margin-top: 8px;">
          <input type="checkbox" v-model="freeform" />
          <label style="font-size: 13px; font-weight: 500; color: var(--vp-c-text-2);">freeform</label>
        </div>
      </div>
    </div>

    <div v-if="result?.error" class="playground-error">
      {{ result.error }}
    </div>

    <PlaygroundOutput
      v-if="result?.output?.messages"
      :messages="result.output.messages"
    />
  </div>
</template>
