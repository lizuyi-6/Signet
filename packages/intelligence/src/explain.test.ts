import { describe, expect, it } from 'vitest';

import { TRUST_STATE_META, type TrustReason, type TrustState } from '@signet/core';

import {
  buildDeterministicExplanation,
  explainEvidenceWithFallback,
  MockIntelligenceProvider,
  VERDICT_CLAUSE,
  type ContextualExplanation,
  type IntelligenceProvider,
  type PageSemanticInput,
  type TrustExplanationInput,
} from './index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REASON_FOR: Readonly<Record<TrustState, TrustReason>> = {
  verified: 'valid-credential',
  'verified-ai': 'ai-declared-and-valid',
  broken: 'integrity-mismatch',
  unknown: 'no-evidence',
};

function mkInput(overrides: Partial<TrustExplanationInput> = {}): TrustExplanationInput {
  return {
    assetId: 'a1',
    trust: { state: 'verified', reason: 'valid-credential' },
    ...overrides,
  };
}

const ALL_STATES: readonly TrustState[] = ['verified', 'verified-ai', 'broken', 'unknown'];

// ---------------------------------------------------------------------------
// Deterministic floor — §59: may not re-derive, override, or contradict the verdict
// ---------------------------------------------------------------------------

describe('buildDeterministicExplanation — never contradicts the verdict', () => {
  it('embeds the EXACT verdict clause for its own state (a pure function of state)', () => {
    for (const state of ALL_STATES) {
      const out = buildDeterministicExplanation(
        mkInput({ trust: { state, reason: REASON_FOR[state] } }),
      );
      expect(out.text.includes(VERDICT_CLAUSE[state]), `state=${state}`).toBe(true);
    }
  });

  it('contains NO other state’s verdict clause (cross-state contamination impossible)', () => {
    for (const state of ALL_STATES) {
      const out = buildDeterministicExplanation(
        mkInput({ trust: { state, reason: REASON_FOR[state] } }),
      );
      for (const other of ALL_STATES) {
        if (other === state) continue;
        expect(
          out.text.includes(VERDICT_CLAUSE[other]),
          `state=${state} must not contain clause of ${other}`,
        ).toBe(false);
      }
    }
  });

  it('contains its own trust LABEL and no other state’s label (badge-vocabulary lock)', () => {
    for (const state of ALL_STATES) {
      const out = buildDeterministicExplanation(
        mkInput({ trust: { state, reason: REASON_FOR[state] } }),
      );
      expect(out.text.includes(TRUST_STATE_META[state].label), `state=${state}`).toBe(true);
      for (const other of ALL_STATES) {
        if (other === state) continue;
        expect(
          out.text.includes(TRUST_STATE_META[other].label),
          `state=${state} must not contain label of ${other}`,
        ).toBe(false);
      }
    }
  });
});

describe('buildDeterministicExplanation — composition', () => {
  it('narrates the role when a semanticRole is given', () => {
    const out = buildDeterministicExplanation(mkInput({ semanticRole: 'chart' }));
    expect(out.text).toContain('On this page it functions as a chart.');
  });

  it('omits the role clause when no semanticRole is given (never invents one)', () => {
    const out = buildDeterministicExplanation(mkInput());
    expect(out.text).not.toContain('functions as');
  });

  it('narrates the claim + relation when both are given (§19 wording: "appears to")', () => {
    const out = buildDeterministicExplanation(
      mkInput({
        pageClaim: {
          id: 'clm_1',
          text: 'Inflation eased in July',
          type: 'numeric',
          importance: 0.9,
        },
        claimRelation: {
          claimId: 'clm_1',
          assetId: 'a1',
          relation: 'illustrates',
          confidence: 0.8,
          reason: 'r',
        },
      }),
    );
    expect(out.text).toContain('appears to illustrate the claim: “Inflation eased in July”.');
  });

  it('narrates the claim without a relation when only the claim is given', () => {
    const out = buildDeterministicExplanation(
      mkInput({ pageClaim: { id: 'clm_1', text: 'A claim', type: 'factual', importance: 0.5 } }),
    );
    expect(out.text).toContain('associated with the claim: “A claim”.');
  });

  it('truncates an overlong claim quote on a word boundary', () => {
    // ~430 chars; "Zebratalia" is the unique tail word that truncation must cut.
    const longClaim = `Inflation ${'kept '.repeat(80)}Zebratalia`.replace(/\s+/g, ' ').trim();
    const out = buildDeterministicExplanation(
      mkInput({ pageClaim: { id: 'clm_1', text: longClaim, type: 'factual', importance: 0.5 } }),
    );
    expect(out.text).toContain('…'); // truncated, not hard-cut
    expect(out.text).not.toContain('Zebratalia'); // the tail is gone
  });
});

