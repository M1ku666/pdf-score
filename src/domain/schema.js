/**
 * 乐谱数据模型（JSON 元数据）
 *
 * 一张乐谱 = PDF + 音频 + JSON。JSON（本文件定义的 meta）记录：
 *  - pages[].systems[]        行（谱表）标记，y0/y1 为 PDF 点坐标
 *  - pages[].systems[].bars[] 小节线标记，x 为 PDF 点坐标，id 稳定不变
 *  - segments[]               段落标记（名称 / BPM / 拍号 / 挂靠的小节线 + 拍号 / 进度条显示 / 时间锚点）
 *  - jumps[]                  跳转记号（起点小节线 / 终点小节线 / 前置的另一条记号）
 *  - audio                    音频信息（起点偏移、时长、波形分辨率）
 *
 * 所有几何量都存 PDF 原始点坐标（pt），与显示缩放无关。
 *
 *  · `createMeta` 是**唯一**的入口：规整 / 校验外来 JSON（含 `fitBeat` 把拍号夹进合法范围），
 *    最后调 `ensureHeadSegment` 保证**始终有一条不能删的 head 段落**（第 1 小节、默认 120 BPM 4/4，
 *    它就是默认速度的来源；没有就直接补一条，不做旧数据兼容）。
 *  · **段落与跳转记号挂的都是小节线 id**：`seg.barId` / `jump.startBarId` / `jump.endBarId`；
 *    小节号是 `deriveStructure` 现推的（对用户显示的那个序号就是它），本文件不存它。
 *  · 段落位置是**两个字段**：`barId` = 挂哪条小节线、`beat` = 这一小节里的第几拍；
 *    没有「打包进一个数字」的编码，比较位置一律用 `comparePosition()`（见 docs/invariants.md §5）。
 *  · 列表的排序约定：`systems` 按 `y0` 降序、`bars` 按 `x` 升序（`normalizePage` 会重排并依赖它）；
 *    任何插入路径都要自己保持有序。
 *  · 标签走 `normalizeTags`（见 docs/code.md）。
 */

export function uid(prefix = '') {
  let s
  if (typeof crypto !== 'undefined' && crypto.randomUUID) s = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  else s = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  return prefix ? `${prefix}_${s}` : s
}

export const META_VERSION = 1

export const DEFAULT_BPM = 120
export const DEFAULT_BEATS_PER_BAR = 4
export const DEFAULT_BEAT_UNIT = 4

/** 整个应用只有一种主题色（见 styles/main.css 的 --accent），标记不再各自配色 */
export const SEGMENT_COLORS = [null]

/**
 * 位置（**解析出来**的那些对象：`resolveSegments` / `resolveJumps` 的产物，或时间轴里的样本）：
 * **小节号与拍号是两个字段**（`measure` / `beat`），一个数字里不打包两件事 ——
 * 所以没有小数进位、没有「两位小数」、也不需要在入口处按文本判断拍号。
 * `beat` 是这一小节里的第几拍（1 起），上限是**这一段落自己的 `beatsPerBar`**；
 * 一个位置与另一个位置谁前谁后一律用 `comparePosition()` 判（见 docs/invariants.md §5）。
 *
 * ⚠️ **原始 meta 里的段落没有 `measure`**：它只有一个 `barId`（哪条小节线），小节号由
 * `deriveStructure` 的 `barStartMeasure` 现推（`domain/timeline.js` 的 `segmentMeasure()`）。
 */
export const DEFAULT_POSITION_BEAT = 1

/** 位置 -> 小节号（拿不到合法值就算第 1 小节） */
export function positionMeasure(pos) {
  const n = Math.round(Number(pos?.measure))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** 位置 -> 小节内的拍号（1 起；拿不到合法值就算第 1 拍，上限由调用方按拍号自己夹） */
export function positionBeat(pos) {
  const n = Math.round(Number(pos?.beat))
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_POSITION_BEAT
}

/**
 * 位置的先后比较（`comparePosition(a, b)`，用法同 `Array.prototype.sort` 的比较器）：
 * **先比小节号、再比拍号**。段落的排序、找「前一个段落」、时间锚点与逐拍调速点全走它，
 * 别在别处再各写一份「谁在前」。
 */
export function comparePosition(a, b) {
  return positionMeasure(a) - positionMeasure(b) || positionBeat(a) - positionBeat(b)
}

/**
 * 拍号规整：夹到 `[1, beatsPerBar]`。
 * 手改 JSON 写出「4/4 里的第 50 拍」、或者把拍数改小之后留下一个越界的旧拍号，
 * 都在这儿被夹回来 —— 段落标记那条线因此永远落在这条小节里面。
 */
export function fitBeat(value, beatsPerBar) {
  const beats = Math.min(32, Math.max(1, Math.round(Number(beatsPerBar)) || DEFAULT_BEATS_PER_BAR))
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < 1) return DEFAULT_POSITION_BEAT
  return Math.min(n, beats)
}

