/**
 * 只在开发/调试时用的识别探针（浏览器侧）：把 PDF 栅格化 → 跑 src/domain/omr.js →
 * 跟标准答案对分 → 画出识别结果，结果挂在 window.__result 上供 CDP 取回。
 * 由 scripts/omr-probe.mjs 通过 Vite dev server 打开，不属于应用代码。
 */
import { openDocument } from '/src/domain/pdf.js'
import { binarize, columnRuns, detectPageSystems, findStaves, toMetaSystems } from '/src/domain/omr.js'

/** 诊断：第一行谱线条带覆盖率最高的若干列（pt 坐标），用来对齐标准答案里的小节线位置 */
function barDiag(bins, staves, scale) {
  if (staves.length < 2) return null
  const groups = []
  const sorted = staves.slice().sort((a, b) => a.yTop - b.yTop)
  for (const st of sorted.slice(0, 2)) {
    const half = Math.max(2, Math.round(st.space * 0.3))
    groups.push([Math.round(st.yTop) - half, Math.round(st.yBottom) + half])
  }
  const { width, height } = bins
  const cols = []
  for (let x = 0; x < width; x++) {
    const runs = columnRuns(bins.bins, width, x, 0, height, 2)
    let n = 0
    for (const [a, b] of runs) {
      for (const [lo, hi] of groups) {
        const s = Math.max(a, lo)
        const e = Math.min(b, hi)
        if (e >= s) n += e - s + 1
      }
    }
    cols.push({ x, n })
  }
  const top = cols.slice().sort((a, b) => b.n - a.n).slice(0, 24)
  return {
    bands: groups,
    bandSum: groups.reduce((a, [lo, hi]) => a + (hi - lo + 1), 0),
    top: top.map((c) => ({ x: Number((c.x / scale).toFixed(1)), n: c.n })),
  }
}

const q = new URLSearchParams(location.search)
const pdfUrl = q.get('pdf') || '/artifacts/omr-fixture.pdf'
const truthUrl = q.get('truth') || pdfUrl.replace(/\.pdf$/, '.truth.json')
const dpis = (q.get('dpi') || '150,200,300').split(',').map(Number)
const wantImage = q.get('image') === '1'

window.__result = { ready: false, runs: [], error: '' }

