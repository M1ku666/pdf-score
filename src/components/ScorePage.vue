<script setup>
/**
 * 单页 PDF + 标记层
 *  - 非编辑：点击小节跳转音频 / 框选小节循环播放（谱面上只画「状态」—— 当前小节的主题色浅底、
 *    框选的谱面灰底、当前小节里那条竖直进度线；编辑标记一概不画）。
 *  - 编辑  ：行、小节线、段落、反复 四种标记
 *    · **反复现在只有三种标记**（`start` / `end` / `house1` 的起点），**房子 2 不是标记** ——
 *      它是从「反复结束线往右」推出来的括号（`houseBrackets`，跨度来自 `timeline.blocks`）。
 *      反复工具点一下 = 有标记就删、没有就按落点加一个（`repeat-toggle`，**没有设置面板**）。
 *  - 本组件是**唯一做 y 轴翻转的地方**：meta 是 y-up、overlay(SVG) 是 y-down，
 *    两者差一次 `y → 页高 − y` —— 读（下面的 computed）翻一次、写（`system-add` 抛出之前）翻一次，
 *    schema / timeline / player 那一层**永远只见 y-up**，别在别处再翻。
 *    翻转后 `height = y1 − y0` 会变负数，矩形一律写 `Math.min` + `Math.abs`（`.m-active` / `.m-sel` /
 *    房子那条 `rep-dot` / `.sys-fill` 都是这个写法）；ghost 预览与命中判定（`hitSystem` / `hitMeasure`）
 *    也必须一起翻，漏一个就是「上半页能点、下半页点不中」。
 *  - **手势策略（抓手 / 指针）完整规则见下面「手势策略」那一整段**，这里只留结论：
 *    **鼠标两种模式完全一样**（按下就接管）；**只有触屏分两种** ——
 *    指针 = 按下就接管、跟手、这一层不滚页；抓手 = 这一层**完全不接管拖动**，
 *    滑动就是原生滚谱，只认「点一下」（**触屏上要框选 / 划行 / 放线就切指针模式**）。
 *    编辑模式一样吃这套规则（用户要求「这个选项对编辑模式也生效」）。
 *    接管之后：位移 ≤ TAP_SLOP（10 CSS px、框选 14）算点按，超过算拖动 ——
 *    （**光标不跟着手势模式变**：谱面全程是系统默认箭头，见下面 `cursorClass` 处的注释。）
 *    非编辑：拖动 = 框选（**框的过程中盖住的小节就当场标灰**，松手才设为循环区间）、点按 = 跳转 / 取消框选；
 *    编辑·行：拖动 = 划出这一行的高度，点按 = 删除该行；
 *      **划出来的行不能和已有的行重叠、也不能在屏幕上比一档点击尺寸更扁**
 *      （`ROW_MIN_PX` = 46px，两条判定都在 `domain/rows.js`）：
 *      不管哪一条不成立，预览带都换成**灰色**、松手整条都不加，只报一条 toast 说明是哪一种。
 *      手势已经越过 TAP_SLOP 就**不再退回「点按 = 删除」**那一路 ——
 *      用户想的是划线却把整行删了，代价太大。零高度（几乎没拖动）同样什么都不加；
 *      **唯一的例外是整条套住某个已有行**（两端都在它内部）：那是合法的「拆行」，预览带画成**红色**，
 *      松手由 `addSystem` 把那条行减成上下两条并克隆标记 —— **拆不成也算灰色**
 *      （拆出来的半行在屏幕上会不够一档点击尺寸，`containingSystem` 直接给 null，落回上面那条拒绝的路）；
 *      与已有行都不沾的是普通新建，走**主题色（蓝）**。
 *      真正落下的区间与预览带取自同一支 `rowBounds`（夹取 + 翻转只做一次），别各算一份。
 *    编辑·小节线：按下随手移动、落点预览跟着指针走，松手落线，点按仍是「命中已有的线就删、否则在该处加」
 *    （附近已有线不再重复添加，`addBar` 按 8pt 去重）；**不按键、只悬停也有一层同样的预告** ——
 *    光标落在**删除判定区**（`hitBarZone`）里时高亮那条线，落在行里其余位置时在光标处画新建落点预览。
 *    编辑·段落 / 反复：拖动时高亮将要落上去的那条小节线，松手才添加 / 打开它的设置，点按同义。
 *  - geometry 全部 PDF 点坐标(pt)，scale = 显示宽 / 页面宽
 *
 * 「编辑什么就高亮什么」：编辑模式下 hover 与标记配色都跟着当前工具（props.tool）走 ——
 *   · hover 高亮的是**该工具编辑的那一整条标记**，也就是**它所有的组成部分**：行（底面 + 上下边线）、
 *     小节线（线 + 正上方那个别针）、段落（线 + 名牌 + 牌上的字）、
 *     反复（两条线 + 旁边那两点）。只亮其中一根线会让人以为点下去只动那根线。
 *   · **行的 hover 直接按 y 命中小节（system），不经过「小节（measure）」** ——
 *     小节是由小节线推出来的（一行 n 条线 = n-1 个小节，`deriveStructure` 里 `bars.length < 2` 直接跳过），
 *     所以**还没画小节线的行一个小节都没有**，拿 measures 命中就永远命不中 → 那种行 hover 不亮。
 *     而行工具恰恰是「点一下给这行补标记」，最需要提示的就是这种空行。**容差给 0**：行的上下沿就是
 *     命中范围的边界，给容差会让相邻两行在缝里同时算命中。
 *   · **行的高亮不再单独画一层矩形**：`.lyr-systems` 本来就被 v-for 渲染出 `.sys-fill` + 两条
 *     `.sys-edge`（与这行有没有标记无关），hover 类挂在那个 `<g>` 上、给后代换色即可 ——
 *     少一层与标记重复的几何量，也就少一处 y0/y1 谁大谁小的坑。
 *   · **hover 类挂在该标记最外层的 `<g>` 上**，靠后代选择器带上自带的部件（别针另在 `.lyr-numbers`
 *     里，所以那里的子 `<g>` 要单独再绑一次）；**标记本体常态就是实色 `--accent`**
 *     （用户拍板「不 hover 的时候就得有 accent 那么重」），所以悬停的差别是**加粗 / 圆点放大**，
 *     不是换色。**标记列表点名时的闪烁高峰用 `--accent-strong`**（比常态再重一档，末帧回到 `--accent`）。
 *     压字的底（别针 / 名牌）是实色，所以字用 `--on-accent`。
 *     **行底是唯一例外**（铺满整行的一层底，走 `--accent-weak` → `--accent-mid`）。
 *   · **小节线只有一根线**（没有辅助线，见下面的样式注释）；**别针尖端还往下拉一条同粗细的杆**
 *     （`.m-no-stem`，尖端 → 行顶），把上面那个别针和行里那根线接成**一条贯通的线**：
 *     杆是别针这个标记的一部分，变灰 / 加粗 / 闪烁都跟别针一起走。
 *     **加粗只给主线**（`.bar-line` / `.m-no-stem` / `.rep-line:not(.thin)` / `.seg-line` / `.sys-edge`）：
 *     反复的第二条细线本来就是细一档，一视同仁地加粗会把那个形状提示抹平（形状是标记之间的区分手段）。
 *     另有独立的悬停竖线 `.bar-hover` 预告「点下去落在哪条线」。
 *   · **小节线工具的高亮只认删除判定区**（`hitBarZone`：行 ± `8 / scale`、线 ± `12 / scale`，与点按同判据）：
 *     区里才高亮那条线（连同它的别针 / 小节号），区外的行内位置不亮任何线、改画一层
 *     **新建落点预览**（`hoverBarGhost`，与拖动预览同一个 `.bar-ghost`）——
 *     谱面上任意位置都亮「最近的那条线」会让人以为点哪儿都是删，实际点下去往往是在旁边新建一条。
 *   · **hover 规则必须写在 `.muted` 之后**：两组选择器优先级相同（都是 0,2,0），写在前面会被灰态压住。
 *   · 只认鼠标：谱面上没有 DOM 命中区（标记是 canvas 之上那层 `pointer-events: none` 的 SVG），
 *     所以自己在 pointermove 里算命中，**只认 `pointerType === 'mouse'`**（触屏不参与、也就不会残留高亮）；
 *     命中结果存成「命中的是谁」的 id ref（**不存坐标对象**，免得每帧换新对象触发重渲染），
 *     pointerleave / 切工具 / 退出编辑时清空。
 *
 * 「当前小节」是个**状态**，不是一条标记 —— 它只有浅底、永远不描边：
 *   · `.m-active` 两种模式下都是 `--accent-weak` 浅底 + 小圆角（`ACTIVE_RADIUS` = **3pt**，
 *     随谱面缩放；谱面上其余标记全是直角 —— 形状本身就是区分手段，别把圆角推广到别的标记上、
 *     也别拿描边粗细替代它）。**编辑模式也不例外**：谱面上的方框已经够多（行底 / 框选 / 段落实线 /
 *     反复实线），当前小节再套一圈实线就分不清哪个框是「标记」、哪个是「状态」了。
 *     **别用「加粗描边」表达播放**。「此刻播到哪一小节」由浅底 + 一条竖直主题色播放进度线
 *     `.m-progress`（x = 小节左边界 + 小节宽 × 本小节已走拍数 / 总拍数，两种模式都画）负责。
 *     **这两样不属于「播放中」**：只要有位置就画 —— 暂停 / 停止 / 预备拍都留着，
 *     只有进编辑模式不画（用户明确要求，见 `docs/ui.md` §18.46）。
 *   · **框选 `.m-sel` 是谱面灰底、不描边**（`--mark-muted-fill`）：它表达的是「这一段在循环」
 *     这个**播放状态**、不是一条编辑标记，所以不跟编辑标记抢主题色 —— 与「当前小节」靠
 *     **灰 / 主题色**区分（用户拍板；docs/ui.md §6 / §18.32）。
 *     **圆角也用同一个 `ACTIVE_RADIUS`**，但按**块**给、不按小节给：同一行里连续的小节合并成一块
 *     （见 `selectedMeasures`），跨行时行首 / 行尾保持直角。
 *   · 标记配色上，当前工具对应的那类标记走主题色，其余三类降级成灰，一眼看出「现在在改什么」。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { t } from '../i18n/index.js'
import { segmentLabel } from '../i18n/score-text.js'
import { DEFAULT_MIN_H, ROW_MIN_PX, clampToPage, containingSystem, overlapSystem } from '../domain/rows.js'
import { segmentStartMeasure } from '../domain/timeline.js'
import { toast } from '../store/toast.js'
import { player, positionBeat, renderer, timeline } from '../store/player.js'
const props = defineProps({
  pageIndex: { type: Number, required: true },
  pageMeta: { type: Object, required: true },
  measures: { type: Array, default: () => [] },
  structure: { type: Object, required: true },
  segments: { type: Array, default: () => [] },
  repeats: { type: Array, default: () => [] },
  cssWidth: { type: Number, required: true },
  render: { type: Boolean, default: true },
  editMode: { type: Boolean, default: false },
  tool: { type: String, default: 'row' },
  activeNo: { type: Number, default: 0 },
  selection: { type: Object, default: null },
  /**
   * 正在播放（`player.playing`）。
   * **只用来决定「跳转前闪烁」画不画**（预备拍那半边看 `cueing`）——
   * 当前小节底与播放头**不看它**：只要有位置就画，暂停 / 停止也留着（用户明确要求，见 `docs/ui.md` §18.46）。
   */
  playing: { type: Boolean, default: false },
  /**
   * 预备拍进行中（`player.cueing`，不是 `metronome.countInActive` —— 那个不是响应式的）。
   * **只影响「跳转前闪烁」**：预备拍就是「马上要跳了」的那几拍倒数，这时落点上那道闪烁要一直亮着。
   */
  cueing: { type: Boolean, default: false },
  /** 当前小节内的播放进度 0..1（非编辑模式那条竖直进度线用它定位）。只对 activeNo 那一小节有意义 */
  progress: { type: Number, default: 0 },
  /**
   * 指针模式（`player.mode !== 'pan'`）。
   * **它只对触屏有意义**：指针 = 触屏按下就接管、跟手、这一层不滚页（`touch-action: none`）；
   * 抓手（默认）= 触屏这一层**完全不接管拖动**，滑动就是原生滚谱（`touch-action: auto`），
   * 我们只认「点一下」。**鼠标两种模式完全一样**（按下就接管），所以这里不参与任何鼠标分支的判断。
   * 编辑模式一样吃这套规则 —— 详见文件头「手势策略」。
   */
  pointerMode: { type: Boolean, default: false },
  /**
   * 「标记列表」开着没（见 `MarksPanel`）。
   * **开着时谱面上所有编辑标记一律降级成灰**（不看当前工具）—— 列表里要删的东西可能就是当前工具那一类，
   * 那时它还亮着主题色会误导「现在编辑的是它」；全灰之后，唯一带主题色的东西就是**刚才点的那一项**
   * （`markFocus` 的闪光），「列表 → 谱面」这条对应关系才看得出来。
   * 顺带把 hover 高亮也停掉（`updateHover` 里那条），否则鼠标一划就又亮起一条。
   */
  marksOpen: { type: Boolean, default: false },
  /** 要在谱面上闪一下的那个标记：`{ key, page, y0, y1, tick }`（`key` 决定闪谁，`tick` 让同一个目标连点也重播） */
  markFocus: { type: Object, default: null },
})

const emit = defineEmits([
  'measure-tap',
  'blank-tap',
  'select',
  /**
   * 行工具松手落下的这一条行（坐标已翻成 meta 的 y-up、已夹进页面）。
   * `minH` 是**行高下限**，按本页当前缩放换算成 pt 一起交给数据层（见 `minRowHeight`）——
   * 判据在 `store/player.js` 的 `addSystem` / `domain/rows.js` 里，这里只负责把「屏幕上多大算够高」
   * 这一条算准；两个入口用的是同一个值，谁也不许自己另算一份。
   */
  'system-add',
  'system-remove',
  'bar-add',
  'bar-remove',
  'segment-add',
  'segment-open',
  /**
   * 反复工具：**点一下就是这一件事** —— 这条线上已经有反复标记就删，没有就把这一笔交给
   * `store/player.js` 的 `addRepeatAt`（两次点击成一对：第一次只记**待定的起点**、第二次才写 json；
   * 已成对的区间里再点 = 房子起点）。**没有「打开设置」这个动作**（用户拍板把编辑器整个删掉了），
   * 所以这里没有 `repeat-open`。
   */
  'repeat-toggle',
  'rendered',
])

const canvas = ref(null)
const root = ref(null)
const rendering = shallowRef(false)

const scale = computed(() => props.cssWidth / (props.pageMeta.width || 595.28))

/**
 * 页高（pt）与 **唯一的那一次 y 轴翻转**。
 *
 * meta 里的 y 是 **PDF 的 y 轴向上**（`docs/data-format.md` 的 `score.json` 结构、`omr.js` 末尾那句
 * 「保持 systems 按 y0 降序的不变量（PDF y 轴向上）」都这么定：同一个值越大越靠上），
 * 而 overlay 这个 SVG 的 y 是**向下**的。两者差一个 `y → 页高 − y` 的翻转。
 *
 * **翻转只发生在 ScorePage 的边界上**，且只有两处：
 *   · **读**：渲染用的那几个 computed（`systems` / `bars` / `segmentMarks` / `repeatMarks` /
 *     `houseBrackets` / `activeMeasure` / `selectedMeasures`）；
 *   · **写**：`system-add` 抛出之前。
 * schema / timeline / player 那一层**始终只见 meta 的 y-up 值** —— 这正是关键：
 * `deriveStructure` 与 `normalizePage` 都按 `y0` **降序**排（降序 = 从页顶那行开始编号），
 * 只有喂给它们的 y 真的是 y-up，小节编号才是从上往下数的。
 *
 * （翻转是个对合：同一支函数反过来用就是 overlay y → meta y。）
 * 历史 bug：overlay 曾经把 meta 的 y 原样当 SVG 的 y 画，等于整层标记上下镜像 ——
 * 拖出来的行因为存的就是 overlay 坐标、看着「碰巧对」，而 demo / 导入的行全反了。
 */
const pageH = computed(() => props.pageMeta.height || 841.89)
const flipY = (y) => pageH.value - y

