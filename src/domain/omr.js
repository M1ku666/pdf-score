export const OMR_DEFAULTS = {
  inkDelta: 10,
  windowRatio: 0.8,
  linePeakRatio: 0.45,
  lineMinRatio: 0.15,
  peakPlateau: 0.92,
  lineProminence: 0.8,
  spaceTolerance: 0.15,
  minStaffLines: 4,
  minStaffSpace: 3,
  maxStaffSpace: 40,
  minStaffWidth: 0.3,
  lineFillRatio: 0.15,
  lineFillStaff: 0.5,
  joinCoverage: 0.7,
  systemGapTight: 2.5,
  barRatio: 0.8,
  barRefRank: 4,
  barRefProbe: 0.35,
  barSlack: 0.22,
  closeRatio: 1 / 12,
  mergeRatio: 2.5,
  rowEndFillRatio: 0.85,
  rowEndGap: 1.2,
  edgeMarginRatio: 0.004,
  minBarsPerSystem: 2,
}

function num(v, fallback) {
  return Number.isFinite(v) ? v : fallback
}

export function median(values) {
  if (!values.length) return 0
  const s = values.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function binarize(data, width, height, staffSpacePx, opts = {}) {
  const t = { ...OMR_DEFAULTS, ...(opts || {}) }
  const inkDelta = t.inkDelta
  const step = Math.max(3, Math.round(num(staffSpacePx, 8) * t.windowRatio)) | 1
  const r = (step - 1) / 2
  const gray = new Uint8ClampedArray(width * height)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000
  }
  let sum = 0
  for (let i = 0; i < gray.length; i++) sum += gray[i]
  if (sum / Math.max(1, gray.length) < 128) {
    for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i]
  }
  const integral = new Float64Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    const rowOff = (y + 1) * (width + 1)
    const prevOff = y * (width + 1)
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x]
      integral[rowOff + x + 1] = integral[prevOff + x + 1] + rowSum
    }
  }
  const bins = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const y1 = Math.min(height, y + r + 1)
    const y0 = Math.max(0, y - r)
    for (let x = 0; x < width; x++) {
      const x1 = Math.min(width, x + r + 1)
      const x0 = Math.max(0, x - r)
      const area = (x1 - x0) * (y1 - y0)
      const s =
        integral[y1 * (width + 1) + x1] - integral[y0 * (width + 1) + x1] - integral[y1 * (width + 1) + x0] + integral[y0 * (width + 1) + x0]
      if (gray[y * width + x] * area < s - inkDelta * area) bins[y * width + x] = 1
    }
  }
  return { bins, width, height, params: { inkDelta, step } }
}

export function rowInkRatios(bins, width, height) {
  const ratio = new Float64Array(height)
  for (let y = 0; y < height; y++) {
    const off = y * width
    let n = 0
    for (let x = 0; x < width; x++) n += bins[off + x]
    ratio[y] = n / width
  }
  return ratio
}

export function pickLineRows(rowRatio, t, maxInRadius = 0, bins = null, width = 0) {
  const H = rowRatio.length
  let pagePeak = 0
  for (let y = 0; y < H; y++) if (rowRatio[y] > pagePeak) pagePeak = rowRatio[y]
  if (pagePeak <= 0) return []
  const floor = Math.max(t.lineMinRatio, pagePeak * t.linePeakRatio)

  const localMax = maxInWindow(rowRatio, Math.max(0, Math.round(maxInRadius)))
  const out = []
  let y = 0
  while (y < H) {
    if (rowRatio[y] < floor) {
      y++
      continue
    }
    let end = y
    while (end + 1 < H && rowRatio[end + 1] >= floor) end++
    let peak = 0
    for (let k = y; k <= end; k++) if (rowRatio[k] > peak) peak = rowRatio[k]
    let sum = 0
    let wsum = 0
    let best = y
    for (let k = y; k <= end; k++) {
      if (rowRatio[k] >= peak * t.peakPlateau) {
        sum += k * rowRatio[k]
        wsum += rowRatio[k]
      }
      if (rowRatio[k] > rowRatio[best]) best = k
    }
    const center = wsum > 0 ? sum / wsum : best
    const cy = Math.round(center)
    const localBest = localMax[cy] || peak
    if (peak >= localBest * t.lineProminence && peak >= floor) {
      const ext = bins && width ? lineExtent(bins, width, y, end) : { x0: 0, x1: -1 }
      out.push({
        y: center,
        from: y,
        to: end,
        thickness: end - y + 1,
        ink: peak,
        peak,
        prominence: peak / Math.max(1e-6, localBest),
        x0: ext.x0,
        x1: ext.x1,
        len: ext.x1 - ext.x0,
      })
    }
    y = end + 1
  }
  return out
}

