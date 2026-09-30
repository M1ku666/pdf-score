<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  modelValue: { type: [Number, String], default: null },
  decimals: { type: Number, default: 0 },
  min: { type: Number, default: -Infinity },
  max: { type: Number, default: Infinity },
  step: { type: Number, default: 0 },
  title: { type: String, default: '' },
  hint: { type: String, default: '' },
  unit: { type: String, default: '' },
  placeholder: { type: String, default: null },
  disabled: { type: Boolean, default: false },
  allowEmpty: { type: Boolean, default: false },
  size: { type: String, default: 'md' },
  format: { type: Function, default: null },
  normalize: { type: Function, default: null },
})

const emit = defineEmits(['update:modelValue', 'change', 'open', 'confirm'])

function coarsePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0 && window.matchMedia('(hover: none)').matches
}

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

function displayOf(v) {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return ''
  return props.format ? props.format(Number(v)) : fmt(v)
}

function resolve(raw, n) {
  const base = props.normalize ? Number(props.normalize(raw, n)) : n
  return roundClamp(Number.isFinite(base) ? base : n)
}

const display = computed(() => displayOf(props.modelValue))

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

function onFieldClick(e) {
  if (props.disabled) return
  const type = e?.pointerType
  if (type === 'touch' || type === 'pen') {
    touchMode.value = true
    inputEl.value?.blur()
  } else if (type === 'mouse') {
    touchMode.value = false
  }
  openPad()
}

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
  emit('confirm', v)
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

    <span v-if="unit" class="unit" :title="unit">{{ unit }}</span>

    <Teleport to="body">
      <div v-if="open" class="pad-scrim scrim-bare" @click="close" @contextmenu.prevent></div>
      <div
        v-if="open"
        ref="padEl"
        class="pad"
        :style="{ top: pos.top + 'px', left: pos.left + 'px', opacity: ready ? 1 : 0 }"
        @pointerdown.stop
      >
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
  text-align: left;
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
.ntap {
  position: absolute;
  inset: 0;
  background: none;
  border: 0;
  border-radius: inherit;
}
.unit {
  position: relative;
  z-index: 1;
  flex: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
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
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 6px 8px;
}
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
