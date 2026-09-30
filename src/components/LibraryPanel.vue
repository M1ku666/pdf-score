<script setup>
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
  usage as storeUsage,
} from '../store/library.js'
import { requestPersistence } from '../db/idb.js'
import { errorToast } from '../store/toast.js'
import { settings } from '../store/settings.js'
import { t } from '../i18n/index.js'

const emit = defineEmits(['open-score', 'scores-removed'])
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

const FRESH_MS = 1500
const FRESH_FADE_MS = 500
const fresh = ref([])
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
onBeforeUnmount(() => {
  for (const timer of freshTimers.values()) clearTimeout(timer)
  freshTimers.clear()
})

watch(
  () => props.newIds,
  async (ids) => {
    if (!ids?.length) return
    markFresh(ids)
    await nextTick()
    const el = document.querySelector(`.lib-list .card[data-id="${ids[0]}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
)

const query = ref('')
const sort = ref('opened-desc')
const selectMode = ref(false)
const selected = ref(new Set())
const filterTags = ref(new Set())

const topMenuOpen = ref(false)
const topMenuAnchor = ref(null)
const sortOpen = ref(false)
const tagsOpen = ref(false)
const importInput = ref(null)

const storageOpen = ref(false)
const storageRatio = computed(() => {
  if (!sizesReady.value) return null
  const q = storeUsage.value?.quota
  if (!Number.isFinite(q) || q <= 0) return null
  return Math.min(1, Math.max(0, sizesTotal.value / q))
})

const SORTS = [
  { value: 'opened-desc', labelKey: 'library.sort.openedDesc', meta: 'opened' },
  { value: 'opened-asc', labelKey: 'library.sort.openedAsc', meta: 'opened' },
  { value: 'title-asc', labelKey: 'library.sort.titleAsc', meta: 'title' },
  { value: 'title-desc', labelKey: 'library.sort.titleDesc', meta: 'title' },
  { value: 'size-desc', labelKey: 'library.sort.sizeDesc', meta: 'size' },
  { value: 'size-asc', labelKey: 'library.sort.sizeAsc', meta: 'size' },
]

const sortMeta = computed(() => SORTS.find((s) => s.value === sort.value)?.meta || 'none')

const topMenuItems = computed(() => [
  { key: 'sort', label: t('library.menu.sort'), icon: ArrowUpDown },
  { key: 'tags', label: t('library.tags.title'), icon: Tags },
  { key: 'select', label: t('library.menu.select'), icon: CircleDashedCheck },
])

const CARD_ACTIONS = [
  { key: 'info', labelKey: 'common.info', icon: Info },
  { key: 'select', labelKey: 'common.select', icon: Check },
  { key: 'remove', labelKey: 'common.delete', icon: Trash, danger: true },
]
const cardActions = computed(() => CARD_ACTIONS.map((a) => ({ ...a, label: t(a.labelKey) })))

const tags = computed(() => collectTags(scores.value))
const UNTAGGED = '__untagged__'
const UNTAGGED_LABEL = computed(() => t('library.tags.untagged'))
const untaggedCount = computed(() => scores.value.filter((s) => !(s.meta?.tags || []).length).length)
const tagItems = computed(() => [
  ...(untaggedCount.value ? [{ key: UNTAGGED, label: UNTAGGED_LABEL.value, count: untaggedCount.value }] : []),
  ...tags.value.map((tag) => ({ key: tag.tag, label: tag.tag, count: tag.count })),
])
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
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  let list = scores.value.slice()
  if (terms.length) {
    list = list.filter((s) => {
      const ts = s.meta?.tags || []
      const hay = [s.title, ...ts, ...(ts.length ? [] : [UNTAGGED_LABEL.value])]
      return terms.some((term) => hay.some((v) => String(v ?? '').toLowerCase().includes(term)))
    })
  }
  list = list.filter((s) => {
    const ts = s.meta?.tags || []
    if (!ts.length) return filterTags.value.has(UNTAGGED)
    return ts.some((tag) => filterTags.value.has(tag))
  })
  const cmpHan = (a, b) => (a || '').localeCompare(b || '', 'zh-Hans-CN', { numeric: true })
  const cmpHanSize = (a, b, dir) => {
    const ba = bytesOf(sizeText(a))
    const bb = bytesOf(sizeText(b))
    if (ba === null || bb === null) return (ba !== null ? -1 : bb !== null ? 1 : 0) || cmpHan(a.title, b.title)
    return -dir * (ba - bb) || cmpHan(a.title, b.title)
  }
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

function sizeText(rec) {
  const bytes = sizes.value.get(rec.id)
  return Number.isFinite(bytes) ? formatBytes(bytes) : ''
}

function bytesOf(text) {
  const m = /^(\d+(?:\.\d+)?) (B|KB|MB|GB)$/.exec(text || '')
  if (!m) return null
  return Number(m[1]) * 1024 ** ['B', 'KB', 'MB', 'GB'].indexOf(m[2])
}

function cardMeta(rec) {
  if (sortMeta.value === 'opened') return formatDate(rec.openedAt)
  if (sortMeta.value === 'title') return (rec.meta?.tags || []).join(' · ')
  if (sortMeta.value === 'size') return sizeText(rec) || t('common.calculating')
  return ''
}

const allSelected = computed(() => filtered.value.length > 0 && filtered.value.every((s) => selected.value.has(s.id)))
const selectedCount = computed(() => selected.value.size)

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

const allTagsOn = computed(() => tagItems.value.length > 0 && tagItems.value.every((it) => filterTags.value.has(it.key)))
function toggleAllTags() {
  filterTags.value = allTagsOn.value ? new Set() : new Set(tagItems.value.map((it) => it.key))
}
const tagFiltered = computed(() => tagItems.value.length > 0 && !allTagsOn.value)

const menu = reactive({ open: false, rec: null, x: 0, y: 0, anchor: null })
const info = reactive({ open: false, rec: null, size: null, title: '', origTitle: '', tags: [], tagDraft: '' })
const confirmDelete = reactive({ open: false, ids: [] })
const coverInput = ref(null)

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

function openTopMenu(e) {
  const r = e.currentTarget.getBoundingClientRect()
  topMenuAnchor.value = { left: r.left, bottom: r.bottom }
  topMenuOpen.value = true
}

function onTopMenuPick(key) {
  if (key === 'sort') sortOpen.value = true
  else if (key === 'tags') tagsOpen.value = true
  else if (key === 'select') enterSelectMode(null)
}

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

const audioDuration = computed(() => {
  const d = info.rec?.meta?.audio?.duration
  if (!d) return t('common.noAudio')
  return `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}`
})

async function commitTitle() {
  const rec = info.rec
  if (!rec) return
  const title = info.title.trim()
  if (!title) {
    info.title = info.origTitle
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
async function doExport() {
  const ids = selectedCount.value ? [...selected.value] : filtered.value.map((s) => s.id)
  if (!ids.length) return
  try {
    await exportScores(ids)
  } catch (err) {
    errorToast(err?.message || t('library.exportFailed'))
  }
}

async function doExportAll() {
  const ids = scores.value.map((s) => s.id)
  if (!ids.length) return
  try {
    await exportScores(ids)
  } catch (err) {
    errorToast(err?.message || t('library.exportFailed'))
  }
}

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
  if (ok) emit('scores-removed', ids)
}

onMounted(async () => {
  await refresh()
  requestPersistence().catch(() => {})
})
</script>

<template>
  <div class="library">
    <header class="lib-head">
      <LayoutGrid :size="20" />
      <h2>{{ t('view.library.title') }}</h2>
      <StorageMeter
        :ratio="storageRatio"
        :class="{ 'no-labels': !settings.showButtonLabels }"
        @open="storageOpen = true"
      />
    </header>

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
        <div class="search-bar lib-search">
          <Search :size="17" />
          <input v-model="query" class="search-input" type="search" :placeholder="t('library.search.placeholder')" />
          <button v-if="query" type="button" class="icon-btn flat" :aria-label="t('library.search.clear')" @click="query = ''">
            <X :size="15" />
          </button>
        </div>
        <button type="button" class="icon-btn flat" :aria-label="t('library.menu.title')" @click="openTopMenu">
          <Menu :size="20" />
        </button>
      </template>
    </header>

    <p v-if="!selectMode && tagFiltered" class="lib-filter-hint muted small">{{ t('library.tags.filtered') }}</p>

    <div v-if="loading" class="empty muted small">{{ t('library.list.loading') }}</div>

    <div v-else-if="!filtered.length" class="empty small">
      <LayoutGrid :size="30" />
      <p v-if="scores.length">{{ t('library.list.emptyFiltered') }}</p>
      <p v-else>{{ t('library.list.emptyNone') }}</p>
    </div>

    <div v-else class="lib-list scroll-y">
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
            'fresh-out': freshOut.includes(rec.id) && !isSelected(rec.id),
          }"
          @click="onCardClick(rec)"
        >
          <div class="thumb">
            <img v-if="rec.thumb" :src="rec.thumb" :class="{ custom: rec.coverCustom }" alt="" loading="lazy" />
            <div v-else class="thumb-empty"><component :is="rec.hasPdf ? File : Music" :size="22" /></div>
          </div>
          <div class="card-text" :class="{ solo: !cardMeta(rec) }">
            <h3>{{ rec.title }}</h3>
            <p v-if="cardMeta(rec)" class="card-meta">{{ cardMeta(rec) }}</p>
          </div>
          <span v-if="selectMode" class="check" :class="{ on: isSelected(rec.id) }">
            <Check v-if="isSelected(rec.id)" :size="14" />
          </span>
          <button v-else type="button" class="icon-btn flat" :aria-label="t('library.card.more')" @click.stop="onCardMore(rec, $event)">
            <EllipsisVertical :size="20" />
          </button>
        </article>
      </template>
    </div>

    <footer v-if="!selectMode" class="lib-foot">
      <button type="button" class="btn primary" @click="importInput.click()">
        <SquareArrowRightEnter :size="18" /> {{ t('library.import') }}
      </button>
    </footer>

    <input ref="importInput" type="file" multiple accept=".zip,.psz,application/zip,application/pdf,audio/*,.json" class="hidden" @change="onImportPicked" />

    <ContextMenu
      :open="topMenuOpen"
      :items="topMenuItems"
      :anchor="topMenuAnchor"
      @select="onTopMenuPick"
      @close="topMenuOpen = false"
    />

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
          <button type="button" class="btn ghost cover-pick" @click="coverInput.click()">
            <span class="cover-thumb">
              <img v-if="info.rec?.thumb" :src="info.rec.thumb" :class="{ custom: info.rec?.coverCustom }" alt="" />
              <Image v-else :size="22" />
            </span>
            <span class="cover-hint">{{ t('library.info.coverHint') }}</span>
          </button>
        </div>
        <div class="facts">
          <div class="fact"><span class="k">{{ t('library.info.pages') }}</span><span class="v mono">{{ info.rec?.pageCount || 0 }} {{ t('unit.page') }}</span></div>
          <div class="fact"><span class="k">{{ t('library.info.measures') }}</span><span class="v mono">{{ info.rec?.measureCount || 0 }} {{ t('unit.measure') }}</span></div>
          <div class="fact"><span class="k">{{ t('library.info.duration') }}</span><span class="v mono">{{ audioDuration }}</span></div>
          <div class="fact"><span class="k">{{ t('library.info.size') }}</span><span class="v mono">{{ info.size === null ? t('common.calculating') : formatBytes(info.size) }}</span></div>
          <div class="fact"><span class="k">{{ t('library.info.openedAt') }}</span><span class="v small">{{ formatDate(info.rec?.openedAt) }}</span></div>
        </div>
      </div>

      <template v-if="info.rec?.coverCustom" #footer>
        <button type="button" class="btn" @click="resetCover">
          <RotateCcw :size="18" /> {{ t('library.info.coverReset') }}
        </button>
      </template>
    </AppSheet>

    <StorageSheet
      :open="storageOpen"
      :used-bytes="sizesReady ? sizesTotal : null"
      :quota-bytes="storeUsage?.quota ?? null"
      :has-scores="scores.length > 0"
      :export-all="doExportAll"
      @close="storageOpen = false"
    />

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

.empty {
  flex: 1;
}

.lib-foot {
  display: flex;
  flex: none;
  padding: 12px 8px calc(12px + var(--safe-b));
  border-top: 1px solid var(--stroke-soft);
}
.lib-foot .btn { flex: 1; }

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

.lib-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  flex: none;
}
.lib-bar.select {
  gap: 6px;
}
.lib-bar.select .btn {
  flex: 1 1 0;
  min-width: 0;
  min-height: var(--tap);
  padding: 0 4px;
  gap: 4px;
  overflow: hidden;
}
.lib-search {
  flex: 1;
  min-width: 0;
}

.lib-filter-hint {
  flex: none;
  margin: 0;
  padding: 0 10px 8px;
}

.lib-list {
  flex: 1;
  min-height: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-content: start;
}
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
  transition: transform 0.08s ease;
}
.card:active:not(:has(.icon-btn:active)) {
  transform: scale(0.98);
  background: var(--surface-active);
}
.card.on {
  background: var(--accent-weak);
}
.card.fresh,
.card.fresh-out {
  transition: transform 0.08s ease, background-color 0.5s ease;
}
.card.fresh {
  background: var(--accent-weak);
}
.card.current {
  background: var(--surface-control);
}
.card.current h3 {
  color: var(--accent);
}
.card.on.current {
  background: var(--accent-weak);
}
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
  filter: var(--pdf-invert, none);
}
.thumb img.custom {
  filter: none;
}
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
.card-meta {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.3;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn.cover-pick {
  width: 100%;
  min-height: 0;
  padding: 10px 12px;
  gap: 12px;
  justify-content: flex-start;
  text-align: left;
}
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
.tag-list {
  margin: 8px 0 0;
}
.tag-sheet {
  margin: 12px 0 0;
}
.tag-count {
  font-size: 11px;
  opacity: 0.7;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.facts {
  display: flex;
  flex-direction: column;
}
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
