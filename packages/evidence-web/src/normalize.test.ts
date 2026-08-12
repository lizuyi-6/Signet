/**
 * @signet/evidence-web — unit tests for the pure normalizer.
 *
 * These tests drive {@link normalizeWebManifestStore} with inputs that mirror
 * the **real** `reader.manifestStore()` output captured by the browser spike
 * (tools/spike-web/run.mjs), then feed the result through the SAME pure
 * {@link mapManifestStore} the Node path uses, asserting the load-bearing
 * field values (validation codes, assertion labels, digitalSourceType, item
 * statuses) that pin the four trust states.
 *
 * The `active_manifest` label strings are structural placeholders (any string
 * works provided it keys into `manifests`); every *field value* below is taken
 * verbatim from the spike run on the committed fixtures. The browser-level
 * end-to-end proof (real SDK → real WASM → real fixtures) lives in the spike
 * harness; these tests prove the shape transform + classification in fast Node.
 */
import { describe, it, expect } from 'vitest';

import { mapManifestStore } from '@signet/evidence';
import type { EvidenceItem } from '@signet/core';

import { normalizeWebManifestStore } from './normalize.js';

/** Real signature_info captured from the spike (same signer for all signed fixtures). */
const REAL_SIGNATURE_INFO = {
  alg: 'Es256',
  issuer: 'C2PA Test Signing Cert',
  common_name: 'C2PA Signer',
  cert_serial_number: '640229841392226413189608867977836244731148734950',
  time: '2026-08-12T10:23:30+00:00',
} as const;

/** Real dataHash.mismatch status captured from tampered.png in the spike. */
const DATA_HASH_MISMATCH = {
  code: 'assertion.dataHash.mismatch',
  explanation:
    'asset hash error, name: jumbf manifest, error: hash verification( Hashes do not match )',
} as const;

const LABEL = 'com.signet.manifest-0001';

/** Build a raw web serialized store around an active manifest + statuses. */
function webStore(
  manifest: Record<string, unknown> | null,
  validation_status: readonly unknown[],
): unknown {
  if (!manifest) {
    return { active_manifest: null, manifests: {}, validation_status, validation_state: 'Invalid' };
  }
  return {
    active_manifest: LABEL,
    manifests: { [LABEL]: manifest },
    validation_status,
    validation_state: validation_status.length === 0 ? 'Trusted' : 'Invalid',
  };
}

const byType = (items: readonly EvidenceItem[]) =>
  Object.fromEntries(items.map((i) => [i.type, i]));

