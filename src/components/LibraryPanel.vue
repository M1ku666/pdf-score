<script setup>
/**
 * 乐谱库面板（原来的 gallery 页面，现在只是一个面板）
 *  · 宿主只有一个（侧栏或竖屏抽屉），两边都是同一套行式列表，不再分网格 / 紧凑两种样式
 *  · **标题栏在面板自己身上**（`.lib-head`）：左边「乐谱库」、右边一颗**「备份」圆钮**
 *    （`StorageMeter`，外圈环形进度 = 已用额度占比）。点它打开 `StorageSheet`：
 *    占用读数 + 进度条 + 「东西存在哪、什么时候会没」的说明 + 「导出全部乐谱」。
 *    **读数不在标题栏上**，标题栏只放一颗按钮。
 *    侧栏那边的同名标题栏（`PlayerView` 的 `.side-head`）已经删掉，别再往回加一条，否则顶上白一条。
 *  · 顶栏：一行「搜索框 + 排序」（**设置不在这儿了**，见文件末尾那段），**多选时整条换成四个纯文本按钮**
 *    「全选 / 清空 · 导出 · 删除 · 完成」（`.btn.sm.text`，删除再加 `.danger`）——
 *    四个**都没有底色也没有边框**，每个都是「图标 + 文字」：`selectAll`/`close`、`download`、
 *    `trash`、`check`；前三个（含删除）用 `--text-strong` 黑字（`.text.strong`），删除用危险色。
 *    四条平分顶栏、与搜索框同高。顶栏的下边框才是分割线，线下面是标签块：
 *    标题行「标签」+ 右侧「全选 / 清空」文本按钮 +「全部标签」箭头钮，
 *    下面一行是横向滚动的标签胶囊；搜索与标签**即点即过滤**，列表实时跟着变
 *  · 底部固定一个整宽的导入按钮（pdf / pmz / zip / 音频 / JSON），不跟列表滚动；**只能点、不收拖入**
 *  · 卡片右侧的「⋯」→ 信息 / 选择 / 删除（**这是唯一的入口：全项目不用右键**，见 docs/ui.md §9）
 *  · 拖入文件不在这里处理：整页拖放由 PlayerView 统一分流
 *
 * 卡片那一行是**两行字**（`.card-text`）：标题 + 下一行的灰色小字（`.card-meta`）。
 *  · 小字显示什么**由当前排序方式决定**（`SORTS[].meta` 经 `sortMeta`）：按时间排序显示**打开时间**、
 *    标题排序显示标签（多个用 `·` 连起来）、占用大小排序显示大小。
 *  · **小字为空就整行不画**（`cardMeta()` 返回空串）：标题**竖直居中**，与封面 / 右侧动作位对齐。
 *    只有「没有标签的乐谱 + 标题排序」这一种情况会走到 —— **不拿「无标签」当占位**。
 *  · 占用大小读 `store/library.js` 的 `sizes`（`Map<id, 字节>`，是这张谱占的**一切**：
 *    PDF + 音频 + 波形 + 封面），还没量到就显示 `common.calculating`。
 *  · 「按占用大小」排序**按那行灰字的字面量排**（`formatBytes` 出来的串本身，比如 `23 MB` / `1.5 MB`），
 *    不是按原始字节比 —— 同一档显示（都是 `0 B`）的按标题兜底；**还没量到的排在最后**，
 *    不拿 0 冒充空谱。
 *  · 两行都 `nowrap` + 省略号：行高会变，但卡片高度与右侧动作位不受影响。
 *
 * **这里没有「设置」**：那颗钮和它的面板（`LibrarySettings`）都归页面 ——
 * 入口要跟「乐谱库 / 收起」并排在同一条左上胶囊里，也就是那一栏。
 *
 * 标签与筛选：
 *  · 勾选状态**就是**筛选条件（`filterTags` = 勾上的 key 集合），`filtered` **无条件**按它过滤
 *    （除「无标签」外谁都没勾 = 空列表 + 「没有符合条件的乐谱」）。默认**全勾**（不筛）；
 *    `watch(tagItems)` 用 `knownTags` 把**第一次见到的标签自动勾上**、见过的沿用用户选择
 *    （否则用户刚取消的标签会被下一次改动又勾回来）。
 *  · **「无标签」是虚拟标签**（`UNTAGGED` 哨兵，绝不会和真实标签重名）：排在标签行最前，筛出所有
 *    一个标签都没有的乐谱，只在真有这种乐谱时出现；标签之间是**「或」**。
 *  · **搜索框的匹配范围是标题 / 标签两者**（`meta.composer` 已删：界面上从来没人能填、也没人看得见）；
 *    空格分隔的多个搜索词之间也是**「或」**；**「无标签」这个虚拟标签同样能被搜到**
 *    （`UNTAGGED_LABEL` 只加在一个标签都没有的乐谱上，不会误伤带标签的乐谱）。
 *  · 勾上 = `.chip.on` = `.chip.accent` 那一套外观（`--accent-weak` 浅底 + `--accent` 描边 + `--accent` 文字），
 *    没勾 = 普通胶囊。这一条与信息面板里的标签**共用 `main.css` 的同一份 `.chip.on`**，只准改那一处；
 *    `.chip.tap.on:hover` **必须重申 `--accent-weak`**，否则鼠标一悬停就把选中态盖成灰底。
 *  · 标题行右侧那个箭头打开 `panel-key="tags"` 的「全部标签」浮层：顶部一个占满整行的全选 / 清空
 *    （`.btn.block`），下面是与标签行**同一套 `.chip.tap`** 的可换行胶囊，共用同一份 `filterTags`。
 *    **没有独立的「搜索与筛选」浮层** —— 搜索框与标签块都在列表顶上，边看边筛。
 *
 * 封面：
 *  · 卡片缩略图 44×44、信息面板那张小预览 68×68，都是**固定正方形的尺寸框**：图等比完整放进、不裁切
 *    （`object-fit: contain`），**框常态不铺底不描边**（卡片那张完全透明；信息面板那张只在没图时用
 *    `--surface-control` 当占位底）。**别给封面补底色** —— 补了就等于把留白补成正方形。
 *  · **缩略图要跟着整页 PDF 一起反色**（`.thumb img` 挂 `filter: var(--pdf-invert)`，它是白纸渲染的
 *    JPEG），而 **`.custom`（`coverCustom`，用户自己选的图）不反色**、`.thumb-empty` 的图标也不反色。
 *    **反色只看 `coverCustom`，不是看「有没有图」**：默认封面（PDF 首页渲染的）也要反色 ——
 *    别用 `!!thumb` 推断，否则「恢复默认」之后就会被当成自定义封面、深色下不反色。
 *    `applyCoverData(id, thumb, custom)` 的 custom **必须显式传**（换图 true / 用 PDF 重生成 false /
 *    导入 pmz 带封面 true）。存储层不改比例（`imageToCover` 仍按 420px 宽等比缩），方框只是显示层的事。
 *  · 信息面板的排布：标签**只用回车添加**（没有「添加」按钮）、列表在输入框下面；详细信息**每样一行**
 *    （页数 / 小节数 / 音频时长 / 占用大小 / 创建时间 / 更新时间），**不要把多项塞进一行、也不要用
 *    `·`、`/` 这类分隔符串值**；**整个信息面板里没有任何分割线**（不要 hr.divider，明细行也不要
 *    border-bottom，靠 `.form` 的 gap 与行内边距分开）。封面是 `.btn.ghost.cover-pick`：**整行宽**的
 *    封面按钮（实线描边、左对齐，左边小预览 + 右边「点击上传替换封面」），自定义封面时下面还有一个
 *    同样占满整行的「恢复默认」。**它只能点**：不收拖入的图片（拖放只有 PlayerView 整页那一个入口）。
 *
 * 导入入口（`.lib-import`）：
 *  · 它是 `.library` 的最后一个 flex 子节点，所以列表在上面滚、它不动；**空状态 / 加载中的 `.empty`
 *    也要 `flex: 1`**，否则按钮会浮在说明文字下面、贴不到底（有列表时是 `.lib-list { flex: 1 }` 顶住）。
 *  · **不要加 `.block`**：`width: 100%` 加上左右 8px 的 margin 会往右溢出，纵向 flex 容器里本来就会
 *    被拉伸到「容器宽 − 左右边距」。按钮上**不写支持哪些格式**。
 *  · 它靠 `.library { height: 100% }` 拿到确定高度，所以容器要有一条确定高度的链路（`.side-frame` /
 *    `.side-body`；抽屉里由 `AppSheet` 的 `.drawer-box` 给满高）—— **别只给它 `height: 100%` 却让祖先
 *    高度是 auto**，那样它会退化成内容高度、按钮浮到列表中间。
 *  · **所有导入框都是按钮、只能点**（原来的虚线「上传框」与悬浮加号 `.fab` /「新增乐谱」面板都已删）。
 *    设置面板里没有导入 / 生成示例那些杂项，只剩偏好设置。
 *
 * 与页面的分工：「打开某张谱的信息面板」由页面发 `infoRequest = { id, tick }`（tick 自增，重复请求也
 * 生效），**面板状态留在本组件自己手里**；封面 / 标签 / 导出 / 删除都走 `store/library.js`。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import ContextMenu from '../components/ContextMenu.vue'
import StorageMeter from '../components/StorageMeter.vue'
import StorageSheet from '../components/StorageSheet.vue'
import {
  busy,
  collectTags,
  exportScores,
  formatBytes,
  formatDate,
  importFiles,
  loading,
  refresh,
  removeScores,
  renameScore,
  scoreFileInfo,
  scores,
  setScoreCover,
  sizes,
  sizesReady,
  sizesTotal,
  updateScoreTags,
  // ⚠️ **取别名**：直接叫 `usage` 的话，模板里 `usage` 会被解析成 `_ctx.usage`（组件实例上没这个），
  // 而不是 setup 里的这个 ref —— 标题栏右侧的占用就永远不显示（渲染函数里 `_ctx.usage` 是 undefined）。
  usage as storeUsage,
} from '../store/library.js'
import { requestPersistence } from '../db/idb.js'
import { toast } from '../store/ui.js'
import { settings } from '../store/settings.js'
import { t } from '../i18n/index.js'

const emit = defineEmits(['open-score'])
/**
 * 当前打开的乐谱 id：列表里给它加一层底色（由 PlayerView 传入，组件不直接读播放器状态）
 * infoRequest：页面拖入文件后要求「打开某张谱的信息面板」，形如 `{ id, tick }`，
 *   tick 每次自增，所以对同一张谱重复请求也会重新打开。
 */
