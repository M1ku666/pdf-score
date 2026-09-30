import { zip, unzip, strToU8, strFromU8 } from 'fflate'
import { t } from '../i18n/index.js'

export const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'mp4']
export const ARCHIVE_EXT = ['zip', 'psz']
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp']

function extOf(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  return m ? m[1].toLowerCase() : ''
}

function safeName(name, fallback = 'score') {
  const base = (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim()
  return base || fallback
}

function zipAsync(files) {
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

function unzipAsync(data) {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)))
  })
}

async function scoreFiles(item) {
  const files = {}
  const meta = JSON.parse(JSON.stringify(item.meta || {}))
  meta.title = item.meta?.title || item.title || 'score'
  files['score.json'] = strToU8(JSON.stringify(meta, null, 2))
  if (item.pdf) files['score.pdf'] = new Uint8Array(await item.pdf.arrayBuffer())
  if (item.audio) {
    const ext = extOf(item.audio.name || item.meta?.audio?.name) || 'mp3'
    files[`audio.${ext}`] = new Uint8Array(await item.audio.arrayBuffer())
  }
  if (item.peaks && item.peaks.length) {
    files['peaks.f32'] = new Uint8Array(item.peaks.buffer.slice(0))
  }
  const cover = dataUrlToBytes(item.thumb)
  if (cover) files[`cover.${cover.ext}`] = cover.bytes
  return files
}

function dataUrlToBytes(url) {
  if (typeof url !== 'string') return null
  const comma = url.indexOf(',')
  if (comma < 0 || !/^data:image\//i.test(url)) return null
  const head = url.slice(0, comma)
  if (!/;base64/i.test(head)) return null
  const mime = head.slice(5, head.indexOf(';')).toLowerCase()
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg'
  try {
    return { ext, bytes: base64ToBytes(url.slice(comma + 1)) }
  } catch {
    return null
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function buildScoreArchive(item) {
  const zipped = await zipAsync(await scoreFiles(item))
  return new Blob([zipped], { type: 'application/zip' })
}

export function fileStamp(d = new Date()) {
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export async function packArchives(archives, titles) {
  const files = {}
  const used = new Set()
  for (let i = 0; i < archives.length; i++) {
    const base = safeName(titles[i], 'score')
    let name = base
    let n = 2
    while (used.has(name)) name = `${base}-${n++}`
    used.add(name)
    files[`${name}.psz`] = new Uint8Array(await archives[i].arrayBuffer())
  }
  const zipped = await zipAsync(files)
  return new Blob([zipped], { type: 'application/zip' })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export async function readZip(file) {
  const data = new Uint8Array(await file.arrayBuffer())
  let flat
  try {
    flat = await flattenArchive(data, '')
  } catch (err) {
    throw new Error(t('domain.error.zipReadFailed', { msg: err?.message || err }))
  }
  const groups = new Map()
  for (const entry of flat) {
    if (!groups.has(entry.dir)) groups.set(entry.dir, [])
    groups.get(entry.dir).push(entry)
  }
  const out = []
  for (const [dir, list] of groups) {
    const pdf = list.find((e) => extOf(e.name) === 'pdf')
    const audio = list.find((e) => AUDIO_EXT.includes(extOf(e.name)))
    const json = list.find((e) => extOf(e.name) === 'json' && /^(score|meta|sheet|index)/i.test(e.name)) || list.find((e) => extOf(e.name) === 'json')
    const peaks = list.find((e) => extOf(e.name) === 'f32' || e.name.toLowerCase() === 'peaks.bin')
    const cover = list.find((e) => IMAGE_EXT.includes(extOf(e.name)) && /^cover\b/i.test(stripExt(e.name)))
    if (!pdf && !audio && !json) continue
    out.push({
      dir,
      meta: json ? parseJson(strFromU8(json.bytes)) : null,
      pdf: pdf ? new Blob([pdf.bytes], { type: 'application/pdf' }) : null,
      pdfName: pdf?.name || '',
      audio: audio ? new Blob([audio.bytes], { type: mimeForAudio(extOf(audio.name)) }) : null,
      audioName: audio?.name || '',
      peaks: peaks ? toFloat32(peaks.bytes) : null,
      cover: cover ? new Blob([cover.bytes], { type: `image/${extOf(cover.name) === 'jpg' ? 'jpeg' : extOf(cover.name)}` }) : null,
      names: list.map((e) => e.name),
    })
  }
  if (!out.length) throw new Error(t('domain.error.zipNoScore'))
  return out
}

async function flattenArchive(data, baseDir) {
  const entries = await unzipAsync(data)
  const out = []
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('/')) continue
    const norm = path.replace(/\\/g, '/')
    if (norm.split('/').some((p) => p === '__MACOSX' || p.startsWith('._'))) continue
    const slash = norm.lastIndexOf('/')
    const dir = (slash >= 0 ? norm.slice(0, slash + 1) : '').replace(/^\/+/, '')
    const name = norm.slice(slash + 1)
    if (!name || name.startsWith('.')) continue
    const fullDir = `${baseDir}${dir}`
    if (ARCHIVE_EXT.includes(extOf(name))) {
      try {
        out.push(...(await flattenArchive(bytes, `${fullDir}${safeName(stripExt(name))}/`)))
        continue
      } catch {
      }
    }
    out.push({ dir: fullDir, name, bytes })
  }
  return out
}

function toFloat32(bytes) {
  try {
    const copy = new Uint8Array(bytes.byteLength - (bytes.byteLength % 4))
    copy.set(bytes.subarray(0, copy.length))
    return new Float32Array(copy.buffer)
  } catch {
    return null
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function mimeForAudio(ext) {
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'm4a':
    case 'mp4':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'ogg':
    case 'oga':
      return 'audio/ogg'
    case 'opus':
      return 'audio/opus'
    case 'flac':
      return 'audio/flac'
    case 'webm':
      return 'audio/webm'
    default:
      return 'audio/*'
  }
}

export function isAudioFile(file) {
  if (!file) return false
  if (file.type?.startsWith('audio/')) return true
  return AUDIO_EXT.includes(extOf(file.name))
}

export function isPdfFile(file) {
  return !!file && (file.type === 'application/pdf' || extOf(file?.name) === 'pdf')
}

export function isZipFile(file) {
  if (!file) return false
  const mime = file.type || ''
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed') return true
  return ARCHIVE_EXT.includes(extOf(file.name))
}

export function isPmzFile(file) {
  return !!file && extOf(file?.name) === 'psz'
}

export function isImageFile(file) {
  if (!file) return false
  if ((file.type || '').startsWith('image/')) return true
  return IMAGE_EXT.includes(extOf(file.name))
}

export function isJsonFile(file) {
  return !!file && (file.type === 'application/json' || extOf(file?.name) === 'json')
}

export function classifyFiles(fileList) {
  const out = { archives: [], pdfs: [], audios: [], jsons: [], images: [], unknown: [] }
  for (const file of Array.from(fileList || [])) {
    if (isZipFile(file)) out.archives.push(file)
    else if (isPdfFile(file)) out.pdfs.push(file)
    else if (isAudioFile(file)) out.audios.push(file)
    else if (isJsonFile(file)) out.jsons.push(file)
    else if (isImageFile(file)) out.images.push(file)
    else out.unknown.push(file)
  }
  return out
}

export function stripExt(name = '') {
  return name.replace(/\.[a-z0-9]+$/i, '')
}
