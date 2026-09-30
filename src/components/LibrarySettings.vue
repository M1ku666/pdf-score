<script setup>
import { Settings } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import SwitchRow from './SwitchRow.vue'
import { settings } from '../store/settings.js'
import { t } from '../i18n/index.js'

defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const SWITCHES = [
  { key: 'autoPlayOnJump', labelKey: 'library.setting.autoPlayOnJump' },
  { key: 'countInJump', labelKey: 'library.setting.countInJump' },
  { key: 'countInPlay', labelKey: 'library.setting.countInPlay' },
  { key: 'countInLoop', labelKey: 'library.setting.countInLoop' },
]
</script>

<template>
  <AppSheet
    :open="open"
    :title="t('common.settings')"
    :icon="Settings"
    position="bottom"
    follow-layout
    panel-key="settings"
    @close="emit('close')"
  >
    <div class="settings">
      <SwitchRow
        :label="t('library.setting.showButtonLabels')"
        :checked="settings.showButtonLabels"
        @change="settings.showButtonLabels = $event"
      />

      <SwitchRow :label="t('library.setting.scrollAnim')" :checked="settings.scrollAnim" @change="settings.scrollAnim = $event" />

      <SwitchRow :label="t('library.setting.hideTopBar')" :checked="settings.hideTopBar" @change="settings.hideTopBar = $event" />

      <SwitchRow
        v-for="sw in SWITCHES"
        :key="sw.key"
        :label="t(sw.labelKey)"
        :checked="settings[sw.key]"
        @change="settings[sw.key] = $event"
      />
    </div>
  </AppSheet>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
