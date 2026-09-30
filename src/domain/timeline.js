/**
 * 结构推导 + 时间轴
 *
 *  1) deriveStructure(meta)  由页/行/小节线推导出「小节」序列（小节编号、屏幕坐标、所属行）
 *  2) resolveSegments(meta)  把段落标记解析成带小节位置的调速点
 *  3) expandJumps(meta)      按跳转记号展开出实际演奏顺序
 *  4) buildTimeline(meta)    按演奏顺序把「小节位置」换算成音频时间，得到逐拍采样表
 *
 *  时间轴查询：timeToPos / posToTime / measureDuration / beatsBetween
 *
 *  硬约定（详见 docs/invariants.md、docs/concepts.md）：
 *   · 小节编号按「页 → 行（自上而下）→ 小节（自左向右）」连续数；**一行 n 条小节线 = n−1 个小节**，
 *     `bars.length < 2` 的行直接跳过（所以没画小节线的行一个小节都没有）。
 *   · `systems` 必须按 `y0` 降序、`bars` 按 `x` 升序（本文件与 schema.js 都会重排并依赖这一点）。
 *   · 行末那条线与**下一行行首那条线**在 `barStartMeasure` 里是**同一个号**（同一个小节的两根线）；
 *     **段落不许落在行末线上**（判据 `isRowEndBar`），要改点**下一行行首那条线**（小节号不变）；
 *     行首那条线**没有**对称限制。跳转记号按小节号存，落笔时按角色挑线（见下一条）。
 *   · 跳转记号的起点 / 终点是**小节编号**，落到谱面上时按角色挑线：起点取**行末**那条、
 *     终点取**行首**那条（同一个小节号的两条线各归一个角色，见 `resolveJumps`）。
 *   · 段落位置是**小节号 + 拍号两个字段**（`seg.measure` / `seg.beat`，见 schema.js），
 *     谁前谁后一律用 `comparePosition()`；一拍时长 = `60 / bpm × 4 / beatUnit`。
 *   · 时间轴是按演奏顺序（含跳转展开）**逐拍累加**出来的，段落的时间锚点在第一遍经过时强制对齐；
 *     `startOffset` 是 `startPosition` 小节（1 或 2）的时间，弱起时第 1 小节落在它之前（见 `startMeasure`）；
 *     派生数据只放在 `store/player.js` 的 computed 里，**别在别处缓存**。
 */

import { comparePosition, DEFAULT_BEAT_UNIT, DEFAULT_BEATS_PER_BAR, DEFAULT_BPM, fitBeat, positionBeat, positionMeasure } from './schema.js'

function medianGap(xs) {
  if (xs.length < 2) return 40
  const diffs = []
  for (let i = 1; i < xs.length; i++) diffs.push(xs[i] - xs[i - 1])
  diffs.sort((a, b) => a - b)
  const m = diffs[Math.floor(diffs.length / 2)]
  return m > 4 ? m : 40
}

/**
 * 小节 = 相邻两条小节线之间。
 * 谱表首尾两条竖线也要标记，这样每行 n 条线 = n-1 个小节。
 * 为了好点，首/末小节的点击区域会向左右各外扩半个平均间距。
 */
