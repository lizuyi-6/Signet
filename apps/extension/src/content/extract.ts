/**
 * @signet/extension/content — DOM → {@link AssetSemanticInput} extractor.
 *
 * The single DOM-touching point that feeds the Intelligence Layer. It pulls
 * TEXT context only (alt / caption / nearby / parent / headings) plus rendered
 * dimensions — never image bytes. This honours the §7/D19 privacy default
 * (`context-only`): even when the AI provider is enabled, what leaves the page
 * is text, not pixels.
 *
 * The extractor is intentionally bounded: every text field is truncated so a
 * pathological page (a 50 KB `<article>` textContent) cannot balloon the
 * provider payload or the cache key. Truncation is a pure helper so it can be
 * exercised without a DOM.
 */
import type { AssetSemanticInput } from '@signet/intelligence';

/** Cap any single text field sent to the classifier/provider. */
const MAX_TEXT_CHARS = 320;
/** Cap the parent-container text (articles can be very long). */
const MAX_PARENT_CHARS = 600;
/** Cap the heading chain (root → leaf). */
const MAX_HEADINGS = 8;

/** Truncate to a bounded length, on a whitespace boundary when possible. */
export function truncateText(s: string, max = MAX_TEXT_CHARS): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const boundary = slice.search(/\s\S+\s*$/);
  return `${(boundary > 0 ? slice.slice(0, boundary) : slice).trim()}…`;
}

/** Collapse runs of whitespace and trim. */
function cleanText(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

/** Nearest ancestor element matching a tag predicate, or null. */
function nearestAncestor(el: Element, predicate: (e: Element) => boolean): Element | null {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (predicate(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

const BLOCK_CONTAINER_TAGS = new Set(['FIGURE', 'ARTICLE', 'SECTION', 'MAIN', 'ASIDE', 'TABLE']);

/** The heading chain root → leaf for the asset's position in the document. */
function headingChain(img: HTMLImageElement): string[] {
  const out: string[] = [];
  const walkers: Element[] = [];
  // Collect all ancestors + the image's own section, then read headings inside.
  let cur: Element | null = img.parentElement;
  while (cur) {
    walkers.push(cur);
    cur = cur.parentElement;
  }
  // Headings are collected root-outward-from-img's parent up; reverse so the
  // outermost (H1) comes first. Only keep the FIRST heading of each level seen
  // at the outermost scope that contains the image.
  for (let level = 1; level <= 6; level++) {
    const tag = `H${level}`;
    // Search from the outermost ancestor inward; the first match is the
    // section-heading that introduces the image's location.
    for (let i = walkers.length - 1; i >= 0; i--) {
      const node = walkers[i];
      if (!node) continue;
      const h = node.querySelector(tag);
      if (h && out.length < MAX_HEADINGS) {
        out.push(truncateText(cleanText(h.textContent), 160));
        break;
      }
    }
  }
  return out;
}

/**
 * Build the semantic input for one image. Pure over the DOM at call time; the
 * orchestrator decides what to do with the result. Returns `null` only when the
 * image has no usable source (the caller should skip it).
 */
export function extractSemantic(img: HTMLImageElement): AssetSemanticInput | null {
  const src = img.currentSrc || img.src;
  if (!src) return null;

  // Dimensions: prefer natural (intrinsic) so a CSS-shrunk logo is still a logo.
  const width = img.naturalWidth || img.width || 0;
  const height = img.naturalHeight || img.height || 0;

  // Caption: a <figcaption> inside the nearest <figure>, else an adjacent
  // caption-like sibling.
  let nearbyText = '';
  const figure = nearestAncestor(img, (e) => e.tagName === 'FIGURE');
  if (figure) {
    const cap = figure.querySelector('FIGCAPTION');
    if (cap) nearbyText = cleanText(cap.textContent);
  }
  if (!nearbyText) {
    const prev = img.previousElementSibling;
    if (prev && (prev.tagName === 'FIGCAPTION' || prev.tagName === 'CAPTION')) {
      nearbyText = cleanText(prev.textContent);
    }
  }
  // Fallback: the image's own title or a直接 adjacent text sibling.
  if (!nearbyText && img.title) nearbyText = cleanText(img.title);

  // Parent container text (the prose the image sits inside).
  const container = figure ?? nearestAncestor(img, (e) => BLOCK_CONTAINER_TAGS.has(e.tagName));
  const parentText = container
    ? truncateText(cleanText(container.textContent), MAX_PARENT_CHARS)
    : '';

  const altText = img.alt ? truncateText(cleanText(img.alt)) : '';
  const title = img.title ? truncateText(cleanText(img.title)) : '';

  const input: AssetSemanticInput = {
    assetId: src,
    altText: altText || undefined,
    title: title || undefined,
    nearbyText: nearbyText ? truncateText(nearbyText) : undefined,
    parentText: parentText || undefined,
    headingContext: headingChain(img),
    width,
    height,
    elementRole: img.getAttribute('role') ?? undefined,
    linkTarget:
      (nearestAncestor(img, (e) => e.tagName === 'A') as HTMLAnchorElement | null)?.href ??
      undefined,
    imageUrl: src,
    pageUrl: location.href,
    pageTitle: truncateText(cleanText(document.title), MAX_PARENT_CHARS) || undefined,
    pageDescription:
      truncateText(
        cleanText(
          document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
        ),
        MAX_PARENT_CHARS,
      ) || undefined,
  };
  return input;
}
