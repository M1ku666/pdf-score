/**
 * 乐谱数据模型（JSON 元数据）
 *
 * 一张乐谱 = PDF + 音频 + JSON。JSON（本文件定义的 meta）记录：
 *  - pages[].systems[]        行（谱表）标记，y0/y1 为 PDF 点坐标
 *  - pages[].systems[].bars[] 小节线标记，x 为 PDF 点坐标，id 稳定不变
 *  - segments[]               段落标记（名称 / BPM / 拍号 / 小节位置 / 进度条显示 / 时间锚点）
 *  - repeats[]                反复标记（反复开始 / 反复结束 / 房子1 / 房子2）
 *  - audio                    音频信息（起点偏移、时长、波形分辨率）
 *
 * 所有几何量都存 PDF 原始点坐标（pt），与显示缩放无关。
 *
 *  · `createMeta` 是**唯一**的入口：规整 / 校验外来 JSON（含 `fitPosition` 把位置夹进合法拍号），
 *    最后调 `ensureHeadSegment` 保证**始终有一条不能删的 head 段落**（第 1 小节、默认 120 BPM 4/4，
 *    它就是默认速度的来源；没有就直接补一条，不做旧数据兼容）。
 *  · 位置编码 `POSITION_SCALE = 100`：整数 = 小节号、两位小数 = 拍号（`4.03` = 第 4 小节第 3 拍）。
 *    **拍号固定两位**，所以用户敲进来的文本走 `normalizePositionText()`（只有 `4.10` 是第 10 拍，
 *    纯数值区分不了）；**比较位置一律用 `positionKey()`**。
 *  · 列表的排序约定：`systems` 按 `y0` 降序、`bars` 按 `x` 升序（`normalizePage` 会重排并依赖它）；
 *    任何插入路径都要自己保持有序。
 *  · 标签走 `normalizeTags`；`REPEAT_KINDS` 之类的常量只存 key、渲染时再 `t()`（见 docs/code.md）。
 */
import { t } from '../i18n/index.js'

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
 * 小节位置 position 的小数约定：**整数部分 = 小节号，小数部分 = 拍号**，
 * 拍号固定占两位：4.01 = 第 4 小节第 1 拍、4.12 = 第 4 小节第 12 拍。
 * 之所以固定两位（而不是 4.1），是因为纯数字里 4.1 与 4.10 完全相等 ——
 * 一位小数就没法表达 9/8、12/8 里第 10 拍以后的拍号了。
 * 小数部分为 0 的位置（如 4）等同于该小节第 1 拍。
 */
export const POSITION_SCALE = 100

/** 位置 -> 小节内的拍号（1 起；没有小数部分时算第 1 拍） */
export function positionBeat(pos) {
  const n = Number(pos)
  if (!Number.isFinite(n)) return 1
  const beat = Math.round((n - Math.floor(n)) * POSITION_SCALE)
  return beat > 0 ? beat : 1
}

/** 位置 -> 显示文本（4.01 / 4.12；整数位置也算小节起点，显示成 4.01） */
export function formatPosition(pos) {
  const n = Number(pos)
  if (!Number.isFinite(n)) return '—'
  return `${Math.floor(n)}.${String(positionBeat(n)).padStart(2, '0')}`
}

/**
 * 位置的比较键：小节号 × POSITION_SCALE + 拍号。
 * 整数位置 5 与 5.01 是同一个位置（都是第 5 小节第 1 拍），直接比数值会漏掉它们相等这件事
 * （5.01 > 5），所以**比位置一律用这个键**，拍差 = 两个键相减。
 */
export function positionKey(pos) {
  const n = Number(pos)
  if (!Number.isFinite(n)) return NaN
  return Math.floor(n) * POSITION_SCALE + positionBeat(n)
}

/**
 * 把外部来的位置规整成合法位置：拍号夹到 [1, beatsPerBar]，
 * 免得手改 JSON 写出 4.5 这种在 4/4 里根本不存在的「第 50 拍」。
 * 本来就是整数的位置保持整数（等于该小节第 1 拍），带小数的补成规范的两位。
 */
export function fitPosition(pos, beatsPerBar) {
  if (!Number.isFinite(pos)) return null
  const bar = Math.floor(pos)
  const frac = pos - bar
  if (frac === 0) return bar
  const beats = Math.min(POSITION_SCALE - 1, Math.max(1, Math.round(Number(beatsPerBar)) || DEFAULT_BEATS_PER_BAR))
  const beat = Math.min(Math.max(1, Math.round(frac * POSITION_SCALE)), beats)
  return bar + beat / POSITION_SCALE
}

