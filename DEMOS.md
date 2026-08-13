# Signet — Demo Script

A 5-minute walkthrough. The single most important thing to land: **Signet
tells you what we can *currently verify* — never what is *true*.** AI ≠ fake.
Unknown ≠ fake. The only negative trust state is *Provenance Broken*.

## 0. Bring it up

Three terminals (or run the smoke test, which does all of this headlessly):

```bash
pnpm install
pnpm dev                                  # T1: demo at http://127.0.0.1:5173/
pnpm --filter @signet/extension build  # T2: build → apps/extension/dist
```

Load `apps/extension/dist` unpacked in Chrome/Edge
(`chrome://extensions` → Developer mode → Load unpacked), then open the demo URL.
Trust badges overlay each image within a second.

Or skip the clicking and run the automated acceptance smoke (it loads the built
extension into a real Chromium and asserts everything below):

```bash
node apps/extension/scripts/smoke.mjs   # needs pnpm dev running + a built dist
```

## 1. The four states (the whole product in one screen)

The demo hosts four images. With the extension loaded, each gets a badge:

| Fixture | Badge | What it means |
| --- | --- | --- |
| `verified.png` | ✓ **Verified** (green) | Signed by a trusted signer; signature **and** content hash both verify. |
| `verified-ai.png` | ◈ **AI Generated** (blue) | Same as above **plus** an explicit `c2pa.ai.gen` declaration. **AI ≠ fake.** |
| `tampered.png` | ⚠ **Provenance Broken** (red) | One pixel byte flipped after signing → the content hash no longer matches the manifest. |
| `unknown.png` | ? **Unknown** (grey) | No C2PA manifest at all. **Unknown ≠ fake** — it just says "we can't tell." |

Talking point: the colour semantics are deliberate. Green and blue are both
*positive* (we verified something). Red is the only *negative* (something is
wrong). Grey is *neutral* — the fail-closed default. We never hand out green on
an absence of evidence.

## 2. Tamper flips Verified → Broken (priority #1)

`tampered.png` was `verified.png` with one IDAT byte flipped and the PNG CRC
recomputed (so it's a structurally valid PNG — the tamper is cryptographically
invisible to the eye). The badge is red. This is the headline demo: **the
signature still verifies, but the content hash does not, so provenance is
broken.** The image looks identical; the trust state does not lie.

## 3. Click a badge → the provenance timeline

Click any badge. A card opens with:

- **Why** — one plain sentence mapped to the machine reason code
  (`integrity-mismatch`, `ai-declared-and-valid`, `no-evidence`, …).
- **Evidence** — the hard-evidence items (credential / signature / hash /
  ai-label), each with a ✓/✗/? glyph from the verification result.
- **Provenance timeline** — the `c2pa.actions` history (`c2pa.captured`,
  `c2pa.placed`, …) extracted from the manifest.

On `verified.png` the timeline shows `c2pa.captured`. On `tampered.png` the hash
item shows ✗ with the mismatch explanation.

## 4. The Intelligence Layer (advisory — never the verdict)

The extension also *understands* the page: what each image is doing there. Turn
it on in the extension's **Options page** (right-click the extension → Options;
no API key needed — the local heuristics run first, and AI is optional).

- **Role chip.** The badge gains a muted second clause — "Chart", "News photo",
  "Logo", … — labelled Heuristic / AI / AI-assisted so you can always tell how
  it was produced.
- **Click a badge → the split.** The detail card now has two fenced sections:
  **VERIFICATION · cryptographic** (the verdict, unchanged) and
  **CONTEXT · {source}** — the role, the page's related claims ("Illustrates
  the claim: …"), and a plain "Why this matters" sentence.
- **The inviolable rule.** Everything in CONTEXT is advisory. It can **never**
  change the verdict above it: an AI or heuristic signal cannot promote to
  Verified nor demote a Verified asset to Broken (§51 — proven by
  `ai-powerlessness.test.ts`), and it can **never** suppress a `Provenance
  Broken` badge — a crypto failure always shows at `critical`, even if the
  semantic layer classified the asset as a logo or decoration (§17 — proven by
  `display.test.ts`). AI understands; crypto proves; the rule engine decides;
  Signet displays.

Run the whole pipeline in a browser (no extension, no key, no network) at
`http://127.0.0.1:5173/report.html`, or headlessly:

```bash
node apps/extension/scripts/report-check.mjs   # needs pnpm dev running
```

## 5. The philosophy (leave them with this)

- **Fail-closed.** Any error, conflict, missing asset, or unrecognised
  validation code → `Unknown`, never `Verified`. We do not invent green.
- **AI ≠ fake.** A valid manifest that *declares* AI generation is *more*
  trustworthy than an unknown image, not less. Transparency is the trust signal.
- **Unknown ≠ fake.** Most images on the web today are Unknown. That is an
  honest "we can't tell", not an accusation.
- **Not a truth oracle.** Signet verifies the *relationship* between
  content and attached credentials. A camera can authentically sign a staged
  photograph. We prove provenance, not reality.

## 6. Credibility evidence (for the sceptical reviewer)

- `pnpm test` — 278 unit tests (engine, mapper, normalizer, intelligence layer,
  fixtures, benchmark, the 4 §51 AI-powerlessness invariants, the 15 §17
  trust-visibility invariants, the 57-case semantic eval set).
- `pnpm benchmark` — 386 classification cases checked against an **independent
  specification oracle** (not a self-comparison); 386/386 pass.
- `node apps/extension/scripts/smoke.mjs` — real-Chromium end-to-end: 4 states
  correct, tamper → Broken, click → timeline. Exit 0.
- `node apps/extension/scripts/report-check.mjs` — real-Chromium Intelligence
  Report: full pipeline self-check passes, 4 asset cards. Exit 0.

"**Don't tell me it's true. Show me why I can trust it.**" — every claim above
has a command you can re-run.