/** 标签：去空白、去重、限长 */
export function normalizeTags(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const raw of list) {
    const tag = String(raw ?? '').trim().slice(0, 24)
    if (!tag) continue
    if (!out.includes(tag)) out.push(tag)
    if (out.length >= 24) break
  }
  return out
}

/**
 * 跳转记号：**起点 / 终点各是一条小节线 id，前置是另一条跳转记号的 id**（可以不设前置）。
 *
 *  · `startBarId` —— **进入它起头的那一小节的那一刻跳走**：这一小节自己**不演奏**（记号标的是「从这里离开」）。
 *    不许落在**行首线**上（见 docs/invariants.md §4）；
 *  · `endBarId`   —— 跳到它起头的那一小节（落到这一小节的开头）。不许落在**行末线**上；
 *  · `prereq` —— 前置：**那条记号跳成功过**这条才允许跳。没满足时这次到达**不算消费**
 *    （之后播放头再回到起点、前置又满足了，照跳）。判定与展开在 `domain/timeline.js` 的 `expandJumps`。
 *
 * 存的是**小节线 id**（不是小节号）：小节号由 `barStartMeasure` 现推（用户看到的那个号就是它），
 * 删掉 / 新增一条小节线时记号留在原来那条线上；挂在被删那条线上的记号跟着那条线一起删（撤销一起回来）。
 */
export function defaultJump(patch = {}) {
  return {
    id: uid('jp'),
    startBarId: null,
    endBarId: null,
    prereq: null,
    ...patch,
  }
}

export function defaultSegment(patch = {}) {
  return {
    id: uid('sg'),
    barId: null, // 挂靠的小节线（不许是行末线）——小节号由它现推，见 domain/timeline.js 的 segmentMeasure()
    name: '',
    bpm: DEFAULT_BPM,
    beatsPerBar: DEFAULT_BEATS_PER_BAR,
    beatUnit: DEFAULT_BEAT_UNIT,
    beat: DEFAULT_POSITION_BEAT, // 小节位置：这一小节里的第几拍（上限 = 本段落的 beatsPerBar）
    time: null, // 可选时间锚点（秒）——精确对齐音频
    head: false, // 固定的「开头」段落：永远挂在编号第一小节起头的那条线上、不可删除、位置不可改
    ...patch,
  }
}

/** 固定开头段落的默认值（**没有默认名字**：名字留空，「开头」这个称呼只在界面显示时按需取 `common.headSegment`） */
export const HEAD_SEGMENT = {
  name: '',
  bpm: DEFAULT_BPM,
  beatsPerBar: DEFAULT_BEATS_PER_BAR,
  beatUnit: DEFAULT_BEAT_UNIT,
  beat: DEFAULT_POSITION_BEAT,
}

/**
 * 保证段落列表里始终有一个 head（开头）段落。
 * **它永远挂在「编号第一小节起头的那条线」上**（`segmentBarId()` 对 head 现推，不读它自己的 `barId`），
 * 所以数据里 `barId` 一直是空的 —— 这里顺手按回第 1 拍。
 * 不做旧数据兼容：没有 head 就直接补一条 120 BPM 4/4、没名字的开头段落。
 */
export function ensureHeadSegment(segments) {
  const list = Array.isArray(segments) ? segments : []
  const head = list.find((s) => s.head)
  if (head) {
    head.barId = null
    head.beat = DEFAULT_POSITION_BEAT
    return list
  }
  list.unshift(defaultSegment({ ...HEAD_SEGMENT, head: true }))
  return list
}

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

function normalizePage(raw) {
  const systems = Array.isArray(raw?.systems)
    ? raw.systems
        .map((s) => ({
          id: s.id || uid('sy'),
          y0: num(s.y0),
          y1: num(s.y1),
          bars: (Array.isArray(s.bars) ? s.bars : [])
            .map((b) => ({ id: b?.id || uid('br'), x: num(b?.x) }))
            .sort((a, b) => a.x - b.x),
        }))
        // PDF 坐标 y 轴向上：y0 越大越靠上，因此第一行是 y0 最大的那个
        .sort((a, b) => b.y0 - a.y0)
    : []
  return { width: num(raw?.width, 595.28), height: num(raw?.height, 841.89), systems }
}

