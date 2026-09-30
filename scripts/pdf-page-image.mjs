import { readFileSync } from 'node:fs'

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => import('pdfjs-dist/build/pdf.mjs'))

function toRgba(img) {
  const { width, height, kind, data } = img
  const out = new Uint8ClampedArray(width * height * 4)
  const SM = pdfjs.ImageKind
  if (kind === SM.RGBA_32BPP) {
    out.set(data.subarray(0, out.length))
  } else if (kind === SM.RGB_24BPP) {
    for (let i = 0, p = 0, q = 0; i < width * height; i++, p += 3, q += 4) {
      out[q] = data[p]
      out[q + 1] = data[p + 1]
      out[q + 2] = data[p + 2]
      out[q + 3] = 255
    }
  } else if (kind === SM.GRAYSCALE_1BPP) {
    const rowBytes = (width + 7) >> 3
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1
        const v = bit ? 255 : 0
        const q = (y * width + x) * 4
        out[q] = v
        out[q + 1] = v
        out[q + 2] = v
        out[q + 3] = 255
      }
    }
  } else {
    throw new Error(`不认识的位图类型 kind=${kind}`)
  }
  if (img.smask) {
    const sm = img.smask
    const SM2 = pdfjs.ImageKind
    let alpha = null
    if (sm.kind === SM2.GRAYSCALE_1BPP) {
      const rowBytes = (sm.width + 7) >> 3
      alpha = new Uint8Array(sm.width * sm.height)
      for (let y = 0; y < sm.height; y++) {
        for (let x = 0; x < sm.width; x++) {
          alpha[y * sm.width + x] = ((sm.data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) ? 255 : 0
        }
      }
    } else if (sm.kind === SM2.RGBA_32BPP) {
      alpha = new Uint8Array(sm.width * sm.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = sm.data[i * 4]
    } else if (sm.kind === SM2.RGB_24BPP) {
      alpha = new Uint8Array(sm.width * sm.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = sm.data[i * 3]
    }
    if (alpha) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const a = alpha[y * sm.width + x] / 255
          if (a >= 1) continue
          const q = (y * width + x) * 4
          out[q] = Math.round(out[q] * a + 255 * (1 - a))
          out[q + 1] = Math.round(out[q + 1] * a + 255 * (1 - a))
          out[q + 2] = Math.round(out[q + 2] * a + 255 * (1 - a))
        }
      }
    }
  }
  return out
}

export async function openPdfPageImages(file, { vector = false } = {}) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), disableWorker: true, isEvalSupported: false }).promise
  const pageCache = new Map()
  const getPage = async (n) => {
    if (!pageCache.has(n)) pageCache.set(n, await doc.getPage(n))
    return pageCache.get(n)
  }
  const imageCache = new Map()
  const rawImage = async (n) => {
    if (imageCache.has(n)) return imageCache.get(n)
    const page = await getPage(n)
    const ops = await page.getOperatorList()
    const idx = ops.fnArray.indexOf(pdfjs.OPS.paintImageXObject)
    if (idx < 0) throw new Error(`第 ${n} 页不是「整页一张位图」（没有 paintImageXObject）—— 这种 PDF 要走浏览器渲染，见 scripts/omr-probe.mjs`)
    const objId = ops.argsArray[idx][0]
    const deps = ops.fnArray.indexOf(pdfjs.OPS.paintImageXObject, idx + 1)
    void deps
    const img = await new Promise((resolve, reject) => {
      const take = () => {
        if (page.objs.has(objId)) resolve(page.objs.get(objId))
        else if (page.commonObjs.has(objId)) resolve(page.commonObjs.get(objId))
        else return false
        return true
      }
      if (take()) return
      const t = setInterval(() => {
        if (take()) clearInterval(t)
      }, 20)
      setTimeout(() => {
        clearInterval(t)
        reject(new Error(`第 ${n} 页的位图 ${objId} 取不到`))
      }, 20000)
    })
    const res = { raw: img, rgba: toRgba(img) }
    imageCache.set(n, res)
    return res
  }
  return {
    numPages: doc.numPages,
    async pageSize(n) {
      const page = await getPage(n)
      const vp = page.getViewport({ scale: 1, rotation: page.rotate || 0 })
      return { width: vp.width, height: vp.height, rotate: page.rotate || 0 }
    },
    async pageImage(n, scale) {
      if (vector) {
        const { rasterizeVectorPage } = await import('./pdf-raster-vector.mjs')
        const img = await rasterizeVectorPage(file, n, scale)
        return { data: img.data, width: img.width, height: img.height }
      }
      const { raw, rgba } = await rawImage(n)
      const { width, height } = await this.pageSize(n)
      const w = Math.max(1, Math.round(width * scale))
      const h = Math.max(1, Math.round(height * scale))
      if (w === raw.width && h === raw.height) return { data: rgba, width: w, height: h }
      const data = w >= raw.width && h >= raw.height ? upscaleBilinear(rgba, raw.width, raw.height, w, h) : resample(rgba, raw.width, raw.height, w, h)
      return { data, width: w, height: h }
    },
    async destroy() {
      await doc.destroy?.()
    },
  }
}

function upscaleBilinear(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4)
  const fx = sw / dw
  const fy = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const wy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const wx = sx - x0
      const q = (y * dw + x) * 4
      for (let c = 0; c < 3; c++) {
        const p00 = src[(y0 * sw + x0) * 4 + c]
        const p10 = src[(y0 * sw + x1) * 4 + c]
        const p01 = src[(y1 * sw + x0) * 4 + c]
        const p11 = src[(y1 * sw + x1) * 4 + c]
        out[q + c] = (p00 * (1 - wx) + p10 * wx) * (1 - wy) + (p01 * (1 - wx) + p11 * wx) * wy
      }
      out[q + 3] = 255
    }
  }
  return out
}

function resample(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    const sy0 = (y * sh) / dh
    const sy1 = ((y + 1) * sh) / dh
    const iy0 = Math.floor(sy0)
    const iy1 = Math.min(sh, Math.ceil(sy1))
    for (let x = 0; x < dw; x++) {
      const sx0 = (x * sw) / dw
      const sx1 = ((x + 1) * sw) / dw
      const ix0 = Math.floor(sx0)
      const ix1 = Math.min(sw, Math.ceil(sx1))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let yy = iy0; yy < iy1; yy++) {
        for (let xx = ix0; xx < ix1; xx++) {
          const p = (yy * sw + xx) * 4
          r += src[p]
          g += src[p + 1]
          b += src[p + 2]
          n++
        }
      }
      const q = (y * dw + x) * 4
      out[q] = n ? r / n : 255
      out[q + 1] = n ? g / n : 255
      out[q + 2] = n ? b / n : 255
      out[q + 3] = 255
    }
  }
  return out
}
