/**
 * 纯逻辑自测（不依赖浏览器）：
 *   node scripts/unit-test.mjs
 * 覆盖结构推导、调速时间轴、小节/时间换算、跳转展开、时间锚点、psz/zip 打包
 */
import { BAR_MERGE_PT, comparePosition, createMeta, defaultJump, defaultSegment, fitBeat, positionBeat, positionMeasure, uid } from '../src/domain/schema.js'
import { buildTimeline, deriveStructure, expandJumps, isRowEndBar, isRowStartBar, resolveJumps, resolveSegments, segmentMeasure, segmentStartMeasure } from '../src/domain/timeline.js'
import { Metronome, OutputClock } from '../src/domain/audio-engine.js'
import { buildScoreArchive, classifyFiles, fileStamp, isZipFile, packArchives, readZip } from '../src/domain/zip.js'
import { clampToPage, overlapSystem } from '../src/domain/rows.js'
import { closeRowEnds, findBars, findStaves, groupSystems } from '../src/domain/omr.js'
import { buildMarkTree } from '../src/domain/marks.js'
import { renderMarkdown } from '../src/domain/markdown.js'
import { errText } from '../src/store/toast.js'
import { catalogs, DEFAULT_LOCALE } from '../src/i18n/locales.generated.js'
import { readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'

const SRC = fileURLToPath(new URL('../src', import.meta.url))

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out)
    else out[p] = v
  }
  return out
}

const flat = Object.fromEntries(Object.entries(catalogs).map(([code, pack]) => [code, flatten(pack)]))

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

/** `expandJumps` 的演奏顺序是 `{ no, jumpTo }`，测试里基本只关心小节号 */
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

/** 第 `no` 小节起头的那几条小节线（同一个小节可能有两条：上一行的行末线 + 这一行的行首线） */
function barsOfMeasure(st, no) {
  return [...st.barStartMeasure].filter(([, n]) => n === no).map(([id]) => id)
}

/**
 * 第 `no` 小节能当跳转起点的那条线：**不是行首线**（见 docs/invariants.md §4）。
 * 测试里按小节号造记号时用它挑线 —— 与 `store/player.js` 的 `startJump` 落下来的那条线一致
 * （那条路会把行首线**挪到**上一行行末线，挪出来的正是这里挑的这条）。
 */
function startLine(st, no) {
  const list = barsOfMeasure(st, no)
  return list.find((id) => !isRowStartBar(st, id)) || list[0]
}

/** 第 `no` 小节能当跳转终点的那条线：**不是行末线**（同上去 `endLine` 那条路） */
function endLine(st, no) {
  const list = barsOfMeasure(st, no)
  return list.find((id) => !isRowEndBar(st, id)) || list[0]
}

/** 按小节号造一条跳转记号（两端各自挑一条合规矩的线） */
function jumpByMeasure(st, start, end, patch = {}) {
  return defaultJump({ startBarId: startLine(st, start), endBarId: endLine(st, end), ...patch })
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
  // 它**永远挂在「编号第一小节起头的那条线」上**（`segmentBarId` 对 head 现推，不读它自己的 barId）。
  const head = meta.segments.find((s) => s.head)
  ok('「开头」段落固定落在第 1 小节', segmentStartMeasure(st, head)?.no === 1, JSON.stringify(segmentStartMeasure(st, head)?.no))
  ok(
    '「开头」段落挂错线了也照样算第 1 小节',
    segmentStartMeasure(st, { ...head, barId: st.measures[3].startBarId })?.no === 1
  )
  const noMeasure = deriveStructure(makeScore({ systems: 1, barsPerSystem: 1 }))
  ok('全谱还没有小节时「开头」段落没有落点（谱面上整条不画）', noMeasure.count === 0 && segmentStartMeasure(noMeasure, head) === null)
}

