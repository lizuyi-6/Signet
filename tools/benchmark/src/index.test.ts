/**
 * @signet/benchmark — enforced gate.
 *
 * The benchmark is acceptance criterion #7. These tests enforce its two
 * load-bearing properties:
 *   1. ≥100 logical cases (the matrix did not silently shrink), AND
 *   2. zero deviations from the specification oracle (engine ↔ spec in sync),
 *   3. every trust state is reached by at least one case (real coverage, not a
 *      single happy path repeated N times — CLAUDE.md rule 4.4).
 */
import { describe, expect, it } from 'vitest';

import { generateCases, runBenchmark } from './index.js';

describe('decision-engine benchmark (acceptance #7)', () => {
  it('covers ≥100 logical cases', () => {
    const cases = generateCases();
    expect(cases.length).toBeGreaterThanOrEqual(100);
    // And the matrix is the expected size: 2 no-manifest + 4·2·4·3·4 = 386.
    expect(cases.length).toBe(2 + 4 * 2 * 4 * 3 * 4);
  });

  it('matches the specification oracle on every case (0 deviations)', () => {
    const r = runBenchmark();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(r.total);
    if (r.mismatches.length > 0) {
      // Surface the first mismatch verbatim if this ever regresses.
      throw new Error(`first mismatch: ${JSON.stringify(r.mismatches[0])}`);
    }
  });

  it('reaches every trust state at least once (real coverage)', () => {
    const r = runBenchmark();
    for (const state of ['verified', 'verified-ai', 'broken', 'unknown']) {
      expect(r.byExpectedState[state]).toBeGreaterThanOrEqual(1);
    }
  });
});
