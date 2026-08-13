# Signet — Architecture

This document describes the target architecture and, for each layer, its current
implementation status. It is intentionally honest about what exists today
(Phase 1) versus what is planned.

## Product premise

Signet is a trust layer between digital content and the screen. It discovers
media on a page, gathers whatever provenance evidence is available (C2PA /
Content Credentials, signatures, hashes, AI labels), and reduces that
machine evidence to one of four human-understandable states.

**It is not a fake-news detector.** It answers *"what can we currently verify?"*
The truth of the underlying real-world event is out of scope and always will be
(see *Limitations* in the README).

## The four trust states

| State | When |
| --- | --- |
| `Verified` | Hard credential present, signature explicitly valid, integrity explicitly valid. |
| `Verified AI` | Same as `Verified`, plus a hard, valid AI-generated/edited declaration. **AI ≠ Fake.** |
| `Provenance Broken` | Credential present, but signature or integrity explicitly failed. |
| `Unknown` | No usable evidence, or evidence insufficient/conflicting/errored. **Unknown ≠ Fake.** |

`Unknown` is the fail-closed default. Errors, conflicts, missing assets, and
insufficient evidence all collapse to it — never to `Verified`.

## Layered architecture (target)

```
Web Page (DOM / images / context)
        │
        ▼
Asset Discovery Layer        DOM scanner, image detector, URL resolver, region mapping
        │
        ▼
Screen Intelligence          semantic classification, importance, optional VLM
        │
        ▼
Trust Engine                 C2PA, metadata, AI labels, hash, signature, source
        │
        ▼
Evidence Graph               per-asset nodes + edges
        │
        ▼
Trust Reasoner               deterministic rule engine → TrustDecision
        │                       + template/LLM human-readable explanation
        ▼
Final Display Policy         decideFinalDisplay: `broken` always shows at `critical`;
        │                       otherwise the advisory semantic decision governs
        ▼
Display Runtime              badge, detail card, timeline, technical view
```

### Current implementation status

| Layer | Package | Status |
| --- | --- | --- |
| Domain model (asset, evidence, trust state) | `@signet/core` | **Implemented (types + helpers).** |
| Trust Decision rule engine | `@signet/trust-engine` | **Implemented + unit tested (26 tests).** |
| Evidence Graph (types) | `@signet/core` | **Types defined + produced** by the C2PA mapper. |
| C2PA / signature / hash collection (Node) | `@signet/evidence` | **Implemented + tested (20 tests).** Read-only native reader + pure mapper. |
| C2PA collection (browser) | `@signet/evidence-web` | **Implemented + tested (8 tests).** Pure `normalizeWebManifestStore` + thin browser-only reader reusing the same mapper. Proven by real-browser spike (D15, 7/7). |
| Build-time signed fixtures | `@signet/gen-fixtures` | **Implemented.** Self-verifying sign→read→tamper→read generator; 4 helper tests. |
| Asset discovery / DOM scanner | `apps/extension` (`content/scan.ts`) | **Implemented.** `scanImages()` + `scanImagesWithSemantics()`; icons/avatars suppressed. |
| Screen Intelligence (advisory) | `@signet/intelligence` | **Implemented.** Heuristic classifier + optional AI provider + claim↔asset mapping + explanation. Never touches trust (§51). |
| Final Display Policy | `@signet/intelligence` (`display.ts`) | **Implemented.** `decideFinalDisplay` — `broken` always shows at `critical`; otherwise semantic decision governs (§17). |
| Display runtime (badge/card/timeline) | `apps/extension` (`content/badge.ts`) | **Implemented.** Shadow-DOM badge + detail card + provenance timeline. |
| Demo site | `apps/demo` | **Implemented.** 4 committed fixtures + Intelligence Report page. |
| AI provider / reasoner | `@signet/intelligence` (provider + classifier) | **Implemented (optional).** OpenAI-compatible + mock; heuristic floor always runs first; no key in source. |

## Trust model (the part that ships in Phase 1)

The decision engine is split into two pure, independently testable stages:

1. **`deriveFacts(graph) → ProvenanceFacts`** — reconciles the raw evidence
   items into a small set of status signals (`credential`, `signature`,
   `integrity`, `ai`) plus flags (`conflict`, `verificationError`,
   `hasHardEvidence`, `hasSoftEvidence`). Reconciliation ignores `unknown`
   statuses when looking for agreement; known-status disagreement sets
   `conflict`.

2. **`applyRules(facts) → TrustDecision`** — applies five rules in strict
   precedence order and returns a state, a machine reason, the rule id, the
   contributing evidence ids, and a `failClosed` flag.

### Rule precedence

```
R1  broken         credential ∧ (integrity invalid ∨ signature invalid)
R2  error          collector verificationError            → unknown
R3  conflict       contradictory hard evidence            → unknown
R4  verified       credential ∧ credential✓ ∧ signature✓ ∧ integrity✓
                       (+ hard ai✓ → verified-ai)
R5  default        everything else                        → unknown
```

Why `broken` before `error` (D4): an explicit `invalid` is a confident positive
signal and surfacing it can never cause a *false verified* — the only outcome
this system exists to prevent.

### Safety invariants (enforced by construction — False-Verified Rate target: 0)

- `verified` / `verified-ai` require signature **and** integrity to be
  explicitly `valid`. `unknown` statuses never promote.
- Soft evidence is routed into `hasSoftEvidence` only; it can never set any of
  the credential/signature/integrity/ai signals (D8). So soft evidence can never
  produce `verified`, `verified-ai`, or `broken`.
- Errors, conflicts, and missing data all fall through to `unknown`.

These are not just rules the engine checks — they are structural properties of
how facts are derived, which makes them auditable at a single point.

### Trust Visibility Invariant (§17) — the last gate before display

The advisory Intelligence Layer may *suppress* a badge for noise reasons (logo,
decoration, low importance), but it can **never** hide a cryptographically
detected failure. The `Final Display Policy` (`decideFinalDisplay`) is the single
mount/suppress authority, and it is fail-closed toward **visibility of failure**:

> No semantic or AI-derived signal may suppress a cryptographically detected
> provenance failure.

Concretely, `decideFinalDisplay(trust, semantic)` returns `show: true, priority:
'critical'` whenever `trust.state === 'broken'`, regardless of the semantic
`BadgeDecision`; for every other state it defers to semantics. It reads only
`trust.state` (a `TrustView`), so it cannot promote or demote a verdict — it only
decides visibility. Verification itself is independent of this gate: the content
script verifies every eligible asset unconditionally, so a `broken` result can
always surface. This is the display-side half of the AI-powerlessness contract:
§51 proves AI cannot *change* the verdict (`ai-powerlessness.test.ts`); §17
proves AI cannot *hide* it (`display.test.ts`).

## Working with this repo

```bash
pnpm install
pnpm test          # 278 tests (core + trust-engine + evidence + evidence-web + intelligence + fixtures + benchmark)
pnpm typecheck     # tsc --noEmit across the workspace
pnpm lint          # ESLint (flat config, typescript-eslint)
pnpm format:check  # Prettier
```

See `docs/decisions.md` for the rationale behind specific structural and
rule-ordering choices.
