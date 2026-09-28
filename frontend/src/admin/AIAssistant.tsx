/**
 * AI Command Center — the staff side of Absolute Genesis AI.
 *
 *   Assistant  chat with the platform through permission-checked tools
 *   Insights   course health computed straight from the staff tools (no AI call, free)
 *   Tasks      background bulk jobs: read whole materials, build topics, map every
 *              question, write up to 1000 questions (all as proposals)
 *   Review     AI proposals waiting for approval (preview → edit → approve / reject)
 *   Activity   every tool the AI used, who it acted for, and how long it took
 *
 * The AI never writes directly: anything it drafts is a proposal until a staff
 * member approves it here.
 */
import {
  AlertTriangle, ArrowUp, BookOpen, Bot, Check, CheckCircle2, ChevronDown, ClipboardCheck, Coins, Copy, Eraser, FileQuestion, Filter, GraduationCap,
  History, Inbox, Layers, ListTree, Loader2, Lock, MessageSquarePlus, Paperclip, Pencil, Radar, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, Tags,
  Target, UserSearch, Wand2, X, XCircle, Zap, ChevronLeft, ChevronRight, FileText,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode} from 'react';
import {Button, Card, Field, Modal, ProgressRing, Skeleton, TextArea, TextInput, ToneIcon, type Tone} from '../components/ui';
import {ToolTrail} from '../components/tutor/AgentBits';
import TasksView, {attachFile, TaskInline, type AttachedMaterial} from './AITasks';
import {IMPORT_ACCEPT} from './MaterialImport';
import {api} from '../lib/api';
import {formatNumber, formatRelative} from '../lib/format';
import {Markdown} from '../lib/markdown';
import {
  aiStaffApi, type AgentTurn, type AIInsightIssue, type AIInsights, type AIStaffStatus, type Proposal, type ProposalCard, type TaskCard, type ToolCallRow, type ToolEvent,
} from '../lib/tutor';
import type {Course} from '../lib/types';
import {useSession} from '../store/session';

