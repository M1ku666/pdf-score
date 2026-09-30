<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SwitchRow from './SwitchRow.vue'
import { duration, markDirty, pausePlayback, peaksRef, player, startPreview, stopPreview } from '../store/player.js'
import { readFontStack, readPalette } from '../store/ui.js'
import { t } from '../i18n/index.js'

const emit = defineEmits(['done'])

const MIN_TIME = -10
const SPAN = 5

const root = ref(null)
const canvas = ref(null)
const width = ref(0)
const centerTime = ref(0)
const dragging = ref(null)
const previewing = computed(() => player.previewing)
const palette = ref(readPalette())
const fontStack = readFontStack()

let ro = null
let ticker = 0

const total = computed(() => Math.max(0.1, duration.value || 0))
const pxPerSec = computed(() => (width.value || 1) / SPAN)

const clampCenter = (time) => Math.max(MIN_TIME, Math.min(total.value, time))

function measure() {
  const el = root.value
  if (el) width.value = el.clientWidth
}

function draw() {
  const cv = canvas.value
  if (!cv) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = Math.max(1, Math.floor(cv.clientWidth * dpr))
  const h = Math.max(1, Math.floor(cv.clientHeight * dpr))
  if (cv.width !== w || cv.height !== h) {
    cv.width = w
    cv.height = h
  }
  const ctx = cv.getContext('2d')
  const p = palette.value
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, w, h)

  const start = centerTime.value - SPAN / 2
  const mid = h / 2
  const peaks = peaksRef.value
  if (peaks?.length) {
    const perSec = player.peaksPerSecond || 150
    const n = peaks.length / 2
    ctx.globalAlpha = 0.7
    ctx.fillStyle = p.accent
    for (let i = 0; i < w; i++) {
      const t0 = start + (SPAN * i) / w
      const t1 = start + (SPAN * (i + 1)) / w
      if (t1 <= 0) continue
      const ia = Math.max(0, Math.floor(t0 * perSec))
      const ib = Math.max(ia + 1, Math.min(n, Math.ceil(t1 * perSec)))
      let mn = 1
      let mx = -1
      for (let k = ia; k < ib; k++) {
        const lo = peaks[k * 2]
        const hi = peaks[k * 2 + 1]
        if (lo < mn) mn = lo
        if (hi > mx) mx = hi
      }
      if (mn > mx) continue
      const y0 = mid - mx * mid * 0.9
      const y1 = mid - mn * mid * 0.9
      ctx.fillRect(i, y0, 1, Math.max(1, y1 - y0))
    }
    ctx.globalAlpha = 1
  } else {
    ctx.fillStyle = p.text
    ctx.font = `${13 * dpr}px ${fontStack}`
    ctx.textAlign = 'center'
    ctx.fillText(player.peaksLoading ? t('audio.generating') : t('audio.noData'), w / 2, mid)
  }

  const zeroX = ((0 - start) / SPAN) * w
  if (zeroX > 0 && zeroX < w) {
    ctx.strokeStyle = p.line
    ctx.lineWidth = dpr
    ctx.beginPath()
    ctx.moveTo(zeroX, 0)
    ctx.lineTo(zeroX, h)
    ctx.stroke()
  }

  ctx.fillStyle = p.text
  ctx.font = `${10 * dpr}px ${fontStack}`
  ctx.textAlign = 'center'
  const first = Math.ceil(start)
  for (let sec = first; sec <= start + SPAN; sec += 1) {
    const x = ((sec - start) / SPAN) * w
    ctx.fillRect(x, h - 6 * dpr, 1, 6 * dpr)
    ctx.fillText(`${sec}s`, x, h - 9 * dpr)
  }

  if (previewing.value) {
    const px = ((player.previewTime - start) / SPAN) * w
    if (px >= 0 && px <= w) {
      ctx.fillStyle = p.accent
      ctx.globalAlpha = 0.5
      ctx.fillRect(px - dpr, 0, 2 * dpr, h)
      ctx.globalAlpha = 1
    }
  }

  ctx.fillStyle = p.accent
  ctx.fillRect(w / 2 - dpr, 0, 2 * dpr, h)
  ctx.beginPath()
  ctx.moveTo(w / 2 - 5 * dpr, 0)
  ctx.lineTo(w / 2 + 5 * dpr, 0)
  ctx.lineTo(w / 2, 9 * dpr)
  ctx.closePath()
  ctx.fill()
}

