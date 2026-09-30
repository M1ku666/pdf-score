<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { X } from '@lucide/vue'
import { closeDrawer, layout, openDrawer, popBackLayer, pushBackLayer, registerPanel, unregisterPanel } from '../store/ui.js'
import { t } from '../i18n/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  icon: { type: [Object, Function], default: null },
  position: { type: String, default: 'bottom' },
  compact: { type: Boolean, default: false },
  followLayout: { type: Boolean, default: false },
  panelKey: { type: String, default: '' },
})

const emit = defineEmits(['close'])

const hostId = computed(() => (props.followLayout && props.panelKey ? 'sheet-slot' : ''))
const current = computed(() => !!hostId.value && layout.panel === props.panelKey)
const shown = computed(() => (hostId.value ? props.open && current.value : props.open))
const transitionName = computed(() => (hostId.value ? 'drawer' : 'sheet'))

function close() {
  emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (!props.followLayout || !props.panelKey) return
    if (open) {
      openDrawer(props.panelKey)
      registerPanel(props.panelKey, close)
    } else {
      closeDrawer(props.panelKey)
      unregisterPanel(props.panelKey)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  closeDrawer(props.panelKey)
  unregisterPanel(props.panelKey)
})

let popBack = null

function syncBackLayer(open) {
  if (open && !popBack) popBack = pushBackLayer(close, hostId.value ? props.panelKey : '')
  else if (!open && popBack) {
    popBack()
    popBack = null
  }
}

watch(() => props.open, syncBackLayer, { immediate: true })

onBeforeUnmount(() => {
  popBack?.()
  popBack = null
})

function onKey(e) {
  if (e.key !== 'Escape' || !props.open) return
  if (hostId.value && !current.value) return
  close()
}

watch(
  () => props.open,
  (v) => {
    if (v) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  }
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport :to="hostId ? `#${hostId}` : 'body'" defer>
    <Transition :name="transitionName">
      <div v-if="shown" :class="hostId ? 'drawer-host' : ['sheet-root', position]">
        <div v-if="!hostId" class="scrim" @click="close"></div>
        <section class="sheet-panel" :class="hostId ? 'drawer-box' : [position, { compact }]">
          <header class="sheet-head">
            <component :is="icon" v-if="icon" :size="20" />
            <h2>{{ title }}</h2>
            <button type="button" class="icon-btn flat" :aria-label="t('common.close')" @click="close">
              <X :size="20" />
            </button>
          </header>
          <div class="sheet-body scroll-y">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="sheet-foot">
            <slot name="footer" />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
}
.sheet-root.bottom {
  align-items: flex-end;
  justify-content: center;
}
.sheet-root.center {
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.drawer-host {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  pointer-events: auto;
}
.drawer-host::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--scrim);
  opacity: 0;
  transition: opacity var(--side-io) var(--ease);
  pointer-events: none;
}
.drawer-leave-active::after {
  opacity: 1;
}
.drawer-box {
  width: 100%;
  height: 100%;
  border-bottom: 0;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding-bottom: var(--safe-b);
}

.sheet-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--surface-float);
  border: 1px solid var(--stroke-strong);
  box-shadow: var(--shadow-3);
  min-height: 0;
}
.sheet-panel.bottom {
  width: 100%;
  max-width: 620px;
  max-height: 78dvh;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  border-bottom: 0;
  padding-bottom: var(--safe-b);
}
.sheet-panel.compact.bottom {
  max-height: 62dvh;
}
.sheet-panel.center {
  width: 100%;
  max-width: 460px;
  max-height: 86dvh;
  border-radius: var(--radius);
}
.sheet-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 12px 18px;
  min-height: calc(var(--tap) + 24px + 1px);
  border-bottom: 1px solid var(--stroke-soft);
  flex: none;
}
.sheet-head h2 {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet-body {
  padding: 16px 18px 18px;
  flex: 1;
  min-height: 0;
}
.sheet-foot {
  display: flex;
  gap: 10px;
  padding: 12px 16px calc(12px + var(--safe-b));
  border-top: 1px solid var(--stroke-soft);
  flex: none;
}
.sheet-panel.center .sheet-foot :deep(.btn) {
  flex: 1;
}
.drawer-box .sheet-foot {
  flex-direction: column;
  padding-bottom: 12px;
}

.sheet-slot.landscape .drawer-box {
  border-radius: 0 var(--radius-lg) 0 0;
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s ease;
}
.sheet-enter-active .sheet-panel,
.sheet-leave-active .sheet-panel {
  transition: transform 0.22s var(--ease);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet-panel.bottom,
.sheet-leave-to .sheet-panel.bottom {
  transform: translateY(24px);
}
.sheet-enter-from .sheet-panel.center,
.sheet-leave-to .sheet-panel.center {
  transform: scale(0.96);
}

.drawer-enter-from,
.drawer-leave-to {
  transform: translateY(100%);
}
.drawer-enter-active,
.drawer-leave-active {
  transition: transform var(--side-io) var(--ease);
}
</style>
