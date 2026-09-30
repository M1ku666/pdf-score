<script setup>
/**
 * 乐谱视图：整本 PDF 垂直滚动 + 按需渲染 + 跟随播放滚动
 *  显示整页（scrollMode='page'）：页高顶满「两条工具栏之间」那一段可视区，播放到一行末尾时露出下一页第一行，
 *                                 播到下一页第一行时又把该页完整显示出来
 *                                 （末行露出的量按**下一页第一行的下沿**算，见 `peekHeight()` ——
 *                                  只按行高留的话第一行会压在底栏后面；下沿一律取 `Math.min(y0, y1)`，
 *                                  两种写法见 docs/invariants.md §1。落点**不再额外上移**，
 *                                  见 `placeBand()` 里那一支的注释）
 *  始终居中（scrollMode='center'）：页宽顶满，当前播放行始终位于可视区中央
 *  **两条工具栏都算进「可视区」**：底栏那对胶囊（`.bottom`）与顶部那两条（`.back-dock` / `.mini-dock`）
 *  都是浮在谱面上的，所以 scale（pageScale）、页边距（paddings）与两种显示方式的落点（placeBand）
 *  一律按 `reserved`（下）+ `reservedTop`（上）扣掉之后再算 —— 少扣一个，页面就会被压在胶囊底下。
 *  两者都从真实 DOM / `--glass-inset-*` 量出来，别在算式里写死数字。
 *  **meta 是 y-up、DOM 是 y-down**：落点算式里凡是拿 `y0` / `y1` 当屏幕距离，都要先翻一次
 *  （`页高 − y`），见 docs/invariants.md §1。漏翻 → 「始终居中」把当前这一行摆到上下镜像的位置上。
 *  ⚠️ **「播放时隐藏顶栏」时 `reservedTop` 不归零**：顶栏只是平移出屏幕，谱面的可视区仍旧按
 *  它在的时候算 —— 不然每次开关顶栏整本谱都要重排（页跳大小、滚动位置也跳）。见 docs/ui.md §18.38。
 *  「滚动动画」开着时自己用 rAF 做 340ms 缓动，关掉就直接跳到位（不用浏览器 smooth，时长不可控）
 *  右侧浮着一列 `Minimap`（谱面总览滚动条，不占谱面宽度）：它的位置换算要用这里的真实布局，
 *  所以由这里把它量出来喂过去（`map` / `mapPos`：页的落点读真实 DOM 的 offsetTop / offsetHeight，
 *  **别在 Minimap 里自己再算一遍间距与内边距**），滚动指令也从这里落到 scroller 上
 *
 *  · 首尾页靠**内容外的 padding** 摆位，不是靠算式：`scrollTop` 被夹在 `[0, maxScroll]`，
 *    算式再准也够不着边界。**`paddings()` 是 padding 与落点算式的唯一来源** ——
 *    `measure()` 写进 element.style 的是它、`scrollToMeasure()` 拿来摆页面的也是它，别再各写一份。
 *  · 本组件的 `.viewer` **不显示浏览器原生滚动条**（`scrollbar-width: none` + `::-webkit-scrollbar`
 *    宽度 0）：右侧总览里那条才是可视的把手，两条并排纯属重复。恒不显示 → 内容宽恒定，
 *    量出来的布局不会因为它出现 / 消失而抖，滚动本身（滚轮 / 触控板 / 键盘 / 拖总览）不受影响。
 *  · 页面渲染走 `domain/pdf.js` 的 `PdfRenderer.render`，**它是双缓冲的**（画到离屏 canvas 再贴过来，
 *    被取消的那次返回 null），所以拖动 / 收起展开期间连续调用是安全的。**别改回在可见 canvas 上直接画**
 *    —— 那正是「收起侧栏的过程中 PDF 全白」的成因。
 *  · **跟随播放的两个时机**：**按下播放那一刻**摆回当前小节 + 缩放归位 1×（`player.playing` 的上升沿，
 *    预备拍倒数里摆的是 `jumpFlash` 指着的落点），之后**播放到下一行**那一刻再滚一次
 *    （`currentPos` 换页 / 换行那一刻，见下面那两个 watch）：同一个行里换小节不动。
 *    两种显示方式、抓手 / 指针两种手势模式都跟，落点一律由 `placeBand()` 算。
 *  · **切显示方式 = 重新贴合一次**（`resetZoom()` + 摆回当前小节）：换显示方式就是换一套贴合比例
 *    （页高顶满 / 页宽顶满），位置不跟着摆正就会停在按旧比例算出来的地方。两种手势模式都做。
 *  · **鼠标拖谱只在抓手模式下有**（见下面「鼠标拖谱」那一段）：抓手 = 谱面层不接管拖动，
 *    触屏交给浏览器原生滚、鼠标由这里拖滚动容器；指针模式下拖动归 `ScorePage`（框选 / 划行 / 放线）。
 *  · **抓手模式（`player.mode === 'pan'`，默认）唯一不自己滚的一处是「打开乐谱时的贴合」**
 *    （`autoScrollAllowed()`）；用户自己滚（滚轮 / 触控板 / 拖总览）照旧。
 *    谱面那一层的手势归还是 `ScorePage` 的事（它才是写 `touch-action` 与光标的那个组件），这里只管滚动。
 *  · **谱面缩放**（1×–4×，只放大 PDF 页面本身，界面其余部分一概不缩放）：触屏双指、桌面 Ctrl / ⌘ + 滚轮，
 *    锚点都是指针 / 双指中点；状态只在内存里，**播放到下一行要自动滚动的那一刻归位 1×**。
 *    入口、锚点算法与归位时机都在下面「缩放」那一段，规则见 docs/ui.md §18.68。
 *  · **标记列表**（`marksOpen` / `markFocus`）：这两个 prop 只是从页面转手给 `ScorePage`（它才知道
 *    标记画在哪、高亮该怎么画）。本组件另外负责「点列表项 → 谱面滚到它那儿」，用的是与
 *    `scrollToMeasure` **同一支 `placeBand`**（避免两份落点算式各修各的）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Minimap from './Minimap.vue'
import ScorePage from './ScorePage.vue'
import JumpArcs from './JumpArcs.vue'
import { t } from '../i18n/index.js'
import { segmentStartMeasure } from '../domain/timeline.js'
import { settings } from '../store/settings.js'
import {
  addBar,
  addSegmentAt,
  addSystem,
  clearSelection,
  currentPos,
  currentTempo,
  openSegment,
  player,
  pointerMode,
  removeBar,
  removeSystem,
  seekToPosition,
  setCurrentPageFromVisible,
  setSelection,
  structure,
  tapJumpBar,
  timeline,
} from '../store/player.js'

const scroller = ref(null)
const pagesEl = ref(null)
/**
 * 「标记列表」开着没、以及要在谱面上闪一下的那个目标（`{ key, page, y0, y1, tick }`）。
 * 两个都只**转手**给 `ScorePage`（标记画在它那一层），本组件另外用 `markFocus` 的坐标做滚动定位。
 */
