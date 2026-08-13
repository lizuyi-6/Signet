/**
 * Vite config for the Signet extension (crxjs + Vite 6, MV3).
 *
 * - `crx({ manifest })` rewrites the source `.ts` paths in the manifest
 *   (background service worker + content script) to the built chunk URLs.
 * - The offscreen document has no manifest field, so it is declared as an
 *   additional HTML input under `rollupOptions.input`. crxjs emits it at a path
 *   derived from its source path, so the runtime string
 *   `chrome.runtime.getURL('src/offscreen/offscreen.html')` is identical in dev
 *   and build (see src/background/index.ts).
 * - `optimizeDeps.exclude` keeps esbuild from pre-bundling the WASM package.
 * - Build (not dev HMR) is the acceptance path: multi-page dev script
 *   resolution is historically flaky (crxjs issue #627), but build output is
 *   reliable — load dist/ unpacked.
 */
import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';

import manifest from './manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
  server: {
    port: 5174,
    strictPort: true,
    hmr: { port: 5174 },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        offscreen: 'src/offscreen/offscreen.html',
        options: 'src/options/index.html',
      },
      output: { chunkFileNames: 'assets/chunk-[hash].js' },
    },
  },
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: { exclude: ['@contentauth/c2pa-web'] },
});
