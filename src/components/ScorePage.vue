<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { t } from '../i18n/index.js'
import { segmentLabel } from '../i18n/score-text.js'
import { DEFAULT_MIN_H, ROW_MIN_PX, clampToPage, overlapSystem } from '../domain/rows.js'
import { segmentStartMeasure } from '../domain/timeline.js'
import { REPEAT_KINDS } from '../domain/schema.js'
import { dangerToast } from '../store/toast.js'
import { player, positionBeat, renderer, timeline } from '../store/player.js'
const props = defineProps({
  pageIndex: { type: Number, required: true },
  pageMeta: { type: Object, required: true },
  measures: { type: Array, default: () => [] },
  structure: { type: Object, required: true },
  segments: { type: Array, default: () => [] },
  repeats: { type: Array, default: () => [] },
  cssWidth: { type: Number, required: true },
  render: { type: Boolean, default: true },
  editMode: { type: Boolean, default: false },
  tool: { type: String, default: 'row' },
  activeNo: { type: Number, default: 0 },
  selection: { type: Object, default: null },
  playing: { type: Boolean, default: false },
  cueing: { type: Boolean, default: false },
  progress: { type: Number, default: 0 },
  pointerMode: { type: Boolean, default: false },
  marksOpen: { type: Boolean, default: false },
  markFocus: { type: Object, default: null },
})

const emit = defineEmits([
  'measure-tap',
  'blank-tap',
  'select',
  'system-add',
  'system-remove',
  'bar-add',
  'bar-remove',
  'segment-add',
  'segment-open',
  'repeat-toggle',
  'rendered',
])

const canvas = ref(null)
const root = ref(null)
const rendering = shallowRef(false)

const scale = computed(() => props.cssWidth / (props.pageMeta.width || 595.28))

const pageH = computed(() => props.pageMeta.height || 841.89)
const flipY = (y) => pageH.value - y

const clampY = (y) => Math.max(0, Math.min(pageH.value, y))

const sysBand = (s) => ({ y0: clampY(flipY(s.y0)), y1: clampY(flipY(s.y1)) })

const systems = computed(() => (props.pageMeta.systems || []).map((s) => ({ ...s, ...sysBand(s) })))

function svgBar(barId) {
  const bar = props.structure.barInfo.get(barId)
  if (!bar || bar.page !== props.pageIndex) return null
  return { ...bar, y0: clampY(flipY(bar.y0)), y1: clampY(flipY(bar.y1)) }
}
const SEG_H = 18
const SEG_GAP = 2
const SEG_FONT = 13
const SEG_PAD = 6

const DISC_R = 12
const PIN_H = 30
const DISC_TOP_UP = SEG_H + SEG_GAP + PIN_H

const HOUSE_H = 12
const HOUSE_GAP = 2
const HOUSE_GAP_X = 4
const HOUSE_UP = DISC_TOP_UP + HOUSE_GAP + HOUSE_H

const ACTIVE_RADIUS = 3

const segmentDisplayLabel = segmentLabel

function charWidth(ch) {
  if (/[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(ch)) return 1
  if (ch === '♩') return 1
  if (ch === ' ') return 0.28
  if (/[0-9]/.test(ch)) return 0.58
  if (/[A-Z]/.test(ch)) return 0.68
  if (/[a-z]/.test(ch)) return 0.56
  if (ch === '=') return 0.71
  return 0.5
}

function labelWidth(label) {
  let w = 0
  for (const ch of label) w += charWidth(ch)
  return w * SEG_FONT
}
const cssHeight = computed(() => (props.pageMeta.height || 841.89) * scale.value)

const bars = computed(() => {
  const out = []
  for (const sys of systems.value) {
    for (const b of sys.bars || []) out.push({ ...b, y0: sys.y0, y1: sys.y1 })
  }
  return out
})

const measureBand = (m) => ({ y0: clampY(flipY(m.y0)), y1: clampY(flipY(m.y1)) })

const svgMeasure = (m) => (m ? { ...m, ...measureBand(m) } : null)

function pinPath(cx, topY) {
  const r = DISC_R
  const cy = topY + r
  const bottom = topY + PIN_H
  const d = bottom - cy
  const cos = Math.min(1, r / d)
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos))
  const tx = r * sin
  const ty = cy + r * cos
  const K = 0.34
  const c1x = cx + tx - tx * K
  const c1y = ty + (bottom - ty) * K
  const c2x = cx + tx * K
  const c2y = bottom - (bottom - ty) * K
  return [
    `M ${cx} ${topY}`,
    `A ${r} ${r} 0 0 1 ${cx + tx} ${ty}`,
    `C ${c1x} ${c1y} ${c2x} ${c2y} ${cx} ${bottom}`,
    `C ${cx - tx * K} ${c2y} ${cx - tx + tx * K} ${c1y} ${cx - tx} ${ty}`,
    `A ${r} ${r} 0 0 1 ${cx} ${topY}`,
    'Z'
  ].join(' ')
}

