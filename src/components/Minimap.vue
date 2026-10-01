<script setup>
/**
 * 谱面总览（**浮在谱面右侧**的那一列，VS Code 代码预览那种 minimap）
 *  · 把 PDF 的**每一页用真实缩略图贴上来**：宽度顶满这一列、等比缩放（pdf.js 渲染，深色下跟整页视图一样反相），
 *    `k = 列宽 / 页的 CSS 宽`，文档里的每个纵向位置都乘它。**只渲染窗口上下半屏内的页**，长谱才不会一次渲染几十页。
 *    位置换算用 `PdfViewer` 量出来的真实布局（`model` / `mapPos`），**别自己再算一遍间距与内边距**。
 *    **别退回去用抽象方块画总览**（页矩形 + 行线那一版已被否掉：把 PDF 每一页贴上去）。
 *  · **蓝框钉在轨道正中间**，代表屏幕上正在显示的那一段；内容从它下面滑过去。
 *    所以内容上下各垫 `(轨道高 − 框高) / 2` 的空白，滚动范围才正好等于文档的滚动范围（见 `pad`）。
 *    映射 `scrollTop = (pos + 可视高/2) × k + pad − 轨道高/2`，反解 `pos = (scrollTop − pad + 轨道高/2) / k − 可视高/2`。
 *    **别把框改成跟着 pos 在轨道里上下跑**，也别去掉那段垫空白（去掉就会出现「文档已经到头、这一列还能继续滚」的空转和错位）。
 *  · **这一列是真正的滚动容器**（`.mini-scroll` = absolute inset 0 + 全局 `.scroll-y`，`.mini-inner` 用内联
 *    height 撑内容高）：听 scroll 把 scrollTop 换算成文档位置抛给 `PdfViewer`；它自己滚了（跟随播放 / 跳转）
 *    时再同步回来。写 scrollTop 时用 `progScroll` 记住自己设的值、忽略回声；`props.pos` 变化时若与
 *    `lastEmit` 相差 < 2px 就当回声忽略，否则才回写。
 *  · **拖动 = 1:1 跟手，松手即停、没有惯性**（惯性交给平台不现实、自己编又不像，索性不做）；
 *    滚轮 / 触控板仍然是原生滚动。点一下 = 把那一点挪到视口中央（走 `@click`；鼠标拖完浏览器也会发 click，
 *    所以拖过之后要用 `pannedAt` 把紧跟那次 click 吞掉）。`touch-action: none` 把触屏手势也拿过来。
 *  · **缩略图本身不画任何标记**（预览就是 PDF 每一页的原始内容），叠加物只有两样：
 *    钉在正中间的**蓝框**（屏幕上正在显示哪一段）与标记位置的**蓝色横线**（见 `marks`）。
 *    蓝线走的是缩略图**之上**的一层 DOM，不画进位图 —— 位图归 pdf.js 渲染，
 *    改了就得整页重渲染，而且深色下位图整体反相，画进去的线会被一起反相变色。
 *    **蓝框用实线、蓝线用虚线**：实线说「视口在哪」、虚线说「标记在哪」，这是两者的语义区分；
 *    虚线用 `repeating-linear-gradient(90deg, … 0 4px, transparent 4px 8px)` 画（4px 实 / 4px 空），
 *    **不要用 `border-style: dashed`**（线段长度由浏览器定、改不了）。蓝线层必须 `pointer-events: none`
 *    —— 它铺满整宽，收事件会把拖动截断。蓝框用 2px 实线 `--accent`，别用压在缩略图上差一档灰的 `--accent-line`。
 *    `marks` 的规则：**非编辑模式只有当前播放小节一条；编辑模式按当前工具逐条列**（行 = 每行一条、
 *    小节线 = 每条线一条、段落 / 跳转 = 每个标记一条），同一行里的多条 y 相同、视觉上叠成一条。
 *    （蓝线曾以「当前播放小节的 `--accent-mid` 横带」的形式存在过并被删掉，现在是按上面这条规则重新加回来的，
 *    别再当成「不该画的东西」删掉。）
 *  · **滚动条就是桌面端的「视觉把手」**：把浏览器自带的那条**显示出来并自己配色**
 *    （`::-webkit-scrollbar` 6px + Firefox 的 `scrollbar-width: thin` / `scrollbar-color`），
 *    **别自己画滑块**（由浏览器绘制、也由浏览器拖：拖滑块、点轨道翻页都是原生行为）。
 *    配 `scrollbar-gutter: stable` 把它的位置恒定占住，否则内容宽会随它出现 / 消失变化（k → innerH 跟着变），
 *    在临界点上会来回抖。
 *  · **布局量全按「内容宽」算**：`box.w` 取滚动容器的 `clientWidth`（已扣掉滚动条那条），
 *    `box.sb = 轨道 clientWidth − 内容宽` 是滚动条占的宽（覆盖式滚动条为 0），缩略图按 `box.w` 缩放、
 *    蓝框按 `box.sb` 右侧内缩。滚动条的出现**不改变轨道的盒子尺寸**、ResizeObserver 不会为它触发，
 *    所以那组尺寸 watch 里要顺手 `measure()` 一次。
 *  · **缩略图左右各内缩 `PAD_X = 5px`**（k 按 `box.w − 2×PAD_X` 算，页 left: PAD_X，蓝框也跟着左右对齐）：
 *    位图外面那圈描边 + 投影才有地方画出来，否则会被滚动容器的 `overflow-x: hidden` 裁掉。
 *  · **形状**：它是贴在屏幕右边的一条抽屉 —— 右边不留边距、只让开安全区，**右侧两个角是直角、只有左边两个圆**
 *    （`border-radius: var(--radius) 0 0 var(--radius)`），贴边那一侧不画描边（`border-right: 0`，
 *    否则那条 1px 线正好压在屏幕最外一列像素上）；上下让开自己那条悬浮胶囊与底栏胶囊。底色与左侧乐谱库
 *    侧栏同一档（`--surface-card`）。缩略图是一张张纸：`box-shadow: 0 0 0 1px var(--stroke-strong)` 收边 +
 *    `--shadow-1`（**别用 SVG 横线当页界**）。裁切层 `.mini-clip` 自己带（只圆左边的）`border-radius`，
 *    **别把 `overflow: hidden` 放到 `.mini-panel` 上** —— 那会把压在面板外面的调宽把手一起裁掉。
 *    收起 = 宽度归零 + **边框也归零**，整块彻底不占地方。
 *  · **它自己带一条三钮胶囊，放在这一列上面**（`.mini-dock` = `.capsule.glass`，边距与右下角那对底栏胶囊
 *    完全一样、一上一下落在同一条竖线上）：**整页 / 居中**（两个字，切 `settings.scrollMode`）、
 *    **翻页 / 标注**（切 `player.mode`，见下）、**收起 / 展开**。
 *    **默认是收起态**（`open` 初值 `false`）：这一列不打开时谱面右边是干净的，胶囊与右边缘那根把手
 *    是两条回头路。它收起**不写进 `settings`**、每次进播放页都回到收起，别改成「记住上次」。
 *    **收起 / 展开这一颗必须让人一眼看出「点它展开的是总览」**：展开时 `chevronRight` +「收起」，
 *    收起时换成 `panelRight` 图标 +「总览」，aria 分别是 `minimap.collapseAria` / `expandAria`；
 *    **别退回「固定 chevron + 只写『展开』」那版**（看不出展开的是什么）。**收起后这条胶囊还在**
 *    （要靠它再展开），所以它是独立的浮层、不属于面板。**切换钮不要常驻背景色**（别挂 `.on`）：
 *    这里没有「选中态」要表达，图标 + 那两个字已经说清现在是哪一种。
 *  · **中间那颗是「翻页 / 标注」**（原来这里是「定位」，2026 年这一轮换掉了）：
 *    · `hand` +「翻页」= `player.mode === 'pan'`（**默认**）—— 谱面这一层不接管拖动：
 *      触屏滑动就是原生滚谱、鼠标拖动由 `PdfViewer` 拖谱面；这一层只认「点一下」
 *      （**要框选 / 划行 / 放线得切标注**）；
 *    · `mousePointer` +「标注」= `'pointer'` —— 按下即跟手（非编辑框选、编辑划行 / 放线），不滚页。
 *    **鼠标与触屏同一套判据**（用户要求「使用鼠标时，翻页模式下能够拖动谱面」）：桌面上点它
 *    也有区别 —— 翻页是拖谱面、标注是框选 / 划线。它**只调 `store/player.js` 的 `setMode()`**，
 *    别的什么都不用在这里同步：图标的响应式 `pointerMode` 是同一个 computed，
 *    `ScorePage` 的手势策略、`PdfViewer` 的鼠标拖谱与「打开乐谱要不要贴合」也都读它。
 *    完整规则见 `ScorePage.vue` 头部的「手势策略」。
 *    **它不关编辑模式** —— 那是右上「编辑 / 完成」的事，这颗钮只切手势。
 *    **「定位」那一颗已经删掉**（连同 `emit('locate')` 与 `minimap.locate*` 两条文案），
 *    别再按旧文档把它加回来 —— 要「回到当前播放的小节」现在点谱面上的小节即可。
 *  · **浮层 + 宽度**：绝对定位压在谱面右边（z-index 低于底栏 24 与左上那颗胶囊 26），不占谱面宽度；
 *    宽度用左边那个把手拖（和乐谱库侧栏同一套手势：≥ 最小值 1:1 跟手，比最小值还窄就只看拖动方向
 *    —— 面板贴右边，**往左拖 = 变宽**，所以往右是收起、往左是展开；指针回到最小值以上立刻恢复跟手，
 *    别锁死在方向模式里）。收起后把手留在屏幕右边缘，点一下用上次的宽度展开；宽度存 `settings.minimapWidth`。
 *  · **改宽度时不许按新宽度重渲染**（那是每拖一像素画一遍整页），而是 `stretching` 状态顶着：
 *    位图**强行拉满**（`width/height: 100% !important`，压掉 pdf.js 写在 canvas 上的内联尺寸，否则会露出
 *    一条底）。**不要加模糊**（糊一片反而看不清拖到哪了）。松手后按 `renderedAt` 的记账补画，画完才撤掉拉满。
 *  · **同一页会被渲染两次**（整页视图 + 总览缩略图），所以 `PdfRenderer.render` 取消上一个任务时要按
 *    「页号:用处」记账，否则总览会把整页视图那次渲染取消掉、页面一片空白。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronRight, File, GalleryVertical, Hand, MousePointer2, PanelRight } from '@lucide/vue'
import { t } from '../i18n/index.js'
import { pointerMode, renderer, setMode } from '../store/player.js'
import { MINIMAP_DEFAULT, MINIMAP_MAX, MINIMAP_MIN, settings } from '../store/settings.js'

const props = defineProps({
  /** PdfViewer 给的布局模型：{ total: 内容总高, view: 可视高, pages: [{ index, top, height, scale, cssW, page }] } */
  model: { type: Object, required: true },
  /** 主视图当前 scrollTop。单独传：滚动时每帧都变，混进 model 会让整个预览重建 */
  pos: { type: Number, default: 0 },
  /** 谱面上「有主题色标记」的纵向位置：[{ page, y }]（y 是页内 PDF pt）。画成蓝色横线叠在缩略图上 */
  marks: { type: Array, default: () => [] },
  /**
   * 「播放时隐藏工具栏」：把这个布尔直接顶下来。**为什么不在组件里自己读一遍状态** —— 它就是
   * 「`player.playing` 且非编辑模式且设置开着」这三条的组合，判据只该有 `PdfViewer` 的 `barsHidden`
   * 一处（页面那几条顶栏也都按同一个值走），这里再算一遍迟早跟那边不一致。
   */
  barsHidden: { type: Boolean, default: false },
})
const emit = defineEmits(['scroll'])

