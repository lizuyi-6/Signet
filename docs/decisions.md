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



---

## D19 — [Phase 7] Intelligence Layer: domain model + trust-immutability seam

**Decision.** Introduce `@signet/intelligence` as the understanding layer. It
UNDERSTANDS page semantics; it never decides trust. The inviolable split
(§11/§42): *AI understands / crypto proves / rule engine decides / Signet
displays.* The deterministic engine (`@signet/trust-engine`) remains the sole
trust authority; nothing in this package reads or writes a `TrustDecision`.

**Safety seam — inherited, not re-implemented (the central design choice).**
Every intelligence output is SOFT evidence. The hard/soft partition already
enforced in `derive-facts.ts` (D8) builds `credentialItems` / `signatureItems` /
`integrityItems` / `aiItems` from the `hard` partition ONLY; soft items touch
exactly one field, `hasSoftEvidence`. Semantic evidence is emitted at
`level: 'soft'`, so by D8's data-flow invariant it **structurally cannot**
produce `verified` / `broken` / `verified-ai` — no new rule and no new check is
required. The property "no AI result may promote to Verified; no AI result may
demote cryptographically-Verified to Broken" (§59) is a consequence of the
existing seam, restated for the Intelligence Layer. This will be pinned by the
Phase I §51 tests (`ai-powerlessness.test.ts`), asserting `decision.state`
remains `unknown` when soft semantic items claim `verified`, and that a valid
hard C2PA manifest stays `verified`/`verified-ai` regardless of any soft claim.

**Opt-in by default.** `DEFAULT_INTELLIGENCE_CONFIG = { enabled:false,
provider:'disabled', privacyMode:'context-only', timeoutMs:8000 }`. With the
default, the extension behaves byte-identically to pre-Intelligence Signet; the
layer is an enhancement, never a dependency (§11).

**zod gates every AI response (§13, rule: never `JSON.parse`+trust).**
`AssetSemanticAnalysisSchema` / `ClaimEvidenceResultSchema` /
`ContextualExplanationSchema` assert STRUCTURE (right shape, right enum). Any
structural failure — wrong role enum, missing field, non-object — makes the
`HybridSemanticClassifier` fall back to the deterministic heuristic result
(implemented Phase D). Score RANGE is asserted separately by `clamp01` after
parsing (NaN/Infinity → 0, fail-closed). The `SemanticRoleSchema` literal list is
kept in sync with `core/domain.ts` by a compile-time drift-guard test that
assigns the parsed value back to a `SemanticRole`.

**Domain model mirrors the evidence/evidence-web split (D15).** Heavy consumers
(heuristics, providers) operate on plain `AssetSemanticInput` data, NOT on live
DOM, so the whole package is unit-testable under Node vitest
(`environment:'node'`, no jsdom). The content script owns the only DOM touch — a
thin extractor (Phase E) that produces `AssetSemanticInput`.

**Additive `SemanticRole` extension (NOT a safety-path change).** Six new roles
appended to the union in `packages/core/src/domain.ts`:
`primary-evidence` / `supporting-evidence` / `data-visualization` / `news-photo`
/ `illustration` / `logo`. Existing roles are kept; `BADGE_SUPPRESSED_ROLES`
(still `{'icon','avatar','decoration'}`) and `isBadgeSuppressed` are UNCHANGED so
`core/domain.test.ts`'s exact-set assertion holds. Verified: full root suite
**100/100** (10 files), including `trust-engine` (26 tests, untouched) and
`core` (4 tests). The richer suppression (logo, advertisement) lives in the new
`DefaultBadgePolicy`, not in the core suppression set (D20).

**Evidence (Phase B).** `packages/intelligence/src/{types,schemas,index}.ts` +
`types.test.ts` (9 tests). `pnpm --filter @signet/intelligence typecheck` exit 0.
`pnpm exec vitest run` → 100/100.

---

## D20 — [Phase 7] Heuristic classifier + dual-mode badge policy (no AI)

**Decision.** Two pure, deterministic, AI-free modules that together give Signet
a useful understanding layer the moment the package exists — even before any
provider is wired.

