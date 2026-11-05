/**
 * Ranked ladder badges.
 *
 * A thin adapter over the badge kit: the art lives in `components/Badge.tsx`
 * and every badge in the app is drawn from it. Each of the fifteen ranked
 * divisions carries its own emblem and its own server palette, so Bronze III
 * reads bronze and Grandmaster reads fire. Nothing to download — it is all
 * vector + CSS.
 */
import type {RankedTier} from '../lib/types';
import {TierBadge, TierPill, type BadgeGlyph, type BadgeSize} from './Badge';

const KNOWN_GLYPHS: BadgeGlyph[] = ['medal', 'shield', 'gem', 'star', 'crown', 'flame', 'trophy', 'sparkles', 'zap', 'sun'];

export function rankOf(tier: RankedTier) {
  const glyph = (KNOWN_GLYPHS as string[]).includes(tier.icon) ? (tier.icon as BadgeGlyph) : 'medal';
  return {key: tier.key, label: tier.name, glyph, deep: tier.deep, bright: tier.bright};
}

export default function RankedBadge({
  tier,
  size = 'md',
  current = false,
  locked = false,
  className = '',
}: {
  tier: RankedTier;
  size?: BadgeSize;
  current?: boolean;
  locked?: boolean;
  className?: string;
}) {
  const rank = rankOf(tier);
  return (
    <TierBadge
      deep={rank.deep}
      bright={rank.bright}
      glyph={rank.glyph}
      size={size}
      current={current}
      locked={locked}
      label={rank.label}
      className={className}
    />
  );
}

/**
 * The inline tag used in rows and headers: a small badge beside the tier
 * name, tinted with the tier's own metal.
 */
export function RankedTierPill({tier, current = false, className = ''}: {tier: RankedTier; current?: boolean; className?: string}) {
  const rank = rankOf(tier);
  return <TierPill deep={rank.deep} bright={rank.bright} label={rank.label} glyph={rank.glyph} size="xs" current={current} className={className} />;
}
