import { reactive, ref } from 'vue'
import { t } from '../i18n/index.js'

export const toasts = reactive([])

let seq = 0
const MAX = 3

function find(keyOrId) {
  if (keyOrId === '' || keyOrId === null || keyOrId === undefined) return -1
  return toasts.findIndex((t) => (t.key && t.key === keyOrId) || t.id === keyOrId)
}

function drop(i) {
  if (i >= 0) toasts.splice(i, 1)
}

function push(entry) {
  const t = {
    id: ++seq,
    tick: 0,
    message: '',
    ms: 0,
    key: '',
    expireAt: 0,
    tone: 'accent',
    ...entry,
  }
  toasts.push(t)
  while (toasts.length > MAX) toasts.shift()
  return t
}

export function toast(message, ms = 2400, opts = {}) {
  const { key = '', tone = 'accent' } = opts
  const i = find(key)
  const prev = i >= 0 ? toasts[i] : null
  if (prev) drop(i)
  const t = push({
    kind: 'toast',
    key: key || prev?.key || '',
    message,
    ms,
    tone,
    expireAt: ms ? Date.now() + ms : 0,
  })
  return () => dismissToast(t.key || t.id)
}

export function dangerToast(message, ms = 2400) {
  return toast(message, ms, { tone: 'danger' })
}

export function dismissToast(keyOrId) {
  drop(find(keyOrId))
}

export const hintsHidden = ref(false)

export function setHintsHidden(hidden) {
  hintsHidden.value = !!hidden
}

export function sweep() {
  const now = Date.now()
  for (let i = toasts.length - 1; i >= 0; i--) {
    const t = toasts[i]
    if (t.expireAt && t.expireAt <= now) toasts.splice(i, 1)
  }
  return toasts.length > 0
}

function makeHandle(t) {
  const id = t.id
  const live = () => find(id) >= 0
  const at = () => toasts[find(id)]

  const set = (patch) => {
    if (!live()) return
    Object.assign(at(), patch)
  }

  const settle = (state, text, ms, nextTick = true, tone = null) => {
    if (!live()) return
    const cur = at()
    Object.assign(cur, {
      kind: 'toast',
      state,
      message: text,
      ms,
      expireAt: ms ? Date.now() + ms : 0,
      progress: null,
      tone: tone || (state === 'failed' ? 'danger' : 'accent'),
      tick: nextTick ? cur.tick + 1 : cur.tick,
    })
  }

  return {
    update(text, done = null, total = null) {
      if (!live()) return
      const patch = {}
      if (text != null) patch.message = text
      if (done === null) patch.progress = null
      else if (total != null) patch.progress = total > 0 ? Math.max(0, Math.min(1, done / total)) : null
      else throw new Error('[toast] update(text, done, total) 要确定进度必须同时给 done 和 total')
      set(patch)
    },
    done(text, ms = 2400, tone = 'accent') {
      if (!live()) return
      if (!text) return this.close()
      settle('done', text, ms, true, tone)
    },
    fail(text, ms = 4200) {
      if (!live()) return
      settle('failed', text || '', ms)
    },
    close() {
      drop(find(id))
    },
  }
}

export function task(message, opts = {}) {
  const { key = 'task', progress = null } = opts
  const i = toasts.findIndex((t) => t.key === key && t.state === 'running')
  if (i >= 0) drop(i)
  const t = push({
    kind: 'task',
    key,
    message,
    state: 'running',
    progress: progress == null ? null : Math.max(0, Math.min(1, progress)),
    expireAt: 0,
  })
  return makeHandle(t)
}

export function actionToast(message, action, button, opts = {}) {
  const { key = 'action', ms = 0, total = 0, tone = 'accent' } = opts
  const i = find(key)
  if (i >= 0) drop(i)
  return push({
    kind: 'action',
    key,
    message,
    action,
    button,
    tone,
    ms,
    since: Date.now(),
    total,
    expireAt: ms ? Date.now() + ms : 0,
  })
}

const ERROR_MS = 6000

export function errorToast(message, opts = {}) {
  const { key = 'error', ms = ERROR_MS } = opts
  return actionToast(message, 'copy', t('common.copy'), { key, ms, total: ms, tone: 'danger' })
}
