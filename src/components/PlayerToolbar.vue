<script setup>
/**
 * 底栏工具条：两个同高的胶囊（都靠右下角，按内容宽度，**不要铺满整行**，超宽只做横向滚动）
 *   普通模式：左胶囊 = 播放 / 跳转（小节.拍）/ 倍速 / 音频（播放放最左），右边圆形 = 进入编辑
 *   编辑模式：左边圆形 = 完成（深色模式下是深色样式），右边胶囊 = 行 / 小节线 / 段落 / 跳转
 *  · 两个胶囊**同高同形，高度由内容决定** = 圆钮 46 + 上下 5px 内边距 + 1px 描边 ≈ 58（`--cap-h`）：
 *    `.capsule` **不设 height** —— 写死成 `height: var(--tap)` 时，box-sizing: border-box 下内容盒只剩
 *    46 − padding − 描边，46 的圆钮会被裁掉 1~2px。
 *  · **这两个胶囊的投影朝上**（`--shadow-2-up`，要求原文：「下工具栏的阴影改为向上」）——
 *    玻璃配方的其余部分（底色 / 16px 模糊 / 弱描边）仍走全局 `.glass`；⚠️ **别去改 `.glass` 本身**
 *    （toast / 左上「乐谱库」/ 右上总览 / 右键菜单都叠加着它，那几处的投影仍是 `--shadow-2`）。
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
 *  · **跳转那颗的数值是「小节.拍」两段拼的**（`pos` 那个 computed + 模板里的三个 span）：
 *    圆钮宽死 46，而拍号跟着小节号一起涨 —— 整串一个字号时三位小节号就顶破圆钮（还会在 `·`
 *    两侧的空格处折行）。所以**小节号留全尺寸、分隔符与拍用小一档**（`--cap-pos-sub`），
 *    分隔符是 `.` 不是 `·`（没有空格 = 没有断行机会）；次级那两段的**底端与整数段齐平**
 *    （`center` 不动、只把这两段自己往下挪一点，见 `main.css` 那条注释）。别把这三段合回一个字符串，
 *    也别给这个圆钮留 `·` —— 原因与实测数字写在 `docs/ui.md` §18.56。
 *  · **「显示按钮文字」这一个设置管全部三处胶囊**（底栏那对 / 左上「乐谱库」/ 右上总览三钮），
 *    外加乐谱库标题栏那颗「备份」圆钮（见下）：
 *    样式只有一份（`main.css` 的 `.no-labels .cap-label { display: none }`，全局类、不是 scoped），
 *    三个使用方各自绑 `:class="{ 'no-labels': !settings.showButtonLabels }"` 而已 —— **别在组件里各写一份**。
 *    那颗「备份」圆钮（`StorageMeter`）**不在胶囊里**、蹭不到这条全局规则，所以那边是
 *    组件自带一份 `.no-labels .label`、类名由 `LibraryPanel` 挂（见 `docs/ui.md` §16.4）。
 *    **没有例外、也不给关掉文字后的钮补 title**。圆钮本身恒为 46，所以胶囊宽度算式与 `--cap-h` 不受影响，
 *    `PdfViewer` 的 reservedTop 靠现成的 barsObserver 自动跟上。
 *  · **倍速浮层：内容区是「预设」列表 → 「自定义历史」，footer 里是「自定义」框 + 「清空历史」**。
 *    两段都是同一套 `.opt` 单选项（同款尺寸、同款勾、点一下即应用并关面板）：
 *    上面是 `RATES`（0.5 / 0.75 / 0.9 / 1.0），下面是历史（最多 `RATE_HISTORY_MAX` 条，
 *    存在 `player.rateHistory` 里）；框是 `NumberPad`、放在面板的 `#footer` 插槽里
 *    （**钉在最底端、不跟内容滚**，单位写在框里，取自 `unit.rate`，见 docs/ui.md §18.23）。
 *    三者与「谁记进历史」的规矩见 docs/ui.md §18.65。
 *    **历史行里没有删除入口**（要求原文：「直接把删除按钮去掉，沿用预设里面的样式」）——
 *    要清就按框下面那颗「清空历史」（中性实心底 `.btn` + `trash`；**不是危险色**、
 *    **不弹确认**、**也不是 `ghost`** —— footer 里的按钮一律实心底 + 18px 图标，
 *    见 docs/ui.md §13 / §18.61），别再往行里加删除图标。
 *    要再加预设先想清楚它该不该进列表：**「填一个别的值」这条路已经在框里了**。
 *    **只有框里那个单位走语言包**（要求原文：「只有框里的单位用语言包，其他地方还是写死」）：
 *    两段列表的读数与底栏那颗倍速钮的读数都还是写死的 `0.5×` 这种
 *    （都是 `rateLabel()` 从值算出来的，不是文案）。
 *  · **音频浮层**：没有音频时显示「导入音频文件」按钮（音乐音量条不显示），**但节拍器音量始终显示**
 *    （音量即开关，拉到 0 = 关，入口在这里）；有音频时再加上音乐音量与「设置音频起点」。
 *    **那个选音频的输入框上不写 `accept`**（iPadOS 的文件选择器会按类型把非 PDF 的文件灰掉、
 *    点不动，见 docs/ui.md §18.21）：类型在 `onAudioPicked` 里判，不对就报「不支持的文件」。
 *    这里的动作按钮（导入 / 更换音频 / 设置起点）**都在面板的 footer（最底端、不跟内容滚）**，
 *    抽屉里 footer 是纵向的，所以它们**一行一个、各占满整行**，不并排
 *    （规范见 docs/ui.md §13 / §18.42 / §18.61）。**每颗都是实心底色 + 18px 图标**：
 *    「导入音频」是 `.btn.primary`，其余几颗中性 `.btn` —— footer 里没有描边档。
 *    这一屏的 footer 有两个状态，见下面「设置音频起点」那一条。
 *    **音量只管声音、不管播放**：`canPlay` 只看有没有东西可走（见 docs/concepts.md §3），播放键的 title
 *    也只在真没东西可走时才解释。
 *  · **音量那三行：一行文字 + 一条整行宽的滑杆，图标一个都不画**（要求原文：「全掉图标」）——
 *    标签自带文字，前面再挂个喇叭 / 节拍器 / 准星只是把同一件事说两遍。
 *    **静音按钮也去掉了**：音量拉到 0 就是静音，与节拍器 / 预备拍那两条一致。
 *  · **音频面板本体也不留说明小字**：三行音量（各自带百分比）与 footer 那几颗按钮就是这一屏的全部，
 *    再挂一行「节拍器音量与预备拍音量拉到 0 就是关闭……」只是把面板撑高。
 *  · **音频入口那颗圆钮的图标恒为普通喇叭**（要求原文：「音频图标不要根据音量发生变化」）：
 *    它只是「这里是音频面板」的入口标识，不看 `player.muted`、也不看 `player.volume === 0`。
 *    **面板里已经没有第二颗喇叭了**（上面那条把静音钮去掉之后），所以这条现在不会跟谁打架。
 *  · **三条音量滑杆共用 `.slider`**：细药丸轨道（两端圆）+ 已填充段走主题色 + **白色长条胶囊把手**
 *    （模板按百分比给 `--fill`）。形态与三态写法见下面那段块注释。
 *  · **再点一次已经选中的标记工具 = 打开「标记列表」**（`MarksPanel`，树形列出全谱的标记）。
 *    点的是**另一个**工具仍然只是切工具；面板开着时点任意一个工具都把它关掉。
 *    所以工具按钮的 `on` 高亮**只表示「现在在编辑哪一类」** —— 当前工具再点一次只是多弹一个列表，
 *    工具本身没变，高亮不该跟着灭（用户明确要求「开关面板不动工具」）。
 *  · **跳转那颗图标恒为 `Route`**：不跟着「有没有待定的起点」换脸（`store/ui.js` 里也没有
 *    `toolIcon()` 了）—— 「起点落下了没有」只由谱面上那条**虚线**表达。
 *  · **设置音频起点**：点开把浮层内容换成 `AudioOffsetPicker`（5 秒固定视野的频谱，不能缩放，中心竖线
 *    = 起点，拖动即时写入，带试听）。页面拖入音频后由 `offsetRequest` 这个**计数器 prop**（不是布尔）驱动，
 *    直接落到这个界面 —— 连续导入两次也要每次都重新打开。
 *    **这一屏的「试听」「返回音频设置」也由本组件的 footer 渲染**（动作按钮一律在面板最底端，
 *    见 docs/ui.md §13 / §18.42）：试听那套逻辑**在 store 里**（`startPreview` / `stopPreview`，
 *    见 `store/player.js`），这里只经 `picker` 这个模板 ref 调它 `defineExpose` 出来的
 *    `previewing` / `togglePreview` / `done` —— 别把同一套试听逻辑抄到外面来。
 *  · 撤销不在这里：删除后由 `PlayerView` 弹限时 banner 提供撤销。
 */
