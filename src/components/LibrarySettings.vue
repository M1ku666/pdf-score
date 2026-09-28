<script setup>
/**
 * 设置面板（原来的「偏好设置」，从 `LibraryPanel` 里原样搬出来的一个小组件）
 *
 * **为什么单独一个组件**：入口搬走了。原来「设置」是乐谱库顶栏里的第三颗图标钮，面板也就跟着
 * 住在 `LibraryPanel` 里；现在那颗钮在左上那条胶囊里（和「乐谱库 / 收起」同一栏），
 * 开合状态归 `PlayerView`，面板自然也该由页面挂 —— 但内容一个字都没变，所以只把那一块搬出来，
 * 不塞进 `PlayerView`（那会让页面多出七个设置开关的细节）。
 *
 * 住在哪儿：仍然是 `AppSheet` + `follow-layout` + `panel-key="settings"` —— 也就是**底部抽屉**，
 * 一次只有一个（新的面板会把这个顶掉，见 `store/ui.js` 的 `openDrawer`）。
 *
 * 里面全是开关，**一行一项**：
 *  · 「显示按钮文字」：管全部「上面图标、下面文字」的按钮 —— 三处悬浮胶囊的小字
 *    （规则在全局 `.no-labels`，见 `main.css`）与乐谱库标题栏那颗「备份」圆钮
 *    （`StorageMeter`，它自己带一份 `.no-labels .label`，类名由 `LibraryPanel` 挂，见 `docs/ui.md` §16.4）；
 *  · 「滚动动画」；
 *  · 「播放时隐藏顶栏」：走带中把顶栏（左上胶囊 / 总览胶囊 / 乐谱库侧栏 / 顶部提示）平移出屏幕，
 *    **底栏不动** —— 判据与动画全在 `PlayerView` 的 `topHidden`，这里只翻 `settings.hideTopBar`
 *    （见 docs/ui.md §18.38）；
 *  · `SWITCHES` 那四个（预备拍与跳转相关的开关）。
 * **即改即生效**，没有「保存」按钮（设置类改动一律如此）。
 *
 * 「文字 + 开关」这一行的**样式与结构都在 `SwitchRow.vue`**（音频起点选择器也用同一份），
 * 这里只留纵向排布 —— 别再往本文件里写一份 `.switch`。
 *
 * ⚠️ 这里**不放**导入 / 生成示例那些杂项 —— 设置面板只有偏好设置，导入入口在乐谱库底部。
 */
import AppSheet from './AppSheet.vue'
import SwitchRow from './SwitchRow.vue'
import { settings } from '../store/settings.js'
import { t } from '../i18n/index.js'

defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

/** 预备拍与跳转相关的开关（音量在播放器的「音频」里）。选项存 key，渲染时才 `t()` */
const SWITCHES = [
  { key: 'autoPlayOnJump', labelKey: 'library.setting.autoPlayOnJump' },
  { key: 'countInJump', labelKey: 'library.setting.countInJump' },
  { key: 'countInPlay', labelKey: 'library.setting.countInPlay' },
  { key: 'countInLoop', labelKey: 'library.setting.countInLoop' },
]
</script>

<template>
  <AppSheet
    :open="open"
    :title="t('common.settings')"
    icon="settings"
    position="bottom"
    follow-layout
    panel-key="settings"
    @close="emit('close')"
  >
    <div class="settings">
      <SwitchRow
        :label="t('library.setting.showButtonLabels')"
        :checked="settings.showButtonLabels"
        @change="settings.showButtonLabels = $event"
      />

      <SwitchRow :label="t('library.setting.scrollAnim')" :checked="settings.scrollAnim" @change="settings.scrollAnim = $event" />

      <!-- 走带中把顶栏平移出屏幕。**只藏顶栏**（左上胶囊 / 总览胶囊 / 乐谱库侧栏 / 顶部提示），
           底栏那对胶囊永远在 —— 播放 / 停止还得按得到。规则见 docs/ui.md §18.38 -->
      <SwitchRow :label="t('library.setting.hideTopBar')" :checked="settings.hideTopBar" @change="settings.hideTopBar = $event" />

      <!-- 四个开关是平级的一串行，不再分组（分组会多出一段间距） -->
      <SwitchRow
        v-for="sw in SWITCHES"
        :key="sw.key"
        :label="t(sw.labelKey)"
        :checked="settings[sw.key]"
        @change="settings[sw.key] = $event"
      />
    </div>
  </AppSheet>
</template>

<style scoped>
/* 设置：一行一项，行与行之间只用统一的间距分开。
   开关行本身（含「不套卡片」那条规矩）在 `SwitchRow.vue` 里，这里只管纵向排布 ——
   分组会多出一段间距，所以所有开关都是 `.settings` 的直接子节点。 */
.settings {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
