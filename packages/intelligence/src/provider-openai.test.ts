import { describe, expect, it } from 'vitest';

import { OpenAICompatibleProvider } from './index.js';
import type { PageSemanticInput, TrustExplanationInput } from './index.js';

function mkPage(): PageSemanticInput {
  return {
    pageUrl: 'https://example.com/a',
    headings: [],
    claims: [],
    privacyMode: 'context-only',
    assets: [{ assetId: 'a1', width: 800, height: 600, pageUrl: 'https://example.com/a' }],
  };
}

function mkExplain(): TrustExplanationInput {
  return {
    assetId: 'a1',
    trust: { state: 'verified', reason: 'valid-credential' },
    semanticRole: 'chart',
    pageClaim: { id: 'clm_1', text: 'Inflation eased', type: 'numeric', importance: 0.9 },
    claimRelation: {
      claimId: 'clm_1',
      assetId: 'a1',
      relation: 'illustrates',
      confidence: 0.8,
      reason: 'r',
    },
    pageContext: { title: 'Report', domain: 'example.com' },
  };
}

/** Build a stub Response from a chat-completions-shaped body. */
function okResponse(content: unknown): Response {
  const body = JSON.stringify({ choices: [{ message: { content } }] });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const baseOpts = {
  endpoint: 'https://example.test/v1/chat/completions',
  apiKey: 'k',
  model: 'm',
  timeoutMs: 2000,
};

describe('OpenAICompatibleProvider — happy path', () => {
  it('parses a well-formed JSON response', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = ((url: string, init: RequestInit) => {
      captured = { url, init };
      // Real OpenAI-compatible APIs return the JSON object STRINGIFIED inside
      // message.content (esp. with response_format: json_object).
      return Promise.resolve(
        okResponse(
          JSON.stringify({
            assets: [
              {
                assetId: 'a1',
                role: 'chart',
                importance: 0.9,
                evidenceLikelihood: 0.9,
                confidence: 0.8,
                reason: 'r',
                generatedBy: 'ai',
              },
            ],
            links: [],
          }),
        ),
      );
    }) as typeof fetch;
    const p = new OpenAICompatibleProvider({ ...baseOpts, fetchImpl });
    const out = await p.classifyPage(mkPage());
    expect(out.assets[0]?.role).toBe('chart');
    // Privacy: request body must NOT contain any image bytes / asset URLs —
    // only text context. Assert it carries the model + messages, not bytes.
    const bodyStr = String(captured!.init.body);
    expect(bodyStr).toContain('"model":"m"');
    expect(bodyStr).toContain('"temperature":0');
    expect(bodyStr).not.toMatch(/data:image|base64/);
  });
});

