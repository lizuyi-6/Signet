import { describe, expect, it } from 'vitest';

import { SemanticCache, cacheKeyFor } from './index.js';
import type { ClaimEvidenceResult, PageSemanticInput } from './index.js';

function mkPage(over: Partial<PageSemanticInput> = {}): PageSemanticInput {
  return {
    pageUrl: 'https://example.com/a',
    headings: ['H'],
    claims: [{ id: 'c1', text: 'claim', type: 'numeric', importance: 0.5 }],
    privacyMode: 'context-only',
    assets: [
      {
        assetId: 'a1',
        width: 800,
        height: 600,
        altText: 'chart',
        pageUrl: 'https://example.com/a',
      },
    ],
    ...over,
  };
}

const VALUE: ClaimEvidenceResult = {
  assets: [
    {
      assetId: 'a1',
      role: 'chart',
      importance: 0.9,
      evidenceLikelihood: 0.9,
      confidence: 0.9,
      reason: 'r',
      generatedBy: 'heuristic',
    },
  ],
  links: [],
};

describe('cacheKeyFor', () => {
  it('is stable for identical inputs', () => {
    expect(cacheKeyFor(mkPage())).toBe(cacheKeyFor(mkPage()));
  });

  it('changes when the surrounding text changes (text is the classifier signal)', () => {
    const a = mkPage();
    const b = mkPage({
      assets: [
        {
          assetId: 'a1',
          width: 800,
          height: 600,
          altText: 'DIFFERENT',
          pageUrl: 'https://example.com/a',
        },
      ],
    });
    expect(cacheKeyFor(a)).not.toBe(cacheKeyFor(b));
  });

  it('changes when pageUrl changes', () => {
    expect(cacheKeyFor(mkPage({ pageUrl: 'https://example.com/x' }))).not.toBe(
      cacheKeyFor(mkPage({ pageUrl: 'https://example.com/y' })),
    );
  });
});

describe('SemanticCache — get/set + TTL', () => {
  it('round-trips a value', () => {
    const cache = new SemanticCache({ ttlMs: 1000 });
    cache.setFor(mkPage(), VALUE);
    const hit = cache.getFor(mkPage());
    expect(hit?.assets[0]?.assetId).toBe('a1');
  });

  it('expires after the TTL (injectable clock)', () => {
    let t = 1000;
    const cache = new SemanticCache({ ttlMs: 100, now: () => t });
    cache.setFor(mkPage(), VALUE);
    expect(cache.getFor(mkPage())).toBeDefined();
    t += 101; // advance past TTL
    expect(cache.getFor(mkPage())).toBeUndefined();
  });

  it('does not return stale entries via size()', () => {
    let t = 0;
    const cache = new SemanticCache({ ttlMs: 50, now: () => t });
    cache.setFor(mkPage(), VALUE);
    expect(cache.size).toBe(1);
    t += 51;
    expect(cache.size).toBe(0);
  });
});

describe('SemanticCache — LRU eviction', () => {
  it('evicts the oldest entry once maxEntries is reached', () => {
    const t = 0;
    const cache = new SemanticCache({ ttlMs: 10_000, maxEntries: 2, now: () => t });
    const pageA = mkPage({ pageUrl: 'https://example.com/a' });
    const pageB = mkPage({ pageUrl: 'https://example.com/b' });
    const pageC = mkPage({ pageUrl: 'https://example.com/c' });
    cache.setFor(pageA, VALUE);
    cache.setFor(pageB, VALUE);
    expect(cache.size).toBe(2);
    cache.setFor(pageC, VALUE); // evicts pageA (oldest)
    expect(cache.size).toBe(2);
    expect(cache.getFor(pageA)).toBeUndefined();
    expect(cache.getFor(pageB)).toBeDefined();
    expect(cache.getFor(pageC)).toBeDefined();
  });
});
