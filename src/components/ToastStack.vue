<script setup>
/**
 * 顶部提示栈（挂在 `App.vue`）—— **全站唯一的提示渲染出口**，一个组件同时画三类 toast：
 *
 *  · 第一类 **一次性通知**：`kind: 'toast'`，只有一行文字，到点自己走。
 *  · 第二类 **任务型通知**：`kind: 'task'`，左边一颗进度圆环 ——
 *    有真实进度就给 `ProgressRing` 传 0~1（蓝弧按比例走），没有明确进度时传 `null`（无限进度环动画）。
 *    任务完成 / 失败后它**就地变成一次性通知**（数据层已经把它改成 `kind: 'toast'`），这里不用分支。
 *  · 第三类 **带按钮的通知**：`kind: 'action'`，右边一颗 `.toast-btn`；给了 `total` 时
 *    左边还有那圈**倒计时环**。两个使用者：**撤销条**（「删除 xN」+ 撤销）与
 *    **可复制的报错**（报错原文 + 复制，动作名 `'copy'`）。
 *
 * 三类共用全局 `.notice`（药丸外形 / 高 `--cap-h` / 最小长度 `--tap × 2`）与 `.glass`（毛玻璃），
 * 所以**外形只有一份**；本组件只管「一条提示自己」的三件事：布局、入场动画、按钮点击。
 *
 * **入场时铺一层主题色再渐隐**（`.toast::before` 的 `toast-wash` 动画）：这是「出现了新通知」的信号。
 * 同一 `id` 的后续更新靠 `:key="t.id + ':' + t.tick"` **重建节点**让动画重播 ——
 * `tick` 只在「这条通知变了意思」时自增（切到确定进度、任务完成），逐帧进度不动它，
 * 否则一圈主题色会闪一路。
 *
 * 到期由数据层判（`sweep()`），这里只按时来问（100ms 的 ticker）：
 * **只用 `setTimeout` 的话，任务中途改过内容的通知会按旧时间提前消失**，一件事只有一个实现。
 */
import { ref, watch } from 'vue'
import ProgressRing from './ProgressRing.vue'
import { hintsHidden, sweep, toasts } from '../store/toast.js'
import { t } from '../i18n/index.js'

/** 按钮点击只发事件：**动作名 → 做什么**由 `App.vue` 派发（见 `onToastAct`） */
defineEmits(['act'])

/** 有没有谁定了到期时间（一条都没有就不用起 ticker） */
const armed = ref(false)
watch(
  toasts,
  () => {
    // 每次变化都顺手扫一次过期：`armed` 是「还有没有定过时的」，
    // 一个都没有时 ticker 空转没意义，就停在那儿等下一次变化
    armed.value = toasts.some((x) => x.expireAt) || !sweep()
  },
  { deep: true, immediate: true }
)
const timer = setInterval(() => {
  if (!armed.value) return
  if (!sweep()) armed.value = false
}, 100)
// 整页卸载时收掉定时器（组件本身挂在应用根上，不会单独卸载）
if (typeof window !== 'undefined') window.addEventListener('unload', () => clearInterval(timer))
</script>

