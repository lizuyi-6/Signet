# Signet — Decision Log

Small product and technical decisions made during implementation, per the PRD's
instruction to record judgement calls here rather than block on them. Each entry
carries the rationale and the phase that introduced it.

Format: `D<n> — [Phase] Title`. Decisions are append-only; supersession is noted
inline, never silently rewritten.

---

## D1 — [Phase 1] Package split: `core` + `trust-engine` first

**Decision.** Start with two workspace packages:

- `@signet/core` — pure domain types (asset, evidence, trust-state) and
  trivial pure helpers.
- `@signet/trust-engine` — the deterministic decision engine.

The PRD lists more packages (`evidence`, `screen-intelligence`, `ai`, `ui`). They
are deferred to the phases that need them. `evidence` types currently live inside
`core` because they are tightly coupled to the domain vocabulary and have no
runtime logic to isolate.

**Rationale.** Avoid over-fragmenting the repo before each package has a real
consumer. Packages are cheap to extract later (they already share the workspace
and the `exports → src` resolution model).

---

## D2 — [Phase 1] No build step; packages resolve via `exports → src`

**Decision.** Each package's `package.json` points `exports`/`main`/`types` at
`./src/index.ts`. The root `tsconfig.json` uses `moduleResolution: "Bundler"`.
There is no `tsc` emit, no `dist/`, no bundler for Phase 1.

**Rationale.** Vitest and `tsc --noEmit` both resolve cross-package imports
straight to TypeScript source, so the engine is 100% testable today without a
build pipeline. A real build (for the extension and for publishing) is added in
Phase 3.

---

## D3 — [Phase 1] TypeScript strictness profile

