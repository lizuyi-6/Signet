/**
 * @signet/intelligence — salient-claim selection (Phase F; spec §45 / §19).
 *
 * Selects the Top 3–8 propositions a page asserts (headline / lede / caption /
 * quote) so the classifier can map them to assets. PURE over text: the content
 * script walks the DOM into raw {@link ClaimCandidate}s; THIS module scores,
 * de-duplicates, type-tags, and truncates them deterministically. No I/O, no DOM,
 * fully unit-testable under Node.
 *
 * Safety (§19 — load-bearing): a {@link PageClaim} is a proposition the PAGE
 * makes — NOT a proposition Signet endorses. "Claim" ≠ "true". Selecting a claim
 * says nothing about its truth; mapping it to an asset (mapping.ts) says nothing
 * about whether the asset proves it. Truth is the cryptographic engine's job,
 * entirely downstream of this advisory layer.
 */
import { fnv1aHex } from './hash.js';
import { clamp01, type ClaimType, type PageClaim } from './types.js';

/**
 * A raw claim candidate pulled from the DOM by the content script. The text is
 * whatever innerText the source element had; selection here normalizes/scores it.
 */
export interface ClaimCandidate {
  readonly text: string;
  /** Source element tag (lowercased, e.g. 'h1', 'figcaption', 'p'). */
  readonly sourceElement: string;
}

/** Selection tuning; all fields optional with safe defaults. */
export interface SelectClaimsOptions {
  /** Max claims returned. Default 8 (spec §45: "Top 3–8"). */
  readonly max?: number;
  /** Min trimmed text length; shorter is dropped. Default 6. */
  readonly minLength?: number;
  /** Max text length; longer is word-boundary truncated. Default 280. */
  readonly maxLength?: number;
}

const DEFAULT_MAX = 8;
const DEFAULT_MIN_LENGTH = 6;
const DEFAULT_MAX_LENGTH = 280;

/**
 * Importance baseline by source-element tag. Headlines outrank body text; a
 * figcaption outranks a list item. Tags not listed fall back to 0.3 (weak).
 */
const TAG_IMPORTANCE: Readonly<Record<string, number>> = {
  h1: 0.95,
  h2: 0.86,
  h3: 0.78,
  h4: 0.6,
  h5: 0.45,
  h6: 0.35,
  figcaption: 0.72,
  caption: 0.7,
  blockquote: 0.66,
  q: 0.6,
  summary: 0.55,
  strong: 0.52,
  b: 0.48,
  dt: 0.46,
  p: 0.45,
  li: 0.38,
  th: 0.4,
  td: 0.32,
};

// ---- Claim-type detectors (precedence: forecast > comparative > numeric > descriptive > factual)
//
// Regex, not parsing — claims are short fragments, not grammatical sentences.
// Precedence exists because a numeric forecast ("revenue will rise 12%") is a
// FORECAST first and numeric second; the leading signal wins.
const FORECAST_RE =
  /\b(will|shall|forecast|forecasted|project|projects|projected|predict|predicts|predicted|expect|expects|expected|estimate|estimates|estimated|anticipate|anticipates|anticipated|upcoming|on\s+track|set\s+to|poised\s+to|slated\s+to|by\s+20\d{2})\b/i;
const COMPARATIVE_RE =
  /\b(more|less|higher|lower|greater|fewer|larger|smaller|faster|slower|versus|vs\.?|compared?\s+to|relative\s+to|increase|increases|increased|decrease|decreases|decreased|growth|decline|drop|drops|dropped|rise|rises|rose|surge|surged|outpace|outpaces|trail|trails|lag|lags)\b/i;
const NUMERIC_RE =
  /(\d+(\.\d+)?\s*%)|([$€£]\s?\d)|(\b\d{1,3}(,\d{3})+\b)|(\b\d+\s*(percent|per\s+cent|bps|basis\s+points|million|billion|trillion|mn|bn|tn|k|m|x)\b)|(\b20\d{2}\b)/i;
const COPULA_RE =
  /\b(is|are|was|were|be|been|being|has|have|had|did|does|do|will|can|could|should|would|may|might|must|said|says|reported|reports|show|shows|found|finds)\b/i;

function tagImportance(tag: string): number {
  return TAG_IMPORTANCE[tag.toLowerCase()] ?? 0.3;
}

/** Collapse runs of whitespace and trim. */
function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Word-boundary truncate with an ellipsis. Pure. */
function truncateClaim(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const boundary = slice.search(/\s\S+\s*$/);
  return `${(boundary > 0 ? slice.slice(0, boundary) : slice).trim()}…`;
}

/**
 * Classify the claim type from text. Precedence: forecast → comparative →
 * numeric → descriptive → factual. A short, verb-less fragment reads as a label
 * (descriptive); anything with a copula/reporting verb reads as a proposition
 * (factual). Exported for direct unit testing.
 */
export function classifyClaimType(text: string): ClaimType {
  if (FORECAST_RE.test(text)) return 'forecast';
  if (COMPARATIVE_RE.test(text)) return 'comparative';
  if (NUMERIC_RE.test(text)) return 'numeric';
  if (text.length < 50 && !COPULA_RE.test(text)) return 'descriptive';
  return 'factual';
}

/**
 * Select the Top-N salient claims from raw candidates. Pure and deterministic:
 * normalizes, de-duplicates (case-insensitive), scores by source element (the
 * higher-scoring source wins a dup), type-tags, truncates, and assigns a stable
 * id derived from the normalized text. Returns at most `max` claims sorted by
 * descending importance; fewer if the page yields fewer distinct candidates;
 * `[]` for empty/no-qualifying input (fail-closed).
 */
export function selectTopClaims(
  candidates: readonly ClaimCandidate[],
  opts: SelectClaimsOptions = {},
): PageClaim[] {
  const max = opts.max ?? DEFAULT_MAX;
  const minLength = opts.minLength ?? DEFAULT_MIN_LENGTH;
  const maxLength = opts.maxLength ?? DEFAULT_MAX_LENGTH;

  // Dedup by normalized-lowercased text. First-seen text is the canonical form
  // (the earliest rendering of a claim, e.g. the headline as it first appears);
  // a later stronger source only UPGRADES importance + sourceElement, never the
  // text. So "Same Claim" (p) then "same claim" (h1) keeps "Same Claim", ranked
  // at h1's importance.
  const best = new Map<string, { text: string; sourceElement: string; importance: number }>();
  for (const c of candidates) {
    const text = truncateClaim(normalizeText(c.text), maxLength);
    if (text.length < minLength) continue;
    const key = text.toLowerCase();
    const importance = tagImportance(c.sourceElement);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, { text, sourceElement: c.sourceElement, importance });
    } else if (importance > prev.importance) {
      best.set(key, { text: prev.text, sourceElement: c.sourceElement, importance });
    }
  }

  const ranked = [...best.values()]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, Math.max(0, max));

  return ranked.map((r) => ({
    id: `clm_${fnv1aHex(r.text.toLowerCase())}`,
    text: r.text,
    type: classifyClaimType(r.text),
    importance: clamp01(r.importance),
    sourceElement: r.sourceElement,
  }));
}
