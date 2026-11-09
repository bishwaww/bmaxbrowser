import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preloads cannot require() node_modules: bundle everything except 'electron'.
      externalizeDeps: false,
      isolatedEntries: true,
      rollupOptions: {
        input: {
          chrome: resolve(__dirname, 'src/preload/chrome.ts'),
          web: resolve(__dirname, 'src/preload/web.ts')
        },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    base: './',
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    server: { port: 5173, strictPort: true },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          chrome: resolve(__dirname, 'src/renderer/chrome/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          newtab: resolve(__dirname, 'src/renderer/newtab/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
          error: resolve(__dirname, 'src/renderer/error/index.html'),
          warning: resolve(__dirname, 'src/renderer/warning/index.html'),
          tor: resolve(__dirname, 'src/renderer/tor/index.html'),
          bookmarks: resolve(__dirname, 'src/renderer/bookmarks/index.html'),
          downloads: resolve(__dirname, 'src/renderer/downloads/index.html'),
          torrents: resolve(__dirname, 'src/renderer/torrents/index.html')
        }
      }
    }
  }
})
