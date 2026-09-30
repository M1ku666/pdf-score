<script setup>
/**
 * 跳转记号的 Sheet：**一条记号一张** —— **点谱面上那条箭头**才打开它（`player.jumpSheetId`）；
 * **点小节线只新建、不再打开任何 Sheet**（用户要求）。谱面上没有第二个编辑入口。
 *
 *  · **正文只有一样东西：「跳转顺序」列表** —— 这条记号**所在的那一组**，按先后排
 *    （`jumpChain`：最上游的前置 → … → 当前这条 → 后续 → …）。行的长相照「排序方式」那张短菜单
 *    （`.ctx-item`：46px 高、悬停灰底）；**「当前」= 这张 Sheet 说的那一条，它那一整行铺一层
 *    主题色浅底（`--accent-weak`）**，右端再写两个字「当前」（不写勾）—— 光靠两个字认不出是哪一行。
 *    一行三块：**点左块** = 把这张 Sheet 换成那一条记号；右端**两颗圆钮**，长相都是全站那颗
 *    `.icon-btn`（46px 圆底、悬停 / 按下归它管）—— **× =「移出组」**（`removeJumpMember`：
 *    它自己留着、后续接上去）、**把手**（`GripVertical`）= **拖动排序**（`moveJumpInGroup`）。
 *    **组里只有它自己**时整个列表换成**空态**：`CircleSlash` +「还没有小组成员」，在正文里居中。
 *  · **设置全在 footer**（用户要求：正文不留设置）：**起点 / 终点两个数字框**
 *    （改的是这条记号的落点 —— 号是现推的，写回的是「第 N 小节起头的那条线」再按落线规则挪，
 *    见 `setJumpMeasure`）、**添加小组成员**、**删除跳转**。
 *  · **「添加小组成员」按下之后抽屉降到只剩标题**（`AppSheet` 的 `collapsed`）、标题换成同一句话，
 *    等用户去谱面上点一个箭头：那个记号**接在组末尾**（`addJumpMember`），Sheet 自己展开回正常态；
 *    **点 × 或谱面上任何非箭头的地方 = 取消**，同样展开回正常态。
 *  · **「删除跳转」只删它自己，后面的成员接上去**（`removeJump`，用户要求）；这条记号没了时
 *    store 那边会自己把 Sheet 收掉，走顶部那条「删除 xN / 撤销」通知。
 *
 * **拖动排序（用户要求）**：按住把手起拖 ——
 *  · **原位置那一行盖一层遮罩**（`.masked` 的 `::after` 用 `--scrim`）当作**占位格**，
 *    它自己按 `transform` **带着过渡滑到将要落到的位置**（落点 = 指针越过谁的中线就插到谁那儿）；
 *  · 同时**复制一份跟着指针**（`.order-ghost`，`position: fixed`、**x 与原行相同**、
 *    **y 恒为指针 + `GHOST_DY`**）—— 它只负责「手里拿着什么」，预览落点的是那个占位格；
 *  · **拖到列表上下边缘时列表自己滚**（`EDGE` / `SCROLL_STEP`，rAF 逐帧滚）；
 *  · 松手才真的落：`moveJumpInGroup(id, 落点)` 重写这一组的先后，DOM 顺序与 transform 同一帧换掉，
 *    所以不会有回弹的闪动。
 *  其余行按落点让位（各 `translateY` 一个槽高），同样带过渡。
 *  · 头部/底部结构全交给 `AppSheet`（`follow-layout` + `panel-key="jump"` → 底部抽屉）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { CircleSlash, GripVertical, MousePointerClick, Route, Trash, X } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import NumberPad from './NumberPad.vue'
import {
  cancelJumpPick,
  closeJumpSheet,
  jumpChain,
  moveJumpInGroup,
  openJumpSheet,
  player,
  removeJump,
  removeJumpMember,
  setJumpMeasure,
  startJumpPick,
  structure,
  timeline,
} from '../store/player.js'
import { t } from '../i18n/index.js'

/** 复制出来的那一份与指针的固定纵向偏移（px）—— 手指底下看不见，所以往下让这么多 */
const GHOST_DY = -30
/** 指针进到列表上下这几 px 之内就开始自动滚 */
const EDGE = 36
/** 自动滚每帧滚多少 px */
const SCROLL_STEP = 8

