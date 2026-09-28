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
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Clock, FileQuestion, Flag, Gauge, Hash, Layers,
  ListChecks, Loader2, MinusCircle, Play, RotateCcw, Sparkles, Target, Timer, TrendingDown, TrendingUp, Trophy, X, XCircle,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import PracticeClock from '../components/PracticeClock';
import {Button, Card, Modal, ProgressBar, Skeleton} from '../components/ui';
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


/* ------------------------------------------------------------ visual bits */
const HERO_BORDER = 'linear-gradient(135deg, rgba(167,139,250,0.75), rgba(255,255,255,0.07) 45%, rgba(56,189,248,0.5))';

/** Gradient-bordered panel with a soft glow and a dot grid. */
function Hero({children, border = HERO_BORDER, glow = 'bg-nova-500/25', className = ''}: {children: React.ReactNode; border?: string; glow?: string; className?: string}) {
  return (
    <section className={`relative overflow-hidden rounded-3xl p-px ${className}`} style={{background: border}}>
      <div className="relative overflow-hidden rounded-[calc(1.5rem-1px)] bg-ink-950/95 p-4 sm:p-6">
        <div aria-hidden className={`pointer-events-none absolute -top-20 -right-16 size-64 rounded-full blur-3xl ${glow}`} />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 size-56 rounded-full bg-sky-500/10 blur-3xl" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{backgroundImage: 'radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)', backgroundSize: '16px 16px', maskImage: 'linear-gradient(160deg, black, transparent 70%)'}}
        />
        <div className="relative">{children}</div>
      </div>
    </section>
  );
}

