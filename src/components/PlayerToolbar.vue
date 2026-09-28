<script setup>
/**
 * 底栏工具条：两个同高的胶囊（都靠右下角，按内容宽度，**不要铺满整行**，超宽只做横向滚动）
 *   普通模式：左胶囊 = 播放 / 跳转（小节.拍）/ 倍速 / 音频（播放放最左），右边圆形 = 进入编辑
 *   编辑模式：左边圆形 = 完成（深色模式下是深色样式），右边胶囊 = 行 / 小节线 / 段落 / 反复
 *  · 两个胶囊**同高同形，高度由内容决定** = 圆钮 46 + 上下 5px 内边距 + 1px 描边 ≈ 58（`--cap-h`）：
 *    `.capsule` **不设 height** —— 写死成 `height: var(--tap)` 时，box-sizing: border-box 下内容盒只剩
 *    46 − padding − 描边，46 的圆钮会被裁掉 1~2px。
 *  · **两个模式是同一对胶囊换内容**（左边 4 钮 ↔ 1 钮、右边反过来）：两套总宽完全一样，所以**只给两个
 *    胶囊的宽度做过渡**（`.capsule { transition: width }`）。宽度**必须显式算出来**（`.cap-w1` / `.cap-w4`：
 *    `n × --tap + (n−1) × --cap-gap + 2 × --cap-pad + 2px 描边`）—— 不定宽就是 auto、过渡不起来；
 *    为此内边距与间隔提成了令牌 `--cap-pad` / `--cap-gap`。**不要 fade、更不要 scale**（缩放会把图标和
 *    文字一起压扁）。两个胶囊是普通 / 编辑**共用的同一对节点**（只用 v-if 换里面的内容），否则节点一换
 *    宽度过渡就没了。
 *  · 胶囊里的按钮一律是**圆形** `.cap-btn`（46×46 = `--tap`，内容「上面大图标、下面小文字」）；
 *    **编辑 / 完成也在这条线上**（装在胶囊里的一个 `.cap-btn`，不再是自己发光的独立圆钮）。
 *    **页面上不再有「独立的圆形玻璃按钮」那套东西**（`.cap-circle` 已删）：单颗浮动按钮就是只有一个
 *    `.cap-btn` 的胶囊（见 PlayerView 的 `.back-dock`、Minimap 的 `.mini-dock`）。
 *  · **「显示按钮文字」这一个设置管全部三处胶囊**（底栏那对 / 左上「乐谱库」/ 右上总览三钮），
 *    外加乐谱库标题栏那颗「备份」圆钮（见下）：
 *    样式只有一份（`main.css` 的 `.no-labels .cap-label { display: none }`，全局类、不是 scoped），
 *    三个使用方各自绑 `:class="{ 'no-labels': !settings.showButtonLabels }"` 而已 —— **别在组件里各写一份**。
 *    那颗「备份」圆钮（`StorageMeter`）**不在胶囊里**、蹭不到这条全局规则，所以那边是
 *    组件自带一份 `.no-labels .label`、类名由 `LibraryPanel` 挂（见 `docs/ui.md` §16.4）。
 *    **没有例外、也不给关掉文字后的钮补 title**。圆钮本身恒为 46，所以胶囊宽度算式与 `--cap-h` 不受影响，
 *    `PdfViewer` 的 reservedTop 靠现成的 barsObserver 自动跟上。
 *  · **音频浮层**：没有音频时显示「导入音频文件」按钮（音乐音量条不显示），**但节拍器音量始终显示**
 *    （音量即开关，拉到 0 = 关，入口在这里）；有音频时再加上音乐音量与「设置音频起点」。
 *    这里的动作按钮（导入 / 设置起点 / 更换音频）**一行一个、各占满整行**，不并排
 *    （规范见 docs/ui.md §13「抽屉 = 面板」，`.audio-actions` 是纵向 flex）。
 *    **音量只管声音、不管播放**：`canPlay` 只看有没有东西可走（见 docs/concepts.md §3），播放键的 title
 *    也只在真没东西可走时才解释。
 *  · **再点一次已经选中的标记工具 = 打开「标记列表」**（`MarksPanel`，树形列出全谱的标记）。
 *    点的是**另一个**工具仍然只是切工具；面板开着时点任意一个工具都把它关掉。
 *    所以工具按钮的 `on` 高亮**只表示「现在在编辑哪一类」** —— 当前工具再点一次只是多弹一个列表，
 *    工具本身没变，高亮不该跟着灭（用户明确要求「开关面板不动工具」）。
 *  · **设置音频起点**：点开把浮层内容换成 `AudioOffsetPicker`（5 秒固定视野的频谱，不能缩放，中心竖线
 *    = 起点，拖动即时写入，带试听，底部只有「返回音频设置」）。页面拖入音频后由 `offsetRequest` 这个
 *    **计数器 prop**（不是布尔）驱动，直接落到这个界面 —— 连续导入两次也要每次都重新打开。
 *  · 撤销不在这里：删除后由 `PlayerView` 弹限时 banner 提供撤销。
 */
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import AppSheet from './AppSheet.vue'
import AudioOffsetPicker from './AudioOffsetPicker.vue'
import MarksPanel from './MarksPanel.vue'
import { t } from '../i18n/index.js'
import { EDIT_TOOLS, drawerOpen } from '../store/ui.js'
import { settings } from '../store/settings.js'
import {
  applyRate,
  applyVolume,
  canPlay,
  currentPos,
  importAudio,
  player,
  setCueVolume,
  setMetronomeVolume,
  silentPlayback,
  toggleMute,
  togglePlay,
} from '../store/player.js'

