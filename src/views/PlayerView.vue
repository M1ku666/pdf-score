<script setup>
/**
 * 播放器 / 唯一页面
 *  · 没打开乐谱时显示「未打开文件」
 *  · 页面自己就是「侧栏 + 抽屉」两套布局的宿主：左边那条 `.side-bar`（乐谱库，占谱面宽度、
 *    可拖宽、只有展开 / 收起两态）+ `#sheet-slot`（面板 Teleport 的落点）+ 抽屉遮罩。
 *    布局模型与 store API 见 docs/ui.md §13，别在本组件里另写一套。
 *  · **左上那颗「乐谱库」胶囊是收起后的唯一回头路**（`v-if="!libraryOpen"`，
 *    `.capsule.glass` + 一个 `.cap-btn`，边距取 `--glass-inset-*`）—— 只在侧栏收起时出现，别删。
 *  · **「未打开文件」这一屏侧栏默认展开**（路由 `/`）：只在**进入这一屏的那一刻**展开一次
 *    （`load()` 里「没有 id 且本来也没开着」+ 从 `/:id` 返回时各补一次）。
 *    **别写成「发现侧栏收着就自动展开」的 watch** —— 那样用户一收起就立刻被弹开、再也收不掉了。
 *    打开乐谱（`openScore`）照旧 `collapseLibrary()`；**点的就是当前那一张时例外** ——
 *    什么都不用换，侧栏留在原地不收起。打开失败分两种：**「库里没这条记录」退回 `/`**
 *    （地址换掉，于是这一次导航又落回上面那条 `/` 的规矩里），**其余失败留在 `/:id` 上显示错误、不展开**。
 *  · **正在看的那一张在乐谱库里被删掉时，人跟着退回来**：乐谱库删成功会回传删掉的 id
 *    （`@scores-removed`），里面有 `player.id` 就走 `onScoresRemoved()` —— 关掉播放器（**不保存**，
 *    记录已经没了）并 `router.replace('/')`，落回「未打开文件」那一屏（见 docs/ui.md §18.67）。
 *  · **文件导入只有这一处分流**（`handleFiles`；整页拖入与乐谱库底部那颗「导入文件」选出来的文件
 *    都进它，见 `onDragEnter/onDragLeave/onDrop`）：
 *    分类走 `domain/zip.js` 的 `classifyFiles`，pdf / zip / psz → 导入成新乐谱；音频 → **要打开着乐谱**
 *    （没音频就直接加、已有就确认后替换）；图片 → 同样要打开着乐谱（确认后换封面）。
 *    **没打开乐谱时只有 pdf / zip / psz 能建新谱**：音频给一条 danger「打开乐谱后才能导入音频」、
 *    图片给「打开乐谱后才能将该图片设为封面」、其余类型（**含散装的 `.json`**）给「不支持的文件」。
 *    **每个分支成功后都自动打开到「该文件对应的配置位置」**：pdf / zip / psz → `openGallery(rec)`
 *    （`importFiles` 每进库一张就调一次，内部 `expandLibrary()` 走 `toLibrary()`：先收抽屉再展开侧栏，
 *    并把刚进来的这一张交给 `LibraryPanel` 滚过去 + 铺一档底色）；音频 → `offsetRequest` 计数器让
 *    `PlayerToolbar` 直接进「设置音频起点」；图片 → 打开乐谱信息。
 *    **导入不会把人带进某张谱里**：pdf / zip / psz 只把谱收进库、在列表上把新的那一行亮一下
 *    （多张就是**进来一张亮一下**），在哪一张上接着看由用户自己点。
 *    **局部不再有任何 drop 落点**（导入框、封面框都只能点）。
 *    **上传入口的输入框上都不写 `accept`**（iPadOS 会按类型把非 PDF 的文件灰掉、点不动，见 docs/ui.md §18.21）：
 *    类型一律选中之后再判 —— 这一页那颗「导入 PDF」也是（只收 PDF 这条判据在 `onPdfPicked` 里，
 *    不是靠 `accept`），另外三个在 `LibraryPanel` / `PlayerToolbar`。
 *  · **`offsetRequest` 有两个来源**（同一个机制，别再加第二套开关）：拖入音频那条路（`runAudioImport`），
 *    以及 `load()` 打开一份**有音频、而起点还是 0** 的谱（`promptAudioOffset()`）——
 *    0 是「还没设过起点」的哨兵，见 `store/player.js` 的 `importAudio` 与 docs/ui.md §18.4 第 37 条。
 *    音频浮层里那颗「导入音频 / 更换音频」选完文件也进那一屏，但**不经这里**：那一屏的开合状态
 *    在 `PlayerToolbar` 自己手里（它的 `showPicker()`），页面不用管。
 *  · 拖入提示层：`dragenter/dragleave` 用计数器（子元素间移动会连发），window 捕获阶段的 `resetDrag`
 *    保证任何一次 drop 都把提示层收掉。
 *  · 「打开某张谱的信息面板」是 `infoRequest = { id, tick }`（tick 自增，重复请求也生效）→
 *    `LibraryPanel` 的 prop + watch。**面板状态留在 LibraryPanel 自己手里，页面只发请求。**
 *  · **撤销不在这页里画**：删除后由 `store/player.js` 的 `notifyUndo()`
 *    发一条**带按钮的 toast**（第三类，正文「删除 xN」+ 一颗「撤销」按钮
 *    + 环形倒计时），渲染在 `App.vue` 的 `ToastStack` 里。
 *    **报错也走第三类**（`errorToast()`：报错原文 + 一颗「复制」按钮）——
 *    这一页里凡是正文带真实错误信息的地方（`err?.message`、`player.error`）都用它，不用 `toast()`。
 *    **提示栈的位置也归它管**（`--hint-top`）—— 这页只负责在「播放时隐藏工具栏」时把整个提示栈
 *    平移出屏幕（`setHintsHidden`，见 `barsHidden`）。
 *    **空格键那个播放 / 暂停的手势也在这页**（`onKey`）：非编辑 + 能播才生效，判据见 docs/ui.md §18.71。
 *  · 页面里还挂着页面级的 `AppSheet`：需要确认的操作用 `center` 形态（**不传 `followLayout`**），
 *    不可恢复的覆盖用 `btn danger`。footer 那两颗照 docs/ui.md §13 / §18.61 第 168 条统一：
 *    **实心底色 + 18px 图标**（取消 = 中性 `.btn` + `close`；确认那颗用**这个动作自己的图标**，
 *    由 `askConfirm({ icon })` 给，没给就 `check`），没有描边档。
 *    **另有一条 footer 只有一颗按钮的**：自动进编辑模式那次弹的提示（`player.checkMarksNotice`）
 *    —— 标题恒为「提示」、正文是 `view.notice.checkMarks` 那句话，**没有「取消」那一颗**，
 *    它不是「要不要做」的确认框（见 docs/ui.md §18.72）。
 *  · **替换类的确认框要把信息写全**：音频那条给 `askConfirm({ rows })` 的「当前 + 新的」两行
 *    （每行 `{ k, v, sub }` = 标签 / 值 / 值下面那行小字），**换封面给 `{ cover }` 的两张图横着并排**
 *    （图片比两行文字直观）—— 只报「当前已经有 X」、或者只报新文件名，用户都没法核对自己会失去什么；
 *    两条都在 `handleFiles` 的分流里，各写哪几样见 docs/ui.md §18.69。
 *    **换封面那条会在弹框之前先把图压出来**：`imageToCover` 压出「存下来会得到的那张图」当预览
 *    （压不出来退回两行文字）。
 *  · 底栏两个胶囊 + 页面最底部细进度条（`ProgressLine`）。
 *  · **页面标题跟着打开的那份乐谱走**：`{乐谱标题} - PDF Score`；没打开乐谱时退回 `app.title`。
 *    改名要走 `renameScore()` —— 记录上的 `title` 由 `store/player.js` 那个 watch 跟着 `meta.title` 走。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, ChevronLeft, File, SquareArrowRightEnter, FileMusic, Image, LayoutGrid, RotateCcw, Settings, TriangleAlert, X } from '@lucide/vue'
import AppSheet from '../components/AppSheet.vue'
import GotoDialog from '../components/GotoDialog.vue'
import JumpSheet from '../components/JumpSheet.vue'
import LibraryPanel from '../components/LibraryPanel.vue'
import LibrarySettings from '../components/LibrarySettings.vue'
import ManualSheet from '../components/ManualSheet.vue'
import PdfViewer from '../components/PdfViewer.vue'
import PlayerToolbar from '../components/PlayerToolbar.vue'
import ProgressLine from '../components/ProgressLine.vue'
import SegmentEditor from '../components/SegmentEditor.vue'
import {
  canPlay,
  clearSelection,
  close,
  closeDeleted,
  importAudio,
  importPdf,
  open,
  player,
  save,
  SCORE_NOT_FOUND,
  scoreTitle,
  togglePlay,
} from '../store/player.js'
import { classifyFiles, imageToCover, importFiles, isPdfFile, setScoreCover } from '../store/library.js'
import { SHEET_MAX_W, SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, settings } from '../store/settings.js'
import {
  closeCurrentDrawer,
  collapseLibrary,
  expandLibrary as expandSideBar,
  drawerOpen,
  libraryOpen,
  pushBackLayer,
  realignSentinelBase,
  resetLayout,
  toLibrary,
} from '../store/ui.js'
import { dangerToast, errorToast, errText, setHintsHidden, toast } from '../store/toast.js'
import { t } from '../i18n/index.js'

const route = useRoute()
const router = useRouter()


const viewer = ref(null)
const gotoOpen = ref(false)
/**
 * 「标记列表」（再点一次已经选中的标记工具时弹的那个抽屉）开着没。
 * **状态留在页面这一层**：开面板的是 `PlayerToolbar`、画高亮的是 `PdfViewer` / `ScorePage`，
 * 两边都得知道它开着（开着时谱面上所有编辑标记降成灰、点列表项才闪主题色），
 * 所以开合放在它们共同的父级，而不是塞进工具栏自己。
 */
