<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, ChevronLeft, File, SquareArrowRightEnter, FileMusic, Image, LayoutGrid, RotateCcw, Settings, TriangleAlert, X } from '@lucide/vue'
import AppSheet from '../components/AppSheet.vue'
import GotoDialog from '../components/GotoDialog.vue'
import LibraryPanel from '../components/LibraryPanel.vue'
import LibrarySettings from '../components/LibrarySettings.vue'
import PdfViewer from '../components/PdfViewer.vue'
import PlayerToolbar from '../components/PlayerToolbar.vue'
import ProgressLine from '../components/ProgressLine.vue'
import SegmentEditor from '../components/SegmentEditor.vue'
import {
  applyMetaJson,
  clearSelection,
  close,
  closeDeleted,
  importAudio,
  importPdf,
  metaSummary,
  open,
  player,
  readMetaJson,
  save,
  SCORE_NOT_FOUND,
  scoreTitle,
  togglePlay,
} from '../store/player.js'
import { classifyFiles, imageToCover, importFiles, setScoreCover } from '../store/library.js'
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
const marksOpen = ref(false)
const markFocus = ref(null)
const newIds = ref([])
const settingsOpen = ref(false)
const pdfInput = ref(null)
const sideDragging = ref(false)
const isLandscape = ref(false)
const sideWidth = ref(settings.sideWidth || SIDE_DEFAULT)

const drawerWidth = computed(() => (libraryOpen.value ? sideWidth.value : SIDE_MIN))

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

const topHidden = computed(() => settings.hideTopBar && player.playing && !player.editMode)

watch(
  topHidden,
  (hidden) => {
    setHintsHidden(hidden)
    if (hidden) collapseLibrary()
  },
  { immediate: true },
)

let mq = null

function syncOrientation() {
  const w = window.innerWidth
  const h = window.innerHeight
  isLandscape.value = (w > h && w >= 700) || w > SHEET_MAX_W
}

function applySideWidth(v) {
  sideWidth.value = Math.max(SIDE_MIN, Math.min(SIDE_MAX, v))
  settings.sideWidth = sideWidth.value
}

function expandLibrary() {
  if (sideWidth.value < SIDE_MIN) sideWidth.value = SIDE_DEFAULT
  toLibrary()
}

function defaultLibrary() {
  if (!hasScore.value) expandLibrary()
}

let backConfirm = null
let backSelection = null
let backEdit = null

function swallowEditBack() {
  backEdit = pushBackLayer(swallowEditBack, 'edit')
}

watch(hasScore, (yes, was) => {
  if (was && !yes) defaultLibrary()
})

function startResize(e, baseW = libraryOpen.value ? sideWidth.value : 0) {
  e.preventDefault()
  sideDragging.value = true
  const startX = e.clientX
  const startW = baseW
  let moved = false
  let anchorX = startX

  const move = (ev) => {
    if (Math.abs(ev.clientX - startX) > 4) moved = true
    const w = startW + (ev.clientX - startX)

    if (w >= SIDE_MIN) {
      sideDragging.value = true
      anchorX = ev.clientX
      if (!libraryOpen.value) expandSideBar()
      applySideWidth(w)
      return
    }

    if (Math.abs(ev.clientX - anchorX) < 3) return
    const dir = ev.clientX > anchorX ? 1 : -1
    anchorX = ev.clientX
    sideDragging.value = false
    if (dir > 0) expandSideBar()
    else collapseLibrary()
  }

  const cleanup = () => {
    sideDragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', cleanup)
    window.removeEventListener('pointercancel', cleanup)
    if (!moved && !libraryOpen.value) expandSideBar()
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', cleanup)
  window.addEventListener('pointercancel', cleanup)
}

function openScore(id) {
  if (id === player.id) return
  collapseLibrary()
  router.push(`/${id}`)
}

async function onScoresRemoved(ids) {
  if (!player.id || !ids?.includes(player.id)) return
  await nextTick()
  await closeDeleted()
  await router.replace('/')
  realignSentinelBase()
}

function toggleMarks(open) {
  marksOpen.value = open
  if (!open) markFocus.value = null
}

watch(
  () => player.editMode,
  (on) => {
    if (!on) toggleMarks(false)
  }
)

function locateMark(target) {
  markFocus.value = target
  viewer.value?.scrollToMark?.(target.page, target.y0, target.y1)
}

const dropActive = ref(false)
const offsetRequest = ref(0)
const infoRequest = ref(null)
let infoTick = 0
const confirmBox = reactive({ open: false, title: '', icon: Check, confirmLabel: t('common.confirm'), danger: false, rows: [], cover: null, run: null })

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

watch(
  () => (hasScore.value ? t('store.pageTitle', { title: scoreTitle.value }) : ''),
  (title) => {
    document.title = title || t('app.title')
  },
  { immediate: true }
)

let dragDepth = 0

function openGallery(rec) {
  expandLibrary()
  newIds.value = rec?.id ? [rec.id] : []
}

async function requestScoreInfo(id) {
  if (!id) return
  expandLibrary()
  await nextTick()
  infoRequest.value = { id, tick: ++infoTick }
}

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

function configSummary(meta) {
  return t('view.confirm.configSummary', metaSummary(meta))
}

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
  await handleDrop(e.dataTransfer.files)
}

