<script setup>
/**
 * 纯数字输入框
 *  · **只有一套交互**：点一下（触屏 / 鼠标都一样）弹九宫格悬浮键盘，值一律在键盘里敲。
 *    物理键盘照样能用 —— 键盘打开时监听 window keydown：数字 / 退格 / 回车 / Esc / 上下箭头微调。
 *  · 唯一的设备差异：**触屏把内部 input 设为 `readonly` + `inputmode="none"`，绝不唤起系统输入法**；
 *    桌面端没有系统输入法这回事，input 只当显示用（不接收原生编辑，输入路径只有键盘一条）。
 *  · 支持 min/max/decimals 夹取、allowEmpty、format / normalize。
 *  · 键盘上**不给备选数字**（预设键已删）：左边一块「标题 / 取值范围」上下两行、值在右侧跟这一块垂直居中，
 *    再下面才是可选的格式说明（`hint`，例如「小节.拍：4.03 = 第 4 小节第 3 拍」）；
 *    **没有 min/max 的字段，范围那一行根本不渲染**，标题块就回到一行。
 *  · **值旁边不写单位**（输入框里、键盘上的大数字后面都不写）：单位由字段的标题（label）表达，
 *    别在标题和值里各写一遍（「120 BPM」「4.03 小节」这种重复反而把数字挤小、还让值看起来像字符串）。
 *  · 框本身就是那个按钮：**不要在框里挂「点我弹键盘」的角标图标**，它自己有 hover / 按下 / 聚焦亮描边。
 *  · **取值只有有限几个合法值**时（拍号分母 1/2/4/8/16 这种）不要退回九宫格，改用 `ContextMenu` 的短单选。
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  modelValue: { type: [Number, String], default: null },
  decimals: { type: Number, default: 0 },
  min: { type: Number, default: -Infinity },
  max: { type: Number, default: Infinity },
  step: { type: Number, default: 0 },
  title: { type: String, default: '' },
  /** 格式说明：显示在键盘里取值范围那一行的下面（min/max 能自动说清范围，说不清格式的字段才传它） */
  hint: { type: String, default: '' },
  placeholder: { type: String, default: null },
  disabled: { type: Boolean, default: false },
  allowEmpty: { type: Boolean, default: false },
  size: { type: String, default: 'md' }, // md | lg
  /** 可选的显示格式化：位置这类「小数有固定含义」的字段要保住末尾的 0（4.10 不能显示成 4.1） */
  format: { type: Function, default: null },
  /** 可选的提交规整：拿到（原始文本, 初步数值）返回最终值，用于按文本判断的输入（见 normalizePositionText） */
  normalize: { type: Function, default: null },
})

const emit = defineEmits(['update:modelValue', 'change', 'open'])

/* -------------------------- 触屏 / 桌面 -------------------------- */

function coarsePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0 && window.matchMedia('(hover: none)').matches
}

/** 只决定「要不要屏蔽系统输入法」：true 时 input 设 readonly + inputmode=none，其余行为两边完全一样 */
const touchMode = ref(coarsePointer())

const inputEl = ref(null)
const trigger = ref(null)
const padEl = ref(null)
const open = ref(false)
const ready = ref(false)
const buffer = ref('')
const fresh = ref(true)
const pos = ref({ top: 0, left: 0 })

function fmt(v) {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return ''
  const n = Number(v)
  if (props.decimals <= 0) return String(Math.round(n))
  const s = n.toFixed(props.decimals)
  if (!s.includes('.')) return s
  return s.replace(/0+$/, '').replace(/\.$/, '')
}

/** 显示文本一律走这里：有 format 就用它（默认 fmt 会吃掉末尾的 0） */
function displayOf(v) {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return ''
  return props.format ? props.format(Number(v)) : fmt(v)
}

/** 提交值一律走这里：normalize 按原始文本决定最终值，再交给 min/max/decimals 夹取 */
function resolve(raw, n) {
  const base = props.normalize ? Number(props.normalize(raw, n)) : n
  return roundClamp(Number.isFinite(base) ? base : n)
}

