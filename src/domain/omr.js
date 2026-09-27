/**
 * 谱面自动识别（只做两件事：找**行**、找**小节线**）
 *
 * 输入是「已经栅格化的页面墨点图」，输出可直接写进 `meta.pages[].systems` 的标记
 * （PDF 原始点坐标 pt，见 docs/invariants.md）。**只用位图**，不看 PDF 矢量路径 ——
 * 实测大量乐谱 PDF（扫描件、图片导出、Pillow 拼图）整页就是一张位图，
 * `getOperatorList()` 里一条路径都没有，矢量方案在它们身上完全失效。
 *
 * 算法移植自 BiliTabCapture（`tab_extractor.py`，其本身移植自 score_capture 的
 * image_process.py），那里验证过对真实谱面的效果，核心是三个判据：
 *
 *   1. **墨迹占比定位谱线**：谱线那一行的墨迹占比远高于其它行（音符/文字再密也到不了），
 *      所以按「行墨迹占比 ≥ 0.7」筛出谱线行，再按间距分成各条谱表。
 *   2. **竖线用「谱表内 + 谱表外」双区域**：小节线是贯穿谱表的，音符符干只占半高；
 *      把同一列的墨迹占比同时和「谱表内」「上下各外扩 1/5」两个区域比，符干自然落选。
 *   3. **对称性 + 白占比兜底**：符干往往连着符头/符尾（上下墨量不对称，std 大），
 *      小节线则一整列均匀 —— 用列内 std 与墨迹占比再各过一遍。
 *   另外用小核纵向闭运算补上扫描件的断线，再把贴得很近的双竖线（反复记号）合并成一条。
 *
 * 本模块不碰 DOM、不引 pdf.js / i18n，`scripts/unit-test.mjs` 可以直接跑。
 * 栅格化那一步在浏览器侧（把 PDF 页渲染到 canvas 再 `getImageData`）。
 */

/** 默认参数（与参考实现同名同义；像素量按「谱表行距」表达，大小谱表通吃） */
export const OMR_DEFAULTS = {
  /** 自适应阈值：比局部均值暗这么多才算墨点 */
  inkDelta: 10,
  /** 自适应阈值的窗口边长 = 谱表行距 × 该值 */
  windowRatio: 0.8,
  /** 谱线行：墨迹占比（该行墨点数 / 行宽）的下限 */
  rowInkRatio: 0.7,
  /** 谱线行分组时允许的行间隔（像素） */
  rowGroupGap: 3,
  /** 一条谱线至少要有几行像素（再薄就是噪点） */
  minLineThickness: 2,
  /** 谱表至少几条线（单线谱表也能满足） */
  minStaffLines: 4,
  /** 谱线行距的合法区间（像素） */
  minStaffSpace: 2,
  maxStaffSpace: 40,
  /** 谱表横向长度 ≥ 页面宽度的这个比例 */
  minStaffWidth: 0.3,
  /** 谱线间距的均匀度：最大偏差 ≤ 行距 × 该值 */
  spaceTolerance: 0.35,
  /** 合行的阈值：两谱表间距 < 单个谱表高度 × 该值 → 同一行（钢琴大谱表） */
  systemGap: 2,
  /** 小节线：谱线条带覆盖率 ≥ 最强那一列的该比例（最强的列就是真正的小节线） */
  barRatio: 0.8,
  /** 小节线：上下墨量对称性（列内 std ≤ 行高 × 该值） */
  barFlatness: 0.4,
  /** 小节线：纵向闭运算核高 = 行高 × 该值（补断线） */
  closeRatio: 1 / 15,
  /** 相邻两条小节线的间距 < 平均间距 × 该值 → 合并（反复记号的双竖线） */
  mergeRatio: 0.2,
  /** 距离页面左右边缘这么近的竖线忽略（切边、页框） */
  edgeMarginRatio: 0.004,
  /** 一行至少几条小节线（n 条线 = n−1 个小节） */
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

/* ------------------------------- 1. 二值化 ------------------------------- */

/**
 * 灰度 + 自适应阈值二值化（积分图算局部均值）。
 * 扫描件的纸面常有一侧发灰/带阴影，全局阈值会把整片区域判成墨点，所以必须局部自适应。
 * 返回 0/1 的 Uint8Array（1 = 墨点）。
 */
export function binarize(data, width, height, staffSpacePx, opts = {}) {
  const t = { ...OMR_DEFAULTS, ...(opts || {}) }
  const inkDelta = t.inkDelta
  const step = Math.max(3, Math.round(num(staffSpacePx, 8) * t.windowRatio)) | 1
  const r = (step - 1) / 2
  const gray = new Uint8ClampedArray(width * height)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000
  }
  // 整页反色（黑底白线）也要能认：均值太暗就翻过来
  let sum = 0
  for (let i = 0; i < gray.length; i++) sum += gray[i]
  if (sum / Math.max(1, gray.length) < 128) {
    for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i]
  }
  // 积分图
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

/* ---------------------------- 2. 行墨迹占比 → 谱线 ---------------------------- */

/** 每行的墨迹占比（该行墨点数 / 行宽） */
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