async function handleDrop(fileList) {
  const files = Array.from(fileList || [])
  if (!files.length) return
  const { archives, pdfs, audios, jsons, images, unknown } = classifyFiles(files)
  const target = player.id

  if (!target) {
    const usable = [...archives, ...pdfs, ...audios, ...jsons]
    if (usable.length) {
      try {
        await importFiles(usable, { bindNew: openGallery })
      } catch (err) {
        errorToast(t('view.errors.importFailed', { msg: errText(err) }))
      }
    } else if (images.length) {
      dangerToast(t('view.toast.imageNeedsScore'), 4200)
    }
    if (unknown.length) dangerToast(t('view.toast.unsupportedFile', { name: unknown[0].name }), 3600)
    return
  }

  const fresh = [...archives, ...pdfs]
  if (fresh.length) {
    try {
      await importFiles(fresh, { bindNew: openGallery })
    } catch (err) {
      errorToast(t('view.errors.importFailed', { msg: errText(err) }))
    }
  }

  if (audios.length > 1) toast(t('view.toast.onlyOneAudio'), 3200)
  if (jsons.length > 1) toast(t('view.toast.onlyOneJson'), 3200)
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

  if (jsons[0]) {
    const file = jsons[0]
    let next = null
    try {
      next = await readMetaJson(file)
    } catch (err) {
      errorToast(t('view.errors.jsonFailed', { msg: errText(err) }))
    }
    if (next) {
      askConfirm({
        title: t('view.confirm.replaceMetaTitle'),
        rows: [
          { k: t('view.confirm.currentMeta'), v: configSummary(player.meta) },
          { k: t('view.confirm.nextMeta'), v: file.name, sub: configSummary(next) },
        ],
        icon: RotateCcw,
        confirmLabel: t('common.replace'),
        danger: false,
        run: async () => {
          try {
            await applyMetaJson(file, next)
            player.editMode = true
            requestScoreInfo(player.id)
          } catch (err) {
            errorToast(t('view.errors.jsonFailed', { msg: errText(err) }))
          }
        },
      })
    }
  }

  if (images[0]) {
    const file = images[0]
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
          requestScoreInfo(player.id)
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
    offsetRequest.value++
  } catch (err) {
    errorToast(t('view.errors.audioFailed', { msg: errText(err) }))
  }
}

async function load() {
  const id = route.params.id
  if (!id) {
    if (player.id) {
      await save()
      await close()
    }
    defaultLibrary()
    return
  }
  const failed = await open(id)
  if (player.error) errorToast(t('view.errors.openFailed', { msg: errText(player.error) }))
  if (failed === SCORE_NOT_FOUND) {
    await router.replace('/')
    realignSentinelBase()
  }
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
  resetLayout()
  backConfirm?.()
  backSelection?.()
  backEdit?.()
  backConfirm = backSelection = backEdit = null
  await save()
  await close()
})

watch(() => route.params.id, load)

function onKey(e) {
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.code === 'Space') {
    e.preventDefault()
    togglePlay()
  } else if (e.key === 'Escape') {
    if (player.drawer) player.drawer = null
    else if (player.selection) clearSelection()
  }
}

function pickPdf() {
  pdfInput.value?.click()
}
async function onPdfPicked(e) {
  const f = e.target.files?.[0]
  e.target.value = ''
  if (!f) return
  await importPdf(f)
  toast(t('view.toast.pdfUpdated'))
}
</script>