const emit = defineEmits(['goto', 'locate'])
/**
 * 外部（页面拖入音频）要求直接进「设置音频起点」时，每请求一次就把这个数 +1。
 * 用计数器而不是布尔值：连续导入两次音频也要每次都重新打开。
 */
const props = defineProps({
  offsetRequest: { type: Number, default: 0 },
  /** 「标记列表」开着没 —— 开合状态留在页面那一层，这里只管入口与显示 */
  marksOpen: { type: Boolean, default: false },
})

const RATES = [
  { value: 0.5, label: '0.5×' },
  { value: 0.6, label: '0.6×' },
  { value: 0.75, label: '0.75×' },
  { value: 0.9, label: '0.9×' },
  { value: 1, label: '1.0×' },
  { value: 1.1, label: '1.1×' },
  { value: 1.25, label: '1.25×' },
  { value: 1.5, label: '1.5×' },
  { value: 1.75, label: '1.75×' },
  { value: 2, label: '2.0×' },
]

const rateOpen = ref(false)
const audioOpen = ref(false)
const picking = ref(false)
const audioInput = ref(null)

// 页面拖入音频后直接落到「设置音频起点」，省掉「打开音频浮层 → 点设置起点」两步
watch(
  () => props.offsetRequest,
  (n) => {
    if (!n) return
    picking.value = true
    audioOpen.value = true
  }
)

async function onAudioPicked(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (file) await importAudio(file)
}

const startOffsetLabel = computed(() => {
  // 局部变量别叫 t，会把翻译函数遮住
  const sec = Number(player.meta.audio?.startOffset) || 0
  return `${sec.toFixed(2)}s`
})

// 小节位置按「小节.拍」显示：4.01 = 第 4 小节第 1 拍（拍号固定两位，见 schema.js 的 POSITION_SCALE）
const posText = computed(() => {
  const pos = currentPos.value
  if (!pos.no) return t('common.noValue')
  return `${pos.no}.${String(Math.max(1, Math.floor(pos.beat))).padStart(2, '0')}`
})
const rateText = computed(() => {
  const r = player.rate
  return `${Number.isInteger(r) ? r.toFixed(1) : String(r)}×`
})
const volumePct = computed(() => Math.round((player.muted ? 0 : player.volume) * 100))
const metronomePct = computed(() => Math.round((player.metronomeVolume || 0) * 100))
const cuePct = computed(() => Math.round((player.cueVolume || 0) * 100))

/** 播放键的提示语：没东西可走（没小节）时才解释为什么按不动 */
const playTitle = computed(() => (canPlay.value ? '' : t('toolbar.nothingToPlay')))

/**
 * 点一个标记工具：
 *   · 点的是**另一个**工具 → 切过去，并把这个列表关掉（列表说的是「全谱的标记」，它只是从那个工具进来的）；
 *   · 点的是**已经选中的那一个** → 切「标记列表」这个抽屉（再点一次 = 关）。
 *     **工具本身不动**：这个动作是「打开列表」，不是「退出这个工具」。
 *   · 列表开着时点任意一个工具都先把它关掉（抽屉是互斥的，切了工具更该收起来）。
 * 判据是「`marksOpen` 且抽屉此刻真的归它」（`drawerOpen`）：列表开着时又被别的面板顶掉的话，
 * 它其实已经收起来了 —— 这时再点当前工具应当是**重新打开**，而不是「再关一次」。
 */
