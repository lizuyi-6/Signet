/**
 * @signet/intelligence — zod schemas for validating AI provider JSON output.
 *
 * The rule (§13): never `JSON.parse(llmText)` and trust it. Every AI response is
 * parsed through these schemas; any structural failure (wrong enum, missing
 * field, non-object) makes the HybridSemanticClassifier fall back to the
 * deterministic heuristic result. Scores are accepted as bare numbers here and
 * clamped to [0,1] by {@link clamp01} after parsing — the schema asserts
 * STRUCTURE (right shape / right enum), clamping asserts RANGE.
 *
 * The {@link SemanticRoleSchema} literal list MUST stay in sync with the
 * `SemanticRole` union in `@signet/core/domain.ts`. A compile-time test
 * (types.test.ts) assigns the parsed value back to a `SemanticRole` so the TS
 * compiler catches drift in either direction.
 */
import { z } from 'zod';

export const SemanticRoleSchema = z.enum([
  'hero-image',
  'article-evidence',
  'chart',
  'avatar',
  'advertisement',
  'icon',
  'decoration',
  'product-image',
  'screenshot',
  // Intelligence additions:
  'primary-evidence',
  'supporting-evidence',
  'data-visualization',
  'news-photo',
  'illustration',
  'logo',
  'unknown',
]);

export const AnalysisSourceSchema = z.enum(['heuristic', 'ai', 'hybrid']);

export const AssetSemanticAnalysisSchema = z.object({
  assetId: z.string().min(1),
  role: SemanticRoleSchema,
  importance: z.number(),
  evidenceLikelihood: z.number(),
  confidence: z.number(),
  reason: z.string(),
  generatedBy: AnalysisSourceSchema,
});

export const ClaimRelationSchema = z.enum(['supports', 'illustrates', 'contradicts', 'unrelated']);

export const ClaimEvidenceLinkSchema = z.object({
  claimId: z.string().min(1),
  assetId: z.string().min(1),
  relation: ClaimRelationSchema,
  confidence: z.number(),
  reason: z.string(),
});

/** Page-level provider response: every asset's analysis + claim↔asset links. */
export const ClaimEvidenceResultSchema = z.object({
  assets: z.array(AssetSemanticAnalysisSchema),
  links: z.array(ClaimEvidenceLinkSchema),
});

/** AI contextual-explanation response (the deterministic variant is built directly). */
export const ContextualExplanationSchema = z.object({
  assetId: z.string().min(1),
  text: z.string().max(2000),
  source: z.literal('ai'),
  caveats: z.array(z.string()).default([]),
});
