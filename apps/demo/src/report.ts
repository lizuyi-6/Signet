/**
 * @signet/demo — Intelligence Report (Phase H demo artifact).
 *
 * Runs the FULL intelligence pipeline in the browser against a text model of
 * the demo page's four fixture images: claims → heuristic classification →
 * mock-AI merge → claim↔asset links → contextual explanations (deterministic
 * floor AND mock-AI). No API key, no extension, no network.
 *
 * The page renders the same VERIFICATION / CONTEXT split the badge shows, and
 * ends with a falsifiable SELF-CHECK block: each invariant is asserted in the
 * browser and rendered PASS/FAIL. The report is a demo of presentation and
 * plumbing — the load-bearing invariant tests live in @signet/intelligence's
 * vitest suite, not here.
 */
import { TRUST_STATE_META, type TrustReason, type TrustState } from '@signet/core';
import {
  HybridSemanticClassifier,
  MockIntelligenceProvider,
  buildDeterministicExplanation,
  explainEvidenceWithFallback,
  selectTopClaims,
  type AssetSemanticInput,
  type ClaimEvidenceLink,
  type ContextualExplanation,
  type PageClaim,
  type PageSemanticInput,
} from '@signet/intelligence';

// ---------------------------------------------------------------------------
// The sample page: a text model of demo/index.html's four fixture cards.
// ---------------------------------------------------------------------------

const GROUND_TRUTH: Readonly<Record<string, TrustState>> = {
  'verified.png': 'verified',
  'verified-ai.png': 'verified-ai',
  'tampered.png': 'broken',
  'unknown.png': 'unknown',
};

const ASSETS: readonly AssetSemanticInput[] = [
  {
    assetId: 'verified.png',
    pageUrl: 'http://127.0.0.1:5173/',
    altText: 'A signed photograph with intact provenance',
    nearbyText: 'Signed by a trusted signer; signature and content hash both verify.',
    width: 640,
    height: 480,
  },
  {
    assetId: 'verified-ai.png',
    pageUrl: 'http://127.0.0.1:5173/',
    altText: 'An AI-generated image with a valid C2PA provenance and an AI declaration',
    nearbyText: 'Valid provenance plus an explicit c2pa.ai.gen declaration (AI ≠ fake).',
    width: 640,
    height: 480,
  },
  {
    assetId: 'tampered.png',
    pageUrl: 'http://127.0.0.1:5173/',
    altText: 'A previously-signed image whose pixels were edited after signing',
    nearbyText: 'One IDAT byte flipped after signing → content hash no longer matches.',
    width: 640,
    height: 480,
  },
  {
    assetId: 'unknown.png',
    pageUrl: 'http://127.0.0.1:5173/',
    altText: 'A plain image with no provenance attached',
    nearbyText: 'No C2PA manifest at all — Unknown says nothing about whether it is real.',
    width: 640,
    height: 480,
  },
];

const CLAIM_CANDIDATES = [
  { text: 'Industry output rose 4.2% in the second quarter', sourceElement: 'h1' },
  {
    text: 'The central bank held its benchmark rate steady at the conclusion of the meeting',
    sourceElement: 'p',
  },
  { text: 'Analysts expect output to rise 12% next year', sourceElement: 'p' },
];

const AI_OVERRIDES = new Map([
  ['verified.png', { role: 'news-photo' as const, confidence: 0.92 }],
  ['verified-ai.png', { role: 'illustration' as const, confidence: 0.88 }],
  ['tampered.png', { role: 'news-photo' as const, confidence: 0.85 }],
  ['unknown.png', { role: 'decoration' as const, confidence: 0.7 }],
]);

function pageInput(claims: readonly PageClaim[]): PageSemanticInput {
  return {
    pageUrl: 'http://127.0.0.1:5173/',
    pageTitle: 'Industry Intelligence Report',
    headings: ['Industry Intelligence Report'],
    claims,
    assets: ASSETS,
    privacyMode: 'context-only',
  };
}

