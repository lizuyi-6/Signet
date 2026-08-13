/**
 * @signet/extension/content — orchestrator (content script entry).
 *
 * Responsibilities:
 *   1. Scan the page for badge-eligible images.
 *   2. Mount a pending {@link TrustOverlay} on each.
 *   3. Ask the background service worker to verify each asset's bytes.
 *   4. On the result, render the badge state and (on click) the detail card.
 *   5. Keep overlays positioned over their images on scroll/resize, and pick up
 *      images added later via a debounced MutationObserver.
 *
 * Two modes, switched by the Intelligence config (chrome.storage.local):
 *   - **Legacy (intelligence OFF, the default):** runs {@link processLegacy},
 *     which is byte-identical to pre-Intelligence Signet — {@link scanImages}
 *     pre-suppresses icons/avatars/decoration, verify + badge. No intelligence
 *     code runs; no `analyze` message is sent.
 *   - **Intelligence (intelligence ON):** runs {@link processIntelligence} —
 *     scans ALL qualifying images with DOM context, applies the heuristic
 *     classifier LOCALLY for immediate enrichment (no flash), verifies EVERY
 *     eligible asset (independent of semantic suppression), and defers the
 *     mount/suppress decision to the final display policy
 *     ({@link reconcileDisplay} → {@link decideFinalDisplay}), which can never
 *     hide a `broken` verdict (§17). Then it sends ONE batched `analyze`
 *     request; the hybrid result refines the enrichment. The trust pipeline
 *     (verify → badge) is the SAME verify message either way — semantics
 *     never gate or alter trust.
 *
 * This module never touches C2PA / WASM directly — that lives in the offscreen
 * document (D16). It only renders trust states the engine has already decided.
 */
import type {
  AnalyzeRequest,
  AnalyzeResult,
  ExplainRequest,
  ExplainResult,
  VerifyRequest,
  VerifyResult,
} from '../messages';
import { loadConfig, onConfigChange } from '../intelligence-config';
import {
  badgePolicy,
  buildDeterministicExplanation,
  cacheKeyFor,
  classifyHeuristicBatch,
  decideFinalDisplay,
  selectTopClaims,
  type AnalysisSource,
  type AssetSemanticAnalysis,
  type AssetSemanticInput,
  type ClaimEvidenceLink,
  type ClaimEvidenceResult,
  type ContextualExplanation,
  type IntelligenceConfig,
  type PageClaim,
  type PageSemanticInput,
  type TrustExplanationInput,
} from '@signet/intelligence';
import type { ContentAsset } from '@signet/core';

import { TrustOverlay, type SemanticPicture } from './badge';
import { collectClaimCandidates } from './claims';
import { collectPageHeadings, findImageByUrl, scanImages, scanImagesWithSemantics } from './scan';

const overlays = new Map<string, TrustOverlay>(); // url → overlay
const inflight = new Set<string>(); // url → verify in flight
const verified = new Set<string>(); // url → already has a result
let repositionRaf = 0;
let processTimer: number | null = null;

// --- Intelligence mode state -------------------------------------------------
/** Mirrors `config.enabled`. When false, the legacy path runs exclusively. */
let intelligenceEnabled = false;
/** True when intelligence is ON and a provider other than 'disabled' is set. */
let aiConfigured = false;
/** Last scanned assets (url → asset+semantic), used to apply analyze results. */
const lastScannedAssets = new Map<
  string,
  { readonly asset: ContentAsset; readonly semantic: AssetSemanticInput }
>();
let analyzeTimer: number | null = null;
let analyzeInflight = false;
let analyzeDirty = false;
let lastSentFingerprint = '';
let pendingSemantics: readonly AssetSemanticInput[] = [];

// --- Per-url advisory state (Phase H) ----------------------------------------
/** The last trust result per url, for building the explanation input. */
const verifyResults = new Map<string, VerifyResult>();
/** The current analysis + its source per url (heuristic first, hybrid later). */
const analysesByUrl = new Map<
  string,
  { readonly analysis: AssetSemanticAnalysis; readonly source: AnalysisSource }
>();
/** Claim↔asset links from the latest analyze result (url → its links). */
let linksByUrl = new Map<string, readonly ClaimEvidenceLink[]>();
/** claimId → claim, from the claims selected at analyze time. */
let claimsById = new Map<string, PageClaim>();
/** How the last analyze call ended — gates the on-demand AI explain request. */
let analyzeStatus: 'disabled' | 'ready' | 'fallback' | null = null;
/** AI-enriched explanations (replace the deterministic floor when they land). */
const explanationsByUrl = new Map<string, ContextualExplanation>();
/** Fire at most one explain request per asset per page state. */
const explainState = new Map<string, 'requested' | 'done'>();

