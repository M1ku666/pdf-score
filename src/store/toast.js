/**
 * 顶部提示（toast）—— **全站唯一的操作反馈机制**，渲染在 `ToastStack.vue`（挂在 `App.vue`）。
 *
 * 「toast（一次性提示）」与「banner（撤销条 / 带按钮那条）」原来是两套东西、两条渲染路径，
 * 现在**只有 toast 一个名字**（用户要求「banner 也统一叫成 toast」），并且**只分三类**：
 *
 *  · **第一类 · 一次性通知** `toast(msg, ms)` —— 说完就自己走，没有进度也没有按钮。
 *  · **第二类 · 任务型通知** `task(label)` —— 发出后**还会改自己的内容**：
 *    有真实进度的给 `update(text, done, total)`（圆环按比例走），
 *    **没有明确进度的就不给进度**（圆环转圈，无限进度环动画）；
 *    任务完成 / 失败时 **`.done()` / `.fail()` 把同一条就地变成一次性通知**，
 *    **不是新发一条**「已完成」。
 *  · **第三类 · 带按钮的通知** `actionToast(msg, action, button, opts)` —— 正文 + 一颗按钮
 *    （现在的撤销条；`opts.total` 还给它一圈倒计时环）。**两个使用者**：
 *    ① 撤销条（按钮 = 撤销）；② **可复制的报错** `errorToast(msg)`（按钮 = 复制）。
 *
 * `opts.key` —— **同一个 key 复用同一条**：反复调只改文字、不堆叠（撤销那条靠它连删累加）。
 *
 * ⚠️ **不要在别处再自建第二套提示机制**，也不要在这里读别的 store ——
 * 这里的动作全部声明成**字符串**（`action`），由 `App.vue` 的 `onToastAct` 派发，
 * 所以本模块不引任何业务 store，也就没有循环依赖。
 */
import { reactive, ref } from 'vue'
import { t } from '../i18n/index.js'

/**
 * 当前挂着的提示。字段：
 * `id` 稳定身份（也是 `:key` 的基础）、`kind` 'toast' | 'task' | 'action'、`tick` 见下、
 * `message` 正文、`ms` 自动消失的毫秒数（0 = 一直留着）、`key` 复用槽位（'' = 每次新起一条）、
 * `expireAt` 什么时候自己走（0 = 不走）、`state` 任务状态 'running' | 'done' | 'failed'、
 * `progress` 0~1 或 null（null = 没有明确进度，画无限进度环）、
 * `since` + `total` 倒计时的起点与总时长（0 = 不倒计时）、
 * `action` 动作名（第三类）、`button` 按钮文案（第三类）。
 *
 * **`tick` 每变一次，渲染层就把这条重建一次**，于是入场那层主题色渐隐动画**重播一遍**。
 * 只在「这条通知真正变了意思」的地方自增（任务完成 / 失败），
 * **逐帧的进度更新不许动它** —— 那样一圈主题色会闪一路。
 */
export const toasts = reactive([])

let seq = 0
/** 同时最多几条：再多就该收掉最老的，否则整屏都是提示 */
const MAX = 3

/** 按 key / id 找一条 */
function find(keyOrId) {
  if (keyOrId === '' || keyOrId === null || keyOrId === undefined) return -1
  return toasts.findIndex((t) => (t.key && t.key === keyOrId) || t.id === keyOrId)
}

/** 收掉一条（索引已定位时才用） */
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
    ...entry,
  }
  toasts.push(t)
  while (toasts.length > MAX) toasts.shift()
  return t
}

/* ----------------------------- 第一类 · 一次性通知 ----------------------------- */

/**
 * 弹一条一次性通知（说完就自己走）。返回一个立刻收掉它的函数。
 */
export function toast(message, ms = 2400, opts = {}) {
  const { key = '' } = opts
  const i = find(key)
  const prev = i >= 0 ? toasts[i] : null
  if (prev) drop(i)
  const t = push({
    kind: 'toast',
    key: key || prev?.key || '',
    message,
    ms,
    expireAt: ms ? Date.now() + ms : 0,
  })
  return () => dismissToast(t.key || t.id)
}

/** 立刻收掉一条提示（按 key 或 id 都行）。**不存在的 key 当没事**，调用方不必先判断 */
export function dismissToast(keyOrId) {
  drop(find(keyOrId))
}

/**
 * 「整个提示栈先藏起来」——**播放时隐藏顶栏**（`settings.hideTopBar`）那件事的一半：
 * 判据（走带中 + 不在编辑模式）只有 `PlayerView` 有，栈本身挂在 `App.vue` 上够不着它，
 * 所以由页面把结果转达进来，栈只负责长出 `.top-hidden` 那一段平移。
 * **不是「清空提示」** —— 正在显示的通知原样留着，只是跟着顶栏一起挪出屏幕。
 */
export const hintsHidden = ref(false)

export function setHintsHidden(hidden) {
  hintsHidden.value = !!hidden
}

/**
 * 把所有过期的收掉，返回「还有没有活着的」。
 * **组件的 ticker 调它** —— 过期判定集中在数据层，组件只负责按时来问。
 */
export function sweep() {
  const now = Date.now()
  for (let i = toasts.length - 1; i >= 0; i--) {
    const t = toasts[i]
    if (t.expireAt && t.expireAt <= now) toasts.splice(i, 1)
  }
  return toasts.length > 0
}

/* ------------------------------ 第二类 · 任务型通知 ------------------------------ */

/**
 * 任务句柄。**任务完成后不是新发一条，而是把同一条就地变成一次性通知**
 * （用户要求「任务完成后变为一次性通知显示任务完成，而不是新发一个通知说完成」）。
 *
 * 每个方法都会先检查「这条还在不在」：被后来的通知顶掉、或者已经收掉之后再调，全部静默忽略 ——
 * 异步任务收尾晚一拍是常态，不该因此报错。
 */
