/**
 * @signet/evidence-web — public surface.
 *
 * - {@link normalizeWebManifestStore}: pure c2pa-web serialized shape →
 *   {@link C2PAManifestStoreView} (Node-testable, zero SDK coupling).
 * - {@link readC2paEvidenceWeb}: browser SDK-backed reader for a `Blob`
 *   (lazy c2pa-web import; content script / offscreen document only).
 *
 * Re-exports {@link mapManifestStore} so consumers can map a pre-normalized
 * view without a second dependency hop.
 */
export { normalizeWebManifestStore } from './normalize.js';
export { readC2paEvidenceWeb } from './reader.js';
export type { WebReaderOptions } from './reader.js';
export { mapManifestStore } from '@signet/evidence';
export type {
  C2PAManifestStoreView,
  C2PAManifestView,
  C2PAAssertionView,
  C2PASignatureInfoView,
  C2PAValidationStatusView,
} from '@signet/evidence';
