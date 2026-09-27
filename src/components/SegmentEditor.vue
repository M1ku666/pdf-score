<script setup>
/**
 * 段落编辑侧边栏：名称 / BPM / 拍号 / 位置(小节.拍)
 * 外壳（开合、标题、footer）交给 EditorPanel，这里只提供字段与业务逻辑。
 *
 * **面板只有这四个字段，别无其它**（用户要求把「位置」下面那一整块、以及各栏的详细说明全删掉）：
 * 原来的 chip 摘要行、时间锚点一组按钮、时间轴 / 定位那块 `.info`、位置旁边那颗「用线位置」、
 * 拍号分母按钮右侧的箭头，都不在了。字段本身会说话 —— 说明文字挤在字段下面只是把面板撑长。
 *
 * 删掉的只是**入口**，不是数据：时间锚点 `seg.time` 仍在 schema 里、时间轴照样按它对齐
 * （`buildTimeline`），只是面板不再提供「取当前播放位置 / 清除」那两个按钮。
 *
 * **四个字段每个都独占一行**，宽度一律铺满面板：名称是 `.text-input`（`width: 100%`），
 * BPM 与位置是 `NumberPad` 的 `class="wide"`（`.nfield.wide`，与名称那条左右边界对齐），
 * 只有拍号那一行是「分子 + / + 分母」三个控件并排。数字框默认是窄框（要和别的控件并排），
 * 所以「占满一行」必须显式写 `class="wide"` —— 别把 `.nfield` 改成默认 100% 宽。
 */
import { computed, ref } from 'vue'
import ContextMenu from './ContextMenu.vue'
import EditorPanel from './EditorPanel.vue'
import NumberPad from './NumberPad.vue'
import {
  activeSegment,
  formatPosition,
  measureCount,
  normalizePositionText,
  removeSegment,
  updateSegment,
} from '../store/player.js'
import { toast } from '../store/ui.js'
import { t } from '../i18n/index.js'

const seg = computed(() => activeSegment.value)

// 位置是「小节.拍」：显示固定两位，输入时按文本规整（4.1 补成 4.01、4.10 才是第 10 拍）
const showPosition = (v) => (Number.isFinite(Number(v)) ? formatPosition(v) : '')
const fixPosition = (text, value) => normalizePositionText(text, value, seg.value?.beatsPerBar || 4)

function set(patch) {
  updateSegment(seg.value.id, patch)
}

/* ------------------------- 拍号分母：锚在按钮上的短单选 ------------------------- */
/* 分母只可能是 1 / 2 / 4 / 8 / 16（schema 的合法集合），用「排序方式」那套
   ContextMenu 直接列出来，比让人敲数字快，也不会敲出非法值。
   按钮上**只有那个数字**（原来右侧那颗箭头已删）：它长得就像 NumberPad 的框，
   点一下弹菜单这件事由 hover / 按下态表达，不必再挂一颗角标图标。 */
const UNIT_OPTIONS = [1, 2, 4, 8, 16]
const unitOpen = ref(false)
const unitAnchor = ref(null)
const unitItems = computed(() =>
  UNIT_OPTIONS.map((u) => ({ key: u, label: t('segment.unit.note', { unit: u }), checked: seg.value?.beatUnit === u }))
)

function openUnit(e) {
  const r = e.currentTarget.getBoundingClientRect()
  unitAnchor.value = { left: r.left, bottom: r.bottom }
  unitOpen.value = true
}

function onUnitPick(u) {
  set({ beatUnit: Number(u) })
}

function del() {
  removeSegment(seg.value.id)
  toast(t('segment.deleted'))
}
</script>

<template>
  <EditorPanel
    drawer="segment"
    :title="seg ? seg.name || (seg.head ? t('common.headSegment') : t('segment.title')) : ''"
    :can-delete="!!seg && !seg.head"
    :delete-label="t('segment.deleteLabel')"
    @delete="del"
  >
    <template v-if="seg">
      <div>
        <label class="field-label">{{ t('segment.name.label') }}</label>
        <input
          class="text-input"
          type="text"
          :value="seg.name"
          :placeholder="t('segment.name.placeholder')"
          @input="set({ name: $event.target.value })"
        />
      </div>

      <div>
        <label class="field-label">{{ t('segment.bpm.label') }}</label>
        <NumberPad
          :model-value="seg.bpm"
          :decimals="1"
          :min="20"
          :max="400"
          :step="1"
          title="BPM"
          :hint="t('segment.bpm.hint')"
          class="wide"
          @update:model-value="set({ bpm: $event })"
        />
      </div>

      <div>
        <label class="field-label">{{ t('segment.meter.label') }}</label>
        <div class="row">
          <NumberPad
            :model-value="seg.beatsPerBar"
            :min="1"
            :max="32"
            :title="t('segment.meter.beatsTitle')"
            :hint="t('segment.meter.beatsHint')"
            @update:model-value="set({ beatsPerBar: $event })"
          />
          <span class="slash">/</span>
          <!-- 分母是有限几个合法值，直接用排序那套上下文菜单选；按钮上只有那个数字 -->
          <button type="button" class="unit-btn" :title="t('segment.unit.title', { unit: seg.beatUnit })" @click="openUnit">
            <span class="unit-value mono">{{ seg.beatUnit }}</span>
          </button>
        </div>
      </div>

      <div>
        <label class="field-label">{{ t('segment.position.label') }}</label>
        <NumberPad
          :model-value="seg.head ? 1 : seg.position"
          :decimals="2"
          :min="1"
          :max="measureCount + 1"
          :step="0.01"
          :disabled="!!seg.head"
          :format="showPosition"
          :normalize="fixPosition"
          :title="t('segment.position.title')"
          :hint="t('segment.position.hint')"
          class="wide"
          @update:model-value="set({ position: $event })"
        />
      </div>

      <!-- 拍号分母：贴着按钮弹出的短单选菜单（与乐谱库的「排序方式」同一套） -->
      <ContextMenu
        :open="unitOpen"
        :items="unitItems"
        :anchor="unitAnchor"
        :title="t('segment.unit.menuTitle')"
        @select="onUnitPick"
        @close="unitOpen = false"
      />
    </template>
  </EditorPanel>
</template>

<style scoped>
.slash {
  font-size: 20px;
  color: var(--text-muted);
}
/* 拍号分母的触发钮：长得像 NumberPad 的输入框，但点开是菜单（按钮上只有那个数字） */
.unit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  min-height: var(--tap-min);
  padding: 0 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  border: 1px solid var(--stroke-strong);
  color: var(--text-strong);
  transition: border-color 0.15s ease, background 0.15s ease;
}
.unit-value {
  font-size: 16px;
  font-weight: 600;
}
@media (hover: hover) {
  .unit-btn:hover {
    background: var(--surface-hover);
    border-color: var(--accent-line);
  }
}
.unit-btn:active {
  background: var(--surface-active);
  border-color: var(--accent);
}
/* 这里原来有一条本地的 `.wide { flex: 1 }`：它既依赖调用方自己的类、
   又只在 flex 父容器里生效（BPM 那一栏的父级是普通 div，所以从来没铺满过），
   而且 `class` 当年根本落不到 `NumberPad` 的根元素上（见 NumberPad.vue 顶部那条注释）。
   现在「占满一行」是 NumberPad 自己的 `.nfield.wide` 一档，调用方只要写 `class="wide"`。 */
</style>
