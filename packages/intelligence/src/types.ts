/**
 * @signet/intelligence — domain types.
 *
 * The Intelligence Layer UNDERSTANDS the page; it never decides trust. Every
 * type here is advisory/soft: it travels ALONGSIDE the deterministic
 * {@link TrustDecision} (from @signet/trust-engine), never through it. Soft
 * semantic evidence cannot promote an asset to Verified or demote it to Broken
 * — that property is enforced STRUCTURALLY in derive-facts.ts (hard/soft
 * partition), not by anything in this package. See docs/decisions.md D19.
 *
 * Design note (mirrors the evidence / evidence-web split, D15): the heavy
 * consumers (heuristics, providers) operate on plain {@link AssetSemanticInput}
 * data, NOT on live DOM, so the whole package is unit-testable under Node
 * without jsdom. The content script owns the only DOM touch — a thin extractor
 * that produces {@link AssetSemanticInput}.
 */
import type { SemanticRole, TrustDecision, TrustReason, TrustState } from '@signet/core';

// ---------------------------------------------------------------------------
// Inputs (plain data — the content script fills these from the DOM)
// ---------------------------------------------------------------------------

/** One asset's DOM-derived context. The unit of semantic analysis. */
export interface AssetSemanticInput {
  readonly assetId: string;

  readonly altText?: string;
  readonly title?: string;
  /** Text immediately surrounding the asset (caption, adjacent paragraph). */
  readonly nearbyText?: string;
  /** Text of the nearest container that groups the asset (figure/article/section). */
  readonly parentText?: string;

  readonly pageTitle?: string;
  readonly pageDescription?: string;
  /** Nearest heading chain, root → leaf (H1 → H2 → …). */
  readonly headingContext?: readonly string[];

  /** Rendered dimensions, CSS pixels. */
  readonly width: number;
  readonly height: number;

  /** ARIA / semantic role of the element, when known. */
  readonly elementRole?: string;
  /** If the asset is wrapped in a link, its destination. */
  readonly linkTarget?: string;
  readonly imageUrl?: string;
  readonly pageUrl: string;
}

