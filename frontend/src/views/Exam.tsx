/**
 * Exam engine: server-authoritative timer, autosave, flags, keyboard control,
 * question navigator and a guarded submit flow.
 */
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Flag,
  Grid3x3,
  MoveVertical,
  ScrollText,
  Send,
  X,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Character from '../components/Character';
import {AnswerFeedback, AnswerTile, BossBar} from '../components/GameQuestion';
import {Button, Card, Chip, ProgressBar} from '../components/ui';
import {api, ApiError} from '../lib/api';
import {HAPTICS} from '../lib/haptics';
import {DifficultyChip, QuestionCard} from '../components/QuestionCard';
import {sfx} from '../lib/sfx';
import {formatClock} from '../lib/format';
import {EASE} from '../lib/motion';
import {useSession} from '../store/session';
import type {AttemptState, OptionKey, QuestionPublic, Quiz} from '../lib/types';

const LETTERS: OptionKey[] = ['A', 'B', 'C', 'D'];

/**
 * The letter the answer sits on *for this attempt*. With option shuffling the
 * canonical key ("B") is not necessarily the letter the player saw, so reveal
 * comparisons must use ``correct_label`` when the server sends it.
 */
function correctLabel(question: QuestionPublic): OptionKey | null {
  return (question.correct_label ?? question.correct ?? null) as OptionKey | null;
}

interface AnswerState {
  selected: OptionKey | null;
  flagged: boolean;
  seconds: number;
  dirty: boolean;
}

