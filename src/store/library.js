import { computed, ref } from 'vue'
import * as db from '../db/idb.js'
import { createMeta, cloneMeta, normalizeTags, syncPages, uid } from '../domain/schema.js'
import { deriveStructure } from '../domain/timeline.js'
import { PdfRenderer, makeThumbnail, pageSizes } from '../domain/pdf.js'
import { detectPdfPages } from '../domain/omr.js'
import { peaksFromBlob } from '../domain/audio-peaks.js'
import { buildScoreArchive, classifyFiles, downloadBlob, fileStamp, isAudioFile, isImageFile, isJsonFile, isPdfFile, isPmzFile, isZipFile, packArchives, readZip, stripExt, mimeForAudio } from '../domain/zip.js'
import { t } from '../i18n/index.js'
import { task, toast } from './toast.js'

export const scores = ref([])
export const loading = ref(false)
export const error = ref('')
export const usage = ref(null)
export const sizes = ref(new Map())
export const sizesReady = ref(false)

let syncOpenRecord = null

export function onRecordUpdated(fn) {
  syncOpenRecord = fn
}

export const sizesTotal = computed(() => {
  let sum = 0
  for (const n of sizes.value.values()) if (Number.isFinite(n)) sum += n
  return sum
})

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
  loadSizes().catch(() => { })
  return scores.value
}

export async function loadSizes() {
  sizesReady.value = false
  try {
    const ids = (scores.value || []).map((s) => s.id)
    const next = new Map()
    await Promise.all(
      ids.map(async (id) => {
        next.set(id, await scoreFileInfo(id))
      })
    )
    const merged = new Map(sizes.value)
    let complete = true
    for (const id of ids) {
      const bytes = next.get(id)
      if (Number.isFinite(bytes)) merged.set(id, bytes)
      else complete = false
    }
    sizes.value = merged
    sizesReady.value = complete
  } catch (err) {
    console.warn('占用大小统计失败', err)
  }
}

export function touchSize(id, delta = null) {
  if (!id) return
  const next = new Map(sizes.value)
  if (delta === null || !next.has(id)) next.delete(id)
  else next.set(id, Math.max(0, next.get(id) + delta))
  sizes.value = next
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
        await db.putScore({ ...rec, openedAt: rec.openedAt })
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
    editDone: false,
    openedAt: Date.now(),
    meta,
    thumb: thumb || null,
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

async function autoMarkPdf(meta, pdfFile, onStatus = null) {
  const hasMarks = (meta.pages || []).some((p) => p.systems?.length)
  if (hasMarks) return
  try {
    const result = await detectPdfPages(pdfFile, {
      onPage: (page, total) => {
        onStatus?.(t('store.autoMarking', { page, total }), page, total)
      },
    })
    let systems = 0
    let bars = 0
    let measures = 0
    for (let i = 0; i < result.pages.length; i++) {
      const list = result.pages[i] || []
      if (meta.pages[i]) meta.pages[i].systems = list
      for (const s of list) {
        systems++
        bars += s.bars?.length || 0
        measures += Math.max(0, (s.bars?.length || 0) - 1)
      }
    }
    if (systems) onStatus?.(t('store.marked', { systems, bars, measures }))
  } catch (err) {
    console.warn('自动标记失败，这份谱照常导入，可以手动标行与小节线', err)
  }
}

export async function createScore({ title, pdfFile = null, audioFile = null, jsonFile = null, meta: metaInput = null, onStatus = null } = {}) {
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
    await autoMarkPdf(meta, pdfFile, onStatus)
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
  if (audioFile) ensurePeaks(id).catch(() => { })
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
  await db.putScore(rec)
  const local = scores.value.find((s) => s.id === id)
  if (local) Object.assign(local, rec)
  syncOpenRecord?.(rec)
  return rec
}

export async function markOpened(id) {
  if (!id) return null
  const rec = await db.getScore(id)
  if (!rec) return null
  rec.openedAt = Date.now()
  await db.putScore(rec)
  const local = scores.value.find((s) => s.id === id)
  if (local) local.openedAt = rec.openedAt
  return rec
}

export async function markEditDone(id) {
  if (!id) return null
  const rec = await db.getScore(id)
  if (!rec) return null
  if (rec.editDone) return rec
  rec.editDone = true
  await db.putScore(rec)
  const local = scores.value.find((s) => s.id === id)
  if (local) local.editDone = true
  return rec
}

export async function renameScore(id, title) {
  const rec = await db.getScore(id)
  if (!rec) return null
  const meta = { ...rec.meta, title: String(title || '').trim() || rec.title }
  return updateScoreMeta(id, meta)
}

export async function updateScoreTags(id, tags) {
  const rec = await db.getScore(id)
  if (!rec) return null
  return updateScoreMeta(id, { ...rec.meta, tags: normalizeTags(tags) })
}

export async function setScoreCover(id, file = null) {
  const rec = await db.getScore(id)
  if (!rec) return null
  if (file) return applyCoverData(id, await imageToCover(file), true)
  const pdf = await db.getFile(id, 'pdf')
  return applyCoverData(id, pdf ? await makeThumbnail(pdf) : null, false)
}

export async function applyCoverData(id, thumb, custom = false) {
  const rec = await db.getScore(id)
  if (!rec) return null
  const before = coverBytes(rec.thumb)
  rec.thumb = thumb || null
  rec.coverCustom = !!thumb && !!custom
  await db.putScore(rec)
  const local = scores.value.find((s) => s.id === id)
  if (local) Object.assign(local, rec)
  touchSize(id, coverBytes(rec.thumb) - before)
  return rec
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(new Error(t('domain.error.coverReadFailed')))
    fr.readAsDataURL(blob)
  })
}

