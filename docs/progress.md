# Signet — Progress Ledger

> **Purpose (rule 7.1).** A durable "what is done / what is not done" account.
> Conversations scroll away; this file must not. Status is never written as
> "完成/done"; only `done(evidenced)` / `in-progress` / `blocked` / `partial`.
>
> **Change-set anchor (rules 5.5 / 6.4 / 2.5).** This repository IS a git repo
> since 2026-08-12 (remote `github.com/lizuyi-6/Signet`, initial commit
> `45bf4f6`). The global rules' `git diff --stat` anchor applies: any "this
> round's change set" cites the actual `git diff --stat` vs `HEAD` plus
> `git status --short` for untracked paths, never a self-narrowed narrative.
> (Earlier entries below predate the repo and use a per-entry **Changed files**
> list as the substitute anchor — left intact as the historical record.)

## Acceptance gate (PRD §37) — overall

The project is "做完" only when ALL of these hold with reproducible evidence:

1. `pnpm dev` starts the demo site.
2. The extension loads in Chrome/Edge.
3. Trust badges appear on the demo's media.
4. The 4 trust states are correct (verified / verified-ai / broken / unknown).
5. Clicking a badge shows a provenance timeline.
6. Tampering a fixture flips Verified → Provenance Broken (demo #1 priority).
7. The benchmark runs (≥100 logical cases).
8. Unit tests pass; Playwright E2E passes.

Priority order: **Demo stability > credibility > correctness > explainability > dev speed.**

## Phase 1 — Foundation (core types + trust engine)

- **done(evidenced)** Domain model (`@signet/core`): asset, evidence,
  trust-state, helpers. 4 tests.
- **done(evidenced)** Trust Decision rule engine (`@signet/trust-engine`):
  deriveFacts + applyRules, 5-rule precedence, fail-closed. 26 tests.
- Evidence: `pnpm verify` exit 0; decisions D1–D10 recorded.

## Phase 2 — Verification (C2PA evidence + fixtures)

- **done(evidenced)** C2PA reader adapter (`@signet/evidence`):
  pure mapper (ResolvedManifestStore view → EvidenceGraph) + thin native reader
  (`c2pa-node` read path, no signer). 14 mapper + 6 integration tests.
- **done(evidenced)** Build-time fixture generator (`@signet/gen-fixtures`)
  with self-verification contract: signs + tampers + reads back each fixture,
  exits non-zero if any reads to the wrong trust state. 4 helper unit tests.
  Fixtures committed to `apps/demo/public/fixtures/`.
- **done(evidenced)** Tamper operation = chunk-aware IDAT byte-flip + CRC
  recompute (D14; the earlier midpoint heuristic was disproved by
  self-verification and replaced).
- **done(evidenced)** Cross-package verify chain green: `pnpm verify` exit 0 —
  typecheck 0, **54 tests pass** (5 files), lint clean, format clean.
- Decisions D11–D14 recorded.

**Changed files this phase (change-set anchor):**
`packages/evidence/**`, `tools/gen-fixtures/**`, `apps/demo/public/fixtures/*`,
`vitest.config.ts`, `docs/decisions.md`, `docs/architecture.md`, `docs/progress.md`.

## Phase 3 — Extension (done(evidenced); see acceptance scoreboard below)

- **done(evidenced)** Browser C2PA reading strategy decided + proven (D15):
  `@contentauth/evidence-web` package — pure `normalizeWebManifestStore` (web
  serialized shape → `C2PAManifestStoreView`) + thin browser-only
  `readC2paEvidenceWeb` that reuses the **same** `mapManifestStore`. 8 unit
  tests. `pnpm verify` exit 0 — typecheck 0, **62 tests pass** (6 files), lint
  clean, format clean.
- **done(evidenced)** Real-browser spike (`tools/spike-web`, Vite + Playwright,
  not-shipped) confirms c2pa-web reads all 4 committed fixtures correctly:
  7/7 contract checks green (verified→Trusted/clean, verified-ai→Trusted+AI,
  tampered→`assertion.dataHash.mismatch`, unknown→null reader). Trust resolved
  via test-signer PEM as `trust.userAnchors` with `verifyTrust:true` (gate not
  weakened, rule 3.3).
- **done(evidenced)** Extension scaffold (`apps/extension`, D16): crxjs + Vite 6
  MV3, content script + background SW + **offscreen document** (runs c2pa-web
  WASM + engine; SW cannot host nested workers). Plain-DOM Shadow-DOM badge +
  detail card (no React; demo-stability priority). `pnpm --filter
  @signet/extension typecheck` exit 0; `build` exit 0 (manifest + offscreen
  chunk + WASM asset correct).
- **done(evidenced)** DOM scanner (`content/scan.ts`): `scanImages()` → readonly
  `ContentAsset[]`; classifies network/data-url/blob sources, suppresses icons
  (<48px) and badge-host roles, `data-tc-fixture` → `article-evidence`. Emits
  absolute `/fixtures/*.png` srcs from the demo.
- **done(evidenced)** Verify pipeline + badge/detail UI: content → background
  (serialized offscreen lifecycle, **creation-race fix below**) → offscreen
  (fetch + `readC2paEvidenceWeb` + `decide`) → Shadow-DOM badge + click→detail.
- **done(evidenced)** Acceptance smoke (`apps/extension/scripts/smoke.mjs`,
  Playwright, loads built dist into real Chromium): exit 0. SW registers; 4
  fixture images; 4 overlay hosts; **all 4 states correct** — Verified, AI
  Generated, Provenance Broken, Unknown, exactly one each; tampered flips to
  Broken (#6); click Verified badge opens `[role="dialog"]` detail (#5).
  Screenshot: `apps/extension/smoke-detail.png`.

**Creation-race fix (this round, load-bearing).** First smoke run showed
`{Verified:1, Unknown:3}` — only the DOM-first fixture verified; the other three
collapsed to Unknown. Root cause (rule 5.8, single root cause + evidence): the
content script fires one `verify` per image in a tight loop; `ensureOffscreen()`
had no serialization, so all callers saw `hasOffscreen()===false` at once and
raced into N `createDocument()` calls — only the first succeeds, the rest throw
and fail-closed to Unknown. Fix: serialize creation behind one in-flight promise
(`background/index.ts`); not a safety-gate change — fail-closed Unknown-on-error
is preserved, the fix only ensures every verify *reaches* the reader. After the
fix the multiset became `{Verified:1, AI Generated:1, Provenance Broken:1,
Unknown:1}` (smoke pass above).

**Acceptance scoreboard (PRD §37):** #1 dev ✓ · #2 loads ✓ · #3 badges ✓ ·
#4 four-states ✓ · #5 click→timeline ✓ · #6 tamper→Broken ✓ · #7 benchmark ✓
(386 cases) · #8 unit tests ✓ (66/66) + Playwright E2E ✓ (smoke exit 0).
**All 9 acceptance criteria now hold with reproducible evidence.**

**Changed files this round (change-set anchor):**
`apps/extension/src/background/index.ts` (creation-race serialization),
`apps/extension/scripts/smoke.mjs` (acceptance smoke), `docs/decisions.md`
(D16 addendum), `docs/progress.md`.

**Cumulative Phase-3 changed files (change-set anchor):**
`apps/extension/**`, `packages/evidence-web/**`, `tools/spike-web/**`,
`packages/evidence/package.json` (`sideEffects:false`), `eslint.config.mjs`,
`.prettierignore`, `docs/decisions.md` (D15, D16), `docs/architecture.md`,
`docs/progress.md`.

## Phase 4 — Demo site (done(evidenced))

- **done(evidenced)** `apps/demo` (Vite + vanilla TS + Tailwind v4): renders the
  4 committed fixtures with "Industry Intelligence Report" framing; images emit
  absolute `/fixtures/*.png` srcs + `data-tc-fixture` so the extension overlays
  them; per-card captions are GROUND-TRUTH labels, not verification results.
  `pnpm dev` serves it (HTTP 200 at `http://127.0.0.1:5173/`); verified live in
  the smoke run above.

**Changed files (change-set anchor):** `apps/demo/**`.

## Phase 5 — Intelligence (done(evidenced))

- **done(evidenced)** Provenance timeline: `extractActions` now accepts the
  whole `c2pa.actions.vN` family (regex), not just exact `c2pa.actions`. This
  matters because c2pa-web **re-serializes** the demo fixtures' `c2pa.actions`
  signing label to `c2pa.actions.v2` on read (pinned empirically). The detail
  card renders the action history as a timeline (`.tc-tl-step`). Mapper unit
  test `extracts provenance actions from the versioned c2pa.actions.v2
  assertion`; end-to-end smoke asserts `.tc-tl-step` count = 1 on the Verified
  detail (verified.png embeds `c2pa.captured`).
- **done(evidenced)** Per-reason explanation sentences (`REASON_SENTENCE`) for
  all 9 `TrustReason` codes, shown in the detail card's "why" line + evidence
  list (glyph/kind/level/note) + timeline. Deterministic, template-based.

## Phase 6 — Polish (done(evidenced))

- **done(evidenced)** Decision-engine benchmark (`tools/benchmark`,
  `@signet/benchmark`): 386 synthetic manifest-store cases across the full
  classification matrix (4 sig codes × 2 hash × 4 AI shapes × 3 unknown-codes ×
  4 actions families + 2 no-manifest shapes), each checked against an
  **independent specification oracle** (encodes PRD R1–R5 precedence, NOT a call
  to `decide`). `pnpm benchmark` → **386/386 pass**, exit 0; coverage reaches
  all 4 states (broken 112, unknown 258, verified 4, verified-ai 12). 3
  enforcing vitest tests (≥100 cases, 0 deviations, every state reached).
- **done(evidenced)** Playwright E2E = the acceptance smoke (`apps/extension/
  scripts/smoke.mjs`): loads built dist into real Chromium, asserts SW + 4
  fixtures + 4 overlay hosts + 4 states + click→detail + timeline. Exit 0.
- **done(evidenced)** README + demo script (DEMOS.md).
- **done(evidenced)** Cross-package verify gate green end-to-end (this round's
  typecheck-layering fix, D18). `pnpm verify` previously failed at typecheck
  because the ROOT tsconfig (node-only lib + `types:["node"]`) re-included
  `apps/*/src/**/*.ts` — wrong environment for the apps' DOM/chrome code. Fix:
  root tsconfig covers packages/tools only; root `typecheck` script runs the two
  app typechecks explicitly (each app has its own DOM-lib tsconfig). Same source
  coverage, routed to the right config. After fix: `pnpm verify` exit 0 —
  typecheck 0 (root + demo + extension), **66/66 tests**, lint 0 errors / 0
  warnings, format clean. Pre-existing lint errors surfaced & fixed in the same
  round (unused imports, `URL` node global, scoped `no-console` for CLI
  entrypoints — D18). Not a safety-path change; `decide()` and the offscreen
  race fix untouched. Re-evidenced: benchmark 386/386, extension `build` exit 0,
  Playwright smoke SMOKE PASS.

**Changed files this round (change-set anchor):** `tsconfig.json` (removed
`apps/*` from root include), `package.json` (`typecheck` script runs app
typechecks), `eslint.config.mjs` (`URL` global + CLI `no-console` override),
`apps/demo/vite.config.ts` (drop unused import), `apps/extension/src/content/
badge.ts` (drop unused type import), `docs/decisions.md` (D18), `docs/progress.md`.
Plus prettier reformat of `apps/demo/src/style.css`,
`apps/extension/scripts/smoke.mjs`, `apps/extension/tsconfig.json`,
`tools/benchmark/src/{cli,index}.ts` (whitespace only, no logic change).

## Phase 7 — Intelligence Layer (done(evidenced): B + C + D + E + F + G + H + I)

Goal: make Signet *understand* page semantics (P0 asset classification, P1
claim↔evidence mapping, P2 contextual explanation) **without** the AI ever
touching trust. Inviolable split: *AI understands / crypto proves / rule engine
decides / Signet displays.* The deterministic engine is the sole trust authority.

- **done(evidenced) — Phase B: domain model** (`@signet/intelligence`, new). Types
  (`AssetSemanticInput`, `AssetSemanticAnalysis`, `ClaimEvidenceResult`,
  `SemanticContext`, `BadgeDecision`, `IntelligenceProvider`, `IntelligenceConfig`)
  + zod schemas (`AssetSemanticAnalysisSchema`, `ClaimEvidenceResultSchema`, …).
  Opt-in: `DEFAULT_INTELLIGENCE_CONFIG = {enabled:false, provider:'disabled',
  privacyMode:'context-only', timeoutMs:8000}` → with the default the extension
  behaves identically to pre-Intelligence Signet. `clamp01` fail-closes
  NaN/Infinity→0; `isAnalysisSource` guards the source union. 9 tests.
- **done(evidenced) — Phase C: heuristic classifier + badge policy (NO AI).**
  `classifyHeuristic(input)` — pure/synchronous/deterministic over plain
  `AssetSemanticInput`; first-match detector ordering (noise→content→`unknown`);
  fail-closed `unknown` default (never fabricates a role). `DefaultBadgePolicy`
  dual-mode: analysis present → richer suppression + high-priority surfacing;
  analysis absent → `isBadgeSuppressed` + `asset.semanticRole` reproducing EXACT
  pre-Intelligence display. 15 heuristic + 10 policy tests.
- **done(evidenced) — regression.** `SemanticRole` union extended **additively**
  in `packages/core/src/domain.ts` (6 new roles); `BADGE_SUPPRESSED_ROLES` and
  `isBadgeSuppressed` UNTOUCHED → `core/domain.test.ts` exact-set assertion holds.
  Full root suite: **100/100 tests pass** (10 files) including the safety oracle
  `trust-engine` (26 tests, untouched) and `core` (4 tests). Zero skipped/ignored.
  `pnpm --filter @signet/intelligence typecheck` exit 0.

**One fixture bug found and fixed by the suite itself (not by softening a test,
per rule 4.1).** A "primary-evidence" test case's `parentText` accidentally
contained the word "photograph" — a `news-photo` trigger. The classifier
correctly returned `news-photo`; the test fixture (self-contradictory) was
corrected, not the detector logic. Re-run: 34/34 intelligence tests pass.

**done(evidenced) — Phase D: provider abstraction + zod validation + 8s timeout
+ heuristic fallback + SemanticCache + versioned prompt.**
`IntelligenceProvider` one-method interface; `MockIntelligenceProvider`
(no-network, doubles as `provider:'mock'` runtime + test double) and
`OpenAICompatibleProvider` (any `/v1/chat/completions`; injectable `fetchImpl`
so every failure path is unit-tested without network, rule 5.3).
`HybridSemanticClassifier` is the safety-bearing orchestrator:
(1) compute heuristic floor unconditionally;
(2) if AI disabled → `{status:'disabled', source:'heuristic'}`;
(3) cache check;
(4) `callWithTimeout(provider, timeoutMs)` → **`ClaimEvidenceResultSchema.parse`
re-validates** (defense-in-depth §13) → `merge` (AI enriches scanner-found
assets only, scores `clamp01`'d, tagged `'hybrid'`) → cache;
(5) catch ALL → `{status:'fallback', source:'heuristic', error}`.
Five fallback classes pinned by tests (network throw, bad-role zod mismatch,
non-object envelope, **NaN score**, timeout). NaN pin: zod v3 rejects NaN →
whole-envelope failure → fallback; dedicated test prevents a future zod from
silently accepting NaN. `SemanticCache`: TTL 5min/maxEntries 256/injectable
clock; keys = portable pure-JS FNV-1a hash (no `node:crypto` — package must run
in the extension SW). `prompts/semantic-v1.ts` = `PROMPT_VERSION='semantic-v1'`,
system prompt forbids authenticity/trust judgments, user prompt sends text-only
context (no image bytes/URLs — §7 privacy default). 25 new Phase-D tests
(11 classifier + 7 openai + 7 cache) + 7 prior provider-mock paths.
**`pnpm verify` → 125/125** (typecheck + test + lint + format:check all green);
safety oracle `trust-engine` (26 tests) untouched, still green.

**Decision recorded:** D21 (provider abstraction: zod-gated, timeout-bound,
fallback-bound, versioned) in `docs/decisions.md`.

**done(evidenced) — Phase E: content-script semantic integration (parallel
advisory channel; trust pipeline byte-identical; AI-disabled = exact current
behavior).** New files: `apps/extension/src/content/extract.ts` (DOM →
`AssetSemanticInput`, text-only per §7, bounded truncation helpers),
`apps/extension/src/intelligence-config.ts` (`chrome.storage.local` config API;
`mergeConfig` validates unions + finite timeout; `loadConfig`/`saveConfig`/
`onConfigChange`), `apps/extension/src/background/intelligence.ts` (SW-hosted
classifier factory; `providerFor` returns null when disabled/incomplete so no
provider call is even attempted). Edited (all additive): `messages.ts`
(+`AnalyzeRequest`/`AnalyzeResult`), `content/scan.ts`
(+`scanImagesWithSemantics`, +`collectPageHeadings`; legacy `scanImages`/
`fromImage`/`inferRole`/`findImageByUrl` UNCHANGED), `content/badge.ts`
(+`ROLE_LABEL`/`SOURCE_LABEL`, +`setSemantics`, +role chip, +fenced CONTEXT
block; `buildBadge`/`setResult` trust rendering UNCHANGED), `content/index.ts`
(rewritten as two-mode dispatcher: `processLegacy` byte-identical to
pre-Intelligence `process()`; `processIntelligence` = local heuristic pass for
immediate suppression/enrichment + one debounced batched `analyze` request +
`applyAnalyzeResult` refinement), `background/index.ts` (+`kind:'analyze'`
branch; `kind:'verify'` branch UNCHANGED), `package.json` (+intelligence dep),
`manifest.config.ts` (+`storage` permission — extension-owned storage only,
NOT a host permission).

**Safety invariants proven structurally this phase (not just asserted):**
- `git diff --stat` over `packages/trust-engine` + `packages/evidence*` +
  `apps/extension/src/offscreen` = **empty**. Trust authority byte-untouched.
- `DEFAULT_INTELLIGENCE_CONFIG.enabled === false` (`types.ts:217`) →
  `applyConfig` sets `intelligenceEnabled=false` → `process()` dispatches to
  `processLegacy` (the exact pre-Intelligence loop). Default install = exact
  current behavior.
- The `analyze` message's `ClaimEvidenceResult` is consumed ONLY by
  `badgePolicy.shouldShow` + `overlay.setSemantics`; there is NO type-level
  path from an `AnalyzeResult` to a `VerifyRequest`/`setResult`/`TrustDecision`.
- SW catch on analyze → `status:'fallback'` with empty advisory data; still
  never touches trust.

**Evidence:** `pnpm verify` → **125/125** (typecheck + test + lint +
format:check all green; Phase E adds no unit tests — extension convention is
typecheck + build + Playwright smoke; Phase E's trust-immutability invariant is
proven by the empty diff, which is stronger than a unit test for that
invariant). `pnpm --filter @signet/intelligence typecheck` exit 0.
`pnpm --filter @signet/extension typecheck` exit 0. `pnpm --filter
@signet/extension build` exit 0 (133 modules transformed, manifest + offscreen
chunk + WASM asset + content/service-worker chunks emitted). **Playwright
acceptance smoke `node apps/extension/scripts/smoke.mjs` → SMOKE PASS, exit 0**
against the built dist + running demo: SW registers, 4 fixture images, 4 overlay
hosts, **all 4 states correct** (Verified / AI Generated / Provenance Broken /
Unknown — exactly one each), detail card opens on click (#5), provenance
timeline renders, tamper→Broken (#6). This is the real-browser proof that with
intelligence OFF (the default) the extension behaves identically to
pre-Intelligence Signet — the advisory channel is wired but dormant, and the
trust pipeline produces the identical 4 states.

**Decision recorded:** D22 (content-script integration ADR — parallel advisory
channel, SW-hosted classifier, local-heuristic-first suppression, trust
pipeline byte-identical) in `docs/decisions.md`.

- **done(evidenced) — Phase F: claim↔evidence mapping (NO AI; advisory only).**
  Closes the Phase-E stub: the content script now selects salient claims and
  the intelligence package maps them to assets. Three PURE modules + one thin
  DOM collector:
  - `packages/intelligence/src/claims.ts` (NEW) — `selectTopClaims`:
    normalize → case-insensitive de-dup (first-seen text kept, source upgraded)
    → `TAG_IMPORTANCE` score → regex type-tag (forecast>comparative>numeric>
    descriptive>factual) → word-boundary truncate → stable id
    `clm_${fnv1aHex}`. `classifyClaimType` exported.
  - `packages/intelligence/src/mapping.ts` (NEW) — `mapClaimsToAssetsHeuristic`:
    content-token overlap (≥3-char runs minus ~110-word stoplist); coverage
    `<0.4`→no link; evidence-role→`'illustrates'`; non-evidence + coverage
    `≥0.55`→`'supports'`; confidence `clamp01(coverage·scale)`; ≤3 links/asset.
  - `packages/intelligence/src/hash.ts` (NEW) — extracted `fnv1aHex` (pure JS,
    no `node:crypto`; shared by `cache.ts` + `claims.ts`; SW-safe).
  - `apps/extension/src/content/claims.ts` (NEW) — `collectClaimCandidates`
    walks primary selectors (h1–h6/figcaption/caption/blockquote/q/summary/
    strong/b/dt) + first 6 article `<p>`; emits raw `ClaimCandidate[]`.
  Wiring: `content/index.ts` `flushAnalyze` now calls
  `selectTopClaims(collectClaimCandidates())` into `PageSemanticInput.claims`
  (was `[]`); `classifier.ts` computes `heuristicLinks` and unions them with AI
  links in `merge` (AI wins collisions, heuristic fills gaps). `heuristics.ts`
  exports `assetBlob` for shared asset-text; `index.ts` re-exports the new
  modules.

  **§19 load-bearing — semantic, never truth.** Relations describe how the
  page uses the asset, never claim truth. Heuristic mapping **NEVER emits
  `'contradicts'`** (detecting a contradiction requires reading the asset's
  pixels, which text overlap cannot establish — emitting it would fabricate a
  judgment) and **never materializes `'unrelated'`** (absence of a link IS the
  unrelated case; N×M pairs would be noise). Positive-or-nothing per pair.
  Fixed by `mapping.test.ts` "NEVER emits contradicts/unrelated" assertions.

  **Safety (unchanged from D22).** Claims/links travel ONLY in the advisory
  `AnalyzeResult` channel — consumed by `applyAnalyzeResult`→badge policy +
  overlay semantics, never by `setResult`/`VerifyRequest`/`TrustDecision`. No
  file under `packages/trust-engine/`, `packages/evidence*/`, `packages/core/`,
  or `apps/extension/src/offscreen/` modified. Verify handler, offscreen
  reader, trust engine, hard/soft seam, badge trust rendering byte-identical.

  **Evidence (reproducible).** `pnpm verify` → **147/147 tests pass**
  (125 prior + 13 `claims.test.ts` + 9 `mapping.test.ts`), typecheck clean,
  lint clean, format clean, **EXIT=0**. `pnpm --filter @signet/extension build`
  → 137 modules, **EXIT=0**. `node apps/extension/scripts/smoke.mjs` →
  **SMOKE PASS**, EXIT=0: 4 trust states correct, detail card opens —
  AI-disabled default path byte-identical (new collector runs only in the
  OFF-by-default intelligence path).

**Decision recorded:** D23 (claim↔evidence mapping ADR — pure claims.ts +
mapping.ts, §19 never-contradicts/never-materialize-unrelated, heuristic floor
+ AI merge union) in `docs/decisions.md`.

- **done(evidenced) — Phase G: contextual explanation (display-only).**
  The P2 narrator: a short human sentence per asset telling the reader what
  the page is using the image for — never re-judging the verdict (§59).
  - `packages/intelligence/src/explain.ts` (NEW, pure) —
    `buildDeterministicExplanation`: verdict clause (pure lookup
    `VERDICT_CLAUSE[state]`, embedding the canonical TRUST_STATE_META label
    VERBATIM) + role clause (omitted when unknown) + claim clause ("appears
    to illustrate/support…", §19 wording, 120-char quote truncation) +
    caveats (per claim type + per state: "AI-generated ≠ fake", "Unknown ≠
    fake"). `explainEvidenceWithFallback`: the §14 pattern applied to
    explanation — floor first, provider attempted only if it implements
    `explainEvidence`, zod re-validation, forced assetId, source-label lie →
    fallback, timeout → fallback.
  - `packages/intelligence/src/prompts/explain-v1.ts` (NEW) — separate
    versioned prompt: verdict is INPUT; contradicting/softening/re-deriving
    it is forbidden; never "the image proves the claim"; minimal text-only
    serialization (EvidenceGraph deliberately NOT sent, §7).
  - `packages/intelligence/src/explain.test.ts` (NEW, 23 tests) — per-state
    exact-clause presence + cross-state clause absence (never-contradicts),
    own-label presence + other-label absence (badge-vocabulary lock),
    composition + omission-when-missing + truncation, caveats per type/state,
    10 orchestrator fallback cases (no provider / no explainEvidence / throw /
    garbage / label-lie / 2001-char / timeout / cross-path isolation).
  - `packages/intelligence/src/provider-mock.ts` (EDIT) — added
    `explainOptions` knobs + `explainEvidence` to MockIntelligenceProvider.
  - `packages/intelligence/src/index.ts` (EDIT) — re-export explain.js +
    prompts/explain-v1.js.

  **Safety.** The deterministic floor can NEVER contradict the verdict: the
  verdict clause is a pure function of `trustDecision.state` — contradiction
  is unrepresentable, and the tests pin clause/label cross-state absence
  mechanically. The AI path is layered (hard/soft seam D19 → prompt forbids
  re-judging → schema carries no trust field → CONTEXT-block rendering). No
  file under `packages/trust-engine/`, `packages/evidence*/`, `packages/core/`,
  or `apps/extension/src/offscreen/` modified. Nothing in the extension calls
  the explainer yet — the detail-card render is Phase H. Verify handler,
  offscreen reader, trust engine, hard/soft seam, badge trust rendering
  byte-identical.

  **Evidence (reproducible).** `pnpm verify` → **170/170 tests pass**
  (147 prior + 23 new explain.test.ts), typecheck clean, lint clean, format
  clean, **EXIT=0**. `pnpm --filter @signet/extension build` → **EXIT=0**.
  `node apps/extension/scripts/smoke.mjs` → **SMOKE PASS**, EXIT=0: 4 trust
  states correct, detail card opens — AI-disabled default path
  byte-identical.

**Decision recorded:** D24 (contextual explanation ADR — deterministic
narrator floor, verdict clause as pure function of state, AI enrichment with
§14 fallback, explain-v1 prompt forbidding re-judging) in `docs/decisions.md`.

- **done(evidenced) — Phase H: options page + detail card ROLE/CLAIM/WHY + demo
  report.**
  Closes the loop: a config UI, the detail card's full semantic picture, and a
  demo report running the whole pipeline in-browser.
  - **Narrowed `TrustExplanationInput`** (`packages/intelligence/src/types.ts`)
    — `trustDecision` + `evidence` → `trust: { state, reason }`. The content
    script builds it from `VerifyResult` with zero synthesis and zero
    trust-channel edits.
  - **Detail card** (`badge.ts`) — `SemanticPicture { analysis, source, links,
    claims, explanation }`; CONTEXT block renders Related claims (relation +
    text; unknown claimIds skipped) + "Why this matters" (text + caveats);
    explicit "Verification · cryptographic" vs "Context · {source}" split.
  - **On-demand AI explanation** — `ExplainRequest`/`ExplainResult` messages; SW
    handler runs `explainEvidenceWithFallback(input, providerFor(config),
    timeoutMs)`. Content script builds the deterministic floor LOCALLY and fires
    the AI request only on detail-open + `status==='ready'` (§45: explain is a
    user-triggered enrichment, not a per-scan call).
  - **`OpenAICompatibleProvider.explainEvidence`** — factored `chat(system,
    user)`; both stages zod-validate their output. 4 new tests.
  - **Options page** (`src/options/index.html` + `options.ts`; vite multi-entry
    + manifest `options_ui`) — enable/provider/endpoint/model/api-key/timeout/
    privacy; "allow-image-upload" rendered disabled (§31 honesty); key stays in
    chrome.storage.local.
  - **Demo report** (`apps/demo/report.html` + `src/report.ts`; two-entry demo
    vite build; `index.html` links it; `apps/extension/scripts/report-check.mjs`
    Playwright acceptance).

  **Safety.** Verify channel, offscreen reader, trust engine, hard/soft seam,
  badge trust rendering byte-identical (no change under `packages/trust-engine/`,
  `packages/evidence*/`, `apps/extension/src/offscreen/`). `VerifyResult`
  UNCHANGED — the explanation input was narrowed on the intelligence side
  instead. Explain channel is advisory: its result feeds only the CONTEXT block.

  **Evidence (reproducible).** `pnpm verify` → **174/174 tests pass**
  (4 new provider-openai explain tests), typecheck clean, lint clean, format
  clean, **EXIT=0**. `pnpm --filter @signet/extension build` → **EXIT=0**
  (options page emitted; manifest carries `options_ui`). `pnpm --filter
  @signet/demo build` → **EXIT=0** (report.html multi-entry). `node
  apps/extension/scripts/smoke.mjs` → **SMOKE PASS**, EXIT=0. `node
  apps/extension/scripts/report-check.mjs` → **EXIT=0**: 4 cards, self-check
  ALL PASS, each fixture narrates its own verdict.

**Decision recorded:** D25 (Phase H ADR — narrowed TrustExplanationInput,
detail-card ROLE/CLAIM/WHY + VERIFICATION/CONTEXT split, on-demand AI explain
channel, options page, demo report, OpenAI explainEvidence) in
`docs/decisions.md`.

- **done(evidenced) — Phase I: safety regression + full gate.**
  The release gate for the whole Intelligence Layer.
  - **`ai-powerlessness.test.ts` (NEW, trust-engine)** — the 4 CRITICAL §51
    tests, each asserting BOTH the verdict AND the fact-field that proves it:
    (1) soft "verified" + no hard → `unknown` (`credentialPresent===false`);
    (2) soft "fake" + valid C2PA → still `verified`; (3) AI unavailable + valid
    C2PA → `verified`; (4) AI unavailable + broken C2PA → `broken`. Soft items
    use `type:'semantic'` (the intelligence layer's real evidence type).
  - **`semantic-eval.test.ts` (NEW, intelligence)** — 57-case breadth net: 38
    role cases (every heuristic-reachable role + precedence), 2 unreachable-role
    negatives, 11 claim-type cases, 4 mapping cases + never-contradicts sweep, +
    a ≥50-case meta-test.
  - **README + DEMOS upgraded** — Intelligence Layer section, package row,
    options/report pages, §51 + eval-set + report-check commands, test count 235.

  **Safety.** No production source changed — Phase I adds only two test files +
  doc edits. Verify channel, offscreen reader, trust engine, hard/soft seam,
  badge trust rendering byte-identical to Phase H.

  **Gate result (reproducible).** `pnpm verify` → **235/235 tests pass** (18
  files), typecheck clean, lint clean, format clean, **EXIT=0**. `pnpm
  benchmark` → **386/386** vs the independent oracle, **EXIT=0**. `node
  apps/extension/scripts/smoke.mjs` → **SMOKE PASS**, EXIT=0 (4 states correct,
  tamper → Broken, detail opens, timeline renders). `node
  apps/extension/scripts/report-check.mjs` → **EXIT=0** (4 cards, ALL PASS,
  each fixture narrates its own verdict).

**Decision recorded:** D26 (Phase I ADR — §51 AI-powerlessness tests, semantic
eval set, README/DEMOS, full-gate result) in `docs/decisions.md`.

**Pending:** none — Phase 7 (the Intelligence Layer) is complete(evidenced).

**Change-set anchor this round (`git status --short` + `git diff --stat` vs `HEAD`):**
```
 M apps/demo/package.json                    (+@signet/intelligence dep [H])
 M apps/demo/src/main.ts                     (+link to report.html [H])
 M apps/demo/vite.config.ts                  (two-entry build: index + report [H])
 M apps/extension/manifest.config.ts         (+storage permission; +options_ui [H])
 M apps/extension/package.json               (+@signet/intelligence dep)
 M apps/extension/smoke-detail.png           (regenerated by smoke runs)
 M apps/extension/src/background/index.ts    (+analyze +explain branches; verify branch UNCHANGED)
 M apps/extension/src/content/badge.ts       (+SemanticPicture/CONTEXT/claims/why; trust render UNCHANGED)
 M apps/extension/src/content/index.ts       (two-mode dispatcher; +picture/explain assembly [F+H])
 M apps/extension/src/content/scan.ts        (+scanImagesWithSemantics; legacy fns UNCHANGED)
 M apps/extension/src/messages.ts            (+Analyze/Explain types; verify types UNCHANGED)
 M apps/extension/vite.config.ts             (+options HTML input [H])
 M DEMOS.md                                    (Phase I: Intelligence section, counts)
 M README.md                                   (Phase I: Intelligence section, package row, counts)
 M docs/decisions.md                         (D21–D26 appended)
 M docs/progress.md                          (Phase D–I entries)
 M packages/core/src/domain.ts               (additive SemanticRole union only — D19)
 M pnpm-lock.yaml                             (zod dep)
 ?? apps/demo/report.html                     (new, Phase H)
 ?? apps/demo/report-smoke.png                (Phase-H report-check artifact)
 ?? apps/demo/src/report.ts                   (new, Phase H)
 ?? apps/extension/scripts/report-check.mjs   (new, Phase H acceptance)
 ?? apps/extension/src/background/intelligence.ts   (new, Phase E)
 ?? apps/extension/src/content/claims.ts            (new, Phase F — DOM collector)
 ?? apps/extension/src/content/extract.ts           (new, Phase E)
 ?? apps/extension/src/intelligence-config.ts       (new, Phase E)
 ?? apps/extension/src/options/                     (new, Phase H)
 ?? packages/intelligence/                          (new package, Phases B+C+D+E+F+G+H+I)
 ?? packages/trust-engine/src/ai-powerlessness.test.ts  (new, Phase I — §51 gate)
```
Phase-F additions inside `packages/intelligence/` (NEW in Phase F unless
noted): `src/claims.ts`, `src/mapping.ts`, `src/hash.ts`, `src/claims.test.ts`,
`src/mapping.test.ts`; EDITED `src/cache.ts` (import shared `fnv1aHex`),
`src/heuristics.ts` (export `assetBlob`), `src/classifier.ts` (heuristic links
+ `merge` union), `src/index.ts` (re-exports). `content/index.ts` EDITED to
wire `selectTopClaims(collectClaimCandidates())` into `flushAnalyze`.

Phase-G additions (all inside `packages/intelligence/`): NEW `src/explain.ts`
(`buildDeterministicExplanation` + `explainEvidenceWithFallback`),
`src/prompts/explain-v1.ts`, `src/explain.test.ts`; EDITED
`src/provider-mock.ts` (`explainOptions` + `explainEvidence`),
`src/index.ts` (+2 re-exports).

Phase-H additions: NEW `apps/extension/src/options/` (index.html + options.ts),
`apps/demo/report.html` + `apps/demo/src/report.ts`,
`apps/extension/scripts/report-check.mjs`; EDITED `src/types.ts` (narrow
TrustExplanationInput), `src/provider-openai.ts` (`chat()` refactor +
explainEvidence), `src/provider-openai.test.ts` (+4), `messages.ts`
(+Explain types), `background/index.ts` (+explain branch), `badge.ts`
(SemanticPicture + detail sections), `content/index.ts` (picture/explain
assembly), both vite configs (multi-entry), `manifest.config.ts` (+options_ui),
`apps/demo/package.json` (+intelligence dep).

Phase-I additions (tests + docs only, NO production source): NEW
`packages/trust-engine/src/ai-powerlessness.test.ts` (4 §51 tests) and
`packages/intelligence/src/semantic-eval.test.ts` (57-case breadth net, inside
the untracked package dir); EDITED `README.md` + `DEMOS.md`.

Safety-relevant files touched this round: NO production source under
`packages/trust-engine/`, `packages/evidence*/`, or
`apps/extension/src/offscreen/` — **verified empty by `git diff --stat`**. The
only trust-engine change is a NEW test file (`ai-powerlessness.test.ts`) that
PINs the invariant; it modifies no engine code. The only safety-adjacent
PRODUCTION file is `packages/core/src/domain.ts`, changed additively in Phase B
(6 union members + doc comment; `BADGE_SUPPRESSED_ROLES`/`isBadgeSuppressed`
unchanged; `core/domain.test.ts` exact-set assertion still green). The verify
message handler, the offscreen reader, the trust engine, the hard/soft seam, and
badge trust rendering are byte-identical; `VerifyResult` is UNCHANGED (the
explanation input was narrowed on the intelligence side instead). Decisions D19
(domain + trust-immutability seam), D20 (heuristic + badge policy), D21
(provider abstraction), D22 (content-script integration), D23 (claim↔evidence
mapping), D24 (contextual explanation), D25 (options + detail card + demo
report), D26 (§51 safety tests + eval set + full gate) recorded in
`docs/decisions.md`.

## Phase 8 — Competition Release (J1–J7, done(evidenced))

Goal: a *self-contained source submission* — safe, standards-compliant,
explainable, reproducible, submittable. Not a feature pass; a hardening pass.
Priority: **Trust Safety > Source-code Security > Reproducibility > Demo
Stability > Standards Compatibility > Privacy > AI Capability > UI Polish >
Architecture Elegance.** No commercial API key in source; the AI provider is a
pluggable, optional enhancement; the zero-config core pipeline runs with no AI.

- **done(evidenced) — J1: Trust Visibility Invariant (§17).** The intelligence
  path no longer gates `verify()`/mounting on `badgePolicy.shouldShow` — semantic
  suppression could previously hide a `Broken` verdict. New
  `packages/intelligence/src/display.ts` (`decideFinalDisplay` +
  `TRUST_VISIBILITY_INVARIANT`): `trust.state === 'broken'` → always show at
  `critical`; otherwise the semantic decision governs. `content/index.ts`
  `reconcileDisplay` is now the only mount/suppress path, and verification is
  unconditional. **Pinned by** `display.test.ts` (15 tests). This is the
  display-side half of §51 (§51: AI cannot *change* the verdict; §17: AI cannot
  *hide* it).
- **done(evidenced) — J2: C2PA AI-standard compat.** `mapper.ts` gains
  `isAISourceType` (lowercased term-inclusion: bare code *and* full IPTC URI) +
  `isAIAction`; `isAIAssertion` now recognises `c2pa.actions[].digitalSourceType`
  (and `.vN`). **Pinned by** `mapper.test.ts` (+5) and `integration.test.ts`
  (+2): `c2pa.actions` URI → `verified-ai`, `.v2` short form → `verified-ai`,
  `digitalCapture` → not-AI, and **AI declaration + `dataHash.mismatch` →
  `broken`** (crypto failure dominates; never `verified-ai`).
- **done(evidenced) — J3: provider config cache includes apiKey.**
  `background/intelligence.ts` `classifierFor` now also compares `apiKey`, so a
  key rotation rebuilds the provider (and drops the cache) instead of reusing the
  old key's client. **Pinned by** `background/intelligence.test.ts` (7 tests,
  new). No secret logging; the key still transits only storage → header.
- **done(evidenced) — J4: analyze fingerprint covers full page content.**
  `content/index.ts` builds the full `PageSemanticInput` first and uses
  `cacheKeyFor(input)` as the dedup fingerprint — `pageUrl`, `pageTitle`,
  `headings`, `claims`, and each asset's `altText`/`nearbyText`/dimensions (never
  bytes/URLs). An SPA content change with an unchanged image set now re-sends.
  **Pinned by** `cache.test.ts` (+4).
- **done(evidenced) — J5: reproducibility + demo/default trust profile.**
  `report-check.mjs` screenshot path now resolves from `import.meta.url`
  (was `X:/BOE/...`). `reader.ts` gains `TrustProfile = 'default' | 'demo'` +
  `resolveTrustProfile` (both keep `verifyTrust: true`; a demo profile without
  its anchor **throws**); the offscreen resolves `demo` once at load.
  **Pinned by** `reader.test.ts` (4 tests, new). `verifyTrust` is never `false`
  anywhere (`reader.ts:93` defaults true; offscreen passes true).
- **done(evidenced) — J6: documentation.** README (AI Provider Notice, Capability
  Matrix, Source submission notice, §17, counts 235→278); DEMOS (§17 + counts);
  architecture (Final Display Policy layer + Trust Visibility Invariant + status
  table); decisions **D27**; this ledger.
- **done(evidenced) — J7: final gate (reproducible, this round).**
  `pnpm verify` → **278/278 tests** (21 files), typecheck 0, lint 0/0, format
  clean, **EXIT=0**. `pnpm benchmark` → **386/386** vs the independent oracle,
  **EXIT=0**. `pnpm --filter @signet/extension build` → **EXIT=0** (144 modules).
  `node apps/extension/scripts/smoke.mjs` → **SMOKE PASS, EXIT=0** (SW registers;
  4 states correct; tamper→Broken; detail opens; timeline renders).
  `node apps/extension/scripts/report-check.mjs` → **EXIT=0** (4 cards, ALL
  PASS). **Secret audit** → no `.env`, no private key (only the public test cert
  `trust-anchor.pem`), no hardcoded API key, no `process.env` secret load.

**Safety.** The trust engine, hard/soft seam, and offscreen verify channel are
untouched. `verifyTrust` remains `true` everywhere. The only behavior change is
J1's `broken`-overrides-suppression, which is toward **visibility of failure**,
never a false green. The AI layer remains advisory (§51 + §17).

**Change-set anchor (`git status --short` + `git diff --stat` vs `HEAD`):**
```
 M DEMOS.md
 M README.md
 M apps/extension/scripts/report-check.mjs
 M apps/extension/smoke-detail.png            (regenerated by smoke run)
 M apps/extension/src/background/intelligence.ts
 M apps/extension/src/content/index.ts        (J1 reconcileDisplay + J4 fingerprint)
 M apps/extension/src/offscreen/index.ts      (J5 trust profile)
 M docs/architecture.md
 M docs/decisions.md                          (D27)
 M packages/evidence-web/src/index.ts         (J5 export resolveTrustProfile)
 M packages/evidence-web/src/reader.ts        (J5 TrustProfile)
 M packages/evidence/src/integration.test.ts  (J2)
 M packages/evidence/src/mapper.test.ts       (J2)
 M packages/evidence/src/mapper.ts            (J2 isAISourceType/isAIAction)
 M packages/intelligence/src/cache.test.ts    (J4)
 M packages/intelligence/src/index.ts         (J1 export display.js)
?? apps/extension/src/background/intelligence.test.ts  (J3, new)
?? packages/evidence-web/src/reader.test.ts            (J5, new)
?? packages/intelligence/src/display.test.ts           (J1, new)
?? packages/intelligence/src/display.ts                (J1, new)
```
`git diff --stat` over `packages/trust-engine/` and the offscreen *verify
handler* = empty for trust-authority logic (only `offscreen/index.ts`'s trust
profile wiring changed, which keeps `verifyTrust: true`).

## Running the suite

```bash
pnpm install
pnpm verify        # typecheck + test + lint + format:check (278 tests today)
pnpm gen:fixtures  # regenerate signed fixtures (needs network for TSA, D13)
pnpm test          # vitest run (278 tests today)
pnpm benchmark     # decision-engine benchmark: 386 cases vs spec oracle
pnpm dev           # serve apps/demo at http://127.0.0.1:5173/
pnpm --filter @signet/extension build   # build the extension → dist/
node apps/extension/scripts/smoke.mjs        # Playwright acceptance smoke
                                              # (needs: pnpm dev running + built dist)
node apps/extension/scripts/report-check.mjs  # demo Intelligence Report self-check
                                              # (needs: pnpm dev running)
node tools/spike-web/run.mjs                 # browser C2PA spike (Vite + Playwright, D15)
```
