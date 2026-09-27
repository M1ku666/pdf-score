<script setup>
/**
 * 右侧栏编辑面板：段落编辑器与反复编辑器共用的外壳。
 * 把两者重复的脚手架收在一处 ——
 *   · 用 player.drawer 判断开合（面板之间互斥）
 *   · AppSheet 的 right + followLayout（横屏贴侧栏位置弹出）
 *   · 表单纵排间距 .form
 *   · **只有一颗「删除」的 footer**
 * 具体字段由默认插槽提供，业务逻辑（set / del / 校验）留在各自组件里。
 *
 * **footer 里没有「完成」**（用户要求删掉，段落与反复两个面板一起去）：这颗钮和头部的 ×
 * 是同一个动作（`close()`，关闭只是导航、不代表放弃修改，见 docs/ui.md §8），
 * 留着它反而把「删除」挤成半行。现在「删除」独占整行（`.sheet-foot :deep(.btn)` 的 `flex: 1`）。
 * 不能删的对象（`canDelete` 为假，如「开头」段落）**连 footer 都不给** —— 免得留一条空的边框。
 */
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import AppSheet from './AppSheet.vue'
import { player } from '../store/player.js'
import { t } from '../i18n/index.js'

const props = defineProps({
  /** 与 player.drawer 的取值对应，决定这个面板是否打开 */
  drawer: { type: String, required: true },
  title: { type: String, default: '' },
  canDelete: { type: Boolean, default: false },
  /** 删除按钮的文字；默认就是通用的「删除」，工厂写法保证取的是当前语言 */
  deleteLabel: { type: String, default: () => t('common.delete') },
})

const emit = defineEmits(['delete'])

const open = computed(() => player.drawer === props.drawer)

function close() {
  player.drawer = null
}
</script>

<template>
  <AppSheet :open="open" :title="title" position="bottom" follow-layout :panel-key="drawer" @close="close">
    <div class="form">
      <slot />
    </div>

    <!-- footer 只在能删的时候才给：里面只有一颗「删除」（见文件头部注释）。
         关闭面板走头部的 × / Esc / 点遮罩 -->
    <template v-if="canDelete" #footer>
      <button type="button" class="btn danger" @click="emit('delete')">
        <AppIcon name="trash" :size="18" /> {{ deleteLabel }}
      </button>
    </template>
  </AppSheet>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
</style>
