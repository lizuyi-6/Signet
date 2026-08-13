import { describe, expect, it } from 'vitest';
import { classifyClaimType, selectTopClaims, type ClaimCandidate } from './claims.js';

describe('classifyClaimType', () => {
  it('classifies a future-tense numeric statement as forecast (precedence over numeric)', () => {
    // FORECAST_RE matches "will"; NUMERIC_RE also matches "12%". Forecast wins.
    expect(classifyClaimType('Revenue will rise 12% next year')).toBe('forecast');
  });

  it('classifies a comparison as comparative (precedence over numeric)', () => {
    expect(classifyClaimType('Sales were higher than last quarter')).toBe('comparative');
  });

  it('classifies a bare number/percent statement as numeric', () => {
    expect(classifyClaimType('Unemployment stands at 5.2%')).toBe('numeric');
  });

  it('classifies a short verb-less fragment as descriptive', () => {
    expect(classifyClaimType('Quarterly inflation chart')).toBe('descriptive');
  });

  it('classifies a declarative sentence as factual', () => {
    // > 50 chars and no forecast/comparative/numeric signal → factual
    // (the descriptive branch only catches SHORT verb-less fragments).
    expect(
      classifyClaimType(
        'The central bank held its benchmark rate steady at the conclusion of the meeting',
      ),
    ).toBe('factual');
  });
});

describe('selectTopClaims', () => {
  it('returns [] for empty input (fail-closed)', () => {
    expect(selectTopClaims([])).toEqual([]);
  });

  it('drops candidates shorter than minLength and returns the rest', () => {
    const out = selectTopClaims([
      { text: 'hi', sourceElement: 'h1' }, // too short (2 < 6)
      { text: 'Inflation eased in July', sourceElement: 'h2' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe('Inflation eased in July');
  });

  it('scores by source tag: h1 outranks p, so h1 sorts first', () => {
    const out = selectTopClaims([
      { text: 'Some body sentence here', sourceElement: 'p' },
      { text: 'The headline claim', sourceElement: 'h1' },
      { text: 'A subhead claim', sourceElement: 'h2' },
    ]);
    expect(out.map((c) => c.sourceElement)).toEqual(['h1', 'h2', 'p']);
    // importance is monotonic in tag strength here.
    expect(out[0]!.importance).toBeGreaterThan(out[1]!.importance);
    expect(out[1]!.importance).toBeGreaterThan(out[2]!.importance);
  });

  it('de-duplicates case-insensitively, keeping the stronger source', () => {
    const out = selectTopClaims([
      { text: 'Same Claim', sourceElement: 'p' }, // importance 0.45
      { text: 'same claim', sourceElement: 'h1' }, // dup, importance 0.95 → wins
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.sourceElement).toBe('h1');
    expect(out[0]?.text).toBe('Same Claim'); // first normalized form kept
  });

  it('caps at max (Top-N)', () => {
    const cands: ClaimCandidate[] = Array.from({ length: 12 }, (_, i) => ({
      text: `Distinct claim number ${i}`,
      sourceElement: 'p',
    }));
    expect(selectTopClaims(cands, { max: 5 })).toHaveLength(5);
    expect(selectTopClaims(cands)).toHaveLength(8); // default max = 8
  });

  it('assigns a stable id derived from normalized text (same text → same id)', () => {
    const a = selectTopClaims([{ text: 'Stable claim', sourceElement: 'h1' }]);
    const b = selectTopClaims([{ text: '  stable   CLAIM  ', sourceElement: 'h2' }]);
    expect(a[0]?.id).toBe(b[0]?.id);
    expect(a[0]?.id).toMatch(/^clm_[0-9a-f]{8}$/);
  });

  it('truncates overlong text on a word boundary with an ellipsis', () => {
    const long = `Inflation ${'across '.repeat(60)}nations`.replace(/\s+/g, ' ').trim();
    const out = selectTopClaims([{ text: long, sourceElement: 'h1' }], { maxLength: 40 });
    expect(out).toHaveLength(1);
    expect(out[0]!.text.length).toBeLessThanOrEqual(41); // 40 + ellipsis
    expect(out[0]!.text.endsWith('…')).toBe(true);
  });

  it('collapses internal whitespace during normalization', () => {
    const out = selectTopClaims([{ text: '  Revenue\n\ngrew   3%   ', sourceElement: 'h1' }]);
    expect(out[0]?.text).toBe('Revenue grew 3%');
  });
});
