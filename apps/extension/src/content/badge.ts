/**
 * @signet/extension/content — trust badge overlay (Shadow DOM).
 *
 * One {@link TrustOverlay} per verified image. The host <div> is appended to
 * document.body and positioned `fixed` over the image's current rect; the
 * overlay repositions on scroll/resize (driven by the orchestrator). All
 * presentation lives inside a closed-ish Shadow Root so the host page's CSS
 * cannot style it and our styles cannot leak.
 *
 * Security: manifest-derived strings (signer names, notes, claim generators)
 * are inserted via `textContent` / attribute setters, never via `innerHTML`
 * interpolation — provenance is untrusted input.
 */
import { TRUST_STATE_META, type EvidenceItem, type SemanticRole } from '@signet/core';
import type {
  AnalysisSource,
  AssetSemanticAnalysis,
  ClaimEvidenceLink,
  ContextualExplanation,
  PageClaim,
} from '@signet/intelligence';

import type { VerifyResult } from '../messages';

type Tone = 'positive' | 'informational' | 'warning' | 'neutral';

const TONE_COLOR: Readonly<Record<Tone, string>> = {
  positive: '#16a34a',
  informational: '#2563eb',
  warning: '#dc2626',
  neutral: '#64748b',
};

/** Short human sentence per machine reason code (Phase 5 expands this). */
const REASON_SENTENCE: Readonly<Record<VerifyResult['reason'], string>> = {
  'valid-credential':
    'A trusted signer signed this asset and both the signature and the content hash verify.',
  'ai-declared-and-valid':
    'Provenance is valid and the manifest declares an AI generation step. AI-generated ≠ fake.',
  'integrity-mismatch':
    'A credential is present but the content hash no longer matches — the bytes were changed after signing.',
  'signature-invalid': 'A credential is present but its signature does not verify.',
  'verification-error':
    'Provenance collection reported an error, so we cannot make a positive claim.',
  'evidence-conflict': 'The hard evidence contradicts itself and could not be reconciled.',
  'insufficient-evidence': 'Some provenance is present, but not enough to verify.',
  'no-evidence': 'No machine-readable provenance was found on this asset.',
  'soft-evidence-only':
    'Only contextual (non-cryptographic) signals were found; these can never verify on their own.',
};

function statusGlyph(status: EvidenceItem['status']): string {
  switch (status) {
    case 'valid':
      return '✓';
    case 'invalid':
      return '✗';
    case 'unknown':
      return '?';
  }
}

/**
 * Short human label for a semantic role. The Intelligence Layer is advisory, so
 * these labels describe the asset's *role on the page*, not its trust state.
 */
const ROLE_LABEL: Readonly<Record<SemanticRole, string>> = {
  'hero-image': 'Hero image',
  'primary-evidence': 'Primary evidence',
  'supporting-evidence': 'Supporting evidence',
  'data-visualization': 'Data visualization',
  chart: 'Chart',
  'news-photo': 'News photo',
  'article-evidence': 'Article evidence',
  screenshot: 'Screenshot',
  'product-image': 'Product image',
  illustration: 'Illustration',
  logo: 'Logo',
  icon: 'Icon',
  avatar: 'Avatar',
  decoration: 'Decorative',
  advertisement: 'Advertisement',
  unknown: 'Image',
};

/** How the semantic analysis was produced — for honest "AI-assisted" labeling (§31). */
const SOURCE_LABEL: Readonly<Record<AnalysisSource, string>> = {
  heuristic: 'Heuristic',
  ai: 'AI',
  hybrid: 'AI-assisted',
};

/** Short label per claim↔asset relation, for the Related-claims list. */
const RELATION_LABEL: Readonly<Record<ClaimEvidenceLink['relation'], string>> = {
  illustrates: 'Illustrates the claim',
  supports: 'Supports the claim',
  contradicts: 'Runs against the claim',
  unrelated: 'Not clearly related to the claim',
};

/**
 * The full advisory semantic picture for one asset: the analysis (role +
 * scores), how it was produced, the claim↔asset links touching it, the claim
 * texts they reference, and the display-only contextual explanation. All of it
 * sits in the CONTEXT block — visually and structurally separate from the
 * cryptographic verdict above it.
 */
export interface SemanticPicture {
  readonly analysis: AssetSemanticAnalysis;
  readonly source: AnalysisSource;
  readonly links: readonly ClaimEvidenceLink[];
  readonly claims: ReadonlyMap<string, PageClaim>;
  readonly explanation: ContextualExplanation;
}