const props = defineProps({
  marksOpen: { type: Boolean, default: false },
  markFocus: { type: Object, default: null },
})
const viewport = ref({ width: 0, height: 0 })
const reserved = ref(110)
/** 顶栏占掉的高度（左上那颗胶囊 / 总览三钮胶囊那一行）—— 「整页」算页高时要连它一起扣掉 */
const reservedTop = ref(74)
const mounted = ref(new Set())
const pageRefs = new Map()
/** 总览条要的布局模型：内容总高 / 可视高 / 每页的落点（内容坐标，CSS px） */
const map = ref({ total: 0, view: 0, pages: [] })
/** 单独一个 ref：滚动时每帧都写，不能让它重建整个模型 */
const mapPos = ref(0)
let observer = null
let ro = null
let barsObserver = null
let anim = 0

const pages = computed(() => player.meta.pages || [])

/**
 * 「播放时隐藏顶栏」（`settings.hideTopBar`）现在是不是生效中：交给总览条那颗胶囊，
 * 让它跟着左上那颗一起平移出屏幕。
 *
 * **判据只此一处**（`PlayerView` 那边另有一份同样的 computed，两处都读同一组状态）：
 * **走带中**（`player.playing`）+ **不在编辑模式**（行 / 小节线 / 段落 / 跳转四个工具就在顶栏里）。
 *
 * ⚠️ 注意它**不影响 `reservedTop`**：顶栏藏起来时谱面的可视区不跟着变大，否则每次开关顶栏
 * 整本谱都要按新的可视高重排一遍（页会跳大小、滚动位置也会跳）。这条是刻意的，别「顺手修」。
 */
const topHidden = computed(() => settings.hideTopBar && player.playing && !player.editMode)

/** 「整页」时页顶/页底与工具栏之间留的呼吸间隙（也算进那段富余，算式必须一起用） */
const PAGE_PAD = 10

function pageScale(page) {
  const pad = PAGE_PAD
  const vw = viewport.value.width || 360
  // 分给页面本身的高度 = 可视高 − 被工具栏压住的那两段（下：底栏胶囊；上：左上 / 右上那两条胶囊）
  const vh = Math.max(120, (viewport.value.height || 640) - reserved.value - reservedTop.value)
  // 先算「贴合」那一档，再乘缩放倍数：**缩放叠在贴合之上**，所以 1× 永远是这一档贴合比例
  const fit =
    settings.scrollMode === 'page'
      ? // 整页可见：以高度为准，同时不超出宽度
        Math.min((vh - pad * 2) / (page.height || 841.89), (vw - pad * 2) / (page.width || 595.28))
      : (vw - pad * 2) / (page.width || 595.28)
  return Math.max(0.1, fit) * zoom.value
}

function pageCssWidth(page) {
  return Math.round((page.width || 595.28) * pageScale(page))
}

function setPageRef(i) {
  return (el) => {
    if (el) pageRefs.set(i, el)
    else pageRefs.delete(i)
  }
}

function observeAll() {
  observer?.disconnect()
  if (!scroller.value) return
  observer = new IntersectionObserver(
    (entries) => {
      let changed = false
      const next = new Set(mounted.value)
      for (const e of entries) {
        const i = Number(e.target.dataset.page)
        if (e.isIntersecting) {
          if (!next.has(i)) {
            next.add(i)
            changed = true
          }
        } else if (next.has(i)) {
          next.delete(i)
          changed = true
        }
      }
      if (changed) mounted.value = next
    },
    { root: scroller.value, rootMargin: '120% 0px' }
  )
  pageRefs.forEach((el) => observer.observe(el))
}

/**
 * 量出总览条要的布局模型。
 * 页的落点直接读真实 DOM（offsetTop / offsetHeight），不自己再算一遍间距与内边距 ——
 * 显示方式、底栏预留高度、页面缩放都会影响它，抄一遍迟早对不上。
 * `cssW` 是这一页在视图里显示的 CSS 宽，总览条按它把缩略图等比缩到侧栏宽度。
 */
function measureMap() {
  const el = scroller.value
  if (!el) return
  const list = []
  for (let i = 0; i < pages.value.length; i++) {
    const wrap = pageRefs.get(i)
    if (!wrap) continue
    list.push({
      index: i,
      top: wrap.offsetTop,
      height: wrap.offsetHeight,
      // 横向这两个只有跳转弧线层（`JumpArcs`）用：它在同一套内容坐标里把弧线画到纸面上。
      // 纸面在包裹盒里居中（`.page-wrap` 是 `justify-content: center`），所以两个都要给
      left: wrap.offsetLeft,
      width: wrap.offsetWidth,
      scale: pageScale(pages.value[i]),
      cssW: pageCssWidth(pages.value[i]),
      page: pages.value[i],
    })
  }
  const total = el.scrollHeight
  const view = el.clientHeight
  const prev = map.value
  const same =
    prev.total === total &&
    prev.view === view &&
    prev.pages.length === list.length &&
    prev.pages.every(
      (p, i) =>
        p.top === list[i].top && p.height === list[i].height && p.left === list[i].left && p.width === list[i].width
    )
  if (!same) map.value = { total, view, pages: list }
  if (mapPos.value !== el.scrollTop) mapPos.value = el.scrollTop
}

