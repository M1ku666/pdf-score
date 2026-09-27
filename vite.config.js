import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const LOCALES_DIR = fileURLToPath(new URL('./src/i18n/', import.meta.url)).replace(/\\/g, '/')

/**
 * 改 `src/i18n/*.yaml` 时重新编译语言包并刷新页面。
 *
 * 语言包是 YAML（好写好改），但浏览器不认 .yaml，运行时读的是
 * `src/i18n/locales.generated.js`。没有这个插件的话，开发时改了 .yaml
 * 要手动跑 `npm run i18n` 或重启 dev server 才生效。
 */
function watchLocales() {
  let running = false
  let pending = false

  const rebuild = (server) => {
    if (running) {
      pending = true // 编译期间又改了一次，跑完再补一次
      return
    }
    running = true
    const child = spawn(process.execPath, ['scripts/build-locales.mjs'], { stdio: 'inherit' })
    child.on('close', (code) => {
      running = false
      if (code === 0) server.ws.send({ type: 'full-reload' })
      if (pending) {
        pending = false
        rebuild(server)
      }
    })
  }

  return {
    name: 'pdf-score:locales',
    configureServer(server) {
      server.watcher.on('all', (event, file) => {
        const path = String(file).replace(/\\/g, '/')
        if (!/\.ya?ml$/.test(path) || !path.startsWith(LOCALES_DIR)) return
        rebuild(server)
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), watchLocales()],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    // pdfjs ships a large prebuilt ESM bundle; pre-bundling it keeps dev startup fast
    include: ['pdfjs-dist'],
  },
})
