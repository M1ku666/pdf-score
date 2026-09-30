<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronRight, File, GalleryVertical, Hand, MousePointer2, PanelRight } from '@lucide/vue'
import { t } from '../i18n/index.js'
import { pointerMode, renderer, setMode } from '../store/player.js'
import { MINIMAP_DEFAULT, MINIMAP_MAX, MINIMAP_MIN, settings } from '../store/settings.js'

const props = defineProps({
  model: { type: Object, required: true },
  pos: { type: Number, default: 0 },
  marks: { type: Array, default: () => [] },
  hideTopBar: { type: Boolean, default: false },
})
const emit = defineEmits(['scroll'])

const open = ref(false)
const dragging = ref(false)
const stretching = ref(false)
const width = ref(settings.minimapWidth >= MINIMAP_MIN ? settings.minimapWidth : MINIMAP_DEFAULT)
const track = ref(null)
const scroller = ref(null)
const box = ref({ w: 0, h: 0, sb: 0 })
const localPos = ref(props.pos)
const canvases = new Map()
const renderedAt = new Map()
let ro = null
let renderToken = 0
let renderTimer = 0
let progScroll = -1
let lastEmit = null
let drag = null
let pannedAt = 0

const PAD_X = 5

const total = computed(() => Math.max(0, props.model.total || 0))
const view = computed(() => Math.max(0, props.model.view || 0))
const docMax = computed(() => Math.max(0, total.value - view.value))
const modelPages = computed(() => props.model.pages || [])

const k = computed(() => {
  const cssW = modelPages.value[0]?.cssW || 0
  const avail = box.value.w - PAD_X * 2
  return cssW > 0 && avail > 0 ? avail / cssW : 0
})

const innerH = computed(() => Math.max(0, Math.round(total.value * k.value)))

const frameH = computed(() => Math.min(box.value.h, Math.max(14, view.value * k.value)))

const pad = computed(() => Math.max(0, (box.value.h - frameH.value) / 2))

const contentH = computed(() => pad.value * 2 + innerH.value)
const maxScroll = computed(() => Math.max(0, contentH.value - box.value.h))

const thumbs = computed(() =>
  modelPages.value.map((p) => ({
    index: p.index,
    top: pad.value + p.top * k.value,
    width: Math.max(1, p.cssW * k.value),
    height: Math.max(1, p.height * k.value),
  }))
)

const frame = computed(() => ({ top: (box.value.h - frameH.value) / 2, height: frameH.value }))

const markTops = computed(() => {
  if (!k.value) return []
  const byIndex = new Map(modelPages.value.map((p) => [p.index, p]))
  const out = []
  for (const mk of props.marks) {
    const p = byIndex.get(mk.page)
    if (!p) continue
    out.push(Math.round(pad.value + (p.top + ((p.page?.height || 841.89) - mk.y) * p.scale) * k.value))
  }
  return out
})

function stripScrollFor(pos) {
  return Math.round((pos + view.value / 2) * k.value + pad.value - box.value.h / 2)
}

function syncStrip(force = false) {
  const el = scroller.value
  if (!el || !k.value) return
  const next = Math.max(0, Math.min(stripScrollFor(localPos.value), maxScroll.value))
  if (!force && Math.abs(el.scrollTop - next) < 2) return
  progScroll = next
  el.scrollTop = next
  if (Math.abs(el.scrollTop - next) > 2) progScroll = -1
}

function onStripScroll() {
  const el = scroller.value
  if (!el || !k.value) return
  const s = el.scrollTop
  if (Math.abs(s - progScroll) < 2) return
  progScroll = -1
  applyPos((s - pad.value + box.value.h / 2) / k.value - view.value / 2)
}

function applyPos(px) {
  const next = Math.max(0, Math.min(px, docMax.value))
  localPos.value = next
  lastEmit = next
  emit('scroll', next)
}

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
  progScroll = -1
  el.scrollTop = drag.s0 - dy
  e.preventDefault()
}

function onUp() {
  if (!drag) return
  if (drag.moved) pannedAt = performance.now()
  drag = null
}

function onTrackClick(e) {
  if (performance.now() - pannedAt < 260) return
  const r = track.value?.getBoundingClientRect()
  const el = scroller.value
  if (!r || !el || !k.value) return
  const contentY = el.scrollTop + (e.clientY - r.top) - pad.value
  applyPos(contentY / k.value - view.value / 2)
  syncStrip()
}

function setCanvas(i, el) {
  if (el) canvases.set(i, el)
  else canvases.delete(i)
}

async function ensureRendered() {
  const r = renderer.value
  const el = scroller.value
  if (!r || !el || !k.value || !innerH.value) {
    stretching.value = false
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
    renderedAt.set(th.index, w)
    try {
      const res = await r.render(th.index + 1, cv, w, null, { slot: 'mini', pixelRatio: 2 })
      if (!res) renderedAt.delete(th.index)
    } catch {
      renderedAt.delete(th.index)
    }
  }
  if (token === renderToken) stretching.value = false
}

function scheduleRender(delay = 120) {
  if (renderTimer) return
  renderTimer = setTimeout(() => {
    renderTimer = 0
    if (!dragging.value) ensureRendered()
  }, delay)
}

function toggleMode() {
  settings.scrollMode = settings.scrollMode === 'page' ? 'center' : 'page'
}

