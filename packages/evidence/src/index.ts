/**
 * @signet/evidence — public surface.
 *
 * - {@link mapManifestStore}: pure C2PA read-result → EvidenceGraph (testable).
 * - {@link readC2paEvidence}: native-backed reader for real asset bytes.
 * - {@link classifyValidationCode} / {@link isAIAssertion}: exported for tests
 *   and for downstream packages that need the same classification.
 */
export { mapManifestStore, classifyValidationCode, isAIAssertion } from './mapper.js';
export { readC2paEvidence } from './reader.js';
export type {
  C2PAManifestStoreView,
  C2PAManifestView,
  C2PAAssertionView,
  C2PASignatureInfoView,
  C2PAValidationStatusView,
} from './c2pa-types.js';
