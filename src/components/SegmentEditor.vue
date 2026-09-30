<script setup>
/**
 * 段落编辑侧边栏：名称 / BPM / 拍号 / 位置（小节号 + 拍号）
 * 外壳（开合、标题、footer）交给 EditorPanel，这里只提供字段与业务逻辑。
 *
 * **面板只有这四个字段，别无其它**（用户要求把「位置」下面那一整块、以及各栏的详细说明全删掉）：
 * 原来的 chip 摘要行、时间锚点一组按钮、时间轴 / 定位那块 `.info`、位置旁边那颗「用线位置」、
 * 拍号分母按钮右侧的箭头，都不在了。字段本身会说话 —— 说明文字挤在字段下面只是把面板撑长。
 *
 * 删掉的只是**入口**，不是数据：时间锚点 `seg.time` 仍在 schema 里、时间轴照样按它对齐
 * （`buildTimeline`），只是面板不再提供「取当前播放位置 / 清除」那两个按钮。
 *
 * **每一栏都铺满面板的左右边界**：名称是 `.text-input`（`width: 100%`）、BPM 是 `NumberPad` 的
 * `class="wide"`（`.nfield.wide`），拍号与位置这两栏**都是 `.row` 里的两个 `.fld`**（`flex: 1` 平分行宽）：
 * 占满一行靠**外面那层 `.fld`** —— `.nfield` 自己还是窄框（`inline-flex` + `min-width: 76px`），
 * 直接塞进 `.row` 只有内容那么宽，所以「占满一行」要显式写 `class="wide"`、
 * 别把 `.nfield` 改成默认 100% 宽。拍号的分子与分母**一样宽**，两个框里的数字**都靠左**
 * （分母钮 `.unit-btn` 是 `justify-content: flex-start`，与 `.nfield` 同一条左边缘）。
 *
 * 拍号与位置这两栏的**单位都写在各自那个框里**（`NumberPad` 的 `unit`，见 docs/ui.md §18.23）：
 * label 只写栏名（`速度`、`位置`），框里是「数字 + 单位」、键盘上只有数字。
 */
import { computed, ref } from 'vue'
import { Flag } from '@lucide/vue'
import ContextMenu from './ContextMenu.vue'
import EditorPanel from './EditorPanel.vue'
import NumberPad from './NumberPad.vue'
import {
  activeSegment,
  measureCount,
  positionBeat,
  removeSegment,
  structure,
  updateSegment,
} from '../store/player.js'
import { measureStartBarId, segmentMeasure } from '../domain/timeline.js'
import { toast } from '../store/toast.js'
import { t } from '../i18n/index.js'

const seg = computed(() => activeSegment.value)

/**
 * 这一段落落在第几小节 —— **现推的**（`segmentMeasure`：它挂靠的那条小节线起头的那一小节）。
 * 「开头」段落永远算第 1 小节（`segmentBarId` 直接给它 `measures[0]`），取不到线时退回 1。
 */
const measure = computed(() => {
  if (!seg.value) return 1
  if (seg.value.head) return 1
  return segmentMeasure(structure.value, seg.value) ?? 1
})

function set(patch) {
  updateSegment(seg.value.id, patch)
}

/**
 * 改「第几小节」= 改挂哪条小节线：**第 `no` 小节起头的那条线**（`measureStartBarId`）。
 * 那条线取不到（`no` 越界）就什么都不改 —— 号与线一一对应，没有第三种可能。
 */
function setMeasure(no) {
  const barId = measureStartBarId(structure.value, no)
  if (barId) set({ barId })
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
}
</script>

