/**
 * @signet/benchmark — decision-engine classification benchmark.
 *
 * Generates ≥100 synthetic {@link C2PAManifestStoreView} cases across the full
 * classification matrix (manifest present/absent × signature codes × hash codes
 * × AI-assertion shapes × unknown-code injection × c2pa.actions.vN family), and
 * checks each one against an **independent specification oracle** — NOT a call
 * to `decide`. The oracle encodes the PRD rule precedence (R1 broken before R2
 * error; integrity before signature; clean → verified / verified-ai) directly.
 *
 * If `decide(mapManifestStore(...))` ever deviates from this oracle, that is a
 * real finding (either the engine drifted from the spec, or the oracle did —
 * both are worth surfacing), and the benchmark fails closed.
 *
 * Acceptance criterion #7 ("benchmark runs, ≥100 logical cases").
 *
 * Run: `pnpm --filter @signet/benchmark benchmark` (or `pnpm benchmark`).
 */
import type { TrustReason, TrustState } from '@signet/core';

import { mapManifestStore } from '@signet/evidence';
import type { C2PAManifestStoreView } from '@signet/evidence';
import { decide } from '@signet/trust-engine';

/** Signature dimension values. */
type SigDim = 'valid' | 'untrusted' | 'expired' | 'claim-untrusted';
/** Hash dimension values. */
type HashDim = 'valid' | 'mismatch';
/** AI-assertion dimension values. */
type AiDim = 'none' | 'c2pa-ai-gen' | 'stds-source-trained' | 'both';
/** Unknown validation-code injection. */
type UnknownDim = 'none' | 'future' | 'not-supported';
/** c2pa.actions assertion family. */
type ActionsDim = 'none' | 'v1' | 'v2' | 'both-v1-v2';

interface Dims {
  readonly present: boolean;
  readonly sig: SigDim;
  readonly hash: HashDim;
  readonly ai: AiDim;
  readonly unknown: UnknownDim;
  readonly actions: ActionsDim;
}

export interface BenchCase {
  readonly id: string;
  readonly dims: Dims;
  readonly store: C2PAManifestStoreView | null;
  readonly expected: { readonly state: TrustState; readonly reason: TrustReason };
}

export interface Mismatch {
  readonly id: string;
  readonly dims: Dims;
  readonly expected: { readonly state: TrustState; readonly reason: TrustReason };
  readonly actual: { readonly state: TrustState; readonly reason: TrustReason };
}

export interface BenchResult {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly mismatches: readonly Mismatch[];
  /** expected-state → case count, for a coverage table. */
  readonly byExpectedState: Readonly<Record<string, number>>;
}

const SIG = { alg: 'Es256', issuer: 'C2PA Test Signing Cert', time: '2026-08-12T10:23:30Z' };

/**
 * The specification oracle. Encodes the PRD rule precedence DIRECTLY — this is
 * the spec, not a mirror of `applyRules`. Any disagreement with the engine is a
 * finding.
 *
 *   - no manifest                    → unknown / no-evidence
 *   - unknown validation code        → unknown / verification-error
 *     (the mapper fails closed on unrecognised codes: it does not invent a
 *     green/invalid prong, so an unknown code dominates hash/signature codes)
 *   - hash mismatch (no unknown)     → broken / integrity-mismatch
 *   - signature failure (no unknown) → broken / signature-invalid
 *   - otherwise clean + AI declared  → verified-ai / ai-declared-and-valid
 *   - otherwise clean                → verified / valid-credential
 */
function oracle(dims: Dims): { state: TrustState; reason: TrustReason } {
  if (!dims.present) return { state: 'unknown', reason: 'no-evidence' };
  if (dims.unknown !== 'none') return { state: 'unknown', reason: 'verification-error' };
  if (dims.hash !== 'valid') return { state: 'broken', reason: 'integrity-mismatch' };
  if (dims.sig !== 'valid') return { state: 'broken', reason: 'signature-invalid' };
  if (dims.ai !== 'none') return { state: 'verified-ai', reason: 'ai-declared-and-valid' };
  return { state: 'verified', reason: 'valid-credential' };
}

/** Build the synthetic manifest store for a dimension combination. Pure. */
function buildStore(dims: Dims): C2PAManifestStoreView | null {
  if (!dims.present) return null;

  const statuses: { code: string; explanation?: string }[] = [];
  if (dims.hash === 'mismatch') {
    statuses.push({
      code: 'assertion.dataHash.mismatch',
      explanation: 'asset hash error, error: hash verification( Hashes do not match )',
    });
  }
  switch (dims.sig) {
    case 'untrusted':
      statuses.push({ code: 'signature.untrusted' });
      break;
    case 'expired':
      statuses.push({ code: 'signature.expired' });
      break;
    case 'claim-untrusted':
      statuses.push({ code: 'claimSignature.untrusted' });
      break;
  }
  switch (dims.unknown) {
    case 'future':
      statuses.push({ code: 'some.future.code' });
      break;
    case 'not-supported':
      statuses.push({ code: 'assertion.notSupported' });
      break;
  }

  const assertions: { label: string; data: unknown }[] = [];
  if (dims.ai === 'c2pa-ai-gen' || dims.ai === 'both') {
    assertions.push({
      label: 'c2pa.ai.gen',
      data: {
        generator: { description: 'Bench Diffusion', type: 'software' },
        digitalSourceType: 'trainedAlgorithmicMedia',
      },
    });
  }
  if (dims.ai === 'stds-source-trained' || dims.ai === 'both') {
    assertions.push({
      label: 'stds.source',
      data: { digitalSourceType: 'trainedAlgorithmicMedia' },
    });
  }
  if (dims.actions === 'v1' || dims.actions === 'both-v1-v2') {
    assertions.push({
      label: 'c2pa.actions',
      data: { actions: [{ action: 'c2pa.captured', when: '2026-08-12T10:00:00Z' }] },
    });
  }
  if (dims.actions === 'v2' || dims.actions === 'both-v1-v2') {
    assertions.push({
      label: 'c2pa.actions.v2',
      data: { actions: [{ action: 'c2pa.created', when: '2026-08-12T10:23:30Z', actor: 'Bench' }] },
    });
  }

  return {
    active_manifest: {
      claim_generator: 'Bench/1.0 c2pa-node/0.0.0',
      signature_info: SIG,
      assertions,
    },
    validation_status: statuses,
  } as C2PAManifestStoreView;
}

