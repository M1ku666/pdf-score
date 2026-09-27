<script setup>
/**
 * 内联图标。
 * 图标本体在 `src/assets/icons/*.svg`，**一个图标一个本地文件**：
 * 换图标 = 覆盖同名 .svg，加图标 = 丢一个新 .svg 进去，都不需要改这个文件。
 *
 * 约定（详见 src/assets/icons/README.md）：
 *  · 文件名用 kebab-case（如 `chevron-left.svg`），组件的 name 用 camelCase，内部自动换算
 *  · 根 <svg> 的 viewBox 会被读取，所以任何标准图标集的文件都能直接丢进来
 *  · 根 <svg> 上的 width / height / stroke / fill 一律忽略，尺寸与颜色由组件属性统一控制
 *  · 需要实心图形时，在子元素上写 fill="currentColor" stroke="none"
 */
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 22 },
  stroke: { type: [Number, String], default: 1.9 },
})

const DEFAULT_VIEW_BOX = '0 0 24 24'

/** 只改这一行就能整体换一套图标目录（Vite 要求 glob 是字面量） */
const files = import.meta.glob('../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true })

const kebab = (s) => String(s).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** 从标准 SVG 文本里取出 viewBox 与内部内容（根 <svg> 自己丢掉） */
function parse(raw) {
  const text = String(raw)
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
  const open = text.match(/<svg\b[^>]*>/i)
  if (!open) return { viewBox: DEFAULT_VIEW_BOX, inner: text }
  const viewBox = (open[0].match(/viewBox\s*=\s*"([^"]*)"/i) || [null, DEFAULT_VIEW_BOX])[1] || DEFAULT_VIEW_BOX
  const start = text.indexOf(open[0]) + open[0].length
  const end = text.lastIndexOf('</svg>')
  return { viewBox, inner: text.slice(start, end < 0 ? undefined : end).trim() }
}

const ICONS = {}
for (const [path, raw] of Object.entries(files)) {
  ICONS[path.split('/').pop().replace(/\.svg$/, '')] = parse(raw)
}

/** 缺失提示只报一次，避免每次渲染都刷屏 */
const warned = new Set()

const icon = computed(() => {
  const key = kebab(props.name)
  const hit = ICONS[key]
  if (!hit && import.meta.env.DEV && !warned.has(key)) {
    warned.add(key)
    console.warn(`[AppIcon] 找不到 src/assets/icons/${key}.svg（name="${props.name}"），已回退到 info`)
  }
  return hit || ICONS.info || { viewBox: DEFAULT_VIEW_BOX, inner: '' }
})
</script>

<template>
  <svg
    class="icon"
    :viewBox="icon.viewBox"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="icon.inner"
  />
</template>

<style scoped>
.icon {
  display: block;
  flex: none;
}
</style>
