/**
 * 纯逻辑自测（不依赖浏览器）：
 *   node scripts/unit-test.mjs
 * 覆盖结构推导、调速时间轴、小节/时间换算、反复与房子 1/2 展开、时间锚点、pmz/zip 打包
 */
import { comparePosition, createMeta, defaultRepeat, defaultSegment, fitBeat, fitMeasure, positionBeat, positionMeasure, uid } from '../src/domain/schema.js'
import { buildTimeline, decideRepeatTap, deriveRepeatBlocks, deriveStructure, expandRepeats, isRowEndBar, matchRepeatBlocks, resolveSegments, segmentStartMeasure } from '../src/domain/timeline.js'
import { OutputClock } from '../src/domain/audio-engine.js'
import { buildScoreArchive, classifyFiles, fileStamp, isZipFile, packArchives, readZip } from '../src/domain/zip.js'
import { clampToPage, containingSystem, overlapSystem, splitSystemBounds } from '../src/domain/rows.js'
import { closeRowEnds, findBars, findStaves, groupSystems } from '../src/domain/omr.js'
import { buildMarkTree } from '../src/domain/marks.js'
import { strToU8, zipSync } from 'fflate'

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}${detail ? `  — ${detail}` : ''}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`)
  }
}

function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps
}

/** `expandRepeats` 的演奏顺序是 `{ no, jumpTo }`，测试里基本只关心小节号 */
function nos(list) {
  return (list || []).map((x) => x.no).join(',')
}

/** 造一份 N 行、每行 M 小节、每小节 B 个标记的乐谱 */
function makeScore({ systems = 2, barsPerSystem = 5, pageHeight = 842, pageWidth = 595 } = {}) {
  const meta = createMeta({ title: 'test' })
  const page = { width: pageWidth, height: pageHeight, systems: [] }
  for (let s = 0; s < systems; s++) {
    const y0 = 700 - s * 120
    const bars = []
    for (let b = 0; b < barsPerSystem; b++) bars.push({ id: uid('br'), x: 72 + b * 100 })
    page.systems.push({ id: uid('sy'), y0, y1: y0 + 40, bars })
  }
  meta.pages = [page]
  return meta
}

console.log('\n[1] 结构与小节编号')
{
  const meta = makeScore({ systems: 2, barsPerSystem: 5 })
  const st = deriveStructure(meta)
  ok('每行 n 条小节线 = n-1 个小节', st.count === 8, `${st.count} 小节`)
  ok('第一行的小节在前', st.measures[0].sys === 0 && st.measures[4].sys === 1)
  ok('阅读顺序自上而下', st.systems[0].y0 > st.systems[1].y0, `${st.systems[0].y0} > ${st.systems[1].y0}`)
  const firstBar = meta.pages[0].systems[0].bars[0].id
  ok('小节线 → 起始小节号', st.barStartMeasure.get(firstBar) === 1, String(st.barStartMeasure.get(firstBar)))
  const lastBarSys0 = meta.pages[0].systems[0].bars[4].id
  ok('行末小节线指向下一行第一小节', st.barStartMeasure.get(lastBarSys0) === 5, String(st.barStartMeasure.get(lastBarSys0)))
  ok('末行末线指向全部之后', st.barStartMeasure.get(meta.pages[0].systems[1].bars[4].id) === 9)
  ok('首小节点击区向左外扩', st.measures[0].hitX0 < st.measures[0].x0, `${st.measures[0].hitX0} < ${st.measures[0].x0}`)
  ok('末小节点击区向右外扩', st.measures[3].hitX1 > st.measures[3].x1)
  // 「开头」段落：编辑模式里谱面上也有一条标记线（`ScorePage`），落点固定在第 1 小节 ——
  // 它的位置被按死在 1（`ensureHeadSegment` / `updateSegment`），这里连「被改坏了」也要兜住。
  const head = meta.segments.find((s) => s.head)
  ok('「开头」段落固定落在第 1 小节', segmentStartMeasure(st, head)?.no === 1, JSON.stringify(segmentStartMeasure(st, head)?.no))
  ok('「开头」段落的小节号被改坏了也照样算第 1 小节', segmentStartMeasure(st, { ...head, measure: 7, beat: 4 })?.no === 1)
  const noMeasure = deriveStructure(makeScore({ systems: 1, barsPerSystem: 1 }))
  ok('全谱还没有小节时「开头」段落没有落点（谱面上整条不画）', noMeasure.count === 0 && segmentStartMeasure(noMeasure, head) === null)
}

console.log('\n[2] 调速时间轴')
{
  const meta = makeScore()
  const sys0 = meta.pages[0].systems[0]
  const sys1 = meta.pages[0].systems[1]
  meta.segments = [
    defaultSegment({ barId: sys0.bars[0].id, bpm: 120, beatsPerBar: 4, beatUnit: 4, measure: 1, beat: 1 }),
    defaultSegment({ barId: sys1.bars[0].id, bpm: 60, beatsPerBar: 4, beatUnit: 4, measure: 5, beat: 1 }),
  ]
  const tl = buildTimeline(meta)
  ok(
    '段落位置自动取自小节线',
    tl.segments[0].measure === 1 && tl.segments[0].beat === 1 && tl.segments[1].measure === 5 && tl.segments[1].beat === 1,
    JSON.stringify(tl.segments.map((s) => [s.measure, s.beat]))
  )
  ok('前 4 小节 @120BPM = 2s/小节', near(tl.posToTime(2) - tl.posToTime(1), 2), `${(tl.posToTime(2) - tl.posToTime(1)).toFixed(3)}s`)
  ok('第 5 小节起 @60BPM = 4s/小节', near(tl.posToTime(6) - tl.posToTime(5), 4), `${(tl.posToTime(6) - tl.posToTime(5)).toFixed(3)}s`)
  ok('总时长正确', near(tl.duration, 4 * 2 + 4 * 4), `${tl.duration}s`)
  ok('小节时长 = 整小节（不是一拍）', near(tl.measureDuration(2), 2), `${tl.measureDuration(2)}s`)
  ok('末小节时长正确', near(tl.measureDuration(8), 4), `${tl.measureDuration(8)}s`)
}

console.log('\n[3] 小节位置与拍')
{
  const meta = makeScore()
  meta.segments = [defaultSegment({ barId: meta.pages[0].systems[0].bars[0].id, bpm: 120, beatsPerBar: 4, beatUnit: 4, measure: 1, beat: 1 })]
  const tl = buildTimeline(meta)
  const t1 = tl.posToTime(1)
  const t4 = tl.posToTime(4)
  ok('第 4 小节起点 = 6s', near(t4 - t1, 6), `+${(t4 - t1).toFixed(3)}s`)
  ok('第 4 小节第 3 拍 = 第 4 小节起点 + 2 拍', near(tl.posToTime(4, null, 2) - t4, 1.0), `+${(tl.posToTime(4, null, 2) - t4).toFixed(3)}s`)
  const samples = tl.samples.filter((s) => s.no === 4).map((s) => s.time - t4)
  ok('小节内逐拍采样', JSON.stringify(samples.map((x) => +x.toFixed(3))) === JSON.stringify([0, 0.5, 1, 1.5]), JSON.stringify(samples.map((x) => +x.toFixed(3))))
  const mid = tl.timeToPos(t4 + 1.25)
  ok('时间 → 小节/拍（含小数拍）', mid.no === 4 && near(mid.beat, 3.5, 1e-6), `小节 ${mid.no} 拍 ${mid.beat}`)
  ok('定位小节永远落在小节起点（不是最近的拍）', near(tl.posToTime(1, 1.9), t1), `${tl.posToTime(1, 1.9)} vs ${t1}`)
  ok('定位小节：取离当前时间最近的那一遍', near(tl.posToTime(4, 6.4), t4), `${tl.posToTime(4, 6.4)}`)
}

console.log('\n[4] 3/4 拍与 6/8 拍')
{
  const meta = makeScore()
  meta.segments = [defaultSegment({ barId: meta.pages[0].systems[0].bars[0].id, bpm: 90, beatsPerBar: 3, beatUnit: 4, measure: 1, beat: 1 })]
  const tl = buildTimeline(meta)
  ok('3/4 每小节 3 拍', tl.samples.filter((s) => s.no === 1).length === 3)
  ok('3/4 @90BPM 小节 = 2s', near(tl.measureDuration(1), 2), `${tl.measureDuration(1)}s`)

  const meta2 = makeScore()
  meta2.segments = [defaultSegment({ barId: meta2.pages[0].systems[0].bars[0].id, bpm: 120, beatsPerBar: 6, beatUnit: 8, measure: 1, beat: 1 })]
  const tl2 = buildTimeline(meta2)
  ok('6/8 每小节 6 拍（八分音符为一拍）', tl2.samples.filter((s) => s.no === 1).length === 6)
  ok('6/8 @120BPM 小节 = 1.5s', near(tl2.measureDuration(1), 1.5), `${tl2.measureDuration(1)}s`)
}

console.log('\n[5] 音频起点偏移与时间锚点')
{
  const meta = makeScore()
  meta.audio.startOffset = 3.5
  meta.segments = [defaultSegment({ barId: meta.pages[0].systems[0].bars[0].id, bpm: 120, measure: 1, beat: 1 })]
  let tl = buildTimeline(meta)
  ok('起点偏移生效（第 1 小节 = 3.5s）', near(tl.posToTime(1), 3.5), `${tl.posToTime(1)}s`)

  const seg = defaultSegment({ barId: meta.pages[0].systems[1].bars[0].id, bpm: 120, measure: 5, beat: 1, time: 30 })
  meta.segments.push(seg)
  tl = buildTimeline(meta)
  ok('段落时间锚点覆盖累计误差', near(tl.posToTime(5), 30), `${tl.posToTime(5)}s`)
  ok('锚点之后按 BPM 继续推进', near(tl.posToTime(6), 32), `${tl.posToTime(6)}s`)

  // 弱起小节：startPosition = 2 → 音频起点是**第 2 小节**的时间，第 1 小节落在它之前
  const pickup = makeScore()
  pickup.audio.startOffset = 3.5
  pickup.audio.startPosition = 2
  pickup.segments = [defaultSegment({ barId: pickup.pages[0].systems[0].bars[0].id, bpm: 120, measure: 1, beat: 1 })]
  let tlPickup = buildTimeline(pickup)
  ok('弱起：第 2 小节对齐音频起点', near(tlPickup.posToTime(2), 3.5), `${tlPickup.posToTime(2)}s`)
  ok('弱起：第 1 小节提前一个整小节', near(tlPickup.posToTime(1), 1.5), `${tlPickup.posToTime(1)}s`)

  // 提前量 = 弱起小节自己的拍数（这里把第 1 小节标成 1 拍 → 只提前 0.5s）
  pickup.segments = [defaultSegment({ barId: pickup.pages[0].systems[0].bars[0].id, bpm: 120, beatsPerBar: 1, measure: 1, beat: 1 })]
  tlPickup = buildTimeline(pickup)
  ok('弱起：提前量按弱起小节的拍数算', near(tlPickup.posToTime(1), 3.0), `${tlPickup.posToTime(1)}s`)

  // 没有弱起（默认 startPosition = 1）时行为不变
  const plain = makeScore()
  plain.audio.startOffset = 3.5
  plain.segments = [defaultSegment({ barId: plain.pages[0].systems[0].bars[0].id, bpm: 120, measure: 1, beat: 1 })]
  ok('无弱起：第 1 小节就是起点', near(buildTimeline(plain).posToTime(1), 3.5))
}

console.log('\n[6] 反复与房子 1 / 房子 2')
{
  const meta = makeScore({ systems: 2, barsPerSystem: 5 }) // 8 小节
  const bars0 = meta.pages[0].systems[0].bars
  const bars1 = meta.pages[0].systems[1].bars
  meta.segments = [defaultSegment({ barId: bars0[0].id, bpm: 120, beatsPerBar: 4, beatUnit: 4, measure: 1, beat: 1 })]

  // 配对的两条线 = 一对反复；**没房子**时两遍走的是同一段
  meta.repeats = [
    defaultRepeat({ kind: 'start', barId: bars0[0].id }),
    defaultRepeat({ kind: 'end', barId: bars0[2].id }),
  ]
  let st = deriveStructure(meta)
  let order = expandRepeats(meta, st, st.count)
  ok('没房子：两遍一模一样 1 2 | 1 2 | 3 …', nos(order.slice(0, 6)) === '1,2,1,2,3,4', nos(order))
  ok('反复总长度 = 原长度 + 反复段', order.length === st.count + 2, `${order.length} vs ${st.count}`)
  ok('往回跳的那一项带 jumpTo', order[2].jumpTo === true && order[2].no === 1, JSON.stringify(order.slice(0, 4)))

  // 只支持两遍：数据里写 3 也按 2 走（`passes` 已不是可调项）
  meta.repeats[1].passes = 3
  order = expandRepeats(meta, deriveStructure(meta), st.count)
  ok('写 3 遍也按 2 遍走', nos(order.slice(0, 6)) === '1,2,1,2,3,4', nos(order))

  // ‖: 1 2 [房子1: 3] :‖ 4 5 …
  // 有房子：第一遍走完整段 1 2 3，第二遍走到房子起点(3)就跳到结束线之后
  meta.repeats = [
    defaultRepeat({ kind: 'start', barId: bars0[0].id }),
    defaultRepeat({ kind: 'end', barId: bars0[3].id }),
    defaultRepeat({ kind: 'house1', barId: bars0[2].id }),
  ]
  order = expandRepeats(meta, deriveStructure(meta), st.count)
  ok('有房子：1 2 3 | 1 2 | 4 …', nos(order) === '1,2,3,1,2,4,5,6,7,8', nos(order))
  ok('房子跳转的落点（第 4 小节）带 jumpTo', order.find((x) => x.no === 4)?.jumpTo === true)
  const tl = buildTimeline(meta)
  ok('反复后时间轴长度 = 演奏顺序 × 小节', tl.samples.length === order.length * 4, `${tl.samples.length} 拍`)
  // 手动跳转认第一次出现；传了 nearTime 才按「离它最近的那一遍」取
  ok('手动跳第 1 小节 = 第一遍', tl.posToTime(1) === tl.posToTime(1, 0))
  ok('带 nearTime 时会取第二遍', tl.posToTime(1, 99) !== tl.posToTime(1), `${tl.posToTime(1, 99)} vs ${tl.posToTime(1)}`)
}

console.log('\n[7] 反复标记：两次点击成对 / 房子 / 房子括号')
{
  /**
   * 用户要的模型（`decideRepeatTap` / `deriveRepeatBlocks`）：
   *   · **两次点击成一对**：第一次只记待定起点（不写 meta），第二次合法才把两条线一起写进去；
   *   · 第二次在起点左边 / 同一条线 → 作废；与已有反复**重叠** → 作废（不能嵌套）；
   *   · 已成对的区间里再点 → 房子起点（一对只能有一个：还没有就加上，已经有了就把那条**搬过去**）；
   *     区间外再点 → 又是待定起点；
   *   · **行末那条小节线只收「反复结束」**：没待定起点时点它 → `row-end`（起点 / 房子起点都不行），
   *     带着待定起点点它 → 正常成对（那一笔就是结束线）；
   *   · 房子 1 括号 = 起点线 → 结束线；房子 2 括号 = 第二遍接着走的那一小节（只画一个小节）。
   */
  // 一行 11 条线 = 10 小节，**标记全落在同一行**，跟用户在一行里连点完全一样
  const meta = makeScore({ systems: 1, barsPerSystem: 11 })
  const bars0 = meta.pages[0].systems[0].bars // 第 i 条线 → 之后的小节 i+1
  const st = deriveStructure(meta)
  const total = st.count // 10

  // 模拟 `store/player.js` 的点击流程：待定起点在会话里，只有 complete 才写 meta
  let pending = null
  const tap = (barId) => {
    const d = decideRepeatTap(barId, { structure: st, total, repeats: meta.repeats, pendingBarId: pending })
    if (d.type === 'start') pending = barId
    else if (d.type === 'complete') {
      meta.repeats.push(defaultRepeat({ barId: d.startBarId, kind: 'start' }))
      meta.repeats.push(defaultRepeat({ barId, kind: 'end' }))
      pending = null
    } else if (d.type === 'house1') {
      meta.repeats.push(defaultRepeat({ barId, kind: 'house1' }))
      pending = null
    } else if (d.type === 'house1-move') {
      const mark = meta.repeats.find((r) => r.barId === d.fromBarId && r.kind === 'house1')
      if (mark) mark.barId = barId
      pending = null
    } else pending = null // reject：起点作废
    return d
  }
  const tapAt = (barId) => decideRepeatTap(barId, { structure: st, total, repeats: meta.repeats, pendingBarId: pending })
  meta.repeats = []
  ok('第一次点 → 待定起点（meta 里什么都没有）', tap(bars0[0].id).type === 'start' && meta.repeats.length === 0)
  // 有待定起点时，点它左边那条 / 点它自己 → 都作废，而且一条也不写进 meta
  ok('起点左边那条 → 作废', decideRepeatTap(bars0[0].id, { structure: st, total, repeats: meta.repeats, pendingBarId: bars0[4].id }).reason === 'not-after-pending')
  ok('点同一条线 → 作废', decideRepeatTap(bars0[0].id, { structure: st, total, repeats: meta.repeats, pendingBarId: bars0[0].id }).reason === 'not-after-pending')
  ok('两次作废都没有写进 meta', meta.repeats.length === 0)

  // 正式来一遍：第 1 条线 → 第 8 条线 = 一对反复（区间 1..7 小节）
  pending = null
  ok('再点第一条线 → 又是待定起点', tap(bars0[0].id).type === 'start')
  ok('第二次点第 8 条线 → 成对，两条线一起写进 meta', tap(bars0[7].id).type === 'complete' && meta.repeats.length === 2)
  ok('成对的区间 = 第 1 条线 → 第 8 条线（1..7 小节）', (() => {
    const b = matchRepeatBlocks(meta.repeats).filter((p) => p.end)
    return b.length === 1 && b[0].start.barId === bars0[0].id && b[0].end.barId === bars0[7].id
  })())

  // 区间**内部**再点 → 房子起点（一对只能有一个）
  ok('对里再点一条 → 房子起点', tap(bars0[5].id).type === 'house1' && meta.repeats.length === 3)
  ok('区间**外面**再点 → 又是待定起点', tap(bars0[9].id).type === 'start' && meta.repeats.length === 3)
  // 待定起点在已有区间**内部**（第 3 条线 = 小节 3），结束线在区间外（第 10 条线）→ [3,10] 压住 [1,8]
  ok('与已有反复重叠 → 作废（不许嵌套）', decideRepeatTap(bars0[9].id, { structure: st, total, repeats: meta.repeats, pendingBarId: bars0[2].id }).reason === 'overlap')
  // 区间套区间：待定起点落在被占区间**内部**（第 2 条线，小节 2），结束线在区间里 → 重叠
  ok('区间套区间也算重叠（不许嵌套）', decideRepeatTap(bars0[2].id, { structure: st, total, repeats: meta.repeats, pendingBarId: bars0[1].id }).reason === 'overlap')

  // 房子括号与展开顺序
  const blocks = deriveRepeatBlocks(meta, st, total)
  const house = (i) => blocks[0].houses.find((h) => h.index === i)
  ok('房子 1 括号 = 起点线 → 结束线（6..7 小节）', house(1)?.startMeasure === 6 && house(1)?.endMeasure === 7, JSON.stringify(house(1)))
  ok('房子 2 括号 = 第二遍落地那一小节，只画一个小节', house(2)?.startMeasure === 8 && house(2)?.endMeasure === 8, JSON.stringify(house(2)))
  const order = expandRepeats(meta, st, total)
  ok('有房子：1-7 走一遍，第二遍碰到房子起点跳到结束线之后', nos(order) === '1,2,3,4,5,6,7,1,2,3,4,5,8,9,10', nos(order))
  ok('跳跃落点是第 8 小节，带 jumpTo', order.find((x) => x.no === 8)?.jumpTo === true)

  // 删掉房子起点 → 没了跳跃，两遍走一样的内容；**没有房子 1 起点就不该推房子 2**（用户要求）
  const afterHouseDelete = meta.repeats.filter((r) => r.barId !== bars0[5].id)
  ok('删房子起点后，反复本身还在', afterHouseDelete.length === 2)
  ok('没房子 1 起点：两遍一模一样，且不推房子 2', (() => {
    const save = meta.repeats
    meta.repeats = afterHouseDelete
    const st2 = deriveStructure(meta)
    const o = expandRepeats(meta, st2, total)
    const b = deriveRepeatBlocks(meta, st2, total)[0]
    meta.repeats = save
    return nos(o) === '1,2,3,4,5,6,7,1,2,3,4,5,6,7,8,9,10' && b.houses.length === 0
  })())

  // **这一段已经有房子起点 → 再点对里别处 = 把它搬过去**（一对里始终只有一个房子起点）
  {
    pending = null // 上一笔「区间外面」留下的待定起点已经在切工具时丢掉了
    const moved = tapAt(bars0[3].id)
    ok('已有房子时再点对里别处 → 返回搬家（带上那条现在挂在哪）', moved.type === 'house1-move' && moved.fromBarId === bars0[5].id, JSON.stringify(moved))
    tap(bars0[3].id)
    const houses = meta.repeats.filter((r) => r.kind === 'house1')
    ok('搬家不新增标记（还是一对反复 + 一个房子）', meta.repeats.length === 3 && houses.length === 1 && houses[0].barId === bars0[3].id)
    const b2 = deriveRepeatBlocks(meta, st, total)[0]
    const o2 = expandRepeats(meta, st, total)
    ok('房子 1 括号跟着搬到新落点（4..7 小节）', b2.houses.find((h) => h.index === 1)?.startMeasure === 4, JSON.stringify(b2.houses[0]))
    ok('展开顺序按新落点走：第 4 小节起跳', nos(o2) === '1,2,3,4,5,6,7,1,2,3,8,9,10', nos(o2))
    tap(bars0[5].id) // 搬回去，后面的删整段断言按原来那条线算
    ok('搬回原处后括号回到 6..7 小节', deriveRepeatBlocks(meta, st, total)[0].houses[0]?.startMeasure === 6)
  }

  // 删整段：配对的两条 + 区间里的房子一起走
  const doomed = new Set([blocks[0].startBarId, blocks[0].endBarId, ...blocks[0].houseMarks.map((m) => m.barId)])
  ok('删整段反复会连房子一起删', meta.repeats.filter((r) => !doomed.has(r.barId)).length === 0)

  ok('曲末那条线（后面没有小节）拒绝落点', decideRepeatTap(bars0[10].id, { structure: st, total, repeats: [], pendingBarId: bars0[0].id }).reason === 'no-measure')

  // **行末那条小节线只允许反复结束标记**：另换一份两行的谱 —— 行末线与下一行行首线在
  // `barStartMeasure` 里是**同一个小节**，所以「起点 / 房子起点改点下一行行首」这个小节号一点不变
  {
    const m2 = makeScore({ systems: 2, barsPerSystem: 5 })
    const [row0, row1] = m2.pages[0].systems.map((s) => s.bars)
    const st2 = deriveStructure(m2)
    const total2 = st2.count // 8（每行 4 个小节）
    ok('行末线与下一行行首线是同一个小节', st2.barStartMeasure.get(row0[4].id) === st2.barStartMeasure.get(row1[0].id), `第 ${st2.barStartMeasure.get(row0[4].id)} 小节`)
    ok('isRowEndBar：行末那条是、行内别处不是', isRowEndBar(st2, row0[4].id) === true && isRowEndBar(st2, row0[3].id) === false)
    ok('行末线上起不了反复起点', decideRepeatTap(row0[4].id, { structure: st2, total: total2, repeats: [] }).reason === 'row-end')
    ok('行首那条线没有对称限制（照样起起点）', decideRepeatTap(row1[0].id, { structure: st2, total: total2, repeats: [] }).type === 'start')
    ok('带着待定起点点行末线 → 正常成对（那一笔是结束线）', decideRepeatTap(row0[4].id, { structure: st2, total: total2, repeats: [], pendingBarId: row0[0].id }).type === 'complete')
    // 行末线落在一段已有反复**内部**时也按行末线拒绝（不是「房子起点」）
    const inBlock = [defaultRepeat({ kind: 'start', barId: row0[1].id }), defaultRepeat({ kind: 'end', barId: row1[2].id })]
    ok('行末线上落不下房子起点（区间内部也一样）', decideRepeatTap(row0[4].id, { structure: st2, total: total2, repeats: inBlock }).reason === 'row-end')
    // 「后面没有小节」排在前面：曲末那条线照样报 no-measure（它同时也是行末线）
    ok('曲末那条线先被「后面没有小节」挡住', decideRepeatTap(row1[4].id, { structure: st2, total: total2, repeats: [] }).reason === 'no-measure')
  }
}

console.log('\n[8] 反复回到指定小节（外部 JSON 里的 backToMeasure）')
{
  const meta = makeScore({ systems: 2, barsPerSystem: 5 })
  const bars0 = meta.pages[0].systems[0].bars
  meta.repeats = [
    defaultRepeat({ kind: 'start', barId: bars0[0].id }),
    defaultRepeat({ kind: 'end', barId: bars0[2].id, backToMeasure: 2 }),
  ]
  const st = deriveStructure(meta)
  ok('指定回到第 2 小节 → 第 2 小节演奏两遍', nos(expandRepeats(meta, st, st.count).slice(0, 5)) === '1,2,2,3,4')
  meta.repeats[1].backToMeasure = null
  ok('不写 backToMeasure → 回到反复开始那一条线', nos(expandRepeats(meta, deriveStructure(meta), st.count).slice(0, 5)) === '1,2,1,2,3')
}

console.log('\n[8] 边界情况')
{
  const empty = createMeta({})
  const tl = buildTimeline(empty)
  ok('空乐谱不报错', tl.samples.length === 0 && tl.total === 0)
  ok('空乐谱 posToTime 返回起点', tl.posToTime(1) === 0)

  const one = makeScore({ systems: 1, barsPerSystem: 2 })
  const st = deriveStructure(one)
  ok('一行两条线 = 1 小节', st.count === 1, `${st.count}`)

  const none = makeScore({ systems: 1, barsPerSystem: 1 })
  ok('只有一条线 = 0 小节', deriveStructure(none).count === 0)

  const meta = makeScore()
  meta.segments = [defaultSegment({ barId: meta.pages[0].systems[0].bars[0].id, measure: 999, beat: 1 })]
  const tl2 = buildTimeline(meta)
  ok('越界的段落小节号被夹到曲末之后', tl2.segments[0].measure === tl2.total + 1, `${tl2.segments[0].measure} vs ${tl2.total + 1}`)
  ok('时间轴仍单调递增', tl2.samples.every((s, i) => i === 0 || s.time >= tl2.samples[i - 1].time))
}

console.log('\n[9] 固定的「开头」段落')
{
  const empty = createMeta({})
  const heads = empty.segments.filter((s) => s.head)
  ok('新建乐谱自带一个开头段落', heads.length === 1 && empty.segments.length === 1)
  ok(
    '开头段落是 120 BPM 4/4、第 1 小节第 1 拍、没有名字',
    heads[0].name === '' && heads[0].bpm === 120 && heads[0].beatsPerBar === 4 && heads[0].beatUnit === 4 && heads[0].measure === 1 && heads[0].beat === 1,
    JSON.stringify(heads[0])
  )
  ok('开头段落的时间轴默认也是 120/4-4', near(buildTimeline(empty).measureDuration(1), 2), `${buildTimeline(empty).measureDuration(1)}s`)

  const again = createMeta(JSON.parse(JSON.stringify(empty)))
  ok('反复规整不会产生第二个开头', again.segments.filter((s) => s.head).length === 1 && again.segments.length === 1)

  // 不做旧数据兼容：已有段落落在开头也照样补一条「开头」
  const imported = createMeta({ segments: [{ barId: null, measure: 1, beat: 3, name: 'A 段', bpm: 90 }] })
  ok(
    '已有段落落在开头也照样补一条「开头」，原有段落保持不变',
    imported.segments.length === 2 &&
      imported.segments[0].head &&
      imported.segments[0].bpm === 120 &&
      imported.segments[1].name === 'A 段' &&
      imported.segments[1].bpm === 90 &&
      imported.segments[1].measure === 1 &&
      imported.segments[1].beat === 3,
    JSON.stringify(imported.segments.map((s) => [s.name, s.measure, s.beat, s.bpm, s.head]))
  )

  // 只有中间段落 → 补一个开头
  const mid = createMeta({ segments: [{ barId: null, measure: 5, beat: 1, name: 'B 段', bpm: 90 }] })
  ok(
    '只有中间段落时自动补开头',
    mid.segments.length === 2 && mid.segments[0].head && mid.segments[0].bpm === 120 && mid.segments[1].measure === 5,
    JSON.stringify(mid.segments.map((s) => [s.name, s.measure, s.beat, s.head]))
  )

  // 开头被挪走也会被按回第 1 小节
  const moved = createMeta({ segments: [{ barId: null, measure: 7, beat: 4, name: '开头', head: true, bpm: 100 }] })
  ok('head 始终被按回第 1 小节第 1 拍', moved.segments[0].measure === 1 && moved.segments[0].beat === 1, JSON.stringify(moved.segments[0]))

  // 手改 JSON 写出的越界拍号被夹进这一段落自己的拍号范围
  const wild = createMeta({ segments: [{ barId: null, measure: 4, beat: 9, beatsPerBar: 4, name: 'C 段' }] })
  ok('越界的拍号被夹进拍号范围', wild.segments[1].beat === 4 && wild.segments[1].measure === 4, JSON.stringify(wild.segments[1]))
}

console.log('\n[10] pmz / zip 打包与读取')
{
  const bytes = (...v) => new Uint8Array(v)
  const scoreItem = (title, { pdf = false, audio = false, peaks = null } = {}) => {
    const meta = createMeta({ title })
    meta.pages = [{ width: 595, height: 842, systems: [] }]
    return {
      title,
      meta,
      pdf: pdf ? new File([bytes(0x25, 0x50, 0x44, 0x46)], 'score.pdf', { type: 'application/pdf' }) : null,
      audio: audio ? new File([bytes(1, 2, 3, 4)], 'audio.mp3', { type: 'audio/mpeg' }) : null,
      peaks,
    }
  }

  // 单张：pmz 内容直接在根目录，读回来还是一张
  const coverBytes = bytes(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3)
  const coverUrl = `data:image/jpeg;base64,${Buffer.from(coverBytes).toString('base64')}`
  const one = await buildScoreArchive(scoreItem('小星星', { pdf: true, audio: true, peaks: new Float32Array([0, 1, -1, 1]) }))
  const back = await readZip(new File([await one.arrayBuffer()], '小星星.pmz'))
  ok('单个 pmz 读回一张乐谱', back.length === 1 && back[0].meta.title === '小星星', JSON.stringify(back.map((e) => e.meta?.title)))
  ok('pmz 里的 PDF 与音频都在', !!back[0].pdf && !!back[0].audio, `pdf=${!!back[0].pdf} audio=${!!back[0].audio}`)
  ok('峰值缓存一起读回', back[0].peaks?.length === 4, String(back[0].peaks?.length))

  // 自定义封面也要进 pmz（自动生成的缩略图不带，导入时按 PDF 重渲染）
  const withCover = await buildScoreArchive({ ...scoreItem('带封面', { pdf: true }), thumb: coverUrl })
  const coverBack = await readZip(new File([await withCover.arrayBuffer()], '带封面.pmz'))
  ok('自定义封面进包并能读回', coverBack[0].cover?.size === coverBytes.length, String(coverBack[0].cover?.size))
  const autoOnly = await buildScoreArchive({ ...scoreItem('无封面'), thumb: null })
  const autoBack = await readZip(new File([await autoOnly.arrayBuffer()], '无封面.pmz'))
  ok('没有自定义封面时不写 cover 条目', !autoBack[0].cover)

  // 多张：外层 zip，每张各是一个 .pmz（不能互相串味）
  const a = await buildScoreArchive(scoreItem('A', { pdf: true }))
  const b = await buildScoreArchive(scoreItem('B', { audio: true }))
  const outer = await packArchives([a, b], ['A', 'B'])
  const list = await readZip(new File([await outer.arrayBuffer()], '乐谱库-2张.zip'))
  ok('外层 zip 里嵌套的 pmz 各自成一张', list.length === 2, JSON.stringify(list.map((e) => e.meta?.title)))
  ok('两张乐谱的文件没有串味', list.filter((e) => e.pdf).length === 1 && list.filter((e) => e.audio).length === 1)
  ok('标题按顺序保留', list.map((e) => e.meta?.title).join(',') === 'A,B', list.map((e) => e.meta?.title).join(','))

  // 旧版格式：每张乐谱一个子目录的 zip 仍然能读
  const legacyBytes = zipSync({
    'A/score.json': strToU8(JSON.stringify(createMeta({ title: 'A' }))),
    'A/score.pdf': bytes(0x25, 0x50, 0x44, 0x46),
    'B/score.json': strToU8(JSON.stringify(createMeta({ title: 'B' }))),
  })
  const legacyBack = await readZip(new File([legacyBytes], 'old.zip'))
  ok('旧版「每张一个子目录」的 zip 仍可读', legacyBack.length === 2 && legacyBack.map((e) => e.meta?.title).join(',') === 'A,B', JSON.stringify(legacyBack.map((e) => e.meta?.title)))

  // 类型识别：pmz 当成容器，图片单独一类
  ok('.pmz 被认成压缩包', isZipFile(new File([bytes(1)], 'x.pmz')))
  const cls = classifyFiles([
    new File([bytes(1)], 'a.pdf', { type: 'application/pdf' }),
    new File([bytes(1)], 'b.pmz', { type: '' }),
    new File([bytes(1)], 'c.mp3', { type: 'audio/mpeg' }),
    new File([bytes(1)], 'd.json', { type: 'application/json' }),
    new File([bytes(1)], 'e.png', { type: 'image/png' }),
    new File([bytes(1)], 'f.txt', { type: 'text/plain' }),
  ])
  ok(
    '拖入的文件按类型分流正确',
    cls.pdfs.length === 1 && cls.archives.length === 1 && cls.audios.length === 1 && cls.jsons.length === 1 && cls.images.length === 1 && cls.unknown.length === 1,
    JSON.stringify(Object.entries(cls).map(([k, v]) => `${k}:${v.length}`))
  )
}

console.log('\n[10.1] 导出文件名里的时间戳')
{
  // 本地时间读数：1 月 2 日 03:04:05 → 010203-030405
  const d = new Date(2025, 0, 2, 3, 4, 5)
  ok('fileStamp 是 yyyymmdd-hhmmss 且按本地时间补零', fileStamp(d) === '20250102-030405', fileStamp(d))
  ok('fileStamp 不带时区 / 分隔符以外的字符', /^\d{8}-\d{6}$/.test(fileStamp()), fileStamp())
}

console.log('\n[11] 段落位置的「小节号 + 拍号」两个字段')
{
  ok('位置就是小节号与拍号两个整数', positionMeasure({ measure: 4, beat: 3 }) === 4 && positionBeat({ measure: 4, beat: 3 }) === 3)
  ok('没写位置时算第 1 小节第 1 拍', positionMeasure({}) === 1 && positionBeat({}) === 1, `${positionMeasure({})}/${positionBeat({})}`)
  ok('拍号支持第 10 拍以后（9/8、12/8）', fitBeat(11, 12) === 11, String(fitBeat(11, 12)))
  ok(
    '手改 JSON 的拍号被夹进拍号范围',
    fitBeat(50, 4) === 4 && fitBeat(0, 4) === 1 && fitBeat(1.4, 4) === 1,
    `${fitBeat(50, 4)} / ${fitBeat(0, 4)} / ${fitBeat(1.4, 4)}`
  )
  ok(
    '小节号只接受 ≥ 1 的整数',
    fitMeasure(0) === 1 && fitMeasure(3.4) === 3 && fitMeasure('abc') === 1,
    `${fitMeasure(0)} / ${fitMeasure(3.4)} / ${fitMeasure('abc')}`
  )
  ok(
    '位置比较先比小节号、再比拍号',
    comparePosition({ measure: 4, beat: 3 }, { measure: 5, beat: 1 }) < 0 &&
      comparePosition({ measure: 4, beat: 3 }, { measure: 4, beat: 4 }) < 0 &&
      comparePosition({ measure: 4, beat: 3 }, { measure: 4, beat: 3 }) === 0,
    String(comparePosition({ measure: 4, beat: 3 }, { measure: 4, beat: 4 }))
  )

  const meta = makeScore()
  meta.segments = [
    defaultSegment({ barId: meta.pages[0].systems[0].bars[0].id, bpm: 120, beatsPerBar: 4, beatUnit: 4, measure: 1, beat: 1 }),
    defaultSegment({ barId: null, bpm: 60, beatsPerBar: 4, beatUnit: 4, measure: 4, beat: 3 }),
  ]
  const tl = buildTimeline(meta)
  const t4 = tl.posToTime(4)
  const beatTimes = tl.samples.filter((s) => s.no === 4).map((s) => +(s.time - t4).toFixed(3))
  ok('第 4 小节第 3 拍的段落从那一拍起生效', JSON.stringify(beatTimes) === JSON.stringify([0, 0.5, 1, 2]), JSON.stringify(beatTimes))

  // 时间锚点落在第 4 小节第 3 拍：那一小节里从第 3 拍起按锚点的时间重排
  meta.segments[1].time = 10
  const tl2 = buildTimeline(meta)
  const times2 = tl2.samples.filter((s) => s.no === 4).map((s) => +s.time.toFixed(3))
  ok('时间锚点按拍对齐', JSON.stringify(times2) === JSON.stringify([6, 6.5, 10, 11]), JSON.stringify(times2))

  // 拍数改小之后越界的拍号被夹回来（`updateSegment` 走的就是 fitBeat）
  ok('拍数改小之后越界的拍号被夹回来', fitBeat(4, 3) === 3, String(fitBeat(4, 3)))
}

console.log('\n[12] 行不许重叠 / 不许太扁（domain/rows.js）')
{
  const row = (y0, y1, id = `${y0}-${y1}`) => ({ id, y0, y1 })
  /** 最小高度：测试里当成一档点击尺寸在某个缩放下的 pt 值 */
  const MIN = 46
  /** 用来当「一条高得能拆」的行的高度：160pt —— 下刀那条（≥MIN）加上上下各留 MIN，一共要 3 × MIN 出头 */
  const H = 160
  const big = row(600, 600 + H, 'big')
  /** 矮行：只有 40pt，比最小高度还矮 —— 拆出来的两半必定至少有一半不成立 */
  const low = row(450, 490, 'low')
  const rows = [big, low]

  ok('完全叠在已有行上 → 命中那条行', overlapSystem(rows, 610, 630, MIN)?.id === 'big')
  ok('只压住一角也算重叠', overlapSystem(rows, 630, 700, MIN)?.id === 'big')
  ok('落在两行之间的空档 → 不重叠', overlapSystem(rows, 500, 540, MIN) === null, String(overlapSystem(rows, 500, 540, MIN)))
  ok('端点正好贴住不算重叠（留 ROW_EPS 容差）', overlapSystem(rows, 490, 500, MIN) === null)
  ok('端点差在容差以外就算重叠', overlapSystem(rows, 489, 500, MIN)?.id === 'low')
  ok('把已有行整个包住也算重叠', overlapSystem(rows, 380, 660, MIN)?.id === 'big')
  ok('没有已标记的行时随便划', overlapSystem([], 100, 200, MIN) === null && overlapSystem(undefined, 100, 200, MIN) === null)
  // OMR 的 truth 是 y0 > y1（omr.js 末尾 toPt.y），判定两种写法都要成立
  ok('y0/y1 反着写的行照样判得出重叠', overlapSystem([row(600 + H, 600)], 610, 630, MIN) !== null)
  ok('传进来的区间反着写也能判', overlapSystem(rows, 630, 610, MIN)?.id === 'big')

  ok('夹取：超出页面的部分被切掉', JSON.stringify(clampToPage(700, 900, 842)) === JSON.stringify({ lo: 700, hi: 842 }), JSON.stringify(clampToPage(700, 900, 842)))
  ok('夹取：整条在页面外 → null', clampToPage(900, 950, 842) === null && clampToPage(-80, -10, 842) === null)
  ok('夹取：上下沿反着写先对调', JSON.stringify(clampToPage(648, 600, 842)) === JSON.stringify({ lo: 600, hi: 648 }))
  ok('夹取：零高度（几乎没拖动）→ null', clampToPage(500, 500, 842) === null)
  // 最小高度按当前缩放算好传进来（ScorePage 那边是 ROW_MIN_PX / scale）：不够高就落不下来
  ok('夹取：低于最小高度的一笔 → null', clampToPage(500, 545, 842, MIN) === null && clampToPage(500, 546, 842, MIN) !== null)
  ok('夹取：最小高度随缩放变（放大后 46pt 就够高）', clampToPage(500, 545, 842, 38) !== null)
  ok('夹取：页面数据里没有页高时不夹', JSON.stringify(clampToPage(600, 648, undefined)) === JSON.stringify({ lo: 600, hi: 648 }))
  ok('夹取：NaN → null', clampToPage(NaN, 648, 842) === null)
  // 夹取 + 判定是同一条链：拖到页外框住已有行的那一笔，靠夹取后的区间判出重叠
  const clipped = clampToPage(630, 900, 842)
  ok('先夹取再判定：拖到页外也躲不过重叠', overlapSystem(rows, clipped.lo, clipped.hi, MIN)?.id === 'big')

  // 整条套住 = 拆行（`containingSystem` + `splitSystemBounds`）：两端都在那条行内部、
  // **而且拆出来上下两半都不低于最小高度** 才算 —— 切掉的那条（b-a）加上剩下两半正好是行高，
  // 所以这三条约束一起挤，容得下「一条最小高度的行 + 上下各留最小高度」的行得高过 3 × MIN
  // 这条行 600…760：从 646 起、切 60pt 高的一刀（到 706），上剩 54、下剩 46 —— 正好都过线
  ok('两端都在行内 → 套住那条行', containingSystem(rows, 646, 706, MIN)?.id === 'big')
  ok('一端顶在行的边上 → 不算套住（那是重叠，仍旧拒绝）', containingSystem(rows, 600, 646, MIN) === null)
  ok('一端伸到行外 → 不算套住', containingSystem(rows, 610, 600 + H, MIN) === null)
  ok('把已有行整个包住不算套住（方向反了）', containingSystem(rows, 380, 660, MIN) === null)
  ok('落在空档里不算套住', containingSystem(rows, 500, 540, MIN) === null)
  ok('没有已标记的行时也不算套住', containingSystem([], 100, 200, MIN) === null && containingSystem(undefined, 100, 200, MIN) === null)
  ok('y0/y1 反着写的行照样判得出套住', containingSystem([row(600 + H, 600)], 646, 706, MIN) !== null)
  ok('传进来的区间反着写也能判', containingSystem(rows, 706, 646, MIN)?.id === 'big')
  // 「套住但拆不成」也算没套住：拆出来的半行低于最小高度时返回 null，于是这一笔落回重叠那一路
  // （不需要调用方再补一次判据 —— 套住必定相交，`overlapSystem` 一定接得住）
  // 这一刀只有 30pt 高（本身还不够当一条行），两头剩下的 70pt 也不够两半都成立
  ok('太扁的一刀 → 不算拆行', containingSystem(rows, 670, 700, MIN) === null)
  // 这一刀够高（60pt），但切在下半那头，上面省下 160、下面只剩 20 → 下半个不成立
  ok('切得偏、某一半不够高 → 不算拆行', containingSystem(rows, 620, 680, MIN) === null)
  ok('矮到装不下两条最小行 → 怎么切都拆不成', containingSystem([low], 460, 480, MIN) === null)
  // 一条行要拆得成，**自己至少得有两个最小高度那么高**（两半各留 MIN，端点还各要躲开 ROW_EPS）：
  // 600…692 正好是 2 × MIN，怎么切都不成立 —— 这类行只能删掉重画，拆是拆不动的
  const tight = row(600, 600 + 2 * MIN)
  ok('正好两条最小行的高度 → 怎么切都拆不成', containingSystem([tight], 606, 640, MIN) === null && containingSystem([tight], 600.2, 600 + 2 * MIN - 0.2, MIN) === null)
  // 一行 600…696：从 646 切一刀出去，下面正好剩下一个最小高度（上面那点缝 < MIN，凑不成一条行）
  ok(
    '刚好剩得下一条最小高度的行',
    JSON.stringify(splitSystemBounds(row(600, 696), 646, 700, MIN)) === JSON.stringify({ above: null, below: { lo: 600, hi: 646 } }),
    JSON.stringify(splitSystemBounds(row(600, 696), 646, 700, MIN))
  )

  // 减去新行剩下的两条：above 是上边那半（y 更大）、below 是下边那半
  const halves = splitSystemBounds(big, 646, 706, MIN)
  ok('拆行：剩下上半与下半', JSON.stringify(halves) === JSON.stringify({ above: { lo: 706, hi: 600 + H }, below: { lo: 600, hi: 646 } }), JSON.stringify(halves))
  // 原行 y0 > y1（OMR 写法）时两半也照着反写，免得同一页里两种写法混着
  const flippedHalves = splitSystemBounds(row(600 + H, 600), 646, 706, MIN)
  ok('拆行：原行反着写时两半也反着写', JSON.stringify(flippedHalves) === JSON.stringify({ above: { lo: 600 + H, hi: 706 }, below: { lo: 646, hi: 600 } }), JSON.stringify(flippedHalves))
  ok('拆行：贴着一端切时那一边没剩下 → null', splitSystemBounds(big, 600.2, 600 + H, MIN).below === null)
  ok(
    '拆行：低于最小高度的那一半 → null（另一半照给）',
    JSON.stringify(splitSystemBounds(big, 610, 630, MIN)) === JSON.stringify({ above: { lo: 630, hi: 600 + H }, below: null }),
    JSON.stringify(splitSystemBounds(big, 610, 630, MIN))
  )
  const bothEnds = splitSystemBounds(big, 600.2, 600 + H - 0.2, MIN)
  ok('拆行：两端都贴着边 → 两半都不成行', bothEnds.above === null && bothEnds.below === null)
  // 套住判定与拆分是同一条链：判出套住的那一笔，拆出来必定上下都有东西
  const cbox = clampToPage(646, 706, 842, MIN)
  const ch = splitSystemBounds(containingSystem(rows, cbox.lo, cbox.hi, MIN), cbox.lo, cbox.hi, MIN)
  ok('先判套住再拆分：两半都成行', !!ch.above && !!ch.below)
}

console.log('\n[13] 标记列表的树（domain/marks.js）')
{
  // 一行没有小节线（推不出小节）、一行有：两行都要在列表里，且小节线 / 段落 / 反复各归各的行
  const meta = makeScore()
  meta.pages[0].systems = [
    { id: uid('sy'), y0: 700, y1: 660, bars: [] }, // y0 > y1：OMR 那种写法，列表也得排得出 lo/hi
    { id: uid('sy'), y0: 500, y1: 540, bars: [{ id: uid('br'), x: 300 }, { id: uid('br'), x: 72 }] },
  ]
  const rowA = meta.pages[0].systems[0]
  const rowB = meta.pages[0].systems[1]
  const [barB1, barB0] = rowB.bars // 排序前：先 300 后 72
  meta.segments = [
    defaultSegment({ barId: barB1.id, bpm: 90, measure: 1, beat: 1, name: 'A 段' }),
    // 没起名字：那行字要写成速度 + 拍号
    defaultSegment({ barId: barB0.id, bpm: 120, measure: 1, beat: 5 }),
  ]
  meta.repeats = [
    defaultRepeat({ barId: barB0.id, kind: 'start' }),
    { id: uid('rp'), kind: 'house2', barId: barB1.id }, // 历史类型：谱面上不画，列表也不该按类型崩掉
  ]

  // 那几段拼进 `line` 的文案由调用方给（domain 不引 i18n），测试里给一份等价的
  const texts = {
    measure: '第{n}小节',
    bar: '小节线',
    tempo: (s) => `${Math.round(s.bpm || 120)} ${s.beatsPerBar || 4}/${s.beatUnit || 4}`,
    // 段落那行字 = 名字 + 速度拍号（与谱面名牌共用 `i18n/score-text.js` 的 `segmentLabel`）
    segment: (s) => {
      const tempo = `${Math.round(s.bpm || 120)} ${s.beatsPerBar || 4}/${s.beatUnit || 4}`
      const name = String(s.name || '').trim()
      return name ? `${name} ${tempo}` : tempo
    },
    repeat: { start: '反复开始', end: '反复结束', house1: '房子 1' },
  }
  const st = deriveStructure(meta)
  const tree = buildMarkTree(meta, st, texts)

  ok('每个行一个节点（含没有小节线、推不出小节的行）', tree.length === st.systems.length && tree.length === 2, `tree=${tree.length} systems=${st.systems.length}`)
  ok('行按阅读顺序编号、推不出小节的那行也有号', tree[0].id === rowA.id && tree[0].index === 1 && tree[1].index === 2)
  ok('行的 y 统一成 lo/hi（y0>y1 那种写法也对）', tree[0].y0 === 660 && tree[0].y1 === 700, `${tree[0].y0}–${tree[0].y1}`)
  ok('摘要：推不出小节的行是 0 小节 0 段落 0 反复', JSON.stringify(tree[0].summary) === JSON.stringify({ measures: 0, segments: 0, repeats: 0 }), JSON.stringify(tree[0].summary))
  ok(
    '摘要：有小节的行数出小节 / 段落 / 反复（这一行 1 小节 2 段落 2 反复）',
    JSON.stringify(tree[1].summary) === JSON.stringify({ measures: 1, segments: 2, repeats: 2 }),
    JSON.stringify(tree[1].summary)
  )
  ok('推不出小节的行一个子标记也没有', tree[0].children.length === 0, String(tree[0].children.length))
  ok('小节线归它所在的行', tree[1].children.filter((c) => c.kind === 'bar').length === 2, String(tree[1].children.length))
  ok('子节点顺序：小节线 → 段落 → 反复', tree[1].children.map((c) => c.kind).join(',') === 'bar,bar,segment,segment,repeat,repeat', tree[1].children.map((c) => c.kind).join(','))
  ok(
    '小节线那行字 = 它起头的小节号',
    tree[1].children.filter((c) => c.kind === 'bar').map((c) => c.line).join(' / ') === '第1小节 / 第2小节',
    tree[1].children.filter((c) => c.kind === 'bar').map((c) => c.line).join(' / ')
  )
  const segHead = tree[1].children.find((c) => c.kind === 'segment' && c.line.startsWith('A 段'))
  ok('段落按生效位置归行并带上坐标（第 1 小节那一行的上下沿）', segHead?.y0 === 500 && segHead?.y1 === 540 && segHead?.page === 0, JSON.stringify([segHead?.page, segHead?.y0, segHead?.y1]))
  // 段落那行字 = **名字 + 速度拍号**（用户拍板：两样都要显示）
  ok('段落那行字 = 名字 + 速度 + 拍号', segHead?.line === 'A 段 90 4/4', String(segHead?.line))
  // 没起名字的段落只写速度 + 拍号（不留前导分隔符）
  const segAnon = tree[1].children.find((c) => c.kind === 'segment' && c.line === '120 4/4')
  ok('没名字的段落那行字只写速度 + 拍号', !!segAnon, JSON.stringify(tree[1].children.filter((c) => c.kind === 'segment').map((c) => c.line)))
  // 「开头」段落不进列表
  ok('「开头」段落不进列表', tree.every((r) => r.children.every((c) => c.line !== '开头')))
  const repeat = tree[1].children.find((c) => c.kind === 'repeat')
  ok('反复那行字 = 类型', repeat?.line === '反复开始', String(repeat?.line))
  ok(
    '全选键 = 每个行 + 它的子标记（推不出小节的行也占一个，但它没有子项）',
    tree.flatMap((r) => [r.id, ...r.children.map((c) => c.id)]).length === 2 + 6,
    String(tree.flatMap((r) => [r.id, ...r.children.map((c) => c.id)]).length)
  )

  // 没给文案模板时也不能崩（调用方漏传时 line 是空串）
  const bare = buildMarkTree(meta, st)
  ok('不给文案模板也能造出树（line 为空）', bare.length === 2 && bare[1].children.length === 6)
}

console.log('\n[14] 弱起前导：时钟读得到负数位置（domain/audio-engine.js）')
{
  // 记谱的弱起小节比音频里那段长时，位置要从负数走起、<audio> 钉在 0 秒等
  //（谁推进前导、什么时候起播在 `store/player.js`，这里只锁「时钟读得到负数」这一条）
  const clock = new OutputClock()
  ok('默认没有前导', clock.leadPos === null)
  clock.leadPos = -1.5
  ok('前导位置就是时钟读数', clock.now === -1.5, `${clock.now}s`)
  clock.leadPos = 0.5
  ok('正数前导也原样读（何时结束由上层定）', clock.now === 0.5, `${clock.now}s`)
  clock.leadPos = null
  ok('取消前导后读数回到时钟自己（没引擎、没上下文时是 0）', clock.now === 0, `${clock.now}s`)
  clock.leadPos = -2
  clock.seek(3)
  ok('seek 会清掉前导', clock.leadPos === null && clock.now === 3, `${clock.now}s`)
  // 这条锁的是分工：时钟 / <audio> 自己只认 ≥ 0，**负起点的回跳必须由上层 `seek()` 接管**。
  // `store/player.js` 的 `handleLoopEnd` 以前在「没开循环预备拍」那一支返回 false、让时钟自己 seek，
  // 负起点被夹到 0 —— 现象就是「循环段跳回第一段时直接从音频位置开始，而不是从头」。
  clock.leadPos = null
  clock.seek(-1.5)
  ok('时钟自己的 seek 把负数夹到 0（负起点的回跳必须由上层接管）', clock.now === 0, `${clock.now}s`)
}

console.log('\n[15] 无音频 + AudioContext 那条时钟分支（domain/audio-engine.js）')
{
  // 「只响节拍器」的走带：读数 = 起点 + 上下文走过的时间 × 倍速。
  // 这条曾经写成 `ctx.currentTime - _ac - origin`，seek(6) 之后读数一直贴着 0，
  // 要等 12 秒才追到 6（无音频时跳小节 / 暂停一下位置就归零）。
  const ctx = { currentTime: 0, state: 'running', resume: async () => {} }
  const clock = new OutputClock()
  clock.attach(null, ctx)

  clock.seek(6)
  ok('seek 之后读数就是目标位置', near(clock.now, 6), `${clock.now}s`)

  await clock.play()
  ctx.currentTime += 1
  ok('上下文走 1 秒 = 位置走 1 秒', near(clock.now, 7), `${clock.now}s`)

  clock.setRate(2)
  ctx.currentTime += 1
  ok('倍速作用在读数上（走 1 秒 = 位置走 2 秒）', near(clock.now, 9), `${clock.now}s`)

  clock.pause()
  ctx.currentTime += 5
  ok('暂停期间读数冻住（上下文还在走，不能算进进度）', near(clock.now, 9), `${clock.now}s`)

  await clock.play()
  ctx.currentTime += 1
  ok('再播放：从冻住的位置接着走', near(clock.now, 11), `${clock.now}s`)

  clock.resync()
  ok('resync 只重钉基准、读数不变（节拍器 reset 会调它）', near(clock.now, 11), `${clock.now}s`)

  clock.seek(6)
  clock.leadPos = -1.5
  clock.resync()
  ok('前导期间 resync 不动 origin（位置归 leadPos）', near(clock.now, -1.5), `${clock.now}s`)
}

/**
 * 造一张「墨点图」给识别用：白底、指定位置画谱线 / 小节线 / 两谱表之间的连线。
 * 尺寸与判据都按像素来（识别全程都在像素域），`scale = 1` 时 pt 与 px 一一对应。
 */
function makeInkPage({ width = 1200, height = 900, staves = [], bars = [], connectors = [] } = {}) {
  const bins = new Uint8Array(width * height)
  const put = (x, y) => {
    if (x >= 0 && y >= 0 && x < width && y < height) bins[y * width + x] = 1
  }
  for (const s of staves) {
    for (const y of s.lines) for (let x = s.x0; x <= s.x1; x++) for (let t = 0; t < 2; t++) put(x, y + t)
  }
  for (const b of bars) for (let y = b.y0; y <= b.y1; y++) for (let t = 0; t < 2; t++) put(b.x + t, y)
  for (const c of connectors) for (let y = c.y0; y <= c.y1; y++) for (let t = 0; t < 2; t++) put(c.x + t, y)
  return { bins, width, height, scale: 1 }
}

console.log('\n[8] 谱面识别（找行 / 找小节线）')
{
  const OMR = { minStaffLines: 3, minStaffWidth: 0.3 }
  const space = 10
  // 两条谱表：各 3 条谱线、行距 10px，上谱表底 y=110、下谱表顶 y=130（间距 20px = 2 倍行距）
  const upper = { x0: 100, x1: 1100, lines: [90, 100, 110] }
  const lower = { x0: 100, x1: 1100, lines: [130, 140, 150] }
  const barXs = [100, 350, 600, 850, 1100]
  // 小节线贯穿两条谱表（3px 宽，避免「只有一列命中」的偶然）
  const bars = []
  for (const x of barXs) for (const t of [0, 1, 2]) bars.push({ x: x + t, y0: 88, y1: 152 })
  // 行首的大括号：把两条谱表之间的空隙连起来
  const connectors = [{ x: 100, y0: 110, y1: 130 }]
  const ctx = makeInkPage({ staves: [upper, lower], bars, connectors })

  const st = findStaves(ctx, OMR)
  ok('认得出两条谱表（各 3 条谱线）', st.staves.length === 2, `staves=${st.staves.length}`)
  ok('谱表行距 = 10px', st.staves.length === 2 && near(st.staves[0].space, 10, 0.5), st.staves[0] ? st.staves[0].space.toFixed(2) : '-')

  const grouped = groupSystems(ctx, st.staves, OMR)
  ok('两条谱表合成一行（行首括号把它们连起来了）', grouped.systems.length === 1, `systems=${grouped.systems.length}`)
  ok('合成的行覆盖两条谱表', grouped.systems[0]?.staves.length === 2, `staves=${grouped.systems[0]?.staves.length}`)

  const sys = grouped.systems[0]
  const found = sys ? findBars(ctx, sys, OMR) : { bars: [] }
  ok('一行里 5 条小节线 = 4 个小节', found.bars.length === 5, `bars=${found.bars.length}`)
  if (found.bars.length === 5) {
    const want = barXs.map((x) => x + 1)
    const okPos = found.bars.every((b, i) => Math.abs(b - want[i]) < 4)
    ok('小节线位置对得上', okPos, found.bars.map((b) => b.toFixed(0)).join(','))
  }

  // 没有括号时退回「贴得很近」的间距判据：间距 20px = 2 倍行距
  const grouped2 = groupSystems(ctx, st.staves, { ...OMR, joinCoverage: 1.5 })
  ok('没有括号时靠「贴得近」也能合行', grouped2.systems.length === 1, `systems=${grouped2.systems.length}`)
}

console.log('\n[9] 行两端补小节线（谱表最左/最右的竖线也要标上）')
{
  const OMR = { minStaffLines: 3, minStaffWidth: 0.3 }
  /**
   * 一页 3 行，每行两条谱表。`skip` 指定「哪一行的哪一端不画小节线」。
   *
   * `connectors` 是行首那根把两条谱表连起来的竖线（合行判据靠它）。**它自己就是行首那一列的墨**，
   * 所以带 `connectors` 时行首永远「有墨」；想验「谱子本来就不画行端线」要把它关掉，
   * 否则测的其实是「那儿有括号墨、但没有小节线」这一种，跟真实版式对不上。
   */
  const makePage = (skip = [], connectors = true) => {
    const staves = []
    const bars = []
    const joins = []
    for (let r = 0; r < 3; r++) {
      const top = 100 + r * 120
      staves.push({ x0: 100, x1: 1100, lines: [top, top + 10, top + 20] })
      staves.push({ x0: 100, x1: 1100, lines: [top + 50, top + 60, top + 70] })
      if (connectors) joins.push({ x: 100, y0: top - 2, y1: top + 72 })
      // 中间两条小节线 + 两端（除 skip 指定的那一端）
      const xs = [100, 400, 700, 1100]
      for (let k = 0; k < xs.length; k++) {
        const isLeft = k === 0
        const isRight = k === xs.length - 1
        if (isLeft && skip.includes(`L${r}`)) continue
        if (isRight && skip.includes(`R${r}`)) continue
        for (const t of [0, 1, 2]) bars.push({ x: xs[k] + t, y0: top - 2, y1: top + 72 })
      }
    }
    return makeInkPage({ staves, bars, connectors: joins })
  }

  // 一行缺行首线、一行缺行尾线，其余都齐 —— 应该只补这两条
  const ctx = makePage(['L1', 'R2'])
  const st = findStaves(ctx, OMR)
  const grouped = groupSystems(ctx, st.staves, OMR)
  ok('3 行各由两条谱表合成', grouped.systems.length === 3, `systems=${grouped.systems.length}`)

  const systems = grouped.systems
    .map((sys) => ({ ...sys, space: sys.space || 10, bars: findBars(ctx, sys, OMR).bars }))
    .filter((s) => s.bars.length >= 2)
  ok(
    '补线前：缺行首的那行只剩中间两条+行尾，缺行尾的那行只剩行首+中间两条',
    systems.map((s) => s.bars.length).join(',') === '4,4,3',
    systems.map((s) => s.bars.length).join(',')
  )

  closeRowEnds(ctx, systems, OMR)
  const expect = [101, 401, 701, 1101]
  const aligned = systems.every((s) => s.bars.length === 4 && s.bars.every((x, i) => Math.abs(x - expect[i]) < 8))
  ok('补完每行都是 4 条线、位置对得上行端', aligned, systems.map((s) => s.bars.map((x) => x.toFixed(0)).join('/')).join(' | '))
  ok('已经齐了的行不多补', systems[0].bars.length === 4, `bars=${systems[0].bars.length}`)

  // 反面：这一页的行端本来就没有竖线（连括号也不画）→ 只在**谱表边界**上补，不往行内乱找
  const ctx2 = makePage(['L0', 'L1', 'L2', 'R0', 'R1', 'R2'], false)
  const st2 = findStaves(ctx2, OMR)
  const g2 = groupSystems(ctx2, st2.staves, { ...OMR, joinCoverage: 1.5 })
  const sys2 = g2.systems.map((sys) => ({ ...sys, space: sys.space || 10, bars: findBars(ctx2, sys, OMR).bars })).filter((s) => s.bars.length >= 2)
  closeRowEnds(ctx2, sys2, OMR)
  const atEdges = sys2.every((s) => s.bars.length === 4 && Math.abs(s.bars[0] - 100) < 2 && Math.abs(s.bars[3] - 1100) < 2)
  ok('行端没画线时补在谱表边界上', atEdges, sys2.map((s) => s.bars.map((x) => x.toFixed(0)).join('/')).join(' | '))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败${fail ? ` → ${failures.join('、')}` : ''}`)
process.exit(fail ? 1 : 0)