function buildBadge(result: VerifyResult): HTMLElement {
  const meta = TRUST_STATE_META[result.state];
  const color = TONE_COLOR[meta.tone];
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'tc-badge';
  badge.style.setProperty('--tc-color', color);
  badge.setAttribute('aria-label', `Signet: ${meta.label}`);
  badge.title = `${meta.label} — click for details`;

  const sym = document.createElement('span');
  sym.className = 'tc-sym';
  sym.textContent = meta.symbol;
  const lbl = document.createElement('span');
  lbl.className = 'tc-lbl';
  lbl.textContent = meta.label;
  badge.append(sym, lbl);
  return badge;
}

function buildDetail(result: VerifyResult, semantics?: SemanticPicture): HTMLElement {
  const meta = TRUST_STATE_META[result.state];
  const color = TONE_COLOR[meta.tone];
  const card = document.createElement('div');
  card.className = 'tc-detail';
  card.setAttribute('role', 'dialog');

  const head = document.createElement('div');
  head.className = 'tc-detail-head';
  head.style.setProperty('--tc-color', color);
  const hsym = document.createElement('span');
  hsym.className = 'tc-detail-sym';
  hsym.textContent = meta.symbol;
  const htitle = document.createElement('strong');
  htitle.className = 'tc-detail-title';
  htitle.textContent = meta.label;
  head.append(hsym, htitle);

  // VERIFICATION — the cryptographic verdict, always rendered from the engine's
  // decision. The section title makes the split explicit (§31): everything
  // below the CONTEXT fence is advisory; everything above is the verdict.
  const vTitle = document.createElement('p');
  vTitle.className = 'tc-list-title';
  vTitle.textContent = 'Verification · cryptographic';

  const why = document.createElement('p');
  why.className = 'tc-why';
  why.textContent = REASON_SENTENCE[result.reason] ?? '';

  card.append(head, vTitle, why);

  if (result.errorMessage) {
    const err = document.createElement('p');
    err.className = 'tc-err';
    err.textContent = `Collector error: ${result.errorMessage}`;
    card.append(err);
  }

  // CONTEXT section — advisory semantics from the Intelligence Layer. Rendered
  // as a DISTINCT block from the cryptographic verdict above, so a reader can
  // always tell "what was proven" (VERIFICATION) apart from "what the page is
  // using this image for" (CONTEXT). Never overrides or restates trust.
  if (semantics) {
    const ctx = document.createElement('div');
    ctx.className = 'tc-context';
    const ctxTitle = document.createElement('p');
    ctxTitle.className = 'tc-list-title';
    ctxTitle.textContent = `Context · ${SOURCE_LABEL[semantics.source]}`;
    const role = document.createElement('p');
    role.className = 'tc-context-role';
    role.textContent = ROLE_LABEL[semantics.analysis.role] ?? 'Image';
    const src = document.createElement('p');
    src.className = 'tc-context-source';
    src.textContent = `confidence ${Math.round(semantics.analysis.confidence * 100)}%`;
    const rsn = document.createElement('p');
    rsn.className = 'tc-context-reason';
    rsn.textContent = semantics.analysis.reason;
    ctx.append(ctxTitle, role, src, rsn);

    // Related claims — the claim↔asset links touching this asset (≤3 by
    // construction, Phase F). Claim texts come from the claim table the
    // content script selected; a link whose claimId is unknown is SKIPPED
    // (fail-closed: never render an id we cannot explain).
    const knownLinks = semantics.links.filter((l) => semantics.claims.has(l.claimId));
    if (knownLinks.length > 0) {
      const relTitle = document.createElement('p');
      relTitle.className = 'tc-list-title';
      relTitle.textContent = 'Related claims';
      const relList = document.createElement('ul');
      relList.className = 'tc-context-claims';
      for (const l of knownLinks) {
        const li = document.createElement('li');
        const rel = document.createElement('span');
        rel.className = 'tc-context-claim-rel';
        rel.textContent = RELATION_LABEL[l.relation];
        const txt = document.createElement('span');
        txt.className = 'tc-context-claim-text';
        txt.textContent = semantics.claims.get(l.claimId)?.text ?? '';
        li.append(rel, txt);
        relList.append(li);
      }
      ctx.append(relTitle, relList);
    }

    // Why this matters — the display-only contextual explanation (deterministic
    // floor or AI-enriched). The caveats list what the reader must NOT conclude.
    const exp = semantics.explanation;
    if (exp.text) {
      const expTitle = document.createElement('p');
      expTitle.className = 'tc-list-title';
      expTitle.textContent = 'Why this matters';
      const expText = document.createElement('p');
      expText.className = 'tc-context-explain';
      expText.textContent = exp.text;
      ctx.append(expTitle, expText);
      for (const c of exp.caveats) {
        const cv = document.createElement('p');
        cv.className = 'tc-context-caveat';
        cv.textContent = `⚠ ${c}`;
        ctx.append(cv);
      }
    }

    card.append(ctx);
  }

  if (result.items.length > 0) {
    const listTitle = document.createElement('p');
    listTitle.className = 'tc-list-title';
    listTitle.textContent = 'Evidence';
    const ul = document.createElement('ul');
    ul.className = 'tc-list';
    for (const item of result.items) {
      const li = document.createElement('li');
      li.className = `tc-item tc-item-${item.level}`;
      const g = document.createElement('span');
      g.className = `tc-item-glyph tc-item-${item.status}`;
      g.textContent = statusGlyph(item.status);
      const body = document.createElement('span');
      body.className = 'tc-item-body';
      const k = document.createElement('span');
      k.className = 'tc-item-kind';
      k.textContent = `${item.type} · ${item.level}`;
      if (item.note) {
        const n = document.createElement('span');
        n.className = 'tc-item-note';
        n.textContent = item.note;
        body.append(k, n);
      } else {
        body.append(k);
      }
      li.append(g, body);
      ul.append(li);
    }
    card.append(listTitle, ul);
  }

  // Provenance timeline: action history carried inside the c2pa evidence item
  // (c2pa.actions / c2pa.actions.vN). Shown only when actions are present, so a
  // no-manifest or empty-history asset shows no empty section.
  const c2paItem = result.items.find((i) => i.type === 'c2pa');
  const actions = (
    c2paItem?.data as {
      actions?: readonly { action?: unknown; when?: unknown; actor?: unknown }[];
    } | null
  )?.actions;
  if (Array.isArray(actions) && actions.length > 0) {
    const tlTitle = document.createElement('p');
    tlTitle.className = 'tc-list-title';
    tlTitle.textContent = 'Provenance timeline';
    const tl = document.createElement('ol');
    tl.className = 'tc-timeline';
    for (const step of actions) {
      if (typeof step.action !== 'string') continue;
      const li = document.createElement('li');
      li.className = 'tc-tl-step';
      const a = document.createElement('span');
      a.className = 'tc-tl-action';
      a.textContent = step.action;
      li.append(a);
      const meta: string[] = [];
      if (typeof step.actor === 'string') meta.push(step.actor);
      if (typeof step.when === 'string') meta.push(step.when);
      if (meta.length > 0) {
        const m = document.createElement('span');
        m.className = 'tc-tl-meta';
        m.textContent = meta.join(' · ');
        li.append(m);
      }
      tl.append(li);
    }
    if (tl.childElementCount > 0) card.append(tlTitle, tl);
  }

  const foot = document.createElement('p');
  foot.className = 'tc-foot';
  foot.textContent = result.failClosed
    ? 'Fail-closed: no positive claim was made.'
    : 'Signet — what we can currently verify.';
  card.append(foot);
  return card;
}

