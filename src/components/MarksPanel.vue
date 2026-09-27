<script setup>
/**
 * 标记列表（treeview）：**再点一次已经选中的那个标记工具**时弹出来的抽屉。
 *
 *  · **哪个工具进来都是这一份列表**（用户要求）：内容永远是「全谱的标记」，工具只决定「从哪儿进来的」——
 *    所以**标题就是通用的一句话**（`marks.title`），不用每个工具换一个词（头部也只有标题 + 关闭）。
 *    入口在 `PlayerToolbar`（同一个工具再点一次 = 开 / 关这个面板）。
 *  · **层级 = 行做父节点**，子节点是挂在这一行上的**小节线 / 段落 / 反复**；
 *    树本身的算法在 **`domain/marks.js`**（纯逻辑、有单测）。
 *  · **外观照搬乐谱库那一套**（用户要求）：顶部一行是**三颗纯文本按钮**
 *    （全选·清空 / 展开·收起 / 删除，乐谱库多选顶栏那套 `.btn.sm.text` 的写法，各占等分），
 *    **没有「完成」**（关面板有头部那颗 × / 遮罩 / Esc）；勾选圈**在每行右边**
 *    （乐谱库多选时「⋯」就地换成圈的位置），**底部不放任何东西**（没有 footer，也就没有「已选中 N 项」那一行）。
 *  · 行显示成「第 N 页 第 M 行」，下面一行小字是这一行的摘要「5 小节 5 段落 5 反复」；
 *    展开后每个子项**只有一行字**：小节线写它起头的小节号（「第 5 小节」）、
 *    段落写名字（没名字写「120 4/4」）、反复写类型（反复开始 / 反复结束 / 房子 1）。
 *  · **多选**：行与子节点各有自己的勾、父子**不联动**；勾行 = 连它下面的子标记一起删
 *    （`removeSystem` 本来就级联清段落与反复）。
 *  · **「展开 / 收起」一键管全部行**（见 `allOpen`）：有任意一行被折起来时按下去 = 全展开，
 *    一行都没折时才 = 全收起 —— 标签与图标跟着这个状态换（与「全选 ↔ 清空」那颗同一个规矩）。
 *  · **批量删除是一个撤销点**：先 `snapshotUndo()`，再把那一串删除函数以 `snapshot = false`
 *    调一遍，最后只报一条 toast —— 撤销栈与顶部那条撤销 banner 都不会被刷成一串。
 *  · **删除要过一道居中确认弹窗**（`AppSheet` + `position="center"`，**不传 `follow-layout`** ——
 *    与「删除乐谱」那个确认同一个形态，见 `docs/ui.md` §13 / §14）：删除是不可恢复的动作，
 *    0 项时按钮本来就是灰的，按下去也只弹窗、不真删。文案里的条数是**真正会被删掉的那几项**
 *    （勾了整行时它下面的子标记不重复计）。
 *  · **点击项 = 谱面滚到它那儿并闪一下**（`locate`）：坐标由 `domain/marks.js` 一起算好，
 *    滚动与高亮分别在 `PdfViewer` / `ScorePage`。
 */
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import AppSheet from './AppSheet.vue'
import {
  player,
  removeBar,
  removeRepeat,
  removeSegment,
  removeSystem,
  snapshotUndo,
  structure,
} from '../store/player.js'
import { buildMarkTree } from '../domain/marks.js'
import { toast } from '../store/ui.js'
import { t } from '../i18n/index.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'locate'])

const selected = ref(new Set())
/** 「折叠起来的行」（默认全展开，所以存的是折叠的那几行） */
const collapsed = ref(new Set())
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
    tempo: (seg) => t('score.segmentTempo', { bpm: Math.round(seg.bpm || 120), beats: seg.beatsPerBar || 4, unit: seg.beatUnit || 4 }),
    repeat: {
      start: t('repeatKind.start.label'),
      end: t('repeatKind.end.label'),
      house1: t('repeatKind.house1.label'),
    },
  })
)

/** 列表里所有条目（含子项）的身份，全选 / 清空按它算 */
const allKeys = computed(() => rows.value.flatMap((r) => [r.id, ...r.children.map((c) => c.id)]))
const allSelected = computed(() => allKeys.value.length > 0 && allKeys.value.every((k) => selected.value.has(k)))
const selectedCount = computed(() => selected.value.size)

/** 「所有行现在都展开着」—— 有没有**任意一行**被折起来（空列表算全展开，那时按钮本来就是禁用的） */
const allOpen = computed(() => rows.value.every((r) => !collapsed.value.has(r.id)))

