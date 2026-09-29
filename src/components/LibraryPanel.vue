<script setup>
/**
 * 乐谱库面板（原来的 gallery 页面，现在只是一个面板）
 *  · 宿主只有一个（侧栏或竖屏抽屉），两边都是同一套行式列表，不再分网格 / 紧凑两种样式
 *  · **列表按「编辑完成没完成」分两栏**：未完成编辑的（记录里的 `editDone` 为假，只有底栏那颗
 *    「完成」会置真，见 `store/player.js` 的 `finishEdit`）一栏在最上面，已完成编辑的一栏在下面，
 *    每栏头上一条 `.field-label` 小标题；**两栏共用同一个滚动容器**（`groups` 那个 computed，
 *    不是两个各自滚的框）。**库里没有任何「未完成编辑」的谱时退回一栏**：只剩一组、
 *    两条小标题一条都不画，列表与加这个分栏之前完全一样。分栏做在筛完排完之后 ——
 *    搜索 / 标签筛选 / 当前排序两栏都吃；某一栏被筛空就整组（含它的小标题）不画。
 *  · **标题栏在面板自己身上**（`.lib-head`）：左边「乐谱库」、右边一颗**「备份」圆钮**
 *    （`StorageMeter`，外圈环形进度 = 已用额度占比）。点它打开 `StorageSheet`：
 *    占用读数 + 进度条 + 「东西存在哪、什么时候会没」的说明 + 「导出全部乐谱」。
 *    **读数不在标题栏上**，标题栏只放一颗按钮。
 *    侧栏那边的同名标题栏（`PlayerView` 的 `.side-head`）已经删掉，别再往回加一条，否则顶上白一条。
 *  · 顶栏：一行「搜索框 + 菜单钮」（**设置不在这儿了**，见文件末尾那段），**多选时整条换成四个纯文本按钮**
 *    「全选 / 清空 · 导出 · 删除 · 完成」（`.btn.sm.text`，删除再加 `.danger`）——
 *    四个**都没有底色也没有边框**，每个都是「图标 + 文字」：`selectAll`、`export`、
 *    `trash`、`check`；前三个（含删除）用 `--text-strong` 黑字（`.text.strong`），删除用危险色。
 *    那颗「全选 / 清空」**只有标签随状态换，图标恒为 `selectAll`**（不换成 `close`，用户要求）。
 *    四条平分顶栏、与搜索框同高。菜单钮（`menu` 图标）点开的是**贴着它的上下文菜单**，
 *    三项：**排序**（开 `panel-key="sort"` 的「排序方式」面板）、**标签**（开 `panel-key="tags"`
 *    的「全部标签」面板）、**多选**（直接进多选顶栏）。这三项**恒定都在**：库里没有标签时
 *    「标签」照样打得开，面板里会把「去乐谱信息里加标签」讲清楚。
 *    顶栏下面**直接就是列表**（那条分割线是列表自己的 `border-top`）—— **没有标签栏**，
 *    标签筛选整个搬进了「全部标签」面板。
 *  · 底部固定一个整宽的导入按钮（pdf / psz / zip / 音频 / JSON），不跟列表滚动；**只能点、不收拖入**
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
 *  · **筛选胶囊只活在「全部标签」面板里**（顶栏菜单钮 →「标签」），列表顶上没有标签栏：
 *    面板顶部一颗占满整行的全选 / 清空，下面是可换行的胶囊，两边共用同一份 `filterTags`。
 *    一个可筛项都没有时（库里一张乐谱都没有）：那颗按钮不画，改显示一句提示
 *    （`library.tags.emptyHint`）—— 不挂一排空胶囊。
 *  · **标签不是全选时，顶栏下面挂一行小字「已按标签筛选」**（`tagFiltered`）—— 筛选状态只活在面板里、
 *    列表上看不出来，这行是它唯一的常驻痕迹；多选时顶栏整条让位，这行也跟着不画。
 *  · **「无标签」是虚拟标签**（`UNTAGGED` 哨兵，绝不会和真实标签重名）：排在胶囊行最前，筛出所有
 *    一个标签都没有的乐谱，只在真有这种乐谱时出现；标签之间是**「或」**。
 *  · **搜索框的匹配范围是标题 / 标签两者**（`meta.composer` 已删：界面上从来没人能填、也没人看得见）；
 *    空格分隔的多个搜索词之间也是**「或」**；**「无标签」这个虚拟标签同样能被搜到**
 *    （`UNTAGGED_LABEL` 只加在一个标签都没有的乐谱上，不会误伤带标签的乐谱）。
 *  · 勾上 = `.chip.on` = `.chip.accent` 那一套外观（`--accent-weak` 浅底 + `--accent` 描边 + `--accent` 文字），
 *    没勾 = 普通胶囊。这一条与信息面板里的标签**共用 `main.css` 的同一份 `.chip.on`**，只准改那一处；
 *    `.chip.tap.on:hover` **必须重申 `--accent-weak`**，否则鼠标一悬停就把选中态盖成灰底。
 *    **没有独立的「搜索与筛选」浮层** —— 搜索框留在顶栏上，边看边筛。
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
 *    导入 psz 带封面 true）。存储层不改比例（`imageToCover` 仍按 420px 宽等比缩），方框只是显示层的事。
 *  · 信息面板的排布：标签**只用回车添加**（没有「添加」按钮）、列表在输入框下面；详细信息**每样一行**
 *    （页数 / 小节数 / 音频时长 / 占用大小 / 创建时间 / 更新时间），**不要把多项塞进一行、也不要用
 *    `·`、`/` 这类分隔符串值**；**整个信息面板里没有任何分割线**（不要 hr.divider，明细行也不要
 *    border-bottom，靠 `.form` 的 gap 与行内边距分开）。封面是 `.btn.ghost.cover-pick`：**整行宽**的
 *    封面按钮（实线描边、左对齐，左边小预览 + 右边「点击上传替换封面」）—— 它是「封面」这个**字段**
 *    本身，所以留在内容区；自定义封面时的「恢复默认」是**动作按钮**，走 `AppSheet` 的 footer
 *    （面板最底端，没换过封面时连 footer 都不给，见 docs/ui.md §13 / §18.61）——
 *    它是**中性实心底 `.btn` + 一颗 `undo` 图标**（footer 里的按钮一律实心底色 + 18px 图标，
 *    见 docs/ui.md §18.61 第 168 条）。
 *    **它只能点**：不收拖入的图片（拖放只有 PlayerView 整页那一个入口）。
 *
 * 导入入口（`.lib-foot` 这条 footer + 里面那颗 `.btn.primary`）：
 *  · **它是一条 footer**：上面一条分割线（`border-top`）、`flex: none` 钉在底边，与 `AppSheet` 的
 *    `.sheet-foot` 同一套形态（见 docs/ui.md §13 / §18.15）。乐谱库在横竖屏都是左侧栏、不是 `AppSheet`，
 *    所以这条分割线由本组件自己画一份；左右内边距跟着乐谱库自己的列表（8px），不照搬抽屉那档 16px。
 *  · 里面那颗按钮同样是**实心底色 + 18px 图标**（`.btn.primary` + `import`），这条 footer 的规矩
 *    与抽屉的 footer 完全一样（docs/ui.md §18.61 第 168 条）。
 *  · 它是 `.library` 的最后一个 flex 子节点，所以列表在上面滚、它不动；**空状态 / 加载中的 `.empty`
 *    也要 `flex: 1`**，否则这条 footer 会浮在说明文字下面、贴不到底（有列表时是 `.lib-list { flex: 1 }` 顶住）。
 *  · **多选时整条 footer 一起不画**（`v-if="!selectMode"`）：只藏按钮会留下一条空分割线。
 *  · **不要给按钮加 `.block`**：`width: 100%` 加上 footer 的内边距会往右溢出，纵向 flex 容器里本来就会
 *    被拉伸撑满整行。按钮上**不写支持哪些格式**。
 *  · 它靠 `.library { height: 100% }` 拿到确定高度，所以容器要有一条确定高度的链路（`.side-frame` /
 *    `.side-body`）—— **别只给它 `height: 100%` 却让祖先高度是 auto**，
 *    那样它会退化成内容高度、footer 浮到列表中间。
 *  · **所有导入框都是按钮、只能点**（原来的虚线「上传框」与悬浮加号 `.fab` /「新增乐谱」面板都已删）。
 *    设置面板里没有导入 / 生成示例那些杂项，只剩偏好设置。
 *
 * 与页面的分工：「打开某张谱的信息面板」由页面发 `infoRequest = { id, tick }`（tick 自增，重复请求也
 * 生效），**面板状态留在本组件自己手里**；封面 / 标签 / 导出 / 删除都走 `store/library.js`。
 * **删掉的是不是「正在看的那一张」由页面判**：删除成功后本组件只**原样回传删掉的 id**
 * （`scores-removed`），关掉播放器并退回「未打开文件」那一屏是 `PlayerView` 的事
 * （见 `docs/ui.md` §18.67）。
 *
 * **导入完成后不跳进乐谱**（pdf / psz / zip 只把谱收进库）：`importFiles` **每进库一张**就回传一次
 * （`PlayerView.openGallery()` 把它转成 `newIds`），本组件据此把列表**滚到这一行并给它铺一档底色**
 * （`.card.fresh`，与多选选中同一档 `--accent-weak`，1.5 秒后退掉；那 0.5 秒的淡出过渡**只挂在它自己身上**，
 * 多选勾选不受影响、永远是硬切）——
 * 所以多张的导入是**进来一张亮一下**，「新的是哪一张」在列表上就交代清楚了。
 * **别再退回「导完直接打开某一张谱」那条路**：列表上这一下就是它的替代（规矩见 docs/ui.md §18.63）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowUpDown, Check, CircleDashedCheck, EllipsisVertical, File, SquareArrowRightEnter, SquareArrowRightExit, Image, Info, LayoutGrid, Menu, Music, RotateCcw, Search, Tags, Trash, X } from '@lucide/vue'
import AppSheet from '../components/AppSheet.vue'
import ContextMenu from '../components/ContextMenu.vue'
import StorageMeter from '../components/StorageMeter.vue'
import StorageSheet from '../components/StorageSheet.vue'
import {
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
import { errorToast } from '../store/toast.js'
import { settings } from '../store/settings.js'
import { t } from '../i18n/index.js'

/**
 * `scores-removed`（删除成功后回传删掉的 id 数组）：页面据它决定「正在看的那一张被删了没有」——
 * 判据与收尾都在页面那边（见文件头注释）。
 */