function mockLinks(claims: readonly PageClaim[]): ClaimEvidenceLink[] {
  const byText = (t: string) => claims.find((c) => c.text.includes(t))?.id;
  const out = (c: ClaimEvidenceLink): ClaimEvidenceLink => c;
  return [
    out({
      claimId: byText('4.2%') ?? 'clm_unknown',
      assetId: 'verified.png',
      relation: 'illustrates',
      confidence: 0.9,
      reason: 'the photograph accompanies the output report',
    }),
    out({
      claimId: byText('benchmark rate') ?? 'clm_unknown',
      assetId: 'verified-ai.png',
      relation: 'illustrates',
      confidence: 0.8,
      reason: 'the illustration depicts the rate decision',
    }),
  ];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

type Check = { label: string; ok: boolean; detail: string };

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
}

function assetCard(opts: {
  assetId: string;
  state: TrustState;
  analysis: {
    role: string;
    importance: number;
    evidenceLikelihood: number;
    confidence: number;
    source: string;
    reason: string;
  };
  links: readonly ClaimEvidenceLink[];
  claims: ReadonlyMap<string, PageClaim>;
  explanation: ContextualExplanation;
}): string {
  const meta = TRUST_STATE_META[opts.state];
  const claimRows = opts.links
    .filter((l) => opts.claims.has(l.claimId))
    .map(
      (l) =>
        `<li><b>${esc(l.relation)}</b> — ${esc(opts.claims.get(l.claimId)!.text)} <i>(conf ${(l.confidence * 100).toFixed(0)}%)</i></li>`,
    )
    .join('');
  const caveats = opts.explanation.caveats
    .map((c) => `<li class="caveat">⚠ ${esc(c)}</li>`)
    .join('');
  return `
    <article class="card">
      <h3><code>${esc(opts.assetId)}</code></h3>
      <section class="verif">
        <h4>VERIFICATION · cryptographic</h4>
        <p><b>${esc(meta.label)}</b> (ground truth for this demo fixture)</p>
      </section>
      <section class="ctx">
        <h4>CONTEXT · ${esc(opts.analysis.source)}</h4>
        <p><b>Role:</b> ${esc(opts.analysis.role)} · importance ${opts.analysis.importance.toFixed(2)} · evidence ${opts.analysis.evidenceLikelihood.toFixed(2)} · confidence ${(opts.analysis.confidence * 100).toFixed(0)}%</p>
        <p class="muted">${esc(opts.analysis.reason)}</p>
        ${claimRows ? `<p><b>Related claims:</b></p><ul>${claimRows}</ul>` : ''}
        <p><b>Why this matters</b> <i>(${esc(opts.explanation.source)})</i>:</p>
        <p>${esc(opts.explanation.text)}</p>
        ${caveats ? `<ul>${caveats}</ul>` : ''}
      </section>
    </article>
  `;
}

