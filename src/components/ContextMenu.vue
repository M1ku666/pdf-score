<script setup>
/**
 * 上下文菜单：锚定在「触发点」或「触发元素」上的小浮层，放针对某个对象的几个动作。
 *
 *  · 轻量浮层，**不参与面板宿主**（不进侧栏、不撑抽屉），所以从抽屉内部弹出来
 *    也不会叠出第二层抽屉 —— 这正是它和 AppSheet 的分工。
 *  · 只拦点击、不画遮罩：上下文菜单不该把整页压暗。
 *  · 点空白或 Esc 关闭；坐标会夹在视口内，贴边时不会跑出屏幕。
 *
 *  · 浮层与遮罩都吃掉 contextmenu：**全项目不用右键**（见 docs/ui.md §9），右键不该在菜单上
 *    再叠一层浏览器原生菜单。
 *
 * items: [{ key, label, icon, danger, checked }]
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
  /** 触发点（某个按钮的位置），当没有 anchor 时用它 */
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  /** 或锚定到一个元素：{ left, bottom }，贴在它下方 */
  anchor: { type: Object, default: null },
  title: { type: String, default: '' },
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
  close()
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
      <button
        v-for="it in items"
        :key="it.key"
        type="button"
        class="ctx-item"
        :class="{ danger: it.danger, on: it.checked }"
        role="menuitem"
        @click="choose(it)"
      >
        <AppIcon v-if="it.icon" :name="it.icon" :size="19" />
        <span class="ctx-label">{{ it.label }}</span>
        <AppIcon v-if="it.checked" name="check" :size="18" class="tick" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* 只拦点击、不画遮罩：上下文菜单不该把整页压暗 */
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
.ctx-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
