import { computed, reactive, shallowRef, watch } from 'vue'
import * as db from '../db/idb.js'
import { AudioEngine, Metronome, OutputClock } from '../domain/audio-engine.js'
import { PdfRenderer } from '../domain/pdf.js'
import { beatDuration, buildTimeline, decideRepeatTap, deriveStructure, isRowEndBar, tempoAt } from '../domain/timeline.js'
import { cloneMeta, comparePosition, createMeta, defaultRepeat, defaultSegment, fitBeat, metaStats, positionBeat, positionMeasure, syncPages, uid } from '../domain/schema.js'
import { DEFAULT_MIN_H, clampToPage, overlapSystem } from '../domain/rows.js'
import { detectPdfPage } from '../domain/omr.js'
import { peaksFromBlob, PEAKS_PER_SECOND } from '../domain/audio-peaks.js'
import { t } from '../i18n/index.js'
import { markEditDone, markOpened, onRecordUpdated, touchSize, updateScoreMeta } from './library.js'
import { settings } from './settings.js'
import { actionToast, dangerToast, dismissToast, errorToast, errText, toast } from './toast.js'

export const engine = new AudioEngine()
export const clock = new OutputClock()
clock.attach(engine, engine.context)
export const metronome = new Metronome()

export const renderer = shallowRef(null)
export const peaksRef = shallowRef(null)

export const player = reactive({
  id: '',
  record: null,
  meta: createMeta(),
  loading: false,
  ready: false,
  error: '',

  hasPdf: false,
  hasAudio: false,
  pdfName: '',
  audioName: '',

  peaksLoading: false,
  peaksPerSecond: PEAKS_PER_SECOND,

  dirty: false,
  saving: false,
  savedAt: 0,
  autoSaved: false,

  editMode: false,
  tool: 'row',
  activeSegmentId: null,
  drawer: null,
  pendingRepeatBarId: null,
  jumpFlash: null,
  jumpAfter: null,

  cueing: false,

  selection: null,
  mode: 'pan',

  playing: false,
  previewing: false,
  previewTime: 0,
  currentTime: 0,
  rate: 1,
  rateHistory: [],
  volume: 1,
  muted: false,
  metronomeVolume: 0,
  cueVolume: 0.6,
  loopOn: false,

  currentPage: 1,
  visiblePage: 1,
  pageCount: 0,
  pdfWidth: 0,
  pdfHeight: 0,
  fitMode: 'width',

  autoTurn: true,
  showHelp: false,
})

const PREFS_KEY = 'pdf-score:prefs'

export const RATE_MIN = 0.25
export const RATE_MAX = 4
export const RATE_HISTORY_MAX = 5

function normRate(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return player.rate
  return Number(Math.min(RATE_MAX, Math.max(RATE_MIN, v)).toFixed(2))
}

function cleanHistory(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    const n = Number(item)
    if (!Number.isFinite(n)) continue
    const v = normRate(n)
    if (!out.includes(v)) out.push(v)
    if (out.length >= RATE_HISTORY_MAX) break
  }
  return out
}

try {
  const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  if (Number.isFinite(prefs.rate)) player.rate = prefs.rate
  player.rateHistory = cleanHistory(prefs.rateHistory)
  if (Number.isFinite(prefs.volume)) player.volume = prefs.volume
  if (Number.isFinite(prefs.metronomeVolume)) player.metronomeVolume = prefs.metronomeVolume
  if (Number.isFinite(prefs.cueVolume)) player.cueVolume = prefs.cueVolume
  if (typeof prefs.autoTurn === 'boolean') player.autoTurn = prefs.autoTurn
} catch {}

function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        rate: player.rate,
        rateHistory: player.rateHistory,
        volume: player.volume,
        metronomeVolume: player.metronomeVolume,
        cueVolume: player.cueVolume,
        autoTurn: player.autoTurn,
      })
    )
  } catch {}
}

let pdfBlob = null
let audioBlob = null
let audioUrl = ''
let saveTimer = 0
const undoSlot = { notice: null, timer: 0 }

const omrPageCache = new Map()

export const structure = computed(() => deriveStructure(player.meta))
export const timeline = computed(() => buildTimeline(player.meta, { structure: structure.value }))
export const measureCount = computed(() => structure.value.count)

export const currentPos = computed(() => timeline.value.timeToPos(player.currentTime))
export const currentMeasure = computed(() => {
  const pos = currentPos.value
  return pos.no ? structure.value.measures[pos.no - 1] || null : null
})
export const currentTempo = computed(() => {
  const pos = currentPos.value
  if (!pos.no) return { bpm: 120, beatsPerBar: 4, beatUnit: 4 }
  return tempoAt(timeline.value.segments, pos.no, Math.max(1, Math.floor(pos.beat || 1)))
})
export const duration = computed(() => Math.max(clock.duration || 0, timeline.value.duration || 0))
export const timelineStart = computed(() => {
  const first = timeline.value.samples[0]
  return first ? first.time : 0
})

export const canPlay = computed(() => player.hasAudio || (timeline.value.duration || 0) > 0)
export const pointerMode = computed(() => player.mode !== 'pan')
export const silentPlayback = computed(() => !player.hasAudio)

export const activeSegment = computed(() => (player.meta.segments || []).find((s) => s.id === player.activeSegmentId) || null)

export const scoreTitle = computed(() => player.record?.title || player.meta?.title || t('store.untitled'))

export function segmentPositionLabel(seg) {
  if (!seg) return ''
  const auto = seg.barId ? structure.value.barStartMeasure.get(seg.barId) : null
  const bar = Number.isFinite(seg.measure) ? positionMeasure(seg) : auto
  if (!Number.isFinite(bar)) return t('common.noValue')
  const beat = Math.max(1, Math.floor(seg.beat || 1))
  return beat > 1 ? t('store.segmentPosition.beat', { bar, beat }) : t('store.segmentPosition.bar', { bar })
}

