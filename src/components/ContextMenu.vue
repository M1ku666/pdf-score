<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check } from '@lucide/vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  anchor: { type: Object, default: null },
  title: { type: String, default: '' },
  stayOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'close'])

const el = ref(null)
const pos = ref({ left: 0, top: 0, ready: false })
const MARGIN = 8

function place() {
  const node = el.value
  if (!node) return
  const w = node.offsetWidth
  const h = node.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  const a = props.anchor
  const left = Math.max(MARGIN, Math.min(a ? a.left : props.x, vw - w - MARGIN))
  const top = Math.max(MARGIN, Math.min(a ? a.bottom + 6 : props.y, vh - h - MARGIN))
  pos.value = { left, top, ready: true }
}

function close() {
  emit('close')
}

function choose(item) {
  emit('select', item.key)
  if (!props.stayOpen) close()
}

function onKey(e) {
  if (e.key === 'Escape') close()
}

watch(
  () => props.open,
  async (v) => {
    if (v) {
      window.addEventListener('keydown', onKey)
      window.addEventListener('resize', place)
      pos.value = { ...pos.value, ready: false }
      await nextTick()
      place()
    } else {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
    }
  }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ctx-layer" @click="close" @contextmenu.prevent="close"></div>
    <div
      v-if="open"
      ref="el"
      class="ctx glass"
      :class="{ ready: pos.ready }"
      :style="{ left: pos.left + 'px', top: pos.top + 'px' }"
      role="menu"
    >
      <p v-if="title" class="ctx-title">{{ title }}</p>
      <template v-for="it in items" :key="it.key">
        <hr v-if="it.divider" class="divider ctx-sep" role="separator" />
        <button
          type="button"
          class="ctx-item"
          :class="{ danger: it.danger, on: it.checked }"
          role="menuitem"
          @click="choose(it)"
        >
          <component :is="it.icon" v-if="it.icon" :size="19" />
          <span class="ctx-label">{{ it.label }}</span>
          <Check v-if="it.checked" :size="18" class="tick" />
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-layer {
  position: fixed;
  inset: 0;
  z-index: 60;
}
.ctx {
  position: fixed;
  z-index: 61;
  min-width: 170px;
  max-width: min(78vw, 260px);
  padding: 6px;
  border-radius: var(--radius);
  box-shadow: var(--shadow-3);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.ctx.ready {
  opacity: 1;
}
.ctx-title {
  margin: 2px 6px 6px;
  font-size: 12.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: var(--tap-min);
  padding: 0 12px;
  border-radius: var(--radius-sm);
  color: var(--text-strong);
  font-size: 15px;
  text-align: left;
}
@media (hover: hover) {
  .ctx-item:hover {
    background: var(--surface-hover);
  }
}
.ctx-item:active {
  background: var(--surface-active);
}
.ctx-item.danger {
  color: var(--danger);
}
.ctx-item.on {
  color: var(--accent);
}
.ctx-sep {
  margin: 5px 0;
}
.ctx-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