import { computed, ref, watch } from 'vue'
import { Check, ChevronLeft, SquareArrowRightEnter, Gauge, MapPin, Pause, PencilLine, Play, RotateCcw, Trash, Volume2 } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import AudioOffsetPicker from './AudioOffsetPicker.vue'
import MarksPanel from './MarksPanel.vue'
import NumberPad from './NumberPad.vue'
import { t } from '../i18n/index.js'
import { isAudioFile } from '../store/library.js'
import { EDIT_TOOLS, drawerOpen } from '../store/ui.js'
import { settings } from '../store/settings.js'
import {
  RATE_MAX,
  RATE_MIN,
  applyCustomRate,
  applyRate,
  applyVolume,
  canPlay,
  clearRateHistory,
  currentPos,
  finishEdit,
  importAudio,
  player,
  setCueVolume,
  setMetronomeVolume,
  stopPreview,
  togglePlay,
} from '../store/player.js'
import { dangerToast, errorToast, errText } from '../store/toast.js'

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

/**
 * 倍速面板最上面那列常用档。**别的倍速不在这里加行**：自己填的那个框就在这列下面。
 * `label` 是**写死**的（要求原文：「只有框里的单位用语言包，其他地方还是写死」）——
 * 走语言包的只有下面那个框的 `unit`。
 */
const RATES = [
  { value: 0.5, label: '0.5×' },
  { value: 0.75, label: '0.75×' },
  { value: 0.9, label: '0.9×' },
  { value: 1, label: '1.0×' },
]

/**
 * 历史里的一条怎么读（`1.15×` / `2.0×` 这样）：**从值算出来、写死在组件里**，与上面 `RATES`
 * 的 `label` 同一个规矩（只有框里的单位走语言包）。
 * 写法与底栏那颗倍速钮的读数**逐字同一套**（`rate` 那个 computed）：整数补一位小数（`2×` → `2.0×`，
 * 要求原文：「整数补齐到一位小数」）、最多两位小数，于是「列表 / 历史 / 底栏」三处的读数一致。
 */
function rateLabel(r) {
  return `${Number.isInteger(r) ? r.toFixed(1) : String(r)}×`
}

/** 上下箭头微调的步长：0.05 正好能走到列表里的 0.75 / 0.9 这两档 */
const RATE_STEP = 0.05

const rateOpen = ref(false)
const audioOpen = ref(false)
const picking = ref(false)
const audioInput = ref(null)
/**
 * 「设置音频起点」那一屏的组件实例。它的动作按钮由本组件的 footer 渲染，所以要从这儿调它
 * `defineExpose` 出来的 `previewing` / `togglePreview` / `done`（试听逻辑只留在它自己那边）。
 */