/**
 * 上下各垫多少空白（CSS px）。
 * **这是算式的唯一来源**：写完 padding 之后，`placeBand()`（跳小节与「标记列表」点项共用那一支）
 * 必须按同一组数字去摆页面，不能再自己写一遍 `reservedTop` / `reserved` —— 差 1px 都会让「整页」的
 * 落点对不齐（历史 bug：padding 是 `reservedTop + 10`，算式里只用 `reservedTop`，于是第一页永远偏低 10px）。
 *
 * 两种显示方式**都靠上下垫空白**把第一页 / 最后一页摆到位 —— 这也正是「始终居中」一直能行的原因：
 * `scrollTop` 会被夹在 `[0, maxScroll]` 里，所以「把第一页往下挪」「把最后一页往上挪」
 * 只能靠内容外面那圈空白撑出来，光靠算式再准也够不着。
 *   · 始终居中：上下各留半个「可视区」（上面那半个连着顶栏那一段 `reservedTop` 一起垫）
 *     → 第一行能顶到正中、最后一行能停在正中；
 *   · 整页：把「两条工具栏之间放得下多少」的富余上下平分垫出去 → 第一页能居中、最后一页也能居中。
 */
function paddings(h) {
  // 「可视区」= 视口扣掉上下两条工具栏压住的那两段（两种显示方式都按它摆位）
  const span = Math.max(120, h - reserved.value - reservedTop.value)
  if (settings.scrollMode === 'center') {
    // 始终居中：上下各留半个可视区 —— 上面那半个还要再让开顶栏那一段（`reservedTop`），
    // 否则第一行顶不到正中；最后一页的最后一行则靠下面那半个停在正中。
    const half = Math.round(span / 2)
    return { top: reservedTop.value + half, bottom: reserved.value + half }
  }
  // 整页：页面本身的显示高由 pageScale 按同一段富余算出（span − 2×pad），
  // 多出来的富余上下平分 —— 于是第一页与最后一页都能居中，和「始终居中」一个道理。
  const slack = Math.max(0, span - pageDisplayHeight()) / 2
  return { top: reservedTop.value + slack, bottom: reserved.value + slack }
}

/**
 * 「整页」下页面本身的显示高（CSS px）：`pageScale` 用的就是 `(span − 20) / 页高pt`，
 * 这里把它换算回来，好让 `paddings()` 知道还剩多少富余可以平分。
 * 取最高的那一页 —— 混合页面尺寸时它决定这一段能装下多少（其余页更矮，只会多出富余）。
 */
function pageDisplayHeight() {
  let maxPt = 0
  for (const p of pages.value) maxPt = Math.max(maxPt, p.height || 841.89)
  return maxPt * pageScale({ width: 0, height: maxPt })
}

function measure() {
  const el = scroller.value
  if (!el) return
  // 底栏是浮在上面的，要按它真实高度预留，翻页「露出下一页第一行」才不会躲到工具栏后面
  const dock = document.querySelector('.bottom')
  const safeB = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-b')) || 0
  const dockH = (dock?.getBoundingClientRect().height || 92) + 14 + safeB
  const nextReserved = Math.max(60, Math.round(dockH))
  if (Math.abs(nextReserved - reserved.value) > 1) reserved.value = nextReserved

  // 顶部同样有两条浮着的胶囊（左上那颗「乐谱库」、右上总览那条三钮胶囊）：
  // 「整页」的页高必须连它们一起让开，否则页顶会被压在胶囊底下。
  // 两条都挂在 `--glass-inset-*` 上，所以量其中一条真实底边即可，
  // 取不到时（元素没渲染）退回「安全区 + --glass-gap-t + --cap-h」。
  const glass = getComputedStyle(document.documentElement)
  const gapT = parseFloat(glass.getPropertyValue('--glass-gap-t')) || 8
  const capH = parseFloat(glass.getPropertyValue('--cap-h')) || 58
  const safeT = parseFloat(glass.getPropertyValue('--safe-t')) || 0
  const topDock = document.querySelector('.back-dock') || document.querySelector('.mini-dock')
  const nextReservedTop = Math.max(
    0,
    Math.round(topDock ? topDock.getBoundingClientRect().bottom : safeT + gapT + capH)
  )
  if (Math.abs(nextReservedTop - reservedTop.value) > 1) reservedTop.value = nextReservedTop

  const w = el.clientWidth
  const h = el.clientHeight
  if (w !== viewport.value.width || h !== viewport.value.height) viewport.value = { width: w, height: h }

  // 上下垫的空白由 paddings() 统一给（算式那边也调它，两边不会各写一份）
  const { top, bottom } = paddings(h)
  const padTop = `${top}px`
  const padBottom = `${bottom}px`
  if (el.style.paddingTop !== padTop) el.style.paddingTop = padTop
  if (el.style.paddingBottom !== padBottom) el.style.paddingBottom = padBottom

  measureMap()
}

/* ------------------------------ 滚动 ------------------------------ */

/** 自己实现缓动；「滚动动画」关掉就直接跳到位 */
function scrollToY(y) {
  const el = scroller.value
  if (!el) return
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  const target = Math.max(0, Math.min(y, max))
  cancelAnimationFrame(anim)
  if (!settings.scrollAnim || Math.abs(target - el.scrollTop) < 2) {
    el.scrollTop = target
    return
  }
  const dur = 340
  const from = el.scrollTop
  const dist = target - from
  const t0 = performance.now()
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur)
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
    el.scrollTop = from + dist * e
    if (k < 1) anim = requestAnimationFrame(step)
  }
  anim = requestAnimationFrame(step)
}