/**
 * 展开 / 收起。**默认收起**：进播放页时这一列不打开（它只是滚动辅助，一进来就占着谱面右边
 * 挡掉一条谱），要靠上面那条胶囊里的「总览」钮、或屏幕右边缘那根把手拉出来。
 * 收起**不持久化**（`settings` 里没有它的开关）—— 换谱 / 刷新后回到收起态，这是有意的：
 * 「默认不打开」说的是**每一次打开播放页的初始样子**，不是「记住上次」。
 */
const open = ref(false)
const dragging = ref(false)
/** 缩略图还没按新宽度重画（正在拖宽度 / 刚拖完）：这段时间先把位图硬拉满 */
const stretching = ref(false)
const width = ref(settings.minimapWidth >= MINIMAP_MIN ? settings.minimapWidth : MINIMAP_DEFAULT)
const track = ref(null)
const scroller = ref(null)
/**
 * 轨道尺寸。
 *  · `w` 是**内容宽**（取自滚动容器的 clientWidth，已经扣掉滚动条占的那一条），缩略图按它缩放；
 *  · `h` 是轨道高；
 *  · `sb` 是滚动条占的宽（覆盖式滚动条时为 0），蓝框要按它内缩，免得压到滚动条上。
 */
const box = ref({ w: 0, h: 0, sb: 0 })
/** 组件认的文档位置：用户滚这一列时由它推出来，否则跟着 props.pos */
const localPos = ref(props.pos)
const canvases = new Map()
const renderedAt = new Map() // 页号 -> 已按哪个宽度渲染过
let ro = null
let renderToken = 0
let renderTimer = 0
/** 我们自己写进 scrollTop 的值：用来忽略那次滚动产生的回声，别把文档又推回去 */
let progScroll = -1
/** 最近一次推给父组件的位置：用来分辨「回声」和「父组件自己滚的」 */
let lastEmit = null
let drag = null // 拖动中：{ y0, s0, moved }
let pannedAt = 0 // 刚拖过：紧跟着的 click 要吞掉（鼠标拖完浏览器也会发 click）

