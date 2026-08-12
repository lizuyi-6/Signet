/**
 * @signet/core — evidence model
 *
 * Evidence is intentionally modelled as a flat list of {@link EvidenceItem}s
 * plus a graph view ({@link EvidenceGraph}). Provenance producers (C2PA SDK,
 * metadata readers, AI-label parsers) emit items; the Trust Engine reasons over
 * them.
 *
 * The single most important distinction in this model is
 * {@link EvidenceLevel}: `hard` evidence can produce `verified`/`broken`/`verified-ai`;
 * `soft` evidence never can.
 */
import type { AssetId, EvidenceId } from './domain.js';

/**
 * Category of evidence. Maps roughly onto the source subsystem that produced it.
 */
export type EvidenceType =
  | 'c2pa' // C2PA / Content Credential manifest
  | 'signature' // cryptographic signature over a manifest/asset
  | 'hash' // hash binding between a manifest and the current asset bytes
  | 'metadata' // trusted metadata (EXIF/IPTC/XMP) with provenance value
  | 'ai-label' // a declared AI-generated / AI-edited label
  | 'source' // first-party / publisher source attribution
  | 'semantic'; // model-derived or heuristic signal (soft only)

/**
 * The trust weight of an evidence item. This is the load-bearing axis.
 *
 * - `hard`: cryptographic / signed / hash-bound. CAN contribute to verified /
 *   verified-ai / broken.
 * - `soft`: model/heuristic/contextual. CANNOT produce verified or broken on
 *   its own — at most yields an additional contextual warning.
 */
export type EvidenceLevel = 'hard' | 'soft';

/**
 * Verification status of a single item.
 *
 * - `valid`: verified successfully.
 * - `invalid`: explicitly failed (bad signature, hash mismatch, corrupted).
 * - `unknown`: could not be determined (parse error, missing data, unsupported).
 *
 * The Trust Engine is fail-closed on `unknown`: it never promotes an item to
 * `verified` unless the relevant hard items are explicitly `valid`.
 */
export type EvidenceStatus = 'valid' | 'invalid' | 'unknown';

/**
 * A single piece of evidence attached to an asset.
 *
 * `data` is intentionally `unknown` at the structural level so the engine stays
 * decoupled from producer-specific shapes. Consumers narrow it to the typed
 * payloads below (or their own) when they need field-level detail for the
 * detail-card / technical view.
 */
export interface EvidenceItem {
  readonly id: EvidenceId;

  readonly type: EvidenceType;

  readonly level: EvidenceLevel;

  readonly status: EvidenceStatus;

  /**
   * Producer-specific payload. See {@link C2PAEvidenceData}, {@link HashEvidenceData},
   * {@link AILabelEvidenceData} for the intended shapes — producers SHOULD emit
   * one of these, but the engine does not require it.
   */
  readonly data: unknown;

  /** Human-readable origin, e.g. "c2pa-sdk", "exif-reader", "gemini-vlm". */
  readonly source: string;

  /** ISO-8601 timestamp when the evidence was produced/observed. */
  readonly timestamp?: string;

  /** Free-form note for diagnostics (e.g. a parse-error message). */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Intended `data` payloads. Producers emit these; the engine narrows when it
// needs detail. Kept loose (most fields optional) because real-world provenance
// is messy.
// ---------------------------------------------------------------------------

/** Shape of `data` for a `c2pa` evidence item. */
export interface C2PAEvidenceData {
  /** Manifest label / claim generator, e.g. "Adobe Photoshop", "Sony A7R IV". */
  readonly claimGenerator?: string;
  readonly signer?: {
    readonly name?: string;
    readonly trusted?: boolean;
  };
  readonly actions?: readonly ProvenanceAction[];
}

/** Shape of `data` for a `hash` evidence item. */
export interface HashEvidenceData {
  readonly algorithm?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly matches?: boolean;
}

/** Shape of `data` for an `ai-label` evidence item. */
export interface AILabelEvidenceData {
  /** What kind of AI involvement is declared. */
  readonly kind: 'generated' | 'edited' | 'trained-on' | 'unknown';
  readonly generator?: string;
}

/**
 * One step in a provenance history (for the timeline UI). Not evidence itself —
 * it is descriptive metadata usually carried inside a C2PA manifest.
 */
export interface ProvenanceAction {
  readonly action: string;
  readonly when?: string;
  readonly actor?: string;
}

// ---------------------------------------------------------------------------
// Evidence graph
// ---------------------------------------------------------------------------

export type EvidenceNodeKind =
  | 'asset'
  | 'credential'
  | 'signer'
  | 'signature'
  | 'hash'
  | 'action'
  | 'ai-declaration'
  | 'source'
  | 'integrity';

export interface EvidenceNode {
  readonly id: string;
  readonly kind: EvidenceNodeKind;
  readonly label: string;
  readonly status?: EvidenceStatus;
  /** Optional reference back to the evidence item this node represents. */
  readonly evidenceId?: EvidenceId;
  readonly detail?: Record<string, unknown>;
}

export interface EvidenceEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
}

/**
 * The full provenance picture for one asset: a flat evidence list (for the
 * decision engine) plus a graph (for the timeline / detail card UI). The
 * decision engine only needs `items`; the graph is for human presentation.
 */
export interface EvidenceGraph {
  readonly assetId: AssetId;
  readonly items: readonly EvidenceItem[];
  readonly nodes?: readonly EvidenceNode[];
  readonly edges?: readonly EvidenceEdge[];

  /**
   * Set by collectors when the gathering process itself failed (SDK throw,
   * network error, parse error). The Trust Engine treats a truthy value as
   * fail-closed → `unknown` unless a definitive `broken` signal is present.
   */
  readonly verificationError?: boolean;
  readonly errorMessage?: string;
}