**Decision.** Enable `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `noImplicitReturns`, `isolatedModules`. Do **not**
enable `exactOptionalPropertyTypes` or `verbatimModuleSyntax` yet; `import type`
is used by convention instead.

**Rationale.** `noUncheckedIndexedAccess` is the single highest-value strictness
flag for safety-relevant code (array/object access is `T | undefined`). The two
omitted flags add real friction for domain modelling and would slow Phase 1
without a proportionate safety gain. Revisit before the extension ships.

---

## D4 — [Phase 1] Broken takes precedence over collector error (R1 before R2)

**Decision.** The rule order is `R1 broken → R2 error → R3 conflict → R4 verified
→ R5 default`. An explicit `invalid` integrity/signature yields `broken` **even
if** the evidence collector also reported `verificationError`.

**Rationale.** An `invalid` status is a confident positive claim by the collector
("the hash binding failed"), not a guess. Surfacing it as `broken` is more
informative and — crucially — can never cause a *false verified*, which is the
only outcome the system is designed to prevent. If the collector is unsure it
must emit `status: 'unknown'` plus `verificationError`, which correctly falls to
`unknown`. Covered by the "BROKEN precedence over error" test.

---

## D5 — [Phase 1] Conflicting hard evidence → `unknown`, not `broken`

**Decision.** A *clean* single-source invalid signal (one hash item, `invalid`)
produces `broken`. *Contradictory* hard signals (e.g. two hash items, one
`valid`, one `invalid`) produce `unknown` with reason `evidence-conflict`.

**Rationale.** `broken` is a strong claim — "we detected tampering". A
contradiction is the weaker claim "we cannot tell". Fail-closed honesty: when we
genuinely cannot reconcile the evidence we say so rather than asserting
tampering. The tamper demo uses the clean single-source case, which is
unambiguous.

---

## D6 — [Phase 1] "Credential present" = hard `c2pa` item, specifically

**Decision.** `credentialPresent` is true iff a hard evidence item of type
`c2pa` exists. Trusted `metadata` alone does **not** count as a verifiable
credential for the purposes of `verified`.

**Rationale.** The PRD's verified rule is `credential ∧ signature valid ∧
integrity valid`. Only a C2PA manifest carries the signature + hash binding
needed to satisfy all three. Trusted metadata (signed EXIF, etc.) is hard
evidence but, without a manifest binding the bytes, cannot meet the integrity
prong — so it falls to `unknown` (`insufficient-evidence`). This keeps the
False-Verified Rate at 0 by construction. Relaxing this to accept other
credential formats is a future, evidence-backed decision.

---

## D7 — [Phase 1] `verified-ai` requires a hard, *valid* AI label

**Decision.** `aiDeclared` is true iff a hard `ai-label` item with `status:
'valid'` exists. A soft AI signal (e.g. a VLM heuristic) never sets `aiDeclared`.
A hard `ai-label` that is `invalid` or `unknown` is ignored, so the decision
falls back to `verified` rather than `verified-ai`.

**Rationale.** Soft evidence must never promote state (PRD §9). An invalid
AI label is a known limitation: ideally an explicitly-invalid AI declaration
amid otherwise-valid provenance might warrant `unknown`, but for Phase 1 it is
treated as "no reliable AI declaration" and the asset is simply `verified`.
Revisit if real-world fixtures show this matters.

---

## D8 — [Phase 1] Soft evidence is structurally excluded from hard signals

**Decision.** `deriveFacts` builds `credentialItems`, `signatureItems`,
`integrityItems`, and `aiItems` from the `hard` partition only. Soft items touch
exactly one field: `hasSoftEvidence`.

**Rationale.** The "soft can never produce verified/broken" invariant is enforced
by data flow, not by a rule the engine has to remember to check. This makes the
invariant auditable at a single point and immune to future rule additions.

---

## D9 — [Phase 1] IDs are plain string aliases, not branded

**Decision.** `AssetId` and `EvidenceId` are documentary `type X = string`
aliases, not branded nominal types.

**Rationale.** Construction stays ergonomic for fixtures and producers. Branded
IDs (preventing an `EvidenceId` being passed where an `AssetId` is expected) are
a reasonable hardening step before the extension lands; deferred to avoid
churn while the domain vocabulary is still settling.

---

## D10 — [Phase 1] Display rank orders `unknown` below `broken` but above `verified`

**Decision.** `TRUST_STATE_META.rank`: `verified` 1, `verified-ai` 2, `unknown`
3, `broken` 4. Higher rank = more visually prominent / concerning presentation.

**Rationale.** `broken` is the most actionable signal (something is wrong with
the provenance the user is seeing). `unknown` is informational ("we couldn't
verify"), not an alarm. The badge tone follows: `verified` positive,
`verified-ai` informational, `unknown` neutral, `broken` warning.

---

## D11 — [Phase 2] Runtime reads only; signing is build-time, fixtures committed

**Decision.** The extension, demo reader, and trust engine use **only the C2PA
read path** (`c2pa-node` `read`, via an instance created with `createC2pa()` and
**no signer**). Signing is a one-time build-time step: a Node fixture script
produces signed PNGs, which are committed to the repo. Tampered fixtures are
produced by a byte-flip (no signing).

**Rationale.** De-risked empirically (spike, 2026-08-12): `read` on an unsigned
asset returns `null` cleanly; `read` on a signed asset returns the resolved
manifest with no signer required on the reading side. This removes the only
network dependency from the runtime (signing is where a TSA URL is involved —
see D13), so the extension works fully offline against committed fixtures. The
False-Verified property depends only on the read path + the trust engine, both
of which are now pure-local and deterministic.

---

## D12 — [Phase 2] Validation-status → trust-state mapping (empirically pinned)

**Decision.** The reader adapter maps `c2pa-node` `ResolvedManifestStore`
output to evidence items as follows, with the `validation_status` codes pinned
by a real sign→read→tamper→read spike (c2pa-rs 0.49.2 under the hood):

| Observation from `read` | Evidence produced | TrustState / reason |
|---|---|---|
| `read` returns `null` (no manifest) | empty graph | `unknown` / `no-evidence` |
| active manifest present, `validation_status` empty, `signature_info` present, **no** AI-gen assertion | hard `c2pa` valid + hard `signature` valid + hard `hash` valid | `verified` / `valid-credential` |
| same, **plus** an assertion whose label starts with `c2pa.ai` (e.g. `c2pa.ai.gen`) or whose data carries a `digitalSourceType` of `trainedAlgorithmicMedia`/`compositeWithTrainedAlgorithmicMedia` | above + hard `ai-label` valid | `verified-ai` / `ai-declared-and-valid` |
| `validation_status` contains `assertion.dataHash.mismatch` | hard `hash` **invalid** | `broken` / `integrity-mismatch` |
| `validation_status` contains a `signature.*` / `claimSignature.*` code | hard `signature` **invalid** | `broken` / `signature-invalid` |
| `validation_status` contains any other code, or `read` throws | `verificationError` on the graph | `unknown` / `verification-error` |

The integrity-mismatch code observed in the spike was exactly
`assertion.dataHash.mismatch` with explanation
`"asset hash error, name: jumbf manifest, error: hash verification( Hashes do
not match )"`.

