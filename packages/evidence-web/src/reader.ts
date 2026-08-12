/**
 * @signet/evidence-web — C2PA reader (browser SDK wrapper).
 *
 * The only place in the browser runtime that touches `@contentauth/c2pa-web`.
 * Mirrors `@signet/evidence/reader.ts`'s contract: never throws — a read
 * failure (worker error, parse error, missing WASM) becomes an
 * {@link EvidenceGraph} with `verificationError: true`, so the engine fails
 * closed to `unknown` instead of crashing the host page.
 *
 * Where it runs (see docs/decisions.md D15): a c2pa-web Reader spawns a Web
 * Worker from inlined source. MV3 service workers cannot spawn nested
 * workers, so this reader must be called from a **content script** (same-origin
 * asset fetch) or an **offscreen document** (cross-origin asset, via the
 * `chrome.offscreen` API). It cannot run in the extension service worker and it
 * cannot run under Node — see `tools/spike-web` for the browser proof.
 *
 * `@contentauth/c2pa-web` is imported **lazily**, so merely importing this
 * module never loads the WASM worker — keeping the pure normalizer Node-testable
 * and letting the host decide when/where to spin up the reader.
 */
import type { EvidenceGraph } from '@signet/core';

import { mapManifestStore } from '@signet/evidence';

import { normalizeWebManifestStore } from './normalize.js';

/**
 * Trust options forwarded to c2pa-web. The `verifyTrust` gate defaults to
 * `true`; the caller must not set it `false` to make an asset pass — that would
 * weaken the requires-proof gate (CLAUDE.md rule 3.3).
 */
export interface WebReaderOptions {
  /** URL of the c2pa.wasm asset. In a Vite host, `import wasm from '.../c2pa.wasm?url'`. */
  readonly wasmSrc: string;
  /**
   * Trust anchors as the text content of a PEM file. For demo fixtures signed
   * by c2pa-node's test signer, pass that PEM here so validation reports
   * `signingCredential.trusted` instead of `signingCredential.untrusted`. Omit
   * for real-world assets to use the SDK's default trust list.
   */
  readonly trustAnchorPem?: string;
  /**
   * Enable trust validation. Default `true`. Do not set `false` to bypass an
   * untrusted-signer result (rule 3.3); only set `false` if the caller is
   * explicitly assuming the trust decision itself.
   */
  readonly verifyTrust?: boolean;
}

interface C2paWebModule {
  createC2pa: (opts: unknown) => Promise<C2paInstance>;
}
interface C2paInstance {
  readonly reader: {
    fromBlob: (format: string, blob: Blob, settings?: unknown) => Promise<ReaderHandle | null>;
  };
}
interface ReaderHandle {
  manifestStore: () => Promise<unknown>;
  free: () => Promise<void>;
}

let createC2paFn: ((opts: unknown) => Promise<C2paInstance>) | null = null;
let sdkLoadError: string | null = null;

async function getFactory(): Promise<(opts: unknown) => Promise<C2paInstance>> {
  if (createC2paFn) {
    return createC2paFn;
  }
  if (sdkLoadError) {
    throw new Error(sdkLoadError);
  }
  try {
    const mod = (await import('@contentauth/c2pa-web')) as C2paWebModule;
    createC2paFn = mod.createC2pa;
    return createC2paFn;
  } catch (e) {
    sdkLoadError = `@contentauth/c2pa-web unavailable: ${(e as Error).message}`;
    throw new Error(sdkLoadError);
  }
}

/** Build the c2pa-web Settings object from the friendlier {@link WebReaderOptions}. */
function buildSettings(opts: WebReaderOptions): unknown {
  const trust: Record<string, unknown> = {};
  if (typeof opts.trustAnchorPem === 'string' && opts.trustAnchorPem.length > 0) {
    trust.userAnchors = opts.trustAnchorPem;
    trust.allowedList = opts.trustAnchorPem;
  }
  return {
    ...(Object.keys(trust).length > 0 ? { trust } : {}),
    verify: {
      verifyTrust: opts.verifyTrust ?? true,
      verifyAfterReading: true,
    },
  };
}

/**
 * Read C2PA provenance from a browser `Blob` and translate it to an
 * {@link EvidenceGraph}. Never throws.
 *
 * @param blob    Asset bytes (e.g. from `fetch(url).then(r => r.blob())`).
 * @param mimeType Asset MIME type; used when `blob.type` is empty.
 * @param assetId  The asset id to stamp onto the resulting graph.
 * @param opts     {@link WebReaderOptions} (wasmSrc required).
 */
export async function readC2paEvidenceWeb(
  blob: Blob,
  mimeType: string,
  assetId: string,
  opts: WebReaderOptions,
): Promise<EvidenceGraph> {
  let store: unknown;
  try {
    const createC2pa = await getFactory();
    const c2pa = await createC2pa({ wasmSrc: opts.wasmSrc, settings: buildSettings(opts) });
    const reader = await c2pa.reader.fromBlob(blob.type || mimeType || 'image/png', blob);
    if (!reader) {
      // No C2PA metadata embedded → Unknown (fail-closed, NOT "fake").
      return { assetId, items: [] };
    }
    try {
      store = await reader.manifestStore();
    } finally {
      try {
        await reader.free();
      } catch {
        // free() is best-effort cleanup; a failure here must not mask the read.
      }
    }
  } catch (e) {
    return {
      assetId,
      items: [],
      verificationError: true,
      errorMessage: `c2pa-web read failed: ${(e as Error).message}`,
    };
  }
  return mapManifestStore(normalizeWebManifestStore(store), assetId);
}