/**
 * 「本页最后一行」要露出下一页多少（CSS px）：**从下一页页顶量到它第一行的下沿**。
 * 整页模式下露出这么多，下一页第一行才是**整条都在底栏上方**；只给「这一行的行高」的话，
 * 页顶那段页边先把这点高度占掉，第一行正好压在下方工具栏后面。
 * ⚠️ 第一行 = `y0` **最大**的那一条（meta 是 y-up，见 docs/invariants.md §1）—— 这一条排序两种写法都对；
 * 但**下沿不能照 `y0` 读**：`addSystem` 写的行是「`y0` = 下沿」，自动识别（`omr.js` 的 `toMetaSystems`）
 * 写出来的是反的（「`y0` = 上沿」），照字面读就只量到那一行的**上沿**、整行留在底栏后面。
 * 所以「从页顶往下量到它的下沿」= `页高 − Math.min(y0, y1)`。
 */
function peekHeight(pageIndex) {
  const page = pages.value[pageIndex + 1]
  if (!page) return 60
  const systems = (page.systems || []).slice().sort((a, b) => b.y0 - a.y0)
  if (!systems.length) return 60
  const s = pageScale(page)
  const first = systems[0]
  const bottom = Math.min(first.y0, first.y1) // y-up：小的是下沿
  return Math.max(28, ((page.height || 841.89) - bottom) * s)
}

/**
 * 把一条「跨整行的带子」摆进可视区。**只有这一支算式**，两个入口都用它：
 *   · `scrollToMeasure(no)` —— 跳小节、跟随播放里那些「滚到这一行」；
 *   · `scrollToMark(page, y0, y1)` —— 标记列表里点某一项。
 * 两处各写一份落点算式的话，改了一处另一处就悄悄错位（而且这种错位只有在「整页」模式下才看得出来）。
 * `band` 的字段：`page`、`y0` / `y1`（**PDF pt，meta 的 y-up**）、`systemId`（可选，用来判「这是本页最后一行」）。
 * **缩放过的谱面**：这一页装不下时「整页」也按「居中」摆这一行（判据在下面），
 * 否则会把页顶摆到顶栏下沿、用户点的那一行根本不在屏幕上。
 */
function placeBand(band) {
  const el = scroller.value
  const wrap = pageRefs.get(band.page)
  if (!el || !wrap) return
  const page = pages.value[band.page]
  if (!page) return
  const s = pageScale(page)
  const pageH = (page.height || 841.89) * s
  // 上下垫的空白来自 paddings()，与 measure() 写进 padding 的是同一组数字（差 1px 就对不齐）
  const { top: padTop, bottom: padBottom } = paddings(el.clientHeight)
  // 「屏幕可视区」= 视口扣掉上下两条工具栏压住的那部分（整页与居中都按它算）
  const viewH = Math.max(120, el.clientHeight - reserved.value - reservedTop.value)
  // **meta 是 y-up、这里是 y-down，必须翻一次**（见 docs/invariants.md §1）：
  // 从页顶量到这一行中线的屏幕距离 = `页高 − 行中线的 y`；拿 y 原值当屏幕距离用，整页会上下镜像。
  const mid = wrap.offsetTop + (pageH - ((band.y0 + band.y1) / 2) * s)
  // 「这一行的中线落在两条工具栏之间的正中」：先让开顶栏那一段，再往上挪半个可视区
  const centered = mid - reservedTop.value - viewH / 2

  // 居中那一档就是它；整页那一档在**这一页装不下**时（谱面放大过）也退回它 ——
  // 否则会按基线把页顶摆到顶栏下沿，用户点的那一行可能根本不在屏幕上
  if (settings.scrollMode === 'center' || pageH > viewH) {
    scrollToY(centered)
    return
  }

  // 显示整页：判断这一行在该页中的位置
  const systems = (page.systems || []).slice().sort((a, b) => a.y0 - b.y0) // 阅读顺序：y0 小的在下
  const isLast = band.systemId && systems.length ? band.systemId === systems[0].id : false
  const pageTop = wrap.offsetTop

  // 先把「这一页完整落在两条工具栏之间」的 scrollTop 算出来当基线。
  // `padTop` 已经含了顶栏与上下平分的那一半富余，所以 pageTop − padTop 就是「页顶该出现在哪」——
  // 第一页 / 最后一页以前会被 scrollTop 的 0..max 夹住贴边，现在那段富余空白把它们撑开了，能真的居中。
  const base = pageTop - padTop
  if (isLast) {
    // 本页最后一行：把下一页第一行摆到底栏上方，再补上底部富余的一半（与居中用同一套基准）。
    // ⚠️ **落点不再额外上移**（别再叠一个 `reserved` 进来）：那是整页再多滑上去一整段底栏的高度，
    // 第一行反而离底栏老远（见 docs/ui.md §18.30 第 90 条）。
    const gap = 8
    const peek = peekHeight(band.page)
    const slackBottom = Math.max(0, padBottom - reserved.value)
    scrollToY(base + pageH + gap + peek - viewH + slackBottom)
  } else {
    // 第一行与中间行一样：整页完整摆进那一段（富余的空白已经在 padding 里平分过了）
    scrollToY(base)
  }
}

/** 跳小节：把这一小节所在的那一行摆进可视区 */
function scrollToMeasure(no) {
  const m = structure.value.measures[no - 1]
  if (!m) return
  placeBand(m)
}

/**
 * 标记列表里点某一项：滚到它那一行（`y0` / `y1` 是 **meta 的 y-up、PDF pt**，调用方给的就是
 * 标记在谱面上画的那一段，不再换算）。给的不是数字、或那一页还没挂上，就什么都不做。
 */
function scrollToMark(page, y0, y1) {
  if (!Number.isFinite(page) || !Number.isFinite(y0) || !Number.isFinite(y1)) return
  const lo = Math.min(y0, y1)
  const hi = Math.max(y0, y1)
  // 给的就是一整行（y 与那一行完全相等）时能拿到 `systemId`，`placeBand` 靠它判「是不是本页最后一行」；
  // 给的是某条小节线（段落 / 跳转落在线上）时对不上任何一行，退回按「中间行」摆 —— 一样滚到那一行上
  const sys = structure.value.systems.find((s) => {
    if (s.page !== page) return false
    const a = Math.min(s.y0, s.y1)
    const b = Math.max(s.y0, s.y1)
    return Math.abs(a - lo) < 0.01 && Math.abs(b - hi) < 0.01
  })
  placeBand({ page, y0, y1, systemId: sys?.id })
}