export default function Exam({
  quiz,
  attemptId,
  reviewOnly = false,
  onFinished,
  onExit,
  onAttempt,
}: {
  quiz?: Quiz;
  attemptId?: number;
  reviewOnly?: boolean;
  /** Fires once the server has opened the attempt, so the address bar can name it. */
  onAttempt?: (attemptId: number) => void;
  onFinished: (attemptId: number) => void;
  onExit: () => void;
}) {
  const {toast, profile} = useSession();
  const [state, setState] = useState<AttemptState | null>(null);
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [navFilter, setNavFilter] = useState<'all' | 'todo' | 'flagged'>('all');
  const [swipeHint, setSwipeHint] = useState(true);
  const touchRef = useRef<{x: number; y: number; t: number} | null>(null);
  useEffect(() => {
    if (!swipeHint) return undefined;
    const timer = window.setTimeout(() => setSwipeHint(false), 9000);
    return () => window.clearTimeout(timer);
  }, [swipeHint]);
  const [direction, setDirection] = useState(1);

  const startedRef = useRef<number>(Date.now());
  /* Which attempt this component already has open. Naming the attempt in the
     URL re-renders with a new `attemptId` prop, and that must not throw away
     the paper the player is working on. */
  const loadedId = useRef<number | null>(null);
  const timersRef = useRef<Record<number, number>>({});
  const submittedRef = useRef(false);

  /* ------------------------------------------------------------- load */
  useEffect(() => {
    if (attemptId && loadedId.current === attemptId) return undefined;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const loaded = reviewOnly && attemptId
          ? await api.review(attemptId)
          : attemptId
            ? await api.attempt(attemptId)
            : await api.startExam(quiz!.id);
        if (!alive) return;
        loadedId.current = loaded.id;
        setState(loaded);
        onAttempt?.(loaded.id);
        const map: Record<number, AnswerState> = {};
        loaded.answers.forEach((row) => {
          map[row.question_id] = {
            selected: row.selected,
            flagged: row.flagged,
            seconds: row.seconds_spent ?? 0,
            dirty: false,
          };
        });
        loaded.questions.forEach((question) => {
          if (!map[question.id]) map[question.id] = {selected: null, flagged: false, seconds: 0, dirty: false};
        });
        setAnswers(map);
        setRemaining(Math.max(0, Math.round(loaded.time_remaining)));
        const firstUnanswered = loaded.questions.findIndex((q) => !map[q.id]?.selected);
        setIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
      } catch (err) {
        if (!alive) return;
        const message = err instanceof ApiError ? err.message : 'Could not open this exam.';
        setError(message);
        if (err instanceof ApiError && err.status === 409) {
          toast('info', 'Exam already submitted', message);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, quiz?.id, reviewOnly, onAttempt]);

  /* ------------------------------------------------------------ timer */
  const submit = useCallback(
    async (type: 'early' | 'auto_timer') => {
      if (!state || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        await api.submitExam(state.id, type);
        onFinished(state.id);
      } catch (err) {
        submittedRef.current = false;
        toast('error', 'Submission failed', (err as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [state, onFinished, toast],
  );

  useEffect(() => {
    if (!state || reviewOnly || state.status !== 'in_progress') return undefined;
    const id = window.setInterval(() => {
      setRemaining((current) => {
        const next = current - 1;
        if (next <= 0) {
          window.clearInterval(id);
          void submit('auto_timer');
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [state, reviewOnly, submit]);

  /* --------------------------------------------- per-question seconds */
  useEffect(() => {
    if (reviewOnly || !state) return undefined;
    const question = state.questions[index];
    if (!question) return undefined;
    const id = window.setInterval(() => {
      setAnswers((current) => {
        const row = current[question.id] ?? {selected: null, flagged: false, seconds: 0, dirty: false};
        return {...current, [question.id]: {...row, seconds: row.seconds + 1}};
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [index, state, reviewOnly]);

  /* --------------------------------------------------------- autosave */
  const persist = useCallback(
    (questionId: number, patch: Partial<AnswerState>) => {
      if (!state || reviewOnly) return;
      setAnswers((current) => {
        const row = current[questionId] ?? {selected: null, flagged: false, seconds: 0, dirty: false};
        return {...current, [questionId]: {...row, ...patch, dirty: true}};
      });

      window.clearTimeout(timersRef.current[questionId]);
      timersRef.current[questionId] = window.setTimeout(async () => {
        try {
          const snapshot = answersRef.current[questionId];
          if (!snapshot) return;
          await api.saveAnswer(state.id, {
            question_id: questionId,
            selected: snapshot.selected,
            flagged: snapshot.flagged,
            seconds_spent: snapshot.seconds,
          });
          setAnswers((current) => ({...current, [questionId]: {...current[questionId], dirty: false}}));
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            toast('info', 'Time is up', 'Your exam was submitted automatically.');
            void submit('auto_timer');
          }
        }
      }, 420);
    },
    [state, reviewOnly, submit, toast],
  );

  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const pick = (question: QuestionPublic, key: OptionKey) => {
    if (reviewOnly || state?.status !== 'in_progress') return;
    const row = answers[question.id];
    sfx.play('tap');
    // Selecting is sticky: re-clicking the same option never blanks an answer.
    persist(question.id, {
      selected: key,
      seconds: Math.round((Date.now() - startedRef.current) / 1000) + (row?.seconds ?? 0),
    });
    startedRef.current = Date.now();
  };

  const toggleFlag = (question: QuestionPublic) => {
    if (reviewOnly) return;
    HAPTICS.tap();
    persist(question.id, {flagged: !answers[question.id]?.flagged});
  };

  const go = useCallback(
    (next: number) => {
      if (!state) return;
      const clamped = Math.max(0, Math.min(state.questions.length - 1, next));
      setDirection(clamped > index ? 1 : -1);
      setIndex(clamped);
      startedRef.current = Date.now();
    },
    [state, index],
  );

  /* -------------------------------------------------------- shortcuts */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!state || confirmOpen) return;
      const target = event.target as HTMLElement;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      const question = state.questions[index];
      if (!question) return;

      if (['a', 'A', '1'].includes(event.key)) pick(question, 'A');
      else if (['b', 'B', '2'].includes(event.key)) pick(question, 'B');
      else if (['c', 'C', '3'].includes(event.key)) pick(question, 'C');
      else if (['d', 'D', '4'].includes(event.key)) pick(question, 'D');
      else if (event.key === 'ArrowRight') go(index + 1);
      else if (event.key === 'ArrowLeft') go(index - 1);
      else if (['f', 'F'].includes(event.key)) toggleFlag(question);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* --------------------------------------------------------- derived */
  const answeredCount = useMemo(() => Object.values(answers).filter((row) => row.selected).length, [answers]);
  // Hits landed so far, straight from the server's attempt state. Guarded: the
  // component renders once before the attempt has loaded.
  const correctCount = Number((state as {correct_count?: number} | null)?.correct_count ?? 0);

  const flaggedCount = useMemo(() => Object.values(answers).filter((row) => row.flagged).length, [answers]);
  const total = state?.questions.length ?? 0;
  const current = state?.questions[index];
  const currentAnswer = current ? answers[current.id] : undefined;
  const percentAnswered = total ? (answeredCount / total) * 100 : 0;
  const urgent = remaining <= 60;
  const critical = remaining <= 15;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4">
        <motion.div
          animate={{rotate: 360}}
          transition={{repeat: Infinity, duration: 1.4, ease: 'linear'}}
          className="size-14 rounded-2xl brand-gradient"
        />
        <p className="text-[0.86rem] font-bold text-mist-400">Loading the arena…</p>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="w-full py-16">
        <Card className="p-7 text-center">
          <AlertTriangle className="mx-auto size-10 text-flare-400" />
          <h2 className="mt-4 text-xl font-black text-mist-50">This exam is not available</h2>
          <p className="mt-2 text-[0.88rem] font-medium text-mist-400">{error}</p>
          <Button className="mt-6" onClick={onExit} icon={<ArrowLeft className="size-4" />}>
            Back to dashboard
          </Button>
        </Card>
      </div>
    );
  }

  const finished = state.status !== 'in_progress' || reviewOnly;

  /* --------------------------------------------- swipe to move (phones) */
  const onSwipeStart = (event: React.TouchEvent) => {
    touchRef.current = {x: event.touches[0].clientX, y: event.touches[0].clientY, t: Date.now()};
  };
  const onSwipeEnd = (event: React.TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start || !state || reviewOnly || finished || navigatorOpen || confirmOpen) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    const fast = Date.now() - start.t < 600;
    if (!fast || Math.abs(dy) < 72 || Math.abs(dy) < Math.abs(dx) * 1.35) return;
    setSwipeHint(false);
    sfx.play('whoosh');
    if (dy > 0) {
      // swipe down -> next question (on the last one it offers submit)
      if (index < state.questions.length - 1) go(index + 1);
      else if (!finished) setConfirmOpen(true);
    } else if (index > 0) {
      go(index - 1);
    }
  };



  /* The hero wears the same server-driven state the mascot used to: it cheers a
     hit, deflates on a miss, thinks when the clock is tight. It never decides
     the verdict itself. */
  const heroMood: 'idle' | 'cheer' | 'sad' | 'think' =
    finished || reviewOnly
      ? current && currentAnswer?.selected
        ? current.correct === currentAnswer.selected
          ? 'cheer'
          : 'sad'
        : 'idle'
      : remaining > 0 && remaining <= 30
        ? 'think'
        : 'idle';


  /* ------------------------------------------- navigator (shared markup) */
  const navigatorButtons = (columns: string, filter: 'all' | 'todo' | 'flagged' = 'all') => (
    <div className={`grid gap-1.5 ${columns}`}>
      {state.questions
        .map((question, position) => ({question, position}))
        .filter(({question}) => {
          const row = answers[question.id];
          if (filter === 'todo') return !row?.selected;
          if (filter === 'flagged') return Boolean(row?.flagged);
          return true;
        })
        .map(({question, position}) => {
        const row = answers[question.id];
        const isCurrent = position === index;
        return (
          <button
            key={question.id}
            onClick={() => {
              go(position);
              setNavigatorOpen(false);
            }}
            aria-label={`Question ${position + 1}${row?.selected ? ', answered' : ', blank'}${row?.flagged ? ', flagged' : ''}`}
            aria-current={isCurrent ? 'true' : undefined}
            className={`relative grid aspect-square w-full place-items-center rounded-xl text-[0.74rem] font-black transition-all active:scale-95 ${
              isCurrent
                ? 'brand-gradient text-white scale-105'
                : row?.selected
                  ? 'bg-mint-500/20 text-mint-200 hover:bg-mint-500/30'
                  : 'bg-white/6 text-mist-500 hover:bg-white/12'
            }`}
          >
            {position + 1}
            {row?.flagged && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-gold-400" />}
          </button>
        );
      })}
    </div>
  );

  const legend = (
    <div className="mt-3.5 grid grid-cols-3 gap-1.5 border-t border-white/8 pt-3 text-[0.7rem] font-semibold text-mist-500 sm:mt-4 sm:block sm:space-y-1.5 sm:text-[0.74rem]">
      {[
        {color: 'bg-mint-500/40', label: 'Answered', count: answeredCount},
        {color: 'bg-white/15', label: 'Blank', count: total - answeredCount},
        {color: 'bg-gold-400', label: 'Flagged', count: flaggedCount},
      ].map((row) => (
        <p key={row.label} className="flex items-center gap-1.5 sm:gap-2">
          <span className={`size-2.5 shrink-0 rounded-full ${row.color}`} />
          <span className="min-w-0 truncate">{row.label}</span>
          <span className="ml-auto font-black tabular text-mist-200">{row.count}</span>
        </p>
      ))}
    </div>
  );

  return (
    <div className="w-full pb-20 lg:pb-0">
      {/* ------------------------------------------------------- header */}
      <div className="mb-3 flex items-center gap-2 sm:mb-4 sm:gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[0.95rem] font-black tracking-tight text-mist-50 sm:text-lg">{state.quiz.title}</h1>
          <p className="truncate text-[0.72rem] font-semibold text-mist-500 sm:text-[0.76rem]">
            {state.quiz.course?.code} · {state.quiz.course?.title}
          </p>
        </div>

        {finished ? (
          <Chip className="border-mint-500/30 bg-mint-500/12 text-mint-300" icon={<CheckCircle2 className="size-3.5" />}>
            Submitted · {state.grade}
          </Chip>
        ) : (
          <motion.div
            animate={critical ? {scale: [1, 1.06, 1]} : {}}
            transition={{repeat: critical ? Infinity : 0, duration: 0.9}}
            className={`flex shrink-0 items-center gap-1.5 rounded-2xl border px-3 py-1.5 tabular sm:gap-2 sm:px-3.5 sm:py-2 ${
              critical
                ? 'border-flare-500/50 bg-flare-500/16 text-flare-300'
                : urgent
                  ? 'border-gold-500/40 bg-gold-500/12 text-gold-300'
                  : 'border-white/12 bg-white/6 text-mist-200'
            }`}
          >
            <Clock className="size-3.5 sm:size-4" />
            <span className="text-[0.95rem] font-black sm:text-[1.05rem]">{formatClock(remaining)}</span>
 <span className="hidden text-[0.68rem] font-bold tracking-wider opacity-70 sm:inline">left</span>
          </motion.div>
        )}
      </div>

      <div className="mb-3.5 sm:mb-5">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[0.7rem] font-bold text-mist-500 sm:text-[0.74rem]">
          <span className="tabular">
            Question {index + 1} of {total}
          </span>
          <span className="flex items-center gap-2 sm:gap-3">
            <span className="text-mint-300">{answeredCount} answered</span>
            {flaggedCount > 0 && <span className="text-gold-300">{flaggedCount} flagged</span>}
          </span>
        </div>
        <ProgressBar value={percentAnswered} className="h-1.5 sm:h-2" />
      </div>

      {/* The paper is the boss: every correct answer takes a bite out of it. */}
      <BossBar
        className="mb-3 sm:mb-4"
        name={state.quiz.title}
        correct={correctCount}
        total={total}
        answered={answeredCount}
      />

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[1fr_16rem]">
        {/* ------------------------------------------------- question */}
        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            {current && (
              <motion.div
                key={current.id}
                initial={{opacity: 0, x: direction * 24}}
                animate={{opacity: 1, x: 0}}
                exit={{opacity: 0, x: direction * -24}}
                transition={{duration: 0.24, ease: EASE}}
              >
                <div onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
                <QuestionCard
                  number={index + 1}
                  className="min-w-0"
                  chips={
                    <>
                      <Chip className="border-nova-500/28 bg-nova-500/12 text-nova-300">
                        Question {current.position || index + 1}
                      </Chip>
                      <Chip>{current.points} pts</Chip>
                      <DifficultyChip level={current.difficulty} />
                      {finished && currentAnswer?.selected && (
                        <Chip
                          className={
                            correctLabel(current) === currentAnswer.selected
                              ? 'border-mint-500/32 bg-mint-500/14 text-mint-300'
                              : 'border-flare-500/32 bg-flare-500/14 text-flare-300'
                          }
                          icon={correctLabel(current) === currentAnswer.selected ? <Check className="size-3" /> : <X className="size-3" />}
                        >
                          {correctLabel(current) === currentAnswer.selected ? 'Correct' : 'Wrong'}
                        </Chip>
                      )}
                    </>
                  }
                  aside={
                    <>
                      <Character mood={heroMood} size={38} className="-my-1 hidden sm:inline-block" label="Arena hero" />
                      {!finished && (
                        <Button
                          size="sm"
                          variant={currentAnswer?.flagged ? 'gold' : 'outline'}
                          onClick={() => toggleFlag(current)}
                          icon={<Flag className="size-3.5" />}
                        >
                          {currentAnswer?.flagged ? 'Flagged' : 'Flag'}
                        </Button>
                      )}
                    </>
                  }
                  text={current.text}
                >
                  <ul className="mt-3.5 space-y-2 sm:mt-5 sm:space-y-2.5">
                    {LETTERS.filter((letter) => current.options[letter]).map((letter, position) => {
                      const selected = currentAnswer?.selected === letter;
                      const isCorrect = correctLabel(current) === letter;
                      const reveal = finished;
                      const state: 'idle' | 'picked' | 'correct' | 'wrong' | 'muted' = !reveal
                        ? selected
                          ? 'picked'
                          : 'idle'
                        : isCorrect
                          ? 'correct'
                          : selected
                            ? 'wrong'
                            : 'muted';
                      return (
                        <li key={letter}>
                          <AnswerTile
                            letter={letter}
                            text={current.options[letter]}
                            state={state}
                            disabled={finished}
                            hint={finished ? undefined : position + 1}
                            onPick={() => pick(current, letter)}
                          />
                        </li>
                      );
                    })}
                  </ul>

                  {/* The verdict, the right letter and the way to understand it. */}
                  {finished && currentAnswer?.selected && (
                    <div className="mt-3.5">
                      <AnswerFeedback
                        kind="boss"
                        cosmetics={profile?.cosmetics}
                        correct={correctLabel(current) === currentAnswer.selected}
                        chosen={currentAnswer.selected}
                        answer={correctLabel(current)}
                        note={current.explanation || undefined}
                      />
                    </div>
                  )}

                </QuestionCard>

                {!reviewOnly && !finished && swipeHint && (
                  <p className="mt-2 flex items-center justify-center gap-1.5 text-[0.66rem] font-bold text-mist-600 sm:hidden">
                    <MoveVertical className="size-3" />
                    Swipe down for next · up for previous
                  </p>
                )}

                {/* ----------------------------------------------- nav */}
                <div className="mt-3 hidden items-center gap-2 sm:mt-4 lg:flex">
                  <Button variant="outline" onClick={() => go(index - 1)} disabled={index === 0} icon={<ArrowLeft className="size-4" />}>
                    Previous
                  </Button>
                  {index < total - 1 ? (
                    <Button className="flex-1" onClick={() => go(index + 1)}>
                      Next question <ArrowRight className="size-4" />
                    </Button>
                  ) : (
                    !finished && (
                      <Button className="flex-1" variant="mint" onClick={() => setConfirmOpen(true)} icon={<Send className="size-4" />}>
                        Finish & submit
                      </Button>
                    )
                  )}
                  {index === total - 1 && !finished && (
                    <Button variant="gold" onClick={() => setConfirmOpen(true)} icon={<Send className="size-4" />}>
                      Submit
                    </Button>
                  )}
                </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ------------------------------------------------ navigator */}
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
          <Card className="p-4">
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.18em] text-mist-500">
              <Grid3x3 className="size-3.5" /> Navigator
            </p>
            <div className="mt-3">{navigatorButtons('grid-cols-5')}</div>
            {legend}

            {!finished && (
              <Button className="mt-4" block variant="mint" onClick={() => setConfirmOpen(true)} icon={<Send className="size-4" />}>
                Submit exam
              </Button>
            )}

            <p className="mt-3 flex items-start gap-2 text-[0.7rem] font-medium leading-relaxed text-mist-600">
              <ScrollText className="mt-0.5 size-3.5 shrink-0" />
              Keyboard: A–D or 1–4 to answer, ← → to move, F to flag.
            </p>
          </Card>
        </aside>
      </div>

      {/* ------------------------------------- phone thumb bar + sheet */}
      <div className="print-hide fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/94 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 pt-2 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)]">
          <Button
            variant="outline"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label="Previous question"
            className="w-12 px-0"
            icon={<ArrowLeft className="size-4" />}
          />
          <button
            onClick={() => setNavigatorOpen(true)}
            className="flex h-12 min-w-0 flex-1 flex-col items-center justify-center rounded-2xl border border-white/12 bg-white/[0.04] px-2 transition-transform touch-manipulation active:scale-[0.98]"
            aria-label="Open the question navigator"
          >
            <span className="flex items-center gap-1.5 text-[0.82rem] font-black tabular text-mist-100">
              <Grid3x3 className="size-3.5 text-nova-300" />
              {index + 1} / {total}
            </span>
            <span className="truncate text-[0.64rem] font-bold text-mist-500">
              {answeredCount} answered{flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ''}
            </span>
          </button>
          {index < total - 1 ? (
            <Button className="h-12 flex-1 px-3" onClick={() => go(index + 1)}>
              Next <ArrowRight className="size-4" />
            </Button>
          ) : (
            !finished && (
              <Button className="h-12 flex-1 px-3" variant="mint" onClick={() => setConfirmOpen(true)} icon={<Send className="size-4" />}>
                Submit
              </Button>
            )
          )}
        </div>
      </div>

      <AnimatePresence>
        {navigatorOpen && (
          <motion.div
            className="print-hide fixed inset-0 z-70 flex items-end scrim backdrop-blur-sm lg:hidden"
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            onClick={() => setNavigatorOpen(false)}
            role="presentation"
          >
            <motion.div
              className="glass-strong max-h-[82dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl px-4 pt-2.5 pb-[max(env(safe-area-inset-bottom,0px),1rem)]"
              initial={{y: '100%'}}
              animate={{y: 0}}
              exit={{y: '100%'}}
              transition={{duration: 0.28, ease: EASE}}
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Question navigator"
            >
              <div className="flex justify-center pb-2.5">
                <span className="sheet-handle" />
              </div>
              <div className="flex items-center justify-between gap-3">
 <p className="flex items-center gap-2 text-[0.72rem] font-black tracking-[0.18em] text-mist-500">
                  <Grid3x3 className="size-3.5" /> Jump to a question
                </p>
                <button
                  onClick={() => setNavigatorOpen(false)}
                  className="grid size-9 place-items-center rounded-xl text-mist-400 transition-colors active:bg-white/10"
                  aria-label="Close navigator"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="mt-3 flex gap-1.5">
                {(
                  [
                    {id: 'all', label: 'All'},
                    {id: 'todo', label: 'To do'},
                    {id: 'flagged', label: 'Flagged'},
                  ] as const
                ).map((option) => {
                  const count =
                    option.id === 'all'
                      ? state.questions.length
                      : state.questions.filter((question) => {
                          const row = answers[question.id];
                          return option.id === 'todo' ? !row?.selected : Boolean(row?.flagged);
                        }).length;
                  const active = navFilter === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => setNavFilter(option.id)}
                      className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 text-[0.7rem] font-extrabold transition-colors touch-manipulation ${
                        active
                          ? 'border-nova-400/50 bg-nova-500/16 text-nova-200'
                          : 'border-white/10 bg-white/[0.03] text-mist-500'
                      }`}
                    >
                      {option.label}
                      <span className="tabular opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                {navFilter !== 'all' &&
                !state.questions.some((question) =>
                  navFilter === 'todo' ? !answers[question.id]?.selected : Boolean(answers[question.id]?.flagged),
                ) ? (
                  <p className="py-6 text-center text-[0.78rem] font-semibold text-mist-500">
                    {navFilter === 'todo' ? 'Every question answered. Submit when ready!' : 'Nothing flagged yet.'}
                  </p>
                ) : (
                  navigatorButtons('grid-cols-6 sm:grid-cols-8', navFilter)
                )}
              </div>
              {legend}
              {!finished && (
                <Button
                  className="mt-4"
                  block
                  variant="mint"
                  onClick={() => {
                    setNavigatorOpen(false);
                    setConfirmOpen(true);
                  }}
                  icon={<Send className="size-4" />}
                >
                  Submit exam
                </Button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------ submit modal */}
      <AnimatePresence>
        {confirmOpen && (
          <motion.div
            className="fixed inset-0 z-80 flex items-end justify-center scrim backdrop-blur-sm sm:grid sm:place-items-center sm:p-4"
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            onClick={() => setConfirmOpen(false)}
            role="presentation"
          >
            <motion.div
              initial={{opacity: 0, scale: 0.94, y: 16}}
              animate={{opacity: 1, scale: 1, y: 0}}
              exit={{opacity: 0, scale: 0.96, y: 8}}
              transition={{duration: 0.26, ease: EASE}}
              onClick={(event) => event.stopPropagation()}
              className="glass-strong w-full rounded-t-3xl px-4 pt-4 pb-[max(env(safe-area-inset-bottom,0px),1.25rem)] sm:max-w-md sm:rounded-3xl sm:p-6"
              role="dialog"
              aria-modal="true"
            >
              <div className="mb-3 flex justify-center sm:hidden">
                <span className="sheet-handle" />
              </div>
              <h3 className="text-lg font-black text-mist-50">Submit your exam?</h3>
              <p className="mt-1.5 text-[0.86rem] font-medium text-mist-400">
                You answered <span className="font-black text-mint-300">{answeredCount}</span> of {total} questions
                {flaggedCount > 0 && (
                  <>
                    {' '}
                    and flagged <span className="font-black text-gold-300">{flaggedCount}</span>
                  </>
                )}
                . This cannot be undone.
              </p>

              {total - answeredCount > 0 && (
                <p className="mt-3 flex items-center gap-2 rounded-2xl border border-gold-500/28 bg-gold-500/10 px-4 py-3 text-[0.82rem] font-semibold text-gold-300">
                  <AlertTriangle className="size-4 shrink-0" />
                  {total - answeredCount} questions are still blank — they score zero.
                </p>
              )}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:mt-6 sm:flex-row">
                <Button variant="ghost" block onClick={() => setConfirmOpen(false)}>
                  Keep working
                </Button>
                <Button variant="mint" block loading={submitting} onClick={() => void submit('early')} icon={<Send className="size-4" />}>
                  Submit now
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
