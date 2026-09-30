<script setup>
import { ref, watch } from 'vue'
import ProgressRing from './ProgressRing.vue'
import { hintsHidden, sweep, toasts } from '../store/toast.js'
import { t } from '../i18n/index.js'

defineEmits(['act'])

const armed = ref(false)
watch(
  toasts,
  () => {
    armed.value = toasts.some((x) => x.expireAt) || !sweep()
  },
  { deep: true, immediate: true }
)
const timer = setInterval(() => {
  if (!armed.value) return
  if (!sweep()) armed.value = false
}, 100)
if (typeof window !== 'undefined') window.addEventListener('unload', () => clearInterval(timer))
</script>

<template>
  <div class="toast-wrap" :class="{ 'top-hidden': hintsHidden }">
    <div
      v-for="x in toasts"
      :key="`${x.id}:${x.tick}`"
      class="toast glass notice"
      :class="[`is-${x.kind}`, { 'is-danger': x.tone === 'danger' }]"
    >
      <ProgressRing
        v-if="x.kind === 'task' || (x.kind === 'action' && x.total > 0)"
        :progress="x.kind === 'task' ? x.progress : null"
        :since="x.since || 0"
        :total="x.total || 0"
        :tone="x.tone"
      />
      <span class="toast-text">{{ x.message }}</span>
      <button
        v-if="x.kind === 'action'"
        type="button"
        class="btn sm toast-btn"
        @click="$emit('act', x)"
      >
        {{ x.button || t('common.undo') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-wrap {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  top: var(--hint-top);
  z-index: 90;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--hint-gap);
  pointer-events: none;
  width: min(92vw, 460px);
  transition: transform var(--side-io) var(--ease);
}
.toast-wrap.top-hidden {
  transform: translateX(-50%) translateY(calc(-100% - var(--hint-top) - 8px));
}
.toast {
  position: relative;
  pointer-events: auto;
  max-width: 100%;
  gap: 10px;
  padding: 5px 17px;
  text-align: center;
  animation: toast-in 0.18s ease;
}
.toast.is-toast {
  padding: 5px 26px;
}
.toast-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.toast::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--accent);
  pointer-events: none;
  animation: toast-wash 0.45s ease-out forwards;
}
.toast.is-danger::before {
  background: var(--danger);
}
.toast.is-danger .toast-btn {
  color: var(--danger);
}
.toast.is-danger .toast-btn:active {
  color: var(--danger-deep);
}
@keyframes toast-wash {
  from {
    opacity: 0.55;
  }
  to {
    opacity: 0;
  }
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
}
.toast-btn {
  flex: none;
  border-radius: 999px;
  background: transparent;
  border-color: var(--accent-line);
  color: var(--accent);
  text-decoration: underline transparent;
  text-underline-offset: 3px;
  text-decoration-thickness: 1.5px;
  transition: text-decoration-color 0.15s ease;
}
@media (hover: hover) {
  .toast-btn:hover {
    background: transparent;
    text-decoration-color: currentColor;
  }
}
.toast-btn:active {
  background: transparent;
  color: var(--accent-deep);
}
</style>
