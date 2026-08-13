import { describe, expect, it } from 'vitest';

import { HybridSemanticClassifier, MockIntelligenceProvider, SemanticCache } from './index.js';
import type {
  AssetSemanticAnalysis,
  IntelligenceConfig,
  IntelligenceProvider,
  PageSemanticInput,
} from './index.js';

const ENABLED: IntelligenceConfig = {
  enabled: true,
  provider: 'mock',
  timeoutMs: 8000,
  privacyMode: 'context-only',
};

function mkPage(): PageSemanticInput {
  return {
    pageUrl: 'https://example.com/article',
    pageTitle: 'Article',
    headings: ['Investigation'],
    claims: [],
    privacyMode: 'context-only',
    assets: [
      {
        assetId: 'logo-1',
        width: 40,
        height: 40,
        altText: 'site logo',
        pageUrl: 'https://example.com/article',
      },
      {
        assetId: 'chart-1',
        width: 800,
        height: 600,
        altText: 'revenue chart',
        nearbyText: 'Q3 revenue chart',
        pageUrl: 'https://example.com/article',
      },
    ],
  };
}

describe('HybridSemanticClassifier — disabled mode', () => {
  it('returns the heuristic floor and never calls the provider', async () => {
    let called = false;
    const provider = new MockIntelligenceProvider({
      failWith: new Error('should not be called'),
    });
    // Wrap to observe the call.
    const wrapped: IntelligenceProvider = {
      async classifyPage(input) {
        called = true;
        return provider.classifyPage(input);
      },
    };
    const c = new HybridSemanticClassifier({
      config: { ...ENABLED, enabled: false },
      provider: wrapped,
    });
    const out = await c.classifyPage(mkPage());
    expect(out.status).toBe('disabled');
    expect(out.source).toBe('heuristic');
    expect(out.cached).toBe(false);
    expect(called).toBe(false);
    // Heuristic still classifies (logo suppressed, chart surfaced).
    const roles = new Map(out.result.assets.map((a) => [a.assetId, a.role]));
    expect(roles.get('logo-1')).toBe('logo');
    expect(roles.get('chart-1')).toBe('chart');
  });

  it('treats provider:"disabled" the same as enabled:false', async () => {
    const c = new HybridSemanticClassifier({
      config: { ...ENABLED, provider: 'disabled' },
      provider: undefined,
    });
    const out = await c.classifyPage(mkPage());
    expect(out.status).toBe('disabled');
  });
});

describe('HybridSemanticClassifier — AI success (merge)', () => {
  it('merges AI analyses onto the heuristic floor, tagging them hybrid', async () => {
    const aiOverrides = new Map<string, Partial<AssetSemanticAnalysis>>([
      // AI "upgrades" the chart's confidence; merge must keep role, clamp score, tag hybrid.
      ['chart-1', { confidence: 0.97 }],
    ]);
    const c = new HybridSemanticClassifier({
      config: ENABLED,
      provider: new MockIntelligenceProvider({ analyses: aiOverrides }),
    });
    const out = await c.classifyPage(mkPage());
    expect(out.status).toBe('ready');
    expect(out.source).toBe('hybrid');
    const chart = out.result.assets.find((a) => a.assetId === 'chart-1');
    expect(chart?.generatedBy).toBe('hybrid');
    expect(chart?.confidence).toBe(0.97);
  });

  it('fills AI-omitted assets from the heuristic floor (never a gap)', async () => {
    // AI only returns chart-1 (logo-1 omitted) → logo-1 keeps heuristic analysis.
    const c = new HybridSemanticClassifier({
      config: ENABLED,
      provider: new MockIntelligenceProvider({
        rawOutput: {
          assets: [
            {
              assetId: 'chart-1',
              role: 'chart',
              importance: 0.9,
              evidenceLikelihood: 0.9,
              confidence: 0.9,
              reason: 'r',
              generatedBy: 'ai',
            },
          ],
          links: [],
        },
      }),
    });
    const out = await c.classifyPage(mkPage());
    expect(out.result.assets).toHaveLength(2);
    const logo = out.result.assets.find((a) => a.assetId === 'logo-1');
    expect(logo?.generatedBy).toBe('heuristic'); // floor filled it
    const chart = out.result.assets.find((a) => a.assetId === 'chart-1');
    expect(chart?.generatedBy).toBe('hybrid');
  });

  it('clamps out-of-range AI scores to [0,1] during merge', async () => {
    // zod rejects NaN (verified), so NaN-in-AI-output triggers fallback
    // (covered by the zod-invalid test + clamp01's own unit test). Here we test
    // the MERGE clamp path with zod-valid finite out-of-range values + Infinity.
    const c = new HybridSemanticClassifier({
      config: ENABLED,
      provider: new MockIntelligenceProvider({
        rawOutput: {
          assets: [
            {
              assetId: 'chart-1',
              role: 'chart',
              importance: 5,
              evidenceLikelihood: -3,
              confidence: 2,
              reason: 'r',
              generatedBy: 'ai',
            },
            {
              assetId: 'logo-1',
              role: 'logo',
              importance: 0.1,
              evidenceLikelihood: 0.1,
              confidence: 0.1,
              reason: 'r',
              generatedBy: 'ai',
            },
          ],
          links: [],
        },
      }),
    });
    const out = await c.classifyPage(mkPage());
    expect(out.status).toBe('ready'); // parse succeeded; merge ran
    const chart = out.result.assets.find((a) => a.assetId === 'chart-1')!;
    expect(chart.importance).toBe(1); // 5 → 1 (high clamp)
    expect(chart.evidenceLikelihood).toBe(0); // -3 → 0 (low clamp)
    expect(chart.confidence).toBe(1); // 2 → 1 (high clamp)
    expect(chart.generatedBy).toBe('hybrid');
  });
});