export { positionBeat, positionMeasure }

export const SCORE_NOT_FOUND = 'scoreNotFound'

export async function open(id) {
  if (player.id && player.id !== id) await close()
  player.loading = true
  player.error = ''
  try {
    const rec = await db.getScore(id)
    if (!rec) {
      const err = new Error(t('domain.error.scoreNotFound'))
      err.code = SCORE_NOT_FOUND
      throw err
    }
    markOpened(id).catch(() => {})
    player.id = id
    player.record = rec
    player.meta = createMeta(rec.meta)
    player.pdfName = rec.pdfName || ''
    player.audioName = rec.meta?.audio?.name || ''
    player.pageCount = player.meta.pages?.length || 0
    player.currentPage = 1
    player.visiblePage = 1

    pdfBlob = await db.getFile(id, 'pdf')
    player.hasPdf = !!pdfBlob
    omrPageCache.clear()
    if (pdfBlob) {
      renderer.value = await PdfRenderer.from(pdfBlob)
      player.pageCount = renderer.value.numPages
    }

    audioBlob = await db.getFile(id, 'audio')
    player.hasAudio = !!audioBlob
    audioUrl = ''
    if (audioBlob) {
      audioUrl = URL.createObjectURL(audioBlob)
      engine.load(audioUrl, player.meta.audio?.duration || 0)
    } else {
      engine.unload()
    }
    applyOutputPrefs()
    peaksRef.value = null
    if (audioBlob) {
      const cached = await db.getFile(id, 'peaks')
      if (cached?.length) {
        peaksRef.value = cached
        player.peaksPerSecond = player.meta.audio?.peaksPerSecond || PEAKS_PER_SECOND
      } else {
        ensurePeaks()
      }
    }
    player.editMode = !rec.editDone
    player.tool = 'row'
    player.mode = 'pan'
    player.selection = null
    player.ready = true
    seek(timelineStart.value)
    dismissAllUndoToasts()
    player.dirty = false
    metronome.setVolume(player.metronomeVolume)
    metronome.setCueVolume(player.cueVolume)
    return ''
  } catch (err) {
    player.error = err?.message || String(err)
    return err?.code === SCORE_NOT_FOUND ? SCORE_NOT_FOUND : 'error'
  } finally {
    player.loading = false
  }
}

export async function ensurePeaks(force = false) {
  if (!player.id) return
  if (peaksRef.value && !force) return
  if (!audioBlob && !force) {
    audioBlob = await db.getFile(player.id, 'audio')
    if (!audioBlob) return
  }
  player.peaksLoading = true
  try {
    const { peaks, perSecond } = await peaksFromBlob(audioBlob)
    const prevBytes = peaksRef.value?.byteLength || 0
    peaksRef.value = peaks
    player.peaksPerSecond = perSecond || PEAKS_PER_SECOND
    await db.putFile(player.id, 'peaks', peaks)
    touchSize(player.id, peaks.byteLength - prevBytes)
    player.meta.audio = { ...player.meta.audio, peaksPerSecond: Number((perSecond || PEAKS_PER_SECOND).toFixed(3)) }
  } catch (err) {
    errorToast(t('store.peaksFailed', { msg: errText(err) }))
  } finally {
    player.peaksLoading = false
  }
}

export async function close() {
  if (player.dirty) await save()
  stopLead()
  player.previewing = false
  player.previewTime = 0
  try {
    engine.unload()
  } catch {}
  clock.pause()
  clock.setLoop(null)
  clock.seek(0)
  metronome.cancelCountIn()
  player.cueing = false
  metronome.stop()
  renderer.value?.destroy()
  renderer.value = null
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = ''
  pdfBlob = null
  audioBlob = null
  peaksRef.value = null
  dismissAllUndoToasts()
  Object.assign(player, {
    id: '',
    record: null,
    meta: createMeta(),
    ready: false,
    hasPdf: false,
    hasAudio: false,
    playing: false,
    previewing: false,
    previewTime: 0,
    cueing: false,
    currentTime: 0,
    selection: null,
    mode: 'pan',
    editMode: false,
    dirty: false,
    drawer: null,
    activeSegmentId: null,
    pendingRepeatBarId: null,
    jumpFlash: null,
    jumpAfter: null,
    autoSaved: false,
  })
}

export async function closeDeleted() {
  player.dirty = false
  await close()
}

export async function finishEdit() {
  if (!player.editMode) return
  player.editMode = false
  await save()
  markEditDone(player.id).catch(() => {})
}

export function markDirty() {
  player.dirty = true
  scheduleSave()
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(), 900)
}

export async function save(force = false) {
  if (!player.id) return
  if (!player.dirty && !force) return
  clearTimeout(saveTimer)
  player.saving = true
  try {
    const rec = await updateScoreMeta(player.id, cloneMeta(player.meta))
    player.record = rec
    player.dirty = false
    player.savedAt = Date.now()
    player.autoSaved = true
    setTimeout(() => (player.autoSaved = false), 1400)
  } catch (err) {
    errorToast(t('store.saveFailed', { msg: errText(err) }))
  } finally {
    player.saving = false
  }
}

function insertBack(list, item, beforeId, afterId) {
  const at = list.findIndex((x) => x.id === afterId)
  if (at >= 0) return [...list.slice(0, at), item, ...list.slice(at)]
  const bt = list.findIndex((x) => x.id === beforeId)
  if (bt >= 0) return [...list.slice(0, bt + 1), item, ...list.slice(bt + 1)]
  return [...list, item]
}

