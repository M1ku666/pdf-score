/**
 * 行的重叠判定（纯逻辑，无 DOM）
 *
 * 行标记工具新建的行（**拖出来的、或点两次成的那一条**）**不能与同一页已有的行重叠**：
 * 叠上去的话那一块会变成两条行的浅底 + 四条边线摞在一起，小节也就跟着被算两遍
 * （`deriveStructure` 是按行顺序数小节的），观感与编号一起坏掉。
 * **没有例外** —— 新行整个套在一条已有行内部、或者把一条已有行整个罩住，都算重叠、都落不下来
 * （行工具只做三件事：点已有行 = 删，点行外的空白两次 = 新建一行，拖动 = 新建一行）。
 *
 * 行工具就这两个判据（都在本文件里）：**不重叠**（`overlapSystem`）与**够高**（`clampToPage`）——
 * 「点两次」那条路把两条行沿交给同一支 `clampToPage`（点回原处就是「不够高」这一档）。
 * 新行的小节线不用手画：`store/player.js` 在新建之后**自动跑一遍谱面识别**补上
 * （见 `docs/concepts.md` §6）。
 *
 * 约定：
 *  · 这是**交互写入的约束**，不是数据的不变量：`schema.js` 照样接受外来 JSON / OMR 里重叠的行，
 *    只有行标记工具划出来的新行走这一道。宽度方向不参与判定 —— 行一律整页宽（见 `ScorePage`）。
 *  · 只判「区间是否相交」，所以 **y0/y1 谁大谁小都行**：meta 的示例写 y0 < y1，而 OMR 的
 *    truth 是 y0 > y1（见 `omr.js` 末尾的 toPt.y 与 docs/invariants.md 第 1 条），这里统一 min/max。
 *  · 判定是**闭区间**：端点相等算「贴着」不算「重叠」，但留 `ROW_EPS` 的容差 —— 屏幕上边缘
 *    正好对上的两次拖动，pt 值会差出一点点毛刺，按严格相等判会时对时错。
 *  · `minH`（**行的高度下限，pt**）由调用方按当前缩放算好传进来：它是**屏幕上的 20 CSS px**
 *    （`ROW_MIN_PX`），换算成 pt 就是 `ROW_MIN_PX / scale`。
 *    **这一层不读 CSS 变量、也不认 px** —— 纯逻辑无 DOM（`scripts/unit-test.mjs` 在 node 里跑），
 *    而且显示方式（整页 / 居中）与缩放一变，同一个 20px 对应的 pt 就不一样。
 *    比它更扁的区间一律落不下来（`clampToPage` 给 null）。
 */

/** 行的高下限（**CSS px**，不是可点尺寸那一档）：换算成 pt 是调用方的事（`ROW_MIN_PX / scale`） */
export const ROW_MIN_PX = 20

/**
 * `minH` 的缺省值（pt）：**只是给省略了 `minH` 的调用方一个确定的值** ——
 * 调用方应当自己按当前缩放算好传进来（`ROW_MIN_PX / scale`）；它不等于任何缩放下的 `ROW_MIN_PX`。
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
