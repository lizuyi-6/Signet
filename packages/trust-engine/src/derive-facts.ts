/**
 * Derive {@link ProvenanceFacts} from an {@link EvidenceGraph}.
 *
 * Pure, deterministic, no I/O. This is the ONLY place the engine inspects
 * evidence items; the rules in `rules.ts` operate purely on the resulting facts.
 */
import type {
  AILabelEvidenceData,
  EvidenceGraph,
  EvidenceItem,
  EvidenceStatus,
} from '@signet/core';

import type { ProvenanceFacts, ReconciledStatus } from './facts.js';

/** Status precedence helper: reconcile a non-empty list of statuses. */
function reconcileStatuses(statuses: readonly EvidenceStatus[]): ReconciledStatus {
  if (statuses.length === 0) {
    return { status: 'unknown', conflict: false };
  }
  // Ignore `unknown` items when looking for agreement — they represent
  // "couldn't tell", not a vote. Conflict is only between *known* disagreements.
  const known = statuses.filter((s) => s !== 'unknown');
  if (known.length === 0) {
    return { status: 'unknown', conflict: false };
  }
  const first = known[0];
  const allAgree = known.every((s) => s === first);
  if (allAgree) {
    // first is 'valid' | 'invalid' here, never 'unknown' (filtered above),
    // but TS needs the cast through EvidenceStatus.
    return { status: first as EvidenceStatus, conflict: false };
  }
  // Known statuses disagree → cannot claim either way; fail to unknown + flag.
  return { status: 'unknown', conflict: true };
}

function isAILabelData(data: unknown): data is AILabelEvidenceData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const kind = (data as { kind?: unknown }).kind;
  return kind === 'generated' || kind === 'edited' || kind === 'trained-on' || kind === 'unknown';
}

/**
 * Derive provenance facts from a graph.
 *
 * Classification rules:
 *  - `credential` = hard items of type `c2pa`.
 *  - `signature`  = hard items of type `signature`.
 *  - `integrity`  = hard items of type `hash`.
 *  - `ai`         = hard items of type `ai-label` with status `valid`.
 *
 * Soft items never contribute to credential/signature/integrity/ai signals —
 * they only set {@link ProvenanceFacts.hasSoftEvidence}.
 */
export function deriveFacts(graph: EvidenceGraph): ProvenanceFacts {
  const items: readonly EvidenceItem[] = graph.items ?? [];

  const hard = items.filter((i) => i.level === 'hard');
  const soft = items.filter((i) => i.level === 'soft');

  const credentialItems = hard.filter((i) => i.type === 'c2pa');
  const signatureItems = hard.filter((i) => i.type === 'signature');
  const integrityItems = hard.filter((i) => i.type === 'hash');
  const aiItems = hard.filter((i) => i.type === 'ai-label' && i.status === 'valid');

  const credentialRec = reconcileStatuses(credentialItems.map((i) => i.status));
  const signatureRec = reconcileStatuses(signatureItems.map((i) => i.status));
  const integrityRec = reconcileStatuses(integrityItems.map((i) => i.status));

  const conflict = credentialRec.conflict || signatureRec.conflict || integrityRec.conflict;

  const aiKind = aiItems
    .map((i) => (isAILabelData(i.data) ? i.data.kind : undefined))
    .find((k): k is NonNullable<typeof k> => k !== undefined);

  return {
    credentialPresent: credentialItems.length > 0,
    credentialStatus: credentialRec.status,
    signatureStatus: signatureRec.status,
    integrityStatus: integrityRec.status,
    aiDeclared: aiItems.length > 0,
    aiKind,
    hasHardEvidence: hard.length > 0,
    hasSoftEvidence: soft.length > 0,
    conflict,
    verificationError: graph.verificationError === true,
    contributorIds: {
      credential: credentialItems.map((i) => i.id),
      signature: signatureItems.map((i) => i.id),
      integrity: integrityItems.map((i) => i.id),
      ai: aiItems.map((i) => i.id),
      soft: soft.map((i) => i.id),
    },
  };
}
