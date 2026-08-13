/**
 * @signet/intelligence — final display policy.
 *
 * The single authority on whether an asset's trust badge is VISIBLE, combining
 * the deterministic trust verdict with the advisory semantic badge decision.
 *
 * This is the load-bearing seam for the §17 "Trust Visibility Invariant":
 * semantic suppression can reduce noise, but can NEVER conceal a
 * cryptographically detected provenance failure. A `broken` verdict overrides
 * any semantic "suppress" — the display policy is the LAST gate, and it is
 * fail-closed toward visibility of failure.
 *
 * Scope note: this module only decides VISIBILITY. It does not gate
 * verification — the content script verifies every eligible asset regardless of
 * what this returns (§11/§12: verification is independent of semantic
 * visibility). And it never reads or writes a TrustDecision's verdict: it only
 * reads the `state`, so it cannot promote or demote it. The hard/soft seam in
 * @signet/trust-engine remains the sole authority on the verdict itself.
 */
import type { TrustState } from '@signet/core';

import type { BadgeDecision } from './types.js';

/** How prominently a badge is shown once displayed. */
export type FinalDisplayPriority = 'critical' | 'high' | 'normal' | 'suppressed';

export interface FinalDisplayDecision {
  readonly show: boolean;
  readonly priority: FinalDisplayPriority;
  readonly reason: string;
}

/** The system invariant this module enforces (documented in README + architecture). */
export const TRUST_VISIBILITY_INVARIANT =
  'No semantic or AI-derived signal may suppress a cryptographically detected provenance failure.';

/**
 * Minimal trust view — accepts a full `TrustDecision` from @signet/core or the
 * content script's `VerifyResult` (both carry `state: TrustState`). Only the
 * state is read; the invariant never depends on reason/items.
 */
export interface TrustView {
  readonly state: TrustState;
}

/**
 * Combine a trust verdict with a semantic badge decision into the FINAL display
 * decision. Rules (§14/§15):
 *   - `trust.state === 'broken'` → ALWAYS show, priority `critical`, regardless
 *     of the semantic decision (the Trust Visibility Invariant).
 *   - otherwise the semantic decision is authoritative: a suppressed role stays
 *     suppressed; a shown role keeps its priority (`high`/`normal`).
 *
 * `trust` may be `undefined` when verification has not resolved yet — then the
 * semantic decision alone decides (no broken signal exists to override).
 */
export function decideFinalDisplay(
  trust: TrustView | undefined,
  semantic: BadgeDecision,
): FinalDisplayDecision {
  if (trust?.state === 'broken') {
    return {
      show: true,
      priority: 'critical',
      reason: 'Cryptographic provenance failure overrides semantic suppression.',
    };
  }
  if (!semantic.show) {
    return { show: false, priority: 'suppressed', reason: semantic.reason };
  }
  return {
    show: true,
    priority: semantic.priority === 'high' ? 'high' : 'normal',
    reason: semantic.reason,
  };
}
