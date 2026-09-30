<script setup>
/**
 * 标记列表（treeview）：**再点一次已经选中的那个标记工具**时弹出来的抽屉。
 *
 *  · **哪个工具进来都是这一份列表**（用户要求）：内容永远是「全谱的标记」，工具只决定「从哪儿进来的」——
 *    所以**标题就是通用的一句话**（`marks.title`），不用每个工具换一个词（头部也只有标题 + 关闭）。
 *    入口在 `PlayerToolbar`（同一个工具再点一次 = 开 / 关这个面板）。
 *  · **层级 = 行做父节点**，子节点是挂在这一行上的**小节线 / 段落 / 反复**；
 *    树本身的算法在 **`domain/marks.js`**（纯逻辑、有单测）。
 *  · **外观照搬乐谱库那一套**（用户要求）：顶部一行是**四颗纯文本按钮**
 *    （展开·收起 / 全选·清空 / 筛选 / 删除，乐谱库多选顶栏那套 `.btn.sm.text` 的写法，各占等分），
 *    「全选 / 清空」那颗**只有标签随状态换，图标恒为 `selectAll`**（不换成 `close`，用户要求），
 *    **没有「完成」**（关面板有头部那颗 × / 遮罩 / Esc）；勾选圈**在每行右边**
 *    （乐谱库多选时「⋯」就地换成圈的位置），**底部不放任何东西**（没有 footer，也就没有「已选中 N 项」那一行）。
 *  · **删除前那道居中确认有 footer**（它不走本面板这条「底部空着」的规矩）：两颗照
 *    docs/ui.md §18.61 第 168 条 —— **实心底色 + 18px 图标**（取消 = `.btn` + `close`、
 *    删除 = `.btn.danger` 实心危险底 + `trash`）。
 *  · 行显示成「第 N 页 第 M 行」，下面一行小字是这一行的摘要「5 小节 5 段落 5 反复」；
 *    展开后每个子项**只有一行字**：小节线写它起头的小节号（「第 5 小节」）、
 *    段落写名字（没名字写「120 4/4」）、反复写类型（反复开始 / 反复结束 / 房子 1）。
 *  · **多选**：行与子节点各有自己的勾、父子**不联动**；勾行 = 连它下面的子标记一起删
 *    （`removeSystem` 本来就级联清段落与反复）。
 *  · **默认全收起**：`expanded` 是空集 = 一行都没展开，一进来是一屏「第N页第M行 + 摘要」，
 *    没有满屏子项。于是顶栏那颗**一进来就是「展开」**（它的判据见下面 `allOpen`）。
 *  · **筛选 = 顶栏那颗「筛选」弹出的上下文菜单**（`ContextMenu`，**四类标记 + 底下一项「全部」**，
 *    两者之间一条分割线；四类 = 行 / 小节线 / 段落 / 反复，名字与图标都**复用工具栏那四个工具**，
 *    不给同一类标记造第二套叫法）：关掉哪一档，列表里就不出现哪一类。
 *    **「全部」是总开关**（勾 = 四档全开着）：全亮时再点一次 = 四档一起关（列表随即说「当前筛选下
 *    没有可显示的标记」），否则 = 四档一起开；标签恒为「全部」（见 `filterItems`）。
 *    **「行」那一档关掉时子项照样要看得到** —— 那时列表**摊平**成
 *    一条条标记（没有父节点可挂了，子项那行字前面补上它落在哪一行）。
 *    筛选**只影响这份列表**：不碰 meta、也不改谱面（面板开着时谱面本来就全是灰的）；
 *    **勾选恒等于「当前看得见的那些」**（切筛选时把选区收窄、全选也只勾看得见的）——
 *    唯一例外是勾一整行：`removeSystem` 本来就级联，它下面被筛掉的子标记也会一起走，
 *    所以行的小字摘要照旧报真实条数（`summary` 不跟着筛）。
 *  · **列表自己是那个滚动容器**：外面 `.fill` 撑满 `.sheet-body` 的高度，`.marks-list` 才有可滚的高度。
 *    ⚠️ `AppSheet` 的 `.sheet-body` 是**块级**容器（不是 flex），少了 `.fill` 这层，列表的
 *    `flex: 1` 不生效 → 它一点都滚不动（鼠标停在列表里滚滚轮没反应，见 `docs/ui.md` §18.44 第 139 条）。
 *  · **批量删除只弹一条 toast、但按项记撤销记录**：把那一串删除函数以 `notify = false`
 *    调一遍（不各弹一条通知），每一项各记一条删除记录，所以「删除 xN」点一次退一项。
 *  · **删除要过一道居中确认弹窗**（`AppSheet` + `position="center"`，**不传 `follow-layout`** ——
 *    与「删除乐谱」那个确认同一个形态，见 `docs/ui.md` §13 / §14）：删除是不可恢复的动作，
 *    0 项时按钮本来就是灰的，按下去也只弹窗、不真删。文案里的条数是**真正会被删掉的那几项**
 *    （勾了整行时它下面的子标记不重复计）。
 *  · **点击项 = 谱面滚到它那儿并闪一下**（`locate`）：坐标由 `domain/marks.js` 一起算好，
 *    滚动与高亮分别在 `PdfViewer` / `ScorePage`。
 */
