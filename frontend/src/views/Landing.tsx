/**
 * Landing — the arena's front face.
 *
 * A branded head, a picture reel that plays like a short clip, live stats, a
 * swipeable feature rail and the current top five. The sign-in form lives on its
 * own view: on a phone this page is purely the pitch, with one button into the
 * sign-in screen.
 */
import {Coins, Flame, Gamepad2, Medal, Shield, Sparkles, Swords, Trophy, Users, Wifi} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {Avatar, Button, SectionHeading} from '../components/ui';
import {Wordmark} from '../components/Brand';
import HeroReel, {type HeroSlide} from '../components/HeroReel';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {useSession} from '../store/session';
import type {Bootstrap} from '../lib/types';

const SLIDES: HeroSlide[] = [
  {
    src: '/arena/bg.webp',
    pos: 'center 18%',
    alt: 'Quiz Arena game art: neon esports arena scoreboard under the gold crown crest',
    eyebrow: 'Timed arena exams',
    title: 'Every answer earns glory.',
    caption: 'Server-guarded clocks, instant grading and XP for every correct answer. Your phone is the exam hall.',
    accent: 'text-flare-300',
  },
  {
    src: '/arena/bg.webp',
    pos: 'left center',
    alt: 'Quiz Arena game art: rival mascots with headsets and tablets facing off',
    eyebrow: 'Live 1v1 duels',
    title: 'Duel a friend. Right now.',
    caption: 'Six-letter codes, real-time answers, speed bonuses and combo streaks. Winner takes the coin pot.',
    accent: 'text-nova-300',
  },
  {
    src: '/arena/bg.webp',
    pos: 'center center',
    alt: 'Quiz Arena game art: the wolf mascot charging forward with a crown phone',
    eyebrow: 'Global & friends ranks',
    title: 'Climb the arena ladder.',
    caption: 'Weekly and all-time leaderboards, badges and login streaks. Beat your mates, not just the clock.',
    accent: 'text-pulse-300',
  },
  {
    src: '/arena/bg.webp',
    pos: 'right center',
    alt: 'Quiz Arena game art: gold coins and the glowing EXP vault',
    eyebrow: 'Coins become prizes',
    title: 'Turn XP into prizes.',
    caption: 'Bank coins from exams, duels and daily bonuses — then claim data bundles, books and campus perks.',
    accent: 'text-gold-300',
  },
];

const FEATURES = [
  {
    icon: Gamepad2,
    tone: 'text-flare-300 border-flare-500/25 bg-flare-500/10',
    title: 'Timed exams, real stakes',
    detail: 'Deadlines, autosave and hidden answer keys. Grades land the second you submit.',
    foot: 'XP + coins per correct answer',
  },
  {
    icon: Swords,
    tone: 'text-nova-300 border-nova-500/25 bg-nova-500/10',
    title: 'Head-to-head duels',
    detail: 'Challenge a friend by code or jump into quick match. Speed and combos decide it.',
    foot: 'Winner takes the staked pot',
  },
  {
    icon: Trophy,
    tone: 'text-gold-300 border-gold-500/25 bg-gold-500/10',
    title: 'Ranks & real prizes',
    detail: 'Global, weekly and friends leaderboards. Cash your coins into the prize vault.',
    foot: 'Season rewards, claimed in-app',
  },
];

