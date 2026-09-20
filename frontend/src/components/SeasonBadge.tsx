/**
 * Season badges.
 *
 * One piece of art per rank, drawn with CSS instead of images: a metal shield
 * with the rank's own gradient, a ring, a gem and the level carved into it. It
 * scales from a 26px chip beside a name to a 120px hero badge without ever
 * going soft, and it costs the page nothing to paint.
 *
 * `deep`/`bright` come from the server (`/api/arena/season`), so the ladder the
 * player sees is the same ladder the API scores them against.
 */
import {
  Crown,
  Flame,
  Gem,
  Medal,
  Shield,
  Sparkles,
  Star,
  Sun,
  Trophy,
  Zap,
} from 'lucide-react';

export type RankGlyph = 'medal' | 'shield' | 'gem' | 'star' | 'crown' | 'flame' | 'trophy' | 'sparkles' | 'zap' | 'sun';

export type SeasonRank = {
  key: string;
  label: string;
  glyph: RankGlyph;
  blurb: string;
  level_from: number;
  level_to: number;
  xp_from: number;
  xp_to: number;
  deep: string;
  bright: string;
};

const GLYPHS = {medal: Medal, shield: Shield, gem: Gem, star: Star, crown: Crown, flame: Flame, trophy: Trophy, sparkles: Sparkles, zap: Zap, sun: Sun};

const SIZES = {
  xs: {box: 26, glyph: 12, font: '0.52rem', ring: 1},
  sm: {box: 34, glyph: 15, font: '0.6rem', ring: 1.5},
  md: {box: 48, glyph: 21, font: '0.78rem', ring: 2},
  lg: {box: 72, glyph: 30, font: '1.1rem', ring: 2.5},
  xl: {box: 104, glyph: 42, font: '1.5rem', ring: 3},
} as const;

export type BadgeSize = keyof typeof SIZES;

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
  const dims = SIZES[size];
  const Glyph = GLYPHS[rank.glyph] ?? Medal;
  const label = title ?? `${rank.label}${typeof level === 'number' ? ` · level ${level}` : ''}`;

  return (
    <span
      className={`season-badge relative inline-grid shrink-0 place-items-center ${locked ? 'season-badge-locked' : ''} ${
        current ? 'season-badge-current' : ''
      } ${className}`}
      style={{
        width: dims.box,
        height: dims.box,
        ['--badge-deep' as string]: rank.deep,
        ['--badge-bright' as string]: rank.bright,
        ['--badge-ring' as string]: `${dims.ring}px`,
      }}
      data-rank={rank.key}
      role="img"
      aria-label={label}
      title={label}
    >
      {/* the shield: outer ring, metal face, inner bevel */}
      <span className="season-badge-shell absolute inset-0 rounded-[30%]" />
      <span className="season-badge-face absolute inset-[12%] rounded-[28%]" />
      <span className="relative grid place-items-center" style={{gap: 0}}>
        <Glyph style={{width: dims.glyph, height: dims.glyph}} strokeWidth={2.4} />
        {showLevel && typeof level === 'number' ? (
          <span className="season-badge-level leading-none font-black tabular" style={{fontSize: dims.font}}>
            {level}
          </span>
        ) : null}
      </span>
    </span>
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
export function LevelTrack({ level, ranks, className = '' }: { level: number; ranks: SeasonRank[]; className?: string }) {
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