describe('normalizeWebManifestStore', () => {
  it('returns null for non-object input (caller → empty graph → unknown)', () => {
    expect(normalizeWebManifestStore(null)).toBeNull();
    expect(normalizeWebManifestStore(undefined)).toBeNull();
    expect(normalizeWebManifestStore('not a store')).toBeNull();
  });

  it('returns active_manifest:null when the store has no manifest object', () => {
    const view = normalizeWebManifestStore({ active_manifest: null, manifests: {} })!;
    expect(view).not.toBeNull();
    expect(view.active_manifest).toBeNull();
  });

  it('still surfaces validation_status even when the active label cannot be resolved', () => {
    // Tamper/unknown-code statuses must not be silently dropped if the manifest
    // object is missing — fail-closed keeps the failure visible.
    const view = normalizeWebManifestStore({
      active_manifest: 'missing-label',
      manifests: {},
      validation_status: [DATA_HASH_MISMATCH],
    })!;
    expect(view.active_manifest).toBeNull();
    expect(view.validation_status?.[0]?.code).toBe('assertion.dataHash.mismatch');
  });

  it('normalizes a clean verified manifest (no AI) → all prongs valid, no ai-label', () => {
    const raw = webStore(
      {
        claim_generator: 'Signet/0.1',
        title: 'verified.png',
        format: 'image/png',
        assertions: [{ label: 'c2pa.actions.v2', data: {} }],
        signature_info: REAL_SIGNATURE_INFO,
      },
      [],
    );
    const view = normalizeWebManifestStore(raw)!;
    expect(view.active_manifest?.claim_generator).toBe('Signet/0.1');
    expect(view.active_manifest?.assertions?.[0]?.label).toBe('c2pa.actions.v2');
    expect(view.active_manifest?.signature_info).toEqual(REAL_SIGNATURE_INFO);
    expect(view.validation_status).toEqual([]);

    const graph = mapManifestStore(view, 'a-verified');
    const t = byType(graph.items);
    expect(t['c2pa']?.status).toBe('valid');
    expect(t['signature']?.status).toBe('valid');
    expect(t['hash']?.status).toBe('valid');
    expect(t['ai-label']).toBeUndefined();
    expect(graph.verificationError).toBeUndefined();
  });

  it('normalizes a verified-ai manifest → adds an ai-label item (kind=generated)', () => {
    const raw = webStore(
      {
        claim_generator: 'Signet/0.1',
        title: 'verified-ai.png',
        format: 'image/png',
        assertions: [
          {
            label: 'c2pa.ai.gen',
            data: {
              generator: { description: 'Signet Demo Diffusion', type: 'software' },
              digitalSourceType: 'trainedAlgorithmicMedia',
            },
          },
          { label: 'c2pa.actions.v2', data: {} },
        ],
        signature_info: REAL_SIGNATURE_INFO,
      },
      [],
    );
    const view = normalizeWebManifestStore(raw)!;
    const aiAssert = view.active_manifest?.assertions?.find((a) => a.label === 'c2pa.ai.gen');
    expect(aiAssert).toBeDefined();
    expect((aiAssert?.data as { digitalSourceType?: string }).digitalSourceType).toBe(
      'trainedAlgorithmicMedia',
    );

    const graph = mapManifestStore(view, 'a-verified-ai');
    const t = byType(graph.items);
    expect(t['hash']?.status).toBe('valid');
    expect(t['ai-label']).toBeDefined();
    expect(t['ai-label']?.status).toBe('valid');
    expect((t['ai-label']?.data as { kind?: string }).kind).toBe('generated');
  });

  it('normalizes a tampered manifest → hash invalid, signature still valid', () => {
    const raw = webStore(
      {
        claim_generator: 'Signet/0.1',
        title: 'tampered.png',
        format: 'image/png',
        assertions: [{ label: 'c2pa.actions.v2', data: {} }],
        signature_info: REAL_SIGNATURE_INFO,
      },
      [DATA_HASH_MISMATCH],
    );
    const view = normalizeWebManifestStore(raw)!;
    expect(view.validation_status?.[0]?.code).toBe('assertion.dataHash.mismatch');

    const graph = mapManifestStore(view, 'a-tampered');
    const t = byType(graph.items);
    // Integrity broken, but the signature itself cryptographically still verifies.
    expect(t['hash']?.status).toBe('invalid');
    expect(t['hash']?.note).toContain('hash verification');
    expect(t['signature']?.status).toBe('valid');
    expect(t['ai-label']).toBeUndefined();
    expect(graph.verificationError).toBeUndefined();
  });

  it('drops assertion entries that lack a string label (defensive)', () => {
    const raw = webStore(
      {
        claim_generator: 'Signet/0.1',
        assertions: [
          { label: 'c2pa.actions.v2', data: {} },
          { data: 'no label here' },
          null,
          { label: 123 },
        ],
        signature_info: REAL_SIGNATURE_INFO,
      },
      [],
    );
    const view = normalizeWebManifestStore(raw)!;
    const labels = view.active_manifest?.assertions?.map((a) => a.label);
    expect(labels).toEqual(['c2pa.actions.v2']);
  });
});

describe('readC2paEvidenceWeb contract (via mapManifestStore on normalized views)', () => {
  // The SDK-coupled reader.ts cannot run under Node (it spawns a Web Worker).
  // Its end-to-end behaviour is proven by the browser spike; here we re-assert
  // that the null-reader branch the reader takes for unsigned assets produces
  // the Unknown (empty) graph the engine expects.
  it('unsigned asset (null manifestStore) → empty graph (Unknown / fail-closed)', () => {
    const graph = mapManifestStore(normalizeWebManifestStore(null), 'a-unknown');
    expect(graph.items).toEqual([]);
    expect(graph.verificationError).toBeUndefined();
  });
});
