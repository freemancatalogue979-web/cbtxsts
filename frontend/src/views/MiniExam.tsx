/**
 * Mini exam — a real, server-timed exam the AI tutor (or the student) builds
 * from the course bank. The server owns the clock, order and scoring: this
 * screen only shows what it is told, saves each pick, and asks for the result.
 *
 *   ready        → start card (count · minutes · difficulty · START EXAM)
 *   in_progress  → one question at a time, palette, countdown, submit
 *   submitted    → score, topic breakdown, weak/strong, next steps, AI feedback, review
 */
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Clock, FileQuestion, Flag, Layers,
  ListChecks, Loader2, RotateCcw, Sparkles, Target, Timer, TrendingDown, TrendingUp, X, XCircle,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Card, Modal, ProgressBar, ProgressRing, Skeleton} from '../components/ui';
import {askTutor, miniExamApi, type MiniExam as Exam, type MiniExamAction, type MiniExamFeedback, type MiniExamQuestion} from '../lib/tutor';
import {useSession} from '../store/session';

const DIFFICULTY: Record<string, string> = {easy: 'Easy', medium: 'Medium', hard: 'Hard', mixed: 'Mixed'};

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function MiniExam({examId, onExit, onOpen}: {examId: number; onExit: () => void; onOpen: (id: number) => void}) {
  const {toast} = useSession();
  const [exam, setExam] = useState<Exam | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setExam(await miniExamApi.get(examId));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [examId]);

  useEffect(() => {
    setExam(null);
    void load();
  }, [load]);

  const start = async () => {
    setBusy(true);
    try {
      setExam(await miniExamApi.start(examId));
    } catch (e) {
      toast('error', "Couldn't start", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Shell>
        <Card className="p-6 text-center">
          <AlertTriangle className="mx-auto size-8 text-flare-300" />
          <p className="mt-2 font-bold text-mist-50">{error}</p>
          <Button className="mt-4" variant="outline" onClick={onExit} icon={<ArrowLeft className="size-4" />}>Back</Button>
        </Card>
      </Shell>
    );
  }
  if (!exam) {
    return (
      <Shell>
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="mt-3 h-64 w-full rounded-2xl" />
      </Shell>
    );
  }
  if (exam.status === 'ready') return <Shell><StartCard exam={exam} busy={busy} onStart={start} onExit={onExit} /></Shell>;
  if (exam.status === 'in_progress') return <Runner key={exam.id} exam={exam} onFinished={setExam} onReload={load} />;
  return <Shell><Results exam={exam} setExam={setExam} onOpen={onOpen} onExit={onExit} /></Shell>;
}

function Shell({children}: {children: React.ReactNode}) {
  return <div className="relative mx-auto w-full max-w-3xl px-3 pt-2 pb-24 sm:px-5 sm:pt-4">{children}</div>;
}

/* ------------------------------------------------------------------ start */
function StartCard({exam, busy, onStart, onExit}: {exam: Exam; busy: boolean; onStart: () => void; onExit: () => void}) {
  return (
    <Card raised className="relative overflow-hidden p-5 sm:p-7">
      <div className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-nova-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 size-48 rounded-full bg-pulse-500/10 blur-3xl" />
      <div className="relative">
        <p className="flex items-center gap-1.5 text-[0.66rem] font-extrabold tracking-[0.16em] text-nova-300 uppercase">
          <Sparkles className="size-3.5" /> {exam.created_by === 'ai' ? 'Built by your AI tutor' : 'Mini exam'}
          {exam.course ? ` · ${exam.course.code}` : ''}
        </p>
        <h1 className="mt-1.5 text-[1.35rem] leading-tight font-extrabold text-mist-50 sm:text-[1.6rem]">{exam.title}</h1>
        {exam.course && <p className="mt-0.5 text-[0.84rem] text-mist-400">{exam.course.title}</p>}
        {exam.topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {exam.topics.map((t) => (
              <span key={t} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.72rem] font-bold text-mist-200">{t}</span>
            ))}
          </div>
        )}
        <div className="mt-5 grid grid-cols-3 gap-2">
          <BigStat icon={<FileQuestion className="size-4" />} value={String(exam.question_count)} label="Questions" />
          <BigStat icon={<Timer className="size-4" />} value={`${exam.duration_minutes} min`} label="Time limit" />
          <BigStat icon={<Target className="size-4" />} value={DIFFICULTY[exam.difficulty] ?? exam.difficulty} label="Difficulty" />
        </div>
        <ul className="mt-5 grid gap-1.5 text-[0.8rem] text-mist-300">
          <Rule>The timer starts when you press Start and keeps running if you leave.</Rule>
          <Rule>Your answers save as you go. You can change them until you submit.</Rule>
          <Rule>Answers and explanations appear after you submit.</Rule>
        </ul>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onExit}>Not now</Button>
          <Button size="lg" onClick={onStart} loading={busy} icon={<Clock className="size-4" />} className="sm:min-w-48">Start exam</Button>
        </div>
      </div>
    </Card>
  );
}