const props = defineProps({
  currentId: { type: String, default: '' },
  infoRequest: { type: Object, default: null },
})

watch(
  () => props.infoRequest,
  (req) => {
    if (!req?.id) return
    const rec = scores.value.find((s) => s.id === req.id)
    if (rec) openInfo(rec)
  }
)

const query = ref('')
const sort = ref('opened-desc')
const selectMode = ref(false)
const selected = ref(new Set())
const filterTags = ref(new Set())

const sortOpen = ref(false)
const sortAnchor = ref(null) // 排序按钮的位置，菜单贴在它下面
const tagsOpen = ref(false)
const importInput = ref(null)

/** 「备份」抽屉开着没（那颗圆钮唯一的落点） */
const storageOpen = ref(false)
/**
 * 已占用占总额度的比例（0~1），喂给圆钮的环形进度；**算不出就是 null**（那种时候不画环）。
 *
 * 分子用**自己加出来的 `sizesTotal`**（和抽屉里那个数是同一个），**不是**浏览器报的 `usage`
 * —— 两者不是一回事，混用会让圆钮与抽屉对不上。分母是浏览器报的 `quota`。
 * 还没量完（`sizesReady` 为假）或总额度拿不到（`quota` 不是正数）时不画环。
 */
const storageRatio = computed(() => {
  if (!sizesReady.value) return null
  const q = storeUsage.value?.quota
  if (!Number.isFinite(q) || q <= 0) return null
  return Math.min(1, Math.max(0, sizesTotal.value / q))
})

/** 选项文字统一存 key，等到渲染时（模板 / computed）才 `t()`，这样切语言不用重载模块 */
/**
 * 排序方式。「时间」那两档用的是 **`openedAt` = 最近一次打开的时间**（不是创建 / 修改时间，
 * 那两个字段已经不记了，见 `store/library.js`）；`meta` 决定卡片下面那行灰字显示什么
 * （`opened` = 打开时间、`title` = 标签、`size` = 占用大小）。
 */
const SORTS = [
  { value: 'opened-desc', labelKey: 'library.sort.openedDesc', meta: 'opened' },
  { value: 'opened-asc', labelKey: 'library.sort.openedAsc', meta: 'opened' },
  { value: 'title-asc', labelKey: 'library.sort.titleAsc', meta: 'title' },
  { value: 'title-desc', labelKey: 'library.sort.titleDesc', meta: 'title' },
  { value: 'size-desc', labelKey: 'library.sort.sizeDesc', meta: 'size' },
  { value: 'size-asc', labelKey: 'library.sort.sizeAsc', meta: 'size' },
]