<template>
  <div class="player">
    <aside
      class="side-bar"
      :class="{ collapsed: !libraryOpen, dragging: sideDragging, 'top-hidden': topHidden }"
      :style="{ width: (libraryOpen ? sideWidth : 0) + 'px' }"
    >
      <div class="side-clip">
        <div class="side-frame" :style="{ width: sideWidth + 'px' }">
          <div class="side-body">
            <LibraryPanel
              :current-id="player.id"
              :info-request="infoRequest"
              :new-ids="newIds"
              @open-score="openScore"
              @scores-removed="onScoresRemoved"
            />
          </div>
        </div>
      </div>
      <div
        class="side-resizer"
        role="separator"
        :aria-label="libraryOpen ? t('view.side.resizeAria') : t('view.circle.openLibrary')"
        @pointerdown="startResize"
      />
    </aside>

    <Transition name="scrim-io">
      <div
        v-if="drawerOpen"
        class="scrim sheet-scrim"
        :class="{ 'fade-x': isLandscape }"
        @click="closeCurrentDrawer()"
      />
    </Transition>

    <div
      id="sheet-slot"
      class="sheet-slot"
      :class="{ dragging: sideDragging, landscape: isLandscape }"
      :style="slotStyle"
    />

    <div
      v-if="drawerOpen && isLandscape"
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

      <div class="capsule glass back-dock" :class="{ 'no-labels': !settings.showButtonLabels, 'top-hidden': topHidden }">
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

      <div v-if="hasScore" class="bottom">
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
    <LibrarySettings :open="settingsOpen" @close="settingsOpen = false" />

    <div v-if="dropActive" class="drop-veil">
      <div class="drop-card">
        <SquareArrowRightEnter :size="30" />
        <strong>{{ t('view.drop.dropHere') }}</strong>
      </div>
    </div>

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

    <input ref="pdfInput" type="file" accept="application/pdf" class="hidden" @change="onPdfPicked" />
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
  --dock-pad: 110px;
  --drawer-h: 85dvh;
}
.stage {
  position: relative;
  flex: 1;
  min-width: var(--stage-min-w);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.side-bar {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-width: 94vw;
  background: var(--surface-card);
  border-right: 1px solid var(--stroke-soft);
  padding-top: var(--safe-t);
  transition: width var(--side-io) var(--ease), border-right-width var(--side-io) var(--ease),
    transform var(--side-io) var(--ease);
}
.side-bar.collapsed {
  border-right-width: 0;
}
.side-bar.top-hidden {
  transform: translateX(-100%);
}
.side-bar.dragging {
  transition: none;
}
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
.sheet-scrim {
  z-index: 29;
}
.side-resizer.drawer-resizer {
  top: calc(100% - var(--drawer-h));
  bottom: 0;
  right: auto;
  z-index: 31;
}
.side-resizer.drawer-resizer::before {
  display: none;
}
.sheet-slot.dragging :deep(.drawer-box) {
  border-right-color: var(--accent);
}
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
.side-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.side-body :deep(.library) {
  flex: 1;
  min-height: 0;
}

.side-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -7px;
  width: 14px;
  cursor: col-resize;
  touch-action: none;
  pointer-events: auto;
  z-index: 27;
}
.side-bar.collapsed .side-resizer {
  right: auto;
  left: var(--safe-l);
}

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
.side-resizer:hover::before {
  opacity: 1;
}

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
.side-resizer:active::after,
.side-resizer.dragging::after,
.side-bar.dragging > .side-resizer::after {
  background: var(--accent);
  width: 3px;
  height: 64px;
  margin-top: -32px;
}
.dragging > .side-resizer::before {
  opacity: 0;
}
.side-bar.dragging::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 2px;
  background: var(--accent);
}

.back-dock {
  position: absolute;
  top: var(--glass-inset-t);
  left: var(--glass-inset-l);
  z-index: 26;
  transition: transform var(--side-io) var(--ease);
}
.back-dock.top-hidden {
  transform: translateY(calc(-100% - var(--glass-inset-t) - 8px));
}

.state {
  flex: 1;
}
.state p {
  margin: 0;
  font-size: 16px;
}
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
}
.bottom > * {
  pointer-events: auto;
  max-width: 100%;
}

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
.cover-cmp-box img.custom {
  filter: none;
}
.cover-cmp-note {
  font-size: 12.5px;
  color: var(--text-muted);
  text-align: center;
  overflow-wrap: anywhere;
}

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
.cmp-sub {
  display: block;
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--text-muted);
}

.hidden {
  display: none;
}
</style>