const picker = ref(null)

// 页面拖入音频后直接落到「设置音频起点」，省掉「打开音频浮层 → 点设置起点」两步
watch(
  () => props.offsetRequest,
  (n) => {
    if (!n) return
    picking.value = true
    audioOpen.value = true
  }
)

/**
 * 「导入音频 / 更换音频」选完文件：**先自己认一遍类型**，再交给 `importAudio`。
 *
 * ⚠️ **这道判断不能省**（输入框上不写 `accept`，见文件头那条说明）：`importAudio` 是**先落库再解码**的
 * （`db.putFile(id, 'audio', …)` 在前、`ensurePeaks()` 在后），把 PDF 或别的文件放进去，
 * 会先给这份谱写进一个根本放不出来的音频、`hasAudio` 也变成真，然后才在解码那步炸掉 —— 等于弄坏数据。
 *
 * 失败也要就地报一条（与页面拖入音频那条 `runAudioImport` 同一句话）：这里是页面外**唯一**的音频入口，
 * 不接住的话（例如文件坏了、编解码不支持）调用方没人管，用户只会看到「点了没反应」。
 */
async function onAudioPicked(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!isAudioFile(file)) {
    dangerToast(t('view.toast.unsupportedFile', { name: file.name }))
    return
  }
  try {
    await importAudio(file)
  } catch (err) {
    errorToast(t('view.errors.audioFailed', { msg: errText(err) }))
  }
}

/**
 * 音频面板收起来（点遮罩 / × / Esc / 返回手势 / 被别的面板顶掉 —— 都走 `AppSheet` 的 `close()`）：
 * **正在放的试听当刻停**（要求原文：「弹窗关闭也要停止试听」）。
 *
 * 为什么要在这儿显式停一次：抽屉退场还有一段过渡，那一屏的组件要等过渡结束才卸载，
 * 光靠它 `onBeforeUnmount` 里那次兜底，声音会跟着多响半拍。
 * 两次调用的是同一个 `stopPreview()`（幂等），**不是第二套停止逻辑**。
 */
function closeAudioSheet() {
  stopPreview()
  picking.value = false
  audioOpen.value = false
}

/**
 * 底栏那颗小字：**当前播放到哪一小节的第几拍**。
 * 位置在数据里就是两个字段（`measure` / `beat`），这里显示的是**播放头**的位置，那两段都不是整数（拍还带小数）。
 *
 * **两段分开渲染**（模板里是三个 span），并且**只有小节号用 `.cap-value` 的全尺寸** ——
 * 圆钮宽是死的 46（`--tap`）：整串一个字号时三位小节号必然顶破圆钮
 * （实测 15px 下 `139 · 1` = 52.53px，还会在 `·` 两侧的空格处**折成两行**）。
 * 分隔符与拍改小一档之后，按下面这个上限算出来的最坏用例 `999.99` 也只在 46 附近
 * （`139.12` = 45.05px，实测表见 `docs/ui.md` §18.56）。
 *
 * **小节号显示封顶 999**（要求原文：「999以上就显示999就行」）：只夹**显示**，
 * 不动播放头、也不动跳转目标 —— 它只是这颗钮上的一串字。
 * 有了这个上限，「数值太长」这件事就不再需要按位数分档了，拍也固定按两位以内算。
 */
const POS_MAX = 999
const pos = computed(() => {
  const p = currentPos.value
  if (!p.no) return { whole: t('common.noValue') }
  return {
    whole: '',
    head: String(Math.min(p.no, POS_MAX)),
    sub: String(Math.max(1, Math.floor(p.beat))),
  }
})
/**
 * 倍速读数，**与跳转那颗同一套写法**（要求原文：「把倍速的小数部分样式也统一成跳转那样」）：
 * `.` 与小数缩小一档（`.sub`）、整数与 `×` 留全尺寸。
 * 拆法不按中文习惯用正则切「小数部分」：小数可能一位也可能两位（`1.25×`），
 * 所以直接切**第一个点**——点前面是整数、点后面（含 `×`）是次级那一段。
 * 这样 `1.0×` 得到「1」+「.」+「0×」，与跳转的「137」+「.」+「1」结构完全一致。
 * 没有小数点（`2×`，整数倍速）时直接走 `whole`，不拆。
 */