function segmentGeometry(seg) {
  const global = segmentStartMeasure(props.structure, seg)
  if (global && global.page !== props.pageIndex) return null
  const m = global ? svgMeasure(props.measures.find((x) => x.no === global.no) || null) : null
  if (seg.head && !m) return null
  const anchor = m || svgBar(seg.barId)
  if (!anchor) return null
  const beats = Math.max(1, Math.round(seg.beatsPerBar || 4))
  const beat = Math.min(beats, Math.max(1, positionBeat(seg)))
  const x = m ? m.x0 + (m.x1 - m.x0) * (beat / (beats + 1)) : anchor.x
  const label = segmentDisplayLabel(seg)
  const pageW = props.pageMeta.width || 595.28
  const w = Math.min(pageW, labelWidth(label) + SEG_PAD * 2)
  const left = Math.min(x, Math.max(0, pageW - w))
  const rowTop = Math.min(anchor.y0, anchor.y1)
  const lineTop = rowTop
  return { seg, x, label, w, left, top: Math.max(0, lineTop - SEG_H), lineTop, lineBottom: Math.max(anchor.y0, anchor.y1) }
}

const segmentMarks = computed(() => props.segments.map(segmentGeometry).filter(Boolean))

const barNumberMarks = computed(() =>
  bars.value.map((b) => {
    const no = props.structure.barStartMeasure.get(b.id)
    const valid = Number.isFinite(no) && no >= 1 && no <= props.structure.count
    const rowTop = Math.min(b.y0, b.y1)
    const topY = Math.max(0, rowTop - DISC_TOP_UP)
    return {
      id: b.id,
      x: b.x,
      topY,
      ty: topY + DISC_R,
      d: pinPath(b.x, topY),
      stemY0: topY + PIN_H,
      stemY1: rowTop,
      label: valid ? String(no) : ''
    }
  })
)

const activeMeasure = computed(() => svgMeasure(props.measures.find((m) => m.no === props.activeNo)))

const jumpFlash = computed(() => {
  const f = player.jumpFlash
  if (!f?.no) return null
  if (!(props.playing || props.cueing) || props.editMode) return null
  const m = svgMeasure(props.measures.find((x) => x.no === f.no))
  if (!m) return null
  return { ...m, tick: f.tick, ms: f.ms || 500, times: Math.max(1, Math.round(f.repeats || 1)) }
})

const jumpAfter = computed(() => {
  const f = player.jumpAfter
  if (!f?.no || props.editMode) return null
  const m = svgMeasure(props.measures.find((x) => x.no === f.no))
  if (!m) return null
  return { ...m, tick: f.tick, ms: f.ms || 600 }
})

const flashOnActive = computed(() => !!jumpFlash.value && jumpFlash.value.no === props.activeNo)

const progressLine = computed(() => {
  if (props.editMode) return null
  const m = activeMeasure.value
  if (!m) return null
  const f = Math.max(0, Math.min(1, Number(props.progress) || 0))
  return { x: m.x0 + (m.x1 - m.x0) * f, y0: m.y0, y1: m.y1 }
})

const hoverSystemId = ref(null)
const hoverBarId = ref(null)
const hoverBarGhost = ref(null)
const hoverSegId = ref(null)
const hoverSegBarId = ref(null)
const hoverRepBarId = ref(null)

function measuresInBox(box) {
  const from = props.measures.filter((m) => {
    const band = measureBand(m)
    return (
      m.hitX1 > box.x0 &&
      m.hitX0 < box.x1 &&
      Math.max(band.y0, band.y1) < box.y1 &&
      Math.min(band.y0, band.y1) > box.y0
    )
  })
  if (!from.length) return null
  const nos = from.map((m) => m.no)
  return { from: Math.min(...nos), to: Math.max(...nos) }
}

const selectedMeasures = computed(() => {
  const range = dragRange.value || props.selection
  if (!range) return []
  const picks = props.measures.filter((m) => m.no >= range.from && m.no <= range.to).map(svgMeasure)
  const blocks = []
  for (const m of picks) {
    const prev = blocks[blocks.length - 1]
    const last = prev && prev.picks[prev.picks.length - 1]
    if (last && last.systemId === m.systemId && Math.abs(last.x1 - m.x0) < 0.5) {
      prev.picks.push(m)
      prev.x1 = Math.max(prev.x1, m.x1)
    } else {
      blocks.push({ systemId: m.systemId, picks: [m], x0: m.x0, x1: m.x1, firstIndex: m.indexInSystem })
    }
  }
  const barCount = new Map(systems.value.map((s) => [s.id, (s.bars || []).length - 1]))
  return blocks.map((b) => {
    const first = b.picks[0]
    const last = b.picks[b.picks.length - 1]
    const count = barCount.get(b.systemId)
    const full = b.firstIndex === 0 || (count > 0 && last.indexInSystem >= count - 1)
    return {
      key: `s${first.no}`,
      x: b.x0,
      y: Math.min(first.y0, first.y1),
      width: Math.max(0.5, b.x1 - b.x0),
      height: Math.max(0.5, Math.abs(first.y1 - first.y0)),
      radius: full ? ACTIVE_RADIUS : 0,
    }
  })
})

const dragMode = ref(null)
const dragRange = computed(() => {
  if (dragMode.value !== 'marquee') return null
  const box = marquee.value
  return box && !box.row ? measuresInBox(box) : null
})

