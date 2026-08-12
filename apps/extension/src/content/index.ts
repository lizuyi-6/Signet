/**
 * @signet/extension/content — orchestrator (content script entry).
 *
 * Responsibilities:
 *   1. Scan the page for badge-eligible images ({@link scanImages}).
 *   2. Mount a pending {@link TrustOverlay} on each.
 *   3. Ask the background service worker to verify each asset's bytes.
 *   4. On the result, render the badge state and (on click) the detail card.
 *   5. Keep overlays positioned over their images on scroll/resize, and pick up
 *      images added later via a debounced MutationObserver.
 *
 * This module never touches C2PA / WASM directly — that lives in the offscreen
 * document (D16). It only renders trust states the engine has already decided.
 */
import type { VerifyRequest, VerifyResult } from '../messages';

import { TrustOverlay } from './badge';
import { findImageByUrl, scanImages } from './scan';

const overlays = new Map<string, TrustOverlay>(); // url → overlay
const inflight = new Set<string>(); // url → verify in flight
const verified = new Set<string>(); // url → already has a result
let repositionRaf = 0;
let processTimer: number | null = null;

function scheduleReposition(): void {
  if (repositionRaf) return;
  repositionRaf = window.requestAnimationFrame(() => {
    repositionRaf = 0;
    for (const ov of overlays.values()) ov.reposition();
  });
}

async function verify(url: string): Promise<void> {
  if (inflight.has(url) || verified.has(url)) return;
  inflight.add(url);
  const req: VerifyRequest = { kind: 'verify', to: 'background', assetId: url, url };
  try {
    const res = (await chrome.runtime.sendMessage(req)) as VerifyResult | undefined;
    if (res && res.kind === 'verify-result' && res.assetId === url) {
      verified.add(url);
      overlays.get(url)?.setResult(res);
    }
  } catch {
    // The SW may be asleep or the channel closed. Leave the pending badge in
    // place — visually fail-closed (no false "verified").
  } finally {
    inflight.delete(url);
  }
}

function ensureOverlay(url: string): TrustOverlay | null {
  const existing = overlays.get(url);
  if (existing) return existing;
  const img = findImageByUrl(url);
  if (!img) return null;
  const ov = new TrustOverlay(img);
  overlays.set(url, ov);
  return ov;
}

function process(): void {
  for (const a of scanImages()) {
    if (!a.url) continue;
    if (ensureOverlay(a.url)) void verify(a.url);
  }
  // Drop overlays whose image has left the DOM.
  for (const [url, ov] of overlays) {
    if (!findImageByUrl(url)) {
      ov.destroy();
      overlays.delete(url);
      verified.delete(url);
    }
  }
}

function scheduleProcess(): void {
  if (processTimer !== null) clearTimeout(processTimer);
  processTimer = window.setTimeout(process, 200);
}

function init(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  window.addEventListener('scroll', scheduleReposition, { passive: true, capture: true });
  window.addEventListener('resize', scheduleReposition, { passive: true });

  const mo = new MutationObserver(scheduleProcess);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Initial pass: run once now and again after load (images may still be
  // decoding and have zero layout rect on the first pass).
  process();
  if (document.readyState !== 'complete') {
    window.addEventListener('load', () => process(), { once: true });
  }
}

init();