/**
 * An overlay anchored to a single <img>. Call {@link setResult} when the
 * decision lands; the orchestrator calls {@link reposition} on scroll/resize.
 */
export class TrustOverlay {
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private badge: HTMLElement;
  private detail: HTMLElement | null = null;
  private open = false;
  private lastResult: VerifyResult | null = null;
  private semantics: SemanticPicture | null = null;
  private roleChip: HTMLElement | null = null;

  /**
   * @param img        the image this overlay anchors to.
   * @param onDetailOpen optional hook fired when the detail card OPENS — the
   *   orchestrator uses it to fire the on-demand AI explanation request
   *   (Phase H). Purely additive; the card renders the deterministic floor
   *   immediately and is refreshed when the AI answer lands.
   */
  constructor(
    private readonly img: HTMLImageElement,
    private readonly onDetailOpen?: () => void,
  ) {
    this.host = document.createElement('div');
    this.host.className = 'tc-host';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    this.badge = buildBadge({
      kind: 'verify-result',
      assetId: '',
      state: 'unknown',
      reason: 'no-evidence',
      failClosed: true,
      items: [],
    });
    this.badge.classList.add('tc-pending');
    this.shadow.append(style, this.badge);
    this.badge.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    document.body.append(this.host);
    this.reposition();
  }

