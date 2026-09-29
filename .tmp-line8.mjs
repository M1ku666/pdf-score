// 一次性脚本（用完即删）：用上一行唯一的 ASCII 结构（含 "unit.measure" 且含 "unit.beat"）定位
import { readFileSync, writeFileSync } from 'node:fs'

const file = 'docs/ui.md'
const lines = readFileSync(file, 'utf8').split('\n')
const hits = []
lines.forEach((l, i) => {
  if (l.includes('unit.measure') && l.includes('unit.beat') && !l.includes('import')) hits.push(i)
})
console.log('含 unit.measure + unit.beat 的行:', hits.map((i) => i + 1).join(', '))
if (hits.length !== 1) {
  hits.forEach((i) => console.log(`  ${i + 1}: ${lines[i].slice(0, 70)}`))
  console.log('锚点不唯一，退出（没有写入）')
  process.exit(1)
}
const start = hits[0]
console.log('起始行:', lines[start].slice(0, 40))
// 这一段是这一条的正文，往后找下一条「数字. **」开头的行
let end = start + 1
while (end < lines.length && !/^\d+\.\s/.test(lines[end])) end++
console.log(`正文范围: ${start + 1} - ${end}（下一条在 ${end + 1}）`)
for (let i = start; i < end; i++) console.log(`  ${i + 1}|${lines[i].length - lines[i].trimStart().length}| ${lines[i].slice(0, 30)}`)
