/**
 * @signet/extension/background — Intelligence classifier factory.
 *
 * Builds the {@link HybridSemanticClassifier} the SW hosts for the `analyze`
 * channel. Provider selection from {@link IntelligenceConfig}:
 *  - `openai-compatible` (with endpoint + apiKey + model) → real HTTP provider.
 *  - `mock` → the no-network mock (demoing the UI without an API key).
 *  - `disabled` / missing creds → `provider: undefined`; the classifier then
 *    returns `status:'disabled'` and serves only the heuristic floor.
 *
 * The API key transits ONLY from `chrome.storage.local` → this factory → the
 * provider's Authorization header. It is never logged, never sent to the
 * content script, never put in source.
 */
import type { IntelligenceConfig, IntelligenceProvider } from '@signet/intelligence';
import {
  HybridSemanticClassifier,
  MockIntelligenceProvider,
  OpenAICompatibleProvider,
  SemanticCache,
  type ClassificationOutcome,
  type HybridClassifierOptions,
} from '@signet/intelligence';

/** A SW-singleton classifier + the config fingerprint it was built from. */
interface ClassifierHandle {
  readonly classifier: HybridSemanticClassifier;
  /** The config the above classifier was constructed with. */
  readonly config: IntelligenceConfig;
}

let handle: ClassifierHandle | null = null;

/** Build the concrete provider for a config, or `null` if AI is disabled. */
export function providerFor(config: IntelligenceConfig): IntelligenceProvider | null {
  if (!config.enabled) return null;
  if (config.provider === 'disabled') return null;
  if (config.provider === 'mock') return new MockIntelligenceProvider({});
  if (config.provider === 'openai-compatible') {
    if (!config.endpoint || !config.apiKey || !config.model) {
      // Incomplete creds → treat as disabled (fail-closed to heuristic-only),
      // never as a half-configured provider that would throw on every call.
      return null;
    }
    return new OpenAICompatibleProvider({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs: config.timeoutMs,
    });
  }
  return null;
}

/** Build a fresh classifier + cache for the given config. */
function build(config: IntelligenceConfig): ClassifierHandle {
  const provider = providerFor(config);
  const opts: HybridClassifierOptions = {
    config,
    ...(provider ? { provider } : {}),
    cache: new SemanticCache(),
  };
  return { classifier: new HybridSemanticClassifier(opts), config };
}

/**
 * Get the classifier for `config`, rebuilding only when the config meaningfully
 * changed. Every behavior-changing field is compared — `enabled`, `provider`,
 * `endpoint`, `apiKey`, `model`, `timeoutMs`, `privacyMode` — so an API-key
 * rotation (same endpoint/model) rebuilds the provider instead of silently
 * reusing the old key's client. The cache is dropped on rebuild — a
 * provider/model/key change invalidates prior results.
 */
export function classifierFor(config: IntelligenceConfig): HybridSemanticClassifier {
  const prev = handle;
  if (
    prev &&
    prev.config.enabled === config.enabled &&
    prev.config.provider === config.provider &&
    prev.config.endpoint === config.endpoint &&
    prev.config.apiKey === config.apiKey &&
    prev.config.model === config.model &&
    prev.config.timeoutMs === config.timeoutMs &&
    prev.config.privacyMode === config.privacyMode
  ) {
    return prev.classifier;
  }
  handle = build(config);
  return handle.classifier;
}

/**
 * Run a page-level classification. Thin wrapper so the SW handler reads as
 * routing, not intelligence logic.
 */
export async function analyzePage(
  config: IntelligenceConfig,
  input: Parameters<HybridSemanticClassifier['classifyPage']>[0],
): Promise<ClassificationOutcome> {
  return classifierFor(config).classifyPage(input);
}