const display = computed(() => displayOf(props.modelValue))

/** 取值范围提示：由 min/max 自动生成（没有就整条不显示）——键盘里不再列备选数字 */
const rangeText = computed(() => {
  const lo = props.min
  const hi = props.max
  const hasLo = Number.isFinite(lo)
  const hasHi = Number.isFinite(hi)
  if (!hasLo && !hasHi) return ''
  const f = (n) => (props.decimals > 0 ? String(Number(n.toFixed(props.decimals))) : String(Math.round(n)))
  if (hasLo && hasHi) return f(lo) === f(hi) ? t('numpad.rangeOnly', { lo: f(lo) }) : t('numpad.rangeBetween', { lo: f(lo), hi: f(hi) })
  return hasHi ? t('numpad.rangeMax', { hi: f(hi) }) : t('numpad.rangeMin', { lo: f(lo) })
})

function roundClamp(n) {
  let v = props.decimals <= 0 ? Math.round(n) : Number(n.toFixed(props.decimals))
  if (v < props.min) v = props.min
  if (v > props.max) v = props.max
  return v
}

/* ------------------------------ 点开键盘 ------------------------------ */

/**
 * 触屏与桌面**走同一条路**：点一下弹九宫格。
 * 这里只按指针类型更新 touchMode（混合设备上手指点按 → 屏蔽输入法，鼠标点按 → 允许显示用），
 * 值本身永远只在键盘里敲，input 不接收原生编辑。
 */
function onFieldClick(e) {
  if (props.disabled) return
  const type = e?.pointerType
  if (type === 'touch' || type === 'pen') {
    touchMode.value = true
    inputEl.value?.blur() // 触屏：万一已经聚焦，先收掉系统输入法
  } else if (type === 'mouse') {
    touchMode.value = false
  }
  openPad()
}

/* ------------------------------ 九宫格键盘 ------------------------------ */

const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

function openPad() {
  if (props.disabled || open.value) return
  buffer.value = displayOf(props.modelValue)
  fresh.value = true
  open.value = true
  ready.value = false
  emit('open')
  nextTick(() => {
    position()
    ready.value = true
    window.addEventListener('resize', position)
    window.addEventListener('orientationchange', position)
    window.addEventListener('scroll', position, true)
    window.addEventListener('keydown', onKey, true)
  })
}

function close() {
  open.value = false
  window.removeEventListener('resize', position)
  window.removeEventListener('orientationchange', position)
  window.removeEventListener('scroll', position, true)
  window.removeEventListener('keydown', onKey, true)
  // 关闭后把焦点从触发钮上收掉：桌面端点过的按钮会一直留着聚焦态，框上就会挂着主题色描边
  const active = document.activeElement
  if (active && trigger.value?.contains(active)) active.blur()
}

function position() {
  const el = trigger.value
  const pad = padEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const pw = pad?.offsetWidth || 264
  const ph = pad?.offsetHeight || 400
  const margin = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = r.right - pw
  left = Math.max(margin, Math.min(left, vw - pw - margin))
  let top = r.bottom + 6
  if (top + ph > vh - margin) {
    const above = r.top - ph - 6
    top = above >= margin ? above : Math.max(margin, vh - ph - margin)
  }
  pos.value = { top, left }
}

function press(k) {
  if (k === 'back') {
    buffer.value = fresh.value ? '' : buffer.value.slice(0, -1)
    fresh.value = false
    return
  }
  if (k === '.') {
    if (props.decimals <= 0) return
    if (fresh.value) {
      buffer.value = ''
      fresh.value = false
    }
    if (buffer.value.includes('.')) return
    buffer.value = (buffer.value || '0') + '.'
    return
  }
  if (fresh.value) {
    buffer.value = ''
    fresh.value = false
  }
  if (buffer.value.replace(/[^0-9]/g, '').length >= 8) return
  if (buffer.value === '0') buffer.value = ''
  buffer.value += k
}

function clear() {
  buffer.value = ''
  fresh.value = false
}

