import { describe, expect, it } from 'vitest';
import type { EvidenceGraph } from '@signet/core';

import { calculateTrustState, decide, deriveFacts } from './index.js';
import { applyRules } from './rules.js';
import {
  emptyGraph,
  mkGraph,
  mkItem,
  softAiOnlyGraph,
  tamperedGraph,
  verifiedAiGraph,
  verifiedGraph,
} from './builders.js';

describe('Trust Decision Engine — PRD-mandated cases', () => {
  it('valid credential + valid signature + valid integrity → verified', () => {
    const d = decide(verifiedGraph());
    expect(d.state).toBe('verified');
    expect(d.reason).toBe('valid-credential');
    expect(d.ruleId).toBe('R4-verified');
    expect(d.failClosed).toBe(false);
  });

  it('valid AI credential → verified-ai (AI ≠ Fake)', () => {
    const d = decide(verifiedAiGraph());
    expect(d.state).toBe('verified-ai');
    expect(d.reason).toBe('ai-declared-and-valid');
    expect(d.failClosed).toBe(false);
  });

  it('invalid integrity → broken (the tamper-demo guarantee)', () => {
    const d = decide(tamperedGraph());
    expect(d.state).toBe('broken');
    expect(d.reason).toBe('integrity-mismatch');
    expect(d.ruleId).toBe('R1-broken');
    expect(d.failClosed).toBe(false);
  });

  it('no evidence → unknown', () => {
    const d = decide(emptyGraph());
    expect(d.state).toBe('unknown');
    expect(d.reason).toBe('no-evidence');
    expect(d.ruleId).toBe('R5-default-unknown');
    expect(d.failClosed).toBe(true);
  });

  it('AI soft evidence only → unknown (soft can never promote to verified-ai)', () => {
    const d = decide(softAiOnlyGraph());
    expect(d.state).toBe('unknown');
    expect(d.reason).toBe('soft-evidence-only');
    expect(d.failClosed).toBe(true);
  });
});

describe('Trust Decision Engine — fail-closed precedence & edge cases', () => {
  it('credential present but signature/integrity unknown → unknown (insufficient)', () => {
    const g = mkGraph([mkItem({ type: 'c2pa', status: 'valid' })]);
    const d = decide(g);
    expect(d.state).toBe('unknown');
    expect(d.reason).toBe('insufficient-evidence');
  });

  it('signature explicitly invalid (credential present) → broken', () => {
    const g = mkGraph([
      mkItem({ type: 'c2pa', status: 'valid' }),
      mkItem({ type: 'signature', status: 'invalid' }),
      mkItem({ type: 'hash', status: 'valid' }),
    ]);
    const d = decide(g);
    expect(d.state).toBe('broken');
    expect(d.reason).toBe('signature-invalid');
  });

  it('credential valid + signature valid + integrity unknown → unknown (no false-verified)', () => {
    const g = mkGraph([
      mkItem({ type: 'c2pa', status: 'valid' }),
      mkItem({ type: 'signature', status: 'valid' }),
      mkItem({ type: 'hash', status: 'unknown' }),
    ]);
    expect(decide(g).state).toBe('unknown');
  });

  it('collector verificationError, no other signal → unknown (verification-error)', () => {
    const g = mkGraph([mkItem({ type: 'c2pa', status: 'unknown' })], { verificationError: true });
    const d = decide(g);
    expect(d.state).toBe('unknown');
    expect(d.reason).toBe('verification-error');
    expect(d.failClosed).toBe(true);
  });

  it('BROKEN precedence over error: invalid integrity + verificationError → broken', () => {
    const g = mkGraph(
      [
        mkItem({ type: 'c2pa', status: 'valid' }),
        mkItem({ type: 'signature', status: 'valid' }),
        mkItem({ type: 'hash', status: 'invalid' }),
      ],
      { verificationError: true },
    );
    const d = decide(g);
    expect(d.state).toBe('broken');
    expect(d.reason).toBe('integrity-mismatch');
  });

  it('BROKEN precedence over verified: invalid integrity + valid AI label → broken', () => {
    const g = mkGraph([
      mkItem({ type: 'c2pa', status: 'valid' }),
      mkItem({ type: 'signature', status: 'valid' }),
      mkItem({ type: 'hash', status: 'invalid' }),
      mkItem({ type: 'ai-label', status: 'valid', data: { kind: 'generated' } }),
    ]);
    expect(decide(g).state).toBe('broken');
  });

  it('conflicting hard hash statuses (valid + invalid) → unknown (evidence-conflict)', () => {
    const g = mkGraph([
      mkItem({ type: 'c2pa', status: 'valid' }),
      mkItem({ type: 'signature', status: 'valid' }),
      mkItem({ type: 'hash', status: 'valid', id: 'h1' }),
      mkItem({ type: 'hash', status: 'invalid', id: 'h2' }),
    ]);
    const d = decide(g);
    expect(d.state).toBe('unknown');
    expect(d.reason).toBe('evidence-conflict');
    expect(d.failClosed).toBe(true);
  });

  it('hard metadata only (no c2pa/signature/hash) → unknown (insufficient)', () => {
    const g = mkGraph([mkItem({ type: 'metadata', status: 'valid', data: { make: 'Sony' } })]);
    const d = decide(g);
    expect(d.state).toBe('unknown');
    expect(d.reason).toBe('insufficient-evidence');
  });

  it('valid provenance + ai-label present but INVALID → verified (not verified-ai)', () => {
    const g = mkGraph([
      mkItem({ type: 'c2pa', status: 'valid' }),
      mkItem({ type: 'signature', status: 'valid' }),
      mkItem({ type: 'hash', status: 'valid' }),
      mkItem({ type: 'ai-label', status: 'invalid', data: { kind: 'generated' } }),
    ]);
    const d = decide(g);
    expect(d.state).toBe('verified');
    expect(d.reason).toBe('valid-credential');
  });

  it('never throws on malformed/empty input — returns fail-closed unknown', () => {
    const g: EvidenceGraph = { assetId: 'a', items: [] };
    expect(decide(g).state).toBe('unknown');
  });
});

