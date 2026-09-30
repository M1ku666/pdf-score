/**
 * 乐谱库（gallery）状态与数据操作
 * 创建 / 导入（psz 单张、zip 多张、散装文件）/ 导出 / 删除 / 封面 / 标签 / 占用与容量统计。
 *
 *  · 面板的界面规则（顶栏、标签筛选、卡片、信息面板、贴底导入按钮）写在 `LibraryPanel.vue` 头部。
 *  · **封面反色只看 `coverCustom`，不要用 `!!thumb` 推断**：`applyCoverData(id, thumb, custom)` 的
 *    custom **必须显式传** —— 换图 `true`、用 PDF 首页重生成 `false`、导入 psz 里带封面 `true`
 *    （否则「恢复默认」之后会被当成自定义封面、深色模式下不反色）。`imageToCover()` 铺白底 `#ffffff`
 *    是**允许硬编码的白名单项**（透明 PNG 转 JPEG 必须铺白，且存储时按 420px 宽等比缩、不改比例）。
 *  · 包格式（psz / zip 的内容与命名）见 `domain/zip.js` 头部；文件类型分类走它的 `classifyFiles`，
 *    唯一的拖放入口在 `PlayerView`。
 *  · 删乐谱要连 `<id>/pdf`、`<id>/audio`、`<id>/peaks` 三个键一起删（见 `db/idb.js`）。
 *  · **`sizes` 是「列表要显示 / 排序的占用」的派生缓存**（`Map<id, 字节>`，来自 `scoreFileInfo`）：
 *    只读地量一遍（`db.getFile` 一次一页读 `size` + 记录里的封面），不往记录里写 `size` 字段 ——
 *    它跟着数据走，写进记录就会有对不上的时候。**它有失效时机**，只有两处会重算：
 *    整表 `refresh()`、以及数据真的变过的 `touchSize(id, delta)`（音频 / 波形 / PDF / 封面那几个入口调）。
 *    在别处改了 `files` 或封面之后不补一次 `touchSize`，列表上的数字与排序就会停在旧值上。
 *  · **占用 = 这张乐谱在本地占的「一切」**：`<id>/pdf` + `<id>/audio` + `<id>/peaks` + 记录里的封面
 *    （`scores.thumb` 是 dataURL，同样是实打实落库的字节）。**不拆成分项** —— 列表与信息面板都只有
 *    一个总数（见 docs/ui.md），量不到时 `scoreFileInfo` 返回 `null`，**别拿 0 冒充「空谱」**。
 */
import { computed, ref } from 'vue'
import * as db from '../db/idb.js'
import { applyDetectedSystems, createMeta, cloneMeta, normalizeTags, syncPages, uid } from '../domain/schema.js'
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
/**
 * 每张乐谱的占用字节（`Map<id, number>`）—— 列表的灰色小字与「按占用大小」排序都读它。
 * **是这张谱在本地占的一切**（PDF + 音频 + 波形 + 封面），见 `scoreFileInfo`。
 * **不是持久数据**：只读地量一遍之后缓存在这里，改动路径见文件头注释。
 */
export const sizes = ref(new Map())
/**
 * `sizes` **量完了没**。列表里逐张缺值就显示「统计中…」，不需要这个标志；
 * 但「整库占用」是个**合计**（见 `sizesTotal`），得知道「一张都还没量到」是
 * 「还没量完」还是「库里真的没有乐谱」，否则会把前者显示成 0。
 */
export const sizesReady = ref(false)

/**
 * 「这条记录刚被 `updateScoreMeta()` 改过」的通知钩子 —— 只在**库里有对应记录**时收到那一份新记录。
 *
 * 库里那些改动（改标题 / 标签 / 封面 / 标记）落库之后，**打开着的那一张**不会自动跟着变：
 * `player.record` 是 `open()` 当时读回来的副本，改的还是另一份（见 `updateScoreMeta` 里的说明）。
 * 本文件不能直接去改它 —— `store/player.js` 引了本文件，反向再引就是循环依赖，所以留这个钩子，
 * 由 `store/player.js` 在自己那一侧挂上（写法照 `store/ui.js` 的 `backGuard`）。
 */
let syncOpenRecord = null

/** 挂上/换掉那个钩子（`store/player.js` 调；传 null 表示不接） */
export function onRecordUpdated(fn) {
  syncOpenRecord = fn
}