type View = 'assistant' | 'insights' | 'tasks' | 'review' | 'activity';
const THREAD_KEY = 'ag.staff.assistant';
const COURSE_KEY = 'ag.staff.course';
const KIND: Record<string, {label: string; icon: typeof Tags; tone: Tone}> = {
  questions: {label: 'Questions', icon: FileQuestion, tone: 'nova'},
  topics: {label: 'Topics', icon: ListTree, tone: 'cyan'},
  classification: {label: 'Classification', icon: Tags, tone: 'pulse'},
  material_topics: {label: 'Material tags', icon: FileText, tone: 'gold'},
};
const SEVERITY: Record<AIInsightIssue['severity'], {label: string; dot: string; pill: string; tone: Tone}> = {
  high: {label: 'High', dot: 'bg-flare-400', pill: 'border-flare-400/35 bg-flare-500/12 text-flare-200', tone: 'flare'},
  medium: {label: 'Medium', dot: 'bg-amber-400', pill: 'border-amber-400/35 bg-amber-500/12 text-amber-200', tone: 'amber'},
  low: {label: 'Low', dot: 'bg-cyan-400', pill: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200', tone: 'cyan'},
};
const TOOL_NAMES: Record<string, string> = {
  get_course_overview: 'Read course structure',
  list_my_courses: 'List courses',
  get_course_topics: 'Course topics',
  search_course_material: 'Search materials',
  search_question_bank: 'Search the bank',
  get_question: 'Open a question',
  read_material: 'Read materials',
  analyze_question_bank: 'Analyse the bank',
  find_duplicate_questions: 'Find duplicates',
  search_questions: 'Search questions',
  get_class_performance: 'Class performance',
  get_student_report: 'Student reports',
  propose_topics: 'Draft topics',
  propose_questions: 'Draft questions',
  propose_classification: 'Classify questions',
  start_ai_task: 'Start background task',
  get_ai_task: 'Check a task',
};
const toolName = (name: string) => TOOL_NAMES[name] ?? name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

type Play = {label: string; prompt: string};
const PLAYBOOKS: {title: string; icon: typeof Tags; tone: Tone; plays: Play[]}[] = [
  {
    title: 'Question bank', icon: Layers, tone: 'nova', plays: [
      {label: 'Bank health check', prompt: 'Analyse the question bank for this course: coverage per topic, difficulty balance, and what is missing. End with a short prioritised to-do list.'},
      {label: 'Fill the weakest topic', prompt: 'Draft 8 good questions for the weakest-covered topic in this course, with explanations.'},
      {label: 'Find duplicates', prompt: 'Find duplicate or near-duplicate questions in this course and recommend which of each pair to keep.'},
      {label: 'Classify untagged', prompt: 'Find questions in this course with no topic and propose a topic and difficulty for each.'},
    ],
  },
  {
    title: 'Content & topics', icon: BookOpen, tone: 'cyan', plays: [
      {label: 'Topics + map every question', prompt: 'Read all the materials in this course, build the topic list from them, assign every existing bank question to the right topic, and tag each material with its topic.'},
      {label: 'Write 200 questions from materials', prompt: 'Read all the materials in this course and write 200 new exam questions across all the topics (balanced difficulty), grounded in the material.'},
      {label: 'Missing explanations', prompt: 'Which questions in this course have no explanation? Draft explanations for up to 10 of them.'},
      {label: 'Course outline', prompt: 'Build a week-by-week course outline from the topics and materials of this course, and flag topics with thin material.'},
    ],
  },
  {
    title: 'Results & students', icon: GraduationCap, tone: 'mint', plays: [
      {label: 'Class results', prompt: 'How is the class doing in this course? Which topics and questions are hardest, and what should I teach again?'},
      {label: 'Suspicious answer keys', prompt: 'Check the questions in this course that students answer in an unusual pattern and may have a wrong answer key. Explain the evidence.'},
      {label: 'Revision plan', prompt: 'Using class results for this course, suggest a 2-week revision plan focused on the weakest topics.'},
    ],
  },
];
const FOLLOW_UPS = ['Turn this into a proposal I can approve', 'Summarise as a short action list', 'Go deeper on the most important point'];

const errText = (e: unknown) => (e as Error).message || 'Something went wrong.';
const money = (n: number | undefined, digits = 3) => `$${(n || 0).toFixed(digits)}`;

function scoreLabel(score: number): {label: string; tone: string} {
  if (score >= 90) return {label: 'Excellent', tone: 'text-mint-300'};
  if (score >= 75) return {label: 'Good', tone: 'text-cyan-300'};
  if (score >= 55) return {label: 'Needs work', tone: 'text-amber-300'};
  return {label: 'Critical', tone: 'text-flare-300'};
}

function readCourse(): number | null {
  try {
    const v = Number(localStorage.getItem(COURSE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/* =================================================================== shell */
export default function AIAssistant({onPending}: {onPending?: (n: number) => void}) {
  const {toast} = useSession();
  const [view, setView] = useState<View>('assistant');
  const [status, setStatus] = useState<AIStaffStatus | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseIdState] = useState<number | null>(readCourse);
  const [openProposal, setOpenProposal] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [queued, setQueued] = useState<string | null>(null);
  const [focusTask, setFocusTask] = useState<number | null>(null);
  const openTask = (id: number) => { setFocusTask(id); setView('tasks'); };

  const loadStatus = useCallback(() => {
    aiStaffApi.status().then((s) => { setStatus(s); onPending?.(s.pending_proposals); }).catch(() => undefined);
  }, [onPending]);
  useEffect(loadStatus, [loadStatus, refreshKey]);
  useEffect(() => {
    api.admin.courses().then((list) => {
      setCourses(list);
      setCourseIdState((c) => (c && list.some((x) => x.id === c) ? c : list[0]?.id ?? null));
    }).catch(() => undefined);
  }, []);

  const setCourseId = (id: number | null) => {
    setCourseIdState(id);
    try {
      if (id) localStorage.setItem(COURSE_KEY, String(id));
      else localStorage.removeItem(COURSE_KEY);
    } catch {
      /* private mode */
    }
  };
  const changed = () => setRefreshKey((k) => k + 1);
  const askAI = (prompt: string) => {
    if (!status?.configured) toast('info', 'Prompt ready', 'Connect an AI key under Models to send it.');
    setQueued(prompt);
    setView('assistant');
  };
  const course = courses.find((c) => c.id === courseId) ?? null;

  return (
    <div className="min-w-0 space-y-3">
      <Hero status={status} courses={courses} courseId={courseId} onCourse={setCourseId} onReview={() => setView('review')} />
      <Tabs view={view} onChange={setView} pending={status?.pending_proposals ?? 0} />
      {view === 'assistant' && (
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <Chat status={status} course={course} onProposal={setOpenProposal} onTask={openTask} onUsed={changed} queued={queued} onQueuedUsed={() => setQueued(null)} />
          <Rail status={status} course={course} refreshKey={refreshKey} onAsk={askAI} onInsights={() => setView('insights')} />
        </div>
      )}
      {view === 'insights' && <Insights courseId={courseId} onCourse={setCourseId} onAsk={askAI} refreshKey={refreshKey} />}
      {view === 'tasks' && <TasksView course={course} focusId={focusTask} onOpenProposal={setOpenProposal} onChanged={changed} />}
      {view === 'review' && <Review key={refreshKey} onOpen={setOpenProposal} />}
      {view === 'activity' && <Activity />}
      <ProposalModal id={openProposal} onClose={() => setOpenProposal(null)} onDecided={changed} />
    </div>
  );
}

/* -------------------------------------------------------------------- hero */
function Hero({status, courses, courseId, onCourse, onReview}: {
  status: AIStaffStatus | null; courses: Course[]; courseId: number | null; onCourse: (id: number | null) => void; onReview: () => void;
}) {
  const used = status?.used_today ?? 0;
  const limit = status?.daily_limit ?? 0;
  const budget = status?.budget_month ?? 0;
  const month = status?.cost_month ?? 0;
  return (
    <section className="panel-hero min-w-0 p-3.5 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-pulse-500/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 size-64 rounded-full bg-nova-500/10 blur-3xl" />
      <div className="relative flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-nova-400 via-pulse-500 to-flare-500 text-white shadow-[0_10px_30px_-8px_rgba(168,85,247,0.7),inset_0_1px_0_rgba(255,255,255,0.35)] sm:size-14">
            <Wand2 className="size-6 sm:size-7" />
            <span className={`absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-ink-900 ${status?.configured ? 'bg-mint-400' : status ? 'bg-flare-400' : 'bg-mist-500'}`} />
          </span>
          <div className="min-w-0">
            <p className="text-[0.62rem] font-extrabold tracking-[0.18em] text-nova-200/80 uppercase">Absolute Genesis AI</p>
            <h2 className="font-display truncate text-[1.15rem] leading-tight font-extrabold text-mist-50 sm:text-[1.35rem]">AI Command Center</h2>
            <p className="line-clamp-2 text-[0.76rem] text-mist-400">Ask, analyse and draft for your courses. Nothing changes until you approve it.</p>
          </div>
        </div>
        <label className="relative flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 py-1.5 pr-2 pl-3 lg:w-[19rem]">
          <BookOpen className="size-4 shrink-0 text-nova-300" />
          <span className="min-w-0 flex-1">
            <span className="block text-[0.58rem] font-extrabold tracking-[0.16em] text-mist-500 uppercase">Working in</span>
            <select
              value={courseId ?? ''}
              onChange={(e) => onCourse(e.target.value ? Number(e.target.value) : null)}
              className="w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent pr-6 text-[0.84rem] font-bold text-mist-50 outline-none"
              aria-label="Course"
            >
              <option value="">All courses</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
            </select>
          </span>
          <ChevronDown className="pointer-events-none absolute right-3 size-4 text-mist-400" />
        </label>
      </div>

      <div className="relative mt-3.5 grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric icon={<Bot className="size-4" />} label="Model" tone="nova">
          {status ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={`size-2 shrink-0 rounded-full ${status.configured ? 'bg-mint-400 shadow-[0_0_0_3px_rgba(52,211,153,0.18)]' : 'bg-flare-400'}`} />
              <span className="truncate">{status.configured ? status.model : 'Not connected'}</span>
            </span>
          ) : '…'}
          <MetricSub>{status ? (status.configured ? `${status.provider} · ${status.agent_enabled ? 'tools on' : 'tools off'}` : 'Add a key under Models') : ' '}</MetricSub>
        </Metric>
        <Metric icon={<Zap className="size-4" />} label="Requests today" tone="pulse">
          <span className="tabular-nums">{used}<span className="text-mist-500">/{limit || '∞'}</span></span>
          <MiniBar value={limit ? used / limit : 0} tone={limit && used / limit > 0.85 ? 'bg-flare-400' : 'bg-pulse-400'} />
        </Metric>
        <button onClick={onReview} className="min-w-0 text-left">
          <Metric icon={<ClipboardCheck className="size-4" />} label="To approve" tone="amber" highlight={!!status?.pending_proposals}>
            <span className="tabular-nums">{status?.pending_proposals ?? 0}</span>
            <MetricSub>{status?.pending_proposals ? 'Tap to review' : 'Queue is clear'}</MetricSub>
          </Metric>
        </button>
        <Metric icon={<Coins className="size-4" />} label="Month spend" tone="gold">
          <span className="tabular-nums">{money(month, 2)}{budget ? <span className="text-mist-500"> / {money(budget, 0)}</span> : null}</span>
          {budget ? <MiniBar value={month / budget} tone={month / budget > 0.85 ? 'bg-flare-400' : 'bg-gold-400'} /> : <MetricSub>{money(status?.cost_today, 3)} today · no cap</MetricSub>}
        </Metric>
      </div>
      <p className="relative mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.68rem] font-bold text-mist-500">
        <span className="flex items-center gap-1"><Lock className="size-3 text-mint-300" /> Read-only tools</span>
        <span className="flex items-center gap-1"><ShieldCheck className="size-3 text-mint-300" /> Changes need your approval</span>
        <span className="flex items-center gap-1"><History className="size-3 text-mint-300" /> Every tool call is logged</span>
      </p>
    </section>
  );
}

const METRIC_TONE: Record<string, string> = {
  nova: 'text-nova-200 bg-nova-500/15', pulse: 'text-pulse-200 bg-pulse-500/15', amber: 'text-amber-200 bg-amber-500/15', gold: 'text-gold-200 bg-gold-500/15',
};
function Metric({icon, label, tone, children, highlight = false}: {icon: ReactNode; label: string; tone: string; children: ReactNode; highlight?: boolean}) {
  return (
    <div className={`h-full min-w-0 rounded-2xl border px-3 py-2.5 transition ${highlight ? 'border-amber-400/40 bg-amber-500/[0.07]' : 'border-white/8 bg-white/[0.035]'}`}>
      <p className="flex min-w-0 items-center gap-1.5 text-[0.6rem] font-extrabold tracking-[0.12em] text-mist-500 uppercase">
        <span className={`grid size-5 shrink-0 place-items-center rounded-md ${METRIC_TONE[tone]}`}>{icon}</span>
        <span className="truncate">{label}</span>
      </p>
      <div className="mt-1 min-w-0 text-[0.92rem] font-extrabold text-mist-50 sm:text-[0.98rem]">{children}</div>
    </div>
  );
}
const MetricSub = ({children}: {children: ReactNode}) => <span className="mt-0.5 block truncate text-[0.66rem] font-semibold text-mist-500">{children}</span>;
const MiniBar = ({value, tone}: {value: number; tone: string}) => (
  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/8">
    <span className={`block h-full rounded-full ${tone}`} style={{width: `${Math.min(100, Math.max(value > 0 ? 3 : 0, value * 100))}%`}} />
  </span>
);

/* -------------------------------------------------------------------- tabs */
function Tabs({view, onChange, pending}: {view: View; onChange: (v: View) => void; pending: number}) {
  const tabs: {id: View; label: string; icon: typeof Tags; badge?: number}[] = [
    {id: 'assistant', label: 'Assistant', icon: Sparkles},
    {id: 'insights', label: 'Insights', icon: Radar},
    {id: 'tasks', label: 'Tasks', icon: Zap},
    {id: 'review', label: 'Review', icon: ClipboardCheck, badge: pending},
    {id: 'activity', label: 'Activity', icon: History},
  ];
  return (
    <div role="tablist" className="grid grid-cols-5 gap-1 rounded-2xl border border-white/8 bg-black/25 p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
      {tabs.map((t) => {
        const on = view === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[0.7rem] font-extrabold transition sm:flex-row sm:gap-1.5 sm:py-2 sm:text-[0.8rem] ${
              on ? 'bg-gradient-to-b from-white/[0.12] to-white/[0.05] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_14px_-6px_rgba(0,0,0,0.6)]' : 'text-mist-400 hover:bg-white/[0.04] hover:text-mist-200'
            }`}
          >
            <t.icon className={`size-4 shrink-0 ${on ? 'text-nova-200' : ''}`} />
            <span className="truncate">{t.label}</span>
            {!!t.badge && (
              <span className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[0.58rem] font-black text-ink-950 sm:static sm:h-5 sm:min-w-5 sm:text-[0.64rem]">{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------- chat */
type Upload = {key: string; name: string; stage: string; fraction?: number; material?: AttachedMaterial; error?: string};

function Chat({status, course, onProposal, onTask, onUsed, queued, onQueuedUsed}: {
  status: AIStaffStatus | null; course: Course | null; onProposal: (id: number) => void; onTask: (id: number) => void; onUsed: () => void; queued: string | null; onQueuedUsed: () => void;
}) {
  const {toast} = useSession();
  const [turns, setTurns] = useState<AgentTurn[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(THREAD_KEY) || '[]') as AgentTurn[];
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [student, setStudent] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = !!status?.configured;

  useEffect(() => {
    sessionStorage.setItem(THREAD_KEY, JSON.stringify(turns.slice(-30)));
    const el = scroller.current;
    if (el) el.scrollTo({top: el.scrollHeight, behavior: 'smooth'});
  }, [turns, busy]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const uploading = uploads.some((u) => !u.material && !u.error);
  const attached = uploads.filter((u) => u.material).map((u) => u.material as AttachedMaterial);

  const addFiles = (list: FileList | File[] | null | undefined) => {
    const files = Array.from(list ?? []).slice(0, 5);
    if (!files.length) return;
    if (!course) {
      toast('info', 'Pick a course first', 'Attached files are saved into the selected course as draft materials.');
      return;
    }
    for (const file of files) {
      const key = `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 6)}`;
      setUploads((u) => [...u, {key, name: file.name, stage: 'Uploading', fraction: 0}]);
      attachFile(file, course.id, (stage, fraction) => setUploads((u) => u.map((x) => (x.key === key ? {...x, stage, fraction} : x))))
        .then((material) => setUploads((u) => u.map((x) => (x.key === key ? {...x, material, stage: 'Attached'} : x))))
        .catch((e) => {
          setUploads((u) => u.map((x) => (x.key === key ? {...x, error: errText(e)} : x)));
          toast('error', `Couldn't attach ${file.name}`, errText(e));
        });
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const send = useCallback(async (text: string, history?: AgentTurn[], files: AttachedMaterial[] = []) => {
    let content = text.trim();
    if ((!content && !files.length) || busy) return;
    const display = content;
    if (!content) content = 'I attached a file. Tell me briefly what it covers and what we can build from it for this course.';
    if (files.length) {
      content += '\n\n' + files.map((f) => `[Attached file "${f.filename}" — saved in ${course?.code ?? 'the course'} as draft material #${f.id} "${f.title}"${f.words ? `, about ${f.words} words` : ''}. Use material_id ${f.id}.]`).join('\n');
    }
    const base = history ?? turns;
    const next: AgentTurn[] = [...base, {role: 'user', content, display: files.length ? display || 'Sent a file' : undefined, files: files.length ? files.map((f) => ({id: f.id, title: f.title, words: f.words})) : undefined, meta: {at: new Date().toISOString()}}];
    setTurns(next);
    setDraft('');
    if (files.length) setUploads((u) => u.filter((x) => !x.material));
    setBusy(true);
    const started = performance.now();
    try {
      const res = await aiStaffApi.chat(next.filter((t) => !t.failed).slice(-12).map(({role, content: c}) => ({role, content: c})), course?.id ?? null);
      setTurns((list) => [...list, {role: 'assistant', content: res.reply, tools: res.tools, actions: res.actions, meta: {cost: res.usage?.cost, ms: Math.round(performance.now() - started), at: new Date().toISOString()}}]);
    } catch (e) {
      setTurns((list) => [...list, {role: 'assistant', content: errText(e), failed: true}]);
      toast('error', 'Assistant unavailable', errText(e));
    } finally {
      setBusy(false);
      onUsed();
    }
  }, [busy, turns, course, toast, onUsed]);
  const submit = () => { if (!uploading) void send(draft, undefined, attached); };

  useEffect(() => {
    if (!queued || busy) return;
    if (ready) void send(queued);
    else setDraft(queued);
    onQueuedUsed();
  }, [queued, ready, busy, send, onQueuedUsed]);

  const retry = (index: number) => {
    const prior = turns.slice(0, index);
    const lastUser = [...prior].reverse().find((t) => t.role === 'user');
    if (!lastUser) return;
    const cut = prior.lastIndexOf(lastUser);
    void send(lastUser.content, turns.slice(0, cut));
  };
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast('success', 'Copied'), () => toast('error', "Couldn't copy"));
  };
  const lastAssistant = turns.length > 0 && turns[turns.length - 1].role === 'assistant' && !turns[turns.length - 1].failed;
  const scope = course ? course.code : 'all courses';

  return (
    <div
      className="relative min-w-0"
      onDragOver={(e: DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e: DragEvent) => { e.preventDefault(); setDragging(false); if (ready) addFiles(e.dataTransfer.files); }}
    >
    <Card className={`relative flex h-[min(44rem,calc(100dvh-9rem))] min-h-[30rem] min-w-0 flex-col overflow-hidden p-0 ${dragging ? 'ring-2 ring-nova-400/60' : ''}`}>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-ink-950/75 backdrop-blur-sm">
          <p className="flex items-center gap-2 rounded-2xl border border-nova-400/40 bg-nova-500/15 px-4 py-3 text-[0.9rem] font-extrabold text-white"><Paperclip className="size-5" /> Drop to attach to {course?.code ?? 'the course'}</p>
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2 border-b border-white/6 bg-white/[0.02] px-3 py-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-nova-400 to-pulse-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"><Sparkles className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.84rem] font-extrabold text-mist-50">Staff assistant</p>
          <p className="truncate text-[0.66rem] font-semibold text-mist-500">{busy ? 'Working through the platform tools…' : `Scoped to ${scope}`}</p>
        </div>
        {turns.length > 0 && (
          <Button size="sm" variant="ghost" icon={<MessageSquarePlus className="size-4" />} label="New conversation" onClick={() => setTurns([])} disabled={busy} />
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4">
        {turns.length === 0 && (
          <div className="mx-auto max-w-2xl">
            <div className="text-center">
              <span className="relative mx-auto grid size-14 place-items-center rounded-[1.2rem] bg-gradient-to-br from-nova-400/30 via-pulse-500/20 to-transparent text-nova-100 ring-1 ring-nova-400/30">
                <Wand2 className="size-7" />
              </span>
              <p className="font-display mt-2.5 text-[1.05rem] font-extrabold text-mist-50">What should we work on{course ? ` in ${course.code}` : ''}?</p>
              <p className="mx-auto mt-1 max-w-md text-[0.78rem] text-mist-400">
                I read courses, materials, the question bank and results through safe tools. Anything I draft waits in <b className="text-mist-200">Review</b> for your approval.
              </p>
            </div>
            <div className="mt-4 grid gap-2.5 md:grid-cols-3">
              {PLAYBOOKS.map((book) => (
                <div key={book.title} className="min-w-0 rounded-2xl border border-white/8 bg-white/[0.025] p-2">
                  <p className="mb-1.5 flex items-center gap-2 px-1 text-[0.7rem] font-extrabold tracking-[0.1em] text-mist-300 uppercase">
                    <ToneIcon tone={book.tone} icon={book.icon} size="sm" /> {book.title}
                  </p>
                  <div className="space-y-1">
                    {book.plays.map((play) => (
                      <button
                        key={play.label}
                        onClick={() => void send(play.prompt)}
                        disabled={!ready || busy}
                        title={play.prompt}
                        className="group flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[0.78rem] font-bold text-mist-200 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="min-w-0 flex-1 truncate">{play.label}</span>
                        <ArrowUp className="size-3.5 shrink-0 rotate-45 text-mist-600 transition group-hover:text-nova-300" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <form
              className="mt-2.5 flex min-w-0 items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.025] p-2"
              onSubmit={(e) => { e.preventDefault(); if (student.trim()) void send(`Give me a learning report for the student "${student.trim()}"${course ? ` in ${course.code}` : ''}: weak and strong topics, recent scores, and what I should do to help.`); setStudent(''); }}
            >
              <ToneIcon tone="gold" icon={UserSearch} size="sm" />
              <input
                value={student}
                onChange={(e) => setStudent(e.target.value)}
                placeholder="Look up a student — name, username or phone"
                className="min-w-0 flex-1 bg-transparent text-[0.8rem] font-semibold text-mist-100 outline-none placeholder:text-mist-500"
                disabled={!ready || busy}
                aria-label="Student to look up"
              />
              <Button size="sm" variant="soft" type="submit" disabled={!ready || busy || !student.trim()}>Report</Button>
            </form>
            {status && !ready && (
              <p className="mt-3 flex items-center justify-center gap-1.5 text-[0.76rem] font-bold text-flare-300"><AlertTriangle className="size-4" /> Connect an AI key under Models to start.</p>
            )}
          </div>
        )}

        {turns.map((turn, i) => turn.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[88%] rounded-2xl rounded-br-md bg-gradient-to-br from-nova-500/45 to-pulse-600/35 px-3.5 py-2 text-[0.86rem] whitespace-pre-wrap text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] [overflow-wrap:anywhere]">
              {turn.files?.length ? (
                <span className="mb-1.5 flex flex-wrap justify-end gap-1">
                  {turn.files.map((f) => (
                    <span key={f.id} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-black/25 px-2 py-1 text-[0.7rem] font-bold"><FileText className="size-3.5 shrink-0" /><span className="truncate">{f.title}</span></span>
                  ))}
                </span>
              ) : null}
              {turn.display ?? turn.content}
            </div>
          </div>
        ) : (
          <div key={i} className="flex min-w-0 gap-2.5">
            <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl text-white ${turn.failed ? 'bg-flare-500/70' : 'bg-gradient-to-br from-nova-400 to-pulse-500'}`}>
              {turn.failed ? <AlertTriangle className="size-4" /> : <Bot className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`min-w-0 rounded-2xl rounded-tl-md border px-3.5 py-2.5 ${turn.failed ? 'border-flare-400/30 bg-flare-500/[0.07]' : 'border-white/8 bg-white/[0.035]'}`}>
                {turn.tools && turn.tools.length > 0 && <ToolTrail tools={turn.tools as ToolEvent[]} />}
                <div className="min-w-0 text-[0.86rem] [overflow-wrap:anywhere]"><Markdown text={turn.content} /></div>
              </div>
              {(turn.actions ?? []).filter((a): a is TaskCard => a.type === 'task').map((t) => <TaskInline key={`t${t.id}`} id={t.id} onOpen={onTask} />)}
              {(turn.actions ?? []).filter((a): a is ProposalCard => a.type === 'proposal').map((p) => {
                const K = KIND[p.kind] ?? {label: p.kind, icon: Sparkles, tone: 'nova' as Tone};
                return (
                  <button key={p.id} onClick={() => onProposal(p.id)} className="mt-2 flex w-full min-w-0 items-center gap-3 rounded-2xl border border-amber-400/30 bg-gradient-to-r from-amber-500/[0.10] to-amber-500/[0.03] px-3 py-2.5 text-left transition hover:border-amber-400/50">
                    <ToneIcon tone="amber" icon={K.icon} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.6rem] font-extrabold tracking-[0.14em] text-amber-200/85 uppercase">Needs approval · {p.count} {K.label.toLowerCase()}</span>
                      <span className="block truncate text-[0.84rem] font-bold text-mist-50">{p.title}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-amber-400 px-3 py-1 text-[0.7rem] font-black text-ink-950">Review</span>
                  </button>
                );
              })}
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-1 text-[0.64rem] font-bold text-mist-500">
                {turn.failed ? (
                  <button onClick={() => retry(i)} disabled={busy} className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-flare-200 hover:bg-white/[0.06]"><RotateCcw className="size-3" /> Try again</button>
                ) : (
                  <>
                    {!!turn.tools?.length && <span>{turn.tools.length} tool{turn.tools.length === 1 ? '' : 's'}</span>}
                    {turn.meta?.ms != null && <span>{(turn.meta.ms / 1000).toFixed(1)}s</span>}
                    {turn.meta?.cost != null && <span>{money(turn.meta.cost, 4)}</span>}
                    <button onClick={() => copy(turn.content)} className="flex items-center gap-1 rounded-full px-1.5 py-0.5 hover:bg-white/[0.06] hover:text-mist-200" aria-label="Copy reply"><Copy className="size-3" /> Copy</button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-nova-400 to-pulse-500 text-white"><Loader2 className="size-4 animate-spin" /></span>
            <div className="rounded-2xl rounded-tl-md border border-white/8 bg-white/[0.035] px-3.5 py-2.5">
              <p className="text-[0.78rem] font-bold text-mist-300">Checking the platform…</p>
              <div className="mt-1.5 flex gap-1">
                {[0, 1, 2].map((d) => <span key={d} className="size-1.5 animate-bounce rounded-full bg-nova-300" style={{animationDelay: `${d * 140}ms`}} />)}
              </div>
            </div>
          </div>
        )}

        {lastAssistant && !busy && (
          <div className="flex flex-wrap gap-1.5 pl-10">
            {FOLLOW_UPS.map((f) => (
              <button key={f} onClick={() => void send(f)} disabled={!ready} className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[0.7rem] font-bold text-mist-300 transition hover:border-nova-400/40 hover:text-white disabled:opacity-40">{f}</button>
            ))}
          </div>
        )}
      </div>

      <form className="border-t border-white/6 bg-black/15 p-2.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {uploads.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {uploads.map((u) => (
              <span key={u.key} className={`relative inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-xl border py-1 pr-1 pl-2 text-[0.72rem] font-bold ${u.error ? 'border-flare-400/40 bg-flare-500/10 text-flare-100' : u.material ? 'border-mint-400/35 bg-mint-500/10 text-mint-100' : 'border-white/12 bg-white/[0.04] text-mist-200'}`} title={u.error || u.name}>
                {u.error ? <AlertTriangle className="size-3.5 shrink-0" /> : u.material ? <FileText className="size-3.5 shrink-0" /> : <Loader2 className="size-3.5 shrink-0 animate-spin" />}
                <span className="max-w-[11rem] truncate">{u.material?.title ?? u.name}</span>
                <span className="shrink-0 text-[0.62rem] font-semibold opacity-75">{u.error ? 'failed' : u.material ? `#${u.material.id}` : `${u.stage}…`}</span>
                <button type="button" onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))} className="grid size-5 shrink-0 place-items-center rounded-md hover:bg-white/10" aria-label={`Remove ${u.name}`}><X className="size-3" /></button>
                {!u.material && !u.error && u.fraction != null && u.stage === 'Uploading' && <span className="absolute bottom-0 left-0 h-0.5 bg-nova-400" style={{width: `${u.fraction * 100}%`}} />}
              </span>
            ))}
          </div>
        )}
        <div className={`flex min-w-0 items-end gap-1.5 rounded-2xl border bg-white/[0.035] p-1.5 pl-1.5 transition focus-within:border-nova-400/50 ${ready ? 'border-white/10' : 'border-white/6 opacity-70'}`}>
          <input ref={fileInput} type="file" multiple accept={IMPORT_ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <Button type="button" variant="ghost" icon={<Paperclip className="size-4" />} label={course ? `Attach a file to ${course.code} (PDF, Word, slides…)` : 'Pick a course to attach files'} onClick={() => (course ? fileInput.current?.click() : addFiles([]))} disabled={!ready || busy} />
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            rows={1}
            maxLength={4000}
            placeholder={ready ? (attached.length ? 'What should I do with this file?' : `Ask about ${scope}…`) : 'Connect an AI key to chat'}
            className="max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-transparent py-2 text-[0.86rem] text-mist-50 outline-none placeholder:text-mist-500"
            disabled={!ready}
            aria-label="Message the assistant"
          />
          <Button type="submit" icon={<ArrowUp className="size-4" />} label="Send" disabled={(!draft.trim() && !attached.length) || busy || !ready || uploading} loading={busy} />
        </div>
        <p className="mt-1 hidden px-1 text-[0.62rem] font-semibold text-mist-600 sm:block">Enter to send · Attach or drop files (PDF, Word, slides) · Big jobs run as background tasks · Drafts wait for your approval.</p>
      </form>
    </Card>
    </div>
  );
}

/* -------------------------------------------------------------------- rail */
function Rail({status, course, refreshKey, onAsk, onInsights}: {
  status: AIStaffStatus | null; course: Course | null; refreshKey: number; onAsk: (prompt: string) => void; onInsights: () => void;
}) {
  const [data, setData] = useState<AIInsights | null>(null);
  useEffect(() => {
    setData(null);
    if (!course) return;
    aiStaffApi.insights(course.id).then(setData).catch(() => setData(null));
  }, [course, refreshKey]);
  const tools = status?.tools.staff ?? [];
  return (
    <aside className="hidden min-w-0 space-y-3 xl:block">
      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[0.76rem] font-extrabold text-mist-200"><Radar className="size-3.5 text-nova-300" /> Course health</p>
          <button onClick={onInsights} className="text-[0.68rem] font-bold text-nova-300 hover:text-nova-200">Open insights</button>
        </div>
        {!course ? (
          <p className="py-3 text-center text-[0.74rem] text-mist-500">Pick a course above to see its health.</p>
        ) : !data || data.score == null ? <Skeleton className="h-36" /> : (
          <>
            <div className="flex items-center gap-3">
              <ProgressRing value={data.score} size={64} stroke={6}>
                <span className="text-[1rem] font-black text-mist-50 tabular-nums">{data.score}</span>
              </ProgressRing>
              <div className="min-w-0">
                <p className={`text-[0.86rem] font-extrabold ${scoreLabel(data.score).tone}`}>{scoreLabel(data.score).label}</p>
                <p className="truncate text-[0.68rem] text-mist-500">{data.bank?.total ?? 0} questions · {data.topics ?? 0} topics · {data.materials?.total ?? 0} materials</p>
              </div>
            </div>
            <div className="mt-2.5 space-y-1.5">
              {(data.issues ?? []).slice(0, 3).map((issue) => (
                <div key={issue.id} className="rounded-xl border border-white/6 bg-white/[0.025] p-2">
                  <p className="flex min-w-0 items-center gap-1.5 text-[0.74rem] font-bold text-mist-100">
                    <span className={`size-1.5 shrink-0 rounded-full ${SEVERITY[issue.severity].dot}`} />
                    <span className="truncate">{issue.title}</span>
                  </p>
                  <button onClick={() => onAsk(issue.prompt)} className="mt-1 flex items-center gap-1 text-[0.68rem] font-extrabold text-nova-300 hover:text-nova-200">
                    <Sparkles className="size-3" /> {issue.action}
                  </button>
                </div>
              ))}
              {(data.issues ?? []).length === 0 && <p className="flex items-center gap-1.5 text-[0.74rem] font-bold text-mint-300"><CheckCircle2 className="size-4" /> Nothing needs attention.</p>}
            </div>
          </>
        )}
      </Card>
      <Card className="p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[0.76rem] font-extrabold text-mist-200"><Target className="size-3.5 text-pulse-300" /> What I can do</p>
        <div className="flex flex-wrap gap-1">
          {tools.length ? tools.map((t) => (
            <span key={t} className={`rounded-lg border px-2 py-0.5 text-[0.66rem] font-bold ${t.startsWith('propose_') ? 'border-amber-400/25 bg-amber-500/[0.07] text-amber-200' : 'border-white/8 bg-white/[0.03] text-mist-300'}`}>{toolName(t)}</span>
          )) : <Skeleton className="h-14 w-full" />}
        </div>
        <p className="mt-2 text-[0.64rem] text-mist-500"><span className="text-amber-200">Amber</span> tools only create proposals. There are no delete, publish, grading or permission tools.</p>
      </Card>
    </aside>
  );
}

/* ---------------------------------------------------------------- insights */
function Insights({courseId, onCourse, onAsk, refreshKey}: {courseId: number | null; onCourse: (id: number | null) => void; onAsk: (prompt: string) => void; refreshKey: number}) {
  const [data, setData] = useState<AIInsights | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setData(null);
    setError('');
    aiStaffApi.insights(courseId).then(setData).catch((e) => setError(errText(e)));
  }, [courseId]);
  useEffect(load, [load, refreshKey]);

  if (error) return <Card className="p-6 text-center text-[0.84rem] text-flare-200">{error} <button className="ml-2 font-bold underline" onClick={load}>Retry</button></Card>;
  if (!data) return <div className="grid gap-3 lg:grid-cols-3"><Skeleton className="h-44" /><Skeleton className="h-44 lg:col-span-2" /><Skeleton className="h-56 lg:col-span-3" /></div>;

  if (!courseId || data.score == null) {
    return (
      <div className="space-y-2.5">
        <FreeNote />
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {data.courses.map((c) => (
            <button key={c.id} onClick={() => onCourse(c.id)} className="group min-w-0 rounded-2xl border border-white/8 bg-white/[0.03] p-3.5 text-left transition hover:-translate-y-0.5 hover:border-nova-400/40 hover:bg-white/[0.05]">
              <div className="flex min-w-0 items-center gap-2.5">
                <ToneIcon tone="nova" icon={BookOpen} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.88rem] font-extrabold text-mist-50">{c.code}</span>
                  <span className="block truncate text-[0.7rem] text-mist-500">{c.title}</span>
                </span>
                {c.pending > 0 && <span className="shrink-0 rounded-full bg-amber-400 px-2 py-0.5 text-[0.62rem] font-black text-ink-950">{c.pending} to review</span>}
              </div>
              <div className="mt-3 grid grid-cols-4 gap-1 text-center">
                {([['Questions', c.bank], ['Topics', c.topics], ['Materials', c.materials], ['Attempts', c.attempts]] as const).map(([k, v]) => (
                  <span key={k} className="rounded-lg bg-black/20 px-1 py-1.5">
                    <span className="block text-[0.9rem] font-black text-mist-50 tabular-nums">{formatNumber(v)}</span>
                    <span className="block truncate text-[0.56rem] font-extrabold tracking-wide text-mist-500 uppercase">{k}</span>
                  </span>
                ))}
              </div>
              <span className="mt-2.5 flex items-center gap-1 text-[0.7rem] font-extrabold text-nova-300 group-hover:text-nova-200"><Radar className="size-3.5" /> Run health check</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const score = data.score;
  const issues = data.issues ?? [];
  const sev = {high: 0, medium: 0, low: 0};
  issues.forEach((i) => { sev[i.severity] += 1; });
  const bank = data.bank!;
  const levels = ['easy', 'medium', 'hard'] as const;
  const levelTone: Record<string, string> = {easy: 'bg-mint-400', medium: 'bg-amber-400', hard: 'bg-flare-400'};
  const maxCov = Math.max(1, ...(data.coverage ?? []).map((c) => c.questions));
  const perf = data.performance!;

  return (
    <div className="min-w-0 space-y-3">
      <FreeNote onRefresh={load} />
      <div className="grid min-w-0 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="relative overflow-hidden p-4">
          <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-40 rounded-full bg-nova-500/15 blur-3xl" />
          <p className="text-[0.62rem] font-extrabold tracking-[0.16em] text-mist-500 uppercase">{data.course?.code} · health score</p>
          <div className="mt-2 flex items-center gap-4">
            <ProgressRing value={score} size={96} stroke={9}>
              <span className="text-center">
                <span className="block text-[1.6rem] leading-none font-black text-mist-50 tabular-nums">{score}</span>
                <span className="block text-[0.56rem] font-extrabold tracking-widest text-mist-500">/ 100</span>
              </span>
            </ProgressRing>
            <div className="min-w-0">
              <p className={`text-[1.05rem] font-extrabold ${scoreLabel(score).tone}`}>{scoreLabel(score).label}</p>
              <div className="mt-1.5 space-y-0.5 text-[0.72rem] font-bold">
                {(['high', 'medium', 'low'] as const).map((k) => (
                  <p key={k} className="flex items-center gap-1.5 text-mist-400"><span className={`size-2 rounded-full ${SEVERITY[k].dot}`} /> {sev[k]} {SEVERITY[k].label.toLowerCase()}</p>
                ))}
              </div>
            </div>
          </div>
        </Card>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <Kpi icon={FileQuestion} tone="nova" label="Questions" value={formatNumber(bank.total)} sub={bank.drafts ? `${bank.drafts} drafts` : 'in the bank'} />
          <Kpi icon={ListTree} tone="cyan" label="Topics" value={formatNumber(data.topics ?? 0)} sub={`${(data.coverage ?? []).filter((c) => !c.curated).length} uncurated`} />
          <Kpi icon={BookOpen} tone="pulse" label="Materials" value={formatNumber(data.materials?.total ?? 0)} sub={`${data.materials?.published ?? 0} published`} />
          <Kpi icon={ClipboardCheck} tone="gold" label="Exams" value={formatNumber(data.exams?.total ?? 0)} sub={`${data.exams?.live ?? 0} active`} />
          <Kpi className="col-span-2 sm:col-span-1" icon={GraduationCap} tone="mint" label="Attempts" value={formatNumber(perf.attempts)} sub={perf.attempts ? `${Math.round(perf.average)}% average` : 'no results yet'} />
        </div>
      </div>

      <Card className="p-3 sm:p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[0.84rem] font-extrabold text-mist-100"><AlertTriangle className="size-4 text-amber-300" /> What needs attention</p>
          <span className="text-[0.68rem] font-bold text-mist-500">{issues.length} finding{issues.length === 1 ? '' : 's'}</span>
        </div>
        {issues.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-mint-400/25 bg-mint-500/[0.06] p-3">
            <ToneIcon tone="mint" icon={CheckCircle2} />
            <div><p className="text-[0.86rem] font-extrabold text-mint-100">All clear</p><p className="text-[0.74rem] text-mist-400">No gaps found in the bank, topics or results for this course.</p></div>
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {issues.map((issue) => (
              <div key={issue.id} className="flex min-w-0 items-start gap-2.5 rounded-2xl border border-white/8 bg-white/[0.025] p-3">
                <ToneIcon tone={SEVERITY[issue.severity].tone} icon={issue.severity === 'high' ? AlertTriangle : issue.severity === 'medium' ? Target : Sparkles} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <p className="min-w-0 text-[0.84rem] font-extrabold text-mist-50">{issue.title}</p>
                    <span className={`rounded-full border px-1.5 py-px text-[0.56rem] font-black tracking-wider uppercase ${SEVERITY[issue.severity].pill}`}>{SEVERITY[issue.severity].label}</span>
                  </div>
                  <p className="mt-0.5 text-[0.74rem] text-mist-400 [overflow-wrap:anywhere]">{issue.detail}</p>
                  <button onClick={() => onAsk(issue.prompt)} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-nova-500/25 to-pulse-500/20 px-3 py-1 text-[0.72rem] font-extrabold text-white ring-1 ring-nova-400/35 transition hover:ring-nova-300/70">
                    <Sparkles className="size-3.5" /> {issue.action}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <Card className="min-w-0 p-3 sm:p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-[0.84rem] font-extrabold text-mist-100"><ListTree className="size-4 text-cyan-300" /> Topic coverage</p>
          {(data.coverage ?? []).length === 0 ? <p className="py-6 text-center text-[0.78rem] text-mist-500">No topics yet.</p> : (
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {(data.coverage ?? []).map((c) => (
                <div key={c.topic} className="flex min-w-0 items-center gap-2">
                  <span className="w-[42%] min-w-0 truncate text-[0.74rem] font-bold text-mist-200" title={c.topic}>
                    {c.topic}{!c.curated && <span className="ml-1 text-[0.6rem] font-extrabold text-amber-300/80" title="Used by questions but not in the topic list">•</span>}
                  </span>
                  <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <span className={`absolute inset-y-0 left-0 rounded-full ${c.questions === 0 ? '' : c.questions < 5 ? 'bg-amber-400/80' : 'bg-gradient-to-r from-cyan-400 to-nova-400'}`} style={{width: `${(c.questions / maxCov) * 100}%`}} />
                  </span>
                  <span className={`w-7 shrink-0 text-right text-[0.72rem] font-black tabular-nums ${c.questions === 0 ? 'text-flare-300' : 'text-mist-300'}`}>{c.questions}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[0.64rem] text-mist-500"><span className="text-amber-300">•</span> not in the curated topic list · amber bars have fewer than 5 questions</p>
        </Card>
        <Card className="min-w-0 p-3 sm:p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-[0.84rem] font-extrabold text-mist-100"><Layers className="size-4 text-pulse-300" /> Difficulty & status</p>
          <div className="flex h-3.5 overflow-hidden rounded-full bg-white/[0.06]">
            {levels.map((l) => bank.total ? <span key={l} className={levelTone[l]} style={{width: `${((bank.by_difficulty[l] ?? 0) / bank.total) * 100}%`}} /> : null)}
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {levels.map((l) => (
              <div key={l} className="rounded-xl border border-white/6 bg-white/[0.025] px-2.5 py-2">
                <p className="flex items-center gap-1.5 text-[0.64rem] font-extrabold tracking-wide text-mist-500 uppercase"><span className={`size-2 rounded-full ${levelTone[l]}`} />{l}</p>
                <p className="text-[1rem] font-black text-mist-50 tabular-nums">{bank.by_difficulty[l] ?? 0}<span className="ml-1 text-[0.68rem] font-bold text-mist-500">{bank.total ? Math.round(((bank.by_difficulty[l] ?? 0) / bank.total) * 100) : 0}%</span></p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Object.entries(bank.by_status).map(([k, v]) => (
              <span key={k} className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-0.5 text-[0.68rem] font-bold text-mist-300 capitalize">{k} <b className="text-mist-50 tabular-nums">{v}</b></span>
            ))}
            {bank.flagged > 0 && <span className="rounded-full border border-flare-400/30 bg-flare-500/10 px-2.5 py-0.5 text-[0.68rem] font-bold text-flare-200">flagged <b>{bank.flagged}</b></span>}
          </div>
        </Card>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <Card className="min-w-0 p-3 sm:p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-[0.84rem] font-extrabold text-mist-100"><GraduationCap className="size-4 text-mint-300" /> Class accuracy by topic</p>
          {perf.topics.length === 0 ? (
            <p className="py-6 text-center text-[0.78rem] text-mist-500">No exam results yet — this fills in as students finish exams.</p>
          ) : (
            <div className="space-y-1.5">
              {perf.topics.map((t) => {
                const acc = t.accuracy ?? 0;
                return (
                  <div key={t.topic} className="flex min-w-0 items-center gap-2">
                    <span className="w-[42%] min-w-0 truncate text-[0.74rem] font-bold text-mist-200">{t.topic}</span>
                    <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <span className={`absolute inset-y-0 left-0 rounded-full ${acc < 50 ? 'bg-flare-400' : acc < 70 ? 'bg-amber-400' : 'bg-mint-400'}`} style={{width: `${acc}%`}} />
                    </span>
                    <span className="w-10 shrink-0 text-right text-[0.72rem] font-black text-mist-300 tabular-nums">{t.accuracy == null ? '—' : `${Math.round(acc)}%`}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card className="min-w-0 p-3 sm:p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-[0.84rem] font-extrabold text-mist-100"><Target className="size-4 text-flare-300" /> Questions to look at</p>
          {perf.flagged.length === 0 && (data.most_missed ?? []).length === 0 ? (
            <p className="py-6 text-center text-[0.78rem] text-mist-500">Nothing flagged. Question statistics appear after students answer.</p>
          ) : (
            <div className="space-y-1.5">
              {perf.flagged.map((q) => (
                <div key={`f${q.id}`} className="rounded-xl border border-white/6 bg-white/[0.025] px-2.5 py-2">
                  <p className="line-clamp-2 text-[0.76rem] font-semibold text-mist-100"><span className="text-mist-500">#{q.id}</span> {q.text}</p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {q.flags.map((f) => <span key={f} className="rounded-md bg-flare-500/12 px-1.5 py-px text-[0.6rem] font-extrabold text-flare-200">{f.replace(/_/g, ' ')}</span>)}
                    <span className="text-[0.62rem] font-bold text-mist-500">{Math.round((q.correct_rate ?? 0) * 100)}% correct</span>
                  </p>
                </div>
              ))}
              {perf.flagged.length === 0 && (data.most_missed ?? []).map((q) => (
                <div key={`m${q.id}`} className="rounded-xl border border-white/6 bg-white/[0.025] px-2.5 py-2">
                  <p className="line-clamp-2 text-[0.76rem] font-semibold text-mist-100"><span className="text-mist-500">#{q.id}</span> {q.text}</p>
                  <p className="mt-0.5 text-[0.62rem] font-bold text-mist-500">{q.wrong} wrong answers</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function FreeNote({onRefresh}: {onRefresh?: () => void}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-mint-400/20 bg-mint-500/[0.05] px-3 py-2 text-[0.72rem] font-bold text-mint-100">
      <Zap className="size-4 shrink-0 text-mint-300" />
      <span className="min-w-0 flex-1">Computed from your data. No AI credit used. “Fix with AI” sends a ready prompt to the assistant.</span>
      {onRefresh && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} label="Refresh insights" onClick={onRefresh} />}
    </div>
  );
}

function Kpi({icon, tone, label, value, sub, className = ''}: {icon: typeof Tags; tone: Tone; label: string; value: string; sub: string; className?: string}) {
  return (
    <div className={`min-w-0 rounded-2xl border border-white/8 bg-white/[0.03] p-3 ${className}`}>
      <ToneIcon tone={tone} icon={icon} size="sm" />
      <p className="mt-2 text-[1.3rem] leading-none font-black text-mist-50 tabular-nums">{value}</p>
      <p className="mt-1 truncate text-[0.62rem] font-extrabold tracking-[0.12em] text-mist-400 uppercase">{label}</p>
      <p className="truncate text-[0.66rem] text-mist-500">{sub}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ review */
function Review({onOpen}: {onOpen: (id: number) => void}) {
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [kind, setKind] = useState<string>('all');
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [all, setAll] = useState<Proposal[]>([]);
  const load = useCallback(() => {
    setRows(null);
    aiStaffApi.proposals(filter).then((r) => setRows(r.proposals)).catch(() => setRows([]));
    aiStaffApi.proposals('all').then((r) => setAll(r.proposals)).catch(() => undefined);
  }, [filter]);
  useEffect(load, [load]);
  const counts = useMemo(() => ({
    pending: all.filter((p) => p.status === 'pending').length,
    approved: all.filter((p) => p.status === 'approved').length,
    rejected: all.filter((p) => p.status === 'rejected').length,
  }), [all]);
  const shown = (rows ?? []).filter((p) => kind === 'all' || p.kind === kind);

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="grid grid-cols-3 gap-2">
        {([['pending', 'Waiting', 'amber', ClipboardCheck], ['approved', 'Approved', 'mint', CheckCircle2], ['rejected', 'Rejected', 'flare', XCircle]] as const).map(([id, label, tone, Icon]) => (
          <button key={id} onClick={() => setFilter(id)} className={`min-w-0 rounded-2xl border p-2.5 text-left transition sm:p-3 ${filter === id ? 'border-nova-400/50 bg-nova-500/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.05]'}`}>
            <div className="flex items-center gap-2">
              <ToneIcon tone={tone} icon={Icon} size="sm" className="hidden sm:grid" />
              <span className="min-w-0">
                <span className="block text-[1.2rem] leading-none font-black text-mist-50 tabular-nums">{counts[id]}</span>
                <span className="block truncate text-[0.64rem] font-extrabold tracking-wide text-mist-400 uppercase">{label}</span>
              </span>
            </div>
          </button>
        ))}
      </div>
      <Card className="min-w-0 p-2 sm:p-3">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5 px-1">
          <Filter className="size-3.5 text-mist-500" />
          {['all', ...Object.keys(KIND)].map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`rounded-full border px-2.5 py-1 text-[0.7rem] font-bold capitalize transition ${kind === k ? 'border-nova-400/50 bg-nova-500/15 text-white' : 'border-white/8 text-mist-400 hover:text-mist-200'}`}>
              {k === 'all' ? 'All kinds' : KIND[k].label}
            </button>
          ))}
          <Button size="sm" variant="ghost" className="ml-auto" icon={<RefreshCw className="size-3.5" />} label="Refresh" onClick={load} />
        </div>
        {!rows ? <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : shown.length === 0 ? (
          <div className="py-10 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/[0.04] text-mist-500"><Inbox className="size-7" /></span>
            <p className="mt-2.5 text-[0.9rem] font-extrabold text-mist-200">{filter === 'pending' ? 'Nothing waiting for review' : `No ${filter} proposals`}</p>
            <p className="mx-auto max-w-xs text-[0.74rem] text-mist-500">Ask the assistant to draft questions, topics or classifications. Drafts land here first.</p>
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {shown.map((p) => {
              const K = KIND[p.kind] ?? {label: p.kind, icon: Sparkles, tone: 'nova' as Tone};
              return (
                <button key={p.id} onClick={() => onOpen(p.id)} className="group flex min-w-0 items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3 text-left transition hover:border-white/16 hover:bg-white/[0.05]">
                  <ToneIcon tone={K.tone} icon={K.icon} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.86rem] font-extrabold text-mist-50">{p.title}</span>
                    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[0.68rem] font-semibold text-mist-500">
                      <span className="rounded-md bg-white/[0.06] px-1.5 py-px font-extrabold text-mist-300">{p.count} item{p.count === 1 ? '' : 's'}</span>
                      <span>{K.label}</span>
                      {p.course && <span>· {p.course}</span>}
                      {p.created_at && <span>· {formatRelative(p.created_at)}</span>}
                    </span>
                  </span>
                  <StatusPill status={p.status} />
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- activity */
function Activity() {
  const [rows, setRows] = useState<ToolCallRow[] | null>(null);
  const [status, setStatus] = useState('all');
  const [actor, setActor] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => {
    setRows(null);
    aiStaffApi.toolCalls(300).then((r) => setRows(r.calls)).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  const stats = useMemo(() => {
    const list = rows ?? [];
    const tools: Record<string, number> = {};
    list.forEach((r) => { tools[r.tool] = (tools[r.tool] ?? 0) + 1; });
    return {
      total: list.length,
      ok: list.filter((r) => r.status === 'ok').length,
      denied: list.filter((r) => r.status === 'denied').length,
      avg: list.length ? Math.round(list.reduce((a, r) => a + (r.ms || 0), 0) / list.length) : 0,
      top: Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, [rows]);
  const shown = (rows ?? []).filter((r) =>
    (status === 'all' || (status === 'error' ? !['ok', 'denied'].includes(r.status) : r.status === status)) &&
    (actor === 'all' || (actor === 'staff' ? !!r.admin_id : !r.admin_id)) &&
    (!q.trim() || `${r.tool} ${r.summary}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const topMax = Math.max(1, ...stats.top.map(([, n]) => n));

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi icon={History} tone="nova" label="Tool calls" value={formatNumber(stats.total)} sub="latest 300" />
        <Kpi icon={CheckCircle2} tone="mint" label="Succeeded" value={stats.total ? `${Math.round((stats.ok / stats.total) * 100)}%` : '—'} sub={`${stats.ok} ok`} />
        <Kpi icon={ShieldCheck} tone="flare" label="Blocked" value={formatNumber(stats.denied)} sub="permission checks" />
        <Kpi icon={Zap} tone="gold" label="Avg time" value={`${formatNumber(stats.avg)} ms`} sub="per tool call" />
      </div>
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <Card className="min-w-0 p-2 sm:p-3">
          <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5 px-1">
            <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 sm:max-w-[16rem]">
              <Search className="size-3.5 shrink-0 text-mist-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools" className="min-w-0 flex-1 bg-transparent text-[0.76rem] text-mist-100 outline-none placeholder:text-mist-500" aria-label="Search tool calls" />
              {q && <button onClick={() => setQ('')} aria-label="Clear search"><X className="size-3.5 text-mist-500" /></button>}
            </label>
            <Seg value={status} onChange={setStatus} options={[['all', 'All'], ['ok', 'OK'], ['denied', 'Blocked'], ['error', 'Errors']]} />
            <Seg value={actor} onChange={setActor} options={[['all', 'Everyone'], ['staff', 'Staff'], ['student', 'Students']]} />
            <Button size="sm" variant="ghost" className="ml-auto" icon={<RefreshCw className="size-3.5" />} label="Refresh" onClick={load} />
          </div>
          {!rows ? <Skeleton className="h-48" /> : shown.length === 0 ? (
            <p className="py-10 text-center text-[0.8rem] text-mist-500">{rows.length ? 'No tool calls match these filters.' : 'No tool calls yet. They appear here as the AI works.'}</p>
          ) : (
            <div className="divide-y divide-white/6">
              {shown.map((r) => (
                <div key={r.id} className="min-w-0">
                  <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-white/[0.03]">
                    <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${r.status === 'ok' ? 'bg-mint-500/12 text-mint-300' : r.status === 'denied' ? 'bg-flare-500/12 text-flare-300' : 'bg-amber-500/12 text-amber-300'}`}>
                      {r.status === 'ok' ? <Check className="size-3.5" /> : r.status === 'denied' ? <Lock className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[0.8rem] font-bold text-mist-50">{toolName(r.tool)}</span>
                        <span className={`shrink-0 rounded-md px-1.5 py-px text-[0.58rem] font-extrabold uppercase ${r.admin_id ? 'bg-pulse-500/15 text-pulse-200' : 'bg-cyan-500/12 text-cyan-200'}`}>{r.admin_id ? `staff #${r.admin_id}` : `student #${r.student_id ?? '?'}`}</span>
                      </span>
                      <span className="block truncate text-[0.66rem] text-mist-500">{formatRelative(r.at)} · {r.ms} ms{r.summary ? ` · ${r.summary}` : ''}</span>
                    </span>
                    <ChevronDown className={`size-4 shrink-0 text-mist-500 transition ${open === r.id ? 'rotate-180' : ''}`} />
                  </button>
                  {open === r.id && (
                    <div className="mx-2 mb-2 rounded-xl border border-white/6 bg-black/30 p-2.5 text-[0.7rem]">
                      <p className="font-bold text-mist-400"><code className="text-nova-200">{r.tool}</code> · role {r.role} · status {r.status}</p>
                      {r.summary && <p className="mt-1 text-mist-300">{r.summary}</p>}
                      <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-black/30 p-2 text-[0.66rem] whitespace-pre-wrap text-mist-300">{JSON.stringify(r.arguments ?? {}, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="hidden min-w-0 p-3 xl:block">
          <p className="mb-2 text-[0.76rem] font-extrabold text-mist-200">Most-used tools</p>
          {stats.top.length === 0 ? <p className="text-[0.74rem] text-mist-500">Nothing yet.</p> : (
            <div className="space-y-2">
              {stats.top.map(([tool, n]) => (
                <div key={tool}>
                  <p className="flex justify-between text-[0.72rem] font-bold text-mist-300"><span className="truncate">{toolName(tool)}</span><span className="tabular-nums">{n}</span></p>
                  <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full bg-gradient-to-r from-nova-400 to-pulse-400" style={{width: `${(n / topMax) * 100}%`}} /></span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 flex items-start gap-1.5 text-[0.66rem] text-mist-500"><Eraser className="size-3.5 shrink-0" /> Arguments are stored so you can audit exactly what the AI asked for.</p>
        </Card>
      </div>
    </div>
  );
}

function Seg({value, onChange, options}: {value: string; onChange: (v: string) => void; options: [string, string][]}) {
  return (
    <div className="flex rounded-full border border-white/10 bg-black/20 p-0.5">
      {options.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)} className={`rounded-full px-2.5 py-1 text-[0.68rem] font-bold transition ${value === id ? 'bg-white/12 text-white' : 'text-mist-500 hover:text-mist-300'}`}>{label}</button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- proposals */
function StatusPill({status}: {status: Proposal['status']}) {
  const tone = status === 'pending' ? 'bg-amber-400/15 text-amber-200' : status === 'approved' ? 'bg-mint-500/15 text-mint-200' : 'bg-white/8 text-mist-400';
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.64rem] font-extrabold uppercase ${tone}`}>{status}</span>;
}

type Item = Record<string, unknown>;
const PAGE = 30;
const itemTopic = (it: Item) => String(it.topic ?? (it.after as Record<string, string> | undefined)?.topic ?? it.after ?? '').trim();
const itemText = (it: Item) => [it.text, it.name, it.title, it.description, it.explanation, itemTopic(it)].filter(Boolean).join(' ').toLowerCase();

function ProposalModal({id, onClose, onDecided}: {id: number | null; onClose: () => void; onDecided: () => void}) {
  const {toast} = useSession();
  const [p, setP] = useState<Proposal | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState('all');
  const [show, setShow] = useState<'all' | 'selected' | 'flagged'>('all');
  const [page, setPage] = useState(0);

  useEffect(() => {
    setP(null);
    setEditing(null);
    setQ('');
    setTopic('all');
    setShow('all');
    setPage(0);
    setRejecting(false);
    setReason('');
    if (!id) return;
    aiStaffApi.proposal(id).then((row) => {
      setP(row);
      const list = (row.payload?.items ?? []) as Item[];
      setItems(list);
      // near-duplicates / already-existing topics start unticked
      setPicked(new Set(list.map((it, i) => (it.possible_duplicate || it.exists ? -1 : i)).filter((i) => i >= 0)));
    }).catch((e) => { toast('error', "Couldn't open proposal", errText(e)); onClose(); });
  }, [id, onClose, toast]);

  const pending = p?.status === 'pending';
  const approve = async () => {
    if (!p) return;
    setBusy('approve');
    try {
      const res = await aiStaffApi.approve(p.id, {items, selected: [...picked].sort((a, b) => a - b)});
      const r = res.result as {created?: number; updated?: number; skipped_existing?: unknown[]; errors?: unknown[]};
      const skipped = (r.skipped_existing?.length ?? 0) + (r.errors?.length ?? 0);
      toast('success', 'Approved and saved', [r.created ? `${r.created} created` : '', r.updated ? `${r.updated} updated` : '', skipped ? `${skipped} skipped` : ''].filter(Boolean).join(' · ') || undefined);
      onDecided();
      onClose();
    } catch (e) {
      toast('error', 'Not approved', errText(e));
    } finally {
      setBusy(null);
    }
  };
  const reject = async () => {
    if (!p) return;
    setBusy('reject');
    try {
      await aiStaffApi.reject(p.id, reason);
      toast('info', 'Proposal rejected');
      onDecided();
      onClose();
    } catch (e) {
      toast('error', 'Not rejected', errText(e));
    } finally {
      setBusy(null);
    }
  };
  const patch = (index: number, change: Item) => setItems((list) => list.map((it, i) => (i === index ? {...it, ...change} : it)));
  const toggle = (index: number) => setPicked((s) => { const n = new Set(s); if (n.has(index)) n.delete(index); else n.add(index); return n; });

  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((it) => { const t = itemTopic(it); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.map((it, i) => ({it, i})).filter(({it, i}) =>
      (topic === 'all' || itemTopic(it) === topic)
      && (show === 'all' || (show === 'selected' ? picked.has(i) : Boolean(it.possible_duplicate || it.exists)))
      && (!needle || itemText(it).includes(needle)),
    ).map(({i}) => i);
  }, [items, q, topic, show, picked]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const shown = visible.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const big = items.length > 12;
  const filtered = visible.length !== items.length;
  const flagged = items.filter((it) => it.possible_duplicate || it.exists).length;

  const K = KIND[p?.kind ?? '']?.icon ?? Sparkles;
  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={p?.title ?? 'Proposal'}
      subtitle={p ? `${KIND[p.kind]?.label ?? p.kind}${p.course ? ` · ${p.course}` : ''} · drafted by AI${p.created_at ? ` ${formatRelative(p.created_at)}` : ''}` : 'Loading…'}
      icon={K}
      tone={pending ? 'amber' : p?.status === 'approved' ? 'mint' : 'nova'}
      size="lg"
      footer={p && pending ? (
        rejecting ? (
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)}>Back</Button>
            <Button variant="danger" onClick={() => void reject()} loading={busy === 'reject'} icon={<XCircle className="size-4" />}>Reject proposal</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setRejecting(true)} icon={<X className="size-4" />}>Reject</Button>
            <Button variant="mint" onClick={() => void approve()} loading={busy === 'approve'} disabled={picked.size === 0} icon={<ShieldCheck className="size-4" />}>
              Approve {picked.size} of {items.length}
            </Button>
          </>
        )
      ) : undefined}
    >
      {!p ? <Skeleton className="h-48" /> : (
        <div className="space-y-3">
          {p.summary && <p className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[0.8rem] text-mist-300"><b className="text-mist-100">Why: </b>{p.summary}</p>}
          {!pending && (
            <p className="flex items-center gap-2 text-[0.8rem] font-bold text-mist-300">
              <StatusPill status={p.status} /> {p.decided_at ? formatRelative(p.decided_at) : ''}
              {p.status === 'rejected' && Boolean((p.result as {reason?: string}).reason) && <span className="font-normal text-mist-500">— {(p.result as {reason?: string}).reason}</span>}
            </p>
          )}
          {rejecting && (
            <Field label="Reason (optional)" hint="Helps the team see why this was declined.">
              <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not in this semester's syllabus" autoFocus />
            </Field>
          )}
          {big && (
            <div className="sticky -top-1 z-10 -mx-1 space-y-2 rounded-2xl border border-white/8 bg-ink-900/95 p-2 backdrop-blur">
              <div className="flex min-w-0 items-center gap-2">
                <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-2.5 focus-within:border-nova-400/50">
                  <Search className="size-4 shrink-0 text-mist-500" />
                  <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={`Search ${items.length} items`} className="min-w-0 flex-1 bg-transparent text-[0.8rem] text-mist-100 outline-none placeholder:text-mist-500" aria-label="Search items" />
                  {q && <button onClick={() => setQ('')} aria-label="Clear search" className="text-mist-500 hover:text-mist-200"><X className="size-3.5" /></button>}
                </label>
                {topics.length > 1 && (
                  <select value={topic} onChange={(e) => { setTopic(e.target.value); setPage(0); }} aria-label="Filter by topic" className="ag-select h-9 max-w-[42%] min-w-0 appearance-none truncate rounded-xl border border-white/10 bg-black/25 px-2.5 text-[0.76rem] font-bold text-mist-200 outline-none">
                    <option value="all">All topics</option>
                    {topics.map(([t, n]) => <option key={t} value={t}>{t} ({n})</option>)}
                  </select>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1 text-[0.7rem] font-extrabold">
                {(['all', 'selected', ...(flagged ? ['flagged'] : [])] as ('all' | 'selected' | 'flagged')[]).map((v) => (
                  <button key={v} onClick={() => { setShow(v); setPage(0); }} className={`rounded-full px-2.5 py-1 capitalize transition ${show === v ? 'bg-white/[0.12] text-white' : 'text-mist-400 hover:bg-white/[0.05]'}`}>
                    {v === 'all' ? `All ${items.length}` : v === 'selected' ? `Selected ${picked.size}` : `Flagged ${flagged}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          {pending && items.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 text-[0.74rem] font-bold text-mist-400">
              <button className="rounded-full px-2 py-1 hover:bg-white/[0.06]" onClick={() => setPicked(new Set(items.map((_, i) => i)))}>Select all {items.length}</button>
              {filtered && <button className="rounded-full px-2 py-1 hover:bg-white/[0.06]" onClick={() => setPicked((s) => new Set([...s, ...visible]))}>Select {visible.length} shown</button>}
              {filtered && <button className="rounded-full px-2 py-1 hover:bg-white/[0.06]" onClick={() => setPicked((s) => { const n = new Set(s); visible.forEach((i) => n.delete(i)); return n; })}>Clear shown</button>}
              <button className="rounded-full px-2 py-1 hover:bg-white/[0.06]" onClick={() => setPicked(new Set())}>Select none</button>
              <span className="ml-auto">{picked.size} selected</span>
            </div>
          )}
          {visible.length === 0 && <p className="rounded-xl border border-dashed border-white/12 px-3 py-6 text-center text-[0.8rem] text-mist-400">Nothing matches these filters.</p>}
          <div className="space-y-2">
            {shown.map((i) => items[i]).map((item, n) => { const i = shown[n]; return (
              <ItemCard
                key={i}
                kind={p.kind}
                item={item}
                index={i}
                selectable={pending}
                selected={picked.has(i)}
                onToggle={() => toggle(i)}
                editing={editing === i}
                onEdit={() => setEditing(editing === i ? null : i)}
                onChange={(change) => patch(i, change)}
              />
            ); })}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button size="sm" variant="ghost" icon={<ChevronLeft className="size-4" />} onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0}>Prev</Button>
              <span className="text-[0.74rem] font-bold text-mist-400">{safePage * PAGE + 1}–{Math.min(visible.length, safePage * PAGE + PAGE)} of {visible.length}</span>
              <Button size="sm" variant="ghost" onClick={() => setPage(Math.min(pages - 1, safePage + 1))} disabled={safePage >= pages - 1}>Next <ChevronRight className="size-4" /></Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ItemCard({kind, item, index, selectable, selected, onToggle, editing, onEdit, onChange}: {
  kind: string; item: Item; index: number; selectable: boolean; selected: boolean; onToggle: () => void; editing: boolean; onEdit: () => void; onChange: (c: Item) => void;
}) {
  const s = (k: string) => String(item[k] ?? '');
  const flag = item.possible_duplicate ? `Looks ${item.possible_duplicate}% like an existing question` : item.exists ? 'Topic already exists' : '';
  return (
    <div className={`rounded-xl border transition ${selected ? 'border-nova-400/35 bg-nova-500/[0.05]' : 'border-white/8 bg-white/[0.02]'}`}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {selectable && (
          <button onClick={onToggle} role="checkbox" aria-checked={selected} aria-label={`Include item ${index + 1}`} className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition ${selected ? 'border-nova-400 bg-nova-500 text-white' : 'border-white/20 hover:border-white/40'}`}>
            {selected && <Check className="size-3.5" />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          {kind === 'questions' && (
            <>
              <p className="text-[0.84rem] leading-snug font-bold text-mist-50"><span className="text-mist-500">{index + 1}.</span> {s('text')}</p>
              <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                {(['A', 'B', 'C', 'D'] as const).filter((L) => s(`option_${L.toLowerCase()}`)).map((L) => (
                  <p key={L} className={`flex items-start gap-1.5 rounded-lg border px-2 py-1 text-[0.76rem] ${s('correct') === L ? 'border-mint-400/40 bg-mint-500/15 font-semibold text-mint-100' : 'border-transparent text-mist-300'}`}>
                    {s('correct') === L ? <CheckCircle2 className="mt-px size-3.5 shrink-0 text-mint-300" /> : <b className="w-3.5 shrink-0 text-center text-mist-500">{L}</b>}
                    <span className="min-w-0 [overflow-wrap:anywhere]">{s('correct') === L && <b>{L}. </b>}{s(`option_${L.toLowerCase()}`)}</span>
                  </p>
                ))}
              </div>
              {s('explanation') && <p className="mt-1.5 text-[0.74rem] text-mist-400"><b className="text-mist-300">Why: </b>{s('explanation')}</p>}
              <p className="mt-1 text-[0.66rem] font-bold text-mist-500">{[s('topic'), s('difficulty')].filter(Boolean).join(' · ')}</p>
            </>
          )}
          {kind === 'topics' && (
            <>
              <p className="text-[0.86rem] font-bold text-mist-50">{s('name')}</p>
              {s('description') && <p className="text-[0.76rem] text-mist-400">{s('description')}</p>}
              {Array.isArray(item.learning_objectives) && item.learning_objectives.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-[0.74rem] text-mist-300">{(item.learning_objectives as string[]).map((o) => <li key={o}>{o}</li>)}</ul>
              )}
            </>
          )}
          {kind === 'classification' && (
            <>
              <p className="text-[0.8rem] font-bold text-mist-100"><span className="text-mist-500">#{s('question_id')}</span> {s('text')}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries((item.after as Record<string, string>) ?? {}).map(([k, v]) => (
                  <span key={k} className="rounded-lg bg-white/[0.04] px-2 py-0.5 text-[0.7rem] text-mist-300">
                    <b className="text-mist-400 capitalize">{k}</b> <s className="text-mist-600">{(item.before as Record<string, string>)?.[k] || '—'}</s> → <b className="text-mint-200">{v}</b>
                  </span>
                ))}
              </div>
            </>
          )}
          {kind === 'material_topics' && (
            <>
              <p className="flex min-w-0 items-center gap-1.5 text-[0.82rem] font-bold text-mist-100"><FileText className="size-4 shrink-0 text-mist-400" /><span className="truncate">{s('title')}</span></p>
              <p className="mt-1 text-[0.72rem] text-mist-300"><b className="text-mist-400">Topic</b> <s className="text-mist-600">{s('before') || '—'}</s> → <b className="text-mint-200">{s('after')}</b></p>
              {Array.isArray(item.covers) && (item.covers as string[]).length > 1 && (
                <p className="mt-1 flex flex-wrap gap-1">{(item.covers as string[]).map((c) => <span key={c} className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[0.64rem] font-semibold text-mist-400">{c}</span>)}</p>
              )}
            </>
          )}
          {flag && <p className="mt-1 text-[0.68rem] font-bold text-amber-300">{flag}</p>}
        </div>
        {selectable && kind !== 'classification' && kind !== 'material_topics' && (
          <Button size="sm" variant="ghost" icon={editing ? <CheckCircle2 className="size-3.5" /> : <Pencil className="size-3.5" />} label={editing ? 'Done editing' : 'Edit'} onClick={onEdit} />
        )}
      </div>
      {editing && kind === 'questions' && (
        <div className="grid gap-2 border-t border-white/6 px-3 py-3">
          <Field label="Question"><TextArea rows={2} value={s('text')} onChange={(e) => onChange({text: e.target.value})} /></Field>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['a', 'b', 'c', 'd'] as const).map((L) => (
              <Field key={L} label={`Option ${L.toUpperCase()}`}><TextInput value={s(`option_${L}`)} onChange={(e) => onChange({[`option_${L}`]: e.target.value})} /></Field>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Correct">
              <div className="flex gap-1">
                {(['A', 'B', 'C', 'D'] as const).map((L) => (
                  <button key={L} onClick={() => onChange({correct: L})} className={`h-10 flex-1 rounded-lg text-[0.8rem] font-extrabold ${s('correct') === L ? 'bg-mint-500 text-white' : 'border border-white/12 text-mist-300 hover:bg-white/[0.05]'}`}>{L}</button>
                ))}
              </div>
            </Field>
            <Field label="Topic"><TextInput value={s('topic')} onChange={(e) => onChange({topic: e.target.value})} /></Field>
            <Field label="Difficulty">
              <div className="flex gap-1">
                {(['easy', 'medium', 'hard'] as const).map((d) => (
                  <button key={d} onClick={() => onChange({difficulty: d})} className={`h-10 flex-1 rounded-lg text-[0.72rem] font-bold capitalize ${s('difficulty') === d ? 'bg-nova-500 text-white' : 'border border-white/12 text-mist-300 hover:bg-white/[0.05]'}`}>{d}</button>
                ))}
              </div>
            </Field>
          </div>
          <Field label="Explanation"><TextArea rows={2} value={s('explanation')} onChange={(e) => onChange({explanation: e.target.value})} /></Field>
        </div>
      )}
      {editing && kind === 'topics' && (
        <div className="grid gap-2 border-t border-white/6 px-3 py-3">
          <Field label="Topic name"><TextInput value={s('name')} onChange={(e) => onChange({name: e.target.value})} /></Field>
          <Field label="Description"><TextArea rows={2} value={s('description')} onChange={(e) => onChange({description: e.target.value})} /></Field>
        </div>
      )}
    </div>
  );
}