/**
 * 灰色小字显示哪种信息**由当前排序方式决定**（`meta`）：
 * 按时间那一档看**打开时间**、标题排序看标签、占用大小排序看大小。
 * 认不出的排序值按「没有小字」处理（那种时候卡片只剩标题、竖直居中）。
 */
const sortMeta = computed(() => SORTS.find((s) => s.value === sort.value)?.meta || 'none')

/** 排序是「锚在按钮上的短单选」——上下文菜单，不是抽屉 */
const sortItems = computed(() => SORTS.map((s) => ({ key: s.value, label: t(s.labelKey), checked: sort.value === s.value })))

/** 卡片右下角「⋯」出来的动作（文字复用 common.*） */
const CARD_ACTIONS = [
  { key: 'info', labelKey: 'common.info', icon: 'info' },
  { key: 'select', labelKey: 'common.select', icon: 'check' },
  { key: 'remove', labelKey: 'common.delete', icon: 'trash', danger: true },
]
const cardActions = computed(() => CARD_ACTIONS.map((a) => ({ ...a, label: t(a.labelKey) })))

/** 预备拍与跳转相关的开关（音量在播放器的「音频」里）。**住在 `LibrarySettings` 里**，见下 */

const tags = computed(() => collectTags(scores.value))
/** 「无标签」的哨兵值：不会和用户真写的标签重名（标签里不可能出现这个串） */
const UNTAGGED = '__untagged__'
/** 「无标签」对外的名字：它既是一个可筛的胶囊，也要能被搜索框直接搜到（渲染时才取，切语言跟着变） */
const UNTAGGED_LABEL = computed(() => t('library.tags.untagged'))
const untaggedCount = computed(() => scores.value.filter((s) => !(s.meta?.tags || []).length).length)
/**
 * 标签行里的每一项：**「无标签」也是一个可筛的标签**（排在最前，只在真有这种乐谱时出现），
 * 后面才是真实标签。全选 / 清空由标题行右边的文本按钮负责，不占这里的名额。
 */
const tagItems = computed(() => [
  ...(untaggedCount.value ? [{ key: UNTAGGED, label: UNTAGGED_LABEL.value, count: untaggedCount.value }] : []),
  ...tags.value.map((tag) => ({ key: tag.tag, label: tag.tag, count: tag.count })),
])
/**
 * 选中状态是**显式**的：默认（以及每出现一个新标签时）全部勾上，列表因此默认什么都不筛。
 * 第一次见到的标签自动勾上，见过的沿用用户自己的选择 —— 否则用户刚取消「练习」，
 * 随便改一下某张谱的标签就会把它又勾回来。
 */
let knownTags = new Set()
watch(
  tagItems,
  (items) => {
    const next = new Set()
    for (const it of items) {
      if (!knownTags.has(it.key) || filterTags.value.has(it.key)) next.add(it.key)
    }
    knownTags = new Set(items.map((it) => it.key))
    filterTags.value = next
  },
  { immediate: true }
)
const sortLabel = computed(() => {
  const hit = SORTS.find((s) => s.value === sort.value)
  return hit ? t(hit.labelKey) : ''
})

const filtered = computed(() => {
  // 空格分隔的多个搜索词之间是「或」：**任意一个**命中标题 / 标签就留下。
  // 标签也在搜索范围内，所以不用先点标签胶囊也能按标签找谱。
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  let list = scores.value.slice()
  if (terms.length) {
    list = list.filter((s) => {
      const ts = s.meta?.tags || []
      // 「无标签」这个虚拟标签也能被搜到：它只加在一个标签都没有的乐谱上，
      // 所以搜「无标签」只会命中这一类，带标签的乐谱不会被误伤。
      const hay = [s.title, ...ts, ...(ts.length ? [] : [UNTAGGED_LABEL.value])]
      return terms.some((term) => hay.some((v) => String(v ?? '').toLowerCase().includes(term)))
    })
  }
  // 标签之间是「或」：命中所选标签里任意一个就留下；一个标签都没有的乐谱，
  // 只在勾了「无标签」时留下（它就是这条特殊标签的定义）。
  // **勾选状态就是筛选条件本身**：全勾 = 全留下；一个都没勾（点「清空」）= 谁都不符合，
  // 列表会走到「没有符合条件的乐谱」。
  list = list.filter((s) => {
    const ts = s.meta?.tags || []
    if (!ts.length) return filterTags.value.has(UNTAGGED)
    return ts.some((tag) => filterTags.value.has(tag))
  })
  const cmpHan = (a, b) => (a || '').localeCompare(b || '', 'zh-Hans-CN', { numeric: true })
  // 占用大小**按卡片那行灰字的字面量比**：把串（`23 MB` / `1.5 MB` / `0 B`）拆回「数字 + 单位」比大小。
  // **不能只 `localeCompare` 两个串** —— 那样 `512 KB` 会排到 `23 MB` 前面（字面量顺序与大小无关），
  // 大小排序就成了假的。同一档显示（都是 `0 B`）的按标题兜底；
  // 还没量到的没有字面量、**两种方向都排在最后**，不拿 0 冒充「空谱」。
  const cmpHanSize = (a, b, dir) => {
    const ba = bytesOf(sizeText(a))
    const bb = bytesOf(sizeText(b))
    if (ba === null || bb === null) return (ba !== null ? -1 : bb !== null ? 1 : 0) || cmpHan(a.title, b.title)
    return -dir * (ba - bb) || cmpHan(a.title, b.title)
  }
  // 时间那一档比的是 `openedAt`（最近一次打开），同刻的按标题兜底，排序才是确定的
  const cmpHanOpened = (a, b, dir) => dir * ((b.openedAt || 0) - (a.openedAt || 0)) || cmpHan(a.title, b.title)
  switch (sort.value) {
    case 'opened-asc':
      list.sort((a, b) => cmpHanOpened(a, b, 1))
      break
    case 'title-asc':
      list.sort((a, b) => cmpHan(a.title, b.title))
      break
    case 'title-desc':
      list.sort((a, b) => cmpHan(b.title, a.title))
      break
    case 'size-desc':
      list.sort((a, b) => cmpHanSize(a, b, 1))
      break
    case 'size-asc':
      list.sort((a, b) => cmpHanSize(a, b, -1))
      break
    default:
      list.sort((a, b) => cmpHanOpened(a, b, -1))
  }
  return list
})

/**
 * 占用那一档灰字的**字面量**（`formatBytes` 出来的串）；**还没量到返回空串**。
 * 卡片显示与排序都只走这一个函数 —— 两者读同一个串，顺序才与眼睛看到的那一行一致。
 */
function sizeText(rec) {
  const bytes = sizes.value.get(rec.id)
  return Number.isFinite(bytes) ? formatBytes(bytes) : ''
}