function scheduleReposition(): void {
  if (repositionRaf) return;
  repositionRaf = window.requestAnimationFrame(() => {
    repositionRaf = 0;
    for (const ov of overlays.values()) ov.reposition();
  });
}

async function verify(url: string): Promise<void> {
  if (inflight.has(url) || verified.has(url)) return;
  inflight.add(url);
  const req: VerifyRequest = { kind: 'verify', to: 'background', assetId: url, url };
  try {
    const res = (await chrome.runtime.sendMessage(req)) as VerifyResult | undefined;
    if (res && res.kind === 'verify-result' && res.assetId === url) {
      verified.add(url);
      verifyResults.set(url, res);
      if (analysesByUrl.has(url)) {
        // Intelligence mode: the FINAL display policy reconciles the verdict
        // with the semantic decision — a broken verdict mounts its badge even
        // if semantics had suppressed the asset (§17 Trust Visibility
        // Invariant).
        reconcileDisplay(url);
      } else {
        // Legacy mode (intelligence OFF): no semantic entry, render directly.
        overlays.get(url)?.setResult(res);
        refreshPicture(url); // explanation now narrates the REAL verdict
      }
    }
  } catch {
    // The SW may be asleep or the channel closed. Leave the pending badge in
    // place — visually fail-closed (no false "verified").
  } finally {
    inflight.delete(url);
  }
}

// --- Semantic picture assembly (Phase H) --------------------------------------
/**
 * Build the advisory SemanticPicture for one asset from everything known so
 * far: the trust verdict (or a pending placeholder), the current analysis, its
 * links, the claim texts, and the best available explanation (AI if one
 * landed, else the deterministic floor). Pure display data — none of it feeds
 * back into the trust pipeline.
 */
function pictureFor(url: string): SemanticPicture | null {
  const entry = analysesByUrl.get(url);
  if (!entry) return null;
  const links = linksByUrl.get(url) ?? [];
  const vr = verifyResults.get(url);
  const trust = vr
    ? { state: vr.state, reason: vr.reason }
    : { state: 'unknown' as const, reason: 'no-evidence' as const };
  const bestLink = links[0];
  const bestClaim = bestLink ? claimsById.get(bestLink.claimId) : undefined;
  const explanation =
    explanationsByUrl.get(url) ??
    buildDeterministicExplanation({
      assetId: url,
      trust,
      semanticRole: entry.analysis.role,
      ...(bestClaim ? { pageClaim: bestClaim } : {}),
      ...(bestLink ? { claimRelation: bestLink } : {}),
      pageContext: { title: document.title || undefined, domain: location.hostname },
    });
  return {
    analysis: entry.analysis,
    source: entry.source,
    links,
    claims: claimsById,
    explanation,
  };
}

function refreshPicture(url: string): void {
  const picture = pictureFor(url);
  if (picture) overlays.get(url)?.setSemantics(picture);
}

/** The explain request input for one asset (same data the picture narrates). */
function explainInputFor(url: string): TrustExplanationInput | null {
  const entry = analysesByUrl.get(url);
  if (!entry) return null;
  const vr = verifyResults.get(url);
  const trust = vr
    ? { state: vr.state, reason: vr.reason }
    : { state: 'unknown' as const, reason: 'no-evidence' as const };
  const bestLink = (linksByUrl.get(url) ?? [])[0];
  const bestClaim = bestLink ? claimsById.get(bestLink.claimId) : undefined;
  return {
    assetId: url,
    trust,
    semanticRole: entry.analysis.role,
    ...(bestClaim ? { pageClaim: bestClaim } : {}),
    ...(bestLink ? { claimRelation: bestLink } : {}),
    pageContext: { title: document.title || undefined, domain: location.hostname },
  };
}

/**
 * Fire the on-demand AI explanation for one asset — ONLY when the analyze call
 * was AI-live (status 'ready'; heuristic/fallback pages get the deterministic
 * floor and no extra provider call) and only once per asset per page state.
 * Any failure is already handled by the SW (fallback → deterministic floor).
 */