**`classifyHeuristic(input: AssetSemanticInput) → AssetSemanticAnalysis`**
(`heuristics.ts`). Pure, synchronous, no I/O, always succeeds. First-match
detector ordering: `decoration → advertisement → avatar → logo → icon → chart →
screenshot → illustration → product → evidence → unknown`. Rationale for the
order: noise first so a tiny logo is labeled `logo` (not `icon`, and never
evidence); content types next; the fail-closed `unknown` default is last — the
classifier never fabricates a role it cannot justify (fail-closed applies to
*understanding* too, §59 "Unknown ≠ Fake"). Signals: empty `alt=""` → decoration
(the HTML-spec decorative signal); word-boundary text hints (logo/brand,
avatar/profile, chart/graph/plot, screenshot, illustration/diagram,
product/buy/price, photo/reuters/getty); size (`<48px` → icon, matching legacy
`scan.ts`); structure (large image inside article context → primary-evidence,
with photo attribution → news-photo). Scores are per-role baselines nudged by
signal strength; `confidence` ∈ [0.35, 0.7]. These are ADVISORY ONLY and
explicitly distinct from trust confidence (§59 "Semantic Confidence ≠ Trust
Confidence").

**`DefaultBadgePolicy`** (`policy.ts`). Dual-mode, the single authority on
whether/where to badge:
- **Intelligence ON (analysis present):** richer suppression — adds `logo` and
  `advertisement` to core's `{icon,avatar,decoration}` set; surfaces
  `chart`/`data-visualization`/`news-photo`/`primary-evidence` at **high**
  priority; conditional roles (`illustration`/`unknown`/…) show at normal
  priority iff `importance ≥ 0.3`, else suppressed to keep the page calm (§6/§29).
- **Intelligence OFF (no analysis):** falls back to `isBadgeSuppressed` +
  `asset.semanticRole`, reproducing EXACTLY the pre-Intelligence display. The
  layer is an enhancement, never a behavioral dependency.

This touches display ONLY; it never reads or writes a `TrustDecision`.

**Evidence (Phase C).** `packages/intelligence/src/{heuristics,policy}.ts` +
`heuristics.test.ts` (15 tests) + `policy.test.ts` (10 tests). `pnpm --filter
@signet/intelligence typecheck` exit 0; `pnpm exec vitest run packages/intelligence`
→ 34/34; full root suite → 100/100.

**Calibration honesty (rule 4.1 — no test was softened).** One suite run failed:
a "primary-evidence" test case's `parentText` accidentally contained the word
"photograph", which is a `news-photo` trigger. The classifier correctly returned
`news-photo`; the *fixture* was self-contradictory and was corrected (word
changed to "figure"), not the detector. This incident is itself evidence that
the press-photo attribution signal fires as designed. No test was skipped,
`it.skip`'d, or had its assertion relaxed; the suite's `total` only rose across
these rounds.

### D21 — [Phase 7] Intelligence provider abstraction: zod-gated, timeout-bound, fallback-bound, versioned

**Status:** accepted. **Date:** 2026-08-12. **Phase:** D.

The provider layer turns the heuristic-only classifier (D20) into a *hybrid*
one without weakening any safety property. The seam is unchanged: this layer
emits only soft `ClaimEvidenceResult` context, and the hard/soft partition in
`derive-facts.ts` (D8/D19) remains the thing that makes soft evidence
structurally unable to promote or demote a `TrustDecision`. This ADR records
the four properties the provider abstraction must hold and where each is
enforced.

**1. Interface, not implementation.** `IntelligenceProvider` is a one-method
interface (`classifyPage(input) → Promise<ClaimEvidenceResult>`). Two
implementations ship:
- `MockIntelligenceProvider` — no-network, deterministic; doubles as the
  legitimate `provider:'mock'` runtime config (demo without an API key) and as
  the test double for every failure path.
- `OpenAICompatibleProvider` — talks to any OpenAI-compatible
  `/v1/chat/completions` endpoint; injectable `fetchImpl` so every failure path
  (timeout, non-2xx, malformed body, missing content, schema mismatch) is
  unit-tested without network (rule 5.3 — no "verify manually" for code we can
  execute locally).

**2. Defense-in-depth zod (§13 — "never `JSON.parse(llmText)` and trust it").**
The schema is enforced **twice**: the provider validates its own output with
`ClaimEvidenceResultSchema.parse`, AND `HybridSemanticClassifier` re-validates
the provider's return value with the same schema before merging. A buggy or
hostile endpoint cannot bypass the schema — the worst it can do is trigger
fallback, which is always safe because heuristic output is soft. The
re-validation line is the single point that converts "hostile provider" into
"fallback", not "bad data".

**3. §14 fallback invariant — AI failure is never fatal.**
`HybridSemanticClassifier.classifyPage` computes the heuristic floor *first*,
unconditionally. It then attempts the provider call raced against a hard
timeout. On ANY failure — throw, abort/timeout, non-2xx, malformed JSON,
non-object envelope, NaN in a score, or zod mismatch — the `catch` returns the
heuristic floor tagged `status:'fallback'`. The classifier therefore **never
throws** and **every scanner asset always has an analysis**. Five dedicated
tests pin the five failure classes (network throw, bad-role zod mismatch,
non-object envelope, NaN score, timeout).

**NaN pin (zod v3).** `z.number()` rejects `NaN` ("Expected number, received
nan") but accepts `Infinity`. A NaN in model output therefore triggers
whole-envelope zod failure → fallback (correct fail-closed). A dedicated test
("falls back when AI scores contain NaN") pins this so a future zod that starts
accepting NaN cannot silently let a NaN score reach the UI. `clamp01` (D19)
independently maps NaN/Infinity → 0.

**4. Merge policy — the scanner is the source of truth for WHICH assets exist.**
AI may only enrich scanner-found assets; it cannot add new ones or drop
existing ones. For each scanner asset: if AI returned a valid analysis, it wins
(tagged `'hybrid'`, scores re-clamped via `clamp01`); otherwise the heuristic
floor fills in (tagged `'heuristic'`). The merge is a pure function of
`(heuristic, ai)`; it touches no `TrustDecision`.

**Cache.** `SemanticCache` (TTL 5 min, maxEntries 256, injectable clock for
tests). Keys are a portable pure-JS FNV-1a 32-bit hash over canonical-JSON of
the page's *text* context — **no `node:crypto`**, because the package must run
in the extension service worker which lacks it. Cache hit returns
`status:'ready', cached:true` without re-invoking the provider.

**Versioned prompt (§30).** `prompts/semantic-v1.ts` exports
`PROMPT_VERSION='semantic-v1'`. The system prompt forbids judging
authenticity/trust/fake — defense-in-depth; the *real* guarantee is the
hard/soft seam, but the prompt aligns model behavior with it. The user prompt
serializes ONLY text context (alt/nearby/headings/claims) — no image bytes, no
asset URLs — honoring the §7/D19 privacy default. `privacyMode:'context-only'`
is the only mode the provider honors today; `allow-image-upload` is a future
opt-in explicitly NOT yet implemented.

**Evidence (Phase D).** `provider-mock.ts`, `provider-openai.ts`, `cache.ts`,
`prompts/semantic-v1.ts`, `classifier.ts` + 5 test files. Intelligence tests:
59 (15 heuristic + 10 policy + 11 classifier + 7 openai + 7 cache + 9 types).
`pnpm verify` → **125/125** (typecheck + test + lint + format:check all green).
The safety oracle `trust-engine` (26 tests) is untouched and still green.

**What this does NOT change (safety).** No file under `packages/trust-engine/`
or `packages/core/` (beyond the additive D19 SemanticRole extension) is
modified by Phase D. The hard/soft seam, the rule engine, and the trust
verdict are byte-identical. This is purely an additive advisory layer.

---

## D22 — Phase E: content-script semantic integration (parallel advisory channel)

**Context.** Phase D produced a fully unit-tested Intelligence package but it
was not yet wired into the extension. Phase E connects it WITHOUT letting any
intelligence result reach the trust pipeline. The architecture principle
(§spec): *AI understands / crypto proves / rule engine decides / Signet
displays.* This ADR records how the wiring preserves that split.

**Decision.** The Intelligence Layer runs as a **parallel advisory channel**
alongside the existing trust pipeline. Four properties hold by construction:

**1. Two dispatch modes, switched by config.** `content/index.ts` keeps a
`process()` dispatcher: `intelligenceEnabled ? processIntelligence() :
processLegacy()`. `processLegacy` is the byte-identical pre-Intelligence body
(`scanImages` → `ensureOverlay` → `verify` → `pruneGoneOverlays`). With the
default config (`DEFAULT_INTELLIGENCE_CONFIG.enabled === false`, confirmed at
`packages/intelligence/src/types.ts:217`), `applyConfig` sets
`intelligenceEnabled = false` and `processLegacy` runs — no intelligence code
executes, no `analyze` message is sent. **AI-disabled = exact current behavior**
is a structural property of the dispatch, not a runtime hope.

**2. Trust pipeline byte-identical.** `git diff --stat` over
`packages/trust-engine`, `packages/evidence`, `apps/extension/src/offscreen` is
empty. The background SW's `kind:'verify'` branch is unchanged (comment marks
it "Trust pipeline (unchanged since D16)"); only a new `kind:'analyze'` branch
was ADDED. The badge's trust rendering (`buildBadge`, `setResult`,
`TRUST_STATE_META` color/glyph/label, `REASON_SENTENCE`) is unchanged; only an
additive role chip + CONTEXT section were appended.

