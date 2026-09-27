/**
 * 乐谱库（gallery）状态与数据操作
 * 创建 / 导入（pmz 单张、zip 多张、散装文件）/ 导出 / 删除 / 封面 / 标签 / 占用与容量统计。
 *
 *  · 面板的界面规则（顶栏、标签筛选、卡片、信息面板、贴底导入按钮）写在 `LibraryPanel.vue` 头部。
 *  · **封面反色只看 `coverCustom`，不要用 `!!thumb` 推断**：`applyCoverData(id, thumb, custom)` 的
 *    custom **必须显式传** —— 换图 `true`、用 PDF 首页重生成 `false`、导入 pmz 里带封面 `true`
 *    （否则「恢复默认」之后会被当成自定义封面、深色模式下不反色）。`imageToCover()` 铺白底 `#ffffff`
 *    是**允许硬编码的白名单项**（透明 PNG 转 JPEG 必须铺白，且存储时按 420px 宽等比缩、不改比例）。
 *  · 包格式（pmz / zip 的内容与命名）见 `domain/zip.js` 头部；文件类型分类走它的 `classifyFiles`，
 *    唯一的拖放入口在 `PlayerView`。
 *  · 删乐谱要连 `<id>/pdf`、`<id>/audio`、`<id>/peaks` 三个键一起删（见 `db/idb.js`）。
 */
import { computed, reactive, ref } from 'vue'
import * as db from '../db/idb.js'
import { createMeta, cloneMeta, normalizeTags, syncPages, uid } from '../domain/schema.js'
import { deriveStructure } from '../domain/timeline.js'
import { PdfRenderer, makeThumbnail, pageSizes } from '../domain/pdf.js'
import { peaksFromBlob } from '../domain/audio-peaks.js'
import { buildScoreArchive, classifyFiles, downloadBlob, isAudioFile, isImageFile, isJsonFile, isPdfFile, isPmzFile, isZipFile, packArchives, readZip, stripExt, mimeForAudio } from '../domain/zip.js'
import { t } from '../i18n/index.js'

export const scores = ref([])
export const loading = ref(false)
export const error = ref('')
export const busy = ref('')
export const usage = ref(null)

export const measureCountOf = (rec) => {
  try {
    return deriveStructure(rec.meta || {}).count
  } catch {
    return 0
  }
}

export async function refresh() {
  loading.value = true
  error.value = ''
  try {
    scores.value = await db.listScores()
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
  db.estimateUsage().then((u) => (usage.value = u))
  return scores.value
}

export function probeAudioDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const el = new Audio()
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      URL.revokeObjectURL(url)
      resolve(v)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) ? el.duration : null)
    el.onerror = () => finish(null)
    setTimeout(() => finish(Number.isFinite(el.duration) ? el.duration : null), 8000)
    el.src = url
  })
}

export async function ensurePeaks(id, force = false) {
  if (!id) return null
  if (!force) {
    const cached = await db.getFile(id, 'peaks')
    if (cached && cached.length) return cached
  }
  const audio = await db.getFile(id, 'audio')
  if (!audio) return null
  try {
    const { peaks, perSecond } = await peaksFromBlob(audio)
    if (peaks?.length) {
      await db.putFile(id, 'peaks', peaks)
      const rec = await db.getScore(id)
      if (rec) {
        rec.meta.audio = { ...(rec.meta.audio || {}), peaksPerSecond: Number(perSecond.toFixed(3)), duration: rec.meta.audio?.duration || null }
        await db.putScore({ ...rec, updatedAt: rec.updatedAt })
      }
    }
    return peaks
  } catch (err) {
    console.warn('波形生成失败', err)
    return null
  }
}

