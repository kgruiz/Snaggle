import { defineConfig } from 'vite';
import { crx, defineManifest } from '@crxjs/vite-plugin';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const manifest = defineManifest({
  manifest_version: 3,
  name: 'Snaggle',
  version: '1.0',
  description: 'Download content from specific websites via the extension popup.',
  icons: {
    '16': 'icons/icon_16.png',
    '32': 'icons/icon_32.png',
    '48': 'icons/icon_48.png', // Keep larger icons for OS/app switcher
    '128': 'icons/icon_128.png'
  },
  permissions: ['activeTab', 'scripting', 'downloads', 'clipboardWrite'],
  host_permissions: ['*://api.github.com/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  action: {
    // REMOVED default_popup - We will use a content script to inject UI
    default_icon: {
      '16': 'icons/icon_16.png',
      '32': 'icons/icon_32.png'
    }
  },
  // ADDED content_scripts to inject our popup UI logic
  content_scripts: [
    {
      matches: ["<all_urls>"], // Inject into all URLs. You could refine this later if needed.
      js: ["src/popup/index.ts"], // Our popup UI logic will run as a content script
      run_at: "document_idle", // Inject when the DOM is ready
      // REMOVED world: "ISOLATED" - ISOLATED is the default in MV3 and removes the TS error
    }
  ]
});

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
      input: {
        // We still list popup.html as an input so Vite processes it
        // but it's no longer the default popup document
        popup: resolve(__dirname, 'popup.html')
        // Note: Vite automatically includes content scripts as entry points via CRXJS
      }
    }
  }
}));