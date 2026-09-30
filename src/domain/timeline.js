import { comparePosition, DEFAULT_BEAT_UNIT, DEFAULT_BEATS_PER_BAR, DEFAULT_BPM, fitBeat, positionBeat, positionMeasure } from './schema.js'

function medianGap(xs) {
  if (xs.length < 2) return 40
  const diffs = []
  for (let i = 1; i < xs.length; i++) diffs.push(xs[i] - xs[i - 1])
  diffs.sort((a, b) => a - b)
  const m = diffs[Math.floor(diffs.length / 2)]
  return m > 4 ? m : 40
}

export function deriveStructure(meta) {
  const measures = []
  const barStartMeasure = new Map()
  const barInfo = new Map()
  const systems = []
  let no = 0
  let pendingLastBar = null

  ;(meta.pages || []).forEach((page, p) => {
    const pageWidth = page.width || 595.28
    const pageSystems = (page.systems || []).slice().sort((a, b) => b.y0 - a.y0)
    pageSystems.forEach((sys, s) => {
      const bars = (sys.bars || []).slice().sort((a, b) => a.x - b.x)
      const rec = { id: sys.id, page: p, sys: s, y0: sys.y0, y1: sys.y1, bars, firstMeasure: 0, lastMeasure: 0 }
      systems.push(rec)
      bars.forEach((b, i) => barInfo.set(b.id, { ...b, page: p, sys: s, systemId: sys.id, indexInSystem: i, y0: sys.y0, y1: sys.y1 }))
      if (pendingLastBar) {
        barStartMeasure.set(pendingLastBar, no + 1)
        pendingLastBar = null
      }
      if (bars.length < 2) return
      const gap = medianGap(bars.map((b) => b.x))
      const first = no + 1
      for (let i = 0; i < bars.length - 1; i++) {
        no++
        const isFirst = i === 0
        const isLast = i === bars.length - 2
        measures.push({
          no,
          page: p,
          sys: s,
          systemId: sys.id,
          y0: sys.y0,
          y1: sys.y1,
          x0: bars[i].x,
          x1: bars[i + 1].x,
          hitX0: isFirst ? Math.max(0, bars[i].x - gap * 0.9) : bars[i].x,
          hitX1: isLast ? Math.min(pageWidth, bars[i + 1].x + gap * 0.9) : bars[i + 1].x,
          startBarId: bars[i].id,
          endBarId: bars[i + 1].id,
          indexInSystem: i,
        })
        barStartMeasure.set(bars[i].id, no)
      }
      rec.firstMeasure = first
      rec.lastMeasure = no
      rec.gap = gap
      pendingLastBar = bars[bars.length - 1].id
    })
  })
  if (pendingLastBar) barStartMeasure.set(pendingLastBar, no + 1)

  return { measures, barStartMeasure, barInfo, systems, count: no, byPage: groupBy(measures, (m) => m.page) }
}

function groupBy(list, keyFn) {
  const map = new Map()
  for (const item of list) {
    const k = keyFn(item)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(item)
  }
  return map
}

export function beatDuration(seg) {
  const bpm = seg?.bpm || DEFAULT_BPM
  const unit = seg?.beatUnit || DEFAULT_BEAT_UNIT
  return (60 / bpm) * (4 / unit)
}

export function resolveSegments(meta, structure, total) {
  const list = []
  for (const seg of meta.segments || []) {
    const auto = seg.barId ? structure.barStartMeasure.get(seg.barId) : null
    const measure = Number.isFinite(seg.measure) ? seg.measure : auto
    if (!Number.isFinite(measure)) continue
    const clamped = total > 0 ? Math.min(Math.max(1, Math.round(measure)), total + 1) : Math.max(1, Math.round(measure))
    const outOfRange = total > 0 && clamped !== Math.round(measure)
    list.push({
      ...seg,
      measure: clamped,
      beat: outOfRange ? 1 : fitBeat(seg.beat, seg.beatsPerBar),
      autoMeasure: auto,
      beatDur: beatDuration(seg),
    })
  }
  list.sort((a, b) => comparePosition(a, b) || (a.id < b.id ? -1 : 1))
  return list
}

export function segmentStartMeasure(structure, seg) {
  if (!seg) return null
  const no = seg.head
    ? 1
    : Number.isFinite(seg.measure)
      ? Math.round(seg.measure)
      : seg.barId
        ? structure.barStartMeasure.get(seg.barId)
        : null
  return Number.isFinite(no) ? structure.measures[no - 1] || null : null
}