async function fetchArrayBuffer(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`取不到 ${url}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function loadTruth() {
  try {
    const res = await fetch(truthUrl)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function drawOverlay(canvas, pageData, scale) {
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height
  const ctx = out.getContext('2d')
  ctx.drawImage(canvas, 0, 0)
  ctx.lineWidth = Math.max(1, canvas.width / 900)
  ctx.strokeStyle = '#e0004d'
  ctx.font = `${Math.round(canvas.width / 60)}px monospace`
  ctx.fillStyle = '#e0004d'
  for (const s of pageData.systems) {
    const yTop = canvas.height - s.y0 * scale
    const yBot = canvas.height - s.y1 * scale
    ctx.strokeRect(Math.min(...s.barXs) * scale, Math.min(yTop, yBot), (Math.max(...s.barXs) - Math.min(...s.barXs)) * scale, Math.abs(yBot - yTop))
    for (const x of s.barXs) {
      ctx.beginPath()
      ctx.moveTo(x * scale, yTop)
      ctx.lineTo(x * scale, yBot)
      ctx.stroke()
    }
    ctx.fillText(`${s.measures}`, Math.min(...s.barXs) * scale + 4, yTop - 4)
  }
  return out
}

function score(detected, truth) {
  if (!truth) return null
  const res = { systems: 0, systemsHit: 0, barTotal: 0, barHit: 0, extraBars: 0 }
  const tolY = 10
  const tolX = 6
  for (const page of truth.pages) {
    const pageRes = detected.find((d) => d.page === truth.pages.indexOf(page) + 1)
    if (!pageRes) continue
    const used = new Set()
    for (const gt of page.systems) {
      res.systems++
      const hit = pageRes.systems.find((s, i) => !used.has(i) && Math.abs((s.y0 + s.y1) / 2 - (gt.y0 + gt.y1) / 2) < tolY)
      if (!hit) continue
      used.add(pageRes.systems.indexOf(hit))
      res.systemsHit++
      const gtBars = [...gt.bars].sort((a, b) => a - b)
      const hitBars = [...hit.barXs].sort((a, b) => a - b)
      res.barTotal += gtBars.length
      const matched = new Set()
      for (const x of gtBars) {
        const i = hitBars.findIndex((hx, k) => !matched.has(k) && Math.abs(hx - x) < tolX)
        if (i >= 0) {
          res.barHit++
          matched.add(i)
        }
      }
      res.extraBars += hitBars.length - matched.size
    }
  }
  res.systemRecall = res.systems ? res.systemsHit / res.systems : 0
  res.barRecall = res.barTotal ? res.barHit / res.barTotal : 0
  res.barPrecision = res.barHit + res.extraBars ? res.barHit / (res.barHit + res.extraBars) : 0
  res.barF1 = res.barPrecision + res.barRecall ? (2 * res.barPrecision * res.barRecall) / (res.barPrecision + res.barRecall) : 0
  return res
}

async function run() {
  const [data, truth] = await Promise.all([fetchArrayBuffer(pdfUrl), loadTruth()])
  const doc = await openDocument(data)
  const detected = []
  const doc0 = await doc.getPage(1)
  const base = doc0.getViewport({ scale: 1, rotation: 0 })

  for (const dpi of dpis) {
    const scale = dpi / 72
    const t0 = performance.now()
    const pagesPixels = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const vp = page.getViewport({ scale, rotation: 0 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(vp.width)
      canvas.height = Math.round(vp.height)
      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      pagesPixels.push({ canvas, img, pageW: base.width, pageH: base.height })
    }
    const tRender = performance.now() - t0

    const t1 = performance.now()
    const pageData = []
    for (let i = 0; i < pagesPixels.length; i++) {
      const { img, canvas, pageW, pageH } = pagesPixels[i]
      const bins = binarize(img.data, img.width, img.height, Math.max(6, scale * 4))
      bins.scale = scale
      let inkRatio = 0
      for (let k = 0; k < bins.bins.length; k++) inkRatio += bins.bins[k]
      inkRatio /= bins.bins.length
      const res = detectPageSystems(bins)
      const st = findStaves(bins)
      res.diag = { ...res.diag, barDiag: barDiag(bins, st.staves, scale), inkRatio: Number(inkRatio.toFixed(4)), w: img.width, h: img.height, pageW: Number(pageW.toFixed(2)), pageH: Number(pageH.toFixed(2)), scale: Number(scale.toFixed(4)), staffSpacePx: Number((res.staffSpace || 0).toFixed(2)) }
      pageData.push({ page: i + 1, ...res, meta: toMetaSystems(res) })
      if (wantImage) {
        const out = drawOverlay(canvas, { systems: res.systems }, scale)
        const url = out.toDataURL('image/jpeg', 0.7)
        const name = `${(pdfUrl.split('/').pop() || 'x').replace(/\.pdf$/, '')}-${dpi}dpi-p${i + 1}.jpg`
        window.__result.images = window.__result.images || []
        window.__result.images.push({ name, url })
        document.body.appendChild(out)
      }
    }
    const tDetect = performance.now() - t1
    detected.push(...pageData)
    window.__result.runs.push({
      dpi,
      renderMs: Math.round(tRender),
      detectMs: Math.round(tDetect),
      skew: pageData.map((p) => Number((p.skew || 0).toFixed(4))),
      staffSpacePx: pageData.map((p) => Number((p.staffSpace || 0).toFixed(2))),
      systems: pageData.map((p) => p.systems.length),
      measures: pageData.map((p) => p.systems.reduce((a, s) => a + s.measures, 0)),
      detail: pageData.map((p) => ({
        page: p.page,
        staffSpace: p.diag?.staffSpace,
        lines: p.diag?.lines,
        staves: p.diag?.staves,
        debug: p.diag?.debug,
        barDiag: p.diag?.barDiag,
        trace: p.diag?.trace,
        geom: { w: p.diag?.w, h: p.diag?.h, pageW: p.diag?.pageW, pageH: p.diag?.pageH, scale: p.diag?.scale, inkRatio: p.diag?.inkRatio },
        systems: p.systems.map((s) => ({
          y0: Number(s.y0.toFixed(1)),
          y1: Number(s.y1.toFixed(1)),
          staffCount: s.staffCount,
          bars: s.barXs.map((x) => Number(x.toFixed(1))),
        })),
      })),
      score: score(pageData, truth),
    })
  }
  // 不同 DPI 之间的一致性（同一份谱子，换个分辨率结果不该变）
  const first = detected.filter((p) => p.page === 1)[0]
  const last = detected.filter((p) => p.page === 1).slice(-1)[0]
  window.__result.crossDpi = first && last ? { systems: [first.systems.length, last.systems.length], bars: [first.systems.reduce((a, s) => a + s.bars.length, 0), last.systems.reduce((a, s) => a + s.bars.length, 0)] } : null
  window.__result.truth = truth ? { pages: truth.pages.length } : null
  window.__result.metaSample = detected[0]?.meta
  window.__result.ready = true
  document.title = 'ready'
}

run().catch((err) => {
  window.__result.error = String(err?.stack || err)
  window.__result.ready = true
  document.title = 'error'
})