/** 把任意（可能来自用户手改/旧版本/第三方）的 JSON 规整成合法 meta */
export function createMeta(init = {}) {
  const audio = init.audio || {}
  return {
    version: META_VERSION,
    title: typeof init.title === 'string' ? init.title : '',
    tags: normalizeTags(init.tags),
    audio: {
      name: typeof audio.name === 'string' ? audio.name : '',
      type: typeof audio.type === 'string' ? audio.type : '',
      duration: Number.isFinite(audio.duration) ? audio.duration : null,
      /** 音频时间轴起点：位置 startPosition 对应的音频时间（秒）；startPosition = 2 表示第 1 小节是弱起 */
      startOffset: num(audio.startOffset, 0),
      startPosition: Math.max(1, Math.round(num(audio.startPosition, 1))),
      peaksPerSecond: num(audio.peaksPerSecond, 0) || null,
    },
    pages: Array.isArray(init.pages) ? init.pages.map(normalizePage) : [],
    segments: ensureHeadSegment(
      (Array.isArray(init.segments) ? init.segments : [])
        // 没挂小节线的段落没有位置可落（挂靠的小节线可能已经随行被删掉）；「开头」是唯一的例外
        .filter((s) => s && (s.barId || s.head))
        .map((s) => {
          const beatsPerBar = Math.min(32, Math.max(1, Math.round(num(s.beatsPerBar, DEFAULT_BEATS_PER_BAR))))
          return defaultSegment({
            ...s,
            id: s.id || uid('sg'),
            bpm: Math.min(400, Math.max(20, num(s.bpm, DEFAULT_BPM))),
            beatsPerBar,
            beatUnit: [1, 2, 4, 8, 16].includes(num(s.beatUnit, DEFAULT_BEAT_UNIT))
              ? num(s.beatUnit, DEFAULT_BEAT_UNIT)
              : DEFAULT_BEAT_UNIT,
            barId: s.head ? null : s.barId,
            beat: fitBeat(s.beat, beatsPerBar),
            time: Number.isFinite(s.time) ? s.time : null,
            head: !!s.head,
          })
        })
    ),
    jumps: normalizeJumps(init.jumps),
  }
}

/**
 * 跳转记号的规整：**没写起点 / 终点小节线的条目丢掉**（挂哪两条线是它唯一的身份）。
 * **前置只认「这一份数据里真的存在的那几条」**：悬空 id（手改过 JSON、或者哪条记号连 id 都没写）
 * 与自指都当没有前置 —— 留着它等于那条记号永远不跳，界面上却看不出为什么。
 */
function normalizeJumps(raw) {
  const barId = (v) => (typeof v === 'string' && v ? v : null)
  const src = (Array.isArray(raw) ? raw : []).filter((j) => j && barId(j.startBarId) && barId(j.endBarId))
  const list = src.map((j) => defaultJump({ id: j.id || uid('jp'), startBarId: barId(j.startBarId), endBarId: barId(j.endBarId) }))
  const ids = new Set(list.map((j) => j.id))
  list.forEach((j, i) => {
    const p = src[i].prereq
    if (typeof p === 'string' && p && p !== j.id && ids.has(p)) j.prereq = p
  })
  return list
}

/** 依据 PDF 真实页面尺寸同步 pages（保留已标记的行/小节线） */
export function syncPages(meta, pageSizes) {
  if (!Array.isArray(pageSizes) || !pageSizes.length) return meta
  const next = pageSizes.map((size, i) => {
    const prev = meta.pages[i]
    const width = num(size.width, 595.28)
    const height = num(size.height, 841.89)
    if (!prev) return { width, height, systems: [] }
    return { width, height, systems: prev.systems || [] }
  })
  meta.pages = next
  return meta
}

export function cloneMeta(meta) {
  return JSON.parse(JSON.stringify(meta))
}

/** 统计信息，用于 gallery 展示与测试 */
export function metaStats(meta) {
  let bars = 0
  let systems = 0
  for (const p of meta.pages || []) {
    for (const s of p.systems || []) {
      systems++
      bars += s.bars?.length || 0
    }
  }
  return { pages: meta.pages?.length || 0, systems, bars, segments: meta.segments?.length || 0, jumps: meta.jumps?.length || 0 }
}
