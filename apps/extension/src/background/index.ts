/**
 * @signet/extension/background — MV3 service worker.
 *
 * Owns the offscreen document lifecycle and relays verify requests between the
 * content script and the offscreen document. Does NOT run C2PA / WASM here — an
 * MV3 service worker cannot host the nested Web Worker that c2pa-web spawns
 * (D16). All it does is route messages and keep the offscreen page alive.
 *
 * Messaging uses the type-safe async pattern: return `true` from the listener
 * to keep the response channel open and call `sendResponse` once the async work
 * finishes. (Returning a Promise is runtime-supported but not in the
 * @types/chrome signature.)
 */
import type {
  AnalyzeRequest,
  AnalyzeResult,
  ExplainRequest,
  ExplainResult,
  VerifyForward,
  VerifyRequest,
  VerifyResult,
} from '../messages';
import { loadConfig } from '../intelligence-config';
import { analyzePage, providerFor } from './intelligence';
import { buildDeterministicExplanation, explainEvidenceWithFallback } from '@signet/intelligence';

// The offscreen document's source path. crxjs serves it at this path in dev and
// emits it at the same relative path under dist/ in build, so the SAME string
// works in both (wrapped in getURL). See docs/decisions.md D16 + research note.
const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

function fail(assetId: string, errorMessage: string): VerifyResult {
  return {
    kind: 'verify-result',
    assetId,
    state: 'unknown',
    reason: 'verification-error',
    failClosed: true,
    items: [],
    errorMessage,
  };
}

async function hasOffscreen(): Promise<boolean> {
  // Prefer the dedicated API (Chrome 116+)…
  if (chrome.offscreen?.hasDocument) {
    try {
      if (await chrome.offscreen.hasDocument()) return true;
    } catch {
      // fall through to getContexts
    }
  }
  // …otherwise ask the runtime whether an offscreen context already exists.
  try {
    const ctxs = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    return ctxs.length > 0;
  } catch {
    return false;
  }
}

// In-flight creation promise. Concurrent verify messages (the content script
// fires one per image in a tight loop) all funnel through `ensureOffscreen`;
// without this guard every caller sees hasOffscreen()===false at once and they
// race into N duplicate createDocument() calls — only the first succeeds, the
// rest throw "only a single offscreen_document" and fail-closed to Unknown.
// The check-then-assign below has no `await` between the two, so it is atomic
// across microtasks: the first resumed caller sets `creating`, the rest await it.
let creating: Promise<void> | null = null;

async function createOffscreenDocument(): Promise<void> {
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL(OFFSCREEN_PATH),
      reasons: ['WORKERS'] as chrome.offscreen.Reason[],
      justification:
        'Runs the c2pa-web WASM C2PA reader, which spawns a Web Worker that an MV3 service worker cannot host.',
    });
  } finally {
    creating = null;
  }
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  if (!creating) {
    creating = createOffscreenDocument();
  }
  await creating;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const m = msg as { to?: string; kind?: string };
  if (!m || m.to !== 'background') {
    return false; // not addressed to us
  }

  // --- Trust pipeline (unchanged since D16) ---------------------------------
  if (m.kind === 'verify') {
    const req = msg as VerifyRequest;
    void (async () => {
      let res: VerifyResult;
      try {
        await ensureOffscreen();
        const fwd: VerifyForward = {
          kind: 'verify',
          to: 'offscreen',
          assetId: req.assetId,
          url: req.url,
        };
        const got = (await chrome.runtime.sendMessage(fwd)) as VerifyResult | undefined;
        res = got ?? fail(req.assetId, 'No response from the offscreen document.');
      } catch (e) {
        res = fail(req.assetId, (e as Error).message);
      }
      sendResponse(res);
    })();
    return true; // keep the channel open for the async sendResponse above
  }

  // --- Intelligence channel (advisory; parallel to trust, never touches it) --
  if (m.kind === 'analyze') {
    const req = msg as AnalyzeRequest;
    void (async () => {
      let res: AnalyzeResult;
      try {
        const config = await loadConfig();
        const outcome = await analyzePage(config, req.input);
        res = {
          kind: 'analyze-result',
          to: 'content',
          result: outcome.result,
          status: outcome.status,
          source: outcome.source,
          promptVersion: outcome.promptVersion,
          ...(outcome.error ? { error: outcome.error } : {}),
        };
      } catch (e) {
        // The classifier is designed never to throw (§14), so this is a true
        // last-resort guard: still advisory, still never touches trust.
        res = {
          kind: 'analyze-result',
          to: 'content',
          result: { assets: [], links: [] },
          status: 'fallback',
          source: 'heuristic',
          promptVersion: 'semantic-v1',
          error: (e as Error).message,
        };
      }
      sendResponse(res);
    })();
    return true;
  }

  // --- Intelligence explanation channel (Phase H; display-only, on demand) ---
  if (m.kind === 'explain') {
    const req = msg as ExplainRequest;
    void (async () => {
      let res: ExplainResult;
      try {
        const config = await loadConfig();
        const provider = providerFor(config);
        const outcome = await explainEvidenceWithFallback(
          req.input,
          provider ?? undefined,
          config.timeoutMs,
        );
        res = {
          kind: 'explain-result',
          to: 'content',
          explanation: outcome.explanation,
          source: outcome.source,
          ...(outcome.error ? { error: outcome.error } : {}),
        };
      } catch (e) {
        // The orchestrator never throws (§14), so this is a true last-resort
        // guard: the deterministic floor is still produced, still display-only.
        res = {
          kind: 'explain-result',
          to: 'content',
          explanation: buildDeterministicExplanation(req.input),
          source: 'deterministic',
          error: (e as Error).message,
        };
      }
      sendResponse(res);
    })();
    return true;
  }

  return false;
});

// Keep the SW log line out of production paths; useful while bootstrapping.
chrome.runtime.onInstalled.addListener(() => {
  // No-op for now: offscreen is created lazily on first verify.
});
