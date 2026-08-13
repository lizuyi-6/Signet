/**
 * @signet/content — page-claim candidate collector (Phase F).
 *
 * Walks the DOM for elements that typically carry the page's salient
 * propositions (headings, captions, quotes, the lede paragraphs) and emits raw
 * {@link ClaimCandidate}s. The SELECTION (scoring / dedup / type-tagging /
 * Top-N) is pure and lives in `@signet/intelligence` (`selectTopClaims`); this
 * file only READS the DOM into candidates. Text-only — no image bytes (§7).
 *
 * Bounded by construction: primary elements (headings/captions/quotes) are
 * collected in full (a page rarely has > 20); lede paragraphs are capped so a
 * 500-paragraph article cannot flood the collector. `selectTopClaims` then caps
 * to 8. Every candidate's text is normalized + truncated downstream, so a
 * pathological element cannot balloon the provider payload.
 */
import type { ClaimCandidate } from '@signet/intelligence';

/** Max lede <p> elements pulled from the main content area (rest are ignored). */
const MAX_LEDE_PARAGRAPHS = 6;

/** Selectors for elements that carry a page's salient propositions. */
const PRIMARY_SELECTOR =
  'h1, h2, h3, h4, h5, h6, figcaption, caption, blockquote, q, summary, strong, b, dt';

/**
 * Collect raw claim candidates from the DOM. Pure over the DOM at call time.
 * Returns candidates in document order; selection/ranking is the caller's job.
 */
export function collectClaimCandidates(scope: ParentNode = document): ClaimCandidate[] {
  const out: ClaimCandidate[] = [];

  // Primary proposition-bearing elements (headings, captions, quotes).
  const primaries = scope.querySelectorAll(PRIMARY_SELECTOR);
  for (const el of primaries) {
    const text = elementText(el);
    if (text) out.push({ text, sourceElement: el.tagName.toLowerCase() });
  }

  // The first few lede paragraphs of the main content area. Scoped to
  // main/article/section so chrome/nav/footer paragraphs are excluded.
  const paras = scope.querySelectorAll('main p, article p, section p');
  let pCount = 0;
  for (const el of paras) {
    if (pCount >= MAX_LEDE_PARAGRAPHS) break;
    const text = elementText(el);
    if (text) {
      out.push({ text, sourceElement: 'p' });
      pCount++;
    }
  }

  return out;
}

/** Collapsed, trimmed innerText of an element (empty string → skip). */
function elementText(el: Element): string {
  // textContent (not innerText) so offscreen/hidden DOM is still readable and so
  // this stays cheap; selectTopClaims normalizes whitespace again anyway.
  const raw = el.textContent ?? '';
  return raw.replace(/\s+/g, ' ').trim();
}
