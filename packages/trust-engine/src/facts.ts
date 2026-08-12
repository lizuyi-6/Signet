/**
 * @signet/trust-engine — derived provenance facts
 *
 * {@link ProvenanceFacts} is the intermediate representation the rule engine
 * reasons over. It is derived structurally from an {@link EvidenceGraph} by
 * {@link deriveFacts}. Keeping the IR separate from the rules makes both layers
 * independently unit-testable.
 */
import type { EvidenceStatus } from '@signet/core';

/**
 * A reduced, rule-ready view of an evidence graph.
 *
 * All `*Status` fields are reconciled across multiple items of the same type:
 * they are `valid` only when every known item of that type agrees on `valid`,
 * `invalid` only when every known item agrees on `invalid`, and `unknown`
 * otherwise (including when items disagree — see {@link conflict}).
 */
export interface ProvenanceFacts {
  /** A hard content credential (C2PA) item is present. */
  readonly credentialPresent: boolean;
  readonly credentialStatus: EvidenceStatus;
  readonly signatureStatus: EvidenceStatus;
  readonly integrityStatus: EvidenceStatus;

  /** A hard, valid AI-label is present (drives verified → verified-ai). */
  readonly aiDeclared: boolean;
  readonly aiKind: 'generated' | 'edited' | 'trained-on' | 'unknown' | undefined;

  readonly hasHardEvidence: boolean;
  readonly hasSoftEvidence: boolean;

  /** Contradictory hard statuses that the engine could not reconcile. */
  readonly conflict: boolean;

  /** Collector reported that evidence gathering itself failed. */
  readonly verificationError: boolean;

  /** Ids of the hard items that produced each signal (for audit). */
  readonly contributorIds: {
    readonly credential: readonly string[];
    readonly signature: readonly string[];
    readonly integrity: readonly string[];
    readonly ai: readonly string[];
    readonly soft: readonly string[];
  };
}

/** Reconcile a list of statuses into a single status + a conflict flag. */
export interface ReconciledStatus {
  readonly status: EvidenceStatus;
  readonly conflict: boolean;
}