  /** Render the decision. Replaces the pending badge and updates colour. */
  setResult(result: VerifyResult): void {
    this.lastResult = result;
    const fresh = buildBadge(result);
    fresh.classList.toggle('tc-pending', false);
    fresh.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.badge.replaceWith(fresh);
    this.badge = fresh;
    this.roleChip = null; // rebuilt by applyRoleChip on the fresh badge
    this.applyRoleChip();
    // If the detail card was open, refresh it too.
    if (this.open && this.detail) {
      const freshDetail = buildDetail(result, this.semantics ?? undefined);
      this.detail.replaceWith(freshDetail);
      this.detail = freshDetail;
    }
    this.reposition();
  }

  /**
   * Attach the advisory semantic picture (role + source + links + claims +
   * explanation) as a small chip on the badge and the CONTEXT block in the
   * detail card. This is ADDITIVE: it never changes the trust glyph, colour,
   * label, or reason. Call with the heuristic picture for an immediate first
   * paint, then again with the refined picture (links + explanation) when the
   * analyze result lands or the AI explanation arrives.
   */
  setSemantics(picture: SemanticPicture): void {
    this.semantics = picture;
    this.applyRoleChip();
    if (this.open && this.detail) {
      const freshDetail = buildDetail(this.lastResult ?? this.placeholderResult(), this.semantics);
      this.detail.replaceWith(freshDetail);
      this.detail = freshDetail;
    }
  }

  /** The minimal VerifyResult used only when the detail card is opened before
   * any trust result has landed (semantics can arrive before trust does). */
  private placeholderResult(): VerifyResult {
    return {
      kind: 'verify-result',
      assetId: '',
      state: 'unknown',
      reason: 'no-evidence',
      failClosed: true,
      items: [],
    };
  }

  /** Add or refresh the role chip on the current badge (no-op if no semantics). */
  private applyRoleChip(): void {
    if (!this.semantics) return;
    const { analysis, source } = this.semantics;
    if (!this.roleChip || !this.badge.contains(this.roleChip)) {
      const chip = document.createElement('span');
      chip.className = 'tc-role';
      chip.setAttribute('aria-label', `Context: ${ROLE_LABEL[analysis.role]}`);
      this.badge.append(chip);
      this.roleChip = chip;
    }
    this.roleChip.textContent = ROLE_LABEL[analysis.role] ?? 'Image';
    this.roleChip.dataset.source = source;
    this.roleChip.title = `${SOURCE_LABEL[source]} context · confidence ${Math.round(analysis.confidence * 100)}%`;
  }

  /** Recompute the host position from the image's current rect. */
  reposition(): void {
    const r = this.img.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      this.host.style.display = 'none';
      return;
    }
    this.host.style.display = '';
    // Anchor to the image's top-right corner with an 8px inset.
    this.host.style.left = `${Math.round(r.right - 8)}px`;
    this.host.style.top = `${Math.round(r.top + 8)}px`;
    if (this.open && this.detail) {
      // Keep the detail card within the viewport.
      const dr = this.detail.getBoundingClientRect();
      const overshoot = Math.max(0, dr.right - (window.innerWidth - 8));
      this.detail.style.transform = `translateX(${-overshoot}px)`;
    }
  }

  private toggle(): void {
    if (!this.lastResult && !this.semantics) return;
    if (this.open) {
      this.detail?.remove();
      this.detail = null;
      this.open = false;
      return;
    }
    this.detail = buildDetail(
      this.lastResult ?? this.placeholderResult(),
      this.semantics ?? undefined,
    );
    this.shadow.append(this.detail);
    this.open = true;
    this.onDetailOpen?.();
    this.reposition();
  }

  destroy(): void {
    this.host.remove();
  }
}

