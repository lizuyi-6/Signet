/**
 * @signet/evidence-web — trust profile regression (Phase J5).
 *
 * Pins the demo/default trust separation: both profiles keep `verifyTrust: true`
 * (the requires-proof gate is never weakened), they differ only in the demo
 * anchor. A `demo` profile without its anchor fails closed (throws) instead of
 * silently validating fixtures as `untrusted`.
 */
import { describe, expect, it } from 'vitest';

import { resolveTrustProfile } from './reader.js';

describe('resolveTrustProfile', () => {
  it('default profile adds no anchor and keeps verifyTrust true', () => {
    expect(resolveTrustProfile({ profile: 'default' })).toEqual({ verifyTrust: true });
  });

  it('demo profile carries the test-signer anchor and keeps verifyTrust true', () => {
    expect(resolveTrustProfile({ profile: 'demo', demoAnchorPem: 'PEM' })).toEqual({
      trustAnchorPem: 'PEM',
      verifyTrust: true,
    });
  });

  it('demo profile without an anchor throws (fail-closed, not silent untrusted)', () => {
    expect(() => resolveTrustProfile({ profile: 'demo' })).toThrow(/demoAnchorPem/);
    expect(() => resolveTrustProfile({ profile: 'demo', demoAnchorPem: '' })).toThrow(
      /demoAnchorPem/,
    );
  });

  it('never returns verifyTrust false for either profile', () => {
    expect(resolveTrustProfile({ profile: 'default' }).verifyTrust).toBe(true);
    expect(resolveTrustProfile({ profile: 'demo', demoAnchorPem: 'PEM' }).verifyTrust).toBe(true);
  });
});