**3. Advisory channel can never reach trust.** The `analyze` message returns an
`AnalyzeResult` whose `result` is a `ClaimEvidenceResult` (advisory
`AssetSemanticAnalysis[]` + `ClaimEvidenceLink[]`). It is consumed ONLY by
`applyAnalyzeResult` → `badgePolicy.shouldShow` (show/suppress + enrichment) and
`overlay.setSemantics` (role chip + CONTEXT block). There is NO path from an
`AnalyzeResult` to `setResult`, to a `VerifyRequest`, or to any `TrustDecision`.
If the SW or provider throws, the catch returns `status:'fallback'` with empty
advisory data — still never touches trust. This is the §14/§59 invariant made
mechanical: the message types and their consumers do not compose into a trust
mutation.

**4. SW hosts the classifier (API key stays in the extension origin).**
`background/intelligence.ts` builds the classifier from `chrome.storage.local`
config; the content script sends only plain `PageSemanticInput` (text context,
no image bytes — §7). The provider round-trip happens in the SW, so the API
key never leaves the extension origin and is never logged. Local heuristic
classification runs in the content script for an immediate calm first paint
(logos/decoration suppressed before any badge mounts, no flash); the hybrid AI
result refines it ~300ms later.

**Progressive UI enrichment (§31 honest labeling).** A `ROLE_LABEL`/`SOURCE_LABEL`
pair renders the advisory role as a muted chip on the badge and a fenced
purple CONTEXT block in the detail card — visually DISTINCT from the
cryptographic verdict so a reader can always tell "what was proven"
(VERIFICATION) from "what the page is using this image for" (CONTEXT). The
chip is labelled `Heuristic` / `AI` / `AI-assisted` per the dominant source, so
"AI-assisted" is never claimed when only heuristics ran.