function confirm() {
  const raw = buffer.value.trim()
  if (raw === '' || raw === '-' || raw === '.') {
    if (props.allowEmpty) {
      emit('update:modelValue', null)
      emit('change', null)
    }
    close()
    return
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    close()
    return
  }
  const v = resolve(raw, n)
  emit('update:modelValue', v)
  emit('change', v)
  close()
}

function bump(dir) {
  const base = Number.isFinite(Number(props.modelValue)) ? Number(props.modelValue) : props.min > -Infinity ? props.min : 0
  const st = props.step || (props.decimals > 0 ? 0.5 : 1)
  const v = roundClamp(base + dir * st)
  emit('update:modelValue', v)
  emit('change', v)
  nextTick(position)
}

function onKey(e) {
  if (!open.value) return
  const k = e.key
  if (/^[0-9]$/.test(k)) press(k)
  else if (k === '.' || k === ',') press('.')
  else if (k === 'Backspace') press('back')
  else if (k === 'Enter') confirm()
  else if (k === 'Escape') close()
  else if (k === 'ArrowUp') bump(1)
  else if (k === 'ArrowDown') bump(-1)
  else return
  e.preventDefault()
  e.stopPropagation()
}

onBeforeUnmount(close)

defineExpose({ openPad, close })
</script>

<template>
  <div
    ref="trigger"
    class="nfield"
    :class="[size, { disabled, empty: !display }]"
    :title="hint || title || null"
    @click="onFieldClick"
  >
    <!-- input 只负责显示：**不接收原生编辑**，值一律在九宫格键盘里敲。
         触屏多挂一层 readonly + inputmode="none"，确保点它不会唤起系统输入法 -->
    <input
      ref="inputEl"
      class="ninput"
      type="text"
      :value="display"
      :readonly="disabled || touchMode"
      :inputmode="touchMode ? 'none' : 'numeric'"
      :placeholder="placeholder ?? t('common.noValue')"
      :disabled="disabled"
      @focus="openPad()"
    />
    <button type="button" class="ntap" :disabled="disabled" :aria-label="title || t('numpad.enterNumber')" @click="onFieldClick" />

    <!-- 九宫格键盘 Teleport 到 body。⚠️ **它必须待在根 `div.nfield` 里面**：
         和根元素**并排**时这个组件的根节点就成了 Fragment，Vue 不再把非 prop 属性落到 `.nfield` 上 ——
         调用方写的 `class="wide"` 会**静默失效**（只在 dev 控制台留一条
         「Extraneous non-props attributes (class)… because component renders fragment or text or teleport root nodes」），
         表现就是「明明给了占满一行的类，框还是窄的」。放进根节点里 DOM 结果一模一样
         （Teleport 的内容仍旧渲染到 body），但根节点回到单元素。**别把它挪回外面。** -->
    <Teleport to="body">
      <div v-if="open" class="pad-scrim scrim-bare" @click="close" @contextmenu.prevent></div>
      <div
        v-if="open"
        ref="padEl"
        class="pad"
        :style="{ top: pos.top + 'px', left: pos.left + 'px', opacity: ready ? 1 : 0 }"
        @pointerdown.stop
      >
        <!-- 左侧一整块「标题 / 取值范围」两行，值靠右跟标题同一基线；
             没有范围的字段就回到只有标题的一行 -->
        <div class="pad-head">
          <div class="pad-head-text">
            <span class="pad-title">{{ title }}</span>
            <span v-if="rangeText" class="pad-range mono">{{ rangeText }}</span>
          </div>
          <span class="pad-buf mono">{{ buffer || '0' }}</span>
        </div>

        <p v-if="hint" class="pad-hint">{{ hint }}</p>

        <div class="pad-grid">
          <button v-for="d in digits" :key="d" type="button" class="pad-key" @click="press(d)">{{ d }}</button>
          <button type="button" class="pad-key fn" @click="press('back')">⌫</button>
          <button type="button" class="pad-key" @click="press('0')">0</button>
          <button type="button" class="pad-key fn" :disabled="decimals <= 0" @click="press('.')">.</button>
        </div>

        <div class="pad-actions">
          <button type="button" class="btn ghost sm" @click="close">{{ t('common.cancel') }}</button>
          <button v-if="allowEmpty" type="button" class="btn ghost sm" @click="clear">{{ t('common.clear') }}</button>
          <button type="button" class="btn primary sm grow" @click="confirm">{{ t('common.confirm') }}</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script>
