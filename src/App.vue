<script setup>
/**
 * 应用根：路由出口 + **顶部提示栈**（`ToastStack`，全站唯一一个提示渲染出口）。
 *
 * 提示的动作按钮**只发动作名**（`toast.action`），由这里派发到对应的 store ——
 * toast 数据层（`store/toast.js`）因此不引任何业务 store，没有循环依赖。
 *
 * 另外这里是**图标默认描边的唯一一处**：`setLucideProps()` 走的是 `provide`，
 * 只有挂在根组件上才盖得住全站（在 `main.js` 的 `app.runWithContext()` 里调不行 ——
 * `provide()` 只认组件实例，会 warn 且不生效）。
 */
import { setLucideProps } from '@lucide/vue'
import ToastStack from './components/ToastStack.vue'
import { undoLastDeletions } from './store/player.js'

// `@lucide/vue` 自己的默认描边是 2，这套 UI 一直是 1.9（见 `docs/ui.md` §16.1）——
// 调用点别再逐个写 `stroke-width`。Teleport 出去的面板也在这棵树里，一样吃得到。
setLucideProps({ strokeWidth: 1.9 })

/**
 * 提示里那颗按钮按下了。`x.action` 是动作名，`x.key` 是这条提示的槽位
 * （点完由动作自己把这条收掉 —— 「按下去要做什么」只有动作那边知道）。
 */
function onToastAct(x) {
  if (x.action === 'undo') undoLastDeletions()
}
</script>

<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" />
  </router-view>

  <ToastStack @act="onToastAct" />
</template>
