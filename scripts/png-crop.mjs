/**
 * 从一张 PNG 里裁一块出来（一次性调试工具，不属于应用代码）。
 * 用法：node scripts/png-crop.mjs <输入.png> <x0,y0,x1,y1> [输出.png]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { encodePng } from './png.mjs'

const [file, region, out] = process.argv.slice(2)
if (!file || !region) {
  console.error('用法：node scripts/png-crop.mjs <输入.png> <x0,y0,x1,y1> [输出.png]')
  process.exit(2)
}
const [x0, y0, x1, y1] = region.split(',').map(Number)
const png = readFileSync(file)
let pos = 8
let w = 0
let h = 0
const idat = []
while (pos < png.length) {
  const len = png.readUInt32BE(pos)
  const type = png.toString('ascii', pos + 4, pos + 8)
  const data = png.subarray(pos + 8, pos + 8 + len)
  if (type === 'IHDR') {
    w = data.readUInt32BE(0)
    h = data.readUInt32BE(4)
    if (data[8] !== 8 || data[9] !== 2) throw new Error('只支持 8 位真彩 PNG')
  } else if (type === 'IDAT') idat.push(data)
  pos += 12 + len
}
const raw = inflateSync(Buffer.concat(idat))
const stride = w * 3 + 1
const cw = Math.max(1, x1 - x0)
const ch = Math.max(1, y1 - y0)
const rgba = new Uint8ClampedArray(cw * ch * 4)
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const p = (y + y0) * stride + 1 + (x + x0) * 3
    const q = (y * cw + x) * 4
    rgba[q] = raw[p]
    rgba[q + 1] = raw[p + 1]
    rgba[q + 2] = raw[p + 2]
    rgba[q + 3] = 255
  }
}
const dest = out || file.replace(/\.png$/, `-crop.png`)
writeFileSync(dest, encodePng(rgba, cw, ch))
console.log(`${dest} ${cw}x${ch}`)
