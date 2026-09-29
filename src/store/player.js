/**
 * 播放器状态（player 页面）
 * 负责：加载乐谱文件 / 维护 meta / 推导时间轴 / 音频引擎 / 编辑标记操作 / 自动保存
 *
 *  · **改状态的写法**：删除这类**可撤销**的操作在动 meta 之前先 `noteRemoval()` 记下被删的那几项
 *    → 改 meta → 最后 `markDirty()`（900ms 防抖自动保存）。
 *    删行 / 删小节线必须走 `cascadeRemoveBars` 级联清掉挂在它上面的段落与反复（**这些也要一起记**）。
 *    **没有全局撤销栈** —— 删除记录就挂在顶部那条带按钮的通知上，通知 6 秒到点收掉、记录跟着丢。
 *    **一步一条记录**：每删一项记一条，点一次「撤销」把那一项插回去、计数 -1（见 `undoLastDeletions`）。
 *    **记的是「被删掉的那几项」而不是整份 meta 的快照** —— 撤销窗口开着时用户接着新建的东西
 *    必须原样留着（见「撤销」那一节）。
 *    批量删除（`MarksPanel`）也按**项**算：勾 3 项就是 3 条记录，它把那一串删除函数以
 *    `notify = false` 调一遍（通知只弹一条，但每一项各记一条）。
 *  · **行只做两件事：点已有行 = 删，拖动 = 新建一行**（`ScorePage` 的行工具）。
 *    新行**不许与同一页已有的行重叠**：相交就拒绝添加并 toast 一条（判定与容差在 `domain/rows.js`）。
 *    这里**没有**「拆开已有的一条行」也**没有**「改已有行的上下沿」—— 整个套住、或者把一条已有行
 *    整个罩住，同样按重叠拒绝。校验过外来 JSON / OMR 的旧数据仍然可能带重叠的行，那不是这里管的事。
 *  · **新行有高度下限**（`minH`，调用方按当前缩放把 `ROW_MIN_PX` = 46 CSS px 折算成 pt，
 *    判据在 `domain/rows.js`）：不够高的新行加不进来，预览带也走灰色那档（见 `ScorePage` 的 `updateBand`）。
 *  · **新行的小节线不用手画**：`addSystem` 落下来之后自己起一次**这一页的谱面识别**
 *    （`domain/omr.js` 的 `detectPdfPage`，与导入时同一套链路），把落在新行 y 范围内的那几条识别结果
 *    的小节线填进去（见 `detectRowBars`）。它是后台活儿：失败只 `console.warn`，不连累新建这一行。
 *  · **行末那条小节线只允许反复结束标记**（判据只有一处：`domain/timeline.js` 的 `isRowEndBar`）：
 *    段落（`addSegmentAt`）与反复的起点 / 房子起点都不许落到它上面，改点**下一行行首那条线**
 *    （两条线是同一个小节）。**点已有的标记照旧**：删反复、打开段落设置都不受这条限制。
 *  · 时间轴的派生数据都放在本文件的 computed 里（structure / timeline / currentPos…），
 *    **改完 meta 不要手动缓存时间轴**，它自己会重算。
 *  · 播放能力只看 `canPlay = hasAudio || timeline.duration > 0`：**节拍器音量绝不参与这个判断**
 *    （它是声源开关，不是播放开关）；静音也能走带，预备拍走独立的 cueVolume。
 *  · `player.mode`（'pan' 抓手 / 'pointer' 指针）决定**谱面手势归谁，鼠标与触屏同一个判据**：
 *    抓手（默认）= 谱面这一层完全不接管拖动（触屏滑动就是原生滚谱、鼠标拖动由 `PdfViewer` 拖谱面），
 *    只认点一下 / 指针 = 按下即接管（框选、划行、放线）。它是 session 状态（不进 meta、不写 localStorage，
 *    默认恒为 'pan'），但**它影响的内容比它自己多** —— `ScorePage` 的 touch-action 与 `drag.own`、
 *    `PdfViewer` 的鼠标拖谱与「打开乐谱要不要贴合」也读它，见 `setMode` 与 `pointerMode`。
 *  · 删除后不在这里弹提示：本文件调 `notifyUndo()`，并维护那条通知挂着的**剩余步数与删除记录栈**
 *    （`undoSlot`），提示本体是 `store/toast.js` 的第三类（带按钮的通知），
 *    倒计时那圈环由 `ProgressRing` 画 —— 位置、外形、倒计时都不在本文件。
 *    **撤销之后也不弹「已撤销」**（用户要求）：退回去的东西就在谱面上。
 *  · 本模块与 `store/library.js` 是**唯一允许直接引 `db/idb.js` 的 store**。
 */
import { computed, reactive, shallowRef, watch } from 'vue'
import * as db from '../db/idb.js'
import { AudioEngine, Metronome, OutputClock } from '../domain/audio-engine.js'
import { PdfRenderer } from '../domain/pdf.js'
import { beatDuration, buildTimeline, decideRepeatTap, deriveStructure, isRowEndBar, tempoAt } from '../domain/timeline.js'
import { cloneMeta, comparePosition, createMeta, defaultRepeat, defaultSegment, fitBeat, positionBeat, positionMeasure, syncPages, uid } from '../domain/schema.js'
import { DEFAULT_MIN_H, clampToPage, overlapSystem } from '../domain/rows.js'
import { detectPdfPage } from '../domain/omr.js'
import { peaksFromBlob, PEAKS_PER_SECOND } from '../domain/audio-peaks.js'
import { t } from '../i18n/index.js'
import { markEditDone, markOpened, onRecordUpdated, touchSize, updateScoreMeta } from './library.js'
import { settings } from './settings.js'
import { actionToast, dangerToast, dismissToast, errorToast, toast } from './toast.js'

export const engine = new AudioEngine()
/**
 * 时钟只有一个：没有音频时它会退回 Web Audio 的时钟，让「只响节拍器」的播放同样能走带。
 * engine 与 metronome 谁先建立 AudioContext 都会调 clock.attach()，所以这里先把 engine 挂上。
 */
export const clock = new OutputClock()
clock.attach(engine, engine.context)
export const metronome = new Metronome()

export const renderer = shallowRef(null)
export const peaksRef = shallowRef(null)

export const player = reactive({
  id: '',
  record: null,
  meta: createMeta(),
  loading: false,
  ready: false,
  error: '',

  hasPdf: false,
  hasAudio: false,
  pdfName: '',
  audioName: '',

  peaksLoading: false,
  peaksPerSecond: PEAKS_PER_SECOND,

  dirty: false,
  saving: false,
  savedAt: 0,
  autoSaved: false,

  editMode: false,
  tool: 'row',
  activeSegmentId: null,
  drawer: null, // 'segment' | null（反复没有面板，见「标记：反复」那一段）
  /**
   * **待定的反复起点**（barId）：反复工具第一次点只记在这里，**不进 meta、不写盘** ——
   * 第二次点合法才把两条线一起写进 `meta.repeats`。切工具 / 退编辑 / 点错都会把它丢掉
   * （见文件末尾那个 watch 与 `store.repeat` 那一段的注释）。
   */
  pendingRepeatBarId: null,
  /**
   * **跳跃闪烁**：两种相位**各占一个槽位**，可以同时在同一个小节上出现（用户明确要求）：
   *   · `jumpFlash` = **「跳转前闪烁」** —— 每拍闪一下、重复一整个小节（`{no, index, tick, ms, repeats}`）。
   *     两个来源：**自动跳之前那一小节**（末尾那个 watch 点亮），以及**预备拍倒数期间的落点**
   *     （`flashCountInLanding`：跳转预备拍 = 你点的那一小节、循环段预备拍 = 框选的起点）。
   *   · `jumpAfter` = **「跳转后闪烁」** —— 落点上**闪一下就完**（`{no, index, tick, ms}`）。
   *     **手动跳转在点击那一刻就闪**（位置当刻就跳过去了，`startPlayback` 里点亮），
   *     与预备拍那串「跳转前」**同时**在同一个落点上；自动跳则在**落地那一拍**由 watch 点亮。
   * 分开两个槽位是因为用户要「点击瞬间闪『跳转后』，同时开始闪预备拍」——
   * 一个槽位里两种相位只能轮流出现，合起来就必然丢掉一个。
   *
   * 画法（`ScorePage`）：`jumpFlash` 只在播放 / 预备拍里画，`jumpAfter` 只要状态在就画
   * （手动跳转多半发生在暂停时）；进编辑模式一律不画。详见 `docs/ui.md` §18.42 / §18.46 / §18.51。
   */
  jumpFlash: null,
  jumpAfter: null,

  /**
   * **预备拍进行中**（可反应的镜像，谱面用它决定显不显示「跳转前闪烁」，见 `docs/ui.md` §18.46）。
   * 为什么不直接读 `metronome.countInActive`：那是个读定时器的 getter，**Vue 追不到它** ——
   * 预备拍开始 / 结束时没有任何别的东西会触发重渲染。所以预备拍一律走下面那个 `startCountIn()`。
   *
   * **预备拍期间 `player.playing` 也为真**（用户明确要求「预备拍的时候也视作播放中，播放按钮要显示成
   * 暂停按钮供用户暂停」）：`startCountIn` 里一起置真，播放键于是显示「暂停」、点它就是
   * `togglePlay` → `pausePlayback()` 取消倒数。所以「在不在走带里」= `player.playing`
   * （预备拍也算），`cueing` 只是给谱面判闪烁用的那半个语义。
   */
  cueing: false,

  selection: null,
  /**
   * 谱面手势模式：`'pan'`（抓手，**默认**）或 `'pointer'`（指针）。**鼠标与触屏同一个判据**：
   *   · `'pan'`  = 谱面这一层不接管拖动：触屏滑动交给浏览器原生滚、鼠标拖动由 `PdfViewer` 拖谱面；
   *     双指缩放已全站禁用，见 `docs/ui.md` §18.46；
   *   · `'pointer'` = 这一层自己接管手势：点小节跳转、拖出框选循环播放（编辑模式 = 划行 / 放线）。
   * **两种模式下光标都是系统默认箭头**（谱面不声明 cursor，见 `docs/ui.md` §18.37）。
   * **每个 session 都从 `'pan'` 开始**：不进 meta / 不写 localStorage，`open()` 与 `close()` 都归位，
   * 换谱、刷新、重开都回到抓手（用户明确要求「每次打开谱面都默认是抓手」）。
   */
  mode: 'pan',

  playing: false,
  /**
   * **音频起点那一屏的「试听」**（`AudioOffsetPicker`）：试听期间为真，
   * 位置在 `previewTime`（**音频文件自己的时间轴**，秒）。
   *
   * ⚠️ **试听不是谱面的播放**（要求原文：「试听不和谱面走同一个播放流程！试听只是单独放那个音频文件」）：
   * 它由 `AudioEngine` 的**第二个 `<audio>`**（`engine.previewEl`）放，所以
   * `playing` / `currentTime` / 时钟 / 节拍器 / 预备拍**一律不受影响** —— 谱面不跟着走、不翻页、
   * 「播放中」那套界面（播放键、顶栏隐藏）也不动。试听只有这一屏的播放头在走。
   */
  previewing: false,
  /** 试听播放头（秒，音频文件自己的时间轴；没在试听时恒为 0） */
  previewTime: 0,
  currentTime: 0,
  rate: 1,
  /**
   * **「自定义」框里填过的倍速**（最近在前，最多 `RATE_HISTORY_MAX` 条）——
   * 倍速面板「自定义历史」那一段就是它，一行一条、与预设那四档同款（见 docs/ui.md §18.65）。
   * 点预设那四档、点历史里的一条**都不记**：那四档本来就常驻在面板最上面，再记一遍是把同一件事说两遍。
   * 跟 `rate` 一起进 `pdf-score:prefs`，所以刷新 / 重开还在；**没有手动删除这一路**，旧值靠封顶自己滚掉。
   */
  rateHistory: [],
  volume: 1,
  muted: false,
  metronomeVolume: 0, // 0 = 关闭节拍器
  cueVolume: 0.6, // 预备拍音量（0 = 不打预备拍）
  loopOn: false,

  currentPage: 1,
  visiblePage: 1,
  pageCount: 0,
  pdfWidth: 0,
  pdfHeight: 0,
  fitMode: 'width', // width | height

  autoTurn: true,
  showHelp: false,
})

const PREFS_KEY = 'pdf-score:prefs'

/**
 * 自定义倍速那个框的取值范围。**下限不能省**：倍速是时钟的乘数（`OutputClock` 按它爬、
 * `<audio>` 按它走），填 0 播放头就一步不走，填负数连 `<audio>` 都不认
 * （`engine.setRate` 里那句写在 `try` 里，抛出去就被咽掉，只剩时钟在动 —— 声音与谱面从此对不上）。
 *
 * **两条路都得认它**：`NumberPad` 拿它夹用户敲进来的值、并按它把范围写在键盘上；
 * 历史从 localStorage 读回来时也按它筛一遍 —— 存进去的值只可能落在这一段里，
 * 外面的不是旧版本留下的就是被人手改过的，丢掉即可。**别在别处再夹一次。**
 */
export const RATE_MIN = 0.25
export const RATE_MAX = 4
/** 自定义历史最多存几条（面板里那一段的条数上限）。超了从最旧那条开始挤 */
export const RATE_HISTORY_MAX = 5

/** 存进历史 / 从历史读回来之前统一规整：夹进范围、抹掉浮点毛刺（`0.1 + 0.2` 那类）。
    认不出数字时回当前倍速 —— 历史里只放得下能当倍速用的数字（`<audio>` 不认 NaN） */
function normRate(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return player.rate
  return Number(Math.min(RATE_MAX, Math.max(RATE_MIN, v)).toFixed(2))
}

/** 读回来的历史：不是数字的、越界的、重复的一律丢掉，再截到上限 */
function cleanHistory(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    const n = Number(item)
    if (!Number.isFinite(n)) continue
    const v = normRate(n)
    if (!out.includes(v)) out.push(v)
    if (out.length >= RATE_HISTORY_MAX) break
  }
  return out
}

try {
  const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  if (Number.isFinite(prefs.rate)) player.rate = prefs.rate
  player.rateHistory = cleanHistory(prefs.rateHistory)
  if (Number.isFinite(prefs.volume)) player.volume = prefs.volume
  if (Number.isFinite(prefs.metronomeVolume)) player.metronomeVolume = prefs.metronomeVolume
  if (Number.isFinite(prefs.cueVolume)) player.cueVolume = prefs.cueVolume
  if (typeof prefs.autoTurn === 'boolean') player.autoTurn = prefs.autoTurn
} catch {}

function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        rate: player.rate,
        rateHistory: player.rateHistory,
        volume: player.volume,
        metronomeVolume: player.metronomeVolume,
        cueVolume: player.cueVolume,
        autoTurn: player.autoTurn,
      })
    )
  } catch {}
}

let pdfBlob = null
let audioBlob = null
let audioUrl = ''
let saveTimer = 0
/**
 * 顶部那条「撤销」通知的一个槽：`{ notice, timer }`。
 * `notice` 是 `{ count, steps, id }`（null = 现在没有这条通知），提示本体由 `store/toast.js` 管
 * （第三类：带按钮的通知）；这里只留两件**只有本文件知道**的事：还剩几步、以及每一步要还回什么。
 *
 *  · `steps` 是一叠「删除记录」，**每删一项记一条**（记的是**被拿掉的那几个对象 + 它们原来挂在哪**）。
 *    点一次「撤销」就弹掉顶上那一条、把那些对象插回去，`count` 跟着 -1 ——
 *    所以「撤销」退的是**最后一次删除**，不是整串（用户要求「点一次撤销就恢复一次删除的内容，
 *    然后删除 xN 的 n 减去一」）。
 *  · **只有删除这一条通知**（删行 / 删小节线 / 标记列表的批量删除）。
 *  · **原本是一个 40 深的全局撤销栈**，但栈里绝大多数记录（新加 / 修改那几处）根本没有撤销入口，
 *    等于白存；现在记录只挂在真正能撤销的这条通知上。
 */