const REPEAT_MARK_KINDS = ['start', 'end', 'house1']
const repeatMarks = computed(() => {
  const out = props.repeats
    .filter((rep) => REPEAT_MARK_KINDS.includes(rep.kind))
    .map((rep) => {
      const bar = svgBar(rep.barId)
      if (!bar) return null
      const startNo = props.structure.barStartMeasure.get(rep.barId)
      return { key: rep.id, kind: rep.kind, bar, startNo }
    })
    .filter(Boolean)
  if (player.pendingRepeatBarId) {
    const bar = svgBar(player.pendingRepeatBarId)
    if (bar) out.push({ key: 'pending', kind: 'start', bar, startNo: props.structure.barStartMeasure.get(player.pendingRepeatBarId), pending: true })
  }
  return out
})

const houseBrackets = computed(() => {
  const out = []
  for (const block of timeline.value.blocks) {
    const house1 = block.houses.find((h) => h.index === 1)
    if (!house1) continue
    for (const house of block.houses) {
      const second = house.index === 2
      const b0 = svgBar(second ? block.endBarId : house.mark.barId)
      const b1 = svgBar(block.endBarId)
      for (const sys of systems.value) {
        const sysMeasures = props.measures.filter((m) => m.systemId === sys.id)
        if (!sysMeasures.length) continue
        const inRange = sysMeasures.filter((m) => m.no >= house.startMeasure && m.no <= house.endMeasure)
        if (!inRange.length) continue
        const first = inRange[0]
        const last = inRange[inRange.length - 1]
        const atStartLine = b0 && b0.sys === sys.sys
        const x0 = (atStartLine ? Math.min(b0.x, first.x0) : first.x0) + (second && atStartLine ? HOUSE_GAP_X : 0)
        const x1 = b1 && b1.sys === sys.sys ? Math.max(b1.x, last.x1) : last.x1
        const y = clampY(Math.min(sys.y0, sys.y1) - HOUSE_UP)
        out.push({
          id: `${block.endBarId}-h${house.index}-${sys.id}`,
          index: house.index,
          x0,
          y,
          d: `M${x0} ${y + 9} L${x0} ${y + 2} L${x1} ${y + 2}` + (second ? '' : ` L${x1} ${y + 9}`),
          barId: house1.mark.barId,
          label: second ? t(REPEAT_KINDS.house2.shortKey) : t(REPEAT_KINDS.house1.shortKey),
        })
      }
    }
  }
  return out
})

const hoverSystem = computed(() => {
  if (!props.editMode || props.tool !== 'row' || !hoverSystemId.value) return null
  return (props.pageMeta.systems || []).find((s) => s.id === hoverSystemId.value) || null
})
const hoverBar = computed(() => {
  if (!props.editMode || props.tool !== 'barline' || !hoverBarId.value) return null
  return bars.value.find((b) => b.id === hoverBarId.value) || null
})
const hoverSegMark = computed(() => {
  if (!props.editMode || props.tool !== 'segment' || !hoverSegId.value) return null
  return segmentMarks.value.find((s) => s.seg.id === hoverSegId.value) || null
})
const hoverRepMark = computed(() => {
  if (!props.editMode || props.tool !== 'repeat' || !hoverRepBarId.value) return null
  return repeatMarks.value.find((r) => r.bar.id === hoverRepBarId.value) || null
})
const hoverLine = computed(() => {
  const barId = hoverBarId.value || hoverSegBarId.value || hoverRepBarId.value
  if (!props.editMode || !barId) return null
  return bars.value.find((b) => b.id === barId) || null
})

let renderToken = 0

async function doRender() {
  const r = renderer.value
  const cv = canvas.value
  if (!r || !cv || !props.render) return
  const token = ++renderToken
  rendering.value = true
  try {
    const res = await r.render(props.pageIndex + 1, cv, props.cssWidth)
    if (token === renderToken && res) emit('rendered', props.pageIndex)
  } catch (err) {
    if (token === renderToken) console.warn('页面渲染失败', err)
  } finally {
    if (token === renderToken) rendering.value = false
  }
}

function release() {
  const cv = canvas.value
  if (!cv) return
  cv.width = 0
  cv.height = 0
}

watch(
  () => [props.render, props.cssWidth, renderer.value],
  ([shouldRender]) => {
    if (shouldRender) doRender()
    else release()
  }
)

onMounted(() => {
  if (props.render) doRender()
})

onBeforeUnmount(() => {
  renderToken++
})

const drag = ref(null)
const marquee = ref(null)
const ghost = ref(null)
const targetBarId = ref(null)
const rowBlock = ref(false)
const reject = ref(null)
const TAP_SLOP = 10
const MARQUEE_SLOP = 14

const minRowHeight = computed(() => (scale.value > 0 ? ROW_MIN_PX / scale.value : DEFAULT_MIN_H))

function toLocal(e) {
  const r = root.value?.getBoundingClientRect()
  if (!r) return { x: 0, y: 0 }
  return { x: (e.clientX - r.left) / scale.value, y: (e.clientY - r.top) / scale.value }
}

function rowBounds(d) {
  return clampToPage(flipY(Math.max(d.y0, d.y1)), flipY(Math.min(d.y0, d.y1)), pageH.value, minRowHeight.value)
}

function hitSystem(y, tol = 6) {
  for (const s of props.pageMeta.systems || []) {
    const band = sysBand(s)
    if (y >= Math.min(band.y0, band.y1) - tol && y <= Math.max(band.y0, band.y1) + tol) return s
  }
  return null
}

