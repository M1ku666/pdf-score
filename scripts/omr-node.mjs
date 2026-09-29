/**
 * OMR 调参跑分器（**纯 node**，一次性工具，不属于应用代码）。
 *
 * 桌面上那三份谱子每页都是「整页一张位图」，所以不需要浏览器：
 * `pdf-page-image.mjs` 直接把那张位图解码出来（与浏览器 200 DPI 渲染同样的像素），
 * 再喂给 `src/domain/omr.js` 跑识别 —— 这样调参时看到的数就是应用里真实的数。
 *
 * 用法：
 *   node scripts/omr-node.mjs --pdf=artifacts/pdfs/cycle.pdf                 # 全部页、200 DPI
 *   node scripts/omr-node.mjs --pdf=... --pages=1 --dpi=200 --png=1          # 画识别结果图
 *   node scripts/omr-node.mjs --pdf=... --json=artifacts/out.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { binarize, detectPageSystems, findStaves, toMetaSystems, OMR_DPI, OMR_DEFAULTS } from '../src/domain/omr.js'
import { openPdfPageImages } from './pdf-page-image.mjs'
import { encodePng, hLine, strokeRect, vLine } from './png.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=')
    return [k, rest.join('=') || '1']
  })
)
const pdf = args.pdf
if (!pdf) {
  console.error('用法：node scripts/omr-node.mjs --pdf=<pdf> [--pages=1,2] [--dpi=200] [--png=1] [--json=out.json]')
  process.exit(2)
}
const dpi = Number(args.dpi || OMR_DPI)
const scale = dpi / 72
const wantPng = args.png === '1' || !!args.pngdir
const pageFilter = (args.pages || '')
  .split(',')
  .map(Number)
  .filter((n) => Number.isFinite(n) && n > 0)
const tuning = args.tune ? JSON.parse(args.tune) : {}
// 调参用的扁平写法（PowerShell 传 JSON 太容易打架）：`--linePeakRatio=0.5 --systemGapTight=2.5`
for (const [k, v] of Object.entries(args)) {
  if (k in OMR_DEFAULTS) tuning[k] = Number(v)
}
const binOpts = args.bin ? JSON.parse(args.bin) : {}
if (args.inkDelta !== undefined) binOpts.inkDelta = Number(args.inkDelta)
if (args.windowRatio !== undefined) binOpts.windowRatio = Number(args.windowRatio)
const windowPx = args.window ? Number(args.window) : null
const outDir = resolve(root, args.pngdir || 'artifacts/omr-shots')
if (wantPng) mkdirSync(outDir, { recursive: true })
const label = basename(pdf, '.pdf')

/** 从 RGBA 缓冲里裁一块出来（审阅单行时用） */
function cropRgba(src, sw, x0, y0, x1, y1) {
  const w = Math.max(1, x1 - x0)
  const h = Math.max(1, y1 - y0)
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = ((y + y0) * sw + (x + x0)) * 4
      const q = (y * w + x) * 4
      data[q] = src[p]
      data[q + 1] = src[p + 1]
      data[q + 2] = src[p + 2]
      data[q + 3] = 255
    }
  }
  return { data, width: w, height: h }
}

/** `--debug=1`：把线候选 / 分组 / 谱表 / 合行全打出来，定位「为什么这行没认出来」 */function dumpStaves(st, res) {
  console.log(`  [debug] 线候选 ${st.lines.length} 条：`)
  st.lines.forEach((l, i) => {
    console.log(`    #${i} y=${l.y.toFixed(1)} ink=${l.ink.toFixed(3)} prom=${(l.prominence ?? 0).toFixed(2)} thick=${l.thickness} x=${l.x0}..${l.x1}`)
  })
  console.log(`  [debug] 谱表 ${st.staves.length} 条：`)
  st.staves.forEach((s, i) => {
    console.log(`    S${i} y=${s.yTop.toFixed(1)}..${s.yBottom.toFixed(1)} space=${s.space.toFixed(2)} count=${s.count} filled=${s.filled} x=${s.x0}..${s.x1}`)
  })
  console.log(`  [debug] 合行 trace：`)
  for (const t of res.diag.trace) console.log(`    yTop=${t.yTop} gap=${t.gap} connector=${t.connector} join=${t.join}`)
}

const doc = await openPdfPageImages(pdf, { vector: args.vector === '1' })
const pageNums = pageFilter.length ? pageFilter : Array.from({ length: doc.numPages }, (_, i) => i + 1)
const report = { pdf: basename(pdf), dpi, windowPx, binOpts, tuning, pages: [] }