const emit = defineEmits(['open-score', 'scores-removed'])
/**
 * 当前打开的乐谱 id：列表里给它加一层底色（由 PlayerView 传入，组件不直接读播放器状态）
 * infoRequest：页面拖入文件后要求「打开某张谱的信息面板」，形如 `{ id, tick }`，
 *   tick 每次自增，所以对同一张谱重复请求也会重新打开。
 * newIds：**刚进库的这一张**的 id（一个元素的数组；页面对**每进库一张**就给一次新数组）。
 *   **导入不会把人带进某张谱里**，这份列表就是「哪一张是新的」唯一的线索 —— 列表据它滚过去
 *   并铺一档底色（见 `markFresh`）。**每次都给一个新的数组实例**（哪怕是同一个 id）：
 *   watch 认的是引用，新实例才会再滚一次、再亮一次。
 */
const props = defineProps({
  currentId: { type: String, default: '' },
  infoRequest: { type: Object, default: null },
  newIds: { type: Array, default: () => [] },
})

watch(
  () => props.infoRequest,
  (req) => {
    if (!req?.id) return
    const rec = scores.value.find((s) => s.id === req.id)
    if (rec) openInfo(rec)
  }
)

/**
 * 刚进库的那一张的**瞬时高亮**（只加一个 `.card.fresh` 类，底色就是多选选中那一档）。
 * `newIds` 是**进来一张就换一次**的，所以多张导入时是**一张接一张地亮**。
 *
 * ⚠️ **计时器按 id 各算各的**（不能只留一个）：只留一个的话，第二张一到就把第一张的计时换掉，
 * 第一张会一直亮着不退；按 id 各算各的，谁先到点谁先退。
 * 到点先摘 `.fresh`、再挂 `FRESH_FADE_MS` 的 `.fresh-out` —— **那 0.5 秒的底色过渡挂在
 * `.fresh-out` 上，不在 `.card` 上**（见样式那一段）：过渡写在 `.card` 上会把多选勾选 / 取消勾选的
 * 底色也拖成 0.5 秒的渐变，而多选勾选必须**立刻生效**。所以淡出得留一个类在元素上带过渡，
 * 光「摘掉 `.fresh`」是淡不起来的（改动之后的那份样式里已经没有过渡了）。
 */
