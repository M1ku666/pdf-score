/**
 * 识别调参用的 CDP 跑分器（一次性工具，不属于应用代码）：
 * 启动 headless Edge/Chrome → 打开 Vite dev server 上的探针页 → 取回 window.__result → 存 JSON。
 * 用法：node scripts/omr-probe.mjs --pdf=artifacts/omr-fixture.pdf --truth=artifacts/omr-fixture.truth.json --dpi=150,200,300
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...rest] = a.replace(/^--/, '').split('=')
  return [k, rest.join('=') || '1']
}))
const pdf = args.pdf || 'artifacts/omr-fixture.pdf'
const truth = args.truth || pdf.replace(/\.pdf$/, '.truth.json')
const dpi = args.dpi || '150,200,300'
const image = args.image === '1'
const port = Number(args.port || 5173)
const out = resolve(root, args.out || `artifacts/omr-report-${basename(pdf, '.pdf')}.json`)

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

const profile = join(tmpdir(), `omr-probe-${Date.now()}`)
mkdirSync(profile, { recursive: true })
mkdirSync(resolve(root, 'artifacts'), { recursive: true })

// 调试用：任何一步卡住都要留下痕迹（默认日志是缓冲的，卡死时看不到）
const trace = (msg) => {
  console.log(`[probe] ${msg}`)
}
trace(`root=${root}`)
trace(`browser=${browser}`)
setTimeout(() => {
  console.error(`[probe] 总超时，强制退出`)
  process.exit(3)
}, 240000).unref()

const child = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--window-size=1400,1000',
    'about:blank',
  ],
  { stdio: 'ignore', detached: false }
)

function cleanup(code) {
  try {
    child.kill()
  } catch {}
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
  process.exit(code)
}

async function devtoolsPort(timeoutMs = 20000) {
  const file = join(profile, 'DevToolsActivePort')
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (existsSync(file)) {
      const line = readFileSync(file, 'utf8').split('\n')[0].trim()
      if (line) return Number(line)
    }
    await sleep(120)
  }
  throw new Error('等不到 DevToolsActivePort')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 失败')
    return r.result?.value
  }
}

async function main() {
  const dbgPort = await devtoolsPort()
  const targets = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const cdp = new Cdp(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')

  const url = `http://127.0.0.1:${port}/artifacts/omr-probe.html?pdf=/${pdf}&truth=/${truth}&dpi=${dpi}${image ? '&image=1' : ''}`
  console.log(`→ ${url}`)
  await cdp.send('Page.navigate', { url })
  const t0 = Date.now()
  let result = null
  while (Date.now() - t0 < 180000) {
    result = await cdp.eval('window.__result ? JSON.parse(JSON.stringify({ ready: window.__result.ready, error: window.__result.error, runs: window.__result.runs, crossDpi: window.__result.crossDpi, metaSample: window.__result.metaSample, imageCount: (window.__result.images||[]).length })) : null')
    if (result?.ready) break
    await sleep(400)
  }
  if (!result) throw new Error('页面没给出结果')
  if (result.error) throw new Error(result.error)
  writeFileSync(out, JSON.stringify(result, null, 2))
  if (image) {
    const images = await cdp.eval('JSON.stringify((window.__result.images||[]).map(i=>i.name))')
    const names = JSON.parse(images || '[]')
    for (let i = 0; i < names.length; i++) {
      const dataUrl = await cdp.eval(`(window.__result.images[${i}]||{}).url || ''`)
      if (!dataUrl) continue
      const buf = Buffer.from(String(dataUrl).split(',')[1], 'base64')
      writeFileSync(resolve(root, 'artifacts', names[i]), buf)
    }
    console.log(`已存 ${names.length} 张识别结果图`)
  }
  console.log(JSON.stringify(result.runs, null, 2))
  console.log(`报告：${out}`)
  ws.close()
  cleanup(0)
}

main().catch((err) => {
  console.error(err?.stack || String(err))
  cleanup(1)
})
