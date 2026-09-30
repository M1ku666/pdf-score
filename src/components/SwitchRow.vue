<script setup>
/**
 * 开关行（L2 通用组件）：左边一行文字、右边一个滑块开关。
 *
 * **全项目唯一一份开关实现** —— 原来这套 `.set-row` + `.switch` 长在 `LibrarySettings.vue` 里，
 * 音频起点选择器要用同一个开关（「添加弱起小节」）时才提出来（docs/invariants.md §11
 *「一件事只有一个实现」；docs/ui.md §11 的硬编码白名单也跟着指向本文件）。
 * **样式一个像素没动**：轨道 48×28、滑块 22、选中右移 20；滑块恒为白 —— 它要同时在
 * 深浅两色的轨道（`--surface-sunken` / `--accent`）上成立，走变量反而会错。
 *
 * 不引任何 store、不含业务概念；`label` 由使用方 `t()` 好再传进来。
 * 整行都是点击区（`min-height` = `--tap-min`），所以触控尺寸达标；
 * **行本身不套卡片底色**（深浅色下都会走样，见 docs/ui.md §18.4 第 47 条），只有悬停/按下才有底。
 *
 * 用法：`<SwitchRow :label="t('...')" :checked="flag" @change="flag = $event" />`
 */
defineProps({
  label: { type: String, default: '' },
  checked: { type: Boolean, default: false },
})
defineEmits(['change'])
</script>

<template>
  <label class="set-row">
    <span class="set-text">{{ label }}</span>
    <input type="checkbox" :checked="checked" @change="$emit('change', $event.target.checked)" />
    <span class="switch" />
  </label>
</template>

<style scoped>
/* 常态不加底色/圆角，但左右留出 8px 内边距（用负外边距抵掉），
   这样鼠标悬停时铺出来的底色不会顶到两头的字上 */
.set-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: var(--tap-min); /* 整行都是点击区，触控尺寸达标 */
  padding: 2px 8px;
  margin: 0 -8px;
}
/* 悬停是临时态，和「开关行不套卡片」不冲突：常态仍然没有底色 */
@media (hover: hover) {
  .set-row:hover {
    background: var(--surface-hover);
    border-radius: var(--radius-sm);
  }
}
/* 按下比悬停再深一档 */
.set-row:active {
  background: var(--surface-active);
  border-radius: var(--radius-sm);
}
.set-row input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.switch {
  width: 48px;
  height: 28px;
  border-radius: 999px;
  background: var(--surface-sunken);
  position: relative;
  flex: none;
  transition: background 0.15s ease;
}
.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  /* 这个白是**白名单里的硬编码**（docs/ui.md §11）：滑块要同时在深浅两色的轨道上都成立，
     走变量反而会错 */
  background: #fff;
  transition: transform 0.15s ease;
}
.set-row input:checked ~ .switch {
  background: var(--accent);
}
.set-row input:checked ~ .switch::after {
  transform: translateX(20px);
}
.set-text {
  flex: 1;
  font-size: 14.5px;
}
</style>
