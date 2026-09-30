<script setup>
/**
 * 音频起点选择器：固定 5 秒视野的频谱图，不能缩放，只能左右拖动 / 滚轮微调，**双击回到 0 秒**。
 * 双击（要求原文：「双击频谱图将音频起点滚动到0s」）就是把中心线摆回音频文件的 0 秒 —— 起点跟着写 0，
 * 与拖动 / 滚轮一样即时写进 meta。**这一笔自己从 pointer 事件里数**（判据是下面的 `TAP_SLOP` /
 * `TAP_MS` / `MOUSE_TAP_MS`），**不用 `@dblclick`**：触屏上原生双击事件不保证派发，那条手势在手机上就哑了；
 * 也**别再挂一套 `@dblclick` 兜底**（一件事只有一个实现）。
 * 屏幕正中间那条竖线就是要设定的音频起点，改动**即时**写进 meta.audio.startOffset（没有保存按钮），
 * 值没变就不写。允许设到音频开始之前最多 10 秒（负数 = 第一小节在音频开始前就开始数）。
 * 可以就地试听：**单独放一下这个音频文件**（试听那只 `<audio>`）——
 * **放起来就一直放到音频结束**（要求原文：「试听不要自动停止，用户不点击停止就播放到音频结束」），
 * 不设时限；**停下来的只有两种情况**（要求原文：「就只有弹窗关闭、用户点停止这两种情况会停止试听」）：
 * **关掉这一屏**（点「返回音频设置」、关音频面板、被别的面板顶掉）与**点「停止试听」**。
 * **试听不跟谱面走同一个播放流程**（要求原文：「试听不和谱面走同一个播放流程！试听只是单独放那个
 * 音频文件」）：它不挪谱面的播放位置、不把 app 切进播放态、不碰节拍器与预备拍。
 * **但进这一屏要先把谱面停下来**（要求原文：「当用户打开了「设置音频起点」的sheet时要把播放中的
 * 乐谱给暂停」）—— 见下面 `onMounted` 里那句 `pausePlayback()`：听到的就只有这个音频文件。
 * 实现只有一处、在 store 里（`store/player.js` 的 `startPreview` / `stopPreview`）：
 * 「试听中」= `player.previewing`、播放头 = `player.previewTime`（音频文件自己的时间轴），
 * 本组件读这两样画播放头、按钮读它换文案 —— **不要在本组件里直接 `engine.play()`**：
 * 那是谱面走带的声源，借它试听会把谱面位置挪走。
 * 它不是一个独立浮层：由「音频」浮层（`PlayerToolbar`）把内容整体换成它。
 * **它自己一颗动作按钮都没有**（`docs/ui.md` §13 / §18.42）：那一屏的「试听 / 停止试听」与
 * 「返回音频设置」由 `PlayerToolbar` 的 **footer（面板最底端）**渲染，本组件只把
 * `previewing` / `togglePreview` / `done` 三样 `defineExpose` 出去（试听那套逻辑在 store 里）。
 * **这一屏不写任何说明小字**：频谱本身加上「拖动 / 滚轮 / 双击」的手势、居中的起点读数和「添加弱起小节」
 * 这个开关就是全部，再挂一行操作说明只是把面板撑高。
 * 起点数值**只用文字色**（不用主题色），也**没有左右微调箭头** —— 拖动与滚轮就是全部微调手段，
 * 回 0 秒只有双击那一下。
 * 「添加弱起小节」开关改的是 `meta.audio.startPosition`（也是即时写）：
 * 关 = 第 1 小节对齐起点，开 = 第 2 小节对齐起点、第 1 小节（弱起）落在起点之前
 * （时间轴那头的语义见 `domain/timeline.js` 的 `startMeasure`）。开关本体走 `SwitchRow`。
 * 频谱与中心线都用 canvas 画，配色走 `readPalette()`，系统主题切换时要重绘。
 * Canvas 上的**字**（「生成中 / 没有音频」那行提示、秒刻度）走全站那套字体：
 * 字体栈从 `--font-ui` 读（`readFontStack`），**别在这里另写字体名**（见 `docs/ui.md` §2）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SwitchRow from './SwitchRow.vue'
import { duration, markDirty, pausePlayback, peaksRef, player, startPreview, stopPreview } from '../store/player.js'
import { readFontStack, readPalette } from '../store/ui.js'
import { t } from '../i18n/index.js'

const emit = defineEmits(['done'])

const MIN_TIME = -10 // 允许音频开始前 10 秒
const SPAN = 5 // 视野固定 5 秒
const TAP_SLOP = 10 // CSS px：一次按下的位移在任一方向上越过它就算拖动，抬手时不再算「点按」（与 `ScorePage` 同一个门槛）
const TAP_MS = 300 // 触屏：两次点按的间隔上限
const MOUSE_TAP_MS = 500 // 鼠标：跟系统默认那双击速度一档，别拿触屏的 300ms 卡住慢一点的双击

const root = ref(null)
const canvas = ref(null)
const width = ref(0)
const centerTime = ref(0)
const dragging = ref(null) // { x, y, center, moved }
/** 上一次点按：`{ time, x }` —— 双击就是两次点按挨得够近够快（见 `onUp`） */
let lastTap = null
/**
 * 「试听中」**读 store 的 `player.previewing`，本组件不再自己存一份**：
 * 试听走的是那只独立的试听 `<audio>`（`startPreview` / `stopPreview`），
 * 这里再存一个布尔就会出现「按钮说在试听、频谱里的播放头不动」这种两套状态。
 */
