<script setup>
/**
 * 跳转：输入小节与拍（九宫格键盘），或直接选择段落
 *
 * **面板里一行说明小字都不留**：这一屏的字就是「小节数」「当前小节」「段落名」「段落位置与 BPM」，
 * 两个数字框的框里已经带单位（见 docs/ui.md §18.23），再挂一行读数只是把面板撑高。
 *
 * **两个数字框不留框外 label**：单位写在**框里**数字的右侧（`NumberPad` 的 `unit`，见 docs/ui.md §18.23），
 * 框自己就是那一栏的说明 —— 「小节」「拍」两栏各自一眼可辨，再挂一行 `field-label` 只是把面板撑高。
 *
 * **没有「跳转」按钮**：键盘上点「确定」就直接跳（`NumberPad` 的 `confirm` 事件），
 * 所以 footer 整块不存在（面板最底端不再留一条空边）；点段落列表里的行照旧直接跳。
 */
import { computed, ref, watch } from 'vue'
import { MapPin } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import NumberPad from './NumberPad.vue'
import { currentPos, measureCount, positionBeat, positionMeasure, player, seekToPosition, segmentPositionLabel, timeline } from '../store/player.js'
import { comparePosition } from '../domain/schema.js'
import { tempoAt } from '../domain/timeline.js'
import { toast } from '../store/toast.js'
import { t } from '../i18n/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open', 'jump'])

const measure = ref(1)
const beat = ref(1)

watch(
  () => props.open,
  (v) => {
    if (v) {
      measure.value = currentPos.value.no || 1
      beat.value = Math.max(1, Math.floor(currentPos.value.beat || 1))
    }
  }
)

/**
 * 这一小节有几拍（= 拍那栏的上限）：**由时间轴问出来**，与谱面 / 段落用的是同一条规则
 * （`tempoAt`：这一小节起点生效的那个段落）。段落可以从小节中间换拍号，所以 beat 传 1。
 */
const beatsPerBar = computed(() => Math.max(1, Math.round(tempoAt(timeline.value.segments, measure.value || 1, 1).beatsPerBar || 4)))

/**
 * 「按段落跳转」只列出**有名字的**段落：没名字的段落在这里只是一行无法辨认的「第 N 小节」，
 * 反而把真正有语义的段落埋掉了（它们仍可从小节输入跳过去）。
 * **固定的「开头」段落是例外**（用户要求）：它删不掉、位置也钉死在 1，用户把名字清空之后
 * 一样要能从列表跳回开头 —— 所以它**不管有没有名字都在列表里**（没名字时见 `segmentLabel`）。
 * 别的段落没名字仍然不列。
 */
const segments = computed(() =>
  (player.meta.segments || [])
    .filter((s) => s.head || (Number.isFinite(s.measure) && String(s.name || '').trim()))
    .sort(comparePosition)
)

/**
 * 列表里那一行显示什么：**有名字写名字**；没名字的只有「开头」（别的没名字段落进不了列表）——
 * 它写 `common.headSegment`（就是「开头」两个字）。
 */
function segmentLabel(seg) {
  const name = String(seg?.name || '').trim()
  if (name) return name
  return t('common.headSegment')
}

function close() {
  emit('update:open', false)
}

/**
 * 「跳转浮层」的两种跳转**都走 `seekToPosition`** —— 它是手动跳转的唯一入口：
 * 位置（不传 nearTime = 取第一次出现，手动跳转「视作还没反复过」）、
 * 「跳转自动播放」、「跳转预备拍」（连带落点那几下闪烁）、「跳转后闪烁」全在里面。
 * 以前这里是自己拼 `posToTime` + `seek`：于是同一个「手动跳转」在谱面上点小节会打预备拍 / 会闪，
 * 从浮层跳却什么都不发生（`docs/ui.md` §18.42 第 114 条早把「跳转浮层」算在闪烁那一类里了）。
 */
