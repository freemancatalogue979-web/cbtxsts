/** Play tab: hero status card, daily bonus, and the exam catalogue. */
import {
  AlarmClock,
  Award,
  CalendarClock,
  ChevronRight,
  CircleDot,
  Coins,
  Crown,
  Flame,
  Gift,
  Layers,
  Lock,
  Megaphone,
  Moon,
  Play,
  RotateCcw,
  ScrollText,
  Sun,
  Sunset,
  Swords,
  Target,
  Trophy,
  Zap,
} from 'lucide-react';
import {motion} from 'motion/react';
import {Suspense, useEffect, useMemo, useState} from 'react';
import {Button, Card, Chip, EmptyState, ProgressRing, SectionHeading, Segmented, Skeleton} from '../components/ui';
import {lazyScreen} from '../lib/lazy';
import {api} from '../lib/api';
import {formatDate, formatNumber, TIER_STYLES} from '../lib/format';
import {staggerContainer, staggerItem} from '../lib/motion';
import {useSize} from '../lib/responsive';
import Character from '../components/Character';
import SeasonBadge from '../components/SeasonBadge';
import Mascot from '../components/Mascot';
import {currentMascot} from '../lib/prefs';
import {useSession} from '../store/session';
import type {Quiz} from '../lib/types';

/* Opened from the Practice / Flashcards switch, so they load on first use. */
const PracticePanel = lazyScreen(() => import('./PracticePanel'));
const FlashcardsPanel = lazyScreen(() => import('./FlashcardsPanel'));

const STATUS_META: Record<string, {label: string; className: string; icon: typeof Play}> = {
  active: {label: 'Operation active', className: 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300', icon: CircleDot},
  scheduled: {label: 'Scheduled op', className: 'border-nova-500/40 bg-nova-500/12 text-nova-300', icon: CalendarClock},
  draft: {label: 'Classified', className: 'border-white/14 bg-white/6 text-mist-500', icon: Lock},
  completed: {label: 'Operation closed', className: 'border-white/14 bg-white/6 text-mist-500', icon: Lock},
};

function QuizCard({quiz, onStart, index}: {quiz: Quiz; onStart: (quiz: Quiz) => void; index?: number}) {
  const status = STATUS_META[quiz.status] ?? STATUS_META.draft;
  const StatusIcon = status.icon;
  const attempt = quiz.my_attempt;
  const submitted = attempt?.status === 'submitted' || attempt?.status === 'expired';
  const inProgress = attempt?.status === 'in_progress';
  const locked = quiz.status !== 'active' || quiz.question_count === 0;

  return (
    <motion.li variants={staggerItem}>
      <Card className="group relative flex h-full flex-col overflow-hidden p-4 transition-all hover:border-nova-400/40 hover:shadow-[0_0_20px_-5px_rgba(6,182,212,0.2)] sm:p-5">
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
 <span className="text-[0.62rem] font-black tracking-wider text-nova-400">
                OP-{String((index ?? 0) + 1).padStart(2, '0')}
              </span>
              {quiz.course && (
                <Chip className="border-white/12 bg-white/6 text-mist-400 text-[0.66rem]">
                  <span style={{color: quiz.course.accent}} className="font-black">
                    {quiz.course.code}
                  </span>
                </Chip>
              )}
            </div>
            <h3 className="mt-1 text-[0.96rem] leading-snug font-extrabold text-mist-50 sm:text-[1.02rem]">{quiz.title}</h3>
            <p className="mt-1 line-clamp-2 text-[0.78rem] font-medium text-mist-400 sm:text-[0.8rem]">
              {quiz.instructions || `${quiz.course?.title ?? 'Tactical Assessment'} · ${quiz.question_count} objectives`}
            </p>
          </div>
          <Chip className={status.className} icon={<StatusIcon className="size-3" />}>
            {status.label}
          </Chip>
        </div>

        <div className="relative mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.72rem] font-bold text-mist-400 sm:mt-4 sm:gap-x-4 sm:gap-y-2 sm:text-[0.76rem]">
          <span className="flex items-center gap-1.5">
            <ScrollText className="size-3.5 text-nova-400" /> {quiz.question_count} objectives
          </span>
          <span className="flex items-center gap-1.5">
            <AlarmClock className="size-3.5 text-amber-400" /> {quiz.duration_minutes} min
          </span>
          {quiz.scheduled_at && (
            <span className="flex items-center gap-1.5">
              <CalendarClock className="size-3.5 text-nova-400" /> {formatDate(quiz.scheduled_at)}
            </span>
          )}
          {!!quiz.submission_count && (
            <span className="flex items-center gap-1.5">
              <Trophy className="size-3.5 text-amber-400" /> {formatNumber(quiz.submission_count)} deployments
            </span>
          )}
        </div>

        {submitted && attempt && (
          <div className="relative mt-4 flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-emerald-500/15 text-[0.8rem] font-black text-emerald-300">
              {attempt.grade}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.82rem] font-extrabold text-mist-100">
                {attempt.correct_count}/{quiz.question_count} confirmed · {attempt.percentage.toFixed(0)}%
              </p>
              <p className="text-[0.70rem] font-semibold text-mist-400">
                +{formatNumber(attempt.xp_awarded)} XP · +{formatNumber(attempt.coins_awarded)} credits
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onStart(quiz)} icon={<RotateCcw className="size-3.5" />}>
              Review
            </Button>
          </div>
        )}

        <div className="relative mt-auto flex items-center gap-2 pt-4 sm:pt-5">
          <Button
            block
            variant={inProgress ? 'gold' : locked ? 'outline' : 'primary'}
            disabled={locked && !inProgress}
            onClick={() => onStart(quiz)}
            icon={inProgress ? <Play className="size-4" /> : locked ? <Lock className="size-4" /> : <Play className="size-4" />}
          >
            {inProgress ? 'Resume attempt' : submitted ? 'Open result slip' : locked ? 'Not open yet' : 'Start exam'}
          </Button>
          <ChevronRight className="size-4 shrink-0 text-mist-600 transition-transform group-hover:translate-x-1" />
        </div>
      </Card>
    </motion.li>
  );
}