const marksOpen = ref(false)
/** 要在谱面上闪一下的那个目标：`{ key, page, y0, y1, tick }`，`tick` 保证同一个目标连点也重播 */
const markFocus = ref(null)
/**
 * 刚导入进来的那几张的 id，交给 `LibraryPanel`（它据此滚动 + 短暂高亮那几行）。
 * 页面只发「哪几张是新的」这个事实，**高亮怎么画归面板自己**（与 `infoRequest` 同一套分工）。
 */
const newIds = ref([])
/**
 * 「设置」这颗钮住在左上那条胶囊里（和「乐谱库 / 收起」同一栏），**开合状态就留在页面这一层**；
 * 面板本身是 `LibrarySettings` 这个小组件（设置面板从 `LibraryPanel` 里搬出来的，见那边注释）。
 */
const settingsOpen = ref(false)
/**
 * 「操作说明」面板（`ManualSheet`）：**入口在设置面板的 footer 里**（那颗「查看操作说明」），
 * 开合状态同样留在页面这一层。两个抽屉互斥，所以点那颗按钮时不用自己去关设置面板 ——
 * `openDrawer` 会把上一个面板收掉（见 `store/ui.js`）。
 */
const manualOpen = ref(false)
/**
 * **「侧栏」和「抽屉」是两套逻辑**（见 `store/ui.js`），这里不用自己存开合状态：
 *  · **侧栏 = 乐谱库**（`libraryOpen`）：横竖屏**都是左边那一条**，宽度可拖；
 *  · **抽屉 = 面板**（`drawerOpen` / `#sheet-slot`）：**永远从底部升起**，一次只有一个。
 */
const pdfInput = ref(null)
/** 正在拖侧栏那根把手（拖动中关掉宽度过渡、并给把手上按下态） */
const sideDragging = ref(false)
const isLandscape = ref(false)
const sideWidth = ref(settings.sideWidth || SIDE_DEFAULT)

/**
 * 抽屉现在的宽度 = **横屏时它就是侧栏宽度**（侧栏收起时用最小宽度，抽屉总得有个宽度）。
 * 它同时是抽屉右边缘那根把手的拖动起点（见 `startResize` 的 `baseW`）。
 */
const drawerWidth = computed(() => (libraryOpen.value ? sideWidth.value : SIDE_MIN))

/**
 * **「选择前置」进行中**（跳转 Sheet 收起、只剩标题，等用户去谱面上点一个箭头）：
 * 这一段时间**遮罩与抽屉把手都要让开**，否则那层遮罩盖着谱面、箭头根本点不到
 * （抽屉本身这时是 auto 高度的标题条，只占底边一条，见 `AppSheet` 的 `collapsed`）。
 */
const jumpPicking = computed(() => !!player.pickJumpId)

/**
 * 抽屉那个盒子（`#sheet-slot`）的位置与宽度 —— **横竖屏唯一的差别就在这几行**：
 *  · 横屏：贴左边、宽度与侧栏一致（侧栏关着就用最小宽度），跟侧栏同占那一列；
 *  · 竖屏：整幅宽、≤620 居中（就是常见的底部抽屉）。
 * 高度是**固定的 85%**（在 CSS 里，不给拖）—— 全部以 CSS 变量递给槽里的抽屉。
 */
const slotStyle = computed(() => {
  const s = {}
  if (isLandscape.value) {
    s['--drawer-w'] = drawerWidth.value + 'px'
    s['--drawer-right'] = 'auto'
  } else {
    s['--drawer-w'] = '100%'
    s['--drawer-margin'] = '0 auto'
    s['--drawer-max-w'] = SHEET_MAX_W + 'px'
  }
  return s
})

const hasScore = computed(() => !!player.id)

/**
 * 「播放时隐藏工具栏」：走带中把**顶栏与底栏那几条**平移出屏幕（不透明度不变 —— 藏 = 真的挪走，不是淡出），
 * 让谱面独享整块屏幕。
 *
 * **藏的五条**：左上的两条胶囊 —— `.back-dock`、`.mini-dock`（在 `PdfViewer` 里）、**顶部整条提示栈**
 * （`ToastStack` 那个 `.toast-wrap`，三类 toast 都在里面、都按 `--hint-top` 摆，所以整条挪走就够 ——
 * 提示栈挂在 `App.vue` 上，藏起来这件事由 `setHintsHidden()` 转达，见下面那个 watch）；
 * 乐谱库侧栏（`.side-bar`）走它本来就有的收起动画；**底栏那对胶囊（`.bottom`）整条向下走出屏幕**。
 * 底栏一走，「播放 / 暂停」那颗圆钮就够不着了 —— 走带中的出口是**空格与双击谱面**
 * （`PlayerToolbar` 那颗钮在编辑模式里本来也不在；两条手势见 docs/ui.md §18.71）。
 *
 * 判据是「**走带中**」（`player.playing`）而不是「按过一次播放」：暂停、播完、预览试听停下
 * 都会自己回来；**编辑模式下也不藏**（行 / 小节线 / 段落 / 跳转四个工具就在那条胶囊里，
 * 而且进编辑模式本来就会先停止播放）。
 *
 * ⚠️ **工具栏藏起来时谱面的「可视区」不跟着变大**：`PdfViewer` 的 `reserved` / `reservedTop`
 * 仍然按它们在的时候算，否则每次开关工具栏整本谱都按新的可视高重排一遍（字会跳大小、滚动位置也会跳）。
 */
const barsHidden = computed(() => settings.hideToolbars && player.playing && !player.editMode)

/**
 * 工具栏要藏起来时顺手把乐谱库侧栏也收掉（胶囊与底栏自己走 CSS 平移）。
 * **只管「收」、不管「展开」**：挡着谱面的就是这条侧栏，展开它等于把刚让出来的地方又填回去；
 * 但工具栏回来时不该替用户把侧栏弹开（他刚才明明看的是没有侧栏的谱面）。
 * 收起用的是现成的 `collapseLibrary()`，所以侧栏那一半动画与手动收起**完全是同一条**。
 *
 * 提示栈那一半**只是转达给 `store/toast.js`**（`setHintsHidden`）：它挂在 `App.vue` 上，
 * 这里够不着它的 DOM；它自己也读不到 `settings.hideToolbars`（那条判断要连
 * `player.playing` / `player.editMode` 一起看，属于这一层）。所以「谁来决定藏不藏」在这里，
 * 「藏起来长什么样」在 `ToastStack.vue` 的 `.toast-wrap.bars-hidden` —— 两边都不重复判据。
 */
watch(
  barsHidden,
  (hidden) => {
    setHintsHidden(hidden)
    if (hidden) collapseLibrary()
  },
  { immediate: true },
)

/**
 * 左上那颗胶囊：**打开乐谱库**（`toLibrary()`：打开侧栏、顺手收掉抽屉）。
 * 它**在侧栏开着的时候整个隐藏**（`v-if="!libraryOpen"`）：关闭走侧栏头部的 × 或者把右边缘拖到底，
 * 左上再留个入口就是重复的。
 */

/* ---------------------- 横竖屏：只决定抽屉摆在哪儿 ---------------------- */

let mq = null

/**
 * **横竖屏只决定抽屉的盒子怎么摆**（宽度 / 位置，见 `slotStyle`）：
 *  · 宽屏（横屏 = 宽 > 高且宽 ≥ 700；**或窗口比底部抽屉的最大宽度还宽** —— 抽屉到 620px 就长不动了）：
 *    抽屉贴左边、与侧栏同宽同列；
 *  · 窄屏：抽屉整幅宽、≤620 居中。
 * 侧栏（乐谱库）**两种朝向一模一样**（都是左边那一条），抽屉的 DOM 也只有一份
 * （槽位 id 恒定），所以换朝向时什么都不用搬、面板里的内容原样留着。
 */
function syncOrientation() {
  const w = window.innerWidth
  const h = window.innerHeight
  isLandscape.value = (w > h && w >= 700) || w > SHEET_MAX_W
}

function applySideWidth(v) {
  sideWidth.value = Math.max(SIDE_MIN, Math.min(SIDE_MAX, v))
  settings.sideWidth = sideWidth.value
}

/**
 * 展开乐谱库（= 让侧栏展开并显示列表）。宽度用上次的；万一是越界的旧值就回落到默认宽度。
 * `defaultLibrary()`、导入完成、请求「乐谱信息」都走它（`toLibrary()` 顺带收掉抽屉）。
 */
function expandLibrary() {
  if (sideWidth.value < SIDE_MIN) sideWidth.value = SIDE_DEFAULT
  toLibrary()
}

/**
 * 「未打开文件」这一屏默认把乐谱库展开 —— 进门就看见自己的谱。
 * 收起的入口照旧保留（标题栏那颗按钮 / 把手拖到底都只是**收起**），所以这里只在一头一尾各补一次：
 *  · 直接打开 `/`（`load()` 里没有 id）；
 *  · 从 `/:id` 返回 `/`（`close()` 之后）；
 *  · **打开失败退回 `/`**（库里没这条记录，`load()` 里那次 `replace`）—— 它落回的也是这一屏。
 * 打开乐谱（`openScore`）照旧收起它；其余打开失败留在 `/:id` 上显示错误，也不展开。
 */
function defaultLibrary() {
  if (!hasScore.value) expandLibrary()
}

/**
 * 「返回手势先关我」的注销函数（由 `pushBackLayer` 发下来）：页面自己持有的三种状态。
 * 都是 `let`（不是 ref）—— 它们只被 watch 读写，不参与渲染。
 *
 * ⚠️ **它们与下面那几个 watch 都排在 `confirmBox` 之后**：`let` / `const` 都有暂时性死区，
 * 而 `watch` 在 setup 期间就会**同步求值一次 getter** 去收集依赖 —— 放在 `confirmBox` 之前
 * 会直接抛 `Cannot access '…' before initialization`，整个页面白屏。见 `playerDrawer` 那段之后。
 */
