export const ROW_MIN_PX = 46

export const DEFAULT_MIN_H = 46

export const ROW_EPS = 0.5

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