const undoSlot = { notice: null, timer: 0 }

/**
 * **按页缓存的谱面识别结果**（`detectRowBars` 用）：`Map<pageIndex, Promise<systems[]>>`。
 * 识别只看 PDF 的像素，与本文件的 meta 无关（画了多少行、多少小节线都不影响它），
 * 所以同一页识别一次就够 —— 连着新建几条行不必把整页重跑几遍（存 promise，
 * 前一条还没认完就又划一条时两次等的是同一件事）。
 * 打开另一份乐谱时必须清掉（见 `open()`）：这里面的坐标是上一份 PDF 的。
 */
const omrPageCache = new Map()

/* ------------------------------- 派生数据 ------------------------------- */

export const structure = computed(() => deriveStructure(player.meta))
export const timeline = computed(() => buildTimeline(player.meta, { structure: structure.value }))
export const measureCount = computed(() => structure.value.count)

export const currentPos = computed(() => timeline.value.timeToPos(player.currentTime))
export const currentMeasure = computed(() => {
  const pos = currentPos.value
  return pos.no ? structure.value.measures[pos.no - 1] || null : null
})
export const currentTempo = computed(() => {
  const pos = currentPos.value
  if (!pos.no) return { bpm: 120, beatsPerBar: 4, beatUnit: 4 }
  return tempoAt(timeline.value.segments, pos.no, Math.max(1, Math.floor(pos.beat || 1)))
})
/** 播放总时长：有音频就是音频时长，没有就是时间轴推出来的时长 */
export const duration = computed(() => Math.max(clock.duration || 0, timeline.value.duration || 0))
/**
 * 谱面真正的开头（秒）—— **「打开乐谱后的默认位置」就是它**（`open()` 里 seek 过去）。
 * 有弱起（或 `startOffset` 为负）时它是**负数**：那一段音频里没有声音，
 * 位置从负数走起、音频等到 0 秒再出声，见 `startLead`。
 */
export const timelineStart = computed(() => {
  const first = timeline.value.samples[0]
  return first ? first.time : 0
})

/**
 * 能不能播放，只看「有没有东西可走」：有音频轨，或者时间轴推得出时长（有小节就能推）。
 * **节拍器音量不参与这个判断** —— 它是声源的开关，不是播放的开关。
 * 没音频、节拍器也归零时照样能走带（静音走带：进度条、播放头、自动翻页都在动），
 * 这是用户明确要的语义；把「有没有声音」和「能不能播放」绑在一起会让人以为播放键坏了。
 */
export const canPlay = computed(() => player.hasAudio || (timeline.value.duration || 0) > 0)
/**
 * 谱面是不是「指针模式」（自己接管手势：点小节跳转 / 框选循环；**编辑模式下才能划行 / 放线**）。
 * 判据**只此一处**（`player.mode !== 'pan'`）—— `ScorePage` / `PdfViewer` 都读它，
 * 别在别处再各写一遍 `mode === 'pointer'`，否则加第三种模式时必漏。
 */
export const pointerMode = computed(() => player.mode !== 'pan')
export const silentPlayback = computed(() => !player.hasAudio)

export const activeSegment = computed(() => (player.meta.segments || []).find((s) => s.id === player.activeSegmentId) || null)

/**
 * 这份乐谱的显示标题 = **记录上的 `title`，退到 `meta.title`，再退到「未命名乐谱」** ——
 * 与乐谱库里那一行同一条规矩（`store/library.js` 的 `buildRecord()`）。
 * 记录标题是「标题进 meta 那一刻」的快照，所以三级回落都要留着。
 */
export const scoreTitle = computed(() => player.record?.title || player.meta?.title || t('store.untitled'))

/**
 * 段落的位置文案（「第 4 小节第 3 拍」/「第 4 小节」）：位置是两个字段（小节号 + 拍号），
 * 没有小节号时退回它挂靠的那条小节线。跳转面板的段落列表、别处要显示段落位置的地方都读它。
 */
export function segmentPositionLabel(seg) {
  if (!seg) return ''
  const auto = seg.barId ? structure.value.barStartMeasure.get(seg.barId) : null
  const bar = Number.isFinite(seg.measure) ? positionMeasure(seg) : auto
  if (!Number.isFinite(bar)) return t('common.noValue')
  const beat = Math.max(1, Math.floor(seg.beat || 1))
  return beat > 1 ? t('store.segmentPosition.beat', { bar, beat }) : t('store.segmentPosition.bar', { bar })
}

/** 位置 -> 小节号 / 小节内的拍号（组件的落点换算与文案共用，别在组件里各算一遍） */
export { positionBeat, positionMeasure }

/* --------------------------------- 加载 --------------------------------- */

/**
 * `open()` 的失败原因之一，**也是唯一一个「这份谱确实不在库里」的失败**：
 * 其余失败（PDF 解析不了、数据损坏、读盘报错）都只写 `player.error`，没有这个 code。
 * 调用方（`views/PlayerView.vue` 的 `load()`）只按它决定要不要把地址退回 `/` ——
 * **不许拿「`player.error` 非空」当判据**，那些失败写的是同一个字段。
 */
export const SCORE_NOT_FOUND = 'scoreNotFound'

/**
 * 打开一份乐谱。
 *
 * **返回值就是失败原因**（`''` = 打开了；`'error'` = 其它失败；`SCORE_NOT_FOUND` = 库里没这条记录）——
 * 失败原因原先全部沉在 `player.error` 里，分不出来，所以这里额外把它交给调用方。
 */
export async function open(id) {
  if (player.id && player.id !== id) await close()
  player.loading = true
  player.error = ''
  try {
    const rec = await db.getScore(id)
    if (!rec) {
      const err = new Error(t('domain.error.scoreNotFound'))
      err.code = SCORE_NOT_FOUND
      throw err
    }
    // 这一次「打开」就是排序要的「最近一次打开」：乐谱库那一档「最近在前 / 最早在前」按它排。
    // **只有这里会写 `openedAt`** —— 改标记 / 标签 / 封面都不算打开（见 store/library.js）。
    // 它**不碰 `editDone`**：「未完成编辑 / 已完成编辑」那一栏只认「完成」那颗钮。
    markOpened(id).catch(() => {})
    player.id = id
    player.record = rec
    player.meta = createMeta(rec.meta)
    player.pdfName = rec.pdfName || ''
    player.audioName = rec.meta?.audio?.name || ''
    player.pageCount = player.meta.pages?.length || 0
    player.currentPage = 1
    player.visiblePage = 1

    pdfBlob = await db.getFile(id, 'pdf')
    player.hasPdf = !!pdfBlob
    // 识别缓存里的坐标是上一份 PDF 的，换谱必清（同一份乐谱重开也清：PDF 可能被换过）
    omrPageCache.clear()
    if (pdfBlob) {
      renderer.value = await PdfRenderer.from(pdfBlob)
      player.pageCount = renderer.value.numPages
    }

    audioBlob = await db.getFile(id, 'audio')
    player.hasAudio = !!audioBlob
    audioUrl = ''
    if (audioBlob) {
      audioUrl = URL.createObjectURL(audioBlob)
      engine.load(audioUrl, player.meta.audio?.duration || 0)
    } else {
      engine.unload()
    }
    applyOutputPrefs()
    peaksRef.value = null
    if (audioBlob) {
      const cached = await db.getFile(id, 'peaks')
      if (cached?.length) {
        peaksRef.value = cached
        player.peaksPerSecond = player.meta.audio?.peaksPerSecond || PEAKS_PER_SECOND
      } else {
        ensurePeaks()
      }
    }
    // **还没完成过编辑的乐谱直接进编辑模式**（判据只有一条：`rec.editDone` 为假）——
    // 打开一份还没编辑完的谱，多半是接着标 / 核对。
    // 点过「完成」之后就不再自动进了（见 `finishEdit`）：再打开只是想看谱 / 播放。
    player.editMode = !rec.editDone
    player.tool = 'row'
    // 每次打开乐谱都回到抓手（见 player.mode 的注释）：上一条谱切过指针，这一条也要从抓手开始
    player.mode = 'pan'
    player.selection = null
    player.ready = true
    // **默认位置 = 谱面真正的开头**：有弱起时是负数（音频 0 秒之前那段），
    // 于是「打开 → 按播放」也会先把整个弱起小节走完，而不是一上来就落在小节半截上（见 startLead）。
    // 放在 `ready` 之后：这条谱的 meta 已经就位，时间轴算得出来了。
    seek(timelineStart.value)
    dismissAllUndoToasts()
    player.dirty = false
    // ⚠️ **只把音量落上去，不许在这里 `startMetronome()`**：打开乐谱（含刷新后自动打开）
    // 不等于开始走带。调度器一旦起来，第一个 `_tick()` 就会把「当前这一拍」排进 Web Audio
    // （`reset()` 把 `lastScheduled` 设成当刻位置，而 `beatsBetween` 的区间是**闭区间**，
    // 正好等于当刻的那一拍会被当成立刻要响的一声），于是**每次刷新都自己响一拍节拍器**。
    // 真正的起播点只有 `playFrom()` / `startLead()` 两处（它们才按 `metronomeVolume > 0` 起调度器）。
    metronome.setVolume(player.metronomeVolume)
    metronome.setCueVolume(player.cueVolume)
    return ''
  } catch (err) {
    player.error = err?.message || String(err)
    // 只认我们自己的那个 code：`DOMException.code` 之类的数字不能被当成分支依据
    return err?.code === SCORE_NOT_FOUND ? SCORE_NOT_FOUND : 'error'
  } finally {
    player.loading = false
  }
}

/**
 * 生成波形缓存（`peaksRef`）。**它是个后台活儿，不出通知**：
 *  · 打开带音频的乐谱时没有缓存就走这里（`open()` 里那只 `ensurePeaks()` 不 await），
 *    跟着弹一条「正在生成波形…」会在每次打开乐谱时都刷一条，而它大多几百毫秒就完了；
 *  · 导入音频时由 `importAudio` **await 它跑完**，再报那一条「已导入音频：xx」——
 *    所以报告的是整件事（导入 + 生成波形）的结果，**不是「先报导入完成、再报波形完成」两条**。
 * 界面上「正在生成」的痕迹在音频起点那一屏（`AudioOffsetPicker` 的 `peaksLoading` 文案），
 * 那是画布里的空状态，不是第二条通知。
 * **失败要报**：那是用户可见的缺失（波形画不出来），走一次性通知。
 */
export async function ensurePeaks(force = false) {
  if (!player.id) return
  if (peaksRef.value && !force) return
  if (!audioBlob && !force) {
    audioBlob = await db.getFile(player.id, 'audio')
    if (!audioBlob) return
  }
  player.peaksLoading = true
  try {
    const { peaks, perSecond } = await peaksFromBlob(audioBlob)
    const prevBytes = peaksRef.value?.byteLength || 0
    peaksRef.value = peaks
    player.peaksPerSecond = perSecond || PEAKS_PER_SECOND
    await db.putFile(player.id, 'peaks', peaks)
    touchSize(player.id, peaks.byteLength - prevBytes) // 波形缓存也在占用里，写进去就跟着挪
    player.meta.audio = { ...player.meta.audio, peaksPerSecond: Number((perSecond || PEAKS_PER_SECOND).toFixed(3)) }
  } catch (err) {
    errorToast(t('store.peaksFailed', { msg: err?.message || err }))
  } finally {
    player.peaksLoading = false
  }
}

export async function close() {
  if (player.dirty) await save()
  stopLead()
  // 试听那只 `<audio>`（`engine.previewEl`）由 `engine.unload()` 一起收掉，这里只归位状态
  player.previewing = false
  player.previewTime = 0
  try {
    engine.unload()
  } catch {}
  clock.pause()
  clock.setLoop(null)
  clock.seek(0)
  // 还挂着的那条预备拍倒数要一起取消：它的回调会把播放拉起来（离开乐谱后再出声、位置往前走）
  metronome.cancelCountIn()
  player.cueing = false
  metronome.stop()
  renderer.value?.destroy()
  renderer.value = null
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = ''
  pdfBlob = null
  audioBlob = null
  peaksRef.value = null
  // 换上另一条谱了，那两条「撤销」通知挂的是**上一条谱的 meta**，必须一起收掉 ——
  // 留着它，点「撤销」会把上一条谱的标记还原到这一条上来
  dismissAllUndoToasts()
  Object.assign(player, {
    id: '',
    record: null,
    meta: createMeta(),
    ready: false,
    hasPdf: false,
    hasAudio: false,
    playing: false,
    previewing: false,
    previewTime: 0,
    cueing: false,
    currentTime: 0,
    selection: null,
    mode: 'pan',
    editMode: false,
    dirty: false,
    drawer: null,
    activeSegmentId: null,
    pendingRepeatBarId: null,
    jumpFlash: null,
    jumpAfter: null,
    autoSaved: false,
  })
}

/**
 * 「正在看的这一份在乐谱库里被删掉了」：**丢掉还没落盘的改动**再把播放器收干净。
 *
 * 收尾本身走 `close()`（渲染器 / 音频 / 那两条撤销通知都在里面收），差别只在**不 `save()`**：
 * 记录已经从库里删掉了，`updateScoreMeta` 会抛「找不到这份乐谱」，
 * 用户会平白看到一条「保存失败」——他刚亲手删的它。
 *
 * 调用方是 `PlayerView`（乐谱库删成功、且删掉的里面有当前这一张时），
 * 它接着把地址退回 `/`（没有打开乐谱那一屏）。
 */
export async function closeDeleted() {
  player.dirty = false
  await close()
}

/**
 * 点底栏那颗「完成」：退出编辑模式，**并把这份谱记成「已完成编辑」**（记录里的 `editDone`）。
 *
 * · **这是编辑模式唯一的出口**：Esc 与手机返回手势都不退编辑模式
 *   （`PlayerView.onKey` 那条 Esc 只管关抽屉 / 取消框选，返回手势在编辑模式里被吃掉）。
 *   `markEditDone` 因此也只会从这里被调到 —— 「编辑完成」= 用户自己按了那颗钮。
 * · 乐谱库据此把它从「未完成编辑」那一栏挪到「已完成编辑」那一栏（见 `LibraryPanel`）。
 * · 幂等：不在编辑模式时什么都不做；`markEditDone` 那边第二次起也不写库。
 *
 * ⚠️ **先 `save()` 再 `markEditDone`，这个顺序不能换**：两者都是「读记录 → 改字段 → 写回」，
 * `markEditDone` 先写、`save` 后写的话，后一次写回会把 `editDone` 盖回假。
 */
export async function finishEdit() {
  if (!player.editMode) return
  player.editMode = false
  await save()
  markEditDone(player.id).catch(() => {})
}

/* --------------------------------- 保存 --------------------------------- */

export function markDirty() {
  player.dirty = true
  scheduleSave()
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(), 900)
}

