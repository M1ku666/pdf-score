import { computed, reactive } from 'vue'
import { Flag, LineDotTopVertical, RectangleHorizontal, Repeat } from '@lucide/vue'

/**
 * 提示（toast）**不在这里** —— 见 `store/toast.js`。
 * 本文件只剩「布局状态」：侧栏 / 抽屉、返回手势、Canvas 调色板。
 * 提示与布局是两件互不相干的事（提示挂在 `App.vue` 上、布局管的是页面里的浮层），
 * 合在一个文件里只会让「谁能引谁」纠缠起来：`store/toast.js` 因此**不引任何业务 store**
 * （动作只声明字符串，由 `App.vue` 派发），`store/player.js` 引它不会成环。
 */

/**
 * 编辑模式的四种标记工具（工具栏共用）：只存 key，渲染时再 `t()`，切语言才跟得上。
 *
 * `icon` 是 **`@lucide/vue` 的图标组件本身**（不是名字字符串），模板里写成
 * `<component :is="tool.icon" :size="21" />`（规矩见 `docs/ui.md` §16.1）。
 * **反复只有一张脸**：Lucide 没有 `‖:` / `:‖` 这种谱面符号，所以不再按待定起点换图标
 * （配对规则仍然在 `store/player.js` 的 `addRepeatAt`）。
 */