/** 行（渲染用）：y 翻到 overlay 空间。模板里凡是拿 sys.y0 / sys.y1 的地方都用这一份 */
const systems = computed(() =>
  (props.pageMeta.systems || []).map((s) => ({ ...s, y0: flipY(s.y0), y1: flipY(s.y1) }))
)

/** `structure.barInfo` 里的那条小节线，y 翻到 overlay 空间；不在本页（或找不到）返回 null。
    段落 / 反复都挂在某条小节线上，渲染前都要过这一道 —— 别在各自那里再翻一遍。 */
function svgBar(barId) {
  const bar = props.structure.barInfo.get(barId)
  if (!bar || bar.page !== props.pageIndex) return null
  return { ...bar, y0: flipY(bar.y0), y1: flipY(bar.y1) }
}
/**
 * 段落标记的尺寸（pt）：模板与几何算式共用这几个值，改一处两边都对。
 *   · `SEG_H`   名牌的厚度（**横向**一块牌，13 号字放得下）
 *   · `SEG_GAP` 名牌顶边与**小节号别针尖端**之间留的那条缝 —— 名牌挂在行顶上、别针压在它上方
 *   · `SEG_FONT` / `SEG_PAD` 必须与 `.seg-text` 的 `font-size`、模板里文字的 `x` 一致 ——
 *     **牌宽是按这几个数估算的**（SVG 里量不到真实文字宽度）
 *   · **没有 `SEG_MAX`**（用户拍板）：名牌上名字 + 速度拍号一起写，**文字一律不截断**，
 *     牌宽只受**纸面可用宽度**约束（见 `segmentGeometry`）。于是纸面放不下时**文字会溢出牌底** ——
 *     刻意的取舍：宁可字出牌，不可字被截、也不可牌出纸。
 */
const SEG_H = 18
const SEG_GAP = 2
const SEG_FONT = 13 // = .seg-text 的 font-size
const SEG_PAD = 6 // 文字与牌两端各留的空白（pt）

/**
 * 小节号标记的几何：**一个地图定位图标（📍 水滴形别针，实心、不带中间那个镂空环）**，
 * 每条小节线正上方一个，里面写它起头的小节号。
 *
 * **锚点是「别针的顶边」，不是圆心**：`DISC_TOP_UP` = 别针顶边离行顶多远 ——
 * 它下面是 `SEG_GAP` 那条缝和段落名牌（`SEG_H`），房子括号再往上（见 `HOUSE_UP`）。
 * 所以 `DISC_TOP_UP` 是这一套里**唯一对外承诺的数**（`= SEG_H + SEG_GAP + PIN_H`）：
 * **改别针外形时让它的顶边仍落在这个值上**，上面那层（房子括号）就一点都不用动。
 *
 * 别针是**上下不对称**的（上面是圆弧、下面收成尖），所以：
 *   · `DISC_R`    别针**圆弧部分**的半径（也是横向半宽）
 *   · `PIN_H`     别针**总高**（从顶边到尖端）；顶端圆帽占 `2 × DISC_R`，剩下的是尖端那截
 * 尖端**朝下**，尖端点落在段落名牌顶边上方 `SEG_GAP` 处（见 `barNumberMarks`）。
 *
 * ⚠️ **圆帽的横向内宽 `2 × DISC_R` 是给号码让出来的，不是随手定的**：
 * 号码走全站那一套字体（`.m-no` 不写 `font-family`，继承 `--font-ui`），字号 10px、字重 700 → Bold 档；
 * 这个字体的数字**本身等宽**（实测每字 `0.590 em`：10px 字号下 `136` 占 17.7pt、`1360` 占 23.6pt），
 * 所以**判据是「四位号」**——`2 × DISC_R` = 24pt，四位号两边各留 ~0.2pt，
 * 三位号（`136`）各留 ~3.1pt。
 * 只把字号调大而不动 `DISC_R`，号码就会从圆帽两边流出去（`.m-no` 是居中压字，
 * 流出去的部分直接落在纸面上，看着就是「帽小字大、压不住」）——**两个数要一起改**。
 */
const DISC_R = 12
/** 别针总高（顶边 → 尖端）。比 `2 × DISC_R` 多出来的那截就是下面的尖（`30 − 24` = 6pt）。
 *  **圆帽那一截是给号码的，不能缩**（见上面 `DISC_R` 的判据），所以总高先由顶端圆帽顶住，
 *  再往下留出下面那个尖：尖太短会缩成一个带尖的圆、失去「地图别针」的辨识度 ——
 *  所以 **`PIN_H ≥ 2 × DISC_R` 是硬下限**（`pinPath` 的切线就按它成立，
 *  圆帽下面的尖至少要有 6pt）。 */
const PIN_H = 30
/** 别针**顶边**在行顶上方多少：它下面是段落名牌（`SEG_H` 厚、底边贴行顶）+ `SEG_GAP` 缝，
 *  再往下才是别针自己那 `PIN_H`（对外承诺，别乱动） */
const DISC_TOP_UP = SEG_H + SEG_GAP + PIN_H

/**
 * 房子括号的垂直位置：**画在最上面那一层**。
 * 行顶往上是一条固定的三层栈（从上到下依次是**房子 → 别针 → 名牌**）：
 *   行顶 → 名牌（`SEG_H` 厚、底边贴在行顶）→ `SEG_GAP` 缝 → 别针（`PIN_H` 高、顶边在 `DISC_TOP_UP`）
 *        → `HOUSE_GAP` 缝 → 房子括号（`HOUSE_H` 高）
 * 所以房子**不再压在别针那一带上**（旧写法是 `行顶 − 15`，正好落在别针中间，与小节号抢地方）。
 *   · `HOUSE_H`   从括号自己的 `y` 到标签基线的高度（模板里是 `y + 12`，改模板要把这里一起改）
 *   · `HOUSE_GAP` 括号底边与**别针顶边**之间留的缝
 * 这几个数和 `SEG_*` / `DISC_*` 是一套：改别针或名牌的尺寸，房子跟着一起挪。
 */
const HOUSE_H = 12
const HOUSE_GAP = 2
/**
 * 房子 1 与房子 2 两条括号之间的**横向缝**（pt）。
 * 两个房子的跨度**首尾相接**（房子 1 收到结束线上、房子 2 就从那条结束线起笔），照着跨度画，
 * 两条竖钩会重叠成一条、看着像一整条括号 —— 所以**房子 2 的起笔往右让出这一段**。
 * **房子 1 的跨度一点不动**：它按约定就是「房子 1 起点线 → 反复结束线」。
 * 单位 pt，随谱面缩放。
 */
const HOUSE_GAP_X = 4
/** 房子括号的 `y` 离行顶多少：把名牌、缝、别针、缝、括号自己一层层让过去 */
const HOUSE_UP = DISC_TOP_UP + HOUSE_GAP + HOUSE_H

/**
 * 谱面上**唯一一档圆角**的半径（pt）。
 * 谱面上别的标记全是直角（行底、小节线、段落、反复、房子、谱面 hover 都是方框）；
 * 用这一档的只有两处**播放状态**的底：当前播放的这一小节（`.m-active`）与框选（`.m-sel`）。
 * 所以圆角本身只说明「这是一层状态底」，**不是「当前小节独有」的形状**（用户拍板）。
 * 用户拍板走**很小的圆角**这一档：3pt，只用来打破直角轮廓，几乎不占地方。
 * 定这一档的过程是 6pt → 14pt（太大，否掉）→ 6pt → 3pt，别再往上调了。
 * 单位是 pt（PDF 点），和别的几何量一样随谱面缩放。
 * 框选那一边**按块给**（同一行里连续的小节合并成一块，跨行时行首 / 行尾保持直角），
 * 所以每块还要各自算「哪几个角是圆的」—— 见 `selectedMeasures`。
 */
const ACTIVE_RADIUS = 3

/**
 * 段落名牌上写什么：**名字与速度拍号同时显示**（用户拍板）—— 有名字「A 段 120 4/4」、
 * 没名字「120 4/4」。拼法在 `i18n/score-text.js` 的 `segmentLabel` 里，
 * **与标记列表那一行是同一个函数**，两处永远一致。
 */
const segmentDisplayLabel = segmentLabel

/**
 * 一个字符占几个「字宽」：按**字符类别**分别给系数，取值来自实测
 * （`700 13px` 下 `.seg-text` 实际继承的那个字体栈，逐字符量真实 advance 宽度再按类取均值）。
 * 系数以**字号**为单位（见 `labelWidth`：宽度 = 系数之和 × `SEG_FONT`）。
 *
 *   · 中日韩 `1`      —— 实测恒为 1.000，满宽，一个字正好一个字号
 *   · 音符 `1`        —— **只给 `♩` 这一个字符**：实测 advance 恒为 1.000（13.0pt ÷ 13；
 *                        字体栈里那几家都没有这个字形，它是回退字体画的）
 *   · 空格 `0.28`     —— 实测 0.276（**这一档最容易被漏算**：名字与速度之间那个空格很窄，
 *                        按拉丁字符算会白多出半个字宽）
 *   · 数字 `0.58`     —— 实测 0.576（等宽，十个数字一样宽）
 *   · 大写 `0.68`     —— 实测均值 0.682
 *   · 小写 `0.56`     —— 实测均值 0.566
 *   · 等号 `0.71`     —— **只给 `=` 这一个字符**：实测 0.707，比一般符号宽
 *   · 其余符号 `0.5`   —— 实测均值 0.502
 *
 * **`♩` 与 `=` 单列出来、不并进「其余符号」那一档**：这两个字符在**每一个**名牌里 ——
 * `score.segmentTempo` 是 `♩={bpm} {拍}/{单位}`，名牌固定以它们开头。按 0.5 算，每个名牌都估窄
 * `(1 − 0.5) + (0.71 − 0.5) ≈ 0.71` 个字宽 ≈ 9pt（13 号字的三分之二个字宽）：
 * 牌右端被文字顶到边上，两端各留一格 `SEG_PAD` 就没了 —— 看着就是「字顶出牌右边」。
 * 名字那一半仍按类取均值（名字是任意文字，只能估）。
 * （`♩` 的墨迹只有约 0.27 个字宽，在它那个 1 个字宽的盒子里**左边留 0.29、右边留 0.45 个字宽**：
 *   牌两端的空白因此差 2pt 上下（左端略宽）—— 那是字形自带的边距，不是 `SEG_PAD` 算错。）
 *
 * 为什么按类分而不是统一一个数（原来拉丁/数字/符号一律 0.58）：那些字符的真实宽度差得很远，
 * 一律按 0.58 算会把整串估宽，**牌宽比文字实际需要的宽**，多出来的部分全堆在字的右边 ——
 * 看着就是「右边多了一块 padding」。分档之后实测平均绝对误差约 6pt（原先是 12pt 上下）。
 *
 * 为什么仍取**略偏保守**（个别字符如 `W` 仍可能略微低估）：估宽决定牌宽，
 * 估窄了文字会顶出牌外。极端情况（整串都是 `W` / `m` 这种宽字符）仍可能差几个 pt，
 * 但那类段落名很少见；真要彻底消除得在 SVG 里量真实宽度，代价见 `labelWidth` 的注释。
 */
function charWidth(ch) {
  if (/[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(ch)) return 1 // 中日韩：满宽
  if (ch === '♩') return 1 // 音符：回退字体给的是满宽（见上）
  if (ch === ' ') return 0.28
  if (/[0-9]/.test(ch)) return 0.58
  if (/[A-Z]/.test(ch)) return 0.68
  if (/[a-z]/.test(ch)) return 0.56
  if (ch === '=') return 0.71 // 等号：比一般符号宽（见上）
  return 0.5 // 其余符号（/ . - ( ) 等）
}

/**
 * 一段文字估出来有多宽（pt）= 字宽之和 × 字号。名牌的宽度按它收放（见 `segmentGeometry`）。
 * **只是估算**（SVG 里量不到文字宽度，量真实值要挂隐藏 `<text>` 用 `getComputedTextLength()`，
 * 那会引入「字体加载完才能量」的时序问题、也得把 `segmentGeometry` 从纯函数改成带状态，
 * 所以这里坚持纯估算）；系数按实测标定，见 `charWidth`。
 * 纸面放不下时牌宽被纸面卡住，文字照样写完，那时估算与实际排版都不再影响
 * 「牌不越出纸面」这件事 —— 那是 `segmentGeometry` 里夹出来的。
 */
function labelWidth(label) {
  let w = 0
  for (const ch of label) w += charWidth(ch)
  return w * SEG_FONT
}
const cssHeight = computed(() => (props.pageMeta.height || 841.89) * scale.value)

const bars = computed(() => {
  const out = []
  for (const sys of systems.value) {
    for (const b of sys.bars || []) out.push({ ...b, y0: sys.y0, y1: sys.y1 })
  }
  return out
})

/** 小节（渲染用）：y 翻到 overlay 空间。`props.measures` 是 structure 给的、y 仍是 meta 的 y-up */
const svgMeasure = (m) => (m ? { ...m, y0: flipY(m.y0), y1: flipY(m.y1) } : null)

/**
 * 小节号那个**地图定位图标（📍 实心水滴形别针）**的轮廓，返回 SVG path 的 `d`。
 *
 * 做法是**「从尖端向圆帽作切线」**（不是随手拍两个贝塞尔控制点）：
 *   · 圆帽：半径 `DISC_R`、圆心 `cy = topY + DISC_R`
 *   · **切点**：从尖端 `(cx, bottom)` 向圆作切线，切点与正下方的夹角 θ 满足 `cosθ = DISC_R / d`
 *     （`d` = 圆心到尖端的距离）—— 这是几何上唯一能让「圆 → 尖」两侧相切的位置
 *   · 两侧：从切点**沿切线方向**收到尖端（控制点按 `K` 取在切线上），
 *     于是尖端两条切线夹角 ≈ `2 × (90° − θ)`，是个**真尖角**
 *   · 尖端：`(cx, topY + PIN_H)`
 *
 * ⚠️ **别把控制点放在与尖端同高的位置**：那样曲线是**水平**撞到尖端的，
 * 底就收成圆的，整个形状变成「云朵 / 梅花」而不是水滴。
 * 控制点必须落在**切点→尖端这条切线**上，尖端才收得出角。
 *
 * 切点存在要求 `PIN_H ≥ 2 × DISC_R`（尖端至少要到圆帽底边）；不满足时把 `cos` 夹到 1，
 * 退化成「圆下面接一个直尖」，不会画出 NaN。
 *
 * **不带中间那个镂空圆环**（用户拍板：不要环）—— 它整块是实心的，
 * 小节号直接压在圆帽中心。
 * 尖端朝下（指向下面那层段落名牌），所以整条 path 的**顶边恒等于 `topY`**、不随 PIN_H 变化 ——
 * 上面那层（房子括号）因此完全不受别针变高变矮影响。
 */
function pinPath(cx, topY) {
  const r = DISC_R
  const cy = topY + r // 圆帽圆心
  const bottom = topY + PIN_H // 尖端
  const d = bottom - cy // 圆心 → 尖端
  const cos = Math.min(1, r / d) // 切点与正下方的夹角余弦
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos))
  // 右切点。左切点按 x 镜像，不另算
  const tx = r * sin
  const ty = cy + r * cos
  // 腰身系数：0 = 完全沿切线直收（角最利），越大越圆润。0.34 是试出来的水滴感
  const K = 0.34
  const c1x = cx + tx - tx * K
  const c1y = ty + (bottom - ty) * K
  const c2x = cx + tx * K
  const c2y = bottom - (bottom - ty) * K
  return [
    `M ${cx} ${topY}`,
    `A ${r} ${r} 0 0 1 ${cx + tx} ${ty}`, // 右半圆：顶 → 右切点
    `C ${c1x} ${c1y} ${c2x} ${c2y} ${cx} ${bottom}`, // 右切线 → 尖端
    `C ${cx - tx * K} ${c2y} ${cx - tx + tx * K} ${c1y} ${cx - tx} ${ty}`, // 左切线（镜像）
    `A ${r} ${r} 0 0 1 ${cx} ${topY}`, // 左半圆：左切点 → 顶
    'Z'
  ].join(' ')
}