const SIGS: readonly SigDim[] = ['valid', 'untrusted', 'expired', 'claim-untrusted'];
const HASHES: readonly HashDim[] = ['valid', 'mismatch'];
const AIS: readonly AiDim[] = ['none', 'c2pa-ai-gen', 'stds-source-trained', 'both'];
const UNKNOWNS: readonly UnknownDim[] = ['none', 'future', 'not-supported'];
const ACTIONS: readonly ActionsDim[] = ['none', 'v1', 'v2', 'both-v1-v2'];

/**
 * Generate the full case matrix.
 *
 * For `present=false` the other dimensions are structurally meaningless (no
 * manifest ⇒ no assertions, no validation_status), so a single representative
 * "no manifest" case is emitted. For `present=true` the full cross-product is
 * generated: 4 sig × 2 hash × 4 ai × 3 unknown × 4 actions = 384 cases.
 */
export function generateCases(): BenchCase[] {
  const cases: BenchCase[] = [];

  // Representative no-manifest cases (two shapes the mapper treats as empty).
  cases.push(
    makeCase(
      { present: false, sig: 'valid', hash: 'valid', ai: 'none', unknown: 'none', actions: 'none' },
      null,
    ),
  );
  cases.push(
    makeCase(
      { present: false, sig: 'valid', hash: 'valid', ai: 'none', unknown: 'none', actions: 'none' },
      { active_manifest: null, validation_status: [] },
    ),
  );

  let n = 0;
  for (const sig of SIGS) {
    for (const hash of HASHES) {
      for (const ai of AIS) {
        for (const unknown of UNKNOWNS) {
          for (const actions of ACTIONS) {
            n += 1;
            const dims = { present: true, sig, hash, ai, unknown, actions };
            cases.push(makeCase(dims, buildStore(dims), `p-${n}`));
          }
        }
      }
    }
  }
  return cases;
}

function makeCase(dims: Dims, store: C2PAManifestStoreView | null, suffix = ''): BenchCase {
  const expected = oracle(dims);
  const id = `${expected.state}|${dims.sig}|${dims.hash}|${dims.ai}|${dims.unknown}|${dims.actions}${suffix ? `#${suffix}` : ''}`;
  return { id, dims, store, expected };
}

/**
 * Run the benchmark: classify every case through the real
 * `decide(mapManifestStore(...))` pipeline and compare to the oracle.
 */
export function runBenchmark(): BenchResult {
  const cases = generateCases();
  const mismatches: Mismatch[] = [];
  const byExpectedState: Record<string, number> = {};

  for (const c of cases) {
    const decision = decide(mapManifestStore(c.store, c.id));
    byExpectedState[c.expected.state] = (byExpectedState[c.expected.state] ?? 0) + 1;
    if (decision.state !== c.expected.state || decision.reason !== c.expected.reason) {
      mismatches.push({
        id: c.id,
        dims: c.dims,
        expected: c.expected,
        actual: { state: decision.state, reason: decision.reason },
      });
    }
  }

  return {
    total: cases.length,
    passed: cases.length - mismatches.length,
    failed: mismatches.length,
    mismatches,
    byExpectedState,
  };
}

/** Human-readable table; used by the CLI entry and the README excerpt. */
export function formatReport(r: BenchResult): string {
  const lines: string[] = [];
  lines.push('Signet decision-engine benchmark');
  lines.push('======================================');
  lines.push(`cases   : ${r.total}`);
  lines.push(`passed  : ${r.passed}`);
  lines.push(`failed  : ${r.failed}`);
  lines.push('');
  lines.push('expected-state coverage:');
  for (const [state, count] of Object.entries(r.byExpectedState).sort()) {
    lines.push(`  ${state.padEnd(12)} ${count}`);
  }
  if (r.mismatches.length > 0) {
    lines.push('');
    lines.push('MISMATCHES (engine deviates from specification oracle; first 20):');
    for (const m of r.mismatches.slice(0, 20)) {
      lines.push(
        `  ${m.id}\n    expected=${m.expected.state}/${m.expected.reason} actual=${m.actual.state}/${m.actual.reason}`,
      );
    }
  } else {
    lines.push('');
    lines.push('All cases match the specification oracle.');
  }
  return lines.join('\n');
}
