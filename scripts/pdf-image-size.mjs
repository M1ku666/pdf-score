import { openPdfPageImages } from './pdf-page-image.mjs'

const pdf = process.argv[2]
const doc = await openPdfPageImages(pdf)
for (let n = 1; n <= doc.numPages; n++) {
  const size = await doc.pageSize(n)
  const native = await doc.pageImage(n, 1)
  console.log(`第 ${n} 页 页面 ${size.width.toFixed(1)}x${size.height.toFixed(1)}pt 原生位图 ${native.width}x${native.height}px（${(native.width / size.width).toFixed(2)} px/pt = ${((native.width / size.width) * 72).toFixed(0)} DPI）`)
}
await doc.destroy?.()