let backConfirm = null
let backSelection = null
let backEdit = null

/**
 * 编辑模式那一层的 dismiss：**什么都不做** —— 编辑模式只有底栏那颗「完成」一个出口
 * （`store/player.js` 的 `finishEdit`）。这一层压在那儿只是为了**把返回手势吃掉**，
 * 否则它是一次真的路由后退，会连人带谱一起退出去。
 *
 * ⚠️ **必须重新登记一层**：`onPopState` 是「先把最上层 `pop` 掉、再调它的 dismiss」，
 * 一次返回就把这一层从栈里摘走了 —— 只写个空函数的话，**第二次返回**就没有哨兵可吃、
 * 变成真的退页。补一层之后返回手势无论按多少次都落在这一层上。
 */
function swallowEditBack() {
  backEdit = pushBackLayer(swallowEditBack, 'edit')
}

/** 从「打开了乐谱」变成「没打开乐谱」= 回到了 `/`，把乐谱库展开 */
watch(hasScore, (yes, was) => {
  if (was && !yes) defaultLibrary()
})

/**
 * 拖这条右边缘调侧栏宽度 —— **侧栏右边缘与抽屉右边缘共用这一段**：
 * 横屏的抽屉跟侧栏同宽同列、还盖在它上面（槽 30 / 遮罩 29 都在把手 27 之上），
 * 所以抽屉自己右边缘也挂一根把手，拖它 = 拖侧栏那条边（改的是同一个 `settings.sideWidth`，
 * 抽屉的宽度是由它推出来的，于是两边一起动）。
 *  · 宽度 ≥ `SIDE_MIN`：**跟手**（拖动中把宽度过渡关掉，不然跟不上指针）；
 *  · 比 `SIDE_MIN` 还窄：**不再看宽度、只看拖动方向**（差 3px 以内当抖动，不动状态）——
 *    两个方向都只是**改状态 + 把跟手关掉**，宽度由**同一段过渡**演过去：往展开方向 → 展开，
 *    往收拢方向 → 收起。所以「收」和「展」用的是同一条动画，没有瞬间跳变；
 *    指针一旦回到 `SIDE_MIN` 以上就立刻恢复 1:1 跟手（这一段在下面 `w >= SIDE_MIN` 的分支里）。
 *  · 收起状态下点一下（没拖动）用上次的宽度展开。
 *
 * `baseW` 是**这条边现在的宽度**（拖动的起点）：
 *  · 侧栏那根：收起时是 0 —— 那时把手贴在屏幕左缘，于是 `baseW + dx` 正好是指针的绝对 x；
 *  · 抽屉那根：抽屉现在的宽度（离屏幕左缘有一整个宽度），**不能给 0**，
 *    否则指针得先空走那么多才跟得上。
 */