/**
 * 把 `formatBytes` 的串（`23 MB` / `1.5 MB` / `0 B`）拆回字节数，拆不出来返回 `null`。
 * 单位集合与 `formatBytes` 一一对应；认不出（换了语言 / 改了单位）就交给标题兜底，别猜。
 */
function bytesOf(text) {
  const m = /^(\d+(?:\.\d+)?) (B|KB|MB|GB)$/.exec(text || '')
  if (!m) return null
  return Number(m[1]) * 1024 ** ['B', 'KB', 'MB', 'GB'].indexOf(m[2])
}

/**
 * 标题下面那行灰色小字，**内容跟着排序方式走**：
 *  · 按时间排序 → `openedAt` 那个时间戳（`formatDate`，与信息面板里「最近打开」同一个格式）；
 *  · 标题排序   → 标签（多个用 ` · ` 串起来）；
 *  · 占用排序   → `formatBytes` 出来的大小（`sizeText(rec)`，与排序键**同一个串**）。
 * **返回空串就是「这一行不存在」**：没有标签的乐谱在标题排序下没有东西可显示，
 * 那时卡片只剩标题、竖直居中（`.card-text.solo`）—— 不拿「无标签」当占位。
 */
function cardMeta(rec) {
  if (sortMeta.value === 'opened') return formatDate(rec.openedAt)
  if (sortMeta.value === 'title') return (rec.meta?.tags || []).join(' · ')
  if (sortMeta.value === 'size') return sizeText(rec) || t('common.calculating')
  return ''
}

const allSelected = computed(() => filtered.value.length > 0 && filtered.value.every((s) => selected.value.has(s.id)))
const selectedCount = computed(() => selected.value.size)

function isSelected(id) {
  return selected.value.has(id)
}
function toggleSelect(id) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function selectAll() {
  selected.value = allSelected.value ? new Set() : new Set(filtered.value.map((s) => s.id))
}
function enterSelectMode(rec) {
  selectMode.value = true
  selected.value = new Set(rec ? [rec.id] : [])
}
function exitSelectMode() {
  selectMode.value = false
  selected.value = new Set()
}
function toggleTagFilter(key) {
  const next = new Set(filterTags.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  filterTags.value = next
}

/**
 * 标签行是**横向**滚动的（一排胶囊，不换行），可鼠标只有一个竖滚轮 ——
 * 竖着滚会直接滚到外层去，这一行就永远滚不动，所以把竖滚轮翻译成横向滚动。
 * 两条规矩：
 *  · **滚到头就放行**（不 preventDefault），别把滚轮吃掉 —— 否则滚到最右之后，
 *    用户在标签行上再滚就完全没反应，外层也滚不了。
 *  · 触控板本来就能给横向分量（deltaX），那种手势交给浏览器原生处理，不要重复翻译。
 */
function onTagWheel(e) {
  const el = e.currentTarget
  const max = el.scrollWidth - el.clientWidth
  if (max <= 0) return // 没有可横向滚的内容，别拦
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // 横向手势：原生滚
  // deltaMode：0 = 像素，1 = 行（Firefox），2 = 页
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1
  const delta = e.deltaY * unit
  if (!delta) return
  if (delta > 0 ? el.scrollLeft >= max - 1 : el.scrollLeft <= 1) return // 已经到头：放行
  el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + delta))
  e.preventDefault()
}
/**
 * 标签块标题行右边的**纯文本按钮**（`.btn.text`：没有底色也没有边框）：**全勾上**（显示「清空」）
 * 与**全取消**（显示「全选」）之间的双向切换。
 * `allTagsOn` 同时决定按钮文字 —— 只要有一个标签没勾上就显示「全选」。
 * 注意「清空」不是「不筛」：勾选状态就是筛选条件，一个都没勾 = 没有任何乐谱符合条件，
 * 列表会走到「没有符合条件的乐谱」的空状态。
 */
const allTagsOn = computed(() => tagItems.value.length > 0 && tagItems.value.every((it) => filterTags.value.has(it.key)))
function toggleAllTags() {
  filterTags.value = allTagsOn.value ? new Set() : new Set(tagItems.value.map((it) => it.key))
}

/* ---------------------------- 卡片交互 ---------------------------- */

const menu = reactive({ open: false, rec: null, x: 0, y: 0, anchor: null })
const info = reactive({ open: false, rec: null, size: null, title: '', origTitle: '', tags: [], tagDraft: '' })
const confirmDelete = reactive({ open: false, ids: [] })
const coverInput = ref(null)

/** 卡片的「⋯」按钮：菜单贴在按钮下方（**唯一的动作入口，不做右键**） */
function onCardMore(rec, e) {
  const r = e.currentTarget.getBoundingClientRect()
  menu.anchor = { left: r.left, bottom: r.bottom + 4 }
  menu.rec = rec
  menu.open = true
}

function onCardClick(rec) {
  if (selectMode.value) toggleSelect(rec.id)
  else emit('open-score', rec.id)
}

async function onCoverPicked(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || !info.rec) return
  await applyCover(file)
}

async function applyCover(file) {
  try {
    info.rec = await setScoreCover(info.rec.id, file)
  } catch (err) {
    toast(err?.message || t('library.cover.setFailed'), 4000)
  }
}

async function resetCover() {
  if (!info.rec) return
  try {
    info.rec = await setScoreCover(info.rec.id, null)
  } catch (err) {
    toast(err?.message || t('library.cover.resetFailed'), 4000)
  }
}

/** 卡片动作菜单：只在按下的位置弹出（目前唯一的调用方是「⋯」，右键已按约定删除） */
function openMenu(rec, x, y) {
  menu.anchor = null
  menu.rec = rec
  menu.x = x
  menu.y = y
  menu.open = true
}
function onCardAction(key) {
  const rec = menu.rec
  if (!rec) return
  if (key === 'info') openInfo(rec)
  else if (key === 'select') enterSelectMode(rec)
  else if (key === 'remove') askDelete([rec.id])
}

/** 排序按钮：菜单贴在按钮下方 */
function openSort(e) {
  const r = e.currentTarget.getBoundingClientRect()
  sortAnchor.value = { left: r.left, bottom: r.bottom }
  sortOpen.value = true
}
function onSortPick(value) {
  sort.value = value
}
function askDelete(ids) {
  confirmDelete.ids = [...ids]
  confirmDelete.open = true
}

async function openInfo(rec) {
  info.rec = rec
  info.title = rec.title || ''
  info.origTitle = rec.title || ''
  info.tags = [...(rec.meta?.tags || [])]
  info.tagDraft = ''
  info.size = null
  info.open = true
  info.size = await scoreFileInfo(rec.id)
}