export async function save(force = false) {
  if (!player.id) return
  if (!player.dirty && !force) return
  clearTimeout(saveTimer)
  player.saving = true
  try {
    const rec = await updateScoreMeta(player.id, cloneMeta(player.meta))
    player.record = rec
    player.dirty = false
    player.savedAt = Date.now()
    player.autoSaved = true
    setTimeout(() => (player.autoSaved = false), 1400)
  } catch (err) {
    errorToast(t('store.saveFailed', { msg: err?.message || err }))
  } finally {
    player.saving = false
  }
}

/* --------------------------------- 撤销 --------------------------------- */
/*
 * **没有全局撤销栈**：删除记录就挂在顶部那条带按钮的通知上，通知收掉 = 这条路断了。
 * 只有一条：`undoSlot` —— 删除。
 *
 * **一步一条「删除记录」（`undoSlot.steps` 是个栈）**，点一次「撤销」就退回一步、
 * 计数跟着 -1（用户要求「点一次撤销就恢复一次删除的内容，然后删除 xN 的 n 减去一」）。
 *
 * ⚠️ **记的是「被删掉的那几项」，不是整份 meta 的快照**（用户要求：
 * 「快照岂不是会把我在这期间新建的内容也回退了」）。这一点很关键：
 * 撤销窗口开着的那几秒里用户完全可以接着干活（新建一条行、加个段落、改个 BPM），
 * 换快照的话「撤销」会连那些**根本没删过**的东西一起抹掉 —— 那是数据丢失。
 * 所以每条记录只装**这一次删除拿掉的对象副本 + 它们原来挂在哪**，撤销时原样插回去，
 * 别的任何一个字节都不碰。
 */

/**
 * 把 `item` 插回 `list` 里它原来的位置（按 id 找回原来的邻居）。
 * `afterId` 是**原来排在它后面**的那一项，所以插在那一项**前面**；
 * 那一项也没了（同一步里被一起删掉）就退回插在 `beforeId`（原来排在它前面的）后面；
 * 两边都不在了（都被删了）就放末尾 —— 位置不完美，但东西一定回得来。
 * **不排序** —— 数组的有序约定（`systems` 按 y0 降、`bars` 按 x 升）由调用方保证：
 * 插回去的对象坐标没变，按原来的邻居插回去就还是有序的。
 */
function insertBack(list, item, beforeId, afterId) {
  const at = list.findIndex((x) => x.id === afterId)
  if (at >= 0) return [...list.slice(0, at), item, ...list.slice(at)]
  const bt = list.findIndex((x) => x.id === beforeId)
  if (bt >= 0) return [...list.slice(0, bt + 1), item, ...list.slice(bt + 1)]
  return [...list, item]
}

/**
 * 删一项前记下「这一步拿掉了什么」。
 * 每一项（part）是 `{ read, write, item, beforeId, afterId }`：
 *  · `read()` 取当前那个数组、`write(next)` 写回去 —— **存函数不存数组引用**：
 *    meta 里的数组会被整段换成新数组（`filter` 那一路都是），存引用会指向旧的、插了也白插；
 *  · `item` 是被删对象的**深副本**（撤销还回来的就是它）；
 *  · 两个 id 是它原来前后的邻居，撤销时按它们插回原位。
 *
 * 深副本很便宜（一处标记几十字节），而它是「撤销真的能把这一项还回来」的唯一依据。
 */
function noteRemoval(...parts) {
  ensureUndoSlot().steps.push({ parts: parts.filter(Boolean) })
}

/** 拿（必要时建）当前那个撤销窗口 */
function ensureUndoSlot() {
  if (!undoSlot.notice) undoSlot.notice = { count: 0, steps: [], id: 0 }
  return undoSlot.notice
}

/**
 * 造一个 part：`access` 是 `{ read, write }` 一对，`item` 是马上要被删掉的那一项。
 * 返回 null = 这一项本来就不在数组里（没什么可记的）。
 */
function partOf(access, item) {
  if (!item) return null
  const list = access.read()
  const i = list.findIndex((x) => x.id === item.id)
  if (i < 0) return null
  return {
    ...access,
    item: JSON.parse(JSON.stringify(item)),
    beforeId: list[i - 1]?.id ?? null,
    afterId: list[i + 1]?.id ?? null,
  }
}

/* meta 里那几个数组的读写口子（`noteRemoval` / `partOf` 用）—— 一律取当前 meta 的那一份，
   不要把数组本身存下来：`filter` 那一路都是整段换成新数组的。
   `atBars` 按行 id 现查（行被删掉之后写回会静默落空，撤销时行已经先插回来了，见 `undoLastDeletions`）。 */
const atSegments = () => ({
  read: () => player.meta.segments,
  write: (next) => { player.meta.segments = next },
})
const atRepeats = () => ({
  read: () => player.meta.repeats,
  write: (next) => { player.meta.repeats = next },
})
const atSystems = (pageIndex) => ({
  read: () => player.meta.pages[pageIndex]?.systems || [],
  write: (next) => { const p = player.meta.pages[pageIndex]; if (p) p.systems = next },
})
const atBars = (pageIndex, systemId) => ({
  read: () => findSystem(systemId)?.sys.bars || [],
  write: (next) => { const f = findSystem(systemId); if (f) f.sys.bars = next },
})

/**
 * 撤销**一步**：把最近一次删除拿掉的那几项原样插回去，计数 -1。
 *
 * **只动那几项** —— 这期间用户新建 / 修改的任何东西都留在原地（这正是不用快照的原因）。
 * **栈空了才收掉通知** —— 还有得退的时候通知留着、正文改写成新的计数，
 * 用户可以接着一点一点往回退。
 *
 * **不报「已撤销」**（用户要求）：退回去的东西就在谱面上，看得见，不用再说一句。
 */
export function undoLastDeletions() {
  const notice = undoSlot.notice
  if (!notice?.steps.length) return
  const step = notice.steps.pop()
  // **正着插**（记的顺序就是「先有容器、后有挂在它里面的东西」）：
  // 行先回来，它的小节线才找得到自己那一行；小节线回来了，挂在它上面的段落 / 反复才插得进去。
  for (const part of step.parts) {
    const list = part.read()
    // 已经在了就别插第二份（同一步里重复记到、或者用户自己又画了一条同 id 的）
    if (list.some((x) => x.id === part.item.id)) continue
    part.write(insertBack(list, part.item, part.beforeId, part.afterId))
  }
  notice.count = Math.max(0, notice.count - 1)
  markDirty()
  // 这一下没得退了：收掉通知，别再留一条「删除 x0」
  if (!notice.steps.length) return dismissUndoToast()
  resendUndoToast()
}

/**
 * 把当前这条撤销通知按剩下的步数重写一遍（正文 `删除 x{n}`、倒计时重新起）。
 * 撤销一步之后调 —— 计数变了，正文也要跟着变。
 * **`bump = false`**：这一步是「退回去」，不是新删一下。
 */
function resendUndoToast() {
  const notice = undoSlot.notice
  if (!notice) return
  notifyUndoToast(undoSlot, (n) => t('store.deleteCount', { n }), 'undo', 'undo', false)
}

/**
 * 收掉那条通知。**按 `id` 收**（不是按 key）：新删一下会把同 key 的那条顶掉，
 * 而按 id 收只收「我正在处理的那一条」—— 顶掉之后槽里已经是新的了，
 * 这里拿到的 id 也是新的，两边不会错位。
 */
function dismissUndoToast() {
  if (undoSlot.notice?.id) dismissToast(undoSlot.notice.id)
  undoSlot.notice = null
  clearTimeout(undoSlot.timer)
}

/**
 * 收掉撤销通知（打开 / 关闭 / 换乐谱时用）。
 * **换谱必须走这里**：那条通知挂的是**上一条谱的**删除记录，跨谱撤销会把它的标记插到这一条上。
 */
function dismissAllUndoToasts() {
  dismissUndoToast()
}

/* ------------------------------- 提示信息 ------------------------------- */

/* 操作反馈统一走全局 toast（store/toast.js），不再另起一套 hint 状态 */

/* ------------------------------ 标记：行 ------------------------------ */

/**
 * 加一行 —— 行工具拖动之后**唯一**会落下来的东西。两种结局：
 *  1. 与已有行都不沾 → 落一条新行，并**自动识别这一行的小节线**（`detectRowBars`）；
 *  2. **与某条已有行重叠**（压住一半、整个套在它内部、或者把它整个罩住都算）→ 一律不加，
 *     给一条 toast（行工具是「点已有行 = 删」，这里**不能**用覆盖 / 替换来化解重叠 ——
 *     松手只会落到一次明确的添加或删除上；拒绝时给反馈，免得让人以为是自己没划准）。
 *     **不够高也算这一支**（低于 `minH`），所以「这一笔什么都没落」的结局只有这一条路。
 * 参数是 meta 的 y-up 坐标（翻转在 `ScorePage` 的边界上已经做过），谁大谁小都行。
 * `minH` 是**行高下限（pt）**，由调用方按当前缩放算好传进来（见 `domain/rows.js` 头部）；
 * 省略时用 `DEFAULT_MIN_H`。
 */
export function addSystem(pageIndex, y0, y1, minH = DEFAULT_MIN_H) {
  const page = player.meta.pages[pageIndex]
  if (!page) return null
  // 先夹进页面（顺带挡掉太扁 / NaN），再判重叠 —— 夹完才与屏幕上看到的那条带子完全一致
  const box = clampToPage(y0, y1, page.height, minH)
  if (!box) return null
  const { lo, hi } = box
  const exists = (page.systems || []).find((s) => Math.abs(s.y0 - lo) < 2 && Math.abs(s.y1 - hi) < 2)
  if (exists) return exists // 同一块地方又拖了一次，不算新行，也不再叠一条
  if (overlapSystem(page.systems, lo, hi)) {
    dangerToast(t('store.row.overlap'))
    return null
  }
  const sys = { id: uid('sy'), y0: lo, y1: hi, bars: [] }
  page.systems.push(sys)
  page.systems.sort((a, b) => b.y0 - a.y0) // PDF y 轴向上：y0 大的在上
  markDirty()
  // 小节线不用手画：这一行刚落下就自己认一遍（不 await —— 它是后台活儿，见 `detectRowBars`）
  detectRowBars(pageIndex, sys.id).catch(() => {})
  return sys
}

/**
 * 新建行之后**自动把这一行的小节线认出来**：跑一次**这一页的整页识别**
 * （`domain/omr.js` 的 `detectPdfPage`，与导入时同一套链路），再把落在这一行 y 范围内的
 * 识别结果的小节线填进这条新行。
 *
 * 三条约定：
 *  · **整页跑，不是把这一行裁出来跑**：行那一步的判据全是相对整页的（门槛是本页最强行的比例、
 *    谱表要够页宽的 0.3 倍…），裁一小块等于把分母全换掉，结果与导入时看到的那一套对不上。
 *  · **按页缓存**（`omrPageCache`）：识别只看 PDF 像素、与 meta 无关，所以同一页认一次就够，
 *    连着新建几条行不必把整页重跑几遍。缓存里存的是**那一次识别的 promise**（不是结果）——
 *    前一条行还没认完就又划了一条时，两次等的是同一件事，不会把整页跑两遍。
 *  · **认不出来就什么都不加**（这一页没有可识别的东西、PDF 没有、识别抛错），
 *    失败只 `console.warn` —— 新建行这件事本身已经成立，不该被识别连累；也**不弹通知**：
 *    标出来的线就在眼前，看得见。
 *
 * 落点用**写之前现查的那一条行**（按 id 重查）：识别的这一段时间里这一行可能已经被删掉 /
 * 被撤销又插回来了（撤销是**把那一行换个副本插回去**，按 id 查才查得到），那时什么都不写。
 * 行上已经有小节线（用户自己画了几条）时也不写，免得把手工标记和识别结果掺在一起。
 */
async function detectRowBars(pageIndex, systemId) {
  if (!pdfBlob) return
  try {
    let pending = omrPageCache.get(pageIndex)
    if (!pending) {
      pending = detectPdfPage(pdfBlob, pageIndex + 1).then((res) => res.systems || [])
      // 失败的那一页不留在缓存里 —— 留着就等于这一页从此再也认不了（下次新建行直接读到那次失败）
      pending.catch(() => omrPageCache.delete(pageIndex))
      omrPageCache.set(pageIndex, pending)
    }
    const systems = await pending
    const page = player.meta.pages[pageIndex]
    const sys = (page?.systems || []).find((s) => s.id === systemId)
    if (!sys || (sys.bars || []).length) return
    const lo = Math.min(sys.y0, sys.y1)
    const hi = Math.max(sys.y0, sys.y1)
    // 识别出的行与本行的 y 范围**有交集**就收：新行是手划的，边界与识别出来的那条不会正好齐。
    // 手划的边界跨了两条行时（识别出来的两行都与它相交）两条的小节线都会进来 ——
    // 那是用户把一条行划到了两行谱上，标出来的仍旧是「这一块里真实存在的线」，
    // 同一个 x 只留一条（去重见下），不会凭空多出小节。
    const xs = []
    for (const s of systems) {
      const a = Math.min(s.y0, s.y1)
      const b = Math.max(s.y0, s.y1)
      if (a >= hi || b <= lo) continue
      for (const bar of s.bars || []) xs.push(bar.x)
    }
    if (!xs.length) return
    // 同一个 x 只留一条（与 `addBar` 的去重同一档 8pt），再按 x 升序 —— `bars` 的约定
    const sorted = xs.slice().sort((a, b) => a - b)
    const kept = []
    for (const x of sorted) {
      if (kept.length && x - kept[kept.length - 1] < 8) continue
      kept.push(x)
    }
    sys.bars = kept.map((x) => ({ id: uid('br'), x }))
    markDirty()
  } catch (err) {
    console.warn('新建行后自动识别小节线失败，这一行照旧留着，可以手动标', err)
  }
}

/**
 * 删一行（连同它的小节线与挂在这些线上的段落 / 反复）。
 * `notify` 传 false = **这次调用不要各弹一条通知** —— 只有「标记列表」的批量删除会这么调。
 *
 * **删之前把这些东西各记一条**（行自己 + 它的小节线 + 那些线上的段落 / 反复），
 * 撤销时才能一样样插回去；`notify = false` 时也要记，它只是不弹通知。
 */
export function removeSystem(systemId, notify = true) {
  const found = findSystem(systemId)
  if (!found) return
  const barIds = new Set((found.sys.bars || []).map((b) => b.id))
  const hitSegs = player.meta.segments.filter((s) => barIds.has(s.barId))
  const hitReps = player.meta.repeats.filter((r) => barIds.has(r.barId))
  // 记：行 → 它的小节线（每条各自记，插回时按各自原来的邻居）→ 挂在这些线上的段落 / 反复
  const barParts = (found.sys.bars || []).map((b) => partOf(atBars(found.pageIndex, systemId), b))
  noteRemoval(
    partOf(atSystems(found.pageIndex), found.sys),
    ...barParts,
    ...hitSegs.map((s) => partOf(atSegments(), s)),
    ...hitReps.map((r) => partOf(atRepeats(), r)),
  )
  found.page.systems.splice(found.sysIndex, 1)
  cascadeRemoveBars(barIds)
  markDirty()
  if (notify) notifyUndo()
}
export function findSystem(systemId) {
  for (let p = 0; p < player.meta.pages.length; p++) {
    const systems = player.meta.pages[p].systems || []
    const i = systems.findIndex((s) => s.id === systemId)
    if (i >= 0) return { page: player.meta.pages[p], pageIndex: p, sys: systems[i], sysIndex: i }
  }
  return null
}