**Rationale.** Pinned by evidence, not memory: the spike produced a signed PNG,
read it back (empty `validation_status`, populated `signature_info`), declared
an AI assertion (`c2pa.ai.gen` with `digitalSourceType:
'trainedAlgorithmicMedia'`, which read back intact), then flipped one byte and
observed the mismatch code. These are the real strings the adapter must match.

---

## D13 — [Phase 2] `tsaUrl` is required by the 0.5.26 native binary for local signing

**Decision.** The fixture-signing script uses `createTestSigner()` (which sets
`tsaUrl: 'http://timestamp.digicert.com'`). It does **not** construct a bare
local signer from the test cert/key without `tsaUrl`.

**Rationale.** Empirical surprise: although `LocalSigner.tsaUrl` is typed
optional in `c2pa-node`'s public `.d.ts`, the **0.5.26 shipped native binary**
rejects a local signer lacking `tsaUrl` with
`TypeError: failed to downcast any to string` (thrown from the async sign
task). This is a binary/source skew — the GitHub tag `v0.5.26` `src/sign/local.rs`
reads `tsaUrl` via `get_opt` (optional), but the prebuilt `.node` behaves as if
it is a required `JsString`. Because signing is build-time only (D11), this
network dependency never reaches the runtime; it only affects regenerating
fixtures. If offline fixture regeneration is later needed, the options are:
pin to an older/newer binary whose behavior matches the type, build c2pa-node
from source, or pre-generate and commit (the current approach).

---

## D14 — [Phase 2] Demo tamper = byte-flip inside the IDAT chunk (CRC recomputed)

**Decision.** The `tamper` fixture operation parses the signed PNG's chunks,
locates the first `IDAT` chunk, flips one byte in the middle of its payload,
recomputes that chunk's CRC, and re-emits the file. The flip is therefore
guaranteed to land in the hashed image data while the PNG stays structurally
valid.

**Rationale.** An earlier version flipped the byte at `floor(length * 0.5)`,
based on a tamper-offset sweep from the spike that showed mid-file offsets
reliably produced `assertion.dataHash.mismatch` on a 256×256 fixture. **That
heuristic was disproved** the first time the real fixture generator ran its
self-verification pass: for the 320×200 demo fixture the midpoint landed
outside the hashed region and `tampered.png` read back as `verified` — a silent
false-verified that the generator's self-check caught and refused to commit.
Chunk-aware IDAT tamper removes all dependence on file layout: the byte is in
the hashed image data by construction, so the reader always reports
`assertion.dataHash.mismatch` → `broken/integrity-mismatch`. CRC is recomputed
so the PNG itself stays valid (c2pa-rs does not reject on CRC mismatch anyway,
but a valid-CRC PNG that differs only in pixels is the most honest "edited
after signing" demo). The lesson is recorded in the generator's
self-verification contract: no fixture is committed unless it reads back to
its intended trust state.

---

## D15 — [Phase 3] Browser C2PA reading: `@contentauth/c2pa-web` (WASM) + shape normalizer

**Decision.** The extension reads C2PA in the browser with
`@contentauth/c2pa-web@0.13.4` (the WASM SDK that wraps `c2pa-wasm`), not by
porting `c2pa-node` (Neon native binding — cannot run outside Node) and not by
hand-rolling a verifier (CLAUDE.md: do not roll our own C2PA/crypto). A new
package `@signet/evidence-web` mirrors `@signet/evidence`:
- `normalize.ts` — a **pure** normalizer (`normalizeWebManifestStore`) that
  maps the web SDK's serialized `manifestStore()` to the same
  `C2PAManifestStoreView` the Node path uses. Zero SDK coupling → runs under
  Node vitest.
- `reader.ts` — a thin browser-only wrapper (`readC2paEvidenceWeb`) that
  lazy-imports `@contentauth/c2pa-web`, reads a `Blob`, normalizes, and feeds
  the result through the **same** `mapManifestStore`. No second classifier, no
  drift.

**Where it runs (load-bearing MV3 constraint).** A c2pa-web Reader spawns a
Web Worker from inlined source. MV3 service workers cannot spawn nested
workers, so this reader **cannot** run in the extension SW and **cannot** run
under Node. It must be invoked from (a) a **content script** with a same-origin
asset fetch, or (b) an **offscreen document** (`chrome.offscreen`) for
cross-origin assets. The Node/SDK proof lives in the throwaway browser spike
`tools/spike-web` (Vite + Playwright, excluded from lint/format as not-shipped).

**Shape difference pinned by the spike.** `c2pa-web`'s serialized store differs
from `c2pa-node`'s `ResolvedManifestStore` in one structurally load-bearing
way: `active_manifest` is the active manifest's **label string** (not a
Manifest object), and the Manifest objects live in `manifests: { [label]:
Manifest }`. The normalizer resolves `manifests[active_manifest]` so the mapper
sees the object shape it expects. Everything else — `validation_status`
entries `{code,url,explanation}` and assertions `{label,data}` — is identical
across both SDKs, so `mapManifestStore` classifies both paths unchanged.