function startResize(e, baseW = libraryOpen.value ? sideWidth.value : 0) {
  e.preventDefault()
  sideDragging.value = true // 默认跟手（拖动中关掉宽度过渡）
  const startX = e.clientX
  const startW = baseW
  let moved = false
  /** 方向模式下的判向基准：每次变状态就挪到当前位置，于是 3px 的抖动不会来回翻 */
  let anchorX = startX

  const move = (ev) => {
    if (Math.abs(ev.clientX - startX) > 4) moved = true
    const w = startW + (ev.clientX - startX)

    if (w >= SIDE_MIN) {
      sideDragging.value = true
      anchorX = ev.clientX
      if (!libraryOpen.value) expandSideBar()
      applySideWidth(w) // 夹取在 applySideWidth 里
      return
    }

    // 比 SIDE_MIN 还窄：只看方向
    if (Math.abs(ev.clientX - anchorX) < 3) return
    const dir = ev.clientX > anchorX ? 1 : -1 // 侧栏在左边：往右 = 展开
    anchorX = ev.clientX
    // 展开 / 收起都**只改状态**：把跟手关掉，宽度交给那段过渡演（两个方向同一条动画）
    sideDragging.value = false
    if (dir > 0) expandSideBar()
    else collapseLibrary()
  }

  const cleanup = () => {
    sideDragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', cleanup)
    window.removeEventListener('pointercancel', cleanup)
    // 收起状态下只点一下（没拖动）= 展开（把手只管侧栏，不碰抽屉）
    if (!moved && !libraryOpen.value) expandSideBar()
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', cleanup)
  window.addEventListener('pointercancel', cleanup)
}

function openScore(id) {
  // 点的是**当前这一张**：什么都不用换（`router.push` 到同一个 id 是空操作），
  // 侧栏也就不该跟着收 —— 收起只属于「切到另一张谱」那件事
  if (id === player.id) return
  collapseLibrary()
  router.push(`/${id}`)
}

/**
 * 乐谱库里刚删掉的那几张（`LibraryPanel` 删成功后回传删掉的 id）。
 * **里面有正在看的这一张就把它关掉、退回「未打开文件」那一屏** —— 那份谱已经不在库里了，
 * 再留在 `/:id` 上是显示着一份不存在的数据（此后任何一次编辑都只会撞上「保存失败」）。
 *
 * 收尾顺序：
 *  1. `nextTick()`：先等乐谱库那边「关掉删除确认框」的收尾跑完 —— 那个浮层注销时会撤掉返回手势的
 *     哨兵，撤哨兵要拿当前地址写回地址栏，先换地址的话写回来的就是这条已经作废的 `/:id`；
 *  2. `closeDeleted()` 丢掉没落盘的改动再把播放器收干净（**不能走 `save()`**：记录已经没了）；
 *  3. 地址退回 `/`：**用 `replace`**，与 `load()` 里「这份谱不在库里」那条同一个理由 ——
 *     这条地址已经作废，留在 history 里只会让返回键退回它、又被弹回来；
 *  4. 换过地址就叫一声 `realignSentinelBase()`（同 `load()` 里那条）：抽屉 / 框选还开着时，
 *     哨兵还在，不叫这一声它撤掉时就会把旧地址写回去。
 *
 * 进这一屏的规矩照旧（`load()` 那条）：**乐谱库默认展开**。
 */
async function onScoresRemoved(ids) {
  if (!player.id || !ids?.includes(player.id)) return
  await nextTick()
  await closeDeleted()
  await router.replace('/')
  realignSentinelBase()
}

/* ---------------------------- 标记列表 ---------------------------- */

/**
 * 「标记列表」的入口是工具栏那条胶囊，但**状态归页面管**（见 `marksOpen` 的注释）。
 * 开关动作出自 `PlayerToolbar.setTool()` 发出的 `marks` 事件 —— 那个组件知道
 * 「同一个工具再点一次」这件事，页面只管接住。
 */
function toggleMarks(open) {
  marksOpen.value = open
  // 关掉时把高亮一起收掉：留着的话下一次打开会先闪一下上次那个目标
  if (!open) markFocus.value = null
}

/**
 * 退出编辑模式时把列表关掉：四个标记工具就在底栏那条胶囊里，它们一没，
 * 「再点一次」这个入口也就不存在了（面板留着会是一扇没有门的房间）。
 */
watch(
  () => player.editMode,
  (on) => {
    if (!on) toggleMarks(false)
  }
)

/** 在谱面上闪一下（`MarksPanel` 里点某一项时）；滚动与高亮都交给 `PdfViewer` */
function locateMark(target) {
  markFocus.value = target
  viewer.value?.scrollToMark?.(target.page, target.y0, target.y1)
}

/* ---------------------------- 文件导入 ---------------------------- */

/**
 * 送进来的东西按类型分流（判定见 `domain/zip.js` 的 `classifyFiles`）：
 *   pdf / zip / psz         → 导入成新谱，然后打开乐谱库让用户看到新谱
 *   音频                    → 本谱面没音频就直接加，有就确认后替换，然后直接去设起点
 *   图片                    → 确认后换本谱面的封面，然后打开「乐谱信息」（封面就在那一屏）
 * **没打开任何乐谱时只有 pdf / zip / psz 能自成一张新谱**：音频与图片都要先打开一份乐谱
 * （各给一条 danger），其余类型给「不支持的文件」。
 * 每个分支成功之后都会**自动打开到该文件对应的配置位置**，不用用户再自己去找。
 * 分流本体是下面的 `handleFiles`，**拖入与乐谱库那颗按钮选进来的文件走的是同一个它**。
 */
const dropActive = ref(false)
/**
 * 要求 `PlayerToolbar` 直接进「设置音频起点」那一屏。**计数器而不是布尔**：同一个请求连着来两次
 * （连续导入两次音频）也要每次都重新打开。两个来源：页面拖入音频（`runAudioImport`）、
 * 以及打开一份起点还是 0 的谱（`promptAudioOffset()`）——
 * **音频浮层里那颗「导入 / 更换音频」不走这里**，那条路在本组件自己身上（`PlayerToolbar` 的
 * `showPicker()`）。
 */
const offsetRequest = ref(0)
/** 要求乐谱库打开某个面板：{ id, tick }，tick 每次自增以保证重复请求也生效 */
const infoRequest = ref(null)
let infoTick = 0
/**
 * 页面级的居中确认框（`AppSheet` + `position="center"`）。内容区有两种画法，给哪样画哪样：
 *  · `rows` = **要摆给用户看的事实**，每行 `{ k, v, sub }` = 标签 / 值 / 值下面那行小字；
 *    替换类的那两条（音频 / 配置）每回都给两行（**当前一侧 + 新的一侧，缺一行就等于没告诉
 *    用户会失去什么**，见 docs/ui.md §18.69）；
 *  · `cover` = **封面的两张图横着并排**（`{ old, oldCustom, next, name }`）：换封面那条走它，
 *    图片比两行文字直观得多。图压不出（文件坏了）时退回 `rows`，照样能确认。
 */
const confirmBox = reactive({ open: false, title: '', icon: Check, confirmLabel: t('common.confirm'), danger: false, rows: [], cover: null, run: null })

/* --------------------------- 返回手势（手机端） --------------------------- */

/**
 * 手机端的返回手势 = history 后退。**有浮层开着时它先关浮层**，这一层由 `store/ui.js` 的
 * `pushBackLayer` 管；本组件把**页面自己持有的那几种状态**也登记进去，
 * 顺序与 `onKey` 里那条 Esc 的落点顺序一致（最靠前的那个先关），**只有编辑模式是例外**：
 *
 *  1. `player.drawer`（段落编辑器 / 跳转 Sheet，`EditorPanel` 与 `AppSheet` 自己登记，不在这里）；
 *  2. 抽屉面板（`AppSheet` 自己登记，不在这里）；
 *  3. 页面这个 `center` 确认弹窗（`confirmBox`）；
 *  4. 循环框选 `player.selection`；
 *  5. 编辑模式 `player.editMode` —— **这一层只是把返回手势吃掉**（dismiss 里什么都不做，
 *     见 `swallowEditBack`）：编辑模式唯一的出口是底栏那颗「完成」，返回不该把人从编辑模式里带出去。
 *     **Esc 同样不退编辑模式**（`onKey` 里那条只管 drawer 与 selection），两边在这件事上是一致的。
 *
 * **只在真开着的时候登记**（跟着状态压 / 弹），所以关完之后返回手势就是**真的路由后退**
 * —— 那才是用户预期的「从乐谱里退出去」。三层都用固定 id 去重。
 *
 * ⚠️ **这两个 watch 必须排在 `confirmBox` 之后**：`watch` 在 setup 期间就会同步求值一次
 * getter，放在声明之前会抛 `Cannot access 'confirmBox' before initialization` 而白屏。
 */
watch(
  () => confirmBox.open,
  (open) => {
    if (open) backConfirm = pushBackLayer(() => (confirmBox.open = false), 'confirm')
    else {
      backConfirm?.()
      backConfirm = null
    }
  }
)

/**
 * 框选与编辑模式各吃一层。
 *
 * ⚠️ **必须写成两个独立的 watch、getter 各返回一个标量**：`watch` 的 getter 一旦返回**数组**，
 * 那个数组每次求值都是新的，而 Vue 用 `Object.is` 比 —— 两个不同的数组永远不等，
 * 于是**每一次响应式空跑都会判定「变了」**，压 / 弹哨兵被反复执行，history 深度直接爆掉。
 * 包一层 `!!` 也救不了（新数组照样不等），只有返回标量才行。
 */
watch(
  () => !!player.selection,
  (hasSel) => {
    if (hasSel && !backSelection) backSelection = pushBackLayer(() => clearSelection(), 'selection')
    else if (!hasSel && backSelection) {
      backSelection()
      backSelection = null
    }
  }
)

watch(
  () => player.editMode,
  (editing) => {
    if (editing && !backEdit) backEdit = pushBackLayer(swallowEditBack, 'edit')
    else if (!editing && backEdit) {
      backEdit()
      backEdit = null
    }
  }
)

/**
 * **页面标题跟着打开的那份乐谱走**：没打开乐谱时是 `app.title`（`main.js` 里写的那一个，
 * `index.html` 的静态值是 JS 还没跑起来时的兜底），打开了就换成「{乐谱标题} - PDF Score」。
 *
 * ⚠️ **`immediate: true` 是必须的**：这条 watch 只在 `meta.title` / `id` **变化时**才跑，
 * 而 `/…/:id` 直接进来（刷新、分享链接）时 id 在 setup 期就已经在了 —— 少了它，
 * 标题会一直停在 `index.html` 上的静态值。
 *
 * 标题里的乐谱名取 `scoreTitle`（记录上的 title → `meta.title` → 「未命名乐谱」），
 * 与乐谱库里那一行同一条规矩；整句的拼法在语言包的 `store.pageTitle`，
 * 所以切语言也会跟着重写（这条 watch 读 `t()`，语言一变就重跑）。
 *
 * ⚠️ **getter 返回的那一串就是「要写进标签页的标题」本身**：watch 的 getter 里**不要再拼**
 * 分隔符 / 附加字段（例如把乐谱名和整句拼成一个只给 `watch` 比对的「变化键」）——
 * 回调收到的就是 getter 的返回值，多拼进去的东西会**原样进标题**。
 * 这里 `t('store.pageTitle', …)` 已经含 `scoreTitle`，单这一个字符串就够比对。
 */
watch(
  () => (hasScore.value ? t('store.pageTitle', { title: scoreTitle.value }) : ''),
  (title) => {
    document.title = title || t('app.title')
  },
  { immediate: true }
)

let dragDepth = 0

/**
 * 导入完把乐谱库亮出来（展开侧栏 + 收掉抽屉，列表不会被盖住）。
 * `rec` = **刚进库的这一张**（`importFiles` 每进库一张就调一次这里）：把它交给 `LibraryPanel`
 * （`newIds` prop，值是 `[rec.id]`）—— 它会把列表滚到这一行并**给这一行铺一档底色**（短，见那边 `markFresh`）。
 * 所以多张的导入是**进来一张亮一下**，不是在最后一块亮。
 * **不把人带进某张谱里**（`openScore` 那条路才是「换一张谱在看」）：导入只把谱收进库，
 * 在哪一张上接着看是用户自己的事。
 *
 * ⚠️ **每次都要给一个新的数组实例**：prop 的 watch 认的是引用，缓存住同一个数组 =
 * 下一次不再滚、不再亮。
 */
function openGallery(rec) {
  expandLibrary()
  newIds.value = rec?.id ? [rec.id] : []
}

/**
 * 打开某张乐谱的「乐谱信息」面板。
 * 面板住在 `LibraryPanel` 里的，所以**必须先让乐谱库展开**（它是常驻 DOM 的，不用等挂载，
 * 但抽屉要等它自己那一帧），然后发请求。
 */
async function requestScoreInfo(id) {
  if (!id) return
  expandLibrary()
  await nextTick()
  infoRequest.value = { id, tick: ++infoTick }
}

/**
 * 弹居中确认框。`opts` 里给的是这个动作自己的事实与长相：
 *  · `rows` / `cover` = 内容区要摆什么（见 `confirmBox` 的注释）；
 *    **每回都从默认值起**（`Object.assign` 里 `rows: []` / `cover: null`），
 *    上一回那两行、那两张图不会残留到这一回。
 */
function askConfirm(opts) {
  Object.assign(confirmBox, { icon: Check, danger: false, confirmLabel: t('common.confirm'), rows: [], cover: null, run: null }, opts, { open: true })
}
function runConfirm() {
  const run = confirmBox.run
  confirmBox.open = false
  try {
    run?.()
  } catch (err) {
    errorToast(t('view.errors.actionFailed', { msg: errText(err) }))
  }
}

/**
 * 「当前封面」那一行的值。**判据是记录上的 `coverCustom`，不是「有没有图」** ——
 * 默认封面（PDF 首页渲染出来的）也是一张图，而用户自己选的那张图在深色模式下不反色，
 * 两档必须分开说（见 docs/invariants.md 的封面那一条）。
 */
function coverState() {
  const rec = player.record
  if (rec?.coverCustom) return t('view.confirm.coverCustom')
  if (rec?.thumb) return t('view.confirm.coverDefault')
  return t('view.confirm.coverNone')
}

function hasFiles(e) {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')
}
function onDragEnter(e) {
  if (!hasFiles(e)) return
  dragDepth++
  dropActive.value = true
}
function onDragOver(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave(e) {
  if (!hasFiles(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dropActive.value = false
}
function resetDrag() {
  dragDepth = 0
  dropActive.value = false
}
async function onDrop(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  resetDrag()
  await handleFiles(e.dataTransfer.files)
}

/**
 * 文件导入的**唯一分流函数**：整页拖入与乐谱库底部那颗「导入文件」选出来的文件都进这里
 * （按钮只负责选文件，选完由 `LibraryPanel` 把文件抛给页面）。
 *
 * 判据只有「现在有没有打开着乐谱」（`player.id`）：
 *  · **没打开**：只有 pdf / zip / psz 能自成一张新谱；**音频 / 图片要打开一份乐谱才收**
 *    （与封面那条同一套规矩），各给一条 danger；其余类型（含散装的 `.json`）给「不支持的文件」。
 *  · **打开着**：pdf / zip / psz 照旧建新谱；音频落到当前这一份（没音频直接加、已有确认后替换）；
 *    图片确认后换当前这一份的封面。
 */
async function handleFiles(fileList) {
  const files = Array.from(fileList || [])
  if (!files.length) return
  const { archives, pdfs, audios, images, unknown } = classifyFiles(files)
  const target = player.id // 音频 / 图片作用在「当前打开的这一份」上

  // 没打开任何乐谱：**只有 pdf / zip / psz 能建新谱**，音频与图片都得先打开一份乐谱
  if (!target) {
    const usable = [...archives, ...pdfs]
    if (usable.length) {
      try {
        // 乐谱库**每进库一张**就亮一次（`bindNew` 逐张回传），所以这里不再等 `created`
        // 「已导入 n 张」/ 出问题的原因都由那条任务通知自己就地报（见 `importFiles`），
        // **这里不许再补一条** —— 补了就是「任务完成后又新发一个通知」
        await importFiles(usable, { bindNew: openGallery })
      } catch (err) {
        errorToast(t('view.errors.importFailed', { msg: errText(err) }))
      }
    }
    if (audios.length) dangerToast(t('view.toast.audioNeedsScore'), 4200)
    if (images.length) dangerToast(t('view.toast.imageNeedsScore'), 4200)
    if (unknown.length) dangerToast(t('view.toast.unsupportedFile', { name: unknown[0].name }), 3600)
    return
  }

  // 1. 一律新建乐谱的：容器（zip / psz）与 PDF —— 每进库一张就打开乐谱库并亮那一行
  const fresh = [...archives, ...pdfs]
  if (fresh.length) {
    try {
      await importFiles(fresh, { bindNew: openGallery })
    } catch (err) {
      errorToast(t('view.errors.importFailed', { msg: errText(err) }))
    }
  }

  if (audios.length > 1) toast(t('view.toast.onlyOneAudio'), 3200)
  if (images.length > 1) toast(t('view.toast.onlyOneImage'), 3200)

  if (audios[0]) {
    const file = audios[0]
    const apply = () => runAudioImport(file)
    if (player.hasAudio) {
      askConfirm({
        title: t('view.confirm.replaceAudioTitle'),
        rows: [
          { k: t('view.confirm.currentAudio'), v: player.audioName || t('common.unnamed') },
          { k: t('view.confirm.nextAudio'), v: file.name },
        ],
        icon: RotateCcw,
        confirmLabel: t('common.replace'),
        run: apply,
      })
    } else {
      apply()
    }
  }

  if (images[0]) {
    const file = images[0]
    // 「新的封面」那张预览先压出来（`imageToCover` = 真正存下来时用的同一个函数，
    // 所以并排看到的图就是替换后的结果）。压不出来（图片坏了）就退回两行文字，照样能确认 ——
    // 那一步的失败照旧由 `setScoreCover` 在确认之后报出来。
    let preview = ''
    try {
      preview = await imageToCover(file)
    } catch {}
    const rec = player.record
    askConfirm({
      title: t('view.confirm.replaceCoverTitle'),
      rows: preview
        ? []
        : [
            { k: t('view.confirm.currentCover'), v: coverState() },
            { k: t('view.confirm.nextCover'), v: file.name },
          ],
      cover: preview
        ? { old: rec?.thumb || '', oldCustom: !!rec?.coverCustom, next: preview, name: file.name }
        : null,
      icon: RotateCcw,
      confirmLabel: t('common.replace'),
      run: async () => {
        try {
          await setScoreCover(player.id, file)
          toast(t('view.toast.coverUpdated'))
          requestScoreInfo(player.id) // 打开「乐谱信息」，封面就在那一屏里
        } catch (err) {
          errorToast(t('view.errors.coverFailed', { msg: errText(err) }))
        }
      },
    })
  }

  if (unknown.length) dangerToast(t('view.toast.unsupportedFile', { name: unknown[0].name }), 3600)
}

async function runAudioImport(file) {
  try {
    await importAudio(file)
    // 音频换了起点也要重设（`importAudio` 已经把 `startOffset` 归 0），直接跳到频谱图那一步
    offsetRequest.value++
  } catch (err) {
    errorToast(t('view.errors.audioFailed', { msg: errText(err) }))
  }
}

/* ------------------------------ 加载 ------------------------------ */

/**
 * 打开一份乐谱之后：**有音频、而起点还是 0** 就直接落到「设置音频起点」那一屏
 * （要求原文：「打开乐谱时如果音频开头位置是0就弹出设置开头位置的sheet」）。
 *
 * **判据只有「起点是不是 0」这一条**（没有音频的谱不弹：没有起点可设）—— 0 在这里是
 * **「还没设过起点」的哨兵**（新导入的音频一律被 `importAudio` 写成 0，见 `store/player.js`）：
 * 所以**一份故意留在 0 的谱，每次打开都会再弹一次**（用户拍板），别自作主张加「只弹一次」的标记。
 *
 * ⚠️ **中间的 `await nextTick()` 不能省**：这件事仍然走 `offsetRequest` 那**一个**机制
 * （页面拖入音频那条路也用它，别为这件事另造一个开关），而接住它的是 `PlayerToolbar` 里的 watch ——
 * 那个组件挂在 `v-if="hasScore"` 里，`open()` 刚把 `player.id` 写上，这一刻它**还没挂上去**
 * （watch 在组件 setup 里注册，组件不存在就没人听），少了这一下这次 +1 就落空：
 * 谱打开了，而那张 sheet 永远不弹。等一次渲染，它才在。
 */
async function promptAudioOffset() {
  if (!player.hasAudio) return
  if (Number(player.meta.audio?.startOffset) !== 0) return
  await nextTick()
  offsetRequest.value++
}

async function load() {
  const id = route.params.id
  if (!id) {
    if (player.id) {
      await save()
      await close()
    }
    // 未打开文件这一屏：乐谱库默认就展开着（用户一进来就该看见自己的谱，而不是一句
    // 「未打开文件」+ 一颗还要点一下的胶囊）。
    // **只在「进入这一屏」时补一次**，绝不能写成「发现栈空就自动补上」——
    // 那样用户手动关掉之后会被立刻重新弹开，等于关不掉。
    defaultLibrary()
    return
  }
  const failed = await open(id)
  if (player.error) errorToast(t('view.errors.openFailed', { msg: errText(player.error) }))
  // **这份谱确实不在库里 → 地址退回 `/`**（见 `open()` 的返回值）。
  // 用 `replace` 而不是 `push`：那条坏 URL 不该留在 history 里，否则返回键会退回它、又立刻被弹回来。
  // **其余失败（谱坏了 / 解析不了 / 读盘报错）留在原 URL 上** —— 地址与页面里的错误态对得上，
  // 用户看得见是哪一份出的问题（这也是 `player.error` 不能拿来当「找不到」判据的原因）。
  if (failed === SCORE_NOT_FOUND) {
    await router.replace('/')
    // ⚠️ 换过地址就得让返回手势的哨兵跟上：它撤哨兵时会拿 `base.url` 写回地址栏，
    // 不对齐的话会把这条已经被放弃的地址又写回来（见 `store/ui.js` 的 `realignSentinelBase()`）
    realignSentinelBase()
  }
  // 打开成功之后再看要不要去设音频起点（这份谱有音频、而起点还是 0 —— 见 `promptAudioOffset()`）
  if (!failed) await promptAudioOffset()
}

onMounted(async () => {
  syncOrientation()
  await load()
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', syncOrientation)
  window.addEventListener('orientationchange', syncOrientation)
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
  // 捕获阶段先把提示层收掉：任何一次 drop 都立刻让提示层消失（漏掉的话它会一直挂着）
  window.addEventListener('drop', resetDrag, true)
  window.addEventListener('dragend', resetDrag)
  if (typeof matchMedia === 'function') {
    mq = matchMedia('(orientation: landscape)')
    mq.addEventListener?.('change', syncOrientation)
  }
})

onBeforeUnmount(async () => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', syncOrientation)
  window.removeEventListener('orientationchange', syncOrientation)
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('drop', resetDrag, true)
  window.removeEventListener('dragend', resetDrag)
  mq?.removeEventListener?.('change', syncOrientation)
  // 离开页面时把布局收干净：面板卸载时自己会出抽屉（见 AppSheet），这里兜底清一次
  resetLayout()
  // 页面自己登记的那几层返回手势也要撤掉（确认框 / 框选 / 编辑模式）
  backConfirm?.()
  backSelection?.()
  backEdit?.()
  backConfirm = backSelection = backEdit = null
  await save()
  await close()
})

watch(() => route.params.id, load)

/**
 * 窗口级的两个键（输入框 / 文本域里的键一概不管，直接早退）。
 *
 * **空格 = 播放 / 暂停**，判据是「**非编辑模式 + 能播**」（`canPlay`）—— 与底栏那颗播放键同一套：
 * 底栏被「播放时隐藏工具栏」挪出屏幕之后（§18.35），它就是桌面上唯一的播放 / 暂停出口（§18.71）。
 * 不能播时**静默**（那颗钮本来就是 `disabled` 的，不给一句「没有可播放的内容」），
 * 编辑模式下也不响应。
 * ⚠️ **拦默认行为照旧不分档**：不拦的话浏览器会把这一下递给当前焦点上那颗按钮 ——
 * 编辑模式下按空格就会去点那颗「完成」。
 *
 * **Esc = 关掉最靠前的那个状态**（见下），编辑模式只有「完成」一个出口，这里不退出编辑。
 */
function onKey(e) {
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.code === 'Space') {
    e.preventDefault()
    if (!player.editMode && canPlay.value) togglePlay()
  } else if (e.key === 'Escape') {
    // Esc 的落点顺序 = 「关掉最靠前的那个状态」。**取消循环框选（`selection`）现在是这里独有的入口**：
    // 原来底部那条提示条上还有一颗「取消」按钮，提示条删掉之后，非编辑模式只剩
    // 「点谱面 / 点空白」（`PdfViewer` 那两个事件）与这条 Esc（见 docs/ui.md §18.32）。
    // ⚠️ **Esc 不退出编辑模式**：编辑模式只有底栏那颗「完成」一个出口（`store/player.js` 的 `finishEdit`）。
    if (player.drawer) player.drawer = null
    else if (player.selection) clearSelection()
  }
}

function pickPdf() {
  pdfInput.value?.click()
}
/**
 * 「导入 PDF」选完文件。**先判一下是不是 PDF**（这个框上不写 `accept`，什么文件都选得进来）：
 * 不是就给一条「不支持的文件」，别把 PDF 以外的字节送进 `PdfRenderer` —— 那里是同步抛，
 * 没人接住的话用户只会看到「点了没反应」。
 */
async function onPdfPicked(e) {
  const f = e.target.files?.[0]
  e.target.value = ''
  if (!f) return
  if (!isPdfFile(f)) {
    dangerToast(t('view.toast.unsupportedFile', { name: f.name }))
    return
  }
  await importPdf(f)
  toast(t('view.toast.pdfUpdated'))
}
</script>

<template>
  <div class="player">
    <!-- **侧栏 = 乐谱库**：横竖屏都是左边那一条（宽度可拖）。
         它和「抽屉」（面板，见下面那个槽）是**两套逻辑**、互不影响。
         **它常驻 DOM，只有「展开 / 收起」两态、没有「关闭」** —— 收起 = 宽度归零 + 边框归零 + 过渡，
         与右侧那条总览（`Minimap`）**同一套动画与手势**，所以列表的搜索词 / 排序 / 多选都留着。 -->
    <aside
      class="side-bar"
      :class="{ collapsed: !libraryOpen, dragging: sideDragging, 'bars-hidden': barsHidden }"
      :style="{ width: (libraryOpen ? sideWidth : 0) + 'px' }"
    >
      <!-- 内容按固定宽度排版、由 `.side-clip` 裁切：收起 / 拖动调宽时列表都不会重排 -->
      <div class="side-clip">
        <div class="side-frame" :style="{ width: sideWidth + 'px' }">
          <!-- 标题栏（「乐谱库」+ 本地占用）是**乐谱库自己的**，由 `LibraryPanel` 画 ——
               这里不再留一条空的 `.side-head`，否则侧栏顶上会白出一整条空白。
               **标题栏里没有收起按钮**：收起是「乐谱库」那一栏的事，
               它和「乐谱库 / 展开」在同一条胶囊里（见下面 `.back-dock`）——
               两处都放一颗就是一个功能两个入口。 -->
          <div class="side-body">
            <LibraryPanel
              :current-id="player.id"
              :info-request="infoRequest"
              :new-ids="newIds"
              @open-score="openScore"
              @scores-removed="onScoresRemoved"
              @import-files="handleFiles"
            />
          </div>
        </div>
      </div>
      <!-- 调宽把手：与右侧总览那根同一套 —— 往左拖到 SIDE_MIN 以下**立刻收起**；
           收起后它自己贴到屏幕左边缘，点一下（或往右拖）就能拉回来 -->
      <div
        class="side-resizer"
        role="separator"
        :aria-label="libraryOpen ? t('view.side.resizeAria') : t('view.circle.openLibrary')"
        @pointerdown="startResize"
      />
    </aside>

    <!-- 抽屉外面那层：**横竖屏都有，点它就关掉抽屉**（抽屉是模态的）。
         横屏的抽屉只占左边那一列，所以这层用**从左到右的渐变** —— 左边（抽屉那一列）压得深、
         往右渐隐到谱面上，不把整幅谱面一起抹暗；竖屏是整幅宽的抽屉，用常规的平遮罩。
         **「选择前置」期间不画**（`jumpPicking`）：那时抽屉只剩一条标题，
         用户的正事是去谱面上点箭头，盖一层遮罩就等于把这件事堵死了 -->
    <Transition name="scrim-io">
      <div
        v-if="drawerOpen && !jumpPicking"
        class="scrim sheet-scrim"
        :class="{ 'fade-x': isLandscape }"
        @click="closeCurrentDrawer()"
      />
    </Transition>

    <!-- **抽屉 = 面板**：这个盒子就是抽屉的位置与大小（横屏贴左边、与侧栏同宽；竖屏整幅宽 ≤620 居中），
         高度固定 85%（在 CSS 里，不给拖）。面板 Teleport 进来铺满它 —— 槽位 id 恒定，换朝向不搬家。
         `.landscape` 是**朝向的唯一出口**：抽屉的圆角按它分（横屏只圆右上角，竖屏整条上圆角 ——
         面板自己的样式是 scoped 的，进了这个槽就选不到父链，所以得由槽把朝向带进去，见 `AppSheet`）。
         **它必须是个空盒子**（只有 `:style` / `:class` 这类属性绑定）：Teleport 会往里面塞两个占位文本节点
         再挂内容，槽里另放别的元素会让父组件的 children diff 和 Teleport 的记账撞车。
         **这个盒子和面板是同一次渲染里一起挂的** —— 所以 `AppSheet` 那边的 `Teleport` 必须带 `defer`
         （原因见 `AppSheet.vue` 头部注释）：首帧挂载时它还不在 document 里，不 defer 的面板会「点了没反应」。
         空着的时候它不吃指针，所以谱面照常可点 -->
    <div
      id="sheet-slot"
      class="sheet-slot"
      :class="{ dragging: sideDragging, landscape: isLandscape }"
      :style="slotStyle"
    />

    <!-- 抽屉右边缘那根把手：**横屏才有**（那时抽屉与侧栏同宽同列、把侧栏那根把手整条盖住了，
         于是「抽屉开着就没法调宽度」）。拖的是同一段 `startResize`、同一个 `settings.sideWidth`，
         所以抽屉与侧栏一起变宽 / 变窄；竖屏的抽屉是整幅宽、跟侧栏宽度没关系，就不挂。
         它是槽的**兄弟节点**（不是槽的子节点，原因见上），位置由 `left` 与 `--drawer-h` 自己摆 -->
    <div
      v-if="drawerOpen && isLandscape && !jumpPicking"
      class="side-resizer drawer-resizer"
      :class="{ dragging: sideDragging }"
      :style="{ left: drawerWidth - 7 + 'px' }"
      role="separator"
      :aria-label="t('view.side.resizeAria')"
      @pointerdown="(e) => startResize(e, drawerWidth)"
    />

    <div class="stage">
      <PdfViewer v-if="hasScore && player.hasPdf" ref="viewer" :marks-open="marksOpen" :mark-focus="markFocus" />

      <div v-else class="state empty">
        <template v-if="player.loading">
          <span class="muted">{{ t('common.loading') }}</span>
        </template>
        <template v-else-if="hasScore && player.error">
          <TriangleAlert :size="32" />
          <p>{{ player.error }}</p>
          <button type="button" class="btn primary lg" @click="router.push('/')">{{ t('common.back') }}</button>
        </template>
        <template v-else-if="hasScore">
          <File :size="32" />
          <p>{{ t('view.empty.noPdf') }}</p>
          <button type="button" class="btn primary lg" @click="pickPdf">{{ t('view.empty.importPdf') }}</button>
        </template>
        <template v-else>
          <FileMusic :size="36" />
          <p>{{ t('view.empty.noFile') }}</p>
        </template>
      </div>

      <!-- 左上那条胶囊：**常驻**（收起 / 展开都在，和右侧总览那条一样），里面两钮：
            第一颗按状态换 —— 收起时「乐谱库」（`grid`，点它展开）、展开时「收起」（`chevronLeft`，
            点它收起）；第二颗「设置」。
            · **它是「乐谱库」那一栏自己的控件**，收起 / 展开都归它管，侧栏标题栏里不再重复放一颗
              （一个功能两个入口）。收起之后尤其要有它 —— 只剩屏幕左边缘那根 14px 的把手等于没有入口
              （用户报过「我的乐谱库按钮咋不见了」），和右侧总览一样：收起了，胶囊还在。
            · 换钮而不是隐藏：两种状态下这条胶囊都在同一个位置，只换第一颗的图标与文字
              （`Minimap` 那条三钮胶囊同一套写法）。文字换了宽度也跟着换（「乐谱库」比「收起」宽），
              这是胶囊按内容宽度的正常结果。
            本体来自全局 `.capsule` / `.glass` / `.cap-btn`，与右上、右下那几条胶囊**同一套控件**；
            「显示按钮文字」这个设置也一起管它（规则在全局 `.no-labels`） -->
      <div class="capsule glass back-dock" :class="{ 'no-labels': !settings.showButtonLabels, 'bars-hidden': barsHidden }">
        <button
          type="button"
          class="cap-btn"
          :aria-label="libraryOpen ? t('common.collapse') : t('view.circle.openLibrary')"
          @click="libraryOpen ? collapseLibrary() : expandLibrary()"
        >
          <component :is="libraryOpen ? ChevronLeft : LayoutGrid" :size="21" />
          <span class="cap-label">{{ libraryOpen ? t('common.collapse') : t('view.library.title') }}</span>
        </button>
        <button type="button" class="cap-btn" :aria-label="t('common.settings')" @click="settingsOpen = true">
          <Settings :size="21" />
          <span class="cap-label">{{ t('common.settings') }}</span>
        </button>
      </div>

      <!-- 底栏那对胶囊（`PlayerToolbar`）：整条由 `.bottom` 定位，「播放时隐藏工具栏」时
           **整条向下平移出屏幕**（与顶栏那几条同一个判据、同一段时长）—— 走带中的播放 / 暂停
           这时靠空格与双击谱面（docs/ui.md §18.71） -->
      <div v-if="hasScore" class="bottom" :class="{ 'bars-hidden': barsHidden }">
        <PlayerToolbar
          :offset-request="offsetRequest"
          :marks-open="marksOpen"
          @goto="gotoOpen = true"
          @marks="toggleMarks"
          @locate="locateMark"
        />
      </div>

      <ProgressLine v-if="hasScore" />
    </div>

    <GotoDialog v-model:open="gotoOpen" @jump="(no) => viewer?.scrollToMeasure(no)" />
    <SegmentEditor />
    <!-- 跳转记号的 Sheet：入口在谱面上（点一条已经有记号的小节线），开合状态在 `player.drawer` 里 -->
    <JumpSheet />
    <!-- 设置面板：入口在左上那条胶囊里，开合状态在页面这一层 -->
    <LibrarySettings :open="settingsOpen" @close="settingsOpen = false" @open-manual="manualOpen = true" />
    <!-- 操作说明面板：入口在设置面板 footer 那颗「查看操作说明」里 -->
    <ManualSheet :open="manualOpen" @close="manualOpen = false" />

    <!-- 拖文件到窗口任意位置：提示层 + 松手后的分流都在这里 -->
    <div v-if="dropActive" class="drop-veil">
      <div class="drop-card">
        <SquareArrowRightEnter :size="30" />
        <strong>{{ t('view.drop.dropHere') }}</strong>
      </div>
    </div>

    <!-- 分流时的确认（替换音频 / 覆盖配置 / 换封面）：信息都要写全 —— 前两条是「当前 / 新的」两行，
         换封面是**两张图横着并排**（docs/ui.md §18.69），不可恢复的覆盖用危险色 -->
    <AppSheet :open="confirmBox.open" :title="confirmBox.title" position="center" @close="confirmBox.open = false">
      <div v-if="confirmBox.cover" class="cover-cmp">
        <div class="cover-cmp-item">
          <span class="cover-cmp-k">{{ t('view.confirm.currentCover') }}</span>
          <span class="cover-cmp-box">
            <img v-if="confirmBox.cover.old" :src="confirmBox.cover.old" :class="{ custom: confirmBox.cover.oldCustom }" alt="" />
            <Image v-else :size="22" />
          </span>
          <span class="cover-cmp-note">{{ coverState() }}</span>
        </div>
        <div class="cover-cmp-item">
          <span class="cover-cmp-k">{{ t('view.confirm.nextCover') }}</span>
          <!-- 新的那张**恒挂 `.custom`**：它是用户选的图，存下来就是自定义封面，深色模式不反色 -->
          <span class="cover-cmp-box"><img class="custom" :src="confirmBox.cover.next" alt="" /></span>
          <span class="cover-cmp-note">{{ confirmBox.cover.name }}</span>
        </div>
      </div>
      <div v-if="confirmBox.rows.length" class="cmp">
        <div v-for="row in confirmBox.rows" :key="row.k" class="cmp-row">
          <span class="cmp-k">{{ row.k }}</span>
          <span class="cmp-v">
            {{ row.v }}
            <span v-if="row.sub" class="cmp-sub">{{ row.sub }}</span>
          </span>
        </div>
      </div>
      <template #footer>
        <button type="button" class="btn" @click="confirmBox.open = false">
          <X :size="18" /> {{ t('common.cancel') }}
        </button>
        <button type="button" class="btn" :class="confirmBox.danger ? 'danger' : 'primary'" @click="runConfirm">
          <component :is="confirmBox.icon" :size="18" /> {{ confirmBox.confirmLabel }}
        </button>
      </template>
    </AppSheet>

    <!-- 自动进编辑模式时那条提示（`open()` 里按 `editDone` 置的开关，见 docs/ui.md §18.72）：
         标题恒为「提示」、正文是那句话，**footer 只有一颗「确定」** —— 这里没有「要不要做」要问，
         所以没有「取消」那一颗 -->
    <AppSheet :open="player.checkMarksNotice" :title="t('view.notice.title')" position="center" @close="player.checkMarksNotice = false">
      <p>{{ t('view.notice.checkMarks') }}</p>
      <template #footer>
        <button type="button" class="btn primary" @click="player.checkMarksNotice = false">
          <Check :size="18" /> {{ t('common.confirm') }}
        </button>
      </template>
    </AppSheet>

    <!-- ⚠️ **不写 `accept`**（与另外三个上传框同一条规矩）：这个框只收 PDF，靠 `onPdfPicked` 里
         那道 `isPdfFile` 判，选错了就报「不支持的文件」 -->
    <input ref="pdfInput" type="file" class="hidden" @change="onPdfPicked" />
  </div>
</template>

<style scoped>
.player {
  position: relative;
  display: flex;
  flex-direction: row;
  height: 100dvh;
  overflow: hidden;
  background: var(--surface-page);
  /* 底栏预留高度：胶囊/圆钮 46 + 1px 描边 + bottom 偏移 8 + 余量 */
  --dock-pad: 110px;
  /* 抽屉（面板）的高度 —— **只有这一处定义**：`.sheet-slot` 的高度与抽屉那根把手的上端都读它 */
  --drawer-h: 85dvh;
}
/* 谱面区：`flex: 1` 吃掉侧栏剩下的宽度，但**有最小宽度**（`--stage-min-w`）。
   窗口再窄也不许把它继续压窄 —— 侧栏是 `flex: none`、这里是硬下限，于是整行超宽，
   谱面被**挤出浏览器窗口右侧**（`.player` 的 `overflow: hidden` 把它裁掉，而不是继续压扁） */
.stage {
  position: relative;
  flex: 1;
  min-width: var(--stage-min-w);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ---------------------- 侧栏（乐谱库）：占谱面左边那一条 ---------------------- */
/*
 * **侧栏和抽屉是两套逻辑**：这条 `<aside>` 里只有乐谱库；面板走页面里那个 `#sheet-slot`（底部抽屉）。
 * **它常驻 DOM，只有「展开 / 收起」两态、没有「关闭」**：收起 = 宽度归零（内联 `width: 0`）+
 * 边框归零 + 过渡，跟右侧那条总览（`Minimap`）**同一套动画**，所以列表的搜索词 / 排序 / 多选都留着。
 *
 * 它是 `.player` 这个 flex 行里的**一个子项**：**占谱面左边一块宽度**（谱面会跟着变窄 / 变宽）。
 * **做过一版「像右侧总览那样悬浮」的（`absolute`、不占宽度），用户看过之后否掉了**，别再改回去：
 * 悬浮会挡住谱面左边一块，而乐谱库是要一边看谱一边翻的。
 */
.side-bar {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* 窄屏上不能把谱面挤没：最多占 94vw（视口更窄时听它的） */
  max-width: 94vw;
  background: var(--surface-card);
  border-right: 1px solid var(--stroke-soft);
  padding-top: var(--safe-t);
  /* 宽度与边框一起过渡 —— 收起时两个都归零，整块彻底不占地方。
     `transform` 也在这里：`.bars-hidden`（播放时隐藏工具栏）用平移把它送出屏幕，见下面那条 */
  transition: width var(--side-io) var(--ease), border-right-width var(--side-io) var(--ease),
    transform var(--side-io) var(--ease);
}
.side-bar.collapsed {
  border-right-width: 0;
}
/* 「播放时隐藏工具栏」：这几条**平移出屏幕**（藏 = 真的挪走，不是淡出，规则见 docs/ui.md §18.35）。
   收起 / 展开本身已经把它压成 0 宽，所以这里主要是防住两处**画在裁切层外面**的东西：
   `.side-resizer` 上端 `top: -15px`、中间那根小竖条 `bottom: -15px` —— 它们不跟着宽度走，
   光靠「宽度 = 0」会看到左边缘浮着半截把手。整块 `translateX(-100%)` 是让它们一起消失的唯一写法。

   ⚠️ **类名是 `.bars-hidden` 而不是 `.hidden`**，五个使用方（侧栏 / 左上胶囊 / 右上胶囊 / 顶栏提示条 /
   底栏）全部照此。原因：本文件末尾还有一个**给隐藏文件输入用的 scoped `.hidden { display: none }`**，
   而 Vue 的 scoped 会在编译时把 `.side-bar.hidden` 削成 `.hidden`（只有前后两截都带标记才保留，
   这里 `.side-bar` 是静态类、`.hidden` 来自绑定，只剩后者带标记）。于是那条 `display: none`
   会命中所有 `.hidden` —— 顶栏**直接消失、连过渡都看不见**（用户报的「右上对了、左上没动画」
   就是这个）。换一个词就永远不会再撞。 */
.side-bar.bars-hidden {
  transform: translateX(-100%);
}
/* 拖动中关掉过渡，否则宽度跟不上指针（不再需要禁选中 —— 全站都已禁，见 main.css） */
.side-bar.dragging {
  transition: none;
}
/* 裁切层：内容按固定宽度排版，收起 / 拖动调宽时列表不会重排（和 `.mini-clip` 一个道理）。
   **不能**把 `overflow: hidden` 放在 `.side-bar` 上 —— 那样会把压在边框外的把手一起裁掉 */
.side-clip {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.side-frame {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ---------------------- 抽屉（面板）：从底部升起的那个盒子 ---------------------- */
/*
 * `#sheet-slot` 就是抽屉的盒子：位置与宽度由页面按横竖屏用 CSS 变量给（见 `slotStyle()`），
 * **高度固定 85%**（不给拖，所以抽屉上没有把手）。面板 Teleport 进来铺满它。
 * **它空着的时候不吃指针**，所以谱面照常可点、底栏胶囊照常能按。
 * `.landscape` 由页面挂（横竖屏的判据就是 `syncOrientation()` 那一个），抽屉的圆角按它分 ——
 * 面板是 Teleport 进来的、父链上拿不到页面的 scoped 属性，只能这么把朝向递进去（见 `AppSheet`）。
 */
.sheet-slot {
  position: absolute;
  bottom: 0;
  left: var(--drawer-left, 0);
  right: var(--drawer-right, 0);
  width: var(--drawer-w, auto);
  max-width: var(--drawer-max-w, none);
  margin: var(--drawer-margin, 0);
  height: var(--drawer-h);
  pointer-events: none;
  z-index: 30;
}
/* 抽屉外面那层：`.scrim` 全局类不带 z-index，而 `.stage` 也是定位元素、还在它前面，
   只靠 DOM 顺序压不住 —— 必须显式给一个（低于抽屉盒子 30、高于谱面里的胶囊 24~26） */
.sheet-scrim {
  z-index: 29;
}
/* 抽屉右边缘那根把手：**与侧栏那根同一个类**（`.side-resizer` 的形态、hover、按下全照搬），
   只是位置自己摆 —— 它是槽的兄弟节点（不能塞进槽里，见模板那条注释），
   所以 `left` 由页面按抽屉宽度内联给、上下两端跟抽屉对齐（抽屉高 `--drawer-h`、贴着底边，
   于是上端落在 `100% − --drawer-h`）。`z-index` 要压过槽（30）和那层遮罩（29），否则点不到。
   选择器写成两段是为了压过下面的 `.side-resizer`（两者同为 (0,1,0)，同分比的是顺序） */
.side-resizer.drawer-resizer {
  top: calc(100% - var(--drawer-h));
  bottom: 0;
  right: auto;
  z-index: 31;
}
/* **抽屉不用再补一条 `::before` 竖线**：它本来就要画右描边，而且右上角是圆的，
   补上去那条直线会戳出圆角外面 —— 只留中间那根小竖条当提示 */
.side-resizer.drawer-resizer::before {
  display: none;
}
/* 拖动中：抽屉自己那条右描边换成主题色（像素位置就是它的边框，绝不会错位）；
   侧栏那根把手的同名效果画在 `.side-bar.dragging::after` 上 —— 抽屉盖着它，看不到 */
.sheet-slot.dragging :deep(.drawer-box) {
  border-right-color: var(--accent);
}
/* 横屏：抽屉只占左边那一列，遮罩改成**从左到右的渐变** —— 左深右浅，往谱面上渐隐 */
.sheet-scrim.fade-x {
  background: linear-gradient(90deg, var(--scrim) 0%, transparent 68%);
}
.scrim-io-enter-active,
.scrim-io-leave-active {
  transition: opacity var(--side-io) var(--ease);
}
.scrim-io-enter-from,
.scrim-io-leave-to {
  opacity: 0;
}
/* 侧栏那一条标题栏（「乐谱库」+ 本地占用）住在 `LibraryPanel` 的 `.lib-head` 里，
   高度 / 内边距 / 字号 / 下边框与抽屉的 `.sheet-head` 一致（含那条
   `min-height: calc(var(--tap) + 24px + 1px)` —— 它是让标题栏**与抽屉标题栏同高**的那一条）。 */
.side-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 列表要能撑满并自己滚（`.library` 是 `height: 100%`，这里再补一层 flex 让它在两种长相下都成立） */
.side-body :deep(.library) {
  flex: 1;
  min-height: 0;
}

/* 侧栏把手：压在侧栏那条 1px 边框上，与右侧总览那根同一套形态与颜色。
   它管三件事：拖宽 / 往左拖到 `SIDE_MIN` 以下**立刻收起** / 收起状态下点一下或往右拖就拉出来 */
.side-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -7px;
  width: 14px;
  cursor: col-resize;
  touch-action: none;
  /* 抽屉那根住在 `#sheet-slot` 里，而槽自己是 `pointer-events: none`（空着时不吃指针）——
     `pointer-events` 是会继承的，所以这里必须显式要回来 */
  pointer-events: auto;
  z-index: 27;
}
/* 收起后把手改贴在屏幕左边缘，成为「把乐谱库拉出来」的入口（与右侧总览那根镜像） */
.side-bar.collapsed .side-resizer {
  right: auto;
  left: var(--safe-l);
}

/* 边框上那条线：hover 时显示成灰色，像素位置与拖动时的主题色线完全重合
   （把手跨在边框两侧 -7 ~ +7，所以侧栏最右 2px 落在把手的 left 5px 处） */
.side-resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 5px;
  width: 2px;
  background: var(--stroke-strong);
  opacity: 0;
  transition: opacity 0.12s ease;
}
/* hover 与按下**形态完全一样**，只换颜色：灰 → 主题色 */
.side-resizer:hover::before {
  opacity: 1;
}

/* 中间那根小竖条：默认的把手提示 */
.side-resizer::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 6px;
  width: 2px;
  height: 46px;
  margin-top: -23px;
  border-radius: 2px;
  background: var(--stroke-strong);
  transition: background 0.15s ease, width 0.15s ease, height 0.15s ease, left 0.15s ease, margin-top 0.15s ease;
}
.side-resizer:hover::after {
  background: var(--stroke-strong);
  width: 3px;
  height: 64px;
  margin-top: -32px;
}
/* 按下 / 拖动中：同样的形状，颜色换成主题色，整条右边缘再亮一条线 */
.side-resizer:active::after,
.side-resizer.dragging::after,
.side-bar.dragging > .side-resizer::after {
  background: var(--accent);
  width: 3px;
  height: 64px;
  margin-top: -32px;
}
/* 拖动中：主题色线已经画在侧栏自己身上了，把手那条灰线让开 */
.dragging > .side-resizer::before {
  opacity: 0;
}
/* 拖动中那条主题色边线（画在侧栏的右边缘上） */
.side-bar.dragging::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 2px;
  background: var(--accent);
}

/* 收起状态那颗「乐谱库」胶囊只负责定位；本体来自全局 `.capsule` / `.glass` / `.cap-btn`，
   边距与右上那颗总览胶囊、右下那对底栏胶囊一致（都读 `--glass-inset-*`，只有那一处定义）。
   侧栏收起时它的宽度是 0，所以这颗正好落在屏幕左上角 */
.back-dock {
  position: absolute;
  top: var(--glass-inset-t);
  left: var(--glass-inset-l);
  z-index: 26;
  /* 「播放时隐藏工具栏」：往上平移出屏幕。
     偏移量必须**比自身高度还多**：这颗钉在 `--glass-inset-t`（= safe-t + 8）上，
     只写 `-100%` 的话屏幕顶上还会露出那 8px + 安全区那一条。 */
  transition: transform var(--side-io) var(--ease);
}
.back-dock.bars-hidden {
  transform: translateY(calc(-100% - var(--glass-inset-t) - 8px));
}

/* 布局来自全局 .empty，这里只让它撑满舞台 */
.state {
  flex: 1;
}
.state p {
  margin: 0;
  font-size: 16px;
}
/* 「导入 PDF」是空状态里的上传入口，桌面端悬停时提亮 + 套一圈主题色光晕。
   只靠 filter 太淡（主题色本来就亮），光晕才看得出「鼠标在这儿」。光晕用 box-shadow 画，
   不占布局、不会把旁边的字挤动。触屏不隔离 hover 会留下粘滞的悬停态。 */
@media (hover: hover) {
  .state .btn.primary:hover {
    filter: brightness(1.1);
    box-shadow: 0 0 0 3px var(--accent-line);
  }
}

.bottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: var(--glass-inset-b);
  padding: 0 var(--glass-inset-r) 0 var(--glass-inset-l);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
  z-index: 24;
  /* 「播放时隐藏工具栏」：整条向下平移出屏幕（与顶栏那几条同一个判据、同一段时长）。
     偏移量必须**比自身高度还多**：它钉在 `--glass-inset-b`（= safe-b + 8）上，
     只写 `100%` 的话屏幕底下还会露出那 8px + 安全区那一条。 */
  transition: transform var(--side-io) var(--ease);
}
.bottom.bars-hidden {
  transform: translateY(calc(100% + var(--glass-inset-b) + 8px));
}
.bottom > * {
  pointer-events: auto;
  max-width: 100%;
}