/* ------------------------------- 几何 ------------------------------- */

/** 缩略图左右各自内缩这么多：位图要留出「描边 + 投影」的地方，否则会被滚动容器裁掉 */
const PAD_X = 5

const total = computed(() => Math.max(0, props.model.total || 0))
const view = computed(() => Math.max(0, props.model.view || 0))
const docMax = computed(() => Math.max(0, total.value - view.value))
const modelPages = computed(() => props.model.pages || [])

/**
 * 缩略图等比缩放系数：让最上面那一页正好顶满这一列的**内容宽**（内容宽两侧还要各留 PAD_X）。
 * 文档里的每个纵向位置都乘它 —— 页的落点、行、小节，全都还在同一条比例尺上。
 */
const k = computed(() => {
  const cssW = modelPages.value[0]?.cssW || 0
  const avail = box.value.w - PAD_X * 2
  return cssW > 0 && avail > 0 ? avail / cssW : 0
})

/** 整本内容按 k 缩下来的高度（文档坐标 × k，不做任何平移） */
const innerH = computed(() => Math.max(0, Math.round(total.value * k.value)))

/** 蓝框高度 = 可视区缩下来的高度；轨道比它还矮时就铺满轨道 */
const frameH = computed(() => Math.min(box.value.h, Math.max(14, view.value * k.value)))

/**
 * 内容上下垫的空白 = 轨道比蓝框多出来的那一半。
 * 有了它，`scrollTop` 的可滚范围才**正好**等于文档的可滚范围：
 *   蓝框中心对应的文档位置 = scrollTop / k（推导见 syncStrip / onStripScroll），
 *   两端也就不会出现「文档已经到头、这一列还能继续滚」的空转。
 */
const pad = computed(() => Math.max(0, (box.value.h - frameH.value) / 2))

const contentH = computed(() => pad.value * 2 + innerH.value)
const maxScroll = computed(() => Math.max(0, contentH.value - box.value.h))

/** 每一页缩略图在内容里的落点与尺寸（左右各内缩 PAD_X，给描边和投影留地方） */
const thumbs = computed(() =>
  modelPages.value.map((p) => ({
    index: p.index,
    top: pad.value + p.top * k.value,
    width: Math.max(1, p.cssW * k.value),
    height: Math.max(1, p.height * k.value),
  }))
)

/** 蓝框：钉在正中间，只表示「屏幕上现在显示这一段」。它和标记蓝线是两回事：
    蓝框说的是**视口**在哪，蓝线说的是**谱面的标记**在哪（见 markTops） */
