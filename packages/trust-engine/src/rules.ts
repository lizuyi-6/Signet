/**
 * @signet/trust-engine — the deterministic rule set.
 *
 * Rules are applied in strict precedence order by {@link applyRules}. The order
 * is the single most important safety property of this engine, so it is spelled
 * out exhaustively here and exercised by tests.
 *
 *   R1  broken         — credential present ∧ (integrity invalid ∨ signature invalid)
 *   R2  error          — collector verificationError            → unknown
 *   R3  conflict       — contradictory hard evidence            → unknown
 *   R4  verified       — credential ∧ credential✓ ∧ signature✓ ∧ integrity✓
 *                          (+ ai hard✓ → verified-ai)
 *   R5  default        — everything else                        → unknown
 *
 * Safety invariants enforced by construction (False-Verified Rate = 0):
 *   - `verified` / `verified-ai` require signature AND integrity to be
 *     EXPLICITLY `valid`. `unknown` statuses never promote.
 *   - Soft evidence never contributes to credential/signature/integrity/ai
 *     signals (see derive-facts), so it can never produce verified or broken.
 *   - Errors, conflicts, and missing data all fall through to `unknown`.
 *
 * Decision: broken is checked BEFORE error (R1 before R2). An explicit `invalid`
 * integrity/signature is a confident positive signal worth surfacing even when
 * the collector also reported a partial error — and it can never cause a
 * false-verified. See docs/decisions.md.
 */
import type { TrustDecision, TrustRuleId, TrustReason, TrustState } from '@signet/core';

import type { ProvenanceFacts } from './facts.js';

function dedupe(ids: readonly string[]): readonly string[] {
  return Array.from(new Set(ids));
}

function make(
  state: TrustState,
  reason: TrustReason,
  ruleId: TrustRuleId,
  failClosed: boolean,
  contributors: readonly string[],
): TrustDecision {
  return {
    state,
    reason,
    ruleId,
    failClosed,
    contributingEvidence: dedupe(contributors),
  };
}

/**
 * The hard-evidence contributor ids, for fail-closed unknown reasons where we
 * want to show "what we did see" in the detail card.
 */
function hardContributors(facts: ProvenanceFacts): readonly string[] {
  return dedupe([
    ...facts.contributorIds.credential,
    ...facts.contributorIds.signature,
    ...facts.contributorIds.integrity,
    ...facts.contributorIds.ai,
  ]);
}

/**
 * Apply the rule set to derived facts. Pure & deterministic.
 */
export function applyRules(facts: ProvenanceFacts): TrustDecision {
  // R1 — Broken (positive tamper detection; precedence over error).
  if (facts.credentialPresent) {
    if (facts.integrityStatus === 'invalid') {
      return make('broken', 'integrity-mismatch', 'R1-broken', false, [
        ...facts.contributorIds.credential,
        ...facts.contributorIds.integrity,
      ]);
    }
    if (facts.signatureStatus === 'invalid') {
      return make('broken', 'signature-invalid', 'R1-broken', false, [
        ...facts.contributorIds.credential,
        ...facts.contributorIds.signature,
      ]);
    }
  }

  // R2 — Collector error → fail-closed unknown.
  if (facts.verificationError) {
    return make(
      'unknown',
      'verification-error',
      'R2-error-to-unknown',
      true,
      hardContributors(facts),
    );
  }

  // R3 — Contradictory hard evidence → fail-closed unknown.
  if (facts.conflict) {
    return make(
      'unknown',
      'evidence-conflict',
      'R3-conflict-to-unknown',
      true,
      hardContributors(facts),
    );
  }

  // R4 — Verified / Verified-AI (all hard signals explicitly green).
  if (
    facts.credentialPresent &&
    facts.credentialStatus === 'valid' &&
    facts.signatureStatus === 'valid' &&
    facts.integrityStatus === 'valid'
  ) {
    if (facts.aiDeclared) {
      return make('verified-ai', 'ai-declared-and-valid', 'R4-verified', false, [
        ...facts.contributorIds.credential,
        ...facts.contributorIds.signature,
        ...facts.contributorIds.integrity,
        ...facts.contributorIds.ai,
      ]);
    }
    return make('verified', 'valid-credential', 'R4-verified', false, [
      ...facts.contributorIds.credential,
      ...facts.contributorIds.signature,
      ...facts.contributorIds.integrity,
    ]);
  }

  // R5 — Default fail-closed unknown; refine the reason for the detail card.
  if (!facts.hasHardEvidence && facts.hasSoftEvidence) {
    return make(
      'unknown',
      'soft-evidence-only',
      'R5-default-unknown',
      true,
      facts.contributorIds.soft,
    );
  }
  if (facts.hasHardEvidence) {
    return make(
      'unknown',
      'insufficient-evidence',
      'R5-default-unknown',
      true,
      hardContributors(facts),
    );
  }
  return make('unknown', 'no-evidence', 'R5-default-unknown', true, []);
}