function segAt(segments, measure, beat) {
  let found = null
  for (const s of segments) {
    if (comparePosition(s, { measure, beat }) <= 0) found = s
    else break
  }
  return found
}

export function tempoAt(segments, measure, beat = 1) {
  const s = segAt(segments, measure, beat)
  if (!s) return { bpm: DEFAULT_BPM, beatsPerBar: DEFAULT_BEATS_PER_BAR, beatUnit: DEFAULT_BEAT_UNIT, beatDur: beatDuration(null), segment: null }
  return { bpm: s.bpm, beatsPerBar: s.beatsPerBar, beatUnit: s.beatUnit, beatDur: beatDuration(s), segment: s }
}

export function matchRepeatBlocks(repeats) {
  const open = []
  const pairs = []
  for (const r of repeats || []) {
    if (r.kind === 'start') open.push(r)
    else if (r.kind === 'end' && open.length) pairs.push({ start: open.pop(), end: r })
  }
  for (const s of open.reverse()) pairs.push({ start: s, end: null })
  for (const r of repeats || []) {
    if (r.kind !== 'start' && r.kind !== 'end') pairs.push({ start: r, end: null })
  }
  return pairs
}

export function deriveRepeatBlocks(meta, structure, total) {
  if (!total) return []
  const marks = (meta?.repeats || []).filter((r) => r.barId)
  const blocks = matchRepeatBlocks(marks)
    .map((p, idx) => {
      const startAt = structure.barStartMeasure.get(p.start.barId)
      const endAt = p.end ? structure.barStartMeasure.get(p.end.barId) : null
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null
      const endMeasure = Math.min(total, Math.max(1, endAt - 1))
      return {
        idx,
        startMeasure: Math.min(Math.max(1, startAt), endMeasure),
        endMeasure,
        passes: Math.max(2, Math.min(16, p.end.passes || 2)),
        startBarId: p.start.barId,
        endBarId: p.end.barId,
        houseMarks: marks.filter((r) => {
          if (r.kind !== 'house1') return false
          const no = structure.barStartMeasure.get(r.barId)
          return Number.isFinite(no) && no > startAt && no < endAt
        }),
        houses: [],
      }
    })
    .filter(Boolean)
  for (const b of blocks) {
    const mark = b.houseMarks[0]
    if (mark) {
      b.houses.push({
        index: 1,
        kind: 'house1',
        startMeasure: structure.barStartMeasure.get(mark.barId),
        endMeasure: b.endMeasure,
        mark,
      })
    }
  }
  const order = expandRepeats(meta, structure, total)
  const orderNos = order.map((x) => x.no)
  for (const b of blocks) {
    if (!b.houses.length) continue
    const passStart = orderNos.lastIndexOf(b.startMeasure)
    if (passStart < 0) continue
    const tail = orderNos.slice(passStart + 1)
    const first = tail.findIndex((no) => no >= b.endMeasure)
    if (first < 0) continue
    const startMeasure = tail[first]
    const fullEndMeasure = tail[tail.length - 1]
    if (fullEndMeasure < startMeasure) continue
    b.houses.push({ index: 2, kind: 'house2', startMeasure, endMeasure: startMeasure, fullEndMeasure })
  }
  return blocks
}

export function isRowEndBar(structure, barId) {
  const info = structure?.barInfo?.get(barId)
  if (!info) return false
  const rec = structure.systems.find((s) => s.id === info.systemId)
  const bars = rec?.bars || []
  return bars.length > 0 && info.indexInSystem === bars.length - 1
}

export function decideRepeatTap(barId, { structure, total, repeats = [], pendingBarId = null } = {}) {
  const no = structure.barStartMeasure.get(barId)
  if (!Number.isFinite(no) || no < 1 || no > total) return { type: 'reject', reason: 'no-measure' }
  const at = (id) => structure.barStartMeasure.get(id)
  const spans = matchRepeatBlocks(repeats)
    .filter((p) => p.end)
    .map((p) => ({ startBarId: p.start.barId, endBarId: p.end.barId, from: at(p.start.barId), to: at(p.end.barId) }))
    .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && s.to >= s.from)

  if (pendingBarId != null) {
    const from = at(pendingBarId)
    if (!Number.isFinite(from) || no <= from) return { type: 'reject', reason: 'not-after-pending' }
    if (spans.some((s) => from < s.to && no > s.from)) return { type: 'reject', reason: 'overlap' }
    return { type: 'complete', startBarId: pendingBarId }
  }

  if (isRowEndBar(structure, barId)) return { type: 'reject', reason: 'row-end' }

  const span = spans.find((s) => no > s.from && no < s.to)
  if (span) {
    const exists = repeats.find((r) => r.kind === 'house1' && at(r.barId) > span.from && at(r.barId) < span.to)
    return exists ? { type: 'house1-move', fromBarId: exists.barId } : { type: 'house1' }
  }
  return { type: 'start' }
}