const FRESH_MS = 1500
/** 与 `.card.fresh-out` 那条 `background-color` 过渡同一个数 */
const FRESH_FADE_MS = 500
const fresh = ref([])
/** 刚摘掉 `.fresh`、正在淡回常态的这一批（模板里**只在它没被选中时**才挂 `.fresh-out`） */
const freshOut = ref([])
const freshTimers = new Map()
function markFresh(ids) {
  fresh.value = [...new Set([...fresh.value, ...ids])]
  freshOut.value = freshOut.value.filter((x) => !ids.includes(x))
  for (const id of ids) {
    clearTimeout(freshTimers.get(id))
    freshTimers.set(
      id,
      setTimeout(() => {
        fresh.value = fresh.value.filter((x) => x !== id)
        freshOut.value = [...freshOut.value, id]
        freshTimers.set(
          id,
          setTimeout(() => {
            freshTimers.delete(id)
            freshOut.value = freshOut.value.filter((x) => x !== id)
          }, FRESH_FADE_MS)
        )
      }, FRESH_MS)
    )
  }
}
/** 组件卸载时把没到点的计时一起收掉，别让它们回来改一个已经不在的列表 */
onBeforeUnmount(() => {
  for (const timer of freshTimers.values()) clearTimeout(timer)
  freshTimers.clear()
})

/**
 * `newIds` 一变就滚过去 + 亮起来。
 *
 * `await nextTick()` **同时干两件事**：等列表把这一行渲染出来（`scores` 在 `importFiles` 里刷新过），
 * 以及把「同一刻连着进来的几张」攒成一批 —— 攒成一批就只滚一次（滚到这批的第一张），
 * 后面**一张一张**进来的那些才各滚各的、各亮各的。
 */
