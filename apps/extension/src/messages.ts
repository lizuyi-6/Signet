/**
 * @signet/extension — message contract shared by all three contexts.
 *
 * Flow (see docs/decisions.md D16):
 *   content script ──verify▶ background SW ──verify▶ offscreen document
 *   content script ◀─result── background SW ◀─result── offscreen document
 *
 * The content script talks to the background service worker only; the SW owns
 * the offscreen document lifecycle and relays. The offscreen document is the
 * sole place `@contentauth/c2pa-web` runs (it spawns a Web Worker, which an MV3
 * service worker cannot host). Each listener acts only on messages addressed to
 * it (`to`) and returns its response from the async listener so Chrome 99+'s
 * promise-based runtime messaging delivers it.
 */
import type { EvidenceItem, TrustReason, TrustState } from '@signet/core';
import type {
  AnalysisSource,
  ClaimEvidenceResult,
  ContextualExplanation,
  IntelligenceStatus,
  PageSemanticInput,
  TrustExplanationInput,
} from '@signet/intelligence';

/** Which context a message is intended for. */
export type Addressee = 'background' | 'offscreen' | 'content';

/** A request to verify the bytes at `url`, originated by the content script. */
export interface VerifyRequest {
  readonly kind: 'verify';
  readonly to: 'background';
  /** Stable id (the asset's absolute URL). */
  readonly assetId: string;
  /** Absolute URL the offscreen document will `fetch()`. */
  readonly url: string;
}

/** Same request, forwarded by the SW to the offscreen document. */
export interface VerifyForward {
  readonly kind: 'verify';
  readonly to: 'offscreen';
  readonly assetId: string;
  readonly url: string;
}

/** The decision for one asset, returned to the content script for rendering. */
export interface VerifyResult {
  readonly kind: 'verify-result';
  readonly assetId: string;
  readonly state: TrustState;
  readonly reason: TrustReason;
  /** True when the engine fell through to `unknown` rather than asserting. */
  readonly failClosed: boolean;
  /** Evidence items that drove the decision (for the detail card). */
  readonly items: readonly EvidenceItem[];
  /** Set when collection itself errored (fail-closed). */
  readonly errorMessage?: string;
}

export type InboundToBackground = VerifyForward | VerifyResult;

// ---------------------------------------------------------------------------
// Intelligence Layer — a SECOND, advisory channel that runs ALONGSIDE the trust
// pipeline. It NEVER touches a VerifyRequest/VerifyResult. The content script
// sends one AnalyzeRequest per page-scan (batch, §45); the background SW hosts
// the HybridSemanticClassifier and returns the merged result. Trust bytes are
// byte-identical whether or not this channel is used.
// ---------------------------------------------------------------------------

/**
 * A page-level semantic analysis request. Carries ONLY text context
 * (`PageSemanticInput` is alt/caption/headings/claims — no image bytes), per
 * the §7 `context-only` privacy default.
 */
export interface AnalyzeRequest {
  readonly kind: 'analyze';
  readonly to: 'background';
  readonly input: PageSemanticInput;
}

/**
 * The advisory semantic result for the whole page. `status` tells the content
 * script HOW to label the enrichment (disabled / ready / fallback); `result`
 * holds the per-asset analyses + claim↔asset links. This is display-only
 * context — it can never promote or demote a `VerifyResult.state`.
 */
export interface AnalyzeResult {
  readonly kind: 'analyze-result';
  readonly to: 'content';
  readonly result: ClaimEvidenceResult;
  readonly status: Exclude<IntelligenceStatus, 'pending' | 'error'>;
  readonly source: AnalysisSource;
  readonly promptVersion: string;
  /** Present when `status === 'fallback'`, for honest UI labeling (§31). */
  readonly error?: string;
}

/**
 * A per-asset contextual-explanation request (Phase H), fired ON DEMAND when
 * the user opens a detail card and AI is live. Carries only the already-decided
 * verdict {state, reason} + advisory semantics — no evidence graph, no image
 * bytes (§7). The SW runs {@link explainEvidenceWithFallback}: any failure
 * yields the deterministic floor, so the card always has a sentence.
 */
export interface ExplainRequest {
  readonly kind: 'explain';
  readonly to: 'background';
  readonly input: TrustExplanationInput;
}

export interface ExplainResult {
  readonly kind: 'explain-result';
  readonly to: 'content';
  readonly explanation: ContextualExplanation;
  readonly source: 'deterministic' | 'ai';
  /** Present when AI was attempted but fell back (honest labeling). */
  readonly error?: string;
}