export function findBar(barId) {
  for (let p = 0; p < player.meta.pages.length; p++) {
    for (const sys of player.meta.pages[p].systems || []) {
      const bar = (sys.bars || []).find((b) => b.id === barId)
      if (bar) return { page: player.meta.pages[p], pageIndex: p, sys, bar }
    }
  }
  return null
}

function cascadeRemoveBars(barIds) {
  let removed = 0
  const before = player.meta.segments.length + player.meta.repeats.length
  player.meta.segments = player.meta.segments.filter((s) => !barIds.has(s.barId))
  player.meta.repeats = player.meta.repeats.filter((r) => !barIds.has(r.barId))
  removed = before - (player.meta.segments.length + player.meta.repeats.length)
  if (player.activeSegmentId && !player.meta.segments.some((s) => s.id === player.activeSegmentId)) {
    player.activeSegmentId = null
    player.drawer = null
  }
  return removed
}

/* ---------------------------- 标记：小节线 ---------------------------- */

export function addBar(systemId, x) {
  const found = findSystem(systemId)
  if (!found) return null
  // 附近已经有一条线就不再重复添加：拖动放置时手一抖很容易画到同一条线上
  const near = (found.sys.bars || []).find((b) => Math.abs(b.x - x) < 8)
  if (near) return near
  const bar = { id: uid('br'), x }
  found.sys.bars = [...(found.sys.bars || []), bar].sort((a, b) => a.x - b.x)
  markDirty()
  return bar
}

export function removeBar(barId, notify = true) {
  const found = findBar(barId)
  if (!found) return
  // 记：这条线 + 挂在它上面的段落 / 反复（级联会一起拿掉）
  noteRemoval(
    partOf(atBars(found.pageIndex, found.sys.id), found.bar),
    ...player.meta.segments.filter((s) => s.barId === barId).map((s) => partOf(atSegments(), s)),
    ...player.meta.repeats.filter((r) => r.barId === barId).map((r) => partOf(atRepeats(), r)),
  )
  found.sys.bars = found.sys.bars.filter((b) => b.id !== barId)
  cascadeRemoveBars(new Set([barId]))
  markDirty()
  if (notify) notifyUndo()
}

/* ----------------------------- 标记：段落 ----------------------------- */

/**
 * 排在第 `measure` 小节之前的最后一个段落（新段落的 BPM / 拍号要照抄它）。
 * 位置比较走 `comparePosition`，没写小节号的段落退回它挂靠的那条小节线。
 */
export function prevSegmentBefore(measure) {
  const segs = player.meta.segments || []
  let best = null
  for (const s of segs) {
    const no = Number.isFinite(s.measure) ? positionMeasure(s) : structure.value.barStartMeasure.get(s.barId)
    if (!Number.isFinite(no)) continue
    if (no < measure && (!best || no > best.measure)) best = { seg: s, measure: no }
  }
  return best?.seg || null
}

/**
 * 点一条小节线 = 在这一小节开头加一个段落（已经有段落就打开它）。
 * 三种落点被挡：**这条线后面没有小节**（曲末那条）、**这条线是行末那条**
 * （行末线只收反复结束标记，段落要挂到下一行行首那条线上 —— 两条线是同一个小节，见 `isRowEndBar`）、
 * 以及位置 1 让给固定的「开头」段落（那种直接打开它）。
 */
export function addSegmentAt(barId) {
  const auto = structure.value.barStartMeasure.get(barId)
  if (!Number.isFinite(auto)) {
    dangerToast(t('store.segment.noMeasureAfterBarline'))
    return null
  }
  const existing = (player.meta.segments || []).find((s) => s.barId === barId)
  if (existing) {
    openSegment(existing.id)
    return existing
  }
  // 行末线只允许反复结束标记：段落改点下一行行首那条线（同一个小节）
  if (isRowEndBar(structure.value, barId)) {
    dangerToast(t('store.segment.rowEndBarline'))
    return null
  }
  // 开头位置由固定的「开头」段落占着，直接打开它
  if (auto <= 1) {
    const head = (player.meta.segments || []).find((s) => s.head)
    if (head) {
      openSegment(head.id)
      return head
    }
  }
  const prev = prevSegmentBefore(auto)
  const seg = defaultSegment({
    barId,
    // 点小节线落在这一小节的开头 —— 拍号永远是第 1 拍
    measure: auto,
    beat: 1,
    bpm: prev?.bpm ?? 120,
    beatsPerBar: prev?.beatsPerBar ?? 4,
    beatUnit: prev?.beatUnit ?? 4,
  })
  player.meta.segments.push(seg)
  player.meta.segments.sort(comparePosition)
  player.activeSegmentId = seg.id
  player.drawer = 'segment'
  markDirty()
  return seg
}

export function openSegment(id) {
  player.activeSegmentId = id
  player.drawer = 'segment'
}

export function removeSegment(id, notify = true) {
  const seg = player.meta.segments.find((s) => s.id === id)
  if (!seg) return
  // 「开头」段落是固定段落（默认速度的来源），任何入口都不许删 —— 列表里也不会列它，
  // 这一条是兜底：万一将来又出现一个新的删除入口，也不会把它删掉
  if (seg.head) {
    dangerToast(t('store.segment.headNotDeletable'))
    return
  }
  noteRemoval(partOf(atSegments(), seg))
  player.meta.segments = player.meta.segments.filter((s) => s.id !== id)
  if (player.activeSegmentId === id) {
    player.activeSegmentId = null
    player.drawer = null
  }
  markDirty()
  if (notify) notifyUndo()
}
/**
 * 改一个段落。**改拍号时拍号要跟着夹一次**：`beat` 的上限是这一段落自己的 `beatsPerBar`，
 * 把 4/4 里的第 4 拍改成 3/4 之后，那第 4 拍在这一段落里已经不存在了（见 schema.js 的 `fitBeat`）。
 */
export function updateSegment(id, patch) {
  const seg = player.meta.segments.find((s) => s.id === id)
  if (!seg) return
  // 固定开头段落：位置永远是第 1 小节第 1 拍，也不挂在任何小节线上
  if (seg.head) patch = { ...patch, measure: 1, beat: 1, barId: null }
  Object.assign(seg, patch)
  seg.beat = fitBeat(seg.beat, seg.beatsPerBar)
  markDirty()
}

export function captureSegmentTime(id, time = player.currentTime) {
  updateSegment(id, { time: Number(time.toFixed(3)) })
}

export function clearSegmentTime(id) {
  updateSegment(id, { time: null })
}

/* ----------------------------- 标记：反复 ----------------------------- */
/*
 * 反复工具**没有编辑面板**，而且是**两次点击成一对**：
 *   1. 第一次点 → 只记一个**待定的反复起点**（`pendingRepeatBarId`，**只在会话里、不写 meta**）；
 *   2. 第二次点 → 两条线**这时才一起**写进 meta，成为一对反复（区间不许与已有反复重叠 = 不能嵌套）；
 *   3. 再点这对区间内部 → 房子起点（**一对只能有一个**）：这一段还没有就加上，
 *      已经有了就把那一条**搬到这一笔落点**上（不新增第二条，也不拒绝）。点区间外 → 又从第 1 步开始。
 * 所以**不是每对反复都有房子**：有没有房子，第二遍的走法不同（见 `domain/timeline.js` 的 `expandRepeats`）。
 * **点已有的标记 = 删**：点房子起点只删它自己；点反复的两条边界线删掉整段（含房子）。
 * **行末那条小节线只收「反复结束」**（判据 `isRowEndBar`）：没待定起点时点它 → 拒绝（`row-end`，
 * 起点 / 房子起点要改点下一行行首那条线，同一个小节）；带着待定起点点它 → 正常成对，那一笔就是结束线。
 *
 * 待定起点被丢掉的三个时机（用户明确要求）：**切工具 / 退出编辑模式 / 第二次点击不合法** ——
 * 前两个挂在文件末尾那个 watch 上，第三个在 reject 分支里。
 * `passes` / `backToMeasure` / `houseEndMeasure` / `label` 字段还在数据里（外部 JSON 可能写着），
 * 但**界面已经没有任何改它们的入口**：遍数固定 2 遍，别再往这里加第二套参数。
 */

/** 丢掉那个还没成对的待定起点（切工具 / 退编辑 / 点错时调） */
export function discardPendingRepeat() {
  player.pendingRepeatBarId = null
}

/** 这一笔是不是落在**已经成对的那段反复**的两条边界线上（是的话返回那个区块） */
function blockAtBarBarline(barId) {
  return timeline.value.blocks.find((b) => b.startBarId === barId || b.endBarId === barId) || null
}

/**
 * 点一条小节线：**已成对的那段反复 → 删 / 加房子；否则按 `decideRepeatTap` 的落点决策走**。
 * 判据本身在 `domain/timeline.js`（那边能单测），这里只管会话状态、写 meta 与文案。
 */
export function addRepeatAt(barId) {
  const onBar = (player.meta.repeats || []).filter((r) => r.barId === barId)
  if (onBar.length) {
    // 房子起点：只删这一条，反复本身留着
    if (onBar.some((r) => r.kind === 'house1')) {
      noteRemoval(...onBar.map((r) => partOf(atRepeats(), r)))
      player.meta.repeats = player.meta.repeats.filter((r) => r.barId !== barId)
      markDirty()
      notifyUndo()
      return null
    }
    // 反复的两条边界线：整段一起删（配对的另一条 + 区间里的房子）
    const block = blockAtBarBarline(barId)
    const doomed = block
      ? new Set([block.startBarId, block.endBarId, ...block.houseMarks.map((m) => m.barId)])
      : new Set([barId]) // 没成对的孤线（外部数据）：点掉就只是去掉这一条
    const hit = player.meta.repeats.filter((r) => doomed.has(r.barId))
    noteRemoval(...hit.map((r) => partOf(atRepeats(), r)))
    player.meta.repeats = player.meta.repeats.filter((r) => !doomed.has(r.barId))
    discardPendingRepeat()
    markDirty()
    notifyUndo()
    return null
  }

  const decision = decideRepeatTap(barId, {
    structure: structure.value,
    total: measureCount.value,
    repeats: player.meta.repeats || [],
    pendingBarId: player.pendingRepeatBarId,
  })

  if (decision.type === 'start') {
    // **不写 meta** —— 只记下待定起点，等第二条线来配对
    player.pendingRepeatBarId = barId
    return null
  }

  if (decision.type === 'complete') {
    player.meta.repeats.push(defaultRepeat({ barId: decision.startBarId, kind: 'start' }))
    player.meta.repeats.push(defaultRepeat({ barId, kind: 'end' }))
    player.pendingRepeatBarId = null
    markDirty()
    return null
  }

  if (decision.type === 'house1') {
    player.meta.repeats.push(defaultRepeat({ barId, kind: 'house1' }))
    player.pendingRepeatBarId = null
    markDirty()
    return null
  }

  if (decision.type === 'house1-move') {
    // 这一段已经有房子起点了 → 把那条标记搬到这一笔落点上（不新增第二条）
    const mark = player.meta.repeats.find((r) => r.barId === decision.fromBarId && r.kind === 'house1')
    if (mark) mark.barId = barId
    player.pendingRepeatBarId = null
    markDirty()
    return null
  }

  // reject：待定起点一并作废（用户要求「第二次点击不合法就把起点删了」）
  discardPendingRepeat()
  dangerToast(t(`store.repeat.reject.${decision.reason}`))
  return null
}

export function removeRepeat(id, notify = true) {
  const rep = player.meta.repeats.find((r) => r.id === id)
  noteRemoval(partOf(atRepeats(), rep))
  player.meta.repeats = player.meta.repeats.filter((r) => r.id !== id)
  markDirty()
  if (notify) notifyUndo()
}

/* ------------------------------- 音频控制 ------------------------------- */

/**
 * 播放设置落到输出上：有音频时听音乐与节拍器，没音频时只有节拍器。
 * 音乐音量 / 静音对无音频的播放没有意义（本来就没声音），但设置照旧留着手动可调。
 */
function applyOutputPrefs() {
  if (player.hasAudio) {
    engine.setRate(player.rate)
    engine.setVolume(player.volume)
    engine.setMuted(player.muted)
    metronome.setMuted(false)
    return
  }
  // 无音频时用 <audio> 元素当「时钟」：把它的 playbackRate 也设上，
  // 即便浏览器跑到别处报 currentTime，也是按同样的倍速在走
  engine.setRate(player.rate)
  engine.setMuted(true)
  clock.setRate(player.rate)
  clock.duration = timeline.value.duration
  metronome.setMuted(false)
}

export function applyRate(rate) {
  player.rate = rate
  applyOutputPrefs()
  metronome.reset()
  savePrefs()
}

/**
 * **「自定义」框里填出来的倍速**（倍速面板那个框）：与 `applyRate` 只差一件事 —— 顺手记进历史。
 *
 * 为什么记在 **`update:model-value`** 这条路上（也就是每敲一下、每按一次上下箭头都记）：
 * 框里那个值「即改即生效」，微调出来的每一档都真的当过当前的倍速。
 * 连点几下箭头会挤掉几条旧值 —— 那是「即改即生效」的代价，不是 bug。
 *
 * 值先规整一遍再比、再记（`normRate`）：与历史里存的写法保持一致，
 * 于是「有没有变」这类比较不用去愁浮点毛刺。值没变（`NumberPad` 点开又原样确定）就不记。
 */
export function applyCustomRate(rate) {
  const v = normRate(rate)
  if (v !== player.rate) rememberRate(v)
  applyRate(v)
}

/** 把一条自定义倍速记进历史：同一个值只挪到最前（不重复），满了挤掉最旧那条。
    **行内没有手动删除**（面板里那一行就是一条只读的档）：清空只有「清空历史」那一颗按钮（见下）。 */
function rememberRate(rate) {
  player.rateHistory = [rate, ...player.rateHistory.filter((r) => r !== rate)].slice(0, RATE_HISTORY_MAX)
}

/**
 * **清空自定义历史**（倍速面板 footer 里那颗「清空历史」）。
 *
 * ⚠️ 清掉的只是**历史这一串记录**：当前倍速（`player.rate`）该是多少还是多少 ——
 * 清完底栏那颗钮照旧读它原来那个数，正在播的谱也不会变速。
 * **没有确认弹窗**（要求原文：「不需要弹窗」）：这里删的是一串填写记录，不是那份谱。
 */
export function clearRateHistory() {
  if (!player.rateHistory.length) return
  player.rateHistory = []
  savePrefs()
}

export function applyVolume(v) {
  player.volume = Math.max(0, Math.min(1, v))
  player.muted = player.volume === 0
  applyOutputPrefs()
  savePrefs()
}

/**
 * **音频起点那一屏的「试听」**（`AudioOffsetPicker` 的中心竖线 = 起点，试听就从那儿放那一小段）。
 *
 * ⚠️ **它不跟谱面走同一个播放流程**（要求原文：「试听不和谱面走同一个播放流程！试听只是单独放
 * 那个音频文件」）—— 落地就一件事：**用另一只 `<audio>` 放同一个音频文件**（`engine.previewEl`），
 * 所以下面这些**一个都不动**：`player.currentTime`（谱面播放头）、`player.playing`（播放中那套界面、
 * 播放键、顶栏隐藏）、`clock` / OutputClock、节拍器、预备拍、循环、自动翻页。
 * 试听只让自己那颗播放头走：`player.previewTime`（秒，**音频文件自己的时间轴**）。
 *
 * 为什么不复用主引擎（`engine.el`）：那只 `<audio>` 是谱面走带的声源，
 * 它的 `currentTime` 就是播放位置、`play` / `pause` 事件会把整个 app 切进 / 切出播放态 ——
 * 借它试听一次，谱面位置就被挪走了，也说不清「这算不算在播放」。
 *
 * 起点可以落在音频开始之前（第一小节排在音频 0 秒之前，见 `timelineStart`），
 * 而 `<audio>` 只认 ≥ 0 —— 那时从音频的 0 秒起播（正好是「你设的这一点之后能听到的第一声」）。
 */