const open = computed(() => player.drawer === 'jump')
/** 这一张 Sheet 说的是哪一条记号（`resolveJumps` 的产物，带序号与现推的小节号） */
const jump = computed(() => timeline.value.jumps.find((j) => j.id === player.jumpSheetId) || null)
/** 正在等用户去谱面上点一个箭头（添加小组成员） */
const picking = computed(() => !!player.pickJumpId)
/** 整组：最上游的前置 → … → 当前 → 后续（`jumpChain` 是这一份次序的唯一来源） */
const chain = computed(() => (jump.value ? jumpChain(jump.value.id) : []))
/** 组里只有它自己 = 既没前置也没后续：列表换成空态 */
const empty = computed(() => chain.value.length <= 1)
/** 可填的小节号范围（与段落编辑器那个位置框同一档判据：真正有小节的范围） */
const maxMeasure = computed(() => Math.max(1, structure.value.count))

const title = computed(() => (picking.value ? t('jump.addMember') : t('jump.title')))

/** 端点取不到小节号时写 `common.noValue`（手改过的 json 可能把记号挂到不成小节的线上） */
const num = (v) => (Number.isFinite(v) ? v : t('common.noValue'))
/** 列表里那一项：就两个数字加一个箭头 */
const shortLabel = (j) => t('jump.short', { start: num(j.start), end: num(j.end) })

/** 点左块 = 换成那一条记号（当前那条自己也点，等于什么都不做） */
function openOther(id) {
  if (id !== jump.value?.id) openJumpSheet(id)
}

function onAddMember() {
  if (jump.value) startJumpPick()
}

function onDelete() {
  if (jump.value) removeJump(jump.value.id)
}

/**
 * 点右上角那颗 ×：**添加小组成员期间它是「取消选择」**（抽屉留着、展开回正常态，用户要求），
 * 平时才是关掉这张 Sheet。
 */
function onClose() {
  if (picking.value) {
    cancelJumpPick()
    return
  }
  closeJumpSheet()
}

/* ------------------------------- 拖动排序 ------------------------------- */

const listEl = ref(null)
/**
 * 拖动中的那一笔：`{ id, from, to, h, slots, left, width, y, label, current, pointerY }`
 *  · `from` / `to` = 原来第几格、将要落到第几格（都在**最终顺序**里数）；
 *  · `slots` = 起拖那一刻量下的每一格的 `offsetTop` / 高（**不受 transform 影响**，
 *    所以拖动期间算落点一直拿它 + 列表的 `scrollTop` 换算，滚动了也准）；
 *  · `left` / `width` / `label` / `current` 是复制那一份要用的。
 */
const drag = ref(null)
let raf = 0

function rowsOf() {
  return listEl.value ? [...listEl.value.querySelectorAll('.order-row')] : []
}

/** 每一行当前的位移：占位格滑到落点、其余按落点让位（`translateY` 一个槽高） */
function rowStyle(id, i) {
  const d = drag.value
  if (!d) return null
  if (id === d.id) return { transform: `translateY(${(d.to - d.from) * d.h}px)` }
  if (d.from < d.to && i > d.from && i <= d.to) return { transform: `translateY(${-d.h}px)` }
  if (d.from > d.to && i >= d.to && i < d.from) return { transform: `translateY(${d.h}px)` }
  return null
}

/** 复制那一份的位置：**x 与原行相同、y 恒为指针 + `GHOST_DY`**（用户要求） */
const ghostStyle = computed(() => {
  const d = drag.value
  if (!d) return null
  return { left: d.left + 'px', top: d.y + 'px', width: d.width + 'px' }
})

/** 落点 = 指针越过谁的中线就插到谁那儿（用起拖时量的格子算，与 transform 无关） */
function updateTarget() {
  const d = drag.value
  const list = listEl.value
  if (!d || !list) return
  const base = list.getBoundingClientRect().top - list.scrollTop
  let k = d.slots.length
  for (let i = 0; i < d.slots.length; i++) {
    const s = d.slots[i]
    if (d.pointerY < base + s.top + s.h / 2) {
      k = i
      break
    }
  }
  // k 是「插到原来第几格之前」；把被拖走的那一格让出来的位置算掉，才是最终顺序里的序号
  d.to = Math.max(0, Math.min(d.slots.length - 1, k > d.from ? k - 1 : k))
}

