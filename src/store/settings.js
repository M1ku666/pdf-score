import { reactive, watch } from 'vue'

const KEY = 'pdf-score:settings'

export const settings = reactive({
  showButtonLabels: true,
  scrollMode: 'page',
  scrollAnim: true,
  hideTopBar: false,
  sideWidth: 0,
  minimapWidth: 0,
  countInPlay: false,
  countInJump: false,
  countInLoop: false,
  autoPlayOnJump: false,
})

const BOOLS = ['showButtonLabels', 'scrollAnim', 'hideTopBar', 'countInPlay', 'countInJump', 'countInLoop', 'autoPlayOnJump']

try {
  const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
  if (typeof raw.toolbarLabels === 'boolean' && typeof raw.showButtonLabels !== 'boolean') {
    settings.showButtonLabels = raw.toolbarLabels
  }
  for (const k of BOOLS) if (typeof raw[k] === 'boolean') settings[k] = raw[k]
  if (raw.scrollMode === 'page' || raw.scrollMode === 'center') settings.scrollMode = raw.scrollMode
  if (Number.isFinite(raw.sideWidth)) settings.sideWidth = raw.sideWidth
  if (Number.isFinite(raw.minimapWidth)) settings.minimapWidth = raw.minimapWidth
} catch {}

export const SIDE_MIN = 280
export const SIDE_MAX = 460
export const SIDE_DEFAULT = 280
if (settings.sideWidth < SIDE_MIN) settings.sideWidth = SIDE_DEFAULT

watch(
  settings,
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {}
  },
  { deep: true }
)

export const MINIMAP_MIN = 56
export const MINIMAP_MAX = 320
export const MINIMAP_DEFAULT = 160

export const SHEET_MAX_W = 620