/**
 * 段落标记的几何：**一条像小节线的竖线 + 挂在它顶上的一块横向名牌**。
 *
 *  · **线对齐到「拍」**：线不画在段落挂靠的那条小节线上，而是按段落的 `beat`（这一小节里的第几拍，
 *    见 `schema.js`）落在那一小节里 —— 第 4 小节第 3 拍就落在第 4 小节第 3 拍上。
 *    **拍点 = 小节按「每小节拍数 + 1」等分后的内部那几条分割线**（用户定的规则）：
 *    4 拍的小节五等分，第 1～4 拍落在 1/5、2/5、3/5、4/5 处 —— 所以**第 1 拍也不压在小节线上**，
 *    小节两端各留出一格。分母用**段落自己的 `beatsPerBar`**：`beat` 本来就是按它夹过的
 *    （`fitBeat` 保证拍号 ≤ beatsPerBar），所以线永远落在这条小节里，不会跑出去。
 *    （那一小节真正有几拍由「小节起点生效的那个段落」决定，跨段落改拍号时两者会差一点 ——
 *    刻意的取舍：不在这里再推一遍 `tempoAt`，宁可自查自洽。）
 *    ⚠️ 播放进度线（`PdfViewer` 的 `measureProgress`）**不是这套网格**：它从行首 0 线性扫到行尾 1，
 *    表达的是「这一小节走了几成」。两者本来就说的不是一件事，别顺手把它们调成一样。
 *  · **线通到名牌**：下端是行底、上端伸到名牌的底边（= 行顶），看起来就是「一根挑着牌子的杆」。
 *    名牌挂在**行顶上**（三层栈里最下面那一层）、别针再往上 —— 行顶往上依次是名牌、缝、别针、
 *    缝、房子括号（`HOUSE_UP`），各层各占各的，谁也不用让谁（所以 `barNumberMarks` 那边
 *    不再需要避让逻辑，房子也不用再挤在别针那一带上）。
 *  · **名牌左边缘贴住线、向右展开**，牌宽按估算字宽收放；快到纸右边时整体左移
 *    （`left` 已经夹过），保证整块牌都在纸面内。
 *  · 哪一小节：**`segmentStartMeasure`**（domain/timeline.js 里那一条：位置优先，
 *    `barId` 只是它当初挂靠的线）。位置指到别的页上去了就不在本页画（它会画在自己那一页）；
 *    位置越界或压根没写（例如挂在行末那条线上、小节号落到下一小节）时退回那条小节线。
 *  · **「开头」段落也画**（用户要求：它虽然删不掉，但在编辑模式里要看得见）：它的 `measure` / `beat`
 *    被按死在 1，所以那根线**固定在第 1 小节第 1 拍**上，点它打开的就是那个不能删的段落。
 *  · 返回 null = 这一条不该画：本页既没有它的小节、也没有它挂的线 —— 全谱还没有小节时
 *    「开头」段落也走这一路，**整条不画**（没有小节也就没有「第 1 拍」可落）。
 */
function segmentGeometry(seg) {
  const global = segmentStartMeasure(props.structure, seg)
  if (global && global.page !== props.pageIndex) return null // 画在它自己那一页上
  const m = global ? svgMeasure(props.measures.find((x) => x.no === global.no) || null) : null
  // 「开头」段落只有「第 1 小节」这一条落点（`segmentStartMeasure` 固定给它 1）：
  // 拿不到那一小节就**整条不画**，不许退回 `barId` —— 它的位置是固定的，
  // 不该因为还挂着一条小节线又冒出来（用户要求：没有小节就先隐藏）。
  if (seg.head && !m) return null
  const anchor = m || svgBar(seg.barId) // 位置越界 / 没写位置 → 退回它挂靠的那条小节线
  if (!anchor) return null
  const beats = Math.max(1, Math.round(seg.beatsPerBar || 4))
  const beat = Math.min(beats, Math.max(1, positionBeat(seg)))
  // 小节等分成 beats + 1 格，第 beat 条分割线就是第 beat 拍的位置（见上面那条注释）
  const x = m ? m.x0 + (m.x1 - m.x0) * (beat / (beats + 1)) : anchor.x
  // 名字 + 速度拍号一起写；**文字永不截断**（用户拍板），所以宽度只受纸面约束
  const label = segmentDisplayLabel(seg)
  const pageW = props.pageMeta.width || 595.28
  // 牌宽封顶是**纸面可用宽度**：名字再长也不越出 PDF 页面（`left` 因此恒 ≥ 0）
  const w = Math.min(pageW, labelWidth(label) + SEG_PAD * 2)
  const left = Math.min(x, Math.max(0, pageW - w))
  // 行顶 = overlay 里较小的那个 y（翻转之后 y 越大越靠下）；**名牌挂在行顶上**（底边就是它）
  const rowTop = Math.min(anchor.y0, anchor.y1)
  const lineTop = rowTop // 竖线上端 = 名牌底边
  return { seg, x, label, w, left, top: lineTop - SEG_H, lineTop, lineBottom: Math.max(anchor.y0, anchor.y1) }
}

const segmentMarks = computed(() => props.segments.map(segmentGeometry).filter(Boolean))

/**
 * 小节线 -> 「正上方那个别针里的小节号」。
 * 一条小节线的编号 = 从它开始的小节号（barStartMeasure）。**没有编号也要画那个别针**：
 * 全谱最后一条线指向 count + 1（已越界），它是「曲终」那条线，没有小节从它开始，
 * 所以别针照画、里面留空 —— 这样每一条线都有一个别针，位置规律不会被一个缺口打断。
 *
 * 别针**位置固定**（顶边在 `DISC_TOP_UP`，尖端压在段落名牌顶边上方 `SEG_GAP` 处）：名牌挂在它
 * **下面**那一层（贴行顶）、房子括号在它上面（`segmentGeometry` / `HOUSE_UP`），三层各占各的，
 * 所以这里没有任何避让 / 抬高逻辑 —— 别再加回来。
 *
 * 几何按**别针顶边**定位（不是圆心）：`topY` = 行顶 − `DISC_TOP_UP`，
 * `d` 是一条「从顶边往下画」的实心水滴轮廓，尖端落在 `topY + PIN_H`。
 * 文字压在圆帽中心（`ty`）—— 换形状后数字仍落在最宽的那一带上。
 *
 * 别针尖端还往下接一条 `stem`：从尖端一直画到**行顶**（那里正是小节线的上端），
 * 同色同粗细 —— 于是「上面的别针 + 行里那根小节线」看起来是**一条贯通的线**，
 * 而不是上下分开的两段。它是这个标记的一部分（跟别针一起变灰 / 一起加粗）。
 */
const barNumberMarks = computed(() =>
  bars.value.map((b) => {
    const no = props.structure.barStartMeasure.get(b.id)
    const valid = Number.isFinite(no) && no >= 1 && no <= props.structure.count
    // `bars` 给的 y 已经翻到 overlay 空间，**这里 y 越大越靠下**，
    // 所以「别针放在行正上方」= 取两者中**较小**的那个再往上减。
    // 翻转 + min/max 一起用，y0/y1 谁大谁小（meta 的示例是 y0<y1、OMR 的 truth 是 y0>y1）都不受影响。
    const rowTop = Math.min(b.y0, b.y1)
    const topY = rowTop - DISC_TOP_UP
    return {
      id: b.id,
      x: b.x,
      topY,
      // 文字的基线：圆帽圆心（= 顶边往下 DISC_R）
      ty: topY + DISC_R,
      d: pinPath(b.x, topY),
      // 杆：尖端 → 行顶（小节线上端）。中间会横穿段落名牌那一带，名牌画在它之后、自然盖住，不用避让
      stemY0: topY + PIN_H,
      stemY1: rowTop,
      label: valid ? String(no) : ''
    }
  })
)

const activeMeasure = computed(() => svgMeasure(props.measures.find((m) => m.no === props.activeNo)))

/**
 * **跳跃闪烁 · 跳转前**（`player.jumpFlash`）：跳跃 / 预备拍倒数期间，那一小节**每拍闪一下**
 * （`ms` 递一拍、`times` 递这一小节几拍）。
 *   · **自动跳**：跳跃前那一整小节就点亮（起点 = 「下一小节的起点就是落点」，见 `store/player.js` 末尾那个 watch）；
 *   · **手动跳转 / 框选起播的预备拍**：倒数这几拍把落点点住（跳转预备拍 = 你点的那一小节、循环段预备拍 = 框选起点）。
 * 显示条件：**播放中与预备拍中**画（预备拍算播放中，`player.cueing` 也一并认）——
 * 它是「一会儿要跳到哪 / 正在倒数」这种播放态提示；**暂停 / 停止不留**（那时它是过期提示）；进编辑模式不画。
 */
const jumpFlash = computed(() => {
  const f = player.jumpFlash
  if (!f?.no) return null
  if (!(props.playing || props.cueing) || props.editMode) return null
  const m = svgMeasure(props.measures.find((x) => x.no === f.no))
  if (!m) return null
  return { ...m, tick: f.tick, ms: f.ms || 500, times: Math.max(1, Math.round(f.repeats || 1)) }
})

/**
 * **跳跃闪烁 · 跳转后**（`player.jumpAfter`）：落点上**闪一下就完**（`ms` 一拍左右，重复次数由 CSS 定死为 1）。
 *   · **手动跳转（点小节 / 跳段落 / 跳转浮层）**：**点击那一刻就闪**，与预备拍那串「跳转前」
 *     **同时**落在同一小节上（用户明确要求：点下去先看到「跳到这里了」，同时开始倒数）；
 *   · **自动跳**：落地那一拍闪（watch 把「跳转前」换成它）。
 * 显示条件：**只要状态在就画** —— 它是「刚刚跳到了这里」的一次性事件提示，而手动跳转多半发生在
 * **没在播放**的时候，跟着播放态一起藏掉就等于手动跳转永远不闪。进编辑模式一律不画。
 */
const jumpAfter = computed(() => {
  const f = player.jumpAfter
  if (!f?.no || props.editMode) return null
  const m = svgMeasure(props.measures.find((x) => x.no === f.no))
  if (!m) return null
  return { ...m, tick: f.tick, ms: f.ms || 600 }
})

/**
 * 闪烁与「当前小节」落在**同一小节**上时，当前小节那层浅底要让位（不画）。
 *
 * 为什么：闪烁的动画是 `opacity 0 → 1 → 0`、填的就是当前小节那档底色（`--accent-weak`），
 * 而它画在 `.m-active` **之上**。底下那层常亮浅底不撤掉的话，两层半透明色会叠起来，
 * 看到的是「一直亮着、峰值只深一点点」，**不是**空白 ↔ 底色之间的一下一下
 * （用户明确要求：预备拍里那道闪烁必须与「跳转前闪烁」长得一模一样）。
 * 撤掉之后，闪烁就是唯一那层底 —— 峰值与当前小节同色，所以落点该亮的时候照样是主题色浅底。
 *
 * **判据只看「跳转前」那一道**（`jumpFlash`）：它是持续时间最长的那一道（一整个小节 / 整个倒数）；
 * 「跳转后」是落点上一闪而过、**盖在上面**的（§18.42 第 114 条那儿的「无缝接上」是有意的），
 * 它单独出现时底下那层常亮浅底要留着。
 */
const flashOnActive = computed(() => !!jumpFlash.value && jumpFlash.value.no === props.activeNo)

/**
 * 当前小节内的播放进度：一条竖直主题色实线，**只在非编辑模式画**。
 * 编辑模式下当前小节是「背景 + 边框」（那是编辑态的表达），进度不必再占一条线。
 * 位置 = 小节左边界 + 小节宽 × 播放比例 —— 比例由父组件按「本小节第几拍 / 总拍数」算好传进来，
 * 这里只管把它放到小节里对应的地方（拍号是段落决定的，换算留在 store 那一侧更准）。
 */
const progressLine = computed(() => {
  if (props.editMode) return null
  const m = activeMeasure.value
  if (!m) return null
  const f = Math.max(0, Math.min(1, Number(props.progress) || 0))
  return { x: m.x0 + (m.x1 - m.x0) * f, y0: m.y0, y1: m.y1 }
})

/* 鼠标悬停高亮：**高亮什么由当前选中的标记工具决定**，编辑什么就高亮什么。
   谱面没有 DOM 命中区，标记都是 canvas 上那层 pointer-events: none 的 SVG，
   所以悬停只能像点击那样自己算命中。
   只存「命中的是谁」（id），不存坐标对象 —— 免得每次 pointermove 都换一个新对象触发重渲染。
   **「标记列表」开着时整套悬停都不参与**（见下面 `updateHover` 的头一句）：
   那时全谱的标记都降级成灰，只有列表里点过的那一项才带主题色。 */
const hoverSystemId = ref(null) // 行工具：悬停到的那一行（按 y 直接命中，**不经过小节**，见文件头注释）
const hoverBarId = ref(null) // 小节线工具：悬停到的那条线（**只在删除判定区里**才给值，见 hitBarZone）
const hoverBarGhost = ref(null) // 小节线工具：没落在删除判定区时，「将要建在这」的落点预览 { x, y0, y1 }
const hoverSegId = ref(null) // 段落工具：悬停到的那条**已有段落**（按画出来的那条线命中，线在拍上）
const hoverSegBarId = ref(null) // 段落工具：悬停到的那条**候选小节线**（点下去会在这儿新增一条段落）
const hoverRepBarId = ref(null) // 反复工具：悬停到的那条反复线

/**
 * 框选矩形（overlay 坐标）盖住的小节号区间。**松手落区间与拖动中的灰底预演共用这一支**：
 * 两处各算一份的话，「拖的时候亮的是这几格、松手却循环另外几格」迟早会发生。
 *
 * `box` 是 overlay 坐标（y 向下），`props.measures` 是 meta 的 y-up，所以比之前要翻；
 * 上下沿用 min/max 夹一下（外来 JSON 里 y0/y1 可能反着写，见 `hitSystem` 的注释）。
 * **返回的是 no 的 [min, max]**，不是命中的那一串：框选要的是连续区间，
 * 中间隔着的小节照样算进去（这不是 bug，是和松手后的循环区间一致的取舍）。
 */
function measuresInBox(box) {
  const from = props.measures.filter(
    (m) =>
      m.hitX1 > box.x0 &&
      m.hitX0 < box.x1 &&
      Math.max(flipY(m.y0), flipY(m.y1)) < box.y1 &&
      Math.min(flipY(m.y0), flipY(m.y1)) > box.y0
  )
  if (!from.length) return null
  const nos = from.map((m) => m.no)
  return { from: Math.min(...nos), to: Math.max(...nos) }
}

/**
 * 框选要高亮的那几块灰底（overlay 坐标）。
 *
 * **按块渲染、不按小节渲染**：框选表达的是一整段循环，一格格画直角矩形的话，段内相邻两小节
 * 之间会露出两个背靠背的小凹口，读起来像「一节一格」；所以先把**同一行里连续的小节合并成一块**，
 * 只在块自己的外角上给 `ACTIVE_RADIUS`。
 *
 * 「连着」的判据是 `systemId` 相同 + `x1` 与下一格的 `x0` 对得上（浮点容差 0.5pt）——
 * **不是「小节号连续」**：相邻两小节跨行 / 跨页时编号照样连续，可它们是两条分开的带子，
 * 并成一块会把中间整页宽的空白也算进灰底。
 *
 * 每块自己算「哪几个角是圆的」，**行的上 / 下两端一律保持直角**（相邻行天然共用同一条 `x0` / `x1`，
 * 块的侧边本来就齐平）：
 *   · 左端没接到行首（`indexInSystem > 0`）→ 左上 / 左下直角，整段读起来是一条上下贯通的带子；
 *   · 右端没接到行尾 → 右上 / 右下直角（行尾 = 这一行最后一个 `indexInSystem`，
 *     行的小节数 = 小节线数 − 1，拿不到就保守留直角）。
 * **SVG 的 `rx` / `ry` 是四个角一起圆的**，没有「只圆某几个角」的写法，所以按角给半径这一路
 * 只能退一格：一块里四角同圆（整段都在一行里时就等于四角圆）。
 * 拖动中的预演与松手落下的区间共用这一支（见 `dragRange`）。
 */
