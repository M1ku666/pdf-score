/**
 * 生产构建冒烟测试：对 dist 产物（vite preview）跑真实用户路径
 *   node scripts/smoke-dist.mjs [url]
 * 覆盖：SPA 路由回退、新增乐谱（真实文件选择）→ IndexedDB → pdf.js worker → canvas 渲染、
 *       资源 404、运行时错误、开发期全局是否已被剔除
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const URL_BASE = process.argv[2] || 'http://127.0.0.1:4173/'
const OUT = resolve(root, 'artifacts')
const PORT = 9600 + Math.floor(Math.random() * 300)
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const browser = BROWSERS.find((p) => existsSync(p))
if (!browser) {
  console.error('找不到 Edge/Chrome')
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })
const profile = join(tmpdir(), `pdf-score-dist-${Date.now()}`)

/* ---------- 生成一份最小 PDF，用于真实文件导入 ---------- */
function makePdf() {
  const ops = []
  const xs = [72, 185, 297, 410, 523]
  for (let s = 0; s < 5; s++) {
    const top = 700 - s * 128
    ops.push('0.8 w 0 0 0 RG')
    for (let l = 0; l < 5; l++) ops.push(`72 ${top - l * 8} m 523 ${top - l * 8} l S`)
    for (const x of xs) ops.push(`${x} ${top} m ${x} ${top - 32} l S`)
    ops.push(`BT /F1 10 Tf 74 ${top + 12} Td (Line ${s + 1}) Tj ET`)
  }
  const stream = ops.join('\n')
  const objs = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = '<< /Type /Pages /Count 1 /Kids [3 0 R] >>'
  objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`
  objs[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  let out = '%PDF-1.4\n'
  const offsets = []
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objs.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const file = join(OUT, 'smoke-test.pdf')
  writeFileSync(file, Buffer.from(out, 'latin1'))
  return file
}
const pdfPath = makePdf()

const child = spawn(
  browser,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--mute-audio', '--window-size=430,932', 'about:blank'],
  { stdio: 'ignore' }
)

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const page = (await r.json()).find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { }
    await sleep(250)
  }
  throw new Error('DevTools 不可用')
}

let seq = 0
const pending = new Map()
const errors = []
const warnings = []
const requests = []
let ws
try {
  ws = new WebSocket(await target())
} catch (err) {
  console.error(err.message)
  process.exit(2)
}
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws 连接失败'))
})

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id) {
    const p = pending.get(m.id)
    if (p) {
      pending.delete(m.id)
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
    }
    return
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') warnings.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text)
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'warning') warnings.push(m.params.entry.text)
  if (m.method === 'Network.responseReceived') requests.push({ url: m.params.response.url, status: m.params.response.status, type: m.params.type })
}

function send(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }))
}

async function evaluate(expression, byValue = true) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: byValue, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return byValue ? r.result?.value : r.result
}

async function waitFor(expr, timeout = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try {
      const v = await evaluate(`return (${expr})`)
      if (v) return v
    } catch { }
    await sleep(150)
  }
  return null
}

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true })

console.log('\n[1] 生产页面加载')
await send('Page.navigate', { url: URL_BASE })
check('乐谱库页面渲染', !!(await waitFor(`!!document.querySelector('.gallery')`)))
check('开发期调试全局已剔除', (await evaluate(`return typeof window.__app === 'undefined'`)) === true)

console.log('\n[2] SPA 深层路由回退')
await send('Page.navigate', { url: `${URL_BASE}score/not-exist` })
await sleep(1200)
const fallback = await evaluate(`return { ok: !!document.querySelector('#app'), text: (document.querySelector('.state') || {}).innerText || '' }`)
check('直接访问 /score/xxx 不 404', fallback.ok, String(fallback.text).replace(/\n/g, ' ').slice(0, 40))

console.log('\n[3] 真实导入 PDF（文件选择 → IndexedDB → pdf.js 渲染）')
await send('Page.navigate', { url: URL_BASE })
await waitFor(`!!document.querySelector('.gallery')`)
const opened = await evaluate(`
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('新增乐谱'))
  if (!btn) return false
  btn.click()
  return true
`)
check('打开「新增乐谱」面板', opened)
await sleep(500)
const inputNode = await evaluate(`return document.querySelector('input[type=file][accept="application/pdf"]')`, false)
check('找到 PDF 文件输入框', !!inputNode?.objectId)
await send('DOM.setSquareArrowRightEnterFiles', { files: [pdfPath], objectId: inputNode.objectId })
await sleep(400)
const picked = await evaluate(`return [...document.querySelectorAll('.pick-file')].map((b) => b.textContent.trim()).join(' | ')`)
check('文件已选中', /smoke-test\.pdf/.test(picked), picked.slice(0, 80))

const created = await evaluate(`
  const btn = [...document.querySelectorAll('.sheet-foot button')].find((b) => b.textContent.includes('创建'))
  if (!btn) return false
  btn.click()
  return true
`)
check('点击创建并打开', created)
const canvasOk = await waitFor(`(() => { const c = document.querySelector('.score-page canvas'); return c && c.width > 400 ? c.width + 'x' + c.height : 0 })()`, 30000)
check('生产模式 PDF 渲染到 canvas', !!canvasOk, canvasOk || '超时')

const content = await evaluate(`
  const c = document.querySelector('.score-page canvas')
  if (!c) return 0
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let dark = 0
  for (let i = 0; i < d.length; i += 4 * 89) if (d[i] < 200) dark++
  return dark
`)
check('canvas 有实际内容', content > 20, `暗色采样 ${content}`)

const measures = await evaluate(`return (document.querySelector('.title-box .chip') || {}).textContent || ''`)
const autoEdit = await evaluate(`return !!document.querySelector('.toolbar .tool') && !!document.querySelector('.wave-canvas, .wave-empty')`)
check('没有音频/标记的乐谱自动进入编辑模式', autoEdit, `${measures.trim()}`)

const workerFile = (await import('node:fs')).readdirSync(join(root, 'dist/assets')).find((f) => /^pdf\.worker.*\.mjs$/.test(f))
const workerRes = workerFile ? await fetch(`${URL_BASE}assets/${workerFile}`) : null
check('pdf.js worker 已随产物发布并可访问', !!workerRes && workerRes.ok, workerFile ? `${workerRes.status} ${workerFile}` : 'dist/assets 中找不到 worker')
check('未退化为主线程 fake worker', warnings.filter((w) => /fake worker|Setting up fake worker/i.test(String(w))).length === 0, warnings.slice(0, 2).join(' | ').slice(0, 120))

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(join(OUT, 'dist-player.png'), Buffer.from(shot.data, 'base64'))

console.log('\n[4] 资源与错误')
const notFound = requests.filter((r) => r.status >= 400 && r.url.startsWith(URL_BASE) && !/favicon/.test(r.url))
check('无 404 资源', notFound.length === 0, notFound.slice(0, 4).map((r) => `${r.status} ${r.url.split('/').pop()}`).join(', '))
check('favicon 可访问', (await fetch(`${URL_BASE}favicon.svg`)).ok)
const realErrors = errors.filter((e) => !/favicon/i.test(String(e)) && !/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(String(e)))
if (realErrors.length) realErrors.slice(0, 8).forEach((e) => console.log('  ! ' + String(e).slice(0, 240)))
check('无运行时错误', realErrors.length === 0, `${realErrors.length} 条`)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
try {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGKILL')
} catch { }
await sleep(300)
try {
  rmSync(profile, { recursive: true, force: true })
} catch { }
process.exit(fail ? 1 : 0)
