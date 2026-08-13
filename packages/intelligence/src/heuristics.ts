/**
 * @signet/intelligence — deterministic heuristic classifier.
 *
 * DOM-first, NO AI. Pure function over {@link AssetSemanticInput}: classifies the
 * semantic role an asset plays on the page and assigns advisory scores. This is
 * the ALWAYS-AVAILABLE baseline; the AI provider (Phase D) only enriches it, and
 * every AI failure falls back here (§14).
 *
 * Calibration philosophy: suppress obvious noise (logo / avatar / icon / ad /
 * decoration) so the page is calm; surface real evidence (charts, large article
 * imagery, news photos) as high-priority. When genuinely unclear, return
 * `unknown` rather than guessing — Signet never fabricates a semantic claim it
 * cannot justify (fail-closed applies to understanding too).
 */
import type { SemanticRole } from '@signet/core';

import { clamp01, type AssetSemanticAnalysis, type AssetSemanticInput } from './types.js';

/** Images whose smaller dimension is under this are treated as icons. */
const ICON_MAX_PX = 48;
/** Width at or above which a large image in article context reads as evidence. */
const EVIDENCE_MIN_WIDTH_PX = 320;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lowercased concatenation of the asset-LOCAL text fields (page title excluded
 * to avoid over-triggering on chrome that happens to mention a keyword).
 * Exported so the claim↔asset mapper (mapping.ts) shares the SAME notion of an
 * asset's text blob — the detector and the mapper must agree on what text counts. */
export function assetBlob(i: AssetSemanticInput): string {
  const parts: string[] = [];
  if (i.altText) parts.push(i.altText);
  if (i.title) parts.push(i.title);
  if (i.nearbyText) parts.push(i.nearbyText);
  if (i.parentText) parts.push(i.parentText);
  if (i.headingContext) parts.push(...i.headingContext);
  return parts.join(' ').toLowerCase();
}

function hasWord(blob: string, word: string): boolean {
  return new RegExp(`\\b${escapeRe(word.toLowerCase())}\\b`).test(blob);
}

function hasAny(blob: string, words: readonly string[]): boolean {
  return words.some((w) => hasWord(blob, w));
}

// ---- Per-role advisory score baselines -------------------------------------

const ROLE_SCORES: Readonly<
  Record<SemanticRole, { readonly importance: number; readonly evidenceLikelihood: number }>
> = {
  'primary-evidence': { importance: 0.9, evidenceLikelihood: 0.9 },
  'supporting-evidence': { importance: 0.65, evidenceLikelihood: 0.72 },
  chart: { importance: 0.85, evidenceLikelihood: 0.9 },
  'data-visualization': { importance: 0.85, evidenceLikelihood: 0.9 },
  'news-photo': { importance: 0.8, evidenceLikelihood: 0.85 },
  'hero-image': { importance: 0.75, evidenceLikelihood: 0.6 },
  'article-evidence': { importance: 0.7, evidenceLikelihood: 0.75 },
  screenshot: { importance: 0.6, evidenceLikelihood: 0.6 },
  'product-image': { importance: 0.5, evidenceLikelihood: 0.4 },
  illustration: { importance: 0.4, evidenceLikelihood: 0.35 },
  unknown: { importance: 0.35, evidenceLikelihood: 0.3 },
  decoration: { importance: 0.05, evidenceLikelihood: 0.05 },
  icon: { importance: 0.1, evidenceLikelihood: 0.05 },
  avatar: { importance: 0.1, evidenceLikelihood: 0.05 },
  logo: { importance: 0.1, evidenceLikelihood: 0.05 },
  advertisement: { importance: 0.05, evidenceLikelihood: 0.05 },
};

function reasonFor(role: SemanticRole): string {
  switch (role) {
    case 'logo':
      return 'Matched "logo"/"brand" — a brand mark, not evidence.';
    case 'avatar':
      return 'Matched "avatar"/"profile" — a user portrait, not evidence.';
    case 'icon':
      return `Smaller than ${ICON_MAX_PX}px on an edge — a UI icon.`;
    case 'decoration':
      return 'Empty alt text (the HTML-spec decorative signal) or a decoration role.';
    case 'advertisement':
      return 'Matched ad/sponsored/promo signals — paid placement, not evidence.';
    case 'chart':
    case 'data-visualization':
      return 'Matched chart/graph/plot — a data figure that may back a numeric claim.';
    case 'screenshot':
      return 'Matched "screenshot" — a captured UI, not a photograph.';
    case 'illustration':
      return 'Matched illustration/diagram — editorial artwork, not hard evidence.';
    case 'product-image':
      return 'Matched product/buy/price signals — commercial imagery.';
    case 'news-photo':
      return 'Large image in article context with photo/press attribution — likely reportage.';
    case 'primary-evidence':
      return 'Large image inside article body — likely primary evidence for the claim.';
    case 'supporting-evidence':
      return 'Image inside article context with nearby text — supporting evidence.';
    case 'hero-image':
      return 'Large header/hero image — editorial, not necessarily evidence.';
    case 'article-evidence':
      return 'Article-embedded image (legacy fixture role).';
    case 'unknown':
      return 'No strong semantic signal — role undetermined (Unknown ≠ untrustworthy).';
  }
}

