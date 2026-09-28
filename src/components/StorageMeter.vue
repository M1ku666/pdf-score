<script setup>
/**
 * 存储占用圆钮（乐谱库标题栏右侧那一颗）：**图标 + 「备份」**，外圈是一道环形进度。
 *
 *  · 圆环 = 已用额度占总额度的比例。**超小比例也要看得见**：实测「几 MB / 10 GB」算出来是 0.1%，
 *    照原样画就是一圈空的、看着像坏了 —— 所以非零占用给一个 `MIN_RATIO` 的可见下限（见下）。
 *  · **拿不到数字时（`ratio` 为 null）不画进度环**，只留一颗普通的圆钮：不假装「已用了 0%」。
 *  · 形态与 `.icon-btn` 一致（`--tap` 的圆、悬停 / 按下同一套），字号跟胶囊小字同档（11px）。
 *    它是**标题栏右侧的独立入口**，不并进左上那条「乐谱库 / 收起 + 设置」胶囊。
 *  · **「显示按钮文字」这个设置也管它**（`settings.showButtonLabels`）：关掉后这颗圆钮也只留图标。
 *    它是**独立圆钮、不在胶囊里**，所以蹭不到全局 `.no-labels` 的那套（那是给 `.cap-btn` 写的）——
 *    类名仍由**使用方**挂（与三处胶囊同一个写法，见本文件末尾的 `.no-labels` 注释）。
 *
 * **只有一个图标（`database` 圆饼）、没有第二种状态**：这颗钮是「查看占用 + 备份」的入口，
 * 不管这台设备答没答应「别自动清」，都长这个样子、都用同一句提示语。
 *
 * 点了只发 `open` 事件 —— 里面的内容（数值、进度条、说明、导出）全在 `StorageSheet` 里，
 * 本组件不引 store、不做数据获取，`ratio` 由使用方给；`showButtonLabels` 同理，
 * 由使用方挂类名，本组件**不引 `store/settings.js`**。
 */
import AppIcon from './AppIcon.vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  /** 已用比例 0~1；**null = 还没量到**（此时不画环） */
  ratio: { type: Number, default: null },
})
defineEmits(['open'])

/**
 * 环形尺寸：SVG 见方 `BOX`，描边 `WIDTH`，半径把描边让进去（r = BOX/2 − WIDTH/2）。
 * `CIRCUMFERENCE` 是整圈周长，`dasharray` 与 `dashoffset` 都从它算。
 */
const BOX = 46
const WIDTH = 2.5
const R = BOX / 2 - WIDTH / 2
const CIRCUMFERENCE = 2 * Math.PI * R
/** 非零占用的**可见下限**：0.1% 那种真实比例画出来就是一圈空，留一小段弧表示「确实占了」 */
const MIN_RATIO = 0.02

/** 环上真正画的弧长占整圈的比例（占用为 0 就是 0，量不到时整条环都不画） */
const shown = () => {
  const r = props.ratio
  if (r === null || !Number.isFinite(r)) return null
  return r <= 0 ? 0 : Math.max(MIN_RATIO, Math.min(1, r))
}
</script>

<template>
  <button type="button" class="meter-btn" :aria-label="t('library.storage.aria')" @click="$emit('open')">
    <!-- 环画在按钮底层（绝对定位铺满），图标与小字压在上面 -->
    <svg v-if="shown() !== null" class="ring" :viewBox="`0 0 ${BOX} ${BOX}`" aria-hidden="true">
      <circle class="ring-track" :cx="BOX / 2" :cy="BOX / 2" :r="R" :stroke-width="WIDTH" />
      <circle
        v-if="shown() > 0"
        class="ring-fill"
        :cx="BOX / 2"
        :cy="BOX / 2"
        :r="R"
        :stroke-width="WIDTH"
        :stroke-dasharray="CIRCUMFERENCE"
        :stroke-dashoffset="CIRCUMFERENCE * (1 - shown())"
      />
    </svg>
    <AppIcon name="database" :size="17" />
    <span class="label">{{ t('library.storage.button') }}</span>
  </button>
</template>


<style scoped>
/* 圆钮本体：与全局 `.icon-btn` 同一套尺寸 / 取色 / 悬停按下（12px 是 `.btn.sm` 那一档的圆角思路，
   这里直接取满圆）。它是 `flex: none` 的方形，不与标题抢宽 */
.meter-btn {
  position: relative;
  flex: none;
  width: var(--tap);
  height: var(--tap);
  border-radius: 50%;
  background: var(--surface-control);
  color: var(--text-strong);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  transition: transform 0.08s ease, background 0.15s ease;
}
@media (hover: hover) {
  .meter-btn:hover {
    background: var(--surface-hover);
  }
}
.meter-btn:active {
  transform: scale(0.94);
  background: var(--surface-active);
}
/* 小字（「备份」）：与胶囊里那颗小字同档，别按标题栏的字号来 */
.label {
  font-size: 11px;
  line-height: 1;
}
/* 「显示按钮文字」关掉后只留图标 —— **这一类名由使用方挂**（与三处胶囊同一个写法）。
   它是独立圆钮、不在胶囊里，所以全局那条 `.no-labels .cap-label`（main.css，给 `.cap-btn` 写的）
   管不到它，这里必须自己来一份。
   ⚠️ **圆钮的尺寸算式不跟着变**：它恒是 `--tap` 的方钮（`flex: none`），关掉文字后图标在
   剩下的空间里居中 —— 与 `.cap-btn` 那条同理（小字一 `display: none`，父级仍是
   `justify-content: center`），所以**不加 `margin-top: 0`** 之类的兜底。 */
.no-labels .label {
  display: none;
}
/* 环：铺满按钮、不吃指针（点在它身上也要落到按钮上） */
.ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  /* 从 12 点方向起画（SVG 圆的 0 度在 3 点） */
  transform: rotate(-90deg);
}
.ring-track {
  fill: none;
  stroke: var(--stroke-strong);
}
.ring-fill {
  fill: none;
  stroke: var(--accent);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.3s var(--ease);
}
</style>
