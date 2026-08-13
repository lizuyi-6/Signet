/**
 * @signet/intelligence — public entrypoint.
 *
 * The Intelligence Layer: DOM-first semantic classification + optional AI
 * provider, claim↔evidence mapping, and display-only contextual explanation.
 *
 * Safety contract (see docs/decisions.md D19): NOTHING in this package can
 * change a TrustDecision. The deterministic engine (@signet/trust-engine) is the
 * sole trust authority; this package only enriches the display alongside it.
 */
export * from './types.js';
export * from './schemas.js';
export * from './hash.js';
export * from './heuristics.js';
export * from './claims.js';
export * from './mapping.js';
export * from './explain.js';
export * from './policy.js';
export * from './display.js';
export * from './cache.js';
export * from './prompts/semantic-v1.js';
export * from './prompts/explain-v1.js';
export * from './provider-mock.js';
export * from './provider-openai.js';
export * from './classifier.js';