const frame = computed(() => ({ top: (box.value.h - frameH.value) / 2, height: frameH.value }))

/**
 * 「有主题色标记」的那些位置的蓝线（内容坐标）。
 * 换算 = 上下垫的空白 + 文档位置 × k，文档位置 = 该页落点 + 页内 pt × 该页的显示缩放。
 * **只做位置换算，不往缩略图位图里画**：位图是 pdf.js 渲染的，想改就得整页重渲染；
 * 而且深色模式下位图整体反相，画进去的线会被一起反相变色。
 */
const markTops = computed(() => {
  if (!k.value) return []
  const byIndex = new Map(modelPages.value.map((p) => [p.index, p]))
  const out = []
  for (const mk of props.marks) {
    const p = byIndex.get(mk.page)
    if (!p) continue
    // `mk.y` 是 meta 的 y-up，缩略图里是 y-down —— 要翻一次（`页高 − y`，与 `PdfViewer.placeBand`
    // 同一个规矩，见 docs/invariants.md §1），不翻这根蓝线会在页内上下镜像
    out.push(Math.round(pad.value + (p.top + ((p.page?.height || 841.89) - mk.y) * p.scale) * k.value))
  }
  return out
})

/* --------------------------- 滚动：两个方向 --------------------------- */
/*
 * 蓝框中心恒在轨道高的一半处。设 scrollTop = s，则框中心在内容里的坐标 = s + 轨道高/2，
 * 减去上垫的空白 pad 就是页面内容坐标，再除以 k 就是文档坐标：
 *     文档位置(框中心) = (s + 轨道高/2 − pad) / k
 * 反过来（要让文档的**可视区中心**落在框中心）：
 *     s = (pos + 可视高/2) × k + pad − 轨道高/2
 */

function stripScrollFor(pos) {
  return Math.round((pos + view.value / 2) * k.value + pad.value - box.value.h / 2)
}

/** 文档位置 -> 这一列该滚到哪 */
function syncStrip(force = false) {
  const el = scroller.value
  if (!el || !k.value) return
  const next = Math.max(0, Math.min(stripScrollFor(localPos.value), maxScroll.value))
  if (!force && Math.abs(el.scrollTop - next) < 2) return
  progScroll = next
  el.scrollTop = next
  // 没滚到位（被浏览器夹住了）：别让它继续冒充「我们设的」
  if (Math.abs(el.scrollTop - next) > 2) progScroll = -1
}

/** 用户滚了（自己拖的 / 滚轮 / 原生惯性）：换成文档位置推上去 */
function onStripScroll() {
  const el = scroller.value
  if (!el || !k.value) return
  const s = el.scrollTop
  if (Math.abs(s - progScroll) < 2) return // 我们自己设的，忽略回声
  progScroll = -1
  applyPos((s - pad.value + box.value.h / 2) / k.value - view.value / 2)
}

function applyPos(px) {
  const next = Math.max(0, Math.min(px, docMax.value))
  localPos.value = next
  lastEmit = next
  emit('scroll', next)
}

/* ------------------------------- 手势 ------------------------------- */
/*
 * **拖动 = 1:1 跟手，松手即停、没有惯性**：手一松就停在原地。
 * 惯性不做 —— 手搓的衰减曲线不像平台（iOS 是指数、Android 是另一套样条），
 * 而「拖到哪停到哪」是不会有意外的手感。滚轮 / 触控板交给浏览器原生滚动（`touch-action: none`
 * 只挡住触屏手势，不影响滚轮）。
 */

function onDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const el = scroller.value
  if (!el) return
  drag = { y0: e.clientY, s0: el.scrollTop, moved: false }
  try {
    track.value?.setPointerCapture?.(e.pointerId)
  } catch {}
  e.preventDefault()
}

function onMove(e) {
  if (!drag) return
  const el = scroller.value
  if (!el) return
  const dy = e.clientY - drag.y0
  if (!drag.moved && Math.abs(dy) > 3) drag.moved = true
  progScroll = -1 // 这是用户在拖，回声照常当用户滚动处理
  el.scrollTop = drag.s0 - dy
  e.preventDefault()
}

function onUp() {
  if (!drag) return
  if (drag.moved) pannedAt = performance.now()
  drag = null
}

/** 点一下 = 把那一点挪到视口中央（拖动后浏览器也会发 click，所以要用 pannedAt 吞掉） */
function onTrackClick(e) {
  if (performance.now() - pannedAt < 260) return
  const r = track.value?.getBoundingClientRect()
  const el = scroller.value
  if (!r || !el || !k.value) return
  const contentY = el.scrollTop + (e.clientY - r.top) - pad.value
  applyPos(contentY / k.value - view.value / 2)
  syncStrip()
}

/* ---------------------------- 缩略图渲染 ---------------------------- */

function setCanvas(i, el) {
  if (el) canvases.set(i, el)
  else canvases.delete(i)
}