/** 总览条点 / 拖过来的目标位置：直接跳（这是滚动条，不该有缓动），并打断正在跑的跟随缓动 */
function setScrollTop(y) {
  const el = scroller.value
  if (!el) return
  cancelAnimationFrame(anim)
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  const next = Math.max(0, Math.min(y, max))
  el.scrollTop = next
  mapPos.value = next
}

let ticking = false
function onScroll() {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    ticking = false
    const el = scroller.value
    if (!el) return
    mapPos.value = el.scrollTop
    const mid = el.scrollTop + el.clientHeight * 0.35
    let acc = 0
    for (let i = 0; i < pages.value.length; i++) {
      const wrap = pageRefs.get(i)
      const h = wrap?.offsetHeight || 0
      if (mid >= acc && mid < acc + h) {
        if (player.visiblePage !== i + 1) setCurrentPageFromVisible(i)
        break
      }
      acc += h + 8
    }
  })
}

/* ------------------------------ 缩放 ------------------------------ */

/**
 * 谱面缩放（1× – `ZOOM_MAX`，**只放大**）。**只放大 PDF 页面本身**，界面其余部分（工具栏 / 侧栏 /
 * 总览 / 抽屉）一概不缩放 —— 就在这一层把 `pageScale()` 乘上它，别去动全站的 `zoom` / `transform`。
 *
 * 两个入口，锚点都是**指针 / 双指中点**那一点：缩放前后，它下面那个谱面位置钉住不动。
 *   · 触屏：谱面上落下两根手指（本组件拦下这次手势自己算，见下面的 `onTouch*`）；
 *   · 桌面：Ctrl / ⌘ + 滚轮 —— 触控板捏合送进来的也是一条带 `ctrlKey` 的 wheel 事件。
 *
 * 状态**只在内存里**（不进 meta、不写 localStorage、不进设置）：它是「临时凑近看一眼」，
 * 不是排版偏好。所以**按下播放那一刻**与**播放到下一行、要自动滚动的这一刻**都归位 1×
 * （`resetZoom()`，规则见 docs/ui.md §18.68），换显示方式、换谱也归位。
 */
const ZOOM_MAX = 4
const zoom = ref(1)

function clampZoom(z) {
  return Math.max(1, Math.min(ZOOM_MAX, z))
}

/**
 * 一页在**内容坐标**里的盒子（左上角 + 显示尺寸）。
 * 页在自己的 `.page-wrap` 里水平居中，所以 x 要把那道居中算进去；
 * w / h 由 `pageScale()` 解析算出，不去量 DOM —— 位图是异步画的，量到的尺寸会慢半拍。
 */
function pageBox(i) {
  const wrap = pageRefs.get(i)
  const page = pages.value[i]
  if (!wrap || !page) return null
  const w = pageCssWidth(page)
  const h = (page.height || 841.89) * pageScale(page)
  return { x: wrap.offsetLeft + Math.max(0, (wrap.clientWidth - w) / 2), y: wrap.offsetTop, w, h }
}

/** 屏幕上这一点（client 坐标）落在哪一页、页内比例多少 —— 缩放要钉住的就是它 */
function zoomAnchorAt(clientX, clientY) {
  const el = scroller.value
  if (!el || !pages.value.length) return null
  const r = el.getBoundingClientRect()
  const cx = clientX - r.left
  const cy = clientY - r.top
  const contentY = el.scrollTop + cy
  let page = 0
  for (let i = 0; i < pages.value.length; i++) {
    const box = pageBox(i)
    if (!box) continue
    page = i
    if (contentY < box.y + box.h) break
  }
  const box = pageBox(page)
  if (!box) return null
  return { page, fx: (el.scrollLeft + cx - box.x) / box.w, fy: (contentY - box.y) / box.h, cx, cy }
}

/**
 * 缩到 `next` 倍，再把 `anchor` 那一点摆回屏幕上原来的位置。
 * **布局是异步更新的**（页宽 / 页高变了 Vue 才重排），所以量新尺寸这一步要放到 `nextTick` 之后；
 * 锚点本身按「页内比例」记，与缩放倍数无关，捏合时只要让 `cx` / `cy` 跟着手指走，
 * 就是「抓住那一点拖」的手感（距离不变 = 纯平移，也走这一支）。
 */
function applyZoom(next, anchor) {
  const z = clampZoom(next)
  if (z !== zoom.value) zoom.value = z
  nextTick(() => {
    measure()
    placeAnchor(anchor)
  })
}

function placeAnchor(anchor) {
  const el = scroller.value
  if (!el || !anchor) return
  const box = pageBox(anchor.page)
  if (!box) return
  el.scrollLeft = Math.max(0, box.x + anchor.fx * box.w - anchor.cx)
  el.scrollTop = Math.max(0, box.y + anchor.fy * box.h - anchor.cy)
  mapPos.value = el.scrollTop
}

/** 归位 1×（播放到下一行要自动滚动之前、换显示方式、换谱） */
async function resetZoom() {
  if (zoom.value === 1) return
  zoom.value = 1
  await nextTick()
  measure()
}

/** 桌面：Ctrl / ⌘ + 滚轮（触控板捏合也是它） */
function onWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return
  if (!scroller.value) return
  // 拦下来，否则浏览器会去缩放**整个页面**（工具栏一起变大，而我们要的是只放大谱面）
  e.preventDefault()
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
  applyZoom(zoom.value * Math.exp(-dy * 0.0022), zoomAnchorAt(e.clientX, e.clientY))
}

/** 捏合中的那一段：起始距离与倍数、以及要钉住的那一点（`cx` / `cy` 跟着两指中点走） */
let pinch = null

function pinchInfo(e) {
  const a = e.touches[0]
  const b = e.touches[1]
  return {
    d: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  }
}

function onTouchStart(e) {
  if (e.touches.length !== 2 || !pages.value.length) return
  const p = pinchInfo(e)
  pinch = { d0: p.d, z0: zoom.value, anchor: zoomAnchorAt(p.x, p.y) }
}

