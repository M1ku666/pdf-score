import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

export function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      const q = y * (w * 3 + 1) + 1 + x * 3
      raw[q] = rgba[p]
      raw[q + 1] = rgba[p + 1]
      raw[q + 2] = rgba[p + 2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export function strokeRect(rgba, w, h, x0, y0, x1, y1, [r, g, b], thickness = 2) {
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const p = (y * w + x) * 4
    rgba[p] = r
    rgba[p + 1] = g
    rgba[p + 2] = b
    rgba[p + 3] = 255
  }
  for (let t = 0; t < thickness; t++) {
    for (let x = x0; x <= x1; x++) {
      put(x, y0 + t)
      put(x, y1 - t)
    }
    for (let y = y0; y <= y1; y++) {
      put(x0 + t, y)
      put(x1 - t, y)
    }
  }
}

export function hLine(rgba, w, h, x0, x1, y, [r, g, b], thickness = 2) {
  for (let t = 0; t < thickness; t++) for (let x = x0; x <= x1; x++) {
    const yy = y + t
    if (x < 0 || yy < 0 || x >= w || yy >= h) continue
    const p = (yy * w + x) * 4
    rgba[p] = r
    rgba[p + 1] = g
    rgba[p + 2] = b
    rgba[p + 3] = 255
  }
}

export function vLine(rgba, w, h, x, y0, y1, [r, g, b], thickness = 2) {
  for (let t = 0; t < thickness; t++) for (let y = y0; y <= y1; y++) {
    const xx = x + t
    if (xx < 0 || y < 0 || xx >= w || y >= h) continue
    const p = (y * w + xx) * 4
    rgba[p] = r
    rgba[p + 1] = g
    rgba[p + 2] = b
    rgba[p + 3] = 255
  }
}
