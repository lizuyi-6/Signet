# Signet — Progress Ledger

> **Purpose (rule 7.1).** A durable "what is done / what is not done" account.
> Conversations scroll away; this file must not. Status is never written as
> "完成/done"; only `done(evidenced)` / `in-progress` / `blocked` / `partial`.
>
> **Change-set anchor (rules 5.5 / 6.4 / 2.5).** This repository is **not** a git
> repo (see environment: `Is a git repository: false`), so the global rules'
> `git diff --stat` anchor cannot apply. The substitute anchor is this file's
> per-entry **Changed files** list plus `docs/decisions.md` for semantic changes.
> Any claim of "this round's change set" cites the files listed under the
> current dated entry — never a self-narrowed narrative.

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

## Running the suite

```bash
pnpm install
pnpm verify        # typecheck + test + lint + format:check (66 tests today)
pnpm gen:fixtures  # regenerate signed fixtures (needs network for TSA, D13)
pnpm test          # vitest run (66 tests today)
pnpm benchmark     # decision-engine benchmark: 386 cases vs spec oracle
pnpm dev           # serve apps/demo at http://127.0.0.1:5173/
pnpm --filter @signet/extension build   # build the extension → dist/
node apps/extension/scripts/smoke.mjs        # Playwright acceptance smoke
                                              # (needs: pnpm dev running + built dist)
node tools/spike-web/run.mjs                 # browser C2PA spike (Vite + Playwright, D15)
```
