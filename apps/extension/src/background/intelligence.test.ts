/**
 * @signet/extension/background — classifier factory regression (Phase J3).
 *
 * Pins that {@link classifierFor} compares EVERY behavior-changing config field,
 * including `apiKey`: a key rotation (same endpoint/model) must rebuild the
 * provider client, not silently reuse the old key's Authorization header. This
 * is the "config cache must not serve a stale API key" invariant.
 *
 * Uses a fake endpoint/key/model — construction is lazy, no network call occurs.
 */
import { describe, expect, it } from 'vitest';

import type { IntelligenceConfig } from '@signet/intelligence';

import { classifierFor, providerFor } from './intelligence.js';

function openAiCfg(apiKey: string): IntelligenceConfig {
  return {
    enabled: true,
    provider: 'openai-compatible',
    endpoint: 'https://api.example.com/v1/chat/completions',
    apiKey,
    model: 'test-model',
    timeoutMs: 8000,
    privacyMode: 'context-only',
  };
}

describe('classifierFor — config fingerprint includes apiKey', () => {
  it('reuses the cached classifier when nothing changes', () => {
    const a = classifierFor(openAiCfg('sk-aaa'));
    const b = classifierFor(openAiCfg('sk-aaa'));
    expect(b).toBe(a);
  });

  it('rebuilds the classifier when only the apiKey changes (key rotation)', () => {
    const a = classifierFor(openAiCfg('sk-aaa'));
    const b = classifierFor(openAiCfg('sk-bbb'));
    expect(b).not.toBe(a);
  });

  it('rebuilds when the provider kind changes', () => {
    const a = classifierFor(openAiCfg('sk-aaa'));
    const b = classifierFor({ ...openAiCfg('sk-aaa'), provider: 'mock' });
    expect(b).not.toBe(a);
  });

  it('rebuilds when the endpoint changes (same key)', () => {
    const a = classifierFor(openAiCfg('sk-aaa'));
    const b = classifierFor({
      ...openAiCfg('sk-aaa'),
      endpoint: 'https://other.example.com/v1/chat/completions',
    });
    expect(b).not.toBe(a);
  });
});

describe('providerFor — fail-closed on incomplete creds', () => {
  it('returns null for a disabled provider and for disabled intelligence', () => {
    expect(providerFor({ ...openAiCfg('sk-aaa'), provider: 'disabled' })).toBeNull();
    expect(providerFor({ ...openAiCfg('sk-aaa'), enabled: false })).toBeNull();
  });

  it('returns null when openai-compatible creds are incomplete', () => {
    expect(providerFor({ ...openAiCfg('sk-aaa'), apiKey: undefined })).toBeNull();
    expect(providerFor({ ...openAiCfg('sk-aaa'), endpoint: undefined })).toBeNull();
    expect(providerFor({ ...openAiCfg('sk-aaa'), model: undefined })).toBeNull();
  });

  it('returns a live provider for a complete openai-compatible config', () => {
    expect(providerFor(openAiCfg('sk-aaa'))).not.toBeNull();
  });
});
