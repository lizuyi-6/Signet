/**
 * Public Trust Decision entrypoints.
 *
 * {@link decide} is the main API: give it an {@link EvidenceGraph}, get a fully
 * explained {@link TrustDecision}. {@link calculateTrustState} is the PRD-named
 * thin wrapper that returns only the {@link TrustState}.
 */
import type { EvidenceGraph, TrustDecision, TrustState } from '@signet/core';

import { deriveFacts } from './derive-facts.js';
import { applyRules } from './rules.js';

/**
 * Compute the trust decision for one asset's evidence graph.
 *
 * Pure, synchronous, deterministic. Never throws on malformed input — the worst
 * case is a fail-closed `unknown` (e.g. an empty graph yields `no-evidence`).
 */
export function decide(graph: EvidenceGraph): TrustDecision {
  const facts = deriveFacts(graph);
  return applyRules(facts);
}

/**
 * PRD-named entrypoint: return only the {@link TrustState}.
 * Prefer {@link decide} when you need the reason / contributors.
 */
export function calculateTrustState(graph: EvidenceGraph): TrustState {
  return decide(graph).state;
}