const previewing = computed(() => player.previewing)
const palette = ref(readPalette())
/** Canvas 上的字走**全站那套字体**（读 `main.css` 的 `--font-ui`，见 `readFontStack`） */
const fontStack = readFontStack()

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
    ctx.font = `${13 * dpr}px ${fontStack}`
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

  // 秒刻度：**只标整秒**（1s / 2s / 3s…）—— 半秒那档（1.5s / 2.5s）不再标：
  // 刻度只是拿来对「起点大概落在第几秒」的，多一档只添乱（要求原文：「频谱的时间只保留1s 2s 3s
  // 去掉1.5 2.5这些」）。
  ctx.fillStyle = p.text
  ctx.font = `${10 * dpr}px ${fontStack}`
  ctx.textAlign = 'center'
  const first = Math.ceil(start)
  for (let sec = first; sec <= start + SPAN; sec += 1) {
    const x = ((sec - start) / SPAN) * w
    ctx.fillRect(x, h - 6 * dpr, 1, 6 * dpr)
    ctx.fillText(`${sec}s`, x, h - 9 * dpr)
  }

  // 试听播放头：位置取 `player.previewTime`（= 试听那只 `<audio>` 的 currentTime，
  // **音频文件自己的时间轴**，与频谱同一套坐标）。
  // ⚠️ 不要用 `player.currentTime`：那是谱面播放位置，试听根本不碰它（见 store 的 `startPreview`）。
  if (previewing.value) {
    const px = ((player.previewTime - start) / SPAN) * w
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
  dragging.value = { x: localX(e), y: e.clientY, center: centerTime.value, moved: false }
  try {
    root.value?.setPointerCapture?.(e.pointerId)
  } catch {}
}

function onMove(e) {
  const d = dragging.value
  if (!d) return
  const dx = localX(e) - d.x
  // 拖动本身**不给阈值**（跟手是第一位的）：`moved` 只用来判断抬手时这一笔算不算「点按」，
  // 所以两个方向都要看 —— 纵向拖（频谱只认横向，纵向上什么都不动）也不该算点按
  if (Math.abs(dx) > TAP_SLOP || Math.abs(e.clientY - d.y) > TAP_SLOP) d.moved = true
  centerTime.value = clampCenter(d.center - dx / pxPerSec.value)
  draw()
}

/** 双击回到 0 秒：中心线对准音频文件的 0 秒（0 永远落在允许区间里，夹一次只是与拖动 / 滚轮同一个写法） */
function backToZero() {
  centerTime.value = clampCenter(0)
  draw()
}

/**
 * 抬手：位移没越过 `TAP_SLOP` 的这一笔算「点按」。两下点按挨得够近够快就是**双击** ——
 * 间隔上限鼠标取 `MOUSE_TAP_MS`、触屏取 `TAP_MS`，落点相距也不超过 `TAP_SLOP`。
 * 拖动过的一笔不算点按，还会把上一次点按作废（「拖完马上点一下」不该算双击）。
 */
function onUp(e) {
  const d = dragging.value
  dragging.value = null
  if (!d || d.moved) {
    lastTap = null
    return
  }
  const now = performance.now()
  const x = localX(e)
  const gap = e.pointerType === 'mouse' ? MOUSE_TAP_MS : TAP_MS
  if (lastTap && now - lastTap.time <= gap && Math.abs(x - lastTap.x) <= TAP_SLOP) {
    lastTap = null
    backToZero()
    return
  }
  lastTap = { time: now, x }
}

