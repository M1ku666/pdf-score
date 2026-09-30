<script setup>
/**
 * 上下文菜单：锚定在「触发点」或「触发元素」上的小浮层，放针对某个对象的几个动作。
 *
 *  · 轻量浮层，**不参与面板宿主**（不进侧栏、不撑抽屉），所以从抽屉内部弹出来
 *    也不会叠出第二层抽屉 —— 这正是它和 AppSheet 的分工。
 *  · 只拦点击、不画遮罩：上下文菜单不该把整页压暗。
 *  · 点空白或 Esc 关闭；坐标会夹在视口内，贴边时不会跑出屏幕。
 *  · **两种用法**：默认「一点就关」= 挑一个动作（卡片「⋯」、乐谱库顶栏菜单钮）；
 *    传 `stay-open` = **开关式菜单**（筛选这种多选）：点一项只切那一项、菜单留着，
 *    连着切好几项不用每次重新点开，点空白 / Esc 才关。
 *
 *  · 浮层与遮罩都吃掉 contextmenu：**全项目不用右键**（见 docs/ui.md §9），右键不该在菜单上
 *    再叠一层浏览器原生菜单。
 *
 * items: [{ key, label, icon, danger, checked, divider }]
 *   · `icon` 是 **`@lucide/vue` 的图标组件本身**（见 `docs/ui.md` §16.1），模板里走 `<component :is>`。
 *   · `divider: true` = **这一项上面画一条分割线**（把「全部」这种总结项与上面的分类项隔开）。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check } from '@lucide/vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
  /** 触发点（某个按钮的位置），当没有 anchor 时用它 */
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  /** 或锚定到一个元素：{ left, bottom }，贴在它下方 */
  anchor: { type: Object, default: null },
  title: { type: String, default: '' },
  /** 开关式菜单：点一项**不关**（见文件头注释），等点空白 / Esc */
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
  // `stayOpen`（开关式菜单）时留着不关：调用方多半要连点好几项（筛选那四档）
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
        <!-- 分割线是**独立的一条**（走全局 `hr.divider`），不是画在上面那一项的上边框上：
             挂在按钮上时，`margin-top` 那块地方既不属于任何项、也不是线，看着就是「多出来一条空白」，
             而且线的几何会跟着项的 `min-height` / 悬停底色一起动 -->
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
/* 分割线：线本体走全局 `hr.divider`（**别在这里再定义一遍 1px 线**），
   只把它的上下外边距收窄 —— 全局那份是给表单分区用的 14px，菜单里项高才 46，14 太散。
   线的颜色也不在这里管：全局 `.divider` 已经用上 `--stroke-strong` 了
   （`--stroke-soft` 那种弱分隔压在浮层的近白底上只有 1.18:1，等于没有这条线）。 */
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
