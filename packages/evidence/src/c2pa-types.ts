/**
 * @signet/evidence — structural view of the c2pa-node read result.
 *
 * This is a *narrow, structural* subset of `c2pa-node`'s
 * `ResolvedManifestStore`. We define it locally (rather than importing the
 * binding's types) so that {@link mapManifestStore} is a pure function with
 * **zero native-binary coupling** and can be unit-tested with synthetic
 * fixtures on any platform — see docs/decisions.md D11 (runtime reads only).
 *
 * Field names and shapes match what `c2pa-node` v0.5.26 actually returns at
 * runtime; these were pinned by a sign→read→tamper→read spike, not from
 * memory (see docs/decisions.md D12).
 */

/** A C2PA assertion as surfaced by the reader. */
export interface C2PAAssertionView {
  readonly label: string;
  readonly data?: unknown;
}

/** `signature_info` block on a resolved manifest. */
export interface C2PASignatureInfoView {
  readonly alg?: string;
  readonly issuer?: string;
  readonly cert_serial_number?: string;
  readonly time?: string;
  readonly [extra: string]: unknown;
}

/** The active (most recent) resolved manifest. */
export interface C2PAManifestView {
  readonly claim_generator?: string;
  readonly title?: string | null;
  readonly instance_id?: string;
  readonly label?: string | null;
  readonly signature_info?: C2PASignatureInfoView | null;
  readonly assertions?: readonly C2PAAssertionView[];
}

/** A single validation-status entry. `code` is the load-bearing field. */
export interface C2PAValidationStatusView {
  readonly code: string;
  readonly explanation?: string | null;
  readonly url?: string | null;
}

/**
 * The structural view of `c2pa-node`'s `ResolvedManifestStore` consumed by the
 * mapper. Only the fields the mapper actually reads are listed; everything
 * else is ignored.
 */
export interface C2PAManifestStoreView {
  readonly active_manifest?: C2PAManifestView | null;
  readonly validation_status?: readonly C2PAValidationStatusView[] | null;
}