const rate = computed(() => {
  const r = player.rate
  const text = `${Number.isInteger(r) ? r.toFixed(1) : String(r)}×`
  const dot = text.indexOf('.')
  if (dot < 0) return { whole: text }
  return { whole: '', head: text.slice(0, dot), sub: text.slice(dot + 1) }
})
// 音乐音量不再有静音钮：读数就是 `player.volume` 本身（拉到 0 = 静音，`applyVolume` 自己会置 `player.muted`）
const volumePct = computed(() => Math.round((player.volume || 0) * 100))
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
      <!-- 编辑模式：完成（也是一个装在胶囊里的圆钮，与另外四个同一套外观）。
           **这是编辑模式唯一的出口**（`finishEdit`）：Esc 与返回手势都不退编辑模式。 -->
      <button v-if="player.editMode" type="button" class="cap-btn" :aria-label="t('toolbar.doneAria')" @click="finishEdit">
        <Check :size="21" />
        <span class="cap-label">{{ t('common.done') }}</span>
      </button>

      <!-- 普通模式：播放 / 跳转 / 倍速 / 音频（播放放最左） -->
      <template v-else>
        <!-- 播放键的两种外观：
             · 能播（有小节）→ .cap-btn.primary，主题色实心 + --on-accent 图标。**有音频没音频都一样**
             · 没小节（canPlay 为假）→ .off，退回中性面 + 主题色图标，表示「没东西可播」
             判据是 canPlay，**不是 hasAudio** —— 没有音频文件照样能播（静音走带 / 只响节拍器）
             `play` 这个额外类名只为**把三角与竖条填实**（见样式里那条 `.cap-btn.play > .lucide`）：
             `@lucide/vue` 里 Play / Pause 都只有描边版、没有 fill 变体，所以实心只能靠 CSS 盖掉。 -->
        <button
          type="button"
          class="cap-btn primary play"
          :class="{ off: !canPlay }"
          :disabled="!canPlay"
          :title="playTitle"
          :aria-label="player.playing ? t('toolbar.pause') : t('toolbar.play')"
          @click="togglePlay"
        >
          <component :is="player.playing ? Pause : Play" :size="21" />
          <span class="cap-label">{{ player.playing ? t('toolbar.pause') : t('toolbar.play') }}</span>
        </button>

        <!-- 跳转：数值是「小节.拍」两段拼的（「.」与拍小一档，见 pos 那个 computed）。
             空态（还没有小节）是一整个 `common.noValue`，不拆 -->
        <button type="button" class="cap-btn" @click="emit('goto')">
          <span v-if="pos.whole" class="cap-value">{{ pos.whole }}</span>
          <span v-else class="cap-value split"
            ><span>{{ pos.head }}</span><span class="point">.</span><span class="sub">{{ pos.sub }}</span></span
          >
          <span class="cap-label">{{ t('toolbar.goto') }}</span>
        </button>

        <!-- 倍速：与跳转**同一套写法**（`.` 与小数走 .sub）—— 两处都是「数值」那一档文字，
             拆法与字号只有这一份规矩（见 rate 那个 computed 与 main.css 的 .cap-value.split） -->
        <button type="button" class="cap-btn" @click="rateOpen = true">
          <span v-if="rate.whole" class="cap-value">{{ rate.whole }}</span>
          <span v-else class="cap-value split"
            ><span>{{ rate.head }}</span><span class="point">.</span><span class="sub">{{ rate.sub }}</span></span
          >
          <span class="cap-label">{{ t('toolbar.rate') }}</span>
        </button>

        <button type="button" class="cap-btn" @click="audioOpen = true">
          <!-- 图标**恒为普通喇叭**，不跟音量 / 静音变（要求原文：「音频图标不要根据音量发生变化」）：
               它是「这里是音频面板」这个入口的标识，不是音量表 —— 音量看面板里那行百分比与滑杆的填充。
               面板里的音量行现在一个图标都不画（见下面那条注释），全项目只剩它这一颗喇叭。 -->
          <Volume2 :size="21" />
          <span class="cap-label">{{ t('toolbar.audio') }}</span>
        </button>
      </template>
    </div>

    <div class="capsule glass" :class="player.editMode ? 'cap-w4' : 'cap-w1'">
      <!-- 编辑模式：行 / 小节线 / 段落 / 跳转。
           `on` 只表示「现在在编辑哪一类」；**同一个再点一次 = 打开标记列表**（工具本身不动），
           所以这里的高亮只读 `player.tool`，不看列表开没开。
           四颗钮**不挂 `title` 提示**。 -->
      <template v-if="player.editMode">
        <button
          v-for="tool in EDIT_TOOLS"
          :key="tool.key"
          type="button"
          class="cap-btn edit-tool"
          :class="{ on: player.tool === tool.key }"
          @click="setTool(tool.key)"
        >
          <!-- 图标 = `EDIT_TOOLS` 里那一项自己带的 Lucide 组件（见 `store/ui.js` 与文件头注释） -->
          <component :is="tool.icon" :size="21" />
          <span class="cap-label">{{ t(tool.labelKey) }}</span>
        </button>
      </template>

      <!-- 普通模式：进入编辑 -->
      <button v-else type="button" class="cap-btn" :aria-label="t('toolbar.editAria')" @click="player.editMode = true">
        <PencilLine :size="21" />
        <span class="cap-label">{{ t('toolbar.edit') }}</span>
      </button>
    </div>

    <!-- 标记列表：**再点一次已经选中的标记工具**时弹出来的抽屉。
         开合状态在页面那一层（`marksOpen`），这里只负责入口与显示；定位请求往上传给 `PdfViewer` -->
    <MarksPanel :open="marksOpen" @close="emit('marks', false)" @locate="emit('locate', $event)" />

    <!-- 倍速：标题行图标 `gauge`（表盘）—— 这张表就是「播放多快」，与底栏那颗倍速钮指同一件事。
         面板形态：内容区是**「预设」列表 → 「自定义历史」**，**自己填的框在 footer**（要求原文：
         「把自定义框放footer里，预设列表顶加个预设两字。整数补齐到一位小数」）——
         列表只有 0.5 / 0.75 / 0.9 / 1.0 四档；框用 `NumberPad`（全项目唯一的数字输入框，
         见 docs/ui.md §18.22），单位取自 `unit.rate`、写在框里数字的右侧；
         **只有这个框的单位走语言包**，列表那四档仍是写死的 `0.5×`。
         框放 footer 等于**钉在面板最底端、不跟内容滚**：历史涨到五条时它照样露在外面，
         不用先滚到底再填（这也是它唯一的理由，见 docs/ui.md §18.65）。
         落地三条：**改动经 `update:model-value` 即改即生效**（所以上下箭头微调也能一边看谱一边试）、
         **只有「确定 / 回车」那一下才关面板**（`confirm`，与列表点一下就关的手感对齐）、
         **框走 `applyCustomRate`**（与列表用的 `applyRate` 只差「顺手记进历史」这一步）。 -->
    <AppSheet :open="rateOpen" :title="t('toolbar.rateTitle')" :icon="Gauge" position="bottom" compact follow-layout panel-key="rate" @close="rateOpen = false">
      <div class="rate">
        <div>
          <label class="field-label">{{ t('toolbar.ratePanel.presets') }}</label>
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
              <Check v-if="player.rate === r.value" :size="19" class="tick" />
            </button>
          </div>
        </div>

        <!-- 自定义历史：**只收框里填出来的值**、最近在前、最多五条（`player.rateHistory`，见 docs/ui.md §18.65）。
             一条都没有时整段不画（不留一行空标题）。**一行就是上面预设那四档的同款 `.opt`**
             （要求原文：「直接把删除按钮去掉，沿用预设里面的样式」）：同款尺寸、同款勾、点一下同样应用并关面板。
             **没有删除入口**：历史按「最近在前 + 封顶五条」自己滚掉旧的，不需要手动删。 -->
        <div v-if="player.rateHistory.length">
          <label class="field-label">{{ t('toolbar.ratePanel.history') }}</label>
          <div class="opt-list">
            <button
              v-for="r in player.rateHistory"
              :key="r"
              type="button"
              class="opt"
              :class="{ on: player.rate === r }"
              @click="applyRate(r); rateOpen = false"
            >
              <span class="spacer">{{ rateLabel(r) }}</span>
              <Check v-if="player.rate === r" :size="19" class="tick" />
            </button>
          </div>
        </div>
      </div>

      <!-- 自己填的框 = 这个面板的 footer（动作区那一套在这里只借用位置：框也是「要动一下才生效」的那一档）。
           `.rate-foot` 自己只为纵向排布与 8px 间距；把它顶上来的那条（footer 的 12px/16px 内边距
           收回内容区那一档 18px）在下面样式里的 `:deep(.sheet-foot)` 上。 -->
      <template #footer>
        <div class="rate-foot">
          <label class="field-label">{{ t('toolbar.ratePanel.custom') }}</label>
          <NumberPad
            class="wide"
            :model-value="player.rate"
            :decimals="2"
            :min="RATE_MIN"
            :max="RATE_MAX"
            :step="RATE_STEP"
            :title="t('toolbar.rateTitle')"
            :unit="t('unit.rate')"
            @update:model-value="applyCustomRate"
            @confirm="rateOpen = false"
          />
          <!-- 「清空历史」跟在框**下面**（要求原文：「清空历史按钮坐在自定义下面」），是这一块唯一的一颗按钮。
               **不是危险色**（要求原文：「不要用danger」）、**也不弹确认**（要求原文：「不需要弹窗」）：
               点一下即清空，清掉的只是一串填写记录，当前倍速（底栏那颗钮的读数）不受影响。
               形态照 docs/ui.md §13 / §18.61 第 168 条那条硬约定：**footer 里的按钮一律实心底色 + 一颗 18px 图标**，
               **`ghost` 那颗描边档不许出现在 footer 里** —— 所以这里是中性实心底 `.btn`（`--surface-control`）
               + `trash`，不是 `.btn.ghost`、也不是 `.btn.danger`（清记录不是不可恢复的删除，§11）。
               一条历史都没有时它跟那一段一起不画（`v-if`）—— 没东西可清的时候就别摆一颗空按钮。
               ⚠️ 纵向 flex 里**别加 `.block`**（`width: 100%` 连同左右 margin 会溢出，见 docs/ui.md §14），
               宽度靠下面那条 scoped 规则撑满。 -->
          <button v-if="player.rateHistory.length" type="button" class="btn clear-history" @click="clearRateHistory">
            <Trash :size="18" /> {{ t('toolbar.ratePanel.clearHistory') }}
          </button>
        </div>
      </template>
    </AppSheet>

    <!-- 音频：没音频时是导入框；有音频时是音量 + 节拍器 + 设置起点（起点用频谱图选）。
         标题行图标**跟着标题走**（这张表有两个状态）：「音频」配 `Volume2`、「设置音频起点」配 `MapPin`
         —— 与里面那颗「设置起点」按钮同一个图标（面板换状态时图标不能停在旧意思上），
         `Volume2` 也**与底栏那颗「音频」圆钮同一个图标**（这个入口指向的就是那块面板） -->
    <AppSheet
      :open="audioOpen"
      :title="picking ? t('toolbar.audioPanel.offsetTitle') : t('toolbar.audio')"
      :icon="picking ? MapPin : Volume2"
      position="bottom"
      follow-layout
      panel-key="audio"
      @close="closeAudioSheet"
    >
      <AudioOffsetPicker v-if="picking && player.hasAudio" ref="picker" @done="picking = false" />

      <div v-else class="audio">
        <!-- 三条音量行长一个样：**一行文字 + 一条滑杆**，一行一个图标都不画
             （要求原文：「全掉图标」）—— 标签自带文字，图标只是同一件事的第二遍。
             静音按钮也去掉了：**音量拉到 0 就是静音**，与节拍器 / 预备拍那两条一致。 -->
        <div v-if="player.hasAudio" class="audio-row">
          <div class="audio-label">
            <span>{{ t('toolbar.audioPanel.musicVolume') }}</span>
            <span class="mono pct">{{ volumePct }}%</span>
          </div>
          <input
            class="slider"
            type="range"
            min="0"
            max="100"
            :aria-label="t('toolbar.audioPanel.musicVolume')"
            :value="volumePct"
            :style="{ '--fill': volumePct + '%' }"
            @input="applyVolume($event.target.value / 100)"
          />
        </div>

        <div class="audio-row">
          <div class="audio-label">
            <span>{{ t('toolbar.audioPanel.metronomeVolume') }}</span>
            <span class="mono pct">{{ metronomePct }}%</span>
          </div>
          <input
            class="slider"
            type="range"
            min="0"
            max="100"
            :aria-label="t('toolbar.audioPanel.metronomeVolume')"
            :value="metronomePct"
            :style="{ '--fill': metronomePct + '%' }"
            @input="setMetronomeVolume($event.target.value / 100)"
          />
        </div>
        <div class="audio-row">
          <div class="audio-label">
            <span>{{ t('toolbar.audioPanel.cueVolume') }}</span>
            <span class="mono pct">{{ cuePct }}%</span>
          </div>
          <input
            class="slider"
            type="range"
            min="0"
            max="100"
            :aria-label="t('toolbar.audioPanel.cueVolume')"
            :value="cuePct"
            :style="{ '--fill': cuePct + '%' }"
            @input="setCueVolume($event.target.value / 100)"
          />
        </div>
      </div>
      <!-- ⚠️ **不写 `accept`**（iPadOS 会按类型把非 PDF 的文件灰掉、点不动，见 docs/ui.md §18.21）：
           类型由 `onAudioPicked` 判，不对就报「不支持的文件」 -->
      <input ref="audioInput" type="file" class="hidden-file" @change="onAudioPicked" />

      <!-- 动作按钮一律在 footer（面板最底端、不跟内容滚，见 docs/ui.md §13 / §18.61）。
           这一屏有两个状态，footer 跟着换 —— 抽屉里 footer 是纵向的，所以下面的按钮各占一整行：
             · 「设置音频起点」那一屏 = 试听 + 返回音频设置；
             · 音频面板本体 = 导入音频文件（没音频时）/ 更换音频 + 设置起点（有音频时）。
           **形态统一**（docs/ui.md §13 / §18.61 第 168 条）：每颗都是**实心底色**（中性 `.btn` 或
           `.btn.primary`）**+ 一颗 18px 图标**，**没有描边档**（`.btn.ghost` 不许出现在 footer 里）。 -->
      <template #footer>
        <template v-if="picking && player.hasAudio">
          <!-- 试听 / 停止试听：逻辑全在 `AudioOffsetPicker` 里，这里只调它的方法。
               **这一颗恒为中性底 `.btn`，不加 `.btn.primary`**（要求原文：「停止试听的按钮不要用
               primary 颜色」）：试听中只换图标与文案，底色、字号、尺寸一律不动 ——
               它和下面那颗「返回音频设置」是同一档，这一屏没有主操作（见 docs/ui.md §18.42 第 115 条）。 -->
          <button type="button" class="btn" @click="picker?.togglePreview()">
            <component :is="picker?.previewing ? Pause : Play" :size="18" />
            {{ picker?.previewing ? t('audio.stopPreview') : t('audio.preview') }}
          </button>
          <button type="button" class="btn" @click="picker?.done()">
            <ChevronLeft :size="18" /> {{ t('audio.backToSettings') }}
          </button>
        </template>
        <template v-else>
          <!-- 只能点（拖入音频由 PlayerView 的整页拖放统一处理） -->
          <button v-if="!player.hasAudio" type="button" class="btn primary" @click="audioInput.click()">
            <SquareArrowRightEnter :size="18" /> {{ t('toolbar.audioPanel.import') }}
          </button>
          <template v-if="player.hasAudio">
            <button type="button" class="btn" @click="audioInput.click()">
              <RotateCcw :size="18" /> {{ t('toolbar.audioPanel.replace') }}
            </button>
            <button type="button" class="btn" @click="picking = true">
              <MapPin :size="18" /> {{ t('toolbar.audioPanel.setStart') }}
            </button>
          </template>
        </template>
      </template>
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
/* 底栏这两个胶囊的投影**朝上**（要求原文：「下工具栏的阴影改为向上」）。
   只换投影这一档（`box-shadow`），玻璃配方的其余部分 —— 底色 / 16px 模糊 / 弱描边 —— 仍然走全局 `.glass`。
   ⚠️ **别去改全局 `.glass`**：toast、左上「乐谱库」、右上总览、右键菜单都叠加着它，它们的投影仍是 `--shadow-2`。
   选择器比 `main.css` 那条 `.glass` 重（多了 `.dock-row` 与 scoped 属性），不靠样式表先后顺序取胜。 */