function maxInWindow(v, r) {
  const n = v.length
  const out = new Float64Array(n)
  if (r <= 0) {
    for (let i = 0; i < n; i++) out[i] = v[i]
    return out
  }
  const dq = new Int32Array(n)
  let head = 0
  let tail = 0
  for (let i = 0; i < n; i++) {
    while (tail > head && v[dq[tail - 1]] <= v[i]) tail--
    dq[tail++] = i
    const lo = i - r
    while (dq[head] < lo) head++
    out[i] = v[dq[head]]
  }
  return out
}

export function lineExtent(bins, width, from, to, thr = 1) {
  const col = new Int32Array(width)
  for (let y = from; y <= to; y++) {
    const off = y * width
    for (let x = 0; x < width; x++) col[x] += bins[off + x]
  }
  let x0 = -1
  let x1 = -1
  for (let x = 0; x < width; x++) {
    if (col[x] >= thr) {
      if (x0 < 0) x0 = x
      x1 = x
    }
  }
  return { x0, x1 }
}

function lineSlope(bins, width, yFrom, yTo, xLo, xHi, slices = 12) {
  const span = xHi - xLo
  if (span < 40) return null
  const w = Math.max(8, Math.floor(span / slices))
  const pts = []
  for (let s = 0; s + w <= span; s += w) {
    let sy = 0
    let sw = 0
    const x0 = xLo + s
    for (let y = yFrom; y <= yTo; y++) {
      const off = y * width
      for (let x = x0; x < x0 + w; x++) {
        if (bins[off + x]) {
          sy += y
          sw++
        }
      }
    }
    if (sw > w * 0.3) pts.push({ x: x0 + w / 2, y: sy / sw })
  }
  if (pts.length < 4) return null
  let sx = 0
  let sy = 0
  for (const p of pts) {
    sx += p.x
    sy += p.y
  }
  const mx = sx / pts.length
  const my = sy / pts.length
  let cov = 0
  let varx = 0
  for (const p of pts) {
    cov += (p.x - mx) * (p.y - my)
    varx += (p.x - mx) ** 2
  }
  if (varx <= 0) return null
  return cov / varx
}

export function groupStaffLines(lines, tolerance) {
  const groups = []
  let i = 0
  while (i < lines.length) {
    let first = null
    let j = i + 1
    while (j < lines.length) {
      const gap = lines[j].y - lines[j - 1].y
      if (first === null) {
        if (gap <= 0) break
        first = gap
      } else if (Math.abs(gap - first) > first * tolerance) break
      j++
    }
    groups.push({ from: i, to: j - 1, count: j - i, offsets: offsetsOf(lines, i, j - 1) })
    i++
  }
  return groups
}

function offsetsOf(lines, from, to) {
  const base = lines[from].y
  const out = []
  let prev = 0
  for (let k = from; k <= to; k++) {
    let idx = Math.round((lines[k].y - base) / Math.max(1e-6, estimateSpace(lines, from, to)))
    if (idx <= prev) idx = prev + 1
    out.push(idx)
    prev = idx
  }
  return out
}

