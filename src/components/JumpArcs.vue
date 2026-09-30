<script setup>
/**
 * 跳转箭头层：**跨页的那一层 overlay**（起点、终点各一条细竖线是 `ScorePage` 画的，这里只画箭头）。
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
 * **形状 = 沿一条二次贝塞尔摆一串 `>`**（用户要求）：从**起点线的上端**拱到**终点线的上端**，
 * 两端的小节线上各是最小的那一个（`ARC_END`）、正中间那个是 **`--tap-min`（46px）**—— **窄 → 宽 → 窄**。
 *  · 个数按**弧长**与**目标间距** `ARC_GAP` 估（取**奇数**，正中间那个才正好落在 46px 这一档上；
 *    封顶 `ARC_MAX`）；摆法就是 CSS 的 **space-between**：首尾贴住两端、中间等分
 *    （`>` 的朝向取曲线在该处的切线）；
 *  · **大小怎么插值、疏密、两端与中间那两档分别在哪改，见下面「箭头的手感常量」那一段**；
 *  · **两边都是固定屏幕像素**，不跟着谱面缩放变（用户要求）—— 只有两端的落点跟着缩放走；
 *  · 整条箭头**有一个投影**（`--mark-shadow`），压在谱面上托起来一点才看得清；
 *    **鼠标停在它上面时加粗**（只加粗、不换色，与谱面上那几条标记同一档手感）。
 *
 * **页缝处断开**（用户要求）：整层套一个 `clipPath`，里面每页一个 `rect`（纸面盒子）——
 * 箭头只在纸面上可见，页与页之间的空隙里自动断成几截。跨页的那一段因此落在它经过的每一页上，
 * 而不是一条悬空的线。
 *
 * **只在编辑模式画**（与非编辑模式「谱面不带任何标记」同一条规矩）；当前工具不是跳转、
 * 或「标记列表」开着时降级成灰（与 `ScorePage` 那套 `.muted` 同一个灰）。
 *
 * **选中跳转工具时箭头可点**（用户要求）：点中箭头**那一条带子**（含 `>` 之间的缝）→
 * 打开**那一条记号**的 Sheet（正在「选择前置」时是把它设成前置）。这时那条带子
 * **压住它下面的小节线** —— 被压住的那一段点下去不会再新建（用户拍板）；
 * **换成别的工具整层退回 `pointer-events: none`**，小节线（连同它的序号别针）照旧说了算。
 *
 * **颜色**：常态 `--accent-line`（比标记本体那档实色淡一档，压在谱面上不抢戏），
 * **Sheet 正开着的那一条用实色 `--accent`**（一眼看出在改哪一条）。
 *
 * **拖拽新建期间的草稿**（`player.jumpDrag`）也画在这一层、样式是同一个形状的半透明版：
 * 跨页的那条草稿只有这里画得出来（`ScorePage` 每页一层，画不出跨页的东西）。
 */
import { computed } from 'vue'
import { t } from '../i18n/index.js'
import { openJumpSheet, pickJumpMember, player, structure, timeline } from '../store/player.js'

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

/* ------------------------------- 箭头的手感常量 ------------------------------- */
/*
 * **这四个就是调箭头长相的全部旋钮**（其余几何都是从它们推出来的）：
 *   1. 两端那个 `>` 多大   → `ARC_END`
 *   2. 正中间那个多大       → `ARC_MID`（现在是写死的；想跟着最小点击尺寸走就用 `readTapMin()`）
 *   3. 大小怎么插值         → `sizeAt(i, n)` 里那一条 `sin`（两端 0、正中间 1）
 *   4. 相邻两个之间多宽     → `ARC_GAP`（**目标间距**：个数按它算，真正的间距由 space-between 定，
 *                            见 `arrowFor`）
 * 另外几个是保险：`ARC_MAX`（跨好几页的长箭头最多摆几个）、`ARC_MIN_GAP`（再挤也要留的缝）、
 * `ARC_STROKE` / `ARC_STROKE_MIN`（笔画粗细 = 宽度 × 比例）、`ARC_HIT_PAD`（可点带子外扩多少）。
 */

/** 两端那个 `>` 的宽度（px）：起点、终点就落在小节线上，这两个最小 —— 再小就只剩一个点 */
const ARC_END = 5
/** 正中间那个 `>` 的宽度（px）。想让箭头中间**跟着全站的最小点击尺寸**走，就改回
    `const ARC_MID = readTapMin()`（读 `--tap-min`，46）；现在是写死的 */