/** 拖到列表上下边缘就自己滚（滚了要重算落点） */
function autoScroll() {
  raf = 0
  const d = drag.value
  const list = listEl.value
  if (!d || !list) return
  const r = list.getBoundingClientRect()
  const dy = d.pointerY < r.top + EDGE ? -SCROLL_STEP : d.pointerY > r.bottom - EDGE ? SCROLL_STEP : 0
  if (!dy) return
  const before = list.scrollTop
  list.scrollTop = before + dy
  if (list.scrollTop !== before) updateTarget()
  raf = requestAnimationFrame(autoScroll)
}

function onDragMove(e) {
  const d = drag.value
  if (!d) return
  d.pointerY = e.clientY
  d.y = e.clientY + GHOST_DY
  updateTarget()
  if (!raf) raf = requestAnimationFrame(autoScroll)
}

function endDrag() {
  const d = drag.value
  drag.value = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  if (d && d.to !== d.from) moveJumpInGroup(d.id, d.to)
}

/**
 * 按住把手起拖：先量下每一格的几何（`offsetTop` / 高）、这一行的落点与宽，
 * 再把复制那一份摆到「指针 + `GHOST_DY`」上。指针捕获交给把手自己，`touch-action: none`
 * 让触屏也不去滚列表（与侧栏 / 总览那两根把手同一套）。
 */
function startDrag(e, j, index) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const row = e.currentTarget.closest('.order-row')
  if (!row || !listEl.value) return
  const rect = row.getBoundingClientRect()
  drag.value = {
    id: j.id,
    from: index,
    to: index,
    h: rect.height,
    slots: rowsOf().map((el) => ({ top: el.offsetTop - listEl.value.offsetTop, h: el.offsetHeight })),
    left: rect.left,
    width: rect.width,
    pointerY: e.clientY,
    y: e.clientY + GHOST_DY,
    label: shortLabel(j),
    current: j.id === jump.value?.id,
  }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId)
  } catch {}
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <AppSheet
    :open="open"
    :title="title"
    :icon="Route"
    position="bottom"
    follow-layout
    panel-key="jump"
    :collapsed="picking"
    @close="onClose"
  >
    <!-- `.fill` 是「正文里那一块占满、能居中也能自己滚」的来源（与 `MarksPanel` 同一套写法）：
         `AppSheet` 的 `.sheet-body` 是块级容器，不给高度的子元素既居中不了、也滚不动 -->
    <div class="fill">
      <template v-if="jump">
        <div v-if="empty" class="empty">
          <CircleSlash :size="30" />
          <p>{{ t('jump.noMember') }}</p>
        </div>

        <div v-else class="order">
          <label class="field-label">{{ t('jump.orderTitle') }}</label>
          <ul ref="listEl" class="order-list scroll-y" :class="{ dragging: !!drag }">
            <li
              v-for="(j, i) in chain"
              :key="j.id"
              class="order-row"
              :class="{ masked: drag && drag.id === j.id, current: j.id === jump.id }"
              :style="rowStyle(j.id, i)"
            >
              <button type="button" class="order-open" @click="openOther(j.id)">
                <span class="order-label">{{ shortLabel(j) }}</span>
                <span v-if="j.id === jump.id" class="now">{{ t('jump.current') }}</span>
              </button>
              <button
                type="button"
                class="icon-btn order-out"
                :aria-label="t('jump.removeMemberAria')"
                @click="removeJumpMember(j.id)"
              >
                <X :size="18" />
              </button>
              <button
                type="button"
                class="icon-btn order-grip"
                :aria-label="t('jump.gripAria')"
                @pointerdown="startDrag($event, j, i)"
              >
                <GripVertical :size="18" />
              </button>
            </li>
          </ul>
        </div>
      </template>
    </div>

    <!-- 设置全在 footer（用户要求：正文只留那个列表）。
         抽屉的 footer 是**纵向、一行一个**（`AppSheet`），所以两个数字框各占一行、
         两颗按钮各占一行。`v-if="jump"` 是兜底：这一条记号已经不在时连 footer 都不给。 -->
    <template v-if="jump" #footer>
      <div class="fld-row">
        <span class="fld-label">{{ t('jump.start') }}</span>
        <div class="fld">
          <NumberPad
            :model-value="jump.start"
            :min="1"
            :max="maxMeasure"
            :title="t('jump.start')"
            :unit="t('unit.measure')"
            class="wide"
            @update:model-value="(no) => setJumpMeasure(jump.id, 'start', no)"
          />
        </div>
      </div>
      <div class="fld-row">
        <span class="fld-label">{{ t('jump.end') }}</span>
        <div class="fld">
          <NumberPad
            :model-value="jump.end"
            :min="1"
            :max="maxMeasure"
            :title="t('jump.end')"
            :unit="t('unit.measure')"
            class="wide"
            @update:model-value="(no) => setJumpMeasure(jump.id, 'end', no)"
          />
        </div>
      </div>

      <button type="button" class="btn" @click="onAddMember">
        <MousePointerClick :size="18" /> {{ t('jump.addMember') }}
      </button>

      <button type="button" class="btn danger" @click="onDelete">
        <Trash :size="18" /> {{ t('jump.deleteJump') }}
      </button>
    </template>
  </AppSheet>

  <!-- 手里拿着的那一份：**投递到 body**（`position: fixed` 在抽屉那层 transform 里会变成相对它定位），
       只负责「正在搬哪一条」，落点预览交给列表里那个占位格 -->
  <Teleport to="body">
    <div v-if="drag" class="order-ghost" :style="ghostStyle">
      <span class="order-label">{{ drag.label }}</span>
      <span v-if="drag.current" class="now">{{ t('jump.current') }}</span>
    </div>
  </Teleport>