/** 每一行是否展开（折叠集合取反）。**默认全展开**（用户要的是「一下看到全部标记」） */
function isOpen(row) {
  return !collapsed.value.has(row.id)
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

/** 勾一行 = 连它的子标记一起勾（它们会跟着这一行一起被删） */
function toggleRow(row, e) {
  e.stopPropagation()
  const next = new Set(selected.value)
  const keys = [row.id, ...row.children.map((c) => c.id)]
  const on = keys.every((k) => next.has(k))
  for (const k of keys) {
    if (on) next.delete(k)
    else next.add(k)
  }
  selected.value = next
}

/** 点行本身 = 展开 / 收起，顺带把谱面滚到这一行 */
function toggleExpand(row) {
  const next = new Set(collapsed.value)
  if (next.has(row.id)) next.delete(row.id)
  else next.add(row.id)
  collapsed.value = next
  locate(row)
}

function selectAll() {
  selected.value = allSelected.value ? new Set() : new Set(allKeys.value)
}

/**
 * 「展开 / 收起」那一颗：**判据是「有没有一行被折起来」**（不是「是不是全折了」）——
 * 只要还有折叠的就全展开，一行都没折时才全收起。不碰勾选，也不定位。
 */
function toggleAll() {
  collapsed.value = allOpen.value ? new Set(rows.value.map((r) => r.id)) : new Set()
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
 * 整批一个撤销点、一条 toast：行连带它的子标记（`removeSystem` 本来就级联清段落与反复），
 * 子项各删各的；全部走 `snapshot = false`，所以撤销栈里只会多出 `snapshotUndo()` 那一个点。
 */
function removeSelected() {
  const keys = selected.value
  if (!keys.size) return
  confirmOpen.value = false
  // **条数要在动手之前数好**：`rows` 是 meta 的 computed，删到一半它就重算了，
  // 删完再读只会得到 0。列表也在这里拍平成快照 —— 循环期间 meta 一直在变。
  const n = deleteCount.value
  const list = rows.value
  snapshotUndo()
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
 * 面板每次打开都从干净状态开始：没有勾选、也没有折叠（关掉再开不该留着上次的勾）。
 * 关掉时顺带把删除确认也收掉 —— 留着的话下次打开会先弹一个确认框。
 */
watch(
  () => props.open,
  (open) => {
    if (!open) {
      confirmOpen.value = false
      return
    }
    selected.value = new Set()
    collapsed.value = new Set()
  }
)

/**
 * 抽屉自己的关闭动作：**确认框开着的时候不关抽屉**。
 * `AppSheet` 的 Esc 是挂在 window 上的（面板与确认框各挂一个），两个都开着时按一下 Esc
 * 会同时命中它们 —— 那不是「先关最靠前的那一层」。这样拦一下才是逐层关。
 */
function closePanel() {
  if (confirmOpen.value) return
  emit('close')
}
</script>

<template>
  <!-- 头部用 `AppSheet` 默认那一个（标题 + 右侧关闭键）：与其它面板**长得一模一样**，
       所以这里不传 header 插槽 —— 工具名不再缀在标题上（用户要求）。 -->
  <AppSheet
    :open="open"
    :title="t('marks.title')"
    position="bottom"
    follow-layout
    panel-key="marks"
    @close="closePanel"
  >
    <!-- 多选那一行：与乐谱库的多选顶栏**同一套写法**（`.lib-bar.select` 的纯文本按钮，图标 + 文字、
         各占等分、删除用危险色），只是这里只有三颗 —— 列表没有「导出」，**也没有「完成」**
         （用户要求去掉：关面板有头部那颗 ×、点遮罩、Esc 三条路，再来一颗「完成」是同一个动作的第四个入口）。
         那颗「全选 / 清空」管所有行与子项，**一行一个动作按钮**的规矩它不吃（这是列表的顶栏，不是抽屉里的动作区）。 -->
    <div class="bar">
          <!-- 一键全展开 / 全收起：**判据是「有没有一行被折起来」**（只折了一行时按下去也是「展开」）。
           标签与图标跟着状态换，与旁边那颗「全选 ↔ 清空」同一个规矩；空列表时没东西可展，禁用。 -->
      <button type="button" class="btn sm text strong" :disabled="!rows.length" @click="toggleAll">
        <AppIcon :name="allOpen ? 'collapseAll' : 'expandAll'" :size="18" />
        {{ allOpen ? t('common.collapse') : t('common.expand') }}
      </button>
      <button type="button" class="btn sm text strong" @click="selectAll">
        <AppIcon :name="allSelected ? 'close' : 'selectAll'" :size="18" />
        {{ allSelected ? t('common.clear') : t('common.selectAll') }}
      </button>
      <!-- 点它只是**打开确认**，不直接删（下面那个 center 的 AppSheet 才是真删） -->
      <button type="button" class="btn sm text danger" :disabled="!selectedCount" @click="confirmOpen = true">
        <AppIcon name="trash" :size="18" /> {{ t('common.delete') }}
      </button>
    </div>

    <div v-if="!rows.length" class="empty small">
      <AppIcon name="row" :size="30" />
      <p>{{ t('marks.empty') }}</p>
    </div>

    <ul v-else class="marks-list scroll-y">
      <li v-for="row in rows" :key="row.id">
        <!-- 行做父节点：整块可点 = 展开 / 收起（顺带把谱面滚到这一行）；
             勾选圈**在右边**（与乐谱库多选时「⋯」变圈的位置一致），自己管选中 -->
        <button type="button" class="tree-node" @click="toggleExpand(row)">
          <AppIcon class="twisty" :class="{ open: isOpen(row) }" name="chevronRight" :size="16" />
          <span class="texts">
            <span class="line">{{ t('marks.pageAt', { n: row.page + 1 }) }}{{ t('marks.rowAt', { n: row.index }) }}</span>
            <span class="desc">
              {{ t('marks.summary', { measures: row.summary.measures, segments: row.summary.segments, repeats: row.summary.repeats }) }}
            </span>
          </span>
          <span class="check" :class="{ on: isSelected(row.id) }" @click="toggleRow(row, $event)">
            <AppIcon v-if="isSelected(row.id)" name="check" :size="14" />
          </span>
        </button>

        <ul v-if="isOpen(row)" class="tree-children">
          <!-- 子项**就一行字**：小节线 = 「第 5 小节」（它起头的那一小节）、段落 = 名字（没名字写速度）、
               反复 = 类型（反复开始 / 反复结束 / 房子 1） -->
          <li v-for="c in row.children" :key="c.id">
            <button type="button" class="tree-node child-node" @click="locate(c)">
              <span class="line">{{ c.line }}</span>
              <span class="check" :class="{ on: isSelected(c.id) }" @click="toggleKey(c.id, $event)">
                <AppIcon v-if="isSelected(c.id)" name="check" :size="14" />
              </span>
            </button>
          </li>
        </ul>
      </li>
    </ul>
  </AppSheet>

  <!-- 删除确认：居中的模态卡片（**不传 `follow-layout`**，所以它不参与抽屉宿主、不会被侧栏收走，
       与「删除乐谱」那个确认是同一个形态）。删除不可恢复，所以确认按钮走危险色；
       条数是**真正会被删掉的那几项**（勾了整行时子标记不重复计）。 -->
  <AppSheet :open="confirmOpen" :title="t('marks.delete.title')" position="center" @close="confirmOpen = false">
    <p>{{ t('marks.delete.confirm', { n: deleteCount }) }}</p>
    <template #footer>
      <button type="button" class="btn ghost" @click="confirmOpen = false">{{ t('common.cancel') }}</button>
      <button type="button" class="btn danger" @click="removeSelected">{{ t('common.delete') }}</button>
    </template>
  </AppSheet>
</template>

<style scoped>
/* 多选那一行：三颗纯文本按钮平分整行（乐谱库多选顶栏是四颗，这里没有「导出」与「完成」：
   全选·清空 / 展开·收起 / 删除）。`min-width: 0` 是必须的 —— 抽屉在竖屏是整幅宽、窄屏上每颗只有
   一百多像素，不放开最小宽度的话文字会顶出去。高度与下面每一行一样的 46 —— 顶栏不跳。 */
.bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}
.bar .btn {
  flex: 1;
  min-width: 0;
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
/* 父节点（行）比子节点重一档：它是这一组的标题 */
.marks-list > li > .tree-node {
  background: var(--surface-control);
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
/* 桌面端悬停、以及按下态。
   **父节点（行）那一档必须显式再写一遍**：它的常态底色来自 `.marks-list > li > .tree-node`（(0,3,0)），
   比 `.tree-node:hover` / `:active`（(0,2,0)）重 —— 不写的话「行」那一排**永远不会变底**
   （用户报的「行的 hover 缺失」就是这么来的），而子节点看着正常，因为它们的常态底色是 `none`。
   子节点照旧走通用那两条；`(0,2,0)` 盖 `(0,3,0)` 做不到，只能把重的那个选择器再写一遍（乐谱库也是这样）。 */
@media (hover: hover) {
  .tree-node:hover {
    background: var(--surface-hover);
  }
  .marks-list > li > .tree-node:hover {
    background: var(--surface-hover);
  }
}
.tree-node:active {
  background: var(--surface-active);
}
.marks-list > li > .tree-node:active {
  background: var(--surface-active);
}
</style>