function setTool(key) {
  const marksShown = props.marksOpen && drawerOpen.value
  if (player.tool === key) {
    emit('marks', !marksShown)
    return
  }
  // 换工具时**只在它真的开着**才发一次关闭 —— 别每次都发（页面那边会收到一串无意义的 false）
  if (marksShown) emit('marks', false)
  player.tool = key
}
</script>

<template>
  <div class="dock-row" :class="{ 'no-labels': !settings.showButtonLabels }">
    <!-- 普通 / 编辑是**同一对胶囊换内容**：左边那个在「4 个播放钮」与「1 个完成钮」之间换，
         右边反过来（编辑 ↔ 4 个标记工具）。
         两套排布的总宽**完全一样**（202 + 间隔 10 + 58），所以只给两个胶囊的**宽度**做过渡，
         就能看到它们互相让位 —— 不淡入淡出、更不缩放（scale 会把里面的图标和文字一起压扁）。
         宽度由 .cap-w4 / .cap-w1 按圆钮个数算出来：不写死宽度的话是 auto，过渡不起来。 -->
    <div class="capsule glass" :class="player.editMode ? 'cap-w1' : 'cap-w4'">
      <!-- 编辑模式：完成（也是一个装在胶囊里的圆钮，与另外四个同一套外观） -->
      <button v-if="player.editMode" type="button" class="cap-btn" :aria-label="t('toolbar.doneAria')" @click="player.editMode = false">
        <AppIcon name="check" :size="24" />
        <span class="cap-label">{{ t('common.done') }}</span>
      </button>

      <!-- 普通模式：播放 / 跳转 / 倍速 / 音频（播放放最左） -->
      <template v-else>
        <!-- 播放键的两种外观：
             · 能播（有小节）→ .cap-btn.primary，主题色实心 + --on-accent 图标。**有音频没音频都一样**
             · 没小节（canPlay 为假）→ .off，退回中性面 + 主题色图标，表示「没东西可播」
             判据是 canPlay，**不是 hasAudio** —— 没有音频文件照样能播（静音走带 / 只响节拍器） -->
        <button
          type="button"
          class="cap-btn primary"
          :class="{ off: !canPlay }"
          :disabled="!canPlay"
          :title="playTitle"
          :aria-label="player.playing ? t('toolbar.pause') : t('toolbar.play')"
          @click="togglePlay"
        >
          <AppIcon :name="player.playing ? 'pause' : 'play'" :size="24" />
          <span class="cap-label">{{ player.playing ? t('toolbar.pause') : t('toolbar.play') }}</span>
        </button>

        <button type="button" class="cap-btn" @click="emit('goto')">
          <span class="cap-value">{{ posText }}</span>
          <span class="cap-label">{{ t('toolbar.goto') }}</span>
        </button>

        <button type="button" class="cap-btn" @click="rateOpen = true">
          <span class="cap-value">{{ rateText }}</span>
          <span class="cap-label">{{ t('toolbar.rate') }}</span>
        </button>

        <button type="button" class="cap-btn" @click="audioOpen = true">
          <AppIcon :name="player.muted || player.volume === 0 ? 'volumeMute' : 'volume'" :size="21" />
          <span class="cap-label">{{ t('toolbar.audio') }}</span>
        </button>
      </template>
    </div>

    <div class="capsule glass" :class="player.editMode ? 'cap-w4' : 'cap-w1'">
      <!-- 编辑模式：行 / 小节线 / 段落 / 反复。
           `on` 只表示「现在在编辑哪一类」；**同一个再点一次 = 打开标记列表**（工具本身不动），
           所以这里的高亮只读 `player.tool`，不看列表开没开。
           提示语（`tool.hintKey`）挂在 title 上：它本来就是一句话说明这个工具怎么用，
           现在还得说明「再点一次会打开列表」——那句话就写在各自 hint 的末尾。 -->
      <template v-if="player.editMode">
        <button
          v-for="tool in EDIT_TOOLS"
          :key="tool.key"
          type="button"
          class="cap-btn edit-tool"
          :class="{ on: player.tool === tool.key }"
          :title="t(tool.hintKey)"
          @click="setTool(tool.key)"
        >
          <AppIcon :name="tool.icon" :size="21" />
          <span class="cap-label">{{ t(tool.labelKey) }}</span>
        </button>
      </template>

      <!-- 普通模式：进入编辑 -->
      <button v-else type="button" class="cap-btn" :aria-label="t('toolbar.editAria')" @click="player.editMode = true">
        <AppIcon name="edit" :size="24" />
        <span class="cap-label">{{ t('toolbar.edit') }}</span>
      </button>
    </div>

    <!-- 标记列表：**再点一次已经选中的标记工具**时弹出来的抽屉。
         开合状态在页面那一层（`marksOpen`），这里只负责入口与显示；定位请求往上传给 `PdfViewer` -->
    <MarksPanel :open="marksOpen" @close="emit('marks', false)" @locate="emit('locate', $event)" />

    <!-- 倍速：标题行图标 `gauge`（表盘）—— 这张表就是「播放多快」，与底栏那颗倍速钮指同一件事 -->
    <AppSheet :open="rateOpen" :title="t('toolbar.rateTitle')" icon="gauge" position="bottom" compact follow-layout panel-key="rate" @close="rateOpen = false">
      <div class="opt-list">
        <button
          v-for="r in RATES"
          :key="r.value"
          type="button"
          class="opt"
          :class="{ on: player.rate === r.value }"
          @click="applyRate(r.value); rateOpen = false"
        >
          <span class="spacer">{{ r.label }}</span>
          <AppIcon v-if="player.rate === r.value" name="check" :size="19" class="tick" />
        </button>
      </div>
    </AppSheet>

    <!-- 音频：没音频时是导入框；有音频时是音量 + 节拍器 + 设置起点（起点用频谱图选）。
         标题行图标**跟着标题走**（这张表有两个状态）：「音频」配 `music`、「设置音频起点」配 `target`
         —— 与里面那颗「设置起点」按钮同一个图标（面板换状态时图标不能停在旧意思上） -->
    <AppSheet
      :open="audioOpen"
      :title="picking ? t('toolbar.audioPanel.offsetTitle') : t('toolbar.audio')"
      :icon="picking ? 'target' : 'music'"
      position="bottom"
      follow-layout
      panel-key="audio"
      @close="audioOpen = false; picking = false"
    >
      <AudioOffsetPicker v-if="picking && player.hasAudio" @done="picking = false" />

      <div v-else class="audio">
        <!-- 只是一个按钮：只能点（拖入音频由 PlayerView 的整页拖放统一处理） -->
        <button v-if="!player.hasAudio" type="button" class="btn primary block" @click="audioInput.click()">
          <AppIcon name="upload" :size="20" /> {{ t('toolbar.audioPanel.import') }}
        </button>
        <p v-if="silentPlayback" class="small muted">{{ t('toolbar.audioPanel.noAudioHint') }}</p>

        <div v-if="player.hasAudio" class="audio-row">
          <div class="audio-label">
            <AppIcon :name="player.muted ? 'volumeMute' : 'volume'" :size="19" />
            <span>{{ t('toolbar.audioPanel.musicVolume') }}</span>
            <span class="mono pct">{{ volumePct }}%</span>
          </div>
          <div class="audio-ctl">
            <button type="button" class="icon-btn flat" :aria-label="player.muted ? t('toolbar.audioPanel.unmute') : t('toolbar.audioPanel.mute')" @click="toggleMute">
              <AppIcon :name="player.muted ? 'volumeMute' : 'volume'" :size="20" />
            </button>
            <input
              class="slider"
              type="range"
              min="0"
              max="100"
              :value="volumePct"
              @input="applyVolume($event.target.value / 100)"
            />
          </div>
        </div>

        <div class="audio-row">
          <div class="audio-label">
            <AppIcon name="metronome" :size="19" />
            <span>{{ t('toolbar.audioPanel.metronomeVolume') }}</span>
            <span class="mono pct">{{ metronomePct }}%</span>
          </div>
          <div class="audio-ctl">
            <input
              class="slider"
              type="range"
              min="0"
              max="100"
              :value="metronomePct"
              @input="setMetronomeVolume($event.target.value / 100)"
            />
          </div>
        </div>
        <div class="audio-row">
          <div class="audio-label">
            <AppIcon name="target" :size="19" />
            <span>{{ t('toolbar.audioPanel.cueVolume') }}</span>
            <span class="mono pct">{{ cuePct }}%</span>
          </div>
          <div class="audio-ctl">
            <input
              class="slider"
              type="range"
              min="0"
              max="100"
              :value="cuePct"
              @input="setCueVolume($event.target.value / 100)"
            />
          </div>
        </div>
        <p class="small muted">{{ t('toolbar.audioPanel.hint') }}</p>

        <template v-if="player.hasAudio">
          <hr class="divider" />
          <!-- 抽屉里一行只放一个动作按钮（docs/ui.md §13）：两颗各占一行，靠纵向 flex 撑满整行 -->
          <div class="audio-actions">
            <button type="button" class="btn ghost" @click="picking = true">
              <AppIcon name="target" :size="18" /> {{ t('toolbar.audioPanel.setStart') }}
            </button>
            <button type="button" class="btn ghost" @click="audioInput.click()">
              <AppIcon name="upload" :size="18" /> {{ t('toolbar.audioPanel.replace') }}
            </button>
          </div>
          <p class="small muted">{{ t('toolbar.audioPanel.currentStart', { value: startOffsetLabel }) }}</p>
        </template>
      </div>
      <input ref="audioInput" type="file" accept="audio/*" class="hidden-file" @change="onAudioPicked" />
    </AppSheet>
  </div>