import { computed, reactive, ref, watch } from 'vue'
import { Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleDashedCheck, Funnel, ListTree, RectangleHorizontal, Trash, X } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import ContextMenu from './ContextMenu.vue'
import {
  player,
  removeBar,
  removeRepeat,
  removeSegment,
  removeSystem,
  structure,
} from '../store/player.js'
import { EDIT_TOOLS } from '../store/ui.js'
import { buildMarkTree } from '../domain/marks.js'
import { REPEAT_KINDS } from '../domain/schema.js'
import { toast } from '../store/toast.js'
import { t } from '../i18n/index.js'
import { segmentLabel } from '../i18n/score-text.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'locate'])

/**
 * 筛选菜单的四个 key = 工具栏那四个工具（`EDIT_TOOLS`），**只有「小节线」那一档名字不同**：
 * 列表里那一类的 `kind` 是 `bar`（`domain/marks.js` 的分组键），其余三个与工具 key 同字。
 * 名字与图标一律从 `EDIT_TOOLS` 取，**不再抄一份**。
 */
const FILTER_KEYS = { row: 'row', barline: 'bar', segment: 'segment', repeat: 'repeat' }

/** 筛选菜单第一项「全部」的 key —— 它不对应任何一类标记，只把四档一起打开（见 `filterItems`） */
const ALL_FILTER = 'all'

const selected = ref(new Set())
/** **展开着的行**（默认空集 = 一行都不展开，见文件头注释「默认全收起」） */
const expanded = ref(new Set())
/** 四类标记的显示开关：`row` 管父节点那一档，另三个与子节点的 `kind` 同名。默认全开 = 不筛 */
const filters = reactive({ row: true, bar: true, segment: true, repeat: true })
/** 高亮用的序号：每次定位都 +1 —— 同一个目标连点两次，`ScorePage` 的动画也要重播一次 */
let focusTick = 0

/**
 * 列表数据 —— **树本身的算法在 `domain/marks.js`**（纯逻辑，`scripts/unit-test.mjs` 里测得到）。
 * 那几段要拼进 `line` 的文案在这里 `t()` 好再传进去（domain 层不引 i18n，见 `docs/code.md` §2）。
 */
const rows = computed(() =>
  buildMarkTree(player.meta, structure.value, {
    measure: t('marks.measureAt'),
    bar: t('marks.type.bar'),
    segment: segmentLabel,
    repeat: {
      start: t(REPEAT_KINDS.start.labelKey),
      end: t(REPEAT_KINDS.end.labelKey),
      house1: t(REPEAT_KINDS.house1.labelKey),
    },
  })
)

/** 这一行里**当前要显示的子项**（被筛掉的那几类不出现） */
function shownChildren(row) {
  return row.children.filter((c) => filters[c.kind])
}

/**
 * 子项那一行字：行开着时就是它自己的字（`c.line`）；**「行」那一档关掉时列表是摊平的**，
 * 子项得自己说清落在哪一行 —— 父节点没了，光「房子 1」看不出位置。
 */
function childLine(row, c) {
  if (filters.row) return c.line
  const at = t('marks.pageAt', { n: row.page + 1 }) + t('marks.rowAt', { n: row.index })
  return t('marks.flatAt', { at, line: c.line })
}