/** 只渲染窗口上下半屏内的页：长谱也不会一次性渲染几十页、把内存吃光 */
async function ensureRendered() {
  const r = renderer.value
  const el = scroller.value
  if (!r || !el || !k.value || !innerH.value) {
    stretching.value = false // 没得画也要把「强行拉满」收掉
    return
  }
  const top = el.scrollTop
  const bottom = el.scrollTop + box.value.h
  const margin = box.value.h * 0.5
  const token = ++renderToken
  for (const th of thumbs.value) {
    if (token !== renderToken) return
    if (th.top > bottom + margin || th.top + th.height < top - margin) continue
    const cv = canvases.get(th.index)
    const w = Math.round(th.width)
    if (!cv || !w || renderedAt.get(th.index) === w) continue
    renderedAt.set(th.index, w) // 先记账：同一页不会被重入的调用重复渲染
    try {
      const res = await r.render(th.index + 1, cv, w, null, { slot: 'mini', pixelRatio: 2 })
      // 被取消（返回 null，双缓冲下画布上还是上一张图）= 这一页**没画成**，
      // 把记账撤掉、下一遍补（不撤的话它会一直以为自己是新宽度，缩略图就旧了）
      if (!res) renderedAt.delete(th.index)
    } catch {
      renderedAt.delete(th.index)
    }
  }
  // 这一遍画完，可见的页都是新宽度了，可以撤掉强行拉满
  if (token === renderToken) stretching.value = false
}

/**
 * 补渲染用**节流**而不是防抖：连续滚动（尤其跟随播放）时防抖会把定时器一直往后推，
 * 结果整条总览在播放期间一直是空的。已经排上了就不再推迟，到点就补一次。
 * 拖宽度期间直接跳过（那时候应该先拉满顶着），松手后再补。
 */
function scheduleRender(delay = 120) {
  if (renderTimer) return
  renderTimer = setTimeout(() => {
    renderTimer = 0
    if (!dragging.value) ensureRendered()
  }, delay)
}

/* ------------------------------- 交互 ------------------------------- */

/** 悬浮胶囊：整页 / 居中 互切（原来在「设置」面板里，搬到这儿随手可点） */
function toggleMode() {
  settings.scrollMode = settings.scrollMode === 'page' ? 'center' : 'page'
}

/**
 * 悬浮胶囊：谱面手势 翻页 ↔ 标注。
 * 只切 `player.mode`（`setMode` 会顺手清框选 / 停循环），**其余什么都不用在这里维护**：
 * `ScorePage` 的 touch-action 与 `drag.own`、`PdfViewer` 的鼠标拖谱与「打开乐谱要不要贴合」，
 * 都读同一个 `pointerMode`。
 */
function toggleGesture() {
  setMode(pointerMode.value ? 'pan' : 'pointer')
}

function toggleOpen() {
  open.value = !open.value
  // 展开时把宽度收回来（越界就回落到默认宽度）；收起保留宽度，下次还用这个宽度
  if (open.value && width.value < MINIMAP_MIN) applyWidth(MINIMAP_DEFAULT)
}

function applyWidth(v) {
  width.value = Math.max(0, Math.min(MINIMAP_MAX, v))
  settings.minimapWidth = width.value
}

/**
 * 拖面板左边缘（与乐谱库侧栏那根**同一套手势**）：
 *  · 宽度 ≥ `MINIMAP_MIN`：跟手（`dragging` 关掉过渡、`stretching` 强行拉满位图）；
 *  · 比 `MINIMAP_MIN` 还窄：**不再看宽度、只看拖动方向**（差 3px 以内当抖动，不动状态）——
 *    两个方向都只是**改 `open` + 把跟手关掉**，宽度由**同一段过渡**演过去：往展开方向 → 展开，
 *    往收拢方向 → 收起（所以「收」和「展」是同一条动画，没有瞬间跳变）；
 *    指针一旦回到 `MINIMAP_MIN` 以上就立刻恢复 1:1 跟手。
 *  · 收起状态下点一下（没拖动）用上次的宽度展开。
 */
function startResize(e) {
  e.preventDefault()
  dragging.value = true
  stretching.value = true // 立刻开始「强行拉满」，不用等尺寸真的变了
  const startX = e.clientX
  const startW = open.value ? width.value : 0
  let moved = false
  /** 方向模式下的判向基准：每次变状态就挪到当前位置，于是 3px 的抖动不会来回翻 */
  let anchorX = startX

  const move = (ev) => {
    if (Math.abs(ev.clientX - startX) > 4) moved = true
    // 面板在右边：往左拖 = 变宽，所以位移取反
    const w = startW - (ev.clientX - startX)

    if (w >= MINIMAP_MIN) {
      dragging.value = true
      stretching.value = true
      anchorX = ev.clientX
      if (!open.value) open.value = true
      applyWidth(w)
      return
    }

    // 比 MINIMAP_MIN 还窄：只看方向
    if (Math.abs(ev.clientX - anchorX) < 3) return
    const dir = ev.clientX < anchorX ? 1 : -1 // 面板在右边：往左 = 展开
    anchorX = ev.clientX
    // 展开 / 收起都**只改状态**：把跟手与「强行拉满」都关掉，宽度交给那段过渡演
    dragging.value = false
    stretching.value = false
    open.value = dir > 0
  }

  const cleanup = () => {
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', cleanup)
    window.removeEventListener('pointercancel', cleanup)
    if (!moved && !open.value) {
      if (width.value < MINIMAP_MIN) applyWidth(MINIMAP_DEFAULT)
      open.value = true
    }
    nextTick(() => {
      measure()
      scheduleRender(0)
    })
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', cleanup)
  window.addEventListener('pointercancel', cleanup)
}

/* ------------------------------- 尺寸 ------------------------------- */

function measure() {
  const el = track.value
  const sc = scroller.value
  if (!el) return
  const h = el.clientHeight
  // 内容宽取滚动容器的 clientWidth：它已经扣掉滚动条（含 scrollbar-gutter 留的那条）
  const w = sc ? sc.clientWidth : el.clientWidth
  const sb = Math.max(0, el.clientWidth - w)
  if (w !== box.value.w || h !== box.value.h || sb !== box.value.sb) box.value = { w, h, sb }
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(measure)
    ro.observe(track.value)
  }
  nextTick(() => {
    syncStrip(true)
    ensureRendered()
  })
})

