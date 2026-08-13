/**
 * @signet/intelligence — HybridSemanticClassifier.
 *
 * The safety-bearing orchestrator. It ALWAYS computes the deterministic
 * heuristic result first (the floor), then — if a provider is configured and
 * enabled — attempts the AI call with a timeout. On ANY failure (network error,
 * timeout/abort, non-2xx, malformed JSON, or zod schema mismatch) it falls back
 * to the heuristic floor. This is the §14 invariant: "AI failure → heuristic
 * fallback, never an exception, never a missing analysis."
 *
 * Defense in depth (§13): the provider is REQUIRED to validate its own output,
 * AND this classifier re-validates with {@link ClaimEvidenceResultSchema}. A
 * buggy or hostile provider cannot bypass the schema — the worst it can do is
 * trigger fallback, which is always safe because heuristic output is soft.
 *
 * Merge policy: the scanner (content script) is the source of truth for WHICH
 * assets exist. AI may only enrich scanner-found assets; it cannot add new ones.
 * For each scanner asset: if AI returned a valid analysis, it wins (tagged
 * `'hybrid'`, scores re-clamped to [0,1]); otherwise the heuristic floor fills
 * in (tagged `'heuristic'`). Every asset in the output has an analysis.
 *
 * SAFETY (D19): nothing here touches a TrustDecision. The output is advisory
 * soft context. The hard/soft seam in derive-facts.ts is what makes soft
 * evidence structurally unable to promote/demote trust — independently of this
 * classifier.
 */
import { classifyHeuristicBatch } from './heuristics.js';
import { mapClaimsToAssetsHeuristic } from './mapping.js';
import { ClaimEvidenceResultSchema } from './schemas.js';
import { PROMPT_VERSION } from './prompts/semantic-v1.js';
import type { SemanticCache } from './cache.js';
import type {
  AnalysisSource,
  ClaimEvidenceResult,
  IntelligenceConfig,
  IntelligenceProvider,
  IntelligenceStatus,
  PageSemanticInput,
} from './types.js';
import { clamp01 } from './types.js';

export interface HybridClassifierOptions {
  readonly config: IntelligenceConfig;
  readonly provider?: IntelligenceProvider;
  readonly cache?: SemanticCache;
}

export interface ClassificationOutcome {
  readonly result: ClaimEvidenceResult;
  /** disabled = AI off; ready = AI (or cache) contributed; fallback = AI failed → heuristic. */
  readonly status: Exclude<IntelligenceStatus, 'pending' | 'error'>;
  /** Dominant source across the result's assets, for honest UI labeling (§31). */
  readonly source: AnalysisSource;
  readonly promptVersion: string;
  readonly cached: boolean;
  /** When status === 'fallback', the human-readable failure reason (for telemetry/UI). */
  readonly error?: string;
}

export class HybridSemanticClassifier {
  constructor(private readonly opts: HybridClassifierOptions) {}

  async classifyPage(input: PageSemanticInput): Promise<ClassificationOutcome> {
    const heuristicAssets = classifyHeuristicBatch(input.assets);
    // Heuristic claim↔asset floor (Phase F): produced from the SAME claims/assets
    // the AI sees, so even with AI OFF the result carries advisory links. Pure.
    const heuristicLinks = mapClaimsToAssetsHeuristic(input.claims, heuristicAssets, input.assets);
    const heuristicResult: ClaimEvidenceResult = { assets: heuristicAssets, links: heuristicLinks };

    const aiEnabled =
      this.opts.config.enabled && this.opts.config.provider !== 'disabled' && !!this.opts.provider;

    if (!aiEnabled) {
      return {
        result: heuristicResult,
        status: 'disabled',
        source: 'heuristic',
        promptVersion: PROMPT_VERSION,
        cached: false,
      };
    }

    const cache = this.opts.cache;
    if (cache) {
      const hit = cache.getFor(input);
      if (hit) {
        return {
          result: hit,
          status: 'ready',
          source: dominantSource(hit.assets),
          promptVersion: PROMPT_VERSION,
          cached: true,
        };
      }
    }

    try {
      const raw = await this.callWithTimeout(
        () => this.opts.provider!.classifyPage(input),
        this.opts.config.timeoutMs,
      );
      // SAFETY NET — re-validate even though the provider should have. This is
      // the line that makes "hostile/buggy provider" → fallback, not → bad data.
      const validated = ClaimEvidenceResultSchema.parse(raw);
      const merged = merge(heuristicResult, validated);
      cache?.setFor(input, merged);
      return {
        result: merged,
        status: 'ready',
        source: 'hybrid',
        promptVersion: PROMPT_VERSION,
        cached: false,
      };
    } catch (e) {
      return {
        result: heuristicResult,
        status: 'fallback',
        source: 'heuristic',
        promptVersion: PROMPT_VERSION,
        cached: false,
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      };
    }
  }

  /** Race the provider call against a hard timeout. Rejects on either failure. */
  private async callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return fn();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`intelligence provider timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([fn(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Merge AI analyses onto the heuristic floor. AI enriches; it cannot add or
 * remove scanner-found assets. AI-winning analyses are tagged `'hybrid'` and
 * score-clamped; AI-omitted assets keep their heuristic analysis.
 *
 * Links are UNIONED by (claimId, assetId): AI is the refined source and wins
 * collisions; heuristic links fill any pair AI omitted. This keeps the advisory
 * mapping continuous across AI success/failure — losing the AI call never loses
 * a link the heuristic floor had established.
 */
function merge(heuristic: ClaimEvidenceResult, ai: ClaimEvidenceResult): ClaimEvidenceResult {
  const aiById = new Map(ai.assets.map((a) => [a.assetId, a]));
  const assets = heuristic.assets.map((h) => {
    const a = aiById.get(h.assetId);
    if (!a) return h; // AI omitted → heuristic floor
    return {
      assetId: a.assetId,
      role: a.role,
      importance: clamp01(a.importance),
      evidenceLikelihood: clamp01(a.evidenceLikelihood),
      confidence: clamp01(a.confidence),
      reason: a.reason,
      generatedBy: 'hybrid' as const,
    };
  });
  // AI links win on (claimId, assetId) collision; heuristic fills the gaps.
  const aiLinkKeys = new Set(ai.links.map((l) => `${l.claimId}|${l.assetId}`));
  const heuristicKept = heuristic.links.filter((l) => !aiLinkKeys.has(`${l.claimId}|${l.assetId}`));
  return { assets, links: [...ai.links, ...heuristicKept] };
}

/** The source label to show when an entire result is summarized as one source. */
function dominantSource(
  assets: readonly { readonly generatedBy: AnalysisSource }[],
): AnalysisSource {
  if (assets.length === 0) return 'heuristic';
  const hasHybrid = assets.some((a) => a.generatedBy === 'hybrid');
  const hasAi = assets.some((a) => a.generatedBy === 'ai');
  if (hasHybrid) return 'hybrid';
  if (hasAi) return 'ai';
  return 'heuristic';
}