export function buildRecord({ id, meta, thumb, hasPdf, hasAudio, pdfName, audioName }) {
  const structure = deriveStructure(meta)
  return {
    id,
    title: meta.title || t('store.untitled'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    meta,
    thumb: thumb || null,
    /** 封面是不是用户自己传的图（决定深色模式下要不要跟着 PDF 一起反色） */
    coverCustom: false,
    hasPdf,
    hasAudio,
    pdfName: pdfName || '',
    audioName: audioName || meta.audio?.name || '',
    pageCount: meta.pages?.length || 0,
    measureCount: structure.count,
    systemCount: structure.systems.length,
  }
}

/**
 * 新建一张乐谱：PDF 必需（可后补），音频与 JSON 可选
 */
export async function createScore({ title, pdfFile = null, audioFile = null, jsonFile = null, meta: metaInput = null } = {}) {
  const id = uid('sc')
  let raw = metaInput
  if (!raw && jsonFile) {
    try {
      raw = JSON.parse(await jsonFile.text())
    } catch {
      throw new Error(t('domain.error.badJson'))
    }
  }
  const meta = createMeta({ title: title || raw?.title || (pdfFile ? stripExt(pdfFile.name) : t('store.untitled')), ...(raw || {}) })
  if (title) meta.title = title

  let thumb = null
  if (pdfFile) {
    const renderer = await PdfRenderer.from(pdfFile)
    try {
      const sizes = await pageSizes(renderer.doc)
      syncPages(meta, sizes)
    } finally {
      renderer.destroy()
    }
    thumb = await makeThumbnail(pdfFile)
    await db.putFile(id, 'pdf', pdfFile)
  }
  if (audioFile) {
    meta.audio = { ...meta.audio, name: audioFile.name, type: audioFile.type || mimeForAudio(''), duration: await probeAudioDuration(audioFile) }
    await db.putFile(id, 'audio', audioFile)
  } else if (raw?.audio?.name) {
    meta.audio = { ...meta.audio, name: raw.audio.name, type: raw.audio.type || '' }
  }

  const record = buildRecord({ id, meta, thumb, hasPdf: !!pdfFile, hasAudio: !!audioFile, pdfName: pdfFile?.name, audioName: audioFile?.name })
  await db.putScore(record)
  await refresh()
  if (audioFile) ensurePeaks(id).catch(() => {})
  return record
}

export async function updateScoreMeta(id, meta) {
  const rec = await db.getScore(id)
  if (!rec) throw new Error(t('domain.error.scoreNotFound'))
  rec.meta = meta
  rec.title = meta.title || rec.title
  const structure = deriveStructure(meta)
  rec.measureCount = structure.count
  rec.systemCount = structure.systems.length
  rec.pageCount = meta.pages?.length || 0
  rec.hasAudio = !!meta.audio?.name
  rec.audioName = meta.audio?.name || ''
  rec.updatedAt = Date.now()
  await db.putScore(rec)
  const local = scores.value.find((s) => s.id === id)
  if (local) Object.assign(local, rec)
  return rec
}

export async function renameScore(id, title) {
  const rec = await db.getScore(id)
  if (!rec) return null
  const meta = { ...rec.meta, title: String(title || '').trim() || rec.title }
  return updateScoreMeta(id, meta)
}

/** 更新标签（数组，去重去空） */
export async function updateScoreTags(id, tags) {
  const rec = await db.getScore(id)
  if (!rec) return null
  return updateScoreMeta(id, { ...rec.meta, tags: normalizeTags(tags) })
}

/**
 * 换封面（`scores.thumb`，卡片直接读它）：
 *  · 传图片文件 → 等比缩到 420px 宽、存成 JPEG dataURL，记 `coverCustom = true`（深色模式不反色）
 *  · 传 null    → 用 PDF 第一页重新生成，回到默认封面（`coverCustom = false`，深色模式跟着反色）
 */
export async function setScoreCover(id, file = null) {
  const rec = await db.getScore(id)
  if (!rec) return null
  if (file) return applyCoverData(id, await imageToCover(file), true)
  const pdf = await db.getFile(id, 'pdf')
  return applyCoverData(id, pdf ? await makeThumbnail(pdf) : null, false)
}

/**
 * 直接写已经做好的封面 dataURL（导入 pmz 时用，不必再过一遍 canvas）。
 * `custom` **必须显式传**：「有没有图」和「是不是用户自己的图」不是一回事 ——
 * 默认封面（PDF 首页渲染的）同样是张图，但深色模式要跟着反色。
 */
export async function applyCoverData(id, thumb, custom = false) {
  const rec = await db.getScore(id)
  if (!rec) return null
  rec.thumb = thumb || null
  rec.coverCustom = !!thumb && !!custom
  rec.updatedAt = Date.now()
  await db.putScore(rec)
  const local = scores.value.find((s) => s.id === id)
  if (local) Object.assign(local, rec)
  return rec
}

/** Blob → dataURL（封面在记录里存的是 dataURL，不能存 objectURL） */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(new Error(t('domain.error.coverReadFailed')))
    fr.readAsDataURL(blob)
  })
}

