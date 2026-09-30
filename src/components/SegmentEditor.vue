<script setup>
import { computed, ref } from 'vue'
import { Flag } from '@lucide/vue'
import ContextMenu from './ContextMenu.vue'
import EditorPanel from './EditorPanel.vue'
import NumberPad from './NumberPad.vue'
import {
  activeSegment,
  measureCount,
  positionBeat,
  positionMeasure,
  removeSegment,
  updateSegment,
} from '../store/player.js'
import { toast } from '../store/toast.js'
import { t } from '../i18n/index.js'

const seg = computed(() => activeSegment.value)

function set(patch) {
  updateSegment(seg.value.id, patch)
}

const UNIT_OPTIONS = [1, 2, 4, 8, 16]
const unitOpen = ref(false)
const unitAnchor = ref(null)
const unitItems = computed(() =>
  UNIT_OPTIONS.map((u) => ({ key: u, label: t('segment.unit.note', { unit: u }), checked: seg.value?.beatUnit === u }))
)

function openUnit(e) {
  const r = e.currentTarget.getBoundingClientRect()
  unitAnchor.value = { left: r.left, bottom: r.bottom }
  unitOpen.value = true
}

function onUnitPick(u) {
  set({ beatUnit: Number(u) })
}

function del() {
  removeSegment(seg.value.id)
  toast(t('segment.deleted'))
}
</script>

<template>
  <EditorPanel
    drawer="segment"
    :icon="Flag"
    :title="t('segment.title')"
    :can-delete="!!seg && !seg.head"
    :delete-label="t('segment.deleteLabel')"
    @delete="del"
  >
    <template v-if="seg">
      <div>
        <label class="field-label">{{ t('segment.name.label') }}</label>
        <input
          class="text-input"
          type="text"
          :value="seg.name"
          :placeholder="t('segment.name.placeholder')"
          @input="set({ name: $event.target.value })"
        />
      </div>

      <div>
        <label class="field-label">{{ t('segment.bpm.label') }}</label>
        <NumberPad
          :model-value="seg.bpm"
          :decimals="1"
          :min="20"
          :max="400"
          :step="1"
          :title="t('segment.bpm.label')"
          :unit="t('unit.bpm')"
          :hint="t('segment.bpm.hint')"
          class="wide"
          @update:model-value="set({ bpm: $event })"
        />
      </div>

      <div>
        <label class="field-label">{{ t('segment.meter.label') }}</label>
        <div class="row">
          <div class="fld">
            <NumberPad
              :model-value="seg.beatsPerBar"
              :min="1"
              :max="32"
              :title="t('segment.meter.beatsTitle')"
              :hint="t('segment.meter.beatsHint')"
              class="wide"
              @update:model-value="set({ beatsPerBar: $event })"
            />
          </div>
          <span class="slash">/</span>
          <div class="fld">
            <button type="button" class="unit-btn" :title="t('segment.unit.title', { unit: seg.beatUnit })" @click="openUnit">
              <span class="unit-value mono">{{ seg.beatUnit }}</span>
            </button>
          </div>
        </div>
      </div>

      <div>
        <label class="field-label">{{ t('segment.position.label') }}</label>
        <div class="row">
          <div class="fld">
            <NumberPad
              :model-value="seg.head ? 1 : positionMeasure(seg)"
              :min="1"
              :max="Math.max(1, measureCount)"
              :disabled="!!seg.head"
              :title="t('unit.measure')"
              :unit="t('unit.measure')"
              class="wide"
              @update:model-value="set({ measure: $event })"
            />
          </div>
          <div class="fld">
            <NumberPad
              :model-value="seg.head ? 1 : positionBeat(seg)"
              :min="1"
              :max="seg.beatsPerBar || 4"
              :disabled="!!seg.head"
              :title="t('unit.beat')"
              :unit="t('unit.beat')"
              class="wide"
              @update:model-value="set({ beat: $event })"
            />
          </div>
        </div>
      </div>

      <ContextMenu
        :open="unitOpen"
        :items="unitItems"
        :anchor="unitAnchor"
        :title="t('segment.unit.menuTitle')"
        @select="onUnitPick"
        @close="unitOpen = false"
      />
    </template>
  </EditorPanel>
</template>

<style scoped>
.slash {
  font-size: 20px;
  color: var(--text-muted);
}
.unit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  min-height: var(--tap-min);
  padding: 0 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  border: 1px solid var(--stroke-strong);
  color: var(--text-strong);
  transition: border-color 0.15s ease, background 0.15s ease;
}
.unit-value {
  font-size: 16px;
  font-weight: 600;
}
@media (hover: hover) {
  .unit-btn:hover {
    background: var(--surface-hover);
    border-color: var(--accent-line);
  }
}
.unit-btn:active {
  background: var(--surface-active);
  border-color: var(--accent);
}
.fld {
  flex: 1;
  min-width: 0;
}
</style>