function hitBar(system, x, tol) {
  let best = null
  let bd = Infinity
  for (const b of system.bars || []) {
    const d = Math.abs(b.x - x)
    if (d < bd) {
      bd = d
      best = b
    }
  }
  return bd <= tol ? best : null
}

function hitMeasure(x, y) {
  return (
    props.measures.find((m) => {
      const band = measureBand(m)
      return (
        y >= Math.min(band.y0, band.y1) &&
        y <= Math.max(band.y0, band.y1) &&
        x >= m.hitX0 &&
        x <= m.hitX1
      )
    }) || null
  )
}

function nearestBar(system, x) {
  let best = null
  let bd = Infinity
  for (const b of system.bars || []) {
    const d = Math.abs(b.x - x)
    if (d < bd) {
      bd = d
      best = b
    }
  }
  return best
}

function hitPinBar(x, y) {
  for (const n of barNumberMarks.value) {
    if (x >= n.x - DISC_R && x <= n.x + DISC_R && y >= n.topY && y <= n.topY + PIN_H) return { id: n.id }
  }
  return null
}

function hitBarZone(x, y) {
  const system = hitSystem(y, 8 / scale.value)
  return { system, bar: hitPinBar(x, y) || (system ? hitBar(system, x, 12 / scale.value) : null) }
}

function hitSegmentMark(x, y, tol) {
  let best = null
  let bd = Infinity
  for (const mk of segmentMarks.value) {
    if (y < mk.top - tol || y > mk.lineBottom + tol) continue
    const inFlag = x >= mk.left && x <= mk.left + mk.w && y <= mk.top + SEG_H + tol
    const d = inFlag ? 0 : Math.abs(mk.x - x)
    if (d <= tol && d < bd) {
      bd = d
      best = mk
    }
  }
  return best
}

function hitHouseBracket(x, y, tol) {
  const padY = Math.min(tol, 6 / scale.value)
  for (const h of houseBrackets.value) {
    if (!h.barId) continue
    if (x >= h.x0 - tol && x <= h.x1 + tol && y >= h.y + 2 - padY && y <= h.y + 15 + padY) return h.barId
  }
  return null
}

const BAND_KIND = { new: 'new', overlap: 'overlap' }

function updateBand(d) {
  if (d.mode === 'row') {
    const box = rowBounds(d)
    const hit = box ? overlapSystem(props.pageMeta.systems, box.lo, box.hi) : null
    const kind = box && !hit ? BAND_KIND.new : BAND_KIND.overlap
    rowBlock.value = kind === BAND_KIND.overlap
    reject.value = !box ? 'tooThin' : hit ? 'overlap' : null
    const y0 = box ? flipY(box.hi) : Math.min(d.y0, d.y1)
    const y1 = box ? flipY(box.lo) : Math.max(d.y0, d.y1)
    marquee.value = { x0: 0, y0, x1: props.pageMeta.width, y1, row: true, kind }
    return
  }
  rowBlock.value = false
  reject.value = null
  if (d.mode === 'marquee') {
    marquee.value = { x0: Math.min(d.x0, d.x1), y0: Math.min(d.y0, d.y1), x1: Math.max(d.x0, d.x1), y1: Math.max(d.y0, d.y1) }
  }
}

function updatePreview(d) {
  if (!props.editMode) {
    ghost.value = null
    targetBarId.value = null
    return
  }
  const tol = 12 / scale.value
  if (props.tool === 'barline') {
    const sys = hitSystem(d.y1, tol)
    ghost.value = sys ? { x: d.x1, ...sysBand(sys), systemId: sys.id } : null
    targetBarId.value = null
  } else if (props.tool === 'segment' || props.tool === 'repeat') {
    const sys = hitSystem(d.y1, tol)
    const bar = sys ? hitBar(sys, d.x1, tol) : null
    targetBarId.value = bar?.id || null
    ghost.value = null
  } else {
    ghost.value = null
    targetBarId.value = null
  }
}

const targetBar = computed(() => (targetBarId.value && props.structure.barInfo.get(targetBarId.value)) || null)

function onTouchMove(e) {
  if (drag.value?.own && e.cancelable) e.preventDefault()
}

const touchPointers = new Set()

function onPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (e.pointerType === 'touch') {
    touchPointers.add(e.pointerId)
    if (touchPointers.size > 1) {
      onPointerCancel()
      return
    }
  }
  const p = toLocal(e)
  rowBlock.value = false
  dragMode.value = null
  hoverBarGhost.value = null
  const own = props.pointerMode
  const d = {
    x0: p.x,
    y0: p.y,
    x1: p.x,
    y1: p.y,
    pointerType: e.pointerType,
    moved: false,
    mode: null,
    own,
  }
  drag.value = d
  if (!own) return
  updatePreview(d)
  try {
    root.value?.setPointerCapture?.(e.pointerId)
  } catch {}
}

function clearHover() {
  hoverSystemId.value = null
  hoverBarId.value = null
  hoverBarGhost.value = null
  hoverSegId.value = null
  hoverSegBarId.value = null
  hoverRepBarId.value = null
}