export async function imageToCover(file, maxWidth = 420) {
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

function coverBytes(dataUrl) {
  const str = typeof dataUrl === 'string' ? dataUrl : ''
  const comma = str.indexOf(',')
  if (comma < 0 || !/;base64$/i.test(str.slice(0, comma))) return str.length
  const body = str.length - comma - 1
  let pad = 0
  if (str.endsWith('==')) pad = 2
  else if (str.endsWith('=')) pad = 1
  return Math.max(0, Math.floor((body * 3) / 4) - pad)
}

export async function scoreFileInfo(id) {
  const rec = await db.getScore(id)
  if (!rec) return null
  const [pdf, audio, peaks] = await Promise.all([db.getFile(id, 'pdf'), db.getFile(id, 'audio'), db.getFile(id, 'peaks')])
  return (pdf?.size || 0) + (audio?.size || 0) + (peaks?.byteLength || 0) + coverBytes(rec.thumb)
}

export function collectTags(list) {
  const map = new Map()
  for (const rec of list || []) {
    for (const tag of rec.meta?.tags || []) map.set(tag, (map.get(tag) || 0) + 1)
  }
  return [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'))
}

export async function removeScores(ids) {
  if (!ids?.length) return
  const handle = task(t('store.removing'))
  try {
    await db.deleteScores(ids)
    scores.value = scores.value.filter((s) => !ids.includes(s.id))
    const next = new Map(sizes.value)
    for (const id of ids) next.delete(id)
    sizes.value = next
    handle.done(t('library.deleted', { n: ids.length }))
  } catch (err) {
    handle.close()
    throw err
  }
}

export async function exportScores(ids) {
  const handle = task(t('store.packing'))
  try {
    const items = []
    for (const id of ids) {
      if (ids.length > 1) handle.update(t('store.packingItems', { i: items.length + 1, total: ids.length }), items.length + 1, ids.length)
      const rec = await db.getScore(id)
      if (!rec) continue
      items.push({
        title: rec.title,
        meta: rec.meta,
        pdf: await db.getFile(id, 'pdf'),
        audio: await db.getFile(id, 'audio'),
        peaks: await db.getFile(id, 'peaks'),
        thumb: rec.coverCustom ? rec.thumb : null,
      })
    }
    if (!items.length) throw new Error(t('store.nothingToExport'))
    const safe = (name) => (name || 'score').replace(/[\\/:*?"<>|]/g, '_')
    if (items.length === 1) {
      const blob = await buildScoreArchive(items[0])
      downloadBlob(blob, `${safe(items[0].title)}.psz`)
    } else {
      const archives = []
      for (const item of items) archives.push(await buildScoreArchive(item))
      const blob = await packArchives(archives, items.map((i) => i.title))
      downloadBlob(blob, t('store.exportZipName', { n: items.length, time: fileStamp() }))
    }
    handle.done(t('library.exported', { n: items.length }))
    return items.length
  } catch (err) {
    handle.close()
    throw err
  }
}

export async function importFiles(fileList, { bindNew = null } = {}) {
  const files = Array.from(fileList || [])
  const created = []
  const problems = []
  const buckets = new Map()
  let i = 0
  if (!files.length) return { created, problems }
  const handle = task(t('store.importingUnknown'))
  const onStatus = (text, done = null, total = null) => handle.update(text, done, total)
  try {
    for (const file of files) {
      i++
      handle.update(t('store.importing', { i, total: files.length }), i, files.length)
      try {
        if (isZipFile(file)) {
          const entries = await readZip(file)
          const fallback = isPmzFile(file) ? stripExt(file.name) : ''
          for (const entry of entries) {
            const title = entry.meta?.title || fallback || (entry.pdfName ? stripExt(entry.pdfName) : stripExt(entry.audioName) || t('store.untitled'))
            const rec = await createScore({ title, pdfFile: entry.pdf, audioFile: entry.audio, meta: entry.meta, onStatus })
            if (entry.peaks?.length) await db.putFile(rec.id, 'peaks', entry.peaks)
            if (entry.cover) await applyCoverData(rec.id, await blobToDataUrl(entry.cover), true)
            created.push(rec)
            bindNew?.(rec)
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
          onStatus,
        })
        created.push(rec)
        bindNew?.(rec)
      } catch (err) {
        problems.push(t('store.importProblem.failed', { name: bucket.stem, msg: err?.message || err }))
      }
    }
    await refresh()
    return { created, problems }
  } finally {
    const text = problems[0] || (created.length ? t('library.imported', { n: created.length }) : '')
    handle.done(text, problems.length ? 4200 : 2400, problems.length ? 'danger' : 'accent')
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