onBeforeUnmount(() => {
  ro?.disconnect()
  clearTimeout(renderTimer)
  renderToken++
})

// 父组件自己滚了（跟随播放 / 跳转）：同步过来。
// 是我们刚推过去的回声（值一样）就忽略，否则每次都会回写一遍、跟原生滚动打架。
watch(
  () => props.pos,
  (v) => {
    if (lastEmit != null && Math.abs(v - lastEmit) < 2) return
    localPos.value = v
    syncStrip()
  }
)

// 尺寸 / 宽度变过：k 或滚动范围跟着变，按新布局重新对位。
// 这里也顺手 measure()：滚动条是否占地方会影响内容宽（box.w），而它不改变轨道的盒子尺寸、
// ResizeObserver 不会为它触发。`scrollbar-gutter: stable` 下这条只在第一次收敛，不会来回抖。
watch([k, innerH, () => box.value.h, () => box.value.w, () => box.value.sb], () => {
  measure()
  syncStrip(true)
  scheduleRender(60)
})

// 换 PDF（renderer 换实例）或**页宽之间的比例**变了（换显示方式）：按新宽度整批重画。
// ⚠️ **只认比例、不认绝对页宽** —— 谱面缩放（1×–4×，见 `docs/ui.md` §18.68）让所有页一起等比变大，
// 缩略图宽度（`p.cssW × k`，两者同时变）**根本没变**，跟着重画纯属白烧几页 pdf.js 渲染。
watch(
  [renderer, () => modelPages.value.map((p) => (p.cssW / (modelPages.value[0]?.cssW || 1)).toFixed(4)).join(',')],
  () => {
    renderedAt.clear()
    stretching.value = true
    nextTick(() => {
      measure()
      syncStrip(true)
      scheduleRender(0)
    })
  }
)
</script>

<template>
  <!-- 侧栏自己的悬浮胶囊：整页 / 居中 · 定位 · 收起 / 展开。
       和左侧那个圆钮一样是「浮在谱面上的控制」，所以收起侧栏后它还在（要靠它再展开）。
       「显示按钮文字」这个设置**统一管三处胶囊**，这里也跟着关文字（规则在全局 .no-labels） -->
  <div
    class="mini-dock capsule glass"
    :class="{ 'no-labels': !settings.showButtonLabels, 'bars-hidden': barsHidden }"
  >
    <button
      type="button"
      class="cap-btn"
      :aria-label="t('minimap.modeAria')"
      @click="toggleMode"
    >
      <component :is="settings.scrollMode === 'center' ? GalleryVertical : File" :size="21" />
      <span class="cap-label">{{ settings.scrollMode === 'center' ? t('minimap.modeCenter') : t('minimap.modePage') }}</span>
    </button>
    <button type="button" class="cap-btn" :aria-label="t('minimap.gestureAria')" @click="toggleGesture">
      <component :is="pointerMode ? MousePointer2 : Hand" :size="21" />
      <span class="cap-label">{{ pointerMode ? t('minimap.gesturePointer') : t('minimap.gesturePan') }}</span>
    </button>
    <button
      type="button"
      class="cap-btn"
      :aria-label="open ? t('minimap.collapseAria') : t('minimap.expandAria')"
      @click="toggleOpen"
    >
      <!-- **收起时要说清点它展开的是什么**（用户提的）：图标画出「右边多出一条」的样子
           （`PanelRight`）、文字直接写「总览」——和同一条胶囊里的「整页 / 居中 / 定位」一个风格。
           展开时东西就在眼前，说动作（收起 + `ChevronRight`）就够了 -->
      <component :is="open ? ChevronRight : PanelRight" :size="21" />
      <span class="cap-label">{{ open ? t('common.collapse') : t('minimap.title') }}</span>
    </button>
  </div>

  <aside
    class="mini-panel"
    :class="{ collapsed: !open, dragging, stretching }"
    :style="{ width: (open ? width : 0) + 'px' }"
  >
    <!-- 内容按固定宽度排版、由 .mini-clip 裁切：收起动画时缩略图不会重排 -->
    <div class="mini-clip">
      <div class="mini-body" :style="{ width: width + 'px' }">
        <div
          ref="track"
          class="mini-track"
          role="scrollbar"
          aria-orientation="vertical"
          :aria-label="t('minimap.trackAria')"
          :aria-valuemin="0"
          :aria-valuemax="Math.round(docMax)"
          :aria-valuenow="Math.round(Math.min(localPos, docMax))"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
          @click="onTrackClick"
        >
          <!-- 滚动容器：拖它由我们接管（1:1 跟手），滚轮仍走浏览器原生 -->
          <div ref="scroller" class="mini-scroll scroll-y" @scroll.passive="onStripScroll">
            <div class="mini-inner" :style="{ height: contentH + 'px' }">
              <!-- 左右各内缩 PAD_X：位图外面那圈描边 + 投影才有地方显示（不然被滚动容器裁掉） -->
              <div
                v-for="th in thumbs"
                :key="th.index"
                class="mini-page"
                :style="{ left: PAD_X + 'px', top: th.top + 'px', width: th.width + 'px', height: th.height + 'px' }"
              >
                <canvas :ref="(el) => setCanvas(th.index, el)" class="mini-thumb" />
              </div>
              <!-- 标记蓝线层：叠在缩略图**之上**的一层，不画进位图里
                   （位图归 pdf.js 渲染，改了就得整页重渲染，深色下还会被一起反相）。
                   左右与页面对齐，右侧让开滚动条那条。 -->
              <div
                class="mini-marks"
                :style="{ left: PAD_X + 'px', right: box.sb + PAD_X + 'px' }"
              >
                <span v-for="(t, i) in markTops" :key="i" class="mini-mark" :style="{ top: t + 'px' }" />
              </div>
            </div>
          </div>
          <!-- 蓝框：钉在正中间，只表示「屏幕上现在显示这一段」；左右和页面对齐，右侧再让开滚动条 -->
          <div
            class="mini-view"
            :style="{
              top: frame.top + 'px',
              height: frame.height + 'px',
              left: PAD_X + 'px',
              right: box.sb + PAD_X + 'px',
            }"
          />
        </div>
      </div>
    </div>
    <!-- 一个把手管三件事：展开时拖宽 / 拖太窄即收起 / 收起后从屏幕右边缘拉出来 -->
    <div
      class="mini-resizer"
      role="separator"
      :aria-label="open ? t('minimap.resizeAria') : t('minimap.expandAria')"
      @pointerdown="startResize"
    />
  </aside>
