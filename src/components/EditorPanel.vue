<script setup>
import { computed } from 'vue'
import { Trash } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import { player } from '../store/player.js'
import { t } from '../i18n/index.js'

const props = defineProps({
  drawer: { type: String, required: true },
  title: { type: String, default: '' },
  icon: { type: [Object, Function], default: null },
  canDelete: { type: Boolean, default: false },
  deleteLabel: { type: String, default: () => t('common.delete') },
})

const emit = defineEmits(['delete'])

const open = computed(() => player.drawer === props.drawer)

function close() {
  player.drawer = null
}
</script>

<template>
  <AppSheet :open="open" :title="title" :icon="icon" position="bottom" follow-layout :panel-key="drawer" @close="close">
    <div class="form">
      <slot />
    </div>

    <template v-if="canDelete" #footer>
      <button type="button" class="btn danger" @click="emit('delete')">
        <Trash :size="18" /> {{ deleteLabel }}
      </button>
    </template>
  </AppSheet>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
</style>
