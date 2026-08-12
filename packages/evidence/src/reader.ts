/**
 * @signet/evidence — C2PA reader (native wrapper).
 *
 * The only place in the runtime that touches the `c2pa-node` native binding.
 * Created **without a signer** (read-only): signing is a build-time concern
 * that never reaches the runtime (docs/decisions.md D11). Any failure to read
 * — native throw, parse error, missing library — is translated into an
 * {@link EvidenceGraph} with `verificationError: true`, so the engine fails
 * closed to `unknown` rather than crashing the host page.
 */
import type { EvidenceGraph } from '@signet/core';

import { mapManifestStore } from './mapper.js';
import type { C2PAManifestStoreView } from './c2pa-types.js';

/**
 * Lazy-loaded c2pa-node read function. Kept out of module top-level so that
 * merely importing this package never loads the native binary — important for
 * test isolation and for environments where the binary is absent.
 */
let readFn: ((asset: { buffer: Buffer; mimeType: string }) => Promise<unknown>) | null = null;
let nativeLoadError: string | null = null;

async function getReader(): Promise<
  (asset: { buffer: Buffer; mimeType: string }) => Promise<unknown>
> {
  if (readFn) {
    return readFn;
  }
  if (nativeLoadError) {
    throw new Error(nativeLoadError);
  }
  try {
    // Dynamic import so the native binary is only loaded when actually needed.
    const mod = (await import('c2pa-node')) as {
      createC2pa: (opts?: { signer?: unknown }) => {
        read: (asset: { buffer: Buffer; mimeType: string }) => Promise<unknown>;
      };
    };
    // No signer → read-only instance (D11).
    const c2pa = mod.createC2pa();
    readFn = c2pa.read.bind(c2pa);
    return readFn;
  } catch (e) {
    nativeLoadError = `c2pa-node native module unavailable: ${(e as Error).message}`;
    throw new Error(nativeLoadError);
  }
}

/**
 * Read C2PA provenance from an in-memory asset and translate it to an
 * {@link EvidenceGraph}. Never throws: a read failure becomes a graph with
 * `verificationError: true` (the engine then decides `unknown`).
 *
 * @param buffer  Raw asset bytes.
 * @param mimeType Asset MIME type (`image/png` / `image/jpeg`).
 * @param assetId  The asset id to stamp onto the resulting graph.
 */
export async function readC2paEvidence(
  buffer: Buffer,
  mimeType: string,
  assetId: string,
): Promise<EvidenceGraph> {
  let store: unknown;
  try {
    const read = await getReader();
    store = await read({ buffer, mimeType });
  } catch (e) {
    return {
      assetId,
      items: [],
      verificationError: true,
      errorMessage: `c2pa read failed: ${(e as Error).message}`,
    };
  }
  // `read` resolves to `ResolvedManifestStore | null`; structurally compatible
  // with our narrow view. Unknown shapes fall through to the null/empty branch.
  return mapManifestStore(store as C2PAManifestStoreView | null, assetId);
}