const ARC_MID = 15
/** 读 `--tap-min`（46，与 main.css 同值）—— 上面那一行的备选写法用得到它 */
function readTapMin() {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min'))
  return Number.isFinite(v) ? v : 46
}
/** 相邻两个 `>` 之间的**目标**宽度（px）：调小 = 个数更多、更密（真正的间距是 space-between 的余量） */
const ARC_GAP = 2
/** 个数上限：跨好几页的长箭头不至于摆成一条虚线 */
const ARC_MAX = 100
/** 相邻两个之间**至少**留多宽（px）：极短的一条按这个下限整体缩一档，免得叠在一起 */
const ARC_MIN_GAP = 2
/** `>` 的笔画粗细 = 宽度 × 这个比例，最细到 `ARC_STROKE_MIN`（两端那两个也才看得见） */
const ARC_STROKE = 0.14
const ARC_STROKE_MIN = 1
/** 可点带子在 `>` 本体高度之外再各放几 px（手指/鼠标不必正好压在笔画上） */
const ARC_HIT_PAD = 1
/** `sin` 分布的**平均宽度**（两端到中间那一档的均值 = 2/π）：只用来估「摆得下几个」 */
const ARC_AVG = ARC_END + (ARC_MID - ARC_END) * (2 / Math.PI)

/**
 * 第 `i` 个 `>` 有多宽（`n` 个里的一串）：**这就是「大小的插值函数」** ——
 * `sin` 让两端收到 `ARC_END`、正中间那个顶到 `ARC_MID`，两头对称。
 * 想换成线性（三角尖）、幂函数、或者干脆一样大，改这一行就行。
 */
function sizeAt(i, n) {
  return ARC_END + (ARC_MID - ARC_END) * Math.sin((Math.PI * i) / (n - 1))
}

/**
 * 每一条小节线上挂着几个**端点**（只算画得出来的那些记号）：`Map<barId, jumpId[]>`。
 * 次序按 `meta.jumps` 的先后（也就是落笔顺序），稳定 —— 增删别的记号时同一条线上的排布不会乱跳。
 * 一张小节线上可能同时挂着好几条记号的起点 / 终点，所以端点的纵向位置要看它：
 * **同一条线上的端点按纵向 space-between 分布**（用户要求），见 `anchor`。
 */
const endpointsByBar = computed(() => {
  const map = new Map()
  for (const jump of timeline.value.jumps) {
    if (!jump.valid) continue
    for (const barId of [jump.startBarId, jump.endBarId]) {
      if (!barId) continue
      const list = map.get(barId)
      if (list) list.push(jump.id)
      else map.set(barId, [jump.id])
    }
  }
  return map
})

/** 拖拽草稿不在 `endpointsByBar` 里（它还没进 meta），用一个不会撞上真 id 的记号去取「最后一格」 */
const DRAFT_ANCHOR = ''

/**
 * 一条记号的某一端在内容坐标里的落点。
 *
 * **x** = 那条小节线的 x（与 `ScorePage` 画的那条细竖线同一处）。
 * **y** = **沿这条小节线纵向 space-between**（用户要求）：这一端是挂在它上面的第 `i` 个端点，
 * 一共 `n` 个 → 落在 `i / (n − 1)` 处（第一个贴行顶、最后一个贴行底；只有它一个时贴行顶）。
 * 「箭头的起点终点不是一定落在小节线的顶端的」—— 就落在这一处上。
 *
 * meta 的 y 是 y-up，翻转后 `页高 − max(y0, y1)` 才是上端（与 `ScorePage` 的 `clampY` 同一档：
 * 夹进纸面、绝不写回 meta）。记号落在本页之外（第几页对不上）时不画。
 */
function anchor(id, barId) {
  const bar = barId ? structure.value.barInfo.get(barId) : null
  if (!bar) return null
  const p = (props.model.pages || []).find((x) => x.index === bar.page)
  if (!p) return null
  const pageH = p.page?.height || 841.89
  const k = kOf(p)
  const top = (p.top || 0) + Math.max(0, Math.min(pageH, pageH - Math.max(bar.y0, bar.y1))) * k
  const bottom = (p.top || 0) + Math.max(0, Math.min(pageH, pageH - Math.min(bar.y0, bar.y1))) * k
  const list = endpointsByBar.value.get(barId) || []
  let i = list.indexOf(id)
  let n = list.length
  // 不在册的（拖拽草稿）排到最后那一格：**不动别人已经站好的位置**
  if (i < 0) {
    i = n
    n += 1
  }
  const t = n > 1 ? i / (n - 1) : 0
  return { x: paperLeft(p) + bar.x * k, y: top + (bottom - top) * t }
}