export const EDIT_TOOLS = [
  { key: 'row', icon: RectangleHorizontal, labelKey: 'store.tool.row.label' },
  { key: 'barline', icon: LineDotTopVertical, labelKey: 'store.tool.barline.label' },
  { key: 'segment', icon: Flag, labelKey: 'store.tool.segment.label' },
  { key: 'repeat', icon: Repeat, labelKey: 'store.tool.repeat.label' },
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
 * 提示（`toasts` / `toast()` / `dismissToast`）也已经搬去 `store/toast.js`，别在这里加回来。
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

/* --------------------------- 返回手势（手机端） --------------------------- */

/**
 * 手机端的返回手势（Android 返回键 / 从屏幕边缘右滑）= 浏览器 history 的后退。
 * **有浮层开着的时候，它必须先关浮层，而不是把整页退掉** —— 否则用户滑一下就从乐谱里退出去了，
 * 而他以为自己只是合上一个面板。
 *
 * 做法是**往 history 里压一条哨兵**：只要有第一层浮层打开，就 `pushState` 压一条同 URL 的记录；
 * 返回手势会先命中它（触发 `popstate`）→ 我们关掉最靠前的那一层浮层，同时再压一条补回去
 * （否则第二层浮层就没有哨兵可吃了）。**全部浮层关完，哨兵一起撤掉**，那时再返回才是真的路由后退。
 *
 * **为什么是「一层哨兵」而不是「一层浮层一条记录」**：抽屉互斥（`openDrawer` 顶掉旧的）、
 * 而且每一层都要自己配一条记录的话，压 / 弹的时机只要错一次，history 深度就永远对不上，
 * 表现为「要点好几次返回才退得出去」。这里改成**压栈的层数不进 history**：
 * 只要 `stack` 非空就恰好有一条哨兵，`popstate` 时**先关最靠前的那一层**再补哨兵。
 *
 * **`base` 记的是「压哨兵之前那条记录的 state」**：撤哨兵时不 `history.back()`
 * （那会真的退到上一条记录、把页面退掉），而是 `replaceState` 把 URL 换回 `base.url` ——
 * 于是 history 深度回到压哨兵之前，多出来的那一条记录被就地抹平。
 *
 * 每一层的 `dismiss` 由注册方给（面板登记的 close、遮罩的关闭动作），所以走的是**同一条收尾**，
 * 与点遮罩 / 按 Esc 完全一致（`docs/ui.md` §8：面板关闭只是导航，不代表放弃修改）。
 */
const stack = []
/**
 * **当前这条 history 记录是不是我们压的哨兵**（还没被返回手势吃掉）。
 * 它与「有没有浮层开着」不是一回事：返回手势吃掉哨兵之后，栈里可能还有别的层，
 * 这时要**补压一条新的**（`sentinel` 重新变真）。撤哨兵只看这个标志。
 */
let sentinel = false
/** 压哨兵之前那条记录的 { url, state }；撤哨兵时换回去 */
let base = null
/** 正在响应 `popstate` 的期间为真：这一段时间里 stack 的增删**不能**再去动 history */
let popping = false

/** 往 history 压一条哨兵（只在当前没有哨兵时压） */
function pushSentinel() {
  if (sentinel || typeof window === 'undefined' || !window.history?.pushState) return
  // `base` 只在**第一条**哨兵时记：补压的哨兵要还原到的仍是压第一条之前那条记录
  if (!base) base = { url: window.location.href, state: window.history.state }
  // 同 URL 压一条：地址栏不变，只是给返回手势多一个「先命中我」的落点
  window.history.pushState({ ...(window.history.state || {}), uiLayer: true }, '', base.url)
  sentinel = true
}

/**
 * 撤掉还没被吃掉的哨兵。**不能用 `history.back()`** —— 那是一次真实的返回，会退到上一条记录上；
 * 就地 `replaceState` 把这一条改回**压第一条哨兵之前**那条记录的 URL / state，
 * 多出来的那一条记录就被抹平了，history 深度回到压哨兵之前。
 *
 * ⚠️ **返回手势已经吃掉哨兵时不用撤**（那种情况下浏览器自己就退掉了一条记录，
 * 这时再 `replaceState` 只是把新位置的 URL 写对，不改变深度）—— 所以两种情况都走这里，
 * 深度都不会被撑长：区别只在「浏览器退过一条」还是「我们自己抹平一条」。
 */
function dropSentinel() {
  if (!sentinel) return
  sentinel = false
  if (typeof window !== 'undefined' && window.history?.replaceState) {
    const url = base ? base.url : window.location.href
    window.history.replaceState(window.history.state, '', url)
  }
  base = null
}

/**
 * **路由自己换过 URL 之后叫一声**（现在只有一处：打开失败退回 `/`，见 `views/PlayerView.vue` 的 `load()`）。
 *
 * `base.url` 记的是压哨兵那一刻的地址，撤哨兵 / 补压新哨兵都要拿它写回地址栏。若这期间
 * **路由把 URL 换掉了**（`router.replace('/')`），这一写就把地址栏换回那个已经被放弃的地址：
 * 表现是「地址栏写着 `/score/xxx`、应用却在首页」，再按一次返回还会当场跳回去。
 * 所以换完 URL 把 `base.url` 对齐到当前地址 —— 撤哨兵只会抹平多出来的那条记录，不再改地址。
 */
export function realignSentinelBase() {
  if (base) base.url = window.location.href
}

/**
 * 返回手势落到哨兵上：**关掉最靠前的那一层**，再按需要补一条哨兵。
 *
 * ⚠️ **到这里浏览器已经退掉了一条记录**（`popstate` 就是它的结果），所以这一条哨兵**不用撤**、
 * 只需要把 `sentinel` 置假；`dismiss()` 之后若还有别的层，就必须**补压一条新的** ——
 * 否则下一次返回手势就没有哨兵可吃，会直接退页。
 *
 * `dismiss` 抛错不能把哨兵状态带坏 —— 那一层照样算关掉了。
 */
function onPopState() {
  if (!sentinel || !stack.length) return
  // 浏览器已经吃掉这一条了：先把这个标志清掉，`dismiss` 里可能触发的注销才不会误撤
  sentinel = false
  popping = true
  const top = stack.pop()
  try {
    top.dismiss()
  } catch (err) {
    console.error('[ui] 关闭浮层失败', err)
  }
  popping = false
  // 还有别的层开着 → 补一条哨兵给下一次返回手势吃；全关完了 → 什么都不做（记录已经被浏览器退掉了）
  if (stack.length) pushSentinel()
  else base = null
}

function listen(on) {
  if (typeof window === 'undefined') return
  if (on) window.addEventListener('popstate', onPopState)
  else window.removeEventListener('popstate', onPopState)
}

/**
 * 登记一层「返回手势先关我」。返回一个注销函数（组件卸载 / 浮层关闭时调）。
 *
 * `dismiss` = 这一层被返回手势关掉时该做什么，**必须是它自己那条正规的收尾路径**
 * （面板走登记的 close、遮罩走 `closeCurrentDrawer`、确认框走把 `open` 置 false），
 * 这样返回手势与点遮罩 / Esc 走的是同一件事。
 *
 * `id` 只是给同一层重复登记时去重用的（同一个面板重开不该压两层）。
 */
export function pushBackLayer(dismiss, id = '') {
  const layer = { dismiss, id }
  if (id) {
    const i = stack.findIndex((l) => l.id === id)
    if (i >= 0) stack.splice(i, 1)
  }
  stack.push(layer)
  if (!popping) {
    listen(true)
    pushSentinel()
  }
  return () => popBackLayer(layer)
}

/** 注销一层（浮层自己关掉时调）。**哨兵还在但栈空了就撤哨兵** —— 否则返回手势会白吃一下 */
export function popBackLayer(layer) {
  const i = stack.indexOf(layer)
  if (i < 0) return
  stack.splice(i, 1)
  if (popping) return
  if (!stack.length) {
    listen(false)
    dropSentinel()
  }
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

/**
 * Canvas 上的字用的**全站字体栈**：读 `main.css` 的 `--font-ui`（那一条是唯一来源）。
 * Canvas 不认 CSS 的 `font-family` 继承，只能把字体栈字符串塞进 `ctx.font` ——
 * 但**字体名不许在组件里另写一份**（全站就这一套字体，见 `docs/ui.md` §2）。
 * 读不到令牌时退回 `sans-serif`（例如在无 DOM 的环境里跑）。
 */
export function readFontStack() {
  if (typeof getComputedStyle !== 'function') return 'sans-serif'
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-ui')
  return (value || '').trim() || 'sans-serif'
}
