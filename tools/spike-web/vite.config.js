// Vite config for the c2pa-web spike. Serves the demo's committed fixtures at
// /fixtures/* so main.js can fetch them, without copying any files.
import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  publicDir: resolve(here, '../../apps/demo/public'),
  server: {
    host: '127.0.0.1',
    port: Number(process.env.SPIKE_PORT) || 4319,
    strictPort: true,
    fs: { strict: false },
  },
  // c2pa-web ships a Web Worker + WASM; let Vite handle them natively.
  optimizeDeps: { exclude: ['@contentauth/c2pa-web'] },
});
