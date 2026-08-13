/**
 * @signet/extension/options — the Intelligence Layer options page.
 *
 * Reads/writes the single source of truth ({@link STORAGE_KEY} in
 * `chrome.storage.local`) via intelligence-config.ts. The page itself is a
 * thin view: it never interprets config semantics, only mirrors fields. The
 * API key is written to storage and echoed into a password input; it is never
 * logged, never sent anywhere but the configured endpoint (by the SW provider),
 * never embedded in source.
 *
 * Honesty (§31 / §7): the "image upload" privacy mode is rendered DISABLED —
 * the current provider does not honor it yet, and pretending otherwise would
 * overstate what the extension sends.
 */
import {
  STORAGE_KEY,
  loadConfig,
  saveConfig,
  type StoredIntelligenceConfig,
} from '../intelligence-config';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const form = $('form') as HTMLFormElement;
const enabledEl = $('enabled') as HTMLInputElement;
const providerEl = $('provider') as HTMLSelectElement;
const openaiFields = $('openaiFields') as HTMLDivElement;
const endpointEl = $('endpoint') as HTMLInputElement;
const modelEl = $('model') as HTMLInputElement;
const apiKeyEl = $('apiKey') as HTMLInputElement;
const timeoutEl = $('timeoutMs') as HTMLInputElement;
const privacyEl = $('privacyMode') as HTMLSelectElement;
const statusEl = $('status');

function syncVisibility(): void {
  openaiFields.hidden = providerEl.value !== 'openai-compatible';
}

providerEl.addEventListener('change', syncVisibility);

async function populate(): Promise<void> {
  const config = await loadConfig();
  enabledEl.checked = config.enabled;
  providerEl.value = config.provider;
  endpointEl.value = config.endpoint ?? '';
  modelEl.value = config.model ?? '';
  apiKeyEl.value = config.apiKey ?? '';
  timeoutEl.value = String(config.timeoutMs);
  privacyEl.value = config.privacyMode;
  syncVisibility();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const patch: StoredIntelligenceConfig = {
    enabled: enabledEl.checked,
    provider: providerEl.value as StoredIntelligenceConfig['provider'],
    endpoint: endpointEl.value.trim() || undefined,
    model: modelEl.value.trim() || undefined,
    apiKey: apiKeyEl.value || undefined,
    timeoutMs: Number(timeoutEl.value),
    privacyMode: privacyEl.value as StoredIntelligenceConfig['privacyMode'],
  };
  void (async () => {
    try {
      await saveConfig(patch);
      // Never echo the key back in the confirmation.
      statusEl.textContent = `Saved (${STORAGE_KEY}). Changes apply to pages scanned from now on.`;
      statusEl.classList.remove('error');
    } catch (err) {
      statusEl.textContent = `Save failed: ${(err as Error).message}`;
      statusEl.classList.add('error');
    }
  })();
});

void populate();
