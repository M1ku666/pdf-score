/**
 * 结构推导 + 时间轴
 *
 *  1) deriveStructure(meta)  由页/行/小节线推导出「小节」序列（小节编号、屏幕坐标、所属行）
 *  2) resolveSegments(meta)  把段落标记解析成带小节位置的调速点
 *  3) expandRepeats(meta)    按反复标记（含房子 1 / 房子 2）展开出实际演奏顺序
 *  4) buildTimeline(meta)    按演奏顺序把「小节位置」换算成音频时间，得到逐拍采样表
 *
 *  时间轴查询：timeToPos / posToTime / measureDuration / beatsBetween
 *
 *  硬约定（详见 docs/invariants.md、docs/concepts.md）：
 *   · 小节编号按「页 → 行（自上而下）→ 小节（自左向右）」连续数；**一行 n 条小节线 = n−1 个小节**，
 *     `bars.length < 2` 的行直接跳过（所以没画小节线的行一个小节都没有）。
 *   · `systems` 必须按 `y0` 降序、`bars` 按 `x` 升序（本文件与 schema.js 都会重排并依赖这一点）。
 *   · 行末那条线与**下一行行首那条线**在 `barStartMeasure` 里是**同一个号**（同一个小节的两根线）；
 *     **行末线上只允许反复结束标记** —— 判据 `isRowEndBar`，段落 / 反复开始 / 房子 1 起点一律改点
 *     下一行行首那条线（小节号不变）。行首那条线**没有**对称限制。
 *   · 段落位置是**小节号 + 拍号两个字段**（`seg.measure` / `seg.beat`，见 schema.js），
 *     谁前谁后一律用 `comparePosition()`；一拍时长 = `60 / bpm × 4 / beatUnit`。
 *   · 时间轴是按演奏顺序（含反复展开）**逐拍累加**出来的，段落的时间锚点在第一遍经过时强制对齐；
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
 * 反复展开。区块模型：
 *   反复结束(end) 与它"回到"的小节(backToMeasure)构成一个反复区块 —— 配对规则见 `matchRepeatBlocks`。
 *   房子(house1) 属于包含它的那个区块，房子 n 只在第 n 遍演奏，其余遍跳过。
 */

/**
 * 把反复标记配成对。谱面能落下的标记只有三种（`start` / `end` / `house1` 起点），
 * 房子 2 由区块推出来（见 `deriveRepeatBlocks` 的 `houses`）。
 *
 * 配对规则：按落点顺序扫一遍，遇到 `end` 就配给**它左边最近的那个还没配对的 `start`**。
 * 于是「先开始后结束」与「先结束后开始」都能配上，而且天然支持嵌套（内层先配上，外层等下一个 `end`）。
 * **落点顺序取 meta 里的数组顺序** —— 加标记一律 push，所以它就是落笔顺序。
 *
 * ⚠️ **没配上的标记也照样返回**（`end: null`），一个都不能丢：
 *   · 只点了「反复开始」还没点结束线时，那一段反复是**敞着口**的 —— 落点判定要靠它才知道
 *     「这一笔还在这一段里」；演奏与渲染则只认配好对的（见 `deriveRepeatBlocks`）。
 *     **别把 `end: null` 过滤掉**，那会让「点完开始再点中间那条线」又开出新的一段反复。
 *   · 「房子 1 起点」天生是**孤线**（它不与谁配对）—— 落点判定要在配对边界内按小节号找它。
 * 反过来，`end` 没有 `start` 可配就**丢掉**：单条结束线构不成反复（以前它会默默回到第 1 小节）。
 */
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

/**
 * 反复区块的完整派生模型。**时间轴、谱面渲染（房子括号）、落点判定、删除范围都读这一份** ——
 * 别在别处再推一遍（同一件事只有一个实现）。
 *
 * 每块带：
 *   · `startMeasure` / `endMeasure`：区块**包含**的小节范围（结束线位于它的下一条小节线上）；
 *   · `passes`：总遍数（默认 2，夹在 2..16）；
 *   · `houses`：这一块的两条房子跨度（`{ index, startMeasure, endMeasure }`，**闭区间**）
 *     —— 房子 1 = 「房子 1 起点线 → 结束线」；房子 2 = 第二遍**跳过房子 1 之后落地的那一小节**，
 *     **只画这一个小节**（`endMeasure === startMeasure`；那个「2.」是起点标记，不是覆盖范围）。
 *     两者**首尾相接、不重叠**，正是用户要的「房子 1 是这个起点到反复结尾，后面就是房子 2」。
 *     只有看过 `house1` 标记才会有房子 1（没有小节要跳，也就没有房子）；
 *     **没有房子 1 就没有房子 2**（用户要的：没标「房子 1 起点」时，那第二条括号不该自己冒出来）；
 *     第二遍没再经过这一块（例如外面还套了一层反复、或反复就停在曲末）时同样不产生房子 2。
 *   · `startBarId` / `endBarId` / `houseMarks`：删整段反复要用（见 `store/player.js` 的 `addRepeatAt`）。
 */