watch(
  () => props.newIds,
  async (ids) => {
    if (!ids?.length) return
    markFresh(ids)
    await nextTick()
    const el = document.querySelector(`.lib-list .card[data-id="${ids[0]}"]`)
    if (!el) return // 它没进当前列表（搜索 / 标签筛掉了）—— 不亮、也不硬滚
    // 「滚到**看得见**这张」而不是滚到顶：新导入的排在最前时（默认按最近打开排），本来就不用滚
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
)

const query = ref('')
const sort = ref('opened-desc')
const selectMode = ref(false)
const selected = ref(new Set())
const filterTags = ref(new Set())

const topMenuOpen = ref(false)
const topMenuAnchor = ref(null) // 顶栏菜单钮的位置，菜单贴在它下面
const sortOpen = ref(false)
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

/**
 * 顶栏菜单钮（`Menu` 图标）打开的三项：**排序 / 标签 / 多选**。
 * 前两项各自去开一个面板（排序方式 / 全部标签），第三项直接进多选顶栏。
 * **三项恒定都在**，不按「库里有没有标签」增删 —— 没有标签时「标签」打开的面板里会讲清楚
 * 该去哪儿加标签。文字里「标签」复用 `library.tags.title`（同一个词不另立一份）。
 */
const topMenuItems = computed(() => [
  { key: 'sort', label: t('library.menu.sort'), icon: ArrowUpDown },
  { key: 'tags', label: t('library.tags.title'), icon: Tags },
  { key: 'select', label: t('library.menu.select'), icon: CircleDashedCheck },
])

/** 卡片右下角「⋯」出来的动作（文字复用 common.*） */
const CARD_ACTIONS = [
  { key: 'info', labelKey: 'common.info', icon: Info },
  { key: 'select', labelKey: 'common.select', icon: Check },
  { key: 'remove', labelKey: 'common.delete', icon: Trash, danger: true },
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
 * 「全部标签」面板里的每一项：**「无标签」也是一个可筛的标签**（排在最前，只在真有这种乐谱时出现），
 * 后面才是真实标签。全选 / 清空由面板顶部那颗整行按钮负责，不占这里的名额。
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
  // 时间那一档比的是 `openedAt`（最近一次打开），同刻的按标题兜底，排序才是确定的。
  // **方向与 `cmpHanSize` 同一套：`dir = 1` 是降序（最近在前），`-1` 是升序** —— 两处别各写各的。
  const cmpHanOpened = (a, b, dir) => dir * ((b.openedAt || 0) - (a.openedAt || 0)) || cmpHan(a.title, b.title)
  switch (sort.value) {
    case 'opened-asc':
      list.sort((a, b) => cmpHanOpened(a, b, -1))
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
      list.sort((a, b) => cmpHanOpened(a, b, 1))
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

/**
 * 列表分栏：**未完成编辑**的（`editDone` 为假）一栏在最上面，**已完成编辑**的（`editDone` 为真）一栏在下面。
 *
 * · 分栏在**筛完、排完之后**做 —— 搜索 / 标签筛选 / 当前排序**两栏都吃**。
 * · **上面那一栏空了就退回一栏**：`groups` 只剩一组、`label` 也没有，
 *   列表与加这个功能之前完全一样（没有小标题、没有分段）。
 * · 一栏里一张都不剩（被筛掉了）就**整组不画**，那一栏的小标题跟着一起消失。
 * · 两栏共用**同一个** `.lib-list` 滚动容器（不是两个各自滚的框，别改成那样）。
 */
const groups = computed(() => {
  const unfinished = filtered.value.filter((s) => !s.editDone)
  const done = filtered.value.filter((s) => s.editDone)
  if (!unfinished.length) return [{ key: 'all', items: filtered.value }]
  return [
    { key: 'unfinished', label: t('library.list.editUnfinished'), items: unfinished },
    { key: 'done', label: t('library.list.editDone'), items: done },
  ].filter((g) => g.items.length)
})

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
 * 「全部标签」面板顶部那颗**整行按钮**（`.btn.block`）：**全勾上**（显示「清空」）
 * 与**全取消**（显示「全选」）之间的双向切换。
 * `allTagsOn` 同时决定按钮文字 —— 只要有一个标签没勾上就显示「全选」。
 * 注意「清空」不是「不筛」：勾选状态就是筛选条件，一个都没勾 = 没有任何乐谱符合条件，
 * 列表会走到「没有符合条件的乐谱」的空状态。
 * 一个可筛项都没有（`tagItems` 为空）时这颗按钮不画 —— 面板里改显示一句提示。
 */
const allTagsOn = computed(() => tagItems.value.length > 0 && tagItems.value.every((it) => filterTags.value.has(it.key)))
function toggleAllTags() {
  filterTags.value = allTagsOn.value ? new Set() : new Set(tagItems.value.map((it) => it.key))
}
/**
 * **标签不是全选 = 真的在按标签筛**：这时顶栏下面挂一行小字「已按标签筛选」。
 * 筛选状态只活在「全部标签」面板里、列表上看不出来，这行是它唯一的常驻痕迹，
 * 点开面板之前也看得见。一个可筛项都没有（`tagItems` 为空 = 库里没有乐谱）不算在筛，不画。
 */
const tagFiltered = computed(() => tagItems.value.length > 0 && !allTagsOn.value)

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
    errorToast(err?.message || t('library.cover.setFailed'))
  }
}

async function resetCover() {
  if (!info.rec) return
  try {
    info.rec = await setScoreCover(info.rec.id, null)
  } catch (err) {
    errorToast(err?.message || t('library.cover.resetFailed'))
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

/** 顶栏菜单钮：菜单贴在按钮下方（与卡片「⋯」同一套 `ContextMenu`） */
function openTopMenu(e) {
  const r = e.currentTarget.getBoundingClientRect()
  topMenuAnchor.value = { left: r.left, bottom: r.bottom }
  topMenuOpen.value = true
}

/**
 * 顶栏菜单里挑了一项：**排序 / 标签各开一个面板，多选直接就地进多选顶栏**。
 * 面板是抽屉、与菜单互斥，所以先关菜单（`ContextMenu` 自己会关）再开面板就行。
 */
function onTopMenuPick(key) {
  if (key === 'sort') sortOpen.value = true
  else if (key === 'tags') tagsOpen.value = true
  else if (key === 'select') enterSelectMode(null)
}

/** 「排序方式」面板里挑一档：**改完就关面板**（与倍速面板同一个手感） */
function pickSort(value) {
  sort.value = value
  sortOpen.value = false
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

/**
 * 导入：**整件事只有一条通知** —— 进度、「已导入 n 张」、以及出问题时那句原因，
 * 全都由 `importFiles` 那条任务通知自己就地报（用户要求「任务完成后变为一次性通知显示任务完成，
 * 而不是新发一个通知说完成」）。所以这里**只兜它压根没走到那一步的意外**（抛出来的错误）：
 * 那种情况 `importFiles` 一条提示都还没弹过，两边不会都报。
 */
async function doImport(files) {
  if (!files?.length) return
  try {
    await importFiles(files)
  } catch (err) {
    errorToast(err?.message || t('library.importFailed'))
  }
}
function onImportPicked(e) {
  doImport(e.target.files)
  e.target.value = ''
}
/** 导出：进度与「导出了几张」同样由 `exportScores` 那条任务通知报，这里只报它抛出来的失败 */
async function doExport() {
  const ids = selectedCount.value ? [...selected.value] : filtered.value.map((s) => s.id)
  if (!ids.length) return
  try {
    await exportScores(ids)
  } catch (err) {
    errorToast(err?.message || t('library.exportFailed'))
  }
}

/**
 * 「备份」抽屉里那颗「导出全部乐谱」：**不看筛选、也不看多选** —— 它保的是整库，
 * 和标题栏那颗按钮的字面意思必须一致（列表是筛过的，「全选」只覆盖看得见的那几条）。
 * 其余（打包、命名、进度、toast）走上面同一条 `exportScores`。
 */
async function doExportAll() {
  const ids = scores.value.map((s) => s.id)
  if (!ids.length) return
  try {
    await exportScores(ids)
  } catch (err) {
    errorToast(err?.message || t('library.exportFailed'))
  }
}

/**
 * 删除：**进度与「已删除 n 张」都由 `removeScores` 那条任务通知自己就地报**
 * （它收尾时把同一条变成一次性通知）—— 这里**不许再补一句**，补了就是两条：
 * 用户明确要求「任务完成后变为一次性通知显示任务完成，而不是新发一个通知说完成」。
 * 这里只兜**删除本身失败**：`removeScores` 遇到这种错会把进度收掉再抛出（不在那边报），
 * 所以这条提示是唯一出口，不会两处都报。
 *
 * 删成功之后**原样回传删掉的 id**（`scores-removed`）——「正在看的那一张被删了」由页面自己判。
 */
async function doDelete() {
  const ids = confirmDelete.ids
  if (!ids.length) return
  let ok = false
  try {
    await removeScores(ids)
    ok = true
  } catch (err) {
    errorToast(err?.message || t('library.deleteFailed'))
  }
  confirmDelete.open = false
  if (selectMode.value) exitSelectMode()
  // **删成功才回传**：里面有正在看的那一张时由页面把它关掉（`PlayerView.onScoresRemoved`）
  if (ok) emit('scores-removed', ids)
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
      <!-- 标题行配 `LayoutGrid` 图标：与「侧栏收起后左上那颗『乐谱库』胶囊」**同一个图标**
           （那颗胶囊就是回到乐谱库的入口，两处指同一件东西，别换成别的） -->
      <LayoutGrid :size="20" />
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

    <!-- 面板顶栏：平时是「搜索 + 菜单钮」一行（设置钮搬到左上胶囊里了）；进多选就整条换成操作按钮
         （四个 `.btn.sm.text`，**都没有底色也没有边框**，每个都带图标（18px）+ 文字；
         前三个挂 `.strong` 用黑字，删除挂 `.danger` 用危险色 —— 它是这一组里唯一的语义色）。
         顶栏自己不画线：下面那条分割线是列表的 `border-top`（顶栏下面直接就是列表）。 -->
    <header class="lib-bar" :class="{ select: selectMode }">
      <template v-if="selectMode">
        <button type="button" class="btn sm text strong" @click="exitSelectMode">
          <Check :size="18" /> {{ t('common.done') }}
        </button>
        <button type="button" class="btn sm text strong" @click="selectAll">
          <CircleDashedCheck :size="18" /> {{ allSelected ? t('common.clear') : t('common.selectAll') }}
        </button>
        <button type="button" class="btn sm text strong" :disabled="!selectedCount" @click="doExport">
          <SquareArrowRightExit :size="18" /> {{ t('library.export') }}
        </button>
        <button type="button" class="btn sm text danger" :disabled="!selectedCount" @click="askDelete([...selected])">
          <Trash :size="18" /> {{ t('common.delete') }}
        </button>
      </template>

      <template v-else>
        <!-- 真的搜索框（不是打开浮层的按钮）：输入即过滤，下面的列表实时跟着变 -->
        <div class="search-bar lib-search">
          <Search :size="17" />
          <input v-model="query" class="search-input" type="search" :placeholder="t('library.search.placeholder')" />
          <button v-if="query" type="button" class="icon-btn flat" :aria-label="t('library.search.clear')" @click="query = ''">
            <X :size="15" />
          </button>
        </div>
        <!-- 菜单钮（`Menu` 图标）：点开的上下文菜单里是 排序 / 标签 / 多选。
             前两项各开一个面板，第三项直接进多选顶栏。 -->
        <button type="button" class="icon-btn flat" :aria-label="t('library.menu.title')" @click="openTopMenu">
          <Menu :size="20" />
        </button>
      </template>
    </header>

    <!-- 顶栏下面**直接就是列表**（顶上那条线是 `.lib-list` 自己的 `border-top`）：
         标签筛选整个搬进了「全部标签」面板，列表顶上没有标签栏。

         「已按标签筛选」那行小字：筛选取的是「不是全选」这个状态（`tagFiltered`）——
         筛选状态只活在面板里，这行是它唯一的常驻痕迹。多选时顶栏整条让位，这行也跟着不画。 -->
    <p v-if="!selectMode && tagFiltered" class="lib-filter-hint muted small">{{ t('library.tags.filtered') }}</p>

    <div v-if="loading" class="empty muted small">{{ t('library.list.loading') }}</div>

    <div v-else-if="!filtered.length" class="empty small">
      <LayoutGrid :size="30" />
      <p v-if="scores.length">{{ t('library.list.emptyFiltered') }}</p>
      <p v-else>{{ t('library.list.emptyNone') }}</p>
    </div>

    <div v-else class="lib-list scroll-y">
      <!-- 一栏还是两栏由 `groups` 决定（见它的注释）：**没有任何「未完成编辑」的谱时
           只有一组、两个小标题都不画**，列表与以前一模一样。
           两栏共用这一个滚动容器，栏标题是 `.field-label`。 -->
      <template v-for="g in groups" :key="g.key">
        <label v-if="g.label" class="field-label">{{ g.label }}</label>
        <article
          v-for="rec in g.items"
          :key="rec.id"
          :data-id="rec.id"
          class="card"
          :class="{
            on: isSelected(rec.id),
            current: rec.id === props.currentId,
            fresh: fresh.includes(rec.id),
            // 正在淡出：`.fresh-out` 是**唯一**带底色过渡的那个类。**被选中时不挂** ——
            // 挂了的话，这 0.5 秒里取消勾选就会被那条过渡拖着慢慢变（多选必须立刻生效）。
            'fresh-out': freshOut.includes(rec.id) && !isSelected(rec.id),
          }"
          @click="onCardClick(rec)"
        >
          <div class="thumb">
            <img v-if="rec.thumb" :src="rec.thumb" :class="{ custom: rec.coverCustom }" alt="" loading="lazy" />
            <div v-else class="thumb-empty"><component :is="rec.hasPdf ? File : Music" :size="22" /></div>
          </div>
          <!-- 标题一行 + 下面一行灰色小字：小字**跟着排序方式变**
               （按时间看打开时间、标题看标签、占用看大小；没有可显示的就不画这一行、标题竖直居中） -->
          <div class="card-text" :class="{ solo: !cardMeta(rec) }">
            <h3>{{ rec.title }}</h3>
            <p v-if="cardMeta(rec)" class="card-meta">{{ cardMeta(rec) }}</p>
          </div>
          <!-- 多选时就地换成勾选圈，避免列表宽度变化 -->
          <span v-if="selectMode" class="check" :class="{ on: isSelected(rec.id) }">
            <Check v-if="isSelected(rec.id)" :size="14" />
          </span>
          <button v-else type="button" class="icon-btn flat" :aria-label="t('library.card.more')" @click.stop="onCardMore(rec, $event)">
            <EllipsisVertical :size="20" />
          </button>
        </article>
      </template>
    </div>

    <!-- 导入入口 = **乐谱库自己的 footer**：上面一条分割线、贴着底边不滚动
         （形态与 `AppSheet` 的 `.sheet-foot` 同一套，见 docs/ui.md §13 / §18.15；
          乐谱库横竖屏都是左侧栏、不是 `AppSheet`，所以这条线得在这儿自己画）。
         它是 `.library` 的最后一个子节点，所以列表在上面滚、它原地不动。
         它只是**一个按钮**（只能点，不收拖入 —— 拖放统一由 PlayerView 整页处理），
         点了就是选文件（pdf / psz / zip / 音频 / JSON 都收），与整页拖放走同一条 importFiles。
         **多选时整条 footer 一起不画** —— 只藏按钮会留下一条空分割线。 -->
    <footer v-if="!selectMode" class="lib-foot">
      <button type="button" class="btn primary" @click="importInput.click()">
        <SquareArrowRightEnter :size="18" /> {{ t('library.import') }}
      </button>
    </footer>

    <input ref="importInput" type="file" multiple accept=".zip,.psz,application/zip,application/pdf,audio/*,.json" class="hidden" @change="onImportPicked" />

    <!-- 顶栏菜单钮的三项（排序 / 标签 / 多选）：**贴着按钮的小菜单**，不是抽屉。
         点「排序」/「标签」才换成下面的面板，点「多选」直接进多选顶栏。 -->
    <ContextMenu
      :open="topMenuOpen"
      :items="topMenuItems"
      :anchor="topMenuAnchor"
      @select="onTopMenuPick"
      @close="topMenuOpen = false"
    />

    <!-- 排序方式：面板里是单选项列表（`.opt-list` + `.opt`，与倍速面板同一套），
         当前那档带勾、点一档就改排序并关掉面板。
         ⚠️ 模板里 `sort` 是**自动解包的 ref**（写 `sort.value` 会得到 undefined），只写 `sort`。 -->
    <AppSheet :open="sortOpen" :title="t('library.sort.title')" :icon="ArrowUpDown" position="bottom" compact follow-layout panel-key="sort" @close="sortOpen = false">
      <div class="opt-list">
        <button
          v-for="s in SORTS"
          :key="s.value"
          type="button"
          class="opt"
          :class="{ on: sort === s.value }"
          @click="pickSort(s.value)"
        >
          <span class="spacer">{{ t(s.labelKey) }}</span>
          <Check v-if="sort === s.value" :size="19" class="tick" />
        </button>
      </div>
    </AppSheet>

    <!-- 全部标签：标签筛选**唯一**的落点（列表顶上没有标签栏）。
         顶部一颗占满整行的全选 / 清空，下面是与信息面板**同一套 `.chip.tap`** 的可换行胶囊，
         勾选即筛选。**一个可筛项都没有时**（库里一张乐谱都没有）那颗按钮与胶囊行都不画，
         改显示一句提示 —— 不挂一排空胶囊。 -->
    <AppSheet :open="tagsOpen" :title="t('library.tags.all')" :icon="Tags" position="bottom" follow-layout panel-key="tags" @close="tagsOpen = false">
      <template v-if="tagItems.length">
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
      </template>
      <p v-else class="muted small">{{ t('library.tags.emptyHint') }}</p>
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
    <AppSheet :open="info.open" :title="t('library.info.title')" :icon="Info" position="bottom" follow-layout panel-key="info" @close="info.open = false">
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
              {{ tag }}<X :size="13" />
            </button>
            <span v-if="!info.tags.length" class="muted small">{{ t('library.tags.empty') }}</span>
          </div>
        </div>
        <div>
          <label class="field-label">{{ t('library.info.cover') }}</label>
          <!-- 整行宽的封面按钮：预览与提示文字都在按钮里，**只能点**
               （拖图片进来换封面由整页拖放统一处理，这里不再自己收 drop）。
               它是「封面」这个**字段**本身（里面带着当前封面的预览），所以留在内容区、不进 footer -->
          <button type="button" class="btn ghost cover-pick" @click="coverInput.click()">
            <span class="cover-thumb">
              <img v-if="info.rec?.thumb" :src="info.rec.thumb" :class="{ custom: info.rec?.coverCustom }" alt="" />
              <Image v-else :size="22" />
            </span>
            <span class="cover-hint">{{ t('library.info.coverHint') }}</span>
          </button>
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

      <!-- 「恢复默认」是**动作按钮**，所以走 footer（面板最底端、不跟内容滚，见 docs/ui.md §13 / §18.61）：
           中性实心底 `.btn` + `undo` 图标 + 文字（footer 里不许出现描边档）。
           没换过自定义封面时没有动作可做，**连 footer 都不给** —— 免得留一条空边框（同 `EditorPanel` 的删除）。 -->
      <template v-if="info.rec?.coverCustom" #footer>
        <button type="button" class="btn" @click="resetCover">
          <RotateCcw :size="18" /> {{ t('library.info.coverReset') }}
        </button>
      </template>
    </AppSheet>

    <!-- 备份：标题栏那颗圆钮打开的抽屉。读数 / 说明 / 导出全在里面，
         `exportAll` 给的是本组件的 `doExportAll`（复用同一个 `exportScores`）。
         **已占用给的是自己加出来的 `sizesTotal`**（量完之前传 null → 显示「统计中…」），
         总额度给的是浏览器报的 `storeUsage.quota`（拿不到就是 null → 那半段不显示）。
         **不再传 `busy`**：「正在打包 i/n…」现在由 `exportScores` 那条**任务型 toast** 显示
         （圆环 + 进度，见 `store/library.js` / `store/toast.js`），
         抽屉里那行小字删掉了 —— 一件事只有一个实现 -->
    <StorageSheet
      :open="storageOpen"
      :used-bytes="sizesReady ? sizesTotal : null"
      :quota-bytes="storeUsage?.quota ?? null"
      :has-scores="scores.length > 0"
      :export-all="doExportAll"
      @close="storageOpen = false"
    />

    <!-- 删除确认 -->
    <AppSheet :open="confirmDelete.open" :title="t('library.delete.title')" position="center" @close="confirmDelete.open = false">
      <p>{{ t('library.delete.confirm', { n: confirmDelete.ids.length }) }}</p>
      <template #footer>
        <button type="button" class="btn" @click="confirmDelete.open = false">
          <X :size="18" /> {{ t('common.cancel') }}
        </button>
        <button type="button" class="btn danger" @click="doDelete">
          <Trash :size="18" /> {{ t('common.delete') }}
        </button>
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

/* 乐谱库的 footer（导入入口那条）：**与 `AppSheet` 的 `.sheet-foot` 同一套形态** ——
   上面一条 1px 弱描边当分割线、`flex: none` 钉在底边，里面的按钮撑满整行（见 docs/ui.md §13 / §18.15）。
   它是 `.library` 这个纵向 flex 容器的最后一个子节点，所以列表在上面滚、它原地不动。

   ⚠️ **两处与 `.sheet-foot` 故意不一样**（别照着那边改）：
    · **左右内边距是 8px**（不是 16px）—— 乐谱库自己的列表就是 8px，照搬 16px 会让按钮比上面的卡片窄一圈；
    · 底部照 `.sheet-foot` 的写法带上安全区（`--safe-b`），按钮才不会压在手机的手势条上。
   **不要给按钮加 `.block`**：`width: 100%` 是按容器内容宽算的，再加上内边距就会往右溢出
   （纵向 flex 容器里它本来就会被拉伸撑满）。 */
.lib-foot {
  display: flex;
  flex: none;
  padding: 12px 8px calc(12px + var(--safe-b));
  border-top: 1px solid var(--stroke-soft);
}
.lib-foot .btn { flex: 1; }

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

/* 顶栏：一行「搜索 + 菜单钮」。它自己**没有下边框** ——
   顶栏与列表之间那条分割线是 `.lib-list` 自己的 `border-top`（标签块删掉之后两者直接相邻，
   所以只能有一处画线，别往这里再加一条）。
   下内边距 10px 就是原来标签块顶上的那一段：搜索框与分割线之间不留空会糊在一起。 */
.lib-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  flex: none;
}
/* 多选模式：整条顶栏换成操作按钮（四个 `.btn.sm.text`：**没有底色、没有边框**，都带 18px 图标，
   前三个挂 `.strong` 走黑字、删除挂 `.danger` 走危险色），四个按钮**始终平分整条顶栏**（不设最小宽度）。
   `gap: 6px` 与平时那条（搜索框 + 菜单钮）一致；`padding: 0 4px` 是给「图标 + 文字」留的余量，
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

/* 「已按标签筛选」那行小字：挂在顶栏下面（缩进与搜索框对齐）、列表那条分割线上面。
   它不是列表的一部分，固定不滚动；多选时不画（顶栏整条让位）。 */
.lib-filter-hint {
  flex: none;
  margin: 0;
  padding: 0 10px 8px;
}

/* 列表：一行一张乐谱。侧栏与竖屏抽屉共用这一套，不再有网格 / 紧凑两种分支。
   它的 `border-top` 就是顶栏与列表之间那条**分割线**（顶栏自己没有下边框）。 */
.lib-list {
  flex: 1;
  min-height: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-content: start;
}
/* 两栏时那两条栏标题（`.field-label`：「未完成编辑」/「已完成编辑」）：
   它同样是 `.lib-list` 的 flex 子项，与卡片之间的间距由上面的 gap 管，
   所以这里把全局 `.field-label` 的 `margin-bottom` 收掉、只留一点左右缩进
   （8px 内边距 + 2px = 与卡片内容对齐的观感）。第二栏那条再往上多留一段，
   两栏才不会连成一整段。**一栏时一条都不画**（模板里 `v-if="g.label"`）。 */
.lib-list .field-label {
  margin: 2px 2px 0;
}
.lib-list .field-label ~ .field-label {
  margin-top: 12px;
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
  /* 常态**不带底色过渡**：勾选 / 取消勾选、按下、悬停、切当前打开那张都是**硬切**，立刻生效
     （按下那个 `transform` 仍用短过渡）。底色过渡只挂在下面 `.fresh` / `.fresh-out` 这两个类上 ——
     它是给「刚进库的那一张」亮完淡回去用的，写在 `.card` 上会把多选勾选也拖成 0.5 秒的渐变。 */
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
/* 刚进库的那一张（`.card.fresh`，由 `newIds` → `markFresh` 挂上、1.5 秒后退掉）：
   **只铺一层底色，就是多选时选中那一档**（`.card.on` 的 `--accent-weak`）——
   没有脉冲、没有描边、没有第二档颜色；这一层是**加上去**的，到点摘掉之后由 `.fresh-out` 的过渡淡回常态，
   所以多张导入时是**一张接一张地亮**（前一张不受后一张影响）。
   **别改成常驻**：它只是「新的是哪一张」的交代，导入**不会**把人带进某张谱里。
   与 `.card.on` / `.card.current` 并存时这一层压在上面（`.card.fresh` 与 `.card.on` 同分、写在后面），
   摘掉后各自回到自己的底色。
   ⚠️ **底色过渡只在这两个类上**（`FRESH_FADE_MS` = 0.5s，两处是同一个数）：`.fresh` 管「亮起来」那一下、
   `.fresh-out` 管「淡回去」那一下 —— 摘掉 `.fresh` 之后过渡必须还留在元素上才淡得起来，所以它在摘掉后
   **再挂 0.5 秒**（模板里**被选中时不挂**，免得勾选被它拖着走）。
   **不许挪回 `.card`**：那样多选勾选 / 取消勾选也跟着 0.5 秒渐变，而勾选必须立刻生效。 */
.card.fresh,
.card.fresh-out {
  transition: transform 0.08s ease, background-color 0.5s ease;
}
.card.fresh {
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
/* 「全部标签」面板：顶部占满一行的全选 / 清空，下面是与信息面板同一套胶囊（可换行） */
.tag-sheet {
  margin: 12px 0 0;
}
.tag-count {
  font-size: 11px;
  opacity: 0.7;
}

/* 设置那一套（`.settings` / `.set-row` / `.switch`）**跟着面板一起搬到了 `LibrarySettings.vue`** ——
   本组件现在只剩列表 / 信息 / 排序 / 标签这几摊。 */

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