/**
 * 整库占用（字节）＝ `sizes` 里所有已量到的值之和。**这是"手动算"的那一份**，
 * 与 `usage`（浏览器报的、含本 origin 其它存储）不是一回事：它只算乐谱库自己占了多少。
 * `sizesReady` 为假时**不要去读它当结果** —— 那时它只是「目前量到的部分」。
 */
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

/**
 * 量一遍库里所有乐谱的占用，写进 `sizes`（列表要显示与排序的那份缓存）。
 * 单张量不到就**不写进这一张**（它退回「统计中…」），整批也**不置 `sizesReady`**：
 * 宁可一直显示「统计中…」，也不要把一个偏小的合计当成真实占用报出去。
 */
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
    // 量失败就保持原样（包括 `sizesReady` 仍是假）：宁可一直显示「统计中…」，
    // 也不要把一个偏小的合计当成真实占用报出去
    console.warn('占用大小统计失败', err)
  }
}

/**
 * 把某一首已缓存的占用**就地挪一个增量**（正数变大、负数变小），用在文件 / 封面换过之后。
 * 拿不到最新真实值的调用方传 `null`，那首就退回「还没量到」、等下一次 `loadSizes`。
 */
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
    /**
     * **这份谱的编辑完成了没有**：新建 / 导入时是 `false`，第一次点「完成」时置真
     * （`markEditDone`）。乐谱库据此把「未完成编辑」的单独列在列表最上面一栏，
     * `open()` 也据此决定要不要自动进编辑模式。**不进包**（见 `docs/data-format.md`）。
     */
    editDone: false,
    /** **最近一次打开的时间**：新建时就按「刚打开过」算，之后只有 `open()` 会刷新它 */
    openedAt: Date.now(),
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
 * 导入 PDF 时自动标出**行与小节线**（`domain/omr.js`），**无条件跑、没有开关**。
 *
 *  · 已经有行就不再跑：JSON / pmz 里带的标记是用户的成果，自动识别不能盖掉它
 *    —— 所以要先 `syncPages`，再交给 `schema.js` 的 `applyDetectedSystems` 填
 *    （它只填还没有行的那一页）。
 *  · **失败绝不连累导入**：识别只是省手工，认不出来就当没有 `systems`，
 *    照旧把 PDF 存进去（用户还能手动标）。所以这里自己 catch，不往上抛。
 *  · **它自己不弹通知，只往调用方那条任务上报**：整件事（导入 → 识别 → 完成）从头到尾
 *    **只有一条 toast**（用户要求「任务完成后变为一次性通知显示任务完成，而不是新发一个通知说完成」）。
 *    曾经这里自己 `task(...)` 一条，于是「导入」那条被顶掉、完成语各自弹一条，屏幕上会出现
 *    「识别完成」和「已导入」两条 —— 那正是要被消灭的现象。
 *    `onStatus(text, done, total)` 由**外面那条任务的 handle** 提供（`createScore` → `importFiles`）；
 *    没有调用方接（例如将来别处单跑识别）就静默跑完，不自己造第二条通知。
 *  · **有真实进度**：`detectPdfPages` 一页页地报 `onPage`，`onStatus` 把「第 n/total 页」
 *    同时写进文案与圆环。总数第一页就带上来，所以第一帧就是确定进度，不会先转几圈再变。
 *  · 本函数**只写 meta 不落库**：识别完的 meta 由 `createScore` 存进 `scores` 里。
 */
async function autoMarkPdf(meta, pdfFile, onStatus = null) {
  const hasMarks = (meta.pages || []).some((p) => p.systems?.length)
  if (hasMarks) return
  try {
    const result = await detectPdfPages(pdfFile, {
      onPage: (page, total) => {
        onStatus?.(t('store.autoMarking', { page, total }), page, total)
      },
    })
    const counts = applyDetectedSystems(meta.pages, result)
    // 报一句「标出了多少」：这份谱一打开就带着一堆标记，是这次导入**自己加上的**，
    // 不说一声用户会以为是数据串了。一条都没认出来（扫描件糊、不是乐谱）就不改文案
    // —— 后面那个文件 / 收尾语会接着写这条通知。
    if (counts.systems) onStatus?.(t('store.marked', counts))
  } catch (err) {
    console.warn('自动标记失败，这份谱照常导入，可以手动标行与小节线', err)
  }
}

