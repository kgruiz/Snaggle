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
  permissions: [
    'activeTab',
    'scripting', // Needed to execute scripts in the active tab
    'downloads',
    'clipboardWrite'
  ],
  // Keep host permissions if background needs to call GitHub API directly
  host_permissions: ['*://api.github.com/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  action: {
    default_icon: {
      '16': 'icons/icon_16.png',
      '32': 'icons/icon_32.png'
    },
    default_popup: 'popup.html'
  },
  web_accessible_resources: [
    {
      // List scripts/assets that might need to be accessed or injected by the background script
      resources: [
        'vendor/jszip.min.js', // If background script loads it dynamically
        'vendor/turndown.js', // If background script loads it dynamically
         // List function *files* (after build, they are .js) if background uses scripting.executeScript({ files: [...] })
         // Instead, we'll pass functions directly or use executeScript({ func: ... })
         // Example: If injecting extractGeneralData as a file: 'src/content/extractGeneralData.js',
      ],
      matches: ['<all_urls>'] // Be more specific if possible
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
    // Disable module preload polyfill/runtime in service worker bundle
    modulePreload: false,
    rollupOptions: {
      // Ensure popup.html is treated as an input for the build process
      input: { popup: resolve(__dirname, 'popup.html') }
    }
  }
}))