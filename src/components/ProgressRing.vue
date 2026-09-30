<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  progress: { type: Number, default: null },
  since: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  tone: { type: String, default: 'accent' },
})

const BOX = 20
const R = 9
const CIRCUMFERENCE = Number((2 * Math.PI * R).toFixed(2))
const MIN_ARC = 0.08
const FPS = 15

const left = ref(1)
let timer = 0

function stop() {
  if (timer) clearInterval(timer)
  timer = 0
}

watch(
  () => [props.since, props.total],
  () => {
    stop()
    if (!props.total || !props.since) return
    const tick = () => {
      const k = Math.min(1, Math.max(0, (Date.now() - props.since) / props.total))
      left.value = 1 - k
      if (k >= 1) stop()
    }
    tick()
    timer = setInterval(tick, Math.round(1000 / FPS))
  },
  { immediate: true }
)
onBeforeUnmount(stop)

const arc = () => {
  if (props.total && props.since) return Math.max(MIN_ARC, left.value)
  const p = props.progress
  if (p === null || !Number.isFinite(p)) return 0.25
  return Math.max(MIN_ARC, Math.min(1, p))
}
const spinning = () =>
  !(props.total && props.since) && (props.progress === null || !Number.isFinite(props.progress))
</script>

<template>
  <i class="toast-ring" :class="{ 'is-danger': tone === 'danger' }" aria-hidden="true">
    <svg :viewBox="`0 0 ${BOX} ${BOX}`" width="20" height="20">
      <circle class="toast-ring-bg" :cx="BOX / 2" :cy="BOX / 2" :r="R" />
      <circle
        class="toast-ring-fg"
        :class="{ spin: spinning() }"
        :cx="BOX / 2"
        :cy="BOX / 2"
        :r="R"
        stroke-linecap="round"
        :stroke-dasharray="`${CIRCUMFERENCE * arc()} ${CIRCUMFERENCE}`"
      />
    </svg>
  </i>
</template>

<style scoped>
.toast-ring {
  flex: none;
  width: 20px;
  height: 20px;
}
.toast-ring svg {
  display: block;
  transform: rotate(-90deg);
}
.toast-ring-bg {
  fill: none;
  stroke: var(--stroke-strong);
  stroke-width: 2;
}
.toast-ring-fg {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
}
.toast-ring.is-danger .toast-ring-fg {
  stroke: var(--danger);
}
.toast-ring-fg.spin {
  animation: toast-ring-spin 0.9s linear infinite;
  transform-origin: 50% 50%;
}
@keyframes toast-ring-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