export default function Landing({onSignIn, onStaff}: {onSignIn: () => void; onStaff: () => void}) {
  const {config} = useSession();
  const [stats, setStats] = useState<Bootstrap | null>(null);
  const [showBar, setShowBar] = useState(false);
  const heroSentinel = useRef<HTMLDivElement | null>(null);
  const ranksRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .bootstrap()
      .then((data) => {
        if (alive) setStats(data);
      })
      .catch(() => {
        /* the sign-in view surfaces connection problems */
      });
    return () => {
      alive = false;
    };
  }, []);

  /* The sticky call-to-action appears once the hero scrolls out of sight. */
  useEffect(() => {
    const node = heroSentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setShowBar(!entry.isIntersecting), {threshold: 0.05});
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const topRows = (stats?.leaderboard ?? []).slice(0, 5);

  return (
    <div className="aurora relative min-h-dvh overflow-x-clip">
      <div className="pointer-events-none fixed inset-0 grid-lines opacity-60" />
      <div className="pointer-events-none fixed -top-40 -left-32 size-[26rem] rounded-full bg-flare-600/16 blur-[110px]" />
      <div className="pointer-events-none fixed -right-32 top-24 size-[24rem] rounded-full bg-nova-600/18 blur-[110px]" />
      <div className="pointer-events-none fixed -bottom-32 left-1/4 size-[22rem] rounded-full bg-pulse-600/16 blur-[110px]" />

      {/* ---------------------------------------------------- branded head
          No bar, no rule: the crest owns the top-left corner and the controls
          float on the aurora. The header height never crops the brand mark. */}
      <header className="sticky top-0 z-50 safe-top">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-ink-950 via-ink-950/72 to-transparent sm:h-32" />
        <div className="relative flex w-full items-center gap-2 px-3 py-1 sm:h-19 sm:gap-3 sm:px-4 lg:h-24 lg:px-6">
          <Wordmark size="brand" tagline taglineClassName="hidden md:block" />
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {(stats?.online ?? 0) > 0 && (
              <span className="hidden items-center gap-1.5 rounded-full border border-mint-500/25 bg-mint-500/10 px-2.5 py-1 text-[0.62rem] font-black tracking-wide text-mint-300 md:inline-flex">
                <Wifi className="size-3" />
                {formatNumber(stats?.online ?? 0)} online
              </span>
            )}
            <span className="hidden items-center gap-1.5 rounded-full border border-gold-500/25 bg-gold-500/10 px-2.5 py-1 text-[0.62rem] font-black tracking-wide text-gold-300 md:inline-flex">
              <Flame className="size-3" />
              {stats?.config.season_name || 'Season 1'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={onStaff}
              icon={<Shield className="size-3.5" />}
              className="hidden lg:inline-flex"
            >
              Staff
            </Button>
            <Button size="sm" onClick={onSignIn}>
              Sign in
            </Button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-3 pb-28 sm:px-6 sm:pb-16">
        {/* ---------------------------------------------------------- hero */}
        <section className="pt-3.5 sm:pt-8">
          <div ref={heroSentinel} />
          <HeroReel slides={SLIDES} />

          <div className="mt-3.5 grid gap-2 sm:mt-6 sm:grid-cols-[1.4fr_1fr] sm:gap-3">
            <Button size="lg" block onClick={onSignIn} icon={<Sparkles className="size-4 text-gold-300" />}>
              Enter the arena
            </Button>
            <Button
              size="lg"
              block
              variant="outline"
              onClick={() => ranksRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'})}
              icon={<Trophy className="size-4 text-gold-300" />}
            >
              Top players
            </Button>
          </div>
        </section>

        {/* ----------------------------------------------------- live stats */}
        <section className="mt-5 grid grid-cols-2 gap-2 sm:mt-8 sm:grid-cols-4 sm:gap-3" aria-label="Arena right now">
          {[
            {icon: Users, label: 'Players', value: formatNumber(stats?.players ?? 0), tone: 'text-nova-300'},
            {icon: Gamepad2, label: 'Live exams', value: String(stats?.quizzes.length ?? 0), tone: 'text-flare-300'},
            {icon: Wifi, label: 'Online now', value: formatNumber(stats?.online ?? 0), tone: 'text-mint-300'},
            {icon: Flame, label: 'Season', value: stats?.config.season_name || 'Season 1', tone: 'text-gold-300'},
          ].map((tile) => {
            const Icon = tile.icon;
            return (
              <div key={tile.label} className="card flex items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/6 sm:size-10">
                  <Icon className={`size-4 sm:size-5 ${tile.tone}`} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-display text-[1rem] leading-tight font-black text-mist-50 tabular sm:text-xl">
                    {tile.value}
                  </span>
 <span className="block text-[0.6rem] font-bold tracking-[0.14em] text-mist-500 sm:text-[0.66rem]">
                    {tile.label}
                  </span>
                </span>
              </div>
            );
          })}
        </section>

        {/* ------------------------------------------------- feature rail */}
        <section className="mt-8 sm:mt-12">
          <SectionHeading
            title="What's inside"
            subtitle="Three ways to earn glory — swipe through on your phone."
            icon={<Gamepad2 className="size-4 text-nova-300" />}
          />
          <div className="-mx-3 mt-3 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-3 pb-1.5 no-scrollbar sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:px-0">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <article
                  key={feature.title}
                  className="card min-w-[82%] snap-center px-4 py-4 sm:min-w-0 sm:px-5 sm:py-5"
                >
                  <span className={`inline-grid size-10 place-items-center rounded-2xl border sm:size-11 ${feature.tone}`}>
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-3 text-[0.98rem] font-black tracking-tight text-mist-50 sm:text-[1.05rem]">
                    {feature.title}
                  </h3>
                  <p className="mt-1.5 text-[0.8rem] leading-relaxed font-medium text-mist-400">{feature.detail}</p>
 <p className="mt-3 flex items-center gap-1.5 text-[0.66rem] font-black tracking-[0.14em] text-mist-500">
                    <Coins className="size-3 text-gold-400" />
                    {feature.foot}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        {/* --------------------------------------------- top of the arena */}
        {topRows.length > 0 && (
          <section ref={ranksRef} className="mt-8 scroll-mt-20 sm:mt-12">
            <SectionHeading
              title="Top of the arena"
              subtitle="The current season leaders."
              icon={<Trophy className="size-4 text-gold-400" />}
            />
            <div className="card mt-3 divide-y divide-white/6">
              {topRows.map((row, position) => (
                <div key={row.id} className="flex items-center gap-2.5 px-3 py-2.5 sm:gap-3.5 sm:px-4 sm:py-3">
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-lg text-[0.72rem] font-black tabular sm:size-8 ${
                      position === 0
                        ? 'bg-gold-500/18 text-gold-300'
                        : position === 1
                          ? 'bg-white/10 text-mist-200'
                          : position === 2
                            ? 'bg-flare-500/14 text-flare-300'
                            : 'bg-white/5 text-mist-500'
                    }`}
                  >
                    {position + 1}
                  </span>
                  <Avatar name={row.name} hue={row.avatar_hue} initials={row.initials} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.86rem] font-extrabold text-mist-100 sm:text-[0.92rem]">
                      {row.name}
                    </span>
                    <span className="block truncate text-[0.66rem] font-bold text-mist-500 sm:text-[0.72rem]">
                      {row.title} · Level {row.level}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[0.8rem] font-black text-nova-300 tabular sm:text-[0.9rem]">
                    <Medal className="size-3.5" />
                    {formatNumber(row.value)} XP
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ------------------------------------------------------- footer */}
        <footer className="mt-10 border-t border-white/6 pt-5 pb-2 text-center sm:mt-14">
          <p className="text-[0.72rem] font-bold text-mist-500">
            {config?.institution || 'University of Nigeria'} · {config?.faculty || 'Faculty of Law'}
          </p>
          <p className="mt-1 text-[0.66rem] font-semibold text-mist-600">
            {config?.campus || 'Enugu, Nigeria'} · Powered by the Quiz Arena engine
          </p>
        </footer>
      </main>

      {/* --------------------------------------- sticky phone call-to-action */}
      <div
        className={`print-hide fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/92 px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom,0px),0.6rem)] backdrop-blur-xl transition-transform duration-300 sm:hidden ${
          showBar ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <Button size="lg" block onClick={onSignIn} icon={<Sparkles className="size-4 text-gold-300" />}>
          Sign in & play
        </Button>
      </div>
    </div>
  );
}