function updateHover(e) {
  if (props.marksOpen) {
    clearHover()
    return
  }
  if (e.pointerType !== 'mouse') return
  const p = toLocal(e)
  if (!props.editMode) {
    clearHover()
    return
  }
  const tol = 12 / scale.value
  if (props.tool === 'row') {
    const sys = hitSystem(p.y, 0)
    const sid = sys ? sys.id : null
    if (hoverSystemId.value !== sid) hoverSystemId.value = sid
    if (hoverBarId.value) hoverBarId.value = null
    if (hoverBarGhost.value) hoverBarGhost.value = null
    if (hoverSegId.value) hoverSegId.value = null
    if (hoverSegBarId.value) hoverSegBarId.value = null
    if (hoverRepBarId.value) hoverRepBarId.value = null
    return
  }
  if (hoverSystemId.value != null) hoverSystemId.value = null
  if (props.tool === 'barline') {
    const zone = hitBarZone(p.x, p.y)
    hoverBarId.value = zone.bar ? zone.bar.id : null
    hoverBarGhost.value =
      zone.system && !zone.bar ? { x: p.x, ...sysBand(zone.system) } : null
    if (hoverSegId.value) hoverSegId.value = null
    if (hoverSegBarId.value) hoverSegBarId.value = null
    if (hoverRepBarId.value) hoverRepBarId.value = null
    return
  }
  hoverBarId.value = null
  hoverBarGhost.value = null
  const system = hitSystem(p.y, tol)
  const bar = system ? hitBar(system, p.x, tol) : null
  const near = system && !bar ? nearestBar(system, p.x) : null
  const barId = (bar || near)?.id || null
  const houseBarId = props.tool === 'repeat' ? hitHouseBracket(p.x, p.y, tol) : null
  hoverRepBarId.value = props.tool === 'repeat' ? houseBarId || barId : null
  if (props.tool === 'segment') {
    const mark = hitSegmentMark(p.x, p.y, tol)
    hoverSegId.value = mark ? mark.seg.id : null
    hoverSegBarId.value = mark ? null : barId
  } else {
    hoverSegId.value = null
    hoverSegBarId.value = null
  }
}

function onPointerMove(e) {
  const d = drag.value
  if (!d) return updateHover(e)
  const p = toLocal(e)
  d.x1 = p.x
  d.y1 = p.y
  const dx = Math.abs(d.x1 - d.x0) * scale.value
  const dy = Math.abs(d.y1 - d.y0) * scale.value
  if (!d.moved && (dx > TAP_SLOP || dy > TAP_SLOP)) d.moved = true

  if (!d.own) return
  if (!d.mode) {
    if (!props.editMode) {
      if (dx > MARQUEE_SLOP || dy > MARQUEE_SLOP) d.mode = 'marquee'
    } else if (props.tool === 'row' && d.moved) {
      d.mode = 'row'
    }
    dragMode.value = d.mode
  }
  if (d.mode) updateBand(d)
  updatePreview(d)
  if (d.mode || d.moved) e.preventDefault()
}

function onPointerUp(e) {
  if (e?.pointerType === 'touch' && e.pointerId != null) touchPointers.delete(e.pointerId)
  const d = drag.value
  drag.value = null
  const box = marquee.value
  marquee.value = null
  dragMode.value = null
  ghost.value = null
  targetBarId.value = null
  if (!d) {
    rowBlock.value = false
    return
  }
  const p = toLocal(e)
  d.x1 = p.x
  d.y1 = p.y

  if (!d.own) {
    if (!d.moved) {
      if (props.editMode) handleEditTap(d.x1, d.y1)
      else handlePlayTap(d.x1, d.y1)
    }
    return
  }

  if (box?.row && d.moved) {
    if (rowBlock.value) {
      const why = reject.value === 'tooThin' ? 'store.row.tooThin' : 'store.row.overlap'
      dangerToast(t(why, { min: ROW_MIN_PX }))
      return
    }
    const bounds = rowBounds(d)
    if (bounds) emit('system-add', { pageIndex: props.pageIndex, y0: bounds.lo, y1: bounds.hi, minH: minRowHeight.value })
    return
  }
  if (box) {
    const range = measuresInBox(box)
    if (range) emit('select', range)
    return
  }
  if (props.editMode) {
    if (props.tool === 'barline' && d.moved) {
      const sys = hitSystem(d.y1, 24 / scale.value)
      if (sys) emit('bar-add', { systemId: sys.id, x: Math.max(0, Math.min(props.pageMeta.width, d.x1)) })
      return
    }
    return handleEditTap(d.x1, d.y1)
  }
  handlePlayTap(d.x1, d.y1)
}

function handlePlayTap(x, y) {
  const m = hitMeasure(x, y)
  if (m) emit('measure-tap', m.no)
  else emit('blank-tap')
}

function handleEditTap(x, y) {
  const tol = 12 / scale.value
  const system = hitSystem(y, 8 / scale.value)
  if (props.tool === 'row') {
    if (system) emit('system-remove', system.id)
    return
  }
  if (props.tool === 'segment') {
    const mark = hitSegmentMark(x, y, tol)
    if (mark) emit('segment-open', mark.seg.id)
    else if (system) {
      const target = hitBar(system, x, tol) || nearestBar(system, x)
      if (target) emit('segment-add', target.id)
    }
    return
  }
  if (props.tool === 'repeat') {
    const houseBarId = hitHouseBracket(x, y, tol)
    if (houseBarId) {
      emit('repeat-toggle', houseBarId)
      return
    }
    if (!system) return
    const target = hitBar(system, x, tol) || nearestBar(system, x)
    if (target) emit('repeat-toggle', target.id)
    return
  }
  const zone = hitBarZone(x, y)
  if (zone.bar) emit('bar-remove', zone.bar.id)
  else if (zone.system) emit('bar-add', { systemId: zone.system.id, x })
}

