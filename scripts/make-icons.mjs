/**
 * 图标位图生成：把 `public/favicon.svg` 光栅化成站点根目录那几份位图。
 *
 * `favicon.svg` 是这几份位图**唯一的设计稿** —— 几何、描边、配色都在那边改，这边只负责光栅化。
 * 每一档都按目标像素**原生光栅化**（走 librsvg，在最终分辨率上抗锯齿），不是从一张大图缩下来的。
 *
 * **手动跑**（`npm run icons`），不在 `predev` / `prebuild` 里：它依赖本机的 ImageMagick
 * （PATH 里要有 `magick`），那不是项目依赖 —— 只在改图标几何或换主题色之后跑一次。
 *
 * 产物（都落在 `public/`，即站点根目录）：
 *   - `favicon.ico`                —— 48 / 32 / 16 三档，老浏览器与书签栏的兜底
 *   - `apple-touch-icon.png`       —— 180×180，**不透明**白底（iOS 主屏图不支持 alpha）
 *   - `apple-touch-icon-alpha.png` —— 180×180，同一张图、保持透明底的那一版
 */
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svg = resolve(root, 'public/favicon.svg')
const pub = resolve(root, 'public')
const work = resolve(root, 'artifacts/icons')

/** 主屏图的底色：iOS 的主屏图不支持 alpha，必须铺一层不透明底 */
const TOUCH_BG = '#ffffff'
const TOUCH_SIZE = 180
/** `favicon.ico` 里装哪几档，从大到小 */
const ICO_SIZES = [48, 32, 16]
/** PNG 主屏图四周留白占最终尺寸的比例（0.1 = 每边各留 10%）；只作用于 PNG，ICO 不受影响 */
const TOUCH_PADDING = 0.2

if (!existsSync(svg)) {
  console.error(`[icons] 找不到设计稿：${svg}`)
  process.exit(1)
}

if (spawnSync('magick', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.error('[icons] 需要本机 ImageMagick：PATH 里要有 `magick`（见 docs/ui.md §7）')
  process.exit(1)
}

// 光栅化密度得从 SVG 自己的 viewBox 推：`-density D` 下 1 个用户单位 = D/96 像素。
// 写死「32 网格」会在换 viewBox 时静静地渲出错误尺寸。
const viewBox = /viewBox\s*=\s*"([^"]+)"/.exec(readFileSync(svg, 'utf8'))?.[1]
const units = Number(viewBox?.trim().split(/[\s,]+/)[2]) // viewBox="minX minY width height"
if (!Number.isFinite(units) || units <= 0) {
  console.error(`[icons] 从 ${svg} 里读不出 viewBox 的宽，算不出光栅化密度`)
  process.exit(1)
}

/**
 * 光栅化 SVG。
 * @param {number} size    输出画布的边长（像素）
 * @param {string} out     输出路径
 * @param {number} padding 四周留白比例；0 表示铺满。留白按最终尺寸算，输出仍是 size×size。
 */
const render = (size, out, padding = 0) => {
  if (padding <= 0) {
    execFileSync(
      'magick',
      ['-background', 'none', '-density', String(Math.round((size / units) * 96)), svg, '-strip', '-depth', '8', out],
      { stdio: 'inherit' },
    )
    return
  }
  // 每边留白像素；夹紧避免 inner 变成 0 或负数
  const pad = Math.min(Math.round(size * padding), Math.floor((size - 1) / 2))
  const inner = size - pad * 2
  execFileSync(
    'magick',
    [
      '-background', 'none',
      '-density', String(Math.round((inner / units) * 96)), svg,
      '-strip', '-depth', '8',
      '-bordercolor', 'none', '-border', String(pad),
      out,
    ],
    { stdio: 'inherit' },
  )
}

mkdirSync(work, { recursive: true })
try {
  const sizes = ICO_SIZES.map((size) => {
    const file = resolve(work, `icon-${size}.png`)
    render(size, file)
    return file
  })
  execFileSync('magick', [...sizes, resolve(pub, 'favicon.ico')], { stdio: 'inherit' })

  const touch = resolve(work, 'touch.png')
  render(TOUCH_SIZE, touch, TOUCH_PADDING)
  execFileSync(
    'magick',
    [touch, '-background', TOUCH_BG, '-alpha', 'remove', '-alpha', 'off', resolve(pub, 'apple-touch-icon.png')],
    { stdio: 'inherit' },
  )
  render(TOUCH_SIZE, resolve(pub, 'apple-touch-icon-alpha.png'), TOUCH_PADDING)
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log(
  `[icons] favicon.ico（${ICO_SIZES.join(' / ')}）+ apple-touch-icon.png / apple-touch-icon-alpha.png（${TOUCH_SIZE}×${TOUCH_SIZE}，留白 ${TOUCH_PADDING * 100}%）-> public/`,
)