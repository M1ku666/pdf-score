import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router.js'
import { locale, t } from './i18n/index.js'
import './styles/main.css'

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

const blockGestureZoom = (e) => e.preventDefault()
document.addEventListener('gesturestart', blockGestureZoom, { passive: false })
document.addEventListener('gesturechange', blockGestureZoom, { passive: false })

createApp(App).use(router).mount('#app')

document.title = t('app.title')
document.documentElement.lang = locale.value

if (import.meta.env.DEV) {
  Promise.all([
    import('./store/player.js'),
    import('./store/library.js'),
    import('./db/idb.js'),
    import('./domain/timeline.js'),
    import('./dev/demo.js'),
  ]).then(([player, library, idb, timeline, demo]) => {
    window.__app = { player, library, idb, timeline, demo }
  })
}