function onPointerCancel(e) {
  if (e?.pointerType === 'touch' && e.pointerId != null) touchPointers.delete(e.pointerId)
  drag.value = null
  marquee.value = null
  dragMode.value = null
  ghost.value = null
  targetBarId.value = null
  rowBlock.value = false
  reject.value = null
}

watch(() => [props.tool, props.editMode, props.pointerMode], clearHover)

const cursorClass = computed(() => (props.editMode ? `tool-${props.tool}` : 'tool-play'))

const focus = computed(() => (props.markFocus && props.markFocus.page === props.pageIndex ? props.markFocus : null))
</script>

<template>
  <div
    ref="root"
    class="score-page"
    :class="[cursorClass, { 'no-gestures': !pointerMode }]"
    :style="{ width: cssWidth + 'px', height: cssHeight + 'px' }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerleave="clearHover"
    @touchmove="onTouchMove"
    @contextmenu.prevent
  >
    <canvas v-show="render" ref="canvas" class="page-canvas" />
    <div v-if="!render" class="page-skeleton" />

    <svg
      v-if="render"
      class="page-overlay"
      :width="cssWidth"
      :height="cssHeight"
      :viewBox="`0 0 ${pageMeta.width} ${pageMeta.height}`"
      preserveAspectRatio="none"
    >
      <g v-if="editMode" class="lyr-systems">
        <g
          v-for="sys in systems"
          :key="focus && focus.key === sys.id ? `${sys.id}:${focus.tick}` : sys.id"
          :class="{ muted: marksOpen || tool !== 'row', hover: hoverSystem && hoverSystem.id === sys.id, 'focus-flag': !!focus && focus.key === sys.id }"
        >
          <rect
            :x="0"
            :y="Math.min(sys.y0, sys.y1)"
            :width="pageMeta.width"
            :height="Math.max(1, Math.abs(sys.y1 - sys.y0))"
            class="sys-fill"
          />
          <line :x1="0" :y1="sys.y0" :x2="pageMeta.width" :y2="sys.y0" class="sys-edge" />
          <line :x1="0" :y1="sys.y1" :x2="pageMeta.width" :y2="sys.y1" class="sys-edge" />
        </g>
      </g>

      <rect
        v-if="!editMode && activeMeasure && !flashOnActive"
        :x="activeMeasure.x0"
        :y="Math.min(activeMeasure.y0, activeMeasure.y1)"
        :width="Math.max(0.5, activeMeasure.x1 - activeMeasure.x0)"
        :height="Math.max(0.5, Math.abs(activeMeasure.y1 - activeMeasure.y0))"
        :rx="ACTIVE_RADIUS"
        :ry="ACTIVE_RADIUS"
        class="m-active"
        :class="{ playing, plain: !editMode }"
      />
      <rect
        v-if="jumpFlash"
        :key="'before' + jumpFlash.tick"
        :x="jumpFlash.x0"
        :y="Math.min(jumpFlash.y0, jumpFlash.y1)"
        :width="Math.max(0.5, jumpFlash.x1 - jumpFlash.x0)"
        :height="Math.max(0.5, Math.abs(jumpFlash.y1 - jumpFlash.y0))"
        :rx="ACTIVE_RADIUS"
        :ry="ACTIVE_RADIUS"
        :style="{ '--flash-ms': jumpFlash.ms + 'ms', '--flash-times': jumpFlash.times }"
        class="m-jump-flash is-before"
      />
      <rect
        v-if="jumpAfter"
        :key="'after' + jumpAfter.tick"
        :x="jumpAfter.x0"
        :y="Math.min(jumpAfter.y0, jumpAfter.y1)"
        :width="Math.max(0.5, jumpAfter.x1 - jumpAfter.x0)"
        :height="Math.max(0.5, Math.abs(jumpAfter.y1 - jumpAfter.y0))"
        :rx="ACTIVE_RADIUS"
        :ry="ACTIVE_RADIUS"
        :style="{ '--flash-ms': jumpAfter.ms + 'ms' }"
        class="m-jump-flash is-after"
      />
      <line
        v-if="!editMode && progressLine"
        :x1="progressLine.x"
        :y1="progressLine.y0"
        :x2="progressLine.x"
        :y2="progressLine.y1"
        class="m-progress"
      />
      <rect
        v-for="blk in selectedMeasures"
        :key="blk.key"
        :x="blk.x"
        :y="blk.y"
        :width="blk.width"
        :height="blk.height"
        :rx="blk.radius"
        :ry="blk.radius"
        class="m-sel"
      />

      <g v-if="editMode" class="lyr-numbers" :class="{ muted: marksOpen || tool !== 'barline' }">
        <g
          v-for="n in barNumberMarks"
          :key="focus && focus.key === n.id ? `${n.id}:${focus.tick}` : n.id"
          :class="{ hover: hoverBar && hoverBar.id === n.id, 'focus-flag': !!focus && focus.key === n.id }"
        >
          <line :x1="n.x" :y1="n.stemY0" :x2="n.x" :y2="n.stemY1" class="m-no-stem" />
          <path :d="n.d" class="m-no-disc" />
          <text v-if="n.label" :x="n.x" :y="n.ty" class="m-no">{{ n.label }}</text>
        </g>
      </g>

      <g v-if="editMode" class="lyr-bars">
        <g
          v-for="b in bars"
          :key="focus && focus.key === b.id ? `${b.id}:${focus.tick}` : b.id"
          :class="{ muted: marksOpen || tool !== 'barline', hover: hoverBar && hoverBar.id === b.id, 'focus-flag': !!focus && focus.key === b.id }"
        >
          <line :x1="b.x" :y1="b.y0" :x2="b.x" :y2="b.y1" class="bar-line" />
        </g>
      </g>

      <g v-if="editMode" class="lyr-houses" :class="{ muted: marksOpen || tool !== 'repeat' }">
        <g v-for="h in houseBrackets" :key="h.id">
          <path :d="h.d" class="house-bracket" />
          <text :x="h.x0 + 5" :y="h.y + 12" class="house-label">{{ h.label }}</text>
        </g>
      </g>

      <g v-if="editMode" class="lyr-segments" :class="{ muted: marksOpen || tool !== 'segment' }">
        <g
          v-for="s in segmentMarks"
          :key="focus && focus.key === s.seg.id ? `${s.seg.id}:${focus.tick}` : s.seg.id"
          :class="{ hover: hoverSegMark && hoverSegMark.seg.id === s.seg.id, 'focus-flag': !!focus && focus.key === s.seg.id }"
        >
          <line :x1="s.x" :y1="s.lineTop" :x2="s.x" :y2="s.lineBottom" class="seg-line" />
          <g :transform="`translate(${s.left} ${s.top})`">
            <rect x="0" y="0" :width="s.w" :height="SEG_H" rx="4" class="seg-flag" />
            <text :x="SEG_PAD" :y="SEG_H / 2" class="seg-text">{{ s.label }}</text>
          </g>
        </g>
      </g>

      <g v-if="editMode" class="lyr-repeats" :class="{ muted: marksOpen || tool !== 'repeat' }">
        <g
          v-for="r in repeatMarks"
          :key="focus && focus.key === r.key ? `${r.key}:${focus.tick}` : r.key"
          :class="{ hover: hoverRepMark && hoverRepMark.key === r.key, 'focus-flag': !!focus && focus.key === r.key }"
        >
          <template v-if="r.kind === 'start' || r.kind === 'end'">
            <line :x1="r.bar.x" :y1="r.bar.y0" :x2="r.bar.x" :y2="r.bar.y1" class="rep-line" />
            <line
              :x1="r.bar.x + (r.kind === 'start' ? 4 : -4)"
              :y1="r.bar.y0"
              :x2="r.bar.x + (r.kind === 'start' ? 4 : -4)"
              :y2="r.bar.y1"
              class="rep-line thin"
            />
            <circle :cx="r.bar.x + (r.kind === 'start' ? 8.5 : -8.5)" :cy="(r.bar.y0 + r.bar.y1) / 2 - 6" r="2" class="rep-dot" />
            <circle :cx="r.bar.x + (r.kind === 'start' ? 8.5 : -8.5)" :cy="(r.bar.y0 + r.bar.y1) / 2 + 6" r="2" class="rep-dot" />
          </template>
          <template v-else>
            <rect
              :x="r.bar.x - 1"
              :y="Math.min(r.bar.y0, r.bar.y1)"
              width="2"
              :height="Math.max(0.5, Math.abs(r.bar.y1 - r.bar.y0))"
              class="rep-dot"
            />
          </template>
        </g>
      </g>

      <line v-if="hoverLine" :x1="hoverLine.x" :y1="hoverLine.y0" :x2="hoverLine.x" :y2="hoverLine.y1" class="bar-hover" />

      <line v-if="hoverBarGhost" :x1="hoverBarGhost.x" :y1="hoverBarGhost.y0" :x2="hoverBarGhost.x" :y2="hoverBarGhost.y1" class="bar-ghost" />

      <line v-if="ghost" :x1="ghost.x" :y1="ghost.y0" :x2="ghost.x" :y2="ghost.y1" class="bar-ghost" />
      <line v-if="targetBar" :x1="targetBar.x" :y1="targetBar.y0" :x2="targetBar.x" :y2="targetBar.y1" class="bar-target" />

      <rect
        v-if="marquee"
        :x="marquee.x0"
        :y="marquee.y0"
        :width="Math.max(0.5, marquee.x1 - marquee.x0)"
        :height="Math.max(0.5, marquee.y1 - marquee.y0)"
        :class="['marquee', { row: marquee.row, overlap: marquee.kind === 'overlap' }]"
      />
    </svg>
  </div>
