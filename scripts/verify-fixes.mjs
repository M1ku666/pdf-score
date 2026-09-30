import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const URL_BASE = process.argv[2] || 'http://127.0.0.1:5173/'
const OUT = resolve(root, 'artifacts')
const PORT = 9600 + Math.floor(Math.random() * 300)
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const browser = BROWSERS.find((p) => existsSync(p))
if (!browser) process.exit(2)
mkdirSync(OUT, { recursive: true })
const profile = join(tmpdir(), `pdf-score-vf2-${Date.now()}`)
const pdfB64 = readFileSync(join(OUT, 'smoke-test.pdf')).toString('base64')

const child = spawn(browser, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--mute-audio', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' })
async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const p = (await r.json()).find((t) => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('DevTools 不可用')
}
let seq = 0
const pending = new Map()
const errors = []
const ws = new WebSocket(await target())
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws 失败'))
})
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id) {
    const p = pending.get(m.id)
    if (p) {
      pending.delete(m.id)
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
    }
    return
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text)
}
function send(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }))
}
async function ev(x) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${x} })()`, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result?.value
}
async function waitFor(e, t = 40000) {
  const t0 = Date.now()
  while (Date.now() - t0 < t) {
    try {
      const v = await ev(`return (${e})`)
      if (v) return v
    } catch {}
    await sleep(150)
  }
  return null
}
async function shot(n) {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, n), Buffer.from(s.data, 'base64'))
  console.log('    → artifacts/' + n)
}
async function readMeta(id) {
  return ev(`
    const db = await new Promise((res, rej) => { const r = indexedDB.open('pdf-score'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const rec = await new Promise((res, rej) => { const g = db.transaction('scores','readonly').objectStore('scores').get(${JSON.stringify(id)}); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error) })
    return rec ? rec.meta : null
  `)
}
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: URL_BASE })
if (!(await waitFor(`!!window.__app`, 40000))) process.exit(3)
await sleep(1200)

const id = await ev(`
  const { library } = window.__app
  const bin = atob(${JSON.stringify(pdfB64)})
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  const rec = await library.createScore({ title: 'vf', pdfFile: new File([buf], 'vf.pdf', { type: 'application/pdf' }) })
  return rec.id
`)
await send('Page.navigate', { url: `${URL_BASE}score/${id}` })
await waitFor(`!!document.querySelector('.score-page canvas')`, 40000)
await sleep(2500)

async function pickTool(label) {
  const r = await ev(`
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim().includes(${JSON.stringify(label)}))
    if (!b) return 'NOT_FOUND:' + [...document.querySelectorAll('button')].map(x=>(x.textContent||'').trim()).filter(Boolean).slice(0,14).join('|')
    b.click(); return 'ok'
  `)
  await sleep(500)
  return r
}
const pageRect = () =>
  ev(`
    const el = document.querySelector('.score-page')
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: b.left, y: b.top, w: b.width, h: b.height }
  `)
async function mouse(type, x, y, extra = {}) {
  await send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), pointerType: 'mouse', ...extra })
}
async function dragCss(x0, y0, x1, y1) {
  await mouse('mouseMoved', x0, y0, { buttons: 0 })
  await sleep(90)
  await mouse('mousePressed', x0, y0, { button: 'left', buttons: 1, clickCount: 1 })
  await sleep(100)
  for (let i = 1; i <= 5; i++) {
    await mouse('mouseMoved', x0 + ((x1 - x0) * i) / 5, y0 + ((y1 - y0) * i) / 5, { button: 'left', buttons: 1 })
    await sleep(70)
  }
  await mouse('mouseReleased', x1, y1, { button: 'left', buttons: 0, clickCount: 1 })
  await sleep(500)
}
async function clickCss(x, y) {
  await mouse('mouseMoved', x, y, { buttons: 0 })
  await sleep(90)
  await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 })
  await sleep(80)
  await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 })
  await sleep(320)
}

console.log('\n[A] 用「行」工具拖两行（先上后下）+ 补小节线')
async function settle() {
  let prev = null
  for (let i = 0; i < 40; i++) {
    const r = await pageRect()
    const key = r && `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`
    if (key && key === prev) return r
    prev = key
    await sleep(250)
  }
  return pageRect()
}
let pr = await settle()
console.log('  点「行」:', await pickTool('行'))
const s = pr.w / 595.28
const P = (px, py) => ({ x: pr.x + px * s, y: pr.y + py * s })
const rowCount = () => ev(`return document.querySelectorAll('.sys-fill').length`)

async function dragRow(py0, py1) {
  const before = await rowCount()
  const a = P(80, py0)
  const b = P(520, py1)
  await dragCss(a.x, a.y, b.x, b.y)
  await sleep(300)
  return (await rowCount()) > before
}
const ok1 = await dragRow(300, 340)
const ok2 = await dragRow(560, 600)
check('第一次拖动落下了一行', ok1)
check('第二次拖动落下了一行', ok2)
check('两行都在', (await rowCount()) === 2, `sys-fill=${await rowCount()}`)

console.log('  点「小节线」:', await pickTool('小节线'))
pr = await settle()
for (const py of [320, 580]) for (const px of [80, 190, 300, 410, 520]) {
  const q = P(px, py)
  await clickCss(q.x, q.y)
}
await sleep(1500)
await shot('vf2-A-drag-rows.png')

let meta = await readMeta(id)
let sys = (meta?.pages?.[0]?.systems || []).map((x) => ({ y0: +x.y0.toFixed(1), y1: +x.y1.toFixed(1), bars: (x.bars || []).length }))
console.log('  存进 meta 的行:', JSON.stringify(sys))
check('每行 5 条小节线', sys.length === 2 && sys.every((x) => x.bars === 5), JSON.stringify(sys.map((x) => x.bars)))
check('按 y-up 存：y0 < y1（下沿小、上沿大）', sys.length === 2 && sys.every((x) => x.y0 < x.y1), JSON.stringify(sys))
check('页顶那行的 y0 更大（= 排序与编号方向的前提）', sys.length === 2 && sys[0].y0 > sys[1].y0, JSON.stringify(sys.map((x) => x.y0)))

const disc = await ev(`
  return [...document.querySelectorAll('.m-no')].map((t) => ({ no: t.textContent, y: t.getBoundingClientRect().top }))
