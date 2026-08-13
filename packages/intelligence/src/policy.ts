/**
 * @signet/intelligence — badge policy.
 *
 * The single authority on whether an asset gets a badge and at what priority.
 * Two modes:
 *  - Intelligence ON  (analysis present): richer suppression — also hides
 *    logo / advertisement and surfaces charts + news photos at high priority.
 *  - Intelligence OFF (no analysis): falls back to {@link isBadgeSuppressed} +
 *    asset.semanticRole, reproducing EXACTLY the pre-Intelligence display. The
 *    layer must be an enhancement, never a behavioral dependency (§11).
 *
 * This policy touches display ONLY. It never reads or writes a TrustDecision.
 */
import { isBadgeSuppressed, type ContentAsset, type SemanticRole } from '@signet/core';

import type { AssetSemanticAnalysis, BadgeDecision } from './types.js';

/** Roles that calm the page when suppressed. Superset of BADGE_SUPPRESSED_ROLES. */
const SUPPRESSED_ROLES: ReadonlySet<SemanticRole> = new Set<SemanticRole>([
  'icon',
  'avatar',
  'logo',
  'decoration',
  'advertisement',
]);

/** Roles whose badges are surfaced most prominently (§29). */
const HIGH_PRIORITY_ROLES: ReadonlySet<SemanticRole> = new Set<SemanticRole>([
  'primary-evidence',
  'chart',
  'data-visualization',
  'news-photo',
]);

/** Importance floor for an `unknown`/`illustration` to still earn a badge. */
const SHOW_MIN_IMPORTANCE = 0.3;

/** A pluggable badge policy; the default impl encodes §6. */
export interface BadgePolicy {
  shouldShow(asset: ContentAsset, analysis?: AssetSemanticAnalysis): BadgeDecision;
}

export class DefaultBadgePolicy implements BadgePolicy {
  shouldShow(asset: ContentAsset, analysis?: AssetSemanticAnalysis): BadgeDecision {
    if (analysis) return this.decideFromAnalysis(analysis);
    // Intelligence OFF → reproduce pre-Intelligence behavior byte-for-byte.
    if (isBadgeSuppressed(asset)) {
      return {
        show: false,
        priority: 'suppressed',
        reason: `${asset.semanticRole} is badge-suppressed (core default).`,
      };
    }
    return {
      show: true,
      priority: 'normal',
      reason: asset.semanticRole
        ? `${asset.semanticRole} is not badge-suppressed.`
        : 'No semantic role — treated as unknown and shown by default.',
    };
  }

  private decideFromAnalysis(a: AssetSemanticAnalysis): BadgeDecision {
    if (SUPPRESSED_ROLES.has(a.role)) {
      return { show: false, priority: 'suppressed', reason: `${a.role}: ${a.reason}` };
    }
    if (HIGH_PRIORITY_ROLES.has(a.role)) {
      return { show: true, priority: 'high', reason: a.reason };
    }
    // Conditional roles (illustration / unknown / hero / product / screenshot /
    // supporting-evidence): show unless the classifier is very unsure.
    if (a.importance >= SHOW_MIN_IMPORTANCE) {
      return { show: true, priority: 'normal', reason: a.reason };
    }
    return {
      show: false,
      priority: 'suppressed',
      reason: `${a.role} below importance ${SHOW_MIN_IMPORTANCE}; suppressing to keep the page calm.`,
    };
  }
}

/** Process-level singleton; pure, no state. */
export const badgePolicy: BadgePolicy = new DefaultBadgePolicy();
