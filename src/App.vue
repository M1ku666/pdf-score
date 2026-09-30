<script setup>
import { setLucideProps } from '@lucide/vue'
import ToastStack from './components/ToastStack.vue'
import { dismissToast, errorToast, errText, toast } from './store/toast.js'
import { t } from './i18n/index.js'
import { undoLastDeletions } from './store/player.js'

setLucideProps({ strokeWidth: 1.9 })

async function copyToClipboard(text) {
  let reason = ''
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return null
    }
  } catch (err) {
    reason = err?.message || ''
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
    return ok ? null : reason
  } catch (err) {
    return err?.message || reason
  }
}

async function onToastAct(x) {
  if (x.action === 'undo') return undoLastDeletions()
  if (x.action !== 'copy') return
  const reason = await copyToClipboard(x.message)
  if (reason !== null) return errorToast(t('common.copyFailed', { msg: errText(reason) }))
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