const selectedMeasures = computed(() => {
  const range = dragRange.value || props.selection
  if (!range) return []
  const picks = props.measures.filter((m) => m.no >= range.from && m.no <= range.to).map(svgMeasure)
  const blocks = []
  for (const m of picks) {
    const prev = blocks[blocks.length - 1]
    const last = prev && prev.picks[prev.picks.length - 1]
    if (last && last.systemId === m.systemId && Math.abs(last.x1 - m.x0) < 0.5) {
      prev.picks.push(m)
      prev.x1 = Math.max(prev.x1, m.x1)
    } else {
      blocks.push({ systemId: m.systemId, picks: [m], x0: m.x0, x1: m.x1, firstIndex: m.indexInSystem })
    }
  }
  // 每行的小节数 = 这一行的小节线数 − 1（`bars.length < 2` 的行没有小节，见 timeline.js）
  const barCount = new Map(systems.value.map((s) => [s.id, (s.bars || []).length - 1]))
  return blocks.map((b) => {
    const first = b.picks[0]
    const last = b.picks[b.picks.length - 1]
    const count = barCount.get(b.systemId)
    // 圆角半径**只算一次**（四角同值），条件 = 这一块的左端钉在行首、或右端钉在行尾
    const full = b.firstIndex === 0 || (count > 0 && last.indexInSystem >= count - 1)
    return {
      key: `s${first.no}`,
      x: b.x0,
      y: Math.min(first.y0, first.y1),
      width: Math.max(0.5, b.x1 - b.x0),
      height: Math.max(0.5, Math.abs(first.y1 - first.y0)),
      radius: full ? ACTIVE_RADIUS : 0,
    }
  })
})

/**
 * 拖动中的框选预演：**在框的过程中就把选中的小节标灰**，而不是松手才标灰
 * （用户明确要求）——预演与松手落下的区间出自同一支 `measuresInBox`。
 *
 * 只在**框选**这一路成立：编辑模式的 `row` 带子是「将要落下的那一行」的预览，
 * 与非编辑的框选是两回事，别让它也去点灰小节。
 * `dragMode` 是一个**只存字符串**的 ref（不存坐标对象）：谱面每帧都在 pointermove 里跑，
 * 存对象等于每帧换一个新引用、白重渲染一层。
 */
const dragMode = ref(null)
const dragRange = computed(() => {
  if (dragMode.value !== 'marquee') return null
  const box = marquee.value
  return box && !box.row ? measuresInBox(box) : null
})

/**
 * 反复线（渲染用）。**只有三种标记**：`start` / `end` / `house1` 的起点 ——
 * 房子 2 已经不是标记了（它是下面那对房子括号推出来的样式），所以外来数据里若还留着
 * `kind: 'house2'`（老版本的编辑器设过它）**当作没看见**，谱面上不画。
 *
 * **待定的反复起点也在这里画**（`player.pendingRepeatBarId`）：反复工具第一次点只记会话状态，
 * 那条线还不在 `meta.repeats` 里 —— 不画出来的话点击像没反应。它照「反复开始」那条样式画，
 * 用户第二次点合法才写进 meta（切工具 / 退编辑 / 点错就消失，见 `store/player.js`）。
 * 所以它是「画出来的状态」，**不进 props.repeats、也不参与任何命中与删除**。
 */
const REPEAT_MARK_KINDS = ['start', 'end', 'house1']
const repeatMarks = computed(() => {
  const out = props.repeats
    .filter((rep) => REPEAT_MARK_KINDS.includes(rep.kind))
    .map((rep) => {
      const bar = svgBar(rep.barId)
      if (!bar) return null
      const startNo = props.structure.barStartMeasure.get(rep.barId)
      return { key: rep.id, kind: rep.kind, bar, startNo }
    })
    .filter(Boolean)
  if (player.pendingRepeatBarId) {
    const bar = svgBar(player.pendingRepeatBarId)
    if (bar) out.push({ key: 'pending', kind: 'start', bar, startNo: props.structure.barStartMeasure.get(player.pendingRepeatBarId), pending: true })
  }
  return out
})

/**
 * 房子括号。**它不是标记**（谱面上落不下「房子 2」），而是从**反复区块**推出来的样式：
 *   房子 1 =「房子 1 起点线 → 反复结束线」（第一遍走它）；
 *   房子 2 =「反复结束线 → 第二遍又走到区块起点之前」（`:‖` 之后接着走的那一段）。
 * 跨度由 `timeline.blocks` 给（`domain/timeline.js` 的 `deriveRepeatBlocks`）——
 * 本文件只负责把区间铺到**每一行**上画括号，**别在这里再推一遍跨度**：
 * 时间轴展开、反复工具的落点判定与删除范围读的都是同一份。
 * 竖直位置：**行顶往上三层栈的最上面**（`HOUSE_UP`）—— 行顶往上是「名牌 → 别针 → 房子」，
 * 房子不再压在小节号别针上。
 *
 * **形状**（用户定的两条）：房子 1 **两头都收尾**（左右各一条竖钩）；房子 2 **只起笔、不收尾**
 * —— 右边敞着口。它的覆盖范围本来就一直到曲末（`fullEndMeasure`），画一条收尾的竖钩等于说
 * 「到此为止」，与事实不符。
 * 两个房子的跨度**共用一条结束线**，照跨度画两条竖钩会重叠成一条，所以房子 2 的起笔再往右
 * 让出 `HOUSE_GAP_X` —— 两条之间留一条缝。**房子 1 的跨度一点不动**。
 * **没有「房子 1 起点」就没有房子 2**：`deriveRepeatBlocks` 那时压根不推房子 2（见那边的注释）。
 */
const houseBrackets = computed(() => {
  const out = []
  for (const block of timeline.value.blocks) {
    // 房子 2 **没有自己的数据**（它只是推出来的样式），所以两条括号共用同一个删除目标：
    // **点任何一条房子括号 = 删掉这一块的「房子 1 起点」标记**（用户要的「线和括号都删房子 1 起点标记」）。
    // 没有房子 1 就没有括号可画（`deriveRepeatBlocks` 那边也不推房子 2）。
    const house1 = block.houses.find((h) => h.index === 1)
    if (!house1) continue
    for (const house of block.houses) {
      const second = house.index === 2
      // 房子 1 从标记线起笔；房子 2 从**结束线**起笔（它的第一小节在结束线的下一条线上）
      const b0 = svgBar(second ? block.endBarId : house.mark.barId)
      const b1 = svgBar(block.endBarId)
      for (const sys of systems.value) {
        const sysMeasures = props.measures.filter((m) => m.systemId === sys.id)
        if (!sysMeasures.length) continue
        const inRange = sysMeasures.filter((m) => m.no >= house.startMeasure && m.no <= house.endMeasure)
        if (!inRange.length) continue
        // 括号**横跨的行数不定**：贴着标记线的那一行要从线上起笔 / 收笔（`Math.min` / `Math.max`
        // 把那条线并进区间），中间的行按小节铺满 —— 同一页上只有起止行会被这条规则改到
        const first = inRange[0]
        const last = inRange[inRange.length - 1]
        const atStartLine = b0 && b0.sys === sys.sys
        const x0 = (atStartLine ? Math.min(b0.x, first.x0) : first.x0) + (second && atStartLine ? HOUSE_GAP_X : 0)
        const x1 = b1 && b1.sys === sys.sys ? Math.max(b1.x, last.x1) : last.x1
        // 括号画在**行上方、别针再往上**的位置（见 `HOUSE_UP`）：overlay 里 y 越小越靠上，
        // 翻转后行顶是 y0/y1 里小的那个
        const y = Math.max(0, Math.min(sys.y0, sys.y1) - HOUSE_UP)
        out.push({
          id: `${block.endBarId}-h${house.index}-${sys.id}`,
          index: house.index,
          x0,
          y,
          // 路径：左端一条竖钩 + 横线；右端**只有房子 1 收尾**（房子 2 敞着口，见上面那段）
          d: `M${x0} ${y + 9} L${x0} ${y + 2} L${x1} ${y + 2}` + (second ? '' : ` L${x1} ${y + 9}`),
          /** 点这条括号要删的那条标记（= 这一块的「房子 1 起点」，见 `hitHouseBracket`） */
          barId: house1.mark.barId,
          label: second ? t('repeatKind.house2.short') : t('repeatKind.house1.short'),
        })
      }
    }
  }
  return out
})

/* 悬停命中的那些标记：**只有当前工具对应的那一个会算出结果**（其余一律 null），
   所以切工具时高亮对象自然就换了。依赖 bars / segmentMarks / repeatMarks，故排在它们之后。 */
/** 行工具：悬停到的那一行。
    **命中来源是 `hoverSystemId`（按 y 直接命中小节），不是「光标在第几小节」** ——
    一行要是还没画小节线（或只画了一条），`deriveStructure` 一个小节都推不出来，
    按小节命中的话这种行永远悬停不亮，而「点一下给这行补标记」恰恰最需要提示。
    依赖 systems 而不是 measures / bars，所以与「这行有没有标记」完全无关。 */
const hoverSystem = computed(() => {
  if (!props.editMode || props.tool !== 'row' || !hoverSystemId.value) return null
  return (props.pageMeta.systems || []).find((s) => s.id === hoverSystemId.value) || null
})
/** 小节线工具：悬停到的那条线 */
const hoverBar = computed(() => {
  if (!props.editMode || props.tool !== 'barline' || !hoverBarId.value) return null
  return bars.value.find((b) => b.id === hoverBarId.value) || null
})
/** 段落工具：悬停到的那条段落标记（按**画出来的那条线**命中，见 `hitSegmentMark`） */
const hoverSegMark = computed(() => {
  if (!props.editMode || props.tool !== 'segment' || !hoverSegId.value) return null
  return segmentMarks.value.find((s) => s.seg.id === hoverSegId.value) || null
})
/** 反复工具：悬停到的那条反复线对应的标记（**含待定起点那条**，它也要能高亮） */
const hoverRepMark = computed(() => {
  if (!props.editMode || props.tool !== 'repeat' || !hoverRepBarId.value) return null
  return repeatMarks.value.find((r) => r.bar.id === hoverRepBarId.value) || null
})
/** 三个线工具共用的那条悬停线 = **候选的那条小节线**（小节线 / 段落 / 反复都落在小节线上，
    提示是同一条）。段落那条线自己画在拍上、由 `hoverSegMark` 让整条标记亮起来，
    所以这里不掺和它 —— 否则光标压着一条 4.03 的段落线，亮的却是另一处的小节线 */
const hoverLine = computed(() => {
  const barId = hoverBarId.value || hoverSegBarId.value || hoverRepBarId.value
  if (!props.editMode || !barId) return null
  return bars.value.find((b) => b.id === barId) || null
})

/* ------------------------------- 渲染 ------------------------------- */

let renderToken = 0

/**
 * 渲染一页。**宽度变了就直接重画，不做防抖也不做跳过** ——
 * 拖动、收起 / 展开动画期间都会连着调用它，靠的是 `domain/pdf.js` 的**双缓冲**：
 * 页面先画到离屏 canvas、画完才贴到可见 canvas，所以「被下一次取消」的那些调用
 * 不会在可见画布上留下半成品（以前是每次开画都先把可见画布清空铺白 → 一路全白）。
 */
async function doRender() {
  const r = renderer.value
  const cv = canvas.value
  if (!r || !cv || !props.render) return
  const token = ++renderToken
  rendering.value = true
  try {
    const res = await r.render(props.pageIndex + 1, cv, props.cssWidth)
    // 被取消的那一次返回 null（画布上还是上一张完整的图）—— 不算画过、也不报错
    if (token === renderToken && res) emit('rendered', props.pageIndex)
  } catch (err) {
    if (token === renderToken) console.warn('页面渲染失败', err)
  } finally {
    if (token === renderToken) rendering.value = false
  }
}

function release() {
  const cv = canvas.value
  if (!cv) return
  cv.width = 0
  cv.height = 0
}

watch(
  () => [props.render, props.cssWidth, renderer.value],
  ([shouldRender]) => {
    if (shouldRender) doRender()
    else release()
  }
)

onMounted(() => {
  if (props.render) doRender()
})

onBeforeUnmount(() => {
  renderToken++
})

/* ----------------------------- 交互处理 ----------------------------- */
/*
 * 手势约定（**接管之后**鼠标与触屏一致；「谁先接管」在下面的「手势策略」里按指针类型分）：
 *   · 接管期间谱面区域**不参与滚动**（`touch-action: none` 或 preventDefault）——
 *     所以接管了就一定是在标记：非编辑模式拖出框选，编辑模式拖出「行」或把标记放到松手的位置
 *   · 点按（位移不超过 TAP_SLOP）保留原来的语义：点小节跳转 / 点已标记的行、小节线删除 /
 *     点段落打开设置 / **点反复 = 有标记就删、没有就加一个（类型按落点定）**
 *   · 拖动 = 落点预览跟着手指走，松手才真正落下（`ghost` / `targetBarId` / `marquee`）
 */
const drag = ref(null) // { x0,y0,x1,y1,pointerType,moved,mode,own }
const marquee = ref(null) // 框选 / 行带预览
/* 拖动中的框选预演（把盖住的小节当场标灰）看的是 `marquee`；它俩都定义在这里，
   `dragRange` 是上面那个 computed、赋值晚于本行 —— 所以它只把 `marquee` 读在函数体里，
   别搬到模块顶层去读。 */
const ghost = ref(null) // 小节线拖动预览：{ x, y0, y1, systemId }
const targetBarId = ref(null) // 段落 / 反复拖动预览：候选小节线
/**
 * 行工具这一次拖动**被拒绝**了（预览带是灰色那一档 —— 只压住某个已有行的一半，见 `updateBand`）。
 * 只当「已经拖动」用的标记位：有了它，松手时就不能再退回「点按 = 删除该行」那一路 ——
 * 手势已经越过了 TAP_SLOP，用户想的是划线、不是删行，退回删行就太危险了。
 * **整条套住不算拒绝**（那是红色的拆行），所以这里为真时松手确实什么都不落。
 */
const rowBlock = ref(false) // 行工具：这一次拖动拖出来的区间不能落下来（灰色档：太扁 / 只压住已有行的一半 / 套住却拆不成）
/**
 * 行工具这一笔**为什么**不成立，松手时按它给 toast（`updateBand` 里算，见那里的两支）：
 * `tooThin`（划出来的区间本身不够高）/ `splitTooThin`（套住的那条行拆成两半之后不够高）。
 * 只是提示文案的选择 —— **成不成立只看 `rowBlock`**，文案取不到时回落到重叠那条。
 */
const reject = ref(null)
const TAP_SLOP = 10 // CSS px，超过它才算拖动
const MARQUEE_SLOP = 14 // 框选会立刻开始循环播放，阈值比 TAP_SLOP 再宽一点，免得点一下就被当成框选

/**
 * 行高下限换算成 **pt**（本页当前缩放下的一档点击尺寸，`ROW_MIN_PX` = `--tap` = 46 CSS px）。
 * 与 `TAP_SLOP` 那几个容差同一个写法：**CSS px 除以 `scale` 才是 pt**（行一律存 pt，见 invariants）。
 * ⚠️ **只此一处换算**：预览带（`rowBounds` / `updateBand`）与落下的那一笔（`system-add` 的 `minH`）
 * 必须用同一个值，否则会出现「预览是灰的、松手却落下来了」这种自相矛盾。
 * `scale` 取不到（0）时退回 `DEFAULT_MIN_H`，别让它算出 Infinity 把行全判成太扁。
 */
const minRowHeight = computed(() => (scale.value > 0 ? ROW_MIN_PX / scale.value : DEFAULT_MIN_H))

function toLocal(e) {
  const r = root.value?.getBoundingClientRect()
  if (!r) return { x: 0, y: 0 }
  return { x: (e.clientX - r.left) / scale.value, y: (e.clientY - r.top) / scale.value }
}

/**
 * 行工具这一次拖动要落的那一行（**meta 的 y-up**，已夹进页面）。
 *
 * 拖出来的 y 是 overlay 坐标（向下）、meta 是 PDF 的 y-up，所以这里是「写 meta」那道边界上的
 * 那一次翻转：翻完屏幕上边成了较大的值，再交给 `clampToPage` 去 min/max + 夹进页高。
 * **夹取是必须的**：拖到页外时落下的行会和页面边界对不上（`clampToPage` 顺带挡掉太扁 / NaN，
 * 所以屏幕上不够 `ROW_MIN_PX` 高的那一笔到这里就没有区间可落了 —— 见 `domain/rows.js`）。
 */
function rowBounds(d) {
  return clampToPage(flipY(Math.max(d.y0, d.y1)), flipY(Math.min(d.y0, d.y1)), pageH.value, minRowHeight.value)
}

