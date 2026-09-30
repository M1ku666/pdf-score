/**
 * i18n 运行时（极简，不引第三方库）
 *
 * **文案都在同目录的 `*.yaml` 里**（一个语言一个文件，如 `zh-CN.yaml`），代码里只写 key：
 *   import { t } from '../i18n/index.js'
 *   t('common.cancel')
 *   t('library.imported', { n: 3 })   // 文案里写 {n}
 *
 * 为什么不直接 import 那个 .yaml：**浏览器与 Node 都不认 .yaml**，而 `src/domain/*`
 * 与 `scripts/unit-test.mjs` 要在纯 node 里加载语言包。所以 `.yaml` 由
 * `scripts/build-locales.mjs` 编译成 `locales.generated.js` 再被这里引用
 * （predev / prebuild / pretest:unit 会自动跑；开发时改 .yaml 也会自动重新生成并刷新页面）。
 *
 * 约定：
 *  · 语言包是**嵌套的普通对象**，用点号路径取值（`t('library.search.placeholder')`）。
 *    取不到时回落到默认语言，再取不到就返回 key 本身并在 DEV 下 warn 一条 ——
 *    漏翻一眼就能看出来，不会静默变成空白。
 *  · 占位符是 `{名字}`，参数对象按名字替换；参数缺省时原样保留，方便看出漏传。
 *  · `locale` 是一个 Vue ref，`t()` 读它 —— 模板里调用 `t()` 就自动建立了依赖，
 *    切语言后用到它的地方都会重渲染，不需要手动刷新页面。
 *  · **加一门语言 = 复制一份 `zh-CN.yaml` 改名成 `<语言 code>.yaml`，
 *    把 `_name` 与内容换掉**，然后 `npm run i18n`（catalogs 与 LOCALES 都会自动带上）。
 */
import { ref } from 'vue'
import { catalogs, DEFAULT_LOCALE, LOCALES } from './locales.generated.js'

export { catalogs, DEFAULT_LOCALE, LOCALES }

export const locale = ref(DEFAULT_LOCALE)

function lookup(catalog, key) {
  let cur = catalog
  for (const part of String(key).split('.')) {
    if (cur == null || typeof cur !== 'object') return null
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : null
}

/** 把 `{name}` 换成参数值；没传的参数原样留着，漏传时能看出来 */
function interpolate(text, params) {
  return text.replace(/\{(\w+)\}/g, (whole, name) => (params?.[name] == null ? whole : String(params[name])))
}

export function has(key) {
  return lookup(catalogs[DEFAULT_LOCALE], key) != null
}

export function t(key, params) {
  const text = lookup(catalogs[locale.value], key) ?? lookup(catalogs[DEFAULT_LOCALE], key)
  if (text == null) {
    if (import.meta.env?.DEV) console.warn(`[i18n] 缺少文案：${key}`)
    return key
  }
  return params ? interpolate(text, params) : text
}

/** 切语言。只认注册过的 code，未知 code 忽略 */
export function setLocale(next) {
  if (!catalogs[next]) return
  locale.value = next
  if (typeof document !== 'undefined') document.documentElement.lang = next
}
