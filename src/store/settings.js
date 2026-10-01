/**
 * 全局偏好设置（localStorage 持久化）
 *  - showButtonLabels：「上面图标、下面文字」的按钮是否显示那行文字（管全部三处悬浮胶囊
 *    与乐谱库标题栏那颗「备份」圆钮，见 docs/ui.md §16.4）
 *  - scrollMode   ：'page' 显示整页（页高顶满）/ 'center' 始终居中（页宽顶满、当前行居中）
 *  - libraryView  ：乐谱库列表的视图：'grid' 封面视图（左右两列，**默认**）/ 'list' 行式列表
 *    （乐谱库顶栏菜单钮的「切换视图」改它，见 docs/ui.md §16.4）
 *  - scrollAnim   ：跟随播放滚动时要不要缓动动画（关掉就是直接跳到位）
 *  - hideToolbars ：走带中把顶栏与底栏一起平移出屏幕（走带中的播放 / 暂停靠空格与双击谱面，
 *    规则见 docs/ui.md §18.35 / §18.71）
 *  - checkMarksNotice：打开一份还没完成编辑的谱（= 自动进编辑模式）时弹不弹那条居中提示，
 *    默认开（规则见 docs/ui.md §18.72）
 *  - sideWidth    ：乐谱库侧栏宽度（拖动调整，夹在 SIDE_MIN ~ SIDE_MAX）
 *  - minimapWidth ：谱面总览（浮在谱面右侧那一列）的宽度（拖动调整，夹在 MINIMAP_MIN ~ MAX）
 */
import { reactive, watch } from 'vue'

const KEY = 'pdf-score:settings'

export const settings = reactive({
  showButtonLabels: true,
  scrollMode: 'page',
  libraryView: 'grid',
  scrollAnim: true,
  hideToolbars: false,
  checkMarksNotice: true,
  sideWidth: 0,
  minimapWidth: 0,
  // 预备拍（一小节倒数）相关
  countInPlay: false, // 正常播放前
  countInJump: false, // 跳转后
  countInLoop: false, // 循环回到开头时
  autoPlayOnJump: false, // 点击小节 / 跳转后自动开始播放
})

const BOOLS = ['showButtonLabels', 'scrollAnim', 'hideToolbars', 'checkMarksNotice', 'countInPlay', 'countInJump', 'countInLoop', 'autoPlayOnJump']

try {
  const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
  // 字段名从 toolbarLabels 改成 showButtonLabels（它一直管的就不止工具栏），
  // 旧键的值照搬过来，别把已经关掉这个开关的人的偏好重置回默认
  if (typeof raw.toolbarLabels === 'boolean' && typeof raw.showButtonLabels !== 'boolean') {
    settings.showButtonLabels = raw.toolbarLabels
  }
  for (const k of BOOLS) if (typeof raw[k] === 'boolean') settings[k] = raw[k]
  if (raw.scrollMode === 'page' || raw.scrollMode === 'center') settings.scrollMode = raw.scrollMode
  if (raw.libraryView === 'grid' || raw.libraryView === 'list') settings.libraryView = raw.libraryView
  if (Number.isFinite(raw.sideWidth)) settings.sideWidth = raw.sideWidth
  if (Number.isFinite(raw.minimapWidth)) settings.minimapWidth = raw.minimapWidth
} catch {}

/**
 * 侧栏允许的宽度范围。
 * MIN = 内容自然宽：乐谱库是列表（封面视图左右两列封面 / 行式列表是缩略图 + 标题 + ⋯），
 * 比这再窄标题就开始挤了；
 * 抽屉（面板）横屏时与侧栏同宽，所以它也是面板内容的下限。
 * 它同时是**能拖到的下限** —— 再往左拖就是「收起侧栏」这个动作（见 PlayerView 的 startResize）。
 * 下限从 150 → 280 → 340 之后：比 MIN 还窄的旧值（150~279 那两版、280~339）
 * 与 0（= 用默认宽度）都按默认宽度补上，否则侧栏一打开就是已经被夹到最窄的样子。
 * `SIDE_DEFAULT` 跟着比 MIN 高 20（老关系 280/300 与 340/360 一样）。
 */
export const SIDE_MIN = 280
export const SIDE_MAX = 460
export const SIDE_DEFAULT = 280
if (settings.sideWidth < SIDE_MIN) settings.sideWidth = SIDE_DEFAULT

watch(
  settings,
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {}
  },
  { deep: true }
)

/**
 * 谱面总览那一列的宽度范围。
 * 它是**浮在谱面上的**，所以比乐谱库侧栏窄得多；但也不能太窄 —— 72px 时页块只有 60px 宽、
 * 深色下几乎看不出是「一页」，默认给到 96（内容宽 84）。小于 MIN 同样视为收起（把手手势与侧栏一致）。
 */
export const MINIMAP_MIN = 56
export const MINIMAP_MAX = 320
export const MINIMAP_DEFAULT = 160

/**
 * 底部抽屉的最大宽度（与 AppSheet 的 `.sheet-panel.bottom { max-width }` 保持一致）。
 * 窗口比它还宽时，抽屉已经长不动了，就没必要再用抽屉 —— 直接上侧栏布局。
 */
export const SHEET_MAX_W = 620
