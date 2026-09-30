<script setup>
import { setLucideProps } from '@lucide/vue'
import ToastStack from './components/ToastStack.vue'
import { dangerToast, dismissToast, toast } from './store/toast.js'
import { t } from './i18n/index.js'
import { undoLastDeletions } from './store/player.js'

setLucideProps({ strokeWidth: 1.9 })

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

async function onToastAct(x) {
  if (x.action === 'undo') return undoLastDeletions()
  if (x.action !== 'copy') return
  if (!(await copyToClipboard(x.message))) return dangerToast(t('common.copyFailed'))
  dismissToast(x.id)
  toast(t('common.copied'))
}
</script>

<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" />
  </router-view>

  <ToastStack @act="onToastAct" />
</template>
