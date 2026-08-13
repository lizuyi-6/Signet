import { describe, expect, it } from 'vitest';

import type { AssetSemanticInput } from './index.js';
import { classifyHeuristic } from './index.js';

/** Minimal valid input; tests override only the fields that matter. */
function mkInput(over: Partial<AssetSemanticInput> = {}): AssetSemanticInput {
  return {
    assetId: 'a1',
    width: 800,
    height: 600,
    pageUrl: 'https://example.com/article',
    ...over,
  };
}

describe('classifyHeuristic — noise suppression (§48)', () => {
  it('classifies a "logo" as logo (suppressed, not evidence)', () => {
    const a = classifyHeuristic(mkInput({ altText: 'Acme company logo' }));
    expect(a.role).toBe('logo');
    expect(a.importance).toBeLessThan(0.2);
    expect(a.generatedBy).toBe('heuristic');
  });

  it('classifies an "avatar" as avatar (suppressed)', () => {
    const a = classifyHeuristic(
      mkInput({ altText: 'Jane Doe profile picture', width: 64, height: 64 }),
    );
    expect(a.role).toBe('avatar');
    expect(a.importance).toBeLessThan(0.2);
  });

  it('classifies a <48px image as icon (suppressed) — matches legacy scan.ts cutoff', () => {
    const a = classifyHeuristic(mkInput({ width: 32, height: 32 }));
    expect(a.role).toBe('icon');
    expect(a.importance).toBeLessThan(0.2);
  });

  it('classifies a sponsored block as advertisement (suppressed)', () => {
    const a = classifyHeuristic(mkInput({ nearbyText: 'Sponsored content — paid promotion' }));
    expect(a.role).toBe('advertisement');
    expect(a.importance).toBeLessThan(0.1);
  });

  it('classifies empty alt="" as decoration (HTML-spec decorative signal)', () => {
    const a = classifyHeuristic(mkInput({ altText: '' }));
    expect(a.role).toBe('decoration');
    expect(a.importance).toBeLessThan(0.1);
  });
});

describe('classifyHeuristic — evidence detection (§48)', () => {
  it('flags a large chart as chart (high priority)', () => {
    const a = classifyHeuristic(
      mkInput({
        altText: 'Q3 revenue bar chart',
        nearbyText: 'The chart shows Q3 revenue growth.',
        parentText: 'In this section we analyze quarterly performance.'.repeat(3),
      }),
    );
    expect(a.role).toBe('chart');
    expect(a.importance).toBeGreaterThan(0.8);
    expect(a.evidenceLikelihood).toBeGreaterThan(0.8);
  });

  it('flags data-visualization when that phrasing appears', () => {
    const a = classifyHeuristic(
      mkInput({ nearbyText: 'Interactive data visualization of the results' }),
    );
    expect(a.role).toBe('data-visualization');
  });

  it('classifies a large article figure as primary-evidence', () => {
    const a = classifyHeuristic(
      mkInput({
        width: 1280,
        height: 720,
        headingContext: ['Investigation', 'Key findings'],
        parentText:
          'The figure below documents the scene described in the preceding paragraph.'.repeat(2),
      }),
    );
    expect(a.role).toBe('primary-evidence');
    expect(a.importance).toBeGreaterThan(0.8);
  });

  it('promotes a large article photo with press attribution to news-photo', () => {
    const a = classifyHeuristic(
      mkInput({
        altText: 'Scene of the event',
        width: 1200,
        height: 800,
        nearbyText: 'Reuters press photo',
        parentText: 'Reportage from the field. '.repeat(10),
      }),
    );
    expect(a.role).toBe('news-photo');
  });

  it('classifies a figure with caption + body text as supporting-evidence', () => {
    const a = classifyHeuristic(
      mkInput({
        width: 200,
        nearbyText: 'Figure 2: secondary metric.',
        parentText: 'Body paragraph with enough length to count as article context. '.repeat(3),
      }),
    );
    expect(a.role).toBe('supporting-evidence');
  });
});

describe('classifyHeuristic — other content roles', () => {
  it('classifies a product link as product-image', () => {
    const a = classifyHeuristic(mkInput({ linkTarget: 'https://shop.example.com/product/123' }));
    expect(a.role).toBe('product-image');
  });

  it('classifies a screenshot alt as screenshot', () => {
    const a = classifyHeuristic(mkInput({ altText: 'screenshot of the dashboard' }));
    expect(a.role).toBe('screenshot');
  });

  it('classifies illustration/diagram as illustration', () => {
    const a = classifyHeuristic(mkInput({ altText: 'diagram of the pipeline' }));
    expect(a.role).toBe('illustration');
  });
});

describe('classifyHeuristic — fail-closed unknown', () => {
  it('returns unknown for an unannotated, small-ish image (no guess)', () => {
    const a = classifyHeuristic(mkInput({ width: 200, height: 150 }));
    expect(a.role).toBe('unknown');
    expect(a.generatedBy).toBe('heuristic');
    // Unknown ≠ untrustworthy: advisory confidence is low but non-zero.
    expect(a.confidence).toBeGreaterThan(0);
    expect(a.confidence).toBeLessThan(0.5);
  });

  it('never produces an out-of-range score', () => {
    const inputs: AssetSemanticInput[] = [
      mkInput({ width: 0, height: 0 }),
      mkInput({ width: 10, height: 10 }),
      mkInput({ width: 4000, height: 4000, altText: 'chart' }),
      mkInput({ altText: 'avatar of user', width: 96, height: 96 }),
    ];
    for (const i of inputs) {
      const a = classifyHeuristic(i);
      for (const v of [a.importance, a.evidenceLikelihood, a.confidence]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
