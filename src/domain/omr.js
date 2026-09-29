/**
 * 谱面自动识别（只做两件事：找**行**、找**小节线**）
 *
 * 输入是「已经栅格化的页面墨点图」，输出可直接写进 `meta.pages[].systems` 的标记
 * （PDF 原始点坐标 pt，见 docs/invariants.md）。**只用位图**，不看 PDF 矢量路径 ——
 * 实测大量乐谱 PDF（扫描件、图片导出、Pillow 拼图）整页就是一张位图，
 * `getOperatorList()` 里一条路径都没有，矢量方案在它们身上完全失效。
 *
 * 四步，每一步的判据都刻意做成「相对这一页自己」的量，不写死绝对像素/占比
 * （同一批谱子里，谱线墨迹占比从 0.64 到 0.9、行距从 11px 到 25px、行内间距从 47px 到 95px 都有）：
 *
 *   1. **谱线行 = 细而突出的行**（`pickLineRows`）：门槛是本页最强行的 `linePeakRatio` 倍，
 *      再按「局部最强行的比例」筛突出度 —— 符杠、歌词、密集符头能堆出一片高墨迹区，
 *      堆不出一根又细又尖的行。
 *   2. **谱表 = 等间距的一组谱线**（`findStaves`）：轮着试几个间距容差取覆盖最好的那一套，
 *      再按等间距外推把**没认出来的那条线**补回来（少一条线，谱表包围盒就短一截，
 *      小节线的判据会跟着一起错）。
 *   3. **行 = 由「有东西连起来」的谱表合成**（`groupSystems`）：主判据是两谱表之间的空隙里
 *      有一根竖线贯穿过去（行首括号 / 系统小节线），没有括号时退回一个卡得很紧的间距判据。
 *      间距的倍数、中位数、分布拐点三种写法都试过，每一种都能在另一份谱子上并错或拆错。
 *   4. **小节线 = 每条谱表的谱表高度里都被一段墨填满**（`findBars`）：逐条谱表单独判、
 *      取最弱的那条，符干在音符上下各留一段自然落选；小核纵向闭运算补扫描件的断线，
 *      最后把贴得太近的（反复记号双竖线）按行距合并成一条。
 *   5. **行两端缺的那条补回来**（`closeRowEnds`）：行首那条线常和行号、谱号、调号、拍号挤在一起
 *      （数字谱里常常干脆不画），行尾那条可能被反复记号 / 终止线挤掉 —— 丢一条就少一个小节
 *      （n 条线 = n−1 个小节）。判据见那个函数。
 *
 * 本模块不碰 DOM、不引 pdf.js / i18n，`scripts/unit-test.mjs` 可以直接跑。
 * 栅格化那一步在浏览器侧（把 PDF 页渲染到 canvas 再 `getImageData`），
 * 由本文件末尾的 `detectPdfPages` 统一包好 —— **导入 PDF 时就是它在跑**（见 `store/library.js`）。
 * 纯 node 下调参用 `scripts/omr-node.mjs`（那批谱子每页就是一张位图，不用浏览器也能拿到同样的像素）。
 */

