/** Exam result slip: score, grade, rank, rewards, and a printable review. */
import {
  ArrowLeft,
  Award,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Coins,
  Download,
  Flame,
  Medal,
  Printer,
  ScrollText,
  Target,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useState} from 'react';
import Character from '../components/Character';
import {Button, Card, Chip, ProgressRing, SectionHeading, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {sfx} from '../lib/sfx';
import {celebrate} from '../lib/confetti';
import {formatDate, formatNumber, GRADE_STYLES} from '../lib/format';
import {staggerContainer, staggerItem} from '../lib/motion';
import {useSize} from '../lib/responsive';
import {useSession} from '../store/session';
import type {AttemptState, OptionKey} from '../lib/types';

const LETTERS: OptionKey[] = ['A', 'B', 'C', 'D'];

export default function Result({
  attemptId,
  onExit,
  onLeaderboard,
}: {
  attemptId: number;
  onExit: () => void;
  onLeaderboard: () => void;
}) {
  const {profile, toast, refreshProfile} = useSession();
  const [state, setState] = useState<AttemptState | null>(null);
  const [loading, setLoading] = useState(true);
  const [openQuestion, setOpenQuestion] = useState<number | null>(null);
  const [celebrated, setCelebrated] = useState(false);
  const ringSize = useSize(104, 132);

  useEffect(() => {
    let alive = true;
    api
      .review(attemptId)
      .then((data) => {
        if (!alive) return;
        setState(data);
        setLoading(false);
        refreshProfile();
        if (!celebrated) {
          sfx.play(data.percentage >= 75 ? 'win' : data.percentage >= 45 ? 'correct' : 'lose');
        }
        if (!celebrated && data.percentage >= 45) {
          celebrate({big: data.percentage >= 75});
          setCelebrated(true);
        }
      })
      .catch((error: Error) => {
        if (!alive) return;
        toast('error', 'Could not load this result', error.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  const summary = useMemo(() => {
    if (!state) return null;
    const review = state.review ?? [];
    return {
      correct: review.filter((row) => row.is_correct).length,
      wrong: review.filter((row) => row.selected && !row.is_correct).length,
      blank: review.filter((row) => !row.selected).length,
      total: review.length || state.quiz.question_count,
    };
  }, [state]);

  if (loading || !state || !summary) {
    return (
      <div className="w-full space-y-4 py-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const passed = state.percentage >= 45;
  const gradeClass = GRADE_STYLES[state.grade] ?? 'border-white/14 bg-white/6 text-mist-200';

  return (
    <div className="w-full py-2">
      <div className="print-hide mb-3 grid grid-cols-3 gap-2 sm:mb-4 sm:flex sm:flex-wrap sm:items-center">
        <Button variant="ghost" size="sm" className="px-2 sm:px-3.5" onClick={onExit} icon={<ArrowLeft className="size-4" />}>
          <span className="sm:hidden">Home</span>
          <span className="hidden sm:inline">Dashboard</span>
        </Button>
        <Button variant="outline" size="sm" className="px-2 sm:px-3.5" onClick={onLeaderboard} icon={<Trophy className="size-4" />}>
          <span className="sm:hidden">Ranks</span>
          <span className="hidden sm:inline">Leaderboard</span>
        </Button>
        <Button variant="outline" size="sm" className="px-2 sm:ml-auto sm:px-3.5" onClick={() => window.print()} icon={<Printer className="size-4" />}>
          <span className="sm:hidden">Print</span>
          <span className="hidden sm:inline">Print slip</span>
        </Button>
      </div>

      {/* -------------------------------------------------------- slip */}
      <Card className="print-slip relative overflow-hidden p-4 sm:p-8">
        <div className="brand-gradient absolute inset-x-0 top-0 h-1.5 print-hide" />
        <div className="pointer-events-none absolute -top-28 -right-20 size-72 rounded-full bg-nova-600/18 blur-3xl print-hide" />
        {/* The hero wears the exam's outcome — celebrating a pass, taking a
            quiet bow otherwise. It never computes the grade itself. */}
        <Character
          mood={passed ? 'celebrate' : 'sad'}
          size={96}
          tone="day"
          className="pointer-events-none absolute top-1 right-1 opacity-95 print-hide sm:top-4 sm:right-6"
          label="Arena hero"
        />

        <div className="relative flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className="print-hide">
            <ProgressRing value={state.percentage} size={ringSize} stroke={10}>
              <span className="flex flex-col items-center">
                <span className="text-2xl leading-none font-black tabular text-mist-50 sm:text-3xl">{state.percentage.toFixed(0)}%</span>
 <span className="mt-1 text-[0.62rem] font-bold tracking-[0.18em] text-mist-500">Score</span>
              </span>
            </ProgressRing>
          </div>

          <div className="min-w-0 flex-1 text-center sm:text-left">
 <p className="text-[0.62rem] font-black tracking-[0.16em] text-mist-500 sm:text-[0.68rem] sm:tracking-[0.24em]">
              {state.quiz.course?.code ?? 'Arena'} · Result slip
            </p>
            <h1 className="mt-1 text-xl leading-tight font-black tracking-tight text-mist-50 sm:mt-1.5 sm:text-3xl">{state.quiz.title}</h1>
            <p className="mt-1 text-[0.8rem] font-semibold text-mist-400 sm:text-[0.84rem]">
              {profile?.name} · {formatDate(state.submitted_at, true)}
            </p>

            <div className="mt-3 flex flex-wrap justify-center gap-1.5 sm:mt-4 sm:justify-start sm:gap-2">
              <Chip className={`px-2.5 py-1 text-[0.76rem] sm:px-3 sm:py-1.5 sm:text-[0.82rem] ${gradeClass}`}>
                <Award className="size-3.5" /> Grade {state.grade}
              </Chip>
              {state.rank_label && (
                <Chip className="border-gold-500/30 bg-gold-500/12 px-2.5 py-1 text-[0.76rem] text-gold-300 sm:px-3 sm:py-1.5 sm:text-[0.82rem]">
                  <Medal className="size-3.5" /> {state.rank_label}
                </Chip>
              )}
              <Chip className="border-mint-500/30 bg-mint-500/12 px-2.5 py-1 text-[0.76rem] text-mint-300 sm:px-3 sm:py-1.5 sm:text-[0.82rem]">
                {passed ? <CheckCircle2 className="size-3.5" /> : <X className="size-3.5" />} {passed ? 'Passed' : 'Below pass mark'}
              </Chip>
              <Chip className="border-white/12 bg-white/6 px-2.5 py-1 text-[0.76rem] text-mist-300 sm:px-3 sm:py-1.5 sm:text-[0.82rem]">
                <ScrollText className="size-3.5" /> {state.correct_count}/{summary.total} correct
              </Chip>
            </div>

            <p className="mt-3 text-[0.82rem] font-medium leading-relaxed text-mist-400 sm:mt-4 sm:text-[0.86rem]">
              {state.score} of {summary.total} points · submitted{' '}
              {state.submission_type === 'auto_timer' ? 'automatically when time ran out' : 'by you'} ·{' '}
              {state.quiz.course?.title ?? 'Arena exam'}
            </p>
          </div>
        </div>

        <div className="relative mt-4 grid grid-cols-2 gap-2 sm:mt-7 sm:grid-cols-4 sm:gap-2.5">
          {[
            {label: 'Correct', value: summary.correct, icon: CheckCircle2, tone: 'text-mint-300'},
            {label: 'Wrong', value: summary.wrong, icon: X, tone: 'text-flare-300'},
            {label: 'Skipped', value: summary.blank, icon: ScrollText, tone: 'text-mist-400'},
            {label: 'XP earned', value: `+${formatNumber(state.xp_awarded)}`, icon: Zap, tone: 'text-nova-300'},
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5 sm:px-4 sm:py-3.5">
                <Icon className={`size-4 ${stat.tone}`} />
                <p className="mt-1 text-lg leading-none font-black tabular text-mist-50 sm:mt-1.5 sm:text-xl">{stat.value}</p>
 <p className="mt-1 truncate text-[0.58rem] font-bold tracking-[0.08em] text-mist-500 sm:text-[0.62rem] sm:tracking-[0.14em]">
                  {stat.label}
                </p>
              </div>
            );
          })}
        </div>

        <div className="relative mt-2 grid grid-cols-2 gap-2 sm:mt-3 sm:grid-cols-4 sm:gap-2.5">
          {[
            {label: 'Coins earned', value: `+${formatNumber(state.coins_awarded)}`, icon: Coins, tone: 'text-gold-300'},
            {label: 'Duration', value: `${state.quiz.duration_minutes} min`, icon: CalendarDays, tone: 'text-pulse-300'},
            {label: 'Accuracy', value: `${summary.total ? Math.round((summary.correct / summary.total) * 100) : 0}%`, icon: Target, tone: 'text-mint-300'},
            {label: 'Streak', value: `${profile?.streak ?? 0}d`, icon: Flame, tone: 'text-flare-300'},
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2.5 sm:px-4 sm:py-3.5">
                <Icon className={`size-4 ${stat.tone}`} />
                <p className="mt-1 text-lg leading-none font-black tabular text-mist-50 sm:mt-1.5 sm:text-xl">{stat.value}</p>
 <p className="mt-1 truncate text-[0.58rem] font-bold tracking-[0.08em] text-mist-500 sm:text-[0.62rem] sm:tracking-[0.14em]">
                  {stat.label}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      {state.leaderboard && state.leaderboard.length > 0 && (
        <section className="print-hide mt-5 sm:mt-6">
          <SectionHeading title="This exam's leaderboard" subtitle="Fastest, highest scorers first." icon={<Trophy className="size-4" />} />
          <Card className="divide-y divide-white/6">
            {state.leaderboard.slice(0, 8).map((row) => (
              <div key={row.student.id} className="flex items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/6 text-[0.8rem] font-black tabular text-mist-300">
                  {row.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.86rem] font-bold text-mist-100">
                  {row.student.name}
 {row.student.id === profile?.id && <span className="ml-2 text-[0.66rem] font-black text-nova-300">You</span>}
                </span>
                <span className="shrink-0 text-[0.8rem] font-black tabular text-mist-200">{row.result.percentage.toFixed(0)}%</span>
                <span className="hidden w-16 shrink-0 text-right text-[0.76rem] font-bold text-mist-500 sm:block">{row.result.score} pts</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {/* ------------------------------------------------------ review */}
      <section className="mt-6 sm:mt-8">
        <SectionHeading
          title="Answer review"
          subtitle="Every question with the correct answer and the reasoning."
          icon={<ScrollText className="size-4" />}
          action={
            <Button size="sm" variant="outline" onClick={() => window.print()} icon={<Download className="size-3.5" />}>
              Save as PDF
            </Button>
          }
        />

        <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="space-y-2">
          {state.review.map((row, position) => {
            const open = openQuestion === row.question_id;
            return (
              <motion.li key={row.question_id} variants={staggerItem}>
                <Card className="overflow-hidden">
                  <button
                    onClick={() => setOpenQuestion(open ? null : row.question_id)}
                    className="flex w-full items-start gap-2.5 px-3 py-3 text-left touch-manipulation sm:gap-3 sm:px-4 sm:py-3.5"
                  >
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-xl ${
                        row.is_correct ? 'bg-mint-500/16 text-mint-300' : row.selected ? 'bg-flare-500/16 text-flare-300' : 'bg-white/6 text-mist-400'
                      }`}
                    >
                      {row.is_correct ? <CheckCircle2 className="size-4" /> : <X className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
 <span className="block text-[0.7rem] font-black tracking-[0.16em] text-mist-600">
                        Question {position + 1}
                      </span>
                      <span className="mt-0.5 block text-[0.9rem] font-bold text-mist-100">{row.text}</span>
                    </span>
                    <ChevronDown className={`mt-1 size-4 shrink-0 text-mist-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{height: 0, opacity: 0}}
                        animate={{height: 'auto', opacity: 1}}
                        exit={{height: 0, opacity: 0}}
                        transition={{duration: 0.26, ease: [0.22, 1, 0.36, 1]}}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-white/8 px-3 py-3 sm:px-4 sm:py-4">
                          <ul className="space-y-1.5">
                            {LETTERS.filter((letter) => row.options[letter]).map((letter) => {
                              // Compare display letters — after option shuffling
                              // the canonical key is no longer the shown letter.
                              const answerLetter = row.correct_label ?? row.correct;
                              const chosenLetter = row.selected_label ?? row.selected;
                              const isCorrect = answerLetter === letter;
                              const chosen = chosenLetter === letter && !isCorrect;
                              return (
                                <li
                                  key={letter}
                                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[0.84rem] font-semibold sm:gap-3 sm:px-3.5 sm:py-2.5 sm:text-[0.86rem] ${
                                    isCorrect
                                      ? 'border-mint-500/45 bg-mint-500/12 text-mint-200'
                                      : chosen
                                        ? 'border-flare-500/45 bg-flare-500/12 text-flare-200'
                                        : 'border-white/8 bg-white/[0.02] text-mist-400'
                                  }`}
                                >
                                  <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-white/8 text-[0.72rem] font-black">
                                    {letter}
                                  </span>
                                  <span className="min-w-0 flex-1">{row.options[letter]}</span>
                                  {isCorrect && <CheckCircle2 className="size-4 shrink-0 text-mint-400" />}
                                  {chosen && !isCorrect && <X className="size-4 shrink-0 text-flare-400" />}
                                </li>
                              );
                            })}
                          </ul>
                          {row.explanation && (
                            <p className="mt-3 rounded-xl border border-pulse-500/22 bg-pulse-500/8 px-3.5 py-3 text-[0.82rem] font-medium leading-relaxed text-mist-200">
                              <span className="font-black text-pulse-300">Why: </span>
                              {row.explanation}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              </motion.li>
            );
          })}
        </motion.ul>
      </section>

      <div className="print-hide mt-6 grid gap-2 sm:mt-8 sm:flex sm:flex-wrap sm:justify-center">
        <Button className="w-full sm:w-auto" onClick={onLeaderboard} icon={<Trophy className="size-4" />}>
          See where you rank
        </Button>
        <Button className="w-full sm:w-auto" variant="outline" onClick={onExit} icon={<ArrowLeft className="size-4" />}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
