import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const file = process.argv[2]
if (!file) {
  console.error('用法: node scripts/measure-cap-shot.mjs <png> [gap]')
  process.exit(1)
}
const minGap = Number(process.argv[3] || 4)

const buf = readFileSync(file)
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
let p = 8, w = 0, h = 0, bd = 0, ct = 0
const idat = []
while (p < buf.length) {
  const len = buf.readUInt32BE(p)
  const type = buf.toString('latin1', p + 4, p + 8)
  const data = buf.subarray(p + 8, p + 8 + len)
  if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9] }
  else if (type === 'IDAT') idat.push(data)
  else if (type === 'IEND') break
  p += 12 + len
}
if (bd !== 8) throw new Error('只支持 8 位深度，实际 ' + bd)
const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 0
if (!ch) throw new Error('不支持的 colorType ' + ct)

const raw = inflateSync(Buffer.concat(idat))
const stride = w * ch
const px = Buffer.alloc(w * h * ch)
let prev = Buffer.alloc(stride)
for (let y = 0; y < h; y++) {
  const ft = raw[y * (stride + 1)]
  const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
  const cur = Buffer.alloc(stride)
  for (let i = 0; i < stride; i++) {
    const a = i >= ch ? cur[i - ch] : 0
    const b = prev[i]
    const c = i >= ch ? prev[i - ch] : 0
    let v = line[i]
    if (ft === 1) v += a
    else if (ft === 2) v += b
    else if (ft === 3) v += (a + b) >> 1
    else if (ft === 4) {
      const pp = a + b - c
      const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    cur[i] = v & 255
  }
  cur.copy(px, y * stride)
  prev = cur
}

const lum = (x, y) => {
  const i = (y * w + x) * ch
  return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
}

const rowMax = [], rowMin = []
for (let y = 0; y < h; y++) {
  let mx = 0, mn = 255
  for (let x = 0; x < w; x++) { const l = lum(x, y); if (l > mx) mx = l; if (l < mn) mn = l }
  rowMax.push(Math.round(mx)); rowMin.push(Math.round(mn))
}
const whiteRows = []
for (let y = 0; y < h; y++) if (rowMax[y] >= 250) whiteRows.push(y)
const capTop = whiteRows[0]
const lastWhite = whiteRows[whiteRows.length - 1]

const nearWhiteInBand = (y) => {
  let c = 0
  for (let x = 0; x < w; x++) if (lum(x, y) >= 245) c++
  return c
}
let capBot = lastWhite
for (let y = lastWhite; y < h; y++) if (nearWhiteInBand(y) > 20) capBot = y

let bx0 = 1e9, bx1 = -1, by0 = 1e9, by1 = -1
for (let y = capTop; y <= capBot; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * ch
  const r = px[i], g = px[i + 1], b = px[i + 2]
  if (b > 150 && b - r > 60 && g < 170) {
    if (x < bx0) bx0 = x
    if (x > bx1) bx1 = x
    if (y < by0) by0 = y
    if (y > by1) by1 = y
  }
}

const isSeg = (x, y) => lum(x, y) < 170
const isInk = (x, y) => lum(x, y) < 140
const isBlue = (x, y) => {
  const i = (y * w + x) * ch
  const r = px[i], g = px[i + 1], b = px[i + 2]
  return b > 150 && b - r > 60 && g < 170
}
const colTop = [], colBot = [], colInkTop = [], colInkBot = [], colBlue = []
for (let x = 0; x < w; x++) {
  let t = -1, b = -1, it = -1, ib = -1, bl = false
  for (let y = capTop; y <= capBot; y++) {
    if (isSeg(x, y)) { if (t < 0) t = y; b = y }
    if (isInk(x, y)) { if (it < 0) it = y; ib = y }
    if (isBlue(x, y)) bl = true
  }
  colTop.push(t); colBot.push(b); colInkTop.push(it); colInkBot.push(ib); colBlue.push(bl)
}
const segs = []
let s = null, gap = 0
for (let x = 0; x < w; x++) {
  if (colTop[x] >= 0 || colBlue[x]) {
    if (!s) s = { x0: x, x1: x, top: colTop[x], bot: colBot[x], inkTop: colInkTop[x], inkBot: colInkBot[x], blue: colBlue[x] }
    else {
      s.x1 = x
      for (const [a, b] of [['top', 'bot']]) void a
      if (colTop[x] >= 0) {
        s.top = s.top < 0 ? colTop[x] : Math.min(s.top, colTop[x])
        s.bot = Math.max(s.bot, colBot[x])
      }
      if (colInkTop[x] >= 0) {
        s.inkTop = s.inkTop < 0 ? colInkTop[x] : Math.min(s.inkTop, colInkTop[x])
        s.inkBot = Math.max(s.inkBot, colInkBot[x])
      }
      s.blue = s.blue || colBlue[x]
    }
    gap = 0
  } else if (s) {
    if (++gap >= minGap) { segs.push(s); s = null }
  }
}
if (s) segs.push(s)

const L = []
L.push(`文件              ${file}`)
L.push(`图片              ${w} x ${h}  ch=${ch}`)
L.push(`胶囊              y ${capTop}..${capBot}   高 ${capBot - capTop + 1}   (纯白行 ${capTop}..${lastWhite})`)
const scale = bx1 >= 0 ? (bx1 - bx0 + 1) / 46 : 1
if (bx1 >= 0) {
  L.push(`蓝色播放钮        x ${bx0}..${bx1} (宽 ${bx1 - bx0 + 1})   y ${by0}..${by1} (高 ${by1 - by0 + 1})`)
  L.push(`截图比例          1 CSS px = ${scale.toFixed(3)} 图 px（按圆钮 46 CSS px 反推）`)
  L.push(`胶囊顶->按钮顶    ${by0 - capTop}px = ${((by0 - capTop) / scale).toFixed(2)} CSS   （规范 6 = --cap-pad 5 + 描边 1）`)
  L.push(`按钮底->胶囊底    ${capBot - by1}px = ${((capBot - by1) / scale).toFixed(2)} CSS   （规范 6）`)
}
L.push('')
L.push('横向内容分段（inkTop/inkBot = 阈值 <140 的「墨迹」行范围，白色三角不在内）')
L.push('#    x范围          宽    segTop segBot  inkTop inkBot ink高  类型')
segs.forEach((g, i) => {
  L.push(
    `${String(i).padEnd(4)} ${String(g.x0 + '..' + g.x1).padEnd(14)} ${String(g.x1 - g.x0 + 1).padEnd(4)} ` +
    `${String(g.top).padEnd(6)} ${String(g.bot).padEnd(6)} ` +
    `${String(g.inkTop).padEnd(6)} ${String(g.inkBot).padEnd(6)} ` +
    `${String(g.inkBot - g.inkTop + 1).padEnd(5)} ${g.blue ? '蓝钮' : '文字'}`
  )
})
L.push('')
L.push('★ 每颗钮的「数字行 → 小字行」间距（CSS px；规范 = 槽底到小字顶的那点余量 + --cap-label-gap 2）')
const groups = []
let g = null
for (const s of segs) {
  if (s.blue || s.inkTop < 0) continue
  if (!g) g = { x0: s.x0, x1: s.x1, inkTop: s.inkTop, inkBot: s.inkBot }
  else { g.x1 = s.x1; g.inkTop = Math.min(g.inkTop, s.inkTop); g.inkBot = Math.max(g.inkBot, s.inkBot) }
}
if (g) groups.push(g)
const btnCols = []
for (const s of segs) if (s.inkTop >= 0) btnCols.push(s)
L.push(`文字段共 ${btnCols.length} 个（数字与它的点 / 小字可能各自成段）`)
L.push('')
L.push('★ 按行统计各 x 区间的墨迹（用来切「数字行」与「小字行」；CSS px = 图 px / 比例）')
const RANGES = segs.filter((g) => !g.blue && g.inkTop >= 0).map((g, i) => [`段${i} x${g.x0}`, g.x0, g.x1])
const byRow = []
for (let y = capTop; y <= capBot; y++) {
  const r = RANGES.map(([, a, b]) => {
    let n = 0
    for (let x = a; x <= b; x++) if (lum(x, y) < 140) n++
    return n
  })
  byRow.push({ y, r })
}
L.push('  y  |' + RANGES.map(([n]) => n.padStart(9)).join(''))
for (const { y, r } of byRow) {
  if (r.every((v) => v === 0)) continue
  L.push(`${String(y).padStart(4)} |` + r.map((v) => String(v).padStart(9)).join(''))
}
L.push('')
L.push('每个区间的墨迹行范围与间距（CSS px）')
const res = RANGES.map(([name, a, b], i) => {
  const rows = byRow.filter(({ r }) => r[i] > 0).map(({ y }) => y)
  return { name: name.trim(), a, b, top: rows[0], bot: rows[rows.length - 1], n: rows.length }
})
for (const t of res) {
  L.push(`${t.name.padEnd(12)} x ${t.a}..${t.b}   行 ${t.top}..${t.bot}  高 ${t.bot - t.top + 1}px = ${((t.bot - t.top + 1) / scale).toFixed(2)} CSS`)
}
const findGap = (a, b) => {
  const rows = []
  for (let y = capTop; y <= capBot; y++) {
    let n = 0
    for (let x = a; x <= b; x++) if (lum(x, y) < 140) n++
    rows.push({ y, n })
  }
  const ink = rows.filter((r) => r.n > 0).map((r) => r.y)
  const gaps = []
  for (let i = 1; i < ink.length; i++) if (ink[i] - ink[i - 1] > 1) gaps.push([ink[i - 1], ink[i]])
  return { top: ink[0], bot: ink[ink.length - 1], gaps }
}
L.push('')
L.push('★ 每个文字段内部：数字行 / 小字行的墨迹范围与两者空隙')
for (const [name, a, b] of RANGES) {
  const g = findGap(a, b)
  const last = g.gaps[g.gaps.length - 1]
  L.push(`${name} (x ${a}..${b}): 墨迹 ${g.top}..${g.bot}   段间空隙 ${g.gaps.map(([p, q]) => `${p}->${q}(${q - p - 1})`).join(', ') || '无'}`)
  if (last) {
    L.push(`   → 「数字行底 ${last[0]}」到「小字行顶 ${last[1]}」= ${last[1] - last[0] - 1}px = ${((last[1] - last[0] - 1) / scale).toFixed(2)} CSS px`)
  }
}
L.push('')
L.push('★ 数值那一行内部：按列给墨迹 top/bot（看「整数」与「.小数」两段的落差）')
for (const [name, a, b] of RANGES) {
  const rows = []
  for (let x = a; x <= b; x++) {
    let t = -1, bo = -1
    for (let y = capTop; y <= capBot; y++) if (lum(x, y) < 140) { if (t < 0) t = y; bo = y }
    if (t >= 0) rows.push(`${x}:${t}-${bo}`)
  }
  if (rows.length) L.push(`${name}: ${rows.join(' ')}`)
}
L.push('')
L.push('逐行 (最亮/最暗)')
const y0 = Math.max(0, capTop - 6)
const y1 = Math.min(h - 1, capBot + 6)
for (let y = y0; y <= y1; y++) {
  L.push(`${String(y).padStart(3)} : ${String(rowMax[y]).padStart(3)} / ${String(rowMin[y]).padStart(3)}` +
    (y < capTop || y > capBot ? '   <-- 胶囊外' : ''))
}
console.log(L.join('\n'))
