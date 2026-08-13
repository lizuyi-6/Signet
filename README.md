# Signet — AI-native Trusted Display Runtime

Signet sits between digital content and the screen the user actually sees.
It discovers media on a page, reads whatever provenance evidence is available
(C2PA / Content Credentials, cryptographic signatures, hashes, AI labels), and
translates that machine evidence into a calm, human-understandable trust state.

> **Signet is NOT a fake-news detector.** It answers *"what can we currently
> verify?"* — never *"what is the truth of the world?"*

## Core semantic states

| State | Meaning |
| --- | --- |
| `Verified` | Hard provenance exists, signature valid, integrity valid. |
| `Verified AI` | Same as above, plus a declared AI-generated/edited step. **AI ≠ Fake.** |
| `Provenance Broken` | Provenance exists, but integrity/signature verification failed. |
| `Unknown` | No verifiable provenance found. **Unknown ≠ Fake.** |

`Unknown` is the fail-closed default for errors, conflicts, missing assets, and
insufficient evidence — never `Verified`.

## Status

End-to-end working. A Chrome/Edge (MV3) extension reads C2PA provenance from
media and overlays a trust badge; the four trust states are correct on the
committed fixtures, the decision engine is benchmarked against a specification
oracle, and the whole path is covered by a Playwright acceptance smoke. The
Intelligence Layer (advisory semantic context: role / related claims / why it
matters) is opt-in and display-only.

| Package | Role |
| --- | --- |
| `@signet/core` | Domain model: asset, evidence, trust state, metadata. |
| `@signet/trust-engine` | Deterministic, fail-closed Trust Decision rule engine (R1–R5). |
| `@signet/evidence` | Pure mapper (`C2PAManifestStoreView` → `EvidenceGraph`) + `c2pa-node` read path. |
| `@signet/evidence-web` | Pure normalizer (c2pa-web serialized shape → mapper view) + browser `c2pa-web` reader. |
| `@signet/intelligence` | **Advisory** semantic layer: heuristic classifier, claim↔asset mapping, contextual explanation. Never touches trust. |
| `@signet/extension` | The MV3 extension: content script (scan + Shadow-DOM badge), background SW, offscreen doc (runs WASM), options page. |
| `@signet/demo` | "Industry Intelligence Report" demo page hosting the 4 fixtures + an Intelligence Report page. |
| `@signet/gen-fixtures` | Build-time signer: emits signed/AI/tampered/unsigned PNGs + self-verifies. |
| `@signet/benchmark` | 386-case decision-engine benchmark vs an independent spec oracle. |

Architecture and the load-bearing decisions live in `docs/architecture.md` and
`docs/decisions.md` (D11–D25). Per-phase progress is tracked in
`docs/progress.md` (status is never written as "done", only `done(evidenced)`).

## The Intelligence Layer (advisory, opt-in)

Signet also *understands* what each image does on the page — its role (chart,
logo, news photo, …), which page claims it illustrates or supports, and a plain
"why this matters" sentence. This is the **Intelligence Layer**, and it is
strictly **advisory**:

> **AI understands / crypto proves / the rule engine decides / Signet displays.**

The inviolable split: the deterministic Trust Decision Engine is the **sole
authority** for `Verified / Verified AI / Provenance Broken / Unknown`. A soft
or AI signal can **never** promote content to Verified, nor demote
cryptographically-verified content to Broken (§51 — pinned by
`ai-powerlessness.test.ts`). The Intelligence Layer is OFF by default; enable it
on the extension's Options page (no API key required for the local heuristics,
which always run first and fall back on any AI failure).

## Work with this repo

```bash
pnpm install
pnpm verify        # typecheck + test + lint + format:check (235 tests)
pnpm test          # vitest run (235 tests)
pnpm benchmark     # decision-engine benchmark: 386 cases vs the spec oracle
pnpm gen:fixtures  # regenerate the signed PNGs (needs network for the TSA)

pnpm dev           # serve the demo at http://127.0.0.1:5173/

# Build + acceptance-test the extension (needs the demo server running):
pnpm --filter @signet/extension build
node apps/extension/scripts/smoke.mjs          # Playwright: loads dist into real Chromium
node apps/extension/scripts/report-check.mjs   # demo Intelligence Report self-check
```

The smoke test loads the built extension into a real Chromium, navigates to the
demo, and asserts: service worker registers, four trust badges appear, the four
states are Verified / AI Generated / Provenance Broken / Unknown (one each),
tamper flips Verified → Provenance Broken, and clicking a badge opens the
provenance timeline.

## What Signet cannot do

It can verify the **relationship** between a piece of content and the provenance
credentials attached to it. It **cannot** prove that the real-world event a photo
depicts actually happened. A camera can authentically sign a staged photograph.
Neither the Intelligence Layer nor anything else in Signet decides "true" or
"fake" — the trust engine decides only *what can be verified*.

---

*Software First. Hardware Aware. — designed with future BOE display integration in mind,
but not dependent on it.*
