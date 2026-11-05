/**
 * Season badges — the realm mark.
 *
 * A season is a hundred levels and every level is its own realm, so the badge
 * a player wears is not "Platinum" or "Celestial": it is *their* realm, with
 * its own frame, its own colour and its own rune ring. This file is a thin
 * adapter over the badge kit — the art lives in `components/Badge.tsx` and
 * every badge in the app is drawn from it.
 *
 * `deep`/`bright` come from the server (`/api/arena/season`), so the ladder the
 * player sees is the ladder the API scores them against.
 */
import {RealmBadge, type BadgeSize} from './Badge';
import {realmFromRank, type Realm} from '../lib/realms';
import type {SeasonRank} from '../lib/types';

export type {BadgeSize, SeasonRank};
export type RankGlyph = SeasonRank['glyph'];

export default function SeasonBadge({
  rank,
  level,
  size = 'md',
  /** Dimmed for realms that are still ahead of the player. */
  locked = false,
  /** Rings the badge the player is standing on right now. */
  current = false,
  showLevel = true,
  className = '',
  title,
}: {
  rank: Pick<SeasonRank, 'key' | 'label' | 'glyph' | 'deep' | 'bright'> & Partial<SeasonRank>;
  level?: number;
  size?: BadgeSize;
  locked?: boolean;
  current?: boolean;
  showLevel?: boolean;
  className?: string;
  title?: string;
}) {
  const realm = realmFromRank(rank);
  const label = title ?? `${rank.label}${typeof level === 'number' ? ` · level ${level}` : ''}`;

  return (
    <RealmBadge
      realm={realm.realm}
      label={rank.label}
      deep={rank.deep}
      bright={rank.bright}
      glyph={rank.glyph ?? realm.glyph}
      shape={rank.shape ?? realm.shape}
      mystical={rank.mystical ?? realm.mystical}
      size={size}
      locked={locked}
      current={current}
      showNumber={showLevel && size !== 'xs'}
      title={label}
      className={className}
    />
  );
}

/**
 * The realm ladder: every realm in the season, dimmed until you reach it.
 *
 * A hundred badges is too many for a grid, so this walks the ladder in bands
 * — ten families of ten realms — and puts the one you are standing on first.
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
  const reached = (rank: SeasonRank) => level >= rank.level_from;
  const current = (rank: SeasonRank) => rank.key === currentKey;
  const sorted = [...ranks].sort((a, b) => a.level_from - b.level_from);
  const currentRank = sorted.find(current);

  // The band the player is standing in, first — then everything else, in order.
  const ordered = currentRank ? [currentRank, ...sorted.filter((rank) => rank !== currentRank)] : sorted;

  return (
    <div className={`grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 ${className}`}>
      {ordered.map((rank) => (
        <div
          key={rank.key}
          className={`flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border-2 px-1 py-2 text-center ${
            current(rank)
              ? 'border-nova-400/70 bg-nova-500/12'
              : reached(rank)
                ? 'border-white/12 bg-white/[0.04]'
                : 'border-white/8 bg-white/[0.02]'
          }`}
        >
          <SeasonBadge rank={rank} level={current(rank) ? level : rank.level_from} size="sm" locked={!reached(rank)} current={current(rank)} />
          <p className="w-full truncate text-[0.66rem] font-black text-mist-100">{rank.label}</p>
          <p className="text-[0.56rem] font-bold tracking-wide text-mist-500 tabular">Lv {rank.level_from}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * The ten families of realms — Ember, Iron, Gold, Platinum and the six
 * mystical ones above them. This is the shape of the ladder in one glance.
 */
export function RealmBands({
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
  const families = new Map<string, {label: string; realms: SeasonRank[]}>();
  for (const rank of ranks) {
    const realm = realmFromRank(rank);
    const key = realm.family || realm.band || 'realm';
    const entry = families.get(key) ?? {label: realm.band || realm.label, realms: []};
    entry.realms.push(rank);
    families.set(key, entry);
  }

  return (
    <div className={`grid gap-2 sm:grid-cols-2 lg:grid-cols-5 ${className}`}>
      {[...families.entries()].map(([key, family]) => {
        const first = family.realms[0];
        const last = family.realms[family.realms.length - 1];
        const mine = family.realms.find((rank) => rank.key === currentKey);
        const mystical = realmFromRank(first).mystical;
        return (
          <div
            key={key}
            className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 ${
              mine ? 'border-nova-400/60 bg-nova-500/10' : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            <SeasonBadge rank={first} size="sm" locked={!mystical && level < first.level_from} />
            <div className="min-w-0">
              <p className="truncate text-[0.78rem] font-black text-mist-50">{family.label}</p>
              <p className="truncate text-[0.62rem] font-bold tracking-wide text-mist-500 tabular">
                Realms {first.level_from}–{last.level_to}
                {mystical ? ' · glowing' : ''}
              </p>
            </div>
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

export type {Realm};