// ---- Detectors (ordered; first match wins) ---------------------------------

function detectDecoration(i: AssetSemanticInput): SemanticRole | null {
  if (i.altText === '') return 'decoration'; // explicit HTML decorative signal
  if (i.elementRole === 'decoration') return 'decoration';
  return null;
}

function detectAdvertisement(i: AssetSemanticInput, blob: string): SemanticRole | null {
  if (i.elementRole === 'advertisement') return 'advertisement';
  if (hasAny(blob, ['advertisement', 'sponsored', 'promo', 'ad banner'])) return 'advertisement';
  return null;
}

function detectAvatar(i: AssetSemanticInput, blob: string): SemanticRole | null {
  if (i.elementRole === 'avatar') return 'avatar';
  if (hasAny(blob, ['avatar', 'profile picture', 'user photo'])) return 'avatar';
  return null;
}

function detectLogo(i: AssetSemanticInput, blob: string): SemanticRole | null {
  if (i.elementRole === 'logo') return 'logo';
  if (hasAny(blob, ['logo', 'brand mark', 'company logo'])) return 'logo';
  return null;
}

function detectIcon(i: AssetSemanticInput): SemanticRole | null {
  const min = Math.min(i.width, i.height);
  if (min > 0 && min < ICON_MAX_PX) return 'icon';
  return null;
}

function detectChart(blob: string): SemanticRole | null {
  if (hasAny(blob, ['data visualization', 'data-visualization', 'data chart'])) {
    return 'data-visualization';
  }
  if (hasAny(blob, ['chart', 'graph', 'bar chart', 'pie chart', 'line chart', 'plot'])) {
    return 'chart';
  }
  return null;
}

function detectScreenshot(blob: string): SemanticRole | null {
  if (hasWord(blob, 'screenshot')) return 'screenshot';
  return null;
}

function detectIllustration(blob: string): SemanticRole | null {
  if (hasAny(blob, ['illustration', 'diagram', 'drawing'])) return 'illustration';
  return null;
}

function detectProduct(i: AssetSemanticInput, blob: string): SemanticRole | null {
  if (hasAny(blob, ['product', 'buy now', 'add to cart', 'price', 'shipping'])) {
    return 'product-image';
  }
  if (i.linkTarget && /\/(product|products|p|item|shop)\//i.test(i.linkTarget)) {
    return 'product-image';
  }
  return null;
}

function detectEvidence(i: AssetSemanticInput, blob: string): SemanticRole | null {
  const inArticle =
    (!!i.parentText && i.parentText.length > 80) ||
    (!!i.headingContext && i.headingContext.length > 0);
  const large = i.width >= EVIDENCE_MIN_WIDTH_PX;
  if (large && inArticle) {
    if (hasAny(blob, ['photo', 'photograph', 'press photo', 'reuters', 'ap photo', 'getty'])) {
      return 'news-photo';
    }
    return 'primary-evidence';
  }
  if (inArticle && !!i.nearbyText && i.nearbyText.length > 0) {
    return 'supporting-evidence';
  }
  return null;
}

function pickRole(i: AssetSemanticInput, blob: string): SemanticRole {
  // Order matters: noise first (so a tiny logo is "logo", not "icon" or worse,
  // evidence), then content types, then the fail-closed `unknown` default.
  return (
    detectDecoration(i) ??
    detectAdvertisement(i, blob) ??
    detectAvatar(i, blob) ??
    detectLogo(i, blob) ??
    detectIcon(i) ??
    detectChart(blob) ??
    detectScreenshot(blob) ??
    detectIllustration(blob) ??
    detectProduct(i, blob) ??
    detectEvidence(i, blob) ??
    'unknown'
  );
}

function confidenceFor(role: SemanticRole, blob: string): number {
  // Text-hint detections are firmer than size/structural ones; `unknown` is the
  // least confident. Numbers are advisory only — they are NOT trust confidence.
  const suppressed: ReadonlySet<SemanticRole> = new Set([
    'icon',
    'avatar',
    'logo',
    'decoration',
    'advertisement',
  ]);
  if (role === 'unknown') return blob.length > 0 ? 0.45 : 0.35;
  if (suppressed.has(role)) return 0.65;
  return 0.7; // content roles detected via text/structure
}

/**
 * Classify one asset deterministically from its DOM context. Pure, synchronous,
 * no I/O. Always succeeds and always returns `generatedBy: 'heuristic'`.
 */
export function classifyHeuristic(input: AssetSemanticInput): AssetSemanticAnalysis {
  const blob = assetBlob(input);
  const role = pickRole(input, blob);
  const scores = ROLE_SCORES[role];
  return {
    assetId: input.assetId,
    role,
    importance: clamp01(scores.importance),
    evidenceLikelihood: clamp01(scores.evidenceLikelihood),
    confidence: clamp01(confidenceFor(role, blob)),
    reason: reasonFor(role),
    generatedBy: 'heuristic',
  };
}

/** Classify every asset on a page (heuristic only). Pure batch helper. */
export function classifyHeuristicBatch(
  inputs: readonly AssetSemanticInput[],
): readonly AssetSemanticAnalysis[] {
  return inputs.map((i) => classifyHeuristic(i));
}
