/**
 * @signet/extension — message contract shared by all three contexts.
 *
 * Flow (see docs/decisions.md D16):
 *   content script ──verify▶ background SW ──verify▶ offscreen document
 *   content script ◀─result── background SW ◀─result── offscreen document
 *
 * The content script talks to the background service worker only; the SW owns
 * the offscreen document lifecycle and relays. The offscreen document is the
 * sole place `@contentauth/c2pa-web` runs (it spawns a Web Worker, which an MV3
 * service worker cannot host). Each listener acts only on messages addressed to
 * it (`to`) and returns its response from the async listener so Chrome 99+'s
 * promise-based runtime messaging delivers it.
 */
import type { EvidenceItem, TrustReason, TrustState } from '@signet/core';

/** Which context a message is intended for. */
export type Addressee = 'background' | 'offscreen' | 'content';

/** A request to verify the bytes at `url`, originated by the content script. */
export interface VerifyRequest {
  readonly kind: 'verify';
  readonly to: 'background';
  /** Stable id (the asset's absolute URL). */
  readonly assetId: string;
  /** Absolute URL the offscreen document will `fetch()`. */
  readonly url: string;
}

/** Same request, forwarded by the SW to the offscreen document. */
export interface VerifyForward {
  readonly kind: 'verify';
  readonly to: 'offscreen';
  readonly assetId: string;
  readonly url: string;
}

/** The decision for one asset, returned to the content script for rendering. */
export interface VerifyResult {
  readonly kind: 'verify-result';
  readonly assetId: string;
  readonly state: TrustState;
  readonly reason: TrustReason;
  /** True when the engine fell through to `unknown` rather than asserting. */
  readonly failClosed: boolean;
  /** Evidence items that drove the decision (for the detail card). */
  readonly items: readonly EvidenceItem[];
  /** Set when collection itself errored (fail-closed). */
  readonly errorMessage?: string;
}

export type InboundToBackground = VerifyForward | VerifyResult;
