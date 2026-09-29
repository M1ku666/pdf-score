<script setup>
/**
 * 「备份」抽屉（点乐谱库标题栏那颗圆钮弹出来的那一屏）：**讲清东西存在哪、什么时候会没，
 * 并给一条把它们拿出来的路**。
 *
 * **内容区两块 + footer 一颗**（动作按钮一律放面板最底端，见 `docs/ui.md` §13 / §18.61）：
 *  1. **占用读数**：一行「左边『本地存储』、右边 `已占用 [/ 总额度]` 整块居右」+ 一条进度条。
 *     · **已占用是自己加出来的**（各张乐谱文件大小之和，`store/library.js` 的 `sizesTotal`），
 *       **不是**浏览器报的 `usage`（那个还含本 origin 其它存储）。**量完之前显示「统计中…」**，
 *       那时**进度条也不画**（还没算完 ≠ 几乎没占）。
 *     · **总额度拿不到就只显示已占用**，`/ …` 那段连斜杠一起不渲染，进度条也不画
 *       —— 不拿 `0 B` 顶上（那等于说「一共零字节」，是假信息）。
 *     · **两边字号相同**（`font-size` 只写在 `.amount` 上，里面两段都不再各写）——
 *       别把数字放成大标题，它与左边那个标签是同一句话的两半。
 *  2. **说明**：本地存储是怎么回事、什么情况下会被清掉、为什么备份能救回来。
 *     文案在 i18n 里，**刻意不含专有名词**（不写 IndexedDB / 持久化 / 配额这类词）。
 *  3. **「导出全部乐谱」在 footer**（面板最底端、不跟内容滚）：走使用方给的 `exportAll`
 *     （就是乐谱库「全选 + 导出」那一条），没有乐谱时禁用。
 *     形态照 footer 那一条规矩（docs/ui.md §18.61 第 168 条）：**实心底色 + 一颗 18px 图标**
 *     —— `.btn.primary` 主题色实心底 + `export`，**没有描边档**。
 *
 * **不自己读写存储、不自己导出**：`usage` / `exportAll` 都由使用方给，
 * 这样它挑不出第二套「量占用」「导出」的逻辑（见 docs/ui.md §14）。
 * **也不自己报进度**：「正在打包 i/n…」是 `exportScores` 那条**任务型 toast**（`store/library.js` → `store/toast.js`），
 * 这里不再放进度 —— 顶上那条任务型 toast 已经写着同一件事，再加一行小字就是第二套提示机制。
 *
 * 抽屉形态照 `AppSheet` 那一套：`follow-layout` + 唯一的 `panel-key`，
 * 竖屏整幅宽、横屏贴左边与侧栏同宽。内容里**没有分割线**，靠间距分组（与信息面板同一条规矩）。
 */
import { Database, SquareArrowRightExit } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import { formatBytes } from '../store/library.js'
import { t } from '../i18n/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /**
   * **已占用额度（字节）** —— 由使用方按 `sizes` 那个合计给（`store/library.js` 的 `sizesTotal`），
   * **不是**浏览器报的 `usage`。还没量完时传 `null`，这里显示「统计中…」。
   */
  usedBytes: { type: Number, default: null },
  /** 总额度（字节）；**null = 拿不到就不显示后面那段**（不要拿 0 顶上） */
  quotaBytes: { type: Number, default: null },
  /** 库里有没有乐谱（没有就把导出按钮禁掉） */
  hasScores: { type: Boolean, default: false },
  /** 导出全部乐谱：**复用乐谱库「全选 + 导出」那一条** */
  exportAll: { type: Function, default: null },
})
defineEmits(['close'])

/**
 * 进度条宽度的**可见下限**：真实占用比例常是 0.1%（几 MB / 10 GB），照原样画就是一条空的
 * —— 给一个下限，让「确实占了东西」看得出来。**与圆钮那个环同一个值、同一个道理**
 * （`StorageMeter` 的 `MIN_RATIO`）。
 */
const MIN_RATIO = 0.02

/** 有总额度、且已占用算得出来，才算得出比例；否则 null（那时不画进度条） */
const ratio = () => {
  const q = props.quotaBytes
  if (!Number.isFinite(q) || q <= 0) return null
  if (!Number.isFinite(props.usedBytes)) return null
  return Math.min(1, Math.max(0, props.usedBytes / q))
}
/**
 * 进度条宽度（%）：
 *  · **算不出比例就不画**（返回 null）—— 总额度不知道、或者**已占用还没算完**都算；
 *  · 非零占用走 `MIN_RATIO` 下限；真的一点没占就是 0（只留底轨、不画填充）。
 * ⚠️ **「还没算完」不能当成 0**：那会画出一条空进度条，等于在说「几乎没占」，
 * 而事实是「还不知道」—— 所以 `ratio()` 在那种情况下也要返回 null，别在这儿补 0。
 */