function maybeExplain(url: string): void {
  if (analyzeStatus !== 'ready') return;
  if (explainState.has(url)) return;
  const input = explainInputFor(url);
  if (!input) return;
  explainState.set(url, 'requested');
  const req: ExplainRequest = { kind: 'explain', to: 'background', input };
  void (async () => {
    try {
      const res = (await chrome.runtime.sendMessage(req)) as ExplainResult | undefined;
      if (res && res.kind === 'explain-result' && res.explanation.assetId === url) {
        explainState.set(url, 'done');
        if (res.source === 'ai') {
          explanationsByUrl.set(url, res.explanation);
          refreshPicture(url);
        }
      }
    } catch {
      // SW asleep: the deterministic floor already rendered. Nothing to do.
    }
  })();
}

function ensureOverlay(url: string): TrustOverlay | null {
  const existing = overlays.get(url);
  if (existing) return existing;
  const img = findImageByUrl(url);
  if (!img) return null;
  const ov = new TrustOverlay(img, () => void maybeExplain(url));
  overlays.set(url, ov);
  return ov;
}

function removeOverlay(url: string): void {
  const ov = overlays.get(url);
  if (!ov) return;
  ov.destroy();
  overlays.delete(url);
  verified.delete(url);
}

/**
 * Recompute the FINAL display decision for one asset from current state and
 * apply it. This is the "Final Display Policy" stage of the pipeline (§13):
 * it combines the trust verdict (when known) with the semantic badge decision,
 * so a `broken` verdict can never be hidden by a later semantic "suppress"
 * (§17 — the Trust Visibility Invariant). Verification itself is triggered
 * separately and unconditionally; this function only mounts/removes the badge.
 */
function reconcileDisplay(url: string): void {
  const entry = lastScannedAssets.get(url);
  const analysis = analysesByUrl.get(url)?.analysis;
  if (!entry || !analysis) return;
  const trust = verifyResults.get(url);
  const decision = decideFinalDisplay(trust, badgePolicy.shouldShow(entry.asset, analysis));
  if (decision.show) {
    const ov = ensureOverlay(url);
    if (ov) {
      if (trust) ov.setResult(trust);
      refreshPicture(url);
    }
  } else {
    removeOverlay(url);
  }
}

function pruneGoneOverlays(): void {
  // Iterate a snapshot — removeOverlay mutates the map.
  for (const url of [...overlays.keys()]) {
    if (!findImageByUrl(url)) removeOverlay(url);
  }
}

// --- Legacy path (intelligence OFF) — byte-identical to pre-Intelligence ------
function processLegacy(): void {
  for (const a of scanImages()) {
    if (!a.url) continue;
    if (ensureOverlay(a.url)) void verify(a.url);
  }
  pruneGoneOverlays();
}

// --- Intelligence path (intelligence ON) --------------------------------------
function processIntelligence(): void {
  const items = scanImagesWithSemantics();
  lastScannedAssets.clear();

  // Immediate LOCAL heuristic pass: pure, synchronous, microseconds. This gives
  // a calm first paint (logos/decoration suppressed before any badge mounts)
  // without waiting on the provider round-trip.
  const heuristic = classifyHeuristicBatch(items.map((i) => i.semantic));
  const heuristicById = new Map(heuristic.map((a) => [a.assetId, a]));
  const semanticsForBatch: AssetSemanticInput[] = [];

  for (const item of items) {
    const url = item.asset.url;
    if (!url) continue; // ContentAsset.url is optional; skip unverifiable assets.
    lastScannedAssets.set(url, item);
    semanticsForBatch.push(item.semantic);
    const analysis = heuristicById.get(item.asset.id);
    if (!analysis) continue;
    analysesByUrl.set(url, { analysis, source: 'heuristic' });
    // Verification is INDEPENDENT of semantic visibility (§11/§12): every
    // eligible asset is verified — even a logo/decoration the badge policy
    // would suppress — so a cryptographic failure can always surface. The
    // FINAL display decision (mount vs suppress) is reconcileDisplay's job.
    void verify(url);
    reconcileDisplay(url);
  }
  pruneGoneOverlays();

  if (aiConfigured) scheduleAnalyze(semanticsForBatch);
}

function process(): void {
  if (intelligenceEnabled) processIntelligence();
  else processLegacy();
}

function scheduleProcess(): void {
  if (processTimer !== null) clearTimeout(processTimer);
  processTimer = window.setTimeout(process, 200);
}

// --- Batched analyze request (one provider call per settled page state) -------
function scheduleAnalyze(semantics: readonly AssetSemanticInput[]): void {
  // Debounce: a burst of mutations collapses into one call 300ms after the last.
  if (analyzeTimer !== null) clearTimeout(analyzeTimer);
  pendingSemantics = semantics;
  analyzeTimer = window.setTimeout(() => void flushAnalyze(), 300);
}

