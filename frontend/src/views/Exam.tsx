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
  CloudCheck,
  CloudUpload,
  Flag,
  Grid3x3,
  MoveVertical,
  ScrollText,
  Send,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Character from '../components/Character';
import {AnswerFeedback, AnswerTile} from '../components/GameQuestion';
import {Button, Card, Chip, ProgressBar} from '../components/ui';
import {api, ApiError} from '../lib/api';
import {
  cachedPaper,
  cachedPaperForQuiz,
  cachedRemaining,
  cachePaper,
  ExamSync,
  isTransient,
  pendingAnswers,
  type SyncStatus,
  updateCachedAnswers,
} from '../lib/examSync';
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
  /* Mirror answers into the saved paper so an offline reload shows them all. */
  const paperId = state?.status === 'in_progress' && !reviewOnly ? state.id : null;
  useEffect(() => {
    if (!paperId || Object.keys(answers).length === 0) return;
    const timer = window.setTimeout(() => updateCachedAnswers(paperId, answers), 500);
    return () => window.clearTimeout(timer);
  }, [answers, paperId]);

  useEffect(() => {
    if (!swipeHint) return undefined;
    const timer = window.setTimeout(() => setSwipeHint(false), 9000);
    return () => window.clearTimeout(timer);
  }, [swipeHint]);
  const [direction, setDirection] = useState(1);
  /* Offline-first delivery + integrity (see lib/examSync.ts). */
  const syncRef = useRef<ExamSync | null>(null);
  const [sync, setSync] = useState<SyncStatus>({kind: 'saved', pending: 0});
  const [deviceConflict, setDeviceConflict] = useState(false);
  const [offlinePaper, setOfflinePaper] = useState(false);
  const [submitQueued, setSubmitQueued] = useState(false);
  const [awayNotice, setAwayNotice] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const takeoverRef = useRef(false);
  const awayWarned = useRef(false);
  const indexRef = useRef(0);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const startedRef = useRef<number>(Date.now());
  /* Which attempt this component already has open. Naming the attempt in the
     URL re-renders with a new `attemptId` prop, and that must not throw away
     the paper the player is working on. */
  const loadedId = useRef<number | null>(null);
  const submittedRef = useRef(false);

  /* ------------------------------------------------------------- load */
  useEffect(() => {
    const takeover = takeoverRef.current;
    if (attemptId && loadedId.current === attemptId && !takeover) return undefined;
    takeoverRef.current = false;
    let alive = true;
    (async () => {
      setLoading(true);
      setDeviceConflict(false);
      try {
        let loaded: AttemptState;
        let fromCache = false;
        let cachedLeft = 0;
        try {
          const knownId = attemptId ?? (quiz ? cachedPaperForQuiz(quiz.id)?.state.id : undefined);
          if (knownId && !reviewOnly) {
            // Deliver anything this phone queued (maybe even a submit) before reading.
            const pre = new ExamSync(knownId);
            await pre.flush().catch(() => null);
            pre.dispose();
          }
          loaded = reviewOnly && attemptId
            ? await api.review(attemptId)
            : attemptId
              ? await api.attempt(attemptId, takeover)
              : await api.startExam(quiz!.id, takeover);
        } catch (err) {
          // No network: reopen the copy of this paper saved on the phone.
          const paper = !reviewOnly && isTransient(err)
            ? attemptId ? cachedPaper(attemptId) : quiz ? cachedPaperForQuiz(quiz.id) : null
            : null;
          if (!paper) throw err;
          loaded = paper.state;
          fromCache = true;
          cachedLeft = cachedRemaining(paper);
        }
        if (!alive) return;
        loadedId.current = loaded.id;
        setState(loaded);
        setOfflinePaper(fromCache);
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
        // Answers still waiting on this phone are newer than the server's copy.
        if (loaded.status === 'in_progress' && !reviewOnly) {
          Object.entries(pendingAnswers(loaded.id)).forEach(([id, row]) => {
            map[Number(id)] = {selected: row.selected, flagged: row.flagged, seconds: row.seconds, dirty: true};
          });
          if (!fromCache) cachePaper(loaded);
        }
        loaded.questions.forEach((question) => {
          if (!map[question.id]) map[question.id] = {selected: null, flagged: false, seconds: 0, dirty: false};
        });
        setAnswers(map);
        setRemaining(fromCache ? cachedLeft : Math.max(0, Math.round(loaded.time_remaining)));
        const firstUnanswered = loaded.questions.findIndex((q) => !map[q.id]?.selected);
        setIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 423) {
          setDeviceConflict(true);
          return;
        }
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
  }, [attemptId, quiz?.id, reviewOnly, onAttempt, reloadTick]);

  /** Move the paper to this device (the other one is locked out and staff see the move). */
  const continueHere = useCallback(() => {
    takeoverRef.current = true;
    loadedId.current = null;
    submittedRef.current = false;
    setSubmitQueued(false);
    setError(null);
    setReloadTick((tick) => tick + 1);
  }, []);

  /* ------------------------------------------------------------ timer */
  const submit = useCallback(
    async (type: 'early' | 'auto_timer') => {
      if (!state || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        const engine = syncRef.current;
        if (!engine) {
          await api.submitExam(state.id, type);
          onFinished(state.id);
          return;
        }
        // Answers and the submit travel together; onSubmitted finishes the flow.
        const result = await engine.submit(type);
        if (!result || result.status === 'in_progress') {
          // Offline (or locked): the submit waits on this phone and goes out on reconnect.
          setSubmitQueued(true);
          setConfirmOpen(false);
        }
      } catch (err) {
        submittedRef.current = false;
        setSubmitQueued(false);
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

  /* ------------------------------------------ delivery engine lifetime */
  const liveId = state && !reviewOnly && state.status === 'in_progress' ? state.id : null;
  // Latest callbacks via refs: the engine must live exactly as long as the attempt,
  // never be rebuilt because a parent re-rendered with new function identities.
  const finishedRef = useRef(onFinished);
  const toastRef = useRef(toast);
  useEffect(() => {
    finishedRef.current = onFinished;
    toastRef.current = toast;
  });
  useEffect(() => {
    if (!liveId) return undefined;
    const engine = new ExamSync(liveId);
    syncRef.current = engine;
    const off = engine.subscribe(setSync);
    engine.onSubmitted = (result) => {
      setSubmitQueued(false);
      if (result.late) {
        toastRef.current('info', 'Paper closed at the deadline', 'Some answers reached the server too late to count.');
      }
      finishedRef.current(liveId);
    };
    if (engine.submitQueued) {
      submittedRef.current = true;
      setSubmitQueued(true);
    }
    if (engine.pending) engine.retryNow();
    return () => {
      off();
      engine.dispose();
      if (syncRef.current === engine) syncRef.current = null;
    };
  }, [liveId]);

  /* A paper reopened from the phone's copy: refresh from the server once it is reachable. */
  useEffect(() => {
    if (!offlinePaper) return undefined;
    const retry = () => {
      if (sync.kind === 'offline') return;
      loadedId.current = null;
      setReloadTick((tick) => tick + 1);
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [offlinePaper, sync.kind]);

  /* ------------------------------------------------ integrity signals */
  /* Recorded for staff review, never used to fail anyone automatically. */
  useEffect(() => {
    if (!liveId) return undefined;
    const engine = () => syncRef.current;
    let awaySince: number | null = null;
    let offlineSince: number | null = navigator.onLine ? null : Date.now();
    const leave = () => {
      if (awaySince === null) awaySince = Date.now();
    };
    const back = () => {
      if (awaySince === null || document.visibilityState !== 'visible') return;
      const seconds = Math.round((Date.now() - awaySince) / 1000);
      awaySince = null;
      if (seconds < 1) return; // notification shade, rotation — not a leave
      engine()?.addEvent({type: 'away', seconds, question: indexRef.current + 1});
      if (!awayWarned.current) {
        awayWarned.current = true;
        setAwayNotice(true);
      }
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? leave() : back());
    const onOffline = () => {
      if (offlineSince === null) offlineSince = Date.now();
    };
    const onOnline = () => {
      if (offlineSince !== null) {
        engine()?.addEvent({type: 'offline', seconds: Math.round((Date.now() - offlineSince) / 1000)});
        offlineSince = null;
      }
      engine()?.retryNow();
    };
    const onCopy = () => engine()?.addEvent({type: 'copy', question: indexRef.current + 1});
    const onPaste = () => engine()?.addEvent({type: 'paste', question: indexRef.current + 1});
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, [liveId]);

  /* The first leave gets one calm heads-up; it hides itself. */
  useEffect(() => {
    if (!awayNotice) return undefined;
    const timer = window.setTimeout(() => setAwayNotice(false), 7000);
    return () => window.clearTimeout(timer);
  }, [awayNotice]);

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
      const base = answersRef.current[questionId] ?? {selected: null, flagged: false, seconds: 0, dirty: false};
      const next = {...base, ...patch, dirty: true};
      answersRef.current = {...answersRef.current, [questionId]: next};
      setAnswers((current) => ({...current, [questionId]: {...(current[questionId] ?? base), ...patch, dirty: true}}));
      // Saved on this phone first, then delivered (batched, retried until it lands).
      syncRef.current?.putAnswer(questionId, {selected: next.selected, flagged: next.flagged, seconds: next.seconds});
    },
    [state, reviewOnly],
  );

  /* Everything confirmed by the server → nothing is "dirty" any more. */
  useEffect(() => {
    if (sync.kind !== 'saved') return;
    setAnswers((current) => {
      if (!Object.values(current).some((row) => row.dirty)) return current;
      const next: Record<number, AnswerState> = {};
      Object.entries(current).forEach(([id, row]) => (next[Number(id)] = {...row, dirty: false}));
      return next;
    });
  }, [sync.kind]);

  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const pick = (question: QuestionPublic, key: OptionKey) => {
    // No taps after 0:00 or once the submit is on its way (even while offline).
    if (reviewOnly || state?.status !== 'in_progress' || remaining <= 0 || submitQueued || sync.kind === 'locked') return;
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
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const question = state.questions[index];
      if (!question) return;

      if (['a', 'A', '1'].includes(event.key)) pick(question, 'A');
      else if (['b', 'B', '2'].includes(event.key)) pick(question, 'B');
      else if (['c', 'C', '3'].includes(event.key)) pick(question, 'C');
      else if (['d', 'D', '4'].includes(event.key)) pick(question, 'D');
      else if (event.key === 'ArrowRight' || event.key === 'n' || event.key === 'N') go(index + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'p' || event.key === 'P') go(index - 1);
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

  if (deviceConflict) {
    return (
      <div className="w-full py-12 sm:py-16">
        <Card className="mx-auto max-w-md p-6 text-center sm:p-7">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-gold-400/30 bg-gold-500/12 text-gold-300">
            <Smartphone className="size-6" />
          </span>
          <h2 className="mt-4 text-lg font-black text-mist-50 sm:text-xl">This exam is open on another device</h2>
          <p className="mt-2 text-[0.84rem] font-medium leading-relaxed text-mist-400">
            To keep the exam fair, a paper can only be open on one device at a time. Continue here to move it to this
            device. The other device will stop taking answers, and your lecturer will see that the exam was moved.
          </p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={onExit} icon={<ArrowLeft className="size-4" />}>
              Go back
            </Button>
            <Button onClick={continueHere} icon={<Smartphone className="size-4" />}>
              Continue here
            </Button>
          </div>
        </Card>
      </div>
    );
  }

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
        ? correctLabel(current) === currentAnswer.selected
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

        {!finished && <SaveStatus status={sync} />}
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

      {!finished && (
        <DeliveryNotices
          sync={sync}
          offlinePaper={offlinePaper}
          submitQueued={submitQueued}
          awayNotice={awayNotice}
          onDismissAway={() => setAwayNotice(false)}
          onRetry={() => syncRef.current?.retryNow()}
          onContinueHere={continueHere}
          onExit={onExit}
        />
      )}

      <ExamStatus
        className="mb-3 sm:mb-4"
        finished={finished}
        total={total}
        answered={answeredCount}
        flagged={flaggedCount}
        remaining={remaining}
        correct={correctCount}
        grade={state.grade}
        onNext={(test) => {
          const qs = state.questions;
          for (let step = 1; step <= qs.length; step++) {
            const at = (index + step) % qs.length;
            if (test(qs[at], answers[qs[at].id])) return go(at);
          }
        }}
        onSubmit={() => setConfirmOpen(true)}
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

              {/* Grid tracks pin each button to its own column, so the two
                  full-width buttons can never overflow the modal — the old
                  flex-row let them demand 200% width and escape on desktop. */}
              <div className="mt-5 grid gap-2 sm:mt-6 sm:grid-cols-2">
                <Button
                  variant="mint"
                  block
                  loading={submitting}
                  onClick={() => void submit('early')}
                  icon={<Send className="size-4" />}
                  className="sm:order-last"
                >
                  Submit now
                </Button>
                <Button variant="ghost" block onClick={() => setConfirmOpen(false)}>
                  Keep working
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------ exam status */
type NextTest = (question: QuestionPublic, answer: AnswerState | undefined) => boolean;

/** Exam status strip: jump to blank / flagged questions and a pace guide while
 * sitting the paper; score and "next wrong" when reviewing. Nothing here
 * reveals correctness before the paper is submitted. */
function ExamStatus({
  finished, total, answered, flagged, remaining, correct, grade, onNext, onSubmit, className = '',
}: {
  finished: boolean;
  total: number;
  answered: number;
  flagged: number;
  remaining: number;
  correct: number;
  grade?: string | null;
  onNext: (test: NextTest) => void;
  onSubmit: () => void;
  className?: string;
}) {
  const blank = total - answered;
  const tile = 'flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-45';
  if (finished) {
    const wrong = total - correct;
    const percent = total ? Math.round((correct / total) * 100) : 0;
    return (
      <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${className}`}>
        <div className={`${tile} col-span-2 border-white/10 bg-white/[0.04] sm:col-span-1`}>
          <CheckCircle2 className="size-4 shrink-0 text-mint-300" />
          <span className="min-w-0">
            <span className="block text-[0.64rem] font-bold tracking-wider text-mist-500 uppercase">Score</span>
            <span className="block truncate text-[0.9rem] font-black text-mist-50 tabular">{correct}/{total} · {percent}%{grade ? ` · ${grade}` : ''}</span>
          </span>
        </div>
        <button className={`${tile} border-flare-500/25 bg-flare-500/[0.07] hover:bg-flare-500/12`} disabled={!wrong} onClick={() => onNext((q, a) => correctLabel(q) !== (a?.selected ?? null))}>
          <X className="size-4 shrink-0 text-flare-300" />
          <span className="min-w-0">
            <span className="block text-[0.64rem] font-bold tracking-wider text-mist-500 uppercase">Missed</span>
            <span className="block truncate text-[0.84rem] font-black text-mist-100">{wrong ? `${wrong} · next` : 'None'}</span>
          </span>
        </button>
        <button className={`${tile} border-gold-500/25 bg-gold-500/[0.06] hover:bg-gold-500/10`} disabled={!flagged} onClick={() => onNext((_, a) => Boolean(a?.flagged))}>
          <Flag className="size-4 shrink-0 text-gold-300" />
          <span className="min-w-0">
            <span className="block text-[0.64rem] font-bold tracking-wider text-mist-500 uppercase">Flagged</span>
            <span className="block truncate text-[0.84rem] font-black text-mist-100">{flagged ? `${flagged} · next` : 'None'}</span>
          </span>
        </button>
      </div>
    );
  }
  const pace = blank > 0 ? remaining / blank : 0;
  const paceTone = !blank ? 'text-mint-300' : pace < 30 ? 'text-flare-300' : pace < 60 ? 'text-gold-300' : 'text-mint-300';
  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      <button className={`${tile} border-white/10 bg-white/[0.04] hover:bg-white/[0.07]`} disabled={!blank} onClick={() => onNext((_, a) => !a?.selected)} aria-label={blank ? `Go to the next of ${blank} unanswered questions` : 'All questions answered'}>
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-white/15 text-[0.62rem] font-black text-mist-200">{blank}</span>
        <span className="min-w-0">
          <span className="block text-[0.64rem] font-bold tracking-wider text-mist-500 uppercase">Blank</span>
          <span className="block truncate text-[0.8rem] font-black text-mist-100">{blank ? (<>Next<span className="hidden sm:inline"> blank</span></>) : 'All done'}</span>
        </span>
      </button>
      <button className={`${tile} border-gold-500/25 bg-gold-500/[0.06] hover:bg-gold-500/10`} disabled={!flagged} onClick={() => onNext((_, a) => Boolean(a?.flagged))} aria-label={flagged ? `Go to the next of ${flagged} flagged questions` : 'No flagged questions'}>
        <Flag className="size-4 shrink-0 text-gold-300" />
        <span className="min-w-0">
          <span className="block text-[0.64rem] font-bold tracking-wider text-mist-500 uppercase">Flagged</span>
          <span className="block truncate text-[0.8rem] font-black text-mist-100">{flagged ? `${flagged} · next` : 'None'}</span>
        </span>
      </button>
      {blank ? (
        <div className={`${tile} border-white/10 bg-white/[0.04]`} title="Time left divided by the questions you haven't answered">
          <Clock className={`size-4 shrink-0 ${paceTone}`} />
          <span className="min-w-0">
            <span className="block text-[0.64rem] font-bold tracking-wider text-mist-500 uppercase">Pace</span>
            <span className={`block truncate text-[0.8rem] font-black tabular ${paceTone}`}>~{formatClock(Math.floor(pace))}<span className="hidden font-bold text-mist-500 sm:inline"> / question</span></span>
          </span>
        </div>
      ) : (
        <button className={`${tile} border-mint-500/35 bg-mint-500/12 hover:bg-mint-500/20`} onClick={onSubmit}>
          <Send className="size-4 shrink-0 text-mint-300" />
          <span className="min-w-0">
            <span className="block text-[0.64rem] font-bold tracking-wider text-mist-500 uppercase">Ready</span>
            <span className="block truncate text-[0.8rem] font-black text-mint-200">Submit</span>
          </span>
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ delivery UI */
/** Small, calm indicator beside the clock: are my answers safe? */
function SaveStatus({status}: {status: SyncStatus}) {
  const view =
    status.kind === 'offline'
      ? {icon: <WifiOff className="size-3.5" />, text: `Offline · ${status.pending} on phone`, short: `${status.pending}`, tone: 'border-gold-500/40 bg-gold-500/12 text-gold-200'}
      : status.kind === 'saving'
        ? {icon: <CloudUpload className="size-3.5 animate-pulse" />, text: 'Saving…', short: '', tone: 'border-white/12 bg-white/6 text-mist-300'}
        : status.kind === 'locked'
          ? {icon: <Smartphone className="size-3.5" />, text: 'Moved', short: '', tone: 'border-flare-500/40 bg-flare-500/12 text-flare-200'}
          : {icon: <CloudCheck className="size-3.5" />, text: 'Saved', short: '', tone: 'border-mint-500/25 bg-mint-500/10 text-mint-300'};
  return (
    <span
      role="status"
      aria-live="polite"
      title={status.kind === 'offline' ? 'No connection. Your answers are saved on this phone and will be sent automatically.' : view.text}
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-[0.72rem] font-bold sm:h-10 sm:px-3 ${view.tone}`}
    >
      {view.icon}
      <span className="hidden sm:inline">{view.text}</span>
      {view.short && <span className="tabular sm:hidden">{view.short}</span>}
      <span className="sr-only sm:hidden">{view.text}</span>
    </span>
  );
}

function DeliveryNotices({
  sync,
  offlinePaper,
  submitQueued,
  awayNotice,
  onDismissAway,
  onRetry,
  onContinueHere,
  onExit,
}: {
  sync: SyncStatus;
  offlinePaper: boolean;
  submitQueued: boolean;
  awayNotice: boolean;
  onDismissAway: () => void;
  onRetry: () => void;
  onContinueHere: () => void;
  onExit: () => void;
}) {
  if (sync.kind === 'locked') {
    return (
      <div className="print-hide fixed inset-0 z-80 grid place-items-center scrim p-4 backdrop-blur-sm">
        <Card className="w-full max-w-md p-6 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-flare-400/30 bg-flare-500/12 text-flare-300">
            <Smartphone className="size-6" />
          </span>
          <h2 className="mt-4 text-lg font-black text-mist-50">This exam moved to another device</h2>
          <p className="mt-2 text-[0.84rem] font-medium leading-relaxed text-mist-400">
            Answers can only be given on one device at a time.
            {sync.pending > 0 ? ` ${sync.pending} answer${sync.pending === 1 ? '' : 's'} from this device will be sent if you continue here.` : ''}
          </p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={onExit} icon={<ArrowLeft className="size-4" />}>
              Leave
            </Button>
            <Button onClick={onContinueHere} icon={<Smartphone className="size-4" />}>
              Continue here
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  return (
    <div className="mb-3 grid gap-2 empty:hidden sm:mb-4">
      {submitQueued && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-gold-500/35 bg-gold-500/10 p-3 sm:p-3.5">
          <CloudUpload className="mt-0.5 size-5 shrink-0 text-gold-300" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.84rem] font-extrabold text-gold-100">Submit is waiting for a connection</p>
            <p className="mt-0.5 text-[0.76rem] font-medium leading-relaxed text-gold-100/75">
              Your answers are saved on this phone. They'll be submitted as soon as you're back online. Keep this page open.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      {!submitQueued && sync.kind === 'offline' && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-gold-500/30 bg-gold-500/[0.07] p-3">
          <WifiOff className="mt-0.5 size-4.5 shrink-0 text-gold-300" />
          <p className="min-w-0 flex-1 text-[0.78rem] font-semibold leading-relaxed text-gold-100/85">
            You're offline. Keep going: your answers are saved on this phone and will be sent automatically.
          </p>
          <Button size="sm" variant="ghost" onClick={onRetry} label="Try to send now" icon={<CloudUpload className="size-4" />} />
        </div>
      )}
      {offlinePaper && sync.kind !== 'offline' && !submitQueued && (
        <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[0.76rem] font-semibold text-mist-400">
          Opened from this phone's saved copy. The clock is kept by this phone until the connection returns.
        </p>
      )}
      {awayNotice && (
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-nova-400/25 bg-nova-500/10 px-3 py-2.5">
          <AlertTriangle className="size-4 shrink-0 text-nova-200" />
          <p className="min-w-0 flex-1 text-[0.76rem] font-semibold leading-relaxed text-nova-100/90">
            Heads up: leaving the exam screen is recorded for your lecturer.
          </p>
          <Button size="sm" variant="ghost" onClick={onDismissAway} label="Dismiss" icon={<X className="size-4" />} />
        </div>
      )}
    </div>
  );
}
