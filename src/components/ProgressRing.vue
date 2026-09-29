<script setup>
/**
 * 提示条里那颗进度圆环（20×20，占原来垃圾桶图标的位置）。**三种长相**：
 *
 *  1. `progress` 是 0~1 的数 → **确定进度**：一圈 `--stroke-strong` 轨道 + 一段 `--accent` 弧线，
 *     弧长 = 比例 × 周长，从 12 点方向顺时针走。
 *  2. `progress === null` → **没有明确进度**：不画静态弧，改用一段 25% 的弧**匀速转圈**（`.spin`）。
 *     这就是「任务完成前用无限进度环动画」那一条。
 *  3. `since` / `total` 都给 → **倒计时**（带按钮那条 toast 的撤销窗口）：弧线按
 *     「剩余时间 / 总时间」自己走空，**由本组件的定时器推**。
 *
 * 三种都遵守同一条下限：**弧线任何时刻都留 `MIN_ARC`（8%）**，走完也是。
 * 一点不剩就成了一个灰空圈、看着像坏了 —— 用户就是照那个样子报过「只有一个灰色空圈」。
 *
 * ⚠️ **确定进度与倒计时都不走 CSS 动画**：那条路要「动画名 + 关键帧 + 内联 duration + fill-mode」
 * 四件事同时对上，任何一环出错，用户看到的就是**空圈**（动画终点值 = 一点不剩），
 * 而且没法自证是哪一环坏的 —— 由属性 / 定时器直接算，每一帧的值都能复现。
 * 唯一的 CSS 动画是第 2 种那个匀速转圈（它转的是 `transform`，与弧长无关）。
 *
 * 几何改 r 的话：`viewBox` / `width` / `height` / `R` 一起改，`CIRCUMFERENCE` 跟着算，别写死数。
 */
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  /** 0~1；**null = 没有明确进度**（无限进度环） */
  progress: { type: Number, default: null },
  /** 倒计时起点（`Date.now()` 的时间戳）；与 `total` 一起给才走倒计时 */
  since: { type: Number, default: 0 },
  /** 倒计时总时长（毫秒）；0 = 不倒数 */
  total: { type: Number, default: 0 },
})

const BOX = 20
const R = 9
/** 整圈周长（2πr ≈ 56.55）：`stroke-dasharray` 与弧长都从它算 */
const CIRCUMFERENCE = Number((2 * Math.PI * R).toFixed(2))
/** 弧线的**可见下限**：占整圈的 8%，任何时刻都留这么一段 */
const MIN_ARC = 0.08
/** 倒计时的更新频率：一圈 6 秒，15fps 已经很顺，而且只改 SVG 属性、不触发重排 */
const FPS = 15

/** 倒计时剩下的比例（1 → 0）。非倒计时模式下不参与 */
const left = ref(1)
let timer = 0

function stop() {
  if (timer) clearInterval(timer)
  timer = 0
}

/** `since` / `total` 一变就重开一轮（连删时倒计时重置） */
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
    tick() // 先画一帧，别等第一个间隔（否则开头一小段是上一轮的值）
    timer = setInterval(tick, Math.round(1000 / FPS))
  },
  { immediate: true }
)
onBeforeUnmount(stop)

/** 要画的弧占整圈的比例 */
const arc = () => {
  if (props.total && props.since) return Math.max(MIN_ARC, left.value)
  const p = props.progress
  if (p === null || !Number.isFinite(p)) return 0.25
  return Math.max(MIN_ARC, Math.min(1, p))
}
/** 无限进度环（转圈）只在「既没有确定进度、也没有倒计时」时出现 */
const spinning = () =>
  !(props.total && props.since) && (props.progress === null || !Number.isFinite(props.progress))
</script>

<template>
  <i class="toast-ring" aria-hidden="true">
    <svg :viewBox="`0 0 ${BOX} ${BOX}`" width="20" height="20">
      <circle class="toast-ring-bg" :cx="BOX / 2" :cy="BOX / 2" :r="R" />
      <!-- `stroke-dasharray` = 这段弧 + 空出整圈，弧长变了它跟着重画 -->
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
  /* 从 12 点方向起画（SVG 圆的 0 度在 3 点） */
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
/* 没有明确进度：那段弧匀速转圈。**不加过渡** —— 它转的是 `transform`，与弧长无关 */
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
