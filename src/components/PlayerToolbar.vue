<script setup>
import { computed, ref, watch } from 'vue'
import { Check, ChevronLeft, SquareArrowRightEnter, Gauge, MapPin, Pause, PencilLine, Play, RotateCcw, Trash, Volume2 } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import AudioOffsetPicker from './AudioOffsetPicker.vue'
import MarksPanel from './MarksPanel.vue'
import NumberPad from './NumberPad.vue'
import { t } from '../i18n/index.js'
import { EDIT_TOOLS, drawerOpen } from '../store/ui.js'
import { settings } from '../store/settings.js'
import {
  RATE_MAX,
  RATE_MIN,
  applyCustomRate,
  applyRate,
  applyVolume,
  canPlay,
  clearRateHistory,
  currentPos,
  finishEdit,
  importAudio,
  player,
  setCueVolume,
  setMetronomeVolume,
  stopPreview,
  togglePlay,
} from '../store/player.js'

const emit = defineEmits(['goto', 'locate'])
const props = defineProps({
  offsetRequest: { type: Number, default: 0 },
  marksOpen: { type: Boolean, default: false },
})

const RATES = [
  { value: 0.5, label: '0.5×' },
  { value: 0.75, label: '0.75×' },
  { value: 0.9, label: '0.9×' },
  { value: 1, label: '1.0×' },
]

function rateLabel(r) {
  return `${Number.isInteger(r) ? r.toFixed(1) : String(r)}×`
}

const RATE_STEP = 0.05

const rateOpen = ref(false)
const audioOpen = ref(false)
const picking = ref(false)
const audioInput = ref(null)
const picker = ref(null)

watch(
  () => props.offsetRequest,
  (n) => {
    if (!n) return
    picking.value = true
    audioOpen.value = true
  }
)

async function onAudioPicked(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (file) await importAudio(file)
}

function closeAudioSheet() {
  stopPreview()
  picking.value = false
  audioOpen.value = false
}

const POS_MAX = 999
const pos = computed(() => {
  const p = currentPos.value
  if (!p.no) return { whole: t('common.noValue') }
  return {
    whole: '',
    head: String(Math.min(p.no, POS_MAX)),
    sub: String(Math.max(1, Math.floor(p.beat))),
  }
})
const rate = computed(() => {
  const r = player.rate
  const text = `${Number.isInteger(r) ? r.toFixed(1) : String(r)}×`
  const dot = text.indexOf('.')
  if (dot < 0) return { whole: text }
  return { whole: '', head: text.slice(0, dot), sub: text.slice(dot + 1) }
})
const volumePct = computed(() => Math.round((player.volume || 0) * 100))
const metronomePct = computed(() => Math.round((player.metronomeVolume || 0) * 100))
const cuePct = computed(() => Math.round((player.cueVolume || 0) * 100))

const playTitle = computed(() => (canPlay.value ? '' : t('toolbar.nothingToPlay')))

function setTool(key) {
  const marksShown = props.marksOpen && drawerOpen.value
  if (player.tool === key) {
    emit('marks', !marksShown)
    return
  }
  if (marksShown) emit('marks', false)
  player.tool = key
}
</script>