/**
 * 把用户敲进来的「小节.拍」文本解析成位置 —— **按文本判断拍号，所以一位小数也算数**：
 * `4.1` 补成 4.01（第 1 拍）、`4.10` 是第 10 拍、`4.000001` 同样补成 4.01。
 * 纯数值做不到这件事（4.1 与 4.10 是同一个数），所以入口必须是文本。
 * 认不出来的文本原样返回 fallback。
 */
export function normalizePositionText(text, fallback, beatsPerBar) {
  const m = /^(\d+)(?:[.,](\d*))?$/.exec(String(text ?? '').trim())
  if (!m) return fallback
  const bar = Math.max(1, Number(m[1]))
  const beats = Math.min(POSITION_SCALE - 1, Math.max(1, Math.round(Number(beatsPerBar)) || DEFAULT_BEATS_PER_BAR))
  const digits = m[2] || ''
  const typed = digits ? Number(digits) : 1
  const beat = Math.min(beats, Number.isFinite(typed) && typed >= 1 ? typed : 1)
  return bar + beat / POSITION_SCALE
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
 * 反复标记类型：**显示文字复用 zh-CN.yaml 的 `repeatKind.*`**，这里只存 key，
 * 渲染时再 `t(labelKey)` —— 模块加载时求值的话，切语言不会刷新。
 */
export const REPEAT_KINDS = {
  start: { key: 'start', labelKey: 'repeatKind.start.label', shortKey: 'repeatKind.start.short', hintKey: 'repeatKind.start.hint' },
  end: { key: 'end', labelKey: 'repeatKind.end.label', shortKey: 'repeatKind.end.short', hintKey: 'repeatKind.end.hint' },
  house1: { key: 'house1', labelKey: 'repeatKind.house1.label', shortKey: 'repeatKind.house1.short', hintKey: 'repeatKind.house1.hint' },
  house2: { key: 'house2', labelKey: 'repeatKind.house2.label', shortKey: 'repeatKind.house2.short', hintKey: 'repeatKind.house2.hint' },
}

export function defaultSegment(patch = {}) {
  return {
    id: uid('sg'),
    barId: null,
    name: '',
    bpm: DEFAULT_BPM,
    beatsPerBar: DEFAULT_BEATS_PER_BAR,
    beatUnit: DEFAULT_BEAT_UNIT,
    position: null, // 小节位置，整数部分=小节号、小数两位=拍号（4.03 = 第 4 小节第 3 拍）
    time: null, // 可选时间锚点（秒）——精确对齐音频
    head: false, // 固定的「开头」段落：永远在第 1 小节、不可删除、位置不可改
    ...patch,
  }
}

/** 固定开头段落的默认值（名字取 `common.headSegment`，默认语言下就是「开头」） */
export const HEAD_SEGMENT = { name: t('common.headSegment'), bpm: DEFAULT_BPM, beatsPerBar: DEFAULT_BEATS_PER_BAR, beatUnit: DEFAULT_BEAT_UNIT, position: 1 }

/**
 * 保证段落列表里始终有一个 head（开头）段落。
 * 不做旧数据兼容：没有 head 就直接补一条 120 BPM 4/4 的「开头」。
 */
export function ensureHeadSegment(segments) {
  const list = Array.isArray(segments) ? segments : []
  const head = list.find((s) => s.head)
  if (head) {
    head.position = 1
    if (!head.name) head.name = HEAD_SEGMENT.name
    return list
  }
  list.unshift(defaultSegment({ ...HEAD_SEGMENT, head: true }))
  return list
}

export function defaultRepeat(patch = {}) {
  return {
    id: uid('rp'),
    kind: 'start',
    barId: null,
    label: '',
    passes: 2, // 反复结束：总遍数
    backToMeasure: null, // 反复结束：回到第几小节（null = 自动取最近的反复开始）
    houseEndMeasure: null, // 房子：结束小节（null = 自动）
    ...patch,
  }
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
        .filter((s) => s && (s.barId || Number.isFinite(s.position) || s.head))
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
            position: fitPosition(s.position, beatsPerBar),
            time: Number.isFinite(s.time) ? s.time : null,
            head: !!s.head,
          })
        })
    ),
    repeats: (Array.isArray(init.repeats) ? init.repeats : [])
      .filter((r) => r && r.barId)
      .map((r) =>
        defaultRepeat({
          ...r,
          id: r.id || uid('rp'),
          kind: REPEAT_KINDS[r.kind] ? r.kind : 'start',
          passes: Math.min(16, Math.max(2, Math.round(num(r.passes, 2)))),
          backToMeasure: Number.isFinite(r.backToMeasure) ? r.backToMeasure : null,
          houseEndMeasure: Number.isFinite(r.houseEndMeasure) ? r.houseEndMeasure : null,
        })
      ),
  }
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
  return { pages: meta.pages?.length || 0, systems, bars, segments: meta.segments?.length || 0, repeats: meta.repeats?.length || 0 }
}