/**
 * 挑出谱线行并聚成「线」（参考实现 detect_horizontal_lines）：
 * 连续若干行的墨迹占比都够高就是一整条谱线，取其中占比最高的那一行当中心。
 */
export function pickLineRows(rowRatio, t) {
  const raw = []
  let cur = null
  for (let y = 0; y < rowRatio.length; y++) {
    if (rowRatio[y] >= t.rowInkRatio) {
      if (cur && y - cur.to <= t.rowGroupGap) {
        cur.to = y
        if (rowRatio[y] > cur.best) {
          cur.best = rowRatio[y]
          cur.y = y
        }
      } else {
        if (cur) raw.push(cur)
        cur = { from: y, to: y, y, best: rowRatio[y] }
      }
    }
  }
  if (cur) raw.push(cur)
  return raw
    .filter((b) => b.to - b.from + 1 >= t.minLineThickness)
    .map((b) => ({ y: b.y, from: b.from, to: b.to, thickness: b.to - b.from + 1, ink: b.best }))
}

/** 线的左右墨迹边界（判断这条线画了多长） */
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

/** 一条谱线的倾斜斜率（对各段墨点重心做最小二乘），用于估计整页歪斜 */
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

/**
 * 找出所有谱表（每个谱表 = 一组间距均匀的谱线）。
 * 与参考实现的差别：那边只认「最后一段」（tab 谱面就在页面底部），
 * 这里要认全部 —— 一页上有好几行，还可能有大谱表。
 */
export function findStaves(ctx, tuning) {
  const { bins, width, height } = ctx
  const t = { ...OMR_DEFAULTS, ...(tuning || {}) }
  const rowRatio = rowInkRatios(bins, width, height)
  const rows = pickLineRows(rowRatio, t)

  const lines = []
  for (const r of rows) {
    const ext = lineExtent(bins, width, r.from, r.to)
    if (ext.x0 < 0) continue
    const len = ext.x1 - ext.x0
    if (len < width * t.minStaffWidth) continue
    lines.push({
      y: r.y + 0.5,
      from: r.from,
      to: r.to,
      thickness: r.thickness,
      ink: r.ink,
      x0: ext.x0,
      x1: ext.x1,
      len,
      slope: lineSlope(bins, width, r.from, r.to, ext.x0, ext.x1),
    })
  }
  lines.sort((a, b) => a.y - b.y)

  // 谱表 = 连续几条「间距均匀」的谱线
  const staves = []
  let i = 0
  while (i < lines.length) {
    let j = i + 1
    let space = 0
    while (j < lines.length) {
      const gap = lines[j].y - lines[j - 1].y
      if (j === i + 1) {
        space = gap
      } else if (Math.abs(gap - space) > space * t.spaceTolerance) {
        break
      }
      j++
    }
    const count = j - i
    if (count >= t.minStaffLines && space >= t.minStaffSpace && space <= t.maxStaffSpace) {
      const group = lines.slice(i, j)
      staves.push({
        yTop: group[0].y,
        yBottom: group[group.length - 1].y,
        space,
        count,
        x0: Math.min(...group.map((g) => g.x0)),
        x1: Math.max(...group.map((g) => g.x1)),
        slope: median(group.map((g) => g.slope).filter((s) => Number.isFinite(s))) || 0,
      })
      i = j
    } else {
      i++
    }
  }

  const skew = staves.length ? median(staves.map((s) => s.slope).filter((s) => Number.isFinite(s))) : 0
  const staffSpace = staves.length ? median(staves.map((s) => s.space)) : 0
  return { staves, lines, rows, rowRatio, skew: skew || 0, staffSpace }
}

/* --------------------------- 3. 谱表 → 行（system） --------------------------- */