function estimateSpace(lines, from, to) {
  const gaps = []
  for (let k = from + 1; k <= to; k++) gaps.push(lines[k].y - lines[k - 1].y)
  return median(gaps) || 1
}

function makeLine(bins, width, y, from, to, ink) {
  const ext = lineExtent(bins, width, from, to)
  return {
    y,
    from,
    to,
    thickness: to - from + 1,
    ink,
    x0: ext.x0,
    x1: ext.x1,
    len: ext.x1 - ext.x0,
    slope: lineSlope(bins, width, from, to, ext.x0, ext.x1),
  }
}

function fillMissingLines(bins, width, rowRatio, group, space, t) {
  const H = rowRatio.length
  const pagePeak = percentile(rowRatio, 0.999)
  const need = Math.max(t.lineMinRatio * 0.5, pagePeak * t.lineFillRatio, median(group.map((l) => l.ink)) * t.lineFillStaff)

  const scored = group.map((l, i) => ({ l, k: i === 0 ? 0 : Math.max(1, Math.round((l.y - group[0].y) / space)) }))
  const dense = []
  for (let i = 0; i < scored.length; i++) {
    const cur = scored[i]
    const prev = dense[dense.length - 1]
    if (prev) {
      const steps = cur.k - prev.k
      for (let s = 1; s < steps; s++) dense.push(makeSyntheticLine(bins, width, prev.l.y + ((cur.l.y - prev.l.y) * s) / steps, rowRatio))
    }
    dense.push(cur.l)
  }

  const gaps = []
  for (let i = 1; i < dense.length; i++) gaps.push(dense[i].y - dense[i - 1].y)
  const uniform = gaps.length < 2 || Math.max(...gaps) <= Math.min(...gaps) * 1.6
  const out = dense.slice()
  if (uniform) {
    const radius = Math.max(1, Math.round(space * 0.5))
    const localMax = maxInWindow(rowRatio, radius)
    for (let side = 0; side < 2; side++) {
      const ref = side === 0 ? out[0] : out[out.length - 1]
      const target = Math.round(side === 0 ? ref.y - space : ref.y + space)
      if (target < 0 || target >= H) continue
      const from = Math.max(0, target - radius)
      const to = Math.min(H - 1, target + radius)
      let cand = -1
      for (let y = from; y <= to; y++) {
        if (rowRatio[y] < need || rowRatio[y] < localMax[y] * t.lineProminence) continue
        if (cand < 0 || rowRatio[y] > rowRatio[cand]) cand = y
      }
      if (cand < 0) continue
      const line = makeLine(bins, width, cand, cand, cand, rowRatio[cand])
      if (line.len < width * t.minStaffWidth) continue
      if (side === 0) out.unshift(line)
      else out.push(line)
    }
  }
  return out
}

function makeSyntheticLine(bins, width, y, rowRatio) {
  const yi = Math.max(0, Math.min(rowRatio.length - 1, Math.round(y)))
  return {
    y,
    from: yi,
    to: yi,
    thickness: 1,
    ink: rowRatio[yi],
    x0: 0,
    x1: width - 1,
    len: width - 1,
    slope: 0,
    synthetic: true,
  }
}