/**
 * 试听放多长就自己停（秒）。
 * 取 3 而不是整屏 5：**频谱里那颗播放头也是从中心竖线往右走**的，
 * 放满 5 秒它就正好走出右边缘看不见了 —— 3 秒内还留在视野里，够听清起点对不对。
 */
const PREVIEW_SPAN = 3

/** 试听从哪儿起播：音频自己的时间轴、不小于 0（见上面的注释） */
function previewStart(centerSeconds) {
  return Math.max(0, Number(centerSeconds) || 0)
}

function syncPreviewOutput() {
  engine.setPreviewVolume(player.volume)
  engine.setPreviewMuted(player.muted)
}

/**
 * 开始试听。返回**这次到底有没有放起来**（`AudioOffsetPicker` 只拿它决定要不要弹提示）。
 * 起不来（音频文件放不出来 / 浏览器拒绝）就把状态退回未试听，**别让按钮挂在一个没有声音的状态上**。
 */
export async function startPreview(centerSeconds) {
  if (!player.hasAudio) return false
  syncPreviewOutput()
  engine.previewSeek(previewStart(centerSeconds))
  player.previewTime = engine.previewTime
  player.previewing = true
  const ok = await engine.previewPlay()
  if (!ok) {
    player.previewing = false
    player.previewTime = 0
    return false
  }
  return true
}

/**
 * 结束试听（再点一下、离开那一屏、换谱都走这里）。**只停试听那只 `<audio>`** ——
 * 谱面该播就还照旧播（两件事互不影响，见上面的注释）。
 * 没在试听时也照调不误（`AudioOffsetPicker` 的 `onBeforeUnmount` 直接调它）。
 */
export function stopPreview() {
  engine.previewPause()
  player.previewing = false
  player.previewTime = 0
}

/**
 * 试听**自己走到该停的地方**就停（`PREVIEW_SPAN` 秒，见那条常量的注释）。
 * 不停的话它会一路放到曲子结束 —— 那一屏只是让你对一下起点，不需要听一整首。
 * 判据走 `player.previewTime` 那条 watch（`engine` 每帧把它报上来），
 * 位置停在原处（不动 `previewTime`）：再点「试听」还从这儿接着放，看得见停在哪。
 */
watch(
  () => player.previewTime,
  (t) => {
    if (!player.previewing) return
    if (t >= PREVIEW_SPAN) {
      engine.previewPause()
      player.previewing = false
    }
  }
)

/** 停下来（暂停 / 取消预备拍）。**进编辑模式、切工具都走这里**，别各处自己拼一遍 */
function pausePlayback() {
  metronome.cancelCountIn()
  // 预备拍取消 = 「预备拍中」这个可反应状态也要一起归位（谱面按它决定闪不闪，见 `player.cueing`）；
  // 预备拍期间点亮的那个落点提示（`jumpFlash`）也一起撤掉 —— 它是「马上要跳」的临时提示，
  // 留着它下次播放会莫名其妙地闪起来（暂停/停止本来就不该有提示，见 `docs/ui.md` §18.46）。
  // 「跳转后」（`jumpAfter`）**不撤**：那是「刚刚跳到了这里」的一次性事件提示，暂停照样留着。
  player.cueing = false
  if (player.jumpFlash) player.jumpFlash = null
  // 试听走的是另一只 `<audio>`（见 `player.previewing`），跟这里没有关系 —— **不要顺手把它停了**：
  // 暂停谱面的播放不该让那一屏的试听跟着断。
  // 前导期间暂停：只停走时，位置留在那个负数上（再按播放从那儿接着走）
  stopLead()
  suppressRewind = false
  engine.pause()
  clock.pause()
}

export async function togglePlay() {
  if (player.playing || metronome.countInActive) {
    // 预备拍途中再点一下 = 取消
    pausePlayback()
    return
  }
  if (!canPlay.value) {
    // 连小节都没有（没 PDF 也没标记）：时间轴为空，播起来没有任何东西可走
    dangerToast(t('store.nothingToPlay'))
    return
  }
  await startPlayback({ cue: settings.countInPlay })
}

export function seek(time, { keepLoop = true } = {}) {
  const dur = duration.value
  // 局部变量别叫 t —— 会和 i18n 的 t() 撞名
  // **下限不夹到 0**：弱起前导期间位置本来就是负数（见 `startLead`）；上界仍然夹到总长
  const clamped = dur ? Math.min(time, dur) : Number(time) || 0
  stopLead()
  if (clamped < 0) {
    // 负数位置寄存在时钟上：`<audio>` 钉在 0 秒（它永远看不到负数），位置 / 节拍器读 `leadPos`
    clock.leadPos = clamped
    if (!engine.paused) {
      const keep = suppressRewind
      suppressRewind = true
      engine.pause()
      suppressRewind = keep
    }
  } else {
    clock.seek(clamped)
  }
  player.currentTime = clamped
  metronome.reset()
  if (player.loopOn && player.selection && keepLoop) {
    const region = loopRegion.value
    if (region && (clamped < region.start - 0.05 || clamped > region.end + 0.05)) {
      // 跳出循环区间即取消框选
      clearSelection()
    }
  }
}

/**
 * 跳到某小节：要不要接着走带、要不要先打预备拍、落点上闪哪一下，全在这儿定。
 *
 * ⚠️ **两件事分开判，别混**（混过一版，用户纠正）：
 *   · **要不要接着走带** = 「跳转自动播放」开着 **或 此刻本来就在走带中**
 *     （`player.playing`，外加预备拍的倒数 —— 有音频时预备拍会把音频停住、`player.playing`
 *     已经是假，但那明明还在走带的流程里）。
 *     用户原话：「我可以在播放的过程中点击跳转，这种情况下即使跳转自动播放没有打开也是需要播预备拍的」；
 *   · **要不要打预备拍** = 「跳转预备拍」开着 **且** 上面那条成立（预备拍是「数一小节再开始」的倒数，
 *     不接着走带就没有可数的东西）。
 *     「没有开自动播放、又不在走带中」→ **既不自动播、也不打预备拍**（用户明确要求）：
 *     只跳到落点、在落点上闪一下「跳转后」。
 */
export async function seekToPosition(measureNo, beatOffset = 0, opts = {}) {
  const tl = timeline.value
  // 局部变量别叫 t —— 会和 i18n 的 t() 撞名
  // **不传 nearTime** = 取这一小节的第一次出现：手动跳转「视作还没反复过」（见 `posToTime` 的注释）
  const anchor = tl.posToTime(measureNo, null, beatOffset)
  // 此刻就在走带中（含预备拍倒数）—— 见上面那条：这时即使没开「跳转自动播放」也要接着走
  const rolling = player.playing || player.cueing
  const wantPlay = opts.play ?? (settings.autoPlayOnJump || rolling)
  const wantCue = opts.cue ?? settings.countInJump
  // 先清掉可能残留的**跳转前**提示：手动跳转是用户自己指定的位置，不是「即将自动跳到某处」，
  // 而且跳到「小节号没变」的位置时那个 watch 根本不会跑（它只在 `currentPos.no` 变化时触发），
  // 不清就会留着一个跟当前播放位置无关的闪烁。
  if (player.jumpFlash) player.jumpFlash = null
  if (wantPlay && canPlay.value) {
    // 打预备拍的那条路：**倒数演完才跳**（跳 + 闪「跳转后」都在 `startPlayback` 的收尾里），
    // 所以这里不要抢着闪、也不要抢着 seek。
    const cueing = await startPlayback({ from: anchor, cue: wantCue, landing: measureNo })
    if (cueing) return anchor
  } else {
    seek(anchor)
  }
  // **跳转后闪烁**：手动跳转落到哪一小节，就在那儿闪一下（用户明确要求手动跳转也闪）。
  // 这一句管的是**没打成预备拍**的那条路（上面 return 掉的那条由 `startPlayback` 在倒数演完后闪）：
  // 暂停着点跳转、预备拍关着、预备拍音量为 0，都是它点亮。
  // ⚠️ 必须在 seek **之后**：闪烁的时机就是**播放头跳转那一刻**（见 `flashAfterJump` 的规则），
  // 而且提示一出生就在落点上，才不会被随后那个 watch 当成「跳完了」清掉（这个坑踩过两次）。
  flashAfterJump(measureNo)
  return anchor
}

/* ---------------------------- 预备拍与播放 ---------------------------- */

let suppressRewind = false

/* ---------------------- 弱起前导：音频开始之前那一段 ---------------------- */

/**
 * 记谱的弱起小节比音频里那段弱起长时，时间轴会在音频 0 秒**之前**就排上拍点
 * （`startOffset` 是第 2 小节的时间，往前推出来的第 1 小节整段落在音频开始之前）。
 * 这时**不能把位置夹到 0** —— 夹完就落在小节的半截上，表现成「点第 1 小节从后半小节开始播放」。
 *
 * 做法：位置从负数走起（谱面 / 节拍器 / 进度都按时间轴走），`<audio>` 钉在 0 秒不动，
 * 等位置走到 0 秒再起播 —— 也就是**「让音频晚一点开始」**。
 * 负数位置寄存在 `clock.leadPos` 上，所以底层的 `<audio>` / AudioContext 时钟永远只看得到 ≥ 0。
 * 前导期间 `player.playing` 为真（播放键显示暂停）；暂停就停在当时那个负数位置上，
 * 再按播放从那儿接着走。`close()` / 跳到非负位置都会停掉它。
 */
let leadRaf = 0
let leadFrom = 0
let leadAt = 0

/** 停住前导的走时：位置停在原地（`clock.leadPos` 继续把负数报给节拍器与位置判定） */
function stopLead() {
  if (leadRaf) cancelAnimationFrame(leadRaf)
  leadRaf = 0
}

/** 前导当前该走到哪：起播那一刻的负数位置 + 已走过的时间（按倍速） */
function leadPos() {
  return leadFrom + ((performance.now() - leadAt) / 1000) * (player.rate || 1)
}

function leadTick() {
  if (!leadRaf) return
  const pos = leadPos()
  clock.leadPos = pos
  player.currentTime = pos
  if (pos < 0) {
    leadRaf = requestAnimationFrame(leadTick)
    return
  }
  // 走到音频的 0 秒了：位置交给 <audio>，正式起播（`seek` 会顺手清掉 leadPos）
  leadRaf = 0
  seek(pos)
  playFrom()
}

/** 从当前位置（必须是负数）开始走前导；位置不是负数就返回 false（正常起播） */
function startLead() {
  const from = player.currentTime
  if (!(from < 0)) return false
  leadFrom = from
  leadAt = performance.now()
  // 音频钉在 0 秒等：这次 pause 是内部动作，别让它触发「回退到小节开头」
  const keep = suppressRewind
  suppressRewind = true
  if (!engine.paused) engine.pause()
  suppressRewind = keep
  clock.leadPos = from
  player.currentTime = from
  player.playing = true
  // 节拍器照点：`startMetronome` 里的 `reset()` 就是按 leadPos（负数）对齐的
  if (player.metronomeVolume > 0) startMetronome()
  if (!leadRaf) leadRaf = requestAnimationFrame(leadTick)
  return true
}

/** 从当前位置开始播放（预备拍已经由调用方打完） */
function playFrom() {
  // 位置还在音频 0 秒之前（弱起前导）：先让位置走，走到 0 秒再起播音频
  if (startLead()) return
  // 节拍器音量 > 0 才起它：归零时播放照走，只是没有点击声（静音走带）
  if (player.metronomeVolume > 0) startMetronome()
  if (player.hasAudio) {
    engine.play()
    return
  }
  // 无音频：没有伴奏也没有点击声时，时钟走 Web Audio，位置仍按时间轴累加
  clock.play()
}

/**
 * 预备拍与「预备拍闪烁」**共用的一份节奏** —— 从落点那一拍（时间轴 sample）取：
 *   · `beats`  = 这一小节几拍 = 预备拍打几下 = 落点闪几下（`flash.repeats`）；
 *   · `beatMs` = 一拍的**真实**毫秒数 = 预备拍每下的间隔 = 落点每一下渐变的时长（`flash.ms`），
 *     下限 160ms（太快就闪不成「一下一下」了）。
 *
 * ⚠️ **必须同源**：预备拍按段落取速度、闪烁按小节另取一份的话，改过 BPM / 拍号就会一个快一个慢 ——
 * 表现成「预备拍和预备拍闪烁的逻辑不一致」（用户报告过）。所以两边都只读这一支，
 * 传进来的可以是 `timeline.samples` 的一条记录，也可以是 `tempoAt()` 的结果（字段名相同）；
 * 都没有（落点不在时间轴上）时退回默认 120 4/4。**一拍多长走 domain 的 `beatDuration()`**
 * （与时间轴、节拍器同一支算式）—— 它给的是**时间轴秒**，所以还要**除以倍速**
 * （`player.rate`）：那一拍在真实世界里就是走这么快，而预备拍的排程与闪烁都是真实时间。
 * 160ms 下限夹在**除完之后**（`player.rate` 报的是这一份的走带速度，
 * 与节拍器前瞻用的 `clock.rate` 同源）。
 */
function countInTiming(source) {
  return {
    beats: Math.max(1, Math.round(source?.beatsPerBar || 4)),
    beatMs: Math.max(160, Math.round((beatDuration(source) * 1000) / (player.rate || 1))),
  }
}

/**
 * **打预备拍的唯一入口**（三条预备拍的路都从这儿走：播放预备拍 / 跳转预备拍 / 循环段预备拍；
 * 代码里只有 `startPlayback` 与 `handleLoopEnd` 两个调用点）——
 * 顺手做两件事：
 *   1. 把「预备拍中」同步到可反应的状态 `player.cueing` 上。
 *      `metronome.countInActive` 是读定时器的 getter、**不是响应式数据**，而谱面要按它决定
 *      显不显示「跳转前闪烁」（见 `docs/ui.md` §18.46），所以必须有一个进 store 的镜像；
 *      `countIn()` 在 `cueVolume = 0` 时会**同步**回调，这里置真再置假也是一次净变化，没有副作用；
 *   2. **`landing`（落点那一拍）给了就把落点点亮**：预备拍这几拍里每拍闪一下，节奏与预备拍**同源**
 *      （`countInTiming`）—— 手动跳转预备拍 = 你点的那一小节、循环段预备拍 = 框选的起点。
 *      它就是「跳转前闪烁」；**「跳转后」那一下在点击那一刻就闪过了**（`startPlayback`），
 *      手动跳转 / 框选起播在倒数演完后**不再补闪**；循环回跳则由落地时的 watch 转换。
 *      **不给 `landing`（播放预备拍）就只数拍子、不闪** —— 那儿没有跳跃，闪谁都不对
 *      （用户定的：播放预备拍里只有当前小节底与播放头）。
 *      但**拍数 / 拍长照样要有来源**：`landing` 没给就用播放头现在那一拍（速度按当前段落走）。
 *   别绕开它直接调 `metronome.countIn` —— 那样 `cueing` 会一直停在假上、落点上那几下闪烁
 *   也会和预备拍各走各的。
 */