export function expandRepeats(meta, structure, total) {
  const repeats = (meta.repeats || []).filter((r) => r.barId)
  const flat = () => {
    const out = []
    for (let m = 1; m <= total; m++) out.push({ no: m, jumpTo: false })
    return out
  }
  if (!total) return []
  const measureOf = (barId) => structure.barStartMeasure.get(barId)
  const blocks = matchRepeatBlocks(repeats)
    .filter((p) => p.end)
    .map((p, idx) => {
      const startAt = measureOf(p.start.barId)
      const endBarAt = measureOf(p.end.barId)
      if (!Number.isFinite(startAt) || !Number.isFinite(endBarAt)) return null
      const endMeasure = Math.min(total, Math.max(1, endBarAt - 1))
      const back = Number.isFinite(p.end.backToMeasure) ? p.end.backToMeasure : startAt
      return { idx, startMeasure: Math.min(Math.max(1, back), endMeasure), endMeasure }
    })
    .filter(Boolean)

  const houseAt = new Map()
  for (const r of repeats) {
    if (r.kind !== 'house1') continue
    const at = measureOf(r.barId)
    if (!Number.isFinite(at)) continue
    const block = blocks.find((b) => at > b.startMeasure && at <= b.endMeasure)
    if (block) houseAt.set(at, block)
  }
  const endAt = new Map(blocks.map((b) => [b.endMeasure, b]))

  const order = []
  const passDone = new Map()
  let i = 1
  let jumpTo = false
  let guard = 0
  const limit = Math.max(64, total * 32)
  while (i >= 1 && i <= total && guard++ < limit) {
    const houseBlock = houseAt.get(i)
    if (houseBlock && (passDone.get(houseBlock.idx) || 0) >= 1) {
      i = houseBlock.endMeasure + 1
      jumpTo = true
      continue
    }
    order.push({ no: i, jumpTo })
    jumpTo = false
    const blk = endAt.get(i)
    if (blk) {
      const done = (passDone.get(blk.idx) || 0) + 1
      passDone.set(blk.idx, done)
      if (done < 2) {
        i = blk.startMeasure
        jumpTo = true
        continue
      }
    }
    i++
  }
  return order.length ? order : flat()
}

export function playOrder(total) {
  const order = []
  for (let m = 1; m <= total; m++) order.push(m)
  return order
}

function startMeasure(meta, total) {
  const wanted = Math.round(Number(meta.audio?.startPosition))
  if (!Number.isFinite(wanted) || wanted <= 1) return 1
  return wanted <= total ? wanted : 1
}

function pickupLeadIn(segments, total, startPos) {
  let sum = 0
  for (let measureNo = 1; measureNo < startPos && measureNo <= total; measureNo++) {
    const tempo = tempoAt(segments, measureNo)
    const beats = Math.max(1, Math.round(tempo.beatsPerBar))
    for (let b = 0; b < beats; b++) sum += tempoAt(segments, measureNo, b + 1).beatDur
  }
  return sum
}

