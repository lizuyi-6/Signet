/**
 * @signet/demo — entry.
 *
 * Renders an "Industry Intelligence Report" page that hosts the four committed
 * C2PA fixtures. The per-card captions are the demo's own GROUND-TRUTH labels
 * (what each fixture was built to demonstrate) — NOT a verification result.
 * Verification is the extension's job; with the extension loaded, a live trust
 * badge overlays each image.
 *
 * Images are emitted with absolute /fixtures/*.png srcs so the extension's
 * content script can fetch the exact same bytes for verification.
 */
import { TRUST_STATE_META, type TrustState } from '@signet/core';
import './style.css';

interface FixtureCard {
  readonly file: string;
  readonly alt: string;
  readonly groundTruth: TrustState;
  readonly note: string;
}

const CARDS: readonly FixtureCard[] = [
  {
    file: 'verified.png',
    alt: 'A signed photograph with intact provenance',
    groundTruth: 'verified',
    note: 'Signed by a trusted signer; signature and content hash both verify.',
  },
  {
    file: 'verified-ai.png',
    alt: 'An AI-generated image with a valid C2PA provenance and an AI declaration',
    groundTruth: 'verified-ai',
    note: 'Valid provenance plus an explicit c2pa.ai.gen declaration (AI ≠ fake).',
  },
  {
    file: 'tampered.png',
    alt: 'A previously-signed image whose pixels were edited after signing',
    groundTruth: 'broken',
    note: 'One IDAT byte flipped after signing → content hash no longer matches.',
  },
  {
    file: 'unknown.png',
    alt: 'A plain image with no provenance attached',
    groundTruth: 'unknown',
    note: 'No C2PA manifest at all — Unknown says nothing about whether it is real.',
  },
];

function el(html: string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const node = tpl.content.firstElementChild;
  if (!node) {
    throw new Error('template produced no element');
  }
  return node as HTMLElement;
}

function card(c: FixtureCard): HTMLElement {
  const meta = TRUST_STATE_META[c.groundTruth];
  return el(`
    <figure class="tc-card group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="relative bg-slate-100">
        <img
          src="/fixtures/${c.file}"
          alt="${c.alt}"
          decoding="async"
          class="block h-48 w-full object-cover"
          data-tc-fixture="${c.file}"
          data-tc-ground-truth="${c.groundTruth}"
        />
      </div>
      <figcaption class="space-y-1 p-4">
        <div class="flex items-center justify-between gap-2">
          <code class="text-sm font-medium text-slate-700">${c.file}</code>
          <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            ground truth: ${meta.label}
          </span>
        </div>
        <p class="text-sm text-slate-500">${c.note}</p>
      </figcaption>
    </figure>
  `);
}

function render(): void {
  const grid = document.createElement('main');
  grid.className = 'mx-auto max-w-6xl px-6 py-10';
  grid.innerHTML = `
    <header class="mb-8">
      <p class="text-xs font-semibold uppercase tracking-widest text-slate-400">Signet</p>
      <h1 class="mt-1 text-3xl font-bold text-slate-900">Industry Intelligence Report</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-500">
        Four images, four trust states. Load the Signet extension to see a
        live provenance badge on each. Ground-truth captions describe what each
        fixture was built to demonstrate.
      </p>
    </header>
    <section id="tc-grid" class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4"></section>
    <div class="mt-8 flex gap-4">
      <a class="inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" href="/report.html">
        View the Intelligence Report →
      </a>
    </div>
    <footer class="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-400">
      Demo host only — this page performs no verification itself. Tampering a
      fixture flips Verified → Provenance Broken (demo priority #1).
    </footer>
  `;
  const gridEl = grid.querySelector('#tc-grid');
  for (const c of CARDS) {
    gridEl?.appendChild(card(c));
  }
  document.body.replaceChildren(grid);
}

render();
