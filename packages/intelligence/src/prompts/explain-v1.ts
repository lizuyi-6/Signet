/**
 * @signet/intelligence — versioned contextual-explanation prompt (v1).
 *
 * Trust-immutability (§59, D19): this prompt is for the EXPLANATION stage only.
 * The model is given the ALREADY-DECIDED trust verdict as input and may restate
 * it — it may never contradict, soften, or re-derive it. The verdict is the
 * cryptographic engine's; the model's sentence is display-only context shown
 * under a "Context" heading, visually separate from the verdict.
 *
 * Privacy (§7): the user message carries ONLY minimal text context (verdict
 * state/reason, role, claim text, relation, page title/domain). The full
 * {@link EvidenceGraph} is deliberately NOT serialized — the model does not
 * need it, and §7's default is to send the least.
 */

export const EXPLAIN_PROMPT_VERSION = 'explain-v1';

/**
 * The system prompt. Versioned so a change in instructions bumps the version
 * (logged alongside every explanation for auditability).
 */
export const EXPLAIN_SYSTEM_PROMPT_V1 = [
  `You are the contextual-explanation stage of Signet, a browser extension that displays content provenance.`,
  `You write ONE short, plain-language sentence explaining what role an image plays on its page and how it relates to the page's claim.`,
  ``,
  `HARD CONSTRAINTS — violating any of these makes your output invalid:`,
  `1. You do NOT judge authenticity, truth, accuracy, "fake", "real", or trust. The trust verdict (Verified / AI Generated / Provenance Broken / Unknown) was ALREADY decided by cryptographic verification and is given to you as input. You may restate it; you may not contradict it, soften it, strengthen it, or re-derive it.`,
  `2. You do NOT decide what the badge shows. Your text is display-only context shown under a "Context" heading, visually separate from the verdict. It has no effect on the verdict.`,
  `3. "illustrates" / "supports" describe how the page uses the image relative to the claim. They NEVER mean the claim is true. Never write that the image proves the claim, and never claim a forecast or number is correct.`,
  `4. If a semantic role or claim relation is missing from the input, do not invent one.`,
  `5. Output ONLY a single JSON object: { "assetId": string, "text": string, "source": "ai", "caveats": string[] }. No prose, no markdown fences.`,
  `6. text must be one or two sentences, at most 2000 characters, plain language. caveats lists what a reader should NOT conclude from the context (e.g. that provenance verifies the claim's numbers).`,
].join('\n');

/** Serialize the minimal privacy-safe context for the user message. */
export function buildExplainUserPromptV1(input: {
  readonly assetId: string;
  readonly trustState: string;
  readonly trustReason: string;
  readonly semanticRole?: string;
  readonly claim?: { readonly id: string; readonly text: string; readonly type: string };
  readonly relation?: { readonly relation: string; readonly confidence: number };
  readonly pageTitle?: string;
  readonly pageDomain?: string;
}): string {
  const payload = {
    assetId: input.assetId,
    trustState: input.trustState,
    trustReason: input.trustReason,
    semanticRole: input.semanticRole ?? null,
    claim: input.claim ?? null,
    relation: input.relation ?? null,
    pageTitle: input.pageTitle ?? null,
    pageDomain: input.pageDomain ?? null,
  };
  // NOTE: deliberately no EvidenceGraph, no image bytes, no URLs beyond the
  // bare domain — minimal context (privacy default, §7).
  return [
    `Write the contextual explanation for this asset. Respond as JSON.`,
    ``,
    `Asset: ${JSON.stringify(payload)}`,
  ].join('\n');
}
