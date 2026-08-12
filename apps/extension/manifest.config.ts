/**
 * MV3 manifest (crxjs defineManifest). crxjs rewrites the source `.ts` paths
 * in `background.service_worker` and `content_scripts[].js` to the built URLs.
 *
 * Scope: content scripts run on all http(s) pages; the demo host
 * (http://127.0.0.1:5173) is the acceptance target. host_permissions let the
 * offscreen document `fetch()` the asset bytes (same-origin for the page, but
 * the offscreen doc is an extension-origin context, so it needs the host grant).
 *
 * The offscreen document is intentionally NOT declared here — it has no MV3
 * manifest field. It is bundled as an additional HTML input (see vite.config.ts)
 * and created at runtime via chrome.offscreen.createDocument.
 */
import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Signet',
  short_name: 'Signet',
  version: '0.0.0',
  description:
    'Turn C2PA / Content Credentials / signatures / hashes / and AI labels into calm, human trust states. Not a fake-news detector — it shows what we can currently verify.',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['offscreen'],
  host_permissions: ['http://*/*', 'https://*/*'],
  // REQUIRED for @contentauth/c2pa-web: MV3 extension pages forbid WebAssembly
  // unless 'wasm-unsafe-eval' is in script-src. Without it, the offscreen doc
  // throws at WebAssembly.instantiate and every asset fails closed to Unknown.
  // This grants WASM only to our own extension pages (not content scripts, not
  // the host page) and does NOT relax any trust-decision gate (rule 3.3 stands).
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
});