/**
 * 按 y 命中的那一行（只比 y，不比 x —— 行是整页宽的；`tol` 是 hitSystem 那套容差，命中行本身时给 0）。
 *
 * **传进来的 `y` 是 overlay 坐标（y 向下），而 meta 是 PDF 的 y-up，所以这里要先翻转再比。**
 * 上下沿用 min/max 夹一下：`y0 < y1`（下沿小、上沿大）是 `addSystem` 写出来的约定，
 * 但外来 JSON 里两个值可能反着写（schema 只保证它们都是数字，OMR 的 truth 就是 y0 > y1），
 * 照字面比较就会出现「落在行里却命中不到」这种情况。翻转与 min/max 一起用才两种数据都对。
 */
function hitSystem(y, tol = 6) {
  for (const s of props.pageMeta.systems || []) {
    const a = flipY(s.y0)
    const b = flipY(s.y1)
    if (y >= Math.min(a, b) - tol && y <= Math.max(a, b) + tol) return s
  }
  return null
}

function hitBar(system, x, tol) {
  let best = null
  let bd = Infinity
  for (const b of system.bars || []) {
    const d = Math.abs(b.x - x)
    if (d < bd) {
      bd = d
      best = b
    }
  }
  return bd <= tol ? best : null
}

/** 命中小节：同样要把 meta 的 y 翻过来再比（`props.measures` 是 structure 给的 y-up 值） */
function hitMeasure(x, y) {
  return (
    props.measures.find((m) => {
      const a = flipY(m.y0)
      const b = flipY(m.y1)
      return y >= Math.min(a, b) && y <= Math.max(a, b) && x >= m.hitX0 && x <= m.hitX1
    }) || null
  )
}

function nearestBar(system, x) {
  let best = null
  let bd = Infinity
  for (const b of system.bars || []) {
    const d = Math.abs(b.x - x)
    if (d < bd) {
      bd = d
      best = b
    }
  }
  return best
}

/**
 * 小节线工具的**删除判定区**（命中 ⇔ 点下去会删掉这条线）—— **判据只此一处**，点按与悬停共用：
 *   纵向 = 行上下沿 ± `8 / scale`；横向 = 线的左右 ± `12 / scale`（CSS px 换算成 pt，见 TAP_SLOP 那段）。
 * 返回 `{ system, bar }`：`system` = 光标落在哪一行（不在任何行里就是 null）；
 * `bar` = 落进判定区的那条线（区外为 null —— 那时点下去是**新建**）。
 */
function hitBarZone(x, y) {
  const system = hitSystem(y, 8 / scale.value)
  return { system, bar: system ? hitBar(system, x, 12 / scale.value) : null }
}

/**
 * 段落工具：按**画出来的那条标记**命中段落。
 *
 * 线落在拍上，**不再等于小节线**了 —— 所以不能再拿「最近的小节线上有没有段落」来判：
 * 4.03 那条线离小节线可能大半小节远，那样点它会在别处新增一条，而不是打开它自己的设置。
 * 命中范围分两块，**两块都算命中**（名牌是这块标记上最显眼、也最好点的一块）：
 *   · 竖直方向 = **整根杆子**（名牌顶边 → 行底）加减 `tol`：线是跨行的、还往上挑着名牌。
 *   · 横向 = 线的左右 `tol`（与点按 / 悬停同一档容差），**或者落在名牌那块矩形里**
 *     （`left … left + w`，见 `segmentGeometry`）—— 名牌横向最宽能铺满整个纸面（不截断），
 *     只认线的话「点着牌子上的字却没反应」。名牌命中取 `d = 0`（优于线），
 *     所以牌压着旁边一条线时，先打开的是这块牌自己的段落。
 *   · 名牌的矩形**不额外放容差**：相邻两段落的牌可能离得很近（同一小节里的 4.01…4.04），
 *     再放一圈容差就会互相抢，命中结果变得看遍历顺序。
 */
function hitSegmentMark(x, y, tol) {
  let best = null
  let bd = Infinity
  for (const mk of segmentMarks.value) {
    if (y < mk.top - tol || y > mk.lineBottom + tol) continue
    const inFlag = x >= mk.left && x <= mk.left + mk.w && y <= mk.top + SEG_H + tol
    const d = inFlag ? 0 : Math.abs(mk.x - x)
    if (d <= tol && d < bd) {
      bd = d
      best = mk
    }
  }
  return best
}

/**
 * 反复工具：这一笔是不是落在**房子括号**上（是的话返回**该删的那条标记**的 barId）。
 *
 * 为什么得单独判一下：括号画在**行顶上方**（`HOUSE_UP`，房子 → 别针 → 名牌三层栈的最上面），
 * 离行有 60 pt 上下，`hitSystem` 那一档容差（8 CSS px）根本够不着它 —— 只走「命中小节线」那一路的话，
 * 点括号**一点反应也没有**。用户要的是「线和括号都删房子 1 起点标记」：
 * 线上的那条细竖条（房子 1 起点标记本体）本来就能删，**括号这边补上同一个删除目标**
 * （`barId` 在 `houseBrackets` 里就算好了 —— 房子 2 没有自己的标记，两条括号删的都是房子 1 起点）。
 *
 * 命中范围 = 括号**画出来的那一块**，横向再放 `tol`（两条竖钩很细，全靠这点容差好点）、
 * 纵向放得**比 `tol` 小**（`6 / scale`）：横线（`y + 2`）到「1. / 2.」标签的下沿（`y + 15`，
 * 字号 13、基线在 `y + 12`）。纵向不敢放满 —— 再往下就是**这一行的小节号别针**（行顶往上 20…50pt）
 * 和**上面那一行**，放满了会在那儿抢点击。
 */
function hitHouseBracket(x, y, tol) {
  const padY = Math.min(tol, 6 / scale.value)
  for (const h of houseBrackets.value) {
    if (!h.barId) continue
    if (x >= h.x0 - tol && x <= h.x1 + tol && y >= h.y + 2 - padY && y <= h.y + 15 + padY) return h.barId
  }
  return null
}

/**
 * 行工具这一次拖动的预览带**属于哪一档**，也是松手时那一笔的结局（三档互斥，见 `updateBand`）：
 *   · `new`     —— 与已有的行都不沾：**蓝色**，松手落一条新行；
 *   · `overlap` —— 这一笔什么都没落：只压住某条已有行的一半（一端伸到行外，或与别的行相交）、
 *                  区间不够高（屏幕上不到 `ROW_MIN_PX`）、或者整条套住一条行但那条行**拆不成**（见下）：
 *                  **灰色**，松手整条都不加（`rowBlock` 为真）；
 *   · `split`   —— 整条套在某条已有行内部、而且**拆得成**（上下两半在屏幕上也各有一档点击尺寸）：
 *                  **红色**，松手把那条行拆成上下两条并克隆标记。
 * 灰色与红色都表示「这一笔不会落成一条新行」，区别只在**是拒绝、还是拆掉已有的一条**；
 * 所以落法只有 `new` / `split` 两种，`overlap` 是唯一什么都不做的
 * （`rowBlock` 只管「松手别再退回点按 = 删行」，与给哪一条 toast 无关）。
 */
const BAND_KIND = { new: 'new', overlap: 'overlap', split: 'split' }

function updateBand(d) {
  if (d.mode === 'row') {
    // 预览带就是**将要落下的那一条行**：先把区间夹进页面，再换算回 overlay 显示，所见即所得。
    // 三档的判据（顺序就是优先级）：夹不出区间（屏幕上不够 `ROW_MIN_PX` 高 / 拖到页外）→ overlap；
    // 整条套住某条已有行**而且拆得成** → split（拆行）；与已有行相交 → overlap；都不沾 → new
    const box = rowBounds(d)
    const minH = minRowHeight.value
    // `containingSystem` 返回 null 有两种情形：压根没套住，或者套住了但拆不成（那条行太扁）。
    // 后者要单独认出来 —— 松手时给的是「拆不成」那条 toast，不是「重叠」那条
    const inside = box ? containingSystem(props.pageMeta.systems, box.lo, box.hi, minH) : null
    const kind = !box ? BAND_KIND.overlap : inside ? BAND_KIND.split : overlapSystem(props.pageMeta.systems, box.lo, box.hi) ? BAND_KIND.overlap : BAND_KIND.new
    rowBlock.value = kind === BAND_KIND.overlap
    // 这一笔被拒绝的原因（松手时按它给 toast；`new` / `split` 落得成，用不上）：
    // 套住但拆不成 → 原行太扁；没套住又夹不出区间 → 划的区间本身太扁（拖到页外也一样按这个说）
    reject.value = inside ? 'splitTooThin' : 'tooThin'
    // 被拒绝时没有合法的区间可显示，退回指针拖出来的原始范围（只当一块「这块地方不行」的提示）
    const y0 = box ? flipY(box.hi) : Math.min(d.y0, d.y1)
    const y1 = box ? flipY(box.lo) : Math.max(d.y0, d.y1)
    marquee.value = { x0: 0, y0, x1: props.pageMeta.width, y1, row: true, kind }
    return
  }
  rowBlock.value = false
  reject.value = null
  if (d.mode === 'marquee') {
    marquee.value = { x0: Math.min(d.x0, d.x1), y0: Math.min(d.y0, d.y1), x1: Math.max(d.x0, d.x1), y1: Math.max(d.y0, d.y1) }
  }
}

/** 拖动中的落点预览：小节线跟着指针走，段落 / 反复吸附到指针附近的那条线 */
function updatePreview(d) {
  if (!props.editMode) {
    ghost.value = null
    targetBarId.value = null
    return
  }
  const tol = 12 / scale.value
  if (props.tool === 'barline') {
    const sys = hitSystem(d.y1, tol)
    // 预览线是**画在 overlay 上**的，所以要拿翻过来的上下沿（sys 本身是 meta 的 y-up）
    ghost.value = sys ? { x: d.x1, y0: flipY(sys.y0), y1: flipY(sys.y1), systemId: sys.id } : null
    targetBarId.value = null
  } else if (props.tool === 'segment' || props.tool === 'repeat') {
    const sys = hitSystem(d.y1, tol)
    const bar = sys ? hitBar(sys, d.x1, tol) : null
    targetBarId.value = bar?.id || null
    ghost.value = null
  } else {
    ghost.value = null
    targetBarId.value = null
  }
}

const targetBar = computed(() => (targetBarId.value && props.structure.barInfo.get(targetBarId.value)) || null)

/* ------------------------------ 手势策略 ------------------------------ */

/**
 * 抓手 / 指针**只对触屏有区别，鼠标两种模式完全一样**（用户明确要求「对于鼠标来说抓手和指针应当没有区别」）：
 *
 *   鼠标（两种模式、编辑与否都一样）：**按下就接管** —— 点 = 跳转 / 标记，拖 = 框选 / 划行 / 放线。
 *   触屏 + 指针：**按下就接管、跟手**，这一层不滚页（`touch-action: none`）。
 *   触屏 + 抓手：**这一层完全不接管拖动** —— 滑动就是原生滚谱，
 *     我们只认「点一下」：非编辑点小节跳转、编辑点标记 / 删行，与鼠标的单击同一套语义。
 *     **想在触屏上框选 / 划行 / 放线，就切到指针模式。**
 *
 * ⚠️ **双指缩放全站已禁**（`main.css` 的 `html { touch-action: pan-x pan-y }` + `main.js` 里的 gesture 兜底，
 *   见 `docs/ui.md` §18.46）：所以抓手那条 `touch-action: auto` 的**生效值只有 `pan-x pan-y`** ——
 *   「原生滚谱」不包含捏合。**别在这个组件里再写任何 `touch-action`**：全站只有 `html` 那一处收窄点。
 *
 * ⚠️ **别给触屏抓手加「先长按再拖」** ——
 * 长按在真机上要靠「比浏览器早到点的计时器 + preventDefault 抢手势」才成立，
 * 而 `touch-action: auto`（原生滚动的代价）下浏览器随时可能先滚起来并发 `pointercancel` 抢走这一笔，
 * 那是一场赢不了的竞速。**别加**：真要在触屏上框选，用指针模式；
 * 真想再要「长按」这类手势，得先决定是否放弃原生滚动（改成自己接管 `scrollTop`）。
 *
 * 「这一笔归不归我们」只看 `own`（在 `onPointerDown` 里算一次）：鼠标恒为真，触屏看 `pointerMode`。
 * 不归我们的那一笔**只当点按处理**（`onPointerUp` 里那条 `!d.own` 分支），其余整个交给浏览器。
 */

/** 只有**归我们**的那一笔才挡浏览器滚动：不归我们的正是一次滑动，挡了谱面就再也滚不动了 */
function onTouchMove(e) {
  if (drag.value?.own && e.cancelable) e.preventDefault()
}

function onPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const p = toLocal(e)
  rowBlock.value = false // 上一笔的拒绝态不跨手势（连它拒绝的理由一起清掉）
  dragMode.value = null // 同理：上一笔的框选预演不跨手势（真正生效的框选在 props.selection 里，不受影响）
  hoverBarGhost.value = null // 悬停那一层落点预览让给拖动预览（`ghost`），免得同一个位置叠两条线
  // 鼠标恒归我们；触屏只有指针模式归我们（抓手模式整笔让给浏览器滚）
  const own = e.pointerType !== 'touch' || props.pointerMode
  const d = {
    x0: p.x,
    y0: p.y,
    x1: p.x,
    y1: p.y,
    pointerType: e.pointerType,
    moved: false,
    mode: null,
    own,
  }
  drag.value = d
  // 不归我们的（抓手 + 触屏）：这一笔是浏览器的，我们只在 pointerup 上看它算不算一次点按
  if (!own) return
  // 按下就先给出落点预览，用户不用先拖再猜
  updatePreview(d)
  try {
    root.value?.setPointerCapture?.(e.pointerId)
  } catch {}
}

/** 一次 pointermove 把几个悬停目标都算清：只有当前工具那一个会真的高亮 */
function clearHover() {
  hoverSystemId.value = null
  hoverBarId.value = null
  hoverBarGhost.value = null
  hoverSegId.value = null
  hoverSegBarId.value = null
  hoverRepBarId.value = null
}

/**
 * 悬停命中：**按当前工具算**，编辑什么就高亮什么（与点击命中共用下面那几个 hit 函数）。
 * 只认鼠标：触屏没有 hover，也不该在点完之后留下一块高亮。
 */
function updateHover(e) {
  // 「标记列表」开着：全谱的标记都是灰的，悬停再亮起一条会跟「列表里点的那一项」抢屏幕，
  // 也让「哪一项对应谱面哪儿」这件事变得没法看 —— 这一整套悬停直接不参与
  if (props.marksOpen) {
    clearHover()
    return
  }
  if (e.pointerType !== 'mouse') return
  const p = toLocal(e)
  if (!props.editMode) {
    clearHover()
    return
  }
  const tol = 12 / scale.value
  if (props.tool === 'row') {
    // 行：高亮光标所在的那一整行（按 y 命中小节，与这行有没有小节线无关）。
    // 容差给 0：行的上下沿就是要命中范围的边界，给容差会让相邻两行在缝里同时算命中
    const sys = hitSystem(p.y, 0)
    const sid = sys ? sys.id : null
    if (hoverSystemId.value !== sid) hoverSystemId.value = sid
    if (hoverBarId.value) hoverBarId.value = null
    if (hoverBarGhost.value) hoverBarGhost.value = null
    if (hoverSegId.value) hoverSegId.value = null
    if (hoverSegBarId.value) hoverSegBarId.value = null
    if (hoverRepBarId.value) hoverRepBarId.value = null
    return
  }
  if (hoverSystemId.value != null) hoverSystemId.value = null
  // 小节线工具这一支**独占**，判据与点按同一套（`hitBarZone`）：
  //   落在**删除判定区**里 → 高亮那一条线（它的别针 / 小节号跟着一起亮）；
  //   落在行里但不在判定区里 → **不亮任何线**，改在指针处给「点下去会在这儿新建一条线」的落点预览。
  // 预览与点按是同一件事的两种说法：有预览的地方点下去一定新增，没预览又没高亮的地方点下去什么都不发生。
  if (props.tool === 'barline') {
    const zone = hitBarZone(p.x, p.y)
    hoverBarId.value = zone.bar ? zone.bar.id : null
    hoverBarGhost.value =
      zone.system && !zone.bar ? { x: p.x, y0: flipY(zone.system.y0), y1: flipY(zone.system.y1) } : null
    if (hoverSegId.value) hoverSegId.value = null
    if (hoverSegBarId.value) hoverSegBarId.value = null
    if (hoverRepBarId.value) hoverRepBarId.value = null
    return
  }
  hoverBarId.value = null
  hoverBarGhost.value = null
  const system = hitSystem(p.y, tol)
  const bar = system ? hitBar(system, p.x, tol) : null
  // 段落 / 反复落在小节线上，所以命中范围放宽到「最近的那条线」，和点击时一致
  const near = system && !bar ? nearestBar(system, p.x) : null
  const barId = (bar || near)?.id || null
  // 反复线**空线上也高亮**：现在点一下就是「在这儿加一个反复」（落点定类型），
  // 高亮的是「点下去会落在哪条线」，不再只是「这条线上已经有标记」。
  // **房子括号也算这一路**（点它就是删「房子 1 起点」，见 `hitHouseBracket`）：悬停到括号时
  // 把高亮指到**房子 1 起点那条线**上 —— 括号画在行顶上方，不这样「点它会删掉什么」根本看不出来。
  const houseBarId = props.tool === 'repeat' ? hitHouseBracket(p.x, p.y, tol) : null
  hoverRepBarId.value = props.tool === 'repeat' ? houseBarId || barId : null
  if (props.tool === 'segment') {
    // 先看有没有压在**某条已有的段落线**上（它画在拍上，得按自己的 x 命中）；
    // 没命中才把「最近的小节线」当候选 —— 点下去会在那儿新增一条段落
    const mark = hitSegmentMark(p.x, p.y, tol)
    hoverSegId.value = mark ? mark.seg.id : null
    hoverSegBarId.value = mark ? null : barId
  } else {
    hoverSegId.value = null
    hoverSegBarId.value = null
  }
}

