import { defineConfig } from 'vite';
import { crx, defineManifest } from '@crxjs/vite-plugin';
import { resolve, dirname } from 'node:path'; // Import resolve and dirname
import { fileURLToPath } from 'node:url';    // Import fileURLToPath

// Calculate __dirname equivalent in ES module scope
const __dirname = dirname(fileURLToPath(import.meta.url));

// Define the manifest dynamically
const manifest = defineManifest({
  manifest_version: 3,
  name: "Snaggle",
  version: "1.0",
  description: "Download content from specific websites via the extension popup.",
  icons: {
    "16": "icons/icon_16.png",
    "32": "icons/icon_32.png",
    "48": "icons/icon_48.png",
    "128": "icons/icon_128.png"
  },
  permissions: [
    "activeTab",
    "scripting",
    "downloads"
  ],
  host_permissions: [
     "*://api.github.com/*" // Keep for background fetch
  ],
  background: {
    service_worker: 'src/background/index.ts', // Source path for CRXJS
    type: 'module',
  },
  action: {
    default_popup: 'popup.html', // CRXJS finds this in public/
    default_icon: {
      "16": "icons/icon_16.png",
      "32": "icons/icon_32.png"
    }
  },
});

// Vite configuration
export default defineConfig(({ command }) => ({
  // Define public directory relative to project root
  publicDir: 'public',
  plugins: [
    crx({ manifest }), // CRXJS plugin reads the manifest
  ],
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173, },
  },
  build: {
    outDir: 'dist',
    sourcemap: command === 'serve' ? 'inline' : false, // Generate source maps for dev
    emptyOutDir: true, // Clean dist before build
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),

        // --- Explicit input for the new content script ---
        // The key 'extractGeneral' is arbitrary, used by Rollup internally.
        // The value points to the source TS file. Vite/CRXJS will ensure
        // the output file is placed correctly in dist (likely dist/src/content/...)
        // and the path used in executeScript({ files: [...] }) will be resolved.
        extractGeneral: resolve(__dirname, 'src/content/extractGeneralData.ts')
        // ---------------------------------------------------
      },
      // Optional: Configure output filenames if needed
      // output: {
      //   entryFileNames: `assets/[name].js`,
      //   chunkFileNames: `assets/[name].js`,
      //   assetFileNames: `assets/[name].[ext]`
      // }
    },
  }
}));