export function findStaves(ctx, tuning) {
  const { bins, width, height } = ctx
  const t = { ...OMR_DEFAULTS, ...(tuning || {}) }
  const rowRatio = rowInkRatios(bins, width, height)

  const coarse = percentile(rowRatio, 0.92)
  const coarseRows = []
  for (let y = 0; y < height; y++) if (rowRatio[y] >= Math.max(t.lineMinRatio, coarse * 0.7)) coarseRows.push({ y, ink: rowRatio[y] })
  const coarseSpace = estimateCoarseSpace(coarseRows)

  const cand = pickLineRows(rowRatio, t, coarseSpace * 0.5, bins, width)
  const lines = cand.filter((l) => l.x0 >= 0 && l.len >= width * t.minStaffWidth)
  lines.sort((a, b) => a.y - b.y)

  const tolerances = uniqueSorted([t.spaceTolerance * 0.6, t.spaceTolerance, t.spaceTolerance * 1.6, t.spaceTolerance * 2.4])
  const proposals = []
  for (const tol of tolerances) {
    for (const g of groupStaffLines(lines, tol)) {
      if (g.count < t.minStaffLines) continue
      const space = estimateSpace(lines, g.from, g.to)
      if (space < t.minStaffSpace || space > t.maxStaffSpace) continue
      proposals.push({ ...g, space, tol })
    }
  }
  const uniq = []
  const seen = new Set()
  for (const p of proposals) {
    const key = `${p.from}:${p.to}`
    if (seen.has(key)) continue
    seen.add(key)
    uniq.push(p)
  }
  uniq.sort((a, b) => b.to - b.from - (a.to - a.from) || a.space - b.space)
  const used = new Uint8Array(lines.length)
  const groups = []
  for (const p of uniq) {
    let free = true
    for (let k = p.from; k <= p.to; k++) if (used[k]) free = false
    if (!free) continue
    for (let k = p.from; k <= p.to; k++) used[k] = 1
    groups.push(p)
  }
  groups.sort((a, b) => lines[a.from].y - lines[b.from].y)

  const staves = []
  for (const g of groups) {
    const core = lines.slice(g.from, g.to + 1)
    const space = estimateSpace(lines, g.from, g.to)
    const full = fillMissingLines(bins, width, rowRatio, core, space, t)
    const finalSpace = median(full.slice(1).map((l, i) => l.y - full[i].y)) || space
    const yTop = full[0].y
    const yBottom = full[full.length - 1].y
    const slopes = full.map((l) => l.slope).filter((s) => Number.isFinite(s))
    staves.push({
      yTop,
      yBottom,
      space: finalSpace,
      count: full.length,
      x0: Math.min(...full.map((l) => l.x0)),
      x1: Math.max(...full.map((l) => l.x1)),
      slope: slopes.length ? median(slopes) : 0,
      filled: full.length - core.length,
    })
  }

  const skew = staves.length ? median(staves.map((s) => s.slope).filter((s) => Number.isFinite(s))) : 0
  const staffSpace = staves.length ? median(staves.map((s) => s.space)) : 0
  return { staves, lines, rows: cand, rowRatio, skew: skew || 0, staffSpace }
}

function estimateCoarseSpace(rows) {
  if (rows.length < 4) return 8
  const gaps = []
  for (let i = 1; i < rows.length; i++) {
    const g = rows[i].y - rows[i - 1].y
    if (g > 0) gaps.push(g)
  }
  if (!gaps.length) return 8
  gaps.sort((a, b) => a - b)
  const q = gaps[Math.floor(gaps.length * 0.25)]
  return Math.min(60, Math.max(3, q))
}

function percentile(arr, p) {
  if (!arr.length) return 0
  const s = Array.from(arr).sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))]
}

function uniqueSorted(values) {
  return Array.from(new Set(values.map((v) => Number(v.toFixed(3))))).sort((a, b) => a - b)
}

export function sameSystem(ctx, prev, st, tuning) {
  const t = { ...OMR_DEFAULTS, ...(tuning || {}) }
  const gapTop = Math.round(prev.yBottom)
  const gapBottom = Math.round(st.yTop)
  const gap = gapBottom - gapTop
  if (!(gap > 0)) return gap >= 0
  if (connectorCoverage(ctx, prev, gapTop, gapBottom) >= t.joinCoverage) return true
  const space = Math.min(prev.space || 0, st.space || 0)
  return space > 0 && gap < space * t.systemGapTight
}

