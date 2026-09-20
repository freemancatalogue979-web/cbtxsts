/**
 * Ranked ladder badges.
 *
 * The same sharp metal-shield art the season ladder uses, keyed off the
 * server's tier list (`/api/ranked/meta`): each of the fifteen badges carries
 * its own glyph and deep/bright gradient, so Bronze III reads bronze and
 * Grandmaster reads fire. Nothing to download — it is all vector + CSS.
 */
import type {RankedTier} from '../lib/types';
import SeasonBadge, {type BadgeSize, type RankGlyph} from './SeasonBadge';

const KNOWN_GLYPHS: RankGlyph[] = ['medal', 'shield', 'gem', 'star', 'crown', 'flame', 'trophy', 'sparkles', 'zap', 'sun'];

export function rankOf(tier: RankedTier) {
  const glyph = (KNOWN_GLYPHS as string[]).includes(tier.icon) ? (tier.icon as RankGlyph) : 'medal';
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
  return <SeasonBadge rank={rankOf(tier)} size={size} current={current} locked={locked} showLevel={false} className={className} />;
}

/**
 * The inline tag used in rows and headers: a small shield beside the tier
 * name, tinted with the tier's own metal.
 */
export function RankedTierPill({tier, className = ''}: {tier: RankedTier; className?: string}) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-1 ${className}`}
      style={{
        borderColor: `${tier.bright}59`,
        background: `${tier.bright}17`,
        color: tier.bright,
      }}
    >
      <RankedBadge tier={tier} size="xs" className="-ml-0.5 scale-[0.86]" />
      <span className="truncate text-[0.62rem] font-extrabold tracking-wide whitespace-nowrap">{tier.name}</span>
    </span>
  );
}
