/**
 * @signet/core — trust states & decision output
 *
 * The four-state model the user sees, plus the machine reason codes the engine
 * emits. States are exhaustive and mutually exclusive; `unknown` is the
 * fail-closed default.
 *
 * Invariants enforced by the engine (see @signet/trust-engine):
 *   - `verified` / `verified-ai` require hard credential + valid signature +
 *     valid integrity, ALL explicit.
 *   - `broken` requires a present credential with an explicit invalid
 *     signature or invalid integrity.
 *   - Soft evidence alone can NEVER produce `verified`, `verified-ai`, or `broken`.
 *   - Errors, conflicts, and missing data fall through to `unknown`.
 */

/**
 * The four user-facing trust states.
 *
 * NOTE: "AI" states are NOT "fake" states. `verified-ai` means the content has
 * valid provenance AND declares an AI step. `unknown` means we lack evidence —
 * it says nothing about whether the content is real or false.
 */
export type TrustState = 'verified' | 'verified-ai' | 'broken' | 'unknown';

/**
 * Machine reason code explaining WHY a state was chosen. Maps 1:1 to the rule
 * that fired, so the detail card / technical view can show a precise cause
 * without exposing raw internals.
 */
export type TrustReason =
  // verified
  | 'valid-credential' // hard credential, signature valid, integrity valid, no AI declared
  // verified-ai
  | 'ai-declared-and-valid' // same as above + a valid hard AI label
  // broken
  | 'integrity-mismatch' // credential present, hash binding failed
  | 'signature-invalid' // credential present, signature verification failed
  // unknown (fail-closed)
  | 'verification-error' // collector reported an error and no definitive broken signal
  | 'evidence-conflict' // contradictory hard evidence that cannot be reconciled
  | 'insufficient-evidence' // some hard evidence present but not enough to verify
  | 'no-evidence' // no usable evidence at all
  | 'soft-evidence-only'; // only soft evidence present

/** A rule identifier (for auditability / testing). */
export type TrustRuleId =
  | 'R1-broken'
  | 'R2-error-to-unknown'
  | 'R3-conflict-to-unknown'
  | 'R4-verified'
  | 'R5-default-unknown';

/**
 * The complete output of the Trust Decision Engine for one asset.
 *
 * `state` is what the badge shows; `reason` is why; `contributingEvidence`
 * lists the item ids that drove the decision (for the detail card / debug panel).
 */
export interface TrustDecision {
  readonly state: TrustState;
  readonly reason: TrustReason;
  /** Which rule fired. */
  readonly ruleId: TrustRuleId;
  /** Evidence item ids that contributed to this decision. */
  readonly contributingEvidence: readonly string[];
  /**
   * True when the decision is the result of a fail-closed fallthrough
   * (error/conflict/insufficient) rather than a positive determination.
   * Convenience flag for UI and metrics.
   */
  readonly failClosed: boolean;
}

/**
 * Display metadata for each state. Centralised so the UI never hardcodes colours
 * or labels per call-site. (Consumed in a later phase by the display layer.)
 */
export const TRUST_STATE_META: Readonly<
  Record<
    TrustState,
    {
      readonly label: string;
      readonly symbol: string;
      readonly tone: 'positive' | 'informational' | 'warning' | 'neutral';
      readonly rank: number; // higher = more concerning presentation
    }
  >
> = {
  verified: { label: 'Verified', symbol: '✓', tone: 'positive', rank: 1 },
  'verified-ai': { label: 'AI Generated', symbol: '◈', tone: 'informational', rank: 2 },
  broken: { label: 'Provenance Broken', symbol: '⚠', tone: 'warning', rank: 4 },
  unknown: { label: 'Unknown', symbol: '?', tone: 'neutral', rank: 3 },
} as const;

/**
 * The states that count as a "false verified" in metrics — i.e. the dangerous
 * outcome. The benchmark's False Verified Rate measures how often a tampered or
 * evidence-less asset is labelled `verified` or `verified-ai`.
 */
export const VERIFIED_STATES: ReadonlySet<TrustState> = new Set<TrustState>([
  'verified',
  'verified-ai',
]);