function localX(e) {
  const r = root.value?.getBoundingClientRect()
  return r ? e.clientX - r.left : 0
}

function onDown(e) {
  dragging.value = { x: localX(e), center: centerTime.value }
  try {
    root.value?.setPointerCapture?.(e.pointerId)
  } catch {}
}

function onMove(e) {
  if (!dragging.value) return
  const dx = localX(e) - dragging.value.x
  centerTime.value = clampCenter(dragging.value.center - dx / pxPerSec.value)
  draw()
}

function onUp() {
  dragging.value = null
}

function onWheel(e) {
  e.preventDefault()
  const step = (e.shiftKey ? 0.5 : 0.1) * (e.deltaY > 0 ? 1 : -1)
  centerTime.value = clampCenter(centerTime.value + step)
  draw()
}

const startPosition = computed(() => {
  const n = Math.round(Number(player.meta.audio?.startPosition))
  return Number.isFinite(n) && n > 1 ? 2 : 1
})

function setPickup(on) {
  const next = on ? 2 : 1
  if (startPosition.value === next) return
  player.meta.audio = { ...player.meta.audio, startPosition: next }
  markDirty()
}

async function togglePreview() {
  if (previewing.value) {
    stopPreview()
    draw()
    return
  }
  await startPreview(centerTime.value)
  draw()
}

function tick() {
  ticker = requestAnimationFrame(tick)
  if (previewing.value) draw()
}

watch(centerTime, (value) => {
  const next = Number(value.toFixed(3))
  if (Number(player.meta.audio?.startOffset) === next) return
  player.meta.audio = { ...player.meta.audio, startOffset: next }
  markDirty()
})

function done() {
  stopPreview()
  emit('done')
}

defineExpose({ previewing, togglePreview, done })

const centerLabel = computed(() => {
  const sec = centerTime.value
  const sign = sec < 0 ? '-' : ''
  const abs = Math.abs(sec)
  return `${sign}${Math.floor(abs / 60)}:${(abs % 60).toFixed(2).padStart(5, '0')}`
})

onMounted(() => {
  pausePlayback()
  const cur = Number(player.meta.audio?.startOffset)
  centerTime.value = Number.isFinite(cur) ? clampCenter(cur) : 0
  measure()
  draw()
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.load(`13px ${fontStack}`).then(
      () => draw(),
      () => {},
    )
  }
  tick()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      measure()
      draw()
    })
    if (root.value) ro.observe(root.value)
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(ticker)
  ro?.disconnect()
  stopPreview()
})
</script>

<template>
  <div class="picker">
    <div
      ref="root"
      class="spec"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @wheel="onWheel"
    >
      <canvas ref="canvas" class="spec-canvas" />
    </div>

    <div class="mono center-val">{{ centerLabel }}</div>

    <SwitchRow :label="t('audio.pickup')" :checked="startPosition > 1" @change="setPickup($event)" />
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.spec {
  position: relative;
  width: 100%;
  height: 150px;
  background: var(--wave-bg);
  border: 1px solid var(--stroke-soft);
  border-radius: var(--radius-sm);
  overflow: hidden;
  touch-action: none;
  cursor: grab;
}
@media (hover: hover) {
  .spec:hover {
    border-color: var(--accent);
  }
}
.spec:active {
  cursor: grabbing;
}
.spec-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.center-val {
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-strong);
}
</style>