export function deriveStructure(meta) {
  const measures = []
  const barStartMeasure = new Map() // barId -> 从该小节线开始的小节号
  const barInfo = new Map() // barId -> { page, sys, x, y0, y1, indexInSystem, systemId }
  const systems = [] // 每行：{ id, page, sys, y0, y1, firstMeasure, lastMeasure, bars }
  let no = 0
  let pendingLastBar = null

  ;(meta.pages || []).forEach((page, p) => {
    const pageWidth = page.width || 595.28
    const pageSystems = (page.systems || []).slice().sort((a, b) => b.y0 - a.y0) // PDF y 轴向上：y0 大的在上
    pageSystems.forEach((sys, s) => {
      const bars = (sys.bars || []).slice().sort((a, b) => a.x - b.x)
      const rec = { id: sys.id, page: p, sys: s, y0: sys.y0, y1: sys.y1, bars, firstMeasure: 0, lastMeasure: 0 }
      systems.push(rec)
      bars.forEach((b, i) => barInfo.set(b.id, { ...b, page: p, sys: s, systemId: sys.id, indexInSystem: i, y0: sys.y0, y1: sys.y1 }))
      if (pendingLastBar) {
        // 上一行最后一条小节线：其后的小节 = 本行第一个小节
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

/**
 * 段落 -> 调速点。位置是「第 `measure` 小节第 `beat` 拍」（见 schema.js）；
 * 没写小节号时自动取该小节线所在的小节号，拍号按这一段落自己的拍号夹一次。
 */
export function resolveSegments(meta, structure, total) {
  const list = []
  for (const seg of meta.segments || []) {
    const auto = seg.barId ? structure.barStartMeasure.get(seg.barId) : null
    const measure = Number.isFinite(seg.measure) ? seg.measure : auto
    if (!Number.isFinite(measure)) continue
    // 越界（挂在曲末那条线上写出的 count + 1）夹到曲末之后：照旧留着这一条，
    // 但拍号归 1 —— 越界的位置上没有「第几拍」可言（原来那种 count + 1 − 1e-6 的写法就是被这件事逼出来的）
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

/**
 * 段落「落在哪一小节」——**位置优先**，没写小节号才退回它挂靠的那条小节线
 * （就是 `resolveSegments` 取生效小节的那一条：先 `measure`、再它挂靠的线）。
 * 谱面上段落标记那条线、总览里那根蓝线都靠它定位，所以三处说的始终是同一件事 ——
 * **别在渲染层再各写一份**「取小节」的规则。
 * 「开头」段落**永远算第 1 小节**（它是固定段落，`measure` 被按死在 1）—— 编辑模式里它也画一条
 * 标记线，就落在第 1 小节第 1 拍上（`measure = 1 / beat = 1`，见 `ScorePage.segmentGeometry`）。
 * **全谱还没有小节时同样返回 null**（`measures` 空），那一条标记就整条不画。
 * 越界也返回 null（例如挂在全谱最后一条小节线上，小节号 = count + 1）。
 */
export function segmentStartMeasure(structure, seg) {
  if (!seg) return null
  // 「开头」不看自己的小节号（数据被手改坏了也照样画在开头）；其余段落位置优先
  const no = seg.head
    ? 1
    : Number.isFinite(seg.measure)
      ? Math.round(seg.measure)
      : seg.barId
        ? structure.barStartMeasure.get(seg.barId)
        : null
  return Number.isFinite(no) ? structure.measures[no - 1] || null : null
}

/**
 * 位置 `measure:beat` 上生效的调速点。`segments` 必须已经按位置排好序（`resolveSegments` 的产物），
 * 所以扫到第一个「排在它后面」的段落就可以停 —— 这里只按小节号与拍号比，没有打包成数字的键。
 */
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

/**
 * 跳转记号 → 谱面上那两条小节线 + 这一条记号「这一次展开里能不能跳」。
 *
 * 每条记号带：
 *   · `seq`  序号（1 起，**按 `meta.jumps` 里的顺序**）—— 界面拿它指代一条记号
 *     （Sheet 里那一行、前置下拉里的选项、标记列表那行字），所以它必须稳定：**别按「有效的那几条」重排**；
 *   · `startBarId` / `endBarId` —— 起点、终点各落在哪条小节线上。同一个小节号可能有**两条线**
 *     （上一行的行末线 + 下一行行首线，见 `deriveStructure`）：**起点取行末那条、终点取行首那条**
 *     （离开在行尾、落在行首），找不到对应的那条（例如那一行只有一条线）就退回第一条；
 *   · `valid` —— 起点与终点都落在 `1..total` 里、且**不是同一个小节**才算有效。
 *     无效的记号**不参与展开、也不画在谱面上**（数据可能是手改的 JSON、也可能是删掉行之后越界了），
 *     但它照旧在数据里、照旧占一个序号 —— 撤销 / 把行加回来之后它自己就恢复了。
 */
export function resolveJumps(meta, structure, total) {
  const barsOf = new Map() // 小节号 -> 起头的那几条小节线
  for (const [barId, no] of structure?.barStartMeasure || []) {
    if (!barsOf.has(no)) barsOf.set(no, [])
    barsOf.get(no).push(barId)
  }
  const at = (barId) => structure?.barInfo?.get(barId) || null
  const pick = (no, role) => {
    const list = barsOf.get(no) || []
    if (!list.length) return null
    // 行末线 = 这一行的最后一条线；行首线 = 这一行的第一条线
    const want = role === 'start'
      ? list.find((b) => isRowEndBar(structure, b))
      : list.find((b) => at(b)?.indexInSystem === 0)
    return want || list[0]
  }
  return (meta?.jumps || []).map((j, i) => {
    const start = Math.round(Number(j.start))
    const end = Math.round(Number(j.end))
    const valid = Number.isFinite(start) && Number.isFinite(end) && start >= 1 && start <= total && end >= 1 && end <= total && start !== end
    return {
      id: j.id,
      seq: i + 1,
      start,
      end,
      prereq: j.prereq || null,
      startBarId: valid ? pick(start, 'start') : null,
      endBarId: valid ? pick(end, 'end') : null,
      valid,
    }
  })
}

/**
 * 这条小节线是不是**它所在那一行的最后一条**（每行最右边那根竖线）。
 *
 * 行末线在 `barStartMeasure` 里与**下一行行首那条线**是**同一个号**：`deriveStructure` 先把上一行的
 * `pendingLastBar` 设成 `no + 1`，下一行自己的第一条线又拿到同一个 `no` —— 两条线说的是同一个小节，
 * 只是画在版心的两端。所以「改挂下一行行首那条线」这个小节号一点不变。
 *
 * 由此有一条落点规则：**段落不许落在行末线上** —— 落在这一行的其他地方、或者下一行行首那条线上
 * 都行（同一个小节）；**行首那条线没有对称限制**。判据只此一处：`store/player.js` 的 `addSegmentAt`
 * 与 `resolveJumps`（同一个小节号的两条线各归起点 / 终点一个角色）共用它。
 *
 * 一行只有一条线（连一个小节都推不出来）时不用管：那条线压根没有 `barStartMeasure`，
 * 「后面没有小节」那道判定先把它挡掉了。
 */
export function isRowEndBar(structure, barId) {
  const info = structure?.barInfo?.get(barId)
  if (!info) return false
  const rec = structure.systems.find((s) => s.id === info.systemId)
  const bars = rec?.bars || []
  return bars.length > 0 && info.indexInSystem === bars.length - 1
}

/**
 * 跳转展开：把谱面顺序（1 → 末小节）改写成**实际演奏顺序**。
 *
 * 规则只有一条，逐小节往前走、每一步先判后走：
 *   **到达第 `i` 小节时，若有一条记号「起点 = `i`」还没跳成功过、且它的前置为空或已跳成功，
 *   就跳到它的终点** —— 起点这一小节自己**不演奏**（记号标的是「从这里离开」）；
 *   一条都没有要跳的就演奏 `i`，再走到 `i + 1`。
 *
 *   · **每条记号最多跳一次**（跳成功就记下）。所以「往回跳」不会转圈，展开必然终止 ——
 *     这也是守卫 `limit` 只是兜底、正常永远碰不到的原因；
 *   · **前置没满足时这次到达不算消费**：记号还等着。之后播放头再回到同一个起点
 *     （框选循环、别的跳转、手动跳都会把它带回去），前置满足了照跳；
 *   · 同一个起点上有多条都能跳时，**取 `meta.jumps` 里排在前面的那条**（`jumps` 的顺序就是落笔顺序）；
 *   · 跳到终点后**接着在终点那一步重新判一次**（终点又正好是另一条记号的起点时，两条连着跳，
 *     `jumpTo` 只标在最后落下来的那一小节上）。
 *
 * 返回 `{ no, jumpTo }` 数组：`jumpTo = true` 的那一项是**跳跃的落点**（终点小节），
 * 界面拿它闪一下目标小节 —— 「提前一小节闪终点、落地再闪一下」两处都读这个标记（见 `store/player.js`）。
 *
 * 入参是 `resolveJumps` 的产物（**已经过滤掉无效的那些**，见那边注释）。
 */
export function expandJumps(jumps, total) {
  const flat = () => {
    const out = []
    for (let m = 1; m <= total; m++) out.push({ no: m, jumpTo: false })
    return out
  }
  if (!total) return []
  const list = (jumps || []).filter((j) => j?.valid)
  const fired = new Set()
  const order = []
  let i = 1
  let jumpTo = false
  let guard = 0
  // 每跳一次最多让 i 从头再走一遍（每条记号只跳一次），所以这个上限正常永远够用
  const limit = total * (list.length + 1) + 8
  while (i >= 1 && i <= total && guard++ < limit) {
    const jump = list.find((j) => j.start === i && !fired.has(j.id) && (!j.prereq || fired.has(j.prereq)))
    if (jump) {
      fired.add(jump.id)
      i = jump.end
      jumpTo = true
      continue
    }
    order.push({ no: i, jumpTo })
    jumpTo = false
    i++
  }
  return order.length ? order : flat()
}

/**
 * 音频起点对齐的是哪一小节：`meta.audio.startPosition`（1 = 第一小节，2 = 有弱起小节时的第二小节）。
 * 只认 1 与 2 两个值，并且夹在总小节数之内 —— 越界（例如只有 1 小节却写了 2）
 * 按 1 处理，等于不提前。
 */
function startMeasure(meta, total) {
  const wanted = Math.round(Number(meta.audio?.startPosition))
  if (!Number.isFinite(wanted) || wanted <= 1) return 1
  return wanted <= total ? wanted : 1
}

/**
 * 弱起小节的提前量（秒）：`startPosition` 之前那些小节都要落在音频起点**之前**。
 * 逐拍累加（与主循环同一套 BPM / 拍号），所以弱起小节标成几拍就提前多少拍 ——
 * 常见做法是给第 1 小节标一个拍号更少的段落（例如 1 拍），提前量就是一拍。
 */
function pickupLeadIn(segments, total, startPos) {
  let sum = 0
  for (let measureNo = 1; measureNo < startPos && measureNo <= total; measureNo++) {
    const tempo = tempoAt(segments, measureNo)
    const beats = Math.max(1, Math.round(tempo.beatsPerBar))
    for (let b = 0; b < beats; b++) sum += tempoAt(segments, measureNo, b + 1).beatDur
  }
  return sum
}

/**
 * 建立时间轴：按**演奏顺序**（含反复展开）逐拍推进，段落 BPM/拍号决定每拍时长，
 * 段落的时间锚点(seg.time)经过时把时间校正到锚点。
 *
 * ⚠️ **两个方向故意不对称**（用户明确要求，别「顺手统一」）：
 *   · **`timeToPos`（播放走到哪）** 走**展开后**的顺序 —— 跳转算数，同一个小节会出现多次；
 *   · **`posToTime`（点小节跳到哪一秒）** 只认**第一次出现** —— 手动跳转「视作还没跳过」：
 *     不管现在播到跳转前还是跳转后，都从那一小节的第一遍接着走，后面的跳转该走还是会走。
 *
 * 起点：`startOffset` 是 `startPosition` 小节的时间。无弱起（startPosition = 1）时它就是第 1 小节的时间；
 * 有弱起（startPosition = 2）时第 1 小节要落在它**之前**一个弱起小节的时长，所以初始时间先往前推。
 * 推出来的时间可以是负数（音频开始前就开始数），播放入口自己会夹到 0。
 */
export function buildTimeline(meta, opts = {}) {
  const structure = opts.structure || deriveStructure(meta)
  const total = structure.count
  const segments = resolveSegments(meta, structure, total)
  const jumps = resolveJumps(meta, structure, total)
  const order = expandJumps(jumps, total)
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
      // 时间锚点：**这一拍走到锚点那一段落所在的位置就把它对齐过去**。
      // 「走了几拍」= 只在同一小节里按拍号相减（锚点那一段落自己的拍号决定一拍多长）——
      // 跨小节的锚点在经过它自己那一小节时就已经对齐过了，这里不需要再按小节号累加。
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
        /** 这一小节是「跳过来的」（见 `expandJumps`）—— 跳转闪一下目标小节就读它 */
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

  // byNo 只记录每一遍的"小节起始拍"，用于小节 <-> 时间的定位
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
    /**
     * 跳转记号 + 它们落在哪两条小节线上（`resolveJumps` 的产物，带序号）。**它不是「又一份派生数据」**：
     * `order` 就是按它展开出来的，谱面画细竖线与弧线、Sheet 里列这一条线上的记号也都读它 —— 一处算、多处用。
     */
    jumps,
    duration,
    audioDuration: Number(meta.audio?.duration) || null,
    startOffset: Number(meta.audio?.startOffset) || 0,
    /**
     * 小节 → 时间。跳转会让同一个小节出现好几遍，所以 `nearTime` 决定取哪一遍：
     *   · **不传 `nearTime`（手动跳转、跳段落、点小节）→ 取第一次出现** —— 用户明确要求手动跳转
     *     「视作还没跳过」：不管现在播到跳转前还是跳转后，都从那一小节的第一遍接着走；
     *   · **传了 `nearTime`（循环区间、暂停回退这类「跟着现在的位置走」的换算）→ 取离它最近的那一遍** ——
     *     否则第二遍框选第 2 小节会把播放头甩回第一遍去。
     */
    posToTime(measureNo, nearTime = null, beatOffset = 0) {
      if (!total) return tl.startOffset
      const occurrences = byNo.get(measureNo)
      if (!occurrences || !occurrences.length) {
        // 越界：夹到最近的有数据的小节
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
    /** 时间 -> { no, beat(小数), sample } */
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
    /** 某小节（某一遍）的时长：按调速点逐拍累加，与演奏顺序无关 */
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
      // 小节内的拍可能因 BPM 变化而不同，逐拍累加
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
    /** 时间区间 [t0,t1] 内的拍点（含重拍标记），用于节拍器 */
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
