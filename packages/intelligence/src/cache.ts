/**
 * @signet/intelligence — SemanticCache.
 *
 * A small TTL cache so a page re-scan (e.g. on DOM mutation) does NOT re-call
 * the provider. Keyed by a stable hash of the page-semantic input (pageUrl +
 * asset text contexts + claims). In-memory only; lives in the service worker and
 * is naturally ephemeral (SW eviction drops it, which is fine — worst case is a
 * re-fetch). Privacy: the cache holds only text-context hashes + analysis
 * objects, never image bytes.
 *
 * Pure-ish: the clock is injectable so tests can exercise TTL expiry without
 * real timers (rule 3.4 — no hidden timing in production-path-adjacent tests).
 */
// No node-only imports: this package must run in BOTH Node (vitest) and the
// extension service worker (no `node:crypto`). The cache key uses a portable
// pure-JS FNV-1a hash below — not cryptographically strong, but adequate for an
// in-memory, bounded (≤256) short-lived cache that is not a security boundary.

import type { ClaimEvidenceResult, PageSemanticInput } from './types.js';
import { fnv1aHex } from './hash.js';

/** Stable canonical JSON for hashing (key-sorted, no key-order drift). */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** Hash a page-semantic input into a stable cache key. */
export function cacheKeyFor(input: {
  readonly pageUrl: string;
  readonly pageTitle?: string;
  readonly headings: readonly string[];
  readonly claims: readonly { readonly id: string; readonly text: string }[];
  readonly assets: readonly {
    readonly assetId: string;
    readonly altText?: string;
    readonly nearbyText?: string;
    readonly width: number;
    readonly height: number;
  }[];
}): string {
  const payload = {
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle ?? null,
    headings: input.headings,
    claims: input.claims,
    // Dimensions + text only — NOT image bytes or URLs. A change in surrounding
    // text (the thing the classifier keys on) intentionally busts the cache.
    assets: input.assets.map((a) => ({
      assetId: a.assetId,
      altText: a.altText ?? null,
      nearbyText: a.nearbyText ?? null,
      width: a.width,
      height: a.height,
    })),
  };
  return fnv1aHex(canonicalJson(payload));
}

export interface SemanticCacheEntry {
  readonly value: ClaimEvidenceResult;
  /** Absolute expiry, epoch ms. */
  readonly expiresAt: number;
}

export interface SemanticCacheOptions {
  /** TTL in ms. Default 5 min. */
  readonly ttlMs?: number;
  /** Max entries (LRU-ish eviction on insert). Default 256. */
  readonly maxEntries?: number;
  /** Injectable clock for tests; defaults to Date.now. */
  readonly now?: () => number;
}

export class SemanticCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly store = new Map<string, SemanticCacheEntry>();

  constructor(opts: SemanticCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
    this.maxEntries = opts.maxEntries ?? 256;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Number of non-expired entries (for tests/observability). */
  get size(): number {
    this.sweep();
    return this.store.size;
  }

  get(key: string): ClaimEvidenceResult | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency (Map preserves insertion order; re-insert moves to end).
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: ClaimEvidenceResult): void {
    // Bound the size (evict oldest). Map iteration is insertion order.
    while (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** Compute key + get in one call. */
  getFor(input: PageSemanticInput): ClaimEvidenceResult | undefined {
    return this.get(cacheKeyFor(input));
  }

  /** Compute key + set in one call. */
  setFor(input: PageSemanticInput, value: ClaimEvidenceResult): void {
    this.set(cacheKeyFor(input), value);
  }

  clear(): void {
    this.store.clear();
  }

  private sweep(): void {
    const now = this.now();
    for (const [k, v] of this.store) {
      if (v.expiresAt <= now) this.store.delete(k);
    }
  }
}