/* 顶部提示（三类 toast 与撤销那条）**不在这页画**：整条栈挂在 `App.vue` 的 `ToastStack` 上，
   位置是 `main.css` 的 `.toast-wrap`（`top: var(--hint-top)`）。
   这页只在「播放时隐藏工具栏」时转达一句 `setHintsHidden()`，由那边把整条栈平移出屏幕。 */

/* 拖入提示层：整页一层遮罩，盖住一切（含侧栏与浮层），松手后由 handleFiles 分流。
   提示本体没有卡面 —— **没有底色、没有虚框、没有阴影**，只留遮罩与图标 + 文字。 */
.drop-veil {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--surface-page) 72%, transparent);
}
.drop-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 340px;
  color: var(--accent);
  text-align: center;
}
.drop-card strong {
  font-size: 15px;
  font-weight: 600;
}

/* 封面替换那个确认框：**当前与新的两张图横着并排**（规则见 docs/ui.md §18.69）。
   每个格子是**正方形**、图等比完整放进、不裁切 —— 与卡片 / 信息面板里的封面同一套（§18.8）；
   ⚠️ **有图时把占位底撤掉**（`:has(img)`），否则不方正的封面四周会被补成一个方框（§18.19 第 65 条）。 */
.cover-cmp {
  display: flex;
  gap: 12px;
}
.cover-cmp-item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.cover-cmp-k {
  font-size: 13px;
  color: var(--text-muted);
}
.cover-cmp-box {
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius-sm);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-control);
  color: var(--text-muted);
}
.cover-cmp-box:has(img) {
  background: none;
}
.cover-cmp-box img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  display: block;
  filter: var(--pdf-invert, none);
}
/* 用户自己选的图不跟着深色模式反色（与卡片 / 信息面板的 `img.custom` 同一条） */
.cover-cmp-box img.custom {
  filter: none;
}
.cover-cmp-note {
  font-size: 12.5px;
  color: var(--text-muted);
  text-align: center;
  overflow-wrap: anywhere;
}