`)
const discs = disc.map((d) => d.no)
console.log('  圆饼(文档顺序):', JSON.stringify(discs), ' 纵坐标:', JSON.stringify(disc.map((d) => Math.round(d.y))))
const avg = (a) => (a.length ? a.reduce((v, w) => v + w, 0) / a.length : NaN)
const low = disc.filter((d) => ['1', '2', '3', '4'].includes(d.no)).map((d) => d.y)
const high = disc.filter((d) => ['5', '6', '7', '8'].includes(d.no)).map((d) => d.y)
check('小节 1–4 在**上面**那一行（编号从上往下）', low.length && high.length && avg(low) < avg(high), `1-4 y≈${avg(low).toFixed(0)} vs 5-8 y≈${avg(high).toFixed(0)}`)

console.log('\n[B] hover（悬停点从 DOM 里量出来的真实几何）')
async function hoverEl(sel, name, nth = 0) {
  const box = await ev(`
    const els = document.querySelectorAll(${JSON.stringify(sel)})
    const el = els[${nth}]
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 }
  `)
  if (!box) return { groups: 0, parts: {}, missing: sel }
  await mouse('mouseMoved', box.x - 40, box.y - 40, { buttons: 0 })
  await sleep(120)
  await mouse('mouseMoved', box.x, box.y, { buttons: 0 })
  await sleep(650)
  const info = await ev(`
    const svg = document.querySelector('.page-overlay')
    const parts = {}
    for (const g of svg.querySelectorAll('g.hover'))
      for (const c of g.querySelectorAll('*'))
        for (const k of (c.getAttribute('class')||'').split(/\\s+/).filter(Boolean)) parts[k] = (parts[k]||0)+1
    return { groups: svg.querySelectorAll('g.hover').length, parts }
  `)
  console.log(`  ${name}: 组=${info.groups} 部件=${JSON.stringify(info.parts)}`)
  await shot('vf2-B-' + name + '.png')
  return info
}

await pickTool('行')
const hRow = await hoverEl('.sys-fill', 'row')
check('行 hover：整行那组亮（sys-fill + 2×sys-edge）', hRow.groups === 1 && hRow.parts['sys-fill'] === 1 && hRow.parts['sys-edge'] === 2, JSON.stringify(hRow.parts))

await pickTool('小节线')
const hBar = await hoverEl('.bar-line:not(.ghost)', 'barline')
check('小节线 hover 连带圆饼 + 饼里的号 + 上端点圆', !!hBar.parts['m-no-disc'] && !!hBar.parts['m-no'] && !!hBar.parts['bar-dot'], JSON.stringify(hBar.parts))
check('小节线 hover 也带上那条 ghost 辅助线', !!hBar.parts['ghost'], JSON.stringify(hBar.parts))

const rowBox = await ev(`
  const f = document.querySelector('.sys-fill')
  const b = f.getBoundingClientRect()
  const bars = [...document.querySelectorAll('.bar-line:not(.ghost)')].map((l) => l.getBoundingClientRect().left)
  return { cy: (b.top + b.bottom) / 2, bars: bars.slice(0, 5) }
`)
console.log('  行中心 y =', Math.round(rowBox.cy), ' 小节线 x =', JSON.stringify(rowBox.bars.map((v) => Math.round(v))))
await pickTool('段落')
await clickCss(rowBox.bars[1], rowBox.cy)
await sleep(700)
const hSeg = await hoverEl('.seg-line', 'segment')
check('段落 hover 连带名牌 + 牌上的字', !!hSeg.parts['seg-flag'] && !!hSeg.parts['seg-text'], JSON.stringify(hSeg.parts))

await pickTool('反复')
await clickCss(rowBox.bars[3], rowBox.cy)
await sleep(700)
const hRep = await hoverEl('.rep-line', 'repeat')
check('反复 hover 连带两条线 + 两点', (hRep.parts['rep-line'] || 0) >= 2 && (hRep.parts['rep-dot'] || 0) >= 2, JSON.stringify(hRep.parts))

console.log('\n运行时错误:', errors.length ? errors.slice(0, 3) : '无')
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
try {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGKILL')
} catch {}
await sleep(300)
try {
  rmSync(profile, { recursive: true, force: true })
} catch {}
process.exit(fail ? 1 : 0)
