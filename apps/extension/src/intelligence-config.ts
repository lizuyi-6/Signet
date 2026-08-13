/**
 * @signet/extension — Intelligence configuration in `chrome.storage.local`.
 *
 * Single source of truth for the Intelligence Layer's runtime config. The
 * Options page (Phase H) writes here; the content script and background SW
 * read here. The API key lives ONLY in storage — never in source, never logged.
 *
 * The stored shape is a partial {@link IntelligenceConfig}; {@link loadConfig}
 * merges it over {@link DEFAULT_INTELLIGENCE_CONFIG} so a field the user has
 * never set still gets a safe default (rule 3.5: the safety default is the most
 * restrictive — intelligence OFF, context-only privacy).
 */
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  type IntelligenceConfig,
  type IntelligenceProviderKind,
  type PrivacyMode,
} from '@signet/intelligence';

/** The storage key all reads/writes share. */
export const STORAGE_KEY = 'signet.intelligence.config.v1';

/** What we persist: every field optional (defaults fill the gaps). */
export interface StoredIntelligenceConfig {
  readonly enabled?: boolean;
  readonly provider?: IntelligenceProviderKind;
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly privacyMode?: PrivacyMode;
}

/**
 * Merge a stored partial over the default. Defensive: validates `provider` and
 * `privacyMode` against their unions so a corrupt/manual edit cannot inject an
 * invalid value that the rest of the layer assumes is impossible.
 */
export function mergeConfig(stored: Partial<StoredIntelligenceConfig>): IntelligenceConfig {
  const provider =
    stored.provider === 'disabled' ||
    stored.provider === 'mock' ||
    stored.provider === 'openai-compatible'
      ? stored.provider
      : DEFAULT_INTELLIGENCE_CONFIG.provider;
  const privacyMode =
    stored.privacyMode === 'context-only' || stored.privacyMode === 'allow-image-upload'
      ? stored.privacyMode
      : DEFAULT_INTELLIGENCE_CONFIG.privacyMode;
  const timeoutMs =
    typeof stored.timeoutMs === 'number' &&
    Number.isFinite(stored.timeoutMs) &&
    stored.timeoutMs > 0
      ? Math.round(stored.timeoutMs)
      : DEFAULT_INTELLIGENCE_CONFIG.timeoutMs;
  return {
    enabled:
      typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_INTELLIGENCE_CONFIG.enabled,
    provider,
    endpoint: typeof stored.endpoint === 'string' ? stored.endpoint : undefined,
    apiKey:
      typeof stored.apiKey === 'string' && stored.apiKey.length > 0 ? stored.apiKey : undefined,
    model: typeof stored.model === 'string' ? stored.model : undefined,
    timeoutMs,
    privacyMode,
  };
}

/** Read the merged config. Returns the default if storage is unavailable. */
export async function loadConfig(): Promise<IntelligenceConfig> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return DEFAULT_INTELLIGENCE_CONFIG;
  }
  try {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    const stored = (got[STORAGE_KEY] ?? {}) as Partial<StoredIntelligenceConfig>;
    return mergeConfig(stored);
  } catch {
    return DEFAULT_INTELLIGENCE_CONFIG;
  }
}

/** Persist a partial update (merges with whatever is already stored). */
export async function saveConfig(patch: StoredIntelligenceConfig): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  const current = await chrome.storage.local.get(STORAGE_KEY);
  const merged = { ...(current[STORAGE_KEY] ?? {}), ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
}

/**
 * Subscribe to config changes. The callback fires with the new merged config.
 * Returns an unsubscribe function (a no-op outside an extension context).
 */
export function onConfigChange(cb: (next: IntelligenceConfig) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'local' || !(STORAGE_KEY in changes)) return;
    cb(mergeConfig((changes[STORAGE_KEY]?.newValue ?? {}) as Partial<StoredIntelligenceConfig>));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