describe('Trust Decision Engine — contributing evidence & metadata', () => {
  it('verified decision lists credential+signature+integrity contributors', () => {
    const d = decide(verifiedGraph());
    expect(d.contributingEvidence).toHaveLength(3);
    expect(d.contributingEvidence).toContain('cred');
    expect(d.contributingEvidence).toContain('sig');
    expect(d.contributingEvidence).toContain('hash');
  });

  it('verified-ai decision also lists the ai-label contributor', () => {
    const d = decide(verifiedAiGraph());
    expect(d.contributingEvidence).toHaveLength(4);
    expect(d.contributingEvidence).toContain('ai');
  });

  it('broken (integrity) decision lists credential+integrity contributors', () => {
    const d = decide(tamperedGraph());
    expect(d.contributingEvidence).toContain('cred');
    expect(d.contributingEvidence).toContain('hash');
    expect(d.contributingEvidence).not.toContain('sig');
  });

  it('contributor ids are de-duplicated', () => {
    const g = mkGraph([
      mkItem({ type: 'c2pa', status: 'valid', id: 'dup' }),
      mkItem({ type: 'signature', status: 'valid', id: 'dup' }),
      mkItem({ type: 'hash', status: 'valid', id: 'dup' }),
    ]);
    const d = decide(g);
    // three sources collapsed; dedup keeps one of each id occurrence per bucket,
    // then across buckets the Set collapses them to a single 'dup'.
    expect(d.contributingEvidence).toEqual(['dup']);
  });

  it('calculateTrustState returns only the state string', () => {
    expect(calculateTrustState(verifiedGraph())).toBe('verified');
    expect(calculateTrustState(tamperedGraph())).toBe('broken');
    expect(calculateTrustState(emptyGraph())).toBe('unknown');
    expect(calculateTrustState(verifiedAiGraph())).toBe('verified-ai');
  });

  it('failClosed is true for every unknown reason and false for verified/broken', () => {
    const cases: Array<{ g: EvidenceGraph; expectedFailClosed: boolean }> = [
      { g: verifiedGraph(), expectedFailClosed: false },
      { g: verifiedAiGraph(), expectedFailClosed: false },
      { g: tamperedGraph(), expectedFailClosed: false },
      { g: emptyGraph(), expectedFailClosed: true },
      { g: softAiOnlyGraph(), expectedFailClosed: true },
    ];
    for (const { g, expectedFailClosed } of cases) {
      expect(decide(g).failClosed).toBe(expectedFailClosed);
    }
  });
});

describe('deriveFacts — reconciliation', () => {
  it('all-valid hashes reconcile to valid with no conflict', () => {
    const f = deriveFacts(
      mkGraph([
        mkItem({ type: 'hash', status: 'valid', id: 'h1' }),
        mkItem({ type: 'hash', status: 'valid', id: 'h2' }),
      ]),
    );
    expect(f.integrityStatus).toBe('valid');
    expect(f.conflict).toBe(false);
  });

  it('mixed valid/unknown hashes reconcile to valid (unknown is not a vote)', () => {
    const f = deriveFacts(
      mkGraph([
        mkItem({ type: 'hash', status: 'valid' }),
        mkItem({ type: 'hash', status: 'unknown' }),
      ]),
    );
    expect(f.integrityStatus).toBe('valid');
    expect(f.conflict).toBe(false);
  });

  it('mixed valid/invalid hashes flag a conflict and collapse to unknown', () => {
    const f = deriveFacts(
      mkGraph([
        mkItem({ type: 'hash', status: 'valid' }),
        mkItem({ type: 'hash', status: 'invalid' }),
      ]),
    );
    expect(f.integrityStatus).toBe('unknown');
    expect(f.conflict).toBe(true);
  });

  it('aiKind is extracted from the first valid hard ai-label', () => {
    const f = deriveFacts(
      mkGraph([mkItem({ type: 'ai-label', status: 'valid', data: { kind: 'edited' } })]),
    );
    expect(f.aiDeclared).toBe(true);
    expect(f.aiKind).toBe('edited');
  });

  it('applyRules is pure: same facts → same decision', () => {
    const f = deriveFacts(verifiedGraph());
    const a = applyRules(f);
    const b = applyRules(f);
    expect(a).toEqual(b);
  });
});
