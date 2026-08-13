/**
 * @signet/intelligence — §16/§17/§54 regression: the Trust Visibility Invariant.
 *
 * "No semantic or AI-derived signal may suppress a cryptographically detected
 * provenance failure." These tests pin that `decideFinalDisplay` makes a
 * `broken` verdict ALWAYS show at `critical` priority — no matter how the
 * semantic layer classifies the asset (decoration, logo, low-importance) or
 * when that classification arrives (before or after verification).
 *
 * These are the load-bearing companions to trust-engine's ai-powerlessness.test.ts:
 * that suite proves AI cannot CHANGE the verdict; this suite proves AI cannot
 * HIDE a broken verdict. Together they are the two halves of §51 + §17.
 */
import { describe, expect, it } from 'vitest';

import { TRUST_VISIBILITY_INVARIANT, decideFinalDisplay, type BadgeDecision } from './index.js';

/** A semantic decision that suppresses (logo/decoration/low-importance). */
function suppressed(reason = 'decoration: empty alt text'): BadgeDecision {
  return { show: false, priority: 'suppressed', reason };
}

function shown(
  priority: 'high' | 'normal' = 'normal',
  reason = 'chart: data figure',
): BadgeDecision {
  return { show: true, priority, reason };
}

describe('Trust Visibility Invariant — broken can never be suppressed', () => {
  it('AI classifies asset as decoration + trust broken → show critical', () => {
    const d = decideFinalDisplay({ state: 'broken' }, suppressed('decoration: AI role'));
    expect(d.show).toBe(true);
    expect(d.priority).toBe('critical');
    expect(d.reason).toMatch(/provenance failure overrides/i);
  });

  it('AI classifies asset as logo + trust broken → show critical', () => {
    const d = decideFinalDisplay({ state: 'broken' }, suppressed('logo: brand mark'));
    expect(d.show).toBe(true);
    expect(d.priority).toBe('critical');
  });

  it('heuristic suppresses asset (low importance) + trust broken → show critical', () => {
    const d = decideFinalDisplay({ state: 'broken' }, suppressed('unknown below importance 0.3'));
    expect(d.show).toBe(true);
    expect(d.priority).toBe('critical');
  });

  it('AI role changes AFTER verification (broken then re-classified as suppressed) → still show', () => {
    // First pass: broken was verified while the role read as 'news-photo'.
    const before = decideFinalDisplay({ state: 'broken' }, shown('high', 'news-photo'));
    expect(before.show).toBe(true);
    // Second pass: the same broken verdict, but AI now says 'logo' (suppress).
    const after = decideFinalDisplay({ state: 'broken' }, suppressed('logo: AI refinement'));
    expect(after.show).toBe(true);
    expect(after.priority).toBe('critical');
  });

  it('broken overrides even a priority-suppressed decision from a hostile/misleading signal', () => {
    const d = decideFinalDisplay(
      { state: 'broken' },
      { show: false, priority: 'suppressed', reason: 'advertisement: paid placement' },
    );
    expect(d.show).toBe(true);
    expect(d.priority).toBe('critical');
  });
});

describe('decideFinalDisplay — non-broken states defer to semantics', () => {
  it('logo + verified → suppressed (semantic wins when nothing is broken)', () => {
    expect(decideFinalDisplay({ state: 'verified' }, suppressed('logo')).show).toBe(false);
  });

  it('decoration + unknown → suppressed', () => {
    expect(decideFinalDisplay({ state: 'unknown' }, suppressed('decoration')).show).toBe(false);
  });

  it('primary-evidence + unknown → show', () => {
    const d = decideFinalDisplay({ state: 'unknown' }, shown('high', 'primary-evidence'));
    expect(d.show).toBe(true);
    expect(d.priority).toBe('high');
  });

  it('chart + verified → show high', () => {
    const d = decideFinalDisplay({ state: 'verified' }, shown('high', 'chart'));
    expect(d.show).toBe(true);
    expect(d.priority).toBe('high');
  });

  it('news-photo + verified-ai → show high (AI-generated is not suppressed)', () => {
    const d = decideFinalDisplay({ state: 'verified-ai' }, shown('high', 'news-photo'));
    expect(d.show).toBe(true);
    expect(d.priority).toBe('high');
  });

  it('no trust yet (undefined) + suppressed → suppressed (no broken signal to override)', () => {
    expect(decideFinalDisplay(undefined, suppressed('logo')).show).toBe(false);
  });

  it('no trust yet (undefined) + shown → show', () => {
    expect(decideFinalDisplay(undefined, shown('normal')).show).toBe(true);
  });
});

describe('TRUST_VISIBILITY_INVARIANT', () => {
  it('is the canonical, greppable wording of the invariant', () => {
    expect(TRUST_VISIBILITY_INVARIANT).toContain('provenance failure');
    expect(TRUST_VISIBILITY_INVARIANT).toMatch(/suppress/i);
  });
});

describe('decideFinalDisplay — accepts the content-script VerifyResult shape', () => {
  it('reads only `state` from a richer verify result', () => {
    // VerifyResult carries state + reason + items; decideFinalDisplay must only
    // depend on `state` (structural TrustView).
    const verifyResult = {
      kind: 'verify-result',
      assetId: 'a1',
      state: 'broken' as const,
      reason: 'integrity-mismatch',
      failClosed: false,
      items: [],
    };
    const d = decideFinalDisplay(verifyResult, suppressed('logo'));
    expect(d.show).toBe(true);
    expect(d.priority).toBe('critical');
  });

  it('keeps a broken verdict visible regardless of which reason produced it', () => {
    // decideFinalDisplay reads only `state`, so both broken reasons behave the
    // same — pin that the invariant does not depend on reason/items.
    expect(decideFinalDisplay({ state: 'broken' }, suppressed()).show).toBe(true);
    expect(decideFinalDisplay({ state: 'broken' }, shown('high')).show).toBe(true);
  });
});
