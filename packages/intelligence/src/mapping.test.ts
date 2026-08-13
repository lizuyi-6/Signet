import { describe, expect, it } from 'vitest';
import { classifyHeuristic } from './heuristics.js';
import { mapClaimsToAssetsHeuristic } from './mapping.js';
import { selectTopClaims } from './claims.js';
import type { AssetSemanticInput, ClaimEvidenceLink, PageClaim } from './types.js';

/** Minimal asset input factory for mapping tests. */
function asset(
  id: string,
  fields: Partial<AssetSemanticInput> & Pick<AssetSemanticInput, 'width' | 'height'>,
): AssetSemanticInput {
  return {
    assetId: id,
    pageUrl: 'https://example.com/',
    ...fields,
  };
}

/** A claim pre-built with a stable id (bypass selectTopClaims for mapping-only cases). */
function claim(id: string, text: string): PageClaim {
  return { id, text, type: 'factual', importance: 0.8 };
}

describe('mapClaimsToAssetsHeuristic — safety / fail-closed', () => {
  it('returns [] when claims is empty', () => {
    const a = classifyHeuristic(asset('a1', { width: 400, height: 300, altText: 'photo' }));
    expect(mapClaimsToAssetsHeuristic([], [a], [asset('a1', { width: 400, height: 300 })])).toEqual(
      [],
    );
  });

  it('returns [] when assets is empty', () => {
    expect(mapClaimsToAssetsHeuristic([claim('c1', 'a claim')], [], [])).toEqual([]);
  });

  it('NEVER emits "contradicts" (§19: heuristic cannot read the asset)', () => {
    const inp = asset('a1', {
      width: 400,
      height: 300,
      altText: 'inflation chart',
      nearbyText: 'inflation chart quarterly data',
    });
    const a = classifyHeuristic(inp);
    const links = mapClaimsToAssetsHeuristic(
      [claim('c1', 'quarterly inflation chart data')],
      [a],
      [inp],
    );
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.relation !== 'contradicts')).toBe(true);
    expect(links.every((l) => l.relation !== 'unrelated')).toBe(true); // never materialized
  });
});

describe('mapClaimsToAssetsHeuristic — relation semantics', () => {
  it('emits "illustrates" when an evidence-role asset caption overlaps the claim', () => {
    // A 400px-wide image in article context whose caption literally says "chart"
    // → classifyHeuristic detects `chart` (an evidence role).
    const inp = asset('a1', {
      width: 400,
      height: 300,
      parentText:
        'The quarterly inflation report shows prices rising across major categories ' +
        'including food and energy costs during the surveyed period.',
      nearbyText: 'inflation chart',
      altText: 'inflation chart',
    });
    const a = classifyHeuristic(inp); // → chart (caption contains "chart")
    expect(a.role).toBe('chart'); // chart IS an evidence role
    const links = mapClaimsToAssetsHeuristic(
      [claim('c1', 'quarterly inflation report prices rising')],
      [a],
      [inp],
    );
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]?.relation).toBe('illustrates');
    expect(links[0]?.claimId).toBe('c1');
    expect(links[0]?.assetId).toBe('a1');
  });

  it('emits "supports" when a non-evidence asset has high text overlap', () => {
    // A small image → icon (non-evidence). But give it strong parent overlap.
    const inp = asset('a1', {
      width: 30,
      height: 30,
      parentText:
        'Renewable capacity doubled after the renewable subsidy program expanded ' +
        'across several regional markets with renewable investment rising.',
      altText: 'renewable',
    });
    const a = classifyHeuristic(inp); // → icon (non-evidence)
    expect(EVIDENCE_NON_EVIDENCE(a.role)).toBe(false);
    const links = mapClaimsToAssetsHeuristic(
      [claim('c1', 'renewable capacity doubled after subsidy program expanded')],
      [a],
      [inp],
    );
    // coverage should clear COVERAGE_SUPPORT (0.55) for a non-evidence asset.
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]?.relation).toBe('supports');
  });

  it('emits NO link when text overlap is below the coverage floor', () => {
    const inp = asset('a1', {
      width: 400,
      height: 300,
      parentText: 'A completely unrelated body of text about cooking recipes and pasta dishes.',
      altText: 'pasta',
    });
    const a = classifyHeuristic(inp);
    const links = mapClaimsToAssetsHeuristic(
      [claim('c1', 'quarterly inflation macroeconomic report indicators')],
      [a],
      [inp],
    );
    expect(links).toEqual([]);
  });

  it('caps links at MAX_LINKS_PER_ASSET per asset', () => {
    // One asset, many claims all overlapping its big text blob.
    const inp = asset('a1', {
      width: 500,
      height: 400,
      parentText:
        'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu ' +
        'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu',
      altText: 'alpha beta gamma delta epsilon zeta',
    });
    const a = classifyHeuristic(inp);
    const claims: PageClaim[] = Array.from({ length: 8 }, (_, i) =>
      claim(`c${i}`, 'alpha beta gamma delta epsilon zeta eta theta'),
    );
    const links = mapClaimsToAssetsHeuristic(claims, [a], [inp]);
    // MAX_LINKS_PER_ASSET = 3 — at most 3 of the 8 overlapping claims per asset.
    expect(links.length).toBeLessThanOrEqual(3);
    expect(links.length).toBeGreaterThan(0);
  });
});

describe('mapClaimsToAssetsHeuristic — confidence', () => {
  it('produces confidence values inside [0, 1]', () => {
    const inp = asset('a1', {
      width: 400,
      height: 300,
      altText: 'inflation quarterly chart data report',
      nearbyText: 'inflation quarterly chart data report',
    });
    const a = classifyHeuristic(inp);
    const links = mapClaimsToAssetsHeuristic(
      [claim('c1', 'inflation quarterly chart data report')],
      [a],
      [inp],
    );
    expect(links.length).toBe(1);
    const conf = links[0]!.confidence;
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
    // ~100% coverage on an evidence asset → 0.95 ceiling after the evidence scale.
    expect(conf).toBeGreaterThan(0.5);
  });
});

describe('mapClaimsToAssetsHeuristic — integration with selectTopClaims', () => {
  it('maps selector output onto classified assets end-to-end (heuristic-only path)', () => {
    const inp = asset('a1', {
      width: 440,
      height: 330,
      altText: 'inflation chart',
      nearbyText: 'inflation chart quarterly',
      parentText:
        'Consumer inflation eased during the quarter as energy prices fell, ' +
        'according to the latest inflation report on consumer prices.',
    });
    const a = classifyHeuristic(inp);
    const claims = selectTopClaims([
      { text: 'Consumer inflation eased during the quarter', sourceElement: 'h1' },
    ]);
    expect(claims.length).toBe(1);
    const links: ClaimEvidenceLink[] = mapClaimsToAssetsHeuristic(claims, [a], [inp]);
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]?.relation === 'illustrates' || links[0]?.relation === 'supports').toBe(true);
  });
});

/** Test-local helper: is this role an evidence role? (mirrors mapping.ts EVIDENCE_ROLES) */
function EVIDENCE_NON_EVIDENCE(role: string): boolean {
  const evidence = new Set([
    'primary-evidence',
    'supporting-evidence',
    'news-photo',
    'article-evidence',
    'data-visualization',
    'chart',
    'screenshot',
  ]);
  return evidence.has(role as never);
}
