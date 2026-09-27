<script setup>
/**
 * 乐谱视图：整本 PDF 垂直滚动 + 按需渲染 + 跟随播放滚动
 *  显示整页（scrollMode='page'）：页高顶满「两条工具栏之间」那一段可视区，播放到一行末尾时露出下一页第一行，
 *                                 播到下一页第一行时又把该页完整显示出来
 *  始终居中（scrollMode='center'）：页宽顶满，当前播放行始终位于可视区中央
 *  **两条工具栏都算进「可视区」**：底栏那对胶囊（`.bottom`）与顶部那两条（`.back-dock` / `.mini-dock`）
 *  都是浮在谱面上的，所以 scale（pageScale）、页边距（measure）与整页的落点（scrollToMeasure）
 *  一律按 `reserved`（下）+ `reservedTop`（上）扣掉之后再算 —— 少扣一个，页面就会被压在胶囊底下。
 *  两者都从真实 DOM / `--glass-inset-*` 量出来，别在算式里写死数字。
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
 *  · **抓手模式（`player.mode === 'pan'`，默认）停的是「自动滚动」**：跟随播放、切显示方式 / 进编辑模式的
 *    重新贴合都不再自己滚（`autoScrollAllowed()`）；用户自己滚（滚轮 / 触控板 / 拖总览）照旧。
 *    谱面那一层的手势归还是 `ScorePage` 的事（它才是写 `touch-action` 与光标的那个组件），这里只管滚动。
 *  · **标记列表**（`marksOpen` / `markFocus`）：这两个 prop 只是从页面转手给 `ScorePage`（它才知道
 *    标记画在哪、高亮该怎么画）。本组件另外负责「点列表项 → 谱面滚到它那儿」，用的是与
 *    `scrollToMeasure` **同一支 `placeBand`**（避免两份落点算式各修各的）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Minimap from './Minimap.vue'
import ScorePage from './ScorePage.vue'
import { t } from '../i18n/index.js'
import { segmentStartMeasure } from '../domain/timeline.js'
import { settings } from '../store/settings.js'
import {
  addBar,
  addRepeatAt,
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
 * **走带中**（`player.playing`）+ **不在编辑模式**（行 / 小节线 / 段落 / 反复四个工具就在顶栏里）。
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
  if (settings.scrollMode === 'page') {
    // 整页可见：以高度为准，同时不超出宽度
    return Math.max(0.1, Math.min((vh - pad * 2) / (page.height || 841.89), (vw - pad * 2) / (page.width || 595.28)))
  }
  return Math.max(0.1, (vw - pad * 2) / (page.width || 595.28))
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
    prev.pages.every((p, i) => p.top === list[i].top && p.height === list[i].height)
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
 *   · 始终居中：上下各留半个可视高 → 第一页能顶到正中、最后一页能停在正中；
 *   · 整页：把「两条工具栏之间放得下多少」的富余上下平分垫出去 → 第一页能居中、最后一页也能居中。
 */
