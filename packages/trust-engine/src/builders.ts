/**
 * Compact builders for Trust Engine tests. Keeps test cases readable while
 * exercising the real EvidenceGraph/EvidenceItem types from core.
 */
import type {
  EvidenceGraph,
  EvidenceItem,
  EvidenceLevel,
  EvidenceStatus,
  EvidenceType,
} from '@signet/core';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export interface ItemInput {
  type: EvidenceType;
  level?: EvidenceLevel;
  status?: EvidenceStatus;
  data?: unknown;
  source?: string;
  id?: string;
}

export function mkItem(input: ItemInput): EvidenceItem {
  return {
    id: input.id ?? nextId(input.type),
    type: input.type,
    level: input.level ?? 'hard',
    status: input.status ?? 'unknown',
    data: input.data ?? null,
    source: input.source ?? 'test-fixture',
  };
}

export interface GraphOptions {
  verificationError?: boolean;
  errorMessage?: string;
  assetId?: string;
}

export function mkGraph(items: readonly EvidenceItem[], opts: GraphOptions = {}): EvidenceGraph {
  return {
    assetId: opts.assetId ?? 'asset-1',
    items,
    ...(opts.verificationError ? { verificationError: true } : {}),
    ...(opts.errorMessage ? { errorMessage: opts.errorMessage } : {}),
  };
}

// ---- Canonical scenario graphs (mirror the four demo assets) ---------------

/** Asset A: valid C2PA, valid signature, valid integrity, no AI. → verified */
export function verifiedGraph(): EvidenceGraph {
  return mkGraph([
    mkItem({ type: 'c2pa', status: 'valid', id: 'cred' }),
    mkItem({ type: 'signature', status: 'valid', id: 'sig' }),
    mkItem({ type: 'hash', status: 'valid', id: 'hash' }),
  ]);
}

/** Asset B: valid provenance + declared AI-generated. → verified-ai */
export function verifiedAiGraph(): EvidenceGraph {
  return mkGraph([
    mkItem({ type: 'c2pa', status: 'valid', id: 'cred' }),
    mkItem({ type: 'signature', status: 'valid', id: 'sig' }),
    mkItem({ type: 'hash', status: 'valid', id: 'hash' }),
    mkItem({
      type: 'ai-label',
      status: 'valid',
      id: 'ai',
      data: { kind: 'generated', generator: 'demo' },
    }),
  ]);
}

/** Asset D: credential + signature ok, but hash binding failed. → broken */
export function tamperedGraph(): EvidenceGraph {
  return mkGraph([
    mkItem({ type: 'c2pa', status: 'valid', id: 'cred' }),
    mkItem({ type: 'signature', status: 'valid', id: 'sig' }),
    mkItem({ type: 'hash', status: 'invalid', id: 'hash', data: { matches: false } }),
  ]);
}

/** Asset C: no evidence at all. → unknown (no-evidence) */
export function emptyGraph(): EvidenceGraph {
  return mkGraph([]);
}

/** Only soft, AI-shaped evidence (e.g. a VLM guess). → unknown (soft-evidence-only) */
export function softAiOnlyGraph(): EvidenceGraph {
  return mkGraph([
    mkItem({
      type: 'ai-label',
      level: 'soft',
      status: 'valid',
      id: 'vlm-ai',
      data: { kind: 'generated' },
      source: 'vlm-heuristic',
    }),
  ]);
}
