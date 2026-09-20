/** Play tab: hero status card, daily bonus, and the exam catalogue. */
import {
  AlarmClock,
  Award,
  CalendarClock,
  ChevronRight,
  CircleDot,
  Coins,
  Flame,
  Gift,
  Layers,
  Lock,
  Megaphone,
  Play,
  RotateCcw,
  ScrollText,
  Swords,
  Target,
  Trophy,
} from 'lucide-react';
import {motion} from 'motion/react';
import {useEffect, useMemo, useState} from 'react';
import {Button, Card, Chip, EmptyState, ProgressRing, SectionHeading, Segmented, Skeleton} from '../components/ui';
import FlashcardsPanel from './FlashcardsPanel';
import PracticePanel from './PracticePanel';
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


  if (!profile) return <Skeleton className="h-64" />;

  const progress = profile.progress;
  const tier = TIER_STYLES[profile.tier] ?? TIER_STYLES.bronze;
  const heroRing = useSize(92, 128);

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
            className="relative overflow-hidden rounded-[1.3rem] border border-flare-500/40 bg-gradient-to-r from-flare-600/22 via-ink-900/80 to-ink-900/80 p-4 shadow-[0_30px_80px_-40px_rgba(244,63,94,0.55)] sm:p-5"
          >
            <div className="pointer-events-none absolute -top-14 -left-10 size-40 rounded-full bg-flare-600/25 blur-3xl" />
            <div className="relative flex flex-wrap items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-flare-500/20 text-flare-300">
                <Megaphone className="size-5 animate-pulse" />
              </span>
              <div className="min-w-0 flex-1">
 <p className="flex items-center gap-2 text-[0.66rem] font-black tracking-[0.22em] text-flare-300">
                  <span className="size-2 animate-ping rounded-full bg-flare-400" />
                  Compulsory exam · live now
                </p>
                <h2 className="mt-0.5 truncate font-display text-[1rem] font-black tracking-tight text-mist-50 sm:text-[1.15rem]">
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
              <Button variant="danger" size="lg" className="shrink-0" onClick={() => onStartExam(quiz)} icon={<Play className="size-4" />}>
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
          <Card className="relative overflow-hidden p-4 sm:p-7">
            <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-nova-600/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-28 -left-10 size-64 rounded-full bg-flare-600/16 blur-3xl" />
            {/* The hero greets you on the home screen; the chosen mascot
                still rides along in the corner as your companion. */}
            <Character
              mood="idle"
              size={104}
              tone="day"
              className="pointer-events-none absolute -right-2 -bottom-3 opacity-95 sm:right-3 sm:-bottom-2"
              label="Arena hero"
            />
            <Mascot
              name={heroMascot}
              mood="idle"
              size={40}
              className="pointer-events-none absolute top-2 right-2.5 opacity-90 sm:top-4 sm:right-5"
            />

            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex items-center gap-4 sm:contents">
              <div className="relative shrink-0">
                <ProgressRing value={progress.percent} size={heroRing} stroke={9}>
                  <span className="flex flex-col items-center">
 <span className="text-[0.54rem] font-black tracking-[0.14em] text-mist-500 sm:text-[0.6rem] sm:tracking-[0.2em]">Level</span>
                    <span className="text-2xl leading-none font-black tabular text-mist-50 sm:text-3xl">{progress.level}</span>
 <span className="mt-0.5 max-w-[4.2rem] truncate text-[0.54rem] font-bold tracking-wide text-nova-300 sm:mt-1 sm:max-w-[5.5rem] sm:text-[0.6rem]">
                      {progress.title}
                    </span>
                  </span>
                </ProgressRing>
              </div>

              <div className="min-w-0 flex-1 pr-12 text-left sm:pr-16">
 <p className="text-[0.64rem] font-black tracking-[0.16em] text-mist-500 sm:text-[0.7rem] sm:tracking-[0.24em]">
                  {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}
                </p>
                <h1 className="mt-0.5 truncate text-xl leading-tight font-black tracking-tight text-mist-50 sm:mt-1 sm:text-[1.75rem]">
                  {profile.name.split(' ').slice(0, 2).join(' ')}
                </h1>
                <p className="mt-1 text-[0.8rem] font-semibold text-mist-400 sm:mt-1.5 sm:text-[0.86rem]">
                  {formatNumber(progress.into_level)} / {formatNumber(progress.needed)} XP to Level {progress.level + 1}
                </p>

                <div className="mt-2.5 flex flex-wrap gap-1.5 sm:mt-4 sm:justify-start sm:gap-2">
                  <Chip className={tier.className} icon={<Award className="size-3.5" />}>
                    {tier.label}
                  </Chip>
                  <Chip className="border-flare-500/28 bg-flare-500/12 text-flare-300" icon={<Flame className="size-3.5" />}>
                    {profile.streak}d streak
                  </Chip>
                  <Chip className="border-gold-500/28 bg-gold-500/12 text-gold-300" icon={<Coins className="size-3.5" />}>
                    {formatNumber(profile.coins)} coins
                  </Chip>
                  <Chip className="border-pulse-500/28 bg-pulse-500/12 text-pulse-300" icon={<Target className="size-3.5" />}>
                    {profile.stats.accuracy}% acc
                  </Chip>
                  {/* the seasonal badge this player is wearing — it resets monthly */}
                  {profile.season ? (
                    <Chip
                      className="border-nova-400/30 bg-nova-500/12 py-0.5 pr-2.5 pl-1 text-nova-200"
                      icon={<SeasonBadge rank={profile.season.rank} level={profile.season.level} size="xs" showLevel={false} />}
                    >
                      {profile.season.rank.label} · {profile.season.days_left}d left
                    </Chip>
                  ) : null}
                </div>
              </div>
              </div>

              <div className="grid gap-2 sm:flex sm:w-auto sm:flex-col">
                <DailyBonusButton onClaimed={load} />
                <Button variant="outline" onClick={onOpenDuels} icon={<Swords className="size-4" />} block>
                  Duel a friend
                </Button>
              </div>
            </div>

            <div className="relative mt-4 grid grid-cols-2 gap-2 sm:mt-6 sm:grid-cols-4 sm:gap-2.5">
              {[
                {label: 'Exams taken', value: profile.stats.exams_taken, icon: ScrollText, tone: 'text-pulse-300'},
                {label: 'Duels won', value: profile.stats.duels_won, icon: Swords, tone: 'text-flare-300'},
                {label: 'Best score', value: `${profile.stats.best_percentage.toFixed(0)}%`, icon: Trophy, tone: 'text-gold-300'},
                {label: 'Badges', value: profile.badges.length, icon: Award, tone: 'text-nova-300'},
              ].map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5 sm:px-3.5 sm:py-3">
                    <Icon className={`size-4 ${stat.tone}`} />
                    <p className="mt-1 text-base leading-none font-black tabular text-mist-50 sm:mt-1.5 sm:text-lg">{stat.value}</p>
 <p className="mt-1 truncate text-[0.58rem] font-bold tracking-[0.08em] text-mist-500 sm:text-[0.66rem] sm:tracking-[0.14em]">
                      {stat.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.div>
      </motion.section>

      {/* ------------------------------------------- continue mission module */}
      {visible.length > 0 && (
        <Card className="relative overflow-hidden border border-nova-500/30 bg-gradient-to-r from-nova-950/30 via-ink-900/80 to-ink-900/80 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-nova-400 animate-pulse" />
 <span className="text-[0.62rem] font-black tracking-widest text-nova-400">
                  CONTINUE MISSION · ACTIVE SECTOR
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-black text-mist-50 truncate mt-1">
                {(visible.find((q) => q.my_attempt?.status === 'in_progress') ?? visible[0]).title}
              </h3>
              <p className="text-[0.76rem] font-medium text-mist-400 mt-0.5">
                {(visible.find((q) => q.my_attempt?.status === 'in_progress') ?? visible[0]).course?.title ?? 'Tactical Simulation'} · {(visible.find((q) => q.my_attempt?.status === 'in_progress') ?? visible[0]).question_count} objectives · {(visible.find((q) => q.my_attempt?.status === 'in_progress') ?? visible[0]).duration_minutes} min allotted
              </p>
            </div>
            <Button
              variant="primary"
              size="md"
              className="shrink-0"
              onClick={() => onStartExam(visible.find((q) => q.my_attempt?.status === 'in_progress') ?? visible[0])}
              icon={<Play className="size-4" />}
            >
              {(visible.find((q) => q.my_attempt?.status === 'in_progress') ?? visible[0]).my_attempt?.status === 'in_progress' ? 'Resume Mission' : 'Start Mission'}
            </Button>
          </div>
        </Card>
      )}

      <Segmented
        value={pane}
        onChange={setPane}
        options={[
          {value: 'exams', label: 'Exams', icon: ScrollText},
          {value: 'practice', label: 'Practice & Boss', icon: Swords},
          {value: 'flashcards', label: 'Flashcards', icon: Layers},
        ]}
      />

      {pane === 'practice' && <PracticePanel />}
      {pane === 'flashcards' && <FlashcardsPanel />}

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
              <Button variant="outline" size="sm" onClick={load} icon={<RotateCcw className="size-3.5" />}>
                Refresh
              </Button>
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
      Claim daily bonus
    </Button>
  );
}