</template>

<style scoped>
/* 浮层：压着谱面右边，不占谱面宽度；层级低于底栏胶囊（24）与左上圆钮（26）。
   它是一条**贴在屏幕右边缘的抽屉**：右边不留边距（只让开安全区）、右侧两个角是直角，
   只有左边两个角是圆的。底色与左侧乐谱库侧栏同一档（--surface-card），两边看起来是一套东西 */
.mini-panel {
  position: absolute;
  /* 顶到上面那条三钮胶囊下面（胶囊：safe-t + 8，高约 58，再留 8 的间距） */
  top: calc(var(--safe-t) + 74px);
  right: var(--safe-r);
  /* 让开底下的底栏胶囊（58 + 8 + 8） */
  bottom: calc(var(--safe-b) + 74px);
  z-index: 23;
  display: flex;
  flex-direction: row;
  background: var(--surface-card);
  border: 1px solid var(--stroke-soft);
  /* 贴边那一侧不画线：线会正好压在屏幕最外面一条像素上，看着像脏边 */
  border-right: 0;
  border-radius: var(--radius) 0 0 var(--radius);
  box-shadow: var(--shadow-2);
  transition: width 0.22s var(--ease), border-width 0.22s var(--ease);
}
/* 收起 = 宽度归零 + 边框归零，整块彻底不占地方（把手另算，它在面板外面） */
.mini-panel.collapsed {
  border-width: 0;
}
/* 拖动中关掉过渡，否则宽度跟不上指针（不再需要禁选中 —— 全站都已禁，见 main.css） */
.mini-panel.dragging {
  transition: none;
}
/* 裁切层跟着圆角走。**不能**把 overflow: hidden 放在 .mini-panel 上 —— 那样会把
   压在外面的调宽把手（left: -7px）一起裁掉 */
.mini-clip {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  /* 只圆左边两个角，与 .mini-panel 一致 */
  border-radius: calc(var(--radius) - 1px) 0 0 calc(var(--radius) - 1px);
}
.mini-body {
  flex: none;
  display: flex;
  padding: 6px;
}
.mini-track {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
/*
 * 滚动容器：`overflow-y / overscroll-behavior / iOS 惯性` 都用全局 `.scroll-y`（别自己再写一遍）。
 * 这里 `touch-action: none` —— 拖动**由组件接管**（1:1 跟手、松手即停），所以不能让浏览器同时
 * 也去滚一次；滚轮不受 touch-action 影响，照旧是原生滚动。
 * 右边缘那条滚动条是**浏览器自己画、自己拖**的，别自己再画一个滑块。
 * `scrollbar-gutter: stable` 让它的位置恒定占住 —— 否则内容宽会随它的出现 / 消失变来变去
 * （`k` 跟着变、`innerH` 跟着变），在临界点上会来回抖。
 */
.mini-scroll {
  position: absolute;
  inset: 0;
  overflow-x: hidden;
  scroll-behavior: auto;
  touch-action: none;
  scrollbar-gutter: stable;
  scrollbar-width: thin; /* Firefox */
  scrollbar-color: var(--stroke-strong) transparent;
}
.mini-scroll::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.mini-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.mini-scroll::-webkit-scrollbar-thumb {
  background: var(--stroke-strong);
  border-radius: 3px;
}
/* hover 在前、按下在后：滑块的按下态用主题色，一眼看得出抓住了 */
.mini-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}
.mini-scroll::-webkit-scrollbar-thumb:active {
  background: var(--accent);
}
/* 内容高度 = 上下垫的空白 + 缩略图总高（内联写死），上下垫的空白让滚动范围正好等于文档范围 */
.mini-inner {
  position: relative;
}
/* 一页就是一张纸：外圈一道描边 + 一点投影，白底上才分得出一页一页 */
.mini-page {
  position: absolute;
  left: 0;
  box-shadow: 0 0 0 1px var(--stroke-strong), var(--shadow-1);
}
/* 和整页视图一样是白纸渲染出来的位图，深色模式下一起反相 */
.mini-thumb {
  display: block;
  width: 100%;
  height: 100%;
  filter: var(--pdf-invert, none);
}
/* 标记蓝线层：铺满内容高，只做叠加。**不吃指针事件** —— 点 / 拖仍归 .mini-track，
   否则这些线会把拖动截断（它们虽然细，但铺满整宽） */