function onTouchMove(e) {
  if (!pinch || e.touches.length < 2) return
  // 抢下这一笔：`touch-action` 允许单指平移，不挡的话浏览器会把它当成滚动，和我们这边一直打架。
  // ⚠️ 这条监听只挂在**谱面滚动容器**上、并且只在两指时挡 —— 单指原生滚动与全局那条
  // `html { touch-action: pan-x pan-y }`（docs/ui.md §18.46）都不受影响；**别挪到 document 上**。
  if (e.cancelable) e.preventDefault()
  const p = pinchInfo(e)
  const el = scroller.value
  if (el && pinch.anchor) {
    const r = el.getBoundingClientRect()
    pinch.anchor.cx = p.x - r.left
    pinch.anchor.cy = p.y - r.top
  }
  applyZoom(pinch.z0 * (p.d / pinch.d0), pinch.anchor)
}

function onTouchEnd(e) {
  if (e.touches.length < 2) pinch = null
}

/* --------------------------- 鼠标拖谱（抓手模式） --------------------------- */

/**
 * **抓手模式下用鼠标拖动谱面**（触屏那边是浏览器原生滚，不经这里）。
 *
 * 归谁看手势模式（`ScorePage` 的 `drag.own` 同一条判据）：**抓手 = 谱面层不接管拖动**，
 * 于是鼠标拖动落到这个滚动容器上由我们自己实现；**指针 = 图层接管**（框选 / 划行 / 放线），
 * 这里一根手指都不碰。
 *
 * 门槛与 `ScorePage` 的 `TAP_SLOP` 一样是 10 CSS px：位移没越过它时**一下都不滚**，
 * 那样「按下 - 松手」仍是一次干净的点按（跳转 / 删行 / 标记），两边不会各做一半。
 * 越过了就按**整段位移**滚（不是从门槛处开始算），跟手才对得上。
 *
 * ⚠️ 光标仍是系统默认箭头 —— 抓手 / 指针说的是手势归谁，不是鼠标长什么样（见 `docs/ui.md` §18.37）。
 */
const PAN_SLOP = 10
let panDrag = null

function onPanPointerDown(e) {
  if (pointerMode.value) return // 指针模式：拖动归谱面层
  if (e.pointerType === 'touch') return // 触屏：原生滚动，别抢
  if (e.button !== 0) return
  const el = scroller.value
  if (!el) return
  panDrag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false }
  cancelAnimationFrame(anim) // 别和正在跑的跟随缓动抢滚动位置
  window.addEventListener('pointermove', onPanPointerMove)
  window.addEventListener('pointerup', onPanPointerUp)
  window.addEventListener('pointercancel', onPanPointerUp)
}

function onPanPointerMove(e) {
  if (!panDrag || e.pointerId !== panDrag.id) return
  const el = scroller.value
  if (!el) return
  const dx = e.clientX - panDrag.x0
  const dy = e.clientY - panDrag.y0
  if (!panDrag.moved && Math.abs(dx) <= PAN_SLOP && Math.abs(dy) <= PAN_SLOP) return
  panDrag.moved = true
  el.scrollLeft = panDrag.left - dx
  el.scrollTop = panDrag.top - dy
  mapPos.value = el.scrollTop
}

function onPanPointerUp(e) {
  if (!panDrag || e.pointerId !== panDrag.id) return
  panDrag = null
  window.removeEventListener('pointermove', onPanPointerMove)
  window.removeEventListener('pointerup', onPanPointerUp)
  window.removeEventListener('pointercancel', onPanPointerUp)
}

/* --------------------------- 跟随播放 --------------------------- */

/**
 * **打开乐谱时**要不要自己贴合到当前小节。
 * 抓手模式（`player.mode === 'pan'`，**默认**）下不贴合 —— 抓手说的就是「谱面归用户自己滑」；
 * 而且这一滚走 `scrollToY`，它会 `cancelAnimationFrame(anim)`，撞上用户自己正在跑的滚动就会打架。
 *
 * ⚠️ **只停这一处**：跟随播放（**按下播放那一刻**与播放到下一行，两种手势模式都滚，见下面那两个
 * watch）与**切显示方式**（换一套贴合比例，也要把位置摆正）都不看它。
 */
function autoScrollAllowed() {
  return pointerMode.value
}

let lastSystem = ''
watch(
  () => currentPos.value.no,
  async (no) => {
    if (!no) return
    const m = structure.value.measures[no - 1]
    if (!m) return
    const key = `${m.page}:${m.systemId}`
    const changed = key !== lastSystem
    lastSystem = key
    // **这条只管「播放到下一行」那一刻**（「开始播放」那一刻是下面那条 watch）：
    // 同一行里换小节不动，落点一律由 `placeBand()` 给
    // （居中 = 这一行摆到可视区正中；整页 = 这一页完整摆进两条工具栏之间、末行再露出下一页第一行）。
    // 两种显示方式、抓手 / 指针两种手势模式都跟，所以这里不看 `autoScrollAllowed()`。
    if (!changed) return
    if (!player.playing || !player.autoTurn) return
    // 缩放是「临时凑近看一眼」：真到要自动滚动这一刻就归位 1×，谱面回到贴合基准再摆这一行
    await resetZoom()
    scrollToMeasure(no)
  }
)

/**
 * **按下播放的那一刻**也摆一次：位置回到当前小节、比例归位 1×（见 docs/ui.md §18.37 / §18.68）。
 *
 * 与上面那条的分工：上面管「播放到下一行」，这条管「开始播放」——暂停着按播放、框选起播、
 * 点小节后的自动播放都算。两条都看同一个 `player.autoTurn`（「自动翻页」）：关掉就不跟随滚动。
 *
 * ⚠️ **不能挂在 `currentPos.no` 上**：从暂停接着播时它根本不变，上面那句 `if (!changed) return`
 * 正是为这个写的；所以这条挂 `player.playing` 的**上升沿**。
 * ⚠️ **摆哪一小节要看 `jumpFlash`**：预备拍倒数期间播放头还钉在原地（跳转 / 框选起播都要等数完
 * 才 `seek`），那串「跳转前」指着的落点才是「马上要起播的那一小节」；没有待定落点时才用播放头。
 * 顺序是先 `resetZoom()` 再摆位置：归位会改页高，量完再算落点才对得上。
 */