function onPointerMove(e) {
  const d = drag.value
  if (!d) return updateHover(e)
  const p = toLocal(e)
  d.x1 = p.x
  d.y1 = p.y
  const dx = Math.abs(d.x1 - d.x0) * scale.value
  const dy = Math.abs(d.y1 - d.y0) * scale.value
  if (!d.moved && (dx > TAP_SLOP || dy > TAP_SLOP)) d.moved = true

  // 这一笔不归我们（抓手 + 触屏）：什么都别做 —— 不画预览、不 preventDefault，
  // 连 `moved` 也照常记（pointerup 要靠它判断这算不算一次点按）
  if (!d.own) return
  if (!d.mode) {
    if (!props.editMode) {
      if (dx > MARQUEE_SLOP || dy > MARQUEE_SLOP) d.mode = 'marquee'
    } else if (props.tool === 'row' && d.moved) {
      d.mode = 'row'
    }
    // 只有真的进了框选这一路才把灰底预演打开（见 `dragRange`）
    dragMode.value = d.mode
  }
  if (d.mode) updateBand(d)
  updatePreview(d)
  if (d.mode || d.moved) e.preventDefault()
}

function onPointerUp(e) {
  const d = drag.value
  drag.value = null
  const box = marquee.value
  marquee.value = null
  dragMode.value = null
  ghost.value = null
  targetBarId.value = null
  if (!d) {
    rowBlock.value = false
    return
  }
  const p = toLocal(e)
  d.x1 = p.x
  d.y1 = p.y

  // 这次手势没轮到我们（抓手 + 触屏）：**最多只当一次点按** ——
  // 抬手前没怎么动 = 点了一下（非编辑跳转 / 编辑标记），动过就什么都不补（那本来就是一次滑动）。
  // 浏览器真滚起来的情况根本走不到这儿 —— 那时它发的是 pointercancel。
  if (!d.own) {
    if (!d.moved) {
      if (props.editMode) handleEditTap(d.x1, d.y1)
      else handlePlayTap(d.x1, d.y1)
    }
    return
  }

  // 行带：松手才落下一整行。
  // **这里是「写 meta」的那道边界**：拖出来的 y 是 overlay 坐标（向下），存进 meta 之前必须翻成
  // PDF 的 y-up —— 这一翻连同「夹进页面」都收在 `rowBounds` 里（预览带用的是同一支，
  // 所以松手落下的正是刚才看到的那一条）。落下的 `lo/hi` 已经过了 min/max，即 y0=下沿、y1=上沿，
  // 与 `docs/data-format.md` 的 score.json 示例一致。
  //
  // **`moved` 是必须的**（和小节线工具同一个门槛）：只按「有没有 `box.row`」分支的话，
  // 一次带 10–20 CSS px 纵向抖动的手指点按 —— 位移越过了 TAP_SLOP、于是 `updateBand` 已经画出了
  // 带子 —— 会落到「拖出这一行」这一路去，把用户真正想做的「点一下删掉这一行」顶掉；
  // 那种抖动本来就该按点按处理（和小节线 / 段落 / 反复一致），没拖动就没有带子可落。
  if (box?.row && d.moved) {
    // 这一笔什么都没落：屏幕上不够 `ROW_MIN_PX` 高、只压住已有行的一半、
    // 或者套住一条行却拆不成（那条行不够两条最小行的高度）。
    // 行工具是「点已有行 = 删」，这里退回删行太危险（用户明明是在划线），所以只报一条 toast，
    // 什么都不改 —— **整条套住不算这一支**（那是拆行，`store/player.js` 的 `addSystem` 会处理）。
    // 理由（`reject`）由 `updateBand` 判定时一起算好，这里不再重算一遍判据
    if (rowBlock.value) {
      const why = reject.value === 'splitTooThin' ? 'store.row.splitTooThin' : reject.value === 'tooThin' ? 'store.row.tooThin' : 'store.row.overlap'
      toast(t(why, { min: ROW_MIN_PX }))
      return
    }
    const bounds = rowBounds(d)
    // `updateBand` 已经判过同样的条件了，这是兜底：夹出来的区间取不到时不发事件
    // （预演与落点必须出自同一支 `rowBounds`，别各算一份）
    if (bounds) emit('system-add', { pageIndex: props.pageIndex, y0: bounds.lo, y1: bounds.hi, minH: minRowHeight.value })
    return
  }
  // 框选：落成小节区间（会立刻开始循环播放）。
  // 命中范围与拖动中的灰底预演**共用 `measuresInBox`** —— 预演亮的就是这里要循环的那一段
  if (box) {
    const range = measuresInBox(box)
    if (range) emit('select', range)
    return
  }
  if (props.editMode) {
    // 小节线：拖动 = 把线放到松手的位置；纵向容差放宽，拖歪一点也认
    if (props.tool === 'barline' && d.moved) {
      const sys = hitSystem(d.y1, 24 / scale.value)
      if (sys) emit('bar-add', { systemId: sys.id, x: Math.max(0, Math.min(props.pageMeta.width, d.x1)) })
      return
    }
    return handleEditTap(d.x1, d.y1)
  }
  handlePlayTap(d.x1, d.y1)
}

function handlePlayTap(x, y) {
  const m = hitMeasure(x, y)
  if (m) emit('measure-tap', m.no)
  else emit('blank-tap')
}

function handleEditTap(x, y) {
  const tol = 12 / scale.value
  const system = hitSystem(y, 8 / scale.value)
  if (props.tool === 'row') {
    if (system) emit('system-remove', system.id)
    return
  }
  // 段落这一路**必须先于下面那道 `if (!system) return`**：名牌挂在**行顶上方**
  // （行顶往上：名牌 → 缝 → 别针，见 `segmentGeometry`），点牌子时 y 早就出了这一行 ——
  // 先按 system 筛的话，点名牌会被静默吃掉（`hitSystem` 只给 8 CSS px 的空隙）。
  // 命中了牌子 / 线就打开它自己；没命中才回到「落在最近的小节线上新增」那一路。
  if (props.tool === 'segment') {
    const mark = hitSegmentMark(x, y, tol)
    if (mark) emit('segment-open', mark.seg.id)
    else if (system) {
      const target = hitBar(system, x, tol) || nearestBar(system, x)
      if (target) emit('segment-add', target.id)
    }
    return
  }
  // 反复这一路**同样必须先于 `if (!system) return`**（理由和段落那条一样）：房子括号画在
  // **更高的那一层**（`HOUSE_UP`，行顶往上 60 多 pt），点它时 y 早就出了这一行。
  // **点括号 = 删掉「房子 1 起点」标记**（用户要的「线和括号都删房子 1 起点标记」）；
  // 括号没命中才回到「线上的标记：有就删、没有就按落点加一个」那一路。
  if (props.tool === 'repeat') {
    const houseBarId = hitHouseBracket(x, y, tol)
    if (houseBarId) {
      emit('repeat-toggle', houseBarId)
      return
    }
    if (!system) return
    const target = hitBar(system, x, tol) || nearestBar(system, x)
    // **这一个事件就够了** —— 线上已经有标记就是删，没有就是加（类型由 store 按落点定）
    if (target) emit('repeat-toggle', target.id)
    return
  }
  // 小节线：命中判定与悬停**共用 `hitBarZone`**（同一档容差）——
  // 判定区里点 = 删那条线，行内区外点 = 在光标处新建一条
  const zone = hitBarZone(x, y)
  if (zone.bar) emit('bar-remove', zone.bar.id)
  else if (zone.system) emit('bar-add', { systemId: zone.system.id, x })
}

function onPointerCancel() {
  drag.value = null
  marquee.value = null
  dragMode.value = null
  ghost.value = null
  targetBarId.value = null
  rowBlock.value = false
  reject.value = null
}

/* 切工具 / 进出编辑模式 / 抓手↔指针 时把悬停清掉：高亮的是「另一种元素」了，
   而鼠标不动就不会再触发 pointermove，旧高亮会一直挂在那儿 */
watch(() => [props.tool, props.editMode, props.pointerMode], clearHover)

/* 光标**这一轮不动**（谱面不声明 cursor，就是系统默认箭头）：`tool-*` 那个类名从很早就在绑，
   全仓从来没有对应的 CSS，保持原样 —— 别顺手补 `grab` / `crosshair`。理由写在上面那条注释里 */
const cursorClass = computed(() => (props.editMode ? `tool-${props.tool}` : 'tool-play'))

/**
 * 「标记列表」里点过的那一项（`{ key, page, y0, y1, tick }`）。
 *
 * **只有本页的那一项才在这张纸上闪**（`markFocus.page` 对得上），并且闪的是**同一个 key**：
 * 行的 key 是它自己的 `id`（`markFocus.key` 就是 `structure.systems[].id`，和模板里的 `sys.id` 是同一个串），
 * 小节线 / 段落 / 反复各自是 `br_*` / `sg_*` / `rp_*`。
 * `tick` 进了下面模板里的 `:key` —— 同一个目标连点两次时节点会重建，动画因此重播一遍。
 */
const focus = computed(() => (props.markFocus && props.markFocus.page === props.pageIndex ? props.markFocus : null))
</script>

