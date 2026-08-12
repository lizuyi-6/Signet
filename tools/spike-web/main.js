// Spike entry: load @contentauth/c2pa-web via Vite (which resolves bare
// specifiers, the worker URL, and the WASM ?url), read each committed fixture,
// and expose the raw manifestStore shape on window for the Playwright driver.
//
// Key facts confirmed from c2pa-types/dist/types/ManifestStore.d.ts:
//   - manifestStore() returns a *serialized* ManifestStore (plain JSON).
//   - ms.active_manifest is a LABEL STRING (not a Manifest); the live manifest
//     is ms.manifests[label].
//   - assertions live at ms.manifests[label].assertions as ManifestAssertion[]
//     each { label, data }.
//   - fromBlob() returns Reader | null (null when no C2PA bytes found).
//
// Trust: the test fixtures are signed by c2pa-node's self-signed test signer
// (es256.pub). The web SDK has NO default trust for it, so without an anchor
// validation_status carries signingCredential.untrusted. We pass the signer's
// PEM as trust.userAnchors (and allowedList), keeping verifyTrust:true — i.e.
// we ADD an anchor, we do NOT weaken the requires-proof gate.
import { createC2pa } from '@contentauth/c2pa-web';
import wasmSrc from '@contentauth/c2pa-web/resources/c2pa.wasm?url';
import anchorPem from './trust-anchor.pem?raw';

const out = document.getElementById('out');
const log = (...a) => {
  console.log('[spike]', ...a);
  out.textContent += a.join(' ') + '\n';
};

const FIXTURES = ['verified.png', 'verified-ai.png', 'tampered.png', 'unknown.png'];

try {
  const c2pa = await createC2pa({
    wasmSrc,
    settings: {
      trust: { userAnchors: anchorPem, allowedList: anchorPem },
      verify: { verifyTrust: true, verifyAfterReading: true },
    },
  });
  const results = [];
  for (const name of FIXTURES) {
    const res = await fetch('/fixtures/' + name);
    const blob = await res.blob();
    const reader = await c2pa.reader.fromBlob(blob.type || 'image/png', blob);
    if (!reader) {
      // unsigned asset: fromBlob returns null (no C2PA metadata). This is the
      // Unknown-state path — fail-closed, NOT "fake".
      results.push({ name, msIsNull: true });
      log(name, '-> no C2PA (null reader)');
      continue;
    }
    let ms;
    try {
      ms = await reader.manifestStore();
    } finally {
      await reader.free();
    }
    const entry = { name, msIsNull: ms == null };
    if (ms) {
      entry.validation_state = ms.validation_state ?? null;
      entry.validation_status = (ms.validation_status ?? []).map((v) => ({
        code: v.code,
        success: v.success ?? null,
        explanation: v.explanation ?? null,
      }));
      const label = ms.active_manifest ?? null;
      const am = label && ms.manifests ? ms.manifests[label] ?? null : null;
      entry.activeManifestKeys = am ? Object.keys(am) : null;
      entry.signature_info = am ? (am.signature_info ?? null) : null;
      const assertions = Array.isArray(am?.assertions) ? am.assertions : [];
      entry.assertionLabels = assertions.map((a) => a?.label).filter(Boolean);
      // surface the AI digitalSourceType for the verified-ai fixture
      const ai = assertions.find((a) => a?.label === 'c2pa.ai.gen');
      entry.aiDigitalSourceType = ai?.data?.digitalSourceType ?? null;
    }
    results.push(entry);
    log(name, '->', JSON.stringify(entry));
  }
  window.__results = results;
  window.__done = true;
  log('DONE');
} catch (e) {
  window.__error = String(e && e.stack ? e.stack : e);
  window.__done = true;
  log('ERROR', window.__error);
}