**What this does NOT change (safety).** No file under `packages/trust-engine/`,
`packages/evidence*`, `packages/core/` (beyond the additive D19 union), or
`apps/extension/src/offscreen/` is modified. The hard/soft seam, rule engine,
trust verdict, verify message handler, and badge trust rendering are
byte-identical. **Phase E adds an advisory display channel; it does not add,
move, or relax any trust gate.**

---

## D23 — Phase F: claim↔evidence mapping (pure heuristic floor + AI merge union)

**Context.** Phase E left `content/index.ts` `flushAnalyze` shipping `claims: []`
to the classifier, so the advisory channel carried asset roles but no
claim↔asset relations. Phase F closes that gap: the content script now selects
the page's salient claims and the intelligence package maps them to assets.

**Shape — three pure modules + one thin DOM collector.**

1. `packages/intelligence/src/claims.ts` (NEW, pure) — `selectTopClaims` takes
   raw `ClaimCandidate[]` (text + source tag) from the DOM and returns 0–8
   `PageClaim`s: normalize → de-dup case-insensitively (first-seen text kept,
   importance/source upgraded on collision) → score by `TAG_IMPORTANCE`
   (h1=0.95 … td=0.32, fallback 0.3) → type-tag via regex precedence
   (forecast > comparative > numeric > descriptive > factual) → word-boundary
   truncate → stable id `clm_${fnv1aHex(normalizedText)}`. Exported
   `classifyClaimType` for direct testing. **No I/O, no DOM.**

