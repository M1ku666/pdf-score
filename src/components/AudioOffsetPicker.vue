<script setup>
/**
 * 音频起点选择器：固定 5 秒视野的频谱图，不能缩放，只能左右拖动 / 滚轮微调。
 * 屏幕正中间那条竖线就是要设定的音频起点，改动**即时**写进 meta.audio.startOffset（没有保存按钮），
 * 值没变就不写。允许设到音频开始之前最多 10 秒（负数 = 第一小节在音频开始前就开始数）。
 * 可以就地试听：从中心位置播放，停止时播放头回到试听前的位置。
 * 它不是一个独立浮层：由「音频」浮层（`PlayerToolbar`）把内容整体换成它，底部只有「返回音频设置」。
 * **动作按钮一行一个**（docs/ui.md §13）：试听独自占满整行，再下面才是「返回音频设置」。
 * 起点数值**只用文字色**（不用主题色），也**没有左右微调箭头** —— 拖动与滚轮就是全部微调手段。
 * 「添加弱起小节」开关改的是 `meta.audio.startPosition`（也是即时写）：
 * 关 = 第 1 小节对齐起点，开 = 第 2 小节对齐起点、第 1 小节（弱起）落在起点之前
 * （时间轴那头的语义见 `domain/timeline.js` 的 `startMeasure`）。开关本体走 `SwitchRow`。
 * 频谱与中心线都用 canvas 画，配色走 `readPalette()`，系统主题切换时要重绘。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import SwitchRow from './SwitchRow.vue'
import { duration, engine, markDirty, peaksRef, player } from '../store/player.js'
import { readPalette } from '../store/ui.js'
import { t } from '../i18n/index.js'

const emit = defineEmits(['done'])

const MIN_TIME = -10 // 允许音频开始前 10 秒
const SPAN = 5 // 视野固定 5 秒

const root = ref(null)
const canvas = ref(null)
const width = ref(0)
const centerTime = ref(0)
const dragging = ref(null)
const previewing = ref(false)
const palette = ref(readPalette())

let restoreTime = 0
let ro = null
let ticker = 0

const total = computed(() => Math.max(0.1, duration.value || 0))
const pxPerSec = computed(() => (width.value || 1) / SPAN)

// 注意：这里的局部时间变量不能叫 `t` —— 会遮住 i18n 的翻译函数
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
      if (t1 <= 0) continue // 音频开始之前留空
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
    ctx.font = `${13 * dpr}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(player.peaksLoading ? t('audio.generating') : t('audio.noData'), w / 2, mid)
  }

  // 0 秒位置
  const zeroX = ((0 - start) / SPAN) * w
  if (zeroX > 0 && zeroX < w) {
    ctx.strokeStyle = p.line
    ctx.lineWidth = dpr
    ctx.beginPath()
    ctx.moveTo(zeroX, 0)
    ctx.lineTo(zeroX, h)
    ctx.stroke()
  }

  // 秒刻度（每 0.5 秒）
  ctx.fillStyle = p.text
  ctx.font = `${10 * dpr}px ui-monospace, monospace`
  ctx.textAlign = 'center'
  const step = 0.5
  const first = Math.ceil(start / step) * step
  for (let sec = first; sec <= start + SPAN; sec += step) {
    const x = ((sec - start) / SPAN) * w
    ctx.fillRect(x, h - 6 * dpr, 1, 6 * dpr)
    ctx.fillText(`${sec.toFixed(1)}s`, x, h - 9 * dpr)
  }

  // 试听播放头
  if (previewing.value) {
    const px = ((player.currentTime - start) / SPAN) * w
    if (px >= 0 && px <= w) {
      ctx.fillStyle = p.accent
      ctx.globalAlpha = 0.5
      ctx.fillRect(px - dpr, 0, 2 * dpr, h)
      ctx.globalAlpha = 1
    }
  }

  // 中心竖线 = 起点
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

/** 滚轮微调：默认 0.1 秒/格，按住 Shift 更快 */
function onWheel(e) {
  e.preventDefault()
  const step = (e.shiftKey ? 0.5 : 0.1) * (e.deltaY > 0 ? 1 : -1)
  centerTime.value = clampCenter(centerTime.value + step)
  draw()
}

/* --------------------------- 弱起小节 --------------------------- */

/**
 * 「添加弱起小节」开关：只认 1（关）/ 2（开）两个值，即 `meta.audio.startPosition`。
 * 关 = 第 1 小节对齐音频起点；开 = 第 2 小节对齐（第 1 小节是弱起，落在起点之前）。
 */
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

/* --------------------------- 试听 --------------------------- */

async function togglePreview() {
  if (previewing.value) {
    engine.pause()
    engine.seek(restoreTime)
    previewing.value = false
    draw()
    return
  }
  restoreTime = player.currentTime
  engine.seek(Math.max(0, centerTime.value))
  previewing.value = true
  await engine.play()
  draw()
}

function stopPreview() {
  if (!previewing.value) return
  engine.pause()
  engine.seek(restoreTime)
  previewing.value = false
}

function tick() {
  ticker = requestAnimationFrame(tick)
  if (previewing.value) draw()
}

/** 拖动 / 滚轮都即时写进 meta.audio.startOffset：设置类改动不需要「保存」 */
watch(centerTime, (value) => {
  const next = Number(value.toFixed(3))
  if (Number(player.meta.audio?.startOffset) === next) return // 值没变就别弄脏乐谱
  player.meta.audio = { ...player.meta.audio, startOffset: next }
  markDirty()
})

/** 只是返回音频面板；改动早已经在生效了 */
function done() {
  stopPreview()
  emit('done')
}

const centerLabel = computed(() => {
  const sec = centerTime.value
  const sign = sec < 0 ? '-' : ''
  const abs = Math.abs(sec)
  return `${sign}${Math.floor(abs / 60)}:${(abs % 60).toFixed(2).padStart(5, '0')}`
})

onMounted(() => {
  restoreTime = player.currentTime
  const cur = Number(player.meta.audio?.startOffset)
  centerTime.value = Number.isFinite(cur) ? clampCenter(cur) : 0
  measure()
  draw()
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
    <p class="small muted">{{ t('audio.hint') }}</p>

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

    <!-- 起点数值：**只用文字色**（不要主题色），左右微调箭头已删 —— 拖动与滚轮就是全部微调手段 -->
    <div class="mono center-val">{{ centerLabel }}</div>

    <!-- 弱起小节：关 = 第 1 小节对齐起点；开 = 第 2 小节对齐、第 1 小节落在起点之前 -->
    <SwitchRow :label="t('audio.pickup')" :checked="startPosition > 1" @change="setPickup($event)" />

    <button type="button" class="btn block" :class="{ primary: previewing }" @click="togglePreview">
      <AppIcon :name="previewing ? 'pause' : 'play'" :size="17" />
      {{ previewing ? t('audio.stopPreview') : t('audio.preview') }}
    </button>

    <button type="button" class="btn block" @click="done">{{ t('audio.backToSettings') }}</button>
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
/* 频谱是拖动面（cursor 已经是 grab），悬停再把边框点亮，提示「这里能拖」 */
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
/* 起点数值：居中一行、只用文字色（原来跟主题色 + 左右箭头挤成一颗步进控件） */
.center-val {
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-strong);
}
</style>
