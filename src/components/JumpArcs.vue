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
 * **形状 = 一条弧线 + 末端一个箭头**（「→」那一种）：从**起点线上的落点**拱到**终点线上的落点**，
 * 拱高与两端横向距离挂钩（短距离也看得见弧度，跨页那种长距离不至于拱到天上）；
 * 末端方向 = 曲线在末端的切线，**箭头尖与终点线之间留 `ARC_GAP`**（尖压在线上就分不出「落到这儿」）。
 * 笔画粗细与 `ScorePage` 那条细竖线**同一档（1.8pt × 页面缩放）**，整条弧线**有一个投影**
 * （`--mark-shadow`，压在谱面上托起来一点才看得清）；**鼠标停在上面时加粗**、**Sheet 正开着的那一条
 * 加粗并且换成实色**（`--arc-k` 1.7，与竖线那一档 1.8pt → 3pt 对齐）—— 只加粗不换色，与谱面上
 * 那几条标记同一档手感。
 *
 * **可点区域比画出来的那条细线大得多**（用户要求）：沿同一条曲线另铺一条
 * **`--arc-hit`（= `--tap-min`，46px）宽的隐形带子**（`stroke: transparent` + `pointer-events: stroke`，
 * 见 `.hit`）—— 手指 / 鼠标不必压在那一两像素的笔画上。带子**画到真正的终点**为止，
 * 所以箭头尖与它前面那条缝也在里面。
 *
 * **页缝处断开**（用户要求）：整层套一个 `clipPath`，里面每页一个 `rect`（纸面盒子）——
 * 箭头只在纸面上可见，页与页之间的空隙里自动断成几截。跨页的那一段因此落在它经过的每一页上，
 * 而不是一条悬空的线。
 *
 * **只在编辑模式画**（与非编辑模式「谱面不带任何标记」同一条规矩）；当前工具不是跳转、
 * 或「标记列表」开着时降级成灰（与 `ScorePage` 那套 `.muted` 同一个灰）。
 *
 * **选中跳转工具时箭头可点**（用户要求）：点中那条带子 → 打开**那一条记号**的 Sheet
 * （正在「选择前置」时是把它设成前置）。这时那条带子**压住它下面的小节线** ——
 * 被压住的那一段点下去不会再新建（用户拍板）；
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
 * **这几个就是调箭头长相的全部旋钮**（其余几何都是从它们推出来的）：
 *   1. 笔画多粗             → `ARC_STROKE`（pt 档，与 `ScorePage` 的 `.jump-line` 同档）
 *   2. 箭头多大             → `ARC_HEAD` / `ARC_WING`（都是**笔画粗细的倍数**）
 *   3. 拱多高               → `arcFor` 里那一条 `lift`
 *   4. 尖与终点线留多宽的缝 → `ARC_GAP`
 *   5. 悬停 / Sheet 开着多粗 → CSS 里的 `--arc-k`（1.7）
 *   6. 可点的那条带子多宽   → CSS 里的 `--arc-hit`（= `--tap-min`，46px）
 */

/** 笔画粗细（pt 档）：与 `ScorePage` 的 `.jump-line` 同一档 1.8pt —— 乘页面缩放 `k` 就是 px */
const ARC_STROKE = 1.8
/** 箭头尖到两翼根部的长度 = 笔画粗细 × 它 */
const ARC_HEAD = 4
/** 两翼在垂直方向张开多少 = 笔画粗细 × 它 */
const ARC_WING = 1.9
/** 箭头尖与终点线之间留的缝（px）—— 压在线上就分不出「落到这儿」了 */
const ARC_GAP = 3

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
 * `k` 一并带回去：笔画粗细要按这一页的缩放折算（与那条细竖线同一档）。
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
  return { x: paperLeft(p) + bar.x * k, y: top + (bottom - top) * t, k }
}

/**
 * 一条跳转的箭头：`{ d, arrow, hit, w }` —— `d` 是那条二次贝塞尔弧线、`arrow` 是末端的箭头、
 * `hit` 是**可点的那条隐形带子**、`w` 是笔画粗细（px，含页面缩放）。
 *
 * 拱高 `lift` 与两端横向距离挂钩；控制点抬在两端之上，于是末端切线朝下 —— 箭头指的就是「落下来」的方向。
 * 箭头尖沿末端切线往回让开 `ARC_GAP`（免得压在终点线上），两翼从尖端往回、垂直于切线张开。
 * **带子画到真正的终点**（不是让开之后的尖）：箭头本身与那条缝也在可点范围里（用户要求：
 * 实际点击区域要比显示出来的箭头细线大）。
 */
function arcFor(a, b) {
  const w = ARC_STROKE * ((a.k + b.k) / 2)
  const lift = Math.max(18, Math.min(120, Math.abs(b.x - a.x) * 0.12))
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift }
  // 末端切线的单位向量（`Q` 在终点的切线方向 = 终点 − 控制点）
  const dx = b.x - c.x
  const dy = b.y - c.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const tip = { x: b.x - ux * ARC_GAP, y: b.y - uy * ARC_GAP }
  // 垂直方向 = 切线转 90°（`(-uy, ux)`）；两翼从尖端往回量
  const head = w * ARC_HEAD
  const wing = w * ARC_WING
  const bx = tip.x - ux * head
  const by = tip.y - uy * head
  return {
    d: `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${tip.x} ${tip.y}`,
    arrow: `M ${bx - uy * wing} ${by + ux * wing} L ${tip.x} ${tip.y} L ${bx + uy * wing} ${by - ux * wing}`,
    hit: `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`,
    w,
  }
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
    out.push({ id: jump.id, label: arcLabel(jump), ...arcFor(a, b) })
  }
  return out
})

