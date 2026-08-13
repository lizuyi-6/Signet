/**
 * @signet/intelligence — OpenAI-compatible chat-completions provider.
 *
 * Talks to any OpenAI-compatible `/v1/chat/completions` endpoint (OpenAI,
 * Azure OpenAI, local Llama/Ollama compat shims, etc.). The API key is supplied
 * at construction (in the extension it is read from `chrome.storage.local`, set
 * via the Options page — never in source). Privacy (§7/D19): this provider sends
 * ONLY text context (per the versioned prompt); it never uploads image bytes in
 * the default `context-only` mode. `allow-image-upload` is a future opt-in and is
 * NOT honored here yet.
 *
 * Robustness contract:
 *  - 8 s (configurable) AbortController timeout;
 *  - non-2xx → throw (classifier falls back);
 *  - response JSON parsed defensively; the provider validates with zod and ALSO
 *    the HybridSemanticClassifier re-validates (defense in depth — a buggy or
 *    hostile endpoint cannot bypass the schema).
 *
 * The fetch implementation is injectable so every failure path (timeout, non-OK,
 * malformed body, missing content) is unit-tested without network (rule 5.3).
 */
import { ClaimEvidenceResultSchema, ContextualExplanationSchema } from './schemas.js';
import {
  PROMPT_VERSION,
  SEMANTIC_SYSTEM_PROMPT_V1,
  buildSemanticUserPromptV1,
} from './prompts/semantic-v1.js';
import { EXPLAIN_SYSTEM_PROMPT_V1, buildExplainUserPromptV1 } from './prompts/explain-v1.js';
import type {
  ClaimEvidenceResult,
  ContextualExplanation,
  IntelligenceProvider,
  PageSemanticInput,
  TrustExplanationInput,
} from './types.js';

export interface OpenAICompatibleOptions {
  /** Full chat-completions URL, e.g. `https://api.openai.com/v1/chat/completions`. */
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch (present in SW + Node ≥18). */
  readonly fetchImpl?: typeof fetch;
}

interface ChatChoice {
  readonly message?: { readonly content?: unknown };
}
interface ChatResponse {
  readonly choices?: readonly ChatChoice[];
}

export class OpenAICompatibleProvider implements IntelligenceProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: OpenAICompatibleOptions) {
    if (!opts.endpoint) throw new Error('OpenAICompatibleProvider: endpoint required');
    if (!opts.apiKey) throw new Error('OpenAICompatibleProvider: apiKey required');
    if (!opts.model) throw new Error('OpenAICompatibleProvider: model required');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  /** Prompt version this provider compiles into its messages (for audit logs). */
  get promptVersion(): string {
    return PROMPT_VERSION;
  }

  async classifyPage(input: PageSemanticInput): Promise<ClaimEvidenceResult> {
    const parsed = await this.chat(SEMANTIC_SYSTEM_PROMPT_V1, buildSemanticUserPromptV1(input));
    return ClaimEvidenceResultSchema.parse(parsed); // throws on schema mismatch
  }

  async explainEvidence(input: TrustExplanationInput): Promise<ContextualExplanation> {
    const parsed = await this.chat(
      EXPLAIN_SYSTEM_PROMPT_V1,
      buildExplainUserPromptV1({
        assetId: input.assetId,
        trustState: input.trust.state,
        trustReason: input.trust.reason,
        semanticRole: input.semanticRole,
        claim: input.pageClaim
          ? { id: input.pageClaim.id, text: input.pageClaim.text, type: input.pageClaim.type }
          : undefined,
        relation: input.claimRelation
          ? {
              relation: input.claimRelation.relation,
              confidence: input.claimRelation.confidence,
            }
          : undefined,
        pageTitle: input.pageContext?.title,
        pageDomain: input.pageContext?.domain,
      }),
    );
    return ContextualExplanationSchema.parse(parsed); // throws on schema mismatch
  }

  /**
   * One chat-completions round-trip: POST the two messages, enforce the
   * AbortController timeout, defensively parse the body. Returns the parsed
   * JSON object from the assistant's message; the CALLER zod-validates it
   * against the stage-specific schema (defense in depth, §13).
   */
  private async chat(system: string, user: string): Promise<unknown> {
    const body = {
      model: this.opts.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.opts.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`provider HTTP ${res.status}`);
      }
      let data: ChatResponse;
      try {
        data = (await res.json()) as ChatResponse;
      } catch (e) {
        throw new Error(`provider returned non-JSON body: ${(e as Error).message}`);
      }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error('provider returned no message content');
      }
      return parseJsonObject(content); // throws on non-JSON
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Parse a JSON object string, throwing a descriptive error on any failure. */
function parseJsonObject(text: string): unknown {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`provider returned non-JSON body: ${(e as Error).message}`);
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('provider returned JSON that is not an object');
  }
  return v;
}