export function connectorCoverage(ctx, prev, gapTop, gapBottom) {
  const { bins, width } = ctx
  const height = gapBottom - gapTop
  if (height <= 0) return 1
  const x0 = Math.max(0, Math.round(prev.x0))
  const x1 = Math.min(width - 1, Math.round(prev.x1))
  if (x1 <= x0) return 0
  let best = 0
  for (let x = x0; x <= x1; x++) {
    const runs = columnRuns(bins, width, x, gapTop, gapBottom, 0)
    for (const [a, b] of runs) {
      const n = b - a + 1
      if (n > best) best = n
    }
    if (best >= height) break
  }
  return best / height
}

export function groupSystems(ctx, staves, tuning) {
  const t = { ...OMR_DEFAULTS, ...(tuning || {}) }
  const sorted = staves.slice().sort((a, b) => a.yTop - b.yTop)
  const systems = []
  const trace = []
  for (const st of sorted) {
    const last = systems[systems.length - 1]
    const prev = last ? last.lastStaff : null
    const join = !!prev && sameSystem(ctx, prev, st, t)
    trace.push({
      yTop: Number(st.yTop.toFixed(1)),
      gap: prev ? Number((st.yTop - prev.yBottom).toFixed(1)) : -1,
      connector: prev ? Number(connectorCoverage(ctx, prev, Math.round(prev.yBottom), Math.round(st.yTop)).toFixed(2)) : null,
      join,
    })
    if (join) {
      last.yBottom = Math.max(last.yBottom, st.yBottom)
      last.lastBottom = st.yBottom
      last.lastStaff = st
      last.x0 = Math.min(last.x0, st.x0)
      last.x1 = Math.max(last.x1, st.x1)
      last.space = Math.min(last.space, st.space)
      last.staves.push(st)
    } else {
      systems.push({
        yTop: st.yTop,
        yBottom: st.yBottom,
        lastBottom: st.yBottom,
        lastStaff: st,
        space: st.space,
        x0: st.x0,
        x1: st.x1,
        staves: [st],
      })
    }
  }
  for (const s of systems) s.height = s.yBottom - s.yTop
  return { systems, trace }
}

export function closeVerticalRuns(runs, maxGap) {
  if (!runs.length) return runs
  const out = [runs[0].slice()]
  for (let i = 1; i < runs.length; i++) {
    const last = out[out.length - 1]
    if (runs[i][0] - last[1] - 1 <= maxGap) last[1] = runs[i][1]
    else out.push(runs[i].slice())
  }
  return out
}

export function columnRuns(bins, width, x, y0, y1, maxGap = 0) {
  const runs = []
  let start = -1
  for (let y = y0; y < y1; y++) {
    const on = bins[y * width + x] === 1
    if (on && start < 0) start = y
    else if (!on && start >= 0) {
      runs.push([start, y - 1])
      start = -1
    }
  }
  if (start >= 0) runs.push([start, y1 - 1])
  return maxGap > 0 ? closeVerticalRuns(runs, maxGap) : runs
}

function runsIn(runs, y0, y1) {
  let n = 0
  for (const [a, b] of runs) {
    const lo = Math.max(a, y0)
    const hi = Math.min(b, y1 - 1)
    if (hi >= lo) n += hi - lo + 1
  }
  return n
}

function inkSpan(runs, lo, hi) {
  let first = -1
  let last = -1
  for (const [a, b] of runs) {
    if (b < lo || a > hi) continue
    const s = Math.max(a, lo)
    const e = Math.min(b, hi)
    if (e < s) continue
    if (first < 0) first = s
    last = e
  }
  return first < 0 ? 0 : last - first + 1
}