/** 默认参数（像素量按「谱表行距」表达，大小谱表通吃） */
export const OMR_DEFAULTS = {
  /** 自适应阈值：比局部均值暗这么多才算墨点 */
  inkDelta: 10,
  /** 自适应阈值的窗口边长 = 谱表行距 × 该值 */
  windowRatio: 0.8,
  /**
   * 谱线行：相对强度下限 —— 该行墨迹占比 ≥ 本页最强那一行 × 该值。
   * **不用绝对阈值**（曾经是写死的 0.7）：扫描件、低分辨率位图、粗印的谱线行墨迹占比能低到
   * 0.64（实测 `cycle` 的整页位图只有 72 DPI，谱线放大后最多到 0.73），而笔画粗的谱子又能到
   * 0.9 —— 一个绝对数要么漏谱线（整条谱表散架、一行都认不出来），要么把符杠认成谱线。
   */
  linePeakRatio: 0.45,
  /** 谱线行的墨迹占比硬下限（防「满页没有谱线」的页面里噪声互相当基准） */
  lineMinRatio: 0.15,
  /** 线芯取重心时，「达到峰值这个比例」的行才算线芯（厚谱线占好几行，取重心比取最高那行稳） */
  peakPlateau: 0.92,
  /**
   * 谱线行的「突出度」下限：局部最强行 × 该值。
   * 这一条与 `linePeakRatio` 搭着用：符杠、歌词、密集符头能堆出一片高墨迹区，
   * 但**堆不出一根又细又突出的行** —— 谱线在它两侧的行里是唯一的尖峰。
   */
  lineProminence: 0.8,
  /**
   * 谱表分组：相邻谱线的间距差异 ≤ 首个间距 × 该值（多个容差轮流试，取覆盖最好的那套，
   * 见 `groupStaffLines`）。太小会把「行距有点不匀的扫描件」拆成两条谱表，太大会把两条谱表并成一条。
   */
  spaceTolerance: 0.15,
  /** 谱表至少几条线（单线谱表也能满足） */
  minStaffLines: 4,
  /** 谱线行距的合法区间（像素） */
  minStaffSpace: 3,
  maxStaffSpace: 40,
  /** 谱表横向长度 ≥ 页面宽度的这个比例 */
  minStaffWidth: 0.3,
  /**
   * 补线：谱表按等间距外推，缺的那条线在该位置找回来的力度（局部最强行的比例）。
   * 谱线断成几截、被符头压掉一半、或者干脆印得很淡（实测 `cycle` 的第 5 条线只有最强行的
   * 两成 propor）时，行墨迹占比会掉到主阈值以下，但**位置是已知的**（等间距外推），
   * 所以能在那个位置用一个宽松得多的力度把它认回来。抓错的风险由「位置必须对得上等间距」兜住。
   */
  lineFillRatio: 0.15,
  /**
   * 合行判据：两谱表之间的空隙被一根竖线**贯穿**到这个比例 → 同一行（行首括号 / 系统小节线）。
   * 见 `sameSystem`。
   */
  joinCoverage: 0.7,
  /**
   * 合行判据的兜底（没有括号可看的谱子）：间距 < 行距 × 该值 → 同一行。
   * **卡得很紧**，只认「贴着画的」；宁可把同一行拆开，也不要并错（并错会让整页小节串位）。
   * 上限就是 3：地獄先生的行内间距是行距的 2.4~2.9 倍，而 cycle 的行间距是 8.8 倍 ——
   * 取 3 以上就会把 cycle 那种单谱表行按间距并起来（实测调大立刻整页并成一行）。
   */
  systemGapTight: 2.5,
  /**
   * 小节线：每条谱表的高度里，**填满的比例**要 ≥ 本行最强那一列的该比例。
   * 「填满的比例」= (最长墨段 − 谱表高度 × `barSlack`) / 谱表高度，见 `findBars`。
   */
  barRatio: 0.8,
  /** 小节线判据里留给「没画满」的容差（× 谱表高度）：两头各差一点点的线还算小节线 */
  barSlack: 0.22,
  /**
   * 小节线：纵向闭运算核高 = 行高 × 该值（补扫描件的断线）。
   * **别调大**：核一大，符干 + 谱线 + 符头之间的空隙全被填上，整列就"看起来是满的"，
   * 每一根符干都会变成一条小节线（实测调到 0.25 时一行能认出一二十条）。
   */
  closeRatio: 1 / 12,
  /** 相邻两条小节线的间距 < 行距 × 该值 → 合并（反复记号的双竖线、粗线被拆成两列） */
  mergeRatio: 2.5,
  /**
   * 行两端补线：行端那条竖线要填满谱表高度的这个比例才算「这儿有线」。
   * **要取得高**（接近整条谱表高度）：同一条谱表上「谱线末端的墨 + 小核闭运算」也能凑出
   * 大半个谱表高的连续段，门槛低了就会把谱线末端当成线。
   */
  rowEndFillRatio: 0.85,
  /**
   * 行两端补线：首（末）小节线离谱表墨迹端点超过 **行距 × 该值** 才补。
   * 拍号 / 谱号占的横向宽度大致是几个行距，一条真小节线不会离行端那么远。
   */
  rowEndGap: 1.2,
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
 * 挑出谱线行。
 *
 * 判据是「**细而突出的行**」，不是一个绝对的墨迹占比：
 *
 *   1. 先看本页最强的行墨迹占比 `pagePeak`，谱线行的门槛就是它的 `linePeakRatio` 倍
 *      （再兜一个 `lineMinRatio` 硬下限）。换一份深浅不同的谱子不用重调参数。
 *   2. 再从高墨迹的行里切出**连续段**，每段取「峰值平台」的重心当线的中心：
 *      线芯占 2~4 行，取重心比取最高那一行稳（扫描件的线常常一侧深一侧浅）。
 *   3. 最后按**突出度**筛：这一行要 ≥ 它「上下各半个行距」内最强行 × `lineProminence`。
 *      符杠、歌词、密集符头能堆出一片高墨迹区，但堆不出一根又细又尖的行 —— 谱线是尖峰。
 *
 * `maxInRadius` = 半个行距（谱线之间的行不该有别的谱线，所以局部最强就是这一根线）。
 */
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
    // 一段里所有「达到峰值这个比例」的行一起定中心
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

/** `v[i]` 在半径 `r` 内的最大值（滑动窗口最大，单调队列，O(n)） */
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
 * 谱表分组：`lines` 已按 y 升序。
 *
 * 从某条线起，往后只要「与上一个间距」和「首个间距」差得在容差内就继续收进来。
 * **首个间距必须与后面所有间距都比**（不能只比相邻两个）—— 只比相邻的话，
 * 间距 13、13、26、26 会被收成一串（13≈13 过、26 与 13 差太多会断，但换个起点又能接上），
 * 谱表高度一虚，小节线的条带判定跟着一起错。
 */
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

/** 一组线相对首条线的序号偏移（= 第几条谱线，缺线时会跳号） */
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

/** 一组线的间距中位数 */
function estimateSpace(lines, from, to) {
  const gaps = []
  for (let k = from + 1; k <= to; k++) gaps.push(lines[k].y - lines[k - 1].y)
  return median(gaps) || 1
}

/** 线候选：形状 + 位置 + 墨迹占比（`ink` 是这根线所在行的占比，供后面的相对判据用） */
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

/**
 * 补线：把「按等间距本该有、但主阈值没认出来」的谱线找回来。
 *
 * 两种缺线都要补，而且补法不同：
 *
 *  · **组内缺线**（认出来的线序号跳号，如 0/1/3/4）：中间那条一定有，位置由前后两条夹出来，
 *    不用另找 —— 直接按等间距插进去。这是「谱线被符头压掉一半」的情形，硬找反而找不准。
 *  · **两端缺线**（序号是 0/1/2/3）：谱表可能真的只有 4 条（TAB 谱就是 4 条），
 *    所以只在**外推位置上确实有墨**时才补，而且要够长够直 —— 判据比主阈值松得多，
 *    因为实测第 5 条线常常只有最强行的两成墨迹占比（`cycle` 整页就是 72 DPI 的位图）。
 *
 * 组内间距均不匀（最大 / 最小 > 该比例）时**不补两端**：间距本来就不匀的谱表
 * （数字谱常见：4 条密线 + 1 条离得远的）外推出来的位置没有依据，宁可不补。
 */
function fillMissingLines(bins, width, rowRatio, group, space, t) {
  const H = rowRatio.length
  const pagePeak = percentile(rowRatio, 0.999)
  const need = Math.max(t.lineMinRatio * 0.5, pagePeak * t.lineFillRatio)

  // 1) 组内缺线：按序号把中间空出来的位置插回去
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

  // 2) 两端缺线：外推一格，位置上有墨且够长才补
  const gaps = []
  for (let i = 1; i < dense.length; i++) gaps.push(dense[i].y - dense[i - 1].y)
  const uniform = gaps.length < 2 || Math.max(...gaps) <= Math.min(...gaps) * 1.6
  const out = dense.slice()
  if (uniform) {
    // 半径取半个行距：再远就不是「这根线」了（相邻谱线之间不该有第二个候选）
    const radius = Math.max(1, Math.round(space * 0.5))
    const localMax = maxInWindow(rowRatio, radius)
    for (let side = 0; side < 2; side++) {
      for (let guard = 0; guard < 3; guard++) {
        const ref = side === 0 ? out[0] : out[out.length - 1]
        const target = Math.round(side === 0 ? ref.y - space : ref.y + space)
        if (target < 0 || target >= H) break
        const from = Math.max(0, target - radius)
        const to = Math.min(H - 1, target + radius)
        let cand = -1
        for (let y = from; y <= to; y++) {
          if (rowRatio[y] < need || rowRatio[y] < localMax[y] * t.lineProminence) continue
          if (cand < 0 || rowRatio[y] > rowRatio[cand]) cand = y
        }
        if (cand < 0) break
        const line = makeLine(bins, width, cand, cand, cand, rowRatio[cand])
        if (line.len < width * t.minStaffWidth) break
        if (side === 0) out.unshift(line)
        else out.push(line)
      }
    }
  }
  return out
}

/** 插进去的线没有真实墨迹行，几何量沿用相邻线（只用于确定谱表包围盒） */
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

/**
 * 找出所有谱表（每个谱表 = 一组间距均匀的谱线）。
 *
 * 要认全部谱表而不是只认其中一段 —— 一页上有好几行，还可能有大谱表。
 * 三个必要的步骤：
 *   1. `pickLineRows` 找**线候选**（细而突出的行）；
 *   2. 按等间距分组时**轮着试几个容差**，取「覆盖到的线最多」的那一套 ——
 *      扫描件的行距本来就不匀，一个写死的容差要么拆要么并；
 *   3. `fillMissingLines` 按等间距外推把**没认出来的那条线**补回来 ——
 *      谱表少一条线的话，谱表包围盒就短一截，小节线的条带判定会跟着一起错。
 */
export function findStaves(ctx, tuning) {
  const { bins, width, height } = ctx
  const t = { ...OMR_DEFAULTS, ...(tuning || {}) }
  const rowRatio = rowInkRatios(bins, width, height)

  // 粗估行距：先用墨迹占比前 8% 的行做一次快速分组，只为拿到半径，结果不直接用
  const coarse = percentile(rowRatio, 0.92)
  const coarseRows = []
  for (let y = 0; y < height; y++) if (rowRatio[y] >= Math.max(t.lineMinRatio, coarse * 0.7)) coarseRows.push({ y, ink: rowRatio[y] })
  const coarseSpace = estimateCoarseSpace(coarseRows)

  const cand = pickLineRows(rowRatio, t, coarseSpace * 0.5, bins, width)
  // 横向太短的「线」不是谱线（歌词的下划线、装饰线）
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
  // 同一组线会被多个容差提出来，按覆盖的行区间去重
  const uniq = []
  const seen = new Set()
  for (const p of proposals) {
    const key = `${p.from}:${p.to}`
    if (seen.has(key)) continue
    seen.add(key)
    uniq.push(p)
  }
  // 贪心取互不重叠、总覆盖最长的那一套（跨行越多的组越优先）
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
    // 补线后重新量一次行距（补进来的线可能把外沿撑开）
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

/** 粗估行距（只为给 `pickLineRows` 一个搜索半径）：候选行的间距里，取「比较小又常见」的那一档 */
function estimateCoarseSpace(rows) {
  if (rows.length < 4) return 8
  const gaps = []
  for (let i = 1; i < rows.length; i++) {
    const g = rows[i].y - rows[i - 1].y
    if (g > 0) gaps.push(g)
  }
  if (!gaps.length) return 8
  // 谱线间距通常是「较小的那一档」：取 25 分位而不是中位数（中位数会被行间距拉大）
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

/* --------------------------- 3. 谱表 → 行（system） --------------------------- */

/**
 * 两条相邻谱表是不是**同一行**（钢琴大谱表、旋律 + TAB、双声部之类）。
 *
 * 主判据是「**有东西把两条谱表连起来**」，而不是间距的倍数 —— 倍数怎么定都会在某一类版式上翻车
 * （实测：地獄先生「旋律 + TAB」的行内间距 47px、行间距 78px，而乱春的行内间距就有 95px、
 * 行间距 150px 以上；按行距乘固定倍数、按全页间距中位数、按分布拐点，三种都试过，
 * 每种都能在另一份谱子上把整页并成一行或拆成一堆）。
 *
 * 连起来的证据按强弱两条：
 *   1. **两谱表之间的空隙里有一根竖线贯穿过去**（行首的大括号 / 系统连线，
 *      或者贯穿两条谱表的小节线）。这是最强证据 —— 地獄先生每一对同行的谱表之间都是
 *      47/47 这样的满格竖墨，而相邻两行之间只有十几像素的碎墨。
 *   2. 没有这种竖线时（有些谱子不画括号），退回间距判据，但门槛卡得很紧（`systemGapTight`
 *      倍行距），只认「贴着画的」那一种；宁可把同一行拆开，也不要并错 ——
 *      拆开的后果是少一条行标记，并错的后果是小节编号整页串位。
 */
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

/**
 * 两谱表之间的空隙里「被一根竖线贯穿」的比例 = 空隙范围内任一列的最长竖墨 / 空隙高度。
 * 行首的大括号、贯穿两条谱表的小节线都会让它是 1.0；正文里的符干、歌词跨不过整段空隙。
 */
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

/** 把同一行里的多个谱表合成一个 system；坐标是像素、y 向下 */
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
 * 一列在 `[lo, hi]` 里「从第一段墨到最一段墨」的总跨度（0 = 这一段里没有墨）。
 *
 * 为什么不用「最长的那一段」：**二值化之后的小节线本来就是断的** —— 它穿过谱线、
 * 音符、歌词的地方会缺几像素，实测一条贯穿两行谱表的小节线能断成 9 段、最大缺口 94px，
 * 各段加起来却是满的。用最长段当分数的话，这种「满是墨但断成几截」的真小节线会被判掉，
 * 而符干那种「一段连续墨」反倒能过（犯过这个错）。跨度对断线天然免疫。
 */
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

/**
 * 小节线 = 贯穿谱表的竖线。
 *
 * 判据是「**每一条谱线的谱表高度里都被一段墨填满**」，不是「整列的墨迹占比」、
 * 也不是「整列只有一段墨」：
 *
 *  · 不能按**谱表包围盒**算覆盖率：钢琴大谱表 / 旋律 + TAB 这类行，两个谱表之间**本来就不画
 *    小节线**，按包围盒算真小节线只有六成覆盖率，会和符干混在一起分不开。所以逐条谱表
 *    单独判（谱线最上/最下一条之间那段），**每条都要过**。
 *  · 分母用**谱表高度**（首末谱线之间），不是条带高度（谱表 ± 0.3 行距）：条带是为了补上
 *    「谱线本身占好几行」的余量，用它当分母等于**替所有短笔画免掉一截**，符干就混进来了。
 *  · 容差 `barSlack × 谱表高度` 那一项是留给**小节线本身没画满**的（不少谱子小节线只画在
 *    谱线之间、两头差一两像素），它随谱表等比缩放，所以大小谱表是同一套判据。
 *  · 不能要求**整列只有一段墨**：符干、连音线会贴着小节线上下一小段，把这一列切成好几段，
 *    真小节线反而被判掉（犯过这个错）。改成看「最长的那一段」—— 碎段不再算数，
 *    但也不会因为有碎段就把整列否掉。
 *  · 分数取**最弱的那条谱带**：只填满了上谱表、下谱表只沾一半的列（符干、装饰线）自己就出局；
 *    按各条带之和比的话，它会靠上谱表把总分顶上去。
 *
 * 最后按**行距**合并贴得太近的候选：反复记号的双竖线、粗线被二值化拆成两列，
 * 都属于「同一根线」，不该算成两条（那会凭空多出一个小节）。
 */
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

  // 每条谱表只判「首末谱线之间」那一段的高度（换算成绝对 y 区间，闭运算要在这个范围里做）
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
  const stats = { maxScore: Number(maxScore.toFixed(3)), bands: bands.length, maxGap }

  const cand = []
  for (let x = 0; x < width; x++) {
    if (score[x] >= maxScore * t.barRatio) cand.push(x)
  }
  stats.rejected = width - cand.length
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

  // 贴得太近的合成一条：判据是**行距**（不是「平均间距的比例」——
  // 一页只有两三个小节时平均间距本身就很大，比例判据会漏掉该合并的双线）
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

  // 贴边的竖线丢掉（扫描切边、页框）
  const edge = Math.max(1, t.edgeMarginRatio * width)
  return { bars: centers.filter((c) => c >= edge && c <= width - edge), stats }
}

/**
 * 行端那一列有多像「一根竖线」：逐条谱表量「列内最长连续墨段 / 谱表高度」，取最弱的那条。
 *
 * 四条约束，各自排掉一类误判：
 *
 *   · **分母是谱表自己的高度**（首末谱线之间），不是整行高度。行端那条竖线只画在谱表上，
 *     拿整行高度当分母的话真线永远不及格（实测 cycle 的行端线只占整行的 0.4，
 *     却是整整一条谱表的高度）。
 *   · **不做空隙闭合**（`maxGap = 0`）：闭合核一大，符干 + 谱线 + 符头之间的空隙全被填上，
 *     谱线末端那一小截也能凑出大半个谱表高的连续段，行端随便一列都会被判成有竖线
 *     （犯过这个错，一行行首都补出了线）。行端这一列有 `closeRowEnds` 规定的位置，
 *     量的是「这儿到底有没有一根竖线」，不需要靠闭合去猜。
 *   · **逐条谱表都要过**：行首括号只连在两谱表之间、不盖谱线，判据里自然不及格。
 *   · **门槛要取得高**：留一点余量给「线本身印得淡、二值化后缺一两个像素」的情况，
 *     但不能低到让谱线末端够得着。
 */
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

/**
 * 行两端补小节线：谱表最左和最右的竖线也必须标上（见 docs/invariants.md 第 4 条）。
 *
 * 什么时候会缺：行首那条竖线常常和**行号、谱号、调号、拍号**挤在一起（数字谱里更是常常
 * 干脆不画 —— 行首第一眼看到的是拍号），行尾那条可能被反复记号 / 终止线画得又粗又花。
 * `findBars` 的判据一保守两头就丢，丢一条就少一个小节（n 条线 = n−1 个小节）。
 *
 * 判据分两步，都在**这一行的谱表边界**（`staves[].x0 / x1`，不是 `system.x0 / x1` ——
 * 后者是这一行所有墨迹的并集，行首大括号、行号能把它撑到谱表外 96px）往里量：
 *
 *   1. 首（末）小节线已经贴着边（距离 ≤ `rowEndGap` × 行距）→ **不缺线，不动**。
 *   2. 否则，在「谱表边界 ~ 已有首（末）线」之间找那条漏掉的竖线：从边界往里扫，
 *      第一列够得上 `rowEndFillRatio` 谱表高度的就是它（行号、加线都够不上谱表高度）；
 *      **一列都没有**（这一端真的没画线、或没线的地方只是空白）→ 补在**谱表边界**上。
 *
 * 第 2 步的兜底是「两端必须有线」这条要求本身：行端没有竖线，这一行的小节数就少一个，
 * 后面小节编号、跳转、反复全跟着错位。
 */
export function closeRowEnds(ctx, systems, tuning) {
  const t = { ...OMR_DEFAULTS, ...(tuning || {}) }
  if (!systems.length) return systems
  const sorted = systems.slice().sort((a, b) => a.yTop - b.yTop)
  for (const sys of sorted) {
    const staves = sys.staves || []
    if (!sys.bars || !sys.bars.length || !staves.length) continue
    const space = sys.space || 10
    const yTop = Math.max(0, Math.round(sys.yTop))
    const yBottom = Math.min(ctx.height - 1, Math.round(sys.yBottom))
    if (yBottom - yTop < 4) continue
    const left = Math.min(...staves.map((s) => s.x0))
    const right = Math.max(...staves.map((s) => s.x1))
    const need = space * t.rowEndGap
    const bars = sys.bars.slice().sort((a, b) => a - b)
    if (bars[0] - left > need) bars.unshift(endStroke(ctx, left, bars[0], yTop, yBottom, staves, space, t))
    if (right - bars[bars.length - 1] > need) bars.push(endStroke(ctx, right, bars[bars.length - 1], yTop, yBottom, staves, space, t))
    sys.bars = bars.filter((x, i, arr) => i === 0 || x - arr[i - 1] > 1)
  }
  return sorted
}

/**
 * 「谱表边界 `edge`」与「已有的首（末）线 `inner`」之间那条漏掉的竖线在哪：
 * 从边界往里扫，第一列填满谱表高度 `rowEndFillRatio` 的就是它。
 *
 * 搜索范围要在 `inner` **本身那几列之前**停下（`inner` 是线心，线本身占好几列；
 * 扫到它的边沿就等于把自己当成要找的线返回，位置一点没变还白多一条）。
 * **扫不到就给 `edge`**：这一端真的没画线时也得有线，否则这一行就少一个小节。
 */
function endStroke(ctx, edge, inner, yTop, yBottom, staves, space, t) {
  const from = Math.max(0, Math.round(edge))
  const to = Math.min(ctx.width - 1, Math.round(inner) - 4)
  for (let x = from; x <= to; x++) {
    if (columnFill(ctx, x, yTop, yBottom, staves, space, t) >= t.rowEndFillRatio) return x
  }
  return edge
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
  const grouped = groupSystems(ctx, staves, t)
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
      // 谱表本身要带着走：行两端补线要拿**谱线自己的墨迹端点**当边界（见 closeRowEnds）
      staves: sys.staves,
      bars,
      measures: bars.length - 1,
    })
  }
  // 行两端补线要在**整页**上做（见 closeRowEnds）
  const before = out.map((s) => s.bars.length)
  closeRowEnds(ctx, out, t)
  out.forEach((s, i) => {
    s.measures = s.bars.length - 1
    const d = debug.find((x) => Math.abs(x.yTop - s.yTop) < 0.5)
    if (d) {
      d.bars = s.bars.length
      d.endsFilled = s.bars.length - before[i]
    }
  })
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