/**
 * 列表里**当前看得见**的条目（含子项）—— 全选 / 清空按它算：被筛掉的不能顺手勾上
 * （勾得到就删得到，那等于把看不见的标记一起删了）。
 */
const visibleKeys = computed(() =>
  filters.row
    ? rows.value.flatMap((r) => [r.id, ...shownChildren(r).map((c) => c.id)])
    : rows.value.flatMap((r) => shownChildren(r).map((c) => c.id))
)
const allSelected = computed(
  () => visibleKeys.value.length > 0 && visibleKeys.value.every((k) => selected.value.has(k))
)
const selectedCount = computed(() => selected.value.size)

/** 「所有行现在都展开着」—— 有没有**任意一行**没展开（`expanded` 空集 = 一行都没展开） */
const allOpen = computed(() => rows.value.every((r) => expanded.value.has(r.id)))

/** 这一行展开着没（默认全收起：只有按过它的行才在 `expanded` 里） */
function isOpen(row) {
  return expanded.value.has(row.id)
}

function isSelected(key) {
  return selected.value.has(key)
}

/** 换一个新的 Set：直接改 Set 内部 Vue 追踪不到 */
function toggleKey(key, e) {
  e?.stopPropagation()
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

/** 勾一行 = 连它的子标记一起勾（它们会跟着这一行一起被删）。**只勾显示着的那些** —— 筛掉的不进选区 */
function toggleRow(row, e) {
  e.stopPropagation()
  const next = new Set(selected.value)
  const keys = [row.id, ...shownChildren(row).map((c) => c.id)]
  const on = keys.every((k) => next.has(k))
  for (const k of keys) {
    if (on) next.delete(k)
    else next.add(k)
  }
  selected.value = next
}

/** 点行本身 = 展开 / 收起，顺带把谱面滚到这一行 */
function toggleExpand(row) {
  const next = new Set(expanded.value)
  if (next.has(row.id)) next.delete(row.id)
  else next.add(row.id)
  expanded.value = next
  locate(row)
}

function selectAll() {
  selected.value = allSelected.value ? new Set() : new Set(visibleKeys.value)
}

/**
 * 「展开 / 收起」那一颗：**判据是「有没有一行没展开」**（不是「是不是都展开了」）——
 * 只要还有折着的就全展开，全都展开时才全收起。不碰勾选，也不定位。
 * **「行」那一档被筛掉时这颗是禁用的**：列表那时是摊平的，没有可折的东西（见模板）。
 */
function toggleAll() {
  expanded.value = allOpen.value ? new Set() : new Set(rows.value.map((r) => r.id))
}

/* ---------------------------- 筛选（顶栏那颗「筛选」） ---------------------------- */

/** 筛选菜单开着没（贴住那颗按钮的 `ContextMenu`，不是抽屉） */
const filterMenu = ref(false)
const filterAnchor = ref(null)
/** 有四档里的任何一档被关掉 = 正在筛（只用来定「全部」那一项的勾；**顶栏那颗按钮不跟着变色**） */
const filtered = computed(() => !Object.values(filters).every(Boolean))

/**
 * 菜单 = **四类标记 + 底下一项「全部」**（隔着一条分割线）。四类的名字与图标都
 * **从工具栏那四个工具取**（`EDIT_TOOLS`），勾 = 这一类现在显示着。
 *
 * **「全部」是总开关**：四档全开着（= 没在筛）时点它 = **四档一起关**，否则 = 四档一起开；
 * 勾 = 四档全开着。标签**恒写「全部」**，不跟着状态换成「清空」：「全选 ↔ 清空」那一套
 * 是要换标签的，而这份面板里「清空」两个字已经是顶栏那颗（清空**勾选**）的意思，
 * 同一个面板里两个「清空」必然打架 —— 状态全靠那个勾表达。
 */
const filterItems = computed(() => [
  ...EDIT_TOOLS.map((tool) => {
    const key = FILTER_KEYS[tool.key]
    return { key, label: t(tool.labelKey), icon: tool.icon, checked: filters[key] }
  }),
  // 排最后 + `divider`：`ContextMenu` 会在它上面画一条线，把它与上面四类分开
  { key: ALL_FILTER, label: t('marks.filter.all'), icon: CircleDashedCheck, checked: !filtered.value, divider: true },
])

/** 点顶栏那颗「筛选」：菜单贴住按钮下方弹出（与乐谱库顶栏那颗菜单钮同一套写法） */
function openFilterMenu(e) {
  const r = e.currentTarget.getBoundingClientRect()
  filterAnchor.value = { left: r.left, bottom: r.bottom + 4 }
  filterMenu.value = true
}

/**
 * 点一项：四类各自开 / 关（菜单**点完不关**，`stay-open`，可以连着点）；
 * 底下那项「全部」是总开关 —— **四档全开着时点它 = 四档全关**（空列表会说话：
 * 「当前筛选下没有可显示的标记」），否则 = 四档全开。
 * 两种点法收尾都一样：把选区**收窄到当前看得见的那些** —— 筛掉的不该还勾着
 * （否则删除按钮亮着、条数也虚报）。
 */
function toggleFilter(key) {
  if (key === ALL_FILTER) {
    const on = !filtered.value // 现在四档全开着 = 这一下要全关
    Object.assign(filters, { row: !on, bar: !on, segment: !on, repeat: !on })
  } else {
    filters[key] = !filters[key]
  }
  const keep = new Set(visibleKeys.value)
  selected.value = new Set([...selected.value].filter((k) => keep.has(k)))
}

/**
 * 把谱面滚到这一项、并让它闪一下（`locate` 往上传，滚动与高亮分别由 `PdfViewer` / `ScorePage` 做）。
 * 坐标是 **meta 的 y-up**（行 / 小节线本来就存在这个空间），换算与翻转都在 `PdfViewer` 那边。
 * 行与子项都带着自己的坐标，所以只有一支函数 —— 拿不到坐标就不滚（不乱跳到别处）。
 */
function locate(item) {
  const y0 = Number(item.y0)
  const y1 = Number(item.y1)
  if (!Number.isFinite(item.page) || !Number.isFinite(y0) || !Number.isFinite(y1)) return
  emit('locate', { key: item.id, page: item.page, y0: Math.min(y0, y1), y1: Math.max(y0, y1), tick: ++focusTick })
}

/**
 * 这一次删除**真正会删掉几项**：勾了整行时它下面的子标记不重复计
 * （行一走，`removeSystem` 就把它们级联带走了）—— 确认弹窗与 toast 都报这个数，
 * 报「勾了几个」会多算一遍，看起来像删了两次。
 */
const deleteCount = computed(() => {
  const keys = selected.value
  let n = 0
  for (const row of rows.value) {
    if (keys.has(row.id)) {
      n++
      continue
    }
    for (const c of row.children) if (keys.has(c.id)) n++
  }
  return n
})

/** 删除确认弹窗开着没 */
const confirmOpen = ref(false)

/**
 * 批量删除：**先弹居中的确认，确认之后才落库**。
 * 一条 toast、但**按项算步数**：行连带它的子标记（`removeSystem` 本来就级联清段落与反复），
 * 子项各删各的；全部走 `notify = false`（那一串不各弹一条通知），
 * 顶部那条「删除 xN」只弹一次、N 就是这一次勾掉的项数。
 * **每一项各记一条删除记录**（删除函数里 `noteRemoval()` 记），所以点一次「撤销」退回一项、
 * 「删除 xN」的 N 跟着 -1，勾 3 项就要点 3 次才全回来。
 */
function removeSelected() {
  const keys = selected.value
  if (!keys.size) return
  confirmOpen.value = false
  // **条数要在动手之前数好**：`rows` 是 meta 的 computed，删到一半它就重算了，
  // 删完再读只会得到 0。列表也在这里拍平成快照 —— 循环期间 meta 一直在变。
  const n = deleteCount.value
  const list = rows.value
  for (const row of list) {
    // 行连带它的子标记一起走：`removeSystem` 本来就级联清掉挂在那些小节线上的段落与反复
    if (keys.has(row.id)) {
      removeSystem(row.id, false)
      continue
    }
    for (const c of row.children) {
      if (!keys.has(c.id)) continue
      if (c.kind === 'bar') removeBar(c.id, false)
      else if (c.kind === 'segment') removeSegment(c.id, false)
      else removeRepeat(c.id, false)
    }
  }
  selected.value = new Set()
  toast(n > 1 ? t('marks.deleted', { n }) : t('marks.deleteOne'))
}

/**
 * 面板每次打开都从干净状态开始：没有勾选、没有展开的行、四类标记也全部显示着
 * （关掉再开不该留着上次的勾，也不该留着一个看不见的筛选 —— 列表少了东西却不知道为什么最吓人）。
 * 关掉时顺带把删除确认与筛选菜单也收掉 —— 留着的话下次打开会先弹一个确认框 / 一份菜单。
 */
watch(
  () => props.open,
  (open) => {
    if (!open) {
      confirmOpen.value = false
      filterMenu.value = false
      return
    }
    selected.value = new Set()
    expanded.value = new Set()
    Object.assign(filters, { row: true, bar: true, segment: true, repeat: true })
  }
)

/**
 * 抽屉自己的关闭动作：**确认框 / 筛选菜单开着的时候不关抽屉**。
 * `AppSheet` 的 Esc 与 `ContextMenu` 的 Esc 都挂在 window 上，两个都开着时按一下 Esc
 * 会同时命中它们 —— 那不是「先关最靠前的那一层」。这样拦一下才是逐层关
 * （确认框那条与「删除乐谱」那个确认同一个道理，见文件头注释）。
 */
function closePanel() {
  if (confirmOpen.value || filterMenu.value) return
  emit('close')
}
</script>

<template>
  <!-- 头部用 `AppSheet` 那一套（图标 + 标题 + 右侧关闭键）：与其它面板**长得一模一样**，
       图标走 `icon` prop —— **不要自己写 `<h2>`**（插槽里的 h2 拿不到 AppSheet 的 scoped 样式，
       字号会变 24、关闭钮会贴到标题上，见 `AppSheet.vue` 头部注释）。
       工具名不再缀在标题上（用户要求）。 -->
  <AppSheet
    :open="open"
    :title="t('marks.title')"
    :icon="ListTree"
    position="bottom"
    follow-layout
    panel-key="marks"
    @close="closePanel"
  >
    <!-- `.fill` 是**列表的滚动高度来源**：`AppSheet` 的 `.sheet-body` 是块级容器，
         不撑满这一层的话 `.marks-list` 的 `flex: 1` 不生效、自己就滚不动了（见文件头注释）。 -->
    <div class="fill">
      <!-- 多选那一行：与乐谱库的多选顶栏**同一套写法**（`.lib-bar.select` 的纯文本按钮，图标 + 文字、
           各占等分、删除用危险色），只是这里只有四颗 —— 列表没有「导出」，**也没有「完成」**
           （用户要求去掉：关面板有头部那颗 ×、点遮罩、Esc 三条路，再来一颗「完成」是同一个动作的第四个入口）。
           那颗「全选 / 清空」管所有行与子项，**一行一个动作按钮**的规矩它不吃（这是列表的顶栏，不是抽屉里的动作区）。 -->
      <div class="bar">
            <!-- 一键全展开 / 全收起：**判据是「有没有一行没展开」**（只展开了一行时按下去也是「展开」）。
             标签与图标跟着状态换（这一对是全仓唯一换图标的那颗）；旁边那颗「全选 ↔ 清空」只换字、
             图标恒为 `CircleDashedCheck`；空列表、以及「行」那一档
             被筛掉时（列表那时是摊平的，没有可折的东西）禁用。 -->
        <button type="button" class="btn sm text strong" :disabled="!rows.length || !filters.row" @click="toggleAll">
          <component :is="allOpen ? ChevronsDownUp : ChevronsUpDown" :size="18" />
          {{ allOpen ? t('common.collapse') : t('common.expand') }}
        </button>
        <button type="button" class="btn sm text strong" @click="selectAll">
          <CircleDashedCheck :size="18" />
          {{ allSelected ? t('common.clear') : t('common.selectAll') }}
        </button>
        <!-- 筛选：**贴住这颗按钮的小菜单**（`ContextMenu`，不是抽屉、不叠第二层），
             四档 = 行 / 小节线 / 段落 / 反复，点一项开 / 关一类。
             **它和旁边那颗「全选」一个颜色**（`.strong` 黑字），**不用主题色**（用户要求）——
             正在筛的时候也不变色：这份顶栏四颗里只有「删除」用另一档颜色（危险色）。 -->
        <button type="button" class="btn sm text strong" @click="openFilterMenu">
          <Funnel :size="18" /> {{ t('marks.filter.label') }}
        </button>
        <!-- 点它只是**打开确认**，不直接删（下面那个 center 的 AppSheet 才是真删） -->
        <button type="button" class="btn sm text danger" :disabled="!selectedCount" @click="confirmOpen = true">
          <Trash :size="18" /> {{ t('common.delete') }}
        </button>
      </div>

      <div v-if="!rows.length" class="empty small">
        <RectangleHorizontal :size="30" />
        <p>{{ t('marks.empty') }}</p>
      </div>

      <!-- 有标记、但**被筛光了**（「行」那一档关掉之后三类子标记又都关着）：换一句说明，
           别让人以为标记没了 —— 图标也换成筛选，指回顶栏那颗按钮 -->
      <div v-else-if="!visibleKeys.length" class="empty small">
        <Funnel :size="30" />
        <p>{{ t('marks.filter.empty') }}</p>
      </div>

      <ul v-else class="marks-list scroll-y">
        <li v-for="row in rows" :key="row.id">
          <!-- 行做父节点：整块可点 = 展开 / 收起（顺带把谱面滚到这一行）；
               勾选圈**在右边**（与乐谱库多选时「⋯」变圈的位置一致），自己管选中。
               **「行」那一档被筛掉时这一块整条不画** —— 子项那时摊平成一条条标记（见下面那个 ul） -->
          <button v-if="filters.row" type="button" class="tree-node" @click="toggleExpand(row)">
            <ChevronRight class="twisty" :class="{ open: isOpen(row) }" :size="16" />
            <span class="texts">
              <span class="line">{{ t('marks.pageAt', { n: row.page + 1 }) }}{{ t('marks.rowAt', { n: row.index }) }}</span>
              <span class="desc">
                {{ t('marks.summary', { measures: row.summary.measures, segments: row.summary.segments, repeats: row.summary.repeats }) }}
              </span>
            </span>
            <span class="check" :class="{ on: isSelected(row.id) }" @click="toggleRow(row, $event)">
              <Check v-if="isSelected(row.id)" :size="14" />
            </span>
          </button>

          <!-- 子项**就一行字**：小节线 = 「第 5 小节」（它起头的那一小节）、段落 = 名字（没名字写速度）、
               反复 = 类型（反复开始 / 反复结束 / 房子 1）。
               **行那一档关掉时**：不再缩进（`.tree-children.flat`）、也不再分展开 / 收起，
               那句字前面由 `childLine()` 补上它落在哪一行。 -->
          <ul v-if="!filters.row || isOpen(row)" class="tree-children" :class="{ flat: !filters.row }">
            <li v-for="c in shownChildren(row)" :key="c.id">
              <button type="button" class="tree-node child-node" @click="locate(c)">
                <span class="line">{{ childLine(row, c) }}</span>
                <span class="check" :class="{ on: isSelected(c.id) }" @click="toggleKey(c.id, $event)">
                  <Check v-if="isSelected(c.id)" :size="14" />
                </span>
              </button>
            </li>
          </ul>
        </li>
      </ul>
    </div>
  </AppSheet>

  <!-- 筛选菜单：**四项 = 四类标记**（行 / 小节线 / 段落 / 反复），带勾表示这一类现在显示着。
       `stay-open`：点一项只切那一档、**菜单不关**，四档可以连着点（点空白 / Esc 才关）——
       一点就关的话每筛一档都要重新点开一次那颗按钮。 -->
  <ContextMenu
    :open="filterMenu"
    :items="filterItems"
    :anchor="filterAnchor"
    :title="t('marks.filter.title')"
    stay-open
    @select="toggleFilter"
    @close="filterMenu = false"
  />

  <!-- 删除确认：居中的模态卡片（**不传 `follow-layout`**，所以它不参与抽屉宿主、不会被侧栏收走，
       与「删除乐谱」那个确认是同一个形态）。删除不可恢复，所以确认按钮走危险色；
       条数是**真正会被删掉的那几项**（勾了整行时子标记不重复计）。
       footer 那两颗照 docs/ui.md §13 / §18.61 第 168 条统一：**实心底色 + 18px 图标**
       （取消 = 中性 `.btn` + `X`；删除 = `.btn.danger` 实心危险底 + `Trash`），没有描边档。 -->
  <AppSheet :open="confirmOpen" :title="t('marks.delete.title')" position="center" @close="confirmOpen = false">
    <p>{{ t('marks.delete.confirm', { n: deleteCount }) }}</p>
    <template #footer>
      <button type="button" class="btn" @click="confirmOpen = false">
        <X :size="18" /> {{ t('common.cancel') }}
      </button>
      <button type="button" class="btn danger" @click="removeSelected">
        <Trash :size="18" /> {{ t('common.delete') }}
      </button>
    </template>
  </AppSheet>
</template>

<style scoped>
/* 撑满 `.sheet-body` 的高度、并把「顶栏 + 列表」排成纵向 flex：**列表要滚，靠的就是这一层**
   （`.sheet-body` 是块级容器，`flex: 1` 在它里面不生效）。
   顶栏因此**不跟着列表滚**（与乐谱库那条顶栏同一个手感），列表自己滚自己的。 */
.fill {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
/* 那一行：四颗纯文本按钮**始终平分整条顶栏**（乐谱库多选顶栏也是四颗，那边是「导出 / 完成」、
   这边是「展开·收起 / 筛选」），取值与 `.lib-bar.select .btn` **逐条同值**：
   `padding` / `gap` 收到 4，显式 `min-width: 0` 才平分得动（flex 项默认 `min-width: auto` 会撑住不缩），
   抽屉在横屏最窄就是 `SIDE_MIN`(280)，再挤就靠 `overflow: hidden` 裁掉，而不是糊到隔壁按钮上。 */
.bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}
.bar .btn {
  flex: 1 1 0;
  min-width: 0;
  padding: 0 4px;
  gap: 4px;
  overflow: hidden;
}
.marks-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tree-children {
  margin: 0;
  padding: 0;
  list-style: none;
}
/* 列表项本体：整块可点，所以是 button（内容左对齐、不继承浏览器的居中） */
.tree-node {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: var(--tap-min);
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-strong);
  text-align: left;
  cursor: pointer;
}
/* 缩进：**除了行（父节点），下面的东西都要缩进一格**（用户要求）——
   子项本来就没有展开箭头，缩进是它「挂在上面那一行底下」的唯一暗示。
   参考线：父节点那一行的**文字**从 34px 起（8 内边距 + 16 箭头 + 10 间距），
   所以子项必须明显越过 34 才看得出层次 —— 上一版写成 34 是「与父节点文字对齐」，
   看着就跟没缩进一样（用户当场否掉），**别往回改**。
   58 = 34 + 24 的台阶，一行的高度只有 46，台阶再大就只剩空白了。 */