export function findBars(ctx, system, tuning) {
  const { bins, width } = ctx
  const t = { ...OMR_DEFAULTS, ...(tuning || {}) }
  const top = Math.max(0, Math.round(system.yTop))
  const bottom = Math.min(ctx.height - 1, Math.round(system.yBottom))
  if (bottom - top < 4) return { bars: [], stats: { reason: 'tooShort' } }
  const space = system.space || Math.max(2, (bottom - top) / 4)
  const expand = Math.round(space * 0.4)
  const edgeTop = Math.max(0, top - expand)
  const edgeBottom = Math.min(ctx.height, bottom + expand + 1)
  const maxGap = Math.max(1, Math.round(space * t.closeRatio))

  const bands = []
  for (const st of system.staves || []) {
    const lo = Math.max(edgeTop, Math.round(st.yTop))
    const hi = Math.min(edgeBottom - 1, Math.round(st.yBottom))
    bands.push([lo, hi, Math.max(1, hi - lo + 1)])
  }
  if (!bands.length) bands.push([top, bottom, Math.max(1, bottom - top + 1)])

  const score = new Float64Array(width)
  for (let x = 0; x < width; x++) {
    const runs = columnRuns(bins, width, x, edgeTop, edgeBottom, maxGap)
    let worst = Infinity
    for (const [lo, hi, len] of bands) {
      let best = 0
      for (const [a, e] of runs) {
        const s = Math.max(a, lo)
        const en = Math.min(e, hi)
        if (en >= s) best = Math.max(best, en - s + 1)
      }
      const s = (best - len * t.barSlack) / len
      if (s < worst) worst = s
      if (worst <= 0) break
    }
    score[x] = worst > 0 ? worst : 0
  }
  let maxScore = 0
  for (let x = 0; x < width; x++) if (score[x] > maxScore) maxScore = score[x]
  const reference = barReference(score, width, maxScore, t)
  const stats = { maxScore: Number(maxScore.toFixed(3)), ref: Number(reference.toFixed(3)), bands: bands.length, maxGap }

  const cand = []
  for (let x = 0; x < width; x++) {
    if (score[x] > 0 && score[x] >= reference * t.barRatio) cand.push(x)
  }
  stats.rejected = width - cand.length
  if (!cand.length) return { bars: [], stats }

  const groups = []
  let cur = [cand[0]]
  for (let i = 1; i < cand.length; i++) {
    if (cand[i] - cand[i - 1] === 1) cur.push(cand[i])
    else {
      groups.push(cur)
      cur = [cand[i]]
    }
  }
  groups.push(cur)
  let centers = groups.map((g) => (g[0] + g[g.length - 1]) / 2)

  const mergeDist = Math.max(1, space * t.mergeRatio)
  if (centers.length > 1) {
    const merged = [centers[0]]
    let sum = centers[0]
    let n = 1
    for (let i = 1; i < centers.length; i++) {
      if (centers[i] - merged[merged.length - 1] < mergeDist) {
        sum += centers[i]
        n++
        merged[merged.length - 1] = sum / n
      } else {
        merged.push(centers[i])
        sum = centers[i]
        n = 1
      }
    }
    centers = merged
  }
  stats.merged = groups.length - centers.length

  const edge = Math.max(1, t.edgeMarginRatio * width)
  return { bars: centers.filter((c) => c >= edge && c <= width - edge), stats }
}

function barReference(score, width, maxScore, t) {
  if (!(maxScore > 0)) return 0
  const probe = maxScore * t.barRefProbe
  const peaks = []
  let cur = 0
  for (let x = 0; x < width; x++) {
    if (score[x] >= probe) {
      if (score[x] > cur) cur = score[x]
    } else if (cur > 0) {
      peaks.push(cur)
      cur = 0
    }
  }
  if (cur > 0) peaks.push(cur)
  if (!peaks.length) return maxScore
  peaks.sort((a, b) => b - a)
  return peaks[Math.max(0, Math.min(peaks.length, Math.round(t.barRefRank)) - 1)]
}

