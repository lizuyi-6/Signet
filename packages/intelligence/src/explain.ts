/**
 * @signet/intelligence — contextual explanation (Phase G; spec §59, §19).
 *
 * The display-only narrator. It turns ALREADY-DECIDED structured evidence into
 * a short human sentence for the detail card: the trust verdict (a given, never
 * re-derived) + the asset's semantic role on the page + its relation to the
 * page's claim. PURE over plain data; unit-testable under Node.
 *
 * Safety (load-bearing — §59 / types.ts TrustExplanationInput contract): the
 * explainer may NOT re-derive, override, or contradict the trust decision. The
 * deterministic floor makes this MECHANICAL: its verdict clause is a pure
 * function of `trust.state` (a lookup in {@link VERDICT_CLAUSE}), so
 * the output can never contradict the verdict — and the tests pin that no
 * other state's clause can appear in the text. The AI path is structurally
 * weaker (free text), so it is layered: the explain prompt FORBIDS re-judging,
 * the schema carries no trust field, and the rendered text sits in the
 * advisory CONTEXT block — visually separate from the cryptographic verdict.
 * The real guarantee, as everywhere in this layer, is the hard/soft seam: an
 * explanation has no path to a TrustDecision.
 */
import type { SemanticRole, TrustState } from '@signet/core';
import { ContextualExplanationSchema } from './schemas.js';
import type {
  ClaimRelation,
  ClaimType,
  ContextualExplanation,
  IntelligenceProvider,
  TrustExplanationInput,
} from './types.js';

/**
 * The verdict clause per trust state. Each sentence embeds the canonical
 * trust-state label VERBATIM (the same words the badge shows — "Verified",
 * "AI Generated", "Provenance Broken", "Unknown" from @signet/core's
 * TRUST_STATE_META), so the explanation can never diverge from the verdict's
 * vocabulary — and the tests can pin label presence/absence mechanically.
 * Each clause is distinct (none is a substring of another). The clause is
 * derived ONLY from the given state — never re-derived, never softened.
 */
export const VERDICT_CLAUSE: Readonly<Record<TrustState, string>> = {
  verified: 'Provenance: Verified — signed by a trusted signer.',
  'verified-ai': 'Provenance: AI Generated — valid provenance with a disclosed AI step.',
  broken: 'Provenance Broken — a credential is present but invalid.',
  unknown: 'Provenance: Unknown — no positive claim was made.',
};

/** Natural-language noun phrase per semantic role, for the role clause. */
const ROLE_PHRASE: Readonly<Record<SemanticRole, string>> = {
  'hero-image': "the page's hero image",
  'primary-evidence': 'primary evidence',
  'supporting-evidence': 'supporting evidence',
  'data-visualization': 'a data visualization',
  chart: 'a chart',
  'news-photo': 'a news photo',
  'article-evidence': 'article evidence',
  screenshot: 'a screenshot',
  'product-image': 'a product image',
  illustration: 'an illustration',
  logo: 'a logo',
  icon: 'an icon',
  avatar: 'an avatar',
  decoration: 'decoration',
  advertisement: 'an advertisement',
  unknown: 'an image',
};

/**
 * Relation phrase per claim↔asset relation. "contradicts" / "unrelated" are
 * only ever supplied by the AI path (the heuristic never emits them — Phase F
 * invariant); narrating them is still advisory, never a verdict on the asset.
 */
const RELATION_PHRASE: Readonly<Record<ClaimRelation, string>> = {
  illustrates: 'appears to illustrate',
  supports: 'appears to support',
  contradicts: 'appears to run against',
  unrelated: 'is not clearly related to',
};

/**
 * Per-claim-type caveat. §19: "supports"/"illustrates" is SEMANTIC — it says
 * how the page uses the image, never that the claim is true. Each caveat makes
 * that explicit for the reader, in claim-type-specific wording.
 */