describe('buildDeterministicExplanation — caveats', () => {
  it('emits the claim-type caveat for every claim type (provenance ≠ claim truth, §19)', () => {
    const CASES = [
      { type: 'forecast' as const, fragment: 'not the prediction' },
      { type: 'numeric' as const, fragment: 'not the numbers' },
      { type: 'comparative' as const, fragment: 'not the comparison' },
      { type: 'factual' as const, fragment: 'not the truth of the claim' },
      { type: 'descriptive' as const, fragment: 'not the description' },
    ];
    for (const { type, fragment } of CASES) {
      const out = buildDeterministicExplanation(
        mkInput({ pageClaim: { id: 'clm_1', text: 'Some claim text', type, importance: 0.5 } }),
      );
      expect(
        out.caveats.some((c) => c.includes(fragment)),
        `type=${type} must carry its caveat; got: ${JSON.stringify(out.caveats)}`,
      ).toBe(true);
    }
  });

  it('emits no claim caveat when no claim is given', () => {
    const out = buildDeterministicExplanation(mkInput());
    expect(out.caveats).toEqual([]);
  });

  it('emits the AI-disclosure caveat for verified-ai (AI-generated ≠ fake)', () => {
    const out = buildDeterministicExplanation(
      mkInput({ trust: { state: 'verified-ai', reason: 'ai-declared-and-valid' } }),
    );
    expect(out.caveats.some((c) => c.includes('AI-generated ≠ fake'))).toBe(true);
  });

  it('emits the no-evidence caveat for unknown', () => {
    const out = buildDeterministicExplanation(
      mkInput({ trust: { state: 'unknown', reason: 'no-evidence' } }),
    );
    expect(out.caveats.some((c) => c.includes('does not mean the content is real or fake'))).toBe(
      true,
    );
  });

  it('is always deterministic-sourced and echoes the input assetId', () => {
    const out = buildDeterministicExplanation(mkInput({ assetId: 'img-42' }));
    expect(out.source).toBe('deterministic');
    expect(out.assetId).toBe('img-42');
  });
});

// ---------------------------------------------------------------------------
// Orchestrator — the §14 pattern applied to explanation (AI off/fail → floor)
// ---------------------------------------------------------------------------

function mkPageForMock(): PageSemanticInput {
  return {
    pageUrl: 'https://example.com/',
    headings: [],
    claims: [],
    privacyMode: 'context-only',
    assets: [],
  };
}

