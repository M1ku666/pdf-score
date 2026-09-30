import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const PAGE = { width: 595.28, height: 841.89 }

export const FIXTURE = {
  page: PAGE,
  left: 64,
  right: 531,
  measuresPerSystem: 4,
  systemsPerPage: 3,
  staffSpace: 8,
  systemTops: [756, 596, 436],
  secondStaffDy: 62,
  bars: [64, 180.75, 297.5, 414.25, 531],
}

export function systemGeom(i) {
  const top = FIXTURE.systemTops[i % FIXTURE.systemsPerPage]
  const gap2 = FIXTURE.secondStaffDy
  const bottom = top - 4 * FIXTURE.staffSpace - gap2
  return { top, gap2, bottom, left: FIXTURE.left, right: FIXTURE.right }
}

function staffLines(top) {
  const o = []
  for (let l = 0; l < 5; l++) o.push(top - l * FIXTURE.staffSpace)
  return o
}

function brace(ops, sys) {
  const top = sys.top
  const bot = sys.bottom
  const x = sys.left - 6
  const mid = (top + bot) / 2
  ops.push('0.7 w 0 0 0 RG')
  ops.push(`${x + 7} ${top + 3} m ${x - 2} ${top - 6} ${x - 2} ${mid + 8} ${x + 3} ${mid} c S`)
  ops.push(`${x + 3} ${mid} m ${x - 2} ${mid - 8} ${x - 2} ${bot + 6} ${x + 7} ${bot - 3} c S`)
}

function notes(ops, sys, x, y, n, beamed) {
  ops.push('0 w 0 0 0 RG')
  for (let i = 0; i < n; i++) {
    const cx = x + i * 13
    ops.push(`${cx} ${y} m ${cx + 2.6} ${y + 1.6} ${cx + 2.6} ${y - 1.6} ${cx} ${y} c S`)
    ops.push(`${cx} ${y} m ${cx - 2.6} ${y + 1.6} ${cx - 2.6} ${y - 1.6} ${cx} ${y} c S`)
    if (i % 2 === 0) ops.push(`${cx + 2.6} ${y} m ${cx + 2.6} ${y + 26} l S`)
    else ops.push(`${cx - 2.6} ${y} m ${cx - 2.6} ${y - 26} l S`)
  }
  if (beamed) {
    for (const [dy, h] of [
      [26, 3],
      [22.5, 3],
    ]) {
      ops.push(`${x + 2.6} ${y + dy} m ${x + 2.6 + 13 * (n - 1)} ${y + dy} l ${x + 2.6 + 13 * (n - 1)} ${y + dy - h} l ${x + 2.6} ${y + dy - h} l h f`)
    }
  }
}

function buildPageOps(pageNo, tilt = 0, pages = 1) {
  const ops = []
  if (tilt) {
    const rad = (tilt * Math.PI) / 180
    const a = Math.cos(rad)
    const b = Math.sin(rad)
    const cx = PAGE.width / 2
    const cy = PAGE.height / 2
    const e = cx - a * cx + b * cy
    const f = cy - b * cx - a * cy
    ops.push('q')
    ops.push(`${a.toFixed(6)} ${b.toFixed(6)} ${(-b).toFixed(6)} ${a.toFixed(6)} ${e.toFixed(3)} ${f.toFixed(3)} cm`)
  }
  ops.push('BT /F1 16 Tf 64 810 Td (OMR Fixture - piano grand staff) Tj ET')
  ops.push(`BT /F1 9 Tf 64 796 Td (page ${pageNo} / ${pages}) Tj ET`)

  for (let s = 0; s < FIXTURE.systemsPerPage; s++) {
    const sys = systemGeom(s)
    brace(ops, sys)
    for (const top of [sys.top, sys.top - sys.gap2]) {
      for (const y of staffLines(top)) {
        ops.push('0.7 w 0 0 0 RG')
        ops.push(`${sys.left} ${y} m ${sys.right} ${y} l S`)
      }
      ops.push('1 w 0 0 0 RG')
      ops.push(`${sys.left + 6} ${top} m ${sys.left + 14} ${top - 16} ${sys.left + 2} ${top - 20} ${sys.left + 9} ${top - 32} c S`)
      ops.push(`BT /F1 14 Tf ${sys.left + 22} ${top - 22} Td (4) Tj ET`)
    }
    for (let m = 0; m <= FIXTURE.measuresPerSystem; m++) {
      const x = FIXTURE.bars[m]
      for (const top of [sys.top, sys.top - sys.gap2]) {
        ops.push('0.9 w 0 0 0 RG')
        ops.push(`${x} ${top} m ${x} ${top - 32} l S`)
        if (m === FIXTURE.measuresPerSystem) {
          ops.push('2.4 w 0 0 0 RG')
          ops.push(`${x - 5} ${top} m ${x - 5} ${top - 32} l S`)
        }
      }
    }
    notes(ops, sys, sys.left + 34, sys.top - 8, 4, true)
    notes(ops, sys, FIXTURE.bars[1] + 16, sys.top + 16, 4, false)
    const y3 = sys.top - 30
    ops.push('0.8 w 0 0 0 RG')
    ops.push(`${FIXTURE.bars[2] + 10} ${y3} m ${FIXTURE.bars[2] + 30} ${y3 + 22} ${FIXTURE.bars[3] - 30} ${y3 + 22} ${FIXTURE.bars[3] - 10} ${y3} c S`)
    const x4 = FIXTURE.bars[3] + 14
    const yw = sys.bottom - sys.gap2 - 14
    ops.push(`${x4} ${yw} m ${x4 + 46} ${yw + 7} l S`)
    ops.push(`${x4} ${yw} m ${x4 + 46} ${yw - 7} l S`)
    ops.push(`BT /F1 11 Tf ${x4} ${yw - 20} Td (mf) Tj ET`)
    ops.push(`BT /F1 10 Tf ${sys.left + 30} ${sys.bottom - 16} Td (la la la la la la la la) Tj ET`)
  }
  ops.push(`BT /F1 9 Tf 285 40 Td (- ${pageNo} -) Tj ET`)
  if (tilt) ops.push('Q')
  return ops.join('\n')
}