</template>

<style scoped>
.fill {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
/* 空态：正文里水平竖直居中（图标在上、那句话在下） */
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-muted);
  text-align: center;
}
.empty p {
  margin: 0;
}
/* 列表占满剩下的高度，自己滚（标题不跟着滚） */
.order {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.order-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* 一行 = 「排序方式」里那一项的长相（46px 高、透明底、悬停灰底），右边再挂两颗钮。
   项与项之间不留间隔（菜单里也是挨着的）—— 靠悬停底色区分是哪一行 */
.order-row {
  position: relative;
  display: flex;
  align-items: center;
  min-height: var(--tap-min);
  border-radius: var(--radius-sm);
}
/* 拖动中：位移都带过渡（「列表里元素的移动要过渡动画」） */
.order-list.dragging .order-row {
  transition: transform 0.18s var(--ease);
}
/* 拖动中的**占位格**：盖一层遮罩（全站那一档 `--scrim`），表示「这一格现在空着、等着落下来」 */
.order-row.masked::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--scrim);
  pointer-events: none;
}
/* 左块：整块可点 = 换成那一条记号（当前那条右端写「当前」） */
.order-open {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  min-height: var(--tap-min);
  padding: 0 12px;
  border-radius: var(--radius-sm);
  color: var(--text-strong);
  font-size: 15px;
  text-align: left;
}
/* 「移出组」：小字、次要色（它是行内的次要动作），自己占一块点击区 */
.order-out {
  flex: none;
  min-height: var(--tap-min);
  padding: 0 8px;
  color: var(--text-muted);
  font-size: 13px;
  white-space: nowrap;
}
/* 把手：拖动排序的抓取点（`touch-action: none` —— 触屏拖它时不许列表跟着滚，
   与侧栏 / 总览那两根把手同一套） */
.order-grip {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--tap-min);
  min-height: var(--tap-min);
  color: var(--text-muted);
  cursor: grab;
  touch-action: none;
}
@media (hover: hover) {
  .order-open:hover,
  .order-out:hover,
  .order-grip:hover {
    background: var(--surface-hover);
  }
}
.order-open:active,
.order-out:active,
.order-grip:active {
  background: var(--surface-active);
}
.order-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 「当前」= 那个位置上原本画勾的地方（勾只表示「选中」，这里要说明的是「就是这一条」） */
.now {
  flex: none;
  font-size: 13px;
  color: var(--accent);
}
/* footer 里的两个数字框：左边一栏标签、右边铺满剩下的宽度（与段落面板的位置那一栏同一套） */
.fld-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fld-label {
  flex: none;
  min-width: 2.5em;
  color: var(--text-muted);
  font-size: 13px;
}
.fld {
  flex: 1;
  min-width: 0;
}
/* 手里拿着的那一份：**投递到 body 的那个浮层**（`position: fixed` 在抽屉那层 transform 里
   会变成相对它定位，所以必须搬出去）。scoped 照样命中它 —— 它就在本组件的模板里，带着同一个
   数据属性（`ContextMenu` 的浮层也是这么办的）。
   长相 = 列表那一行 + 浮层该有的底与投影（透明底的行飘起来会看不见） */
.order-ghost {
  position: fixed;
  z-index: 80;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--tap-min);
  padding: 0 12px;
  border: 1px solid var(--stroke-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-float);
  box-shadow: var(--shadow-2);
  color: var(--text-strong);
  font-size: 15px;
  pointer-events: none;
}
</style>