**Trust policy (gate NOT weakened).** The demo fixtures are signed by
`c2pa-node`'s self-signed test signer (`es256.pub`: leaf + intermediate). The
web SDK has **no default trust** for it, so out of the box validation carries
`signingCredential.untrusted`. Resolution: pass the signer's PEM as
`trust.userAnchors` (and `allowedList`), **keeping `verifyTrust: true`**. We
ADD a trust anchor; we do not pass `verifyTrust=false` to make the asset pass
(CLAUDE.md rule 3.3). `WebReaderOptions.verifyTrust` defaults to `true`.

**Empirical facts pinned by the real-browser spike** (`node tools/spike-web/run.mjs`,
7/7 contract checks green, on the committed `apps/demo/public/fixtures/`):

| Fixture | `validation_state` | `validation_status` | AI |
|---|---|---|---|
| verified.png | `Trusted` | `[]` (no `signingCredential.untrusted`) | — |
| verified-ai.png | `Trusted` | `[]` | `c2pa.ai.gen` / `digitalSourceType: 'trainedAlgorithmicMedia'` |
| tampered.png | `Invalid` | `assertion.dataHash.mismatch` (explanation byte-identical to c2pa-node) | — |
| unknown.png | — | `reader.manifestStore()` fromBlob → `null` reader | — |

The integrity code `assertion.dataHash.mismatch` is byte-identical in both SDKs,
which is exactly why the pure mapper transfers with no change. The
normalizer's 8 unit tests assert the load-bearing field values (codes, labels,
`digitalSourceType`, item statuses) captured from this spike.

**Known follow-up (Phase 5, not a classification gap).** The fixtures emit
`c2pa.actions.v2`, but `mapManifestStore.extractActions` matches the exact label
`c2pa.actions`. Timeline actions are therefore empty for the demo fixtures.
The 4 trust states are unaffected; revisit when enriching the provenance
timeline (Phase 5).

---

## D16 — [Phase 3] Extension architecture: crxjs + Vite, verify in offscreen document, plain-DOM Shadow-DOM overlay

**Decision.**
- **Build tooling:** `@crxjs/vite-plugin@2.7.1` + Vite 6 for `apps/extension`
  (MV3 manifest authored as a TS/JS define; content script + background service
  worker + offscreen document entries). Chosen over a hand-rolled multi-entry
  Vite build because crxjs is the mature, supported way to do MV3+Vite and
  reduces manifest/HMR/wiring failure surface.
- **Where c2pa-web runs:** an **offscreen document** (`chrome.offscreen`), not
  the content script and not the service worker. The content script detects
  images + injects badges; the background SW owns the offscreen doc lifecycle
  and relays verify requests; the offscreen doc fetches asset bytes and runs
  `readC2paEvidenceWeb` (evidence-web / c2pa-web). One verification path for
  same-origin (demo) **and** cross-origin (the offscreen doc fetches with
  `host_permissions`).
