/** Toasts + the big celebration overlay (level-ups, badges, duel wins, prizes). */
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Crown,
  Flame,
  Gift,
  Info,
  Medal,
  Sparkles,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo} from 'react';
import {Button} from './ui';
import {useSession} from '../store/session';
import type {Celebration, Toast} from '../store/session';
import {formatNumber} from '../lib/format';
import {popIn, sheetVariants, overlayVariants} from '../lib/motion';
import {celebrate} from '../lib/confetti';
import {HAPTICS} from '../lib/haptics';
import Character from './Character';
import SeasonBadge from './SeasonBadge';
import {sfx} from '../lib/sfx';

const TOAST_STYLES: Record<Toast['kind'], {className: string; icon: typeof Info}> = {
  success: {className: 'border-mint-500/35 bg-mint-500/14 text-mint-200', icon: CheckCircle2},
  error: {className: 'border-flare-500/35 bg-flare-500/14 text-flare-200', icon: AlertTriangle},
  info: {className: 'border-pulse-500/35 bg-pulse-500/14 text-pulse-200', icon: Info},
  reward: {className: 'border-gold-500/35 bg-gold-500/14 text-gold-200', icon: Zap},
};

export function Toasts() {
  const {toasts, dismissToast} = useSession();
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-20 z-70 mx-auto flex max-w-md flex-col-reverse gap-2 sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-5 sm:mx-0 sm:w-96 sm:max-w-none sm:flex-col">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const style = TOAST_STYLES[toast.kind];
          const Icon = style.icon;
          return (
            <motion.button
              key={toast.id}
              layout
              variants={popIn}
              initial="hidden"
              animate="show"
              exit={{opacity: 0, x: 40, transition: {duration: 0.2}}}
              onClick={() => dismissToast(toast.id)}
              className={`pointer-events-auto flex w-full items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 text-left backdrop-blur-xl sm:gap-3 sm:px-4 sm:py-3 ${style.className}`}
            >
              <Icon className="mt-0.5 size-4 shrink-0 sm:size-5" />
              <span className="min-w-0">
                <span className="block truncate text-[0.82rem] font-extrabold sm:text-[0.86rem]">{toast.title}</span>
                {toast.detail && <span className="mt-0.5 block text-[0.74rem] font-semibold opacity-80 sm:text-[0.78rem]">{toast.detail}</span>}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

const CELEBRATION_META: Record<Celebration['kind'], {icon: typeof Trophy; title: string; accent: string}> = {
  level_up: {icon: Flame, title: 'Level up', accent: 'from-flare-500 via-nova-500 to-pulse-500'},
  season_rank: {icon: Medal, title: 'New badge', accent: 'from-gold-400 via-flare-500 to-nova-500'},
  season_roll: {icon: Sparkles, title: 'New season', accent: 'from-pulse-500 via-nova-500 to-flare-500'},
  badge: {icon: Award, title: 'Badge unlocked', accent: 'from-gold-400 via-flare-500 to-nova-500'},
  duel_win: {icon: Swords, title: 'Duel victory', accent: 'from-flare-500 via-nova-600 to-pulse-600'},
  exam_pass: {icon: Trophy, title: 'Result in', accent: 'from-pulse-500 via-nova-500 to-flare-500'},
  prize: {icon: Gift, title: 'Prize claimed', accent: 'from-gold-400 via-gold-500 to-flare-500'},
};

function CelebrationCard({celebration, onClose}: {celebration: Celebration; onClose: () => void}) {
  const meta = CELEBRATION_META[celebration.kind];
  const Icon = meta.icon;
  const xp = useMemo(
    () => (celebration.rewards || []).filter((r) => r.type === 'xp').reduce((sum, r) => sum + ('amount' in r ? r.amount : 0), 0),
    [celebration.rewards],
  );
  const coins = useMemo(
    () => (celebration.rewards || []).filter((r) => r.type === 'coins').reduce((sum, r) => sum + ('amount' in r ? r.amount : 0), 0),
    [celebration.rewards],
  );

  return (
    <motion.div
      className="fixed inset-0 z-80 grid place-items-center overflow-y-auto scrim backdrop-blur-md p-3 sm:p-5"
      variants={overlayVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        variants={sheetVariants}
        onClick={(event) => event.stopPropagation()}
        className="relative max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-[1.5rem] border border-white/12 bg-ink-900/95 text-center shadow-[0_50px_120px_-40px_rgba(168,85,247,0.7)] sm:rounded-[2rem]"
        role="dialog"
        aria-modal="true"
      >
        <div className={`h-1.5 w-full bg-gradient-to-r ${meta.accent}`} />
        <div className="pointer-events-none absolute inset-x-0 -top-24 h-56 bg-gradient-to-b from-nova-500/25 to-transparent blur-2xl" />
        <div className="relative px-4 pt-6 pb-5 sm:px-7 sm:pt-9 sm:pb-8">
          <Character mood="celebrate" size={64} tone="day" className="pointer-events-none absolute top-2 right-2 sm:right-4" />
          {celebration.season ? (
            /* A season badge gets its own hero: the metal shield the ladder
               draws, with the level carved into it, and where it sits. */
            <motion.div variants={popIn} initial="hidden" animate="show" transition={{delay: 0.08}} className="mx-auto w-fit">
              <SeasonBadge rank={celebration.season.rank} level={celebration.season.level} size="xl" current />
 <p className="mt-3 text-[0.62rem] font-black tracking-[0.18em] text-mist-500">
                {celebration.season.label}
              </p>
            </motion.div>
          ) : (
            <motion.span
              variants={popIn}
              initial="hidden"
              animate="show"
              transition={{delay: 0.08}}
              className={`mx-auto grid size-20 place-items-center rounded-[1.5rem] bg-gradient-to-br ${meta.accent} text-white shadow-[0_24px_60px_-20px_rgba(168,85,247,0.9)] sm:size-24 sm:rounded-[1.8rem]`}
            >
              {celebration.badge ? (
                <BadgeGlyph name={celebration.badge.icon} />
              ) : (
                <Icon className="size-10 sm:size-12" strokeWidth={2.1} />
              )}
            </motion.span>
          )}

          <motion.p
            initial={{opacity: 0, y: 10}}
            animate={{opacity: 1, y: 0}}
            transition={{delay: 0.16}}
 className="mt-3.5 text-[0.62rem] font-black tracking-[0.2em] text-mist-500 sm:mt-5 sm:text-[0.7rem] sm:tracking-[0.32em]"
          >
            {meta.title}
          </motion.p>
          <motion.h2
            initial={{opacity: 0, y: 12}}
            animate={{opacity: 1, y: 0}}
            transition={{delay: 0.2}}
            className="game-title mt-1 font-display text-2xl font-black tracking-tight sm:mt-1.5 sm:text-4xl"
          >
            {celebration.title}
          </motion.h2>
          {celebration.subtitle && (
            <motion.p
              initial={{opacity: 0}}
              animate={{opacity: 1}}
              transition={{delay: 0.26}}
              className="mt-1 text-[0.84rem] font-bold text-gradient sm:text-[0.9rem]"
            >
              {celebration.subtitle}
            </motion.p>
          )}
          {celebration.detail && (
            <motion.p
              initial={{opacity: 0}}
              animate={{opacity: 1}}
              transition={{delay: 0.3}}
              className="mx-auto mt-2.5 max-w-xs text-[0.82rem] font-medium text-mist-400 sm:mt-3 sm:text-[0.86rem]"
            >
              {celebration.detail}
            </motion.p>
          )}

          {celebration.season && (
            <motion.div
              initial={{opacity: 0, y: 10}}
              animate={{opacity: 1, y: 0}}
              transition={{delay: 0.32}}
              className="mx-auto mt-3 w-full max-w-xs rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left"
            >
              <p className="flex items-center gap-2 text-[0.74rem] font-bold text-mist-300">
                {celebration.seasonRoll ? (
                  <>
                    <SeasonBadge rank={celebration.season.rank} size="xs" showLevel={false} />
                    <span className="text-mist-500">
                      You finished {celebration.seasonRoll.label} on {celebration.seasonRoll.rankLabel} · level{' '}
                      {celebration.seasonRoll.level} ({formatNumber(celebration.seasonRoll.xp)} XP)
                    </span>
                  </>
                ) : celebration.season.previousRank ? (
                  <>
                    <SeasonBadge rank={celebration.season.previousRank} size="xs" showLevel={false} />
                    <span className="text-mist-500">upgraded from {celebration.season.previousRank.label}</span>
                  </>
                ) : celebration.kind === 'season_roll' ? (
                  <span className="text-mist-500">You sat last season out — the ladder is wide open</span>
                ) : (
                  <span className="text-mist-500">First badge of the season</span>
                )}
              </p>
              <p className="mt-1.5 text-[0.74rem] font-semibold text-mist-400">
                {celebration.season.nextRank
                  ? `${celebration.season.levelsToNextRank} level${celebration.season.levelsToNextRank === 1 ? '' : 's'} to ${celebration.season.nextRank.label}`
                  : 'Top of the ladder — nothing above this one'}
              </p>
            </motion.div>
          )}

          {(celebration.score !== undefined || xp > 0 || coins > 0) && (
            <motion.div
              initial={{opacity: 0, y: 14}}
              animate={{opacity: 1, y: 0}}
              transition={{delay: 0.34}}
              className="mt-4 grid grid-cols-3 gap-1.5 sm:mt-6 sm:gap-2"
            >
              {celebration.score !== undefined && (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-1 py-2.5 sm:px-0 sm:py-3">
                  <p className="truncate text-base font-black tabular text-mist-50 sm:text-lg">
                    {celebration.score}
                    {celebration.percentage !== undefined && (
                      <span className="text-[0.7rem] font-bold text-mist-500">/{Math.round((celebration.score / (celebration.percentage / 100)) || 0)}</span>
                    )}
                  </p>
 <p className="text-[0.58rem] font-bold tracking-[0.1em] text-mist-500 sm:text-[0.62rem] sm:tracking-[0.18em]">Score</p>
                </div>
              )}
              <div className="rounded-2xl border border-nova-400/35 bg-gradient-to-b from-nova-500/25 to-nova-700/10 px-1 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-2px_0_rgba(0,0,0,0.25)] sm:px-0 sm:py-3">
                <p className="truncate text-base font-black tabular text-nova-200 sm:text-lg">+{formatNumber(xp)}</p>
 <p className="text-[0.58rem] font-bold tracking-[0.1em] text-mist-500 sm:text-[0.62rem] sm:tracking-[0.18em]">XP</p>
              </div>
              <div className="rounded-2xl border border-gold-400/40 bg-gradient-to-b from-gold-400/25 to-gold-600/10 px-1 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-2px_0_rgba(0,0,0,0.25)] sm:px-0 sm:py-3">
                <p className="truncate text-base font-black tabular text-gold-200 sm:text-lg">+{formatNumber(coins)}</p>
 <p className="text-[0.58rem] font-bold tracking-[0.1em] text-mist-500 sm:text-[0.62rem] sm:tracking-[0.18em]">Coins</p>
              </div>
            </motion.div>
          )}

          {celebration.grade && (
            <p className="mt-4 text-[0.8rem] font-bold text-mist-400">
              Grade <span className="text-base font-black text-mist-50">{celebration.grade}</span>
              {celebration.rankLabel && (
                <>
                  {' · '}
                  <span className="inline-flex items-center gap-1 text-gold-300">
                    <Medal className="size-4" /> {celebration.rankLabel}
                  </span>
                </>
              )}
            </p>
          )}

          <Button className="mt-5 sm:mt-7" block size="lg" onClick={onClose} icon={<Crown className="size-4" />}>
            {celebration.kind === 'season_roll' ? 'Claim the new season' : 'Keep climbing'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const BADGE_GLYPHS: Record<string, typeof Trophy> = {
  first_steps: Flame,
  sharp_shooter: Zap,
  perfectionist: Crown,
  scholar: Award,
  speed_demon: Zap,
  duelist: Swords,
  champion: Trophy,
  socialite: Info,
  collector: Gift,
  streaker: Flame,
  veteran: Medal,
  top_rank: Crown,
  night_owl: Info,
  comeback: Flame,
  legend: Crown,
  deity: Crown,
};

function BadgeGlyph({name}: {name: string}) {
  const Glyph = BADGE_GLYPHS[name] ?? Award;
  return <Glyph className="size-10 sm:size-12" strokeWidth={2.1} />;
}

export function CelebrationLayer() {
  const {celebrations, dismissCelebration} = useSession();
  const active = celebrations[0];

  useEffect(() => {
    if (!active) return undefined;
    if (active.kind === 'duel_win' || active.kind === 'prize') celebrate({big: true});
    if (active.kind === 'duel_win' || active.kind === 'level_up') {
      HAPTICS.win();
      sfx.play(active.kind === 'level_up' ? 'levelup' : 'win');
    } else {
      HAPTICS.reward();
      sfx.play(active.kind === 'prize' ? 'coin' : 'correct');
    }
    const timer = window.setTimeout(() => dismissCelebration(active.id), 9000);
    return () => window.clearTimeout(timer);
  }, [active, dismissCelebration]);

  return (
    <AnimatePresence mode="wait">
      {active && <CelebrationCard key={active.id} celebration={active} onClose={() => dismissCelebration(active.id)} />}
    </AnimatePresence>
  );
}