function noteRemoval(...parts) {
  ensureUndoSlot().steps.push({ parts: parts.filter(Boolean) })
}

function ensureUndoSlot() {
  if (!undoSlot.notice) undoSlot.notice = { count: 0, steps: [], id: 0 }
  return undoSlot.notice
}

function partOf(access, item) {
  if (!item) return null
  const list = access.read()
  const i = list.findIndex((x) => x.id === item.id)
  if (i < 0) return null
  return {
    ...access,
    item: JSON.parse(JSON.stringify(item)),
    beforeId: list[i - 1]?.id ?? null,
    afterId: list[i + 1]?.id ?? null,
  }
}

const atSegments = () => ({
  read: () => player.meta.segments,
  write: (next) => { player.meta.segments = next },
})
const atRepeats = () => ({
  read: () => player.meta.repeats,
  write: (next) => { player.meta.repeats = next },
})
const atSystems = (pageIndex) => ({
  read: () => player.meta.pages[pageIndex]?.systems || [],
  write: (next) => { const p = player.meta.pages[pageIndex]; if (p) p.systems = next },
})
const atBars = (pageIndex, systemId) => ({
  read: () => findSystem(systemId)?.sys.bars || [],
  write: (next) => { const f = findSystem(systemId); if (f) f.sys.bars = next },
})

export function undoLastDeletions() {
  const notice = undoSlot.notice
  if (!notice?.steps.length) return
  const step = notice.steps.pop()
  for (const part of step.parts) {
    const list = part.read()
    if (list.some((x) => x.id === part.item.id)) continue
    part.write(insertBack(list, part.item, part.beforeId, part.afterId))
  }
  notice.count = Math.max(0, notice.count - 1)
  markDirty()
  if (!notice.steps.length) return dismissUndoToast()
  resendUndoToast()
}

function resendUndoToast() {
  const notice = undoSlot.notice
  if (!notice) return
  notifyUndoToast(undoSlot, (n) => t('store.deleteCount', { n }), 'undo', 'undo', false)
}

function dismissUndoToast() {
  if (undoSlot.notice?.id) dismissToast(undoSlot.notice.id)
  undoSlot.notice = null
  clearTimeout(undoSlot.timer)
}

function dismissAllUndoToasts() {
  dismissUndoToast()
}

export function addSystem(pageIndex, y0, y1, minH = DEFAULT_MIN_H) {
  const page = player.meta.pages[pageIndex]
  if (!page) return null
  const box = clampToPage(y0, y1, page.height, minH)
  if (!box) return null
  const { lo, hi } = box
  const exists = (page.systems || []).find((s) => Math.abs(s.y0 - lo) < 2 && Math.abs(s.y1 - hi) < 2)
  if (exists) return exists
  if (overlapSystem(page.systems, lo, hi)) {
    dangerToast(t('store.row.overlap'))
    return null
  }
  const sys = { id: uid('sy'), y0: lo, y1: hi, bars: [] }
  page.systems.push(sys)
  page.systems.sort((a, b) => b.y0 - a.y0)
  markDirty()
  detectRowBars(pageIndex, sys.id).catch(() => {})
  return sys
}

async function detectRowBars(pageIndex, systemId) {
  if (!pdfBlob) return
  try {
    let pending = omrPageCache.get(pageIndex)
    if (!pending) {
      pending = detectPdfPage(pdfBlob, pageIndex + 1).then((res) => res.systems || [])
      pending.catch(() => omrPageCache.delete(pageIndex))
      omrPageCache.set(pageIndex, pending)
    }
    const systems = await pending
    const page = player.meta.pages[pageIndex]
    const sys = (page?.systems || []).find((s) => s.id === systemId)
    if (!sys || (sys.bars || []).length) return
    const lo = Math.min(sys.y0, sys.y1)
    const hi = Math.max(sys.y0, sys.y1)
    const xs = []
    for (const s of systems) {
      const a = Math.min(s.y0, s.y1)
      const b = Math.max(s.y0, s.y1)
      if (a >= hi || b <= lo) continue
      for (const bar of s.bars || []) xs.push(bar.x)
    }
    if (!xs.length) return
    const sorted = xs.slice().sort((a, b) => a - b)
    const kept = []
    for (const x of sorted) {
      if (kept.length && x - kept[kept.length - 1] < 8) continue
      kept.push(x)
    }
    sys.bars = kept.map((x) => ({ id: uid('br'), x }))
    markDirty()
  } catch (err) {
    console.warn('新建行后自动识别小节线失败，这一行照旧留着，可以手动标', err)
  }
}

export function removeSystem(systemId, notify = true) {
  const found = findSystem(systemId)
  if (!found) return
  const barIds = new Set((found.sys.bars || []).map((b) => b.id))
  const hitSegs = player.meta.segments.filter((s) => barIds.has(s.barId))
  const hitReps = player.meta.repeats.filter((r) => barIds.has(r.barId))
  const barParts = (found.sys.bars || []).map((b) => partOf(atBars(found.pageIndex, systemId), b))
  noteRemoval(
    partOf(atSystems(found.pageIndex), found.sys),
    ...barParts,
    ...hitSegs.map((s) => partOf(atSegments(), s)),
    ...hitReps.map((r) => partOf(atRepeats(), r)),
  )
  found.page.systems.splice(found.sysIndex, 1)
  cascadeRemoveBars(barIds)
  markDirty()
  if (notify) notifyUndo()
}
export function findSystem(systemId) {
  for (let p = 0; p < player.meta.pages.length; p++) {
    const systems = player.meta.pages[p].systems || []
    const i = systems.findIndex((s) => s.id === systemId)
    if (i >= 0) return { page: player.meta.pages[p], pageIndex: p, sys: systems[i], sysIndex: i }
  }
  return null
}

