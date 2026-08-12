/**
 * @signet/evidence — pure mapper: C2PA read result → {@link EvidenceGraph}.
 *
 * This module contains the single load-bearing translation between what the
 * C2PA SDK reports and the evidence vocabulary the Trust Engine reasons over.
 * It is **pure and deterministic** — no I/O, no native binary — so every branch
 * is unit-testable with a synthetic manifest store.
 *
 * Fail-closed design (see docs/decisions.md D11, D12):
 *   - An empty/absent manifest → an empty graph (engine → `unknown/no-evidence`).
 *   - A clean manifest (`validation_status` empty, `signature_info` present) →
 *     credential✓, signature✓, hash✓ (engine → `verified`).
 *   - `assertion.dataHash.mismatch` → hash invalid (engine → `broken`).
 *   - A `signature.*`/`claimSignature.*` code → signature invalid
 *     (engine → `broken`).
 *   - Any *other* `validation_status` code is treated as unrecognised: statuses
 *     fall to `unknown` and the graph carries `verificationError`, so the engine
 *     lands on `unknown/verification-error` rather than guessing.
 *
 * The recognised `validation_status` codes and the AI-assertion shapes were
 * pinned empirically by a sign→read→tamper→read spike (c2pa-rs 0.49.2), not
 * from memory.
 */
import type {
  AILabelEvidenceData,
  C2PAEvidenceData,
  EvidenceGraph,
  EvidenceItem,
  EvidenceStatus,
  ProvenanceAction,
} from '@signet/core';

import type {
  C2PAAssertionView,
  C2PAManifestStoreView,
  C2PAManifestView,
  C2PASignatureInfoView,
  C2PAValidationStatusView,
} from './c2pa-types.js';

/** AI-trained digital source types per the C2PA spec → count as AI-declared. */
const AI_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'trainedAlgorithmicMedia',
  'compositeWithTrainedAlgorithmicMedia',
]);

/**
 * Classification of a `validation_status` code into the evidence prong it
 * affects. `unknown-code` means "the SDK reported a problem we do not model";
 * the mapper treats that as a collector-level verification error.
 */
type CodeClass = 'hash-mismatch' | 'signature-failure' | 'unknown-code';

/** Classify a single validation-status code. Pure. */
export function classifyValidationCode(code: string): CodeClass {
  // Exact integrity code observed in the tamper spike.
  if (code === 'assertion.dataHash.mismatch' || code.includes('dataHash.mismatch')) {
    return 'hash-mismatch';
  }
  // Signature/claim-signature failures. c2pa-rs emits codes such as
  // `signature.untrusted`, `claimSignature.untrusted`, `signature.expired`.
  const lower = code.toLowerCase();
  if (lower.includes('signature')) {
    return 'signature-failure';
  }
  return 'unknown-code';
}

interface CodeBucket {
  readonly hashMismatch: C2PAValidationStatusView[];
  readonly signatureFailure: C2PAValidationStatusView[];
  readonly unknown: C2PAValidationStatusView[];
}

function bucketCodes(codes: readonly C2PAValidationStatusView[]): CodeBucket {
  const hashMismatch: C2PAValidationStatusView[] = [];
  const signatureFailure: C2PAValidationStatusView[] = [];
  const unknown: C2PAValidationStatusView[] = [];
  for (const c of codes) {
    switch (classifyValidationCode(c.code)) {
      case 'hash-mismatch':
        hashMismatch.push(c);
        break;
      case 'signature-failure':
        signatureFailure.push(c);
        break;
      case 'unknown-code':
        unknown.push(c);
        break;
    }
  }
  return { hashMismatch, signatureFailure, unknown };
}

/** True if an assertion represents a declared AI involvement. Pure. */
export function isAIAssertion(assertion: C2PAAssertionView): boolean {
  if (assertion.label.startsWith('c2pa.ai')) {
    return true;
  }
  const data = assertion.data as { digitalSourceType?: unknown } | undefined;
  return typeof data?.digitalSourceType === 'string' && AI_SOURCE_TYPES.has(data.digitalSourceType);
}

/** Extract a human-facing generator name from an AI assertion's data, if any. */
function aiGenerator(assertion: C2PAAssertionView): string | undefined {
  const data = assertion.data as
    { generator?: { description?: unknown }; generatorInfo?: unknown } | undefined;
  const desc = data?.generator?.description;
  return typeof desc === 'string' ? desc : undefined;
}

/** True for `c2pa.actions` and the versioned `c2pa.actions.vN` family. Pure. */
function isActionsLabel(label: string): boolean {
  return label === 'c2pa.actions' || /^c2pa\.actions\.v\d+$/.test(label);
}

/** Build the timeline actions from a `c2pa.actions`(/`.vN`) assertion, if any. */
function extractActions(assertions: readonly C2PAAssertionView[]): readonly ProvenanceAction[] {
  for (const a of assertions) {
    if (!isActionsLabel(a.label)) {
      continue;
    }
    const data = a.data as { actions?: unknown } | undefined;
    if (!Array.isArray(data?.actions)) {
      continue;
    }
    return (data.actions as readonly { action?: unknown; when?: unknown; actor?: unknown }[])
      .filter((act) => typeof act.action === 'string')
      .map((act) => ({
        action: String(act.action),
        when: typeof act.when === 'string' ? act.when : undefined,
        actor: typeof act.actor === 'string' ? act.actor : undefined,
      }));
  }
  return [];
}

