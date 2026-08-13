/**
 * @signet/intelligence — heuristic claim↔asset mapping (Phase F; spec §19).
 *
 * PURE: maps already-selected {@link PageClaim}s to already-classified assets by
 * text overlap. This is the always-available floor; the AI provider only refines
 * it (and any AI failure falls back here, §14). Fully unit-testable under Node.
 *
 * Safety (§19 — load-bearing): a relation is SEMANTIC, never truth.
 *   - "illustrates" = the asset appears to picture / visually back the claim.
 *   - "supports"    = the asset's surrounding text discusses the claim.
 * NEITHER means the claim is TRUE. Heuristic mapping NEVER emits "contradicts"
 * — detecting a contradiction requires reading the asset, which text overlap
 * cannot establish; claiming it from overlap alone would be fabrication. It also
 * never materializes "unrelated" pairs: absence of a link IS the unrelated case,
 * and emitting all N×M unrelated pairs would be pure noise. So the heuristic is
 * POSITIVE-OR-NOTHING per (claim, asset) pair.
 */
import type { SemanticRole } from '@signet/core';
import { assetBlob } from './heuristics.js';
import {
  clamp01,
  type AssetSemanticAnalysis,
  type AssetSemanticInput,
  type ClaimEvidenceLink,
  type PageClaim,
} from './types.js';

/** Coverage (fraction of the claim's content tokens found in the asset text) at
 * or below which NO link is emitted. */
const COVERAGE_MIN = 0.4;
/** Coverage at/above which a NON-evidence asset still "supports" a claim. */
const COVERAGE_SUPPORT = 0.55;
/** Max links emitted per asset — keeps the detail card legible (Phase H). */
const MAX_LINKS_PER_ASSET = 3;

/** Roles that function as visual evidence — caption overlap reads as "illustrates". */
const EVIDENCE_ROLES: ReadonlySet<SemanticRole> = new Set<SemanticRole>([
  'primary-evidence',
  'supporting-evidence',
  'news-photo',
  'article-evidence',
  'data-visualization',
  'chart',
  'screenshot',
]);

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'at',
  'by',
  'from',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'their',
  'his',
  'her',
  'our',
  'your',
  'they',
  'them',
  'we',
  'you',
  'he',
  'she',
  'not',
  'no',
  'do',
  'does',
  'did',
  'has',
  'have',
  'had',
  'will',
  'would',
  'can',
  'could',
  'should',
  'may',
  'might',
  'must',
  'about',
  'into',
  'than',
  'then',
  'so',
  'such',
  'very',
  'more',
  'most',
  'some',
  'any',
  'all',
  'each',
  'every',
  'other',
  'over',
  'under',
  'up',
  'down',
  'out',
  'new',
  'one',
  'two',
  'three',
  'first',
  'last',
  'after',
  'before',
  'because',
  'while',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'what',
  'how',
  'why',
  'if',
  'there',
  'here',
  'also',
  'just',
  'only',
  'via',
  'per',
  'amid',
  'upon',
  'among',
  'during',
  'through',
  'between',
  'across',
  'behind',
  'beyond',
]);

/**
 * Tokenize text into lowercased content tokens: alphanumeric runs of length ≥ 3,
 * minus stopwords. Numbers of length ≥ 3 (e.g. "2024", "100") are kept so a
 * claim like "revenue hit $4.2B in 2024" shares "2024" with matching prose.
 */
function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  const matches = text.toLowerCase().match(/[a-z0-9]{3,}/g);
  if (!matches) return out;
  for (const tok of matches) {
    if (STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

interface ScoredLink {
  readonly link: ClaimEvidenceLink;
  readonly score: number;
}

/**
 * Heuristically map claims to assets by text overlap. Pure and deterministic.
 *
 * @param claims   the selected page claims (from claims.ts).
 * @param analyses the heuristic (or merged) asset analyses — supplies the ROLE.
 * @param inputs   the raw asset inputs — supplies the TEXT (alt/caption/parent).
 * @returns        links (illustrates / supports only), strongest per asset first,
 *                 capped at {@link MAX_LINKS_PER_ASSET} per asset. `[]` if either
 *                 side is empty or no pair clears the coverage floor.
 */
export function mapClaimsToAssetsHeuristic(
  claims: readonly PageClaim[],
  analyses: readonly AssetSemanticAnalysis[],
  inputs: readonly AssetSemanticInput[],
): ClaimEvidenceLink[] {
  if (claims.length === 0 || analyses.length === 0 || inputs.length === 0) return [];

  const inputById = new Map(inputs.map((i) => [i.assetId, i]));
  // Precompute claim token sets once (claims are reused across all assets).
  const claimTokens = claims.map((c) => ({ claim: c, tokens: contentTokens(c.text) }));

  const out: ClaimEvidenceLink[] = [];
  for (const analysis of analyses) {
    const input = inputById.get(analysis.assetId);
    if (!input) continue;
    const blob = assetBlob(input);
    if (!blob) continue;
    const assetTokens = contentTokens(blob);
    if (assetTokens.size === 0) continue;

    const scored: ScoredLink[] = [];
    for (const { claim, tokens } of claimTokens) {
      if (tokens.size === 0) continue;
      let matched = 0;
      for (const t of tokens) if (assetTokens.has(t)) matched++;
      const coverage = matched / tokens.size;
      if (coverage < COVERAGE_MIN) continue; // positive-or-nothing (§19)

      const evidenceLike = EVIDENCE_ROLES.has(analysis.role);
      let relation: ClaimEvidenceLink['relation'];
      if (evidenceLike) {
        relation = 'illustrates';
      } else if (coverage >= COVERAGE_SUPPORT) {
        relation = 'supports';
      } else {
        // Weak overlap on a non-evidence asset: not enough to assert a link.
        continue;
      }
      const confidence = clamp01(coverage * (evidenceLike ? 0.95 : 0.85));
      scored.push({
        score: coverage,
        link: {
          claimId: claim.id,
          assetId: analysis.assetId,
          relation,
          confidence,
          reason: `Shares ${matched} key ${matched === 1 ? 'term' : 'terms'} with the claim (${Math.round(coverage * 100)}% coverage).`,
        },
      });
    }
    // Strongest links first; cap per asset so one image cannot flood the card.
    scored.sort((a, b) => b.score - a.score);
    for (const s of scored.slice(0, MAX_LINKS_PER_ASSET)) out.push(s.link);
  }
  return out;
}