describe('explainEvidenceWithFallback — fallback invariant', () => {
  it('returns the deterministic floor when no provider is given (AI off)', async () => {
    const out = await explainEvidenceWithFallback(mkInput());
    expect(out.source).toBe('deterministic');
    expect(out.explanation.text).toContain(VERDICT_CLAUSE.verified);
    expect(out.error).toBeUndefined();
  });

  it('returns the floor when the provider does NOT implement explainEvidence', async () => {
    const bare: IntelligenceProvider = {
      classifyPage: async () => ({ assets: [], links: [] }),
    };
    const out = await explainEvidenceWithFallback(mkInput(), bare);
    expect(out.source).toBe('deterministic');
  });

  it('uses the AI explanation when the provider returns a valid one', async () => {
    const canned: ContextualExplanation = {
      assetId: 'a1',
      text: 'The chart visualizes the quarterly trend the headline describes.',
      source: 'ai',
      caveats: [],
    };
    const provider = new MockIntelligenceProvider({ explainOptions: { output: canned } });
    const out = await explainEvidenceWithFallback(mkInput(), provider);
    expect(out.source).toBe('ai');
    expect(out.explanation.text).toBe(canned.text);
    expect(out.explanation.caveats).toEqual([]);
  });

  it('forces OUR assetId onto the AI explanation (provider cannot retarget it)', async () => {
    const provider = new MockIntelligenceProvider({
      explainOptions: {
        output: {
          assetId: 'SOME-OTHER-ASSET',
          text: 'AI text',
          source: 'ai',
          caveats: [],
        },
      },
    });
    const out = await explainEvidenceWithFallback(mkInput({ assetId: 'img-9' }), provider);
    expect(out.source).toBe('ai');
    expect(out.explanation.assetId).toBe('img-9');
  });

  it('falls back to the floor when the provider THROWS', async () => {
    const provider = new MockIntelligenceProvider({
      explainOptions: { failWith: new TypeError('network failed') },
    });
    const out = await explainEvidenceWithFallback(mkInput(), provider);
    expect(out.source).toBe('deterministic');
    expect(out.explanation.text).toContain(VERDICT_CLAUSE.verified);
    expect(out.error).toContain('network failed');
  });

  it('falls back when the provider returns garbage (zod safety-net)', async () => {
    const provider = new MockIntelligenceProvider({
      explainOptions: { rawOutput: 'not an object at all' },
    });
    const out = await explainEvidenceWithFallback(mkInput(), provider);
    expect(out.source).toBe('deterministic');
  });

  it('falls back when the AI lies about its source label (schema forces "ai" only)', async () => {
    // Honest labeling (§31): a provider cannot return source:"deterministic"
    // (or anything else) — the schema rejects it and the floor takes over.
    const provider = new MockIntelligenceProvider({
      explainOptions: {
        rawOutput: {
          assetId: 'a1',
          text: 'trustworthy words',
          source: 'deterministic',
          caveats: [],
        },
      },
    });
    const out = await explainEvidenceWithFallback(mkInput(), provider);
    expect(out.source).toBe('deterministic');
    expect(out.explanation.text).toContain(VERDICT_CLAUSE.verified);
  });

  it('falls back when the AI text exceeds the 2000-char cap', async () => {
    const provider = new MockIntelligenceProvider({
      explainOptions: {
        output: { assetId: 'a1', text: 'x'.repeat(2001), source: 'ai', caveats: [] },
      },
    });
    const out = await explainEvidenceWithFallback(mkInput(), provider);
    expect(out.source).toBe('deterministic');
  });

  it('falls back on TIMEOUT (explain slower than the bound)', async () => {
    const provider = new MockIntelligenceProvider({
      explainOptions: { delayMs: 600 },
    });
    const t0 = Date.now();
    const out = await explainEvidenceWithFallback(mkInput(), provider, 40);
    const elapsed = Date.now() - t0;
    expect(out.source).toBe('deterministic');
    expect(out.error).toMatch(/timed out|timeout/i);
    expect(elapsed).toBeLessThan(500);
  });

  it('keeps classifyPage working for the same mock provider (no cross-path bleed)', async () => {
    // The explain knobs must not affect the classify path.
    const provider = new MockIntelligenceProvider({ explainOptions: { failWith: new Error('x') } });
    const classified = await provider.classifyPage(mkPageForMock());
    expect(Array.isArray(classified.assets)).toBe(true);
    const explained = await explainEvidenceWithFallback(mkInput(), provider);
    expect(explained.source).toBe('deterministic'); // explain path still fails independently
  });
});