/** 把用户选的图片压成封面。和 makeThumbnail 一样先铺白底，免得透明 PNG 变黑 */
async function imageToCover(file, maxWidth = 420) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(t('domain.error.imageReadFailed')))
      el.src = url
    })
    const iw = img.naturalWidth || maxWidth
    const ih = img.naturalHeight || maxWidth
    const scale = Math.min(1, maxWidth / iw)
    const w = Math.max(1, Math.round(iw * scale))
    const h = Math.max(1, Math.round(ih * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.72)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 单张乐谱的文件总占用（字节） */
export async function scoreFileInfo(id) {
  try {
    const [pdf, audio, peaks] = await Promise.all([db.getFile(id, 'pdf'), db.getFile(id, 'audio'), db.getFile(id, 'peaks')])
    return (pdf?.size || 0) + (audio?.size || 0) + (peaks?.byteLength || 0)
  } catch {
    return 0
  }
}

/** 曲库中出现过的所有标签及数量（按数量降序） */
export function collectTags(list) {
  const map = new Map()
  for (const rec of list || []) {
    // 局部变量别叫 t —— 会和 i18n 的 t() 撞名
    for (const tag of rec.meta?.tags || []) map.set(tag, (map.get(tag) || 0) + 1)
  }
  return [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'))
}

export async function removeScores(ids) {
  busy.value = t('store.removing')
  try {
    await db.deleteScores(ids)
    scores.value = scores.value.filter((s) => !ids.includes(s.id))
  } finally {
    busy.value = ''
  }
}

/**
 * 导出：单张直接给一个 `.pmz`；多张打成一个外层 **zip**，里面每张乐谱各是一个 `.pmz`
 */
export async function exportScores(ids) {
  busy.value = t('store.packing')
  try {
    const items = []
    for (const id of ids) {
      const rec = await db.getScore(id)
      if (!rec) continue
      items.push({
        title: rec.title,
        meta: rec.meta,
        pdf: await db.getFile(id, 'pdf'),
        audio: await db.getFile(id, 'audio'),
        peaks: await db.getFile(id, 'peaks'),
        // 只有用户自己换过的封面才带走；自动生成的缩略图导入时按 PDF 重新渲染即可
        thumb: rec.coverCustom ? rec.thumb : null,
      })
    }
    if (!items.length) throw new Error(t('store.nothingToExport'))
    const safe = (name) => (name || 'score').replace(/[\\/:*?"<>|]/g, '_')
    if (items.length === 1) {
      const blob = await buildScoreArchive(items[0])
      downloadBlob(blob, `${safe(items[0].title)}.pmz`)
      return blob
    }
    const archives = []
    for (const item of items) archives.push(await buildScoreArchive(item))
    const blob = await packArchives(archives, items.map((i) => i.title))
    downloadBlob(blob, t('store.exportZipName', { n: items.length }))
    return blob
  } finally {
    busy.value = ''
  }
}

/** 导入压缩包（pmz = 单张 / zip = 多张容器）/ 散装文件 */
export async function importFiles(fileList, { onProgress } = {}) {
  const files = Array.from(fileList || [])
  const created = []
  const problems = []
  const buckets = new Map() // 散装文件按文件名合并
  let i = 0
  try {
    for (const file of files) {
      i++
      busy.value = t('store.importing', { i, total: files.length })
      onProgress?.(i, files.length, file.name)
      try {
        if (isZipFile(file)) {
          const entries = await readZip(file)
          // 单个 pmz 里没有 score.json 时，用压缩包自己的文件名当标题
          const fallback = isPmzFile(file) ? stripExt(file.name) : ''
          for (const entry of entries) {
            const title = entry.meta?.title || fallback || (entry.pdfName ? stripExt(entry.pdfName) : stripExt(entry.audioName) || t('store.untitled'))
            const rec = await createScore({ title, pdfFile: entry.pdf, audioFile: entry.audio, meta: entry.meta })
            if (entry.peaks?.length) await db.putFile(rec.id, 'peaks', entry.peaks)
            if (entry.cover) await applyCoverData(rec.id, await blobToDataUrl(entry.cover), true)
            created.push(rec)
          }
        } else if (isPdfFile(file) || isAudioFile(file) || isJsonFile(file)) {
          const stem = stripExt(file.name)
          if (!buckets.has(stem)) buckets.set(stem, { stem })
          const bucket = buckets.get(stem)
          if (isPdfFile(file)) bucket.pdfFile = file
          else if (isAudioFile(file)) bucket.audioFile = file
          else bucket.jsonFile = file
        } else {
          problems.push(t('store.importProblem.unsupportedType', { name: file.name }))
        }
      } catch (err) {
        problems.push(t('store.importProblem.failed', { name: file.name, msg: err?.message || err }))
      }
    }
    for (const bucket of buckets.values()) {
      try {
        const rec = await createScore({
          title: bucket.jsonFile ? undefined : bucket.stem,
          pdfFile: bucket.pdfFile || null,
          audioFile: bucket.audioFile || null,
          jsonFile: bucket.jsonFile || null,
        })
        created.push(rec)
      } catch (err) {
        problems.push(t('store.importProblem.failed', { name: bucket.stem, msg: err?.message || err }))
      }
    }
    await refresh()
    return { created, problems }
  } finally {
    busy.value = ''
  }
}

export const libraryStats = computed(() => ({
  total: scores.value.length,
  withAudio: scores.value.filter((s) => s.hasAudio).length,
  measures: scores.value.reduce((sum, s) => sum + (s.measureCount || 0), 0),
}))

export function formatBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export { classifyFiles, cloneMeta }
