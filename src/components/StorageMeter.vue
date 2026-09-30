<script setup>
import { Database } from '@lucide/vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  ratio: { type: Number, default: null },
})
defineEmits(['open'])

const BOX = 46
const WIDTH = 2.5
const R = BOX / 2 - WIDTH / 2
const CIRCUMFERENCE = 2 * Math.PI * R
const MIN_RATIO = 0.02

const shown = () => {
  const r = props.ratio
  if (r === null || !Number.isFinite(r)) return null
  return r <= 0 ? 0 : Math.max(MIN_RATIO, Math.min(1, r))
}
</script>

<template>
  <button type="button" class="meter-btn" :aria-label="t('library.storage.aria')" @click="$emit('open')">
    <svg v-if="shown() !== null" class="ring" :viewBox="`0 0 ${BOX} ${BOX}`" aria-hidden="true">
      <circle class="ring-track" :cx="BOX / 2" :cy="BOX / 2" :r="R" :stroke-width="WIDTH" />
      <circle
        v-if="shown() > 0"
        class="ring-fill"
        :cx="BOX / 2"
        :cy="BOX / 2"
        :r="R"
        :stroke-width="WIDTH"
        :stroke-dasharray="CIRCUMFERENCE"
        :stroke-dashoffset="CIRCUMFERENCE * (1 - shown())"
      />
    </svg>
    <Database :size="17" />
    <span class="label">{{ t('library.storage.button') }}</span>
  </button>
</template>


<style scoped>
.meter-btn {
  position: relative;
  flex: none;
  width: var(--tap);
  height: var(--tap);
  border-radius: 50%;
  background: var(--surface-control);
  color: var(--text-strong);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  transition: transform 0.08s ease, background 0.15s ease;
}
@media (hover: hover) {
  .meter-btn:hover {
    background: var(--surface-hover);
  }
}
.meter-btn:active {
  transform: scale(0.94);
  background: var(--surface-active);
}
.label {
  font-size: 11px;
  line-height: 1;
}
.no-labels .label {
  display: none;
}
.ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  transform: rotate(-90deg);
}
.ring-track {
  fill: none;
  stroke: var(--stroke-strong);
}
.ring-fill {
  fill: none;
  stroke: var(--accent);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.3s var(--ease);
}
</style>
