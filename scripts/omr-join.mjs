/**
 * 「同一行的谱表是靠什么连起来的」实测（一次性诊断脚本，不属于应用代码）。
 *
 * 对每一对相邻谱表，量三件事：
 *   · 行内间距 / 行距 的比值
 *   · 两条谱表的小节线起点对不对得上（左端 x 差多少）
 *   · 两谱表之间的空隙里，有没有一根竖线把两边连起来（大括号 / 系统小节线）
 *
 * 用法：node scripts/omr-join.mjs --pdf=artifacts/pdfs/jigoku.pdf --page=1
 */
import { binarize, columnRuns, findBars, findStaves, OMR_DEFAULTS } from '../src/domain/omr.js'
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
const pages = (args.pages || '1').split(',').map(Number)
const tuning = { ...OMR_DEFAULTS }
for (const [k, v] of Object.entries(args)) if (k in OMR_DEFAULTS) tuning[k] = Number(v)

const doc = await openPdfPageImages(pdf)
for (const page of pages) {
  const img = await doc.pageImage(page, scale)
  const ctx = binarize(img.data, img.width, img.height, Math.max(6, scale * 4))
  ctx.scale = scale
  const st = findStaves(ctx, tuning)
  const staves = st.staves
  console.log(`\n== ${pdf} 第 ${page} 页：谱表 ${staves.length} 条`)
  for (let i = 0; i < staves.length; i++) {
    const s = staves[i]
    const r = findBars(ctx, { ...s, staves: [s], space: s.space, yTop: s.yTop, yBottom: s.yBottom }, tuning)
    const bars = r.bars || []
    console.log(
      `  S${String(i).padStart(2)} y ${s.yTop.toFixed(0)}..${s.yBottom.toFixed(0)} space ${s.space.toFixed(1)} 线${s.count} bars=${bars.length} x0=${bars[0]?.toFixed(0)} x1=${bars[bars.length - 1]?.toFixed(0)}`
    )
    if (i > 0) {
      const prev = staves[i - 1]
      const gap = s.yTop - prev.yBottom
      // 空隙里有没有连起来的墨：在两谱表之间逐列量最长竖墨段
      const gapTop = Math.round(prev.yBottom)
      const gapBottom = Math.round(s.yTop)
      let connector = 0
      let connectorX = -1
      for (let x = 0; x < ctx.width; x++) {
        const runs = columnRuns(ctx.bins, ctx.width, x, gapTop, gapBottom, 0)
        for (const [a, b] of runs) {
          if (b - a + 1 > connector) {
            connector = b - a + 1
            connectorX = x
          }
        }
      }
      const gapLen = Math.max(1, gapBottom - gapTop)
      const ratio = gap / prev.space
      console.log(
        `      ↑间距 ${gap.toFixed(0)}px = ${ratio.toFixed(2)}×行距 | 空隙里的最长竖墨 ${connector}/${gapLen}px @x=${connectorX} | 上谱表首线 x=${findBars(ctx, { ...prev, staves: [prev] }, tuning).bars[0]?.toFixed(0)} 本谱表首线 x=${bars[0]?.toFixed(0)}`
      )
    }
  }
}
await doc.destroy?.()
