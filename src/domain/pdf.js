/**
 * PDF 渲染（pdf.js 封装）
 * 页面统一以 canvas 渲染；标记几何量使用 PDF 原始点坐标（pt），与显示缩放解耦。
 *
 *  · `PdfRenderer.render()` 是**双缓冲**：先画到离屏 canvas、画完再贴到可见 canvas，被取消的那次返回
 *    `null`。所以拖动侧栏 / 收起展开期间连续调用它是安全的、不会白 —— **别改回「在可见 canvas 上直接画」**
 *    （每次开画都清空 + 铺白，而帧锁定的动画里每帧都会把上一帧取消掉，那就是「过程中 PDF 全白」的成因）。
 *  · 取消上一个任务要按 **`页号:用处`** 记账（整页视图 `slot: 'page'`、总览缩略图 `slot: 'mini'`）：
 *    同一页会被渲染两次，不分开记账时总览会把整页视图那次渲染取消掉、页面一片空白。
 *  · worker 通过 `?url` 引入再赋给 `GlobalWorkerOptions.workerSrc`；改法会导致退化为主线程 fake worker。
 *    它的 cmap / 标准字体 / wasm 资源由 `predev` / `prebuild` 复制到 `public/pdfjs/`，**别直接 vite build**。
 *  · 纸面颜色是**允许硬编码的 `#ffffff`**：PDF 永远按白纸渲染，深色反色交给 `--pdf-invert`（见 docs/ui.md §11）。
 *  · 位图尺寸 = CSS 尺寸 × devicePixelRatio，**但有总面积上限**（`MAX_RASTER_PX`）：谱面可以放大到 4×
 *    （见 docs/ui.md §18.68），不封顶的话一张纸就是几十兆像素、内存直接打爆。
 *    超过上限只降位图密度、CSS 尺寸照旧 —— 画面还是撑满，只是软一点。
 */
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
    // 忽略 90/270 旋转带来的差异，统一成显示宽高
    sizes.push({ width: Math.abs(vp.width), height: Math.abs(vp.height), rotate: page.rotate || 0 })
  }
  return sizes
}

/**
 * 离屏画布池最多留几块。同时可见的页各要一块（一页一块，渲染期间独占），
 * 留 3 块够常见情况；再多就得新建 —— 一块整页缓冲在 dpr 2 下十几 MB，宁可丢。
 */
const SCRATCH_MAX = 3

/**
 * 一张页面位图的**总像素上限**（宽 × 高，含 dpr）。
 * 谱面缩放越往上，CSS 尺寸越大；位图跟着等比放大的话像素是**平方**增长的
 * （4× 就是 16 倍），所以按总面积封顶，超了就只降位图密度 —— CSS 尺寸照旧、画面撑满，只是软一点。
 * 1× 下常见整页（约 1200 × 1700 CSS px、dpr 2）≈ 8.2 M，仍在限内，画质与以前一致。
 */
const MAX_RASTER_PX = 12e6

export class PdfRenderer {
  constructor(doc) {
    this.doc = doc
    this.tasks = new Map()
    /** 双缓冲用的离屏画布池（见 `render()` 的注释）。**按尺寸复用**，满了就丢掉最旧的 */
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

  /**
   * 渲染第 n 页到 canvas（按 CSS 尺寸 + devicePixelRatio）
   * `opts.slot`：同一页可能被两处同时渲染（整页视图 + 右侧总览缩略图），
   *   取消任务必须按「页 + 用处」记账，否则总览会把整页视图那次渲染给取消掉。
   * `opts.pixelRatio`：覆盖 devicePixelRatio（缩略图固定按 2 倍渲染，桌面端 DPR=1 时也够清楚）。
   *
   * **双缓冲**：页面先画到离屏 canvas，画完再一次性贴到可见 canvas。
   * 直接在可见 canvas 上画的话，每次 `render()` 都要「改尺寸（清空）→ 取消上一次 → 铺一层白」，
   * 于是**被下一次取消的那一回会在可见画布上留下白底** —— 宽度连续变化时（拖动、收起 / 展开动画）
   * 就是「一路全白」（用户报过「收起侧栏时 PDF 全白」）。
   * 离屏画完才动可见画布，可见画布上**永远是上一张完整的图**，取消多少次都不会白。
   */
  async render(n, canvas, cssWidth, cssHeight, opts = {}) {
    const { slot = 'view', pixelRatio = 0 } = opts
    const key = `${n}:${slot}`
    const page = await this.getPage(n)
    const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate })
    const scale = cssWidth / baseViewport.width
    const viewport = page.getViewport({ scale, rotation: page.rotate })
    const dpr = pixelRatio > 0 ? pixelRatio : Math.min(window.devicePixelRatio || 1, 2)
    // 位图总面积封顶（见 `MAX_RASTER_PX`）：`transform` 与位图尺寸用同一个 `dpr`，别只改一处
    const area = Math.max(1, viewport.width * viewport.height)
    const scaleDown = Math.min(1, Math.sqrt(MAX_RASTER_PX / (area * dpr * dpr)))
    const bitDpr = Math.max(0.5, dpr * scaleDown)
    const w = Math.max(1, Math.floor(viewport.width * bitDpr))
    const h = Math.max(1, Math.floor(viewport.height * bitDpr))
    // 显示尺寸**立刻**跟上：新位图还没画好之前，浏览器会把旧位图拉满撑着，不会留空
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
      // 被下一次渲染取消是**正常路径**（拖动 / 动画期间一直在发生），别当失败往上抛、也别贴上去
      if (err?.name !== 'RenderingCancelledException') throw err
      return null
    } finally {
      if (this.tasks.get(key) === task) this.tasks.delete(key)
      this._release(off)
    }
    // 画完了才换可见画布：改位图尺寸（这一步会清空）和贴图在**同一个任务里**完成，不会闪
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    canvas.getContext('2d', { alpha: false }).drawImage(off, 0, 0)
    return { width: viewport.width, height: viewport.height }
  }

  /**
   * 离屏缓冲的**池子**：整页大小（dpr 2 下一张 A4 十几 MB），每次新建会把 GC 吵炸，
   * 所以按尺寸复用。池子满了就丢掉最旧的一块 —— 正在用的那块只是从池子里摘出去，
   * 被别的渲染引用着，不受影响。
   */
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

/** 生成第一页缩略图（dataURL） */
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
