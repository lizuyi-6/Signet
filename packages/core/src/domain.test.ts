import { describe, expect, it } from 'vitest';

import { BADGE_SUPPRESSED_ROLES, isBadgeSuppressed } from './domain.js';

describe('isBadgeSuppressed', () => {
  it('suppresses icons, avatars, and decoration', () => {
    expect(isBadgeSuppressed({ semanticRole: 'icon' })).toBe(true);
    expect(isBadgeSuppressed({ semanticRole: 'avatar' })).toBe(true);
    expect(isBadgeSuppressed({ semanticRole: 'decoration' })).toBe(true);
  });

  it('does not suppress meaningful imagery', () => {
    expect(isBadgeSuppressed({ semanticRole: 'hero-image' })).toBe(false);
    expect(isBadgeSuppressed({ semanticRole: 'article-evidence' })).toBe(false);
    expect(isBadgeSuppressed({ semanticRole: 'chart' })).toBe(false);
  });

  it('does not suppress when role is absent (treated as unknown, not decorative)', () => {
    expect(isBadgeSuppressed({})).toBe(false);
  });

  it('BADGE_SUPPRESSED_ROLES matches the documented set', () => {
    expect(BADGE_SUPPRESSED_ROLES).toEqual(new Set(['icon', 'avatar', 'decoration']));
  });
});