/** Narrow `signature_info` to the view type (defensive against odd shapes). */
function asSignatureInfo(info: unknown): C2PASignatureInfoView | null {
  if (typeof info === 'object' && info !== null) {
    return info as C2PASignatureInfoView;
  }
  return null;
}

let idCounter = 0;
/**
 * Allocate a stable-within-process evidence id. Determinism within a single
 * call to {@link mapManifestStore} is what matters for the engine; cross-call
 * uniqueness is not required (ids are consumed locally by the rules).
 */
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Reset the in-process id counter (test utility; not part of the public API). */
export function _resetIdCounterForTests(): void {
  idCounter = 0;
}

interface ProngStatuses {
  readonly credential: EvidenceStatus;
  readonly signature: EvidenceStatus;
  readonly hash: EvidenceStatus;
  readonly verificationError: boolean;
  readonly errorMessage?: string;
}

/**
 * Decide the three prong statuses from the bucketed validation codes.
 *
 * Recognised codes pin a prong to `invalid`. Unrecognised codes do not pin any
 * prong to invalid but set `verificationError`, which (combined with the prongs
 * staying `unknown` in that case) drives the engine to `unknown/verification-error`.
 */
function deriveProngStatuses(bucket: CodeBucket): ProngStatuses {
  const hasUnknown = bucket.unknown.length > 0;
  if (hasUnknown) {
    // Unrecognised SDK complaint: fail closed. We do not invent a green prong.
    return {
      credential: 'unknown',
      signature: 'unknown',
      hash: 'unknown',
      verificationError: true,
      errorMessage: bucket.unknown.map((c) => c.code).join(', '),
    };
  }
  return {
    credential: 'valid',
    signature: bucket.signatureFailure.length > 0 ? 'invalid' : 'valid',
    hash: bucket.hashMismatch.length > 0 ? 'invalid' : 'valid',
    verificationError: false,
  };
}

/**
 * Map a C2PA manifest-store view to an {@link EvidenceGraph}.
 *
 * Pure, deterministic, no I/O. This is the function the Trust Engine's
 * behaviour ultimately depends on; every branch is covered by tests.
 *
 * @param store The structural read result (may be `null` when no manifest is embedded).
 * @param assetId The asset these evidence items belong to.
 */
export function mapManifestStore(
  store: C2PAManifestStoreView | null,
  assetId: string,
): EvidenceGraph {
  if (!store || !store.active_manifest) {
    // No embedded provenance → no evidence. Engine → unknown/no-evidence.
    return { assetId, items: [] };
  }

  const manifest: C2PAManifestView = store.active_manifest;
  const codes = store.validation_status ?? [];
  const bucket = bucketCodes(codes);
  const prongs = deriveProngStatuses(bucket);

  const items: EvidenceItem[] = [];
  const source = 'c2pa-sdk';

  // 1) Credential (the manifest itself).
  const c2paData: C2PAEvidenceData = {
    claimGenerator: manifest.claim_generator,
    actions: extractActions(manifest.assertions ?? []),
  };
  items.push({
    id: nextId('c2pa'),
    type: 'c2pa',
    level: 'hard',
    status: prongs.credential,
    data: c2paData,
    source,
  });

  // 2) Signature.
  const sigInfo = asSignatureInfo(manifest.signature_info);
  items.push({
    id: nextId('sig'),
    type: 'signature',
    level: 'hard',
    status: prongs.signature,
    data: sigInfo ? { algorithm: sigInfo.alg, issuer: sigInfo.issuer, time: sigInfo.time } : null,
    source,
    note:
      prongs.signature === 'invalid'
        ? bucket.signatureFailure.map((c) => `${c.code}: ${c.explanation ?? ''}`).join('; ') ||
          'signature validation failed'
        : undefined,
  });

  // 3) Hash binding (integrity).
  items.push({
    id: nextId('hash'),
    type: 'hash',
    level: 'hard',
    status: prongs.hash,
    data: {},
    source,
    note:
      prongs.hash === 'invalid'
        ? bucket.hashMismatch.map((c) => c.explanation ?? c.code).join('; ') ||
          'asset hash mismatch'
        : undefined,
  });

  // 4) AI declaration(s) — one item per AI assertion found.
  const aiAssertions = (manifest.assertions ?? []).filter(isAIAssertion);
  for (const a of aiAssertions) {
    const aiData: AILabelEvidenceData = {
      // c2pa.ai.gen / trainedAlgorithmicMedia both mean "generated by an AI
      // model"; refine the vocabulary when real-world fixtures demand it.
      kind: 'generated',
      generator: aiGenerator(a),
    };
    items.push({
      id: nextId('ai'),
      type: 'ai-label',
      level: 'hard',
      // An AI declaration is only trustworthy when the manifest credential is
      // intact; otherwise fail it closed so it cannot promote to verified-ai.
      status: prongs.credential === 'valid' ? 'valid' : 'unknown',
      data: aiData,
      source,
    });
  }

  const graph: EvidenceGraph = {
    assetId,
    items,
    ...(prongs.verificationError
      ? { verificationError: true as const, errorMessage: prongs.errorMessage }
      : {}),
  };
  return graph;
}