/* 居中确认框里的「当前 / 新的」那几行（`confirmBox.rows`，规则见 docs/ui.md §18.69）：
   标签在左、值在右 —— 取值与乐谱信息的 `.facts` 同一套（13 / 13.5 / 12.5 三档字号）。
   ⚠️ **值不许省略号截断**：两边要对比的往往正是文件名的结尾（`.mp3` / `.jpg` 那一截），
   截掉就等于又把信息藏回去了，长文件名让它换行（`overflow-wrap`）。 */
.cmp {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cmp-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.cmp-k {
  flex: none;
  font-size: 13px;
  color: var(--text-muted);
}
.cmp-v {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  text-align: right;
  overflow-wrap: anywhere;
}
/* 值下面那行小字：新配置的规模（旧的那一侧本来就是规模，没有这一行） */
.cmp-sub {
  display: block;
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--text-muted);
}

/* 隐藏文件输入用的（`display: none`）。
   ⚠️ **「播放时隐藏工具栏」那几条千万别复用这个类名**：Vue 的 scoped 会把它编译成**裸 `.hidden`**
   （见上面 `.side-bar.bars-hidden` 那条注释），于是它会把顶栏 `display: none` 掉 ——
   看起来就是「点播放工具栏没了，但没有平移动画」。那边统一用 `.bars-hidden`。 */
.hidden {
  display: none;
}
</style>