2. `packages/intelligence/src/mapping.ts` (NEW, pure) —
   `mapClaimsToAssetsHeuristic` maps selected claims onto classified assets by
   CONTENT-TOKEN overlap (alphanumeric runs ≥3 minus a ~110-word stoplist).
   Per (claim, asset): coverage = matched/tokens; `< 0.4` → no link
   (positive-or-nothing); evidence-role asset → `'illustrates'`; non-evidence
   asset with coverage ≥ 0.55 → `'supports'`; otherwise skip. Confidence is
   `clamp01(coverage * (evidenceLike ? 0.95 : 0.85))`. Capped at
   `MAX_LINKS_PER_ASSET = 3` per asset.

3. `packages/intelligence/src/hash.ts` (NEW, pure) — extracted `fnv1aHex`
   shared by `cache.ts` and `claims.ts`. Pure JS (no `node:crypto`) so it runs
   in the SW.

4. `apps/extension/src/content/claims.ts` (NEW, thin DOM collector) —
   `collectClaimCandidates` walks `document` for the primary selectors
   (h1–h6, figcaption, caption, blockquote, q, summary, strong, b, dt) plus the
   first 6 `main p / article p / section p`. Emits raw `ClaimCandidate[]`; all
   scoring lives in the pure module.

**§19 is load-bearing here — semantic, never truth.** The relations a link
carries (`illustrates` / `supports`) describe **how the page uses the asset
relative to the claim**, never whether the claim is true. Two consequences are
encoded directly:

- **NEVER `'contradicts'`.** Detecting a contradiction requires *reading the
  asset's pixels*; text overlap cannot establish it. Emitting `'contradicts'`
  from overlap alone would fabricate a judgment the heuristic has no basis for.
  (A future VLM *could* — and even then its output is advisory soft evidence,
  never a `TrustDecision`, per §59/D19.) The test "NEVER emits contradicts"
  (`mapping.test.ts`) fixes this invariant mechanically.

- **NEVER materializes `'unrelated'`.** Absence of a link IS the unrelated
  case; emitting all N×M unrelated pairs is pure noise. So the heuristic is
  positive-or-nothing per pair.

**Merge policy (classifier.ts `merge`).** Assets: unchanged from D20 (AI
enriches scanner-found assets, cannot add/remove). Links: UNIONED by
`(claimId, assetId)` — AI wins collisions, heuristic fills any pair AI omitted.
This keeps the advisory mapping continuous across AI success/failure: losing
the AI call never loses a link the heuristic floor had established. With AI
OFF (the default), the result still carries heuristic links.

**What this does NOT change (safety).** No file under `packages/trust-engine/`,
`packages/evidence*/`, `packages/core/`, or `apps/extension/src/offscreen/` is
modified. Claims and links travel ONLY in the advisory `AnalyzeResult`
(`ClaimEvidenceResult`) consumed by `applyAnalyzeResult` → badge policy +
overlay semantics — the same channel D22 audited as unable to reach a
`TrustDecision`. The verify message handler, the offscreen reader, the trust
engine, the hard/soft seam, and badge trust rendering remain byte-identical.
**Phase F populates an advisory field that Phase E had left empty; it does not
add, move, or relax any trust gate.**

**Evidence.** `pnpm verify` → 147/147 tests pass, typecheck clean, lint clean,
format clean (EXIT=0). New tests: `claims.test.ts` (13: type precedence ×5,
selection ×8), `mapping.test.ts` (9: fail-closed ×3, relation semantics ×4,
confidence bounds ×1, end-to-end ×1). `pnpm --filter @signet/extension build`
→ 137 modules (EXIT=0). `node apps/extension/scripts/smoke.mjs` → SMOKE PASS
(EXIT=0): 4 trust states correct, detail card opens — AI-disabled default
path byte-identical (the new collector runs only in the OFF-by-default
intelligence path).

---

## D24 — Phase G: contextual explanation (deterministic narrator floor + AI enrichment, display-only)

**Context.** Phases B–F gave the advisory channel two things: per-asset
semantic roles and claim↔asset links. Phase G adds the P2 layer: a short
human sentence narrating, per asset, what the page is using it for — while
NEVER re-judging the trust verdict (§59).

