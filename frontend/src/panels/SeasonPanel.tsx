/**
 * The season screen — where the ladder lives.
 *
 * A season is one calendar month, so this is the part of the arena that starts
 * fresh: twelve rank badges, a hundred levels and the countdown to the reset.
 * Lifetime XP, coins, mastery and badges are a different ledger and are never
 * touched by a rollover, which is why "Season reset" is safe to show so
 * casually.
 */
import {useEffect, useState} from 'react';
import {CalendarClock, ChevronLeft, Coins, Flame, Sparkles, TrendingUp, Trophy} from 'lucide-react';

import SeasonBadge, {LevelTrack, RankLadder, type SeasonRank} from '../components/SeasonBadge';
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
        <Button variant="ghost" size="sm" icon={<ChevronLeft className="size-4" />} onClick={onBack} className="-ml-1">
          Back
        </Button>
      ) : null}

      {/* ---------------------------------------------------------- header */}
      <section className="panel-hero relative overflow-hidden">
        <Scenery layer="map" className="opacity-60" />
        <div className="relative p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
 <p className="text-[0.62rem] font-black tracking-[0.2em] text-mist-400">
                Season {season.number} · {season.label}
              </p>
              <h2 className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[1.15rem] font-black text-mist-50 sm:text-[1.35rem]">
                {me.rank.label}
                <span className="text-[0.8rem] font-bold text-mist-400">season level {me.level}/100</span>
              </h2>
              <p className="mt-1 text-[0.78rem] font-semibold text-mist-400">{me.rank.blurb}</p>
            </div>
            <SeasonBadge rank={me.rank} level={me.level} size="xl" current />
          </div>

          <div className="mt-4">
 <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[0.7rem] font-black tracking-wide text-mist-400">
              <span>
                {formatNumber(me.progress.into_level)} / {formatNumber(me.progress.level_ceiling - me.progress.level_floor)} XP into level {me.level}
              </span>
              <span className="tabular">{formatNumber(me.progress.needed)} XP to level {me.level + 1}</span>
            </div>
            <div className="xpbar">
              <span className="xpbar-fill" style={{width: `${Math.max(3, me.progress.percent)}%`}} />
            </div>
          </div>

          <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
 <p className="flex items-center gap-1.5 text-[0.6rem] font-black tracking-wide text-mist-500">
                <TrendingUp className="size-3" /> Season XP
              </p>
              <p className="mt-0.5 text-lg font-black text-nova-300 tabular">{formatNumber(me.xp)}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
 <p className="flex items-center gap-1.5 text-[0.6rem] font-black tracking-wide text-mist-500">
                <Trophy className="size-3" /> Board
              </p>
              <p className="mt-0.5 text-lg font-black text-gold-300 tabular">#{me.board_rank}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
 <p className="flex items-center gap-1.5 text-[0.6rem] font-black tracking-wide text-mist-500">
                <CalendarClock className="size-3" /> Resets in
              </p>
              <p className="mt-0.5 text-lg font-black text-pulse-300 tabular">{season.days_left}d</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
 <p className="flex items-center gap-1.5 text-[0.6rem] font-black tracking-wide text-mist-500">
                <Flame className="size-3" /> Next badge
              </p>
              <p className="mt-0.5 truncate text-lg font-black text-flare-300">
                {me.next_rank ? me.next_rank.label : 'Maxed'}
              </p>
            </div>
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
            <Chip key={rank.key} className="border-white/12 bg-white/[0.03] text-mist-400">
              {rank.label} · Lv {rank.level_from}
            </Chip>
          ))}
          <Chip className="border-white/12 bg-white/[0.03] text-mist-400">…</Chip>
          <Chip className="border-white/12 bg-white/[0.03] text-mist-400">
            {ladder[ladder.length - 1].label} · Lv {ladder[ladder.length - 1].level_from}
          </Chip>
        </div>
      </Card>

      {/* --------------------------------------------------------- ladder */}
      <Card className="min-w-0 p-4">
        <SectionHeading
          title="The twelve ranks"
          subtitle="Every badge is earned inside a single season and resets with it. Your lifetime level, coins and trophies never reset."
          icon={<Trophy className="size-4" />}
          action={
            onOpenRanks ? (
              <Button size="sm" variant="outline" onClick={onOpenRanks}>
                Boards
              </Button>
            ) : undefined
          }
        />
        <RankLadder ranks={ladder} currentKey={me.rank.key} level={me.level} className="mt-3" />
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