</template>

<style scoped>
.dock-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}
/* 胶囊按内容宽度，不铺满整行；太窄时只收缩不换行。
   宽度要**参与过渡**（普通 ↔ 编辑时两个胶囊互换胖瘦），所以下面按圆钮个数把它算出来 ——
   auto 宽度是过渡不起来的。 */
.dock-row .capsule {
  flex: 0 1 auto;
  max-width: 100%;
  transition: width 0.22s var(--ease);
}
/* 胶囊宽度 = n 个圆钮 + (n−1) 个间隔 + 左右内边距 + 左右 1px 描边。
   尺寸全部取自令牌（--tap / --cap-pad / --cap-gap），改了 .capsule 的样式这里会跟着对；
   只有 .glass 的 1px 描边是写死的常量，所以按 2px 算。 */
.cap-w1 {
  width: calc(var(--tap) + 2 * var(--cap-pad) + 2px);
}
.cap-w4 {
  width: calc(4 * var(--tap) + 3 * var(--cap-gap) + 2 * var(--cap-pad) + 2px);
}
/* 设置里关掉「显示按钮文字」后只留图标 —— 规则是全局的（main.css 的 .no-labels），
   因为三处悬浮胶囊共用这一套；这里只挂类名，不再各写一份样式 */

/* 没小节（canPlay 为假）= 没东西可播：播放键退回中性面 + 主题色图标。
   它同时带 :disabled（main.css 里那条 opacity: 0.4），两者叠加才是最终的「灰掉」观感；
   注意这条**只在没小节时**生效 —— 没有音频文件是能播的，那时仍是主题色实心。 */
