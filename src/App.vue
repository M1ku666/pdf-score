<script setup>
/**
 * 应用根：路由出口 + **顶部提示栈**（`ToastStack`，全站唯一一个提示渲染出口）。
 *
 * 提示的动作按钮**只发动作名**（`toast.action`），由这里派发到对应的 store ——
 * toast 数据层（`store/toast.js`）因此不引任何业务 store，没有循环依赖。
 */
import ToastStack from './components/ToastStack.vue'
import { undoLastDeletions, undoLastSplit } from './store/player.js'

/**
 * 提示里那颗按钮按下了。`x.action` 是动作名，`x.key` 是这条提示的槽位
 * （点完由动作自己把这条收掉 —— 「按下去要做什么」只有动作那边知道）。
 */
function onToastAct(x) {
  if (x.action === 'undo') undoLastDeletions()
  else if (x.action === 'undo-split') undoLastSplit()
}
</script>

<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" />
  </router-view>

  <ToastStack @act="onToastAct" />
</template>
