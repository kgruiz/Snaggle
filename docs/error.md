(basic) 16:48:19 ~/Developer/Projects/Snaggle % npm run build

> snaggle@1.0.0 build
> npm run copy-vendor && vite build

> snaggle@1.0.0 copy-vendor
> mkdir -p public/vendor && cp node_modules/jszip/dist/jszip.min.js public/vendor/ && cp node_modules/turndown/dist/turndown.js public/vendor/

vite v6.2.6 building for production...
✓ 4 modules transformed.
✗ Build failed in 78ms
error during build:
[vite]: Rollup failed to resolve import "html2pdf.js" from "/Users/kadengruizenga/Developer/Projects/Snaggle/src/popup/index.ts".
This is most likely unintended because it can break your application at runtime.
If you do want to externalize this module explicitly add it to
`build.rollupOptions.external`
at viteLog (file:///Users/kadengruizenga/Developer/Projects/Snaggle/node_modules/vite/dist/node/chunks/dep-Bid9ssRr.js:51645:15)
at onRollupLog (file:///Users/kadengruizenga/Developer/Projects/Snaggle/node_modules/vite/dist/node/chunks/dep-Bid9ssRr.js:51695:5)
at onLog (file:///Users/kadengruizenga/Developer/Projects/Snaggle/node_modules/vite/dist/node/chunks/dep-Bid9ssRr.js:51343:7)
at file:///Users/kadengruizenga/Developer/Projects/Snaggle/node_modules/vite/node_modules/rollup/dist/es/shared/node-entry.js:20665:32
at Object.logger [as onLog] (file:///Users/kadengruizenga/Developer/Projects/Snaggle/node_modules/vite/node_modules/rollup/dist/es/shared/node-entry.js:22551:9)
at ModuleLoader.handleInvalidResolvedId (file:///Users/kadengruizenga/Developer/Projects/Snaggle/node_modules/vite/node_modules/rollup/dist/es/shared/node-entry.js:21291:26)
at file:///Users/kadengruizenga/Developer/Projects/Snaggle/node_modules/vite/node_modules/rollup/dist/es/shared/node-entry.js:21249:26
at async Promise.all (index 1)
(basic) 16:48:22 ~/Developer/Projects/Snaggle %