/** 音频时长：没有音频就直接说「无音频」，不要显示 0:00 */
const audioDuration = computed(() => {
  const d = info.rec?.meta?.audio?.duration
  if (!d) return t('common.noAudio')
  return `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}`
})

/** 标题 / 标签都即改即生效（设置类改动不要「保存」按钮）；标题在失焦或回车时提交 */
async function commitTitle() {
  const rec = info.rec
  if (!rec) return
  const title = info.title.trim()
  if (!title) {
    info.title = info.origTitle // 清空等于放弃修改，不写库
    return
  }
  if (title === info.origTitle) return
  await renameScore(rec.id, title)
  info.origTitle = title
}

async function addTag(raw) {
  const tag = String(raw || '').trim().slice(0, 24)
  info.tagDraft = ''
  if (!tag || !info.rec || info.tags.includes(tag)) return
  info.tags.push(tag)
  await updateScoreTags(info.rec.id, info.tags)
}
async function removeTag(tag) {
  info.tags = info.tags.filter((x) => x !== tag)
  if (info.rec) await updateScoreTags(info.rec.id, info.tags)
}

/* ------------------------------ 导入导出 ------------------------------ */

async function doImport(files) {
  if (!files?.length) return
  try {
    const { created, problems } = await importFiles(files)
    if (created.length) toast(t('library.imported', { n: created.length }))
    if (problems.length) toast(problems[0], 4200)
  } catch (err) {
    toast(err?.message || t('library.importFailed'), 4000)
  }
}
function onImportPicked(e) {
  doImport(e.target.files)
  e.target.value = ''
}
async function doExport() {
  const ids = selectedCount.value ? [...selected.value] : filtered.value.map((s) => s.id)
  if (!ids.length) return
  try {
    await exportScores(ids)
    toast(t('library.exported', { n: ids.length }))
  } catch (err) {
    toast(err?.message || t('library.exportFailed'), 4000)
  }
}

/**
 * 「备份」抽屉里那颗「导出全部乐谱」：**不看筛选、也不看多选** —— 它保的是整库，
 * 和标题栏那颗按钮的字面意思必须一致（列表是筛过的，「全选」只覆盖看得见的那几条）。
 * 其余（打包、命名、toast）走上面同一条 `exportScores`。
 */
async function doExportAll() {
  const ids = scores.value.map((s) => s.id)
  if (!ids.length) return
  try {
    await exportScores(ids)
    toast(t('library.exported', { n: ids.length }))
  } catch (err) {
    toast(err?.message || t('library.exportFailed'), 4000)
  }
}

async function doDelete() {
  const ids = confirmDelete.ids
  if (!ids.length) return
  await removeScores(ids)
  confirmDelete.open = false
  if (selectMode.value) exitSelectMode()
  toast(t('library.deleted', { n: ids.length }))
}

onMounted(async () => {
  await refresh()
  // 申请「别自动清我的数据」。**这是个只做的动作，结果不参与任何界面分支** ——
  // 圆钮与抽屉不因为它变样（见 `StorageMeter`）
  requestPersistence().catch(() => {})
})
</script>