/** Page-level batch input (one provider call per scan, per §45). */
export interface PageSemanticInput {
  readonly pageUrl: string;
  readonly pageTitle?: string;
  readonly pageDescription?: string;
  readonly headings: readonly string[];
  /** Heuristic-extracted candidate claims (Top 3–8). */
  readonly claims: readonly PageClaim[];
  readonly assets: readonly AssetSemanticInput[];
  readonly privacyMode: PrivacyMode;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type AnalysisSource = 'heuristic' | 'ai' | 'hybrid';

/**
 * Per-asset semantic analysis. All score fields are clamped to [0, 1].
 * `generatedBy` records whether this came from heuristics, the AI provider, or
 * a merge of both — so the UI can always label "AI-assisted" honestly (§31).
 */
export interface AssetSemanticAnalysis {
  readonly assetId: string;
  readonly role: SemanticRole;
  /** How central this asset is to the page's message. [0,1]. */
  readonly importance: number;
  /** How likely this asset is functioning as evidence (vs decoration). [0,1]. */
  readonly evidenceLikelihood: number;
  /** Classifier self-confidence. [0,1]. Distinct from trust confidence. */
  readonly confidence: number;
  readonly reason: string;
  readonly generatedBy: AnalysisSource;
}

/** Result of a page-level pass: every asset classified + claim↔asset links. */
export interface ClaimEvidenceResult {
  readonly assets: readonly AssetSemanticAnalysis[];
  readonly links: readonly ClaimEvidenceLink[];
}

/**
 * The full semantic picture attached to one asset (for the detail card). This is
 * the advisory context that sits next to — never replaces — the TrustDecision.
 */
export interface SemanticContext {
  readonly assetId: string;
  readonly role: SemanticRole;
  readonly importance: number;
  readonly evidenceLikelihood: number;
  readonly confidence: number;
  readonly explanation?: string;
  readonly relatedClaims: readonly ClaimEvidenceLink[];
  readonly source: AnalysisSource;
}

// ---------------------------------------------------------------------------
// Claims & claim↔evidence mapping
// ---------------------------------------------------------------------------

export type ClaimType = 'numeric' | 'factual' | 'forecast' | 'comparative' | 'descriptive';

/** A salient proposition the page asserts (headline, lede, caption-driven). */
export interface PageClaim {
  readonly id: string;
  readonly text: string;
  readonly type: ClaimType;
  /** [0,1]; drives Top-N selection. */
  readonly importance: number;
  /** Selector / tag of the element the claim was extracted from. */
  readonly sourceElement?: string;
}

export type ClaimRelation = 'supports' | 'illustrates' | 'contradicts' | 'unrelated';

/**
 * A SEMANTIC relationship between a claim and an asset. This is NOT truth
 * verification (§19): "supports" means "the asset appears to illustrate/back
 * the claim", never "the claim is true".
 */
export interface ClaimEvidenceLink {
  readonly claimId: string;
  readonly assetId: string;
  readonly relation: ClaimRelation;
  /** [0,1]. */
  readonly confidence: number;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Badge policy (the authority on whether/where to show a badge)
// ---------------------------------------------------------------------------

export type BadgePriority = 'high' | 'normal' | 'suppressed';

export interface BadgeDecision {
  readonly show: boolean;
  readonly priority: BadgePriority;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Contextual explanation (display-only; NEVER re-judges trust)
// ---------------------------------------------------------------------------

/**
 * Input to the explainer. Carries ONLY already-decided, structured evidence —
 * the explainer may not re-derive, override, or contradict the trust decision.
 * The verdict is narrowed to `{ state, reason }`: the explainer narrates the
 * state and (for the AI prompt) cites the reason; it has no use for rule ids or
 * the full evidence graph, and the AI path deliberately EXCLUDES evidence from
 * what is sent (§7 privacy default). The extension's content script builds this
 * from its VerifyResult (state/reason) + advisory semantics, with no synthesis.
 */
export interface TrustExplanationInput {
  readonly assetId: string;
  readonly trust: { readonly state: TrustState; readonly reason: TrustReason };
  readonly semanticRole?: SemanticRole;
  readonly pageClaim?: PageClaim;
  readonly claimRelation?: ClaimEvidenceLink;
  readonly pageContext?: { readonly title?: string; readonly domain?: string };
}

export interface ContextualExplanation {
  readonly assetId: string;
  readonly text: string;
  readonly source: 'deterministic' | 'ai';
  /** Hard caveats the UI must surface (e.g. "does not verify the forecast"). */
  readonly caveats: readonly string[];
}

// ---------------------------------------------------------------------------
// Provider abstraction & configuration
// ---------------------------------------------------------------------------

/**
 * A pluggable intelligence source. The primary method is page-level (batch) per
 * §45; `explainEvidence` is optional and only used for the contextual narrative.
 * Implementations MUST validate their own JSON (schemas.ts) and the
 * HybridSemanticClassifier MUST fall back to heuristics on any failure.
 */
export interface IntelligenceProvider {
  classifyPage(input: PageSemanticInput): Promise<ClaimEvidenceResult>;
  explainEvidence?(input: TrustExplanationInput): Promise<ContextualExplanation>;
}

export type PrivacyMode = 'context-only' | 'allow-image-upload';

export type IntelligenceProviderKind = 'disabled' | 'mock' | 'openai-compatible';

/**
 * Configuration. API keys live in `chrome.storage.local` (set via the Options
 * page) and never in source. When `provider === 'disabled'` or `enabled === false`,
 * Signet runs exactly as it did before the Intelligence Layer existed.
 */
export interface IntelligenceConfig {
  readonly enabled: boolean;
  readonly provider: IntelligenceProviderKind;
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly timeoutMs: number;
  readonly privacyMode: PrivacyMode;
}

/**
 * Default: intelligence OFF, context-only privacy. The layer is opt-in; with the
 * default config the extension behaves identically to pre-Intelligence Signet.
 */
export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig = {
  enabled: false,
  provider: 'disabled',
  timeoutMs: 8000,
  privacyMode: 'context-only',
};

// ---------------------------------------------------------------------------
// Runtime state (per asset) — keeps trust and intelligence layers visibly split
// (§31, §60). `trust` is the deterministic verdict; `semantics` is advisory.
// ---------------------------------------------------------------------------

export type IntelligenceStatus = 'disabled' | 'pending' | 'ready' | 'fallback' | 'error';

export interface SignetAssetState {
  readonly trust: TrustDecision;
  readonly semantics?: SemanticContext;
  readonly intelligenceStatus: IntelligenceStatus;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Clamp to [0,1]; NaN/Infinity collapse to 0 (fail-closed for scores). */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Type guard for the analysis-source union (used on parsed AI JSON). */
export function isAnalysisSource(s: unknown): s is AnalysisSource {
  return s === 'heuristic' || s === 'ai' || s === 'hybrid';
}
