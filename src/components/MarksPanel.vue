<script setup>
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

const FILTER_KEYS = { row: 'row', barline: 'bar', segment: 'segment', repeat: 'repeat' }

const ALL_FILTER = 'all'

const selected = ref(new Set())
const expanded = ref(new Set())
const filters = reactive({ row: true, bar: true, segment: true, repeat: true })
let focusTick = 0

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

function shownChildren(row) {
  return row.children.filter((c) => filters[c.kind])
}

function childLine(row, c) {
  if (filters.row) return c.line
  const at = t('marks.pageAt', { n: row.page + 1 }) + t('marks.rowAt', { n: row.index })
  return t('marks.flatAt', { at, line: c.line })
}

const visibleKeys = computed(() =>
  filters.row
    ? rows.value.flatMap((r) => [r.id, ...shownChildren(r).map((c) => c.id)])
    : rows.value.flatMap((r) => shownChildren(r).map((c) => c.id))
)
const allSelected = computed(
  () => visibleKeys.value.length > 0 && visibleKeys.value.every((k) => selected.value.has(k))
)
const selectedCount = computed(() => selected.value.size)

const allOpen = computed(() => rows.value.every((r) => expanded.value.has(r.id)))

function isOpen(row) {
  return expanded.value.has(row.id)
}

function isSelected(key) {
  return selected.value.has(key)
}

function toggleKey(key, e) {
  e?.stopPropagation()
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

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

function toggleAll() {
  expanded.value = allOpen.value ? new Set() : new Set(rows.value.map((r) => r.id))
}

const filterMenu = ref(false)
const filterAnchor = ref(null)
const filtered = computed(() => !Object.values(filters).every(Boolean))

const filterItems = computed(() => [
  ...EDIT_TOOLS.map((tool) => {
    const key = FILTER_KEYS[tool.key]
    return { key, label: t(tool.labelKey), icon: tool.icon, checked: filters[key] }
  }),
  { key: ALL_FILTER, label: t('marks.filter.all'), icon: CircleDashedCheck, checked: !filtered.value, divider: true },
])

function openFilterMenu(e) {
  const r = e.currentTarget.getBoundingClientRect()
  filterAnchor.value = { left: r.left, bottom: r.bottom + 4 }
  filterMenu.value = true
}

function toggleFilter(key) {
  if (key === ALL_FILTER) {
    const on = !filtered.value
    Object.assign(filters, { row: !on, bar: !on, segment: !on, repeat: !on })
  } else {
    filters[key] = !filters[key]
  }
  const keep = new Set(visibleKeys.value)
  selected.value = new Set([...selected.value].filter((k) => keep.has(k)))
}

function locate(item) {
  const y0 = Number(item.y0)
  const y1 = Number(item.y1)
  if (!Number.isFinite(item.page) || !Number.isFinite(y0) || !Number.isFinite(y1)) return
  emit('locate', { key: item.id, page: item.page, y0: Math.min(y0, y1), y1: Math.max(y0, y1), tick: ++focusTick })
}

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

const confirmOpen = ref(false)

function removeSelected() {
  const keys = selected.value
  if (!keys.size) return
  confirmOpen.value = false
  const n = deleteCount.value
  const list = rows.value
  for (const row of list) {
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

function closePanel() {
  if (confirmOpen.value || filterMenu.value) return
  emit('close')
}
</script>

<template>
  <AppSheet
    :open="open"
    :title="t('marks.title')"
    :icon="ListTree"
    position="bottom"
    follow-layout
    panel-key="marks"
    @close="closePanel"
  >
    <div class="fill">
      <div class="bar">
        <button type="button" class="btn sm text strong" :disabled="!rows.length || !filters.row" @click="toggleAll">
          <component :is="allOpen ? ChevronsDownUp : ChevronsUpDown" :size="18" />
          {{ allOpen ? t('common.collapse') : t('common.expand') }}
        </button>
        <button type="button" class="btn sm text strong" @click="selectAll">
          <CircleDashedCheck :size="18" />
          {{ allSelected ? t('common.clear') : t('common.selectAll') }}
        </button>
        <button type="button" class="btn sm text strong" @click="openFilterMenu">
          <Funnel :size="18" /> {{ t('marks.filter.label') }}
        </button>
        <button type="button" class="btn sm text danger" :disabled="!selectedCount" @click="confirmOpen = true">
          <Trash :size="18" /> {{ t('common.delete') }}
        </button>
      </div>

      <div v-if="!rows.length" class="empty small">
        <RectangleHorizontal :size="30" />
        <p>{{ t('marks.empty') }}</p>
      </div>

      <div v-else-if="!visibleKeys.length" class="empty small">
        <Funnel :size="30" />
        <p>{{ t('marks.filter.empty') }}</p>
      </div>

      <ul v-else class="marks-list scroll-y">
        <li v-for="row in rows" :key="row.id">
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

  <ContextMenu
    :open="filterMenu"
    :items="filterItems"
    :anchor="filterAnchor"
    :title="t('marks.filter.title')"
    stay-open
    @select="toggleFilter"
    @close="filterMenu = false"
  />

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
.fill {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
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
.tree-children .tree-node {
  padding-left: 58px;
}
.tree-children.flat > li > .tree-node {
  padding-left: 8px;
}
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
@media (hover: hover) {
  .tree-node:hover {
    background: var(--surface-hover);
  }
}
.tree-node:active {
  background: var(--surface-active);
}
</style>
