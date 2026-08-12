/**
 * @signet/evidence — unit tests for the pure mapper.
 *
 * These pin every branch of {@link mapManifestStore} against synthetic
 * manifest-store fixtures (no native binary). Assertions are on the
 * `status`/`type` fields of produced evidence items — the load-bearing values
 * the Trust Engine reads — not on incidental shape.
 *
 * The end-to-end "does the resulting graph produce the right TrustState" check
 * lives in `integration.test.ts`.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import {
  classifyValidationCode,
  isAIAssertion,
  mapManifestStore,
  _resetIdCounterForTests,
} from './mapper.js';
import type { C2PAManifestStoreView } from './c2pa-types.js';

const SIG = { alg: 'Es256', issuer: 'C2PA Test Signing Cert', time: '2026-01-01T00:00:00Z' };

function cleanStore(extra?: {
  assertions?: C2PAManifestStoreView['active_manifest'] extends infer M
    ? M extends { assertions?: readonly unknown[] }
      ? readonly { label: string; data?: unknown }[]
      : never
    : never;
}): C2PAManifestStoreView {
  return {
    active_manifest: {
      claim_generator: 'Signet/0.1 c2pa-node/0.0.0',
      title: 'fixture',
      signature_info: SIG,
      assertions: extra?.assertions,
    },
    validation_status: [],
  };
}

beforeEach(() => _resetIdCounterForTests());

describe('classifyValidationCode', () => {
  it('classifies the exact integrity code observed in the tamper spike', () => {
    expect(classifyValidationCode('assertion.dataHash.mismatch')).toBe('hash-mismatch');
  });

  it('classifies signature-bearing codes as signature failures', () => {
    expect(classifyValidationCode('signature.untrusted')).toBe('signature-failure');
    expect(classifyValidationCode('claimSignature.untrusted')).toBe('signature-failure');
    expect(classifyValidationCode('signature.expired')).toBe('signature-failure');
  });

  it('routes unrecognised codes to the unknown bucket (fail-closed)', () => {
    expect(classifyValidationCode('some.future.code')).toBe('unknown-code');
    expect(classifyValidationCode('assertion.notSupported')).toBe('unknown-code');
  });
});

describe('isAIAssertion', () => {
  it('detects assertions whose label is in the c2pa.ai namespace', () => {
    expect(isAIAssertion({ label: 'c2pa.ai.gen', data: {} })).toBe(true);
    expect(isAIAssertion({ label: 'c2pa.actions', data: {} })).toBe(false);
  });

  it('detects assertions carrying a trained-algorithmic source type', () => {
    expect(
      isAIAssertion({
        label: 'stds.source',
        data: { digitalSourceType: 'trainedAlgorithmicMedia' },
      }),
    ).toBe(true);
    expect(
      isAIAssertion({
        label: 'stds.source',
        data: { digitalSourceType: 'compositeWithTrainedAlgorithmicMedia' },
      }),
    ).toBe(true);
    // A plain digital capture is NOT an AI declaration.
    expect(
      isAIAssertion({ label: 'stds.source', data: { digitalSourceType: 'digitalCapture' } }),
    ).toBe(false);
  });
});

describe('mapManifestStore', () => {
  it('returns an empty graph (no items) when there is no manifest', () => {
    const g = mapManifestStore(null, 'a1');
    expect(g.items).toHaveLength(0);
    expect(g.verificationError).toBeUndefined();

    const g2 = mapManifestStore({ active_manifest: null, validation_status: [] }, 'a1');
    expect(g2.items).toHaveLength(0);
  });

  it('emits credential✓ / signature✓ / hash✓ for a clean manifest', () => {
    const g = mapManifestStore(cleanStore(), 'a1');
    const byType = new Map(g.items.map((i) => [i.type, i]));
    expect(byType.get('c2pa')?.status).toBe('valid');
    expect(byType.get('c2pa')?.level).toBe('hard');
    expect(byType.get('signature')?.status).toBe('valid');
    expect(byType.get('hash')?.status).toBe('valid');
    expect(byType.has('ai-label')).toBe(false);
    expect(g.verificationError).toBeUndefined();
  });

  it('emits a valid ai-label when a c2pa.ai.gen assertion is present', () => {
    const g = mapManifestStore(
      cleanStore({
        assertions: [
          { label: 'c2pa.ai.gen', data: { generator: { description: 'Acme Diffusion' } } },
        ],
      }),
      'a1',
    );
    const ai = g.items.filter((i) => i.type === 'ai-label');
    expect(ai).toHaveLength(1);
    expect(ai[0]?.status).toBe('valid');
    expect(ai[0]?.data).toMatchObject({ kind: 'generated', generator: 'Acme Diffusion' });
  });

  it('emits a valid ai-label for a trainedAlgorithmicMedia digitalSourceType', () => {
    const g = mapManifestStore(
      cleanStore({
        assertions: [
          { label: 'stds.source', data: { digitalSourceType: 'trainedAlgorithmicMedia' } },
        ],
      }),
      'a1',
    );
    const ai = g.items.filter((i) => i.type === 'ai-label');
    expect(ai).toHaveLength(1);
    expect(ai[0]?.status).toBe('valid');
  });

  it('marks hash invalid on assertion.dataHash.mismatch while leaving signature valid', () => {
    const store: C2PAManifestStoreView = {
      active_manifest: { claim_generator: 'x', signature_info: SIG, assertions: [] },
      validation_status: [
        {
          code: 'assertion.dataHash.mismatch',
          explanation: 'asset hash error, error: hash verification( Hashes do not match )',
        },
      ],
    };
    const g = mapManifestStore(store, 'a1');
    const byType = new Map(g.items.map((i) => [i.type, i]));
    expect(byType.get('hash')?.status).toBe('invalid');
    expect(byType.get('signature')?.status).toBe('valid');
    expect(byType.get('c2pa')?.status).toBe('valid');
    expect(g.verificationError).toBeUndefined();
  });

  it('marks signature invalid on a signature.* code while leaving hash valid', () => {
    const store: C2PAManifestStoreView = {
      active_manifest: { claim_generator: 'x', signature_info: SIG, assertions: [] },
      validation_status: [{ code: 'signature.untrusted', explanation: 'untrusted chain' }],
    };
    const g = mapManifestStore(store, 'a1');
    const byType = new Map(g.items.map((i) => [i.type, i]));
    expect(byType.get('signature')?.status).toBe('invalid');
    expect(byType.get('hash')?.status).toBe('valid');
    expect(byType.get('c2pa')?.status).toBe('valid');
  });

  it('fails closed on an unrecognised code: all prongs unknown + verificationError', () => {
    const store: C2PAManifestStoreView = {
      active_manifest: { claim_generator: 'x', signature_info: SIG, assertions: [] },
      validation_status: [{ code: 'some.future.code' }],
    };
    const g = mapManifestStore(store, 'a1');
    const byType = new Map(g.items.map((i) => [i.type, i]));
    expect(byType.get('c2pa')?.status).toBe('unknown');
    expect(byType.get('signature')?.status).toBe('unknown');
    expect(byType.get('hash')?.status).toBe('unknown');
    expect(g.verificationError).toBe(true);
    expect(g.errorMessage).toContain('some.future.code');
  });

  it('demotes an AI declaration to unknown when the credential is not clean', () => {
    // Unrecognised code → credential unknown → AI label must not stay 'valid'.
    const store: C2PAManifestStoreView = {
      active_manifest: {
        claim_generator: 'x',
        signature_info: SIG,
        assertions: [{ label: 'c2pa.ai.gen', data: {} }],
      },
      validation_status: [{ code: 'some.future.code' }],
    };
    const g = mapManifestStore(store, 'a1');
    const ai = g.items.find((i) => i.type === 'ai-label');
    expect(ai?.status).toBe('unknown');
  });

  it('extracts provenance actions from a c2pa.actions assertion into the c2pa item data', () => {
    const g = mapManifestStore(
      cleanStore({
        assertions: [
          {
            label: 'c2pa.actions',
            data: {
              actions: [
                { action: 'c2pa.captured', when: '2026-01-01T00:00:00Z' },
                { action: 'c2pa.color_adjusted', when: '2026-01-01T00:01:00Z' },
              ],
            },
          },
        ],
      }),
      'a1',
    );
    const c2pa = g.items.find((i) => i.type === 'c2pa');
    expect(
      (c2pa?.data as { actions?: { action: string }[] }).actions?.map((a) => a.action),
    ).toEqual(['c2pa.captured', 'c2pa.color_adjusted']);
  });

  it('extracts provenance actions from the versioned c2pa.actions.v2 assertion (demo fixtures)', () => {
    // The committed fixtures emit `c2pa.actions.v2`; extractActions must accept
    // the whole c2pa.actions.vN family, or the timeline stays empty (D15/D16).
    const g = mapManifestStore(
      cleanStore({
        assertions: [
          {
            label: 'c2pa.actions.v2',
            data: {
              actions: [
                { action: 'c2pa.created', actor: 'Signet', when: '2026-08-12T10:23:30Z' },
                { action: 'c2pa.signed' },
              ],
            },
          },
        ],
      }),
      'a1',
    );
    const c2pa = g.items.find((i) => i.type === 'c2pa');
    expect(
      (c2pa?.data as { actions?: { action: string }[] }).actions?.map((a) => a.action),
    ).toEqual(['c2pa.created', 'c2pa.signed']);
  });
});