describe('OpenAICompatibleProvider — failure modes (all must throw → classifier fallback)', () => {
  it('throws on non-2xx HTTP', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('{"error":"rate limited"}', { status: 429 }))) as typeof fetch;
    const p = new OpenAICompatibleProvider({ ...baseOpts, fetchImpl });
    await expect(p.classifyPage(mkPage())).rejects.toThrow(/HTTP 429/);
  });

  it('throws when the body is not valid JSON', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('not json at all', { status: 200 }))) as typeof fetch;
    const p = new OpenAICompatibleProvider({ ...baseOpts, fetchImpl });
    await expect(p.classifyPage(mkPage())).rejects.toThrow(/non-JSON/);
  });

  it('throws when choices[0].message.content is missing', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('{"choices":[{}]}', { status: 200 }))) as typeof fetch;
    const p = new OpenAICompatibleProvider({ ...baseOpts, fetchImpl });
    await expect(p.classifyPage(mkPage())).rejects.toThrow(/no message content/);
  });

  it('throws when the JSON content fails the schema (bad role)', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        okResponse({
          assets: [
            {
              assetId: 'a1',
              role: 'made-up-role',
              importance: 0.5,
              evidenceLikelihood: 0.5,
              confidence: 0.5,
              reason: 'r',
              generatedBy: 'ai',
            },
          ],
          links: [],
        }),
      )) as typeof fetch;
    const p = new OpenAICompatibleProvider({ ...baseOpts, fetchImpl });
    await expect(p.classifyPage(mkPage())).rejects.toThrow();
  });

  it('aborts (rejects) when the fetch exceeds the timeout', async () => {
    // fetchImpl honors the AbortSignal: rejects when the provider's AbortController fires.
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        if (signal.aborted) reject(new Error('aborted'));
        else signal.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const p = new OpenAICompatibleProvider({ ...baseOpts, timeoutMs: 40, fetchImpl });
    const t0 = Date.now();
    await expect(p.classifyPage(mkPage())).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('OpenAICompatibleProvider — construction validation', () => {
  it('rejects a missing endpoint / apiKey / model', () => {
    expect(() => new OpenAICompatibleProvider({ endpoint: '', apiKey: 'k', model: 'm' })).toThrow(
      /endpoint/,
    );
    expect(() => new OpenAICompatibleProvider({ endpoint: 'x', apiKey: '', model: 'm' })).toThrow(
      /apiKey/,
    );
    expect(() => new OpenAICompatibleProvider({ endpoint: 'x', apiKey: 'k', model: '' })).toThrow(
      /model/,
    );
  });
});

describe('OpenAICompatibleProvider — explainEvidence (Phase H)', () => {
  it('parses a well-formed explanation and runs the explain-v1 prompt', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = ((url: string, init: RequestInit) => {
      captured = { url, init };
      return Promise.resolve(
        okResponse(
          JSON.stringify({
            assetId: 'a1',
            text: 'The chart appears to illustrate the claim.',
            source: 'ai',
            caveats: ['provenance does not verify the numbers'],
          }),
        ),
      );
    }) as typeof fetch;
    const p = new OpenAICompatibleProvider({ ...baseOpts, fetchImpl });
    const out = await p.explainEvidence(mkExplain());
    expect(out.source).toBe('ai');
    expect(out.text).toContain('appears to illustrate');
    expect(out.caveats).toHaveLength(1);
    // The explain stage compiles the EXPLAIN prompt, not the classify prompt.
    const bodyStr = String(captured!.init.body);
    expect(bodyStr).toContain('contextual-explanation stage');
    // The payload lives ESCAPED inside the user-message string (JSON-in-JSON),
    // so assert the key/value pair in its escaped form: \"trustState\":\"verified\".
    expect(bodyStr).toContain('trustState\\":\\"verified');
    // Privacy (§7): the explain body carries text context only — no evidence
    // graph, no image bytes, no base64.
    expect(bodyStr).not.toMatch(/data:image|base64/);
    expect(bodyStr).not.toContain('contributingEvidence');
  });

  it('serializes a minimal input gracefully (nulls, no crash)', async () => {
    let captured: { init: RequestInit } | undefined;
    const fetchImpl = ((_url: string, init: RequestInit) => {
      captured = { init };
      return Promise.resolve(
        okResponse(JSON.stringify({ assetId: 'a1', text: 'ok', source: 'ai', caveats: [] })),
      );
    }) as typeof fetch;
    const p = new OpenAICompatibleProvider({ ...baseOpts, fetchImpl });
    const out = await p.explainEvidence({
      assetId: 'a1',
      trust: { state: 'unknown', reason: 'no-evidence' },
    });
    expect(out.source).toBe('ai');
    const bodyStr = String(captured!.init.body);
    // Escaped form inside the user-message string: \"semanticRole\":null.
    expect(bodyStr).toContain('semanticRole\\":null');
    expect(bodyStr).toContain('claim\\":null');
  });

  it('throws when the explanation fails the schema (source label lie)', async () => {
    // ContextualExplanationSchema forces source:"ai" — a provider cannot
    // return "deterministic". This must THROW so the orchestrator falls back
    // to the deterministic floor.
    const fetchImpl = (() =>
      Promise.resolve(
        okResponse(
          JSON.stringify({ assetId: 'a1', text: 'x', source: 'deterministic', caveats: [] }),
        ),
      )) as typeof fetch;
    const p = new OpenAICompatibleProvider({ ...baseOpts, fetchImpl });
    await expect(p.explainEvidence(mkExplain())).rejects.toThrow();
  });

  it('throws on non-2xx HTTP for the explain path too', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('{"error":"rate limited"}', { status: 429 }))) as typeof fetch;
    const p = new OpenAICompatibleProvider({ ...baseOpts, fetchImpl });
    await expect(p.explainEvidence(mkExplain())).rejects.toThrow(/HTTP 429/);
  });
});