/* ------------------------- 栅格化 → 一页一次识别（入口） ------------------------- */

/**
 * 识别用的栅格化精度（DPI）。识别质量**由它决定**，不是随手取的数：
 * 谱线间距在 150 DPI 下只剩几个像素（`minStaffSpace` 是个位数），细谱线一断就整条谱表丢；
 * 300 DPI 位图面积是 200 的 2.25 倍，而识别结果与 200 几乎一致 —— 纯亏时间与内存。
 * 所以固定 200，**不要做成可调参数**（换了它 `staffSpacePx` 那一串判据要跟着重调）。
 */
export const OMR_DPI = 200

/** 栅格化一律白纸：底色透明或灰的 PDF 不铺白会整页判成墨点 */
const PAGE_BG = '#ffffff'

/** 一页墨点占比低于它就算空白页（纯白页/只有页码的页不值得往下跑识别） */
const BLANK_INK_RATIO = 0.002

/** 把一页按 `dpi` 渲染到 canvas 并取出像素（`ctx.scale` = 像素/pt，`w/h` = 像素尺寸） */
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

/**
 * 一页页地识别整份 PDF，返回 `{ pages, diag }`：
 * `pages[i]` = 第 i+1 页的 `toMetaSystems()` 结果（**可直接写进 `meta.pages[i].systems`**），
 * 空白页给空数组（这一页本来也没有行/小节线可标）。
 *
 * 一次只留一页的位图与积分图：200 DPI 的 A4 灰度缓冲约 6MB、积分图约 53MB，
 * 整本一起留在内存里几页就能把标签页顶爆 —— 所以**渲染一页就识别一页、识别完立刻释放**
 * （`page.cleanup()` + 让 canvas 出作用域）。
 */