function columnFill(ctx, x, yTop, yBottom, staves, space, t) {
  const bands = (staves || []).map((s) => [Math.max(yTop, Math.round(s.yTop)), Math.min(yBottom, Math.round(s.yBottom))])
  if (!bands.length) bands.push([yTop, yBottom])
  const runs = columnRuns(ctx.bins, ctx.width, x, yTop, yBottom + 1, 0)
  let worst = Infinity
  for (const [lo, hi] of bands) {
    let longest = 0
    for (const [a, b] of runs) {
      const s = Math.max(a, lo)
      const e = Math.min(b, hi)
      if (e >= s) longest = Math.max(longest, e - s + 1)
    }
    worst = Math.min(worst, longest / Math.max(1, hi - lo + 1))
  }
  return worst === Infinity ? 0 : worst
}

export function closeRowEnds(ctx, systems, tuning) {
  const t = { ...OMR_DEFAULTS, ...(tuning || {}) }
  if (!systems.length) return systems
  const sorted = systems.slice().sort((a, b) => a.yTop - b.yTop)
  for (const sys of sorted) {
    const staves = sys.staves || []
    if (!staves.length || !sys.bars || !sys.bars.length) continue
    const space = sys.space || 10
    const yTop = Math.max(0, Math.round(sys.yTop))
    const yBottom = Math.min(ctx.height - 1, Math.round(sys.yBottom))
    if (yBottom - yTop < 4) continue
    const left = Math.min(...staves.map((s) => s.x0))
    const right = Math.max(...staves.map((s) => s.x1))
    const merge = Math.max(1, space * t.mergeRatio)
    const need = Math.max(space * t.rowEndGap, merge)
    const bars = sys.bars.slice().sort((a, b) => a - b)
    const last = bars[bars.length - 1]
    if (bars[0] - left > need) bars.unshift(endStroke(ctx, left, bars[0], yTop, yBottom, staves, space, merge, t))
    if (right - last > need) bars.push(endStroke(ctx, right, last, yTop, yBottom, staves, space, merge, t))
    sys.bars = mergeCloseBars(bars, merge)
  }
  return sorted
}

function mergeCloseBars(bars, dist) {
  const out = []
  for (let i = 0; i < bars.length; i++) {
    const x = bars[i]
    const last = out[out.length - 1]
    if (last !== undefined && x - last < dist) {
      out[out.length - 1] = out.length === 1 ? last : i === bars.length - 1 ? x : (last + x) / 2
      continue
    }
    out.push(x)
  }
  return out
}

function endStroke(ctx, edge, inner, yTop, yBottom, staves, space, mergeDistance, t) {
  const from = Math.max(0, Math.round(edge))
  const to = Math.min(ctx.width - 1, Math.round(inner) - Math.ceil(mergeDistance))
  for (let x = from; x <= to; x++) {
    if (columnFill(ctx, x, yTop, yBottom, staves, space, t) >= t.rowEndFillRatio) return x
  }
  return edge
}

export function detectPageSystems(ctx, tuning, map = null) {
  const t = { ...OMR_DEFAULTS, ...(tuning || {}) }
  const scale = ctx.scale || 1
  const toPt =
    map ||
    {
      x: (px) => px / scale,
      y: (py) => (ctx.height - py) / scale,
    }
  const { staves, skew, staffSpace, lines, rows } = findStaves(ctx, t)
  const grouped = groupSystems(ctx, staves, t)
  const systems = grouped.systems
  const candidates = []
  const debug = []
  for (const sys of systems) {
    const { bars, stats } = findBars(ctx, sys, t)
    debug.push({ yTop: sys.yTop, yBottom: sys.yBottom, space: sys.space, height: sys.height, bars: bars.length, ...stats })
    candidates.push({
      x0: sys.x0,
      x1: sys.x1,
      yTop: sys.yTop,
      yBottom: sys.yBottom,
      space: sys.space,
      staffCount: sys.staves.length,
      staves: sys.staves,
      bars,
      measures: bars.length - 1,
    })
  }
  closeRowEnds(ctx, candidates, t)
  const out = candidates.filter((s) => s.bars.length >= t.minBarsPerSystem)
  for (const s of out) {
    s.measures = s.bars.length - 1
    const d = debug.find((x) => Math.abs(x.yTop - s.yTop) < 0.5)
    if (d) {
      d.endsFilled = s.bars.length - d.bars
      d.bars = s.bars.length
    }
  }
  for (const s of out) {
    const pad = Math.max(2, s.space * 0.6)
    s.y0 = toPt.y(s.yTop - pad)
    s.y1 = toPt.y(s.yBottom + pad)
    s.barXs = s.bars.map((x) => toPt.x(x))
  }
  out.sort((a, b) => b.y0 - a.y0)
  return {
    systems: out,
    staves,
    skew,
    staffSpace,
    diag: { lines: lines.length, rows: rows.length, staves: staves.length, staffSpace, skew, debug, trace: grouped.trace },
  }
}

