<script setup>
/**
 * 「小节号」的 Sheet：**小节线工具点一条已有的线**就打开它（`player.barSheetId`），一张 Sheet 说一条线。
 * **点线不再直接删**（用户要求：以前那一下把线删掉了）—— 删挪到这张 Sheet 的 footer 里，
 * 于是那一下变成「看看 / 改改这条线的号」，删除是它里面一个说得出口的动作。
 * 开它的三个入口都算「点这条线」：**线本身、它正上方那个别针（📍）、它前面那一小节里的多休止记号**
 * （三块的命中判定都在 `ScorePage` 的 `hitBarZone` 里）。
 *
 *  · **正文只有那个数字框**，没有框外说明段落：这一屏只有一件事。单位「小节」写在框里
 *    （`NumberPad` 的 `unit`，见 docs/ui.md §18.23），偏移是怎么回事由谱面上那条多休止记号自己说。
 *  · **框里就是这条线的小节号**（谱上印的那个号）：数据里存的是**相对偏移**，
 *    换算只有 `store/player.js` 的 `setBarMeasure` 一处。**全谱只有这一套号**（见 `deriveStructure`），
 *    框里填 40，那一段就是 39 个真小节（时间轴上也是 39 个普通小节）。
 *  · **下限 = 前一条线的小节号 + 1**（键盘上那行范围就是「≥ N」）：用户要求「自定义的小节号不能
 *    小于等于前一条小节」。**填成本来那个号 = 把偏移清掉**（不是存一个 +1），所以改错了不用另找入口退回去。
 *  · 取不到前一条线时**框禁用**（`NumberPad` 的 disabled：整框降到 45% 不透明、点不开键盘）：
 *    全谱第一条活线没有前一条可参照；独线行里那些线**推不出小节号**，没有号可改。
 *    **footer 那颗删除照旧能点** —— 这两类线照样要能删。
 *  · **即改即生效**（docs/ui.md §8）：键盘上点「确定」/ 回车那一下落库（`NumberPad` 的 `change`），
 *    **没有「保存」按钮**；被拒绝时框自己弹回 meta 里那个号（它读的是 `barSheetInfo`）并弹一条 danger。
 *  · 外壳（开合、标题、**只有一颗删除的 footer**）全交给 `EditorPanel`（`drawer="bar"`），
 *    标题图标取 `EDIT_TOOLS` 里「小节线」那一颗 —— 与小节线工具同一颗，不另抄一个。
 */
import { computed } from 'vue'
import EditorPanel from './EditorPanel.vue'
import NumberPad from './NumberPad.vue'
import { barSheetInfo, closeBarSheet, removeBar, setBarMeasure } from '../store/player.js'
import { EDIT_TOOLS } from '../store/ui.js'
import { t } from '../i18n/index.js'

/** 这张 Sheet 说的那条线（`no` / `prevNo` / `editable` / `targetId` 全是现推的，见 store） */
const info = computed(() => barSheetInfo.value)
/** 标题行那颗图标 = 小节线工具那一颗 */
const icon = EDIT_TOOLS.find((x) => x.key === 'barline')?.icon || null
/** 下限：不能小于等于前一条线的小节号。禁用时给 1（只是别让框里出现 NaN） */
const min = computed(() => (info.value?.editable ? info.value.prevNo + 1 : 1))

/**
 * 删掉这条线（连带挂在它上面的段落与跳转记号，可撤销）+ 关掉这张 Sheet。
 * **先关再删**：删完那条线已经不在数据里了，Sheet 没有对象可指；撤销把线插回来时它也不自己弹出来
 * （用户要的是「删掉了」，不是「弹回来一张 Sheet」）。
 */
function onDelete() {
  const barId = info.value?.barId
  closeBarSheet()
  if (barId) removeBar(barId)
}
</script>

<template>
  <EditorPanel
    drawer="bar"
    :icon="icon"
    :title="t('bar.title')"
    can-delete
    :delete-label="t('bar.deleteLabel')"
    @delete="onDelete"
  >
    <div>
      <label class="field-label">{{ t('bar.measure') }}</label>
      <!-- `change`（键盘上「确定」/ 回车、上下箭头微调）就是这一次输入的提交点，没有保存按钮。
           值本身一直读 `info.no`（meta 现推），所以被拒绝时框自己就弹回去了 -->
      <NumberPad
        :model-value="info?.no ?? null"
        :min="min"
        :disabled="!info?.editable"
        :title="t('bar.measure')"
        :unit="t('unit.measure')"
        :hint="t('bar.hint')"
        size="lg"
        class="wide"
        @change="setBarMeasure"
      />
    </div>
  </EditorPanel>
</template>
