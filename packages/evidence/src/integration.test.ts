/**
 * @signet/evidence — integration with the Trust Engine.
 *
 * This is the single most important test in the project: it proves that the
 * C2PA read-result shapes produced by the real SDK map, through the pure
 * mapper, into the four trust states the PRD requires. It uses the synthetic
 * manifest stores that mirror what the sign→read→tamper spike actually
 * produced (see docs/decisions.md D12), so a green run here is direct evidence
 * for the "4 states correct" acceptance criterion — without needing the native
 * binary in CI.
 */
import { describe, expect, it } from 'vitest';

import { mapManifestStore } from './mapper.js';
import { decide } from '@signet/trust-engine';
import type { C2PAManifestStoreView } from './c2pa-types.js';

const SIG = { alg: 'Es256', issuer: 'C2PA Test Signing Cert', time: '2026-01-01T00:00:00Z' };

describe('decide(mapManifestStore(...)) — the four trust states', () => {
  it('no manifest → unknown / no-evidence', () => {
    const d = decide(mapManifestStore(null, 'a1'));
    expect(d.state).toBe('unknown');
    expect(d.reason).toBe('no-evidence');
    expect(d.failClosed).toBe(true);
  });

  it('clean manifest → verified / valid-credential', () => {
    const store: C2PAManifestStoreView = {
      active_manifest: { claim_generator: 'Signet/0.1', signature_info: SIG, assertions: [] },
      validation_status: [],
    };
    const d = decide(mapManifestStore(store, 'a1'));
    expect(d.state).toBe('verified');
    expect(d.reason).toBe('valid-credential');
    expect(d.ruleId).toBe('R4-verified');
    expect(d.failClosed).toBe(false);
  });

  it('clean manifest + AI declaration → verified-ai / ai-declared-and-valid', () => {
    const store: C2PAManifestStoreView = {
      active_manifest: {
        claim_generator: 'Signet/0.1',
        signature_info: SIG,
        assertions: [
          {
            label: 'c2pa.ai.gen',
            data: {
              generator: { description: 'Acme Diffusion 2', type: 'software' },
              digitalSourceType: 'trainedAlgorithmicMedia',
            },
          },
        ],
      },
      validation_status: [],
    };
    const d = decide(mapManifestStore(store, 'a1'));
    expect(d.state).toBe('verified-ai');
    expect(d.reason).toBe('ai-declared-and-valid');
    expect(d.ruleId).toBe('R4-verified');
  });

  it('c2pa.actions[].digitalSourceType (URI form) → verified-ai', () => {
    const store: C2PAManifestStoreView = {
      active_manifest: {
        claim_generator: 'Signet/0.1',
        signature_info: SIG,
        assertions: [
          {
            label: 'c2pa.actions',
            data: {
              actions: [
                {
                  action: 'c2pa.created',
                  digitalSourceType:
                    'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
                },
              ],
            },
          },
        ],
      },
      validation_status: [],
    };
    const d = decide(mapManifestStore(store, 'a1'));
    expect(d.state).toBe('verified-ai');
    expect(d.reason).toBe('ai-declared-and-valid');
  });

  it('c2pa.actions.v2[].digitalSourceType (short form) → verified-ai', () => {
    const store: C2PAManifestStoreView = {
      active_manifest: {
        claim_generator: 'Signet/0.1',
        signature_info: SIG,
        assertions: [
          {
            label: 'c2pa.actions.v2',
            data: {
              actions: [{ action: 'c2pa.created', digitalSourceType: 'trainedAlgorithmicMedia' }],
            },
          },
        ],
      },
      validation_status: [],
    };
    const d = decide(mapManifestStore(store, 'a1'));
    expect(d.state).toBe('verified-ai');
  });

  it('AI declaration + integrity mismatch → broken (never verified-ai)', () => {
    // An asset that declares AI generation but fails its hash binding is broken,
    // not "verified" and not "verified-ai": a cryptographic failure dominates.
    const store: C2PAManifestStoreView = {
      active_manifest: {
        claim_generator: 'Signet/0.1',
        signature_info: SIG,
        assertions: [
          {
            label: 'c2pa.actions',
            data: {
              actions: [
                {
                  action: 'c2pa.created',
                  digitalSourceType:
                    'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
                },
              ],
            },
          },
        ],
      },
      validation_status: [
        {
          code: 'assertion.dataHash.mismatch',
          explanation: 'asset hash error, error: hash verification( Hashes do not match )',
        },
      ],
    };
    const d = decide(mapManifestStore(store, 'a1'));
    expect(d.state).toBe('broken');
    expect(d.reason).toBe('integrity-mismatch');
  });

  it('assertion.dataHash.mismatch (tamper) → broken / integrity-mismatch', () => {
    const store: C2PAManifestStoreView = {
      active_manifest: { claim_generator: 'Signet/0.1', signature_info: SIG, assertions: [] },
      validation_status: [
        {
          code: 'assertion.dataHash.mismatch',
          explanation: 'asset hash error, error: hash verification( Hashes do not match )',
        },
      ],
    };
    const d = decide(mapManifestStore(store, 'a1'));
    expect(d.state).toBe('broken');
    expect(d.reason).toBe('integrity-mismatch');
    expect(d.ruleId).toBe('R1-broken');
    // Broken is a positive detection, not a fail-closed unknown.
    expect(d.failClosed).toBe(false);
  });

  it('signature failure → broken / signature-invalid', () => {
    const store: C2PAManifestStoreView = {
      active_manifest: { claim_generator: 'Signet/0.1', signature_info: SIG, assertions: [] },
      validation_status: [{ code: 'signature.untrusted' }],
    };
    const d = decide(mapManifestStore(store, 'a1'));
    expect(d.state).toBe('broken');
    expect(d.reason).toBe('signature-invalid');
  });

  it('unrecognised validation code → unknown / verification-error (fail closed)', () => {
    const store: C2PAManifestStoreView = {
      active_manifest: { claim_generator: 'Signet/0.1', signature_info: SIG, assertions: [] },
      validation_status: [{ code: 'some.future.unknown.code' }],
    };
    const d = decide(mapManifestStore(store, 'a1'));
    expect(d.state).toBe('unknown');
    expect(d.reason).toBe('verification-error');
    expect(d.failClosed).toBe(true);
  });
});
