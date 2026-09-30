/**
 * zip / psz 导入导出（fflate）
 *
 * 单张乐谱 = 一个 `.psz`（就是改了后缀的 zip，内容直接放在压缩包根目录）：
 *   score.json   元数据（小节线、段落、跳转记号…）
 *   score.pdf    PDF 乐谱
 *   audio.<ext>  音频
 *   peaks.f32    波形峰值缓存（可选，缺失时自动重算）
 *   cover.<ext>  自定义封面（可选，只有用户换过封面时才在）
 *
 * 多张导出 = 外层 **zip**（装多张乐谱的容器），里面**每张乐谱各是一个 `.psz`**：
 *   <名称>.psz
 *   <名称2>.psz
 * 读的时候会把嵌套的 psz / zip 递归摊平，所以单个 psz、外层 zip、以及旧版
 * 「每张一个子目录」的 zip 都能读。
 *
 *  · **术语别混**：`.psz` = 单张乐谱的压缩包；`.zip` = 装多张 psz 的容器。
 *  · 摊平规则：嵌套条目展开到「以该条目文件名命名的子目录」里，所以外层 zip 里的每张 psz 各成一组、
 *    不会串味；同目录内按扩展名识别（JSON 优先认 `score` / `meta` / `sheet` / `index`，封面认 `cover.*`），
 *    **同一个目录里的 pdf / 音频 / `score.json` 合成一张乐谱**。
 *  · 导出多张时每张 psz 以**标题命名**（重名自动加 `-2`）；导入侧的拖放分类入口是 `classifyFiles`。
 *  · 解析失败要给用户看得懂的报错（走 `t()`），别把 fflate 的原始异常直接抛给界面。
 */
import { zip, unzip, strToU8, strFromU8 } from 'fflate'
import { t } from '../i18n/index.js'

export const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'mp4']
/** 容器类扩展名：zip 与「乐谱压缩包改后缀」的 psz */
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

/**
 * 一张乐谱要写进压缩包的文件集合（内容直接在根目录，不再套子目录）。
 * 自定义封面（记录里的 `thumb`，dataURL）也一起进包，所以 psz 是「一张乐谱的完整快照」。
 */
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

/** `data:image/jpeg;base64,…` → 原始字节 + 扩展名；不是 base64 dataURL 就返回 null */
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

/**
 * 单张乐谱 → `.psz` 内容（一个 zip Blob，文件名由调用方加 `.psz` 后缀）
 * @param {{title, meta, pdf?:Blob, audio?:Blob, peaks?:Float32Array, thumb?:string}} item
 * @returns {Promise<Blob>}
 */
export async function buildScoreArchive(item) {
  const zipped = await zipAsync(await scoreFiles(item))
  return new Blob([zipped], { type: 'application/zip' })
}

/**
 * 文件名用的时间戳：`yyyymmdd-hhmmss`。
 * 取的是**本机本地时间**，不带时区后缀 —— 它只是给用户认「这是哪一次导出的」，不是可解析的时间格式。
 * 放在 domain 层是为了让 `scripts/unit-test.mjs` 能在 node 里直接量它（`store/library.js` 引了 pdf.js，node 加载不了）。
 */
export function fileStamp(d = new Date()) {
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * 多张乐谱 → 外层 zip，每张乐谱是一个以标题命名的 `.psz`（重名自动加 `-2`）
 * @param {Array<Blob>} archives 已经打好的单张 psz
 * @param {Array<string>} titles
 * @returns {Promise<Blob>}
 */
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

/**
 * 读取压缩包 -> 若干张乐谱的原始文件集合。
 * 术语：`.psz` = 单张乐谱的压缩包（内容在根目录）；`.zip` = 装多张乐谱的容器（里面每个 `.psz` 一张）。
 * 两种都读，嵌套的压缩包会被递归摊平，内容归到该条目所在目录下。
 * @returns {Promise<Array<{dir, meta, pdf, audio, peaks, cover, names}>>}
 */
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
    // 自定义封面：包里的 cover.jpg / cover.png…
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

/**
 * 把一层压缩包摊平成「目录 + 文件」列表；遇到嵌套的 psz / zip 就继续往里展开。
 * 展开时用**该条目的文件名**当子目录：外层 zip 里每张 psz 因此各自成组，不会互相串味。
 */
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
        // 不是压缩包就当成普通文件（理论上不会走到这里）
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

/**
 * 把拖入 / 选中的一堆文件按「能干什么」分类（导入分流的唯一依据，见 `PlayerView`）：
 *  · archives：zip / psz —— 里面是一张或多张乐谱
 *  · pdfs：新建乐谱
 *  · audios / images：作用在**当前打开的那一份**上（没打开乐谱时这两种都不收）
 *  · **没有「json」这一类**：散装的一份 `.json` 不是可导入的类型（它没有 PDF，成不了一张乐谱）——
 *    包里那份 `score.json` 是压缩包的内部结构，由 `readZip` 自己按扩展名认，不走这里。
 */
export function classifyFiles(fileList) {
  const out = { archives: [], pdfs: [], audios: [], images: [], unknown: [] }
  for (const file of Array.from(fileList || [])) {
    if (isZipFile(file)) out.archives.push(file)
    else if (isPdfFile(file)) out.pdfs.push(file)
    else if (isAudioFile(file)) out.audios.push(file)
    else if (isImageFile(file)) out.images.push(file)
    else out.unknown.push(file)
  }
  return out
}

export function stripExt(name = '') {
  return name.replace(/\.[a-z0-9]+$/i, '')
}
