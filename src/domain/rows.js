/**
 * 行的重叠 / 拆分判定（纯逻辑，无 DOM）
 *
 * 行标记工具拖出来的新行**不能与同一页已有的行重叠**：叠上去的话那一块会变成两条行的浅底 + 四条
 * 边线摞在一起，小节也就跟着被算两遍（`deriveStructure` 是按行顺序数小节的），观感与编号一起坏掉。
 *
 * **唯一的例外是「整条套住」**（`containingSystem`）：新行两端都落在某条已有行内部时，
 * 那条已有行被新行减去、拆成上下两条（`splitSystemBounds`），新行自己**不落下来**。
 * 判据的顺序是「先问套住、再问重叠」：只压住一半（一端伸到行外）仍旧按重叠拒绝。
 *
 * 约定：
 *  · 这是**交互写入的约束**，不是数据的不变量：`schema.js` 照样接受外来 JSON / OMR 里重叠的行，
 *    只有行标记工具划出来的新行走这一道。宽度方向不参与判定 —— 行一律整页宽（见 `ScorePage`）。
 *  · 只判「区间是否相交」，所以 **y0/y1 谁大谁小都行**：meta 的示例写 y0 < y1，而 OMR 的
 *    truth 是 y0 > y1（见 `omr.js` 末尾的 toPt.y 与 docs/invariants.md 第 1 条），这里统一 min/max。
 *  · 判定是**闭区间**：端点相等算「贴着」不算「重叠」，但留 `ROW_EPS` 的容差 —— 屏幕上边缘
 *    正好对上的两次拖动，pt 值会差出一点点毛刺，按严格相等判会时对时错。
 *  · `minH`（**行的高度下限，pt**）由调用方按当前缩放算好传进来：它是**屏幕上的一档点击尺寸**
 *    （`ROW_MIN_PX`，即 `--tap` = 46 CSS px），换算成 pt 就是 `ROW_MIN_PX / scale`。
 *    **这一层不读 CSS 变量、也不认 px** —— 纯逻辑无 DOM（`scripts/unit-test.mjs` 在 node 里跑），
 *    而且显示方式（整页 / 居中）与缩放一变，同一个 46px 对应的 pt 就不一样。
 *    比它更扁的行一律不成立：拖出来的区间不够高（`clampToPage` 给 null）、拆出来的某一半不够高
 *    （`splitSystemBounds` 给 null）、连「拆了它剩下的两半都不够高」的那条行本身也不许拆
 *    （`containingSystem` 给 null）。不成立的那一笔按「不加也不拆」处理，颜色档与别的拒绝同一档（灰）。
 *    省略它时按 `DEFAULT_MIN_H`。
 */

/** 行的高下限（**CSS px**，与 `--tap` 同值）：换算成 pt 是调用方的事（`ROW_MIN_PX / scale`） */
export const ROW_MIN_PX = 46

/**
 * `minH` 的缺省值（pt）：**0.3 缩放下的 46px**（`ROW_MIN_PX` 在这一点上的等效高度）。
 * 只是给省略了 `minH` 的调用方一个确定的值 —— 调用方应当自己按当前缩放算好传进来。
 */
export const DEFAULT_MIN_H = 46

/** 判定用的毛刺容差（pt）：端点差在这个值以内就算「贴着」，见本文件头部的闭区间那一条 */
export const ROW_EPS = 0.5

/**
 * 某个行与 `[lo, hi]` 是否重叠；重叠就返回那条行（调用方要拿它给用户报「和哪一条撞上了」），
 * 不重叠返回 null。
 * `lo > hi` 会先对调；零高度的行按「点」处理（只要这个点落在别的行里就算重叠）。
 */
export function overlapSystem(systems, lo, hi) {
  const a = Math.min(lo, hi)
  const b = Math.max(lo, hi)
  for (const s of systems || []) {
    const c = Math.min(s.y0, s.y1)
    const d = Math.max(s.y0, s.y1)
    if (a < d - ROW_EPS && b > c + ROW_EPS) return s
  }
  return null
}

