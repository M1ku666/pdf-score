<script setup>
import { Database, SquareArrowRightExit } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import { formatBytes } from '../store/library.js'
import { t } from '../i18n/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  usedBytes: { type: Number, default: null },
  quotaBytes: { type: Number, default: null },
  hasScores: { type: Boolean, default: false },
  exportAll: { type: Function, default: null },
})
defineEmits(['close'])

const MIN_RATIO = 0.02

const ratio = () => {
  const q = props.quotaBytes
  if (!Number.isFinite(q) || q <= 0) return null
  if (!Number.isFinite(props.usedBytes)) return null
  return Math.min(1, Math.max(0, props.usedBytes / q))
}
const pct = () => {
  const r = ratio()
  if (r === null) return null
  return (r <= 0 ? 0 : Math.max(MIN_RATIO, r)) * 100
}
const usedText = () => (Number.isFinite(props.usedBytes) ? formatBytes(props.usedBytes) : t('common.calculating'))
const quotaText = () => (Number.isFinite(props.quotaBytes) && props.quotaBytes > 0 ? `/ ${formatBytes(props.quotaBytes)}` : '')
</script>

<template>
  <AppSheet
    :open="open"
    :title="t('library.storage.title')"
    :icon="Database"
    position="bottom"
    follow-layout
    panel-key="storage"
    @close="$emit('close')"
  >
    <div class="storage">
      <div class="block">
        <div class="amount">
          <span class="label">{{ t('library.storage.localLabel') }}</span>
          <span class="value mono">
            {{ usedText() }} <span v-if="quotaText()" class="muted">{{ quotaText() }}</span>
          </span>
        </div>
        <div
          v-if="pct() !== null"
          class="meter"
          role="progressbar"
          :aria-valuenow="Math.round(pct())"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-label="t('library.storage.title')"
        >
          <i :style="{ width: pct() + '%' }" />
        </div>
      </div>

      <div class="block">
        <p class="note">{{ t('library.storage.note') }}</p>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn primary" :disabled="!hasScores" @click="exportAll?.()">
        <SquareArrowRightExit :size="18" /> {{ t('library.storage.exportAll') }}
      </button>
    </template>
  </AppSheet>
</template>

<style scoped>
.storage {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.amount {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 14px;
  line-height: 1.5;
}
.label {
  flex: none;
  color: var(--text-soft);
}
.value {
  margin-left: auto;
  color: var(--text-strong);
  white-space: nowrap;
}

.meter {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-sunken);
  overflow: hidden;
}
.meter > i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.3s var(--ease);
}

.note {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--text-soft);
  white-space: pre-line;
}
</style>