for (const n of pageNums) {
  const img = await doc.pageImage(n, scale)
  const pageSize = await doc.pageSize(n)
  const t0 = Date.now()
  const bins = binarize(img.data, img.width, img.height, windowPx || Math.max(6, scale * 4), binOpts || {})
  bins.scale = scale
  const detectMs = Date.now() - t0
  let ink = 0
  for (let i = 0; i < bins.bins.length; i++) ink += bins.bins[i]
  const inkRatio = ink / bins.bins.length
  const t1 = Date.now()
  const res = detectPageSystems(bins, tuning)
  const runMs = Date.now() - t1
  const st = findStaves(bins, tuning)
  if (args.debug === '1') dumpStaves(st, res)
  const info = {
    page: n,
    pixels: `${img.width}x${img.height}`,
    pt: `${pageSize.width.toFixed(1)}x${pageSize.height.toFixed(1)}`,
    inkRatio: Number(inkRatio.toFixed(4)),
    binarizeMs: detectMs,
    detectMs: runMs,
    staffSpacePx: Number((res.staffSpace || 0).toFixed(2)),
    skew: Number((res.skew || 0).toFixed(4)),
    lines: st.lines.length,
    staves: st.staves.length,
    systems: res.systems.length,
    measures: res.systems.reduce((a, s) => a + s.measures, 0),
    detail: res.systems.map((s) => ({
      yTop: Number(s.yTop.toFixed(1)),
      yBottom: Number(s.yBottom.toFixed(1)),
      staffCount: s.staffCount,
      bars: s.bars.length,
      barXs: s.barXs.map((x) => Number(x.toFixed(1))),
    })),
    debug: res.diag.debug,
    groupTrace: res.diag.trace.map((t) => ({ ...t, lastBottom: undefined })),
    staffDetail: st.staves.map((s) => ({
      yTop: Number(s.yTop.toFixed(1)),
      yBottom: Number(s.yBottom.toFixed(1)),
      space: Number(s.space.toFixed(2)),
      count: s.count,
      x0: Number(s.x0.toFixed(0)),
      x1: Number(s.x1.toFixed(0)),
    })),
    lineDetail: st.lines.map((l) => ({
      y: Number(l.y.toFixed(1)),
      x0: Number(l.x0.toFixed(0)),
      x1: Number(l.x1.toFixed(0)),
      ink: Number(l.ink.toFixed(3)),
      thick: l.thickness,
    })),    rowRatioTop: Array.from(st.rowRatio)
      .map((v, y) => ({ y, v: Number(v.toFixed(3)) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 60),
    rowRatio: Array.from(st.rowRatio).map((v) => Number(v.toFixed(3))),
  }
  report.pages.push(info)
  console.log(
    `第 ${n} 页 ${info.pixels}px (${info.pt}pt) 墨比 ${info.inkRatio} | 谱线行 ${info.lines} 谱表 ${info.staves} 行 ${info.systems} 小节 ${info.measures} | 行距 ${info.staffSpacePx}px | ${info.detectMs}ms`
  )
  for (const s of info.detail) {
    console.log(`    行 y ${s.yTop}..${s.yBottom} 谱表×${s.staffCount} ${s.bars} 条线 = ${s.bars - 1} 小节`)
  }

  if (wantPng) {
    const out = new Uint8ClampedArray(img.data)
    for (const s of st.staves) hLine(out, img.width, img.height, Math.round(s.x0), Math.round(s.x1), Math.round(s.yTop), [0, 140, 255], 1)
    for (const s of res.systems) {
      const yT = Math.round(s.yTop)
      const yB = Math.round(s.yBottom)
      strokeRect(out, img.width, img.height, Math.round(s.x0), yT, Math.round(s.x1), yB, [0, 160, 0], 2)
      for (const x of s.bars) vLine(out, img.width, img.height, Math.round(x), yT, yB, [230, 0, 60], 2)
    }
    const file = resolve(outDir, `${label}-p${n}-${dpi}dpi.png`)
    writeFileSync(file, encodePng(out, img.width, img.height))
    console.log(`    图：${file}`)
  }
  // 逐行裁出来（每行一张图）：审阅「这一行的小节线对不对」时不用对着整页缩放
  if (args.crops === '1') {
    for (let i = 0; i < res.systems.length; i++) {
      const s = res.systems[i]
      const out = new Uint8ClampedArray(img.data)
      for (const line of st.staves) {
        if (line.yTop < s.yTop - 40 || line.yTop > s.yBottom + 40) continue
        hLine(out, img.width, img.height, Math.round(line.x0), Math.round(line.x1), Math.round(line.yTop), [0, 140, 255], 1)
      }
      for (const x of s.bars) vLine(out, img.width, img.height, Math.round(x), Math.round(s.yTop), Math.round(s.yBottom), [230, 0, 60], 2)
      strokeRect(out, img.width, img.height, Math.round(s.x0), Math.round(s.yTop), Math.round(s.x1), Math.round(s.yBottom), [0, 160, 0], 2)
      const y0 = Math.max(0, Math.round(s.yTop) - Math.round((st.staffSpace || 20) * 2.5))
      const y1 = Math.min(img.height, Math.round(s.yBottom) + Math.round((st.staffSpace || 20) * 2.5))
      const x0 = Math.max(0, Math.round(s.x0) - 40)
      const x1 = Math.min(img.width, Math.round(s.x1) + 40)
      const crop = cropRgba(out, img.width, x0, y0, x1, y1)
      const file = resolve(outDir, `row-${label}-p${n}-r${String(i + 1).padStart(2, '0')}.png`)
      writeFileSync(file, encodePng(crop.data, crop.width, crop.height))
    }
    console.log(`    逐行图 ${res.systems.length} 张 → ${outDir}/row-${label}-p${n}-r*.png`)
  }
}
await doc.destroy?.()
if (args.json) {
  mkdirSync(dirname(resolve(root, args.json)), { recursive: true })
  writeFileSync(resolve(root, args.json), JSON.stringify(report, null, 2))
  console.log(`报告：${args.json}`)
}
