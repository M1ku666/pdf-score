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

function luma(args) {
  if (Array.isArray(args)) {
    if (args.length >= 3) return (args[0] * 299 + args[1] * 587 + args[2] * 114) / 1000
    return Number(args[0]) || 0
  }
  const s = String(args)
  if (s.startsWith('#')) {
    const hex = s.slice(1)
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      return (r * 299 + g * 587 + b * 114) / 1000
    }
    return parseInt(hex || '0', 16) || 0
  }
  const parts = s.trim().split(/\s+/).map(Number)
  if (parts.length >= 3) return (parts[0] * 299 + parts[1] * 587 + parts[2] * 114) / 1000
  return Number.isFinite(parts[0]) ? parts[0] : 0
}

function pathBuffer(args) {
  const raw = Array.isArray(args?.[1]) ? args[1][0] : args?.[1]
  return toNumberArray(raw)
}

export function toNumberArray(raw) {
  if (!raw) return null
  if (Array.isArray(raw)) return raw
  if (ArrayBuffer.isView(raw)) return Array.from(raw)
  const n = Number(raw.length) | 0
  if (!n) return null
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const v = raw[i] !== undefined ? raw[i] : raw[String(i)]
    out[i] = typeof v === 'number' ? v : Number(v) || 0
  }
  return out
}

function flattenCubic(pts, x0, y0, x1, y1, x2, y2, x3, y3) {
  const chord = Math.hypot(x3 - x0, y3 - y0)
  const poly = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2)
  const steps = Math.max(2, Math.min(32, Math.ceil((chord + poly) / 4)))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    pts.push([a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3])
  }
}

function strokeSegments(gray, W, H, segs, halfW) {
  const hw = Math.max(0.35, halfW)
  for (const [x0, y0, x1, y1] of segs) {
    const dx = x1 - x0
    const dy = y1 - y0
    const len2 = dx * dx + dy * dy
    if (len2 < 1e-12) {
      const xa = Math.max(0, Math.floor(x0 - hw))
      const xb = Math.min(W - 1, Math.ceil(x0 + hw))
      const ya = Math.max(0, Math.floor(y0 - hw))
      const yb = Math.min(H - 1, Math.ceil(y0 + hw))
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) gray[y * W + x] = 0
      continue
    }
    const pad = hw + 1
    const xa = Math.max(0, Math.floor(Math.min(x0, x1) - pad))
    const xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + pad))
    const ya = Math.max(0, Math.floor(Math.min(y0, y1) - pad))
    const yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + pad))
    for (let y = ya; y <= yb; y++) {
      const py = y + 0.5
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5
        let t = ((px - x0) * dx + (py - y0) * dy) / len2
        if (t < 0) t = 0
        else if (t > 1) t = 1
        const cx = x0 + t * dx
        const cy = y0 + t * dy
        if ((px - cx) * (px - cx) + (py - cy) * (py - cy) <= hw * hw) gray[y * W + x] = 0
      }
    }
  }
}

function fillPolygons(gray, W, H, polys) {
  for (const poly of polys) {
    if (poly.length < 3) continue
    let minY = Infinity
    let maxY = -Infinity
    for (const [, y] of poly) {
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const ya = Math.max(0, Math.floor(minY))
    const yb = Math.min(H - 1, Math.ceil(maxY))
    const xs = []
    for (let y = ya; y <= yb; y++) {
      const yc = y + 0.5
      xs.length = 0
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i]
        const [bx, by] = poly[(i + 1) % poly.length]
        if (ay === by) continue
        if ((yc >= ay && yc < by) || (yc >= by && yc < ay)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax))
      }
      if (xs.length < 2) continue
      xs.sort((a, b) => a - b)
      const row = y * W
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const pa = Math.max(0, Math.round(xs[k]))
        const pb = Math.min(W - 1, Math.round(xs[k + 1]))
        for (let x = pa; x <= pb; x++) gray[row + x] = 0
      }
    }
  }
}