export default { name: 'NumberPad' }
</script>

<style scoped>
.nfield {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-height: var(--tap-min);
  padding: 0 10px 0 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  border: 1px solid var(--stroke-strong);
  color: var(--text-strong);
  transition: border-color 0.15s ease, background 0.15s ease;
  min-width: 76px;
}
.nfield.empty .ninput::placeholder {
  color: var(--text-muted);
}
/* 「占满一行」的变体：调用方写 `class="wide"` 即可（段落编辑器的 BPM / 位置、跳转面板的小节 / 拍）。
   默认的 `.nfield` 是 inline-flex + min-width 76px 的**窄框** —— 它常和别的控件并排（拍号分子、跳转的两栏），
   所以「占满一行」必须是显式的一档，不能做成默认。
   `display: flex`（不是 inline-flex）+ `width: 100%`：父容器无论是块级还是 flex 行，它都铺满。 */
.nfield.wide {
  display: flex;
  width: 100%;
}
.nfield.disabled {
  opacity: 0.45;
}
.nfield.lg {
  min-height: 52px;
}
/* 整个框就是一个「打开键盘」的按钮：hover / 按下与其它中性控件同一套。
   聚焦（键盘开着 / Tab 进来）时描边亮主题色，所以这两条排在 hover / active 后面 */
@media (hover: hover) {
  .nfield:not(.disabled):hover {
    background: var(--surface-hover);
    border-color: var(--accent-line);
  }
}
.nfield:not(.disabled):active {
  background: var(--surface-active);
  border-color: var(--accent);
}
.nfield:focus-within {
  border-color: var(--accent);
}
.ninput {
  flex: 1;
  min-width: 0;
  width: 100%;
  background: none;
  border: 0;
  outline: none;
  text-align: right;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-strong);
  padding: 0;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.nfield.lg .ninput {
  font-size: 18px;
}
.ninput::placeholder {
  color: var(--text-muted);
  font-weight: 500;
}
/* 盖一层透明按钮：整块区域都能点开键盘，input 自己也不接收原生编辑 */
.ntap {
  position: absolute;
  inset: 0;
  background: none;
  border: 0;
  border-radius: inherit;
}

.pad-scrim {
  z-index: 70;
}

.pad {
  position: fixed;
  z-index: 71;
  width: 264px;
  padding: 10px;
  border-radius: var(--radius);
  background: var(--surface-float);
  border: 1px solid var(--stroke-strong);
  box-shadow: var(--shadow-3);
  transition: opacity 0.12s ease;
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.pad-head {
  display: flex;
  /* 值在右侧跟左边这一块（标题 / 范围两行）**垂直居中**，不跟某一行基线对齐 */
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 6px 8px;
}
/* 标题 + 范围合成左边一块（上下两行），高度由它决定 */
.pad-head-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.pad-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}
/* 范围是标题块的第二行（灰一档，别跟标题抢）；没有范围限制的字段这一行根本不渲染 */
.pad-range {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-muted);
}
.pad-buf {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.02em;
  min-width: 40px;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pad-hint {
  margin: 0;
  padding: 0 6px 8px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted);
}
.pad-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.pad-key {
  height: 52px;
  border-radius: 10px;
  background: var(--surface-control);
  color: var(--text-strong);
  font-size: 21px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
@media (hover: hover) {
  .pad-key:hover {
    background: var(--surface-hover);
  }
}
.pad-key:active {
  background: var(--accent);
  color: var(--on-accent);
}
.pad-key.fn {
  color: var(--text-soft);
  font-size: 18px;
}
.pad-key[disabled] {
  opacity: 0.3;
}
.pad-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
}
.pad-actions .grow {
  flex: 1;
}
</style>