<template>
  <div class="library">
    <!-- 乐谱库自己的标题栏：左边标题、右边一颗**「备份」圆钮**（外圈环形进度 = 已用额度占比）。
         读数、说明与「导出全部」都在它打开的抽屉里（`StorageSheet`）——
         这里只放一颗按钮，不把数值摊在标题栏上。 -->
    <header class="lib-head">
      <!-- 标题行配 `grid` 图标：与「侧栏收起后左上那颗『乐谱库』胶囊」**同一个图标**
           （那颗胶囊就是回到乐谱库的入口，两处指同一件东西，别换成别的） -->
      <AppIcon name="grid" :size="20" />
      <h2>{{ t('view.library.title') }}</h2>
      <!-- 「显示按钮文字」也管这颗圆钮（与三处胶囊同一个写法）：
           它是独立圆钮、不在胶囊里，蹭不到全局 `.no-labels .cap-label`，所以类名要从这儿挂，
           `StorageMeter` 里那份 `.no-labels .label` 才生效 -->
      <StorageMeter
        :ratio="storageRatio"
        :class="{ 'no-labels': !settings.showButtonLabels }"
        @open="storageOpen = true"
      />
    </header>

    <!-- 面板顶栏：平时是「搜索 + 排序」一行（设置钮搬到左上胶囊里了）；进多选就整条换成操作按钮
         （四个 `.btn.sm.text`，**都没有底色也没有边框**，每个都带图标（18px）+ 文字；
         前三个挂 `.strong` 用黑字，删除挂 `.danger` 用危险色 —— 它是这一组里唯一的语义色）。
         顶部这条下边框就是顶栏与下面标签块之间的分割线（标签在线的**下面**）。 -->
    <header class="lib-bar" :class="{ select: selectMode }">
      <template v-if="selectMode">
        <button type="button" class="btn sm text strong" @click="exitSelectMode">
          <AppIcon name="check" :size="18" /> {{ t('common.done') }}
        </button>
        <button type="button" class="btn sm text strong" @click="selectAll">
          <AppIcon :name="allSelected ? 'close' : 'selectAll'" :size="18" /> {{ allSelected ? t('common.clear') : t('common.selectAll') }}
        </button>
        <button type="button" class="btn sm text strong" :disabled="!selectedCount" @click="doExport">
          <AppIcon name="download" :size="18" /> {{ t('library.export') }}
        </button>
        <button type="button" class="btn sm text danger" :disabled="!selectedCount" @click="askDelete([...selected])">
          <AppIcon name="trash" :size="18" /> {{ t('common.delete') }}
        </button>
      </template>

      <template v-else>
        <!-- 真的搜索框（不是打开浮层的按钮）：输入即过滤，下面的列表实时跟着变 -->
        <div class="search-bar lib-search">
          <AppIcon name="search" :size="17" />
          <input v-model="query" class="search-input" type="search" :placeholder="t('library.search.placeholder')" />
          <button v-if="query" type="button" class="icon-btn flat" :aria-label="t('library.search.clear')" @click="query = ''">
            <AppIcon name="close" :size="15" />
          </button>
        </div>
        <button type="button" class="icon-btn flat" :aria-label="t('library.sort.title')" @click="openSort">
          <AppIcon name="sort" :size="20" />
        </button>
      </template>
    </header>

    <!-- 分割线下面：标签。标题行左边「标签」，右边是「全选 / 清空」文本按钮 + 全部标签的箭头钮；
         下面一行是不换行、横向滚动的胶囊。「无标签」也是一项可筛的标签（排在最前），
         它筛的是所有一个标签都没有的乐谱。 -->
    <div v-if="!selectMode && tags.length" class="tag-block">
      <div class="tag-head">
        <span class="field-label">{{ t('library.tags.title') }}</span>
        <!-- 右边两个动作贴在一起：全选 / 清空是纯文本按钮，箭头把全部标签摊进浮层看 -->
        <div class="tag-actions">
          <button type="button" class="btn sm text" @click="toggleAllTags">{{ allTagsOn ? t('common.clear') : t('common.selectAll') }}</button>
          <button type="button" class="icon-btn flat" :aria-label="t('library.tags.all')" @click="tagsOpen = true">
            <AppIcon name="arrow-down-right" :size="18" />
          </button>
        </div>
      </div>
      <!-- 竖滚轮也滚得动：见 onTagWheel（滚到头会把事件放行给外层） -->
      <div class="tag-scroll" @wheel="onTagWheel">
        <button
          v-for="item in tagItems"
          :key="item.key"
          type="button"
          class="chip tap"
          :class="{ on: filterTags.has(item.key) }"
          @click="toggleTagFilter(item.key)"
        >
          {{ item.label }}<span class="tag-count">{{ item.count }}</span>
        </button>
      </div>
    </div>

    <div v-if="loading" class="empty muted small">{{ t('library.list.loading') }}</div>

    <div v-else-if="!filtered.length" class="empty small">
      <AppIcon name="grid" :size="30" />
      <p v-if="scores.length">{{ t('library.list.emptyFiltered') }}</p>
      <p v-else>{{ t('library.list.emptyNone') }}</p>
    </div>

    <div v-else class="lib-list scroll-y">
      <article
        v-for="rec in filtered"
        :key="rec.id"
        class="card"
        :class="{ on: isSelected(rec.id), current: rec.id === props.currentId }"
        @click="onCardClick(rec)"
      >
        <div class="thumb">
          <img v-if="rec.thumb" :src="rec.thumb" :class="{ custom: rec.coverCustom }" alt="" loading="lazy" />
          <div v-else class="thumb-empty"><AppIcon :name="rec.hasPdf ? 'file' : 'music'" :size="22" /></div>
        </div>
        <!-- 标题一行 + 下面一行灰色小字：小字**跟着排序方式变**
             （按时间看打开时间、标题看标签、占用看大小；没有可显示的就不画这一行、标题竖直居中） -->
        <div class="card-text" :class="{ solo: !cardMeta(rec) }">
          <h3>{{ rec.title }}</h3>
          <p v-if="cardMeta(rec)" class="card-meta">{{ cardMeta(rec) }}</p>
        </div>
        <!-- 多选时就地换成勾选圈，避免列表宽度变化 -->
        <span v-if="selectMode" class="check" :class="{ on: isSelected(rec.id) }">
          <AppIcon v-if="isSelected(rec.id)" name="check" :size="14" />
        </span>
        <button v-else type="button" class="icon-btn flat" :aria-label="t('library.card.more')" @click.stop="onCardMore(rec, $event)">
          <AppIcon name="more" :size="20" />
        </button>
      </article>
    </div>

    <!-- 导入入口固定在面板底部：它是 `.library` 的最后一个子节点，所以列表在上面滚、它不动。
         它只是**一个按钮**（只能点，不收拖入 —— 拖放统一由 PlayerView 整页处理），
         点了就是选文件（pdf / pmz / zip / 音频 / JSON 都收），与整页拖放走同一条 importFiles。 -->
    <button v-if="!selectMode" type="button" class="btn primary lib-import" @click="importInput.click()">
      <AppIcon name="upload" :size="20" /> {{ t('library.import') }}
    </button>

    <div v-if="busy" class="busy small">{{ busy }}</div>

    <input ref="importInput" type="file" multiple accept=".zip,.pmz,application/zip,application/pdf,audio/*,.json" class="hidden" @change="onImportPicked" />

    <!-- 排序：锚在排序按钮上的上下文菜单（不再撑一个抽屉） -->
    <ContextMenu
      :open="sortOpen"
      :items="sortItems"
      :anchor="sortAnchor"
      :title="t('library.sort.title')"
      @select="onSortPick"
      @close="sortOpen = false"
    />

    <!-- 全部标签：横向滚动那一行放不下的长列表，从这里摊进浮层里看。
         胶囊与标签行里的**同一套 `.chip.tap`**（勾选即筛选），顶部是一个占满整行的全选 / 清空。 -->
    <AppSheet :open="tagsOpen" :title="t('library.tags.all')" icon="tags" position="bottom" follow-layout panel-key="tags" @close="tagsOpen = false">
      <button type="button" class="btn block" @click="toggleAllTags">{{ allTagsOn ? t('common.clear') : t('common.selectAll') }}</button>
      <div class="tags tag-sheet">
        <button
          v-for="item in tagItems"
          :key="item.key"
          type="button"
          class="chip tap"
          :class="{ on: filterTags.has(item.key) }"
          @click="toggleTagFilter(item.key)"
        >
          {{ item.label }}<span class="tag-count">{{ item.count }}</span>
        </button>
      </div>
    </AppSheet>

    <!-- 卡片「⋯」的动作菜单：贴住按钮弹出（不是抽屉；**不做右键**） -->
    <ContextMenu
      :open="menu.open"
      :items="cardActions"
      :anchor="menu.anchor"
      :x="menu.x"
      :y="menu.y"
      :title="menu.rec?.title || ''"
      @select="onCardAction"
      @close="menu.open = false"
    />

    <!-- 信息 / 编辑：标题与标签即改即生效，所以没有保存按钮 -->
    <AppSheet :open="info.open" :title="t('library.info.title')" icon="info" position="bottom" follow-layout panel-key="info" @close="info.open = false">
      <div class="form">
        <div>
          <label class="field-label">{{ t('library.info.titleLabel') }}</label>
          <input
            v-model="info.title"
            class="text-input"
            type="text"
            :placeholder="t('library.info.titlePlaceholder')"
            @change="commitTitle"
            @keyup.enter="$event.target.blur()"
          />
        </div>
        <div>
          <label class="field-label">{{ t('library.tags.title') }}</label>
          <!-- 只能回车添加：没有「添加」按钮，标签列表在输入框下面 -->
          <input
            v-model="info.tagDraft"
            class="text-input"
            type="text"
            :placeholder="t('library.tags.placeholder')"
            @keyup.enter="addTag(info.tagDraft)"
          />
          <div class="tags tag-list">
            <button v-for="tag in info.tags" :key="tag" type="button" class="chip tap on" @click="removeTag(tag)">
              {{ tag }}<AppIcon name="close" :size="13" />
            </button>
            <span v-if="!info.tags.length" class="muted small">{{ t('library.tags.empty') }}</span>
          </div>
        </div>
        <div>
          <label class="field-label">{{ t('library.info.cover') }}</label>
          <!-- 整行宽的封面按钮：预览与提示文字都在按钮里，**只能点**
               （拖图片进来换封面由整页拖放统一处理，这里不再自己收 drop） -->
          <button type="button" class="btn ghost cover-pick" @click="coverInput.click()">
            <span class="cover-thumb">
              <img v-if="info.rec?.thumb" :src="info.rec.thumb" :class="{ custom: info.rec?.coverCustom }" alt="" />
              <AppIcon v-else name="image" :size="22" />
            </span>
            <span class="cover-hint">{{ t('library.info.coverHint') }}</span>
          </button>
          <!-- 恢复默认也占满整行 -->
          <button v-if="info.rec?.coverCustom" type="button" class="btn ghost cover-reset" @click="resetCover">{{ t('library.info.coverReset') }}</button>
        </div>
        <!-- 详细信息每样一行：不合并、不用分隔符串起来，也不画分割线 -->
        <div class="facts">
          <div class="fact"><span class="k">{{ t('library.info.pages') }}</span><span class="v mono">{{ info.rec?.pageCount || 0 }} {{ t('unit.page') }}</span></div>
          <div class="fact"><span class="k">{{ t('library.info.measures') }}</span><span class="v mono">{{ info.rec?.measureCount || 0 }} {{ t('unit.measure') }}</span></div>
          <div class="fact"><span class="k">{{ t('library.info.duration') }}</span><span class="v mono">{{ audioDuration }}</span></div>
          <div class="fact"><span class="k">{{ t('library.info.size') }}</span><span class="v mono">{{ info.size === null ? t('common.calculating') : formatBytes(info.size) }}</span></div>
          <div class="fact"><span class="k">{{ t('library.info.openedAt') }}</span><span class="v small">{{ formatDate(info.rec?.openedAt) }}</span></div>
        </div>
      </div>
    </AppSheet>

    <!-- 备份：标题栏那颗圆钮打开的抽屉。读数 / 说明 / 导出全在里面，
         `exportAll` 给的是本组件的 `doExportAll`（复用同一个 `exportScores`）。
         **已占用给的是自己加出来的 `sizesTotal`**（量完之前传 null → 显示「统计中…」），
         总额度给的是浏览器报的 `storeUsage.quota`（拿不到就是 null → 那半段不显示） -->
    <StorageSheet
      :open="storageOpen"
      :used-bytes="sizesReady ? sizesTotal : null"
      :quota-bytes="storeUsage?.quota ?? null"
      :has-scores="scores.length > 0"
      :busy="busy"
      :export-all="doExportAll"
      @close="storageOpen = false"
    />

    <!-- 删除确认 -->
    <AppSheet :open="confirmDelete.open" :title="t('library.delete.title')" position="center" @close="confirmDelete.open = false">
      <p>{{ t('library.delete.confirm', { n: confirmDelete.ids.length }) }}</p>
      <template #footer>
        <button type="button" class="btn ghost" @click="confirmDelete.open = false">{{ t('common.cancel') }}</button>
        <button type="button" class="btn danger" @click="doDelete">{{ t('common.delete') }}</button>
      </template>
    </AppSheet>

    <input ref="coverInput" type="file" accept="image/*" class="hidden" @change="onCoverPicked" />
  </div>
