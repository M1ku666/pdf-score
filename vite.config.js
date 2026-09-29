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

/**
 * 原子写文件的工具（编辑器、AI agent）会在目标文件同目录下建一个暂存目录
 * `.<文件名>.<pid>.<uuid>.tmpdir/`，把内容写进 `<文件名>.tmp` 再改名覆盖。
 *
 * Windows 上暂存文件在写入期间被独占打开（无 FILE_SHARE），chokidar 对它调
 * `fs.watch` 会抛 `EBUSY`；chokidar 把 `fs.watch` 的异常当致命错误 emit
 * （`ignorePermissionErrors` 只吞 EACCES/EPERM/ENOENT，不含 EBUSY），而 Vite
 * 没有挂 `error` 监听 —— 于是整个 dev server 进程直接退出。
 *
 * 兜底：watcher 报错只记一条 warn，不跟着退出（过滤见 `server.watch.ignored`）。
 */
function guardWatcherErrors() {
  return {
    name: 'pdf-score:watcher-errors',
    configureServer(server) {
      server.watcher.on('error', (error) => {
        const where = error?.path ? ` (${error.path})` : ''
        server.config.logger.warn(`[watcher] ${error?.message ?? error}${where}`)
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), watchLocales(), guardWatcherErrors()],
  server: {
    host: true,
    port: 5173,
    watch: {
      // 暂存目录不是源码：不进 watcher，就不给 chokidar 机会去 watch 那个被锁的文件
      ignored: ['**/.*.tmpdir', '**/.*.tmpdir/**'],
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    // pdfjs ships a large prebuilt ESM bundle; pre-bundling it keeps dev startup fast
    include: ['pdfjs-dist'],
  },
})