export function findBar(barId) {
  for (let p = 0; p < player.meta.pages.length; p++) {
    for (const sys of player.meta.pages[p].systems || []) {
      const bar = (sys.bars || []).find((b) => b.id === barId)
      if (bar) return { page: player.meta.pages[p], pageIndex: p, sys, bar }
    }
  }
  return null
}

function cascadeRemoveBars(barIds) {
  let removed = 0
  const before = player.meta.segments.length + player.meta.repeats.length
  player.meta.segments = player.meta.segments.filter((s) => !barIds.has(s.barId))
  player.meta.repeats = player.meta.repeats.filter((r) => !barIds.has(r.barId))
  removed = before - (player.meta.segments.length + player.meta.repeats.length)
  if (player.activeSegmentId && !player.meta.segments.some((s) => s.id === player.activeSegmentId)) {
    player.activeSegmentId = null
    player.drawer = null
  }
  return removed
}

export function addBar(systemId, x) {
  const found = findSystem(systemId)
  if (!found) return null
  const near = (found.sys.bars || []).find((b) => Math.abs(b.x - x) < 8)
  if (near) return near
  const bar = { id: uid('br'), x }
  found.sys.bars = [...(found.sys.bars || []), bar].sort((a, b) => a.x - b.x)
  markDirty()
  return bar
}

export function removeBar(barId, notify = true) {
  const found = findBar(barId)
  if (!found) return
  noteRemoval(
    partOf(atBars(found.pageIndex, found.sys.id), found.bar),
    ...player.meta.segments.filter((s) => s.barId === barId).map((s) => partOf(atSegments(), s)),
    ...player.meta.repeats.filter((r) => r.barId === barId).map((r) => partOf(atRepeats(), r)),
  )
  found.sys.bars = found.sys.bars.filter((b) => b.id !== barId)
  cascadeRemoveBars(new Set([barId]))
  markDirty()
  if (notify) notifyUndo()
}

export function prevSegmentBefore(measure) {
  const segs = player.meta.segments || []
  let best = null
  for (const s of segs) {
    const no = Number.isFinite(s.measure) ? positionMeasure(s) : structure.value.barStartMeasure.get(s.barId)
    if (!Number.isFinite(no)) continue
    if (no < measure && (!best || no > best.measure)) best = { seg: s, measure: no }
  }
  return best?.seg || null
}

export function addSegmentAt(barId) {
  const auto = structure.value.barStartMeasure.get(barId)
  if (!Number.isFinite(auto)) {
    dangerToast(t('store.segment.noMeasureAfterBarline'))
    return null
  }
  const existing = (player.meta.segments || []).find((s) => s.barId === barId)
  if (existing) {
    openSegment(existing.id)
    return existing
  }
  if (isRowEndBar(structure.value, barId)) {
    dangerToast(t('store.segment.rowEndBarline'))
    return null
  }
  if (auto <= 1) {
    const head = (player.meta.segments || []).find((s) => s.head)
    if (head) {
      openSegment(head.id)
      return head
    }
  }
  const prev = prevSegmentBefore(auto)
  const seg = defaultSegment({
    barId,
    measure: auto,
    beat: 1,
    bpm: prev?.bpm ?? 120,
    beatsPerBar: prev?.beatsPerBar ?? 4,
    beatUnit: prev?.beatUnit ?? 4,
  })
  player.meta.segments.push(seg)
  player.meta.segments.sort(comparePosition)
  player.activeSegmentId = seg.id
  player.drawer = 'segment'
  markDirty()
  return seg
}

export function openSegment(id) {
  player.activeSegmentId = id
  player.drawer = 'segment'
}

export function removeSegment(id, notify = true) {
  const seg = player.meta.segments.find((s) => s.id === id)
  if (!seg) return
  if (seg.head) {
    dangerToast(t('store.segment.headNotDeletable'))
    return
  }
  noteRemoval(partOf(atSegments(), seg))
  player.meta.segments = player.meta.segments.filter((s) => s.id !== id)
  if (player.activeSegmentId === id) {
    player.activeSegmentId = null
    player.drawer = null
  }
  markDirty()
  if (notify) notifyUndo()
}
export function updateSegment(id, patch) {
  const seg = player.meta.segments.find((s) => s.id === id)
  if (!seg) return
  if (seg.head) patch = { ...patch, measure: 1, beat: 1, barId: null }
  Object.assign(seg, patch)
  seg.beat = fitBeat(seg.beat, seg.beatsPerBar)
  markDirty()
}

export function captureSegmentTime(id, time = player.currentTime) {
  updateSegment(id, { time: Number(time.toFixed(3)) })
}

export function clearSegmentTime(id) {
  updateSegment(id, { time: null })
}

export function discardPendingRepeat() {
  player.pendingRepeatBarId = null
}

function blockAtBarBarline(barId) {
  return timeline.value.blocks.find((b) => b.startBarId === barId || b.endBarId === barId) || null
}

