/**
 * 一次性修复脚本：把因 Windows PowerShell 5.1 的 ANSI 读写而损坏的文件重新规范成合法 UTF-8。
 * 非法字节会被替换成 U+FFFD，之后需要人工补回丢失的字符。
 *   node scripts/fix-encoding.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
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
    else if (EXT.has(extname(e.name)) || e.name.startsWith('.')) files.push(p)
  }
}
walk(root)

let fixed = 0
for (const f of files) {
  let buf
  try {
    buf = readFileSync(f)
  } catch {
    continue
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    const s = buf.toString('utf8')
    writeFileSync(f, s, 'utf8')
    console.log(`已修复编码: ${f.slice(root.length + 1)}（含 ${(s.match(/\uFFFD/g) || []).length} 个待补字符）`)
    fixed++
  }
}
console.log(fixed ? `共修复 ${fixed} 个文件` : '所有文件都是合法 UTF-8')