- **UI stack split:** the demo site (`apps/demo`) uses Vite + vanilla TS +
  Tailwind v4; the extension overlay (badge + detail card + timeline) is
  **plain DOM rendered into a Shadow DOM root with scoped CSS**. React is
  intentionally NOT introduced in this phase: a content-script React root plus
  Tailwind-in-Shadow-DOM is a meaningful styling-isolation/build failure
  surface that is not justified for a badge + card, and "demo stability" is the
  top priority. React remains an option for richer Phase 5/6 surfaces.

**Rationale (offscreen, not content script).** A c2pa-web Reader spawns a Web
Worker from inlined source and fetches WASM. The spike (D15) proved it runs in
a normal web page. Whether it reliably runs inside an **MV3 content script's
isolated world** under MV3 CSP + worker restrictions is **uncertain and not
free to verify cheaply** (would need a built+loaded extension run). Per
fail-closed-on-uncertainty, the offscreen document is the safer choice: it is a
full extension page — environmentally equivalent to the spike's web page — and
is Chrome's recommended MV3 way to run worker/DOM code. The service worker is
explicitly unusable (D15: no nested workers). Cost: one async message round-trip
(content → SW → offscreen → SW → content); messaging is well-trodden and
stable, so the reliability trade favors offscreen.

**Rationale (plain-DOM overlay, not React).** Shadow DOM gives full style
isolation from the host page for free; a hand-written ~150-line badge+card is
more stable than mounting React into a host page's Shadow root and feeding
Tailwind into that root. The decision is reversible: if Phase 5 explanation UI
grows complex, a `@signet/ui` React package can later render into the same
Shadow host.

**Invariant: offscreen creation must be serialized (load-bearing, found by the
acceptance smoke).** The content script emits one `verify` message per image in
a tight loop, so the SW's `onMessage` listener fires N times near-simultaneously
on first scan. Each invocation independently calls `ensureOffscreen()`; without
a guard, every caller observes `hasOffscreen()===false` before any
`createDocument()` has resolved, and all N call `createDocument()`. Only the
first succeeds — the rest throw *"only a single offscreen_document context can
be created at a time"* and the verify fails-closed to `unknown/verification-error`.
Symptom: `{Verified:1, Unknown:3}` — the lone Verified is whichever fixture is
first in DOM order. Fix in `background/index.ts`: a single in-flight `creating`
promise, check-then-assign with no `await` between (atomic across microtasks),
so concurrent callers await the same creation. **This is not a safety-gate
change** — the per-verify fail-closed-to-Unknown-on-error path is unchanged; the
fix only ensures every verify actually reaches the offscreen reader + engine,
which is strictly more correct. Re-verified: smoke multiset became
`{Verified:1, AI Generated:1, Provenance Broken:1, Unknown:1}`, exit 0.

---

## D17 — [Phase 6] Benchmark uses an INDEPENDENT specification oracle, not a self-comparison

**Decision.** The acceptance benchmark (`tools/benchmark`,
`@signet/benchmark`) generates 386 synthetic `C2PAManifestStoreView` cases
across the classification matrix and checks each against an **oracle function
that encodes the PRD rule precedence (R1–R5) directly** — it does NOT call
`decide` or `mapManifestStore`. The oracle is one hand-coded function:

```
no manifest        → unknown / no-evidence
unknown code       → unknown / verification-error   (mapper fail-closes on unrecognised codes)
hash mismatch      → broken  / integrity-mismatch   (R1, integrity before signature)
signature failure  → broken  / signature-invalid
clean + AI declared→ verified-ai / ai-declared-and-valid
clean              → verified / valid-credential
```

The benchmark then asserts `decide(mapManifestStore(store))` matches the oracle
on every case.

**Rationale (why independent).** A benchmark that compares the engine to itself
(a replay of the same rule order) is circular — it can only catch crashes, not
semantic drift. An oracle hand-derived from the SPEC catches the real failure:
someone edits `applyRules` precedence, or `classifyValidationCode`, or the
mapper's unknown-code handling, and the engine silently re-classifies a case.
The oracle stays fixed to the spec, so the diff is surfaced. If the oracle and
the engine disagree, it is a finding either way (engine drifted from spec, or
the oracle mis-encodes it) — and the benchmark fails closed rather than hiding
it.

**Coverage is a real cross-product, not a repeated happy path** (rule 4.4):
4 signature codes × 2 hash × 4 AI shapes × 3 unknown-code injections × 4
`c2pa.actions` family shapes = 384 present-manifest cases + 2 no-manifest
shapes = 386. Every trust state is reached (broken 112, unknown 258, verified 4,
verified-ai 12). The clean states have fewer cases because most dimension values
push toward broken/unknown — an honest reflection of the matrix, not trimming.

