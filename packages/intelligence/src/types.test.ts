import { describe, expect, it } from 'vitest';

import type { SemanticRole } from '@signet/core';

import {
  AssetSemanticAnalysisSchema,
  ClaimEvidenceResultSchema,
  DEFAULT_INTELLIGENCE_CONFIG,
  clamp01,
  isAnalysisSource,
} from './index.js';

describe('DEFAULT_INTELLIGENCE_CONFIG', () => {
  it('is opt-in: intelligence OFF and privacy context-only by default', () => {
    // With this config the extension behaves identically to pre-Intelligence
    // Signet — the layer must be an enhancement, never a dependency (§11).
    expect(DEFAULT_INTELLIGENCE_CONFIG.enabled).toBe(false);
    expect(DEFAULT_INTELLIGENCE_CONFIG.provider).toBe('disabled');
    expect(DEFAULT_INTELLIGENCE_CONFIG.privacyMode).toBe('context-only');
    expect(DEFAULT_INTELLIGENCE_CONFIG.timeoutMs).toBe(8000);
  });
});

describe('clamp01', () => {
  it('clamps into [0,1] and fail-closes non-finite to 0', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('isAnalysisSource', () => {
  it('accepts the three legitimate sources and rejects everything else', () => {
    expect(isAnalysisSource('heuristic')).toBe(true);
    expect(isAnalysisSource('ai')).toBe(true);
    expect(isAnalysisSource('hybrid')).toBe(true);
    expect(isAnalysisSource('verified')).toBe(false); // a trust state, not a source
    expect(isAnalysisSource(null)).toBe(false);
  });
});

describe('AssetSemanticAnalysisSchema', () => {
  it('parses a well-formed analysis', () => {
    const out = AssetSemanticAnalysisSchema.parse({
      assetId: 'a1',
      role: 'primary-evidence',
      importance: 0.9,
      evidenceLikelihood: 0.8,
      confidence: 0.7,
      reason: 'chart under a numeric claim',
      generatedBy: 'ai',
    });
    expect(out.role).toBe('primary-evidence');
    expect(out.generatedBy).toBe('ai');
  });

  it('rejects an unknown role enum (the failure mode that must trigger fallback)', () => {
    expect(() =>
      AssetSemanticAnalysisSchema.parse({
        assetId: 'a1',
        role: 'super-evidence', // not in the union
        importance: 0.5,
        evidenceLikelihood: 0.5,
        confidence: 0.5,
        reason: 'x',
        generatedBy: 'ai',
      }),
    ).toThrow();
  });

  it('rejects a missing required field', () => {
    expect(() =>
      AssetSemanticAnalysisSchema.parse({
        assetId: 'a1',
        role: 'chart',
        importance: 0.5,
        // evidenceLikelihood missing
        confidence: 0.5,
        reason: 'x',
        generatedBy: 'heuristic',
      }),
    ).toThrow();
  });
});

describe('ClaimEvidenceResultSchema', () => {
  it('parses nested assets + links', () => {
    const out = ClaimEvidenceResultSchema.parse({
      assets: [
        {
          assetId: 'a1',
          role: 'chart',
          importance: 0.9,
          evidenceLikelihood: 0.9,
          confidence: 0.8,
          reason: 'r',
          generatedBy: 'hybrid',
        },
      ],
      links: [
        {
          claimId: 'c1',
          assetId: 'a1',
          relation: 'supports',
          confidence: 0.94,
          reason: 'chart illustrates the numeric claim',
        },
      ],
    });
    expect(out.assets).toHaveLength(1);
    expect(out.links[0]?.relation).toBe('supports');
  });

  it('rejects an unknown relation', () => {
    expect(() =>
      ClaimEvidenceResultSchema.parse({
        assets: [],
        links: [{ claimId: 'c1', assetId: 'a1', relation: 'proves', confidence: 1, reason: 'r' }],
      }),
    ).toThrow();
  });
});

describe('SemanticRoleSchema ↔ core SemanticRole (drift guard)', () => {
  it('parses a role that is statically assignable to the core SemanticRole type', () => {
    // If schemas.ts and core/domain.ts drift, this assignment fails to compile.
    const parsed = AssetSemanticAnalysisSchema.parse({
      assetId: 'a1',
      role: 'data-visualization',
      importance: 0.5,
      evidenceLikelihood: 0.5,
      confidence: 0.5,
      reason: 'r',
      generatedBy: 'heuristic',
    });
    const role: SemanticRole = parsed.role;
    expect(role).toBe('data-visualization');
  });
});