function Pill({children, tone = 'plain'}: {children: React.ReactNode; tone?: 'nova' | 'plain' | 'mint' | 'amber' | 'flare'}) {
  const cls = {
    nova: 'border-nova-400/35 bg-nova-500/12 text-nova-200',
    plain: 'border-white/10 bg-white/[0.05] text-mist-200',
    mint: 'border-mint-400/35 bg-mint-500/12 text-mint-200',
    amber: 'border-amber-400/35 bg-amber-500/12 text-amber-200',
    flare: 'border-flare-400/35 bg-flare-500/12 text-flare-200',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.62rem] font-black tracking-[0.12em] uppercase ${cls}`}>{children}</span>;
}

/** Three bars: easy 1, medium 2, hard 3, mixed = one of each colour. */
function DifficultyMeter({level}: {level: string}) {
  const bars = level === 'easy' ? ['bg-mint-400', '', ''] : level === 'medium' ? ['bg-amber-400', 'bg-amber-400', ''] : level === 'hard' ? ['bg-flare-400', 'bg-flare-400', 'bg-flare-400'] : ['bg-mint-400', 'bg-amber-400', 'bg-flare-400'];
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {bars.map((c, i) => <span key={i} className={`w-1.5 rounded-sm ${c || 'bg-white/12'}`} style={{height: 6 + i * 4}} />)}
    </span>
  );
}

function StatTile({icon, value, label, tone, extra, row}: {icon: React.ReactNode; value: React.ReactNode; label: string; tone: string; extra?: React.ReactNode; row?: boolean}) {
  if (row) {
    return (
      <div className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/8 bg-white/[0.035] p-2.5 sm:p-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${tone}`}>{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-[1.05rem] leading-none font-black tabular text-mist-50">{value}</p>
          <p className="mt-1 truncate text-[0.56rem] font-black tracking-[0.1em] text-mist-500 uppercase">{label}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="min-w-0 rounded-2xl border border-white/8 bg-white/[0.035] p-3">
      <div className="flex items-center justify-between gap-1">
        <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${tone}`}>{icon}</span>
        {extra}
      </div>
      <p className="mt-2 truncate text-[1.05rem] leading-none font-black tabular text-mist-50 sm:text-[1.15rem]">{value}</p>
      <p className="mt-1 truncate text-[0.58rem] font-black tracking-[0.1em] text-mist-500 uppercase">{label}</p>
    </div>
  );
}

function SectionTitle({icon, title, hint, action}: {icon: React.ReactNode; title: string; hint?: string; action?: React.ReactNode}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-mist-200">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9rem] font-black text-mist-50">{title}</p>
        {hint && <p className="truncate text-[0.7rem] font-medium text-mist-500">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

function Shell({children}: {children: React.ReactNode}) {
  return <div className="relative mx-auto w-full max-w-3xl px-3 pt-2 pb-24 sm:px-5 sm:pt-4">{children}</div>;
}

/* ------------------------------------------------------------------ start */
function StartCard({exam, busy, onStart, onExit}: {exam: Exam; busy: boolean; onStart: () => void; onExit: () => void}) {
  const [allTopics, setAllTopics] = useState(false);
  const topics = allTopics ? exam.topics : exam.topics.slice(0, 5);
  const hidden = exam.topics.length - topics.length;
  const perQuestion = exam.question_count ? Math.round((exam.duration_minutes * 60) / exam.question_count) : 0;
  return (
    <Hero>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone="nova"><Sparkles className="size-3" /> {exam.created_by === 'ai' ? 'Built by your AI tutor' : 'Mini exam'}</Pill>
        {exam.course && <Pill>{exam.course.code}</Pill>}
      </div>

      <div className="mt-4 flex items-start gap-3.5 sm:gap-4">
        <div className="relative shrink-0">
          <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-nova-400 to-pulse-600 text-white shadow-lg shadow-nova-900/50 sm:size-16">
            <FileQuestion className="size-7" />
          </span>
          <span className="absolute -right-1.5 -bottom-1.5 grid min-w-6 place-items-center rounded-full border-2 border-ink-950 bg-mint-400 px-1 text-[0.66rem] font-black text-ink-950 tabular">{exam.question_count}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.3rem] leading-tight font-black text-mist-50 sm:text-[1.6rem]">{exam.title}</h1>
          {exam.course && <p className="mt-1 text-[0.82rem] font-medium text-mist-400">{exam.course.title}</p>}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <StatTile icon={<FileQuestion className="size-4" />} tone="bg-nova-500/15 text-nova-200" value={exam.question_count} label="Questions" />
        <StatTile icon={<Timer className="size-4" />} tone="bg-sky-500/15 text-sky-200" value={`${exam.duration_minutes}m`} label={perQuestion ? `~${perQuestion}s each` : 'Time limit'} />
        <StatTile icon={<Gauge className="size-4" />} tone="bg-amber-500/15 text-amber-200" value={DIFFICULTY[exam.difficulty] ?? exam.difficulty} label="Difficulty" extra={<DifficultyMeter level={exam.difficulty} />} />
      </div>

      {exam.topics.length > 0 && (
        <div className="mt-5">
          <p className="text-[0.6rem] font-black tracking-[0.14em] text-mist-500 uppercase">Covers {exam.topics.length} topic{exam.topics.length === 1 ? '' : 's'}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {topics.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] py-1 pr-2.5 pl-2 text-[0.72rem] font-bold text-mist-200">
                <Hash className="size-3 text-nova-300" />{t}
              </span>
            ))}
            {hidden > 0 && (
              <button onClick={() => setAllTopics(true)} className="rounded-full border border-dashed border-white/15 px-2.5 py-1 text-[0.72rem] font-bold text-mist-400 hover:border-white/30 hover:text-mist-200">
                +{hidden} more
              </button>
            )}
          </div>
        </div>
      )}

      <ol className="mt-5 grid gap-2 rounded-2xl border border-white/8 bg-ink-900/60 p-3 sm:grid-cols-3 sm:gap-3">
        {[
          {icon: <Clock className="size-3.5" />, text: 'The clock starts when you press Start — and keeps running if you leave.'},
          {icon: <Check className="size-3.5" />, text: 'Every answer saves instantly. Change it any time before you submit.'},
          {icon: <BookOpen className="size-3.5" />, text: 'Answers, explanations and your tutor feedback come after.'},
        ].map((row, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.07] text-[0.66rem] font-black text-mist-200">{i + 1}</span>
            <span className="text-[0.76rem] leading-snug text-mist-300">{row.text}</span>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button variant="ghost" onClick={onExit}>Not now</Button>
        <Button size="lg" onClick={onStart} loading={busy} icon={<Play className="size-4 fill-current" />} className="sm:min-w-52">Start exam</Button>
      </div>
    </Hero>
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

  const total = exam.duration_minutes * 60;
  if (!q) return null;
  const flagged = flags.has(q.question_id);
  const toggleFlag = () => setFlags((f) => { const n = new Set(f); if (n.has(q.question_id)) n.delete(q.question_id); else n.add(q.question_id); return n; });

  return (
    <div className="relative mx-auto w-full max-w-3xl px-3 pt-1 pb-28 sm:px-5 sm:pt-3">
      {/* status bar: what you're sitting, how far along, and the clock */}
      <div className="sticky top-14 z-30 mb-3 flex items-center gap-2.5 rounded-3xl border border-white/10 bg-ink-950/85 p-1.5 pl-3.5 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)] backdrop-blur-md sm:top-15 sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8rem] font-black text-mist-50">
            {exam.course && !exam.title.includes(exam.course.code) && <span className="text-nova-300">{exam.course.code} · </span>}
            {exam.title}
          </p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[0.95rem] font-black tabular text-mist-50">{answered}</span>
            <span className="text-[0.72rem] font-bold tabular text-mist-500">/ {questions.length} answered</span>
            {flags.size > 0 && <span className="ml-1 inline-flex items-center gap-0.5 text-[0.68rem] font-bold text-amber-300"><Flag className="size-3" />{flags.size}</span>}
          </div>
          <ProgressBar value={answered} max={Math.max(1, questions.length)} className="mt-1.5 h-1.5" />
        </div>
        <PracticeClock remaining={left} totalSeconds={total} />
        <Button size="sm" variant="soft" onClick={() => setConfirm(true)} className="mr-1 hidden sm:inline-flex">Submit</Button>
      </div>

      {/* question */}
      <Card raised className="relative overflow-hidden p-4 sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-20 size-56 rounded-full bg-nova-500/10 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <span className="grid h-10 min-w-10 place-items-center rounded-2xl bg-gradient-to-br from-nova-400 to-pulse-600 px-2 text-[0.95rem] font-black text-white tabular shadow-lg shadow-nova-900/40">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-[0.6rem] font-black tracking-[0.14em] text-mist-500 uppercase">Question {index + 1} of {questions.length}</p>
            {q.topic && <p className="mt-0.5 truncate text-[0.76rem] font-bold text-mist-300">{q.topic}</p>}
          </div>
          <button
            onClick={toggleFlag}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[0.72rem] font-bold transition ${flagged ? 'border-amber-400/45 bg-amber-400/15 text-amber-200' : 'border-white/10 text-mist-400 hover:border-white/20 hover:bg-white/[0.05] hover:text-mist-200'}`}
            aria-label={flagged ? 'Remove flag' : 'Flag for review'}
            aria-pressed={flagged}
          >
            <Flag className={`size-3.5 ${flagged ? 'fill-current' : ''}`} /> {flagged ? 'Flagged' : 'Flag'}
          </button>
        </div>
        <p className="relative mt-4 text-[1.02rem] leading-relaxed font-semibold whitespace-pre-wrap text-mist-50 sm:text-[1.1rem]">{q.text}</p>
        {q.image_url && <img src={q.image_url} alt="" className="relative mt-3 max-h-72 rounded-xl border border-white/10 object-contain" />}
        <div className="relative mt-5 grid gap-2">
          {q.options.map((o) => {
            const on = picks[q.question_id] === o.key;
            return (
              <button
                key={o.key}
                onClick={() => void choose(o.key)}
                aria-pressed={on}
                className={`group flex min-h-14 items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                  on
                    ? 'border-nova-400/70 bg-gradient-to-r from-nova-500/25 to-nova-500/[0.06] shadow-[0_0_0_1px_rgba(139,92,246,0.35),0_8px_24px_-14px_rgba(139,92,246,0.8)]'
                    : 'border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]'
                }`}
              >
                <span className={`grid size-9 shrink-0 place-items-center rounded-xl text-[0.82rem] font-black transition ${on ? 'bg-gradient-to-br from-nova-400 to-pulse-600 text-white' : 'bg-white/[0.06] text-mist-300 group-hover:bg-white/10'}`}>
                  {saving === q.question_id && on ? <Loader2 className="size-3.5 animate-spin" /> : o.key}
                </span>
                <span className={`min-w-0 flex-1 text-[0.9rem] leading-snug ${on ? 'font-bold text-mist-50' : 'text-mist-100'}`}>{o.text}</span>
                {on && <CheckCircle2 className="size-5 shrink-0 text-nova-200" />}
              </button>
            );
          })}
        </div>
      </Card>

      {/* question map */}
      <div className="mt-3 rounded-3xl border border-white/8 bg-white/[0.025] p-3 sm:p-4">
        <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="flex-1 text-[0.8rem] font-black text-mist-100">Question map</p>
          <span className="flex items-center gap-1 text-[0.64rem] font-bold text-mist-500"><span className="size-2.5 rounded-[4px] bg-gradient-to-br from-nova-400 to-pulse-600" /> Answered</span>
          <span className="flex items-center gap-1 text-[0.64rem] font-bold text-mist-500"><span className="size-2.5 rounded-full bg-amber-400" /> Flagged</span>
          <span className="flex items-center gap-1 text-[0.64rem] font-bold text-mist-500"><span className="size-2.5 rounded-[4px] border border-white/20" /> Blank</span>
        </div>
        <div className="grid grid-cols-7 gap-1.5 min-[420px]:grid-cols-8 sm:grid-cols-10">
          {questions.map((row, i) => {
            const done = Boolean(picks[row.question_id]);
            const isFlagged = flags.has(row.question_id);
            return (
              <button
                key={row.question_id}
                onClick={() => setIndex(i)}
                aria-label={`Question ${i + 1}${done ? ', answered' : ''}${isFlagged ? ', flagged' : ''}`}
                aria-current={i === index}
                className={`relative h-10 rounded-xl text-[0.76rem] font-black tabular transition ${
                  i === index ? 'ring-2 ring-nova-200 ring-offset-2 ring-offset-ink-950' : ''
                } ${done ? 'bg-gradient-to-br from-nova-400 to-pulse-600 text-white shadow-md shadow-nova-900/30' : 'border border-white/12 bg-ink-950/40 text-mist-400 hover:bg-white/[0.06]'}`}
              >
                {i + 1}
                {isFlagged && <span className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-ink-950 bg-amber-400" />}
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
                Next question <ArrowRight className="size-4" />
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
  const verdict =
    pct >= 75
      ? {label: 'Excellent', note: 'You really know this material.', pill: 'mint' as const, icon: Trophy, ring: ['#34d399', '#22d3ee'], glow: 'bg-mint-500/25', border: 'linear-gradient(135deg, rgba(52,211,153,0.7), rgba(255,255,255,0.07) 45%, rgba(34,211,238,0.45))'}
      : pct >= 50
        ? {label: 'Good effort', note: 'Solid — a little more practice closes the gap.', pill: 'amber' as const, icon: TrendingUp, ring: ['#fbbf24', '#f472b6'], glow: 'bg-amber-500/20', border: 'linear-gradient(135deg, rgba(251,191,36,0.7), rgba(255,255,255,0.07) 45%, rgba(244,114,182,0.45))'}
        : {label: 'Keep going', note: 'Every miss below is a lesson — review them and try again.', pill: 'flare' as const, icon: Target, ring: ['#fb7185', '#a78bfa'], glow: 'bg-flare-500/20', border: 'linear-gradient(135deg, rgba(251,113,133,0.7), rgba(255,255,255,0.07) 45%, rgba(167,139,250,0.5))'};

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

  const VerdictIcon = verdict.icon;
  const avg = a?.avg_seconds != null ? Math.round(a.avg_seconds) : null;
  const wrongCount = (exam.questions ?? []).filter((q) => !q.is_correct).length;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {/* result hero */}
      <Hero border={verdict.border} glow={verdict.glow}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={verdict.pill}><VerdictIcon className="size-3" /> {verdict.label}</Pill>
          {exam.status === 'expired' && <Pill tone="amber"><Clock className="size-3" /> Time's up · auto-submitted</Pill>}
          {exam.course && <Pill>{exam.course.code}</Pill>}
        </div>
        <div className="mt-4 flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:gap-6 sm:text-left">
          <ScoreRing value={pct} colors={verdict.ring}>
            <p className="text-[2rem] leading-none font-black text-mist-50 tabular">{pct}<span className="text-[1.1rem] text-mist-400">%</span></p>
            <p className="mt-1 text-[0.66rem] font-bold text-mist-400 tabular">{exam.score}/{exam.total} marks</p>
          </ScoreRing>
          <div className="min-w-0 flex-1">
            <h1 className="text-[1.25rem] leading-tight font-black text-mist-50 sm:text-[1.45rem]">{exam.title}</h1>
            <p className="mt-1 text-[0.82rem] text-mist-400">{verdict.note}</p>
            {a?.change != null && (
              <p className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.72rem] font-bold ${a.change >= 0 ? 'bg-mint-500/12 text-mint-200' : 'bg-flare-500/12 text-flare-200'}`}>
                {a.change >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                {a.change >= 0 ? '+' : ''}{a.change}% vs your last mini exam
              </p>
            )}
          </div>
        </div>
        {a && (
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile icon={<CheckCircle2 className="size-4" />} tone="bg-mint-500/15 text-mint-200" value={a.correct} label="Correct" row />
            <StatTile icon={<XCircle className="size-4" />} tone="bg-flare-500/15 text-flare-200" value={a.wrong} label="Wrong" row />
            <StatTile icon={<MinusCircle className="size-4" />} tone="bg-amber-500/15 text-amber-200" value={a.skipped} label="Skipped" row />
            <StatTile icon={<Timer className="size-4" />} tone="bg-sky-500/15 text-sky-200" value={minutes != null ? `${minutes}m` : '—'} label={avg != null ? `~${avg}s each` : 'Time used'} row />
          </div>
        )}
      </Hero>

      {/* AI feedback */}
      <section className="relative overflow-hidden rounded-3xl border border-nova-400/25 bg-gradient-to-br from-nova-500/[0.12] via-ink-900/70 to-pulse-500/[0.06] p-4 sm:p-5">
        <div aria-hidden className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-nova-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-nova-400 to-pulse-500 text-white shadow-lg shadow-nova-900/40"><Sparkles className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.9rem] font-black text-mist-50">Tutor feedback</p>
            <p className="text-[0.7rem] font-medium text-mist-400">A personal read of this result</p>
          </div>
          {!feedback && <div className="order-last w-full sm:order-none sm:w-auto"><Button size="sm" block onClick={() => void getFeedback()} loading={loadingFeedback} icon={<Sparkles className="size-3.5" />}>Get feedback</Button></div>}
        </div>
        {feedback ? (
          <div className="relative mt-3.5 grid gap-3">
            <p className="text-[0.95rem] leading-snug font-black text-mist-50">{feedback.headline}</p>
            {feedback.summary && <p className="text-[0.84rem] leading-relaxed text-mist-300">{feedback.summary}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {feedback.mistake_patterns.length > 0 && (
                <div className="rounded-2xl border border-flare-400/20 bg-flare-500/[0.06] p-3">
                  <p className="text-[0.6rem] font-black tracking-[0.14em] text-flare-300 uppercase">Mistake patterns</p>
                  <ul className="mt-1.5 grid gap-1.5">{feedback.mistake_patterns.map((m) => <li key={m} className="flex gap-2 text-[0.8rem] leading-snug text-mist-200"><X className="mt-0.5 size-3.5 shrink-0 text-flare-300" />{m}</li>)}</ul>
                </div>
              )}
              {feedback.recommended_actions.length > 0 && (
                <div className="rounded-2xl border border-mint-400/20 bg-mint-500/[0.06] p-3">
                  <p className="text-[0.6rem] font-black tracking-[0.14em] text-mint-300 uppercase">Do this next</p>
                  <ul className="mt-1.5 grid gap-1.5">{feedback.recommended_actions.map((m) => <li key={m} className="flex gap-2 text-[0.8rem] leading-snug text-mist-200"><ArrowRight className="mt-0.5 size-3.5 shrink-0 text-mint-300" />{m}</li>)}</ul>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="relative mt-2.5 text-[0.78rem] leading-relaxed text-mist-400">What went well, the mistakes you keep repeating, and exactly what to study next.</p>
        )}
      </section>

      {/* topics */}
      {a && a.topics.length > 0 && (
        <Card className="p-4 sm:p-5">
          <SectionTitle icon={<Target className="size-4" />} title="By topic" hint={a.weak_topics.length ? `Focus on: ${a.weak_topics.slice(0, 3).join(', ')}` : 'How you did in each area'} />
          <div className="mt-3.5 grid gap-3">
            {a.topics.map((t) => {
              const weak = a.weak_topics.includes(t.topic);
              const strong = a.strong_topics.includes(t.topic);
              const tone = t.percentage >= 75 ? 'from-mint-400 to-cyan-400' : t.percentage >= 50 ? 'from-amber-400 to-orange-400' : 'from-flare-400 to-pink-500';
              return (
                <div key={t.topic}>
                  <div className="flex items-center gap-2 text-[0.8rem]">
                    <span className="min-w-0 flex-1 truncate font-bold text-mist-100">{t.topic}</span>
                    {weak && <span className="rounded-full bg-flare-500/15 px-2 py-0.5 text-[0.58rem] font-black tracking-wider text-flare-200 uppercase">Weak</span>}
                    {strong && <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-[0.58rem] font-black tracking-wider text-mint-200 uppercase">Strong</span>}
                    <span className="w-14 text-right font-black text-mist-300 tabular">{t.correct}/{t.total}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className={`h-full rounded-full bg-gradient-to-r ${tone}`} style={{width: `${Math.max(4, t.percentage)}%`}} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* next steps */}
      {a && a.recommended_actions.length > 0 && (
        <Card className="p-4 sm:p-5">
          <SectionTitle icon={<ArrowRight className="size-4" />} title="Next steps" hint="One tap — your tutor sets it up" />
          <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
            {a.recommended_actions.map((action) => {
              const look = action.type === 'review'
                ? {icon: <BookOpen className="size-4" />, tone: 'bg-sky-500/15 text-sky-200', kind: 'Lesson'}
                : action.type === 'flashcards'
                  ? {icon: <Layers className="size-4" />, tone: 'bg-pulse-500/15 text-pulse-200', kind: 'Flashcards'}
                  : {icon: <ListChecks className="size-4" />, tone: 'bg-nova-500/15 text-nova-200', kind: 'Mini exam'};
              return (
                <button
                  key={action.label}
                  onClick={() => void act(action)}
                  disabled={creating !== null}
                  className="group flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:border-white/18 hover:bg-white/[0.06] disabled:opacity-50"
                >
                  <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${look.tone}`}>
                    {creating === action.label ? <Loader2 className="size-4 animate-spin" /> : look.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.58rem] font-black tracking-[0.12em] text-mist-500 uppercase">{look.kind}</span>
                    <span className="block text-[0.82rem] leading-snug font-bold text-mist-100">{action.label}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-mist-600 transition group-hover:translate-x-0.5 group-hover:text-mist-300" />
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* review */}
      {(exam.questions?.length ?? 0) > 0 && (
        <Card className="p-4 sm:p-5">
          <SectionTitle
            icon={<ListChecks className="size-4" />}
            title="Review answers"
            hint={wrongCount ? `${wrongCount} to learn from` : 'Every answer was right'}
            action={
              <div className="flex rounded-full border border-white/10 bg-ink-950/50 p-0.5 text-[0.7rem] font-bold">
                {(['wrong', 'all'] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 transition ${filter === f ? 'bg-white/12 text-mist-50' : 'text-mist-500 hover:text-mist-300'}`}>{f === 'wrong' ? `Missed${wrongCount ? ` ${wrongCount}` : ''}` : 'All'}</button>
                ))}
              </div>
            }
          />
          <div className="mt-3.5 grid gap-2">
            {questions.length === 0 && (
              <div className="grid place-items-center gap-1.5 rounded-2xl border border-dashed border-mint-400/25 py-6 text-center">
                <Trophy className="size-6 text-mint-300" />
                <p className="text-[0.82rem] font-bold text-mint-100">Nothing missed — every answer was right.</p>
              </div>
            )}
            {questions.map((q) => <ReviewItem key={q.question_id} q={q} number={(exam.questions ?? []).indexOf(q) + 1} course={exam.course?.id} />)}
          </div>
        </Card>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onExit} icon={<ArrowLeft className="size-4" />}>Back</Button>
        {exam.course && (
          <Button
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

/** Score ring in the verdict's colours. */
function ScoreRing({value, colors, children}: {value: number; colors: string[]; children: React.ReactNode}) {
  const size = 132;
  const r = 56;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{width: size, height: size}}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <defs>
          <linearGradient id="mini-score-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={colors[0]} />
            <stop offset="100%" stopColor={colors[1]} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="11" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#mini-score-ring)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, Math.max(0, value)) / 100)}
          style={{transition: 'stroke-dashoffset 1s ease-out'}}
        />
      </svg>
      <div className="absolute inset-3 grid place-items-center rounded-full bg-ink-950/60 text-center">
        <div>{children}</div>
      </div>
    </div>
  );
}

function ReviewItem({q, number, course}: {q: MiniExamQuestion; number: number; course?: number}) {
  const [open, setOpen] = useState(!q.is_correct);
  const status = q.selected == null ? 'skipped' : q.is_correct ? 'right' : 'wrong';
  const look = {
    right: {bar: 'bg-mint-400', badge: 'bg-mint-500/15 text-mint-200', border: 'border-mint-400/20', label: 'Correct', Icon: CheckCircle2},
    wrong: {bar: 'bg-flare-400', badge: 'bg-flare-500/15 text-flare-200', border: 'border-flare-400/25', label: 'Wrong', Icon: XCircle},
    skipped: {bar: 'bg-amber-400', badge: 'bg-amber-500/15 text-amber-200', border: 'border-amber-400/20', label: 'Skipped', Icon: MinusCircle},
  }[status];
  return (
    <div className={`relative overflow-hidden rounded-2xl border ${look.border} bg-white/[0.025]`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${look.bar}`} />
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 py-3 pr-3 pl-4 text-left">
        <span className={`grid size-7 shrink-0 place-items-center rounded-lg text-[0.72rem] font-black tabular ${look.badge}`}>{number}</span>
        <span className="min-w-0 flex-1">
          <span className={`inline-flex items-center gap-1 text-[0.58rem] font-black tracking-[0.12em] uppercase ${look.badge.split(' ')[1]}`}><look.Icon className="size-3" /> {look.label}</span>
          <span className="mt-0.5 block text-[0.84rem] leading-snug font-semibold text-mist-100">{q.text}</span>
        </span>
        <ChevronDown className={`mt-1 size-4 shrink-0 text-mist-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-1.5 pr-3 pb-3 pl-4">
          {q.options.map((o) => {
            const right = o.key === q.correct;
            const mine = o.key === q.selected;
            return (
              <div key={o.key} className={`flex items-start gap-2.5 rounded-xl border px-2.5 py-2 text-[0.8rem] ${right ? 'border-mint-400/30 bg-mint-500/10 text-mint-100' : mine ? 'border-flare-400/30 bg-flare-500/10 text-flare-100' : 'border-transparent text-mist-400'}`}>
                <span className={`grid size-5 shrink-0 place-items-center rounded-md text-[0.66rem] font-black ${right ? 'bg-mint-400 text-ink-950' : mine ? 'bg-flare-400 text-ink-950' : 'bg-white/[0.06] text-mist-400'}`}>{o.key}</span>
                <span className="flex-1 leading-snug">{o.text}</span>
                {right && <span className="shrink-0 text-[0.58rem] font-black tracking-wider text-mint-300 uppercase">Answer</span>}
                {mine && !right && <span className="shrink-0 text-[0.58rem] font-black tracking-wider text-flare-300 uppercase">Your pick</span>}
              </div>
            );
          })}
          {q.explanation && (
            <div className="mt-1 rounded-xl border border-white/8 bg-ink-950/50 px-3 py-2.5">
              <p className="text-[0.58rem] font-black tracking-[0.12em] text-mist-500 uppercase">Why</p>
              <p className="mt-0.5 text-[0.79rem] leading-relaxed text-mist-300">{q.explanation}</p>
            </div>
          )}
          <button
            onClick={() => askTutor({prompt: `Explain question: "${q.text}". I picked ${q.selected ?? 'nothing'}; the answer is ${q.correct}. Why?`, mode: 'EXPLAIN', context: course ? {course_id: course, question_id: q.question_id} : undefined, autoSend: true, temporary: true, label: `Question ${number}`})}
            className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-nova-400/30 bg-nova-500/10 px-3 py-1.5 text-[0.72rem] font-bold text-nova-200 hover:bg-nova-500/20"
          >
            <Sparkles className="size-3.5" /> Ask the tutor why
          </button>
        </div>
      )}
    </div>
  );
}
