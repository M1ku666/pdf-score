/**
 * 把仓库里的文本文件统一成 LF（Windows PowerShell 的 Set-Content 会写出 CRLF）。
 *   node scripts/fix-line-endings.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', 'dist', 'artifacts', '.git', '.vite'])
const EXT = new Set(['.js', '.mjs', '.cjs', '.vue', '.css', '.md', '.html', '.json', '.toml', '.txt', '.svg'])

const files = []
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (EXT.has(extname(e.name))) files.push(p)
  }
}
walk(root)

let fixed = 0
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  if (!s.includes('\r\n')) continue
  writeFileSync(f, s.replace(/\r\n/g, '\n'), 'utf8')
  console.log(`已转成 LF: ${f.slice(root.length + 1)}`)
  fixed++
}
console.log(fixed ? `共处理 ${fixed} 个文件` : '行尾都已经是 LF')