export function addRepeatAt(barId) {
  const onBar = (player.meta.repeats || []).filter((r) => r.barId === barId)
  if (onBar.length) {
    if (onBar.some((r) => r.kind === 'house1')) {
      noteRemoval(...onBar.map((r) => partOf(atRepeats(), r)))
      player.meta.repeats = player.meta.repeats.filter((r) => r.barId !== barId)
      markDirty()
      notifyUndo()
      return null
    }
    const block = blockAtBarBarline(barId)
    const doomed = block
      ? new Set([block.startBarId, block.endBarId, ...block.houseMarks.map((m) => m.barId)])
      : new Set([barId])
    const hit = player.meta.repeats.filter((r) => doomed.has(r.barId))
    noteRemoval(...hit.map((r) => partOf(atRepeats(), r)))
    player.meta.repeats = player.meta.repeats.filter((r) => !doomed.has(r.barId))
    discardPendingRepeat()
    markDirty()
    notifyUndo()
    return null
  }

  const decision = decideRepeatTap(barId, {
    structure: structure.value,
    total: measureCount.value,
    repeats: player.meta.repeats || [],
    pendingBarId: player.pendingRepeatBarId,
  })

  if (decision.type === 'start') {
    player.pendingRepeatBarId = barId
    return null
  }

  if (decision.type === 'complete') {
    player.meta.repeats.push(defaultRepeat({ barId: decision.startBarId, kind: 'start' }))
    player.meta.repeats.push(defaultRepeat({ barId, kind: 'end' }))
    player.pendingRepeatBarId = null
    markDirty()
    return null
  }

  if (decision.type === 'house1') {
    player.meta.repeats.push(defaultRepeat({ barId, kind: 'house1' }))
    player.pendingRepeatBarId = null
    markDirty()
    return null
  }

  if (decision.type === 'house1-move') {
    const mark = player.meta.repeats.find((r) => r.barId === decision.fromBarId && r.kind === 'house1')
    if (mark) mark.barId = barId
    player.pendingRepeatBarId = null
    markDirty()
    return null
  }

  discardPendingRepeat()
  dangerToast(t(`store.repeat.reject.${decision.reason}`))
  return null
}

export function removeRepeat(id, notify = true) {
  const rep = player.meta.repeats.find((r) => r.id === id)
  noteRemoval(partOf(atRepeats(), rep))
  player.meta.repeats = player.meta.repeats.filter((r) => r.id !== id)
  markDirty()
  if (notify) notifyUndo()
}

function applyOutputPrefs() {
  if (player.hasAudio) {
    engine.setRate(player.rate)
    engine.setVolume(player.volume)
    engine.setMuted(player.muted)
    metronome.setMuted(false)
    return
  }
  engine.setRate(player.rate)
  engine.setMuted(true)
  clock.setRate(player.rate)
  clock.duration = timeline.value.duration
  metronome.setMuted(false)
}

export function applyRate(rate) {
  player.rate = rate
  applyOutputPrefs()
  metronome.reset()
  savePrefs()
}

export function applyCustomRate(rate) {
  const v = normRate(rate)
  if (v !== player.rate) rememberRate(v)
  applyRate(v)
}

function rememberRate(rate) {
  player.rateHistory = [rate, ...player.rateHistory.filter((r) => r !== rate)].slice(0, RATE_HISTORY_MAX)
}

export function clearRateHistory() {
  if (!player.rateHistory.length) return
  player.rateHistory = []
  savePrefs()
}

export function applyVolume(v) {
  player.volume = Math.max(0, Math.min(1, v))
  player.muted = player.volume === 0
  applyOutputPrefs()
  savePrefs()
}

function previewStart(centerSeconds) {
  return Math.max(0, Number(centerSeconds) || 0)
}

function syncPreviewOutput() {
  engine.setPreviewVolume(player.volume)
  engine.setPreviewMuted(player.muted)
}

export async function startPreview(centerSeconds) {
  if (!player.hasAudio) return false
  syncPreviewOutput()
  engine.previewSeek(previewStart(centerSeconds))
  player.previewTime = engine.previewTime
  player.previewing = true
  const ok = await engine.previewPlay()
  if (!ok) {
    player.previewing = false
    player.previewTime = 0
    return false
  }
  return true
}

export function stopPreview() {
  engine.previewPause()
  player.previewing = false
  player.previewTime = 0
}

export function pausePlayback() {
  metronome.cancelCountIn()
  player.cueing = false
  if (player.jumpFlash) player.jumpFlash = null
  stopLead()
  suppressRewind = false
  engine.pause()
  clock.pause()
}

export async function togglePlay() {
  if (player.playing || metronome.countInActive) {
    pausePlayback()
    return
  }
  if (!canPlay.value) {
    dangerToast(t('store.nothingToPlay'))
    return
  }
  await startPlayback({ cue: settings.countInPlay })
}

export function seek(time, { keepLoop = true } = {}) {
  const dur = duration.value
  const clamped = dur ? Math.min(time, dur) : Number(time) || 0
  stopLead()
  if (clamped < 0) {
    clock.leadPos = clamped
    if (!engine.paused) {
      const keep = suppressRewind
      suppressRewind = true
      engine.pause()
      suppressRewind = keep
    }
  } else {
    clock.seek(clamped)
  }
  player.currentTime = clamped
  metronome.reset()
  if (player.loopOn && player.selection && keepLoop) {
    const region = loopRegion.value
    if (region && (clamped < region.start - 0.05 || clamped > region.end + 0.05)) {
      clearSelection()
    }
  }
}

export async function seekToPosition(measureNo, beatOffset = 0, opts = {}) {
  const tl = timeline.value
  const anchor = tl.posToTime(measureNo, null, beatOffset)
  const rolling = player.playing || player.cueing
  const wantPlay = opts.play ?? (settings.autoPlayOnJump || rolling)
  const wantCue = opts.cue ?? settings.countInJump
  if (player.jumpFlash) player.jumpFlash = null
  if (wantPlay && canPlay.value) {
    const cueing = await startPlayback({ from: anchor, cue: wantCue, landing: measureNo })
    if (cueing) return anchor
  } else {
    seek(anchor)
  }
  flashAfterJump(measureNo)
  return anchor
}

let suppressRewind = false

let leadRaf = 0
let leadFrom = 0
let leadAt = 0

function stopLead() {
  if (leadRaf) cancelAnimationFrame(leadRaf)
  leadRaf = 0
}