</template>

<style scoped>
.library {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: transparent;
}

/* 空状态 / 加载中也要**吃掉剩下的高度**，否则导入按钮会浮在说明文字下面、贴不到面板底部
   （有列表时是 `.lib-list { flex: 1 }` 顶住的，空状态这一支必须自己补） */
.empty {
  flex: 1;
}

/* 导入按钮贴着**乐谱库自己的底部**（不是整页右下角）：侧栏里就在侧栏底、竖屏抽屉里就在抽屉底。
   它是 `.library` 这个 flex 纵向容器的最后一个子节点，所以列表在上面滚、它原地不动。
   **不要给它加 `.block`**：`width: 100%` 是按容器内容宽算的，再加上左右 8px 的 margin 就会往右
   溢出 8px（曾经就是这样）；纵向 flex 容器里它本来就会被拉伸到「容器宽 − 左右边距」。 */
.lib-import {
  flex: none;
  margin: 0 8px 8px;
}

/* 乐谱库自己的标题栏：高、内边距、字号、下边框都照搬抽屉的 `.sheet-head`
   （两者本来就是一上一下两条并列的标题栏，形态不一样会看出来）——
   右边那颗「备份」圆钮是 `StorageMeter`（`--tap` 的方钮，不吃标题的余量） */
.lib-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 12px 18px;
  min-height: calc(var(--tap) + 24px + 1px);
  border-bottom: 1px solid var(--stroke-soft);
  flex: none;
}
.lib-head h2 {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 顶栏：一行「搜索 + 排序」。它自己的下边框**仍然是分割线** ——
   标签块紧跟在线下面（设置钮的进出不影响这条线的位置与顶栏高度：少一颗图标钮只是右边空出来，
   46 的搜索框还在，所以这一条的高度不变）。 */
.lib-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--stroke-soft);
  flex: none;
}
/* 多选模式：整条顶栏换成操作按钮（四个 `.btn.sm.text`：**没有底色、没有边框**，都带 18px 图标，
   前三个挂 `.strong` 走黑字、删除挂 `.danger` 走危险色），四个按钮**始终平分整条顶栏**（不设最小宽度）。
   `gap: 6px` 与平时那条（搜索框 + 排序钮）一致；`padding: 0 4px` 是给「图标 + 文字」留的余量，
   侧栏拖到很窄时靠 `overflow: hidden` 裁掉，而不是糊到隔壁按钮上。
   flex 项默认 min-width:auto 会撑住不缩，所以要显式给 0，否则「平分」做不到。 */
.lib-bar.select {
  gap: 6px;
}
.lib-bar.select .btn {
  flex: 1 1 0;
  min-width: 0;
  min-height: var(--tap); /* 与平时那条 46px 的搜索框同高，切进切出顶栏不跳 */
  padding: 0 4px;
  gap: 4px; /* 「图标 + 文字」贴紧一点（.btn 默认 8），窄侧栏里才装得下 */
  overflow: hidden; /* 侧栏拖到极窄时裁掉，而不是糊到隔壁按钮上 */
}
/* 搜索框：药丸外观来自全局 .search-bar，这里只让它占掉剩下的宽度 */
.lib-search {
  flex: 1;
  min-width: 0;
}

/* 分割线下面的标签块：标题行（左「标签」+ 右「全选 / 清空」）+ 一行胶囊。
   它不是列表的一部分，固定不滚动。 */