export async function detectPdfPages(blobOrData, { dpi = OMR_DPI, onPage = null } = {}) {
  // 动态 import：`pdf.js` 只在浏览器里成立（它要 `document`、还要 worker）。
  // 写成顶层静态 import 的话，`scripts/unit-test.mjs` 这种纯 node 环境一加载本模块就炸。
  const { PdfRenderer } = await import('./pdf.js')
  const renderer = await PdfRenderer.from(blobOrData)
  const pages = []
  const diag = []
  try {
    for (let n = 1; n <= renderer.numPages; n++) {
      onPage?.(n, renderer.numPages)
      // 让出一帧：识别是同步的重活，不让帧的话那条任务型 toast 里的「正在识别第 n/共 m 页…」
      // 与进度环要到整本跑完才第一次画出来 —— 长谱看上去就是卡死。
      // 与 setTimeout 赛跑是**必需的兜底**：后台标签页里 rAF 会被节流甚至完全停掉，
      // 只等 rAF 的话「导入」会在切走标签页之后永远停在这一页上。
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
        if (inkRatio < BLANK_INK_RATIO) {
          pages.push([])
          diag.push({ page: n, blank: true, inkRatio })
          continue
        }
        bins.scale = img.scale
        const result = detectPageSystems(bins)
        pages.push(toMetaSystems(result))
        // 像素尺寸一起记下：识别出的几何量全部由它和 `scale` 换算成 pt，
        // 排查「行/小节线整体偏移」时先看这两个数对不对得上页面实际大小
        diag.push({ page: n, blank: false, inkRatio, width: img.width, height: img.height, scale: img.scale, systems: result.systems.length })
      } finally {
        page.cleanup?.()
      }
    }
  } finally {
    renderer.destroy()
  }
  return { pages, diag }
}
