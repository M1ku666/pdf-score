/**
 * 行的「不许重叠」判定（纯逻辑，无 DOM）
 *
 * 行标记工具拖出来的新行**不能与同一页已有的行重叠**：叠上去的话那一块会变成两条行的浅底 + 四条
 * 边线摞在一起，小节也就跟着被算两遍（`deriveStructure` 是按行顺序数小节的），观感与编号一起坏掉。
 *
 * 约定：
 *  · 这是**交互写入的约束**，不是数据的不变量：`schema.js` 照样接受外来 JSON / OMR 里重叠的行，
 *    只有行标记工具划出来的新行走这一道。宽度方向不参与判定 —— 行一律整页宽（见 `ScorePage`）。
 *  · 只判「区间是否相交」，所以 **y0/y1 谁大谁小都行**：meta 的示例写 y0 < y1，而 OMR 的
 *    truth 是 y0 > y1（见 `omr.js` 末尾的 toPt.y 与 docs/invariants.md 第 1 条），这里统一 min/max。
 *  · 判定是**闭区间**：端点相等算「贴着」不算「重叠」，但留 `TOUCH_EPS` 的容差 —— 屏幕上边缘
 *    正好对上的两次拖动，pt 值会差出一点点毛刺，按严格相等判会时对时错。
 *  · 没有「最小高度」这一说：拖出来的区间哪怕很薄也是一条合法的行，只有**零高度**（薄到 TOUCH_EPS
 *    以内）才判为无效，那实际上是「点了一下没拖动」。
 */

/** 判定用的容差（pt）：端点差在这个值以内就算贴着 —— 既是闭区间的毛刺容差，也是行的最小高度 */
export const TOUCH_EPS = 0.5

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
    if (a < d - TOUCH_EPS && b > c + TOUCH_EPS) return s
  }
  return null
}

/**
 * 把区间夹进页面高度 `[0, pageH]`（`null` 表示拖出来的东西整个在页面之外）。
 * 页高取不到时（老数据 / 外来 JSON 可能没有）不夹 —— 那总比把行弄丢强。
 */
export function clampToPage(lo, hi, pageH) {
  let a = Math.min(lo, hi)
  let b = Math.max(lo, hi)
  const max = Number(pageH)
  if (Number.isFinite(max) && max > 0) {
    a = Math.max(0, Math.min(max, a))
    b = Math.max(0, Math.min(max, b))
  }
  return b - a > TOUCH_EPS ? { lo: a, hi: b } : null
}