function startCountIn(landing, onDone) {
  const timing = countInTiming(landing || currentPos.value.sample)
  player.cueing = true
  // **预备拍也算播放中**（用户明确要求）：播放键要显示成「暂停」、点一下就能暂停 / 取消倒数，
  // 顶栏隐藏、`togglePlay` 那两处判据都读 `player.playing`，所以这里一起置真。
  // 起始状态本来是暂停（暂停着点跳转 + 自动播放开着）时也必须置真，不能只靠「原来就在播」。
  player.playing = true
  if (landing) flashCountInLanding(landing, timing)
  metronome.countIn(timing.beats, timing.beatMs / 1000, () => {
    player.cueing = false
    // 倒数这一小节正好把落点那串「跳转前」演完（`repeats` × `ms` = 一小节）—— 顺手把状态撤掉。
    // 不撤的话它会一直挂着：闪烁本身早就透明了，但「当前小节那层浅底让位」（`flashOnActive`）
    // 还生效，落点这一小节看着就像没有「当前小节」的底（手动跳转 / 框选起播 / 循环回跳都走这儿）。
    // **自动跳**那串「跳转前」不是在这儿点的（由末尾那条 watch 落地时换成「跳转后」），不受影响。
    if (landing) player.jumpFlash = null
    onDone()
  })
}

/**
 * 预备拍要用的那一拍（= 要点亮的落点 + 拍数 / 拍长的来源）：
 *   · `from` 给了（跳转那条路）就取**那个时刻**在时间轴上的记录 —— `from` 是 `posToTime` 算出来的
 *     落点时间，所以它天然是**这一遍**的那条；反复里同一个小节有好几条记录，按小节号取会取到第一遍那条；
 *   · 没给（**播放预备拍**：没有跳转，播放就是从当前位置接着走）就取播放头现在那一拍 ——
 *     于是倒数这几拍点的就是「马上要从哪儿开始」那一小节，和跳转那几条路长得一模一样。
 */
function countInSample(from) {
  const sample = from != null ? timeline.value.timeToPos(from).sample : currentPos.value.sample
  return sample || null
}

/**
 * 打一小节预备拍后开始播放（不打预备拍 / 预备拍音量为 0 时直接播）。
 * `from` = 落点时间（`posToTime` 算出来的；**不给就是没有跳跃**：播放预备拍 / 大跳转）。
 * `landing` = 落点小节号，只在**有跳跃**时用得上（数完跳过去之后在它上面闪「跳转后」）。
 * **返回「这次真的打了预备拍吗」**：调用方据此决定还要不要自己闪一下「跳转后闪烁」。
 *
 * ⚠️ **次序：先数一小节，数完才把播放头跳过去**（用户明确要求，**所有带预备拍的地方都一样**）：
 * 倒数这一小节里**播放头一动不动**（还在你原来那一小节），只有落点那串「跳转前」在闪；
 * 数完才 `seek(from)` → 闪「跳转后」→ 起播。所以「跳转后」的时机永远等于**播放头跳转那一刻**
 * （见 `flashAfterJump`），它自然落在倒数演完之后，而不是点击那一刻。
 * 播放预备拍没有跳跃（`from` 为 null）：原地接着播，落点那串闪的是「马上要起播的那一小节」，
 * **不闪「跳转后」**（没跳就没这一下）。
 */
async function startPlayback({ from = null, cue = false, landing = null } = {}) {
  const wantCue = cue && player.cueVolume > 0
  if (!wantCue) {
    if (from != null) seek(from)
    playFrom()
    return false
  }
  // **打预备拍先停声源**：倒数这一小节里播放头必须钉在原地不动 —— 不停的话音乐会在倒数底下继续放，
  // 播放头还会往前走（落点那串闪烁会被「走过落点」之类的判定收掉，谱面上的当前小节也跟着乱跑）。
  // `suppressRewind` = 这次「停」是上层刻意压住的，别让它触发「回退到小节开头」，
  // 也别让它把 `player.playing` 抹掉（预备拍算播放中，见 `engine.on('pause')`）。
  const beat = countInSample(from)
  suppressRewind = true
  stopSources()
  await metronome.resume()
  startCountIn(beat, () => {
    suppressRewind = false
    // 数完：① 播放头跳到落点（**先跳**）② 同时闪「跳转后」③ 起播。①② 之间不许有 await。
    if (from != null) seek(from)
    if (from != null && landing != null) flashAfterJump(landing)
    playFrom()
  })
  return true
}

export function setCueVolume(v) {
  player.cueVolume = Math.max(0, Math.min(1, Number(v) || 0))
  metronome.setCueVolume(player.cueVolume)
  savePrefs()
}

/** 暂停后回退到当前小节开头 */
function rewindToMeasureStart() {
  const no = currentPos.value.no
  if (!no) return
  const at = timeline.value.posToTime(no, player.currentTime)
  if (Number.isFinite(at) && Math.abs(clock.now - at) > 0.04) seek(at)
}

export const loopRegion = computed(() => {
  if (!player.selection) return null
  const tl = timeline.value
  const from = player.selection.from
  const to = player.selection.to
  const t0 = tl.posToTime(from, player.currentTime)
  const t1 = tl.posToTime(to, t0) + tl.measureDuration(to, t0)
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null
  return { start: t0, end: t1 }
})

/**
 * **循环回跳这次会不会打预备拍**（「循环段预备拍」开着 **且** 预备拍音量 > 0）。
 * 判据只有这一处：`setSelection`（要不要走预备拍那条路）、`handleLoopEnd`（两条路）、
 * 以及 `armLoopLandingIfLastMeasure`（打了预备拍就别预闪）都读它 —— 别在各处再拼一遍这条件。
 */
function loopCountInOn() {
  return settings.countInLoop && player.cueVolume > 0
}

/**
 * **正在循环的那一段 —— 引擎手里那一个**（`setSelection` 里 `clock.setLoop(region)` 给的那份）。
 *
 * ⚠️ 判「循环起点是哪一遍」**不能用上面那个 `loopRegion` computed**：它是**按当前播放头重算**的
 * （`posToTime(from, player.currentTime)`），反复里同一个小节有好几遍时，播放头一走到区间后半段，
 * `nearTime` 就会选到**下一遍**去 —— 于是循环落点被点到另一遍的记录上（下标对不上，
 * 「跳转前 → 跳转后」那条链子就断在那儿）。引擎手里那份从框选那一刻定下来、不会漂。
 */
function activeLoop() {
  const region = clock.loop
  return region && region.end > region.start ? region : null
}

/**
 * 循环区间里**最后一小节的起始拍**（回跳就发生在它末尾）—— 「跳转前闪烁」要点的那一拍。
 * **按下标认、不按小节号**：反复里同一个小节号会出现好几遍，得区分是哪一遍。
 */
function loopLastStart(loop) {
  const samples = timeline.value.samples
  const last = timeline.value.timeToPos(Math.max(loop.start, loop.end - 0.001)).sample
  if (!last) return null
  let i = last.index
  while (i > 0 && samples[i].beat !== 1) i-- // 退回这一小节的第 1 拍
  return samples[i]
}

/** 循环区间的**起点**那一拍（回跳的落点） */
function loopStartSample(loop) {
  return timeline.value.timeToPos(loop.start).sample || null
}

/**
 * 切手势模式（总览胶囊里那颗「抓手 / 指针」）。
 *
 * · **鼠标与触屏同一个判据**（用户要求「使用鼠标时，抓手模式下能够拖动谱面」）：
 *   · 指针 = 按下就接管，跟手；谱面这一层不滚页（`touch-action: none`）——
 *     非编辑按下拖 = 框选循环，编辑按下拖 = 划行 / 放线。
 *   · 抓手（默认）= 谱面这一层**完全不接管拖动**：触屏滑动就是原生滚谱
 *     （双指缩放已全站禁用，见 `docs/ui.md` §18.46）、鼠标拖动由 `PdfViewer` 拖谱面；
 *     我们只认「点一下」：非编辑点小节跳转、编辑点标记 / 删行。
 *     **要框选 / 划行 / 放线，就切到指针模式**（鼠标也一样）。
 *   · **编辑模式一样吃这套规则**（用户要求「这个选项对编辑模式也生效」）。
 *   完整规则与实现见 `ScorePage.vue` 头部的「手势策略」（那边是唯一的实现处）。
 * · 切到 `'pan'` 时**顺手清掉框选并停止循环**：这是一条顺手的便利（抓手模式下点一下谱面
 *   仍然能取消框选，不是非清不可）—— 切到「浏览」却还留着一段在循环的区间，会让人以为没切成功。
 *   **只做这一件事**：`editMode` 与 `tool` 有各自的入口（右上「编辑 / 完成」、四种标记工具），
 *   这颗钮不该隔着半个屏幕去改它们 —— 那样这个按钮就成了隐形的编辑模式开关。
 * · **既不进 meta、也不写 localStorage** —— 它是当下的操作方式，不是乐谱数据；
 *   而且默认值恒为 `'pan'`（`open()` / `close()` 都归位），这就是「每次打开谱面都默认抓手」。
 * · 幂等：同一个模式再点一次什么都不做（尤其是别去动正在播的循环）。
 */
export function setMode(mode) {
  const next = mode === 'pointer' ? 'pointer' : 'pan'
  if (player.mode === next) return
  player.mode = next
  if (next === 'pan' && player.selection) clearSelection()
}

export function setSelection(from, to) {
  if (!from || !to) return
  const a = Math.min(from, to)
  const b = Math.max(from, to)
  player.selection = { from: a, to: b }
  const tl = timeline.value
  const t0 = tl.posToTime(a, player.currentTime)
  const t1 = tl.posToTime(b, t0) + tl.measureDuration(b, t0)
  const region = { start: t0, end: Math.max(t1, t0 + 0.2) }
  if (!canPlay.value) return
  player.loopOn = true
  clock.setLoop(region)
  metronome.reset()
  if (loopCountInOn()) startPlayback({ from: region.start, cue: true, landing: a })
  else {
    seek(region.start)
    playFrom()
    // 框选起播这一刻 `player.playing` 还没被置真（`engine.play()` / `clock.play()` 都是异步后才发事件），
    // 末尾那条 watch 会被「不在播放也不在预备拍」那一句挡掉 —— 所以这里补一手：
    // **单小节循环**的点就是本小节，第一遍不补就一次都不闪。
    // （打了预备拍时 `armLoopLandingIfLastMeasure` 自己会跳过：那种情况只在预备拍里闪。）
    armLoopLandingIfLastMeasure()
  }
}

export function clearSelection() {
  player.selection = null
  player.loopOn = false
  clock.setLoop(null)
}

export function toggleMetronome() {
  setMetronomeVolume(player.metronomeVolume > 0 ? 0 : 0.6)
}

/**
 * 节拍器音量即开关：0 关闭（**只管声音，不管播放**）。
 * 归零时走带继续、只是没有点击声 —— 用户明确要「没声音也能播」，
 * 所以这里不再顺手把静音播放停掉（旧行为会让播放键看起来像被音量锁住了）。
 */
export function setMetronomeVolume(v) {
  player.metronomeVolume = Math.max(0, Math.min(1, Number(v) || 0))
  metronome.setVolume(player.metronomeVolume)
  // **只有在走带里才动调度器**（与 `open()` 同一个道理）：暂停着把音量拉起来只是「下次播放会响」，
  // 不能当场起调度器 —— 那样第一个 `_tick()` 会立刻补响当前这一拍（区间是闭区间，见 `open()` 的注释）。
  if (player.metronomeVolume > 0) {
    if (player.playing) startMetronome()
  } else {
    metronome.stop()
  }
  savePrefs()
}

export function metronomeOn() {
  return player.metronomeVolume > 0
}

/**
 * 弹一条**带按钮的 toast**（第三类）：正文 + 一颗「撤销」按钮。
 * 删除（「删除 xN」）走的就是这一条（挂在 `undoSlot` 上）。
 *
 *  · **累加在同一条上**：计数 +1、重发一次（`count` 变了 → 重发的正文也不同），
 *    `UNDO_MS` 重新计时 —— 用户看到的是同一条提示里的数字在涨，而不是屏幕上堆一串「删除 x1」。
 *  · **每删一项记一条「删除记录」**（`slot.notice.steps`，记的那一处是 `noteRemoval()`）：
 *    这样点一次「撤销」还回来的正好是最后一次删掉的那几项（见 `undoLastDeletions()`），而不是整串。
 *    记的是**那几项本身**、不是整份 meta 的快照 —— 见本文件「撤销」那一节的说明。
 *  · **倒计时那圈环由 `ProgressRing` 画**（不在本文件或 `PlayerView` 逐帧算）：
 *    它按「剩余时间 / 总时间」这个比例给弧长，与第二类任务通知共用同一个组件。
 *  · 6 秒到点自己收掉，那叠记录跟着丢，之后这条路就断了（**没有别的撤销入口**）。
 */
const UNDO_MS = 6000

/**
 * 写一条撤销通知：正文 `text(count)` + 一颗「撤销」按钮。
 * `action` 是按钮的**动作名**（`App.vue` 靠它派发到对应的撤销函数）。
 *
 * **两个入口，靠 `bump` 分开**：
 *  · 新删一下（`notifyUndo()`）→ 计数 +1；
 *  · 撤销一步之后重写正文（`resendUndoToast()`）→ 计数不动（撤销那边已经 -1 过了）。
 * 记录**不在这里记** —— 那是 `noteRemoval()` 的事（它必须在 meta 被改动**之前**调，
 * 而这里是在删除函数末尾调的，那时候东西已经没了）。
 */
function notifyUndoToast(slot, text, key, action, bump = true) {
  const cur = slot.notice
  const count = bump ? (cur ? cur.count + 1 : 1) : cur?.count || 0
  const x = actionToast(text(count), action, t('common.undo'), {
    key,
    ms: UNDO_MS,
    total: UNDO_MS,
  })
  slot.notice = { count, steps: cur?.steps || [], id: x.id }
  clearTimeout(slot.timer)
  slot.timer = setTimeout(() => {
    slot.notice = null
  }, UNDO_MS)
}

function notifyUndo() {
  notifyUndoToast(undoSlot, (n) => t('store.deleteCount', { n }), 'undo', 'undo')
}

function startMetronome() {
  metronome.reset()
  metronome.start(
    (t0, t1) => {
      const loop = player.loopOn ? loopRegion.value : null
      let hi = t1
      if (loop && loop.end < hi) hi = loop.end
      return timeline.value.beatsBetween(t0, hi)
    },
    clock
  )
}

/** 循环回到起点前先停住声源（无音频时只有节拍器） */
function stopSources() {
  metronome.stop()
  if (player.hasAudio) engine.pause()
  else clock.pause()
}