watch(
  () => player.playing,
  async (on) => {
    if (!on || !player.autoTurn) return
    const no = player.jumpFlash?.no || currentPos.value.no
    await resetZoom()
    if (no) scrollToMeasure(no)
  }
)

// 显示方式 / 按钮是否带小字（会改胶囊高度，进而改顶部预留）改变后重新贴合。
// **两种手势模式下都重新贴合到当前小节**：换显示方式就是换一套贴合比例（页高 / 页宽顶满），
// 位置不跟着摆正的话，用户会停在一个按旧比例算出来的位置上。
watch(
  () => [settings.scrollMode, settings.showButtonLabels && 0].join('|'),
  async () => {
    await nextTick()
    measure()
    observeAll()
    if (currentPos.value.no) scrollToMeasure(currentPos.value.no)
  }
)

/** 换显示方式 = 换一套贴合比例：缩放不跨显示方式继承，先归位 1×（它不进设置，见上面「缩放」那一段） */
watch(
  () => settings.scrollMode,
  () => {
    resetZoom()
  }
)

// 换谱（`player.id`）/ 乐谱装载完成 / 页数变了：重量一次，并把缩放归位 1×
// （换谱时哪怕页数一样，`id` 这一项也保证这条 watch 会跑到）
watch(
  () => [player.id, player.ready, pages.value.length].join('|'),
  async () => {
    await resetZoom()
    await nextTick()
    measure()
    observeAll()
    if (player.ready && autoScrollAllowed() && currentPos.value.no) scrollToMeasure(currentPos.value.no)
  },
  { immediate: true }
)

/* 进 / 出编辑模式、框选状态、**抓手↔指针切换**：都要重新量一次（胶囊高度、页高可能变） */
watch(
  () => [player.editMode, player.selection ? 1 : 0, player.hasScore ? 1 : 0, pointerMode.value],
  async () => {
    await nextTick()
    measure()
    observeAll()
  }
)

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      measure()
      nextTick(observeAll)
    })
    ro.observe(scroller.value)
    // 页面渲染出来 / 换 PDF 后内容高度会变，总览条要跟着重画
    if (pagesEl.value) ro.observe(pagesEl.value)
  }
  // 顶部那两条胶囊 / 底栏的高度会变（工具栏小字开关、框选条出现、进出编辑模式），
  // 它们一变「整页」的页高就要重算。光靠 window resize 抓不到 —— 容器尺寸没变，
  // 变的是浮在谱面上的工具栏，所以单独观察这几个元素本身。
  if (typeof ResizeObserver !== 'undefined') {
    barsObserver = new ResizeObserver(() => measure())
    for (const bar of [document.querySelector('.back-dock'), document.querySelector('.mini-dock'), document.querySelector('.bottom')]) {
      if (bar) barsObserver.observe(bar)
    }
  }
  window.addEventListener('orientationchange', measure)
  // 缩放的两个入口（见上面「缩放」那一段）：两条都**必须非 passive** 才拦得住默认行为。
  // 只挂在谱面滚动容器上，**不是 document**（那条警告见 docs/ui.md §18.46）
  const el = scroller.value
  el?.addEventListener('pointerdown', onPanPointerDown)
  el?.addEventListener('wheel', onWheel, { passive: false })
  el?.addEventListener('touchstart', onTouchStart, { passive: true })
  el?.addEventListener('touchmove', onTouchMove, { passive: false })
  el?.addEventListener('touchend', onTouchEnd, { passive: true })
  el?.addEventListener('touchcancel', onTouchEnd, { passive: true })
})

onBeforeUnmount(() => {
  observer?.disconnect()
  barsObserver?.disconnect()
  ro?.disconnect()
  cancelAnimationFrame(anim)
  window.removeEventListener('orientationchange', measure)
  const el = scroller.value
  el?.removeEventListener('pointerdown', onPanPointerDown)
  window.removeEventListener('pointermove', onPanPointerMove)
  window.removeEventListener('pointerup', onPanPointerUp)
  window.removeEventListener('pointercancel', onPanPointerUp)
  el?.removeEventListener('wheel', onWheel)
  el?.removeEventListener('touchstart', onTouchStart)
  el?.removeEventListener('touchmove', onTouchMove)
  el?.removeEventListener('touchend', onTouchEnd)
  el?.removeEventListener('touchcancel', onTouchEnd)
})

/* --------------------------- 事件 -> store --------------------------- */

function onMeasureTap(no) {
  if (player.selection) {
    clearSelection()
    return
  }
  seekToPosition(no, 0)
  scrollToMeasure(no)
}

function onSelect({ from, to }) {
  setSelection(from, to)
  scrollToMeasure(from)
}

const measuresByPage = computed(() => structure.value.byPage)

/**
 * 当前小节内的播放进度 0..1，喂给 ScorePage 画那条竖直进度线。
 * 做法是「本小节已经走了几拍 / 本小节一共几拍」：`currentPos.beat` 从 1 起算（1 = 第 1 拍），
 * 拍号由当前段落的 `beatsPerBar` 决定（所以换算得放在这儿 —— ScorePage 只拿到小节，不知道拍号）。
 */
const measureProgress = computed(() => {
  const pos = currentPos.value
  if (!pos.no) return 0
  const beats = Math.max(1, Math.round(currentTempo.value.beatsPerBar || 4))
  return Math.max(0, Math.min(1, (pos.beat - 1) / beats))
})

/**
 * 谱面总览里那些蓝色横线的位置：**「当前有主题色标记的地方」逐条列出**。
 *   · 非编辑模式：只有当前播放的小节一条（那时谱面上唯一的主题色就是它）
 *   · 编辑模式：当前工具那一类的每个标记各一条 —— 与谱面上的主题色一一对应，
 *     所以「谱面上哪几条是主题色，总览上就有几条线」，不会多也不会少
 *
 * 只报「页号 + 页内 PDF pt 的 y」，**换算成总览那一列的位置交给 Minimap** ——
 * 那要用到它自己的 k / pad / 上下垫的空白，在这儿再算一遍迟早对不上。
 * 取标记的纵向中点（行 / 小节线 / 段落线都是跨整行的一段，中线最能代表「它在这一行」）。
 */
