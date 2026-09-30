import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const FONTS = join(here, '..', 'src', 'assets', 'fonts')

function readMetrics(file) {
  const b = readFileSync(file)
  const numTables = b.readUInt16BE(4)
  const tables = {}
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16
    tables[b.toString('latin1', o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) }
  }
  const head = tables.head.off
  const unitsPerEm = b.readUInt16BE(head + 18)
  const hhea = tables.hhea.off
  const hAsc = b.readInt16BE(hhea + 4)
  const hDesc = b.readInt16BE(hhea + 6)
  const hGap = b.readInt16BE(hhea + 8)
  let oAsc = null, oDesc = null, oGap = null, typoAsc = null, typoDesc = null, typoGap = null
  if (tables['OS/2']) {
    const os2 = tables['OS/2'].off
    const ver = b.readUInt16BE(os2)
    typoAsc = b.readInt16BE(os2 + 68)
    typoDesc = b.readInt16BE(os2 + 70)
    typoGap = b.readInt16BE(os2 + 72)
    oAsc = b.readInt16BE(os2 + 74)
    oDesc = b.readInt16BE(os2 + 76)
    oGap = null
    if (ver >= 2 && tables['OS/2'].len >= 90) oGap = b.readInt16BE(os2 + 78)
  }
  return { unitsPerEm, hAsc, hDesc, hGap, typoAsc, typoDesc, typoGap, oAsc, oDesc, oGap }
}

const files = {
  Regular: 'HarmonyOS_Sans_SC_Regular.ttf',
  Medium: 'HarmonyOS_Sans_SC_Medium.ttf',
  Bold: 'HarmonyOS_Sans_SC_Bold.ttf',
}

for (const [name, f] of Object.entries(files)) {
  const m = readMetrics(join(FONTS, f))
  const u = m.unitsPerEm
  console.log(`\n=== ${name} (${f})  unitsPerEm=${u} ===`)
  console.log(`  hhea  ascent/descent/lineGap = ${m.hAsc} / ${m.hDesc} / ${m.hGap}` +
    `  → em: ${(m.hAsc / u).toFixed(4)} / ${(m.hDesc / u).toFixed(4)} / ${(m.hGap / u).toFixed(4)}`)
  console.log(`  OS/2  typo = ${m.typoAsc} / ${m.typoDesc} / ${m.typoGap}` +
    `  → em: ${(m.typoAsc / u).toFixed(4)} / ${(m.typoDesc / u).toFixed(4)} / ${(m.typoGap / u).toFixed(4)}`)
  console.log(`  OS/2  win  = ${m.oAsc} / ${m.oDesc}` +
    `  → em: ${(m.oAsc / u).toFixed(4)} / ${(m.oDesc / u).toFixed(4)}`)

  const A = m.hAsc / u, D = Math.abs(m.hDesc) / u, gap = m.hGap / u
  console.log(`  → normal 行高 = ${(A + D + gap).toFixed(4)} em（Blink：hhea 的 A + D + lineGap）`)

  const topToBaseline = (fontPx, lhMul = 1.15) => {
    const L = fontPx * lhMul
    const fontBox = fontPx * (A + D + gap)
    const half = (L - fontBox) / 2
    return { L, topToBaseline: half + fontPx * A, bottomToBoxBottom: half + fontPx * D, fontBox }
  }
  const big = topToBaseline(15)
  const sub = topToBaseline(11.5)
  console.log(`  15px   @1.15：L=${big.L.toFixed(3)}  盒顶→基线=${big.topToBaseline.toFixed(3)}  字体盒=${big.fontBox.toFixed(3)}`)
  console.log(`  11.5px @1.15：L=${sub.L.toFixed(3)}  盒顶→基线=${sub.topToBaseline.toFixed(3)}  字体盒=${sub.fontBox.toFixed(3)}`)
  console.log(`  ⇒ 两段按 baseline 对齐时的错位 = ${(big.topToBaseline - sub.topToBaseline).toFixed(3)}px` +
    `（小字被抬高这么多 = 上标）`)

  const sub1 = topToBaseline(11.5, 1.0)
  console.log(`  11.5px @1.00：L=${sub1.L.toFixed(3)}  盒顶→基线=${sub1.topToBaseline.toFixed(3)}`)
  console.log(`  ⇒ 把两段都收到 line-height:1 后，错位 = ${(topToBaseline(15, 1).topToBaseline - sub1.topToBaseline).toFixed(3)}px`)

  const strut = big
  const subHalfLeading = (sub1.L - sub.fontBox) / 2
  const subTopOffset = halfLeadingTop(big) - subHalfLeading
  const subAscent = subTopOffset + 11.5 * A
  const subDescent = sub1.L - subAscent
  console.log(`  小字 inline box（11.5px@1）相对父级 strut 顶偏移 = ${subTopOffset.toFixed(3)}` +
    `  其上升=${subAscent.toFixed(3)} 下降=${subDescent.toFixed(3)}`)
  console.log(`  父级 strut：上升=${strut.topToBaseline.toFixed(3)} 下降=${strut.bottomToBoxBottom.toFixed(3)}`)
  const grows = Math.max(strut.topToBaseline, subAscent) + Math.max(strut.bottomToBoxBottom, subDescent) - strut.L
  console.log(`  ⇒ 行盒高增量 = ${grows.toFixed(3)}px` + (grows > 0.001 ? '  ⚠️ 会被撑高' : '  ✅ 不变'))
}

function halfLeadingTop(m) { return (m.L - m.fontBox) / 2 }
