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

export function setLocale(next) {
  if (!catalogs[next]) return
  locale.value = next
  if (typeof document !== 'undefined') document.documentElement.lang = next
}