**c2pa.actions.vN extraction fix (Phase 5, pinned here).** `extractActions`
matched the exact label `c2pa.actions`. The demo fixtures are SIGNED with label
`c2pa.actions` (gen-fixtures line 210/238), but **c2pa-web re-serializes it to
`c2pa.actions.v2` on read** (pinned by the D15 spike). So the web path produced
an empty timeline. Fix: accept the whole `c2pa.actions.vN` family via regex
(`/^c2pa\.actions\.v\d+$/`). No classification impact (actions are descriptive),
but the provenance timeline now renders real action history. End-to-end smoke
asserts `.tc-tl-step` count = 1 on the Verified detail.

## D18 — [Phase 6] Typecheck layering: root tsconfig covers node-only code, apps typecheck themselves

**Problem.** `pnpm verify` (the cross-package gate, acceptance #8) failed at the
typecheck step with ~40 TS errors — all on `apps/extension/src/**/*.ts` and
`apps/demo/**`: TS2584 `Cannot find name 'document'/'window'`, TS2304
`'chrome'/'HTMLDivElement'/'MutationObserver'`, TS2307
`@contentauth/c2pa-web/resources/c2pa.wasm?url`. Root cause was structural: the
ROOT `tsconfig.json` (which `extends tsconfig.base.json` = lib ES2022 **only**,
no DOM, and sets `types:["node"]`) had `"apps/*/src/**/*.ts"` in its `include`,
so it re-typechecked the apps' DOM/chrome/vite code under the wrong lib. The
apps each already had their OWN correctly-configured tsconfig (lib ES2022 +
DOM + DOM.Iterable, types include `vite/client` and, for the extension,
`@types/chrome`); per-package `pnpm --filter @signet/extension typecheck`
exited 0. This was a pre-existing gap (extension .ts files have used DOM globals
since creation); it was hidden because earlier phases' `pnpm verify` runs hit a
different failing step first or the include was added later.

**Decision.** The root tsconfig must NOT typecheck the apps — it has the wrong
(lib-less-DOM, node-typed) environment for them. Remove `apps/*/src/**/*.ts`
from the root `include` (root now covers `packages/*` + `tools/*` + the vitest
config, which are all node-only). Preserve coverage by making the root
`typecheck` script run the two app typechecks explicitly:

`tsc -p tsconfig.json --noEmit && pnpm --filter @signet/demo typecheck && pnpm --filter @signet/extension typecheck`

Each tsconfig now typechecks the code that matches its environment. The same
source files are covered as before — no coverage lost, just routed to the
config that has the right globals.

**Why not one shared tsconfig with DOM?** packages/* are pure node/library code
(no DOM); giving them DOM globals would hide accidental DOM use. The layering
keeps each layer honest about its environment — the same principle as the
evidence/evidence-web split (D15): node path stays node, browser path gets DOM.

**Not a safety-path change.** This is build-tooling only. The `decide()` engine
(`@signet/trust-engine`), the mapper's fail-closed unknown-code handling,
and the offscreen creation-race serialization (D16) are untouched. Re-evidenced
after the change: `pnpm verify` exit 0 (typecheck 0 + 66/66 tests + lint 0
errors + format clean); `pnpm benchmark` 386/386; extension `build` exit 0;
Playwright smoke SMOKE PASS (4 states + tamper→Broken + click→timeline).

**Lint cleanup in the same round (recorded for traceability).** Three pre-existing
lint errors surfaced once typecheck stopped blocking the gate: unused `resolve`
import (`apps/demo/vite.config.ts`), unused `TrustState` type import
(`apps/extension/src/content/badge.ts`), and `URL` no-undef
(`apps/extension/scripts/smoke.mjs` — `URL` is a Node global since Node 10,
added to eslint `globals`). Also added a scoped `no-console: off` override for
CLI entrypoints (`apps/extension/scripts/**`, `tools/**/cli.ts`) — these print
to stdout as their contract (benchmark report, smoke diagnostics), so console
is intentional there, not a smell. None of these touch runtime behavior; the
smoke re-pass confirms the badge/detail UI is unchanged.



