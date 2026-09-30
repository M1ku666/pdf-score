import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { buildDemoScore } from '../src/dev/demo.js'

const require = createRequire(import.meta.url)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => import('pdfjs-dist/build/pdf.mjs'))

function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}
function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

async function pageSegments(page) {
  const { OPS, DrawOPS } = pdfjs
  const ops = await page.getOperatorList()
  const viewport = page.getViewport({ scale: 1, rotation: 0 })
  const v = viewport.transform
  const det = v[0] * v[3] - v[1] * v[2]
  const inv = [v[3] / det, -v[1] / det, -v[2] / det, v[0] / det, 0, 0]
  inv[4] = -(inv[0] * v[4] + inv[2] * v[5])
  inv[5] = -(inv[1] * v[4] + inv[3] * v[5])

  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  const h = []
  const vlines = []
  const counts = {}
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]
    counts[fn] = (counts[fn] || 0) + 1
    if (fn === OPS.save) stack.push(ctm.slice())
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.transform) ctm = multiply(ctm, args)
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm.slice())
      if (args?.[0]) ctm = multiply(ctm, args[0])
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.constructPath) {
      const buffer = args?.[1]?.[0]
      if (!buffer) continue
      let cx = 0
      let cy = 0
      let sx = 0
      let sy = 0
      for (let k = 0; k < buffer.length; ) {
        const op = buffer[k++]
        if (op === DrawOPS.moveTo || op === DrawOPS.lineTo) {
          const x = buffer[k++]
          const y = buffer[k++]
          const p = apply(ctm, x, y)
          const q = apply(inv, p[0], p[1])
          if (op === DrawOPS.moveTo) {
            sx = q[0]
            sy = q[1]
          } else {
            pushSeg(h, vlines, cx, cy, q[0], q[1])
          }
          cx = q[0]
          cy = q[1]
        } else if (op === DrawOPS.curveTo) {
          const x = buffer[k + 4]
          const y = buffer[k + 5]
          k += 6
          const p = apply(ctm, x, y)
          const q = apply(inv, p[0], p[1])
          cx = q[0]
          cy = q[1]
        } else if (op === DrawOPS.closePath) {
          pushSeg(h, vlines, cx, cy, sx, sy)
          cx = sx
          cy = sy
        } else break
      }
    }
  }
  return { h, v: vlines, numOps: ops.fnArray.length, counts }
}

function pushSeg(h, vlines, x0, y0, x1, y1) {
  const w = Math.abs(x1 - x0)
  const hh = Math.abs(y1 - y0)
  if (w <= 1.2 && hh > 1.2) vlines.push({ x: (x0 + x1) / 2, y0: Math.min(y0, y1), y1: Math.max(y0, y1) })
  else if (hh <= 1.2 && w > 1.2) h.push({ y: (y0 + y1) / 2, x0: Math.min(x0, x1), x1: Math.max(x0, x1) })
}

function detectPage(h, vlines, pageW, pageH) {
  const lines = h.slice().sort((a, b) => b.y - a.y)
  const groups = []
  for (const line of lines) {
    const g = groups[groups.length - 1]
    if (g && Math.abs(g.y - line.y) <= 1.0) {
      g.members.push(line)
      g.x0 = Math.min(g.x0, line.x0)
      g.x1 = Math.max(g.x1, line.x1)
    } else {
      groups.push({ y: line.y, members: [line], x0: line.x0, x1: line.x1 })
    }
  }
  const staffs = []
  for (const g of groups) {
    const n = g.members.length
    if (n < 4 || n > 6) continue
    const xs0 = Math.min(...g.members.map((m) => m.x0))
    const xs1 = Math.max(...g.members.map((m) => m.x1))
    if (xs1 - xs0 < pageW * 0.25) continue
    const ys = g.members.map((m) => m.y).sort((a, b) => b - a)
    const gaps = []
    for (let i = 1; i < ys.length; i++) gaps.push(ys[i - 1] - ys[i])
    const gm = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    if (!(gm >= 2 && gm <= 20)) continue
    if (gaps.some((d) => Math.abs(d - gm) > gm * 0.25)) continue
    staffs.push({ top: ys[0], bottom: ys[ys.length - 1], gap: gm, x0: xs0, x1: xs1, lines: n })
  }
  staffs.sort((a, b) => b.top - a.top)
  const systems = []
  for (const st of staffs) {
    const last = systems[systems.length - 1]
    if (last && last.bottom - st.top < Math.max(last.gap, st.gap) * 4.5) {
      last.bottom = st.bottom
      last.x0 = Math.min(last.x0, st.x0)
      last.x1 = Math.max(last.x1, st.x1)
      last.staffs++
    } else {
      systems.push({ top: st.top, bottom: st.bottom, gap: st.gap, x0: st.x0, x1: st.x1, staffs: 1 })
    }
  }
  for (const sys of systems) {
    const span = sys.top - sys.bottom
    const need = span * 0.7
    const xs = vlines
      .filter((l) => {
        const cover = Math.min(l.y1, sys.top) - Math.max(l.y0, sys.bottom)
        return cover >= need && l.y0 < sys.top + 2 && l.y1 > sys.bottom - 2
      })
      .map((l) => l.x)
      .sort((a, b) => a - b)
    const out = []
    for (const x of xs) if (!out.length || x - out[out.length - 1] > 1.5) out.push(x)
    sys.bars = out
  }
  return { systems: systems.filter((s) => s.bars.length >= 2), total: systems.length }
}

const arg = process.argv[2]
let blob
let label
if (arg) {
  blob = new Blob([readFileSync(arg)])
  label = arg
} else {
  const demo = await buildDemoScore()
  blob = demo.pdf
  label = 'demo（5 行/页 × 4 小节，共 2 页）'
}
const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), disableWorker: true }).promise
console.log(`\n== ${label} == 页数 ${doc.numPages}`)
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const vp = page.getViewport({ scale: 1, rotation: 0 })
  const t0 = Date.now()
  const { h, v, numOps } = await pageSegments(page)
  const tSeg = Date.now() - t0
  const res = detectPage(h, v, vp.width, vp.height)
  console.log(
    `  第 ${p} 页 尺寸 ${vp.width.toFixed(0)}×${vp.height.toFixed(0)} | 操作符 ${numOps} | 横线 ${h.length} 竖线 ${v.length} | 用时 ${tSeg}ms`
  )
  for (const s of res.systems) {
    const measures = s.bars.length - 1
    console.log(
      `    行 y ${s.bottom.toFixed(1)}..${s.top.toFixed(1)} 谱表×${s.staffs} x ${s.bars[0]?.toFixed(1)}..${s.bars[s.bars.length - 1]?.toFixed(1)} → 线 ${s.bars.length} 条 = ${measures} 小节`
    )
  }
  console.log(`    识别到 ${res.systems.length} 行（候选 ${res.total}）`)
}
await doc.destroy()