const SHADOW_CSS = `
  :host {
    position: fixed;
    z-index: 2147483646;
    pointer-events: none;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #0f172a;
  }
  .tc-badge {
    pointer-events: auto;
    transform: translateX(-100%);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px 3px 6px;
    border-radius: 999px;
    border: 1px solid rgba(15,23,42,0.08);
    background: #ffffff;
    color: var(--tc-color, #64748b);
    box-shadow: 0 1px 4px rgba(15,23,42,0.18);
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
  }
  .tc-badge:hover { box-shadow: 0 2px 8px rgba(15,23,42,0.28); }
  .tc-badge .tc-lbl { display: none; }
  .tc-badge:hover .tc-lbl, .tc-badge:focus-visible .tc-lbl { display: inline; }
  .tc-badge .tc-sym { font-size: 13px; line-height: 1; }
  .tc-badge.tc-pending { opacity: 0.55; animation: tc-pulse 1.2s ease-in-out infinite; }
  @keyframes tc-pulse { 0%,100%{opacity:.35} 50%{opacity:.75} }
  /* Role chip: advisory context on the badge. Muted so it never competes with
     the trust glyph; prefixed with a separator so it reads as a second clause. */
  .tc-badge .tc-role {
    font-size: 11px;
    font-weight: 500;
    color: #64748b;
    padding-left: 5px;
    margin-left: 1px;
    border-left: 1px solid rgba(15,23,42,0.12);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tc-badge[data-source="ai"] .tc-role,
  .tc-badge .tc-role[data-source="hybrid"] { color: #7c3aed; }
  .tc-badge:hover .tc-role, .tc-badge:focus-visible .tc-role { display: inline; }

  .tc-detail {
    pointer-events: auto;
    position: absolute;
    top: 28px;
    left: 0;
    transform: translateX(-100%);
    width: 300px;
    max-width: 80vw;
    padding: 12px 14px;
    background: #ffffff;
    border: 1px solid rgba(15,23,42,0.1);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(15,23,42,0.22);
    font-size: 12.5px;
    line-height: 1.45;
  }
  .tc-detail-head {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 6px;
  }
  .tc-detail-sym { color: var(--tc-color, #64748b); font-size: 18px; font-weight: 700; }
  .tc-detail-title { font-size: 14px; color: #0f172a; }
  .tc-why { margin: 0 0 8px; color: #334155; }
  .tc-err { margin: 0 0 8px; color: #b91c1c; }
  .tc-list-title { margin: 8px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
  .tc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .tc-item { display: flex; gap: 6px; align-items: flex-start; }
  .tc-item-glyph { flex: 0 0 auto; width: 14px; text-align: center; font-weight: 700; }
  .tc-item-valid { color: #16a34a; } .tc-item-invalid { color: #dc2626; } .tc-item-unknown { color: #94a3b8; }
  .tc-item-kind { color: #475569; font-weight: 600; }
  .tc-item-note { display:block; color: #64748b; font-size: 11.5px; word-break: break-word; }
  /* CONTEXT block: advisory semantics, visually fenced off from the verdict so
     "what's proven" and "what the image is doing here" never blur together. */
  .tc-context {
    margin: 6px 0 8px;
    padding: 8px 10px;
    background: #f5f3ff;
    border: 1px solid #ddd6fe;
    border-radius: 8px;
  }
  .tc-context-role { margin: 0 0 2px; font-weight: 600; color: #4c1d95; font-size: 12.5px; }
  .tc-context-source { margin: 0 0 4px; font-size: 11px; color: #7c3aed; }
  .tc-context-reason { margin: 0; font-size: 11.5px; color: #475569; word-break: break-word; }
  .tc-context-claims { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
  .tc-context-claim-rel { display: block; font-size: 10.5px; font-weight: 600; color: #7c3aed; }
  .tc-context-claim-text { display: block; font-size: 11.5px; color: #334155; word-break: break-word; }
  .tc-context-explain { margin: 0; font-size: 11.5px; color: #334155; word-break: break-word; }
  .tc-context-caveat { margin: 4px 0 0; font-size: 10.5px; color: #92400e; word-break: break-word; }
  .tc-timeline { list-style: none; margin: 0; padding: 0 0 0 14px; position: relative; display: flex; flex-direction: column; gap: 3px; }
  .tc-timeline::before { content:''; position:absolute; left:4px; top:4px; bottom:4px; width:2px; background:#e2e8f0; border-radius:2px; }
  .tc-tl-step { position: relative; padding-left: 2px; }
  .tc-tl-step::before { content:'•'; position:absolute; left:-12px; color:#94a3b8; font-size: 14px; line-height: 1; }
  .tc-tl-action { color: #334155; font-weight: 600; }
  .tc-tl-meta { display:block; color:#94a3b8; font-size: 11px; }
  .tc-foot { margin: 10px 0 0; font-size: 11px; color: #94a3b8; border-top: 1px solid #eef2f7; padding-top: 8px; }
`;
