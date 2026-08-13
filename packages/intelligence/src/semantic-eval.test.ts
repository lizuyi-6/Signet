/**
 * @signet/intelligence — semantic eval set (Phase I; spec §65 breadth gate).
 *
 * A BROAD, table-driven regression net over the deterministic semantic layer —
 * NOT the load-bearing invariant tests (those are the per-module suites +
 * ai-powerlessness.test.ts). This file's job is breadth: many realistic
 * DOM-shaped cases exercising every heuristic-reachable role, every claim type,
 * and the claim↔asset mapping, so a small edit to a detector cannot silently
 * break an unanticipated real-world input.
 *
 * Structure: three case tables (role / claim / mapping) + one meta-assertion
 * that the set stays ≥ 50 cases, so shrinking this file fails the gate (rule
 * 4.1: the total count is part of the contract).
 */
import { describe, expect, it } from 'vitest';

import type { SemanticRole } from '@signet/core';

import { classifyClaimType, classifyHeuristic, mapClaimsToAssetsHeuristic } from './index.js';
import type { AssetSemanticInput, PageClaim } from './index.js';

/** Minimal asset factory for the eval table. */
function A(
  id: string,
  fields: Partial<AssetSemanticInput> & Pick<AssetSemanticInput, 'width' | 'height'>,
): AssetSemanticInput {
  return { assetId: id, pageUrl: 'https://example.com/', ...fields };
}

/** Long parent text so a large image reads as article-embedded (evidence). */
const ARTICLE_PARENT =
  'This is the body of a long-form article discussing the central findings of ' +
  'the investigation, the methodology, and the implications for the wider ' +
  'industry over the coming quarters and years, presented in detail.';

// ---------------------------------------------------------------------------
// Role classification — every heuristic-reachable role + precedence + fallback
// ---------------------------------------------------------------------------

interface RoleCase {
  readonly id: string;
  readonly input: AssetSemanticInput;
  readonly role: SemanticRole;
}