.tag-block {
  flex: none;
  padding: 10px 10px 8px;
}
.tag-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
/* 标题行里的「标签」不用自带下间距，行距由 .tag-head 统一给 */
.tag-head .field-label {
  margin-bottom: 0;
}
/* 右侧两个动作：文本按钮 + 全部标签的箭头钮，贴在一起不散开 */
.tag-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* 列表：一行一张乐谱。侧栏与竖屏抽屉共用这一套，不再有网格 / 紧凑两种分支 */
.lib-list {
  flex: 1;
  min-height: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-content: start;
}

.card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: none;
  border: 0;
  padding: 6px;
  border-radius: var(--radius-sm);
  min-height: 56px;
  cursor: pointer;
  transition: transform 0.08s ease;
}
/* 整行的按下动画只代表「这一行本身被按了」。:active 会从后代冒泡上来，
   所以按行内的「⋯」时要用 :has 排掉，否则会出现「点按钮、整行跟着缩」。
   按钮自己有 .icon-btn:active 的按下态（缩小 + 变底），不需要整行配合。
   底色同时提一档（`--surface-active` 比悬停的 `--surface-hover` 更重），确保按下比悬停明显。 */
.card:active:not(:has(.icon-btn:active)) {
  transform: scale(0.98);
  background: var(--surface-active);
}
.card.on {
  background: var(--accent-weak);
}
/* 当前正打开的那一份：整行底色 + 主题色标题，一眼能认出来 */
.card.current {
  background: var(--surface-control);
}
.card.current h3 {
  color: var(--accent);
}
.card.on.current {
  background: var(--accent-weak);
}
/* 桌面端悬停：整行铺一档悬停底。已选 / 当前打开那两种状态有自己的底色，
   这里显式把它们再写一遍，免得悬停把状态色盖掉（.card:hover 与 .card.on 权重相同）。 */
@media (hover: hover) {
  .card:hover {
    background: var(--surface-hover);
  }
  .card.current:hover {
    background: var(--surface-hover);
  }
  .card.on:hover {
    background: var(--accent-weak);
  }
}
/* 封面框只当**尺寸约束**用：44×44 的方框，图等比完整放进（不裁切），四周留空是**透明**的。
   框自己**不铺底、不描边** —— 铺了底色就等于把留白补成正方形，一张 3:4 的封面看起来像被裁成了方块。 */
.thumb {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 5px;
  overflow: hidden;
  flex: none;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  display: block;
  /* 缩略图是白纸渲染出来的 JPEG，深色模式下与整页 PDF 一样反色 */
  filter: var(--pdf-invert, none);
}
/* 自定义封面是用户自己选的图片，不是白纸渲染的，不能跟着反色（信息面板那处在下面单独写） */
.thumb img.custom {
  filter: none;
}
/* 没有封面时才是那个占位方框（灰色底 + 图标），它不是「封面图」，照旧铺底 */
.thumb-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-control);
  color: var(--text-muted);
}
.check {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--stroke-strong);
  color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}
.check.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
/* 标题那两行：标题 + 下一行的灰色小字。它自己占满中间那一块（原来的 `h3 { flex: 1 }` 挪到这里），
   两行都超长省略 —— 一行标题的时代这里是 `nowrap`，多了一行之后两行都得自己裁。
   没有小字时（`.solo`）标题**竖直居中**，与封面 / 右侧动作位对齐 */
.card-text {
  flex: 1;
  min-width: 0;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
.card h3 {
  margin: 0;
  font-size: 13.5px;
  font-weight: 500;
  text-align: left;
  line-height: 1.35;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 灰色小字：内容随排序方式变（标签 / 占用大小），字比标题小一档、用弱化色 */
.card-meta {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.3;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 信息面板里的封面：整行宽的**按钮**（不再是虚线上传框），预览和提示文字都装在按钮里。
   它盖掉全局 `.btn` 的居中 / 等宽 / nowrap，改成左对齐的横向排布 */
.btn.cover-pick {
  width: 100%;
  min-height: 0;
  padding: 10px 12px;
  gap: 12px;
  justify-content: flex-start;
  text-align: left;
}
/* 预览框（信息面板里那个，68×68）与卡片上的一致：只做尺寸约束，图等比完整放进、不裁切 */
.cover-thumb {
  flex: none;
  width: 68px;
  height: 68px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-control);
  color: var(--text-muted);
}
/* 有图时把占位底撤掉 —— 否则那张不方正的封面四周会被补成正方形 */
.cover-thumb:has(img) {
  background: none;
}
.cover-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  display: block;
  filter: var(--pdf-invert, none);
}
/* 自定义封面是用户自己选的图片，不是白纸渲染的，不能跟着反色 */
.cover-thumb img.custom {
  filter: none;
}
.cover-hint {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-muted);
  text-align: left;
  white-space: normal;
}
.cover-reset {
  width: 100%;
  margin-top: 8px;
}

/* 导入 / 导出进度徽标：浮在**底部导入按钮之上**（46 的按钮 + 8 外边距），别压在按钮上 */
.busy {
  position: absolute;
  left: 50%;
  bottom: calc(var(--tap) + 20px);
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--surface-float);
  border: 1px solid var(--stroke-strong);
  box-shadow: var(--shadow-2);
}

/* 搜索框（顶栏那一行里） */
.search-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: 0;
  outline: none;
  font-size: 16px;
  color: var(--text-strong);
}
.search-input::-webkit-search-cancel-button {
  display: none;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}
/* 信息面板里的标签列表在输入框下面，只需要上间距 */
.tag-list {
  margin: 8px 0 0;
}
/* 「全部标签」浮层：顶部占满一行的全选/清空，下面是与标签行同一套胶囊（可换行） */
.tag-sheet {
  margin: 12px 0 0;
}
.tag-count {
  font-size: 11px;
  opacity: 0.7;
}

/* 标签块里那一行胶囊：不换行，内容比容器宽就在这一行里横向滚动 */
.tag-scroll {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
}
.tag-scroll .chip {
  flex: none;
}

/* 设置那一套（`.settings` / `.set-row` / `.switch`）**跟着面板一起搬到了 `LibrarySettings.vue`** ——
   本组件现在只剩列表 / 标签 / 信息这几摊。 */

/* 表单 */
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.facts {
  display: flex;
  flex-direction: column;
}
/* 明细行之间不画线、不加分割符：靠行距分开就够了 */
.fact {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
}
.fact .k {
  font-size: 13px;
  color: var(--text-muted);
  flex: none;
}
.fact .v {
  font-size: 13.5px;
  text-align: right;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hidden {
  display: none;
}
</style>
