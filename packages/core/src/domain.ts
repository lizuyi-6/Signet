/**
 * @signet/core — domain model
 *
 * Pure type definitions for the Signet domain. No runtime logic, no I/O.
 * These types describe WHAT we are reasoning about; the {@link @signet/trust-engine}
 * package decides what trust state to assign.
 *
 * Naming follows the PRD: an `Asset` is a discovered piece of media on a page;
 * an `EvidenceItem` is one piece of machine-readable provenance attached to it.
 */

/**
 * Document-only string aliases. They do NOT brand at the type level (keep
 * construction ergonomic), but they signal intent and make signatures readable.
 * Branded IDs are a future option (see docs/decisions.md).
 */
export type AssetId = string;
export type EvidenceId = string;

/**
 * Axis-aligned rectangle in viewport (overlay) pixel space.
 * Used to map a verified asset back onto the region the user actually sees.
 */
export interface BoundingBox {
  /** Left edge, in CSS pixels relative to the viewport origin. */
  readonly x: number;
  /** Top edge, in CSS pixels relative to the viewport origin. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The semantic role an asset plays on the page. Drives whether a trust badge
 * should be rendered at all — icons/avatars/decoration are suppressed by default
 * so the page does not become a wall of badges.
 *
 * The union is additive across phases: Phase 1–6 shipped the first ten roles;
 * the Intelligence Layer (Phase 7) extends it with evidence-granularity and
 * noise roles (`primary-evidence`, `supporting-evidence`, `data-visualization`,
 * `news-photo`, `illustration`, `logo`). Existing roles are kept so the working
 * scanner / suppression tests stay byte-stable. Nothing here is a trust signal.
 */
export type SemanticRole =
  | 'hero-image'
  | 'article-evidence'
  | 'chart'
  | 'avatar'
  | 'advertisement'
  | 'icon'
  | 'decoration'
  | 'product-image'
  | 'screenshot'
  // Intelligence Layer additions (Phase 7):
  | 'primary-evidence'
  | 'supporting-evidence'
  | 'data-visualization'
  | 'news-photo'
  | 'illustration'
  | 'logo'
  | 'unknown';

/**
 * DOM/element category of the discovered asset.
 */
export type AssetElementType = 'image' | 'video' | 'canvas' | 'unknown';

/**
 * How the asset's bytes were (or could be) obtained. Determines which resolver
 * strategy the extension uses to fetch the underlying file for hashing.
 */
export type AssetSourceType = 'network' | 'data-url' | 'blob' | 'canvas' | 'unknown';

/**
 * A discovered, verifiable piece of media on a page.
 *
 * An `ContentAsset` is the **input handle**. The byte-level artifact and the
 * evidence attached to it live separately; an asset only describes where the
 * thing is and what role it plays.
 */
export interface ContentAsset {
  readonly id: AssetId;

  /** Resolved source URL when one is derivable (http(s), data:, blob:). */
  readonly url?: string;

  /** MIME type when known (e.g. from `Content-Type` or magic bytes). */
  readonly mimeType?: string;

  readonly elementType: AssetElementType;

  /** Where the bytes come from — drives the resolver strategy. */
  readonly sourceType: AssetSourceType;

  /** Viewport rectangle the badge should anchor to. */
  readonly boundingBox: BoundingBox;

  /**
   * Semantic role on the page. When omitted the asset is treated as `unknown`.
   * Icons, avatars, and decoration are badge-suppressed by the display layer.
   */
  readonly semanticRole?: SemanticRole;

  /** Stable content hash (e.g. sha-256) once computed; used as the cache key. */
  readonly contentHash?: string;
}

/**
 * Roles that should NOT receive a trust badge by default, to keep the page calm.
 * The display layer treats this set as suppressive.
 */
export const BADGE_SUPPRESSED_ROLES: ReadonlySet<SemanticRole> = new Set<SemanticRole>([
  'icon',
  'avatar',
  'decoration',
]);

/**
 * Helper: should the display layer render a badge for this asset by default?
 * Pure function over the role; the display layer may still be overridden by user
 * settings, but the safe default suppresses trivial decorative imagery.
 */
export function isBadgeSuppressed(asset: Pick<ContentAsset, 'semanticRole'>): boolean {
  return asset.semanticRole !== undefined && BADGE_SUPPRESSED_ROLES.has(asset.semanticRole);
}