<template>
  <div
    ref="root"
    class="score-page"
    :class="[cursorClass, { 'no-gestures': !pointerMode }]"
    :style="{ width: cssWidth + 'px', height: cssHeight + 'px' }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerleave="clearHover"
    @touchmove="onTouchMove"
    @contextmenu.prevent
  >
    <canvas v-show="render" ref="canvas" class="page-canvas" />
    <div v-if="!render" class="page-skeleton" />

    <!-- `@contextmenu.prevent` 与长按手势无关（那套逻辑已经删了），留着是为了**手机**：
         Android 不认 `-webkit-touch-callout: none`（main.css 那条只对 iOS 有效），
         手指在谱面上停久一点就会弹出「下载图片 / 全选」这类系统菜单 —— 那在谱面上纯属打扰。
         也顺手对上「全项目不用右键」这条约定（见 docs/ui.md §18.36，此前只有两处浮层挡过）。 -->

    <svg
      v-if="render"
      class="page-overlay"
      :width="cssWidth"
      :height="cssHeight"
      :viewBox="`0 0 ${pageMeta.width} ${pageMeta.height}`"
      preserveAspectRatio="none"
    >
      <!-- 行（只在编辑模式画：非编辑模式的谱面就是原始 PDF，不带任何标记）
           行标记 = **整行铺一层浅底 + 上下两条边线**：底让人一眼看出「这一行被标记了」，
           边线给出这一行的上下沿。**不画左右竖边** —— 行顶满整页宽，左右边界没有意义，
           画出来只会和两端的小节线糊在一起 -->
      <g v-if="editMode" class="lyr-systems">
        <g
          v-for="sys in systems"
          :key="focus && focus.key === sys.id ? `${sys.id}:${focus.tick}` : sys.id"
          :class="{ muted: marksOpen || tool !== 'row', hover: hoverSystem && hoverSystem.id === sys.id, 'focus-flag': !!focus && focus.key === sys.id }"
        >
          <!-- 行底：y 取两条边线中较小的那个（= 屏幕上靠上的那条），高取两者之差 ——
               不能写 y0 / (y1 − y0)：y0 与 y1 谁大谁小取决于数据，写反了 height 会变成负数被夹成 1pt，
               行底就只剩一条看不见的细缝（这个 bug 犯过一次） -->
          <rect
            :x="0"
            :y="Math.min(sys.y0, sys.y1)"
            :width="pageMeta.width"
            :height="Math.max(1, Math.abs(sys.y1 - sys.y0))"
            class="sys-fill"
          />
          <line :x1="0" :y1="sys.y0" :x2="pageMeta.width" :y2="sys.y0" class="sys-edge" />
          <line :x1="0" :y1="sys.y1" :x2="pageMeta.width" :y2="sys.y1" class="sys-edge" />
        </g>
      </g>

      <!-- 当前小节 / 跳跃闪烁 / 播放头的显示规则**三样是分开的**（用户明确要求，见 `docs/ui.md` §18.46）：
           · 当前小节与播放头：**只要有位置就画** —— 播放 / 暂停 / 停止 / 预备拍都画，只有编辑模式不画。
             暂停时看不见自己停在哪一小节、这一小节停在第几拍，正是这次要修的问题；
           · 跳跃闪烁：**两道**，显示条件不同 —— `jumpFlash`（跳转前）在播放与预备拍里画、
             `jumpAfter`（跳转后）只要状态在就画（见那两个 computed 的注释）。
           · **`jumpFlash` 落在同一小节上时，当前小节这层底要让位**（`!flashOnActive`）——
             否则两层半透明底叠在一起，看到的只是「亮着、微微变深」而不是空白 ↔ 底色的一下一下
             （预备拍里那道闪烁就要和「跳转前闪烁」一模一样，见 `flashOnActive` 的注释）。
           编辑模式尤其不能留：那时谱面上只有标记，「播到哪了」混在一起就分不清哪个框是标记、哪个是状态了。
           当前小节只有一层浅底、**不描边**；`rx/ry` 是四个角一起圆（SVG 没有「只圆某几个角」
           的写法），作为「当前小节」的形状特征与其余直角标记区分开 -->
      <rect
        v-if="!editMode && activeMeasure && !flashOnActive"
        :x="activeMeasure.x0"
        :y="Math.min(activeMeasure.y0, activeMeasure.y1)"
        :width="Math.max(0.5, activeMeasure.x1 - activeMeasure.x0)"
        :height="Math.max(0.5, Math.abs(activeMeasure.y1 - activeMeasure.y0))"
        :rx="ACTIVE_RADIUS"
        :ry="ACTIVE_RADIUS"
        class="m-active"
        :class="{ playing, plain: !editMode }"
      />
      <!-- 跳跃闪烁**两道**（见上面两个 computed）：`jumpFlash`（跳转前：每拍闪一次、重复一整个小节）
           与 `jumpAfter`（跳转后：落点上闪一下）。**两层同时存在是有意的** —— 手动点跳转时
           「跳到这里了」那一下与预备拍的每拍闪烁要一起出现（用户明确要求），所以不能合成一层。
           `:key` 带 tick：同一个落点连着跳两次、或同一小节先「跳转前」后「跳转后」时，动画都要从头开始。 -->
      <rect
        v-if="jumpFlash"
        :key="'before' + jumpFlash.tick"
        :x="jumpFlash.x0"
        :y="Math.min(jumpFlash.y0, jumpFlash.y1)"
        :width="Math.max(0.5, jumpFlash.x1 - jumpFlash.x0)"
        :height="Math.max(0.5, Math.abs(jumpFlash.y1 - jumpFlash.y0))"
        :rx="ACTIVE_RADIUS"
        :ry="ACTIVE_RADIUS"
        :style="{ '--flash-ms': jumpFlash.ms + 'ms', '--flash-times': jumpFlash.times }"
        class="m-jump-flash is-before"
      />
      <rect
        v-if="jumpAfter"
        :key="'after' + jumpAfter.tick"
        :x="jumpAfter.x0"
        :y="Math.min(jumpAfter.y0, jumpAfter.y1)"
        :width="Math.max(0.5, jumpAfter.x1 - jumpAfter.x0)"
        :height="Math.max(0.5, Math.abs(jumpAfter.y1 - jumpAfter.y0))"
        :rx="ACTIVE_RADIUS"
        :ry="ACTIVE_RADIUS"
        :style="{ '--flash-ms': jumpAfter.ms + 'ms' }"
        class="m-jump-flash is-after"
      />
      <!-- 当前小节内的播放进度（播放头）：与当前小节同一条规则 —— **有位置就画**，只有编辑模式不画 -->
      <line
        v-if="!editMode && progressLine"
        :x1="progressLine.x"
        :y1="progressLine.y0"
        :x2="progressLine.x"
        :y2="progressLine.y1"
        class="m-progress"
      />
      <!-- 框选（循环区间）：谱面灰底、不描边 —— 它是播放状态、不是编辑标记（理由见 `.m-sel` 的注释）。
           **按块画**（同一行里连续的小节合并成一块，见 `selectedMeasures`）：一格格画的话，
           段内相邻两小节之间会露出两个背靠背的小凹口。
           圆角用与当前小节同一档的 `ACTIVE_RADIUS`，但**跨行的行首 / 行尾保持直角**（模块里算好）。 -->
      <rect
        v-for="blk in selectedMeasures"
        :key="blk.key"
        :x="blk.x"
        :y="blk.y"
        :width="blk.width"
        :height="blk.height"
        :rx="blk.radius"
        :ry="blk.radius"
        class="m-sel"
      />

      <!-- 小节号：每条小节线**正上方**一个地图定位图标（有编号的写编号，没编号的留空图标）。
           它属于「小节线」那一类标记，所以跟着小节线工具一起变色。
           放在线层之前，免得图标把线压住 -->
      <g v-if="editMode" class="lyr-numbers" :class="{ muted: marksOpen || tool !== 'barline' }">
        <g
          v-for="n in barNumberMarks"
          :key="focus && focus.key === n.id ? `${n.id}:${focus.tick}` : n.id"
          :class="{ hover: hoverBar && hoverBar.id === n.id, 'focus-flag': !!focus && focus.key === n.id }"
        >
          <!-- 常态位置就固定、**永远不让位**：段落名牌挂在它**下面**那一层（贴行顶，见 `segmentGeometry`）、
               房子括号在它上面一层，三层各占各的，谁也不用躲谁。**顶边固定在 DISC_TOP_UP**、尖端朝下
               （`PIN_H`）—— 所以上下两层的位置都不受别针外形影响 -->
          <!-- 别针尖端往下接的那条杆：一直画到行顶，与小节线同色同粗细，两段因此看起来是一条线。
               它先画、别针压在上面，尖端正落在杆的上端 -->
          <line :x1="n.x" :y1="n.stemY0" :x2="n.x" :y2="n.stemY1" class="m-no-stem" />
          <path :d="n.d" class="m-no-disc" />
          <text v-if="n.label" :x="n.x" :y="n.ty" class="m-no">{{ n.label }}</text>
        </g>
      </g>

      <!-- 小节线：只有选中「小节线」工具时才是主题色，其余工具下退成灰 -->
      <g v-if="editMode" class="lyr-bars">
        <g
          v-for="b in bars"
          :key="focus && focus.key === b.id ? `${b.id}:${focus.tick}` : b.id"
          :class="{ muted: marksOpen || tool !== 'barline', hover: hoverBar && hoverBar.id === b.id, 'focus-flag': !!focus && focus.key === b.id }"
        >
          <line :x1="b.x" :y1="b.y0" :x2="b.x" :y2="b.y1" class="bar-line" />
        </g>
      </g>

      <!-- 房子括号（编辑模式才画；属于「反复」这一类标记）。
           竖直位置：**行顶往上三层栈的最上面**（`HOUSE_UP`）—— 行顶往上是「名牌 → 别针 → 房子」，
           房子不再压在小节号别针那一带上 -->
      <g v-if="editMode" class="lyr-houses" :class="{ muted: marksOpen || tool !== 'repeat' }">
        <g v-for="h in houseBrackets" :key="h.id">
          <path :d="h.d" class="house-bracket" />
          <text :x="h.x0 + 5" :y="h.y + 12" class="house-label">{{ h.label }}</text>
        </g>
      </g>

      <!-- 段落标记：一根**长得像小节线的竖线**（落在 position 的拍上、上端一直伸到名牌）
           + 挂在**行顶上**（别针的下方那一层）的一块横向名牌（房子括号再往上一层）。名牌左边缘贴住线、
           向右展开（牌宽按估算字宽收放）；几何全在 `segmentGeometry` 里算好，模板只摆位置 -->
      <g v-if="editMode" class="lyr-segments" :class="{ muted: marksOpen || tool !== 'segment' }">
        <g
          v-for="s in segmentMarks"
          :key="focus && focus.key === s.seg.id ? `${s.seg.id}:${focus.tick}` : s.seg.id"
          :class="{ hover: hoverSegMark && hoverSegMark.seg.id === s.seg.id, 'focus-flag': !!focus && focus.key === s.seg.id }"
        >
          <line :x1="s.x" :y1="s.lineTop" :x2="s.x" :y2="s.lineBottom" class="seg-line" />
          <g :transform="`translate(${s.left} ${s.top})`">
            <rect x="0" y="0" :width="s.w" :height="SEG_H" rx="4" class="seg-flag" />
            <!-- 文字**横向、左对齐**：x 是 SEG_PAD（与牌宽算式同一个值）、y 取半个牌厚配
                 `dominant-baseline: central` 在牌里垂直居中 -->
            <text :x="SEG_PAD" :y="SEG_H / 2" class="seg-text">{{ s.label }}</text>
          </g>
        </g>
      </g>

      <!-- 反复标记：只有 start / end / house1 起点三种（房子 2 是上面的括号，不是标记）。
           反复开始 = 实线 + 右侧一条细线 + 右边两点；反复结束 = 同样的形状翻到左边；
           房子 1 起点 = 一条细竖条。**形状是这三种之间唯一的区分手段**（配色一样）。
           `pending` 那条是**还没成对的待定起点**（不在 meta 里），照「反复开始」的样子画 -->
      <g v-if="editMode" class="lyr-repeats" :class="{ muted: marksOpen || tool !== 'repeat' }">
        <g
          v-for="r in repeatMarks"
          :key="focus && focus.key === r.key ? `${r.key}:${focus.tick}` : r.key"
          :class="{ hover: hoverRepMark && hoverRepMark.key === r.key, 'focus-flag': !!focus && focus.key === r.key }"
        >
          <template v-if="r.kind === 'start' || r.kind === 'end'">
            <line :x1="r.bar.x" :y1="r.bar.y0" :x2="r.bar.x" :y2="r.bar.y1" class="rep-line" />
            <line
              :x1="r.bar.x + (r.kind === 'start' ? 4 : -4)"
              :y1="r.bar.y0"
              :x2="r.bar.x + (r.kind === 'start' ? 4 : -4)"
              :y2="r.bar.y1"
              class="rep-line thin"
            />
            <circle :cx="r.bar.x + (r.kind === 'start' ? 8.5 : -8.5)" :cy="(r.bar.y0 + r.bar.y1) / 2 - 6" r="2" class="rep-dot" />
            <circle :cx="r.bar.x + (r.kind === 'start' ? 8.5 : -8.5)" :cy="(r.bar.y0 + r.bar.y1) / 2 + 6" r="2" class="rep-dot" />
          </template>
          <template v-else>
            <!-- 房子 1 起点：一条细竖条。翻转之后 y1 不再保证比 y0 大，所以照 min/abs 写 -->
            <rect
              :x="r.bar.x - 1"
              :y="Math.min(r.bar.y0, r.bar.y1)"
              width="2"
              :height="Math.max(0.5, Math.abs(r.bar.y1 - r.bar.y0))"
              class="rep-dot"
            />
          </template>
        </g>
      </g>

      <!-- 三个线工具的悬停提示：光标附近那条小节线整条亮起（这些标记本身可能又细又淡，
           只靠把标记加粗不够显眼，所以单独再描一条），同时也是「点下去会落在哪条线」的预告 -->
      <line v-if="hoverLine" :x1="hoverLine.x" :y1="hoverLine.y0" :x2="hoverLine.x" :y2="hoverLine.y1" class="bar-hover" />

      <!-- 小节线工具**没落在删除判定区**时的悬停预览：光标处一条竖线，预告「点下去会在这儿新建一条」。
           光标落在判定区里时它是 null（那一支由上面的 `.bar-hover` + 标记本身的高亮来表达） -->
      <line v-if="hoverBarGhost" :x1="hoverBarGhost.x" :y1="hoverBarGhost.y0" :x2="hoverBarGhost.x" :y2="hoverBarGhost.y1" class="bar-ghost" />

      <!-- 拖动落点预览：小节线跟着指针走；段落 / 反复高亮将要落上去的那条线 -->
      <line v-if="ghost" :x1="ghost.x" :y1="ghost.y0" :x2="ghost.x" :y2="ghost.y1" class="bar-ghost" />
      <line v-if="targetBar" :x1="targetBar.x" :y1="targetBar.y0" :x2="targetBar.x" :y2="targetBar.y1" class="bar-target" />

      <!-- 框选矩形 / 行带预览：行工具拖出来的带子按结局分三档配色（新建蓝 / 部分相交灰 / 整条套住红） -->
      <rect
        v-if="marquee"
        :x="marquee.x0"
        :y="marquee.y0"
        :width="Math.max(0.5, marquee.x1 - marquee.x0)"
        :height="Math.max(0.5, marquee.y1 - marquee.y0)"
        :class="['marquee', { row: marquee.row, overlap: marquee.kind === 'overlap', split: marquee.kind === 'split' }]"
      />
    </svg>
  </div>
</template>