function checksBlock(checks: readonly Check[]): string {
  const rows = checks
    .map(
      (c) =>
        `<li class="${c.ok ? 'pass' : 'fail'}">${c.ok ? 'PASS' : 'FAIL'} — ${esc(c.label)} <span class="muted">${esc(c.detail)}</span></li>`,
    )
    .join('');
  const allOk = checks.every((c) => c.ok);
  return `
    <section class="checks">
      <h2>Self-check (in-browser, falsifiable)</h2>
      <p class="${allOk ? 'pass' : 'fail'}"><b>${allOk ? 'ALL PASS' : 'SOME FAIL'}</b></p>
      <ul>${rows}</ul>
      <p class="muted">These checks demonstrate the demo plumbing. The load-bearing invariant tests run in vitest (pnpm test).</p>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Run the pipeline
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const app = document.getElementById('app')!;
  const checks: Check[] = [];

  const claims = selectTopClaims(CLAIM_CANDIDATES);
  const claimsById: ReadonlyMap<string, PageClaim> = new Map(claims.map((c) => [c.id, c] as const));

  // 1) Heuristic floor (AI off).
  const off = new HybridSemanticClassifier({
    config: { enabled: false, provider: 'disabled', timeoutMs: 8000, privacyMode: 'context-only' },
  });
  const heuristic = await off.classifyPage(pageInput(claims));
  checks.push({
    label: 'AI-off run returns heuristic analyses for all 4 assets',
    ok: heuristic.status === 'disabled' && heuristic.result.assets.length === 4,
    detail: `status=${heuristic.status}, assets=${heuristic.result.assets.length}`,
  });
  checks.push({
    label: 'heuristic links reference only selected claim ids and never say "contradicts"',
    ok:
      heuristic.result.links.every((l) => claimsById.has(l.claimId)) &&
      heuristic.result.links.every((l) => l.relation !== 'contradicts'),
    detail: `links=${heuristic.result.links.length}`,
  });

  // 2) Hybrid run (mock AI + links).
  const mock = new MockIntelligenceProvider({ analyses: AI_OVERRIDES, links: mockLinks(claims) });
  const hybrid = await new HybridSemanticClassifier({
    config: { enabled: true, provider: 'mock', timeoutMs: 8000, privacyMode: 'context-only' },
    provider: mock,
  }).classifyPage(pageInput(claims));
  checks.push({
    label: 'mock-AI run is ready and merged (hybrid)',
    ok: hybrid.status === 'ready' && hybrid.source === 'hybrid',
    detail: `status=${hybrid.status}, source=${hybrid.source}`,
  });
  checks.push({
    label: 'every asset has an analysis (no gaps after merge)',
    ok: hybrid.result.assets.length === 4,
    detail: `assets=${hybrid.result.assets.length}`,
  });

  // 3) Explanations: deterministic floor + AI enrichment per asset.
  const cards: string[] = [];
  const explainChecks: Check[] = [];
  for (const a of hybrid.result.assets) {
    const state = GROUND_TRUTH[a.assetId] ?? 'unknown';
    const reason = {
      verified: 'valid-credential',
      'verified-ai': 'ai-declared-and-valid',
      broken: 'integrity-mismatch',
      unknown: 'no-evidence',
    }[state] as TrustReason;
    const links = hybrid.result.links.filter((l) => l.assetId === a.assetId);
    const bestLink = links[0];
    const bestClaim = bestLink ? claimsById.get(bestLink.claimId) : undefined;
    const trust = { state, reason };

    const deterministic = buildDeterministicExplanation({
      assetId: a.assetId,
      trust,
      semanticRole: a.role,
      ...(bestClaim ? { pageClaim: bestClaim } : {}),
      ...(bestLink ? { claimRelation: bestLink } : {}),
      pageContext: { title: 'Industry Intelligence Report', domain: '127.0.0.1:5173' },
    });
    explainChecks.push({
      label: `deterministic explanation for ${a.assetId} narrates its verdict`,
      ok: deterministic.text.includes(TRUST_STATE_META[state].label),
      detail: deterministic.text,
    });

    const ai = await explainEvidenceWithFallback(
      { assetId: a.assetId, trust, semanticRole: a.role },
      mock,
      8000,
    );
    explainChecks.push({
      label: `AI explanation for ${a.assetId} is ai-sourced (mock)`,
      ok: ai.source === 'ai' && ai.explanation.text.length > 0,
      detail: ai.explanation.text,
    });

    cards.push(
      assetCard({
        assetId: a.assetId,
        state,
        analysis: {
          role: a.role,
          importance: a.importance,
          evidenceLikelihood: a.evidenceLikelihood,
          confidence: a.confidence,
          source: a.generatedBy,
          reason: a.reason,
        },
        links,
        claims: claimsById,
        explanation: ai.explanation, // AI first; the floor text is shown in the check list
      }),
    );
  }
  checks.push(...explainChecks);

  app.innerHTML = `
    <header>
      <p class="kicker">Signet · demo</p>
      <h1>Intelligence Report</h1>
      <p class="muted">
        The full intelligence pipeline (claims → heuristic → mock-AI merge →
        links → explanations) run in-browser against the four fixture images,
        with NO API key and NO network. The cryptographic VERIFICATION column
        is the demo's ground-truth label; the CONTEXT column is what the
        Intelligence Layer produces — advisory only, never a verdict.
      </p>
      <p><a href="/">← back to the demo page</a></p>
    </header>
    <section class="grid">${cards.join('')}</section>
    ${checksBlock(checks)}
  `;
}

void run();
