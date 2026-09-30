import { readFileSync } from 'node:fs'

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => import('pdfjs-dist/build/pdf.mjs'))

const args = {}
const positional = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const [k, ...rest] = a.replace(/^--/, '').split('=')
    args[k] = rest.join('=') || argv[++i] || '1'
  } else positional.push(a)
}
const file = positional[0]
if (!file) {
  console.error('用法：node scripts/pdf-survey.mjs <pdf> [--pages=1,2]')
  process.exit(2)
}

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), disableWorker: true, isEvalSupported: false }).promise
const { OPS } = pdfjs
const NAME = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]))
const wanted = (args.pages || '').split(',').map(Number).filter((n) => n > 0)
const pages = wanted.length ? wanted : Array.from({ length: doc.numPages }, (_, i) => i + 1)
console.log(`== ${file} == 页数 ${doc.numPages}`)

for (const n of pages) {
  const page = await doc.getPage(n)
  const vp = page.getViewport({ scale: 1, rotation: page.rotate || 0 })
  const ops = await page.getOperatorList()
  const counts = {}
  for (const fn of ops.fnArray) counts[NAME[fn] || fn] = (counts[NAME[fn] || fn] || 0) + 1
  const kind = (counts.paintImageXObject || 0) > 0 && ops.fnArray.length <= 12 ? '整页一张位图' : '矢量绘制'
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `${k}:${v}`)
    .join('  ')
  console.log(`  第 ${n} 页 ${vp.width.toFixed(1)}x${vp.height.toFixed(1)}pt 操作数 ${ops.fnArray.length}  [${kind}]`)
  console.log(`    ${top}`)
}
await doc.destroy?.()
