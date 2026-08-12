/**
 * @signet/trust-engine — public entrypoint.
 *
 * Deterministic, fail-closed Trust Decision engine. Consumes an
 * {@link EvidenceGraph} from `@signet/core` and produces a
 * {@link TrustDecision}.
 */
export { decide, calculateTrustState } from './decision.js';
export { applyRules } from './rules.js';
export { deriveFacts } from './derive-facts.js';
export type { ProvenanceFacts, ReconciledStatus } from './facts.js';