async function flushAnalyze(): Promise<void> {
  analyzeTimer = null;
  // Build the FULL page-semantic input first: the dedup fingerprint must cover
  // every field the classifier keys on — pageUrl, pageTitle, headings, claims,
  // and each asset's altText/nearbyText — not just the asset URL set (§ J4).
  // Otherwise an SPA content change that leaves the image set unchanged would
  // be silently skipped and the AI layer would keep serving a stale analysis.
  const claims: PageClaim[] = selectTopClaims(collectClaimCandidates());
  const input: PageSemanticInput = {
    pageUrl: location.href,
    pageTitle: document.title || undefined,
    headings: collectPageHeadings(),
    claims, // Phase F: Top 3–8 salient page propositions (advisory; §19 claim≠truth)
    assets: pendingSemantics,
    privacyMode: 'context-only', // content script never sends image bytes (§7)
  };
  const fp = cacheKeyFor(input);
  if (fp === lastSentFingerprint) return;
  if (analyzeInflight) {
    // A provider call is in flight; re-send once it lands if the page changed.
    analyzeDirty = true;
    return;
  }
  lastSentFingerprint = fp;
  claimsById = new Map(claims.map((c) => [c.id, c])); // for rendering linked claims
  analyzeInflight = true;
  try {
    const req: AnalyzeRequest = { kind: 'analyze', to: 'background', input };
    const res = (await chrome.runtime.sendMessage(req)) as AnalyzeResult | undefined;
    if (res && res.kind === 'analyze-result') applyAnalyzeResult(res.result, res.status);
  } catch {
    // SW asleep / channel closed. The local heuristic enrichment already
    // applied; no false "AI-verified" state is possible (semantics are advisory).
  } finally {
    analyzeInflight = false;
    if (analyzeDirty) {
      analyzeDirty = false;
      void flushAnalyze();
    }
  }
}

function applyAnalyzeResult(result: ClaimEvidenceResult, status: AnalyzeResult['status']): void {
  analyzeStatus = status;
  const byId = new Map(result.assets.map((a) => [a.assetId, a]));
  // Index links by asset for picture assembly.
  const links = new Map<string, ClaimEvidenceLink[]>();
  for (const l of result.links) {
    const list = links.get(l.assetId);
    if (list) list.push(l);
    else links.set(l.assetId, [l]);
  }
  linksByUrl = links;
  for (const [url] of lastScannedAssets) {
    const analysis = byId.get(url);
    if (!analysis) continue; // AI omitted this asset → heuristic enrichment stays.
    analysesByUrl.set(url, {
      analysis,
      source: analysis.generatedBy === 'ai' ? 'ai' : analysis.generatedBy,
    });
    // Reconcile: AI may refine the role to a suppressed one, but a `broken`
    // verdict still overrides suppression (§17). No semantic signal hides it.
    reconcileDisplay(url);
  }
}

// --- Config + mode switching --------------------------------------------------
function applyConfig(config: IntelligenceConfig): boolean {
  const newEnabled = config.enabled;
  const newAi = config.enabled && config.provider !== 'disabled';
  const changed = newEnabled !== intelligenceEnabled || newAi !== aiConfigured;
  intelligenceEnabled = newEnabled;
  aiConfigured = newAi;
  return changed;
}

function resetOverlays(): void {
  for (const url of [...overlays.keys()]) removeOverlay(url);
  lastSentFingerprint = '';
  lastScannedAssets.clear();
  verifyResults.clear();
  analysesByUrl.clear();
  linksByUrl = new Map();
  claimsById = new Map();
  analyzeStatus = null;
  explanationsByUrl.clear();
  explainState.clear();
}

function init(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  // Attach listeners synchronously so nothing is missed while config loads.
  window.addEventListener('scroll', scheduleReposition, { passive: true, capture: true });
  window.addEventListener('resize', scheduleReposition, { passive: true });
  const mo = new MutationObserver(scheduleProcess);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  void (async () => {
    const config = await loadConfig();
    applyConfig(config);
    process();
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => process(), { once: true });
    }
    // Live mode-switch: if the user toggles intelligence in Options, reset and
    // re-process so the badge set matches the new mode without a reload.
    onConfigChange((next) => {
      if (applyConfig(next)) {
        resetOverlays();
        process();
      }
    });
  })();
}

init();