export function deriveRepeatBlocks(meta, structure, total) {
  if (!total) return []
  const marks = (meta?.repeats || []).filter((r) => r.barId)
  const blocks = matchRepeatBlocks(marks)
    .map((p, idx) => {
      const startAt = structure.barStartMeasure.get(p.start.barId)
      // 敞着口的那一段（点了开始还没点结束）**不成区块**：没有结束线就没有「回到哪里」，
      // 时间轴与房子括号都只认配好对的。落点判定靠 `decideRepeatTap` 自己看 `end === null`。
      const endAt = p.end ? structure.barStartMeasure.get(p.end.barId) : null
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null
      const endMeasure = Math.min(total, Math.max(1, endAt - 1))
      return {
        idx,
        startMeasure: Math.min(Math.max(1, startAt), endMeasure),
        endMeasure,
        passes: Math.max(2, Math.min(16, p.end.passes || 2)),
        /** 配对的两条标记（删整段反复、算落点都靠它们） */
        startBarId: p.start.barId,
        endBarId: p.end.barId,
        /** 房子的标记线：**严格落在区块内部**（两条边界线上落不下标记，见 `decideRepeatTap`） */
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
  /**
   * 「房子 2 覆盖到哪」= **最后那一遍**从区块里接着往下走的那一段。顺序直接取时间轴那一份，不再另推一套。
   *
   * ⚠️ 起点取「跳过房子 1 之后落地的第一条线」（`tail[first]`），**不是** `endMeasure + 1`：
   * 房子 1 的跨度本身就伸到结束线（用户要的「房子 1 = 起点线 → 反复结尾」），
   * 第二遍是**跳过房子 1 整段**才落下来的 —— 从那一段的第一小节起笔，两个房子才首尾相接、不重叠。
   *
   * ⚠️ **括号只画一个小节**（用户明确要求「房子 2 的样式就画一个小节就够了」）：那个「2.」是**起点标记**，
   * 不是覆盖范围。真实覆盖到哪另有 `fullEndMeasure` 记着（调试与将来的用途），渲染只看 `endMeasure`。
   *
   * ⚠️ **没有房子 1 就没有房子 2**（用户要的）：房子 2 的起点本来就是「第二遍**跳过房子 1** 之后
   * 落下来的那一条线」—— 没有房子 1 这条线就无从谈起，那时推出来的东西落在区块自己身上，
   * 画出来只是一条凭空冒出来的「2.」。所以这一轮只处理**已经有房子 1** 的区块。
   */
  const order = expandRepeats(meta, structure, total)
  const orderNos = order.map((x) => x.no)
  for (const b of blocks) {
    if (!b.houses.length) continue // 没有房子 1 起点线 → 不推房子 2（上面那段）
    // **最后一次**从区块起点起走的那一遍 = 反复的那一遍（再往后就不会回到这个起点了）
    const passStart = orderNos.lastIndexOf(b.startMeasure)
    if (passStart < 0) continue
    const tail = orderNos.slice(passStart + 1)
    const first = tail.findIndex((no) => no >= b.endMeasure)
    if (first < 0) continue // 这一遍到曲末都没再走到结束线之后 → 没有「接着往下走」的那一段
    const startMeasure = tail[first]
    // 结束线**是会被跳过的那条线**（它在房子 1 的跨度里），所以「走到的最后一小节」按区间末尾取
    const fullEndMeasure = tail[tail.length - 1]
    if (fullEndMeasure < startMeasure) continue
    b.houses.push({ index: 2, kind: 'house2', startMeasure, endMeasure: startMeasure, fullEndMeasure })
  }
  return blocks
}

/**
 * 这条小节线是不是**它所在那一行的最后一条**（每行最右边那根竖线）。
 *
 * 行末线在 `barStartMeasure` 里与**下一行行首那条线**是**同一个号**：`deriveStructure` 先把上一行的
 * `pendingLastBar` 设成 `no + 1`，下一行自己的第一条线又拿到同一个 `no` —— 两条线说的是同一个小节，
 * 只是画在版心的两端。所以「改挂下一行行首那条线」这个小节号一点不变。
 *
 * 由此有一条落点规则：**行末线上只允许反复结束标记**（`end`），段落 / 反复开始 / 房子 1 起点都不许落在
 * 它上面。落在这一行的其他地方、或者下一行行首那条线上都行；**行首那条线没有对称限制**。
 * 判据只此一处：`decideRepeatTap`（反复）与 `store/player.js` 的 `addSegmentAt`（段落）共用它。
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
 * 反复工具的**落点决策**：点了某条小节线之后该干什么。纯函数，**判据只此一处**（store 只负责把
 * 结果翻成文案并落库 / 落会话状态），所以能单测。
 *
 * 模型是「两次点击成一对」：
 *   1. 点空线 → `start`：起一个**待定起点**（只在内存里、**不写 meta**；切工具 / 退编辑 / 下一次点击
 *      不合法都会把它丢掉）；
 *   2. 有待定起点时再点一条：
 *      · 在起点**之前**（或同一条线）→ `not-after-pending`，待定起点作废；
 *      · 与已有反复区间**重叠**（含把它整个包住）→ `overlap`，待定起点作废 —— **不允许嵌套**；
 *      · 合法 → `complete`，两条线**这时才一起写进 meta**，成为一对反复；
 *   3. 已成对的区间再被点到 → `house1`（房子起点；**一对只能有一个**，已经有了就 `house1-move` ——
 *      把那条已有的标记**搬到这一笔落点**上，不新增也不拒绝）；落在所有区间之外 → 又回到第 1 步。
 *
 * 还有两个前提：这条线后面得有小节（曲末那条线不行，`no-measure`）；**这条线不能是行末那条**
 * （`row-end` —— 行末线只收「反复结束」，见 `isRowEndBar`）—— 注意这道判定排在**待定起点那一段之后**，
 * 所以带着待定起点点行末线照样成对（那一笔就是结束线）。「点已有的标记 = 删」由上层先判
 * （`delete` 不在本函数里 —— 它看的是线上的标记，不是落点）。
 *
 * 返回 `{ type, ... }`：`start` / `complete`（带 `startBarId`）/ `house1` /
 * `house1-move`（带 `fromBarId` = 那条已有房子标记现在挂在哪条线上）/ `{ type: 'reject', reason }`。
 */
export function decideRepeatTap(barId, { structure, total, repeats = [], pendingBarId = null } = {}) {
  const no = structure.barStartMeasure.get(barId)
  if (!Number.isFinite(no) || no < 1 || no > total) return { type: 'reject', reason: 'no-measure' }
  const at = (id) => structure.barStartMeasure.get(id)
  // 已成对的区间：[起点线之后], [结束线] —— 结束线本身也算区间的一部分（它标的是区间里最后一小节的收尾）
  const spans = matchRepeatBlocks(repeats)
    .filter((p) => p.end)
    .map((p) => ({ startBarId: p.start.barId, endBarId: p.end.barId, from: at(p.start.barId), to: at(p.end.barId) }))
    .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && s.to >= s.from)

  if (pendingBarId != null) {
    const from = at(pendingBarId)
    if (!Number.isFinite(from) || no <= from) return { type: 'reject', reason: 'not-after-pending' }
    // **区间不许重叠** —— 等价于「不能嵌套」，顺带挡住交叉与「把老的一段整个包住」
    if (spans.some((s) => from < s.to && no > s.from)) return { type: 'reject', reason: 'overlap' }
    return { type: 'complete', startBarId: pendingBarId }
  }

  // 行末线只收「反复结束」：没有待定起点配对的那些落点非起点即房子起点，一律拒绝（见 `isRowEndBar`）
  if (isRowEndBar(structure, barId)) return { type: 'reject', reason: 'row-end' }

  const span = spans.find((s) => no > s.from && no < s.to)
  if (span) {
    // 这一块里已经有房子起点 → **把它搬到这一笔落点上**（一对只能有一个，所以不是新增、也不是拒绝）
    const exists = repeats.find((r) => r.kind === 'house1' && at(r.barId) > span.from && at(r.barId) < span.to)
    return exists ? { type: 'house1-move', fromBarId: exists.barId } : { type: 'house1' }
  }
  return { type: 'start' }
}

/**
 * 反复展开：把谱面顺序变成**实际演奏顺序**。**一对反复最多两遍**（`passes` 一律按 2 算），
 * 分成**有房子**和**没房子**两种情形 —— 差别就在第二遍：
 *
 *   · **没房子**：两遍走的都是整段 —— `‖: 1 2 3 4 :‖ 5 6` → `1 2 3 4 | 1 2 3 4 | 5 6`；
 *   · **有房子**（这段反复里点了一条「房子 1 起点」，设它落在第 3 小节）：
 *     房子那段**只有第一遍会走**，第二遍**碰到房子起点就直接跳到反复结尾之后**：
 *     `‖: 1 2 [3 4] :‖ 5 6` → `1 2 3 4 | 1 2 5 6`（第二遍的 5 就是「结束线之后那一小节」）。
 *
 * 返回 `{ no, jumpTo }` 数组：`jumpTo = true` 的那一项是**跳跃的落点**——即它前面那一项到它
 * 之间发生了一次「跳」（终点跳回起点、或碰到房子起点跳到反复结尾之后），界面拿它来闪一下目标小节。
 * 跳跃只可能是**往回跳或跳过几小节**，所以落点的小节号一定不在上一项之后紧挨着。
 *
 * 配对规则见 `matchRepeatBlocks`（`end` 配给左边最近的未配对 `start`）；没有 `end` 的 `start` 不成区块。
 * `backToMeasure` 仍然认（老数据 / 外部 JSON 里可能写着），没有就用**左边最近的反复开始**所在小节。
 */
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
      const endMeasure = Math.min(total, Math.max(1, endBarAt - 1)) // 反复结束线之前的小节
      const back = Number.isFinite(p.end.backToMeasure) ? p.end.backToMeasure : startAt
      return { idx, startMeasure: Math.min(Math.max(1, back), endMeasure), endMeasure }
    })
    .filter(Boolean)

  // 房子：只认 `house1`，且必须**严格落在某段反复内部**（界面只允许这么放）
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
  let jumpTo = false // 这一项是不是「跳过来的落点」（终点跳回起点 / 房子跳转）
  let guard = 0
  const limit = Math.max(64, total * 32)
  while (i >= 1 && i <= total && guard++ < limit) {
    const houseBlock = houseAt.get(i)
    // 走到房子起点的**第二遍**（`passDone` 已经记过一次了）→ 跳到反复结尾之后，房子那段整个跳过
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

/** 演奏顺序 = 小节 1 → 末小节，一条直线。**反复记号不参与** —— 见文件头第 3 条 */
export function playOrder(total) {
  const order = []
  for (let m = 1; m <= total; m++) order.push(m)
  return order
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
 *   · **`timeToPos`（播放走到哪）** 走**展开后**的顺序 —— 反复、房子都算数，同一个小节会出现多次；
 *   · **`posToTime`（点小节跳到哪一秒）** 只认**第一次出现** —— 手动跳转「视作还没反复过」：
 *     不管现在播到反复前还是反复后，都从那一小节的第一遍接着走，后面的反复该走还是会走。
 *
 * 起点：`startOffset` 是 `startPosition` 小节的时间。无弱起（startPosition = 1）时它就是第 1 小节的时间；
 * 有弱起（startPosition = 2）时第 1 小节要落在它**之前**一个弱起小节的时长，所以初始时间先往前推。
 * 推出来的时间可以是负数（音频开始前就开始数），播放入口自己会夹到 0。
 */
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
        /** 这一小节是「跳过来的」（见 `expandRepeats`）—— 跳转闪一下目标小节就读它 */
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
     * 反复区块（配对 + 房子跨度）。**它不是「又一份派生数据」**：`order` 就是按它展开出来的，
     * 谱面画房子括号、反复工具的落点判定与删除范围也都读它 —— 一处算、多处用。
     */
    blocks: deriveRepeatBlocks(meta, structure, total),
    duration,
    audioDuration: Number(meta.audio?.duration) || null,
    startOffset: Number(meta.audio?.startOffset) || 0,
    /**
     * 小节 → 时间。反复会让同一个小节出现好几遍，所以 `nearTime` 决定取哪一遍：
     *   · **不传 `nearTime`（手动跳转、跳段落、点小节）→ 取第一次出现** —— 用户明确要求手动跳转
     *     「视作还没反复过」：不管现在播到反复前还是反复后，都从那一小节的第一遍接着走；
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