/**
 * 把一条贝塞尔**按弧长**采成一张表：`at(s)` 给出弧长 `s` 处的点与单位切线。
 * 那一串 `>` 要沿曲线等分、还要按切线转方向，只有弧长这一档参数量做得到
 * （按参数 `t` 等分的话，拱得高的一段会挤在一起）。
 */
function sampleCurve(p0, c, p1) {
  const N = 64
  const pts = []
  let total = 0
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const u = 1 - t
    const x = u * u * p0.x + 2 * u * t * c.x + t * t * p1.x
    const y = u * u * p0.y + 2 * u * t * c.y + t * t * p1.y
    if (i) total += Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y)
    // 切线 B'(t) = 2(1−t)(C − P0) + 2t(P1 − C)
    const tx = 2 * u * (c.x - p0.x) + 2 * t * (p1.x - c.x)
    const ty = 2 * u * (c.y - p0.y) + 2 * t * (p1.y - c.y)
    const len = Math.hypot(tx, ty) || 1
    pts.push({ x, y, s: total, ux: tx / len, uy: ty / len })
  }
  const at = (s) => {
    const q = Math.min(Math.max(s, 0), total)
    let i = 1
    while (i < pts.length - 1 && pts[i].s < q) i++
    const a = pts[i - 1]
    const b = pts[i]
    const k = b.s > a.s ? (q - a.s) / (b.s - a.s) : 0
    const ux = a.ux + (b.ux - a.ux) * k
    const uy = a.uy + (b.uy - a.uy) * k
    const len = Math.hypot(ux, uy) || 1
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, ux: ux / len, uy: uy / len }
  }
  return { at, total }
}

/**
 * 一条跳转的箭头：`{ chevrons: [{ key, d, hit, w }] }` —— 每个 `>` 是一条两段的折线
 * （`w` 是它的笔画粗细，随它自己的宽度走），`hit` 是**这一格的可点区域**。
 *
 * 宽度按 `sizeAt` 的 `sin` 分布：`i = 0` 与 `i = n−1` 落在 `ARC_END` 上、正中间那一个落在 `ARC_MID` 上，
 * 中间是渐变的窄宽窄。间距按 **space-between**：首尾贴住两端，剩下的弧长在 `n−1` 段里等分。
 * **个数由 `ARC_GAP`（目标间距）估**：`n ≈ (弧长 + ARC_GAP) / (平均宽度 + ARC_GAP)`，取奇数
 * （正中间那个才正好落在 `ARC_MID` 这一档）、封顶 `ARC_MAX`。所以真正的间距是**余量**，
 * 目标间距只决定个数：调小 = 个数更多、更密。
 * 缝的下限是 `ARC_MIN_GAP` —— 弧长连「这么多个 `>` 加上这些缝」都摆不下时**整体按比例缩一档**，
 * 否则间距会算成负的、那一串会互相叠起来。
 */
