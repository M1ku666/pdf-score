import { computed, reactive } from 'vue'
import { Flag, LineDotTopVertical, RectangleHorizontal, Repeat } from '@lucide/vue'

export const EDIT_TOOLS = [
  { key: 'row', icon: RectangleHorizontal, labelKey: 'store.tool.row.label' },
  { key: 'barline', icon: LineDotTopVertical, labelKey: 'store.tool.barline.label' },
  { key: 'segment', icon: Flag, labelKey: 'store.tool.segment.label' },
  { key: 'repeat', icon: Repeat, labelKey: 'store.tool.repeat.label' },
]

export const layout = reactive({
  library: false,
  panel: null,
})

export const libraryOpen = computed(() => layout.library)
export const drawerOpen = computed(() => !!layout.panel)

export function expandLibrary() {
  layout.library = true
}

export function collapseLibrary() {
  layout.library = false
}

export function toLibrary() {
  closeDrawer(layout.panel)
  expandLibrary()
}

const panelClosers = new Map()

export function registerPanel(key, close) {
  if (key) panelClosers.set(key, close)
}

export function unregisterPanel(key) {
  if (key) panelClosers.delete(key)
}

export function openDrawer(key) {
  if (!key) return
  const prev = layout.panel
  layout.panel = key
  if (prev && prev !== key) panelClosers.get(prev)?.()
}

export function closeDrawer(key) {
  if (key && layout.panel === key) layout.panel = null
}

export function closeCurrentDrawer() {
  const key = layout.panel
  if (!key) return
  const closer = panelClosers.get(key)
  if (closer) closer()
  else layout.panel = null
}

export function resetLayout() {
  layout.library = false
  layout.panel = null
}

const stack = []
let sentinel = false
let base = null
let popping = false

function pushSentinel() {
  if (sentinel || typeof window === 'undefined' || !window.history?.pushState) return
  if (!base) base = { url: window.location.href, state: window.history.state }
  window.history.pushState({ ...(window.history.state || {}), uiLayer: true }, '', base.url)
  sentinel = true
}

function dropSentinel() {
  if (!sentinel) return
  sentinel = false
  if (typeof window !== 'undefined' && window.history?.replaceState) {
    const url = base ? base.url : window.location.href
    window.history.replaceState(window.history.state, '', url)
  }
  base = null
}

export function realignSentinelBase() {
  if (base) base.url = window.location.href
}

function onPopState() {
  if (!sentinel || !stack.length) return
  sentinel = false
  popping = true
  const top = stack.pop()
  try {
    top.dismiss()
  } catch (err) {
    console.error('[ui] 关闭浮层失败', err)
  }
  popping = false
  if (stack.length) pushSentinel()
  else base = null
}

function listen(on) {
  if (typeof window === 'undefined') return
  if (on) window.addEventListener('popstate', onPopState)
  else window.removeEventListener('popstate', onPopState)
}

export function pushBackLayer(dismiss, id = '') {
  const layer = { dismiss, id }
  if (id) {
    const i = stack.findIndex((l) => l.id === id)
    if (i >= 0) stack.splice(i, 1)
  }
  stack.push(layer)
  if (!popping) {
    listen(true)
    pushSentinel()
  }
  return () => popBackLayer(layer)
}

export function popBackLayer(layer) {
  const i = stack.indexOf(layer)
  if (i < 0) return
  stack.splice(i, 1)
  if (popping) return
  if (!stack.length) {
    listen(false)
    dropSentinel()
  }
}

export function readPalette() {
  if (typeof getComputedStyle !== 'function') return { bg: '#0b0d10', accent: '#4c9dff', line: '#333', text: '#888' }
  const cs = getComputedStyle(document.documentElement)
  const get = (k, fallback) => (cs.getPropertyValue(k) || '').trim() || fallback
  return {
    bg: get('--wave-bg', '#0b0d10'),
    accent: get('--accent', '#4c9dff'),
    line: get('--stroke-strong', '#333'),
    text: get('--text-muted', '#888'),
  }
}

export function readFontStack() {
  if (typeof getComputedStyle !== 'function') return 'sans-serif'
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-ui')
  return (value || '').trim() || 'sans-serif'
}