.tree-children .tree-node {
  padding-left: 58px;
}
/* **摊平**（「行」那一档被筛掉、父节点整条不画）时没有「挂在谁底下」可言，缩进要收回去：
   选择器写成三段 + `li` 是为了压过上面那条两段的（同类规则谁重谁说了算）。 */
.tree-children.flat > li > .tree-node {
  padding-left: 8px;
}
/* 展开箭头：靠旋转表达开合（**行首只有这一个**，别再给行首引第二个箭头图标；
   顶栏那颗「展开 / 收起」是**另一个语义**（一次管全部行），它有自己的 `expandAll` / `collapseAll`） */
.twisty {
  flex: none;
  color: var(--text-muted);
  transition: transform 0.15s ease;
}
.twisty.open {
  transform: rotate(90deg);
}
.texts {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.line {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desc {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 勾选圈：与乐谱库那套同一个形状 / 配色，位置也在行的右端（`.check` 那边是 scoped，这是第二份写法） */
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
/* 桌面端悬停、以及按下态：行与子节点**同一套**（行没有自己的常态底色了，见文件头注释 ——
   父节点靠「两行字 + 展开箭头」、子节点靠缩进区分，不靠底色）。
   所以这里只有通用那两条：**别再给「行」补一条更重的选择器**，那说明又给它加回去了常态底色。 */
@media (hover: hover) {
  .tree-node:hover {
    background: var(--surface-hover);
  }
}
.tree-node:active {
  background: var(--surface-active);
}
</style>