<template>
  <div class="toast-wrap" :class="{ 'top-hidden': hintsHidden }">
    <!-- key 里带 `tick`：这条通知「变了意思」时重建一次，入场那层主题色跟着重播 -->
    <div v-for="x in toasts" :key="`${x.id}:${x.tick}`" class="toast glass notice" :class="`is-${x.kind}`">
      <!-- 任务型通知靠它报进度；带按钮那条如果给了 `total` 就用它当撤销窗口的倒计时 -->
      <ProgressRing
        v-if="x.kind === 'task' || (x.kind === 'action' && x.total > 0)"
        :progress="x.kind === 'task' ? x.progress : null"
        :since="x.since || 0"
        :total="x.total || 0"
      />
      <span class="toast-text">{{ x.message }}</span>
      <button
        v-if="x.kind === 'action'"
        type="button"
        class="btn sm toast-btn"
        @click="$emit('act', x)"
      >
        {{ x.button || t('common.undo') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-wrap {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  top: var(--hint-top);
  z-index: 90;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--hint-gap);
  pointer-events: none;
  width: min(92vw, 460px);
  /* 「播放时隐藏顶栏」时整条栈往上挪出屏幕（**不是淡出** —— 顶栏那几条都是真的挪走）。
     平移量 = 本层高 + 顶部起点 + 8px，保证整条出屏；`--hint-top` 那几个令牌一个都不用动。
     `translateX(-50%)` 必须一起写：`transform` 是整条覆盖的，只写 `translateY` 会让整条栈
     以左边为基准偏半个身位。 */
  transition: transform var(--side-io) var(--ease);
}
.toast-wrap.top-hidden {
  transform: translateX(-50%) translateY(calc(-100% - var(--hint-top) - 8px));
}
/* 一条提示自己：外形（药丸 / 高 58 / 最小长度 92 / 字色字号 / 居中）全在全局 `.notice` 里，
   这里只剩布局、最大宽度与入场动画。
   `.toast-btn` 与圆环是「这条比纯文字多出来的东西」，靠这里的 `gap` 与两端内边距摆开 */
.toast {
  position: relative;
  /* **`pointer-events: auto` 不能少**：`.toast-wrap` 是 `none`（整条栈不吃指针、不挡谱面），
     而 `pointer-events` **会被子元素继承** —— 不在这里要回来，这一条（含里面那颗按钮）
     在命中测试里等于不存在：按钮看得见、点下去事件穿过去落到谱面上，什么都不发生。
     用户报过「toast 里的按钮点不动了」，就是漏了这一行（`.toast-btn` 自己不管这件事）。 */
  pointer-events: auto;
  max-width: 100%;
  gap: 10px;
  /* 两端各留 17：有按钮时按钮离右边缘 17、有圆环时环离左边缘 17（对称是要求，不是记数） */
  padding: 5px 17px;
  text-align: center;
  animation: toast-in 0.18s ease;
}
.toast.is-toast {
  padding: 5px 26px;
}
/* 正文自己占满剩余宽度并居中：`.notice` 是 flex 容器，文字是里面的匿名项 */
.toast-text {
  flex: 1;
  min-width: 0;
  /* **`min-width: 0` 是 flex 子项能换行的前提**（默认 `min-width: auto` 不肯缩，
     长句子会把药丸顶破、横着溢出 `.toast-wrap`）。这里**不省略号截断**：
     提示是给用户看的整句话，宁可换行也不要截掉后半段。 */
  overflow-wrap: anywhere;
}
/* 入场那层主题色：铺满药丸（跟着 `border-radius` 裁圆），约 0.45s 从 55% 渐隐到 0。
   放在 `::before` 上而不是元素的 `background` 上：`.glass` 的底色与模糊不能被动画打断，
   而且 `::before` 跟着圆角裁、不遮正文。 */
.toast::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--accent);
  pointer-events: none;
  animation: toast-wash 0.45s ease-out forwards;
}
@keyframes toast-wash {
  from {
    opacity: 0.55;
  }
  to {
    opacity: 0;
  }
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
}
/* 通知里那颗按钮：与撤销条那颗同款（药丸圆角、透明底、主题色文字、只靠下划线做悬停） */
.toast-btn {
  flex: none;
  border-radius: 999px;
  background: transparent;
  border-color: var(--accent-line);
  color: var(--accent);
  text-decoration: underline transparent;
  text-underline-offset: 3px;
  text-decoration-thickness: 1.5px;
  transition: text-decoration-color 0.15s ease;
}
@media (hover: hover) {
  .toast-btn:hover {
    background: transparent;
    text-decoration-color: currentColor;
  }
}
.toast-btn:active {
  background: transparent;
  color: var(--accent-deep);
}
</style>
