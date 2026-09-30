<script setup>
/**
 * 跳转弧线层：**跨页的那一层 overlay**（起点、终点各一条细竖线是 `ScorePage` 画的，这里只画连线）。
 *
 * 为什么必须单独一层：每页一个 `ScorePage`、每页一层 SVG（`viewBox` 是本页的 pt），
 * 而跳转两端常常不在同一页（「第 9 小节跳回第 1 小节」多半就是一页到另一页）——
 * 跨页的线在那一层里画不出来。这一层铺在整个谱面内容上、**直接用 CSS px 算坐标**（不设 `viewBox`）。
 *
 * **坐标一律取 `PdfViewer` 量好的 `map.pages`**（每页在内容坐标里的落点、包裹盒宽、缩放、页对象），
 * 别在这里再量一次 DOM：两处各量一份迟早差几像素，而且没挂载的那些页（`ScorePage` 是 `v-if` 的）
 * 在这一层里根本量不到。坐标原点与 `offsetTop` 同一处（滚动容器的 padding 边），
 * 所以这一层 `top: 0; left: 0` 摆上去就对得上。
 *
 * 形状：从**起点线的上端**起笔，一条二次贝塞尔拱到**终点线的上端**，末端一个箭头
 * （方向 = 曲线在末端的切线 = 「落下来」的方向）。拱高与两端横向距离挂钩，短距离也看得见弧度。
 *
 * **页缝处断开**（用户要求）：整层套一个 `clipPath`，里面每页一个 `rect`（纸面盒子）——
 * 弧线只在纸面上可见，页与页之间的空隙里自动断成几截。跨页的那一段因此落在它经过的每一页上，
 * 而不是一条悬空的线。
 *
 * **只在编辑模式画**（与非编辑模式「谱面不带任何标记」同一条规矩）；当前工具不是跳转、
 * 或「标记列表」开着时降级成灰（与 `ScorePage` 那套 `.muted` 同一个灰）。
 */
import { computed } from 'vue'
import { player, structure, timeline } from '../store/player.js'

const props = defineProps({
  /** `PdfViewer` 量好的内容布局：`{ total, view, pages: [{ index, top, height, left, width, scale, cssW, page }] }` */
  model: { type: Object, required: true },
  /** 「标记列表」开着（与 `ScorePage` 一样降级成灰） */
  marksOpen: { type: Boolean, default: false },
})

/** 缩放：这一页 px / pt。与 `ScorePage` 的 `scale` 同一个口径（`cssWidth / 页宽`），别另算一份 */
const kOf = (p) => p.cssW / (p.page?.width || 595.28)
/** 纸面在本页包裹盒里的左边缘（`.page-wrap` 是 `justify-content: center`，页比盒子窄时居中） */
const paperLeft = (p) => (p.left || 0) + Math.max(0, (p.width || p.cssW) - p.cssW) / 2

/**
 * 一条小节线的**上端**在内容坐标里的位置。
 * meta 的 y 是 y-up，翻转后 `页高 − max(y0, y1)` 才是上端（与 `ScorePage` 的 `clampY` 同一档：
 * 夹进纸面、绝不写回 meta）。记号落在本页之外（第几页对不上）时不画。
 */
function anchor(barId) {
  const bar = barId ? structure.value.barInfo.get(barId) : null
  if (!bar) return null
  const p = (props.model.pages || []).find((x) => x.index === bar.page)
  if (!p) return null
  const pageH = p.page?.height || 841.89
  const k = kOf(p)
  const topPt = Math.max(0, Math.min(pageH, pageH - Math.max(bar.y0, bar.y1)))
  return { x: paperLeft(p) + bar.x * k, y: (p.top || 0) + topPt * k, k }
}

/** 弧线：路径 + 末端箭头 + 线宽（线宽按两端那一档 pt 折算成 px，与谱面上那条细线同粗细） */
function arcPath(a, b) {
  const gap = 3 // 箭头尖与终点线上端留的缝（px）—— 压在线上就分不出「落到这儿」了
  const sx = a.x
  const sy = a.y
  const ex = b.x
  const ey = Math.max(0, b.y - gap)
  // 拱高与横向距离挂钩：短距离也看得见弧度，跨页那种长距离不至于拱到天上
  const lift = Math.max(18, Math.min(120, Math.abs(ex - sx) * 0.12))
  const cx = (sx + ex) / 2
  const cy = Math.min(sy, ey) - lift
  const d = `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`
  // 末端箭头：方向取曲线在末端的切线（`Q` 在 P1 处的切线就是 P1 − 控制点）
  const dx = ex - cx
  const dy = ey - cy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const head = 7
  const wing = 3.4
  const bx = ex - ux * head
  const by = ey - uy * head
  const arrow = `M ${bx - uy * wing} ${by + ux * wing} L ${ex} ${ey} L ${bx + uy * wing} ${by - ux * wing}`
  return { d, arrow, w: 1.8 * ((a.k + b.k) / 2) }
}

/** 每一页的纸面盒子：`clipPath` 用它们把弧线在页缝处切断 */
const clips = computed(() =>
  (props.model.pages || []).map((p, i) => ({
    key: i,
    x: paperLeft(p),
    y: p.top || 0,
    w: p.cssW,
    h: p.height || 0,
  }))
)

const arcs = computed(() => {
  if (!props.model.pages?.length) return []
  const out = []
  for (const jump of timeline.value.jumps) {
    const a = anchor(jump.startBarId)
    const b = anchor(jump.endBarId)
    if (!a || !b) continue
    out.push({ id: jump.id, ...arcPath(a, b) })
  }
  return out
})

/** 这一层要多大：横到最右边那一页的右边缘，竖到内容总高（坐标就是内容坐标，不缩放） */
const size = computed(() => {
  let w = 0
  for (const p of props.model.pages || []) w = Math.max(w, paperLeft(p) + p.cssW)
  return { w, h: props.model.total || 0 }
})

const muted = computed(() => props.marksOpen || player.tool !== 'jump')
</script>

<template>
  <svg
    v-if="size.w && size.h && arcs.length"
    class="jump-arcs"
    :class="{ muted }"
    :width="size.w"
    :height="size.h"
    aria-hidden="true"
  >
    <!-- 页缝处断开：只有纸面上看得见（每一页一个 rect，取并集） -->
    <clipPath id="jump-arc-clip">
      <rect v-for="c in clips" :key="c.key" :x="c.x" :y="c.y" :width="c.w" :height="c.h" />
    </clipPath>
    <g clip-path="url(#jump-arc-clip)">
      <g v-for="a in arcs" :key="a.id">
        <path :d="a.d" class="arc" :style="{ strokeWidth: a.w }" />
        <path :d="a.arrow" class="arc" :style="{ strokeWidth: a.w }" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
/* 铺在谱面内容上：坐标就是内容坐标（原点 = 滚动容器的 padding 边，与 `offsetTop` 同一处）。
   `pointer-events: none` —— 它只是一层画出来的线，点击仍然归下面那些页 */
.jump-arcs {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
}
.arc {
  fill: none;
  stroke: var(--accent);
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 降级成灰：与 `ScorePage` 里 `.muted` 那套用同一个灰（`--mark-muted-line`）——
   两处各挑一档灰迟早会不一样 */
.jump-arcs.muted .arc {
  stroke: var(--mark-muted-line);
}
</style>
