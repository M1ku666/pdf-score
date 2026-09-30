<script setup>
/**
 * 页面最底下的一小条进度条：只显示播放进度，不接收任何点击（段落跳转在「小节·拍」里）。
 */
import { computed } from 'vue'
import { duration, player } from '../store/player.js'

const total = computed(() => Math.max(0.1, duration.value || 0))
const pct = computed(() => Math.min(100, Math.max(0, (player.currentTime / total.value) * 100)))
</script>

<template>
  <div class="progress-line" role="progressbar" :aria-valuenow="Math.round(pct)">
    <i :style="{ width: pct + '%' }" />
  </div>
</template>
