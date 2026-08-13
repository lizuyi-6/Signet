/**
 * @signet/intelligence — versioned provider prompt (v1).
 *
 * Privacy (§7, §58): DOM-FIRST. The prompt carries ONLY text context
 * (alt/title/nearby/heading text + extracted claims) — never raw image bytes,
 * never screenshots, and by default not even the image URL. `allow-image-upload`
 * is an explicit user opt-in handled at the provider call site, not here.
 *
 * Trust-immutability (§59, D19): the system prompt FORBIDS the model from
 * judging authenticity, truth, or trust. It may only classify semantic ROLE and
 * map claims to assets. The output schema (schemas.ts) structurally cannot
 * express a trust verdict, and zod rejects anything that tries. This is a
 * defense-in-depth measure — the real guarantee is the hard/soft seam (D8/D19),
 * which is immune to whatever the model emits.
 */

export const PROMPT_VERSION = 'semantic-v1';

/**
 * The system prompt. Versioned so a change in instructions bumps the version
 * (logged alongside every analysis for auditability).
 */
export const SEMANTIC_SYSTEM_PROMPT_V1 = [
  `You are the semantic-classification stage of Signet, a browser extension that displays content provenance.`,
  `Your ONLY job is to understand what role each image plays on the page and which images illustrate which claims.`,
  ``,
  `HARD CONSTRAINTS — violating any of these makes your output invalid:`,
  `1. You do NOT judge authenticity, truth, accuracy, "fake", "real", or trust. Those are out of scope and decided by separate cryptographic verification.`,
  `2. You classify each asset into exactly one role from this set:`,
  `   hero-image, article-evidence, chart, avatar, advertisement, icon, decoration, product-image, screenshot, primary-evidence, supporting-evidence, data-visualization, news-photo, illustration, logo, unknown.`,
  `3. A claim↔asset relation is one of: supports, illustrates, contradicts, unrelated. "supports" means the asset appears to illustrate or back the claim — it does NOT mean the claim is true.`,
  `4. If you are unsure of an asset's role, output "unknown" rather than guessing. Unknown is acceptable; fabricating a confident role is not.`,
  `5. Output ONLY a single JSON object matching the requested schema. No prose, no markdown fences.`,
  `6. Scores are in [0,1]. importance = how central the asset is to the page's message; evidenceLikelihood = how likely it functions as evidence vs decoration; confidence = your own certainty. None of these are trust scores.`,
].join('\n');

/** Serialize a page's text context for the user message (privacy: text-only). */
export function buildSemanticUserPromptV1(input: {
  readonly pageUrl: string;
  readonly pageTitle?: string;
  readonly headings: readonly string[];
  readonly claims: readonly { readonly id: string; readonly text: string; readonly type: string }[];
  readonly assets: readonly {
    readonly assetId: string;
    readonly altText?: string;
    readonly title?: string;
    readonly nearbyText?: string;
    readonly width: number;
    readonly height: number;
    readonly elementRole?: string;
  }[];
}): string {
  const page = {
    pageTitle: input.pageTitle ?? null,
    headings: input.headings,
    claims: input.claims,
  };
  const assets = input.assets.map((a) => ({
    assetId: a.assetId,
    altText: a.altText ?? null,
    title: a.title ?? null,
    nearbyText: a.nearbyText ?? null,
    width: a.width,
    height: a.height,
    elementRole: a.elementRole ?? null,
  }));
  // NOTE: deliberately no imageUrl, no bytes — context-only (privacy default).
  return [
    `Classify every asset and link claims to assets. Respond as JSON:`,
    `{ "assets": [ { "assetId": string, "role": <role>, "importance": number, "evidenceLikelihood": number, "confidence": number, "reason": string, "generatedBy": "ai" } ], "links": [ { "claimId": string, "assetId": string, "relation": "supports"|"illustrates"|"contradicts"|"unrelated", "confidence": number, "reason": string } ] }`,
    ``,
    `Page: ${JSON.stringify(page)}`,
    `Assets: ${JSON.stringify(assets)}`,
  ].join('\n');
}