function makeHandle(t) {
  const id = t.id
  /** 还在表里才有意义（被顶掉 / 收掉之后一切方法都是空操作） */
  const live = () => find(id) >= 0
  const at = () => toasts[find(id)]

  /** 就地改文案 / 进度。**改进度不动 `tick`**（否则主题色入场动画会一路闪） */
  const set = (patch) => {
    if (!live()) return
    Object.assign(at(), patch)
  }

  const settle = (state, text, ms, nextTick = true) => {
    if (!live()) return
    const cur = at()
    // 先清掉自动消失的约定（`expireAt`），否则跑到一半就被上一轮的到期时间收掉了
    Object.assign(cur, {
      kind: 'toast',
      state,
      message: text,
      ms,
      expireAt: ms ? Date.now() + ms : 0,
      progress: null,
      // 这一下是「这条通知变了意思」：重播一次入场动画，完成时也有一段主题色渐隐做提示
      tick: nextTick ? cur.tick + 1 : cur.tick,
    })
  }

  return {
    /**
     * 改文案，或推进进度：**`update(text, 已做, 总数)` 两个都写才是确定进度**
     * （只写文案就 `update(text)`；想退回无限进度环就 `update(text, null)`）。
     */
    update(text, done = null, total = null) {
      if (!live()) return
      const patch = {}
      if (text != null) patch.message = text
      if (done === null) patch.progress = null
      else if (total != null) patch.progress = total > 0 ? Math.max(0, Math.min(1, done / total)) : null
      // 只给一个数、没给总数 = 调错了：与其画一条错的弧，不如把话说清楚（DEV 能立刻看见）
      else throw new Error('[toast] update(text, done, total) 要确定进度必须同时给 done 和 total')
      set(patch)
    },
    /**
     * 干完了：**同一条就地变成一次性通知**。
     * `ms` 默认 2400（和 `toast()` 一个时长），没有 `text` 就直接收掉。
     */
    done(text, ms = 2400) {
      if (!live()) return
      if (!text) return this.close()
      settle('done', text, ms)
    },
    /** 失败：同一条就地报错（错误提示留久一点，默认 4200） */
    fail(text, ms = 4200) {
      if (!live()) return
      settle('failed', text || '', ms)
    },
    /** 收掉，什么都不报 */
    close() {
      drop(find(id))
    },
  }
}

/**
 * 起一条任务型通知。**同一时刻只留一条「在跑」的任务**（默认共用一个槽位 `key='task'`）：
 * 后一个任务顶掉前一个，否则导入 10 个包会堆 10 条进度。
 *
 * `opts.key` 可以给它自己的槽位（互不相干的两件事各占一条时才给）。
 */
export function task(message, opts = {}) {
  const { key = 'task', progress = null } = opts
  /* ⚠️ **只顶掉「还在跑」的那条**（按 key + state 找，不能只按 key 找第一条）：
     刚跑完、正在显示「已导入 3 张…」的那条**不许顶** —— 它已经变成一次性通知了，用户还没看完。
     它自己到点会走，新任务另起一条（同 key 不冲突：句柄是按 `id` 找自己的，见 makeHandle）。 */
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

/* ----------------------------- 第三类 · 带按钮的通知 ----------------------------- */

/**
 * 弹一条带按钮的通知（现在的撤销条）。`action` 是**动作名**，由 `App.vue` 的 `onToastAct` 派发。
 *
 * `opts.ms` 是整条提示的存活时间（撤销条 = 6 秒的撤销窗口）；给 `opts.total` 才会在
 * 按钮左边画那圈**倒计时环**（弧长按剩余时间走，见 `ProgressRing`），缺省就不画。
 *
 * **按钮按下去时由调用方自己收掉它**（`opts` 里的动作自己 `dismissToast(key)`）——
 * 这里不自动收，因为「按下去要做什么」只有调用方知道。
 *
 * **同一个 key 再发一次就是「还是这件事、又发生了一遍」**（连删）：旧的那条被顶掉、
 * 新的那条从满圈重新开始，也就是**倒计时重置**。
 */
export function actionToast(message, action, button, opts = {}) {
  const { key = 'action', ms = 0, total = 0 } = opts
  const i = find(key)
  if (i >= 0) drop(i)
  return push({
    kind: 'action',
    key,
    message,
    action,
    button,
    ms,
    since: Date.now(),
    total,
    expireAt: ms ? Date.now() + ms : 0,
  })
}

/** 报错那条挂多久：**和撤销条同一个 6 秒窗口**（倒计时环走的也是它） */
const ERROR_MS = 6000

/**
 * 弹一条**可复制的报错通知** —— 第三类（带按钮那条）的第二个使用者，
 * 外形、那颗按钮的三态、倒计时环全部复用撤销条那一套（**不另画一套报错样式**）。
 *
 * · 正文就是报错原文（`err?.message` 或「××失败」那句话），按钮是「复制」（动作名 `'copy'`，
 *   由 `App.vue` 把它放进剪贴板）；倒计时环表达的是「还剩多久能复制」。
 * · **固定一个槽位 `key = 'error'`**：又报一个错就顶掉前一个，屏幕上不会堆一串报错。
 *   ⚠️ 槽位不能和撤销条（`key = 'undo'`）撞：两条同时在时是各占一条、上下排开。
 */
export function errorToast(message, opts = {}) {
  const { key = 'error', ms = ERROR_MS } = opts
  return actionToast(message, 'copy', t('common.copy'), { key, ms, total: ms })
}