function paddings(h) {
  if (settings.scrollMode === 'center') {
    const half = Math.max(0, Math.round((h - reserved.value) / 2))
    return { top: half, bottom: reserved.value + half }
  }
  // 整页：页面本身的显示高由 pageScale 按同一段富余算出（span − 2×pad），
  // 多出来的富余上下平分 —— 于是第一页与最后一页都能居中，和「始终居中」一个道理。
  const span = Math.max(120, h - reserved.value - reservedTop.value)
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

/** 下一页第一行露出多少：用下一页第一个行的高度 */
function peekHeight(pageIndex) {
  const page = pages.value[pageIndex + 1]
  if (!page) return 60
  const systems = (page.systems || []).slice().sort((a, b) => b.y0 - a.y0)
  if (!systems.length) return 60
  const s = pageScale(page)
  return Math.max(28, (systems[0].y1 - systems[0].y0) * s)
}

/**
 * 把一条「跨整行的带子」摆进可视区。**只有这一支算式**，两个入口都用它：
 *   · `scrollToMeasure(no)` —— 跳小节、跟随播放里那些「滚到这一行」；
 *   · `scrollToMark(page, y0, y1)` —— 标记列表里点某一项。
 * 两处各写一份落点算式的话，改了一处另一处就悄悄错位（而且这种错位只有在「整页」模式下才看得出来）。
 * `band` 的字段：`page`、`y0` / `y1`（**PDF pt，meta 的 y-up**）、`systemId`（可选，用来判「这是本页最后一行」）。
 */
function placeBand(band) {
  const el = scroller.value
  const wrap = pageRefs.get(band.page)
  if (!el || !wrap) return
  const page = pages.value[band.page]
  if (!page) return
  const s = pageScale(page)
  const top = wrap.offsetTop + band.y0 * s
  const bottom = wrap.offsetTop + band.y1 * s
  const pageH = (page.height || 841.89) * s
  // 上下垫的空白来自 paddings()，与 measure() 写进 padding 的是同一组数字（差 1px 就对不齐）
  const { top: padTop, bottom: padBottom } = paddings(el.clientHeight)
  // 「屏幕可视区」= 视口扣掉上下两条工具栏压住的那部分（整页与居中都按它算）
  const viewH = Math.max(120, el.clientHeight - reserved.value - reservedTop.value)

  if (settings.scrollMode === 'center') {
    scrollToY((top + bottom) / 2 - viewH / 2)
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
    // 本页最后一行：把下一页第一行摆到底栏上方，再补上底部富余的一半（与居中用同一套基准）
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
  // 给的是某条小节线（段落 / 反复落在线上）时对不上任何一行，退回按「中间行」摆 —— 一样滚到那一行上
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

/* --------------------------- 跟随播放 --------------------------- */

/**
 * 抓手模式（`player.mode === 'pan'`，**默认**）下**一切自动滚动都停掉**：不跟随播放、不跳到当前小节、
 * 也不随切显示方式 / 进出编辑模式重新贴合。
 * 理由：抓手模式说的就是「谱面归用户自己滑」；而且这些滚动都走 `scrollToY`，它会
 * `cancelAnimationFrame(anim)`，撞上用户自己正在跑的滚动就会打架。
 * **只停「自动」这一路** —— 用户自己滚（滚轮 / 触控板 / 拖总览）在两种模式下都照旧。
 */
function autoScrollAllowed() {
  return pointerMode.value
}

let lastSystem = ''
watch(
  () => currentPos.value.no,
  (no) => {
    if (!no) return
    if (!autoScrollAllowed()) return // 抓手模式：跟随播放暂停（见上）
    const m = structure.value.measures[no - 1]
    if (!m) return
    const key = `${m.page}:${m.systemId}`
    const changed = key !== lastSystem
    lastSystem = key
    if (!changed) return
    if (player.playing && player.autoTurn) scrollToMeasure(no)
  }
)

// 显示方式 / 工具栏是否带小字（会改胶囊高度，进而改顶部预留）改变后重新贴合。
// 抓手模式下不重新贴合（那也是自动滚动），但 measure() 照做 —— 页高与预留都变了，
// 不量的话页面尺寸不刷新，用户自己滑过去看到的是旧排版
watch(
  () => [settings.scrollMode, settings.toolbarLabels && 0].join('|'),
  async () => {
    await nextTick()
    measure()
    observeAll()
    if (autoScrollAllowed() && currentPos.value.no) scrollToMeasure(currentPos.value.no)
  }
)

watch(
  () => [player.ready, pages.value.length],
  async () => {
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
})

onBeforeUnmount(() => {
  observer?.disconnect()
  barsObserver?.disconnect()
  ro?.disconnect()
  cancelAnimationFrame(anim)
  window.removeEventListener('orientationchange', measure)
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
  // 段落 / 反复：反复挂在它那条小节线上；**段落是按 `position` 生效的**，所以它的行要按
  // `segmentStartMeasure`（位置优先）来定 —— 和谱面上那条标记线同一个规则，总览那根蓝线才不会
  // 落在另一行上（「开头」段落也在这条规则里：它固定算第 1 小节，蓝线就落在开头那一行）。
  // 位置越界时退回它挂靠的那条小节线。
  const list = player.tool === 'segment' ? player.meta.segments : player.tool === 'repeat' ? player.meta.repeats : []
  for (const item of list) {
    const m = player.tool === 'segment' ? segmentStartMeasure(st, item) : null
    const b = m || (item.barId ? st.barInfo.get(item.barId) : null)
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
            :repeats="player.meta.repeats"
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
            @system-add="(e) => addSystem(e.pageIndex, e.y0, e.y1)"
            @system-remove="removeSystem"
            @bar-add="(e) => addBar(e.systemId, e.x)"
            @bar-remove="removeBar"
            @segment-add="addSegmentAt"
            @segment-open="openSegment"
            @repeat-toggle="addRepeatAt"
          />
        </div>
        <p v-if="!pages.length" class="page-empty muted">{{ t('viewer.noPages') }}</p>
      </div>
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