export function toMetaSystems(result, makeId = null) {
  return result.systems.map((s) => ({
    ...(makeId ? { id: makeId() } : {}),
    y0: round2(s.y0),
    y1: round2(s.y1),
    bars: s.barXs.map((x) => ({ ...(makeId ? { id: makeId() } : {}), x: round2(x) })),
  }))
}

function round2(v) {
  return Math.round(v * 100) / 100
}

export const OMR_DPI = 200

const PAGE_BG = '#ffffff'

const BLANK_INK_RATIO = 0.002

async function rasterizePage(page, dpi) {
  const scale = dpi / 72
  const viewport = page.getViewport({ scale, rotation: page.rotate })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  ctx.fillStyle = PAGE_BG
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, canvas, viewport, background: PAGE_BG }).promise
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { data: image.data, width: image.width, height: image.height, scale, page }
}

async function detectRenderedPage(renderer, n, dpi) {
  await new Promise((resolve) => {
    const done = () => resolve()
    requestAnimationFrame(done)
    setTimeout(done, 50)
  })
  const page = await renderer.getPage(n)
  try {
    const img = await rasterizePage(page, dpi)
    const bins = binarize(img.data, img.width, img.height, Math.max(6, img.scale * 4))
    let ink = 0
    for (let i = 0; i < bins.bins.length; i++) ink += bins.bins[i]
    const inkRatio = ink / Math.max(1, bins.bins.length)
    if (inkRatio < BLANK_INK_RATIO) return { systems: [], diag: { blank: true, inkRatio } }
    bins.scale = img.scale
    const result = detectPageSystems(bins)
    return {
      systems: toMetaSystems(result),
      diag: { blank: false, inkRatio, width: img.width, height: img.height, scale: img.scale, systems: result.systems.length },
    }
  } finally {
    page.cleanup?.()
  }
}

export async function detectPdfPages(blobOrData, { dpi = OMR_DPI, onPage = null } = {}) {
  const { PdfRenderer } = await import('./pdf.js')
  const renderer = await PdfRenderer.from(blobOrData)
  const pages = []
  const diag = []
  try {
    for (let n = 1; n <= renderer.numPages; n++) {
      onPage?.(n, renderer.numPages)
      const r = await detectRenderedPage(renderer, n, dpi)
      pages.push(r.systems)
      diag.push({ page: n, ...r.diag })
    }
  } finally {
    renderer.destroy()
  }
  return { pages, diag }
}

export async function detectPdfPage(blobOrData, pageNumber, { dpi = OMR_DPI } = {}) {
  const { PdfRenderer } = await import('./pdf.js')
  const renderer = await PdfRenderer.from(blobOrData)
  try {
    const n = Number.isFinite(pageNumber) ? Math.min(Math.max(1, Math.round(pageNumber)), renderer.numPages) : 1
    return await detectRenderedPage(renderer, n, dpi)
  } finally {
    renderer.destroy()
  }
}
