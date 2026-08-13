/**
 * @signet/extension/content — DOM scanner.
 *
 * Pure-ish DOM pass that turns the images on a page into {@link ContentAsset}
 * descriptors. No network, no verification — just "what is on the page and
 * where is it". The orchestrator (./index.ts) decides what to do with the list.
 *
 * Suppresses icons / avatars / decoration via {@link isBadgeSuppressed} so the
 * page does not become a wall of badges. The demo's fixture images carry a
 * `data-tc-fixture` attribute and are always treated as `article-evidence`.
 */
import {
  BADGE_SUPPRESSED_ROLES,
  isBadgeSuppressed,
  type AssetSourceType,
  type ContentAsset,
  type SemanticRole,
} from '@signet/core';
import type { AssetSemanticInput } from '@signet/intelligence';

import { extractSemantic } from './extract';

/** Images smaller than this on either axis are treated as icons. */
const ICON_DIMENSION_PX = 48;
/** Images with fewer than this many layout pixels are not laid out yet. */
const MIN_LAYOUT_AREA_PX = 16;

function classifySource(src: string): AssetSourceType | null {
  if (src.startsWith('http:') || src.startsWith('https:')) return 'network';
  if (src.startsWith('data:')) return 'data-url';
  if (src.startsWith('blob:')) return 'blob';
  return null;
}

function inferRole(img: HTMLImageElement): SemanticRole {
  if (img.dataset.tcFixture !== undefined) return 'article-evidence';
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w > 0 && h > 0 && Math.min(w, h) < ICON_DIMENSION_PX) return 'icon';
  return 'unknown';
}

function fromImage(img: HTMLImageElement): ContentAsset | null {
  // HTMLImageElement.src / currentSrc are always absolute (the browser resolves
  // relative URLs against the document base). currentSrc honours srcset/picture.
  const src = img.currentSrc || img.src;
  if (!src) return null;
  const sourceType = classifySource(src);
  if (!sourceType) return null;

  const rect = img.getBoundingClientRect();
  if (rect.width * rect.height < MIN_LAYOUT_AREA_PX) return null;

  const semanticRole = inferRole(img);
  // Defensive: never trust the suppressed set to be empty.
  if (BADGE_SUPPRESSED_ROLES.size === 0 || isBadgeSuppressed({ semanticRole })) {
    return null;
  }

  return {
    id: src,
    url: src,
    elementType: 'image',
    sourceType,
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    semanticRole,
  };
}

/**
 * Scan the document for badge-eligible images. Pure over the DOM at call time;
 * callers re-scan on mutation/resize (see orchestrator).
 */
export function scanImages(scope: ParentNode = document): readonly ContentAsset[] {
  const out: ContentAsset[] = [];
  const imgs = scope.querySelectorAll<HTMLImageElement>('img');
  imgs.forEach((img) => {
    const asset = fromImage(img);
    if (asset) out.push(asset);
  });
  return out;
}

/**
 * Find the live <img> element whose current src matches `url`. Used by the
 * orchestrator to anchor an overlay to the actual element after verification
 * returns (the element may have moved in the interim).
 */
export function findImageByUrl(url: string): HTMLImageElement | null {
  const imgs = document.querySelectorAll<HTMLImageElement>('img');
  for (const img of imgs) {
    const s = img.currentSrc || img.src;
    if (s === url) return img;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Intelligence mode — returns ALL qualifying images with their DOM-derived
// {@link AssetSemanticInput}, and does NOT role-suppress. Suppression is the
// BadgePolicy's job once an analysis exists. `scanImages` above (the legacy
// path) stays byte-identical and is the ONLY path used when intelligence is OFF.
// ---------------------------------------------------------------------------

/** An image plus the semantic context the Intelligence Layer classifies on. */
export interface SemanticAsset {
  readonly asset: ContentAsset;
  readonly semantic: AssetSemanticInput;
}

/**
 * Scan for ALL badge-eligible images + their semantic context. The minimal
 * filter is: a fetchable source + non-trivial layout area. Role suppression is
 * deferred to {@link DefaultBadgePolicy} so the heuristic (run synchronously in
 * the content script) can suppress obvious logos/decoration before any badge is
 * mounted — no flash.
 */
export function scanImagesWithSemantics(scope: ParentNode = document): readonly SemanticAsset[] {
  const out: SemanticAsset[] = [];
  const imgs = scope.querySelectorAll<HTMLImageElement>('img');
  imgs.forEach((img) => {
    const src = img.currentSrc || img.src;
    if (!src) return;
    const sourceType = classifySource(src);
    if (!sourceType) return;
    const rect = img.getBoundingClientRect();
    if (rect.width * rect.height < MIN_LAYOUT_AREA_PX) return;
    const semantic = extractSemantic(img);
    if (!semantic) return;
    // data-tc-fixture (demo signed images) are always article-evidence.
    const semanticRole: SemanticRole =
      img.dataset.tcFixture !== undefined ? 'article-evidence' : 'unknown';
    out.push({
      asset: {
        id: src,
        url: src,
        elementType: 'image',
        sourceType,
        boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        semanticRole,
      },
      semantic,
    });
  });
  return out;
}

/**
 * Page-level heading text (root → leaf, de-duplicated, bounded), for the
 * `PageSemanticInput.headings` field sent in the batch analyze request.
 */
export function collectPageHeadings(max = 12): readonly string[] {
  const out: string[] = [];
  const hs = document.querySelectorAll('h1, h2, h3');
  hs.forEach((h) => {
    const t = (h.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t && out.length < max) out.push(t);
  });
  return out;
}
