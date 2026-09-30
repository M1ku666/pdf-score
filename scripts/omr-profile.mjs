import { binarize, rowInkRatios, OMR_DEFAULTS } from '../src/domain/omr.js'
import { openPdfPageImages } from './pdf-page-image.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=')
    return [k, rest.join('=') || '1']
  })
)
const pdf = args.pdf || 'artifacts/pdfs/cycle.pdf'
const page = Number(args.page || 1)
const dpi = Number(args.dpi || 200)
const scale = dpi / 72
const tuning = { ...OMR_DEFAULTS, ...(args.bin ? JSON.parse(args.bin) : {}) }
const windowPx = args.window ? Number(args.window) : Math.max(6, scale * 4)

const doc = await openPdfPageImages(pdf)
const img = await doc.pageImage(page, scale)
console.log(`== ${pdf} 第 ${page} 页 @${dpi}dpi ${img.width}x${img.height} 窗口 ${windowPx}px inkDelta=${tuning.inkDelta}`)

const gray = new Float64Array(img.width * img.height)
for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (img.data[p] * 299 + img.data[p + 1] * 587 + img.data[p + 2] * 114) / 1000
const probeX = Number(args.x || Math.round(img.width * 0.35))
const probeY0 = Number(args.y || 120)
const probeY1 = Number(args.y1 || 220)
let s = `灰度剖面 x=${probeX} y=${probeY0}..${probeY1}：`
for (let y = probeY0; y < probeY1; y++) s += `${y}:${Math.round(gray[y * img.width + probeX])} `
console.log(s)

if (args.scan === '1') {
  const from = Number(args.from || 0)
  const to = Number(args.to || img.height)
  const mean = new Float64Array(img.height)
  for (let y = from; y < to; y++) {
    let sum = 0
    for (let x = 0; x < img.width; x++) sum += gray[y * img.width + x]
    mean[y] = sum / img.width
  }
  for (let y = from; y < to; y++) {
    if (mean[y] > 240) continue
    console.log(`  行均灰度 ${String(y).padStart(5)} ${mean[y].toFixed(1)}`)
  }
}

const bins = binarize(img.data, img.width, img.height, windowPx, tuning)
const ratio = rowInkRatios(bins.bins, img.width, img.height)
let worst = 0
for (let y = 0; y < img.height; y++) worst = Math.max(worst, ratio[y])
console.log(`最高行墨迹占比 ${worst.toFixed(3)}`)
const y0 = Number(args.from || 0)
const y1 = Number(args.to || img.height)
const bars = ' .:-=+*#%@'
for (let y = y0; y < y1; y++) {
  const v = ratio[y]
  const bar = bars[Math.min(bars.length - 1, Math.floor((v / Math.max(0.001, worst)) * (bars.length - 1)))]
  if (v > 0.15 || (args.all === '1' && y % 1 === 0)) {
    console.log(`${String(y).padStart(5)} ${v.toFixed(3)} ${bar.repeat(Math.max(0, Math.round(v * 60)))}`)
  }
}
await doc.destroy?.()
