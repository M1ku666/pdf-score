/**
 * 把识别结果 overlay 缩到便于查看的尺寸（一次性工具，不属于应用代码）。
 * 用法：node scripts/omr-shrink.mjs artifacts/omr-shots/cycle-p1-200dpi.png [maxWidth]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { encodePng } from './png.mjs'

const file = process.argv[2]
const maxW = Number(process.argv[3] || 1400)
const png = readFileSync(file)

/* 只解自己写出来的那种 PNG：8 位真彩、filter 0、单个 IDAT、无隔行 */
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
    if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) throw new Error('只支持 8 位真彩非隔行 PNG')
  } else if (type === 'IDAT') idat.push(data)
  pos += 12 + len
}
const raw = (await import('node:zlib')).inflateSync(Buffer.concat(idat))
const stride = w * 3 + 1
const scale = Math.min(1, maxW / w)
const dw = Math.max(1, Math.round(w * scale))
const dh = Math.max(1, Math.round(h * scale))
const out = new Uint8ClampedArray(dw * dh * 4)
for (let y = 0; y < dh; y++) {
  const sy0 = Math.floor((y * h) / dh)
  const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * h) / dh))
  for (let x = 0; x < dw; x++) {
    const sx0 = Math.floor((x * w) / dw)
    const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * w) / dw))
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let yy = sy0; yy < sy1; yy++) {
      const row = yy * stride + 1
      for (let xx = sx0; xx < sx1; xx++) {
        // 取最暗的那个像素：缩小时细线才不会整条消失
        const p = row + xx * 3
        if (n === 0 || raw[p] + raw[p + 1] + raw[p + 2] < r + g + b) {
          r = raw[p]
          g = raw[p + 1]
          b = raw[p + 2]
        }
        n++
      }
    }
    const q = (y * dw + x) * 4
    out[q] = r
    out[q + 1] = g
    out[q + 2] = b
    out[q + 3] = 255
  }
}
const dest = join('artifacts', 'omr-shots', `small-${basename(file)}`)
writeFileSync(dest, encodePng(out, dw, dh))
console.log(`${dest}  ${dw}x${dh}`)
