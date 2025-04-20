// vite.config.ts
import { defineConfig } from 'vite'
import { crx, defineManifest } from '@crxjs/vite-plugin'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const manifest = defineManifest({
  manifest_version: 3,
  name: 'Snaggle',
  version: '1.0',
  description: 'Download content from specific websites via the extension popup.',
  icons: {
    '16': 'icons/icon_16.png',
    '32': 'icons/icon_32.png',
    '48': 'icons/icon_48.png',
    '128': 'icons/icon_128.png'
  },
  permissions: ['activeTab', 'scripting', 'downloads', 'clipboardWrite'],
  host_permissions: ['*://api.github.com/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  action: {
    default_icon: {
      '16': 'icons/icon_16.png',
      '32': 'icons/icon_32.png'
    }
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/popup/index.ts'],
      run_at: 'document_idle'
    }
  ],
  web_accessible_resources: [
    {
      // globs include all needed runtime assets
      resources: [
        'popup.html',
        'src/popup/*',
        'vendor/jszip.min.js',
        'vendor/turndown.js'
      ],
      matches: ['<all_urls>']
    }
  ]
})

export default defineConfig(({ command }) => ({
  publicDir: 'public',
  plugins: [crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 }
  },
  build: {
    outDir: 'dist',
    sourcemap: command === 'serve' ? 'inline' : false,
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve(__dirname, 'popup.html') }
    }
  }
}))
