<script setup>
/**
 * 应用根：路由出口 + **顶部提示栈**（`ToastStack`，全站唯一一个提示渲染出口）。
 *
 * 提示的动作按钮**只发动作名**（`toast.action`），由这里派发到对应的 store ——
 * toast 数据层（`store/toast.js`）因此不引任何业务 store，没有循环依赖。
 * 现在两个动作：`'undo'` → 撤销上一次删除；`'copy'` → 把报错那条的正文放进剪贴板。
 *
 * 另外这里是**图标默认描边的唯一一处**：`setLucideProps()` 走的是 `provide`，
 * 只有挂在根组件上才盖得住全站（在 `main.js` 的 `app.runWithContext()` 里调不行 ——
 * `provide()` 只认组件实例，会 warn 且不生效）。
 */
import { setLucideProps } from '@lucide/vue'
import ToastStack from './components/ToastStack.vue'
import { dismissToast, errorToast, errText, toast } from './store/toast.js'
import { t } from './i18n/index.js'
import { undoLastDeletions } from './store/player.js'

// `@lucide/vue` 自己的默认描边是 2，这套 UI 一直是 1.9（见 `docs/ui.md` §16.1）——
// 调用点别再逐个写 `stroke-width`。Teleport 出去的面板也在这棵树里，一样吃得到。
setLucideProps({ strokeWidth: 1.9 })

/**
 * 把一段文字放进剪贴板：**成功返回 `null`，失败返回失败原因文案**
 * （可能为空字符串，表示没有可用的原因）。
 *
 * **先走 `navigator.clipboard`，它不在或被拒时退回 `execCommand`** —— 手机经局域网用
 * `http://内网IP` 打开时是**非安全上下文**（`docs/deployment.md` §2），`navigator.clipboard`
 * 在那里根本不存在：只写前半段的话手机上「复制」永远是失败的。
 */
async function copyToClipboard(text) {
  let reason = ''
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return null
    }
  } catch (err) {
    // 掉到下面的回退：权限被拒 / 非安全上下文都走这里
    reason = err?.message || ''
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    // 只读 + 挪出可视区：不弹软键盘、页面也不因它滚动一下
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

/**
 * 提示里那颗按钮按下了。`x.action` 是动作名，`x.id` / `x.key` 是这条提示的身份与槽位
 * （点完由动作自己把这条收掉 —— 「按下去要做什么」只有动作那边知道）。
 */
async function onToastAct(x) {
  if (x.action === 'undo') return undoLastDeletions()
  if (x.action !== 'copy') return
  /* 复制的是**这条提示上的整句正文**（含「导入失败：…」这种前缀，粘给人看时一眼知道是哪件事）。
     成了才收掉那条报错、另弹一条「已复制」；**没成就不收** —— 原句还在屏幕上，用户能再点一次 */
  const reason = await copyToClipboard(x.message)
  if (reason !== null) return errorToast(t('common.copyFailed', { msg: errText(reason) }))
  /* **按 `x.id` 收，不按 `key`**：等待剪贴板那一下里可能又来一个报错、把同槽位那条顶掉了，
     按 key 收会误收掉新报错（id 是这条自己的身份，已经被顶掉时收它是空操作） */
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