function Rule({children}: {children: React.ReactNode}) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 size-3.5 shrink-0 text-mint-300" />
      <span>{children}</span>
    </li>
  );
}

function BigStat({icon, value, label}: {icon: React.ReactNode; value: string; label: string}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-ink-950/40 px-2 py-3 text-center">
      <span className="mx-auto grid size-8 place-items-center rounded-lg bg-nova-500/15 text-nova-200">{icon}</span>
      <p className="mt-1.5 text-[0.98rem] font-extrabold text-mist-50">{value}</p>
      <p className="text-[0.62rem] font-bold tracking-wide text-mist-500 uppercase">{label}</p>
    </div>
  );
}

/* ----------------------------------------------------------------- runner */
function Runner({exam, onFinished, onReload}: {exam: Exam; onFinished: (e: Exam) => void; onReload: () => Promise<void>}) {
  const {toast} = useSession();
  const questions = exam.questions ?? [];
  const [index, setIndex] = useState(() => Math.max(0, questions.findIndex((q) => !q.selected)));
  const [picks, setPicks] = useState<Record<number, string | null>>(() => Object.fromEntries(questions.map((q) => [q.question_id, q.selected])));
  const [flags, setFlags] = useState<Set<number>>(new Set());
  const [left, setLeft] = useState(exam.seconds_left ?? exam.duration_minutes * 60);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const deadline = useRef(Date.now() + (exam.seconds_left ?? 0) * 1000);
  const shownAt = useRef(Date.now());
  const finishing = useRef(false);

  const q = questions[index];
  const answered = Object.values(picks).filter(Boolean).length;

  const finish = useCallback(async (auto = false) => {
    if (finishing.current) return;
    finishing.current = true;
    setSubmitting(true);
    try {
      const result = auto ? await miniExamApi.get(exam.id) : await miniExamApi.finish(exam.id);
      if (auto && result.status === 'in_progress') {
        // the server clock is the truth: a few seconds of drift → re-sync, don't force it
        finishing.current = false;
        deadline.current = Date.now() + (result.seconds_left ?? 0) * 1000;
        setLeft(result.seconds_left ?? 0);
        return;
      }
      if (auto) toast('info', "Time's up", 'Your answers were submitted.');
      onFinished(result);
    } catch (e) {
      finishing.current = false;
      toast('error', "Couldn't submit", (e as Error).message);
    } finally {
      setSubmitting(false);
      setConfirm(false);
    }
  }, [exam.id, onFinished, toast]);

  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0) void finish(true);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [finish]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  const choose = async (key: string) => {
    if (!q || finishing.current) return;
    const previous = picks[q.question_id];
    const next = previous === key ? null : key;
    setPicks((p) => ({...p, [q.question_id]: next}));
    setSaving(q.question_id);
    const seconds = (Date.now() - shownAt.current) / 1000;
    shownAt.current = Date.now();
    try {
      const res = await miniExamApi.answer(exam.id, q.question_id, next, seconds);
      if (res.seconds_left != null) deadline.current = Date.now() + res.seconds_left * 1000;
    } catch (e) {
      setPicks((p) => ({...p, [q.question_id]: previous}));
      const status = (e as {status?: number}).status;
      if (status === 409 || status === 410) {
        toast('info', 'This exam has closed', (e as Error).message);
        await onReload();
      } else toast('error', 'Answer not saved', (e as Error).message);
    } finally {
      setSaving((s) => (s === q.question_id ? null : s));
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (confirm || (event.target as HTMLElement)?.closest('input,textarea')) return;
      const k = event.key.toUpperCase();
      if (['A', 'B', 'C', 'D', 'E'].includes(k) && q?.options.some((o) => o.key === k)) void choose(k);
      else if (event.key === 'ArrowRight') setIndex((i) => Math.min(questions.length - 1, i + 1));
      else if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const low = left <= 60;
  const total = exam.duration_minutes * 60;
  if (!q) return null;

  return (
    <div className="relative mx-auto w-full max-w-3xl px-3 pt-1 pb-28 sm:px-5 sm:pt-3">
      {/* status bar */}
      <div className="sticky top-14 z-30 mb-3 rounded-2xl border border-white/8 bg-ink-900/85 px-3 py-2.5 shadow-lg shadow-black/30 backdrop-blur-md sm:top-15 sm:px-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8rem] font-extrabold text-mist-50">{exam.title}</p>
            <p className="text-[0.68rem] font-bold text-mist-500">{answered}/{questions.length} answered{exam.course ? ` · ${exam.course.code}` : ''}</p>
          </div>
          <div
            className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 font-mono text-[0.95rem] font-extrabold tabular-nums ${low ? 'animate-pulse border-flare-400/40 bg-flare-500/15 text-flare-200' : 'border-white/10 bg-white/[0.04] text-mist-50'}`}
            role="timer"
            aria-label={`Time left ${clock(left)}`}
          >
            <Timer className="size-4" /> {clock(left)}
          </div>
          <Button size="sm" variant="soft" onClick={() => setConfirm(true)} className="hidden sm:inline-flex">Submit</Button>
        </div>
        <ProgressBar value={total - left} max={total} animated={false} className="mt-2 h-1" />
      </div>

      {/* question */}
      <Card raised className="p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-nova-500/15 px-2 py-0.5 text-[0.7rem] font-extrabold text-nova-200">Question {index + 1} of {questions.length}</span>
          {q.topic && <span className="truncate text-[0.7rem] font-bold text-mist-500">{q.topic}</span>}
          <button
            onClick={() => setFlags((f) => { const n = new Set(f); if (n.has(q.question_id)) n.delete(q.question_id); else n.add(q.question_id); return n; })}
            className={`ml-auto grid size-8 place-items-center rounded-lg transition ${flags.has(q.question_id) ? 'bg-amber-400/15 text-amber-300' : 'text-mist-600 hover:bg-white/[0.06] hover:text-mist-300'}`}
            aria-label={flags.has(q.question_id) ? 'Remove flag' : 'Flag for review'}
            aria-pressed={flags.has(q.question_id)}
            data-tip={flags.has(q.question_id) ? 'Flagged' : 'Flag for review'}
          >
            <Flag className="size-4" />
          </button>
        </div>
        <p className="mt-3 text-[1rem] leading-relaxed font-semibold whitespace-pre-wrap text-mist-50 sm:text-[1.05rem]">{q.text}</p>
        {q.image_url && <img src={q.image_url} alt="" className="mt-3 max-h-72 rounded-xl border border-white/10 object-contain" />}
        <div className="mt-4 grid gap-2">
          {q.options.map((o) => {
            const on = picks[q.question_id] === o.key;
            return (
              <button
                key={o.key}
                onClick={() => void choose(o.key)}
                aria-pressed={on}
                className={`group flex min-h-13 items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.995] ${
                  on ? 'border-nova-400/60 bg-nova-500/15 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.35)]' : 'border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]'
                }`}
              >
                <span className={`grid size-8 shrink-0 place-items-center rounded-xl text-[0.8rem] font-extrabold transition ${on ? 'bg-nova-500 text-white' : 'bg-white/[0.06] text-mist-300 group-hover:bg-white/10'}`}>
                  {saving === q.question_id && on ? <Loader2 className="size-3.5 animate-spin" /> : o.key}
                </span>
                <span className="text-[0.9rem] leading-snug text-mist-100">{o.text}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* palette */}
      <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center gap-3 text-[0.64rem] font-bold text-mist-500">
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-nova-500" /> Answered</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-amber-400" /> Flagged</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm border border-white/15" /> Not yet</span>
        </div>
        <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
          {questions.map((row, i) => {
            const done = Boolean(picks[row.question_id]);
            const flagged = flags.has(row.question_id);
            return (
              <button
                key={row.question_id}
                onClick={() => setIndex(i)}
                aria-label={`Question ${i + 1}${done ? ', answered' : ''}${flagged ? ', flagged' : ''}`}
                aria-current={i === index}
                className={`relative h-9 rounded-lg text-[0.74rem] font-extrabold tabular-nums transition ${
                  i === index ? 'ring-2 ring-nova-300 ring-offset-1 ring-offset-ink-950' : ''
                } ${done ? 'bg-nova-500/80 text-white' : 'border border-white/12 text-mist-400 hover:bg-white/[0.06]'}`}
              >
                {i + 1}
                {flagged && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-amber-400" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* bottom nav */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/8 bg-ink-950/90 backdrop-blur-md safe-bottom">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-2.5 sm:px-5">
          <Button variant="outline" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} icon={<ArrowLeft className="size-4" />} label="Previous" />
          <div className="min-w-0 flex-1">
            {index < questions.length - 1 ? (
              <Button block onClick={() => setIndex((i) => i + 1)}>
                Next <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button block variant="mint" onClick={() => setConfirm(true)} icon={<CheckCircle2 className="size-4" />}>Submit exam</Button>
            )}
          </div>
          {index < questions.length - 1 && <Button variant="soft" onClick={() => setConfirm(true)} className="sm:hidden" data-submit="mobile">Submit</Button>}
        </div>
      </div>

      <Modal
        open={confirm}
        onClose={() => !submitting && setConfirm(false)}
        title="Submit your exam?"
        subtitle={answered < questions.length ? `${questions.length - answered} question${questions.length - answered === 1 ? '' : 's'} still unanswered.` : 'Every question has an answer.'}
        icon={answered < questions.length ? AlertTriangle : CheckCircle2}
        tone={answered < questions.length ? 'amber' : 'mint'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={submitting}>Keep going</Button>
            <Button variant="mint" onClick={() => void finish(false)} loading={submitting}>Submit now</Button>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-2 text-center">
          <MiniStat value={answered} label="Answered" tone="text-nova-200" />
          <MiniStat value={questions.length - answered} label="Blank" tone="text-amber-200" />
          <MiniStat value={flags.size} label="Flagged" tone="text-mist-200" />
        </div>
        <p className="mt-3 text-[0.78rem] text-mist-400">You have {clock(left)} left. Once submitted, you can't change your answers.</p>
      </Modal>
    </div>
  );
}

function MiniStat({value, label, tone}: {value: number | string; label: string; tone: string}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] py-2">
      <p className={`text-[1.1rem] font-extrabold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[0.62rem] font-bold tracking-wide text-mist-500 uppercase">{label}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- results */
function Results({exam, setExam, onOpen, onExit}: {exam: Exam; setExam: (e: Exam) => void; onOpen: (id: number) => void; onExit: () => void}) {
  const {toast} = useSession();
  const a = exam.analysis;
  const pct = Math.round(exam.percentage ?? a?.percentage ?? 0);
  const [feedback, setFeedback] = useState<MiniExamFeedback | null>(a?.ai ?? null);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'wrong'>('wrong');
  const verdict = pct >= 75 ? {label: 'Excellent', tone: 'text-mint-300'} : pct >= 50 ? {label: 'Good effort', tone: 'text-amber-200'} : {label: 'Keep going', tone: 'text-flare-300'};

  const getFeedback = async () => {
    setLoadingFeedback(true);
    try {
      const res = await miniExamApi.feedback(exam.id);
      setFeedback(res.feedback);
      if (exam.analysis) setExam({...exam, analysis: {...exam.analysis, ai: res.feedback}});
    } catch (e) {
      toast('error', 'No feedback right now', (e as Error).message);
    } finally {
      setLoadingFeedback(false);
    }
  };

  const act = async (action: MiniExamAction) => {
    const context = exam.course ? {course_id: exam.course.id, topic: action.topic || undefined} : undefined;
    if (action.type === 'review') {
      askTutor({prompt: `Teach me ${action.topic} — I got questions on it wrong in my mini exam "${exam.title}".`, mode: 'TEACH', context, autoSend: true, newChat: true, label: action.topic});
    } else if (action.type === 'flashcards') {
      askTutor({prompt: `Make 10 flashcards on ${action.topic}`, context, autoSend: true, label: action.topic});
    } else if (exam.course) {
      setCreating(action.label);
      try {
        const next = await miniExamApi.create({course_id: exam.course.id, topics: action.topic ? [action.topic] : undefined, question_count: 10, difficulty: action.topic ? 'mixed' : 'hard', focus: action.topic ? 'weak' : 'mixed'});
        onOpen(next.id);
      } catch (e) {
        toast('error', "Couldn't build it", (e as Error).message);
      } finally {
        setCreating(null);
      }
    }
  };

  const questions = useMemo(() => (exam.questions ?? []).filter((q) => filter === 'all' || !q.is_correct), [exam.questions, filter]);
  const minutes = a?.time_used_seconds != null ? Math.max(1, Math.round(a.time_used_seconds / 60)) : null;

  return (
    <div className="grid gap-3">
      <Card raised className="relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -top-20 -right-16 size-60 rounded-full bg-nova-500/15 blur-3xl" />
        <div className="relative flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <ProgressRing value={pct} size={112} stroke={10}>
            <div className="text-center">
              <p className="text-[1.6rem] leading-none font-extrabold text-mist-50 tabular-nums">{pct}%</p>
              <p className="mt-0.5 text-[0.66rem] font-bold text-mist-500">{exam.score}/{exam.total}</p>
            </div>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <p className="text-[0.66rem] font-extrabold tracking-[0.16em] text-mist-500 uppercase">
              {exam.status === 'expired' ? "Time's up · auto-submitted" : 'Mini exam result'}{exam.course ? ` · ${exam.course.code}` : ''}
            </p>
            <h1 className="mt-0.5 text-[1.2rem] leading-tight font-extrabold text-mist-50 sm:text-[1.35rem]">{exam.title}</h1>
            <p className={`mt-0.5 text-[0.9rem] font-extrabold ${verdict.tone}`}>{verdict.label}</p>
            {a?.change != null && (
              <p className={`mt-1 inline-flex items-center gap-1 text-[0.76rem] font-bold ${a.change >= 0 ? 'text-mint-300' : 'text-flare-300'}`}>
                {a.change >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                {a.change >= 0 ? '+' : ''}{a.change}% vs your last mini exam
              </p>
            )}
          </div>
        </div>
        {a && (
          <div className="relative mt-4 grid grid-cols-4 gap-1.5">
            <MiniStat value={a.correct} label="Correct" tone="text-mint-300" />
            <MiniStat value={a.wrong} label="Wrong" tone="text-flare-300" />
            <MiniStat value={a.skipped} label="Skipped" tone="text-amber-200" />
            <MiniStat value={minutes != null ? `${minutes}m` : '—'} label="Time" tone="text-mist-100" />
          </div>
        )}
      </Card>

      {/* AI feedback */}
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-nova-400 to-pulse-500 text-white"><Sparkles className="size-4" /></span>
          <p className="flex-1 text-[0.86rem] font-extrabold text-mist-50">Tutor feedback</p>
          {!feedback && <Button size="sm" variant="soft" onClick={() => void getFeedback()} loading={loadingFeedback}>Get feedback</Button>}
        </div>
        {feedback ? (
          <div className="mt-3 grid gap-2.5">
            <p className="text-[0.92rem] font-bold text-mist-50">{feedback.headline}</p>
            {feedback.summary && <p className="text-[0.84rem] leading-relaxed text-mist-300">{feedback.summary}</p>}
            {feedback.mistake_patterns.length > 0 && (
              <div>
                <p className="text-[0.64rem] font-extrabold tracking-[0.14em] text-mist-500 uppercase">Mistake patterns</p>
                <ul className="mt-1 grid gap-1">{feedback.mistake_patterns.map((m) => <li key={m} className="flex gap-2 text-[0.8rem] text-mist-200"><X className="mt-0.5 size-3.5 shrink-0 text-flare-300" />{m}</li>)}</ul>
              </div>
            )}
            {feedback.recommended_actions.length > 0 && (
              <div>
                <p className="text-[0.64rem] font-extrabold tracking-[0.14em] text-mist-500 uppercase">Do this next</p>
                <ul className="mt-1 grid gap-1">{feedback.recommended_actions.map((m) => <li key={m} className="flex gap-2 text-[0.8rem] text-mist-200"><ArrowRight className="mt-0.5 size-3.5 shrink-0 text-nova-300" />{m}</li>)}</ul>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2 text-[0.78rem] text-mist-500">A short, personal read of your result: what went well, the mistakes you repeat, and what to study next.</p>
        )}
      </Card>

      {/* topics */}
      {a && a.topics.length > 0 && (
        <Card className="p-4">
          <p className="text-[0.86rem] font-extrabold text-mist-50">By topic</p>
          <div className="mt-3 grid gap-2.5">
            {a.topics.map((t) => {
              const weak = a.weak_topics.includes(t.topic);
              const strong = a.strong_topics.includes(t.topic);
              return (
                <div key={t.topic}>
                  <div className="flex items-center gap-2 text-[0.8rem]">
                    <span className="min-w-0 flex-1 truncate font-bold text-mist-100">{t.topic}</span>
                    {weak && <span className="rounded-full bg-flare-500/15 px-1.5 py-0.5 text-[0.6rem] font-extrabold text-flare-200 uppercase">Weak</span>}
                    {strong && <span className="rounded-full bg-mint-500/15 px-1.5 py-0.5 text-[0.6rem] font-extrabold text-mint-200 uppercase">Strong</span>}
                    <span className="font-bold text-mist-400 tabular-nums">{t.correct}/{t.total}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className={`h-full rounded-full ${t.percentage >= 75 ? 'bg-mint-400' : t.percentage >= 50 ? 'bg-amber-400' : 'bg-flare-400'}`} style={{width: `${Math.max(3, t.percentage)}%`}} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* next steps */}
      {a && a.recommended_actions.length > 0 && (
        <Card className="p-4">
          <p className="text-[0.86rem] font-extrabold text-mist-50">Next steps</p>
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {a.recommended_actions.map((action) => (
              <button
                key={action.label}
                onClick={() => void act(action)}
                disabled={creating !== null}
                className="flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2.5 text-left transition hover:border-white/16 hover:bg-white/[0.05] disabled:opacity-50"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-nova-500/15 text-nova-200">
                  {creating === action.label ? <Loader2 className="size-4 animate-spin" /> : action.type === 'review' ? <BookOpen className="size-4" /> : action.type === 'flashcards' ? <Layers className="size-4" /> : <ListChecks className="size-4" />}
                </span>
                <span className="min-w-0 flex-1 text-[0.8rem] font-bold text-mist-100">{action.label}</span>
                <ArrowRight className="size-4 text-mist-600" />
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* review */}
      {(exam.questions?.length ?? 0) > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[0.86rem] font-extrabold text-mist-50">Review answers</p>
            <div className="flex rounded-full border border-white/10 p-0.5 text-[0.7rem] font-bold">
              {(['wrong', 'all'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-1 ${filter === f ? 'bg-white/10 text-mist-50' : 'text-mist-500'}`}>{f === 'wrong' ? 'Missed' : 'All'}</button>
              ))}
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            {questions.length === 0 && <p className="py-4 text-center text-[0.8rem] text-mist-500">Nothing missed — every answer was right.</p>}
            {questions.map((q) => <ReviewItem key={q.question_id} q={q} number={(exam.questions ?? []).indexOf(q) + 1} course={exam.course?.id} />)}
          </div>
        </Card>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onExit} icon={<ArrowLeft className="size-4" />}>Back</Button>
        {exam.course && (
          <Button
            variant="outline"
            icon={<RotateCcw className="size-4" />}
            loading={creating === 'again'}
            onClick={async () => {
              setCreating('again');
              try {
                const next = await miniExamApi.create({course_id: exam.course!.id, topics: exam.topics.length ? exam.topics : undefined, question_count: exam.question_count, duration_minutes: exam.duration_minutes, difficulty: exam.difficulty});
                onOpen(next.id);
              } catch (e) {
                toast('error', "Couldn't build it", (e as Error).message);
              } finally {
                setCreating(null);
              }
            }}
          >
            New set, same topics
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewItem({q, number, course}: {q: MiniExamQuestion; number: number; course?: number}) {
  const [open, setOpen] = useState(!q.is_correct);
  const status = q.selected == null ? 'skipped' : q.is_correct ? 'right' : 'wrong';
  return (
    <div className={`rounded-xl border ${status === 'right' ? 'border-mint-400/20' : status === 'wrong' ? 'border-flare-400/25' : 'border-amber-400/20'} bg-white/[0.02]`}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
        {status === 'right' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-mint-300" /> : status === 'wrong' ? <XCircle className="mt-0.5 size-4 shrink-0 text-flare-300" /> : <Clock className="mt-0.5 size-4 shrink-0 text-amber-300" />}
        <span className="min-w-0 flex-1 text-[0.84rem] leading-snug text-mist-100"><b className="text-mist-400">{number}.</b> {q.text}</span>
        <ChevronDown className={`mt-0.5 size-4 shrink-0 text-mist-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-1.5 px-3 pb-3">
          {q.options.map((o) => {
            const right = o.key === q.correct;
            const mine = o.key === q.selected;
            return (
              <div key={o.key} className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[0.8rem] ${right ? 'bg-mint-500/12 text-mint-100' : mine ? 'bg-flare-500/12 text-flare-100' : 'text-mist-400'}`}>
                <b className="w-4 shrink-0">{o.key}</b>
                <span className="flex-1">{o.text}</span>
                {right && <span className="text-[0.62rem] font-extrabold uppercase">Correct</span>}
                {mine && !right && <span className="text-[0.62rem] font-extrabold uppercase">Your pick</span>}
              </div>
            );
          })}
          {q.explanation && <p className="mt-1 rounded-lg bg-white/[0.03] px-2.5 py-2 text-[0.78rem] leading-relaxed text-mist-300">{q.explanation}</p>}
          <button
            onClick={() => askTutor({prompt: `Explain question: "${q.text}". I picked ${q.selected ?? 'nothing'}; the answer is ${q.correct}. Why?`, mode: 'EXPLAIN', context: course ? {course_id: course, question_id: q.question_id} : undefined, autoSend: true, temporary: true, label: `Question ${number}`})}
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-[0.72rem] font-bold text-nova-300 hover:bg-nova-500/10"
          >
            <Sparkles className="size-3.5" /> Ask the tutor why
          </button>
        </div>
      )}
    </div>
  );
}
