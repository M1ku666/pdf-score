<script setup>
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
const props = defineProps({
  marksOpen: { type: Boolean, default: false },
  markFocus: { type: Object, default: null },
})
const viewport = ref({ width: 0, height: 0 })
const reserved = ref(110)
const reservedTop = ref(74)
const mounted = ref(new Set())
const pageRefs = new Map()
const map = ref({ total: 0, view: 0, pages: [] })
const mapPos = ref(0)
let observer = null
let ro = null
let barsObserver = null
let anim = 0

const pages = computed(() => player.meta.pages || [])

const topHidden = computed(() => settings.hideTopBar && player.playing && !player.editMode)

const PAGE_PAD = 10

function pageScale(page) {
  const pad = PAGE_PAD
  const vw = viewport.value.width || 360
  const vh = Math.max(120, (viewport.value.height || 640) - reserved.value - reservedTop.value)
  const fit =
    settings.scrollMode === 'page'
      ?
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

function paddings(h) {
  const span = Math.max(120, h - reserved.value - reservedTop.value)
  if (settings.scrollMode === 'center') {
    const half = Math.round(span / 2)
    return { top: reservedTop.value + half, bottom: reserved.value + half }
  }
  const slack = Math.max(0, span - pageDisplayHeight()) / 2
  return { top: reservedTop.value + slack, bottom: reserved.value + slack }
}

function pageDisplayHeight() {
  let maxPt = 0
  for (const p of pages.value) maxPt = Math.max(maxPt, p.height || 841.89)
  return maxPt * pageScale({ width: 0, height: maxPt })
}

function measure() {
  const el = scroller.value
  if (!el) return
  const dock = document.querySelector('.bottom')
  const safeB = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-b')) || 0
  const dockH = (dock?.getBoundingClientRect().height || 92) + 14 + safeB
  const nextReserved = Math.max(60, Math.round(dockH))
  if (Math.abs(nextReserved - reserved.value) > 1) reserved.value = nextReserved

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

  const { top, bottom } = paddings(h)
  const padTop = `${top}px`
  const padBottom = `${bottom}px`
  if (el.style.paddingTop !== padTop) el.style.paddingTop = padTop
  if (el.style.paddingBottom !== padBottom) el.style.paddingBottom = padBottom

  measureMap()
}

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

function peekHeight(pageIndex) {
  const page = pages.value[pageIndex + 1]
  if (!page) return 60
  const systems = (page.systems || []).slice().sort((a, b) => b.y0 - a.y0)
  if (!systems.length) return 60
  const s = pageScale(page)
  const first = systems[0]
  const bottom = Math.min(first.y0, first.y1)
  return Math.max(28, ((page.height || 841.89) - bottom) * s)
}

function placeBand(band) {
  const el = scroller.value
  const wrap = pageRefs.get(band.page)
  if (!el || !wrap) return
  const page = pages.value[band.page]
  if (!page) return
  const s = pageScale(page)
  const pageH = (page.height || 841.89) * s
  const { top: padTop, bottom: padBottom } = paddings(el.clientHeight)
  const viewH = Math.max(120, el.clientHeight - reserved.value - reservedTop.value)
  const mid = wrap.offsetTop + (pageH - ((band.y0 + band.y1) / 2) * s)
  const centered = mid - reservedTop.value - viewH / 2

  if (settings.scrollMode === 'center' || pageH > viewH) {
    scrollToY(centered)
    return
  }

  const systems = (page.systems || []).slice().sort((a, b) => a.y0 - b.y0)
  const isLast = band.systemId && systems.length ? band.systemId === systems[0].id : false
  const pageTop = wrap.offsetTop

  const base = pageTop - padTop
  if (isLast) {
    const gap = 8
    const peek = peekHeight(band.page)
    const slackBottom = Math.max(0, padBottom - reserved.value)
    scrollToY(base + pageH + gap + peek - viewH + slackBottom)
  } else {
    scrollToY(base)
  }
}

function scrollToMeasure(no) {
  const m = structure.value.measures[no - 1]
  if (!m) return
  placeBand(m)
}

function scrollToMark(page, y0, y1) {
  if (!Number.isFinite(page) || !Number.isFinite(y0) || !Number.isFinite(y1)) return
  const lo = Math.min(y0, y1)
  const hi = Math.max(y0, y1)
  const sys = structure.value.systems.find((s) => {
    if (s.page !== page) return false
    const a = Math.min(s.y0, s.y1)
    const b = Math.max(s.y0, s.y1)
    return Math.abs(a - lo) < 0.01 && Math.abs(b - hi) < 0.01
  })
  placeBand({ page, y0, y1, systemId: sys?.id })
}

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

const ZOOM_MAX = 4
const zoom = ref(1)

function clampZoom(z) {
  return Math.max(1, Math.min(ZOOM_MAX, z))
}

function pageBox(i) {
  const wrap = pageRefs.get(i)
  const page = pages.value[i]
  if (!wrap || !page) return null
  const w = pageCssWidth(page)
  const h = (page.height || 841.89) * pageScale(page)
  return { x: wrap.offsetLeft + Math.max(0, (wrap.clientWidth - w) / 2), y: wrap.offsetTop, w, h }
}

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

async function resetZoom() {
  if (zoom.value === 1) return
  zoom.value = 1
  await nextTick()
  measure()
}

function onWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return
  if (!scroller.value) return
  e.preventDefault()
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
  applyZoom(zoom.value * Math.exp(-dy * 0.0022), zoomAnchorAt(e.clientX, e.clientY))
}

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

const PAN_SLOP = 10
let panDrag = null

function onPanPointerDown(e) {
  if (pointerMode.value) return
  if (e.pointerType === 'touch') return
  if (e.button !== 0) return
  const el = scroller.value
  if (!el) return
  panDrag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false }
  cancelAnimationFrame(anim)
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
    if (!changed) return
    if (!player.playing || !player.autoTurn) return
    await resetZoom()
    scrollToMeasure(no)
  }
)

watch(
  () => player.playing,
  async (on) => {
    if (!on || !player.autoTurn) return
    const no = player.jumpFlash?.no || currentPos.value.no
    await resetZoom()
    if (no) scrollToMeasure(no)
  }
)

watch(
  () => [settings.scrollMode, settings.showButtonLabels && 0].join('|'),
  async () => {
    await nextTick()
    measure()
    observeAll()
    if (currentPos.value.no) scrollToMeasure(currentPos.value.no)
  }
)

watch(
  () => settings.scrollMode,
  () => {
    resetZoom()
  }
)

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
    if (pagesEl.value) ro.observe(pagesEl.value)
  }
  if (typeof ResizeObserver !== 'undefined') {
    barsObserver = new ResizeObserver(() => measure())
    for (const bar of [document.querySelector('.back-dock'), document.querySelector('.mini-dock'), document.querySelector('.bottom')]) {
      if (bar) barsObserver.observe(bar)
    }
  }
  window.addEventListener('orientationchange', measure)
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

const measureProgress = computed(() => {
  const pos = currentPos.value
  if (!pos.no) return 0
  const beats = Math.max(1, Math.round(currentTempo.value.beatsPerBar || 4))
  return Math.max(0, Math.min(1, (pos.beat - 1) / beats))
})

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
            @system-add="(e) => addSystem(e.pageIndex, e.y0, e.y1, e.minH)"
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
  position: relative;
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
  padding: 10px 0 var(--dock-pad, 120px);
  scroll-behavior: auto;
  overflow-x: auto;
  scrollbar-width: none;
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