const ROLE_CASES: readonly RoleCase[] = [
  // decoration — empty alt (HTML-spec decorative signal) + elementRole
  { id: 'empty-alt', input: A('r1', { width: 100, height: 100, altText: '' }), role: 'decoration' },
  {
    id: 'decoration-role',
    input: A('r2', { width: 100, height: 100, elementRole: 'decoration' }),
    role: 'decoration',
  },
  // advertisement
  {
    id: 'ad-role',
    input: A('r3', { width: 300, height: 250, elementRole: 'advertisement' }),
    role: 'advertisement',
  },
  {
    id: 'sponsored',
    input: A('r4', { width: 300, height: 250, nearbyText: 'sponsored content' }),
    role: 'advertisement',
  },
  {
    id: 'promo',
    input: A('r5', { width: 300, height: 250, altText: 'promo banner' }),
    role: 'advertisement',
  },
  // avatar
  {
    id: 'avatar-role',
    input: A('r6', { width: 50, height: 50, elementRole: 'avatar' }),
    role: 'avatar',
  },
  {
    id: 'user-photo',
    input: A('r7', { width: 50, height: 50, altText: 'user photo' }),
    role: 'avatar',
  },
  {
    id: 'profile-pic',
    input: A('r8', { width: 50, height: 50, nearbyText: 'profile picture' }),
    role: 'avatar',
  },
  // logo
  {
    id: 'logo-role',
    input: A('r9', { width: 100, height: 40, elementRole: 'logo' }),
    role: 'logo',
  },
  {
    id: 'company-logo',
    input: A('r10', { width: 100, height: 40, altText: 'company logo' }),
    role: 'logo',
  },
  {
    id: 'brand-mark',
    input: A('r11', { width: 100, height: 40, nearbyText: 'brand mark' }),
    role: 'logo',
  },
  // icon — by size
  { id: 'icon-24', input: A('r12', { width: 24, height: 24, altText: 'action' }), role: 'icon' },
  { id: 'icon-47', input: A('r13', { width: 47, height: 60, altText: 'glyph' }), role: 'icon' },
  // size boundary: 48px is NOT icon (no other signal → unknown)
  { id: 'not-icon-48', input: A('r14', { width: 48, height: 48 }), role: 'unknown' },
  // chart / data-visualization
  {
    id: 'bar-chart',
    input: A('r15', { width: 600, height: 400, altText: 'bar chart' }),
    role: 'chart',
  },
  {
    id: 'data-viz',
    input: A('r16', { width: 600, height: 400, nearbyText: 'data visualization' }),
    role: 'data-visualization',
  },
  {
    id: 'data-chart',
    input: A('r17', { width: 600, height: 400, altText: 'data chart' }),
    role: 'data-visualization',
  },
  {
    id: 'line-graph',
    input: A('r18', { width: 600, height: 400, altText: 'line graph of revenue' }),
    role: 'chart',
  },
  {
    id: 'plot',
    input: A('r19', { width: 600, height: 400, nearbyText: 'scatter plot' }),
    role: 'chart',
  },
  // screenshot
  {
    id: 'screenshot',
    input: A('r20', { width: 800, height: 600, altText: 'screenshot of dashboard' }),
    role: 'screenshot',
  },
  // illustration
  {
    id: 'illustration',
    input: A('r21', { width: 500, height: 300, altText: 'illustration of the concept' }),
    role: 'illustration',
  },
  {
    id: 'diagram',
    input: A('r22', { width: 500, height: 300, nearbyText: 'diagram of the flow' }),
    role: 'illustration',
  },
  {
    id: 'drawing',
    input: A('r23', { width: 500, height: 300, altText: 'a drawing' }),
    role: 'illustration',
  },
  // product
  {
    id: 'product-keyword',
    input: A('r24', { width: 400, height: 400, altText: 'product photo' }),
    role: 'product-image',
  },
  {
    id: 'buy-now',
    input: A('r25', { width: 400, height: 400, nearbyText: 'buy now' }),
    role: 'product-image',
  },
  {
    id: 'price',
    input: A('r26', { width: 400, height: 400, nearbyText: 'price and shipping' }),
    role: 'product-image',
  },
  {
    id: 'product-link',
    input: A('r27', { width: 400, height: 400, linkTarget: 'https://example.com/shop/item/1' }),
    role: 'product-image',
  },
  // evidence: news-photo / primary / supporting
  {
    id: 'news-photo',
    input: A('r28', {
      width: 800,
      height: 600,
      parentText: ARTICLE_PARENT,
      altText: 'reuters photo of the scene',
    }),
    role: 'news-photo',
  },
  {
    id: 'primary-evidence',
    input: A('r29', { width: 800, height: 600, parentText: ARTICLE_PARENT, altText: 'the scene' }),
    role: 'primary-evidence',
  },
  {
    id: 'supporting-evidence',
    input: A('r30', { width: 200, height: 150, parentText: ARTICLE_PARENT, nearbyText: 'context' }),
    role: 'supporting-evidence',
  },
  // precedence: noise detectors win over content detectors
  {
    id: 'tiny-logo-not-icon',
    input: A('r31', { width: 20, height: 20, altText: 'logo' }),
    role: 'logo',
  },
  {
    id: 'tiny-avatar-not-icon',
    input: A('r32', { width: 20, height: 20, altText: 'avatar' }),
    role: 'avatar',
  },
  {
    id: 'ad-beats-chart',
    input: A('r33', { width: 400, height: 300, nearbyText: 'sponsored chart' }),
    role: 'advertisement',
  },
  {
    id: 'logo-beats-chart',
    input: A('r34', { width: 400, height: 100, altText: 'logo chart' }),
    role: 'logo',
  },
  {
    id: 'icon-beats-chart',
    input: A('r35', { width: 30, height: 30, altText: 'chart' }),
    role: 'icon',
  },
  {
    id: 'screenshot-beats-diagram',
    input: A('r36', { width: 600, height: 400, altText: 'diagram screenshot' }),
    role: 'screenshot',
  },
  // fail-closed: no strong signal → unknown; photo keyword outside article → unknown
  { id: 'unknown-empty', input: A('r37', { width: 300, height: 300 }), role: 'unknown' },
  {
    id: 'photo-outside-article',
    input: A('r38', { width: 200, height: 150, altText: 'a photo' }),
    role: 'unknown',
  },
];

// Roles that the HEURISTIC cannot emit (AI/legacy-only): assert they are never
// produced, so a future accidental detector cannot claim a role it has no basis for.
const UNREACHABLE_ROLES: readonly { id: string; input: AssetSemanticInput; role: SemanticRole }[] =
  [
    {
      id: 'hero-unreachable',
      input: A('r39', { width: 900, height: 500, parentText: ARTICLE_PARENT, altText: 'hero' }),
      role: 'hero-image',
    },
    {
      id: 'article-evidence-unreachable',
      input: A('r40', {
        width: 700,
        height: 500,
        parentText: ARTICLE_PARENT,
        altText: 'article evidence',
      }),
      role: 'article-evidence',
    },
  ];

// ---------------------------------------------------------------------------
// Claim typing — every ClaimType + precedence
// ---------------------------------------------------------------------------

interface ClaimCase {
  readonly text: string;
  readonly type: ReturnType<typeof classifyClaimType>;
}