/** 这一笔被系统收走了（指针丢失 / 手势被接管）：不算点按，也不留残影 */
function onCancel() {
  dragging.value = null
  lastTap = null
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

/**
 * 试听**只在 store 里实现一处**（`startPreview` / `stopPreview`）：那只 `<audio>` 的位置由
 * `engine.previewEl` 每帧报上来（`player.previewTime`），所以播放头会自己走。
 * 本组件只做两件事：把起点报上去、把播放头画出来。
 *
 * 起不来（文件放不出来 / 浏览器拒绝）时**本组件不弹提示**：`store/player.js` 挂在引擎的
 * `previewError` 上已经弹了一条**可复制的报错**（危险色、正文「试听失败：错误原文」）—— 在这里
 * 再补一条就是两条；播放出错那条（`error`）也归它，试听这条**不发那个事件**（见 `previewPlay()`）。
 *
 * `centerTime` 可以落在音频开始之前（第一小节排在音频 0 秒之前，见 `timelineStart`）——
 * 那一段音频里没有声音，store 会从音频的 0 秒起播（见 `previewStart`）。
 */
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

/** 拖动 / 滚轮都即时写进 meta.audio.startOffset：设置类改动不需要「保存」 */
watch(centerTime, (value) => {
  const next = Number(value.toFixed(3))
  if (Number(player.meta.audio?.startOffset) === next) return // 值没变就别弄脏乐谱
  player.meta.audio = { ...player.meta.audio, startOffset: next }
  markDirty()
})

/**
 * 返回音频面板。**试听跟着停** —— 这一屏关掉了，「听一下」这件事也就结束了
 * （「关掉这一屏」是两种停法之一，另一个是那颗「停止试听」，见文件头）。
 * 改动早已经在生效了，这里没有保存。
 */
function done() {
  stopPreview()
  emit('done')
}

/**
 * **这一屏没有自己的动作按钮**：「试听 / 停止试听」与「返回音频设置」由音频面板（`PlayerToolbar`）的
 * **footer** 渲染（动作按钮一律放面板最底端，见 docs/ui.md §13 / §18.42 / §18.61）。
 * 所以把这三样暴露给使用方；**试听那套逻辑在 store 里**（`startPreview` / `stopPreview`），
 * 这里只转发 —— 别为了放按钮把它抄到外面去（§14「一件事只有一个实现」）。
 */
defineExpose({ previewing, togglePreview, done })

const centerLabel = computed(() => {
  const sec = centerTime.value
  const sign = sec < 0 ? '-' : ''
  const abs = Math.abs(sec)
  return `${sign}${Math.floor(abs / 60)}:${(abs % 60).toFixed(2).padStart(5, '0')}`
})

onMounted(() => {
  /**
   * **进这一屏先把谱面停下来**（要求原文：「当用户打开了「设置音频起点」的sheet时要把播放中的乐谱给
   * 暂停」）：这一屏是「听一下这个音频文件」，谱面同时在走带就两处都在响。
   * 走 store 的 `pausePlayback()`（暂停的唯一入口，与进编辑模式同一条）—— 它**只停谱面、不停试听**，
   * 所以「开着试听去点别的」不会被这里顺手掐掉。没在播放时调它也没事。
   */
  pausePlayback()
  const cur = Number(player.meta.audio?.startOffset)
  centerTime.value = Number.isFinite(cur) ? clampCenter(cur) : 0
  measure()
  draw()
  // Canvas **不吃 CSS 的字体加载**：字体还没到位时这一遍画的是回退字形，之后不会有任何东西
  // 自动触发重绘（要等用户拖动 / 试听才换回来）。所以显式等一次 —— 已经加载好就是立刻兑现。
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
  /**
   * **兜底把试听停掉**（`stopPreview()` 幂等，重复调没事）：这一屏没了，试听就不该还在响。
   * 正常关闭路径上 `PlayerToolbar` 的面板 `@close` 已经停过一次（那边是为了**当刻**停，
   * 不跟着抽屉退场那段过渡多响半拍）；这里兜的是剩下那几种卸载：音频被移除、页面卸载。
   */
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
      @pointercancel="onCancel"
      @wheel="onWheel"
    >
      <canvas ref="canvas" class="spec-canvas" />
    </div>

    <!-- 起点数值：**只用文字色**（不要主题色），左右微调箭头已删 —— 拖动与滚轮就是全部微调手段 -->
    <div class="mono center-val">{{ centerLabel }}</div>

    <!-- 弱起小节：关 = 第 1 小节对齐起点；开 = 第 2 小节对齐、第 1 小节落在起点之前 -->
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
