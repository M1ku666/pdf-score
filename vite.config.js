import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const LOCALES_DIR = fileURLToPath(new URL('./src/i18n/', import.meta.url)).replace(/\\/g, '/')

function watchLocales() {
  let running = false
  let pending = false

  const rebuild = (server) => {
    if (running) {
      pending = true
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
      ignored: ['**/.*.tmpdir', '**/.*.tmpdir/**'],
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
})