const CLAIM_CASES: readonly ClaimCase[] = [
  { text: 'Revenue will rise 12% next year', type: 'forecast' },
  { text: 'Output is expected to reach 5% in 2026', type: 'forecast' },
  { text: 'The board projects continued growth', type: 'forecast' },
  { text: 'Sales were higher than last quarter', type: 'comparative' },
  { text: 'Costs fell 3% versus last year', type: 'comparative' },
  { text: 'Unemployment stands at 5.2%', type: 'numeric' },
  { text: 'The price is $12.99', type: 'numeric' },
  { text: '2024 was a record year', type: 'numeric' },
  { text: 'Quarterly inflation chart', type: 'descriptive' },
  { text: 'A short note', type: 'descriptive' },
  {
    text: 'The central bank held its benchmark rate steady at the conclusion of the meeting',
    type: 'factual',
  },
];

// ---------------------------------------------------------------------------
// Mapping — evidence role → illustrates, non-evidence high overlap → supports,
// low overlap → no link, and the never-contradicts invariant.
// ---------------------------------------------------------------------------

function claim(id: string, text: string): PageClaim {
  return { id, text, type: 'factual', importance: 0.8 };
}

interface MapCase {
  readonly id: string;
  readonly input: AssetSemanticInput;
  readonly claimText: string;
  readonly relation: 'illustrates' | 'supports' | null;
}

const MAP_CASES: readonly MapCase[] = [
  {
    id: 'm1-illustrates',
    input: A('m1', {
      width: 600,
      height: 400,
      altText: 'inflation chart',
      nearbyText: 'inflation chart quarterly',
    }),
    claimText: 'quarterly inflation chart data',
    relation: 'illustrates',
  },
  {
    id: 'm2-supports',
    input: A('m2', {
      width: 400,
      height: 400,
      nearbyText: 'product shipping details and pricing',
      altText: 'product',
    }),
    claimText: 'product shipping details',
    relation: 'supports',
  },
  {
    id: 'm3-low-overlap',
    input: A('m3', {
      width: 600,
      height: 400,
      altText: 'inflation chart',
      nearbyText: 'inflation chart',
    }),
    claimText: 'completely unrelated cooking recipe',
    relation: null,
  },
  {
    id: 'm4-evidence-low-coverage',
    input: A('m4', {
      width: 600,
      height: 400,
      altText: 'inflation chart',
      nearbyText: 'inflation chart',
    }),
    claimText: 'quarterly unemployment figures report',
    relation: null,
  },
];

// ---------------------------------------------------------------------------
// The eval suite
// ---------------------------------------------------------------------------

describe('semantic eval — role classification breadth', () => {
  for (const c of ROLE_CASES) {
    it(`classifies ${c.id} → ${c.role}`, () => {
      expect(classifyHeuristic(c.input).role, c.id).toBe(c.role);
    });
  }

  for (const c of UNREACHABLE_ROLES) {
    it(`NEVER classifies ${c.id} as ${c.role} (not a heuristic-reachable role)`, () => {
      expect(classifyHeuristic(c.input).role, c.id).not.toBe(c.role);
    });
  }
});

describe('semantic eval — claim typing breadth', () => {
  for (const c of CLAIM_CASES) {
    it(`types "${c.text.slice(0, 40)}…" → ${c.type}`, () => {
      expect(classifyClaimType(c.text)).toBe(c.type);
    });
  }
});

describe('semantic eval — claim↔asset mapping breadth', () => {
  for (const c of MAP_CASES) {
    it(`maps ${c.id} → ${c.relation ?? 'no link'}`, () => {
      const analysis = classifyHeuristic(c.input);
      const links = mapClaimsToAssetsHeuristic([claim(c.id, c.claimText)], [analysis], [c.input]);
      if (c.relation === null) {
        expect(links, c.id).toEqual([]);
      } else {
        expect(links[0]?.relation, c.id).toBe(c.relation);
      }
    });
  }

  it('never emits "contradicts" or "unrelated" across the whole role table', () => {
    for (const c of ROLE_CASES) {
      const analysis = classifyHeuristic(c.input);
      const links = mapClaimsToAssetsHeuristic(
        [claim('c', c.input.altText ?? 'x')],
        [analysis],
        [c.input],
      );
      expect(
        links.every((l) => l.relation !== 'contradicts' && l.relation !== 'unrelated'),
        c.id,
      ).toBe(true);
    }
  });
});

describe('semantic eval — breadth contract (rule 4.1)', () => {
  it('holds at least 50 cases so the eval set stays a real regression net', () => {
    const total =
      ROLE_CASES.length + UNREACHABLE_ROLES.length + CLAIM_CASES.length + MAP_CASES.length;
    expect(total).toBeGreaterThanOrEqual(50);
  });
});
