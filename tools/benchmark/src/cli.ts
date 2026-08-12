/**
 * CLI entry for the benchmark: `tsx src/cli.ts` (via `pnpm benchmark`).
 *
 * Prints the full report and exits non-zero if any case deviates from the
 * specification oracle — so this is a real pass/fail gate, not a vanity metric.
 */
import { formatReport, runBenchmark } from './index.js';

const result = runBenchmark();
console.log(formatReport(result));
console.log('');
if (result.failed > 0) {
  console.error(`BENCHMARK FAIL: ${result.failed}/${result.total} cases deviate from the oracle.`);
  process.exit(1);
}
console.log(
  `BENCHMARK PASS: ${result.passed}/${result.total} cases match the specification oracle.`,
);
process.exit(0);