const pct = () => {
  const r = ratio()
  if (r === null) return null
  return (r <= 0 ? 0 : Math.max(MIN_RATIO, r)) * 100
}
/** 已占用那一半的字：还没量完就是「统计中…」（不是 0，也不是空白） */
const usedText = () => (Number.isFinite(props.usedBytes) ? formatBytes(props.usedBytes) : t('common.calculating'))
/** 「/ 总额度」那一半：拿不到就是空串，整段不渲染 */
const quotaText = () => (Number.isFinite(props.quotaBytes) && props.quotaBytes > 0 ? `/ ${formatBytes(props.quotaBytes)}` : '')
</script>

<template>
  <AppSheet
    :open="open"
    :title="t('library.storage.title')"
    :icon="Database"
    position="bottom"
    follow-layout
    panel-key="storage"
    @close="$emit('close')"
  >
    <div class="storage">
      <!-- 1. 占用读数：「本地存储」在左，`9.1 MB / 462 GB` 整块居右。
            · 左边那个数是**自己加出来的**（各张乐谱的文件大小之和），量完之前显示「统计中…」；
            · **总额度拿不到就只显示已占用**，后面那段 `/ …` 连斜杠一起不渲染
              —— 不拿 `0 B` 顶上（那是在说「一共零字节」，是假信息）。
            **两边字号相同**（都读 `.amount` 的 `font-size`）—— 别把数字放大成标题号，
            它和左边那个标签是同一句话的两半。数值用等宽体，数字变化时字宽不跳。 -->
      <div class="block">
        <div class="amount">
          <span class="label">{{ t('library.storage.localLabel') }}</span>
          <span class="value mono">
            {{ usedText() }} <span v-if="quotaText()" class="muted">{{ quotaText() }}</span>
          </span>
        </div>
        <div
          v-if="pct() !== null"
          class="meter"
          role="progressbar"
          :aria-valuenow="Math.round(pct())"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-label="t('library.storage.title')"
        >
          <i :style="{ width: pct() + '%' }" />
        </div>
      </div>

      <!-- 2. 说明：**整段是一条 key**（`note`，段间用 `\n` 分段、靠 `white-space: pre-line` 渲染） -->
      <div class="block">
        <p class="note">{{ t('library.storage.note') }}</p>
      </div>
    </div>

    <!-- 3. 导出全部：它是**动作按钮**，所以待在面板 footer（最底端、不跟内容滚），
         没有乐谱就禁用；抽屉里 footer 是纵向的，独占整行（docs/ui.md §13 / §18.61）。
         打包进度看顶部那条任务型 toast（`store/library.js` 的 `exportScores`），这里不重复显示 -->
    <template #footer>
      <button type="button" class="btn primary" :disabled="!hasScores" @click="exportAll?.()">
        <SquareArrowRightExit :size="18" /> {{ t('library.storage.exportAll') }}
      </button>
    </template>
  </AppSheet>
</template>

<style scoped>
/* 三块之间只用间距分开，**不画分割线**（与信息面板同一条规矩） */
.storage {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 读数一行：「本地存储」在左、数值整块**居右**。**两边字号统一成 14px** ——
   别把数字放成大标题，它与左边那个标签是同一句话的两半。
   `margin-left: auto` 把数值推到最右，不用 `justify-content: space-between`
   （那样两段会被顶到两头、中间空一大块；这里左边本来就贴着左边缘，两种写法在
   只有两项时看起来一样，但 `auto` 在以后加项时行为更明确）。 */
.amount {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 14px;
  line-height: 1.5;
}
.label {
  flex: none;
  color: var(--text-soft);
}
/* 数值整块靠右；里面的 `已用` 用正文色、" / 共 Y" 用弱化色 */
.value {
  margin-left: auto;
  color: var(--text-strong);
  white-space: nowrap;
}

/* 进度条：与页面底下那条 `.progress-line` 同一套观感，但**是这一屏自己的**（那条属于播放页，
   宽度 / 定位都绑在页面上）。轨道用下凹面、填充走主题色 */
.meter {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-sunken);
  overflow: hidden;
}
.meter > i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.3s var(--ease);
}

/* 说明文字：行距放宽一点。**整段是一条 key，段与段之间用 `\n`**，靠 `pre-line` 把它渲染出来 */
.note {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--text-soft);
  white-space: pre-line;
}
</style>