.mini-marks {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
}
/* 一条主题色**虚线**横线 = 谱面上一个「有主题色标记」的位置。
   用虚线是为了和实线的蓝框区分开：**实线说的是「视口在哪」，虚线说的是「标记在哪」**。
   再配一档颜色差（虚线用浅一档的 `--accent-line`，蓝框用实色 `--accent`）——
   虚实是给「形状」上的区分，颜色是给「强调程度」上的区分，两条一起才不至于看成一类东西。
   虚线用 repeating-linear-gradient 画（不用 border-style: dashed）—— 后者的线段长度由浏览器定，
   改不了；这里 4px 实 / 4px 空，缩放时看着稳定。
   `margin-top: -1px` 让线的**中心**落在算出来的位置上，而不是从它往下长 */
.mini-mark {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  margin-top: -1px;
  background: repeating-linear-gradient(90deg, var(--accent-line) 0 4px, transparent 4px 8px);
}
/* 可视范围（蓝框）：钉在正中间，实线 --accent 描边，一眼看得出框住了哪一段。
   它是这一列里**唯一的叠加物** —— 缩略图上不画任何标记，就是 PDF 每页的原始内容 */
.mini-view {
  position: absolute;
  left: 0;
  right: 0;
  border: 2px solid var(--accent);
  border-radius: 3px;
  background: var(--accent-weak);
  pointer-events: none;
  transition: background 0.12s ease;
}
/* 改宽度时缩略图还没按新宽度重画：**先把位图强行拉满**，别让右边露出一条底。
   （不加模糊：糊一片反而看不清自己在拖到哪。） */
.mini-panel.stretching .mini-thumb {
  width: 100% !important;
  height: 100% !important;
}
/* **这一列没有悬停态**：鼠标移进总览条时蓝框底色不变，只有按下才提到 --accent-line */
.mini-track:active .mini-view {
  background: var(--accent-line);
}

/* 侧栏自己的悬浮胶囊（整页/居中 · 定位 · 收起）：放在这一列**上面**，
   边距走 `--glass-inset-*`（只有那一处定义）—— 与右下角那对底栏胶囊**完全一样**，
   一上一下同一条竖线，看起来才是一套控件。
   `transform` 只用来做「播放时隐藏工具栏」（`PdfViewer` 的 `barsHidden` prop）：**往上平移出屏幕**，
   不是淡出。偏移量要比自身高度还多 —— 它钉在 `--glass-inset-t`（= safe-t + 8）上，
   只写 `-100%` 会露出顶上那 8px + 安全区那一条。宽度（总览面板）与把手不跟着动，
   收起后那根把手仍然留在屏幕右边缘（那是「把总览拉出来」的入口，工具栏藏起来也不该一起走）。
   **类名用 `.bars-hidden`、不要写成 `.hidden`**：本组件里 `.hidden` 这个词很危险，
   `PlayerView` 那份 scoped 的 `.hidden { display: none }` 会命中所有同名元素（原因见那边的注释）。 */
.mini-dock {
  position: absolute;
  right: var(--glass-inset-r);
  top: var(--glass-inset-t);
  z-index: 25;
  transition: transform var(--side-io) var(--ease);
}
.mini-dock.bars-hidden {
  transform: translateY(calc(-100% - var(--glass-inset-t) - 8px));
}

/* 把手：压在面板那条 1px 边框上（与乐谱库侧栏的 .side-resizer 同一套形态与颜色） */
.mini-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -7px;
  width: 14px;
  cursor: col-resize;
  touch-action: none;
  z-index: 27;
}
/* 收起后把手改贴在屏幕右边缘，成为「拉出总览」的入口 */
.mini-panel.collapsed .mini-resizer {
  left: auto;
  right: var(--safe-r);
}
/* 边框上那条线：hover 时显示成灰色，像素位置与拖动时的主题色线完全重合 */
.mini-resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 5px;
  width: 2px;
  background: var(--stroke-strong);
  opacity: 0;
  transition: opacity 0.12s ease;
}
/* hover 与按下**形态完全一样**，只换颜色：灰 → 主题色 */
.mini-resizer:hover::before {
  opacity: 1;
}
.mini-resizer::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 6px;
  width: 2px;
  height: 46px;
  margin-top: -23px;
  border-radius: 2px;
  background: var(--stroke-strong);
  transition: background 0.15s ease, width 0.15s ease, height 0.15s ease, margin-top 0.15s ease;
}
.mini-resizer:hover::after {
  background: var(--stroke-strong);
  width: 3px;
  height: 64px;
  margin-top: -32px;
}
.mini-resizer:active::after,
.mini-panel.dragging .mini-resizer::after {
  background: var(--accent);
  width: 3px;
  height: 64px;
  margin-top: -32px;
}
.mini-panel.dragging .mini-resizer::before {
  opacity: 0; /* 主题色线已经画在面板上了，灰线让开 */
}
.mini-panel.dragging::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  background: var(--accent);
}
/* 收起后没有边框可画线：把手自己就是入口，hover 灰、按下主题色 */
.mini-panel.collapsed .mini-resizer::before {
  display: none;
}
.mini-panel.collapsed .mini-resizer::after {
  left: 3px;
  width: 3px;
  height: 56px;
  margin-top: -28px;
  background: var(--stroke-strong);
}
.mini-panel.collapsed .mini-resizer:hover::after {
  background: var(--stroke-strong);
  height: 72px;
  margin-top: -36px;
}
.mini-panel.collapsed .mini-resizer:active::after {
  background: var(--accent);
  height: 72px;
  margin-top: -36px;
}
</style>