function arrowFor(a, b) {
  // 拱高与两端横向距离挂钩：短距离也看得见弧度，跨页那种长距离不至于拱到天上
  const lift = Math.max(18, Math.min(120, Math.abs(b.x - a.x) * 0.12))
  const p0 = { x: a.x, y: a.y }
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift }
  const p1 = { x: b.x, y: b.y }
  const { at, total } = sampleCurve(p0, c, p1)

  let n = Math.round((total + ARC_GAP) / (ARC_AVG + ARC_GAP))
  if (n % 2 === 0) n += 1 // 取奇数：正中间那个才正好是 ARC_MID 这一档
  n = Math.max(3, Math.min(ARC_MAX, n))

  const sizes = []
  let sum = 0
  for (let i = 0; i < n; i++) {
    const s = sizeAt(i, n)
    sizes.push(s)
    sum += s
  }
  const room = total - ARC_MIN_GAP * (n - 1)
  if (sum > room) {
    const k = Math.max(0, room) / sum
    for (let i = 0; i < n; i++) sizes[i] *= k
    sum = Math.max(0, room)
  }
  const gap = (total - sum) / (n - 1)

  const chevrons = []
  let cursor = 0
  for (let i = 0; i < n; i++) {
    const size = sizes[i]
    const tip = at(cursor + size)
    const half = size / 2
    // 垂直方向 = 切线转 90°；两条腿都从尖端往回量，于是这个 `>` 的水平与垂直跨度都是 size
    const nx = -tip.uy
    const ny = tip.ux
    const bx = tip.x - tip.ux * size
    const by = tip.y - tip.uy * size
    // **可点区域 = 这一格**（`>` 本体 + 它两侧各半个缝），所以「缝里也能点」：
    // 沿着中心线切一条 size 高的带子出来（首尾两格只吃到端点，不外扩）
    const s0 = i === 0 ? 0 : cursor - gap / 2
    const s1 = i === n - 1 ? total : cursor + size + gap / 2
    const q0 = at(s0)
    const q1 = at(s1)
    const h0 = size / 2 + ARC_HIT_PAD
    chevrons.push({
      key: i,
      d: `M ${bx + nx * half} ${by + ny * half} L ${tip.x} ${tip.y} L ${bx - nx * half} ${by - ny * half}`,
      hit: `M ${q0.x - q0.uy * h0} ${q0.y + q0.ux * h0} L ${q1.x - q1.uy * h0} ${q1.y + q1.ux * h0} L ${q1.x + q1.uy * h0} ${q1.y - q1.ux * h0} L ${q0.x + q0.uy * h0} ${q0.y - q0.ux * h0} Z`,
      w: Math.max(ARC_STROKE_MIN, size * ARC_STROKE),
    })
    cursor += size + gap
  }
  return { chevrons }
}

/** 每一页的纸面盒子：`clipPath` 用它们把箭头在页缝处切断 */
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
    if (!jump.valid) continue
    const a = anchor(jump.id, jump.startBarId)
    const b = anchor(jump.id, jump.endBarId)
    if (!a || !b) continue
    out.push({ id: jump.id, label: arcLabel(jump), ...arrowFor(a, b) })
  }
  return out
})

/** 这条箭头叫什么（只给读屏用；谱面上的箭头本来只是一串线，没有文字） */
function arcLabel(jump) {
  const none = t('common.noValue')
  return t('jump.arcAria', { start: jump.start ?? none, end: jump.end ?? none })
}

/** 拖拽新建期间那条草稿（两端已经由 store 按落线规则挪好） */
const draft = computed(() => {
  const d = player.jumpDrag
  if (!d || !props.model.pages?.length) return null
  const a = anchor(DRAFT_ANCHOR, d.startBarId)
  const b = anchor(DRAFT_ANCHOR, d.endBarId)
  if (!a || !b) return null
  return arrowFor(a, b)
})

/** 这一层要多大：横到最右边那一页的右边缘，竖到内容总高（坐标就是内容坐标，不缩放） */
const size = computed(() => {
  let w = 0
  for (const p of props.model.pages || []) w = Math.max(w, paperLeft(p) + p.cssW)
  return { w, h: props.model.total || 0 }
})

const muted = computed(() => props.marksOpen || player.tool !== 'jump')
/** 可点 = 正在用跳转工具、手还在编辑（「标记列表」开着时连标记都是灰的，这一层不抢点击） */
const live = computed(() => player.editMode && player.tool === 'jump' && !props.marksOpen)

/** 点中一条箭头：正在「添加小组成员」就把它加进那一组，不然打开**那一条**记号的 Sheet */
function onPick(id) {
  if (!live.value) return
  if (player.pickJumpId) pickJumpMember(id)
  else openJumpSheet(id)
}
</script>

