export function uid(prefix = '') {
  let s
  if (typeof crypto !== 'undefined' && crypto.randomUUID) s = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  else s = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  return prefix ? `${prefix}_${s}` : s
}

export const META_VERSION = 1

export const DEFAULT_BPM = 120
export const DEFAULT_BEATS_PER_BAR = 4
export const DEFAULT_BEAT_UNIT = 4

export const SEGMENT_COLORS = [null]

export const DEFAULT_POSITION_BEAT = 1

export function positionMeasure(pos) {
  const n = Math.round(Number(pos?.measure))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export function positionBeat(pos) {
  const n = Math.round(Number(pos?.beat))
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_POSITION_BEAT
}

export function comparePosition(a, b) {
  return positionMeasure(a) - positionMeasure(b) || positionBeat(a) - positionBeat(b)
}

export function fitMeasure(value) {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export function fitBeat(value, beatsPerBar) {
  const beats = Math.min(32, Math.max(1, Math.round(Number(beatsPerBar)) || DEFAULT_BEATS_PER_BAR))
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < 1) return DEFAULT_POSITION_BEAT
  return Math.min(n, beats)
}

export function normalizeTags(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const raw of list) {
    const tag = String(raw ?? '').trim().slice(0, 24)
    if (!tag) continue
    if (!out.includes(tag)) out.push(tag)
    if (out.length >= 24) break
  }
  return out
}

export const REPEAT_KINDS = {
  start: { key: 'start', labelKey: 'repeatKind.start.label' },
  end: { key: 'end', labelKey: 'repeatKind.end.label' },
  house1: { key: 'house1', labelKey: 'repeatKind.house1.label', shortKey: 'repeatKind.house1.short' },
  house2: { key: 'house2', shortKey: 'repeatKind.house2.short' },
}

export function defaultSegment(patch = {}) {
  return {
    id: uid('sg'),
    barId: null,
    name: '',
    bpm: DEFAULT_BPM,
    beatsPerBar: DEFAULT_BEATS_PER_BAR,
    beatUnit: DEFAULT_BEAT_UNIT,
    measure: null,
    beat: DEFAULT_POSITION_BEAT,
    time: null,
    head: false,
    ...patch,
  }
}

export const HEAD_SEGMENT = {
  name: '',
  bpm: DEFAULT_BPM,
  beatsPerBar: DEFAULT_BEATS_PER_BAR,
  beatUnit: DEFAULT_BEAT_UNIT,
  measure: 1,
  beat: DEFAULT_POSITION_BEAT,
}

export function ensureHeadSegment(segments) {
  const list = Array.isArray(segments) ? segments : []
  const head = list.find((s) => s.head)
  if (head) {
    head.measure = 1
    head.beat = DEFAULT_POSITION_BEAT
    return list
  }
  list.unshift(defaultSegment({ ...HEAD_SEGMENT, head: true }))
  return list
}

export function defaultRepeat(patch = {}) {
  return {
    id: uid('rp'),
    kind: 'start',
    barId: null,
    label: '',
    passes: 2,
    backToMeasure: null,
    houseEndMeasure: null,
    ...patch,
  }
}

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

function normalizePage(raw) {
  const systems = Array.isArray(raw?.systems)
    ? raw.systems
        .map((s) => ({
          id: s.id || uid('sy'),
          y0: num(s.y0),
          y1: num(s.y1),
          bars: (Array.isArray(s.bars) ? s.bars : [])
            .map((b) => ({ id: b?.id || uid('br'), x: num(b?.x) }))
            .sort((a, b) => a.x - b.x),
        }))
        .sort((a, b) => b.y0 - a.y0)
    : []
  return { width: num(raw?.width, 595.28), height: num(raw?.height, 841.89), systems }
}

export function createMeta(init = {}) {
  const audio = init.audio || {}
  return {
    version: META_VERSION,
    title: typeof init.title === 'string' ? init.title : '',
    tags: normalizeTags(init.tags),
    audio: {
      name: typeof audio.name === 'string' ? audio.name : '',
      type: typeof audio.type === 'string' ? audio.type : '',
      duration: Number.isFinite(audio.duration) ? audio.duration : null,
      startOffset: num(audio.startOffset, 0),
      startPosition: Math.max(1, Math.round(num(audio.startPosition, 1))),
      peaksPerSecond: num(audio.peaksPerSecond, 0) || null,
    },
    pages: Array.isArray(init.pages) ? init.pages.map(normalizePage) : [],
    segments: ensureHeadSegment(
      (Array.isArray(init.segments) ? init.segments : [])
        .filter((s) => s && (s.barId || Number.isFinite(s.measure) || s.head))
        .map((s) => {
          const beatsPerBar = Math.min(32, Math.max(1, Math.round(num(s.beatsPerBar, DEFAULT_BEATS_PER_BAR))))
          return defaultSegment({
            ...s,
            id: s.id || uid('sg'),
            bpm: Math.min(400, Math.max(20, num(s.bpm, DEFAULT_BPM))),
            beatsPerBar,
            beatUnit: [1, 2, 4, 8, 16].includes(num(s.beatUnit, DEFAULT_BEAT_UNIT))
              ? num(s.beatUnit, DEFAULT_BEAT_UNIT)
              : DEFAULT_BEAT_UNIT,
            measure: Number.isFinite(s.measure) ? fitMeasure(s.measure) : null,
            beat: fitBeat(s.beat, beatsPerBar),
            time: Number.isFinite(s.time) ? s.time : null,
            head: !!s.head,
          })
        })
    ),
    repeats: (Array.isArray(init.repeats) ? init.repeats : [])
      .filter((r) => r && r.barId)
      .map((r) =>
        defaultRepeat({
          ...r,
          id: r.id || uid('rp'),
          kind: REPEAT_KINDS[r.kind] ? r.kind : 'start',
          passes: Math.min(16, Math.max(2, Math.round(num(r.passes, 2)))),
          backToMeasure: Number.isFinite(r.backToMeasure) ? r.backToMeasure : null,
          houseEndMeasure: Number.isFinite(r.houseEndMeasure) ? r.houseEndMeasure : null,
        })
      ),
  }
}

export function syncPages(meta, pageSizes) {
  if (!Array.isArray(pageSizes) || !pageSizes.length) return meta
  const next = pageSizes.map((size, i) => {
    const prev = meta.pages[i]
    const width = num(size.width, 595.28)
    const height = num(size.height, 841.89)
    if (!prev) return { width, height, systems: [] }
    return { width, height, systems: prev.systems || [] }
  })
  meta.pages = next
  return meta
}

export function cloneMeta(meta) {
  return JSON.parse(JSON.stringify(meta))
}

export function metaStats(meta) {
  let bars = 0
  let systems = 0
  for (const p of meta.pages || []) {
    for (const s of p.systems || []) {
      systems++
      bars += s.bars?.length || 0
    }
  }
  return { pages: meta.pages?.length || 0, systems, bars, segments: meta.segments?.length || 0, repeats: meta.repeats?.length || 0 }
}
