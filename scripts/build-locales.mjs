/**
 * 把 `src/i18n/*.yaml` 语言包编译成 `src/i18n/locales.generated.js`。
 *
 * 为什么要有这一步：语言包是 YAML（好写好改），但**浏览器和 Node 都不认 .yaml** ——
 * `src/domain/*` 与 `scripts/unit-test.mjs` 都要在纯 node 里加载语言包，
 * 所以运行时读的始终是这个生成的 .js。改文案改的是 .yaml，别改生成物。
 *
 * 执行时机：`predev` / `prebuild` / `pretest:unit`，也可以手动 `npm run i18n`。
 * 开发时改 .yaml 会自动重新生成（见 vite.config.js 里的 watchLocales 插件）。
 *
 * 一个语言一个文件，文件名就是语言 code（`zh-CN.yaml` → `zh-CN`）。
 *   `_name`  这个键是语言自己的名字（设置面板里显示用），不算文案，不会进语言包。
 *   其余键就是 `t('点号.路径')` 的那棵树。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIR = join(ROOT, 'src/i18n')
const OUT = join(DIR, 'locales.generated.js')

/** 默认语言：取不到时回落它，也是所有语言必须齐备的那一份 key 集合 */
const DEFAULT_LOCALE = 'zh-CN'

function leaves(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, p, out)
    else out.set(p, v)
  }
  return out
}

const files = (await readdir(DIR)).filter((n) => /\.ya?ml$/.test(n)).sort()
if (!files.length) {
  console.error(`[i18n] ${DIR} 里没有找到语言包（*.yaml）`)
  process.exit(1)
}

const catalogs = {}
const locales = []
const packs = {}

for (const file of files) {
  const code = file.replace(/\.ya?ml$/, '')
  const raw = await readFile(join(DIR, file), 'utf8')
  let doc
  try {
    doc = parse(raw)
  } catch (err) {
    console.error(`[i18n] ${file} 解析失败：\n${err.message}`)
    process.exit(1)
  }
  if (!doc || typeof doc !== 'object') {
    console.error(`[i18n] ${file} 内容不是一个映射（key: value 结构）`)
    process.exit(1)
  }
  const { _name: name, ...pack } = doc
  catalogs[code] = pack
  packs[code] = leaves(pack)
  locales.push({ value: code, label: typeof name === 'string' && name ? name : code })
}

if (!catalogs[DEFAULT_LOCALE]) {
  console.error(`[i18n] 缺少默认语言 ${DEFAULT_LOCALE}.yaml`)
  process.exit(1)
}

// 结构校验：其它语言缺哪些 key 就说出来（缺的会回落到默认语言，不是致命错误）
const base = packs[DEFAULT_LOCALE]
let problems = 0
for (const code of Object.keys(packs)) {
  if (code === DEFAULT_LOCALE) continue
  const missing = [...base.keys()].filter((k) => !packs[code].has(k))
  const extra = [...packs[code].keys()].filter((k) => !base.has(k))
  if (missing.length) {
    problems += missing.length
    console.warn(`[i18n] ${code} 缺少 ${missing.length} 条：${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`)
  }
  if (extra.length) {
    problems += extra.length
    console.warn(`[i18n] ${code} 多出 ${extra.length} 条默认语言里没有的 key：${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ' …' : ''}`)
  }
}

const header = `/**
 * 自动生成，不要手改 —— 改文案请改同目录的 \`*.yaml\`，然后 \`npm run i18n\`
 * （predev / prebuild / pretest:unit 会自动跑；开发时改 .yaml 也会自动重新生成）。
 */
`

const body = `${header}
export const DEFAULT_LOCALE = ${JSON.stringify(DEFAULT_LOCALE)}

/** 语言 code → 语言包 */
export const catalogs = ${JSON.stringify(catalogs, null, 2)}

/** 可选语言（设置面板直接列它） */
export const LOCALES = ${JSON.stringify(locales, null, 2)}
`

await writeFile(OUT, body, 'utf8')
const total = [...base.keys()].length
console.log(`[i18n] ${files.length} 个语言包 → ${OUT.replace(ROOT, '')}（${DEFAULT_LOCALE} 共 ${total} 条）`)
if (problems) console.warn(`[i18n] 语言之间结构不一致，共 ${problems} 处（见上）`)
