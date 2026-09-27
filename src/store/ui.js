import { computed, reactive } from 'vue'

export const toasts = reactive([])
let seq = 0

export function toast(message, ms = 2400) {
  const id = ++seq
  toasts.push({ id, message })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, ms)
  return id
}

/** 编辑模式的四种标记工具（工具栏共用）：只存 key，渲染时再 `t()`，切语言才跟得上 */
export const EDIT_TOOLS = [
  { key: 'row', icon: 'row', labelKey: 'store.tool.row.label', hintKey: 'store.tool.row.hint' },
  { key: 'barline', icon: 'barline', labelKey: 'store.tool.barline.label', hintKey: 'store.tool.barline.hint' },
  { key: 'segment', icon: 'section', labelKey: 'store.tool.segment.label', hintKey: 'store.tool.segment.hint' },
  { key: 'repeat', icon: 'repeat', labelKey: 'store.tool.repeat.label', hintKey: 'store.tool.repeat.hint' },
]

/**
 * 布局状态：**「侧栏」和「抽屉」是两套逻辑**，别再合成一个容器：
 *
 *  · **侧栏 = 乐谱库**（`layout.library`）：横竖屏**都是左边那一条**，宽度可拖（`settings.sideWidth`）。
 *    **只有「展开 / 收起」两态、没有「关闭」** —— 它常驻 DOM，收起 = 宽度归零 + 边框归零 + 过渡，
 *    和右侧那条总览（`Minimap`）**同一套动画与手势**，所以收起时列表的搜索词 / 排序 / 多选都留着。
 *  · **抽屉 = 各个面板**（`layout.panel`，**一次只有一个**）：**永远是从下往上弹的底部抽屉**。
 *    横屏时它的宽度与侧栏一致（侧栏关着就是最小宽度），竖屏时是整幅宽、≤620 居中。
 *
 * 面板**互斥**：有新的要出来就把旧的关掉（`openDrawer` 替旧面板把 `open` 置 false，
 * 它自己再走退场过渡）。所以这里不需要「栈」—— 只记「现在轮到谁」。
 * 面板自己的开合状态仍然留在各自组件里（`settingsOpen` 之类），这里只记当前那个。
 *
 * 侧栏与抽屉**互不影响**（乐谱库开着也能弹抽屉）—— 唯一的例外是 `toLibrary()`：
 * 「只留乐谱库」的那几处入口（导入完成）会顺手把抽屉关掉，免得它压着列表。
 *
 * **别再往回加的东西**：`layout.stack` / `pushPanel` / `popPanel` / `topKey` / `hostOpen` /
 * `libraryShown` / `clearStack` / `#side-slot` 那套「栈」已全部删掉；越界罩危险色 + 叉号的
 * `.close-veil`（`sideClosing` / `sideOver` / `veilOpacity`）也已随「收起 / 展开」模型删除 ——
 * 现在只有一种语义（比最小值还窄就按拖动方向收起），没有第二种需要提示。
 *
 * **四条边距只有一处定义**：`main.css` 的 `--glass-inset-t/b/l/r`（裸数值是 `--glass-gap-*`，
 * 供 `PdfViewer` 读）。浮在谱面上的控件（底栏那对、左上「乐谱库」、右上总览三钮）都从这里取，
 * **别再各写一份 `calc(safe-x + Npx)`**。
 *
 * 把手的方向判定（侧栏右边缘、总览左边缘共用，细节见各组件）：宽度 ≥ 最小值 1:1 跟手；
 * **比最小值还窄时只看拖动方向**（往收拢方向拖 = 收起、往展开方向拖 = 展开），两个方向都只改状态、
 * 走同一段过渡；指针回到最小值以上**立刻恢复跟手**，别锁死在方向模式里；判向留 3px 基准防手抖。
 */
export const layout = reactive({
  /** 侧栏（乐谱库）在不在 */
  library: false,
  /** 抽屉里现在是谁（null = 没有抽屉） */
  panel: null,
})

/** 侧栏**展开着**没（收起 = false）。组件里读它，别直接读 `layout.library` */
export const libraryOpen = computed(() => layout.library)
/** 抽屉在不在 */
export const drawerOpen = computed(() => !!layout.panel)

/* ------------------------------ 侧栏（乐谱库） ------------------------------ */

/** 展开侧栏。宽度由 `PlayerView` 管（它才知道 `settings.sideWidth`） */
export function expandLibrary() {
  layout.library = true
}

/**
 * 收起侧栏 —— **不是「关闭」**：它常驻 DOM，收起只是宽度归零（见 `PlayerView` 的 `.collapsed`），
 * 所以列表的搜索词、排序、多选状态都还在，再展开就是原样。
 * 越界的旧宽度由 `PlayerView.expandLibrary()` 兜底回落。
 */
export function collapseLibrary() {
  layout.library = false
}

/**
 * 「只留乐谱库」：关掉抽屉（它的入口都在乐谱库里，被抽屉压着不好看）再把侧栏展开。
 * 从乐谱库里打开某个面板**不走它** —— 那是「弹抽屉」，侧栏该留在原地。
 */
export function toLibrary() {
  closeDrawer(layout.panel)
  expandLibrary()
}

/* ------------------------------- 抽屉（面板） ------------------------------- */

/** 每个面板自己的 close（把它那个 `open` 置 false）。「新的顶掉旧的」靠它 */
const panelClosers = new Map()

export function registerPanel(key, close) {
  if (key) panelClosers.set(key, close)
}

export function unregisterPanel(key) {
  if (key) panelClosers.delete(key)
}

/** 打开一个面板：**一次只有一个抽屉** —— 有新的要出来就把旧的关掉 */
export function openDrawer(key) {
  if (!key) return
  const prev = layout.panel
  layout.panel = key
  if (prev && prev !== key) panelClosers.get(prev)?.()
}

/**
 * 关掉一个面板。**只有它确实是当前那个才清** ——
 * 否则「新的顶掉旧的」时，旧面板的收尾会把刚打开的新面板一起关掉。
 */
export function closeDrawer(key) {
  if (key && layout.panel === key) layout.panel = null
}

/**
 * 关掉当前抽屉（遮罩点击这类「从外面来的」关闭请求）。
 * 走面板自己登记的 close，好让它内部的 `open` 也跟着收尾。
 */
export function closeCurrentDrawer() {
  const key = layout.panel
  if (!key) return
  const closer = panelClosers.get(key)
  if (closer) closer()
  else layout.panel = null
}

/** 立刻收掉一切、不要动画（组件卸载时用） */
export function resetLayout() {
  layout.library = false
  layout.panel = null
}

/** Canvas 绘制需要的颜色（深浅色都会变，必须从 CSS 变量读） */
export function readPalette() {
  if (typeof getComputedStyle !== 'function') return { bg: '#0b0d10', accent: '#4c9dff', line: '#333', text: '#888' }
  const cs = getComputedStyle(document.documentElement)
  const get = (k, fallback) => (cs.getPropertyValue(k) || '').trim() || fallback
  return {
    bg: get('--wave-bg', '#0b0d10'),
    accent: get('--accent', '#4c9dff'),
    line: get('--stroke-strong', '#333'),
    text: get('--text-muted', '#888'),
  }
}