console.log('\n[2] 调速时间轴')
{
  const meta = makeScore()
  const sys0 = meta.pages[0].systems[0]
  const sys1 = meta.pages[0].systems[1]
  meta.segments = [
    defaultSegment({ barId: sys0.bars[0].id, bpm: 120, beatsPerBar: 4, beatUnit: 4, beat: 1 }),
    defaultSegment({ barId: sys1.bars[0].id, bpm: 60, beatsPerBar: 4, beatUnit: 4, beat: 1 }),
  ]
  const tl = buildTimeline(meta)
  ok(
    '段落的小节号由它挂靠的那条小节线现推',
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
  meta.segments = [defaultSegment({ barId: meta.pages[0].systems[0].bars[0].id, bpm: 120, beatsPerBar: 4, beatUnit: 4, beat: 1 })]
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
  meta.segments = [defaultSegment({ barId: meta.pages[0].systems[0].bars[0].id, bpm: 90, beatsPerBar: 3, beatUnit: 4, beat: 1 })]
  const tl = buildTimeline(meta)
  ok('3/4 每小节 3 拍', tl.samples.filter((s) => s.no === 1).length === 3)
  ok('3/4 @90BPM 小节 = 2s', near(tl.measureDuration(1), 2), `${tl.measureDuration(1)}s`)

  const meta2 = makeScore()
  meta2.segments = [defaultSegment({ barId: meta2.pages[0].systems[0].bars[0].id, bpm: 120, beatsPerBar: 6, beatUnit: 8, beat: 1 })]
  const tl2 = buildTimeline(meta2)
  ok('6/8 每小节 6 拍（八分音符为一拍）', tl2.samples.filter((s) => s.no === 1).length === 6)
  ok('6/8 @120BPM 小节 = 1.5s', near(tl2.measureDuration(1), 1.5), `${tl2.measureDuration(1)}s`)
}

console.log('\n[5] 音频起点偏移与时间锚点')
{
  const meta = makeScore()
  meta.audio.startOffset = 3.5
  meta.segments = [defaultSegment({ barId: meta.pages[0].systems[0].bars[0].id, bpm: 120, beat: 1 })]
  let tl = buildTimeline(meta)
  ok('起点偏移生效（第 1 小节 = 3.5s）', near(tl.posToTime(1), 3.5), `${tl.posToTime(1)}s`)

  const seg = defaultSegment({ barId: meta.pages[0].systems[1].bars[0].id, bpm: 120, beat: 1, time: 30 })
  meta.segments.push(seg)
  tl = buildTimeline(meta)
  ok('段落时间锚点覆盖累计误差', near(tl.posToTime(5), 30), `${tl.posToTime(5)}s`)
  ok('锚点之后按 BPM 继续推进', near(tl.posToTime(6), 32), `${tl.posToTime(6)}s`)

  // 弱起小节：startPosition = 2 → 音频起点是**第 2 小节**的时间，第 1 小节落在它之前
  const pickup = makeScore()
  pickup.audio.startOffset = 3.5
  pickup.audio.startPosition = 2
  pickup.segments = [defaultSegment({ barId: pickup.pages[0].systems[0].bars[0].id, bpm: 120, beat: 1 })]
  let tlPickup = buildTimeline(pickup)
  ok('弱起：第 2 小节对齐音频起点', near(tlPickup.posToTime(2), 3.5), `${tlPickup.posToTime(2)}s`)
  ok('弱起：第 1 小节提前一个整小节', near(tlPickup.posToTime(1), 1.5), `${tlPickup.posToTime(1)}s`)

  // 提前量 = 弱起小节自己的拍数（这里把第 1 小节标成 1 拍 → 只提前 0.5s）
  pickup.segments = [defaultSegment({ barId: pickup.pages[0].systems[0].bars[0].id, bpm: 120, beatsPerBar: 1, beat: 1 })]
  tlPickup = buildTimeline(pickup)
  ok('弱起：提前量按弱起小节的拍数算', near(tlPickup.posToTime(1), 3.0), `${tlPickup.posToTime(1)}s`)

  // 没有弱起（默认 startPosition = 1）时行为不变
  const plain = makeScore()
  plain.audio.startOffset = 3.5
  plain.segments = [defaultSegment({ barId: plain.pages[0].systems[0].bars[0].id, bpm: 120, beat: 1 })]
  ok('无弱起：第 1 小节就是起点', near(buildTimeline(plain).posToTime(1), 3.5))
}


console.log('\n[6] 跳转记号：展开演奏顺序')
{
  // 8 小节（两行各 4 个）
  const meta = makeScore({ systems: 2, barsPerSystem: 5 })
  /** 展开这一份 meta 的演奏顺序（`resolveJumps` → `expandJumps`，与 `buildTimeline` 同一条链） */
  const orderOf = (m = meta) => {
    const s = deriveStructure(m)
    return expandJumps(resolveJumps(m, s, s.count), s.count)
  }
  ok('没有记号：1..末小节一条直线', nos(orderOf()) === '1,2,3,4,5,6,7,8', nos(orderOf()))

  // 一条记号：**进入起点那一小节就跳，起点自己不演奏**；跳成功之后不再跳（往回跳不会转圈）
  const st = deriveStructure(meta)
  meta.jumps = [jumpByMeasure(st, 3, 1, { id: 'a' })]
  let order = orderOf()
  ok('往回跳：进入第 3 小节跳回第 1 小节、第 3 小节自己不演奏', nos(order) === '1,2,1,2,3,4,5,6,7,8', nos(order))
  ok('落点那一项带 jumpTo（界面拿它闪目标小节）', order[2].jumpTo === true && order[2].no === 1, JSON.stringify(order.slice(0, 4)))
  ok('一条记号只跳一次：第二遍走到第 3 小节接着往下走', order.filter((x) => x.jumpTo).length === 1)

  // 往后跳：跳过中间那几小节
  meta.jumps = [jumpByMeasure(st, 2, 5)]
  ok('往后跳：进入第 2 小节直接落到第 5 小节', nos(orderOf()) === '1,5,6,7,8', nos(orderOf()))

  // 无效记号（两端同一个小节 / 端点那条线取不到小节号）不参与展开
  meta.jumps = [
    defaultJump({ startBarId: startLine(st, 3), endBarId: startLine(st, 3) }),
    defaultJump({ startBarId: startLine(st, 3), endBarId: 'br_gone' }),
  ]
  ok('无效记号一律不跳', nos(orderOf()) === '1,2,3,4,5,6,7,8', nos(orderOf()))

  // 前置：**没满足时这次到达不算消费** —— 之后再回到起点（这里由 A 那条跳转带回来）照样跳
  meta.jumps = [
    jumpByMeasure(st, 5, 1, { id: 'a' }), // A：进入第 5 小节跳回第 1 小节
    jumpByMeasure(st, 3, 6, { id: 'b', prereq: 'a' }), // B：前置 A
  ]
  order = orderOf()
  ok('前置没满足：第一次走到第 3 小节不跳（也没作废）', nos(order) === '1,2,3,4,1,2,6,7,8', nos(order))
  ok('回到第 3 小节时前置已满足 → 这次跳了', order.filter((x) => x.jumpTo).length === 2, JSON.stringify(order.map((x) => [x.no, x.jumpTo])))

  // 同一个起点上两条都能跳 → 取 `meta.jumps` 里**排在前面的**那条（顺序就是落笔顺序）
  const two = [jumpByMeasure(st, 3, 1, { id: 'x' }), jumpByMeasure(st, 3, 6, { id: 'y' })]
  meta.jumps = two
  ok('同一个起点：先取排在前面的那条', nos(orderOf()) === '1,2,1,2,6,7,8', nos(orderOf()))
  meta.jumps = [two[1], two[0]]
  ok('调换顺序后换另一条先跳', nos(orderOf()) === '1,2,6,7,8', nos(orderOf()))

  // 时间轴照旧按展开后的顺序逐拍累加：同一个小节出现几遍就有几组采样
  meta.jumps = [jumpByMeasure(st, 3, 1, { id: 'a' })]
  const tl = buildTimeline(meta)
  ok('时间轴长度 = 展开后的小节数 × 每小节拍数', tl.samples.length === orderOf().length * 4, `${tl.samples.length} 拍`)
  ok(
    '手动跳转「视作还没跳过」：不传 nearTime 取第 1 小节的第一遍',
    tl.posToTime(1) < tl.posToTime(1, 999),
    `${tl.posToTime(1)} vs ${tl.posToTime(1, 999)}`
  )

  // 规整（`createMeta`）：悬空 / 自指的前置一律当没有前置 —— 留着它那条记号永远不跳，界面上却看不出为什么
  const norm = createMeta({ jumps: [{ id: 'p', startBarId: 'a', endBarId: 'b', prereq: 'nope' }, { id: 'q', startBarId: 'b', endBarId: 'a', prereq: 'q' }] })
  ok('规整：悬空 / 自指的前置都当没有前置', norm.jumps.every((j) => j.prereq === null), JSON.stringify(norm.jumps))
  ok(
    '规整：没写起点 / 终点小节线的条目丢掉',
    createMeta({ jumps: [{ id: 'z' }, { id: 'w', startBarId: 'a', endBarId: 'b' }] }).jumps.length === 1,
    JSON.stringify(createMeta({ jumps: [{ id: 'z' }, { id: 'w', startBarId: 'a', endBarId: 'b' }] }).jumps)
  )
}

console.log('\n[6.1] 规整：同一行里贴得太近的小节线并成一条')
{
  const oneRow = (bars) => [{ width: 595, height: 842, systems: [{ id: 'sy_a', y0: 700, y1: 660, bars }] }]
  const meta = createMeta({
    pages: oneRow([{ id: 'br_a', x: 100 }, { id: 'br_b', x: 104 }, { id: 'br_c', x: 160 }]),
    segments: [{ id: 'sg_a', barId: 'br_b', name: 'B 段', bpm: 90 }],
    jumps: [{ id: 'jp_a', startBarId: 'br_b', endBarId: 'br_c' }],
  })
  const bars = meta.pages[0].systems[0].bars
  const seg = meta.segments.find((s) => s.id === 'sg_a')
  ok('x 间距 < 5pt 的两条并成一条', bars.length === 2, bars.map((b) => `${b.id}@${b.x}`).join(' ,'))
  ok('保留左边那条的 id、x 取中点', bars[0].id === 'br_a' && near(bars[0].x, 102), `${bars[0].id}@${bars[0].x}`)
  ok('挂在被并掉那条线上的段落改挂留下的那条', seg?.barId === 'br_a', String(seg?.barId))
  ok('跳转记号的两端也跟着改挂', meta.jumps[0].startBarId === 'br_a' && meta.jumps[0].endBarId === 'br_c', JSON.stringify(meta.jumps[0]))
  ok('小节数按合并后的线数算', deriveStructure(meta).count === 1, String(deriveStructure(meta).count))

  const exact = createMeta({ pages: oneRow([{ id: 'br_a', x: 100 }, { id: 'br_b', x: 100 + BAR_MERGE_PT }]) })
  ok('间距正好等于阈值不并（判据是「小于」）', exact.pages[0].systems[0].bars.length === 2)

  // 逐个跟「上一条已经并过的线」比：100 与 103 并成 101.5，101.5 与 106 只差 4.5 → 也并进去
  const chain = createMeta({ pages: oneRow([{ id: 'br_a', x: 100 }, { id: 'br_b', x: 103 }, { id: 'br_c', x: 106 }]) })
  const cb = chain.pages[0].systems[0].bars
  ok('连着挨在一起的几条并成一条', cb.length === 1 && near(cb[0].x, 103.75), cb.map((b) => `${b.id}@${b.x}`).join(' ,'))

  const again = createMeta(JSON.parse(JSON.stringify(meta)))
  ok('幂等：并过的结果再规整一遍不变', JSON.stringify(again.pages) === JSON.stringify(meta.pages))
}

console.log('\n[7] 跳转记号：两端的小节号由存着的那条小节线现推')
{
  // 两行各 4 小节：**行末线与下一行行首线是同一个小节**（第 5 小节），两条线各合一个角色的规矩
  const meta = makeScore({ systems: 2, barsPerSystem: 5 })
  const [row0, row1] = meta.pages[0].systems.map((s) => s.bars)
  const st = deriveStructure(meta)
  ok(
    '行末线与下一行行首线是同一个小节',
    st.barStartMeasure.get(row0[4].id) === st.barStartMeasure.get(row1[0].id),
    `第 ${st.barStartMeasure.get(row0[4].id)} 小节`
  )
  ok('isRowEndBar：行末那条是、行内别处不是', isRowEndBar(st, row0[4].id) === true && isRowEndBar(st, row0[3].id) === false)
  ok('isRowStartBar：行首那条是、行内别处不是', isRowStartBar(st, row1[0].id) === true && isRowStartBar(st, row1[1].id) === false)
  ok('曲末那条线指向「全部小节之后」', st.barStartMeasure.get(row1[4].id) === st.count + 1, String(st.barStartMeasure.get(row1[4].id)))

  // 起点落在**行末线**上（第 5 小节）、终点落在**行首线**上（第 5 小节）—— 这两条线都是合规矩的落点
  const js = resolveJumps(
    {
      jumps: [
        defaultJump({ id: 'x', startBarId: row0[4].id, endBarId: row0[0].id }),
        defaultJump({ id: 'y', startBarId: row1[1].id, endBarId: row1[0].id }),
      ],
    },
    st,
    st.count
  )
  ok('存的是哪条线就落在哪条线上（不再按角色挑线）', js[0].startBarId === row0[4].id && js[1].endBarId === row1[0].id)
  ok('两端的小节号由那两条线现推', js[0].start === 5 && js[0].end === 1 && js[1].start === 6 && js[1].end === 5, JSON.stringify(js.map((j) => [j.start, j.end])))
  ok('都有效', js[0].valid === true && js[1].valid === true)
  ok('序号按 meta 里的顺序（1 起，界面拿它指代一条记号）', js[0].seq === 1 && js[1].seq === 2)

  const bad = resolveJumps(
    { jumps: [defaultJump({ startBarId: 'br_gone', endBarId: row0[0].id }), defaultJump({ startBarId: row0[0].id, endBarId: row0[0].id })] },
    st,
    st.count
  )
  ok('端点那条线取不到小节号 / 两端同一个小节的记号无效', bad.every((j) => j.valid === false))
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
  // 曲末那条线：小节号 = 小节数 + 1（后面没有小节），段落挂在它上面时拍号归 1
  meta.segments = [defaultSegment({ barId: meta.pages[0].systems[1].bars[4].id, beat: 3 })]
  const tl2 = buildTimeline(meta)
  ok('挂在曲末那条线上的段落被夹到曲末之后', tl2.segments[0].measure === tl2.total + 1, `${tl2.segments[0].measure} vs ${tl2.total + 1}`)
  ok('越界的位置没有「第几拍」可言：拍号归 1', tl2.segments[0].beat === 1, String(tl2.segments[0].beat))
  ok('时间轴仍单调递增', tl2.samples.every((s, i) => i === 0 || s.time >= tl2.samples[i - 1].time))
}

console.log('\n[9] 固定的「开头」段落')
{
  const empty = createMeta({})
  const heads = empty.segments.filter((s) => s.head)
  ok('新建乐谱自带一个开头段落', heads.length === 1 && empty.segments.length === 1)
  ok(
    '开头段落是 120 BPM 4/4、第 1 拍、没有名字、不挂小节线',
    heads[0].name === '' && heads[0].bpm === 120 && heads[0].beatsPerBar === 4 && heads[0].beatUnit === 4 && heads[0].barId === null && heads[0].beat === 1,
    JSON.stringify(heads[0])
  )
  ok('开头段落的时间轴默认也是 120/4-4', near(buildTimeline(empty).measureDuration(1), 2), `${buildTimeline(empty).measureDuration(1)}s`)

  const again = createMeta(JSON.parse(JSON.stringify(empty)))
  ok('再规整一遍不会产生第二个开头', again.segments.filter((s) => s.head).length === 1 && again.segments.length === 1)

  // 不做旧数据兼容：已有段落也照样补一条「开头」
  const imported = createMeta({ segments: [{ barId: 'br_a', beat: 3, name: 'A 段', bpm: 90 }] })
  ok(
    '已有段落也照样补一条「开头」，原有段落保持不变',
    imported.segments.length === 2 &&
    imported.segments[0].head &&
    imported.segments[0].bpm === 120 &&
    imported.segments[1].name === 'A 段' &&
    imported.segments[1].bpm === 90 &&
    imported.segments[1].barId === 'br_a' &&
    imported.segments[1].beat === 3,
    JSON.stringify(imported.segments.map((s) => [s.name, s.barId, s.beat, s.bpm, s.head]))
  )

  // 只有中间段落 → 补一个开头
  const mid = createMeta({ segments: [{ barId: 'br_b', beat: 1, name: 'B 段', bpm: 90 }] })
  ok(
    '只有中间段落时自动补开头',
    mid.segments.length === 2 && mid.segments[0].head && mid.segments[0].bpm === 120 && mid.segments[1].barId === 'br_b',
    JSON.stringify(mid.segments.map((s) => [s.name, s.barId, s.beat, s.head]))
  )

  // 开头被挪走（挂到别的线上、拍号改成第 4 拍）也会被按回「第一小节第 1 拍」
  const moved = createMeta({ segments: [{ barId: 'br_z', beat: 4, name: '开头', head: true, bpm: 100 }] })
  ok('head 始终被按回不挂线、第 1 拍', moved.segments[0].barId === null && moved.segments[0].beat === 1, JSON.stringify(moved.segments[0]))

  // 手改 JSON 写出的越界拍号被夹进这一段落自己的拍号范围
  const wild = createMeta({ segments: [{ barId: 'br_w', beat: 9, beatsPerBar: 4, name: 'C 段' }] })
  ok('越界的拍号被夹进拍号范围', wild.segments[1].beat === 4 && wild.segments[1].barId === 'br_w', JSON.stringify(wild.segments[1]))
}

console.log('\n[10] psz / zip 打包与读取')
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

  // 单张：psz 内容直接在根目录，读回来还是一张
  const coverBytes = bytes(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3)
  const coverUrl = `data:image/jpeg;base64,${Buffer.from(coverBytes).toString('base64')}`
  const one = await buildScoreArchive(scoreItem('小星星', { pdf: true, audio: true, peaks: new Float32Array([0, 1, -1, 1]) }))
  const back = await readZip(new File([await one.arrayBuffer()], '小星星.psz'))
  ok('单个 psz 读回一张乐谱', back.length === 1 && back[0].meta.title === '小星星', JSON.stringify(back.map((e) => e.meta?.title)))
  ok('psz 里的 PDF 与音频都在', !!back[0].pdf && !!back[0].audio, `pdf=${!!back[0].pdf} audio=${!!back[0].audio}`)
  ok('峰值缓存一起读回', back[0].peaks?.length === 4, String(back[0].peaks?.length))

  // 自定义封面也要进 psz（自动生成的缩略图不带，导入时按 PDF 重渲染）
  const withCover = await buildScoreArchive({ ...scoreItem('带封面', { pdf: true }), thumb: coverUrl })
  const coverBack = await readZip(new File([await withCover.arrayBuffer()], '带封面.psz'))
  ok('自定义封面进包并能读回', coverBack[0].cover?.size === coverBytes.length, String(coverBack[0].cover?.size))
  const autoOnly = await buildScoreArchive({ ...scoreItem('无封面'), thumb: null })
  const autoBack = await readZip(new File([await autoOnly.arrayBuffer()], '无封面.psz'))
  ok('没有自定义封面时不写 cover 条目', !autoBack[0].cover)

  // 多张：外层 zip，每张各是一个 .psz（不能互相串味）
  const a = await buildScoreArchive(scoreItem('A', { pdf: true }))
  const b = await buildScoreArchive(scoreItem('B', { audio: true }))
  const outer = await packArchives([a, b], ['A', 'B'])
  const list = await readZip(new File([await outer.arrayBuffer()], '乐谱库-2张.zip'))
  ok('外层 zip 里嵌套的 psz 各自成一张', list.length === 2, JSON.stringify(list.map((e) => e.meta?.title)))
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

  // 类型识别：psz 当成容器，图片单独一类，**`.json` 不是可导入的类型**（与 txt 一起归 unknown）
  ok('.psz 被认成压缩包', isZipFile(new File([bytes(1)], 'x.psz')))
  const cls = classifyFiles([
    new File([bytes(1)], 'a.pdf', { type: 'application/pdf' }),
    new File([bytes(1)], 'b.psz', { type: '' }),
    new File([bytes(1)], 'c.mp3', { type: 'audio/mpeg' }),
    new File([bytes(1)], 'd.json', { type: 'application/json' }),
    new File([bytes(1)], 'e.png', { type: 'image/png' }),
    new File([bytes(1)], 'f.txt', { type: 'text/plain' }),
  ])
  ok(
    '送进来的文件按类型分流正确',
    cls.pdfs.length === 1 && cls.archives.length === 1 && cls.audios.length === 1 && cls.images.length === 1 && cls.unknown.length === 2 && cls.jsons === undefined,
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
    '位置比较先比小节号、再比拍号',
    comparePosition({ measure: 4, beat: 3 }, { measure: 5, beat: 1 }) < 0 &&
    comparePosition({ measure: 4, beat: 3 }, { measure: 4, beat: 4 }) < 0 &&
    comparePosition({ measure: 4, beat: 3 }, { measure: 4, beat: 3 }) === 0,
    String(comparePosition({ measure: 4, beat: 3 }, { measure: 4, beat: 4 }))
  )

  const meta = makeScore()
  const st = deriveStructure(meta)
  meta.segments = [
    defaultSegment({ barId: meta.pages[0].systems[0].bars[0].id, bpm: 120, beatsPerBar: 4, beatUnit: 4, beat: 1 }),
    // 第 4 小节起头的那条线，拍号落在这一小节的第 3 拍
    defaultSegment({ barId: st.measures[3].startBarId, bpm: 60, beatsPerBar: 4, beatUnit: 4, beat: 3 }),
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
  /** 最小高度：测试里随便取一个 pt 值（真实调用方按当前缩放算 `ROW_MIN_PX / scale`） */
  const MIN = 46
  /** 拿来当「一条高行」的高度：160pt（够高、位置固定，用来试各种压住 / 罩住 / 套住的区间） */
  const H = 160
  const big = row(600, 600 + H, 'big')
  /** 矮行：只有 40pt，比最小高度还矮 —— 它自己也是一条行，只是比下限扁 */
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
}

console.log('\n[13] 标记列表的树（domain/marks.js）')
{
  // 一行没有小节线（推不出小节）、一行有（三根线 → 两个小节）：两行都要在列表里，
  // 且小节线 / 段落 / 跳转各归各的行
  const meta = makeScore()
  const barA = { id: uid('br'), x: 300 } // 行末那条：起头的小节号是「全部小节之后」
  const barB = { id: uid('br'), x: 72 }
  const barC = { id: uid('br'), x: 200 }
  meta.pages[0].systems = [
    { id: uid('sy'), y0: 700, y1: 660, bars: [] }, // y0 > y1：OMR 那种写法，列表也得排得出 lo/hi
    { id: uid('sy'), y0: 500, y1: 540, bars: [barA, barB, barC] }, // 三根线乱序给进来：两个小节
  ]
  const rowA = meta.pages[0].systems[0]
  const rowB = meta.pages[0].systems[1]
  // 按 x 排完是 B(72) → C(200) → A(300)：第 1 小节起于 B、第 2 小节起于 C，A 是行末那条（= 第 3 小节之前，越界）
  meta.segments = [
    defaultSegment({ barId: barC.id, bpm: 90, beat: 1, name: 'A 段' }),
    // 没起名字：那行字要写成速度 + 拍号
    defaultSegment({ barId: barB.id, bpm: 120, beat: 5 }),
  ]
  // 两条跳转记号：**归它起点那条小节线所在的行**（两条的起点线都在这一行）。
  // 落线规则（挪到同一个小节的那条孪生线）是**写入口**（`store/player.js` 的 `startJump` /
  // `finishJump` / `createJump`）管的事，这里只要有两条有效记号。
  const jumpIn = defaultJump({ id: 'jp_in', startBarId: barC.id, endBarId: barB.id })
  meta.jumps = [jumpIn, defaultJump({ id: 'jp_out', startBarId: barB.id, endBarId: barC.id, prereq: jumpIn.id })]

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
    // 跳转那行字 = 序号 + 起点 → 终点
    jump: (j) => `#${j.seq} ${j.start}→${j.end}`,
  }
  const st = deriveStructure(meta)
  const tree = buildMarkTree(meta, st, texts)

  ok('每个行一个节点（含没有小节线、推不出小节的行）', tree.length === st.systems.length && tree.length === 2, `tree=${tree.length} systems=${st.systems.length}`)
  ok('行按阅读顺序编号、推不出小节的那行也有号', tree[0].id === rowA.id && tree[0].index === 1 && tree[1].index === 2)
  ok('行的 y 统一成 lo/hi（y0>y1 那种写法也对）', tree[0].y0 === 660 && tree[0].y1 === 700, `${tree[0].y0}–${tree[0].y1}`)
  ok('摘要：推不出小节的行是 0 小节 0 段落 0 跳转', JSON.stringify(tree[0].summary) === JSON.stringify({ measures: 0, segments: 0, jumps: 0 }), JSON.stringify(tree[0].summary))
  ok(
    '摘要：有小节的行数出小节 / 段落 / 跳转（这一行 2 小节 2 段落 2 跳转）',
    JSON.stringify(tree[1].summary) === JSON.stringify({ measures: 2, segments: 2, jumps: 2 }),
    JSON.stringify(tree[1].summary)
  )
  ok('推不出小节的行一个子标记也没有', tree[0].children.length === 0, String(tree[0].children.length))
  ok('小节线归它所在的行', tree[1].children.filter((c) => c.kind === 'bar').length === 3, String(tree[1].children.length))
  ok(
    '子节点顺序：小节线 → 段落 → 跳转',
    tree[1].children.map((c) => c.kind).join(',') === 'bar,bar,bar,segment,segment,jump,jump',
    tree[1].children.map((c) => c.kind).join(',')
  )
  ok(
    '小节线那行字 = 它起头的小节号（全谱最后一条线指向 `count + 1`，也照样按号写出来）',
    tree[1].children.filter((c) => c.kind === 'bar').map((c) => c.line).join(' / ') === '第1小节 / 第2小节 / 第3小节',
    tree[1].children.filter((c) => c.kind === 'bar').map((c) => c.line).join(' / ')
  )
  const segHead = tree[1].children.find((c) => c.kind === 'segment' && c.line.startsWith('A 段'))
  ok('段落按挂靠的小节线归行并带上坐标（那条线所在行的上下沿）', segHead?.y0 === 500 && segHead?.y1 === 540 && segHead?.page === 0, JSON.stringify([segHead?.page, segHead?.y0, segHead?.y1]))
  // 段落那行字 = **名字 + 速度拍号**（用户拍板：两样都要显示）
  ok('段落那行字 = 名字 + 速度 + 拍号', segHead?.line === 'A 段 90 4/4', String(segHead?.line))
  // 没起名字的段落只写速度 + 拍号（不留前导分隔符）
  const segAnon = tree[1].children.find((c) => c.kind === 'segment' && c.line === '120 4/4')
  ok('没名字的段落那行字只写速度 + 拍号', !!segAnon, JSON.stringify(tree[1].children.filter((c) => c.kind === 'segment').map((c) => c.line)))
  // 「开头」段落不进列表
  ok('「开头」段落不进列表', tree.every((r) => r.children.every((c) => c.line !== '开头')))
  const jumpChild = tree[1].children.find((c) => c.kind === 'jump')
  ok('跳转那行字 = 序号 + 起点 → 终点', jumpChild?.line === '#1 2→1', String(jumpChild?.line))
  ok('跳转归**起点那条小节线**所在的行，坐标就是那条线', jumpChild?.barId === barC.id && jumpChild?.y0 === 500 && jumpChild?.y1 === 540, JSON.stringify([jumpChild?.barId === barC.id, jumpChild?.y0, jumpChild?.y1]))
  ok(
    '全选键 = 每个行 + 它的子标记（推不出小节的行也占一个，但它没有子项）',
    tree.flatMap((r) => [r.id, ...r.children.map((c) => c.id)]).length === 2 + 7,
    String(tree.flatMap((r) => [r.id, ...r.children.map((c) => c.id)]).length)
  )

  // 没给文案模板时也不能崩（调用方漏传时 line 是空串）
  const bare = buildMarkTree(meta, st)
  ok('不给文案模板也能造出树（line 为空）', bare.length === 2 && bare[1].children.length === 7)
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
  const ctx = { currentTime: 0, state: 'running', resume: async () => { } }
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

console.log('\n[16] 节拍器前瞻排程：倍速 > 1 时同一批拍子不许反复排（domain/audio-engine.js）')
{
  // 锁的是「倍速 > 1 时 `_tick` 每 25ms 都把同一批拍子重排一遍」那个坑：
  // 兜底判据 `now < lastScheduled − 前瞻` 里的前瞻量写死 0.25 的话，倍速 > 1 时它每 tick 都命中
  // （`lastScheduled` 正常落在 `now + 0.25 × 倍速` 上）——现象是节拍器变成每 tick 一下
  // （约 40 下/秒、与段落 BPM 无关），而且**暂停也停不下来**。
  // 不跑真实的 25ms 定时器：把 `_tick()` 当帧手动驱动，点击声的排程时刻自己数。
  const clicks = []
  const fakeCtx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    resume: async () => { },
    createGain: () => ({
      gain: { value: 1, setValueAtTime() { }, exponentialRampToValueAtTime() { }, cancelScheduledValues() { } },
      connect() { },
    }),
    createOscillator: () => ({
      frequency: { value: 0 },
      type: '',
      connect() { },
      start(when) {
        clicks.push(when)
      },
      stop() { },
    }),
  }
  const prevWindow = globalThis.window
  globalThis.window = {
    AudioContext: function () {
      return fakeCtx
    },
  }
  try {
    // 每 0.5 秒一拍（120 BPM）；2× 倍速 = 位置每真实秒走 2 秒
    const clock = { now: 0, rate: 2, resync() { }, attach() { } }
    const provider = (t0, t1) => {
      const out = []
      for (let i = 0; i < 400; i++) {
        const at = i * 0.5
        if (at >= t0 && at <= t1) out.push({ time: at, accent: i % 4 === 0 })
      }
      return out
    }
    const mt = new Metronome()
    mt.setVolume(0.6)
    mt.start(provider, clock)
    clearInterval(mt.timer) // 关掉真实定时器：下面按帧驱动，测试不依赖真实时间
    mt.timer = 0

    // 走 0.6 秒真实时间（每帧 25ms → 位置走 0.05 秒）：这半秒里只有 1~2 拍，不该排成每帧一下
    mt.reset()
    clicks.length = 0
    clock.now = 10
    for (let i = 0; i < 12; i++) {
      mt._tick()
      clock.now += 0.05
    }
    ok('2× 倍速走 0.6 秒只排这几拍（不是每帧一下）', clicks.length <= 5, `${clicks.length} 下`)

    // 暂停：位置冻在 10.6（前瞻里已经排进去的是 11.0 那一拍），之后不该再排任何东西
    clock.now = 10.6
    const beforePause = clicks.length
    for (let i = 0; i < 40; i++) mt._tick()
    ok('暂停（位置冻住）后不再排新的点击声', clicks.length === beforePause, `又排了 ${clicks.length - beforePause} 下`)

    // 位置真的往回跳（seek 之后忘了 reset 的兜底）：重新对上之后照旧往前排，不许卡在旧窗口
    const beforeJump = clicks.length
    clock.now = 4
    for (let i = 0; i < 12; i++) {
      mt._tick()
      clock.now += 0.05
    }
    ok('位置往回跳之后能重新对上并接着往前排', clicks.length > beforeJump, `${clicks.length - beforeJump} 下`)
    mt.stop()
  } finally {
    if (prevWindow === undefined) delete globalThis.window
    else globalThis.window = prevWindow
  }
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

console.log('\n[12] errorToast 的文案一律是「动作失败：{msg}」')
{
  const files = (await readdir(SRC, { recursive: true })).filter((n) => /\.(js|vue)$/.test(n))
  const keys = new Set()
  for (const rel of files) {
    const text = await readFile(join(SRC, rel), 'utf8')
    for (const m of text.matchAll(/errorToast\(\s*t\(\s*'([^']+)'/g)) keys.add(m[1])
  }
  ok('源码里能找到 errorToast 的文案 key', keys.size > 0, `${keys.size} 个 key`)

  const missing = [...keys].filter((k) => flat[DEFAULT_LOCALE]?.[k] == null)
  ok('这些 key 都存在于默认语言包', missing.length === 0, missing.join('、'))

  const noMsg = [...keys].filter((k) => !String(flat[DEFAULT_LOCALE]?.[k] ?? '').includes('{msg}'))
  ok('每条 errorToast 文案都带 {msg}', noMsg.length === 0, noMsg.join('、'))

  ok('裸 errorToast(动态串) 也已清干净', !/\berrorToast\((?!\s*t\(')/.test(files.map((rel) => readFileSync(join(SRC, rel), 'utf8')).join('\n').replace(/export function errorToast[\s\S]*?\n}/, '')))

  const unknown = flat[DEFAULT_LOCALE]['common.unknown']
  ok('errText 取 Error.message', errText(new Error('炸了')) === '炸了', errText(new Error('炸了')))
  ok('errText 也吃裸字符串', errText('炸了') === '炸了')
  ok('errText 没有原因时给「未知错误」', errText('') === unknown && errText(null) === unknown && errText({}) === unknown)
  ok('errText 支持调用方自带兜底', errText('', '无音频') === '无音频')
}

console.log('\n[17] Markdown 解析（domain/markdown.js，只服务「操作说明」那一份 md）')
{
  /** 一串 spans 的纯文字（与模块里的 `plainText` 同一个口径） */
  const plain = (spans) => (spans || []).map((s) => s.v).join('').trim()
  const doc = renderMarkdown(
    [
      '# 操作说明',
      '',
      '第一段。',
      '第二行接在同一段里。',
      '',
      '## 导入乐谱',
      '',
      '- 拖进来',
      '- 或点按钮',
      '',
      '### 支持的格式',
      '',
      '1. PDF',
      '2. `.psz`',
      '',
      '> 一句提醒',
      '',
      '---',
      '',
      '正文里的 **粗体**、*斜体* 与 `代码`，还有 [说明](https://example.com/a?b=1)。',
      '',
      '```',
      'a ** b',
      '```',
      '',
      '## 播放',
      '',
      '<b>不是标签</b> & 原样文字',
    ].join('\n')
  )

  const headings = doc.blocks.filter((b) => b.type === 'heading')
  const lists = doc.blocks.filter((b) => b.type === 'list')
  const first = doc.blocks.find((b) => b.type === 'p')

  ok('第一个一级标题当 sheet 标题', doc.title === '操作说明', doc.title)
  ok('这个标题不在正文里重复画', !headings.some((h) => h.level === 1), headings.map((h) => h.level).join(','))
  ok('目录只有二级标题', doc.toc.map((x) => x.text).join('|') === '导入乐谱|播放', doc.toc.map((x) => x.text).join('|'))
  ok(
    '目录项的 id 与文字就是正文那个二级标题的',
    doc.toc.every((x) => headings.some((h) => h.level === 2 && h.id === x.id && plain(h.spans) === x.text)),
    JSON.stringify(doc.toc)
  )
  ok('三级标题在正文里、不进目录', headings.some((h) => h.level === 3 && plain(h.spans) === '支持的格式'))
  ok('段落里连续几行拼成一段', plain(first.spans) === '第一段。 第二行接在同一段里。', plain(first.spans))
  ok('无序列表：一项一行以下（不嵌套）', lists[0]?.ordered === false && lists[0].items.length === 2, JSON.stringify(lists[0]?.items.map(plain)))
  ok('有序列表也认', lists[1]?.ordered === true && lists[1].items.length === 2, JSON.stringify(lists[1]?.items.map(plain)))
  ok('引用块', doc.blocks.some((b) => b.type === 'quote' && plain(b.spans) === '一句提醒'))
  ok('分隔线', doc.blocks.some((b) => b.type === 'hr'))

  const rich = doc.blocks.find((b) => b.type === 'p' && b.spans.some((s) => s.t === 'link'))
  ok('粗体 / 斜体落在文字节点上', rich.spans.some((s) => s.t === 'text' && s.v === '粗体' && s.b) && rich.spans.some((s) => s.t === 'text' && s.v === '斜体' && s.i), JSON.stringify(rich.spans))
  ok('行内代码是单独的节点', rich.spans.some((s) => s.t === 'code' && s.v === '代码'))
  ok(
    '链接节点带文字与地址',
    rich.spans.some((s) => s.t === 'link' && s.v === '说明' && s.href === 'https://example.com/a?b=1'),
    JSON.stringify(rich.spans.filter((s) => s.t === 'link'))
  )
  ok('md 里的 HTML 就是普通文字（渲染交给 Vue 转义，模块不做转义）', doc.blocks.some((b) => b.type === 'p' && plain(b.spans) === '<b>不是标签</b> & 原样文字'))
  ok('代码块原样、里面的标记不解', doc.blocks.some((b) => b.type === 'code' && b.text === 'a ** b'), JSON.stringify(doc.blocks.find((b) => b.type === 'code')))

  // 链接：只认 http(s)；代码段 / 别的协议都不当链接（写错的地址宁可看着「没生效」）
  const links = (md) => renderMarkdown(`# t\n\n${md}`).blocks[0].spans
  ok('http 也认', links('[甲](http://example.com)')[0].href === 'http://example.com')
  ok('相对路径不当链接', links('[乙](foo.md)').every((s) => s.t === 'text') && plain(links('[乙](foo.md)')) === '[乙](foo.md)', JSON.stringify(links('[乙](foo.md)')))
  ok('别的协议（javascript:）不当链接', links('[丙](javascript:alert(1))').every((s) => s.t === 'text'), JSON.stringify(links('[丙](javascript:alert(1))')))
  ok('代码段里的链接写法不是链接', links('`[丁](https://example.com)`')[0].t === 'code', JSON.stringify(links('`[丁](https://example.com)`')))
  ok('没成对的 ** 原样留着（不会把后面整段变成粗体）', plain(links('**没关')) === '**没关' && links('**没关').every((s) => !s.b), JSON.stringify(links('**没关')))
  ok('成对的 ** 照旧开合（收尾不受影响）', JSON.stringify(links('**粗** 后面')) === JSON.stringify([{ t: 'text', v: '粗', b: true, i: false }, { t: 'text', v: ' 后面', b: false, i: false }]), JSON.stringify(links('**粗** 后面')))

  const marked = renderMarkdown('# 说明\n\n## 标题 `code` 与 **粗** 字')
  ok('目录那一行的文字去掉行内标记', marked.toc[0].text === '标题 code 与 粗 字', marked.toc[0].text)

  // 「key」：直接引用语言包（key 只认点号分层的 ASCII，普通中文引号不是 key；**角括号保留**）
  ok('「key」换成语言包里那条文案（角括号保留）', plain(links('「common.confirm」')) === '「确定」', plain(links('「common.confirm」')))
  ok('「key」外面的粗体照旧生效', links('**「common.confirm」**')[0]?.b === true, JSON.stringify(links('**「common.confirm」**')))
  ok(
    '没找到的 key 连角括号一起原样留着',
    plain(links('「nope.nothing」')) === '「nope.nothing」' && links('「nope.nothing」').every((s) => s.t === 'text'),
    plain(links('「nope.nothing」'))
  )
  ok(
    '普通中文引号不会被当成 key（照旧是引号）',
    plain(links('「翻页 / 标注」和「设置」')) === '「翻页 / 标注」和「设置」',
    plain(links('「翻页 / 标注」和「设置」'))
  )
  ok('引号里带空格的一律不是 key', plain(links('「common.confirm 」')) === '「common.confirm 」', plain(links('「common.confirm 」')))
  ok('换进来的文字不再当标记解析（只替换一层）', plain(links('「domain.error.zipReadFailed」')) === '「无法读取压缩包：{msg}」', plain(links('「domain.error.zipReadFailed」')))
  ok('代码段里的「key」不是引用', links('`「common.confirm」`')[0]?.t === 'code', JSON.stringify(links('`「common.confirm」`')))

  // 线上那份说明里的每个 key 都得真的存在（写错 key 会静默变成一串原文，只有这条能当场抓住）
  const manualSource = readFileSync(join(SRC, 'assets', 'manual.md'), 'utf8')
  const usedKeys = [...manualSource.matchAll(/「([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)」/g)].map((m) => m[1])
  const missingKeys = usedKeys.filter((k) => flat[DEFAULT_LOCALE]?.[k] == null)
  ok('说明里引用了语言包的 key', usedKeys.length > 0, `${usedKeys.length} 个：${usedKeys.join('、')}`)
  ok('说明里引用的 key 全都在语言包里', missingKeys.length === 0, missingKeys.join('、'))

  const noH1 = renderMarkdown('## 只有二级\n\n正文')
  ok('没有一级标题时不编标题（调用方自己兜底）', noH1.title === '')
  ok('空源码 / 非字符串都给空壳，不报错', renderMarkdown('').blocks.length === 0 && renderMarkdown(null).toc.length === 0 && renderMarkdown(undefined).title === '')
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败${fail ? ` → ${failures.join('、')}` : ''}`)
process.exit(fail ? 1 : 0)
