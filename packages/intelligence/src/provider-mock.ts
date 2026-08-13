/**
 * @signet/intelligence — MockIntelligenceProvider.
 *
 * Deterministic, no-network provider for tests and for the "mock" config value.
 * It lets tests exercise the FULL HybridSemanticClassifier path (merge, zod
 * fallback, timeout fallback, error fallback) without any HTTP. The mock is also
 * a legitimate runtime config (`provider: 'mock'`) so the Intelligence UI can be
 * demoed without an API key.
 */
import type {
  AssetSemanticAnalysis,
  ClaimEvidenceLink,
  ClaimEvidenceResult,
  ContextualExplanation,
  IntelligenceProvider,
  PageSemanticInput,
  TrustExplanationInput,
} from './types.js';

import { classifyHeuristicBatch } from './heuristics.js';

export interface MockProviderOptions {
  /** Per-asset partial overrides merged onto the heuristic-derived baseline. */
  readonly analyses?: ReadonlyMap<string, Partial<AssetSemanticAnalysis>>;
  /** Extra claim↔asset links to return (already-shaped). */
  readonly links?: readonly ClaimEvidenceLink[];
  /** Simulate a provider failure (network / crash). The classifier falls back. */
  readonly failWith?: Error;
  /** Simulate latency. If it exceeds the classifier timeout, the call is aborted. */
  readonly delayMs?: number;
  /**
   * Return an arbitrary value as-is (typed via `as`), simulating a model that
   * returned garbage. The classifier's zod safety-net rejects it → fallback.
   * This mirrors reality: the real provider parses a raw model string.
   */
  readonly rawOutput?: unknown;
  /** Knobs for the optional explainEvidence path (Phase G). */
  readonly explainOptions?: {
    /** Canned explanation to return; default is a minimal valid AI explanation. */
    readonly output?: ContextualExplanation;
    /** Simulate a provider failure on the explain path. */
    readonly failWith?: Error;
    /** Simulate latency on the explain path. */
    readonly delayMs?: number;
    /** Return garbage as-is on the explain path → zod rejects → deterministic floor. */
    readonly rawOutput?: unknown;
  };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MockIntelligenceProvider implements IntelligenceProvider {
  constructor(private readonly options: MockProviderOptions = {}) {}

  async classifyPage(input: PageSemanticInput): Promise<ClaimEvidenceResult> {
    if (this.options.delayMs && this.options.delayMs > 0) await delay(this.options.delayMs);
    if (this.options.failWith) throw this.options.failWith;
    if (this.options.rawOutput !== undefined) {
      return this.options.rawOutput as ClaimEvidenceResult;
    }
    // Default: the heuristic baseline, re-tagged 'ai' to exercise the merge path.
    const base = classifyHeuristicBatch(input.assets);
    const overrides = this.options.analyses;
    const assets: AssetSemanticAnalysis[] = base.map((a) => {
      const ov = overrides?.get(a.assetId);
      return ov
        ? { ...a, ...ov, assetId: a.assetId, generatedBy: 'ai' }
        : { ...a, generatedBy: 'ai' };
    });
    return { assets, links: [...(this.options.links ?? [])] };
  }

  async explainEvidence(input: TrustExplanationInput): Promise<ContextualExplanation> {
    const o = this.options.explainOptions;
    if (o?.delayMs && o.delayMs > 0) await delay(o.delayMs);
    if (o?.failWith) throw o.failWith;
    if (o?.rawOutput !== undefined) return o.rawOutput as ContextualExplanation;
    return (
      o?.output ?? {
        assetId: input.assetId,
        text: 'This image functions as supporting context on the page.',
        source: 'ai',
        caveats: [],
      }
    );
  }
}
