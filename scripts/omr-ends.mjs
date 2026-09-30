import { binarize, columnRuns, findBars, findStaves, groupSystems, OMR_DEFAULTS } from '../src/domain/omr.js'
import { openPdfPageImages } from './pdf-page-image.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=')
    return [k, rest.join('=') || '1']
  })
)
const pdf = args.pdf
const dpi = Number(args.dpi || 200)
const scale = dpi / 72
const pages = (args.pages || '1,2,3').split(',').map(Number)
const t = { ...OMR_DEFAULTS }
for (const [k, v] of Object.entries(args)) if (k in OMR_DEFAULTS) t[k] = Number(v)

function fill(ctx, x, yTop, yBottom, slack = 2) {
  const height = Math.max(1, yBottom - yTop + 1)
  let best = 0
  for (let dx = -slack; dx <= slack; dx++) {
    const cx = Math.round(x) + dx
    if (cx < 0 || cx >= ctx.width) continue
    const runs = columnRuns(ctx.bins, ctx.width, cx, yTop, yBottom + 1, 0)
    let first = -1
    let last = -1
    for (const [a, b] of runs) {
      if (b < yTop || a > yBottom) continue
      if (first < 0) first = Math.max(a, yTop)
      last = Math.min(b, yBottom)
    }
    best = Math.max(best, first < 0 ? 0 : last - first + 1)
  }
  return best / height
}

const doc = await openPdfPageImages(pdf)
for (const page of pages) {
  const img = await doc.pageImage(page, scale)
  const ctx = binarize(img.data, img.width, img.height, Math.max(6, scale * 4))
  ctx.scale = scale
  const st = findStaves(ctx, t)
  const { systems } = groupSystems(ctx, st.staves, t)
  console.log(`\n== ${pdf} p${page}：${systems.length} 行  rowEndGap=${t.rowEndGap} × 行距`)
  systems.forEach((sys, i) => {
    const space = sys.space || 10
    const yTop = Math.max(0, Math.round(sys.yTop))
    const yBottom = Math.min(ctx.height - 1, Math.round(sys.yBottom))
    const left = Math.min(...sys.staves.map((s) => s.x0))
    const right = Math.max(...sys.staves.map((s) => s.x1))
    const { bars } = findBars(ctx, sys, t)
    if (!bars.length) return
    const need = space * t.rowEndGap
    const first = bars[0]
    const last = bars[bars.length - 1]
    const L = { gap: first - left, f: fill(ctx, left, yTop, yBottom) }
    const R = { gap: right - last, f: fill(ctx, right, yTop, yBottom) }
    const verdict = (side) =>
      side.gap <= need ? '贴着边·不补' : side.f >= t.rowEndFillRatio ? '★补' : '没墨·不补'
    console.log(
      `  r${i} 谱表 ${left}..${right} 行距${space.toFixed(1)} 门槛${need.toFixed(0)} | 首线${first} 差${L.gap.toFixed(0)} 墨${L.f.toFixed(2)} → ${verdict(L)} | 末线${last} 差${R.gap.toFixed(0)} 墨${R.f.toFixed(2)} → ${verdict(R)}`
    )
  })
}
await doc.destroy?.()