/** 把同一行里的多个谱表（钢琴大谱表等）合成一个 system；坐标是像素、y 向下 */
export function groupSystems(staves, tuning) {
  const t = { ...OMR_DEFAULTS, ...(tuning || {}) }
  const sorted = staves.slice().sort((a, b) => a.yTop - b.yTop)
  const systems = []
  const trace = []
  for (const st of sorted) {
    const last = systems[systems.length - 1]
    const span = (s) => (s ? s.yBottom - s.yTop : NaN)
    const gap = last ? st.yTop - last.lastBottom : -1
    const usedSpan = last ? Math.max(span(last.lastStaff), span(st)) : 0
    const limit = usedSpan * t.systemGap
    const join = !!last && gap < limit
    trace.push({ yTop: st.yTop, gap, usedSpan, limit: Number(limit.toFixed(2)), systemGap: t.systemGap, join })
    // 判据用「单个谱表的高度」而不是已合并行的高度：后者会随着不断并入而变大，
    // 链式反应下来会把整页并成一行（犯过这个错）。
    // 比较的基准是「组里最后一个谱表的底线」，所以单独记 lastBottom —— 不能拿 yBottom
    // （那是整组的下边界，链上来以后只会越离越远）。
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

/* ------------------------------ 4. 小节线（竖线） ------------------------------ */

/** 纵向闭运算：把一列墨点里 ≤ maxGap 的空隙填上（扫描件断线全靠它） */
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

/** 某列在 [y0,y1) 之间的墨点区间（已按 maxGap 补齐断点） */
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

/**
 * 参考实现 `_detect_bar_lines` 的 JS 版，但判据从「整列墨迹占比」改成「谱线条带覆盖率」。
 *
 * 为什么不能按「谱表包围盒」算覆盖率：钢琴大谱表的两个谱表之间**本来就不画小节线**
 * （一条贯穿全高的小节线只出现在声部交界处），按包围盒算真实小节线只有 67% 覆盖率，
 * 会和符干混在一起分不开。所以这里只统计**谱线所在的条带**（找到的谱线行 ± 半行距），
 * 小节线一定把这些条带都填满，符干只会盖住上下两头的一部分。
 *
 * 参考实现的另外两道过滤照搬：上下对称性（列内 std）与「谱表内 + 谱表外」双区域比较。
 */
export function findBars(ctx, system, tuning) {
  const { bins, width } = ctx
  const t = { ...OMR_DEFAULTS, ...(tuning || {}) }
  const top = Math.max(0, Math.round(system.yTop))
  const bottom = Math.min(ctx.height - 1, Math.round(system.yBottom))
  if (bottom - top < 4) return []
  const expand = Math.round((bottom - top) / 5)
  const edgeTop = Math.max(0, top - expand)
  const edgeBottom = Math.min(ctx.height, bottom + expand + 1)
  const maxGap = Math.max(1, Math.round((bottom - top) * t.closeRatio))

  // 期望墨点：每条谱线 ± 半行距（谱线本身会被记成 2~3 行，这里按行距留够余量）
  const bands = []
  for (const st of system.staves || []) {
    const half = Math.max(2, Math.round(st.space * 0.3))
    bands.push([Math.max(edgeTop, Math.round(st.yTop) - half), Math.min(edgeBottom - 1, Math.round(st.yBottom) + half)])
  }
  if (!bands.length) bands.push([top, bottom])
  const minBand = Math.min(...bands.map(([lo, hi]) => Math.max(1, hi - lo + 1)))

  const inSum = new Float64Array(width)
  const segCount = new Int32Array(width)
  let maxIn = 0
  for (let x = 0; x < width; x++) {
    const runs = columnRuns(bins, width, x, edgeTop, edgeBottom, maxGap)
    let n = 0
    let segs = 0
    for (const [lo, hi] of bands) {
      let k = 0
      for (const [a, b] of runs) {
        const s = Math.max(a, lo)
        const e = Math.min(b, hi)
        if (e < s) continue
        n += e - s + 1
        k++
      }
      if (k > segs) segs = k
    }
    inSum[x] = n
    segCount[x] = segs
    if (n > maxIn) maxIn = n
  }

  const cand = []
  const stats = { ratioReject: 0, flatReject: 0, maxIn, minBand }
  for (let x = 0; x < width; x++) {
    const n = inSum[x]
    if (n < maxIn * t.barRatio) {
      stats.ratioReject++
      continue // 谱线条带没被填满：不是一条完整的小节线
    }
    // 每条谱带里只能有「一整段」墨：符干在音符上下各留一段，会被这一步筛掉
    if (segCount[x] > 1) {
      stats.flatReject++
      continue
    }
    cand.push(x)
  }
  stats.cand = cand.length
  if (!cand.length) return { bars: [], stats }

  // 相邻列并成组（一组 = 一根小节线）
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

  // 贴得很近的双竖线（反复记号）合并成一条
  if (centers.length > 1) {
    const gaps = centers.slice(1).map((c, i) => c - centers[i])
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    if (avg > 0) {
      const merged = []
      let i = 0
      while (i < centers.length) {
        let j = i
        while (j + 1 < centers.length && centers[j + 1] - centers[j] < avg * t.mergeRatio) j++
        merged.push(centers.slice(i, j + 1).reduce((a, b) => a + b, 0) / (j - i + 1))
        i = j + 1
      }
      centers = merged
    }
  }

  // 贴边的竖线丢掉（扫描切边、页框）
  const edge = Math.max(1, t.edgeMarginRatio * width)
  return { bars: centers.filter((c) => c >= edge && c <= width - edge), stats }
}

/* --------------------------------- 主入口 --------------------------------- */

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
  const grouped = groupSystems(staves, t)
  const systems = grouped.systems
  const out = []
  const debug = []
  for (const sys of systems) {
    const { bars, stats } = findBars(ctx, sys, t)
    debug.push({ yTop: sys.yTop, yBottom: sys.yBottom, space: sys.space, height: sys.height, bars: bars.length, ...stats })
    if (bars.length < t.minBarsPerSystem) continue
    out.push({
      x0: sys.x0,
      x1: sys.x1,
      yTop: sys.yTop,
      yBottom: sys.yBottom,
      space: sys.space,
      staffCount: sys.staves.length,
      bars,
      measures: bars.length - 1,
    })
  }
  // 像素 → pt；保持「systems 按 y0 降序」的不变量（PDF y 轴向上）
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

/** 把识别结果转成 `meta.pages[i].systems` 的形状（id 由调用方注入，domain 层保持纯粹） */
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