**Contract.** `TrustExplanationInput` / `ContextualExplanation` /
`ContextualExplanationSchema` existed since Phase B (types.ts + schemas.ts).
`ContextualExplanation` is `{ assetId, text, source: 'deterministic'|'ai',
caveats: string[] }` — structurally incapable of carrying a trust verdict.
Phase G implemented what the contract describes.

**Deterministic floor — `explain.ts` `buildDeterministicExplanation` (pure).**
Composes three clauses from GIVEN data only:
1. **Verdict clause** — a pure lookup `VERDICT_CLAUSE[trustDecision.state]`.
   Each clause embeds the canonical `TRUST_STATE_META` label VERBATIM ("Verified"
   / "AI Generated" / "Provenance Broken" / "Unknown" — the exact words the
   badge shows), so the narration is vocabulary-locked to the badge. This is
   the mechanical "never contradicts": the output is a function of the given
   state, not of any re-derivation.
2. **Role clause** — "On this page it functions as {role phrase}." from the
   already-classified semantic role; omitted when no role is known (never
   invented).
3. **Claim clause** — "It {appears to illustrate / appears to support /
   appears to run against / is not clearly related to} the claim: '…'." §19
   wording: the relation is narrated with "appears to", NEVER as proof.
   Claim quote word-boundary truncated at 120 chars.