<style scoped>
.score-page {
  position: relative;
  margin: 0 auto;
  background: var(--page-paper, #fff);
  border-radius: 6px;
  /* 和背景分开：外面一层投影，里面一圈描边。
     内描边用 outline 而不是 inset 阴影 —— canvas 是子节点会把 inset 阴影盖住，
     而 outline 在 CSS 绘制顺序里排在所有后代之后，压不住。 */
  box-shadow: var(--shadow-2);
  outline: 1px solid var(--stroke-soft);
  outline-offset: -1px;
  overflow: hidden;
  /* 指针模式：谱面区域不参与滚动，在谱面上拖就一定是在标记（框选 / 划行 / 放置）——
     这样拖动才不会被浏览器抢去当滚动手势。抓手模式那条 `.no-gestures` 会把它让回去。
     （选中文字 / iOS 长按菜单不用在这里再写一遍 —— 全站已禁，见 main.css） */
  touch-action: none;
}
/* 抓手模式（默认）：**这里一个字都不许再声明 touch-action**（上面那条 none 必须让位），
   触屏滑动就是原生滚谱 —— 这正是「抓手」的定义。
   ⚠️ 它的**生效值只有 `pan-x pan-y`**：全站禁缩放那一条写在 `html` 上（`main.css`，见 `docs/ui.md` §18.46），
   交集下来捏合就没了 —— 这里写 `auto` 不是「连缩放一起放开」，别指望从这儿放开它。
   ⚠️ **它必须在 touchstart 之前就定好**（浏览器在那一刻锁值，中途改无效），
   所以「先滑一会儿再改成接管」这类玩法在这个类上是做不到的（那正是被删掉的长按方案的老路）。
   它管的是**触屏**；鼠标两种模式完全一样（见文件头「手势策略」）。 */
.score-page.no-gestures {
  touch-action: auto;
}
/* 深色模式下 PDF 反色（只反页面本身，标记层保持主题色） */
.page-canvas {
  filter: var(--pdf-invert, none);
}
.page-skeleton {
  filter: var(--pdf-invert, none);
}
.page-canvas,
.page-skeleton {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.page-skeleton {
  background: repeating-linear-gradient(180deg, #fff 0 26px, #f4f5f7 26px 28px);
  opacity: 0.5;
}
.page-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}

/* 光标：**这一轮不动它**——谱面本来就没有任何 cursor 声明，鼠标就是系统默认箭头（全站只在
   `main.css` 给可点元素写了 `pointer`）。抓手 / 指针说的是**手势归谁**，不是鼠标长什么样：
   抓手模式下谱面交给浏览器原生滑动，光标仍是默认箭头。
   ⚠️ **别在这里按手势模式或编辑工具补 cursor 规则**：模板上那个 `tool-*` 类名（`tool-play` /
   `tool-row` / `tool-barline` / `tool-segment` / `tool-repeat`）从很早就在绑，但全仓从来没有对应的
   CSS —— 它一直是个没落地的挂点，保持原样即可，不要顺手补成 `grab` / `crosshair` 那几档。 */

/* 编辑层样式（坐标单位 = pt，故描边宽度用 pt 值）
   三条全局规则：
   1. **线型统一用实线** —— 不再有虚线（原来行是虚线框、段落线是虚线）。
      区分「哪一类标记」靠的是颜色与形状，不是虚实线：混用虚实线看着像两套制图规范。
   2. **配色只表达「现在在编辑哪一类」**：当前工具对应的那类走主题色，其余三类降级成灰
      （`.muted`）。灰用**专用的 `--mark-*` 三件套**（见下），不要挪用界面的表面 / 描边 / 文字灰 ——
      那些是给面板用的，压在 PDF 纸上要么太亮要么看不见。
      **灰是半透明的**（`color-mix` 减淡、不用 opacity）：标记本体走的是实色 `--accent`，
      灰要是也用不透明实色，两边重量就换了个方向 —— 要么灰压过主题色，
      要么主题色被灰衬得发脏，「谁在编辑」就看不出来了。
   3. **主题色只用两档**（都取自既有的 accent 族，不自造）：
      · **标记本体**（行边线、小节线、段落线与名牌底、反复线、房子括号与标签、别针 / 圆点）
        用**实色 `--accent`** —— 用户拍板「**不 hover 的时候就得有 accent 那么重**」：
        常态就按实色画，**不要**那档半透明的 `--accent-line`（压在纸上会比 hover 时轻一档，
        鼠标一进去就像换了一支笔）；
      · **底 / 面**（行底、悬停底、当前小节底）用 `--accent-weak`。
        别拿 `--accent` 铺面：它是「线」这一档，铺满整行会把谱子压住。
      · **谱面标记没有一处用 `--accent-line`**：小节线左边那条淡辅助线已经不画了
        （它和主线只差 3pt、又都贯穿整行，看上去是一条重影）。
      （**框选底是唯一的例外**，走 `--mark-muted-fill`，见下面 `.m-sel` —— 它是播放状态、不是编辑标记。）
   本节所有颜色都走变量，不写死十六进制。 */
/* 行 = 浅底 + 上下边线。底色必须**很淡**：这一层压在 PDF 内容之上，
   铺浓了会把谱子本身盖住（--accent-weak 只有 ~12–16% 不透明度，正合适） */
.sys-fill {
  fill: var(--accent-weak);
  stroke: none;
}
/* 行标记的上下边线：标记本体一律**实色 `--accent`**（见本节顶部第 3 条）。
   灰色态见下面 .muted */
.sys-edge {
  stroke: var(--accent);
  stroke-width: 1.6;
}
/* 小节线 = **一根实线，只有它**：左边 3pt 处那条淡辅助线、顶端的端点圆都不画。
   两样都没有替代物，别再补回来 —— 小节线这一类标记的形状特征只有「正上方那个别针」
   （别针与它之间那条杆是别针那一份的，见下面 `.m-no-stem`） */
.bar-line {
  stroke: var(--accent);
  stroke-width: 1.6;
}
/* 小节号那个地图定位图标（📍 实心水滴别针）：每条小节线正上方一个。
   **没有编号的线也要有这个图标**（全谱最后一条线指向 count + 1，没有小节从它开始），
   所以图标是常驻的、只有里面的文字可有可无。
   它要压字，所以用实色 `--accent`：图标小、字更小，底太浅字就糊在上面了。
   形状由模板上的 `d`（`pinPath`）给，这里只上色 —— **别加 stroke**：描边会把尖端糊粗 */
.m-no-disc {
  fill: var(--accent);
}
/* 别针尖端往下那条**杆**（模板里的 `n.stemY0 → n.stemY1`，尖端 → 行顶）：
   与小节线**同色同粗细**（`.bar-line` 那一套），于是别针和行里那根线看起来是一条贯通的线。
   它是别针这个标记的一部分，所以变灰 / 加粗 / 闪烁都跟着 `.m-no-disc` 走
   （见下面的 `.muted` / `.hover` / `.focus-flag` 几组选择器）——新加这一档时**别忘了那三处** */
.m-no-stem {
  stroke: var(--accent);
  stroke-width: 1.6;
}
/* 图标 / 段落牌上的字：底色是**实色 `--accent`**（见 `.m-no-disc` / `.seg-flag`），
   所以用 `--on-accent` 这颗「实色主题底的反差字」；
   **别改用 `--text-strong`**：深浅两色下它压在这层实色上只有 1.3~1.8 的对比度，等于看不见。
   （**灰态是另一回事**：`.muted` 下底是半透明的谱面灰，那里用 `--surface-page`，见下面。）
   **字号与 `DISC_R` 是一对**：字号调大就得同时把圆帽加宽，
   否则四位号（1360）会从圆帽两边流出去（判据与算式写在 `DISC_R` 那段注释里）。
   **字体不在这里写**：走全站那一套（`main.css` 的 `--font-ui`，不写 `font-family` 就是继承它）。
   这个字体的数字**本身就是等宽的**（Bold 档实测每字 `0.590 em`），
   所以**不用另引一套等宽字体、也不用开 `tnum`**（开不开量到的宽度一样）。 */
.m-no {
  fill: var(--on-accent);
  font-size: 10px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
}
/* 鼠标悬停的高亮**不再单独画一层矩形**：行标记那一组的 `.sys-fill` / `.sys-edge` 本身就在
   `.hover` 组里（见文件末尾的 hover 规则），直接换色即可 —— 少一层与标记重复的几何量。
   下面几个 `--accent` 实色**故意不跟着标记减淡**：它们是「此刻的状态」提示
   （鼠标旁边那条预告线 / 当前小节 / 播放进度），本来就该比静态标记更醒目。
   ⚠️ **它们不是「标记的高亮」**：标记本身的 hover 走 `--accent`、标记列表点名时的闪烁走
   `--accent-strong`（见文件末尾），而这一组是**另画出来的一层线**，不压在标记自己的形状上 ——
   所以它们跟标记的高亮**不一定同色**，别顺手把这组的选择器合并过去。
   **框选不在这一组里**：它虽然也是状态，但走的是谱面灰（见下面的 `.m-sel`）。 */
.bar-hover {
  stroke: var(--accent);
  stroke-width: 2.4;
}
/* 当前小节：**只有浅底、永远不描边**。**只要有位置就画**（播放 / 暂停 / 停止 / 预备拍都画，
   只有编辑模式不画，见模板上的 `v-if` 与 `docs/ui.md` §18.46）—— 编辑模式下谱面上只有标记，
   「此刻播到哪一小节」是播放态的东西，两者混在一起就分不清哪个框是标记、哪个是状态了。
   **`before` 闪烁落在同一小节时这一层不画**（让给闪烁那层底，否则叠色 = 不再是一下一下地闪，见 `flashOnActive`）。
   下面四条选择器**一起写、且都不给 stroke**，是有意的：`plain` 恒为真（兜底），
   `.playing` 目前没有专属样式（留着当以后的挂点，例如想把播放态换成 `--accent-mid`）。
   要恢复边框得**同时**改这里和模板上的 `plain`，否则会变成「有的模式有框、有的没有」 */
.m-active,
.m-active.plain,
.m-active.playing,
.m-active.plain.playing {
  fill: var(--accent-weak);
  stroke: none;
}
/* **跳跃闪烁**：谱面上唯一**会动**的东西，两道（见那两个 computed 的注释）。
   **两道可以同时在同一个小节上**（手动点跳转：点击瞬间的「跳转后」+ 预备拍倒数的「跳转前」），
   所以它们是两层、各自一个 `<rect>`，别合并成一层再拿类切相位。
     · `.is-before` **跳转前闪烁**：**每拍闪一次**，重复一整个小节 / 整个倒数（`--flash-ms` 递一拍、
       `--flash-times` 递这一小节的拍数）；
     · `.is-after`  **跳转后闪烁**：落在落点上**闪一下**（`--flash-ms` 一拍左右，重复次数固定 1，
       一次渐变就结束、停在透明上）。
   底色就是 `.m-active` 那一档 `--accent-weak`（当前小节的底色），所以落地时是**无缝接上**的，
   不会闪出第三种颜色。
   **渐变，不是硬跳**（用户明确要求）：关键帧之间让浏览器插值，读起来是「亮—暗」的呼吸。
   `--flash-times` 只有跳转前那一层用：每小节拍数（跟着拍号走，4/4 就闪 4 下）。 */
.m-jump-flash {
  fill: var(--accent-weak);
  stroke: none;
}
.m-jump-flash.is-before {
  animation: jump-flash-before var(--flash-ms, 500ms) ease-in-out var(--flash-times, 4);
}
.m-jump-flash.is-after {
  animation: jump-flash-after var(--flash-ms, 0.6s) ease-in-out 1 forwards;
}
@keyframes jump-flash-before {
  0% {
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@keyframes jump-flash-after {
  0% {
    opacity: 0;
  }
  45% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
/* 当前小节内的播放进度线：不透明主题色实线，压在 PDF 内容上才看得清 */
.m-progress {
  stroke: var(--accent);
  stroke-width: 1.6;
}
/* 框选（循环区间）：**谱面灰底、不描边** —— 它表达的是「这一段在循环」这个**播放状态**，
   不该跟编辑标记抢主题色（用户拍板，推翻了原来「框选 = 谱面上唯一带描边的方框」那条约定；
   见 docs/ui.md §6 / §18.32）。
   与「当前小节」（`.m-active`）现在靠**灰 / 主题色**区分，而不是靠描边（圆角两处共用
   `ACTIVE_RADIUS`，所以圆角不再是区分手段）。
   灰用 `--mark-muted-fill`，也就是编辑模式里行底那一档 —— **别换用界面的灰**：
   这一层压在 PDF 纸上（深色下纸面近黑、浅色下是白纸），明度要求跟界面灰完全不同。
   **圆角是每条 `<rect>` 自己带的 `rx` / `ry`**（按块算出来的，见 `selectedMeasures`），
   不写进这条规则里 —— 写死在这儿会把「跨行时行首 / 行尾直角」一起抹掉。
   已知取舍：编辑模式下当前工具不是「行」时，行底（`.muted .sys-fill`）就是同一档灰，
   框选会和行底糊在一起 —— 这是用户接受的结果，不是 bug。 */
.m-sel {
  fill: var(--mark-muted-fill);
  stroke: none;
}
/* 段落线：**长得和小节线一样**（同色、同粗细的一条竖线，都是实色 `--accent`），
   位置落在段落 position 的拍上（见 `segmentGeometry`）——
   形状上与「这是一条分界」对齐，不再另给一档粗细 */
.seg-line {
  stroke: var(--accent);
  stroke-width: 1.6;
}
/* 段落名牌：横向一块牌，要压名字，所以用实色 `--accent` 当底（同 `.m-no-disc`） */
.seg-flag {
  fill: var(--accent);
}
/* 名牌里的字：**横向、左对齐**（`text-anchor: start`；x = SEG_PAD、y = SEG_H/2 由模板给，
   与 SEG_PAD / SEG_H 那两个常量是同一份约定）。字色同 `.m-no`：实色底上用 `--on-accent` */
.seg-text {
  fill: var(--on-accent);
  font-size: 13px;
  font-weight: 700;
  text-anchor: start;
  dominant-baseline: central;
}
.rep-line {
  stroke: var(--accent);
  stroke-width: 1.8;
}
.rep-line.thin {
  stroke-width: 1;
}
.rep-dot {
  fill: var(--accent);
}
.house-bracket {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.6;
}
.house-label {
  fill: var(--accent);
  font-size: 13px;
  font-weight: 700;
}
/* 降级成灰：当前没在编辑的那几类标记。线型、形状、粗细全都不动，只换颜色 ——
   换形状会让人误以为标记本身变了，而这里要表达的只是「它不是现在的编辑对象」。
   灰用**专用的一组 `--mark-*`**（`main.css` 里定义，深浅各一套）：
   表面 / 描边 / 文字那几套灰都是「界面上的灰」，而这几条线要压在 PDF 图上
   （深色下纸面近黑、浅色下是白纸），对明度的要求跟界面完全不同，共用一套必然有一边看不清。
   线、别针、行底各用其中一档，**不要混用界面的灰**。
   **灰是半透明的**（`--mark-muted-line` / `--mark-muted-fill` 都是 `color-mix` 减淡出来的）：
   标记本体现在是实色 `--accent`，灰要是也用不透明实色，两边重量就换了个方向 ——
   要么灰压过主题色，要么主题色被灰衬得发脏。 */
.muted .sys-edge,
.muted .bar-line,
.muted .m-no-stem,
.muted .seg-line,
.muted .rep-line,
.muted .house-bracket {
  stroke: var(--mark-muted-line);
}
.muted .m-no-disc,
.muted .seg-flag,
.muted .rep-dot,
.muted .house-label {
  fill: var(--mark-muted-line);
}
/* 行底：比线更淡的一层（铺满整行，浓了会盖住谱子） */
.muted .sys-fill {
  fill: var(--mark-muted-fill);
}
/* 灰底别针 / 段落牌上的字：用页面底色反向衬托
   （深色模式深底亮字、浅色模式亮底深字），不能用文字灰 —— 同色系压上去看不见 */
.muted .m-no,
.muted .seg-text {
  fill: var(--surface-page);
}
/* 悬停：**一条标记被悬停时，它的所有组成部分一起亮起来** ——
   线（加粗）+ 别针 + 名牌 + 圆点 + 行底 + 行边线，一个不落，观感统一。
   「所有组成部分」是有意义的：小节线正上方还有一个别针，
   反复是两条线 + 旁边两点，段落是线 + 名牌 —— 只亮其中一根，用户会以为点下去只动那一根。
   ⚠️ **常态就已经是实色 `--accent`**（用户拍板「不 hover 的时候就得有 accent 那么重」），
   所以下面这几条颜色规则**在常态下是同一套值**：它们的实际作用是**把 `.muted` 那套灰顶掉**
   （「标记列表」开着等状态下两层会同时命中），**不要**因为“看起来是重复”就删掉。
   悬停真正的差别是**加粗（3pt）与圆点放大（r 3.2）**，以及行底那一层。
   **行底是唯一的例外**：它是一层铺满整行的底，照旧走 `--accent-weak` → `--accent-mid` 那两档透明度。
   注意 .hover 只可能出现在当前工具那一层上（非当前工具的层没有 hover 命中），
   但因为 CSS 优先级相同，仍要写在 .muted 之后才能保证压得住。 */
.hover .sys-edge,
.hover .bar-line,
.hover .m-no-stem,
.hover .seg-line,
.hover .rep-line {
  stroke: var(--accent);
}
.hover .sys-fill {
  fill: var(--accent-mid);
}
.hover .m-no-disc,
.hover .seg-flag,
.hover .rep-dot {
  fill: var(--accent);
}
.hover .m-no,
.hover .seg-text {
  fill: var(--on-accent);
}
/* 加粗**只给主线**：反复的第二条细线本来就要细一档，一视同仁地加粗会把那个形状提示抹平
   （形状是标记之间的区分手段，不能动） */
.hover .sys-edge,
.hover .bar-line,
.hover .m-no-stem,
.hover .seg-line,
.hover .rep-line:not(.thin) {
  stroke-width: 3;
}
.hover .rep-dot {
  r: 3.2;
}
/* 拖动中的框选 / 行带预览、以及小节线的落点预览，同样一律实线（全站不做虚实线区分） */
.marquee {
  fill: var(--accent-weak);
  stroke: var(--accent);
  stroke-width: 1.4;
}
.marquee.row {
  fill: color-mix(in srgb, var(--accent) 10%, transparent);
  stroke: var(--accent);
}
/* 行工具拖出来的带子按**这一笔的结局**分三档配色（判据在 `updateBand` 的 `BAND_KIND`）：
     · 都不沾（`new`）   = 主题色（蓝）—— 松手落一条新行，就是 `.marquee.row` 本身那份；
     · 落不下来（`overlap`）= **灰**（`--mark-muted-*`，与「非当前工具的标记」同一套谱面灰）——
       太扁、只压住一半、套住却拆不成都是这一档，松手前就能看出「这块地方不行」；
     · 整条套住（`split`）  = **红**（`--danger`）—— 这一笔画的是「切在这儿」，不是落一条新行，
       要跟蓝色的新建一眼分开。
   两条覆盖规则都写在 `.marquee.row` 之后，否则同优先级下主题色会把它们盖掉；透明度与行底同一档
   （10%）—— 这一层压在 PDF 上，浓了会看不清谱子；灰那档用 `--mark-muted` 同一档（16%，与行底的灰底一致）。 */
.marquee.row.overlap {
  fill: var(--mark-muted-fill);
  stroke: var(--mark-muted-line);
}
.marquee.row.split {
  fill: color-mix(in srgb, var(--danger) 10%, transparent);
  stroke: var(--danger);
}
/* 落点预览：小节线是「将要放在这里」（拖动中与**悬停时**共用这一档）；段落 / 反复是「落在这条线上」，加粗一档 */
.bar-ghost {
  stroke: var(--accent);
  stroke-width: 2;
}
.bar-target {
  stroke: var(--accent);
  stroke-width: 3;
}
/* 「标记列表」里刚点过的那一项：**闪两下**，把「列表里的这一行 = 谱面上的这一条」指出来。
   全谱的标记这时都是灰的（`.muted` 由 `marksOpen` 一起挂上），所以带主题色的只有它。
   规则**必须排在 `.muted` 之后**：选择器与 `.muted .xxx` 同分（0,2,0），靠顺序才压得住。
   ⚠️ **高峰帧用 `--accent-strong`（比常态的 `--accent` 再重一档）**，低峰帧与末帧都是常态的
   `--accent` —— **末帧必须等于常态色**：`both` 会把最后一帧一直挂在元素上，
   末帧写成别的颜色 = 闪完留下一个「常亮的高亮」（行底那条就是踩过这个坑，见 `sys-flash-fill`）。 */
.focus-flag .sys-edge,
.focus-flag .bar-line,
.focus-flag .m-no-stem,
.focus-flag .seg-line,
.focus-flag .rep-line,
.focus-flag .house-bracket {
  animation: mark-flash-stroke 1.5s ease-in-out both;
}
.focus-flag .m-no-disc,
.focus-flag .seg-flag,
.focus-flag .rep-dot,
.focus-flag .house-label {
  animation: mark-flash-fill 1.5s ease-in-out both;
}
/* **行底是唯一的例外**：它闪的是**底色本身**，所以单独一条动画 —— 常态 `--accent-weak`、
   高峰实色 `--accent`、末帧回到 `--accent-weak`。**别把这条并回上面那组**。 */
.focus-flag .sys-fill {
  animation: sys-flash-fill 1.5s ease-in-out both;
}
@keyframes mark-flash-stroke {
  0%,
  55% {
    stroke: var(--accent-strong);
    stroke-width: 3;
  }
  25%,
  80% {
    stroke: var(--accent);
    stroke-width: 3;
  }
  100% {
    stroke: var(--accent);
    stroke-width: 3;
  }
}
@keyframes mark-flash-fill {
  0%,
  55% {
    fill: var(--accent-strong);
  }
  25%,
  80% {
    fill: var(--accent);
  }
  100% {
    fill: var(--accent);
  }
}
/* 行底那一下（唯一的例外，见上面的说明）。
   ⚠️ **末帧必须写回 `--accent-weak`**（行底的常态色）：原来写的是 `--accent-line`，
   于是「在标记列表里点一行」闪完之后，那一行会**一直停在 55% 的蓝底上**，
   直到焦点转到别处为止 —— 这与「闪完不留高亮」的设计相反。 */
@keyframes sys-flash-fill {
  0%,
  55% {
    fill: var(--accent);
  }
  25%,
  80% {
    fill: var(--accent-weak);
  }
  100% {
    fill: var(--accent-weak);
  }
}
</style>
