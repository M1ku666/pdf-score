<script setup>
import { toasts } from './store/ui.js'
</script>

<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" />
  </router-view>

  <div class="toast-wrap">
    <div v-for="t in toasts" :key="t.id" class="toast glass notice">{{ t.message }}</div>
  </div>
</template>