<template>
  <EditorPanel
    drawer="segment"
    :icon="Flag"
    :title="t('segment.title')"
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
          :title="t('segment.bpm.label')"
          :unit="t('unit.bpm')"
          :hint="t('segment.bpm.hint')"
          class="wide"
          @update:model-value="set({ bpm: $event })"
        />
      </div>

      <div>
        <label class="field-label">{{ t('segment.meter.label') }}</label>
        <div class="row">
          <div class="fld">
            <NumberPad
              :model-value="seg.beatsPerBar"
              :min="1"
              :max="32"
              :title="t('segment.meter.beatsTitle')"
              :hint="t('segment.meter.beatsHint')"
              class="wide"
              @update:model-value="set({ beatsPerBar: $event })"
            />
          </div>
          <span class="slash">/</span>
          <!-- 分母是有限几个合法值，直接用排序那套上下文菜单选；按钮上只有那个数字。
               它跟分子**一样宽**（两半各是一个 `.fld`），框里的数字**靠左**（`justify-content: flex-start`），
               与分子框（`.nfield` 的数字贴左、单位贴右）同一条左边缘。 -->
          <div class="fld">
            <button type="button" class="unit-btn" :title="t('segment.unit.title', { unit: seg.beatUnit })" @click="openUnit">
              <span class="unit-value mono">{{ seg.beatUnit }}</span>
            </button>
          </div>
        </div>
      </div>

      <div>
        <label class="field-label">{{ t('segment.position.label') }}</label>
        <!-- 位置 = **两个框**（小节号 / 拍号），与跳转面板的「小节 · 拍」同一套写法：
             单位**写在各自那个框里、数字的右侧**（`NumberPad` 的 `unit`）、label 只写栏名「位置」，
             两个框自己也不挂 label、不写 hint —— 拍号的上限就是这一段落自己的拍数
             （`NumberPad` 会把取值范围显示在键盘上）。
             原来那句「小节.拍：4.03 = 第 4 小节第 3 拍」是给一个框装两件事时用的，
             两个框各装一件事之后它就没有意义了。 -->
        <div class="row">
          <div class="fld">
            <!-- 小节号上限 = **真正有小节的范围**（`measureCount`）：再往右就是曲末那条线，
                 段落落在那里没有位置可落、标记会整条不画（`segmentMeasure` 返回 null）。
                 这个框里是**号**，写回的是「第 N 小节起头的那条小节线」（`setMeasure`）——
                 数据里存的一直是线，号是现推出来给用户看的。 -->
            <NumberPad
              :model-value="seg.head ? 1 : measure"
              :min="1"
              :max="Math.max(1, measureCount)"
              :disabled="!!seg.head"
              :title="t('unit.measure')"
              :unit="t('unit.measure')"
              class="wide"
              @update:model-value="setMeasure"
            />
          </div>
          <div class="fld">
            <NumberPad
              :model-value="seg.head ? 1 : positionBeat(seg)"
              :min="1"
              :max="seg.beatsPerBar || 4"
              :disabled="!!seg.head"
              :title="t('unit.beat')"
              :unit="t('unit.beat')"
              class="wide"
              @update:model-value="set({ beat: $event })"
            />
          </div>
        </div>
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
/* 拍号分母的触发钮：长得像 NumberPad 的输入框，但点开是菜单（按钮上只有那个数字）。
   宽度铺满父级 `.fld`（与分子**一样宽**），框里的数字靠左 —— 这两条都跟分子框对齐
   （框里的内容一律靠左，框里没有单位就不该有靠右的东西，见 docs/ui.md §3.3），
   两框并列时才不会一个数字靠左、一个靠右 */
.unit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
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
/* `.row` 里的一栏：一人一半、中间的间隔用全局 `.row` 的 `gap`（与跳转面板同一套）。
   `min-width: 0` 是必须的 —— flex 子项默认不肯缩到内容宽度以下，窄侧栏里两个框会一起顶出去。
   拍号（分子 / 分母一样宽）与位置（两个框一样宽）这两栏都用它。 */
.fld {
  flex: 1;
  min-width: 0;
}
/* 这里原来有一条本地的 `.wide { flex: 1 }`：它既依赖调用方自己的类、
   又只在 flex 父容器里生效（BPM 那一栏的父级是普通 div，所以从来没铺满过），
   而且 `class` 当年根本落不到 `NumberPad` 的根元素上（见 NumberPad.vue 顶部那条注释）。
   现在「占满一行」是 NumberPad 自己的 `.nfield.wide` 一档，调用方只要写 `class="wide"`。 */
</style>
