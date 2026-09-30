<script setup>
import { computed, ref, watch } from 'vue'
import { MapPin } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import NumberPad from './NumberPad.vue'
import { currentPos, measureCount, positionBeat, positionMeasure, player, seekToPosition, segmentPositionLabel, timeline } from '../store/player.js'
import { comparePosition } from '../domain/schema.js'
import { tempoAt } from '../domain/timeline.js'
import { dangerToast, toast } from '../store/toast.js'
import { t } from '../i18n/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'jump'])

const measure = ref(1)
const beat = ref(1)

watch(
  () => props.open,
  (v) => {
    if (v) {
      measure.value = currentPos.value.no || 1
      beat.value = Math.max(1, Math.floor(currentPos.value.beat || 1))
    }
  }
)

const beatsPerBar = computed(() => Math.max(1, Math.round(tempoAt(timeline.value.segments, measure.value || 1, 1).beatsPerBar || 4)))

const segments = computed(() =>
  (player.meta.segments || [])
    .filter((s) => s.head || (Number.isFinite(s.measure) && String(s.name || '').trim()))
    .sort(comparePosition)
)

function segmentLabel(seg) {
  const name = String(seg?.name || '').trim()
  if (name) return name
  return t('common.headSegment')
}

function close() {
  emit('update:open', false)
}

function jump() {
  if (!measureCount.value) {
    dangerToast(t('goto.noMeasures'))
    return
  }
  const no = Math.min(Math.max(1, Math.round(measure.value)), measureCount.value)
  const b = Math.min(Math.max(1, Math.round(beat.value)), beatsPerBar.value)
  seekToPosition(no, b - 1)
  emit('jump', no)
  close()
}

function jumpSegment(s) {
  seekToPosition(positionMeasure(s), positionBeat(s) - 1)
  emit('jump', positionMeasure(s))
  toast(t('goto.jumped', { name: segmentLabel(s) }))
  close()
}
</script>

<template>
  <AppSheet :open="open" :title="t('goto.title')" :icon="MapPin" position="bottom" follow-layout panel-key="goto" @close="close">
    <div class="go">
      <label class="field-label">{{ t('goto.byBeat') }}</label>
      <div class="row">
        <div class="fld">
          <NumberPad
            v-model="measure"
            :min="1"
            :max="measureCount || 1"
            :title="t('unit.measure')"
            :unit="t('unit.measure')"
            size="lg"
            class="wide"
            @confirm="jump"
          />
        </div>
        <div class="fld">
          <NumberPad
            v-model="beat"
            :min="1"
            :max="beatsPerBar"
            :title="t('unit.beat')"
            :unit="t('unit.beat')"
            size="lg"
            class="wide"
            @confirm="jump"
          />
        </div>
      </div>

      <template v-if="segments.length">
        <label class="field-label">{{ t('goto.bySegment') }}</label>
        <div class="seg-list">
          <button v-for="s in segments" :key="s.id" type="button" class="seg-item" @click="jumpSegment(s)">
            <span class="dot" />
            <span class="seg-name">{{ segmentLabel(s) }}</span>
            <span class="seg-pos mono">{{ segmentPositionLabel(s) }}</span>
            <span class="seg-bpm mono">{{ s.bpm }} BPM</span>
          </button>
        </div>
      </template>
    </div>
  </AppSheet>
</template>

<style scoped>
.go {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.row {
  display: flex;
  gap: 12px;
}
.fld {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.seg-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.seg-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  text-align: left;
}
@media (hover: hover) {
  .seg-item:hover {
    background: var(--surface-hover);
  }
}
.seg-item:active {
  background: var(--surface-active);
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}
.seg-name {
  flex: 1;
  font-size: 15px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seg-pos,
.seg-bpm {
  font-size: 12.5px;
  color: var(--text-muted);
}
</style>