.cap-btn.off {
  background: var(--surface-control);
  color: var(--accent);
}
@media (hover: hover) {
  .cap-btn.off:hover {
    background: var(--accent-weak);
    color: var(--accent);
  }
}
.cap-btn.off:active {
  background: var(--accent-mid);
  color: var(--accent);
}

.audio {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
/* 面板里的动作按钮一行一个（docs/ui.md §13）：纵向 flex 里靠拉伸撑满整行即可，
   **别加 `.block`**（width: 100% 连同左右 margin 会溢出，见 docs/ui.md §14） */
.audio-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hidden-file {
  display: none;
}
.audio-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.audio-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-soft);
}
.audio-label .pct {
  margin-left: auto;
  color: var(--text-strong);
}
.audio-ctl {
  display: flex;
  align-items: center;
  gap: 10px;
}
.slider {
  flex: 1;
  height: var(--tap-min);
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}
.slider::-webkit-slider-runnable-track {
  height: 10px;
  border-radius: 999px;
  background: var(--surface-sunken);
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 30px;
  height: 30px;
  margin-top: -10px;
  border-radius: 50%;
  background: var(--text-strong);
  box-shadow: var(--shadow-1);
}
.slider::-moz-range-track {
  height: 10px;
  border-radius: 999px;
  background: var(--surface-sunken);
}
.slider::-moz-range-thumb {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 50%;
  background: var(--text-strong);
}
/* 滑杆悬停：滑块换成主题色，提示「这里能拖」（只换颜色，不动尺寸） */
@media (hover: hover) {
  .slider:hover::-webkit-slider-thumb {
    background: var(--accent);
  }
  .slider:hover::-moz-range-thumb {
    background: var(--accent);
  }
}
</style>