/**
 * 新建一张乐谱：PDF 必需（可后补），音频与 JSON 可选。
 * `onStatus` 一路传给 `autoMarkPdf` —— 这样「识别第 n 页」也落在**调用方那一条**通知上。
 */
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
  // **不动 `openedAt` / `editDone`**：改标记、改标签、改标题都不是「打开」也不是「编辑完成」，
  // `openedAt` 只认 `open()`、`editDone` 只认「完成」那颗钮
  await db.putScore(rec)
  const local = scores.value.find((s) => s.id === id)
  if (local) Object.assign(local, rec)
  /**
   * **正在打开着的那一张也要跟着变**：`open()` 赋给 `player.record` 的是**当时**从库里读回来的那一份，
   * 与 `scores.value` 里那条是**两个不同的对象**（`db.getScore()` 每次给的都是新的），
   * 所以上面那句 `Object.assign(local, …)` 照不到它。
   *
   * 里头**全是记录级字段**（`title` / `meta` / `pageCount` / `measureCount` / `hasAudio`…），
   * 没有一个是 `player` 自己的会话状态，整份换掉是安全的。
   *
   * 为什么不在这里 `import` player：`store/player.js` 引了本文件，反向再引就成了循环依赖。
   * 所以只留一个钩子，由 `store/player.js` 在自己那一侧挂上（照 `store/ui.js` 的 `backGuard` 那套写法）。
   */
  syncOpenRecord?.(rec)
  return rec
}

/**
 * 记一次「打开」：把 `openedAt` 刷成现在。**排序用的「最近一次打开」就是它**，
 * 由 `store/player.js` 的 `open()` 调用（打开乐谱的唯一入口就是那里）。
 * **它不碰 `editDone`** —— 「打开过」与「编辑完成」是两件事（后者见 `markEditDone`）。
 */
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

/**
 * 记一次「编辑完成」：把 `editDone` 置真 —— **只有第一次真的写库**，之后各次都是空转。
 * 由 `store/player.js` 的 `finishEdit()` 调用（底栏那颗「完成」的唯一落点）。
 *
 * 置真之后：乐谱库把它从「未完成编辑」那一栏挪到下面「已完成编辑」那一栏，
 * `open()` 也不再自动进编辑模式。
 */
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
 *
 * 封面也在占用里，所以写完要**按封面自己挪一次 `sizes` 的增量**：记录里的旧值就是基准，
 * 不必重读文件。**换封面只有这一条出口**（`setScoreCover` 的三条路都落到这里），
 * 增量只在这一处算得全。
 */
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

/** Blob → dataURL（封面在记录里存的是 dataURL，不能存 objectURL） */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(new Error(t('domain.error.coverReadFailed')))
    fr.readAsDataURL(blob)
  })
}

/**
 * 把用户选的图片压成封面：等比缩到 `maxWidth` 宽、先铺白底再画（免得透明 PNG 变黑）、
 * 存成 JPEG dataURL。**唯一的出口**是 `applyCoverData`（存记录）。
 *
 * 换封面的确认框也调它来做「新的封面」那张预览 —— 于是并排看到的那张图**就是存下来会得到的那张**
 * （同一个函数、同一个尺寸与质量），不会出现「预览好看、存下来发黑」这种事。
 */
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

/**
 * 封面的字面字节：`scores.thumb` 存的是 `data:image/jpeg;base64,…`，**base64 每 4 个字符合 3 字节**，
 * 所以不能拿字符串长度当占用（那会虚报约 1/3）。不是 base64 dataURL 就退回字符数（近似，好过不算）。
 */
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

/**
 * 单张乐谱的总占用（字节）= `<id>/pdf` + `<id>/audio` + `<id>/peaks` + 记录里的封面。
 * **量不到（读库抛错、记录读不出来）返回 `null`** —— 调用方据此退回「统计中…」，
 * 所以这里不要 `catch` 成 0：0 会被显示成 `0 B`、还会把这张谱排到「最小」那一头，
 * 与事实（根本没量到）正好相反。
 */
