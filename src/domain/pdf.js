import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { t } from '../i18n/index.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjsLib }

const ASSET_BASE = new URL('pdfjs/', document.baseURI).href.replace(/\/$/, '') + '/'

function options(extra = {}) {
  return {
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}wasm/`,
    ...extra,
  }
}

export async function openDocument(blobOrData) {
  let data
  if (blobOrData instanceof Blob) data = new Uint8Array(await blobOrData.arrayBuffer())
  else if (blobOrData instanceof ArrayBuffer) data = new Uint8Array(blobOrData)
  else if (blobOrData instanceof Uint8Array) data = blobOrData
  else if (typeof blobOrData === 'string' || blobOrData?.url) data = blobOrData
  else throw new Error(t('domain.error.invalidPdf'))
  const task = pdfjsLib.getDocument(options(typeof data === 'object' && data?.url ? data : { data }))
  return task.promise
}

export async function pageSizes(doc) {
  const sizes = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1, rotation: page.rotate })
    sizes.push({ width: Math.abs(vp.width), height: Math.abs(vp.height), rotate: page.rotate || 0 })
  }
  return sizes
}

const SCRATCH_MAX = 3

const MAX_RASTER_PX = 12e6

export class PdfRenderer {
  constructor(doc) {
    this.doc = doc
    this.tasks = new Map()
    this.scratch = []
  }

  static async from(blob) {
    const doc = await openDocument(blob)
    return new PdfRenderer(doc)
  }

  get numPages() {
    return this.doc?.numPages || 0
  }

  async getPage(n) {
    return this.doc.getPage(n)
  }

  async render(n, canvas, cssWidth, cssHeight, opts = {}) {
    const { slot = 'view', pixelRatio = 0 } = opts
    const key = `${n}:${slot}`
    const page = await this.getPage(n)
    const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate })
    const scale = cssWidth / baseViewport.width
    const viewport = page.getViewport({ scale, rotation: page.rotate })
    const dpr = pixelRatio > 0 ? pixelRatio : Math.min(window.devicePixelRatio || 1, 2)
    const area = Math.max(1, viewport.width * viewport.height)
    const scaleDown = Math.min(1, Math.sqrt(MAX_RASTER_PX / (area * dpr * dpr)))
    const bitDpr = Math.max(0.5, dpr * scaleDown)
    const w = Math.max(1, Math.floor(viewport.width * bitDpr))
    const h = Math.max(1, Math.floor(viewport.height * bitDpr))
    canvas.style.width = `${Math.round(viewport.width)}px`
    canvas.style.height = `${Math.round(viewport.height)}px`
    const prev = this.tasks.get(key)
    if (prev) {
      try {
        prev.cancel()
      } catch {}
    }
    const off = this._scratch(w, h)
    const offCtx = off.getContext('2d', { alpha: false })
    offCtx.save()
    offCtx.fillStyle = '#ffffff'
    offCtx.fillRect(0, 0, w, h)
    offCtx.restore()
    const task = page.render({
      canvasContext: offCtx,
      canvas: off,
      viewport,
      background: '#ffffff',
      transform: bitDpr !== 1 ? [bitDpr, 0, 0, bitDpr, 0, 0] : null,
    })
    this.tasks.set(key, task)
    try {
      await task.promise
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') throw err
      return null
    } finally {
      if (this.tasks.get(key) === task) this.tasks.delete(key)
      this._release(off)
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    canvas.getContext('2d', { alpha: false }).drawImage(off, 0, 0)
    return { width: viewport.width, height: viewport.height }
  }

  _scratch(w, h) {
    const pool = this.scratch
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i]
      if (c.width === w && c.height === h) return pool.splice(i, 1)[0]
    }
    const c = pool.pop() || document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }

  _release(c) {
    if (!c) return
    if (this.scratch.length >= SCRATCH_MAX) return
    if (!this.scratch.includes(c)) this.scratch.push(c)
  }

  destroy() {
    try {
      this.doc?.destroy()
    } catch {}
  }
}

export async function makeThumbnail(blob, maxWidth = 420) {
  let renderer = null
  try {
    renderer = await PdfRenderer.from(blob)
    if (!renderer.numPages) return null
    const page = await renderer.getPage(1)
    const base = page.getViewport({ scale: 1, rotation: page.rotate })
    const scale = maxWidth / base.width
    const viewport = page.getViewport({ scale, rotation: page.rotate })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, canvas, viewport, background: '#ffffff' }).promise
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch (err) {
    console.warn('缩略图生成失败', err)
    return null
  } finally {
    renderer?.destroy()
  }
}