<template>
  <div class="dock-row" :class="{ 'no-labels': !settings.showButtonLabels }">
    <div class="capsule glass" :class="player.editMode ? 'cap-w1' : 'cap-w4'">
      <button v-if="player.editMode" type="button" class="cap-btn" :aria-label="t('toolbar.doneAria')" @click="finishEdit">
        <Check :size="21" />
        <span class="cap-label">{{ t('common.done') }}</span>
      </button>

      <template v-else>
        <button
          type="button"
          class="cap-btn primary play"
          :class="{ off: !canPlay }"
          :disabled="!canPlay"
          :title="playTitle"
          :aria-label="player.playing ? t('toolbar.pause') : t('toolbar.play')"
          @click="togglePlay"
        >
          <component :is="player.playing ? Pause : Play" :size="21" />
          <span class="cap-label">{{ player.playing ? t('toolbar.pause') : t('toolbar.play') }}</span>
        </button>

        <button type="button" class="cap-btn" @click="emit('goto')">
          <span v-if="pos.whole" class="cap-value">{{ pos.whole }}</span>
          <span v-else class="cap-value split"
            ><span>{{ pos.head }}</span><span class="point">.</span><span class="sub">{{ pos.sub }}</span></span
          >
          <span class="cap-label">{{ t('toolbar.goto') }}</span>
        </button>

        <button type="button" class="cap-btn" @click="rateOpen = true">
          <span v-if="rate.whole" class="cap-value">{{ rate.whole }}</span>
          <span v-else class="cap-value split"
            ><span>{{ rate.head }}</span><span class="point">.</span><span class="sub">{{ rate.sub }}</span></span
          >
          <span class="cap-label">{{ t('toolbar.rate') }}</span>
        </button>

        <button type="button" class="cap-btn" @click="audioOpen = true">
          <Volume2 :size="21" />
          <span class="cap-label">{{ t('toolbar.audio') }}</span>
        </button>
      </template>
    </div>

    <div class="capsule glass" :class="player.editMode ? 'cap-w4' : 'cap-w1'">
      <template v-if="player.editMode">
        <button
          v-for="tool in EDIT_TOOLS"
          :key="tool.key"
          type="button"
          class="cap-btn edit-tool"
          :class="{ on: player.tool === tool.key }"
          @click="setTool(tool.key)"
        >
          <component :is="tool.icon" :size="21" />
          <span class="cap-label">{{ t(tool.labelKey) }}</span>
        </button>
      </template>

      <button v-else type="button" class="cap-btn" :aria-label="t('toolbar.editAria')" @click="player.editMode = true">
        <PencilLine :size="21" />
        <span class="cap-label">{{ t('toolbar.edit') }}</span>
      </button>
    </div>

    <MarksPanel :open="marksOpen" @close="emit('marks', false)" @locate="emit('locate', $event)" />

    <AppSheet :open="rateOpen" :title="t('toolbar.rateTitle')" :icon="Gauge" position="bottom" compact follow-layout panel-key="rate" @close="rateOpen = false">
      <div class="rate">
        <div>
          <label class="field-label">{{ t('toolbar.ratePanel.presets') }}</label>
          <div class="opt-list">
            <button
              v-for="r in RATES"
              :key="r.value"
              type="button"
              class="opt"
              :class="{ on: player.rate === r.value }"
              @click="applyRate(r.value); rateOpen = false"
            >
              <span class="spacer">{{ r.label }}</span>
              <Check v-if="player.rate === r.value" :size="19" class="tick" />
            </button>
          </div>
        </div>

        <div v-if="player.rateHistory.length">
          <label class="field-label">{{ t('toolbar.ratePanel.history') }}</label>
          <div class="opt-list">
            <button
              v-for="r in player.rateHistory"
              :key="r"
              type="button"
              class="opt"
              :class="{ on: player.rate === r }"
              @click="applyRate(r); rateOpen = false"
            >
              <span class="spacer">{{ rateLabel(r) }}</span>
              <Check v-if="player.rate === r" :size="19" class="tick" />
            </button>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="rate-foot">
          <label class="field-label">{{ t('toolbar.ratePanel.custom') }}</label>
          <NumberPad
            class="wide"
            :model-value="player.rate"
            :decimals="2"
            :min="RATE_MIN"
            :max="RATE_MAX"
            :step="RATE_STEP"
            :title="t('toolbar.rateTitle')"
            :unit="t('unit.rate')"
            @update:model-value="applyCustomRate"
            @confirm="rateOpen = false"
          />
          <button v-if="player.rateHistory.length" type="button" class="btn clear-history" @click="clearRateHistory">
            <Trash :size="18" /> {{ t('toolbar.ratePanel.clearHistory') }}
          </button>
        </div>
      </template>
    </AppSheet>

    <AppSheet
      :open="audioOpen"
      :title="picking ? t('toolbar.audioPanel.offsetTitle') : t('toolbar.audio')"
      :icon="picking ? MapPin : Volume2"
      position="bottom"
      follow-layout
      panel-key="audio"
      @close="closeAudioSheet"
    >
      <AudioOffsetPicker v-if="picking && player.hasAudio" ref="picker" @done="picking = false" />

      <div v-else class="audio">
        <div v-if="player.hasAudio" class="audio-row">
          <div class="audio-label">
            <span>{{ t('toolbar.audioPanel.musicVolume') }}</span>
            <span class="mono pct">{{ volumePct }}%</span>
          </div>
          <input
            class="slider"
            type="range"
            min="0"
            max="100"
            :aria-label="t('toolbar.audioPanel.musicVolume')"
            :value="volumePct"
            :style="{ '--fill': volumePct + '%' }"
            @input="applyVolume($event.target.value / 100)"
          />
        </div>

        <div class="audio-row">
          <div class="audio-label">
            <span>{{ t('toolbar.audioPanel.metronomeVolume') }}</span>
            <span class="mono pct">{{ metronomePct }}%</span>
          </div>
          <input
            class="slider"
            type="range"
            min="0"
            max="100"
            :aria-label="t('toolbar.audioPanel.metronomeVolume')"
            :value="metronomePct"
            :style="{ '--fill': metronomePct + '%' }"
            @input="setMetronomeVolume($event.target.value / 100)"
          />
        </div>
        <div class="audio-row">
          <div class="audio-label">
            <span>{{ t('toolbar.audioPanel.cueVolume') }}</span>
            <span class="mono pct">{{ cuePct }}%</span>
          </div>
          <input
            class="slider"
            type="range"
            min="0"
            max="100"
            :aria-label="t('toolbar.audioPanel.cueVolume')"
            :value="cuePct"
            :style="{ '--fill': cuePct + '%' }"
            @input="setCueVolume($event.target.value / 100)"
          />
        </div>
      </div>
      <input ref="audioInput" type="file" accept="audio/*" class="hidden-file" @change="onAudioPicked" />

      <template #footer>
        <template v-if="picking && player.hasAudio">
          <button type="button" class="btn" @click="picker?.togglePreview()">
            <component :is="picker?.previewing ? Pause : Play" :size="18" />
            {{ picker?.previewing ? t('audio.stopPreview') : t('audio.preview') }}
          </button>
          <button type="button" class="btn" @click="picker?.done()">
            <ChevronLeft :size="18" /> {{ t('audio.backToSettings') }}
          </button>
        </template>
        <template v-else>
          <button v-if="!player.hasAudio" type="button" class="btn primary" @click="audioInput.click()">
            <SquareArrowRightEnter :size="18" /> {{ t('toolbar.audioPanel.import') }}
          </button>
          <template v-if="player.hasAudio">
            <button type="button" class="btn" @click="audioInput.click()">
              <RotateCcw :size="18" /> {{ t('toolbar.audioPanel.replace') }}
            </button>
            <button type="button" class="btn" @click="picking = true">
              <MapPin :size="18" /> {{ t('toolbar.audioPanel.setStart') }}
            </button>
          </template>
        </template>
      </template>
    </AppSheet>
  </div>