export async function scoreFileInfo(id) {
  const rec = await db.getScore(id)
  if (!rec) return null
  const [pdf, audio, peaks] = await Promise.all([db.getFile(id, 'pdf'), db.getFile(id, 'audio'), db.getFile(id, 'peaks')])
  return (pdf?.size || 0) + (audio?.size || 0) + (peaks?.byteLength || 0) + coverBytes(rec.thumb)
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

/**
 * 删除若干张乐谱。**任务型通知（第二类）但进度未知**：`db.deleteScores` 一次删完、
 * 中途没有任何可报的比例，所以这条只显示无限进度环，删完**同一条就地报**「已删除 n 张乐谱。」
 * （调用方不许再补一句 —— 补了就是两条通知）。
 * （别为了有进度把它拆成一堆单删 —— 那要写很多次库，也比一次事务慢。）
 *
 * ⚠️ **失败不在这里报**：这里只把进度收掉再抛出，由调用方（`LibraryPanel.doDelete`）
 * 弹一条「删除失败」—— 两边都报就是同一件事出现两遍。
 */
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

/**
 * 导出：单张直接给一个 `.pmz`；多张打成一个外层 **zip**，里面每张乐谱各是一个 `.pmz`。
 *
 * **任务型通知（第二类）**：多张时逐张读库 + 打包是串行的，「第 i/n 张」同时进文案与圆环；
 * 收尾时**同一条就地变成**「已导出 n 张乐谱」（n 按**真的打进去的张数**报，不是请求的张数）。
 * ⚠️ **失败不在这里报**：那属于「另一件事」（调用方 `LibraryPanel` 的 `doExport` / `doExportAll`
 * 会弹一条错误提示），这里只把进度收掉再抛出 —— 两边都报就是同一句话出现两遍。
 */
export async function exportScores(ids) {
  const handle = task(t('store.packing'))
  try {
    const items = []
    for (const id of ids) {
      // 单张时不报「第 1/1 张」那种废话，直接留着「正在打包…」
      if (ids.length > 1) handle.update(t('store.packingItems', { i: items.length + 1, total: ids.length }), items.length + 1, ids.length)
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

/**
 * 导入压缩包（pmz = 单张 / 多张容器）/ 散装文件。
 *
 * **任务型通知（第二类），有真实进度**：一个文件 = 一格，「第 i/n 个」同时进文案与圆环；
 * 一格内部的子步骤（自动识别第 n/m 页）也**写在这一条上**（`onStatus` 一路传进 `createScore`）。
 *
 * **收尾只有这一条通知**（用户要求「任务完成后变为一次性通知显示任务完成，而不是
 * 新发一个通知说完成」）：成功报「已导入 n 张」、出问题报那条问题的原文（两条同时成立时
 * **先报问题**，它更需要被看见）、一件都没进来就收掉。所以**调用方不许再补一条提示** ——
 * 只有「它压根没走到这一步」的意外才由调用方 `catch` 里报，而那种情况本函数
 * **一条通知都还没弹过**（任务是在第一个文件开始处理时才起的），两边不会都报。
 *
 * **每进库一张就 `bindNew(rec)` 报一次**（含散装文件那一轮）：调用方靠它知道「刚才进来的是哪一张」——
 * 乐谱库据此把列表滚到新谱并**给这一行铺一档底色**（见 `LibraryPanel` 的 `newIds` / `markFresh`），
 * 所以多张的导入是**进来一张亮一下**。**不参与落库**（记录早在 `createScore` 里存好了）。
 *
 * ⚠️ **不许改成「整批导完只报一次」**：那样多张会**一块亮**，而用户要的是**进来一张亮一下**
 * （要求原文：「亮的时机不对，导入多张的时候是进来一张闪一下，不是全都进来一块闪」）。
 */
export async function importFiles(fileList, { bindNew = null } = {}) {
  const files = Array.from(fileList || [])
  const created = []
  const problems = []
  const buckets = new Map() // 散装文件按文件名合并
  let i = 0
  // 一个文件都没有：直接返回，**连通知都不弹**（弹了再收掉就是闪一下）
  if (!files.length) return { created, problems }
  /** ⚠️ **任务在这时才起**（确认有文件可导之后）：空选择 / 参数错误压根不会有通知，
      调用方的 `catch` 于是是这条提示的唯一出口，不会和这里重复 */
  const handle = task(t('store.importingUnknown'))
  /** 识别进度 / 中间结论都写到这同一条通知上（子步骤不另开一条） */
  const onStatus = (text, done = null, total = null) => handle.update(text, done, total)
  try {
    for (const file of files) {
      i++
      handle.update(t('store.importing', { i, total: files.length }), i, files.length)
      try {
        if (isZipFile(file)) {
          const entries = await readZip(file)
          // 单个 pmz 里没有 score.json 时，用压缩包自己的文件名当标题
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
    // **同一条就地变成一次性通知**：有问题先报问题（用户要处理的那件事），否则报导入了几张；
    // 一件都没进来（且没报出问题，例如空选择）就收掉，不留一条空通知。
    // 报的是**问题原文**时那条要走危险色（`done` 的第三个参数）—— 它是「完成态、内容其实是问题」。
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