.dock-row .capsule.glass {
  box-shadow: var(--shadow-2-up);
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

/**
 * 播放 / 暂停键的图标是**填实**的（要求原文：「播放暂停按钮换成fill类型的可以吗」）：
 * `fill: currentColor` 盖掉 Lucide 自带的 `fill="none"`，`stroke: none` 把 1.9 的描边去掉
 * （留着描边会让填色块外缘再胖一圈、边缘发毛）。两枚图标的路径本来就是「两个闭合三角形」与
 * 「两条竖条」，填实不需要任何额外形状。
 *
 * ⚠️ **只挂在这一颗圆钮上**（`.cap-btn.play`），不许写进 `main.css` 的全局 `svg.lucide`：
 * 同一个 `Play` / `Pause` 组件还被音频面板 footer 那颗「试听 / 停止试听」用着
 * （它只是切图标组件、不换外观），填实成三角会与它比邻的实心主题色圆钮混淆。
 * ⚠️ **尺寸仍是 21**（docs/ui.md §18.56：胶囊里每一颗都用 21，播放键的三角也不例外）——
 * 填实之后三角的观感会比旁边几颗描边图标重一点，但圆钮里那行内容槽 `--cap-icon-h` 是 24，
 * 装得下、不会撑破圆钮；要调就先改文档再改这里。
 */
.cap-btn.play > .lucide {
  fill: currentColor;
  stroke: none;
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

/* 倍速面板的内容区：现在是**两段**（「预设」列表 → 「自定义历史」），段与段之间留一档间距
   （与音频面板那几行同一个 18px）。两段各自「小标题 + 列表」，都不用 `.block`：
   列表是 `.opt-list`，自己就占满整行。**框不在这里** —— 它在面板的 footer（见 `.rate-foot`）。 */
.rate {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
/**
 * 自己填的框那一块（**在面板的 footer 里**，见模板那条注释）：框本身没有可调的东西 ——
 * 抽屉里 footer 本来就是 `flex-direction: column`（`AppSheet` 的 `.drawer-box .sheet-foot`），
 * 而 `NumberPad` 的 `.wide` 在纵向 flex 里自己就铺满整行。这里只为**对上内容区的左右边距**。
 *
 * `AppSheet` 的 `.sheet-foot` 是 12px / 16px，而 `.sheet-body` 是 `16px 18px 18px` ——
 * 照原样摆，「自定义」这个标题与框会比上面的「预设」「自定义历史」**左缩进少 2px**，
 * 上下两块一眼就看得出没对齐。所以把 footer 的左右内边距收回 18、上边距收到 16，与 `.sheet-body` 逐字同值。
 *
 * ⚠️ `:deep(.sheet-foot)` **只能这样写**，不能写成 `.rate-foot :deep(.sheet-foot)` ——
 * 插槽内容是在**父组件**（本组件）的作用域里渲染的，scoped 属性只打在插槽内容自己的根上，
 * **没有** `.sheet-foot` 那个元素的属性，而 `:deep()` 前面的选择器必须匹配到一个带属性的元素。
 * 这条会命中本组件里**所有**面板的 footer —— 目前只有这一处（音频面板的 footer 是按钮，
 * 用的就是 `AppSheet` 自己的内边距），将来给别处塞 footer 时留意别被它带偏。
 */
.rate-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.rate-foot .field-label {
  margin-bottom: 0;
}
/* 「清空历史」撑满整行：纵向 flex 里靠拉伸即可，**别写 `width: 100%` + 左右 margin**
   （那会溢出，见 docs/ui.md §14）。它比上面那个框窄一点点不是错位 —— 那是 `.btn` 自己的
   padding 与 `NumberPad` 的（14）之差，两边的字仍然对齐在同一条竖线上。
   ⚠️ **别给它挂 `.ghost`**：footer 里的按钮一律实心底色（docs/ui.md §13），
   这条只负责宽度，底色 / 图标由模板上的 `.btn` + Lucide 组件管。 */
.rate-foot .clear-history {
  align-self: stretch;
}
:deep(.sheet-foot) {
  padding: 16px 18px calc(12px + var(--safe-b));
}

/* 音频面板的内容区：动作按钮不在这里（它们在 `AppSheet` 的 footer，见文件头注释），
   所以这一块只剩滑杆与说明文字。纵向 flex 里靠拉伸撑满整行即可，
   **别加 `.block`**（width: 100% 连同左右 margin 会溢出，见 docs/ui.md §14） */
.audio {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.hidden-file {
  display: none;
}
.audio-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
/* ------------------------------- 音量滑杆 ------------------------------- */
/**
 * 音量滑杆（音乐 / 节拍器 / 预备拍三行共用一套，每行独占一条整行宽的）。四条要求，改之前先读：
 *  · **一行一条、占满整行**：滑杆是 `.audio-row` 的第二个子节点、直接铺满整行，
 *    所以**没有 `.audio-ctl` 这个包装层了** —— 它原来只为了把「静音钮 + 滑杆」并排放，
 *    静音钮去掉后那层就没有存在的理由（多一层 flex 只会让宽度算式绕一圈）。
 *  · **轨道细、药丸形、两端都是圆的**：高 `--track`(6px) + `border-radius: 999px`；
 *    `--tap-min` 只留给**热区**（输入框本身仍是 46 高，触屏可点范围不缩水 ——
 *    `docs/ui.md` §3.1 就是这么定的）。
 *    ⚠️ **底色（`--surface-sunken`）必须给轨道本体，不能只画在填充那条渐变里**：
 *    渐变只铺在「内缩区间」上，不铺底色的话 0% 时轨道左端是**透明的**，圆角那一段就看不见了
 *    （症状：用户报「轨道两端不是圆角」）。铺满整宽 + 圆角 999 之后，两端永远是圆的、与填充画到哪儿无关。
 *    ⚠️ **滑杆自己还要留左右内边距**（`padding: 0 10px`，要求原文：「左右边距又不够」）：
 *    抽屉内容区（`.sheet-body`）本来就有 18px 左右内边距，不给这一档时轨道正好顶在那 18px 的边上。
 *  · **已填充的那一段走主题色**：`--fill` 由模板按百分比给（`volumePct` 那三个），
 *    背景用 `linear-gradient` 画在轨道上，**铺满整个内边距盒、不做任何内缩** ——
 *    这样「填充画到哪儿」与「把手停在哪儿」才是同一条直线（量出来的那组数见下面 `.slider` 的块注释）。
 *    这条**在 Firefox 上也一样**（`:hover` / `:focus` 下 Firefox 会自己给已填充段上色，
 *    那是系统主题色、深浅两色下都不一定对，所以那些规则在下面用 `background: inherit` 顶掉）。
 *  · **把手是白色横向胶囊（宽 > 高）**（要求原文：「把手是白色长条胶囊」「白色胶囊把手是横向的，
 *    宽比高长」「把手还是胶囊形」）：**24 × 16**（含 1px 描边）、圆角 999 ——
 *    比轨道粗得多、上下各冒出轨道 5px，横向比竖向长一半（一眼就是胶囊，不是圆点）。
 *    恒为 `#fff`（深浅两色的轨道上都要成立，与 `SwitchRow` 的开关滑块同一个理由，见 `docs/ui.md` §7 白名单）。
 *    垂直居中按「(轨道厚 − 把手高) / 2」算出来（6 − 16 = −10，取 −5 落在中线上），两个内核各一份。
 *    **带一条灰描边**（要求原文：「然后要带灰色边框」）：1px `--stroke-strong`
 *    （`#d7dade`，深浅两色下压白把手都够）—— 白把手压在白底上也能看清轮廓。
 *    ⚠️ **尺寸与描边必须写死在那两个 thumb 伪元素里**（写法与原因见下面 `::-webkit-slider-thumb` 那条注释）。
 *  **悬停 / 按下 / 聚焦三态都不动尺寸与颜色**（`docs/ui.md` §18.18）：变的是整条轨道 ——
 *  悬停铺一档 `--surface-hover` 的底（它就是「这里能拖」的提示），按下换更重的 `--surface-active`，
 *  键盘聚焦在整条输入框上点一圈 `--accent-line`。移动端没有悬停，拖的时候靠把手底下那条
 *  正在变长的主题色填充段给反馈。
 */
.slider {
  /* 撑满整行（本行只有它一个子节点）。用 `align-self: stretch` 而**不是** `width: 100%`：
     整行宽度的写法一旦遇上左右 margin 就会溢出（`docs/ui.md` §14 那条同样的坑） */
  align-self: stretch;
  height: var(--tap-min);
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  border-radius: 999px;
  --track: 6px;
  /* 轨道左右再留一点边距（要求原文：「左右边距又不够」）：抽屉内容区本来就有 18px 左右内边距，
     不给这一档的话轨道就顶到那 18px 的边上，看着贴边 */
  padding: 0 10px;
  transition: background-color 0.12s var(--ease);
}
/**
 * ⚠️ **填充那条渐变要铺满整个内边距盒，不做任何内缩**（`background-size: 100%` + `position: 0`）：
 *  量过渲染结果（25% / 50% / 100% 三档，逐像素）——**这样量出来的「填充右端」与「把手左外沿」
 *  三档全部 0px 重合**。两个内核都是这个行为，所以不需要按内核分开给值。
 *
 *  **踩过的坑（错了两轮，别再往回改）**：原先按「把手行程比轨道窄一个把手宽」的推算，
 *  给渐变加了 `--inset` 内缩（先 `W`、后 `W/2`），结果怎么调都对不齐：
 *  低音量时填充短一截、高音量时又正好——因为 `background-size` / `background-position` 的
 *  `calc()` 折算与把手的实际行程并不是同一条算式（要求原文：「把手和填充色对不齐了」）。
 *  结论：**填充端点只用「铺满 + 百分比」这一条直线就对了**，别再加内缩量。
 *  （同理别再引入 `--inset` 这个变量：它已经删了。）
 */
.slider::-webkit-slider-runnable-track {
  height: var(--track);
  border-radius: 999px;
  /* 底色给轨道本体（不是画在渐变里）：不铺底色的话 0% 时轨道两端是透明的、圆角那一段看不见。
     渐变**铺满整个内边距盒、不做内缩** —— 见 `.slider` 上面那段注释里量的那组数。 */
  background-color: var(--surface-sunken);
  background-image: linear-gradient(
    to right,
    var(--accent) 0,
    var(--accent) var(--fill, 0%),
    var(--surface-sunken) var(--fill, 0%),
    var(--surface-sunken) 100%
  );
  background-size: 100% 100%;
  background-position: 0 center;
  background-repeat: no-repeat;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  /* ⚠️ **把手的尺寸必须写在这里，不能只写在 `.slider` 上用 `var()` 转一手**：
     自定义属性**不会继承进 `::-webkit-slider-thumb` 这个伪元素**，`var(--knob-w)` 解析不出来、
     整条声明作废，Chrome 就退回它自带的那个 ~16px 方形把手 —— 看上去正好是「高比宽长的竖药丸」，
     而且怎么改数值都不变。写死在这里才生效（下面 `-moz-range-thumb` 同理，一份尺寸各写一遍）。 */
  width: 24px;
  height: 16px;
  /* (6 − 16) / 2 = −5：把把手压在轨道中线上（上下各冒出轨道 5px）。
     写成**字面量**，不写 `calc((var(--track) - 16px) / 2)` —— 理由同上：这个伪元素里
     连 `--track` 也拿不到，声明会作废、退回 0，把手就不再居中 */
  margin-top: -5px;
  border: 1px solid #d7dade;
  border-radius: 999px;
  background: #fff;
  box-shadow: var(--shadow-1);
}
.slider::-moz-range-track {
  height: var(--track);
  border-radius: 999px;
  /* 与 WebKit 那份同一套（底色给轨道本体 + 渐变铺满内边距盒），理由见上面那条注释 */
  background-color: var(--surface-sunken);
  background-image: linear-gradient(
    to right,
    var(--accent) 0,
    var(--accent) var(--fill, 0%),
    var(--surface-sunken) var(--fill, 0%),
    var(--surface-sunken) 100%
  );
  background-size: 100% 100%;
  background-position: 0 center;
  background-repeat: no-repeat;
}
/* ⚠️ Firefox 自带一条 `::-moz-range-progress`（已填充段），悬停 / 聚焦时它会铺系统主题色 ——
   压在轨道那条渐变上就是两种颜色打架。填充由上面的 `::-moz-range-track` 全权负责，这里让它透明让开。 */
.slider::-moz-range-progress {
  background: transparent;
  height: var(--track);
  border-radius: 999px;
}
.slider::-moz-range-thumb {
  /* 与上面 WebKit 那份同一个尺寸，理由见那条注释（伪元素里拿不到 `.slider` 的自定义属性） */
  width: 24px;
  height: 16px;
  border: 1px solid #d7dade;
  border-radius: 999px;
  background: #fff;
  box-shadow: var(--shadow-1);
}
/* 悬停 / 按下只换整条轨道的底（见上面那段注释），**轨道与把手都不位移、尺寸也不动**。
   写在 `:active` 前面，否则按下时会被悬停盖住（`docs/ui.md` §10） */
@media (hover: hover) {
  .slider:hover {
    background: var(--surface-hover);
  }
}
.slider:active {
  background: var(--surface-active);
}
/* 键盘聚焦：描边点亮（`.text-input:focus` / `NumberPad` 同一档），不动轨道与把手的颜色 */
.slider:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-line);
}
</style>
