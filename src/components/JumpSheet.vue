<script setup>
/**
 * 跳转记号的 Sheet：**点一条已经有跳转记号的小节线就打开它**（`player.jumpSheetBarId` = 那条线）。
 *
 *  · 列表里是**起点或终点落在这条线上的那些记号**（`jumpsOnBar()`，与谱面上那条细竖线同一份判据），
 *    每项一行：序号 + 在这条线上是**起点还是终点** + 「第 a 小节 → 第 b 小节」，下面一行是
 *    **前置下拉**（`ContextMenu`，列「无」+ 其它跳转记号）与**删除**。
 *  · **footer 只有一颗按钮**，按「这一笔是第几次点」切换（用户明确要求）：
 *    没有待定的起点 = 「创建起点」（以这条线起一个待定起点）、有 = 「创建终点」
 *    （把待定的起点与这条线配成一条记号）—— 与在谱面上点两次是同一件事，只是从 Sheet 里完成，
 *    点完就收掉 Sheet（接着去谱面上点第二次）。
 *  · 删除走 `store/player.js` 的 `removeJump`：**依赖它的记号一起删**，删出来的每一条都进
 *    顶部那条「删除 xN / 撤销」通知；这条线上一条都不剩时它自己会把 Sheet 收掉。
 *  · 头部/底部结构全交给 `AppSheet`（`follow-layout` + `panel-key="jump"` → 底部抽屉）。
 */
import { computed, ref } from 'vue'
import { ChevronDown, Plus, Route, Trash } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import ContextMenu from './ContextMenu.vue'
import {
  closeJumpSheet,
  finishJump,
  jumpsOnBar,
  player,
  removeJump,
  setJumpPrereq,
  startJump,
  timeline,
} from '../store/player.js'
import { t } from '../i18n/index.js'

const open = computed(() => player.drawer === 'jump')
const barId = computed(() => player.jumpSheetBarId)
/** 起点或终点落在这条线上的记号（渲染用的那一份，带序号） */
const items = computed(() => jumpsOnBar(barId.value))
/** 这一笔是第几次点：没有待定的起点 = 第一次点 */
const pending = computed(() => !!player.pendingJumpBarId)
const createLabel = computed(() => (pending.value ? t('jump.createEnd') : t('jump.createStart')))

/** 这一项在这条线上是起点还是终点（一条有效记号的两端不会落在同一条线上，两者都列只是兜底） */
function roleOf(jump) {
  const roles = []
  if (jump.startBarId === barId.value) roles.push(t('jump.role.start'))
  if (jump.endBarId === barId.value) roles.push(t('jump.role.end'))
  return roles.join(' · ')
}

/**
 * 一条记号的「第 a 小节 → 第 b 小节」：两端的小节号是**现推的**（存的是小节线 id）。
 * 端点取不到小节号时（手改过 JSON 把记号挂到了不成小节的线上）写 `common.noValue`，
 * 免得那一行字缺一块。
 */
function itemLabel(jump) {
  const none = t('common.noValue')
  return t('jump.item', { start: jump.start ?? none, end: jump.end ?? none })
}

function create() {
  const id = barId.value
  if (!id) return
  if (pending.value) finishJump(id)
  else startJump(id)
  closeJumpSheet()
}

/* --------------------------- 前置：锚在这一行上的短菜单 --------------------------- */
const menuOpen = ref(false)
const menuAnchor = ref(null)
const menuFor = ref(null) // 正在改前置的那一条（null = 菜单没开）
/** 「无」+ **其它**跳转记号（自己不能当自己的前置；隔着几条绕回来的环由 store 那边拒绝） */
const menuItems = computed(() => [
  { key: '', label: t('jump.prereq.none'), checked: !menuFor.value?.prereq },
  ...timeline.value.jumps
    .filter((j) => j.id !== menuFor.value?.id)
    .map((j) => ({
      key: j.id,
      label: `${t('jump.seq', { n: j.seq })} ${itemLabel(j)}`,
      checked: menuFor.value?.prereq === j.id,
    })),
])

function openMenu(jump, e) {
  const r = e.currentTarget.getBoundingClientRect()
  menuAnchor.value = { left: r.left, bottom: r.bottom }
  menuFor.value = jump
  menuOpen.value = true
}

function pickPrereq(key) {
  if (menuFor.value) setJumpPrereq(menuFor.value.id, key || null)
}

/** 前置那一栏上显示什么：`#3` / 「无」 */
function prereqLabel(jump) {
  const p = jump.prereq ? timeline.value.jumps.find((j) => j.id === jump.prereq) : null
  return p ? t('jump.seq', { n: p.seq }) : t('jump.prereq.none')
}
</script>

<template>
  <AppSheet
    :open="open"
    :title="t('jump.title')"
    :icon="Route"
    position="bottom"
    follow-layout
    panel-key="jump"
    @close="closeJumpSheet"
  >
    <p v-if="!items.length" class="empty small">{{ t('jump.empty') }}</p>

    <ul v-else class="jump-list">
      <li v-for="j in items" :key="j.id" class="jump-item">
        <div class="head">
          <span class="seq mono">{{ t('jump.seq', { n: j.seq }) }}</span>
          <span class="role">{{ roleOf(j) }}</span>
          <span class="line">{{ itemLabel(j) }}</span>
        </div>
        <div class="row">
          <!-- 前置：锚在这一行上的短单选（与段落面板的「单位拍」、「排序方式」同一套 `ContextMenu`） -->
          <button type="button" class="btn prereq" @click="openMenu(j, $event)">
            <span class="prereq-label">{{ t('jump.prereq.label') }}</span>
            <span class="prereq-value">{{ prereqLabel(j) }}</span>
            <ChevronDown :size="16" />
          </button>
          <button type="button" class="icon-btn" :aria-label="t('common.delete')" @click="removeJump(j.id)">
            <Trash :size="18" />
          </button>
        </div>
      </li>
    </ul>

    <!-- footer：**只有一颗动作按钮**，按「第几次点」切换（见文件头注释）。
         实心底色 + 18px 图标（docs/ui.md §13 / §18.61 第 168 条） -->
    <template #footer>
      <button type="button" class="btn primary" @click="create">
        <Plus :size="18" /> {{ createLabel }}
      </button>
    </template>
  </AppSheet>

  <ContextMenu
    :open="menuOpen"
    :items="menuItems"
    :anchor="menuAnchor"
    :title="t('jump.prereq.menuTitle')"
    @select="pickPrereq"
    @close="menuOpen = false"
  />
</template>

<style scoped>
.jump-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* 一条记号一块：上面一行是「序号 + 角色 + 起点→终点」，下面一行是前置与删除 */
.jump-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--stroke-soft);
  border-radius: var(--radius);
  background: var(--surface-card);
}
.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
/* 序号与角色是**小字**（这两样只是标识，正文是那个「第 a 小节 → 第 b 小节」） */
.seq,
.role {
  flex: none;
  font-size: 12px;
  color: var(--text-muted);
}
.role {
  padding: 1px 6px;
  border: 1px solid var(--stroke-soft);
  border-radius: 999px;
}
.line {
  min-width: 0;
  color: var(--text-strong);
  font-weight: 600;
}
/* 前置那一栏铺满剩下的宽度（与右边的删除钮并排），内容靠左 —— 与 `.unit-btn` 同一套写法 */
.prereq {
  flex: 1;
  min-width: 0;
  justify-content: flex-start;
}
.prereq-label {
  color: var(--text-muted);
}
.prereq-value {
  font-weight: 600;
}
.empty {
  color: var(--text-muted);
}
</style>