export async function rasterizeVectorPage(file, n, scale, opts = {}) {
  const { readFileSync } = await import('node:fs')
  const { toUint8, onStats, supersample = 2 } = opts
  const stats = onStats ? {} : null
  const ss = Math.max(1, Math.round(supersample))
  const hiScale = scale * ss
  const bytes = toUint8 ? toUint8(readFileSync(file)) : new Uint8Array(readFileSync(file))
  const doc = await pdfjs.getDocument({ data: bytes, disableWorker: true, isEvalSupported: false }).promise
  const page = await doc.getPage(n)
  const viewport = page.getViewport({ scale: hiScale, rotation: page.rotate || 0 })
  const W = Math.max(1, Math.round(viewport.width))
  const H = Math.max(1, Math.round(viewport.height))
  const gray = new Uint8ClampedArray(W * H).fill(255)
  const ops = await page.getOperatorList()
  const { OPS } = pdfjs
  const MOVE = 0
  const LINE = 1
  const CURVE = 2
  const CURVE2 = 3
  const CLOSE = 4
  const RECT = 5

  const v = viewport.transform
  const toDevice = (m, x, y) => apply(multiply(m, v), x, y)

  let ctm = [1, 0, 0, 1, 0, 0]
  let textMatrix = [1, 0, 0, 1, 0, 0]
  let lineWidth = 1
  let textState = { size: 12, font: null }
  const stack = []

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]
    if (fn === OPS.save) {
      stack.push({ ctm: ctm.slice(), textMatrix: textMatrix.slice(), lineWidth, textState: { ...textState } })
    } else if (fn === OPS.restore) {
      const s = stack.pop()
      if (s) {
        ctm = s.ctm
        textMatrix = s.textMatrix
        lineWidth = s.lineWidth
        textState = s.textState
      }
    } else if (fn === OPS.beginText) {
      textMatrix = [1, 0, 0, 1, 0, 0]
    } else if (fn === OPS.transform) {
      const m = toNumberArray(args)
      if (m && m.length >= 6) ctm = multiply(ctm, m)
    } else if (fn === OPS.setTextMatrix) {
      const m = toNumberArray(args?.[0] ?? args)
      if (m && m.length >= 6) {
        textMatrix = m
      }
    } else if (fn === OPS.setLineWidth) {
      lineWidth = Number(args[0]) || 1
    } else if (fn === OPS.setFont) {
      const [id, size] = args
      textState.size = size
      textState.font = page.commonObjs.has(id) ? page.commonObjs.get(id) : null
    } else if (fn === OPS.constructPath) {
      const buffer = pathBuffer(args)
      if (!buffer) continue
      const intent = Number(args?.[0])
      if (intent === OPS.endPath) continue
      const stroked = intent === OPS.stroke || ops.fnArray[i + 1] === OPS.stroke
      if (stats && (stats.rawPaths || 0) < 2) {
        stats.rawPaths = (stats.rawPaths || 0) + 1
        stats.raw = stats.raw || []
        const first = []
        for (let k = 0; k < buffer.length && first.length < 6; ) {
          const op = buffer[k++]
          if (op === 0 || op === 1) {
            const x = buffer[k++]
            const y = buffer[k++]
            first.push([Number(x.toFixed(1)), Number(y.toFixed(1)), Number(toDevice(ctm, x, y)[0].toFixed(1)), Number(toDevice(ctm, x, y)[1].toFixed(1))])
          } else break
        }
        stats.raw.push({ i, intent, ctm: ctm.map((v) => Number(v.toFixed(3))), first })
      }
      const polys = []
      const segs = []
      let pts = []
      let cx = 0
      let cy = 0
      let sx = 0
      let sy = 0
      const flushStroke = () => {
        for (let k = 1; k < pts.length; k++) segs.push([pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]])
      }
      for (let k = 0; k < buffer.length; ) {
        const op = buffer[k++]
        if (op === MOVE) {
          if (stroked) flushStroke()
          const p = toDevice(ctm, buffer[k++], buffer[k++])
          if (stroked) pts = [p]
          else {
            if (pts.length > 2) polys.push(pts)
            pts = [p]
          }
          cx = sx = p[0]
          cy = sy = p[1]
        } else if (op === LINE) {
          const p = toDevice(ctm, buffer[k++], buffer[k++])
          pts.push(p)
          cx = p[0]
          cy = p[1]
        } else if (op === CURVE) {
          const c1 = toDevice(ctm, buffer[k++], buffer[k++])
          const c2 = toDevice(ctm, buffer[k++], buffer[k++])
          const p = toDevice(ctm, buffer[k++], buffer[k++])
          flattenCubic(pts, cx, cy, c1[0], c1[1], c2[0], c2[1], p[0], p[1])
          cx = p[0]
          cy = p[1]
        } else if (op === CURVE2) {
          const c2 = toDevice(ctm, buffer[k++], buffer[k++])
          const p = toDevice(ctm, buffer[k++], buffer[k++])
          flattenCubic(pts, cx, cy, cx, cy, c2[0], c2[1], p[0], p[1])
          cx = p[0]
          cy = p[1]
        } else if (op === RECT) {
          const x = buffer[k++]
          const y = buffer[k++]
          const w = buffer[k++]
          const h = buffer[k++]
          const a = toDevice(ctm, x, y)
          const b = toDevice(ctm, x + w, y + h)
          if (stroked) flushStroke()
          if (pts.length > 2) polys.push(pts)
          pts = [
            [a[0], a[1]],
            [b[0], a[1]],
            [b[0], b[1]],
            [a[0], b[1]],
          ]
          if (!stroked) {
            polys.push(pts)
            pts = []
          }
          cx = sx = a[0]
          cy = sy = a[1]
        } else if (op === CLOSE) {
          if (cx !== sx || cy !== sy) pts.push([sx, sy])
          cx = sx
          cy = sy
        } else break
      }
      if (stroked) {
        flushStroke()
        if (stats) {
          stats.segCount = (stats.segCount || 0) + 1
          for (const s of segs) {
            for (let k = 0; k < 4; k++) {
              const v = s[k]
              if (!Number.isFinite(v)) stats.nan = (stats.nan || 0) + 1
            }
            const [x0, y0, x1, y1] = s
            stats.dMinX = stats.dMinX === undefined ? Math.min(x0, x1) : Math.min(stats.dMinX, x0, x1)
            stats.dMaxX = stats.dMaxX === undefined ? Math.max(x0, x1) : Math.max(stats.dMaxX, x0, x1)
            stats.dMinY = stats.dMinY === undefined ? Math.min(y0, y1) : Math.min(stats.dMinY, y0, y1)
            stats.dMaxY = stats.dMaxY === undefined ? Math.max(y0, y1) : Math.max(stats.dMaxY, y0, y1)
          }
        }
        strokeSegments(gray, W, H, segs, Math.max(1.2 * ss, (lineWidth * hiScale) / 2))
      } else {
        if (pts.length > 2) polys.push(pts)
        fillPolygons(gray, W, H, polys)
      }
      if (stats) {
        stats.drawn = (stats.drawn || 0) + 1
        if (stroked) stats.segTotal = (stats.segTotal || 0) + segs.length
        else stats.polyTotal = (stats.polyTotal || 0) + polys.length
        if (!stats.samples) stats.samples = []
        if (stats.samples.length < 4) {
          stats.samples.push({
            i,
            intent,
            stroked,
            ctm: ctm.map((v) => Number(v.toFixed(3))),
            seg0: segs.length ? segs[0].map((v) => Number(v.toFixed(1))) : null,
            poly0: polys.length ? polys[0].slice(0, 3).map((p) => p.map((v) => Number(v.toFixed(1)))) : null,
          })
        }
      }
    } else if (fn === OPS.clip || fn === OPS.eoClip) {
    } else if (fn === OPS.showText) {
      const items = args[0] || []
      const size = textState.size || 12
      const ascent = Number(textState.font?.ascent) || 0.75
      const descent = Number(textState.font?.descent) || -0.25
      const tm = multiply(ctm, textMatrix)
      let tx = 0
      for (const it of items) {
        const str = typeof it === 'string' ? it : it?.unicode || ''
        const adv = it && typeof it === 'object' && it.width ? (it.width * size) / 1000 : size * 0.5 * Math.max(1, str.length)
        if (str.trim()) {
          const p0 = toDevice(tm, tx, descent * size)
          const p1 = toDevice(tm, tx + adv, ascent * size)
          fillPolygons(gray, W, H, [
            [
              [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1])],
              [Math.max(p0[0], p1[0]), Math.min(p0[1], p1[1])],
              [Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])],
              [Math.min(p0[0], p1[0]), Math.max(p0[1], p1[1])],
            ],
          ])
        }
        tx += adv
      }
    }
  }
  const outGray = ss > 1 ? downsample(gray, W, H, ss) : gray
  const outW = ss > 1 ? Math.max(1, Math.round(W / ss)) : W
  const outH = ss > 1 ? Math.max(1, Math.round(H / ss)) : H
  const data = new Uint8ClampedArray(outW * outH * 4)
  for (let i = 0; i < outW * outH; i++) {
    data[i * 4] = outGray[i]
    data[i * 4 + 1] = outGray[i]
    data[i * 4 + 2] = outGray[i]
    data[i * 4 + 3] = 255
  }
  await doc.destroy?.()
  void luma
  if (stats) onStats(stats)
  return { data, width: outW, height: outH }
}

function downsample(gray, W, H, factor) {
  const w = Math.max(1, Math.round(W / factor))
  const h = Math.max(1, Math.round(H / factor))
  const out = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * H) / h)
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * H) / h))
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * W) / w)
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * W) / w))
      let sum = 0
      let n = 0
      for (let yy = sy0; yy < sy1; yy++) {
        const row = yy * W
        for (let xx = sx0; xx < sx1; xx++) {
          sum += gray[row + xx]
          n++
        }
      }
      out[y * w + x] = n ? sum / n : 255
    }
  }
  return out
}