</template>

<style scoped>
.score-page {
  position: relative;
  margin: 0 auto;
  background: var(--page-paper, #fff);
  border-radius: 6px;
  box-shadow: var(--shadow-2);
  outline: 1px solid var(--stroke-soft);
  outline-offset: -1px;
  overflow: hidden;
  touch-action: none;
}
.score-page.no-gestures {
  touch-action: auto;
}
.page-canvas {
  filter: var(--pdf-invert, none);
}
.page-skeleton {
  filter: var(--pdf-invert, none);
}
.page-canvas,
.page-skeleton {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.page-skeleton {
  background: repeating-linear-gradient(180deg, #fff 0 26px, #f4f5f7 26px 28px);
  opacity: 0.5;
}
.page-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}

.sys-fill {
  fill: var(--accent-weak);
  stroke: none;
}
.sys-edge {
  stroke: var(--accent);
  stroke-width: 1.6;
}
.bar-line {
  stroke: var(--accent);
  stroke-width: 1.6;
}
.m-no-disc {
  fill: var(--accent);
}
.m-no-stem {
  stroke: var(--accent);
  stroke-width: 1.6;
}
.m-no {
  fill: var(--on-accent);
  font-size: 10px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
}
.bar-hover {
  stroke: var(--accent);
  stroke-width: 2.4;
}
.m-active,
.m-active.plain,
.m-active.playing,
.m-active.plain.playing {
  fill: var(--accent-weak);
  stroke: none;
}
.m-jump-flash {
  fill: var(--accent-weak);
  stroke: none;
}
.m-jump-flash.is-before {
  animation: jump-flash-before var(--flash-ms, 500ms) ease-in-out var(--flash-times, 4);
}
.m-jump-flash.is-after {
  animation: jump-flash-after var(--flash-ms, 0.6s) ease-in-out 1 forwards;
}
@keyframes jump-flash-before {
  0% {
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@keyframes jump-flash-after {
  0% {
    opacity: 0;
  }
  45% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
.m-progress {
  stroke: var(--accent);
  stroke-width: 1.6;
}
.m-sel {
  fill: var(--mark-muted-fill);
  stroke: none;
}
.seg-line {
  stroke: var(--accent);
  stroke-width: 1.6;
}
.seg-flag {
  fill: var(--accent);
}
.seg-text {
  fill: var(--on-accent);
  font-size: 13px;
  font-weight: 700;
  text-anchor: start;
  dominant-baseline: central;
}
.rep-line {
  stroke: var(--accent);
  stroke-width: 1.8;
}
.rep-line.thin {
  stroke-width: 1;
}
.rep-dot {
  fill: var(--accent);
}
.house-bracket {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.6;
}
.house-label {
  fill: var(--accent);
  font-size: 13px;
  font-weight: 700;
}
.muted .sys-edge,
.muted .bar-line,
.muted .m-no-stem,
.muted .seg-line,
.muted .rep-line,
.muted .house-bracket {
  stroke: var(--mark-muted-line);
}
.muted .m-no-disc,
.muted .seg-flag,
.muted .rep-dot,
.muted .house-label {
  fill: var(--mark-muted-line);
}
.muted .sys-fill {
  fill: var(--mark-muted-fill);
}
.muted .m-no,
.muted .seg-text {
  fill: var(--surface-page);
}
.hover .sys-edge,
.hover .bar-line,
.hover .m-no-stem,
.hover .seg-line,
.hover .rep-line {
  stroke: var(--accent);
}
.hover .sys-fill {
  fill: var(--accent-mid);
}
.hover .m-no-disc,
.hover .seg-flag,
.hover .rep-dot {
  fill: var(--accent);
}
.hover .m-no,
.hover .seg-text {
  fill: var(--on-accent);
}
.hover .sys-edge,
.hover .bar-line,
.hover .m-no-stem,
.hover .seg-line,
.hover .rep-line:not(.thin) {
  stroke-width: 3;
}
.hover .rep-dot {
  r: 3.2;
}
.marquee {
  fill: var(--accent-weak);
  stroke: var(--accent);
  stroke-width: 1.4;
}
.marquee.row {
  fill: color-mix(in srgb, var(--accent) 10%, transparent);
  stroke: var(--accent);
}
.marquee.row.overlap {
  fill: var(--mark-muted-fill);
  stroke: var(--mark-muted-line);
}
.bar-ghost {
  stroke: var(--accent);
  stroke-width: 2;
}
.bar-target {
  stroke: var(--accent);
  stroke-width: 3;
}
.focus-flag .sys-edge,
.focus-flag .bar-line,
.focus-flag .m-no-stem,
.focus-flag .seg-line,
.focus-flag .rep-line,
.focus-flag .house-bracket {
  animation: mark-flash-stroke 1.5s ease-in-out both;
}
.focus-flag .m-no-disc,
.focus-flag .seg-flag,
.focus-flag .rep-dot,
.focus-flag .house-label {
  animation: mark-flash-fill 1.5s ease-in-out both;
}
.focus-flag .sys-fill {
  animation: sys-flash-fill 1.5s ease-in-out both;
}
@keyframes mark-flash-stroke {
  0%,
  55% {
    stroke: var(--accent-strong);
    stroke-width: 3;
  }
  25%,
  80% {
    stroke: var(--accent);
    stroke-width: 3;
  }
  100% {
    stroke: var(--accent);
    stroke-width: 3;
  }
}
@keyframes mark-flash-fill {
  0%,
  55% {
    fill: var(--accent-strong);
  }
  25%,
  80% {
    fill: var(--accent);
  }
  100% {
    fill: var(--accent);
  }
}
@keyframes sys-flash-fill {
  0%,
  55% {
    fill: var(--accent);
  }
  25%,
  80% {
    fill: var(--accent-weak);
  }
  100% {
    fill: var(--accent-weak);
  }
}
</style>