/**
 * 循环回到起点：可以按设置先打一小节预备拍。
 *
 * ⚠️ **次序与跳转那几条路一致：先数一小节，数完才跳回循环开始处**（用户明确要求
 * 「所有带预备拍的地方都是数完预备拍才跳，包括循环」）：倒数这一小节里播放头**还停在循环末尾**，
 * 只有落点（循环开始处）那串「跳转前」在闪；数完才 `seek(region.start)` → 闪「跳转后」→ 接着播。
 *
 * 预备拍里把**落点点亮、每拍闪一下** —— 传进去的是**这一遍的那条记录**（`pos.sample`，
 * 由 `timeToPos(region.start)` 取，不是小节号）：反复里的落点有好几条记录，按小节号取会取到
 * 第一遍那条，下标对不上。
 *
 * ⚠️ **两条路都必须由本函数接管（都返回 `true`）**：以前「没开预备拍」那一支直接 `return false`，
 * 让时钟 / `<audio>` 自己去 seek —— 它们只认 ≥ 0，**弱起区间的起点是负数会被夹到 0**，
 * 现象就是用户报告的「循环段跳回第一段时直接从音频位置开始，而不是从头」。
 * 回跳一律走 `seek()` + `playFrom()`：负数会重新起弱起前导（见 `startLead`），节拍器也会 `reset()`。
 *
 * ⚠️ **闪烁也在这儿点**（主要是「跳转后」）：循环回跳这条路上播放头**多半不换小节号**
 * （单小节循环更是完全不换），末尾那条 watch 跑不起来，不能指望它：
 *   · 「跳转后」点在循环起点上 —— 播放头当刻就跳过去了（「跳转后 = 播放头跳转那一刻」，
 *     见 `flashAfterJump` 的规则）；
 *   · 跳完再 `armLoopLandingIfLastMeasure()` 补一手 —— **单小节循环**这一遍进来就是最后一小节，
 *     顺手把**下一遍的「跳转前」**点亮（多小节循环不用管：watch 会在走进最后一小节时点亮）。
 *     不补的话单小节循环从第二遍起就再也不闪了（watch 只在换小节时跑，单小节循环不换小节）。
 */
function handleLoopEnd(region) {
  // 传进来的是**引擎手里那一份**循环区间（权威，见 `activeLoop`），不要再用 `loopRegion` 重算
  const loop = region
  const startSample = loopStartSample(loop)
  if (!loopCountInOn()) {
    // 不带预备拍：立刻回跳。`suppressRewind` 压住回跳那次内部 pause（弱起起点会让 `<audio>` 先停住），
    // 别让它触发「回退到小节开头」——那一下会按 `posToTime(no)` 取「第一遍」的落点，反复里就跳错遍了。
    const keep = suppressRewind
    suppressRewind = true
    seek(region.start)
    flashAfterJump(startSample?.no, startSample)
    player.jumpFlash = null
    playFrom()
    armLoopLandingIfLastMeasure()
    suppressRewind = keep
    return true
  }
  const pos = timeline.value.timeToPos(region.start)
  // 同步停住声源（**不能等 await**）：`_startTicker` 下一帧还会再看一次循环末尾，
  // 那时元素要是还在播就会再叫一次 onLoopEnd —— 那就是两条倒数叠在一起了
  suppressRewind = true
  stopSources()
  /**
   * ⚠️ **`cueing` 与播放头必须在这里「同步」钉住，不许挂在任何 await / `.then()` 后面。**
   *
   * 循环末尾那一帧的读数**本来就是越过 `loop.end` 的**（判定线是 `end - 0.02`，再加一帧步进），
   * 而 `engine.on('time')` 那道闸（`if (player.cueing) return`）只在 `cueing` 置真之后才拦得住。
   * 中间只要隔一个异步微任务（例如 `metronome.resume().then(...)`），那一帧的越界读数就会被
   * 照单全收、把播放头写进循环段后面那一小节 —— 现象就是「播放头跑到循环段后一个小节开头
   * 才停住、响预备拍」。**先取位、再置 `cueing`、最后同步把倒数排上**，这三步之间不许有 await。
   *
   * 取位是 `region.end` **往回退 1ms**（与 `loopLastStart` 同一个 epsilon）：`timeToPos` 判的是
   * `samples[i].time <= time`，停在 `region.end` 上会读到最后一小节的**边界拍**（`beat = 拍数 + 1`），
   * 退 1ms 才稳稳落在循环段最后一小节的最后一拍上 —— 也就是「停在最后一小节段末尾」。
   *
   * `startCountIn` 里的落点提示 / 拍数只认传进去的 `pos.sample`（循环起点），与这里的播放头无关。
   */
  player.cueing = true
  player.currentTime = Math.max(region.start, region.end - 0.001)
  startCountIn(pos.sample, () => {
    suppressRewind = false
    // 数完：跳回循环开始处 + 同时闪「跳转后」，然后接着播（两句之间不许有 await）
    seek(region.start)
    flashAfterJump(pos.no, pos.sample)
    playFrom()
    armLoopLandingIfLastMeasure() // 单小节循环：下一遍的「跳转前」当场续上（见函数注释）
  })
  return true
}

engine.on('play', () => (player.playing = true))
engine.on('pause', () => {
  /**
   * **预备拍开头那次「停」是上层刻意压住的**（`startPlayback` / `handleLoopEnd` 都先置
   * `suppressRewind` 再 `stopSources`）：那时不该退出播放态 ——
   * 预备拍**算播放中**（用户明确要求「预备拍的时候也视作播放中，播放按钮要显示成暂停按钮供用户暂停」），
   * 而这次暂停只是「把音乐停下来数拍子」，播放键必须还是「暂停」、点它才能取消倒数。
   * 真暂停（`pausePlayback`）走的是另一条路：它先把 `suppressRewind` 置假再 pause。
   */
  if (suppressRewind) return
  const wasPlaying = player.playing
  player.playing = false
  // 暂停（含播完）后自动回到当前小节开头
  if (wasPlaying && !engine.ended) rewindToMeasureStart()
})
engine.on('time', (t) => {
  // 弱起前导期间（含前导里暂停）位置归前导循环管：`<audio>` 这时钉在 0 秒，
  // 它每帧报的 0 会把负数位置顶掉，所以这段时间一律忽略
  if (clock.leadPos != null) return
  /**
   * **预备拍倒数期间位置钉在落点上，音频报什么都不算**（踩过的坑）：
   * 真机 `<audio>` 的 `currentTime = x` 要等媒体管线落定，落定之前那个 rAF ticker 每帧读到的还是
   * **旧位置** —— 于是「跳转 → 倒数开始」的头几十毫秒里播放头会被拉回原处、再跳回落点，
   * `currentPos.no` 就这么变了两下。除了谱面上的当前小节会抖一下，更要命的是：
   * 播放头**又落回落点那一小节**会让下面那条 watch 走「落地了」那一支，
   * 把倒数刚点亮的「跳转前」当场换成「跳转后」—— 现象就是
   * **「跳转后闪烁发生在点击时，而不是发生在预备拍结束后」**（用户报告，已复现）。
   * 倒数结束（`cueing` 置假）后 ticker 照旧接管位置。
   */
  if (player.cueing) return
  player.currentTime = t
})
engine.on('error', () => errorToast(t('store.audioPlayError')))
/**
 * 试听那只 `<audio>` 的位置（`engine.previewEl`）——**只喂这一屏的播放头**，
 * 与 `player.currentTime`（谱面播放位置）是两条独立的路（见 `startPreview` 的注释）。
 */
engine.on('previewTime', (t) => {
  if (player.previewing) player.previewTime = t
})
engine.onLoopEnd = handleLoopEnd

// 无音频的播放：没有 <audio> 的 timeupdate，位置只能每帧自己推
let uiRaf = 0
clock.on('play', () => {
  player.playing = true
  if (uiRaf) return
  const tick = () => {
    uiRaf = requestAnimationFrame(tick)
    clock.tick()
  }
  uiRaf = requestAnimationFrame(tick)
})
clock.on('pause', () => {
  // 预备拍开头的「停」是上层刻意压住的，这时不该退出播放态
  if (suppressRewind) return
  player.playing = false
  if (uiRaf) cancelAnimationFrame(uiRaf)
  uiRaf = 0
})
clock.on('time', (t) => {
  player.currentTime = t
})
clock.onLoopEnd = handleLoopEnd
clock.resync()

// 自动翻页：当前小节所在页码变化时通知视图滚动
watch(
  () => currentPos.value.no,
  (no, prev) => {
    if (!player.autoTurn) return
    if (!no) return
    const m = structure.value.measures[no - 1]
    if (!m) return
    const prevM = prev ? structure.value.measures[prev - 1] : null
    if (!prevM || m.page !== prevM.page) player.currentPage = m.page + 1
  }
)

// 无音频时「走完」的判据不是采样表末尾（那时最后一个音已经发完了），而是时间轴自己的总长：
// 界面上会显示到 100%，也比最后一拍的余音多留一点点
watch(
  () => timeline.value.duration,
  (d) => {
    clock.duration = d
  },
  { immediate: true }
)

// 走到乐谱末尾就停下并回到当前小节开头；有音频时这条由 <audio> 的 ended 承担
watch(
  () => player.currentTime,
  (t) => {
    if (player.hasAudio || player.loopOn || metronome.countInActive || suppressRewind) return
    if (clock.ended) engine.pause()
    else if (t > 0 && t >= clock.duration) clock.pause()
  }
)

/**
 * 切工具 / 退出编辑模式 → **丢掉那个还没成对的反复起点**（用户明确要求：这两种情况都要把它删了）。
 * 它本来就不在 meta 里，所以只要把会话状态清掉 —— 谱面上那条「反复开始」跟着一起消失。
 */
watch(
  () => [player.tool, player.editMode],
  () => {
    if (player.pendingRepeatBarId) player.pendingRepeatBarId = null
  }
)

/**
 * **进编辑模式就自动停止播放**（用户明确要求）。只停不归位：播放位置留着，
 * 退出编辑再按播放就从原地继续（与「暂停」同一套语义）。
 * 挂在这里而不是各个按钮上 —— `player.editMode` 有三个入口（工具栏、导入 JSON、打开未完成编辑的乐谱时自动进），
 * 挂在入口上迟早漏一个。
 */
watch(
  () => player.editMode,
  (on) => {
    if (on && (player.playing || metronome.countInActive)) pausePlayback()
  }
)

/**
 * **库里改过的记录要立刻反映到打开着的这一张上**。
 *
 * `player.record` 是 `open()` 当时从库里读回来的那一份副本，而 `updateScoreMeta()` 改的是
 * **另一份**（`db.getScore()` 每次给的都是新的）—— 不接这根线，改标题 / 标签 / 封面之后
 * 页面标题与别处读 `player.record` 的地方都会停在旧值上。
 *
 * **只在改的就是正开着的那一张时接**：改的是库里别的谱，`player.record` 一个字都不该动。
 * 传进来的 `rec` 全是记录级字段（`title` / `meta` / `pageCount` / `hasAudio`…），整份换掉是安全的。
 */
onRecordUpdated((rec) => {
  if (rec?.id && rec.id === player.id) player.record = rec
})

/**
 * **两种跳跃闪烁**（用户明确区分，别混成一个）—— 各占一个槽位，可以同时出现（见 `player.jumpFlash`）：
 *   · **跳转前闪烁** `player.jumpFlash` —— 跳跃**发生之前**那一整小节的每拍一下（`ms` 递一拍、
 *     `repeats` 递这一小节的拍数）；**预备拍倒数期间也用它**点住落点。
 *   · **跳转后闪烁** `player.jumpAfter` —— 落点上**闪一下就完**（`ms` 递一拍左右，一次渐变）。
 *     **手动跳转在点击那一刻就闪**（`startPlayback`），自动跳在**落地那一拍**闪（下面那个 watch）。
 *
 * ⚠️ **提示记的是「采样下标」，不是小节号**（踩过一次坑）：往回跳时落点的小节号**比当前小节号小**
 * （8 小节处跳回第 1 小节），拿小节号判「到了没有」根本分不清「还在前面」和「已经跳过去了」，
 * 一句 `no >= hint.no` 就把刚点亮的提示当场清掉 —— 表现就是**一点都不闪**。
 * 采样下标在展开后的顺序里是**单调递增**的。
 *
 * `tick` 每次自增是为了让 CSS 动画**重新开始**（同一个落点连着跳两次也要从头闪）。
 */
let lastFlashTick = 0
/** 「跳转前闪烁」：每拍一下、重复一整个小节 */
function setBeforeFlash(no, index, ms, repeats) {
  player.jumpFlash = { no, index, tick: ++lastFlashTick, ms, repeats }
}
/** 「跳转后闪烁」：落点上闪一下就完（重复次数由 CSS 的 `.is-after` 那一支定死为 1） */
function setAfterFlash(no, index, ms) {
  player.jumpAfter = { no, index, tick: ++lastFlashTick, ms }
}

/**
 * 落点那一小节在时间轴上**是哪一条记录**（反复会让同一个小节出现好几遍）：
 * 优先取**播放头现在所在的那一条**。
 *
 * `flashAfterJump` 调它的时机永远在**播放头已经跳到落点之后**（`seek` 之后当刻，见那边注释），
 * 所以取到的必然就是**这一遍**的那条。一律取第一遍（`samples.find(no === measureNo && beat === 1)`）
 * 的话，反复里第二遍的落点会比对到第一遍那条记录上去 —— 谱面上看着没事（闪烁是按小节号画的），
 * 但**下标对不上**：那条 watch 认不出「就是这一条」，于是会当成「已经走过去了」把闪烁清掉。
 * 播放头不在落点上（越界 / 还没有小节）时才退回第一遍那条（找不到就给 -1 = 没有可比的下标）。
 */
function landingSample(measureNo) {
  const cur = currentPos.value.sample
  if (cur && cur.no === measureNo) return cur
  return timeline.value.samples.find((s) => s.no === measureNo && s.beat === 1) || null
}

/**
 * 跳转后闪烁：**播放头一跳过去就闪**。
 *
 * ⚠️ **判据是「播放头跳转那一刻」，不是「真正开始播放那一刻」，更不是「用户点下去那一刻」**
 * （用户定的规则）：所有带预备拍的地方都是**数完预备拍才跳**（见 `startPlayback` / `handleLoopEnd`），
 * 所以这一下自然落在**倒数演完之后**；没打预备拍时就是 `seek` 之后当刻（`seekToPosition`）；
 * 自动跳是落地那一拍由末尾那条 watch 点亮。**别把它挂到 `playFrom()` 上，也别提前到点击那一刻。**
 *
 * ⚠️ 只拿 `measureNo` 现查时间轴（不看调用时播放头在哪）：几种时机下都只要「在第几小节」这一个信息。
 * 查出来的那条记录同时也是**下标**的来源（见 `landingSample`），落地那条 watch 靠它判断
 * 「是落在这一条上了」还是「已经走过去了」。
 */
function flashAfterJump(measureNo, sample = null) {
  if (!measureNo) return
  const beat = sample || landingSample(measureNo)
  // 速度与拍数走 `countInTiming`：它与预备拍**同源**（两处各算一份迟早快慢不一）。
  // 落点不在时间轴上（越界 / 还没有小节）时退回段落速度，下标给 -1（= 没有可比的下标）。
  const timing = countInTiming(beat || tempoAt(timeline.value.segments, measureNo))
  setAfterFlash(measureNo, beat?.index ?? -1, timing.beatMs)
}

/**
 * **「跳转前闪烁」的时长 = 它所在的那一小节**（用户明确要求：**只闪一个小节的时长**）。
 * 它讲的是「本小节走完就要跳了」，所以拍数 / 拍长按**当前正在播的这一小节**算：
 * 拿落点那一小节算的话，两边拍号 / 速度不同就会闪多或闪少（一多就跨到下一小节去了）。
 * 一小节的时长走 `measureDuration`（逐拍累加，与时间轴同一支算式），除回每小节拍数就是每下的时长；
 * 它给的是**时间轴毫秒**，还要**除以倍速**（`player.rate`）才是真实每下的时长 ——
 * 这道预闪是**跟着音乐播的**，倍速下这一小节本来就走这么快。
 * `beatMs` 仍保 160ms 下限（夹在除完之后）：太快就闪不成「一下一下」，这条与预备拍那边一致。
 */
