// Vite config for the Signet demo site.
// Serves the committed fixtures from /public (Vite default) so the page and the
// extension both see them at /fixtures/*.png.
import { defineConfig } from 'vite';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
});