const CLAIM_TYPE_CAVEAT: Readonly<Record<ClaimType, string>> = {
  forecast: 'This is a forecast; provenance verifies the image, not the prediction.',
  numeric: 'This is a numeric claim; provenance verifies the image, not the numbers.',
  comparative: 'This is a comparison; provenance verifies the image, not the comparison.',
  factual: 'Provenance verifies the image, not the truth of the claim it accompanies.',
  descriptive: 'Provenance verifies the image, not the description it carries.',
};

/** Extra caveat for states whose label is commonly misread. */
const STATE_CAVEAT: Partial<Record<TrustState, string>> = {
  'verified-ai': 'AI-generated ≠ fake; the provenance is valid and discloses the AI step.',
  unknown: 'Unknown means no evidence was found — it does not mean the content is real or fake.',
};

/** Max length of the claim fragment quoted inside the explanation. */
const CLAIM_QUOTE_MAX = 120;

/** Word-boundary truncate (mirrors claims.ts truncateClaim). */
function truncateClaim(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const boundary = slice.search(/\s\S+\s*$/);
  return `${(boundary > 0 ? slice.slice(0, boundary) : slice).trim()}…`;
}

/**
 * The deterministic explanation floor. Always available, never fails, never
 * contradicts the verdict — it NARRATES the given TrustDecision and the given
 * advisory semantics. This is what renders when AI is off (the default), when
 * the provider fails, or when its output is rejected.
 */
export function buildDeterministicExplanation(input: TrustExplanationInput): ContextualExplanation {
  const state = input.trust.state;
  const parts: string[] = [VERDICT_CLAUSE[state]];

  if (input.semanticRole) {
    parts.push(`On this page it functions as ${ROLE_PHRASE[input.semanticRole]}.`);
  }

  if (input.pageClaim) {
    const quoted = truncateClaim(input.pageClaim.text, CLAIM_QUOTE_MAX);
    if (input.claimRelation) {
      parts.push(`It ${RELATION_PHRASE[input.claimRelation.relation]} the claim: “${quoted}”.`);
    } else {
      parts.push(`It is associated with the claim: “${quoted}”.`);
    }
  }

  const caveats: string[] = [];
  if (input.pageClaim) caveats.push(CLAIM_TYPE_CAVEAT[input.pageClaim.type]);
  const stateCaveat = STATE_CAVEAT[state];
  if (stateCaveat) caveats.push(stateCaveat);

  return { assetId: input.assetId, text: parts.join(' '), source: 'deterministic', caveats };
}

export interface ExplanationOutcome {
  readonly explanation: ContextualExplanation;
  /** ai = provider contributed; deterministic = floor (AI off or failed). */
  readonly source: 'deterministic' | 'ai';
  /** When source === 'deterministic' but AI was attempted, the failure reason. */
  readonly error?: string;
}

/** Race a promise against a hard timeout (mirrors classifier.callWithTimeout). */
function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fn();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`explain provider timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([fn(), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * AI-enriched explanation with the deterministic floor as the guaranteed
 * fallback — the §14 pattern applied to explanation. Order: floor computed
 * first; provider attempted only if it implements `explainEvidence`; provider
 * output re-validated with {@link ContextualExplanationSchema} (defense in
 * depth, §13 — a buggy or hostile provider triggers fallback, never bad text).
 * The schema forces `source:'ai'`, so a provider cannot lie about its label.
 * On ANY failure the caller still gets the floor: explanation is always
 * available, exactly like classification.
 */
export async function explainEvidenceWithFallback(
  input: TrustExplanationInput,
  provider?: IntelligenceProvider,
  timeoutMs = 8000,
): Promise<ExplanationOutcome> {
  const floor = buildDeterministicExplanation(input);
  if (!provider?.explainEvidence) {
    return { explanation: floor, source: 'deterministic' };
  }
  try {
    const raw = await withTimeout(() => provider.explainEvidence!(input), timeoutMs);
    const parsed = ContextualExplanationSchema.parse(raw);
    // Defense in depth: the explanation MUST describe OUR asset id, whatever
    // the provider echoed back.
    return { explanation: { ...parsed, assetId: input.assetId }, source: 'ai' };
  } catch (e) {
    return {
      explanation: floor,
      source: 'deterministic',
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }
}