function beforeJumpTiming(measureSample) {
  const beats = Math.max(1, Math.round(measureSample?.beatsPerBar || 4))
  const dur = measureSample ? timeline.value.measureDuration(measureSample.no, player.currentTime) : 0
  const fromMeasure = Number.isFinite(dur) && dur > 0 ? Math.round(((dur / beats) * 1000) / (player.rate || 1)) : 0
  return { beats, beatMs: Math.max(160, fromMeasure || countInTiming(measureSample).beatMs) }
}

/**
 * **循环回跳的「跳转前闪烁」**：把落点（循环起点）点亮、每拍一下、**时长就是当前这一小节**。
 *
 * 用户口径：**只要能预见要发生跳转，就有「跳转前闪烁」** —— 所以循环段这里
 * **只要这次回跳不打预备拍**就要闪（打预备拍的那条路由 `startCountIn` 点同一个落点，
 * 见 `armLoopLandingIfLastMeasure` 的开关）。
 * `force = true`：同一个落点连着跳两遍也要**从头闪**（去重会把第二遍挡掉）。
 */
function flashLoopLanding(loop) {
  const sample = loopStartSample(loop)
  if (sample) flashBeforeJump(sample, true, beforeJumpTiming(currentPos.value.sample))
}

/**
 * 「**本小节末尾就要回跳了**」→ 点亮循环落点（**循环优先**，见 `armLoopLandingIfLastMeasure`）。
 * 返回有没有点。
 *
 * ⚠️ **这次回跳要打预备拍的话，这里一律不点**（用户明确要求）：预备拍自己会点落点、
 * 而且它就在**下一小节**的位置上闪 —— 这边再预闪一小节，加起来就是**闪两小节**。
 * 「只在预备拍闪」是那种情况下唯一正确的样子。
 *
 * 为什么要有这么一支：循环回跳**没有别的事件可挂**（播放头多半不换小节号，单小节循环根本不换），
 * 只能靠「走进最后一小节」这个时机预报。三处调用：
 *   · 末尾那条 watch（播放中走进最后一小节）—— 多小节循环靠它；
 *   · `setSelection` 框选起播那一刻 —— 那时 `player.playing` 还没被置真，watch 会被
 *     「不在播放也不在预备拍」那一句挡掉，**单小节循环的第一遍就一次都不闪**；
 *   · `handleLoopEnd` 跳完那一下 —— 单小节循环的下一遍（这一遍进来就是最后一小节）。
 *
 * 判据用**本小节的起始拍**（`beat === 1` 那一条）比，不用「当前这一拍」：
 * 播放头可能落在小节中间（掉帧时尤其明显），拿当前拍比会漏判。
 */
function armLoopLandingIfLastMeasure() {
  const loop = loopingToLastMeasure()
  if (!loop) return false
  // 打了预备拍：闪烁归预备拍，这里不点 —— 但**照样返回真**，让调用方知道
  // 「本小节末尾要回跳」，别再拿反复那一跳去闪（那一跳根本不会发生）。
  if (!loopCountInOn()) flashLoopLanding(loop)
  return true
}

/**
 * 本小节是不是**循环区间的最后一小节**（回跳就发生在它末尾）？是就返回那段区间。
 * 与「要不要闪」分开：**循环优先于反复记号**这件事（本小节末尾的跳是循环回跳，不是反复那一跳）
 * 与「谁负责闪」（预备拍 or 预闪）是两件事 —— 打了预备拍时前者照样成立，只是闪的人换成预备拍。
 */
function loopingToLastMeasure() {
  const loop = activeLoop()
  if (!loop) return null
  const sample = currentPos.value.sample
  const lastStart = loopLastStart(loop)
  if (!sample || !lastStart) return null
  const samples = timeline.value.samples
  let cur = sample.index
  while (cur > 0 && samples[cur].beat !== 1) cur--
  return lastStart.index === cur ? loop : null
}

/**
 * 跳转前闪烁（自动跳用）：把下一小节的落点点亮，**每拍闪一次、重复一整个小节**
 * （用户要求：不是一小节一次，而是跟着拍子一下一下地闪）。
 * 所以动画周期递的是**一拍**（`beatMs`），重复次数递的是**这一小节的拍数**（`repeats`）。
 *
 * 节奏走 `countInTiming`（与预备拍同源）；`timing` 传进来就直接用（预备拍那条路要把
 * 「预备拍打的拍子」与「落点闪的节奏」钉成同一份，见 `startCountIn`）。
 * `force` = 同一个落点也**换一个新 `tick`**（让 CSS 动画从头再来）。
 * watch 那条路不需要（它只在进小节时点一次）；**预备拍的倒数需要** —— 同一个落点连着打两次预备拍
 * （单小节循环回跳、反复点同一个落点）不换 tick 的话第二次一点都不闪。
 */
function flashBeforeJump(sample, force = false, timing = null) {
  const t = timing || countInTiming(sample)
  const cur = player.jumpFlash
  if (!force && cur && cur.no === sample.no && cur.index === sample.index && cur.ms === t.beatMs && cur.repeats === t.beats) return
  setBeforeFlash(sample.no, sample.index, t.beatMs, t.beats)
}

/**
 * **预备拍里的落点闪烁**：倒数这几拍把落点那一小节点亮、每拍闪一下 —— 与自动跳的
 * 「跳转前闪烁」同一套节奏，只是**每次强制重播**（见 `flashBeforeJump` 的 `force`）。
 * `sample` = 落点那一拍（`startCountIn` 从调用方拿到的**这一遍**的记录），
 * `timing` = 与预备拍**同一份**拍数 / 拍长（`countInTiming`）—— 预备拍打几下，落点就闪几下。
 */
function flashCountInLanding(sample, timing) {
  if (!sample) return
  flashBeforeJump(sample, true, timing)
}

watch(
  // 盯 `currentPos` 而不是 `currentTime`：要判的是「走到哪一小节了」，顺带省掉自己再算一遍
  () => currentPos.value.no,
  () => {
    const sample = currentPos.value.sample
    if (!sample) return

    /**
     * **预备拍倒数期间：落点上那两道提示归预备拍管，这条 watch 一律不碰**（`player.cueing`）。
     *
     * 倒数这几拍落点本来就该一直闪（`startCountIn` 点亮的「跳转前」，每拍一下），而「跳转后」
     * 在**点击那一刻**就已经闪过了（手动跳转，见 `startPlayback`）—— 这条 watch 的活儿是**自动跳**：
     * 跳之前一小节点亮、落地那一拍换成「跳转后」。
     * 不挡的话：播放头在倒数里再落回落点（真机 `<audio>` 的异步 seek 会把位置先拉回旧处再落回，
     * 见 `engine.on('time')` 那条注释），这一支就会把倒数那串闪烁当场换成「跳转后」——
     * **倒数剩下的几拍就不闪了**（已复现）。
     * 倒数结束那一刻 `cueing` 已经置假，所以循环回跳落地那次 `seek(region.start)` 照旧走下面
     * 「落地那一拍」那一支。
     */
    if (player.cueing) return

    const passed = sample.index
    const hint = player.jumpFlash

    // 「跳转后」收工：走过落点之后它就没意义了（动画本身早就停在透明上，这里只是别留状态）
    if (player.jumpAfter && player.jumpAfter.index >= 0 && player.jumpAfter.index < passed) player.jumpAfter = null

    /**
     * 落点上要做的两件事，**顺序不能换**：
     *   1. **落地那一拍**（`hint.index === passed`）：跳转前闪烁演完 → **换成跳转后闪烁**，
     *      在落点上再闪一下 —— 用户明确要求「反复记号的跳转，跳转后也要闪」（**自动跳**那一路；
     *      手动跳转的「跳转后」在点击那一刻就闪过了，见 `startPlayback`）；
     *   2. **走过落点之后**（`hint.index < passed`）：这次跳跃的提示彻底收工。
     *
     * ⚠️ 判据只能是「下标相等 / 大于」，**不能靠 `landed` 现推**：手动跳转是「先 seek、再点亮」，
     * watch 随后一跑就发现播放头已经在落点上了，现推的话会把刚点亮的提示当场清掉
     * （现象是手动跳转一点都不闪，这个坑踩过两次）。
     */
    if (hint && hint.index < passed) {
      player.jumpFlash = null
      return
    }
    if (hint && hint.index === passed) {
      const landing = hint.no
      player.jumpFlash = null
      flashAfterJump(landing)
      // 落地的这一小节**如果同时就是循环的最后一小节**（单小节循环），这一遍马上又要回跳：
      // 「跳转前」刚让位给「跳转后」，这里立刻补回来 —— 否则这一遍整小节都不闪（第一遍尤其明显）。
      armLoopLandingIfLastMeasure()
      return
    }
    // 不在播放也不在预备拍：不该点新的提示（**闪烁只在播放 / 预备拍里出现**，暂停 / 停止不留提示）
    if (!player.playing && !metronome.countInActive) return
    if (hint) return
    /**
     * **跳转前闪烁 = 「能预见要跳」就闪，而且只闪一个小节的时长**（用户口径）：本小节末尾就是
     * 要跳的那一刻，于是**本小节**整小节在闪 —— 所以节奏按**当前这一小节**算（`beforeJumpTiming`），
     * 不是按落点那一小节算（那样两边拍号 / 速度不同就会闪多，一多就跨到下一小节去了）。
     * 两种情况，**循环优先**：
     *   1. **循环区间在本小节末尾回跳**（`loopLastStart(loop).index === 本小节起始拍`）→ 点**循环起点**。
     *      ⚠️ 必须排在反复前面：区间末端压在反复结束线上时，**实际发生的是循环回跳**（循环优先于反复记号），
     *      闪烁就得点循环起点，不能点反复那个（可能根本走不到的）落点 —— 用户报过「闪的位置不对」。
     *      ⚠️ **这次回跳要打循环段预备拍的话，这一支整个不点亮**（`armLoopLandingIfLastMeasure` 里的开关）：
     *      倒数那一小节本来就点着落点，这边再预闪一小节就是**闪两小节**（用户报过）。
     *   2. 否则看时间轴：**下一小节的起点是「跳过来的」那一小节**（`jumpTo`）→ 点它（反复 / 房子跳转）。
     *      这一支与预备拍无关（自动跳不打预备拍），照旧闪本小节。
     *
     * ⚠️ 别改成「下一拍是不是落点」：这个 watch 只在**小节号变化**时触发（依赖就是 `currentPos.no`），
     * 跳到落点那一刻它才跑 —— 等它跑的时候播放头已经站在落点上了，「下一拍」永远问不出答案（踩过这个坑）。
     * 而「下一小节的起点是落点」正好等价于「**跳跃就发生在本小节末尾**」，于是整小节都在闪。
     */
    if (armLoopLandingIfLastMeasure()) return
    const samples = timeline.value.samples
    let nextStart = null
    for (let i = sample.index + 1; i < samples.length; i++) {
      if (samples[i].beat === 1) {
        nextStart = samples[i]
        break
      }
    }
    if (nextStart?.jumpTo) flashBeforeJump(nextStart, false, beforeJumpTiming(sample))
  }
)

export function setCurrentPageFromVisible(pageIndex) {
  player.visiblePage = pageIndex + 1
}

/* ------------------------------- 文件替换 ------------------------------- */

function syncPageCount() {
  player.pageCount = player.meta.pages?.length || renderer.value?.numPages || 0
}

export async function importAudio(file) {
  if (!player.id || !file) return
  // 无音频时元素只当时钟用（见 applyOutputPrefs）：换曲子不必重开，位置照旧按时间轴走
  const silent = !player.hasAudio
  const prevBytes = (audioBlob?.size || 0) + (peaksRef.value?.byteLength || 0)
  audioBlob = file
  await db.putFile(player.id, 'audio', file)
  // 乐谱库那一行灰字与「按占用大小」排序读的是缓存：音频换了、波形马上要重算，先按已知的增量挪一下
  touchSize(player.id, file.size - prevBytes)
  player.meta.audio = {
    ...player.meta.audio,
    name: file.name,
    type: file.type || '',
    duration: null,
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = URL.createObjectURL(file)
  player.hasAudio = true
  player.audioName = file.name
  if (!silent) engine.load(audioUrl, 0)
  applyOutputPrefs()
  peaksRef.value = null
  await ensurePeaks(true)
  const dur = engine.duration
  if (dur) player.meta.audio.duration = dur
  markDirty()
  toast(t('store.audioImported', { name: file.name }))
}

export async function importPdf(file) {
  if (!player.id || !file) return
  const { PdfRenderer: R, pageSizes: sizes } = await import('../domain/pdf.js')
  const r = await R.from(file)
  try {
    const list = await sizes(r.doc)
    player.meta.pages = list.map((s, i) => {
      const prev = player.meta.pages[i]
      return prev ? { ...prev, width: s.width, height: s.height } : { width: s.width, height: s.height, systems: [] }
    })
  } finally {
    r.destroy()
  }
  await db.putFile(player.id, 'pdf', file)
  // 缓存里那一份的占用跟着变大（PDF 换掉就是这份文件里最大的一块）
  touchSize(player.id, file.size - (pdfBlob?.size || 0))
  renderer.value?.destroy()
  renderer.value = await PdfRenderer.from(file)
  pdfBlob = file
  player.hasPdf = true
  player.pdfName = file.name
  syncPageCount()
  markDirty()
  toast(t('store.pdfImported', { name: file.name }))
}

/**
 * 用一份 JSON（score.json）覆盖当前乐谱的标记 / 配置。
 * 页面尺寸仍以当前 PDF 为准：JSON 里的页尺寸可能来自别的 PDF，照搬会让标记错位。
 */
export async function applyMetaJson(file) {
  if (!player.id || !file) return null
  let raw
  try {
    raw = JSON.parse(await file.text())
  } catch {
    throw new Error(t('domain.error.badJson'))
  }
  const meta = createMeta(raw)
  if (renderer.value) {
    try {
      const { pageSizes } = await import('../domain/pdf.js')
      syncPages(meta, await pageSizes(renderer.value.doc))
    } catch {}
  }
  player.meta = meta
  player.selection = null
  player.drawer = null
  player.activeSegmentId = null
  player.pendingRepeatBarId = null
  markDirty()
  toast(t('store.jsonApplied'))
  return meta
}

export async function removeAudio() {
  if (!player.id) return
  const wasPlaying = player.playing
  engine.unload()
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = ''
  audioBlob = null
  peaksRef.value = null
  player.hasAudio = false
  player.audioName = ''
  player.meta.audio = { ...player.meta.audio, name: '', type: '', duration: null, peaksPerSecond: null }
  await db.deleteFile(player.id, 'audio')
  await db.deleteFile(player.id, 'peaks')
  touchSize(player.id, null) // 音频与波形一起没了，缓存里那一份的占用作废，等下一次量
  // 挪到无音频的时钟上继续（音量、倍速、节拍器都是现成的），没在播就原地停着。
  applyOutputPrefs()
  // 走 `seek()` 而不是直接 `clock.seek()`：负数位置（弱起前导）也必须原样留在 `leadPos` 上
  seek(player.currentTime)
  if (wasPlaying && !canPlay.value) clock.pause()
  markDirty()
}

/* ------------------------------ 时间格式化 ------------------------------ */

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatTimeMs(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