/**
 * 拖出来的 `[lo, hi]` 是否**整个套在某条已有的行里**（两端都在那条行内部）**而且拆得成** ——
 * 是就返回那条行，否则 null。这就是「拆行」的判据：套住的那条行被 `[lo, hi]` 减去，
 * 剩下**上方**与**下方**两段（见 `splitSystemBounds`）。
 *
 * 与 `overlapSystem` 的分工：**先问这个、再问重叠** —— 严格套住才算拆，只压住一半
 * （一端伸到行外）仍旧是重叠，照旧拒绝。
 * 容差与重叠判定同一套（`ROW_EPS`）：新行的端点与那条行的边只差一点毛刺时，
 * 剩下的那半薄到算不上一条行，当作没套住更安全。
 *
 * **「拆得成」也算在判据里**：减去新行之后上下两半**都得不低于 `minH`**，否则返回 null
 * （原行本身就不够两条最小行的高度时，怎么切都切不出两半）。这一条**不必由调用方再补一次** ——
 * 套住意味着新行与那条行必定相交，所以这种「套住但拆不成」的区间落回 `overlapSystem` 时
 * 一定被判为重叠、走「不加也不拆」那一支；`updateBand` 的灰档（拒绝）因此天然覆盖了它，
 * 不会画成红档。`splitSystemBounds` 用的是同一条算式，两边的结论不会打架。
 */
export function containingSystem(systems, lo, hi, minH = DEFAULT_MIN_H) {
  const a = Math.min(lo, hi)
  const b = Math.max(lo, hi)
  for (const s of systems || []) {
    const c = Math.min(s.y0, s.y1)
    const d = Math.max(s.y0, s.y1)
    if (a > c + ROW_EPS && b < d - ROW_EPS && b - a >= minH && d - b >= minH && a - c >= minH) return s
  }
  return null
}

/**
 * 「已有的行 − 新行」剩下的两条：`above`（上边那半，`y` 更大）与 `below`（下边那半）。
 * 任一半**低于 `minH`** 时那一半是 `null`（那就是「没剩下」，不是一条行）。
 * 返回的 `{ above, below }` 里的区间已经 min/max 过，且沿用**原行**的上下沿顺序
 * （原行 y0/y1 反着写时两半也反着写，免得同一页里两种写法混着）。
 */
export function splitSystemBounds(sys, lo, hi, minH = DEFAULT_MIN_H) {
  const a = Math.min(lo, hi)
  const b = Math.max(lo, hi)
  const c = Math.min(sys.y0, sys.y1)
  const d = Math.max(sys.y0, sys.y1)
  const flipped = Number(sys.y0) > Number(sys.y1)
  const half = (x, y) => (y - x >= minH ? (flipped ? { lo: y, hi: x } : { lo: x, hi: y }) : null)
  return { above: half(b, d), below: half(c, a) }
}

/**
 * 把区间夹进页面高度 `[0, pageH]`（`null` 表示拖出来的东西整个在页面之外）。
 * 页高取不到时（老数据 / 外来 JSON 可能没有）不夹 —— 那总比把行弄丢强。
 *
 * **夹完还要够高**：低于 `minH` 的区间一律给 null。这里只按拖出来的区间判，
 * 不替调用方把薄区间撑到最小值 —— 撑开会多出一条用户没划出来的行（松手落下的必须
 * 正是预览带那一条），所以「太扁」与「拖到页外」同样按无效处理。
 */
export function clampToPage(lo, hi, pageH, minH = DEFAULT_MIN_H) {
  let a = Math.min(lo, hi)
  let b = Math.max(lo, hi)
  const max = Number(pageH)
  if (Number.isFinite(max) && max > 0) {
    a = Math.max(0, Math.min(max, a))
    b = Math.max(0, Math.min(max, b))
  }
  return b - a >= minH ? { lo: a, hi: b } : null
}