function leadPos() {
  return leadFrom + ((performance.now() - leadAt) / 1000) * (player.rate || 1)
}

function leadTick() {
  if (!leadRaf) return
  const pos = leadPos()
  clock.leadPos = pos
  player.currentTime = pos
  if (pos < 0) {
    leadRaf = requestAnimationFrame(leadTick)
    return
  }
  leadRaf = 0
  seek(pos)
  playFrom()
}

function startLead() {
  const from = player.currentTime
  if (!(from < 0)) return false
  leadFrom = from
  leadAt = performance.now()
  const keep = suppressRewind
  suppressRewind = true
  if (!engine.paused) engine.pause()
  suppressRewind = keep
  clock.leadPos = from
  player.currentTime = from
  player.playing = true
  if (player.metronomeVolume > 0) startMetronome()
  if (!leadRaf) leadRaf = requestAnimationFrame(leadTick)
  return true
}

function playFrom() {
  if (startLead()) return
  if (player.metronomeVolume > 0) startMetronome()
  if (player.hasAudio) {
    engine.play()
    return
  }
  clock.play()
}

function countInTiming(source) {
  return {
    beats: Math.max(1, Math.round(source?.beatsPerBar || 4)),
    beatMs: Math.max(160, Math.round((beatDuration(source) * 1000) / (player.rate || 1))),
  }
}

function startCountIn(landing, onDone) {
  const timing = countInTiming(landing || currentPos.value.sample)
  player.cueing = true
  player.playing = true
  if (landing) flashCountInLanding(landing, timing)
  metronome.countIn(timing.beats, timing.beatMs / 1000, () => {
    player.cueing = false
    if (landing) player.jumpFlash = null
    onDone()
  })
}

function countInSample(from) {
  const sample = from != null ? timeline.value.timeToPos(from).sample : currentPos.value.sample
  return sample || null
}

async function startPlayback({ from = null, cue = false, landing = null } = {}) {
  const wantCue = cue && player.cueVolume > 0
  if (!wantCue) {
    if (from != null) seek(from)
    playFrom()
    return false
  }
  const beat = countInSample(from)
  suppressRewind = true
  stopSources()
  await metronome.resume()
  startCountIn(beat, () => {
    suppressRewind = false
    if (from != null) seek(from)
    if (from != null && landing != null) flashAfterJump(landing)
    playFrom()
  })
  return true
}

export function setCueVolume(v) {
  player.cueVolume = Math.max(0, Math.min(1, Number(v) || 0))
  metronome.setCueVolume(player.cueVolume)
  savePrefs()
}

function rewindToMeasureStart() {
  const no = currentPos.value.no
  if (!no) return
  const at = timeline.value.posToTime(no, player.currentTime)
  if (Number.isFinite(at) && Math.abs(clock.now - at) > 0.04) seek(at)
}

export const loopRegion = computed(() => {
  if (!player.selection) return null
  const tl = timeline.value
  const from = player.selection.from
  const to = player.selection.to
  const t0 = tl.posToTime(from, player.currentTime)
  const t1 = tl.posToTime(to, t0) + tl.measureDuration(to, t0)
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null
  return { start: t0, end: t1 }
})

function loopCountInOn() {
  return settings.countInLoop && player.cueVolume > 0
}

function activeLoop() {
  const region = clock.loop
  return region && region.end > region.start ? region : null
}

function loopLastStart(loop) {
  const samples = timeline.value.samples
  const last = timeline.value.timeToPos(Math.max(loop.start, loop.end - 0.001)).sample
  if (!last) return null
  let i = last.index
  while (i > 0 && samples[i].beat !== 1) i--
  return samples[i]
}

function loopStartSample(loop) {
  return timeline.value.timeToPos(loop.start).sample || null
}

export function setMode(mode) {
  const next = mode === 'pointer' ? 'pointer' : 'pan'
  if (player.mode === next) return
  player.mode = next
  if (next === 'pan' && player.selection) clearSelection()
}

export function setSelection(from, to) {
  if (!from || !to) return
  const a = Math.min(from, to)
  const b = Math.max(from, to)
  player.selection = { from: a, to: b }
  const tl = timeline.value
  const t0 = tl.posToTime(a, player.currentTime)
  const t1 = tl.posToTime(b, t0) + tl.measureDuration(b, t0)
  const region = { start: t0, end: Math.max(t1, t0 + 0.2) }
  if (!canPlay.value) return
  player.loopOn = true
  clock.setLoop(region)
  metronome.reset()
  if (loopCountInOn()) startPlayback({ from: region.start, cue: true, landing: a })
  else {
    seek(region.start)
    playFrom()
    armLoopLandingIfLastMeasure()
  }
}

export function clearSelection() {
  player.selection = null
  player.loopOn = false
  clock.setLoop(null)
}

export function toggleMetronome() {
  setMetronomeVolume(player.metronomeVolume > 0 ? 0 : 0.6)
}

export function setMetronomeVolume(v) {
  player.metronomeVolume = Math.max(0, Math.min(1, Number(v) || 0))
  metronome.setVolume(player.metronomeVolume)
  if (player.metronomeVolume > 0) {
    if (player.playing) startMetronome()
  } else {
    metronome.stop()
  }
  savePrefs()
}

export function metronomeOn() {
  return player.metronomeVolume > 0
}

const UNDO_MS = 6000

function notifyUndoToast(slot, text, key, action, bump = true) {
  const cur = slot.notice
  const count = bump ? (cur ? cur.count + 1 : 1) : cur?.count || 0
  const x = actionToast(text(count), action, t('common.undo'), {
    key,
    ms: UNDO_MS,
    total: UNDO_MS,
  })
  slot.notice = { count, steps: cur?.steps || [], id: x.id }
  clearTimeout(slot.timer)
  slot.timer = setTimeout(() => {
    slot.notice = null
  }, UNDO_MS)
}