export function buildTimeline(meta, opts = {}) {
  const structure = opts.structure || deriveStructure(meta)
  const total = structure.count
  const segments = resolveSegments(meta, structure, total)
  const order = expandRepeats(meta, structure, total)
  const samples = []
  const anchors = segments.filter((s) => Number.isFinite(s.time)).sort(comparePosition)
  const applied = new Set()
  const startPos = startMeasure(meta, total)
  let t = (Number(meta.audio?.startOffset) || 0) - (startPos > 1 ? pickupLeadIn(segments, total, startPos) : 0)
  let orderIndex = 0

  for (const step of order) {
    const measureNo = step.no
    const tempo = tempoAt(segments, measureNo)
    const beats = Math.max(1, Math.round(tempo.beatsPerBar))
    for (let b = 0; b < beats; b++) {
      const beat = b + 1
      for (const a of anchors) {
        if (applied.has(a.id)) continue
        if (comparePosition(a, { measure: measureNo, beat }) > 0) break
        applied.add(a.id)
        const segA = tempoAt(segments, positionMeasure(a), positionBeat(a))
        t = a.time + (beat - positionBeat(a)) * segA.beatDur
      }
      const td = tempoAt(segments, measureNo, beat)
      if (samples.length) t = Math.max(t, samples[samples.length - 1].time + 0.002)
      samples.push({
        index: samples.length,
        orderIndex,
        jumpTo: step.jumpTo && b === 0,
        no: measureNo,
        beat,
        time: t,
        bpm: td.bpm,
        beatsPerBar: beats,
        beatUnit: td.beatUnit,
        segmentId: td.segment?.id || null,
      })
      t += td.beatDur
    }
    orderIndex++
  }

  const byNo = new Map()
  samples.forEach((s) => {
    if (s.beat !== 1) return
    if (!byNo.has(s.no)) byNo.set(s.no, [])
    byNo.get(s.no).push(s)
  })

  const last = samples[samples.length - 1]
  const duration = last ? last.time + (60 / (last.bpm || DEFAULT_BPM)) * (4 / (last.beatUnit || DEFAULT_BEAT_UNIT)) : 0

  const tl = {
    structure,
    segments,
    order,
    samples,
    byNo,
    total,
    blocks: deriveRepeatBlocks(meta, structure, total),
    duration,
    audioDuration: Number(meta.audio?.duration) || null,
    startOffset: Number(meta.audio?.startOffset) || 0,
    posToTime(measureNo, nearTime = null, beatOffset = 0) {
      if (!total) return tl.startOffset
      const occurrences = byNo.get(measureNo)
      if (!occurrences || !occurrences.length) {
        let best = null
        for (const m of structure.measures) {
          if (!byNo.has(m.no)) continue
          if (!best || Math.abs(m.no - measureNo) < Math.abs(best - measureNo)) best = m.no
        }
        if (best == null) return tl.startOffset
        return tl.posToTime(best, nearTime, beatOffset)
      }
      let pick = occurrences[0]
      if (Number.isFinite(nearTime)) {
        let bestD = Infinity
        for (const o of occurrences) {
          const d = Math.abs(o.time - nearTime)
          if (d < bestD) {
            bestD = d
            pick = o
          }
        }
      }
      return pick.time + beatOffset * (60 / (pick.bpm || DEFAULT_BPM)) * (4 / (pick.beatUnit || DEFAULT_BEAT_UNIT))
    },
    timeToPos(time) {
      if (!samples.length) return { no: total ? 1 : 0, beat: 1, sample: null, progress: 0 }
      if (time <= samples[0].time) return { no: samples[0].no, beat: 1, sample: samples[0], progress: 0 }
      let lo = 0
      let hi = samples.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (samples[mid].time <= time) lo = mid
        else hi = mid - 1
      }
      const s = samples[lo]
      const beatDur = (60 / (s.bpm || DEFAULT_BPM)) * (4 / (s.beatUnit || DEFAULT_BEAT_UNIT))
      const beat = s.beat + (time - s.time) / beatDur
      return { no: s.no, beat, sample: s, progress: duration > 0 ? time / duration : 0 }
    },
    measureDuration(measureNo, nearTime = null) {
      const occurrences = byNo.get(measureNo)
      if (!occurrences || !occurrences.length) {
        const t = tempoAt(segments, measureNo)
        return t.beatDur * Math.max(1, Math.round(t.beatsPerBar))
      }
      let pick = occurrences[0]
      if (Number.isFinite(nearTime)) {
        let bestD = Infinity
        for (const o of occurrences) {
          const d = Math.abs(o.time - nearTime)
          if (d < bestD) {
            bestD = d
            pick = o
          }
        }
      }
      const beats = Math.max(1, Math.round(pick.beatsPerBar))
      const i0 = samples.indexOf(pick)
      let dur = 0
      for (let b = 0; b < beats; b++) {
        const s = samples[i0 + b]
        if (s && s.no === measureNo) {
          const next = samples[i0 + b + 1]
          if (next && next.no === measureNo) dur += next.time - s.time
          else dur += (60 / (s.bpm || DEFAULT_BPM)) * (4 / (s.beatUnit || DEFAULT_BEAT_UNIT))
        } else {
          const td = tempoAt(segments, measureNo, b + 1)
          dur += td.beatDur
        }
      }
      return dur
    },
    beatsBetween(t0, t1, limit = 64) {
      const out = []
      if (!samples.length) return out
      let lo = 0
      let hi = samples.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (samples[mid].time < t0) lo = mid + 1
        else hi = mid
      }
      for (let i = Math.max(0, lo - 1); i < samples.length && out.length < limit; i++) {
        const s = samples[i]
        if (s.time >= t0 && s.time <= t1) out.push({ time: s.time, accent: s.beat === 1, no: s.no, beat: s.beat })
      }
      return out
    },
    measureOf(measureNo) {
      return structure.measures[measureNo - 1] || null
    },
  }
  return tl
}