function toggleGesture() {
  setMode(pointerMode.value ? 'pan' : 'pointer')
}

function toggleOpen() {
  open.value = !open.value
  if (open.value && width.value < MINIMAP_MIN) applyWidth(MINIMAP_DEFAULT)
}

function applyWidth(v) {
  width.value = Math.max(0, Math.min(MINIMAP_MAX, v))
  settings.minimapWidth = width.value
}

function startResize(e) {
  e.preventDefault()
  dragging.value = true
  stretching.value = true
  const startX = e.clientX
  const startW = open.value ? width.value : 0
  let moved = false
  let anchorX = startX

  const move = (ev) => {
    if (Math.abs(ev.clientX - startX) > 4) moved = true
    const w = startW - (ev.clientX - startX)

    if (w >= MINIMAP_MIN) {
      dragging.value = true
      stretching.value = true
      anchorX = ev.clientX
      if (!open.value) open.value = true
      applyWidth(w)
      return
    }

    if (Math.abs(ev.clientX - anchorX) < 3) return
    const dir = ev.clientX < anchorX ? 1 : -1
    anchorX = ev.clientX
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

function measure() {
  const el = track.value
  const sc = scroller.value
  if (!el) return
  const h = el.clientHeight
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

watch(
  () => props.pos,
  (v) => {
    if (lastEmit != null && Math.abs(v - lastEmit) < 2) return
    localPos.value = v
    syncStrip()
  }
)

watch([k, innerH, () => box.value.h, () => box.value.w, () => box.value.sb], () => {
  measure()
  syncStrip(true)
  scheduleRender(60)
})

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
  <div
    class="mini-dock capsule glass"
    :class="{ 'no-labels': !settings.showButtonLabels, 'top-hidden': hideTopBar }"
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
      <component :is="open ? ChevronRight : PanelRight" :size="21" />
      <span class="cap-label">{{ open ? t('common.collapse') : t('minimap.title') }}</span>
    </button>
  </div>

  <aside
    class="mini-panel"
    :class="{ collapsed: !open, dragging, stretching }"
    :style="{ width: (open ? width : 0) + 'px' }"
  >
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
          <div ref="scroller" class="mini-scroll scroll-y" @scroll.passive="onStripScroll">
            <div class="mini-inner" :style="{ height: contentH + 'px' }">
              <div
                v-for="th in thumbs"
                :key="th.index"
                class="mini-page"
                :style="{ left: PAD_X + 'px', top: th.top + 'px', width: th.width + 'px', height: th.height + 'px' }"
              >
                <canvas :ref="(el) => setCanvas(th.index, el)" class="mini-thumb" />
              </div>
              <div
                class="mini-marks"
                :style="{ left: PAD_X + 'px', right: box.sb + PAD_X + 'px' }"
              >
                <span v-for="(t, i) in markTops" :key="i" class="mini-mark" :style="{ top: t + 'px' }" />
              </div>
            </div>
          </div>
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
    <div
      class="mini-resizer"
      role="separator"
      :aria-label="open ? t('minimap.resizeAria') : t('minimap.expandAria')"
      @pointerdown="startResize"
    />
  </aside>
</template>

<style scoped>
.mini-panel {
  position: absolute;
  top: calc(var(--safe-t) + 74px);
  right: var(--safe-r);
  bottom: calc(var(--safe-b) + 74px);
  z-index: 23;
  display: flex;
  flex-direction: row;
  background: var(--surface-card);
  border: 1px solid var(--stroke-soft);
  border-right: 0;
  border-radius: var(--radius) 0 0 var(--radius);
  box-shadow: var(--shadow-2);
  transition: width 0.22s var(--ease), border-width 0.22s var(--ease);
}
.mini-panel.collapsed {
  border-width: 0;
}
.mini-panel.dragging {
  transition: none;
}
.mini-clip {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
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
.mini-scroll {
  position: absolute;
  inset: 0;
  overflow-x: hidden;
  scroll-behavior: auto;
  touch-action: none;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
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
.mini-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}
.mini-scroll::-webkit-scrollbar-thumb:active {
  background: var(--accent);
}
.mini-inner {
  position: relative;
}
.mini-page {
  position: absolute;
  left: 0;
  box-shadow: 0 0 0 1px var(--stroke-strong), var(--shadow-1);
}
.mini-thumb {
  display: block;
  width: 100%;
  height: 100%;
  filter: var(--pdf-invert, none);
}
.mini-marks {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
}
.mini-mark {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  margin-top: -1px;
  background: repeating-linear-gradient(90deg, var(--accent-line) 0 4px, transparent 4px 8px);
}
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
.mini-panel.stretching .mini-thumb {
  width: 100% !important;
  height: 100% !important;
}
@media (hover: hover) {
  .mini-track:hover .mini-view {
    background: var(--accent-line);
  }
}
.mini-track:active .mini-view {
  background: var(--accent-line);
}

.mini-dock {
  position: absolute;
  right: var(--glass-inset-r);
  top: var(--glass-inset-t);
  z-index: 25;
  transition: transform var(--side-io) var(--ease);
}
.mini-dock.top-hidden {
  transform: translateY(calc(-100% - var(--glass-inset-t) - 8px));
}

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
.mini-panel.collapsed .mini-resizer {
  left: auto;
  right: var(--safe-r);
}
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
  opacity: 0;
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