function notifyUndo() {
  notifyUndoToast(undoSlot, (n) => t('store.deleteCount', { n }), 'undo', 'undo')
}

function startMetronome() {
  metronome.reset()
  metronome.start(
    (t0, t1) => {
      const loop = player.loopOn ? loopRegion.value : null
      let hi = t1
      if (loop && loop.end < hi) hi = loop.end
      return timeline.value.beatsBetween(t0, hi)
    },
    clock
  )
}

function stopSources() {
  metronome.stop()
  if (player.hasAudio) engine.pause()
  else clock.pause()
}

function handleLoopEnd(region) {
  const loop = region
  const startSample = loopStartSample(loop)
  if (!loopCountInOn()) {
    const keep = suppressRewind
    suppressRewind = true
    seek(region.start)
    flashAfterJump(startSample?.no, startSample)
    player.jumpFlash = null
    playFrom()
    armLoopLandingIfLastMeasure()
    suppressRewind = keep
    return true
  }
  const pos = timeline.value.timeToPos(region.start)
  suppressRewind = true
  stopSources()
  player.cueing = true
  player.currentTime = Math.max(region.start, region.end - 0.001)
  startCountIn(pos.sample, () => {
    suppressRewind = false
    seek(region.start)
    flashAfterJump(pos.no, pos.sample)
    playFrom()
    armLoopLandingIfLastMeasure()
  })
  return true
}

engine.on('play', () => (player.playing = true))
engine.on('pause', () => {
  if (suppressRewind) return
  const wasPlaying = player.playing
  player.playing = false
  if (wasPlaying && !engine.ended) rewindToMeasureStart()
})
engine.on('time', (t) => {
  if (clock.leadPos != null) return
  if (player.cueing) return
  player.currentTime = t
})
engine.on('error', (err) => errorToast(t('store.audioPlayError', { msg: errText(err) })))
engine.on('previewError', (err) =>
  errorToast(t('audio.previewFailed', { msg: errText(err, t('common.noAudio')) }))
)
engine.on('previewTime', (t) => {
  if (player.previewing) player.previewTime = t
})
engine.on('previewEnded', () => {
  if (!player.previewing) return
  player.previewing = false
})
engine.onLoopEnd = handleLoopEnd

let uiRaf = 0
clock.on('play', () => {
  player.playing = true
  if (uiRaf) return
  const tick = () => {
    uiRaf = requestAnimationFrame(tick)
    clock.tick()
  }
  uiRaf = requestAnimationFrame(tick)
})
clock.on('pause', () => {
  if (suppressRewind) return
  player.playing = false
  if (uiRaf) cancelAnimationFrame(uiRaf)
  uiRaf = 0
})
clock.on('time', (t) => {
  player.currentTime = t
})
clock.onLoopEnd = handleLoopEnd
clock.resync()

watch(
  () => currentPos.value.no,
  (no, prev) => {
    if (!player.autoTurn) return
    if (!no) return
    const m = structure.value.measures[no - 1]
    if (!m) return
    const prevM = prev ? structure.value.measures[prev - 1] : null
    if (!prevM || m.page !== prevM.page) player.currentPage = m.page + 1
  }
)

watch(
  () => timeline.value.duration,
  (d) => {
    clock.duration = d
  },
  { immediate: true }
)

watch(
  () => player.currentTime,
  (t) => {
    if (player.hasAudio || player.loopOn || metronome.countInActive || suppressRewind) return
    if (clock.ended) engine.pause()
    else if (t > 0 && t >= clock.duration) clock.pause()
  }
)

watch(
  () => [player.tool, player.editMode],
  () => {
    if (player.pendingRepeatBarId) player.pendingRepeatBarId = null
  }
)

watch(
  () => player.editMode,
  (on) => {
    if (on && (player.playing || metronome.countInActive)) pausePlayback()
  }
)

onRecordUpdated((rec) => {
  if (rec?.id && rec.id === player.id) player.record = rec
})

let lastFlashTick = 0
function setBeforeFlash(no, index, ms, repeats) {
  player.jumpFlash = { no, index, tick: ++lastFlashTick, ms, repeats }
}
function setAfterFlash(no, index, ms) {
  player.jumpAfter = { no, index, tick: ++lastFlashTick, ms }
}

function landingSample(measureNo) {
  const cur = currentPos.value.sample
  if (cur && cur.no === measureNo) return cur
  return timeline.value.samples.find((s) => s.no === measureNo && s.beat === 1) || null
}

function flashAfterJump(measureNo, sample = null) {
  if (!measureNo) return
  const beat = sample || landingSample(measureNo)
  const timing = countInTiming(beat || tempoAt(timeline.value.segments, measureNo))
  setAfterFlash(measureNo, beat?.index ?? -1, timing.beatMs)
}

function beforeJumpTiming(measureSample) {
  const beats = Math.max(1, Math.round(measureSample?.beatsPerBar || 4))
  const dur = measureSample ? timeline.value.measureDuration(measureSample.no, player.currentTime) : 0
  const fromMeasure = Number.isFinite(dur) && dur > 0 ? Math.round(((dur / beats) * 1000) / (player.rate || 1)) : 0
  return { beats, beatMs: Math.max(160, fromMeasure || countInTiming(measureSample).beatMs) }
}

function flashLoopLanding(loop) {
  const sample = loopStartSample(loop)
  if (sample) flashBeforeJump(sample, true, beforeJumpTiming(currentPos.value.sample))
}