function buildPdf(tilt, pages) {
  const contents = []
  for (let p = 0; p < pages; p++) contents.push(buildPageOps(p + 1, tilt, pages))
  const objects = []
  const pageCount = pages
  const firstPageObj = 3
  const contentStart = firstPageObj + pageCount
  const fontObj = contentStart + pageCount
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  const kids = []
  for (let i = 0; i < pageCount; i++) kids.push(`${firstPageObj + i} 0 R`)
  objects[2] = `<< /Type /Pages /Count ${pageCount} /Kids [${kids.join(' ')}] >>`
  for (let i = 0; i < pageCount; i++) {
    objects[firstPageObj + i] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentStart + i} 0 R >>`
    const stream = contents[i]
    objects[contentStart + i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  }
  objects[fontObj] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  let out = '%PDF-1.4\n'
  const offsets = []
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefPos = out.length
  const total = objects.length
  out += `xref\n0 ${total}\n0000000000 65535 f \n`
  for (let i = 1; i < total; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  out += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  return bytes
}

export function groundTruth({ tilt = 0, pages = 1 } = {}) {
  const rad = (tilt * Math.PI) / 180
  const rot = (x, y) => {
    if (!tilt) return [x, y]
    const a = Math.cos(rad)
    const b = Math.sin(rad)
    const cx = PAGE.width / 2
    const cy = PAGE.height / 2
    const e = cx - a * cx + b * cy
    const f = cy - b * cx - a * cy
    return [a * x - b * y + e, b * x + a * y + f]
  }
  const out = { page: PAGE, systemsPerPage: FIXTURE.systemsPerPage, measuresPerSystem: FIXTURE.measuresPerSystem, pages: [] }
  for (let p = 0; p < pages; p++) {
    const systems = []
    for (let s = 0; s < FIXTURE.systemsPerPage; s++) {
      const sys = systemGeom(s)
      const [x0, yTopRaw] = rot(sys.left, sys.top)
      const [, yBotRaw] = rot(sys.left, sys.bottom)
      const [, yTopRight] = rot(sys.right, sys.top)
      const [, yBotRight] = rot(sys.right, sys.bottom)
      systems.push({
        y0: Math.max(yTopRaw, yTopRight),
        y1: Math.min(yBotRaw, yBotRight),
        yTop: Math.max(yTopRaw, yTopRight),
        yBottom: Math.min(yBotRaw, yBotRight),
        bars: FIXTURE.bars.map((x) => {
          const [bx] = rot(x, sys.top)
          return Math.round(bx * 100) / 100
        }),
      })
    }
    systems.sort((a, b) => b.y0 - a.y0)
    out.pages.push({ width: PAGE.width, height: PAGE.height, systems })
  }
  return out
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/omr-fixture.mjs')
if (isMain) {
  const args = process.argv.slice(2)
  const tilt = Number((args.find((a) => a.startsWith('--tilt=')) || '').split('=')[1] || 0)
  const pages = Number((args.find((a) => a.startsWith('--pages=')) || '').split('=')[1] || 2)
  const outArg = args.find((a) => !a.startsWith('--')) || 'artifacts/omr-fixture.pdf'
  const file = resolve(outArg)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, buildPdf(tilt, pages))
  const gtFile = file.replace(/\.pdf$/, '.truth.json')
  writeFileSync(gtFile, JSON.stringify(groundTruth({ tilt, pages }), null, 2))
  console.log(`已生成 ${file}（${pages} 页${tilt ? `，倾斜 ${tilt}°` : ''}）与标准答案 ${gtFile}`)
}

export { buildPdf }
