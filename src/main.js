import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.js'
import { locale, t } from './i18n/index.js'
import './styles/main.css'

// pdf.js v6 依赖 Promise.withResolvers（较老的 Safari / Chrome 没有）
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

// 页面缩放**全站禁用**的 iOS 兜底（见 `docs/ui.md` §18.46）。
// `main.css` 那条 `html { touch-action: pan-x pan-y }` 是新浏览器就够用的那一层，
// 但 iOS Safari 从 10 起无视 viewport 的 `user-scalable=no` / `maximum-scale`（`index.html`），
// 而它对 `touch-action` 的支持也晚（13.4 前后才完整）—— 所以再拦一次 Safari 专有的手势事件：
// `gesturestart` / `gesturechange` 一 preventDefault，捏合就不会放大整页。
// **只拦这两根手指的事**：单指滚动与所有既有手势完全不受影响。
// ⚠️ 这里**故意不挂**「document 级非 passive touchmove，多指就 preventDefault」那条常见写法 ——
// 文档级非 passive 监听会让浏览器对整页滚动保守处理（掉帧 / 惯性变差），而它多兜住的只是
// 「既没有 gesture 事件、也不认 touch-action」的浏览器，现在不存在。要加先想清楚这个代价。
const blockGestureZoom = (e) => e.preventDefault()
document.addEventListener('gesturestart', blockGestureZoom, { passive: false })
document.addEventListener('gesturechange', blockGestureZoom, { passive: false })

createApp(App).use(router).mount('#app')

// 标题与 <html lang> 都取自语言包：index.html 里的静态值是「JS 还没跑起来」时的兜底
document.title = t('app.title')
document.documentElement.lang = locale.value

// 开发期把模块实例挂到 window，便于调试与自动化测试（生产构建不包含）
if (import.meta.env.DEV) {
  Promise.all([
    import('./store/player.js'),
    import('./store/library.js'),
    import('./db/idb.js'),
    import('./domain/timeline.js'),
    import('./dev/demo.js'),
  ]).then(([player, library, idb, timeline, demo]) => {
    // `demo` 提供 `buildDemoScore` / `seedDemoLibrary` —— 铺一批假乐谱，
    // 好看清乐谱库那几行（标签、占用大小、各档排序）
    window.__app = { player, library, idb, timeline, demo }
  })
}