function jump() {
  if (!measureCount.value) {
    toast(t('goto.noMeasures'))
    return
  }
  const no = Math.min(Math.max(1, Math.round(measure.value)), measureCount.value)
  const b = Math.min(Math.max(1, Math.round(beat.value)), beatsPerBar.value)
  // 注意：局部变量不能叫 t —— 会把 i18n 的翻译函数遮蔽掉
  seekToPosition(no, b - 1)
  emit('jump', no)
  close()
}

function jumpSegment(s) {
  // 段落位置就是「小节号 + 拍号」两个字段，换算成 0 起的拍偏移才是 seekToPosition 要的 beatOffset
  seekToPosition(positionMeasure(s), positionBeat(s) - 1)
  emit('jump', positionMeasure(s))
  toast(t('goto.jumped', { name: segmentLabel(s) }))
  close()
}
</script>

<template>
  <AppSheet :open="open" :title="t('goto.title')" :icon="MapPin" position="bottom" follow-layout panel-key="goto" @close="close">
    <div class="go">
      <label class="field-label">{{ t('goto.byBeat') }}</label>
      <div class="row">
        <!-- 两栏各自一个框，**单位写在框里数字的右侧**（`NumberPad` 的 `unit`，见 docs/ui.md §18.23）：
             这一行**没有框外 label**，框本身就是那一栏的说明。
             `.fld` 只为了分这一行：`.nfield` 是窄框（`inline-flex`），不套一层就只有内容那么宽。
             `@confirm` = 键盘上点「确定」那一下 —— 直接跳，不需要再点一颗按钮。 -->
        <div class="fld">
          <NumberPad
            v-model="measure"
            :min="1"
            :max="measureCount || 1"
            :title="t('unit.measure')"
            :unit="t('unit.measure')"
            size="lg"
            class="wide"
            @confirm="jump"
          />
        </div>
        <div class="fld">
          <NumberPad
            v-model="beat"
            :min="1"
            :max="beatsPerBar"
            :title="t('unit.beat')"
            :unit="t('unit.beat')"
            size="lg"
            class="wide"
            @confirm="jump"
          />
        </div>
      </div>

      <template v-if="segments.length">
        <label class="field-label">{{ t('goto.bySegment') }}</label>
        <div class="seg-list">
          <button v-for="s in segments" :key="s.id" type="button" class="seg-item" @click="jumpSegment(s)">
            <span class="dot" />
            <span class="seg-name">{{ segmentLabel(s) }}</span>
            <span class="seg-pos mono">{{ segmentPositionLabel(s) }}</span>
            <span class="seg-bpm mono">{{ s.bpm }} BPM</span>
          </button>
        </div>
      </template>
    </div>
  </AppSheet>
</template>

<style scoped>
.go {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.row {
  display: flex;
  gap: 12px;
}
/* 一栏 = 一个铺满的框（`.nfield.wide`）。**这一层是必须的**：`.nfield` 自己写死了窄框
   （`inline-flex` + `min-width: 76px`、给「和别的控件并排」用的），直接塞进 `.row` 会按内容宽度撑开、
   两个框不一样宽。单位字的外观由 `NumberPad` 的 `.unit` 自己给（见 docs/ui.md §18.23）。 */
.fld {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* `.wide` 不在这里定义：它是 `NumberPad` 自己的 `.nfield.wide`（占满父级宽度）。
   这里原来那条本地 `.wide { width: 100% }` 从来没生效过 —— `class` 当年落不到 NumberPad 的根元素上，
   见 NumberPad.vue 里的那条注释。 */
.seg-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.seg-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  text-align: left;
}
@media (hover: hover) {
  .seg-item:hover {
    background: var(--surface-hover);
  }
}
.seg-item:active {
  background: var(--surface-active);
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
}
.seg-name {
  flex: 1;
  font-size: 15px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seg-pos,
.seg-bpm {
  font-size: 12.5px;
  color: var(--text-muted);
}
</style>
