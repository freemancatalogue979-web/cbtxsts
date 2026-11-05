/**
 * The season screen — where the ladder lives.
 *
 * A season is one calendar month, so this is the part of the arena that starts
 * fresh: a hundred realms, a hundred levels and the countdown to the reset.
 * Lifetime XP, coins, mastery and badges are a different ledger and are never
 * touched by a rollover, which is why "Season reset" is safe to show so
 * casually.
 */
import {useEffect, useState} from 'react';
import {Award, CalendarClock, ChevronLeft, Coins, Crown, Flame, Sparkles, TrendingUp, Trophy} from 'lucide-react';

import SeasonBadge, {LevelTrack, RealmBands, type SeasonRank} from '../components/SeasonBadge';
import Scenery from '../components/Scenery';
import {Button, Card, Chip, SectionHeading, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';

type SeasonSummary = {
  season: {key: string; number: number; label: string; starts_at: string; ends_at: string; days_left: number; days_total: number; percent_elapsed: number};
  /* the server names this block `me_season` — it is season XP, not lifetime */

  me_season: {
    xp: number;
    level: number;
    rank: SeasonRank;
    next_rank: SeasonRank | null;
    rank_progress: number;
    board_rank: number;
    progress: {level: number; xp: number; level_floor: number; level_ceiling: number; into_level: number; needed: number; percent: number};
  };
  ladder: SeasonRank[];
  levels: {level: number; xp: number; next_xp: number | null; rank: string}[];
  history: {season: {key: string; label: string}; xp: number; level: number; rank: SeasonRank | null}[];
};

export default function SeasonPanel({onBack, onOpenRanks}: {onBack?: () => void; onOpenRanks?: () => void} = {}) {
  const [data, setData] = useState<SeasonSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.arena
      .season()
      .then((payload) => setData(payload as unknown as SeasonSummary))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <Card className="p-5 text-center">
        <p className="text-[0.84rem] font-bold text-mist-400">Could not load the season — {error}</p>
      </Card>
    );
  }

  if (!data) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const {season, me_season: me, ladder, history} = data;

  return (
    <div className="min-w-0 space-y-3.5 sm:space-y-4">
      {onBack ? (
        <Button variant="ghost" size="sm" icon={<ChevronLeft className="size-4" />} onClick={onBack} className="-ml-1" label="Back" />
      ) : null}

      {/* ---------------------------------------------------------- header */}
      <section className="panel-hero relative overflow-hidden">
        <Scenery layer="map" className="opacity-60" />
        <div className="relative p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="ag-eyebrow">
                <CalendarClock className="size-3.5 text-gold-300" />
                Season {season.number} · {season.label} · Realm {me.rank.realm ?? me.level}
              </p>
              <h2
                className="ag-title ag-title-tier mt-1 line-clamp-2 text-[1.5rem] leading-none hyphens-auto [overflow-wrap:anywhere] sm:text-[1.9rem]"
                style={{['--tier-bright' as string]: me.rank.bright, ['--tier-deep' as string]: me.rank.deep}}
              >
                {me.rank.label}
              </h2>
              <p className="mt-1.5 text-[0.78rem] font-semibold text-mist-400">{me.rank.blurb}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="ag-rank">
                  <i>
                    <Crown />
                  </i>
                  Level {me.level}/100
                </span>
                <span className="ag-league" style={{['--lg' as string]: me.rank.bright}}>
                  <i>
                    <Award />
                  </i>
                  #{me.board_rank} on the board
                </span>
              </div>
            </div>
            <SeasonBadge rank={me.rank} level={me.level} size="xl" current />
          </div>

          <div className="relative mt-4">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[0.7rem] font-black tracking-wide text-mist-400">
              <span>
                {formatNumber(me.progress.into_level)} / {formatNumber(me.progress.level_ceiling - me.progress.level_floor)} XP into level {me.level}
              </span>
              <span className="tabular">{formatNumber(me.progress.needed)} XP to level {me.level + 1}</span>
            </div>
            <div
              className="ag-xp"
              role="progressbar"
              aria-valuenow={Math.round(me.progress.percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`XP into level ${me.level}`}
            >
              <i style={{width: `${Math.max(3, me.progress.percent)}%`, background: `linear-gradient(90deg, ${me.rank.deep}, ${me.rank.bright})`}} />
            </div>
          </div>

          <div className="mt-3.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2.5">
            {[
              {label: 'Season XP', value: formatNumber(me.xp), icon: TrendingUp, color: 'var(--color-nova-400)'},
              {label: 'Board', value: `#${me.board_rank}`, icon: Trophy, color: 'var(--color-gold-400)'},
              {label: 'Resets in', value: `${season.days_left}d`, icon: CalendarClock, color: 'var(--color-pulse-400)'},
              {label: 'Next badge', value: me.next_rank ? me.next_rank.label : 'Maxed', icon: Flame, color: 'var(--color-flare-400)'},
            ].map((res) => {
              const Icon = res.icon;
              return (
                <div key={res.label} className="ag-res" style={{['--res' as string]: res.color}}>
                  <Icon />
                  <b className="truncate">{res.value}</b>
                  <small>{res.label}</small>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ 100 levels */}
      <Card className="min-w-0 p-4">
        <SectionHeading
          title="Level track"
          subtitle="One hundred levels per season — level 1 is free, every level after costs a little more."
          icon={<Sparkles className="size-4" />}
        />
        <LevelTrack level={me.level} ranks={ladder} className="mt-3" />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ladder.slice(0, 5).map((rank) => (
            <Chip key={rank.key} tone="neutral">
              {rank.label} · Lv {rank.level_from}
            </Chip>
          ))}
          <Chip tone="neutral">…</Chip>
          <Chip tone="neutral">
            {ladder[ladder.length - 1].label} · Lv {ladder[ladder.length - 1].level_from}
          </Chip>
        </div>
      </Card>

      {/* --------------------------------------------------------- ladder */}
      <Card className="min-w-0 p-4">
        <SectionHeading
          title="The hundred realms"
          subtitle="Every level of a season is its own realm, with its own badge. You keep the one you reach when the month ends — but only until the next season opens."
          icon={<Trophy className="size-4" />}
          action={
            onOpenRanks ? (
              <Button size="sm" variant="outline" onClick={onOpenRanks}>
                Boards
              </Button>
            ) : undefined
          }
        />
        <RealmBands ranks={ladder} currentKey={me.rank.key} level={me.level} className="mt-3" />
        <p className="mt-3 flex items-center gap-1.5 text-[0.7rem] font-semibold text-mist-500">
          <Sparkles className="size-3.5 text-nova-300" />
          Everything from realm 41 upward glows — those badges are entities, not medals.
        </p>
      </Card>

      {/* -------------------------------------------------------- history */}
      <Card className="min-w-0 p-4">
        <SectionHeading
          title="Past seasons"
          subtitle="Where you finished in the last six months."
          icon={<CalendarClock className="size-4" />}
        />
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
          {history.map((row) => (
            <div key={row.season.key} className="flex w-[6.5rem] shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-3">
              {row.rank ? (
                <SeasonBadge rank={row.rank} level={row.level} size="sm" />
              ) : (
                <SeasonBadge rank={ladder[0]} size="sm" locked showLevel={false} />
              )}
              <p className="truncate text-[0.62rem] font-black text-mist-200">{row.season.label.split(' ')[0]}</p>
              <p className="text-[0.56rem] font-bold text-mist-500 tabular">
                {row.xp ? `${formatNumber(row.xp)} XP` : 'did not play'}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[0.7rem] font-semibold text-mist-500">
          <Coins className="size-3.5" /> Season rewards are claimed from the boards tab once you pass 1,000 season XP.
        </p>
      </Card>
    </div>
  );
}
