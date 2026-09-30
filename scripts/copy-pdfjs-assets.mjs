import { cp, mkdir, access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'node_modules/pdfjs-dist')
const dest = resolve(root, 'public/pdfjs')
const dirs = ['cmaps', 'standard_fonts', 'wasm', 'image_decoders']

if (!existsSync(src)) {
  console.warn('[pdfjs-assets] 未找到 pdfjs-dist，跳过')
  process.exit(0)
}

await mkdir(dest, { recursive: true })
let copied = 0
for (const dir of dirs) {
  const from = resolve(src, dir)
  if (!existsSync(from)) continue
  const to = resolve(dest, dir)
  await cp(from, to, { recursive: true, force: true })
  copied++
}
console.log(`[pdfjs-assets] 已同步 ${copied} 个资源目录 -> public/pdfjs`)