const markLines = computed(() => {
  const st = structure.value
  const out = []
  if (!st) return out
  const push = (page, y0, y1) => {
    if (page == null) return
    out.push({ page, y: (y0 + y1) / 2 })
  }
  if (!player.editMode) {
    const cur = currentPos.value.no ? st.measures[currentPos.value.no - 1] : null
    if (cur) push(cur.page, cur.y0, cur.y1)
    return out
  }
  if (player.tool === 'row') {
    for (const sys of st.systems) push(sys.page, sys.y0, sys.y1)
    return out
  }
  if (player.tool === 'barline') {
    for (const b of st.barInfo.values()) push(b.page, b.y0, b.y1)
    return out
  }
  // 段落 / 跳转：两类的定位都**只看它挂靠的那条小节线** —— 段落的小节号由 `segmentStartMeasure`
  // 现推（「开头」永远算第 1 小节），与谱面上那条标记线、总览那根蓝线同一个规则。
  // **无效的跳转记号不参与总览**（它同样不画在谱面上）。
  if (player.tool === 'jump') {
    for (const jump of timeline.value.jumps) {
      if (!jump.valid) continue
      for (const barId of [jump.startBarId, jump.endBarId]) {
        const b = barId ? st.barInfo.get(barId) : null
        if (b) push(b.page, b.y0, b.y1)
      }
    }
    return out
  }
  const list = player.tool === 'segment' ? player.meta.segments : []
  for (const item of list) {
    const b = segmentStartMeasure(st, item) || (item.barId ? st.barInfo.get(item.barId) : null)
    if (b) push(b.page, b.y0, b.y1)
  }
  return out
})

defineExpose({ scrollToMeasure, scrollToMark, remeasure: measure, setScrollTop })
</script>

<template>
  <div class="viewer-root">
    <!-- 右侧谱面总览浮层：点 / 拖它来滚动。移动端谱面区域不响应拖动滚动，这是唯一的滚动入口 -->
    <Minimap
      v-if="pages.length"
      :model="map"
      :pos="mapPos"
      :marks="markLines"
      :hide-top-bar="topHidden"
      @scroll="setScrollTop"
    />

    <div ref="scroller" class="viewer scroll-y" @scroll.passive="onScroll">
      <div ref="pagesEl" class="pages">
        <div
          v-for="(page, i) in pages"
          :key="i"
          class="page-wrap"
          :data-page="i"
          :ref="setPageRef(i)"
          :style="{ minHeight: Math.round((page.height || 841.89) * pageScale(page)) + 'px' }"
        >
          <ScorePage
            v-if="mounted.has(i)"
            :page-index="i"
            :page-meta="page"
            :measures="measuresByPage.get(i) || []"
            :structure="structure"
            :segments="player.meta.segments"
            :css-width="pageCssWidth(page)"
            :render="true"
            :edit-mode="player.editMode"
            :tool="player.tool"
            :active-no="currentPos.no"
            :selection="player.selection"
            :playing="player.playing"
            :cueing="player.cueing"
            :progress="measureProgress"
            :pointer-mode="pointerMode"
            :marks-open="marksOpen"
            :mark-focus="markFocus"
            @measure-tap="onMeasureTap"
            @blank-tap="player.selection && clearSelection()"
            @select="onSelect"
            @system-add="(e) => addSystem(e.pageIndex, e.y0, e.y1, e.minH)"
            @system-remove="removeSystem"
            @bar-add="(e) => addBar(e.systemId, e.x)"
            @bar-remove="removeBar"
            @segment-add="addSegmentAt"
            @segment-open="openSegment"
            @jump-tap="tapJumpBar"
          />
        </div>
        <p v-if="!pages.length" class="page-empty muted">{{ t('viewer.noPages') }}</p>
      </div>
      <!-- 跳转弧线：跨页的那一层（每页一层 SVG 画不出跨页的线），**归在滚动内容里**，
           所以它跟着谱面一起滚；坐标直接用 `map.pages` 那一套内容坐标（见 `JumpArcs`）。
           只画编辑模式 —— 非编辑模式的谱面不带任何标记 -->
      <JumpArcs v-if="player.editMode" :model="map" :marks-open="marksOpen" />
    </div>
  </div>
</template>

<style scoped>
.viewer-root {
  position: relative; /* 谱面总览是绝对定位浮在这一层右边的 */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}
.viewer {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--page-bg);
  /* 上下 padding 由 measure() 按显示方式与底栏实际高度动态设置 */
  padding: 10px 0 var(--dock-pad, 120px);
  scroll-behavior: auto;
  /* 谱面放大到 4× 时页比视口宽，**横轴也要能滚**：横向滚动条同样不画（理由见下），
     触屏单指原生平移、桌面用 Shift+滚轮 / 触控板；缩放的锚点逻辑保证「看着的那一块」不跑掉 */
  overflow-x: auto;
  /* 大 PDF 自带的那条滚动条**删掉**：右侧总览条里那条（浏览器原生、能拖）才是可视的把手，
     两条并排重复、深色下还格外抢眼。滚动本身不受影响（滚轮 / 触控板 / 键盘都还在），
     而且这条恒不显示 → 内容宽恒定，量出来的布局不会因为它的出现/消失而抖 */
  scrollbar-width: none; /* Firefox */
}
.viewer::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
.pages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 谱面比视口窄时顶满（`min-width`），比视口宽（放大）时由内容把它撑开，
     于是 `.page-wrap` 的 100% 有确定的宽度、里面的页还能水平居中 */
  width: max-content;
  min-width: 100%;
}
.page-wrap {
  display: flex;
  justify-content: center;
  width: 100%;
}
.page-empty {
  text-align: center;
  padding: 40px 16px;
}
</style>