function examEnds(quiz: Quiz): number | null {
  if (!quiz.end_at) return null;
  return new Date(quiz.end_at.endsWith('Z') ? quiz.end_at : `${quiz.end_at}Z`).getTime();
}

function countdownParts(ms: number): {h: string; m: string; s: string} {
  const left = Math.max(0, Math.round(ms / 1000));
  return {
    h: String(Math.floor(left / 3600)).padStart(2, '0'),
    m: String(Math.floor((left % 3600) / 60)).padStart(2, '0'),
    s: String(left % 60).padStart(2, '0'),
  };
}

export default function PlayPanel({onStartExam, onOpenDuels}: {onStartExam: (quiz: Quiz) => void; onOpenDuels: () => void}) {
  const {profile, toast, on} = useSession();
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null);
  const [filter, setFilter] = useState<string>('all');
  // The chosen pane survives a refresh (device-local, like every other pref),
  // so a student practising lands back inside their run, not on the exam list.
  const [pane, setPaneState] = useState<'exams' | 'practice' | 'flashcards'>(() => {
    try {
      const saved = window.localStorage.getItem('arena.playpane');
      return saved === 'practice' || saved === 'flashcards' ? saved : 'exams';
    } catch {
      return 'exams';
    }
  });
  const setPane = (next: 'exams' | 'practice' | 'flashcards') => {
    setPaneState(next);
    try {
      window.localStorage.setItem('arena.playpane', next);
    } catch {
      /* ignore private-mode storage errors */
    }
  };
  const [heroMascot] = useState(() => currentMascot());
  const [now, setNow] = useState(() => Date.now());

  const load = () => {
    api
      .quizzes()
      .then(setQuizzes)
      .catch((error: Error) => toast('error', 'Could not load exams', error.message));
  };

  useEffect(load, []);

  // One shared clock for every exam countdown on the tab.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // The instant an admin opens an exam window, every signed-in player hears about it.
  useEffect(
    () =>
      on('quiz_status', (data) => {
        load();
        const status = (data as {status?: string} | null)?.status;
        if (status === 'active') {
          toast('error', 'Compulsory exam live', 'An admin just opened an exam window — the clock is running.');
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [on],
  );

  /* Exams an admin has opened with a closing time, still joinable by me. */
  const liveExams = useMemo(
    () =>
      (quizzes || []).filter((quiz) => {
        if (quiz.status !== 'active') return false;
        const ends = examEnds(quiz);
        if (ends === null || ends <= now) return false;
        return quiz.my_attempt?.status !== 'submitted';
      }),
    [quizzes, now],
  );

  const courses = useMemo(() => {
    const map = new Map<string, string>();
    (quizzes || []).forEach((quiz) => {
      if (quiz.course) map.set(quiz.course.code, quiz.course.title);
    });
    return [...map.entries()];
  }, [quizzes]);

  const visible = useMemo(() => {
    const rows = quizzes || [];
    if (filter === 'all') return rows;
    if (filter === 'mine') return rows.filter((quiz) => quiz.my_attempt);
    return rows.filter((quiz) => quiz.course?.code === filter);
  }, [quizzes, filter]);


  // the exam you're in the middle of, else the next open one you haven't sat
  const upNext = useMemo(() => {
    const rows = visible.filter((quiz) => !quiz.is_bank);
    return (
      rows.find((quiz) => quiz.my_attempt?.status === 'in_progress') ??
      rows.find((quiz) => quiz.status === 'active' && quiz.question_count > 0 && !quiz.my_attempt) ??
      null
    );
  }, [visible]);

  const heroRing = useSize(84, 116);
  const heroSlime = useSize(58, 92);
  if (!profile) return <Skeleton className="h-64" />;
  const hour = new Date().getHours();
  const greetingText = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const GreetIcon = hour < 6 || hour >= 19 ? Moon : hour < 17 ? Sun : Sunset;

  const progress = profile.progress;
  const tier = TIER_STYLES[profile.tier] ?? TIER_STYLES.bronze;

  return (
    <div className="space-y-5 sm:space-y-8">
      {/* ------------------------------------------- compulsory exam banners */}
      {liveExams.map((quiz) => {
        const ends = examEnds(quiz) ?? now;
        const {h, m, s} = countdownParts(ends - now);
        const resuming = quiz.my_attempt?.status === 'in_progress';
        return (
          <motion.div
            key={quiz.id}
            initial={{opacity: 0, y: -10}}
            animate={{opacity: 1, y: 0}}
            className="relative overflow-hidden rounded-[1.3rem] border border-flare-500/40 bg-gradient-to-r from-flare-600/22 via-ink-900/80 to-ink-900/80 p-3.5 sm:p-5"
          >
            <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-flare-500/20 text-flare-300 sm:size-11 sm:rounded-2xl">
                <Megaphone className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[0.62rem] font-black tracking-[0.1em] whitespace-nowrap text-flare-300 sm:text-[0.66rem] sm:tracking-[0.16em]">
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-flare-400" />
                  Compulsory exam · live now
                </p>
                <h2 className="mt-0.5 line-clamp-2 font-display leading-snug text-[1rem] font-black tracking-tight text-mist-50 sm:text-[1.15rem]">
                  {quiz.title}
                </h2>
                <p className="mt-0.5 text-[0.72rem] font-bold text-mist-400">
                  {quiz.duration_minutes} min per attempt · window closes in{' '}
                  <span className="font-display tabular-nums text-gold-300">
                    {h}:{m}:{s}
                  </span>
                  {resuming ? ' · your clock kept running — resume where you left off' : ''}
                </p>
              </div>
              </div>
              <Button variant="danger" className="w-full shrink-0 sm:w-auto" onClick={() => onStartExam(quiz)} icon={<Play className="size-4" />}>
                {resuming ? 'Resume' : 'Enter now'}
              </Button>
            </div>
            <p className="relative mt-2.5 text-[0.68rem] font-semibold text-mist-500">
              Leave mid-exam and your progress is kept — but once the window closes it is results only, no retakes.
            </p>
          </motion.div>
        );
      })}

      {/* ------------------------------------------------------------ hero */}
      <motion.section variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
        <motion.div variants={staggerItem}>
          <Card className="ag-hero relative overflow-hidden">
            {/* ---- banner: level ring, name plate, XP track */}
            <div className="ag-hero__banner px-4 pt-4 pb-4 sm:px-7 sm:pt-6 sm:pb-5">
              {/* the slime companion peeks in from the corner */}
              <Character
                mood="idle"
                size={heroSlime}
                tone="day"
                className="pointer-events-none absolute -top-1 right-0 opacity-95 sm:top-1 sm:right-4"
                label="Slime mascot"
              />
              <div className="relative flex items-center gap-3.5 sm:gap-6">
                <div className="relative shrink-0">
                  <ProgressRing value={progress.percent} size={heroRing} stroke={8}>
                    <span className="flex flex-col items-center">
                      <span className="text-[0.5rem] font-black tracking-[0.18em] text-mist-500 uppercase not-italic sm:text-[0.58rem]">Level</span>
                      <span className="ag-title text-[1.7rem] leading-none sm:text-[2.3rem]">{progress.level}</span>
                    </span>
                  </ProgressRing>
                  {/* the mascot you picked rides on the ring like a familiar */}
                  <span className="ag-hero__companion" aria-hidden="true">
                    <Mascot name={heroMascot} mood="idle" size={26} className="pointer-events-none" />
                  </span>
                </div>

                <div className="min-w-0 flex-1 sm:pr-24">
                  <p className="ag-eyebrow pr-14 sm:pr-0">
                    <GreetIcon className="size-3.5 text-gold-300" />
                    {greetingText}
                  </p>
                  <h1 className="ag-name mt-1 line-clamp-2 pr-10 [overflow-wrap:anywhere] sm:pr-0">{profile.name.split(' ').slice(0, 2).join(' ')}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="ag-rank" title="Your rank title">
                      <i>
                        <Crown />
                      </i>
                      {progress.title}
                    </span>
                    <span className="ag-league" style={{['--lg' as string]: tier.ring}} title="Your league">
                      <i>
                        <Award />
                      </i>
                      {tier.label}
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative mt-4 sm:mt-5">
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[0.66rem] font-extrabold tracking-[0.08em] text-mist-500 uppercase sm:text-[0.7rem]">
                  <span>
                    <span className="inline-flex items-center gap-1">
                      Lv {progress.level} <ChevronRight className="size-3 text-nova-300" /> Lv {progress.level + 1}
                    </span>
                  </span>
                  <span className="tabular text-mist-300 normal-case">
                    <b className="text-mist-50">{formatNumber(progress.into_level)}</b> / {formatNumber(progress.needed)} XP
                  </span>
                </div>
                <div className="ag-xp" role="progressbar" aria-valuenow={Math.round(progress.percent)} aria-valuemin={0} aria-valuemax={100} aria-label="XP to next level">
                  <i style={{width: `${Math.max(0, Math.min(100, progress.percent))}%`}} />
                </div>
              </div>
            </div>

            <div className="grid gap-3 p-3 sm:gap-4 sm:p-6">
              {/* ---- resources */}
              <div className="grid grid-cols-4 gap-1.5 sm:gap-2.5">
                {[
                  {label: 'Week XP', value: formatNumber(profile.weekly_xp ?? 0), icon: Zap, color: 'var(--color-nova-400)'},
                  {label: 'Streak', value: `${profile.streak}d`, icon: Flame, color: 'var(--color-flare-400)'},
                  {label: 'Coins', value: formatNumber(profile.coins), icon: Coins, color: 'var(--color-gold-400)'},
                  {label: 'Accuracy', value: `${profile.stats.accuracy}%`, icon: Target, color: 'var(--color-pulse-400)'},
                ].map((r) => {
                  const Icon = r.icon;
                  return (
                    <div key={r.label} className="ag-res" style={{['--res' as string]: r.color}}>
                      <Icon />
                      <b>{r.value}</b>
                      <small>{r.label}</small>
                    </div>
                  );
                })}
              </div>

              {/* ---- season badge you're wearing (resets monthly) */}
              {profile.season ? (
                <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-nova-400/25 bg-nova-500/10 py-2 pr-3 pl-2">
                  <SeasonBadge rank={profile.season.rank} level={profile.season.level} size="xs" showLevel={false} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="ag-title ag-title-gold truncate text-[0.92rem] sm:text-base">{profile.season.rank.label} season</span>
                      <span className="shrink-0 text-[0.66rem] font-extrabold text-mist-400">{profile.season.days_left}d left</span>
                    </p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-300" style={{width: `${Math.max(4, Math.min(100, profile.season.progress?.percent ?? 0))}%`}} />
                    </div>
                    <p className="mt-1 truncate text-[0.62rem] font-bold text-mist-500">
                      {profile.season.next_rank ? <>Next: {profile.season.next_rank.label}</> : 'Top rank reached'} · #{profile.season.board_rank} on the board
                    </p>
                  </div>
                </div>
              ) : null}

              {/* ---- actions */}
              <div className="grid grid-cols-2 gap-2">
                <DailyBonusButton onClaimed={load} />
                <Button variant="outline" onClick={onOpenDuels} icon={<Swords className="size-4" />} block>
                  Duel a friend
                </Button>
              </div>

              {/* ---- lifetime ledger */}
              <div className="ag-ledger">
                {[
                  {label: 'Exams', value: profile.stats.exams_taken, icon: ScrollText, tone: 'text-pulse-300'},
                  {label: 'Duels won', value: profile.stats.duels_won, icon: Swords, tone: 'text-flare-300'},
                  {label: 'Best', value: `${profile.stats.best_percentage.toFixed(0)}%`, icon: Trophy, tone: 'text-gold-300'},
                  {label: 'Badges', value: profile.badges.length, icon: Award, tone: 'text-nova-300'},
                ].map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.label}>
                      <b className="tabular">
                        <Icon className={stat.tone} />
                        {stat.value}
                      </b>
                      <small>{stat.label}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </motion.div>
      </motion.section>

      {/* ------------------------------------------------ continue / up next */}
      {upNext && <ContinueCard quiz={upNext} onStart={() => onStartExam(upNext)} />}

      <Segmented
        value={pane}
        onChange={setPane}
        options={[
          {value: 'exams', label: 'Exams', icon: ScrollText},
          {value: 'practice', label: 'Practice & Boss', icon: Swords},
          {value: 'flashcards', label: 'Flashcards', icon: Layers},
        ]}
      />

      {pane !== 'exams' && (
        <Suspense fallback={<Skeleton className="h-48" />}>
          {pane === 'practice' && <PracticePanel />}
          {pane === 'flashcards' && <FlashcardsPanel />}
        </Suspense>
      )}

      {/* ---------------------------------------------------------- exams */}
      {pane === 'exams' && (
      <section>
        <SectionHeading
          title="Arena exams"
          subtitle="Timed, server-graded, and worth XP. Your best rank earns bonus coins."
          icon={<ScrollText className="size-4" />}
          action={
            <div className="no-scrollbar flex gap-1 overflow-x-auto">
              {[{code: 'all', title: 'All'}, ...courses.map(([code]) => ({code, title: code}))].map((option) => (
                <button
                  key={option.code}
                  onClick={() => setFilter(option.code)}
                  className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[0.72rem] font-bold transition-colors touch-manipulation sm:px-3 sm:text-[0.74rem] ${
                    filter === option.code
                      ? 'border-nova-400/50 bg-nova-500/16 text-nova-200'
                      : 'border-white/10 bg-white/4 text-mist-500 hover:text-mist-200'
                  }`}
                >
                  {option.title}
                </button>
              ))}
            </div>
          }
        />

        {!quizzes ? (
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-52 sm:h-56" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="size-6" />}
            title={filter === 'all' ? 'No exams published yet' : 'Nothing in this filter'}
            detail="Staff can publish exams from the admin console — they appear here instantly."
            action={
              <Button variant="outline" size="sm" onClick={load} icon={<RotateCcw className="size-3.5" />} label="Refresh" />
            }
          />
        ) : (
          <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((quiz, i) => (
              <QuizCard key={quiz.id} quiz={quiz} onStart={onStartExam} index={i} />
            ))}
          </motion.ul>
        )}
      </section>
      )}
    </div>
  );
}

/** Claim-daily-bonus button (streak-aware). */
function DailyBonusButton({onClaimed}: {onClaimed: () => void}) {
  const {setProfile, pushRewards, toast} = useSession();
  const [busy, setBusy] = useState(false);

  const claim = async () => {
    setBusy(true);
    try {
      const result = await api.dailyBonus();
      setProfile(result.profile);
      pushRewards(result.rewards as never, {kind: 'prize', title: 'Daily bonus'});
      toast('success', `${result.season} bonus claimed`, 'Come back tomorrow to extend your streak.');
      onClaimed();
    } catch (error) {
      toast('info', 'Already claimed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button onClick={claim} loading={busy} icon={<Gift className="size-4" />} block>
      <span className="sm:hidden">Daily bonus</span>
      <span className="max-sm:hidden">Claim daily bonus</span>
    </Button>
  );
}

/* ---------------------------------------------------------- continue card */
function useNow(every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(timer);
  }, [every]);
  return now;
}

function leftLabel(seconds: number): string {
  if (seconds <= 0) return "Time's up";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
}

/** "Pick up where you left off" / "Up next" — the one exam worth a tap right now. */
function ContinueCard({quiz, onStart}: {quiz: Quiz; onStart: () => void}) {
  const attempt = quiz.my_attempt?.status === 'in_progress' ? quiz.my_attempt : null;
  const now = useNow(attempt ? 1000 : 60000);
  const accent = quiz.course?.accent || '#8b5cf6';
  const total = Math.max(1, quiz.duration_minutes * 60);
  const secondsLeft = attempt ? Math.max(0, Math.round((Date.parse(attempt.deadline_at) - now) / 1000)) : total;
  const timePct = attempt ? Math.min(100, (secondsLeft / total) * 100) : 100;
  const urgent = attempt && secondsLeft <= 300;

  const stats = [
    {icon: ScrollText, label: 'Questions', value: String(quiz.question_count)},
    {icon: AlarmClock, label: attempt ? 'Time left' : 'Duration', value: attempt ? leftLabel(secondsLeft) : `${quiz.duration_minutes} min`},
  ];

  return (
    <motion.section
      initial={{opacity: 0, y: 10}}
      animate={{opacity: 1, y: 0}}
      transition={{duration: 0.35, ease: 'easeOut'}}
      className="relative overflow-hidden rounded-3xl p-px"
      style={{background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 60%, transparent), rgba(255,255,255,0.08) 45%, rgba(56,189,248,0.45))`}}
    >
      <div className="relative overflow-hidden rounded-[calc(1.5rem-1px)] bg-ink-950/95 p-4 sm:p-5">
        {/* decor: accent glow, soft grid, watermark */}
        <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full opacity-35 blur-3xl" style={{background: accent}} />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-16 size-48 rounded-full bg-sky-500/15 blur-3xl" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{backgroundImage: 'radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)', backgroundSize: '16px 16px', maskImage: 'linear-gradient(90deg, transparent, black 60%)'}}
        />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex min-w-0 flex-1 items-center gap-3.5 sm:gap-4">
            {/* time ring (in progress) or course badge (up next) */}
            <div className="relative shrink-0">
              <ProgressRing value={timePct} size={68} stroke={6} gradientId="ring-brand">
                <span className="grid size-12 place-items-center rounded-full text-white shadow-inner" style={{background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 60%, #a78bfa), color-mix(in srgb, ${accent} 50%, #1e1b4b))`}}>
                  {attempt ? <Play className="size-5 translate-x-px fill-current" /> : <ScrollText className="size-5" />}
                </span>
              </ProgressRing>
              {attempt && <span className="absolute -top-0.5 -right-0.5 size-3.5 animate-ping rounded-full bg-mint-400/70" />}
              {attempt && <span className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full border-2 border-ink-950 bg-mint-400" />}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6rem] font-black tracking-[0.12em] uppercase ${
                    attempt ? 'border-mint-400/35 bg-mint-500/12 text-mint-300' : 'border-nova-400/35 bg-nova-500/12 text-nova-200'
                  }`}
                >
                  <span className={`size-1.5 rounded-full ${attempt ? 'animate-pulse bg-mint-400' : 'bg-nova-300'}`} />
                  {attempt ? 'In progress' : 'Up next'}
                </span>
                {quiz.course && (
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[0.62rem] font-black tracking-wider" style={{color: `color-mix(in srgb, ${accent} 45%, #ede9fe)`}}>
                    {quiz.course.code}
                  </span>
                )}
              </div>
              <h3 className="mt-1.5 line-clamp-2 text-[1.05rem] leading-tight font-black text-mist-50 sm:truncate sm:text-xl">{quiz.title}</h3>
              <p className="mt-0.5 truncate text-[0.76rem] font-medium text-mist-400">
                {attempt ? 'Your answers are saved. Pick up where you left off.' : quiz.course?.title ?? 'Ready when you are.'}
              </p>
            </div>
          </div>

          <div className="flex items-stretch gap-2 sm:shrink-0">
            {stats.map(({icon: Icon, label, value}) => (
              <div
                key={label}
                className={`min-w-0 flex-1 rounded-2xl border px-2.5 py-2 sm:w-[6.5rem] sm:px-3 sm:flex-none ${
                  label === 'Time left' && urgent ? 'border-flare-500/40 bg-flare-500/10' : 'border-white/8 bg-white/[0.04]'
                }`}
              >
                <p className="flex items-center gap-1 truncate text-[0.58rem] font-black tracking-[0.06em] whitespace-nowrap sm:tracking-[0.1em] text-mist-500 uppercase">
                  <Icon className="size-3 shrink-0" /> {label}
                </p>
                <p className={`mt-0.5 text-[0.98rem] font-black tabular ${label === 'Time left' && urgent ? 'text-flare-200' : 'text-mist-50'}`}>{value}</p>
              </div>
            ))}
            <Button variant="primary" size="md" className="shrink-0 self-stretch !h-auto" onClick={onStart} icon={<Play className="size-4 fill-current" />}>
              {attempt ? 'Resume' : 'Start'}
            </Button>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

