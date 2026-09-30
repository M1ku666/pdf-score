import { binarize, columnRuns, detectPageSystems, findStaves, groupSystems, OMR_DEFAULTS } from '../src/domain/omr.js'
import { openPdfPageImages } from './pdf-page-image.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=')
    return [k, rest.join('=') || '1']
  })
)
const pdf = args.pdf
const page = Number(args.page || 1)
const dpi = Number(args.dpi || 200)
const scale = dpi / 72
const which = Number(args.system !== undefined ? args.system : 0)
const cov = args.cov ? Number(args.cov) : 0.9
const tuning = { ...OMR_DEFAULTS }
for (const [k, v] of Object.entries(args)) if (k in OMR_DEFAULTS) tuning[k] = Number(v)

const doc = await openPdfPageImages(pdf)
const img = await doc.pageImage(page, scale)
const ctx = binarize(img.data, img.width, img.height, Math.max(6, scale * 4))
ctx.scale = scale
const st = findStaves(ctx, tuning)
const { systems } = groupSystems(ctx, st.staves, tuning)
const sys = systems[which]
if (!sys) {
  console.log(`没有第 ${which} 行（共 ${systems.length}）`)
  process.exit(1)
}
const full = detectPageSystems(ctx, tuning).systems[which]
sys.bars = full ? full.bars : []

const top = Math.max(0, Math.round(sys.yTop))
const bottom = Math.min(ctx.height - 1, Math.round(sys.yBottom))
const space = sys.space || 20
const expand = Math.round(space * 0.5)
const edgeTop = Math.max(0, top - expand)
const edgeBottom = Math.min(ctx.height, bottom + expand + 1)
const maxGap = Math.max(1, Math.round(space * tuning.closeRatio))
const bands = sys.staves.map((s) => {
  const half = Math.max(2, Math.round(s.space * 0.3))
  return [Math.max(edgeTop, Math.round(s.yTop) - half), Math.min(edgeBottom - 1, Math.round(s.yBottom) + half)]
})
console.log(`== ${pdf} p${page} @${dpi}dpi 第 ${which} 行 y ${top}..${bottom} 谱表 ${sys.staves.length} space=${space.toFixed(1)}`)
console.log(`  条带：${bands.map(([a, b]) => `${a}..${b}(${b - a + 1})`).join('  ')}  maxGap=${maxGap} barSlack=${tuning.barSlack}`)

const width = ctx.width
const cols = []
for (let x = 0; x < width; x++) {
  const runs = columnRuns(ctx.bins, width, x, edgeTop, edgeBottom, maxGap)
  const per = bands.map(([lo, hi]) => {
    let best = 0
    let segs = 0
    let total = 0
    for (const [a, b] of runs) {
      const s = Math.max(a, lo)
      const e = Math.min(b, hi)
      if (e < s) continue
      best = Math.max(best, e - s + 1)
      total += e - s + 1
      segs++
    }
    return { best, segs, total, len: hi - lo + 1 }
  })
  let worst = Infinity
  for (const p of per) worst = Math.min(worst, (p.best - p.len * tuning.barSlack) / p.len)
  cols.push({ x, per, score: worst > 0 ? worst : 0 })
}
const maxScore = Math.max(...cols.map((c) => c.score))
console.log(`  最高分 ${maxScore.toFixed(3)}`)

const interesting = cols.filter((c) => c.score >= maxScore * cov)
const runsOut = []
let cur = null
for (const c of interesting) {
  if (cur && c.x - cur.to <= 2) {
    cur.to = c.x
    cur.cols.push(c)
  } else {
    if (cur) runsOut.push(cur)
    cur = { from: c.x, to: c.x, cols: [c] }
  }
}
if (cur) runsOut.push(cur)

console.log(`\n候选竖线（分数 ≥ 最高分 × ${cov}）：`)
for (const r of runsOut) {
  const mid = r.cols[Math.floor(r.cols.length / 2)]
  const net = mid.per.map((p) => p.best).join('/')
  const segs = mid.per.map((p) => p.segs).join('/')
  const mark = sys.bars.some((b) => Math.abs(b - mid.x) <= 2) ? ' ★已采纳' : ''
  console.log(`  x ${String(r.from).padStart(5)}..${String(r.to).padEnd(5)} 分 ${mid.score.toFixed(3)} 净墨段 ${net} 段数 ${segs}${mark}`)
}
if (args.col) {
  const X = Number(args.col)
  const runs = columnRuns(ctx.bins, width, X, edgeTop, edgeBottom, maxGap)
  console.log(`\n列 x=${X} 在 ${edgeTop}..${edgeBottom} 的墨段（已按 maxGap=${maxGap} 闭合）：`)
  for (const [a, b] of runs) console.log(`  ${a}..${b} (${b - a + 1})`)
  const raw = columnRuns(ctx.bins, width, X, edgeTop, edgeBottom, 0)
  console.log(`  未闭合的原始墨段：${raw.map(([a, b]) => `${a}..${b}(${b - a + 1})`).join(' ')}`)
}
await doc.destroy?.()
