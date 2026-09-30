<script setup>
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
.set-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: var(--tap-min);
  padding: 2px 8px;
  margin: 0 -8px;
}
@media (hover: hover) {
  .set-row:hover {
    background: var(--surface-hover);
    border-radius: var(--radius-sm);
  }
}
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