<template>
  <svg
    v-if="size.w && size.h && (arcs.length || draft)"
    class="jump-arcs"
    :class="{ muted, live }"
    :width="size.w"
    :height="size.h"
    :aria-hidden="live ? null : 'true'"
  >
    <!-- 页缝处断开：只有纸面上看得见（每一页一个 rect，取并集） -->
    <clipPath id="jump-arc-clip">
      <rect v-for="c in clips" :key="c.key" :x="c.x" :y="c.y" :width="c.w" :height="c.h" />
    </clipPath>
    <g clip-path="url(#jump-arc-clip)">
      <g
        v-for="a in arcs"
        :key="a.id"
        class="arrow"
        :class="{ on: a.id === player.jumpSheetId }"
        :role="live ? 'button' : null"
        :aria-label="live ? a.label : null"
        @click="onPick(a.id)"
      >
        <!-- 可点的那条带子（含 `>` 之间的缝）：不画出来，只吃指针。
             `pointer-events: all` 让命中按几何算，`fill: none` 因此不碍事 -->
        <path v-for="c in a.chevrons" :key="'h' + c.key" :d="c.hit" class="hit" />
        <path
          v-for="c in a.chevrons"
          :key="c.key"
          :d="c.d"
          class="chev"
          :style="{ '--chev-w': c.w + 'px' }"
        />
      </g>
      <!-- 拖拽中的草稿：同一个形状、半透明，松手前就看得到它会落在哪儿 -->
      <g v-if="draft" class="arrow draft">
        <path
          v-for="c in draft.chevrons"
          :key="c.key"
          :d="c.d"
          class="chev"
          :style="{ '--chev-w': c.w + 'px' }"
        />
      </g>
    </g>
  </svg>
</template>

<style scoped>
/* 铺在谱面内容上：坐标就是内容坐标（原点 = 滚动容器的 padding 边，与 `offsetTop` 同一处）。
   `pointer-events: none` —— 它只是一层画出来的线；**只有选中跳转工具时**（`.live`）
   才把可点的那条带子（`.hit`）自己收回来，这时它压住下面的小节线（见文件头注释） */
.jump-arcs {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
}
/* 整条箭头一个投影（画在 `<g>` 上，不是逐个 `>` 各投一次）：压在 PDF 谱面上要托起来一点，
   否则细笔画糊在五线谱里分不出来。`--mark-shadow` 是**完整的一条 `drop-shadow()` 值**
   （深浅两套各一档，见 main.css 的 `--mark-*` 那一组）。 */
.arrow {
  filter: drop-shadow(var(--mark-shadow));
}
/* 粗细由每个 `>` 自己的宽度给（`--chev-w` 从模板里带进来）——**必须走自定义属性**：
   直接写内联 `stroke-width` 的话，下面那两条加粗规则是 CSS，压不过内联样式。
   加粗倍数是**一个** `--chev-k`（常态 1），两种情形把它抬到 **1.7**：**鼠标停在上面**、
   以及**这条记号的 Sheet 正开着**（用户要求：打开 sheet 的那条用 hover 那种粗细）。
   常态是**半透明的那一档主题色**（`--accent-line`）：箭头压在谱面正文上，太重会盖住五线谱 */
.chev {
  fill: none;
  stroke: var(--accent-line);
  stroke-width: calc(var(--chev-w, 1px) * var(--chev-k, 1));
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 降级成灰：与 `ScorePage` 里 `.muted` 那套用同一个灰（`--mark-muted-line`）——
   两处各挑一档灰迟早会不一样。
   ⚠️ 必须排在下面 `.arrow.on` **之前**：两组选择器同分，谁在后面谁说了算 ——
   「Sheet 正开着的那一条」永远该是主题色 */
.jump-arcs.muted .chev {
  stroke: var(--mark-muted-line);
}
/* **Sheet 正开着的那一条**：实色主题色 + **与悬停同一档的粗细** */
.arrow.on {
  --chev-k: 1.7;
}
.arrow.on .chev {
  stroke: var(--accent);
}
/* 可点的那条带子：**含 `>` 之间的缝**（用户要求：点缝里也算点箭头）。
   `fill: none` + `pointer-events: all` —— 命中只按几何算，与填不填色无关。
   草稿不参与（它只是画着看的；拖动那一笔本来就被 `ScorePage` 的指针捕获拿着）。
   ⚠️ **不给它加 `cursor`**：谱面全程是系统默认箭头，两种手势模式都一样（docs/ui.md §18.37）。 */
.hit {
  fill: none;
}
.jump-arcs.live .arrow:not(.draft) .hit {
  pointer-events: all;
}
/* 悬停加粗（只在那条带子能点的时候亮）：颜色不变、只加粗 ——
   与谱面上那几条标记「常态 1.8pt → 悬停 3pt」是同一档手感（约 1.7 倍） */
.jump-arcs.live .arrow:not(.draft):hover {
  --chev-k: 1.7;
}
/* 拖拽中的草稿：还没落地，淡一档 —— 与谱面上那条待定起点的虚线是同一个意思 */
.arrow.draft .chev {
  opacity: 0.45;
}
</style>
