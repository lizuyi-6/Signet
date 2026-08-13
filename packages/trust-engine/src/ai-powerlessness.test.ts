/**
 * @signet/trust-engine — §51 CRITICAL safety tests: AI powerlessness.
 *
 * The inviolable invariant (§11, §51, D19): the Intelligence Layer is an
 * ENHANCEMENT, never a dependency of provenance verification, and an AI/soft
 * result can NEVER promote content to Verified / Verified-AI, nor demote
 * cryptographically-verified content to Broken.
 *
 * These four tests are the release gate for that invariant. Each asserts BOTH
 * the verdict (the user-visible state) AND the fact-field that MECHANICALLY
 * proves why (derive-facts.ts drops every `soft` item from the
 * credential/signature/integrity/ai buckets — a soft item can only set
 * `hasSoftEvidence`). The verdict is the outcome; the fact-field is the
 * sufficient condition that makes "soft can never promote/demote" falsifiable.
 */
import { describe, expect, it } from 'vitest';

import { decide, deriveFacts } from './index.js';
import { mkGraph, mkItem, tamperedGraph, verifiedGraph } from './builders.js';

/** A soft, model-derived signal that asserts the content is authentic. */
function softClaimsVerified(): ReturnType<typeof mkItem> {
  return mkItem({
    type: 'semantic',
    level: 'soft',
    status: 'valid',
    id: 'soft-verified',
    data: { claim: 'authentic', confidence: 0.99 },
    source: 'vlm-heuristic',
  });
}

/** A soft, model-derived signal that asserts the content is synthetic/fake. */
function softClaimsFake(): ReturnType<typeof mkItem> {
  return mkItem({
    type: 'semantic',
    level: 'soft',
    status: 'invalid',
    id: 'soft-fake',
    data: { claim: 'synthetic', confidence: 0.99 },
    source: 'vlm-heuristic',
  });
}

describe('§51 — soft evidence can never PROMOTE to Verified', () => {
  it('soft "verified" + no hard credential → unknown (soft-evidence-only)', () => {
    const g = mkGraph([softClaimsVerified()]);
    const d = decide(g);
    // Verdict: never verified.
    expect(d.state).toBe('unknown');
    expect(d.reason).toBe('soft-evidence-only');
    expect(d.failClosed).toBe(true);
    // The sufficient condition: a soft "credential-like" claim contributes to
    // NO hard signal — credentialPresent is false, only hasSoftEvidence set.
    const f = deriveFacts(g);
    expect(f.credentialPresent).toBe(false);
    expect(f.hasHardEvidence).toBe(false);
    expect(f.hasSoftEvidence).toBe(true);
  });
});

describe('§51 — soft evidence can never DEMOTE verified content', () => {
  it('soft "fake" + valid C2PA → still verified (soft cannot demote)', () => {
    const g = mkGraph([
      ...verifiedGraph().items,
      softClaimsFake(), // an AI model screaming "this is fake" — irrelevant to trust
    ]);
    const d = decide(g);
    // Verdict: the cryptographic evidence wins; the soft "fake" is ignored.
    expect(d.state).toBe('verified');
    expect(d.reason).toBe('valid-credential');
    // The sufficient condition: the soft "fake" contributes to NO hard signal.
    const f = deriveFacts(g);
    expect(f.integrityStatus).toBe('valid');
    expect(f.signatureStatus).toBe('valid');
    expect(f.hasSoftEvidence).toBe(true);
  });
});

describe('§51 — AI is a dependency of NOTHING (AI-unavailable invariance)', () => {
  it('AI unavailable + valid C2PA → verified (no soft item present)', () => {
    // verifiedGraph() has ZERO soft/AI items: the intelligence layer is absent
    // (disabled or failed), yet a valid credential still verifies.
    const g = verifiedGraph();
    expect(deriveFacts(g).hasSoftEvidence).toBe(false);
    const d = decide(g);
    expect(d.state).toBe('verified');
    expect(d.reason).toBe('valid-credential');
  });

  it('AI unavailable + broken C2PA → broken (no soft item present)', () => {
    // tamperedGraph() has ZERO soft/AI items: broken-detection does not depend
    // on any AI signal — an invalid hash is detected on its own.
    const g = tamperedGraph();
    expect(deriveFacts(g).hasSoftEvidence).toBe(false);
    const d = decide(g);
    expect(d.state).toBe('broken');
    expect(d.reason).toBe('integrity-mismatch');
  });
});