</template>

<style scoped>
.dock-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}
.dock-row .capsule {
  flex: 0 1 auto;
  max-width: 100%;
  transition: width 0.22s var(--ease);
}
.dock-row .capsule.glass {
  box-shadow: var(--shadow-2-up);
}
.cap-w1 {
  width: calc(var(--tap) + 2 * var(--cap-pad) + 2px);
}
.cap-w4 {
  width: calc(4 * var(--tap) + 3 * var(--cap-gap) + 2 * var(--cap-pad) + 2px);
}

.cap-btn.off {
  background: var(--surface-control);
  color: var(--accent);
}

.cap-btn.play > .lucide {
  fill: currentColor;
  stroke: none;
}
@media (hover: hover) {
  .cap-btn.off:hover {
    background: var(--accent-weak);
    color: var(--accent);
  }
}
.cap-btn.off:active {
  background: var(--accent-mid);
  color: var(--accent);
}

.rate {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.rate-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.rate-foot .field-label {
  margin-bottom: 0;
}
.rate-foot .clear-history {
  align-self: stretch;
}
:deep(.sheet-foot) {
  padding: 16px 18px calc(12px + var(--safe-b));
}

.audio {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.hidden-file {
  display: none;
}
.audio-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.audio-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-soft);
}
.audio-label .pct {
  margin-left: auto;
  color: var(--text-strong);
}
.slider {
  align-self: stretch;
  height: var(--tap-min);
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  border-radius: 999px;
  --track: 6px;
  padding: 0 10px;
  transition: background-color 0.12s var(--ease);
}
.slider::-webkit-slider-runnable-track {
  height: var(--track);
  border-radius: 999px;
  background-color: var(--surface-sunken);
  background-image: linear-gradient(
    to right,
    var(--accent) 0,
    var(--accent) var(--fill, 0%),
    var(--surface-sunken) var(--fill, 0%),
    var(--surface-sunken) 100%
  );
  background-size: 100% 100%;
  background-position: 0 center;
  background-repeat: no-repeat;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 24px;
  height: 16px;
  margin-top: -5px;
  border: 1px solid #d7dade;
  border-radius: 999px;
  background: #fff;
  box-shadow: var(--shadow-1);
}
.slider::-moz-range-track {
  height: var(--track);
  border-radius: 999px;
  background-color: var(--surface-sunken);
  background-image: linear-gradient(
    to right,
    var(--accent) 0,
    var(--accent) var(--fill, 0%),
    var(--surface-sunken) var(--fill, 0%),
    var(--surface-sunken) 100%
  );
  background-size: 100% 100%;
  background-position: 0 center;
  background-repeat: no-repeat;
}
.slider::-moz-range-progress {
  background: transparent;
  height: var(--track);
  border-radius: 999px;
}
.slider::-moz-range-thumb {
  width: 24px;
  height: 16px;
  border: 1px solid #d7dade;
  border-radius: 999px;
  background: #fff;
  box-shadow: var(--shadow-1);
}
@media (hover: hover) {
  .slider:hover {
    background: var(--surface-hover);
  }
}
.slider:active {
  background: var(--surface-active);
}
.slider:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-line);
}
</style>
