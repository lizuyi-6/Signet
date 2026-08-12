/**
 * @signet/extension/offscreen — the offscreen document.
 *
 * The ONLY extension context that runs `@contentauth/c2pa-web` and the trust
 * engine. It receives a URL from the background SW, fetches the bytes, reads
 * C2PA provenance, runs the deterministic trust decision, and returns a
 * {@link VerifyResult}. Fail-closed throughout: any error → `unknown`, never a
 * false verified.
 *
 * Trust anchor: the demo ships c2pa-node's TEST signer PEM so the committed
 * fixtures verify as Trusted. `verifyTrust` stays `true` — this ADDS an anchor
 * (the sanctioned mechanism, rule 3.3), it does not weaken the gate. A real
 * build would ship real C2PA trust anchors or use the SDK default list.
 */
import { decide } from '@signet/trust-engine';
import { readC2paEvidenceWeb } from '@signet/evidence-web';

import wasmSrc from '@contentauth/c2pa-web/resources/c2pa.wasm?url';
import anchorPem from './trust-anchor.pem?raw';

import type { VerifyForward, VerifyResult } from '../messages';

function fail(assetId: string, errorMessage: string): VerifyResult {
  return {
    kind: 'verify-result',
    assetId,
    state: 'unknown',
    reason: 'verification-error',
    failClosed: true,
    items: [],
    errorMessage,
  };
}

function guessMime(url: string): string {
  const u = url.toLowerCase().split('?')[0] ?? '';
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.jpeg') || u.endsWith('.jpg')) return 'image/jpeg';
  if (u.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function handleVerify(fwd: VerifyForward): Promise<VerifyResult> {
  const { assetId, url } = fwd;

  let blob: Blob;
  try {
    const r = await fetch(url);
    if (!r.ok) return fail(assetId, `fetch ${url} → HTTP ${r.status}`);
    blob = await r.blob();
  } catch (e) {
    return fail(assetId, `fetch failed: ${(e as Error).message}`);
  }

  const mime = blob.type || guessMime(url);
  const graph = await readC2paEvidenceWeb(blob, mime, assetId, {
    wasmSrc,
    trustAnchorPem: anchorPem,
    verifyTrust: true,
  });
  const decision = decide(graph);
  return {
    kind: 'verify-result',
    assetId,
    state: decision.state,
    reason: decision.reason,
    failClosed: decision.failClosed,
    items: graph.items,
    errorMessage: graph.errorMessage,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const m = msg as { to?: string; kind?: string };
  if (!m || m.to !== 'offscreen' || m.kind !== 'verify') {
    return false;
  }
  const fwd = msg as VerifyForward;
  void (async () => {
    sendResponse(await handleVerify(fwd));
  })();
  return true; // keep the channel open for the async sendResponse above
});