/** 这条箭头叫什么（只给读屏用；谱面上的箭头本来只是一条线，没有文字） */
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
  return arcFor(a, b)
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
        :style="{ '--arc-w': a.w + 'px' }"
        :role="live ? 'button' : null"
        :aria-label="live ? a.label : null"
        @click="onPick(a.id)"
      >
        <!-- 可点的那条带子：**不画出来**（透明），只吃指针 —— 它比画出来的那条细线宽得多（`--arc-hit`）。
             `pointer-events: stroke` 让命中按几何算，与填不填色无关 -->
        <path :d="a.hit" class="hit" />
        <!-- 弧线 + 末端那个箭头：**画出来的只有这两条**（粗细、颜色都在 `.arc` 里） -->
        <path :d="a.d" class="arc" />
        <path :d="a.arrow" class="arc" />
      </g>
      <!-- 拖拽中的草稿：同一个形状、半透明，松手前就看得到它会落在哪儿 -->
      <g v-if="draft" class="arrow draft" :style="{ '--arc-w': draft.w + 'px' }">
        <path :d="draft.d" class="arc" />
        <path :d="draft.arrow" class="arc" />
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
  /* 可点带子的宽度 = 全站最小点击尺寸那一档（46px）—— **比画出来的那条细线宽得多**（用户要求） */
  --arc-hit: var(--tap-min, 46px);
}
/* 整条箭头一个投影（画在 `<g>` 上，不是弧线与箭头各投一次）：压在 PDF 谱面上要托起来一点，
   否则细笔画糊在五线谱里分不出来。`--mark-shadow` 是**完整的一条 `drop-shadow()` 值**
   （深浅两套各一档，见 main.css 的 `--mark-*` 那一组）。 */
.arrow {
  filter: drop-shadow(var(--mark-shadow));
}
/* 弧线与末端箭头：粗细由 `--arc-w` 给（JS 按页面缩放算好）、加粗倍数是一个 `--arc-k`（常态 1）。
   **必须走自定义属性**：直接写内联 `stroke-width` 的话，下面那两条加粗规则是 CSS，压不过内联样式。
   两种情形把 `--arc-k` 抬到 **1.7**：**鼠标停在上面**、以及**这条记号的 Sheet 正开着**
   （用户要求：打开 sheet 的那条用 hover 那种粗细）。
   常态是**半透明的那一档主题色**（`--accent-line`）：箭头压在谱面正文上，太重会盖住五线谱 */
.arc {
  fill: none;
  stroke: var(--accent-line);
  stroke-width: calc(var(--arc-w, 2px) * var(--arc-k, 1));
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 降级成灰：与 `ScorePage` 里 `.muted` 那套用同一个灰（`--mark-muted-line`）——
   两处各挑一档灰迟早会不一样。
   ⚠️ 必须排在下面 `.arrow.on` **之前**：两组选择器同分，谁在后面谁说了算 ——
   「Sheet 正开着的那一条」永远该是主题色 */
.jump-arcs.muted .arc {
  stroke: var(--mark-muted-line);
}
/* **Sheet 正开着的那一条**：实色主题色 + **与悬停同一档的粗细**（1.7 —— 1.8pt 那一档 → 3pt） */
.arrow.on {
  --arc-k: 1.7;
}
.arrow.on .arc {
  stroke: var(--accent);
}
/* 可点的那条带子：**不画出来**（透明）+ **比细线宽得多**（`--arc-hit`）。
   `pointer-events` 不在常态给 —— 它继承 `.jump-arcs` 的 `none`，只有 `.live` 那一条规则才收回来。
   `stroke` 是透明的也不影响命中：`pointer-events: stroke` 只按几何算，与涂不涂色无关。
   ⚠️ **不给它加 `cursor`**：谱面全程是系统默认箭头，两种手势模式都一样（docs/ui.md §18.37）。 */
.hit {
  fill: none;
  stroke: transparent;
  stroke-width: var(--arc-hit);
  stroke-linecap: round;
  stroke-linejoin: round;
}
.jump-arcs.live .arrow:not(.draft) .hit {
  pointer-events: stroke;
}
/* 悬停加粗（只在那条带子能点的时候亮）：颜色不变、只加粗 ——
   与谱面上那几条标记「常态 1.8pt → 悬停 3pt」是同一档手感（约 1.7 倍） */
.jump-arcs.live .arrow:not(.draft):hover {
  --arc-k: 1.7;
}
/* 拖拽中的草稿：还没落地，淡一档 —— 与谱面上那条待定起点的虚线是同一个意思 */
.arrow.draft .arc {
  opacity: 0.45;
}
</style>
