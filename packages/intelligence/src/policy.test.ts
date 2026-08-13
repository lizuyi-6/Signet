import { describe, expect, it } from 'vitest';

import type { ContentAsset } from '@signet/core';

import { DefaultBadgePolicy, badgePolicy, type AssetSemanticAnalysis } from './index.js';

/** Minimal ContentAsset fixture; tests set semanticRole. */
function mkAsset(role: ContentAsset['semanticRole']): ContentAsset {
  return {
    id: 'asset-1',
    elementType: 'image',
    sourceType: 'network',
    boundingBox: { x: 0, y: 0, width: 800, height: 600 },
    semanticRole: role,
  };
}

function mkAnalysis(over: Partial<AssetSemanticAnalysis>): AssetSemanticAnalysis {
  return {
    assetId: 'a1',
    role: 'unknown',
    importance: 0.5,
    evidenceLikelihood: 0.5,
    confidence: 0.5,
    reason: 'test reason',
    generatedBy: 'heuristic',
    ...over,
  };
}

describe('DefaultBadgePolicy — intelligence ON (analysis present)', () => {
  const p = new DefaultBadgePolicy();

  it('suppresses logo (the new role core alone does not suppress)', () => {
    expect(p.shouldShow(mkAsset(undefined), mkAnalysis({ role: 'logo' })).show).toBe(false);
  });

  it('suppresses advertisement, icon, avatar, decoration', () => {
    for (const role of ['advertisement', 'icon', 'avatar', 'decoration'] as const) {
      expect(p.shouldShow(mkAsset(undefined), mkAnalysis({ role })).show).toBe(false);
    }
  });

  it('flags charts / data-viz / news-photo / primary-evidence at high priority', () => {
    for (const role of ['chart', 'data-visualization', 'news-photo', 'primary-evidence'] as const) {
      const d = p.shouldShow(mkAsset(undefined), mkAnalysis({ role }));
      expect(d.show).toBe(true);
      expect(d.priority).toBe('high');
    }
  });

  it('shows supporting-evidence at normal priority', () => {
    const d = p.shouldShow(mkAsset(undefined), mkAnalysis({ role: 'supporting-evidence' }));
    expect(d.show).toBe(true);
    expect(d.priority).toBe('normal');
  });

  it('shows an unknown with importance >= 0.3 (preserves legacy "unknown badges")', () => {
    const d = p.shouldShow(mkAsset(undefined), mkAnalysis({ role: 'unknown', importance: 0.35 }));
    expect(d.show).toBe(true);
    expect(d.priority).toBe('normal');
  });

  it('suppresses an unknown whose importance falls below the floor', () => {
    const d = p.shouldShow(mkAsset(undefined), mkAnalysis({ role: 'unknown', importance: 0.2 }));
    expect(d.show).toBe(false);
    expect(d.priority).toBe('suppressed');
  });
});

describe('DefaultBadgePolicy — intelligence OFF (no analysis) preserves legacy behavior', () => {
  const p = new DefaultBadgePolicy();

  it('suppresses icon/avatar/decoration via core BADGE_SUPPRESSED_ROLES', () => {
    expect(p.shouldShow(mkAsset('icon')).show).toBe(false);
    expect(p.shouldShow(mkAsset('avatar')).show).toBe(false);
    expect(p.shouldShow(mkAsset('decoration')).show).toBe(false);
  });

  it('shows article-evidence (legacy fixture) at normal priority', () => {
    const d = p.shouldShow(mkAsset('article-evidence'));
    expect(d.show).toBe(true);
    expect(d.priority).toBe('normal');
  });

  it('shows a role-less asset as normal (legacy "unknown → badge")', () => {
    const d = p.shouldShow(mkAsset(undefined));
    expect(d.show).toBe(true);
    expect(d.priority).toBe('normal');
  });
});

describe('exported badgePolicy singleton', () => {
  it('behaves identically to a fresh instance', () => {
    const a = mkAnalysis({ role: 'chart' });
    expect(badgePolicy.shouldShow(mkAsset(undefined), a)).toEqual(
      new DefaultBadgePolicy().shouldShow(mkAsset(undefined), a),
    );
  });
});
