/**
 * @signet/evidence-web — pure normalizer: c2pa-web serialized shape →
 * {@link C2PAManifestStoreView}.
 *
 * `@contentauth/c2pa-web`'s `reader.manifestStore()` returns a **serialized**
 * ManifestStore (plain JSON) whose structure differs from `c2pa-node`'s
 * `ResolvedManifestStore` in one load-bearing way:
 *
 *   - c2pa-node: `active_manifest` is the active Manifest *object*.
 *   - c2pa-web:  `active_manifest` is the active manifest's *label string*; the
 *                Manifest objects live in `manifests: { [label]: Manifest }`.
 *
 * This module closes that gap so the **same pure {@link mapManifestStore}** the
 * Node path uses also classifies the browser path — no second classification
 * implementation, no drift (see docs/decisions.md D15).
 *
 * The shapes below are the subset the normalizer reads; they were pinned by a
 * real-browser spike (tools/spike-web), not from memory. Every branch is
 * unit-tested in `normalize.test.ts` against the captured spike shapes.
 *
 * This module has **zero SDK coupling** (no import of `@contentauth/c2pa-web`),
 * so it runs under Node vitest. The SDK-coupled reader lives in `reader.ts`.
 */
import type {
  C2PAManifestStoreView,
  C2PAManifestView,
  C2PAValidationStatusView,
} from '@signet/evidence';

/** Minimal c2pa-web serialized ManifestStore shape the normalizer reads. */
interface WebManifestStore {
  readonly active_manifest?: string | null;
  readonly manifests?: Readonly<Record<string, unknown>> | null;
  readonly validation_status?: readonly unknown[] | null;
}

/** Minimal c2pa-web serialized Manifest shape the normalizer reads. */
interface WebManifest {
  readonly claim_generator?: string;
  readonly title?: string | null;
  readonly instance_id?: string;
  readonly label?: string | null;
  readonly signature_info?: unknown;
  readonly assertions?: readonly unknown[];
}

/** Minimal c2pa-web serialized ManifestAssertion shape. */
interface WebAssertion {
  readonly label: string;
  readonly data?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asManifest(v: unknown): WebManifest | null {
  return isObject(v) ? (v as WebManifest) : null;
}

/** Narrow a `validation_status` array to the mapper's view. Pure. */
function normalizeStatuses(v: unknown): C2PAValidationStatusView[] | null {
  if (!Array.isArray(v)) {
    return null;
  }
  const out: C2PAValidationStatusView[] = [];
  for (const entry of v) {
    if (!isObject(entry)) {
      continue;
    }
    const code = entry.code;
    if (typeof code !== 'string') {
      continue;
    }
    out.push({
      code,
      ...(typeof entry.explanation === 'string' ? { explanation: entry.explanation } : {}),
      ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
    });
  }
  return out;
}

/**
 * Normalize a c2pa-web serialized ManifestStore into the
 * {@link C2PAManifestStoreView} the mapper consumes.
 *
 * Returns `null` when `input` is not a recognizable store (the caller then
 * produces an empty `EvidenceGraph` → engine fails closed to `unknown`). When
 * the store exists but the active manifest label cannot be resolved to an
 * object, `active_manifest` is set to `null` while `validation_status` is still
 * surfaced, so a tamper/unknown-code status is not silently dropped.
 *
 * @param input The value returned by `reader.manifestStore()` (or `null`).
 */
export function normalizeWebManifestStore(input: unknown): C2PAManifestStoreView | null {
  if (!isObject(input)) {
    return null;
  }
  const ms = input as WebManifestStore;

  const statuses = normalizeStatuses(ms.validation_status);

  const label =
    typeof ms.active_manifest === 'string' && ms.active_manifest.length > 0
      ? ms.active_manifest
      : null;
  const manifests = isObject(ms.manifests) ? ms.manifests : null;
  const rawManifest = label && manifests ? manifests[label] : undefined;
  const manifest = asManifest(rawManifest);
  if (!manifest) {
    return { active_manifest: null, validation_status: statuses };
  }

  const active: Record<string, unknown> = {};
  if (typeof manifest.claim_generator === 'string') {
    active.claim_generator = manifest.claim_generator;
  }
  if (manifest.title !== undefined) {
    active.title = manifest.title;
  }
  if (typeof manifest.instance_id === 'string') {
    active.instance_id = manifest.instance_id;
  }
  if (manifest.label !== undefined) {
    active.label = manifest.label;
  }
  if (manifest.signature_info !== undefined) {
    active.signature_info = manifest.signature_info;
  }
  if (Array.isArray(manifest.assertions)) {
    active.assertions = manifest.assertions
      .filter((a): a is WebAssertion => {
        if (!isObject(a)) {
          return false;
        }
        return typeof (a as { label?: unknown }).label === 'string';
      })
      .map((a) => ({ label: a.label, ...(a.data !== undefined ? { data: a.data } : {}) }));
  }

  return { active_manifest: active as C2PAManifestView, validation_status: statuses };
}
