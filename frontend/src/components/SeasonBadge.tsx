/**
 * Season badges.
 *
 * A thin adapter over the badge kit: the art lives in `components/Badge.tsx`
 * and every badge in the app is drawn from it, so a season rank and a ranked
 * tier are the same sculpted object.
 *
 * `deep`/`bright` come from the server (`/api/arena/season`), so the ladder the
 * player sees is the same ladder the API scores them against.
 */
import {TierBadge, type BadgeGlyph, type BadgeSize} from './Badge';
import type {SeasonRank} from '../lib/types';

export type {BadgeGlyph as RankGlyph, BadgeSize, SeasonRank};

export default function SeasonBadge({
  rank,
  level,
  size = 'md',
  /** Dimmed for ranks that are still ahead of the player. */
  locked = false,
  /** Rings the badge the player is standing on right now. */
  current = false,
  showLevel = true,
  className = '',
  title,
}: {
  rank: Pick<SeasonRank, 'key' | 'label' | 'glyph' | 'deep' | 'bright'>;
  level?: number;
  size?: BadgeSize;
  locked?: boolean;
  current?: boolean;
  showLevel?: boolean;
  className?: string;
  title?: string;
}) {
  const label = title ?? `${rank.label}${typeof level === 'number' ? ` · level ${level}` : ''}`;

  return (
    <TierBadge
      deep={rank.deep}
      bright={rank.bright}
      glyph={rank.glyph}
      size={size}
      level={level}
      showLevel={showLevel}
      locked={locked}
      current={current}
      label={label}
      className={className}
    />
  );
}

/**
 * The full seasonal ladder: twelve badges, blurred until you reach them.
 * Used by the season panel so a player can see exactly what is next.
 */
export function RankLadder({
  ranks,
  currentKey,
  level,
  className = '',
}: {
  ranks: SeasonRank[];
  currentKey: string;
  level: number;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 ${className}`}>
      {ranks.map((rank) => {
        const reached = level >= rank.level_from;
        const current = rank.key === currentKey;
        return (
          <div
            key={rank.key}
            className={`flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border-2 px-1.5 py-2.5 text-center ${
              current ? 'border-nova-400/70 bg-nova-500/12' : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            <SeasonBadge rank={rank} level={current ? level : rank.level_from} size="md" locked={!reached} current={current} />
            <p className="w-full truncate text-[0.68rem] font-black text-mist-100">{rank.label}</p>
            <p className="text-[0.56rem] font-bold tracking-wide text-mist-500">
              Lv {rank.level_from}–{rank.level_to}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** A 10x10 grid of the hundred levels — the season's progress in one glance. */
export function LevelTrack({level, ranks, className = ''}: {level: number; ranks: SeasonRank[]; className?: string}) {
  const colourFor = (row: number) => ranks.find((rank) => rank.key === colourKey(ranks, row)) ?? ranks[0];
  return (
    /* Ten columns of thumb-sized chips fill the width at every breakpoint, so
       the track uses its own rule instead of a fixed Tailwind column count. */
    <div className={`level-track gap-1 ${className}`}>
      {Array.from({length: 100}).map((_, index) => {
        const value = index + 1;
        const rank = colourFor(value);
        const reached = value <= level;
        const isNow = value === level;
        return (
          <span
            key={value}
            title={`Level ${value} · ${rank.label}`}
            className={`aspect-square rounded-[0.3rem] border ${isNow ? 'season-level-now' : reached ? '' : 'border-white/8'} ${
              reached ? '' : 'bg-white/[0.03]'
            }`}
            style={reached ? {background: `linear-gradient(160deg, ${rank.bright}, ${rank.deep})`, borderColor: 'rgba(0,0,0,0.25)'} : undefined}
          />
        );
      })}
    </div>
  );
}

function colourKey(ranks: SeasonRank[], level: number) {
  const found = ranks.find((rank) => rank.level_from <= level && level <= rank.level_to);
  return found ? found.key : ranks[ranks.length - 1].key;
}