**Caveats.** Two sources, both surfacing what a reader must NOT conclude:
per-claim-type (forecast/numeric/comparative/factual/descriptive — "provenance
verifies the image, not the prediction/numbers/…") and per-state
(verified-ai → "AI-generated ≠ fake"; unknown → "does not mean the content is
real or fake").

**AI enrichment — `explainEvidenceWithFallback`.** The §14 pattern applied to
explanation: deterministic floor computed FIRST; the provider is attempted
only if it implements the optional `explainEvidence`; its output is
re-validated with `ContextualExplanationSchema` (a provider cannot bypass the
shape), `assetId` is FORCED to the input's (a provider cannot retarget the
sentence at another asset), and the schema's `source: z.literal('ai')` means a
provider cannot lie about its label — any failure, garbage, or timeout yields
the floor. Explanation is therefore always available, exactly like
classification.

**System prompt — `prompts/explain-v1.ts`.** The explain prompt is a SEPARATE
versioned prompt (`explain-v1`) that takes the trust verdict as INPUT and
forbids contradicting, softening, strengthening, or re-deriving it; forbids
claiming the image proves the claim; forbids inventing missing roles. The user
message serializes ONLY minimal text context (state/reason, role, claim text,
relation, page title/domain) — the full `EvidenceGraph` is deliberately NOT
sent (§7 privacy default).

**Defense layers for the free-text AI path (in order).** (1) hard/soft seam:
an explanation has no path to a `TrustDecision` (D19); (2) prompt forbids
re-judging; (3) schema carries no trust field; (4) the rendered text sits in
the advisory CONTEXT block, visually separate from the cryptographic verdict.
The deterministic floor — the only thing that renders when AI is off (the
default) — is protected by something stronger than any of these: its verdict
clause is a pure function of state, so contradiction is unrepresentable.

**What this does NOT change (safety).** No file under
`packages/trust-engine/`, `packages/evidence*/`, `packages/core/`, or
`apps/extension/src/offscreen/` is modified. `explainEvidenceWithFallback`
lives in the intelligence package; nothing in the extension yet calls it (the
detail-card rendering of the explanation is Phase H). The verify handler,
offscreen reader, trust engine, hard/soft seam, and badge trust rendering
remain byte-identical. **Phase G adds a narrator; it does not add, move, or
relax any trust gate.**

**Evidence.** `pnpm verify` → 170/170 tests pass (147 prior + 23 new
`explain.test.ts`), typecheck clean, lint clean, format clean (EXIT=0). The
23 new tests pin: per-state exact-clause presence AND cross-state clause
absence (never-contradicts); per-state own-label presence AND other-label
absence (badge-vocabulary lock); composition (role/claim/relation clauses,
omission-when-missing, 120-char quote truncation); caveats per claim type +
per state; and 10 orchestrator cases (no provider → floor; provider without
`explainEvidence` → floor; valid AI → source 'ai' with forced assetId; throw →
floor; garbage → floor; source-label lie → floor; 2001-char text → floor;
timeout → floor; mock cross-path isolation). `pnpm --filter @signet/extension
build` → EXIT=0; `node apps/extension/scripts/smoke.mjs` → SMOKE PASS (EXIT=0):
4 trust states correct, detail card opens — AI-disabled default path
byte-identical.

---

## D25 — Phase H: options page + detail card (ROLE / CLAIM / WHY) + demo report

**Context.** Phases B–G built the intelligence package and wired the advisory
channel; Phase G's explainer had no consumer and the Options page was a stub.
Phase H closes the loop: a config UI, the detail-card rendering of the full
semantic picture, and a demo report that runs the whole pipeline in-browser.

**1. Narrowed `TrustExplanationInput` (a Phase-H refinement of Phase G).** The
explainer had carried `trustDecision: TrustDecision` + `evidence: EvidenceGraph`.
Neither is used by the deterministic floor, and the AI prompt deliberately
excludes the graph (§7 privacy). Rather than touch the trust channel to supply
`ruleId`/`contributingEvidence` (the offscreen computes them but `VerifyResult`
drops them), the input was narrowed to `trust: { state, reason }` and the
`evidence` field removed. This is a **semantic contract change** (6.4):
`TrustExplanationInput.trustDecision` → `TrustExplanationInput.trust`, `evidence`
→ removed. The content script builds it from its own `VerifyResult` (state +
reason) + advisory semantics with zero synthesis and zero trust-channel edits —
the verify message, offscreen reader, and trust engine stay byte-identical
(D22/D23/D24's invariant preserved).

**2. Detail card: ROLE / RELATED CLAIM / WHY THIS MATTERS (VERIFICATION vs
CONTEXT split, §31).** `badge.ts`'s `SemanticState` grew into a
`SemanticPicture { analysis, source, links, claims, explanation }`. The CONTEXT
block now renders: role + confidence (muted), the asset's claim↔asset links as
"Related claims" (relation label + claim text; links whose claimId is unknown
are SKIPPED — fail-closed, never render an id we can't explain), and "Why this
matters" (the explanation text + caveats). The VERIFICATION section gets an
explicit "Verification · cryptographic" title; the CONTEXT title is labelled
`Context · {Heuristic|AI|AI-assisted}`. The split is visual: everything above
the purple fence is the engine's verdict; everything inside it is advisory.

**3. On-demand AI explanation (display-only).** `messages.ts` gains
`ExplainRequest`/`ExplainResult`; the SW handles `explain` via
`explainEvidenceWithFallback(input, providerFor(config), timeoutMs)` — the §14
pattern, so any failure yields the deterministic floor. The content script
builds the deterministic explanation LOCALLY (pure, no round-trip) and fires
the AI request ON DEMAND when the detail card opens AND the analyze call was
AI-live (`status==='ready'`) — at most once per asset per page state. This
respects §45's "one provider call per scan" for classification (the explain
call is a user-interaction-triggered enrichment, not a per-scan call). The
`TrustOverlay` constructor takes an optional `onDetailOpen` hook; the card
renders the floor immediately and refreshes when the AI answer lands.

**4. `OpenAICompatibleProvider.explainEvidence`.** The HTTP round-trip was
factored into a private `chat(system, user)` used by both `classifyPage`
(semantic-v1) and `explainEvidence` (explain-v1); each re-validates its output
with the stage-specific zod schema. Same timeout/AbortController, same
Authorization header, same privacy (text-only).

**5. Options page.** `src/options/index.html` + `options.ts`; wired as a
multi-entry vite input and `options_ui` (open_in_tab). Fields: enable toggle,
provider (disabled/mock/openai-compatible), endpoint/model/api-key (password,
shown only for openai-compatible), timeout, privacy mode. The "allow-image-
upload" privacy value is rendered DISABLED — the provider does not honor it
yet, and overstating what the extension sends would violate §31 honesty. The
API key transits chrome.storage.local → the SW provider only; it is never
logged and never embedded.

**6. Demo report page.** `apps/demo/report.html` + `src/report.ts` run the full
pipeline in-browser (mock provider, no key, no network): claims → heuristic →
mock-AI merge → links → deterministic + AI explanations, rendering the same
VERIFICATION/CONTEXT split and a falsifiable self-check block. The demo app
became a two-entry vite build; `index.html` links to the report. A
`report-check.mjs` Playwright script loads `/report.html` and asserts ALL PASS
+ 4 cards.

**What this does NOT change (safety).** The verify channel (`VerifyRequest`/
`VerifyResult`), the offscreen reader, the trust engine, the hard/soft seam,
and badge trust rendering remain byte-identical — `git diff --stat` shows no
change under `packages/trust-engine/`, `packages/evidence*/`, or
`apps/extension/src/offscreen/`. `VerifyResult` is UNCHANGED (the explanation
input was narrowed on the intelligence side instead). The explain channel is
advisory: its result feeds only the CONTEXT block. **Phase H adds a config UI
and display enrichment; it does not add, move, or relax any trust gate.**

**Evidence.** `pnpm verify` → 174/174 tests (4 new provider-openai explain
tests), typecheck clean, lint clean, format clean (EXIT=0). `pnpm --filter
@signet/extension build` → EXIT=0 (options page emitted,
`manifest.json` carries `options_ui`). `pnpm --filter @signet/demo build` →
EXIT=0 (report.html multi-entry). `node apps/extension/scripts/smoke.mjs` →
SMOKE PASS (EXIT=0). `node apps/extension/scripts/report-check.mjs` → EXIT=0:
4 cards, self-check ALL PASS, each fixture's deterministic explanation narrates
its own verdict (Verified / AI Generated / Provenance Broken / Unknown).

---

## D26 — Phase I: safety regression + full gate

**Context.** The final phase is the release gate: pin the §51 AI-powerlessness
invariant as named tests, add a broad semantic eval set, and re-run the whole
regression (verify + benchmark + both Playwright checks).

**1. `ai-powerlessness.test.ts` — the 4 CRITICAL §51 tests (trust-engine).**
The inviolable invariant (§11/§51/D19) is now a named, greppable suite. Each
test asserts BOTH the user-visible verdict AND the fact-field that mechanically
proves it (derive-facts.ts drops every `level:'soft'` item from the
credential/signature/integrity/ai buckets — soft can only set
`hasSoftEvidence`):
1. soft "verified" + no hard → `unknown` (`credentialPresent === false`);
2. soft "fake" + valid C2PA → still `verified` (`integrityStatus === 'valid'`);
3. AI unavailable + valid C2PA → `verified` (zero soft items);
4. AI unavailable + broken C2PA → `broken` (zero soft items).
The adversarial soft items use `type:'semantic'` (the intelligence layer's
evidence type, "soft only") so the test models the real channel, not a strawman.

**2. `semantic-eval.test.ts` — 57-case breadth net (intelligence).** Three
tables: 38 role cases (every heuristic-reachable role × variants + precedence:
tiny-logo-not-icon, ad-beats-chart, logo-beats-chart, icon-beats-chart,
screenshot-beats-diagram), 2 unreachable-role cases (hero-image /
article-evidence are AI/legacy-only and asserted NOT produced), 11 claim-type
cases, 4 mapping cases + a never-contradicts sweep. A meta-test asserts the set
stays ≥ 50 cases (rule 4.1: the count is part of the contract).

**3. README + DEMOS upgrade.** README gains the Intelligence Layer section,
the `@signet/intelligence` package row, the options page + report page, and the
correct test count (235). DEMOS gains section 4 ("The Intelligence Layer —
advisory, never the verdict") and refreshes the credibility-evidence commands
(smoke + report-check + §51 + eval set).

**Gate result (reproducible).** `pnpm verify` → 235/235 tests (18 files),
typecheck clean, lint clean, format clean (EXIT=0). `pnpm benchmark` → 386/386
vs the independent oracle (EXIT=0). `node apps/extension/scripts/smoke.mjs` →
SMOKE PASS (EXIT=0): 4 trust states correct, tamper → Broken, detail opens,
timeline renders. `node apps/extension/scripts/report-check.mjs` → EXIT=0: 4
cards, self-check ALL PASS, each fixture narrates its own verdict.

**What this phase does NOT change (safety).** No production source under any
package changed — Phase I adds only `ai-powerlessness.test.ts`,
`semantic-eval.test.ts`, and doc edits. The verify channel, offscreen reader,
trust engine, hard/soft seam, and badge trust rendering remain byte-identical
to Phase H.