describe('HybridSemanticClassifier — §14 fallback invariant (the safety gate)', () => {
  it('falls back to heuristic when the provider THROWS (network error)', async () => {
    const c = new HybridSemanticClassifier({
      config: ENABLED,
      provider: new MockIntelligenceProvider({ failWith: new TypeError('network failed') }),
    });
    const out = await c.classifyPage(mkPage());
    expect(out.status).toBe('fallback');
    expect(out.source).toBe('heuristic');
    expect(out.error).toContain('network failed');
    // Every scanner asset still has an analysis (floor guaranteed).
    expect(out.result.assets).toHaveLength(2);
    expect(out.result.assets.every((a) => a.generatedBy === 'heuristic')).toBe(true);
  });

  it('falls back when the provider returns zod-INVALID output (bad role enum)', async () => {
    const c = new HybridSemanticClassifier({
      config: ENABLED,
      provider: new MockIntelligenceProvider({
        rawOutput: {
          assets: [
            {
              assetId: 'chart-1',
              role: 'super-evidence',
              importance: 0.9,
              evidenceLikelihood: 0.9,
              confidence: 0.9,
              reason: 'r',
              generatedBy: 'ai',
            },
          ],
          links: [],
        },
      }),
    });
    const out = await c.classifyPage(mkPage());
    expect(out.status).toBe('fallback');
    expect(out.source).toBe('heuristic');
    // Heuristic floor's correct role survives; the AI garbage did not leak.
    const chart = out.result.assets.find((a) => a.assetId === 'chart-1');
    expect(chart?.role).toBe('chart');
  });

  it('falls back when the provider returns a non-object envelope', async () => {
    const c = new HybridSemanticClassifier({
      config: ENABLED,
      provider: new MockIntelligenceProvider({ rawOutput: 'not an object' }),
    });
    const out = await c.classifyPage(mkPage());
    expect(out.status).toBe('fallback');
  });

  it('falls back when AI scores contain NaN (zod rejects nan → fail-closed)', async () => {
    // Pins zod v3 "Expected number, received nan" so a future zod that starts
    // accepting NaN cannot silently let a NaN score reach the UI.
    const c = new HybridSemanticClassifier({
      config: ENABLED,
      provider: new MockIntelligenceProvider({
        rawOutput: {
          assets: [
            {
              assetId: 'chart-1',
              role: 'chart',
              importance: 0.9,
              evidenceLikelihood: 0.9,
              confidence: Number.NaN,
              reason: 'r',
              generatedBy: 'ai',
            },
          ],
          links: [],
        },
      }),
    });
    const out = await c.classifyPage(mkPage());
    expect(out.status).toBe('fallback');
    expect(out.result.assets.every((a) => a.generatedBy === 'heuristic')).toBe(true);
  });

  it('falls back on TIMEOUT (provider slower than timeoutMs)', async () => {
    const c = new HybridSemanticClassifier({
      config: { ...ENABLED, timeoutMs: 40 },
      provider: new MockIntelligenceProvider({ delayMs: 600 }),
    });
    const t0 = Date.now();
    const out = await c.classifyPage(mkPage());
    const elapsed = Date.now() - t0;
    expect(out.status).toBe('fallback');
    expect(out.error).toMatch(/timed out|timeout/i);
    // Felt the timeout, not the full delay.
    expect(elapsed).toBeLessThan(500);
  });
});

describe('HybridSemanticClassifier — SemanticCache', () => {
  it('returns a cached result on the second call without re-invoking the provider', async () => {
    let calls = 0;
    const provider = new MockIntelligenceProvider({});
    const wrapped: IntelligenceProvider = {
      async classifyPage(input) {
        calls++;
        return provider.classifyPage(input);
      },
    };
    const c = new HybridSemanticClassifier({
      config: ENABLED,
      provider: wrapped,
      cache: new SemanticCache(),
    });
    const first = await c.classifyPage(mkPage());
    expect(first.cached).toBe(false);
    const second = await c.classifyPage(mkPage());
    expect(second.cached).toBe(true);
    expect(second.status).toBe('ready');
    expect(calls).toBe(1); // provider called once, cache served the second
  });
});