function armLoopLandingIfLastMeasure() {
  const loop = loopingToLastMeasure()
  if (!loop) return false
  if (!loopCountInOn()) flashLoopLanding(loop)
  return true
}

function loopingToLastMeasure() {
  const loop = activeLoop()
  if (!loop) return null
  const sample = currentPos.value.sample
  const lastStart = loopLastStart(loop)
  if (!sample || !lastStart) return null
  const samples = timeline.value.samples
  let cur = sample.index
  while (cur > 0 && samples[cur].beat !== 1) cur--
  return lastStart.index === cur ? loop : null
}

function flashBeforeJump(sample, force = false, timing = null) {
  const t = timing || countInTiming(sample)
  const cur = player.jumpFlash
  if (!force && cur && cur.no === sample.no && cur.index === sample.index && cur.ms === t.beatMs && cur.repeats === t.beats) return
  setBeforeFlash(sample.no, sample.index, t.beatMs, t.beats)
}

function flashCountInLanding(sample, timing) {
  if (!sample) return
  flashBeforeJump(sample, true, timing)
}

watch(
  () => currentPos.value.no,
  () => {
    const sample = currentPos.value.sample
    if (!sample) return

    if (player.cueing) return

    const passed = sample.index
    const hint = player.jumpFlash

    if (player.jumpAfter && player.jumpAfter.index >= 0 && player.jumpAfter.index < passed) player.jumpAfter = null

    if (hint && hint.index < passed) {
      player.jumpFlash = null
      return
    }
    if (hint && hint.index === passed) {
      const landing = hint.no
      player.jumpFlash = null
      flashAfterJump(landing)
      armLoopLandingIfLastMeasure()
      return
    }
    if (!player.playing && !metronome.countInActive) return
    if (hint) return
    if (armLoopLandingIfLastMeasure()) return
    const samples = timeline.value.samples
    let nextStart = null
    for (let i = sample.index + 1; i < samples.length; i++) {
      if (samples[i].beat === 1) {
        nextStart = samples[i]
        break
      }
    }
    if (nextStart?.jumpTo) flashBeforeJump(nextStart, false, beforeJumpTiming(sample))
  }
)

export function setCurrentPageFromVisible(pageIndex) {
  player.visiblePage = pageIndex + 1
}

function syncPageCount() {
  player.pageCount = player.meta.pages?.length || renderer.value?.numPages || 0
}

export async function importAudio(file) {
  if (!player.id || !file) return
  const prevBytes = (audioBlob?.size || 0) + (peaksRef.value?.byteLength || 0)
  audioBlob = file
  await db.putFile(player.id, 'audio', file)
  touchSize(player.id, file.size - prevBytes)
  player.meta.audio = {
    ...player.meta.audio,
    name: file.name,
    type: file.type || '',
    duration: null,
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = URL.createObjectURL(file)
  player.hasAudio = true
  player.audioName = file.name
  engine.load(audioUrl, 0)
  applyOutputPrefs()
  peaksRef.value = null
  await ensurePeaks(true)
  const dur = engine.duration
  if (dur) player.meta.audio.duration = dur
  markDirty()
  toast(t('store.audioImported', { name: file.name }))
}

export async function importPdf(file) {
  if (!player.id || !file) return
  const { PdfRenderer: R, pageSizes: sizes } = await import('../domain/pdf.js')
  const r = await R.from(file)
  try {
    const list = await sizes(r.doc)
    player.meta.pages = list.map((s, i) => {
      const prev = player.meta.pages[i]
      return prev ? { ...prev, width: s.width, height: s.height } : { width: s.width, height: s.height, systems: [] }
    })
  } finally {
    r.destroy()
  }
  await db.putFile(player.id, 'pdf', file)
  touchSize(player.id, file.size - (pdfBlob?.size || 0))
  renderer.value?.destroy()
  renderer.value = await PdfRenderer.from(file)
  pdfBlob = file
  player.hasPdf = true
  player.pdfName = file.name
  syncPageCount()
  markDirty()
  toast(t('store.pdfImported', { name: file.name }))
}

export function metaSummary(meta) {
  const stats = metaStats(meta)
  return {
    systems: stats.systems,
    measures: deriveStructure(meta).count,
    segments: (meta?.segments || []).filter((s) => !s.head).length,
    repeats: stats.repeats,
  }
}

export async function readMetaJson(file) {
  if (!file) return null
  let raw
  try {
    raw = JSON.parse(await file.text())
  } catch {
    throw new Error(t('domain.error.badJson'))
  }
  const meta = createMeta(raw)
  if (renderer.value) {
    try {
      const { pageSizes } = await import('../domain/pdf.js')
      syncPages(meta, await pageSizes(renderer.value.doc))
    } catch {}
  }
  return meta
}

export async function applyMetaJson(file, meta = null) {
  if (!player.id || !file) return null
  const next = meta || (await readMetaJson(file))
  player.meta = next
  player.selection = null
  player.drawer = null
  player.activeSegmentId = null
  player.pendingRepeatBarId = null
  markDirty()
  toast(t('store.jsonApplied'))
  return next
}

export async function removeAudio() {
  if (!player.id) return
  const wasPlaying = player.playing
  engine.unload()
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = ''
  audioBlob = null
  peaksRef.value = null
  player.hasAudio = false
  player.audioName = ''
  player.meta.audio = { ...player.meta.audio, name: '', type: '', duration: null, peaksPerSecond: null }
  await db.deleteFile(player.id, 'audio')
  await db.deleteFile(player.id, 'peaks')
  touchSize(player.id, null)
  applyOutputPrefs()
  seek(player.currentTime)
  if (wasPlaying && !canPlay.value) clock.pause()
  markDirty()
}

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatTimeMs(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
