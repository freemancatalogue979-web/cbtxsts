/**
 * Background AI tasks — bulk course work at full capacity.
 *
 *   read every material → build topics → tag materials → map EVERY bank
 *   question → write up to 1000 new questions
 *
 * Tasks run on the server (you can leave the page). Everything they produce
 * lands in Review as proposals; "Approve all" applies a finished task in one go.
 */
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronDown, Clock, Coins, FileQuestion, FileUp, Layers, ListTree, Loader2, Paperclip, Play, RotateCcw,
  ShieldCheck, Sparkles, Square, Tags, Timer, Wand2, X, XCircle, Zap,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Button, Card, Modal, Skeleton, Switch, TextArea, ToneIcon, type Tone} from '../components/ui';
import {api, type ImportJob} from '../lib/api';
import {formatNumber, formatRelative} from '../lib/format';
import {aiStaffApi, type AITask, type AITaskEstimate, type AITaskLimits, type AITaskParams, type AITaskProposal} from '../lib/tutor';
import type {Course, MaterialCard} from '../lib/types';
import {useSession} from '../store/session';
import {IMPORT_ACCEPT} from './MaterialImport';

const errText = (e: unknown) => (e as Error).message || 'Something went wrong.';
const money = (n: number | undefined, digits = 3) => `$${(n || 0).toFixed(digits)}`;
const utc = (s: string | null) => (s ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`).getTime() : 0);
const active = (t: AITask) => t.status === 'queued' || t.status === 'running';

export const STAGES: Record<string, {label: string; icon: typeof Tags}> = {
  read: {label: 'Read', icon: BookOpen},
  topics: {label: 'Topics', icon: ListTree},
  materials: {label: 'Tag materials', icon: Tags},
  classify: {label: 'Map questions', icon: Layers},
  generate: {label: 'Write questions', icon: FileQuestion},
};
const STATUS: Record<AITask['status'], {label: string; pill: string; tone: Tone}> = {
  queued: {label: 'Queued', pill: 'bg-white/10 text-mist-200', tone: 'nova'},
  running: {label: 'Running', pill: 'bg-nova-500/20 text-nova-100', tone: 'nova'},
  done: {label: 'Done', pill: 'bg-mint-500/15 text-mint-200', tone: 'mint'},
  stopped: {label: 'Stopped', pill: 'bg-amber-400/15 text-amber-200', tone: 'amber'},
  failed: {label: 'Failed', pill: 'bg-flare-500/15 text-flare-200', tone: 'flare'},
  cancelled: {label: 'Cancelled', pill: 'bg-white/8 text-mist-400', tone: 'nova'},
  interrupted: {label: 'Interrupted', pill: 'bg-amber-400/15 text-amber-200', tone: 'amber'},
};
const KIND_LABEL: Record<string, string> = {topics: 'topics', questions: 'questions', classification: 'question mappings', material_topics: 'material tags'};
const MIXES: {id: string; label: string; mix: {easy: number; medium: number; hard: number}}[] = [
  {id: 'balanced', label: 'Balanced', mix: {easy: 30, medium: 50, hard: 20}},
  {id: 'gentle', label: 'Easier', mix: {easy: 50, medium: 35, hard: 15}},
  {id: 'exam', label: 'Exam-hard', mix: {easy: 15, medium: 45, hard: 40}},
];
const COUNTS = [50, 100, 250, 500, 1000];

/* ------------------------------------------------------------ file attach */
export interface AttachedMaterial {id: number; title: string; words: number; filename: string}
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** Upload a file into a course as a (draft) material via the import jobs API:
 * short requests only (upload → poll → commit → poll), so no proxy timeouts. */
export async function attachFile(file: File, courseId: number, onStage: (stage: string, fraction?: number) => void): Promise<AttachedMaterial> {
  onStage('Uploading', 0);
  let job: ImportJob = await api.materials.importUpload(file, (f) => onStage('Uploading', f));
  const follow = async (waiting: ImportJob['state']) => {
    let misses = 0;
    while (job.state === waiting) {
      await sleep(1200);
      try {
        job = await api.materials.importStatus(job.id);
        misses = 0;
      } catch (e) {
        if ((misses += 1) >= 8) throw e;
      }
    }
  };
  onStage('Reading');
  await follow('reading');
  if (job.state !== 'ready') throw new Error(job.error || 'That file could not be read.');
  const words = job.preview?.words ?? 0;
  onStage('Saving');
  job = await api.materials.importCommit(job.id, {course_id: courseId, title: job.preview?.title || file.name.replace(/\.[^.]+$/, ''), kind: 'material', status: 'draft', keep_file: true});
  await follow('importing');
  if (job.state !== 'done' || !job.material) throw new Error(job.error || 'The file could not be saved as a material.');
  return {id: job.material.id, title: job.material.title, words, filename: file.name};
}

/* -------------------------------------------------------------- live task */
export function useTask(id: number | null, initial?: AITask | null): AITask | null {
  const [task, setTask] = useState<AITask | null>(initial ?? null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    let timer = 0;
    const tick = () => {
      aiStaffApi.task(id).then((t) => {
        if (!alive) return;
        setTask(t);
        if (active(t)) timer = window.setTimeout(tick, 2000);
      }).catch(() => { if (alive) timer = window.setTimeout(tick, 5000); });
    };
    tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [id]);
  return task;
}

function Bar({value, tone = 'nova', pulse = false}: {value: number; tone?: Tone; pulse?: boolean}) {
  const fill = tone === 'mint' ? 'from-mint-400 to-cyan-400' : tone === 'flare' ? 'from-flare-500 to-flare-400' : tone === 'amber' ? 'from-amber-500 to-amber-300' : 'from-pulse-500 to-nova-400';
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
      <div className={`relative h-full rounded-full bg-gradient-to-r ${fill} transition-[width] duration-700`} style={{width: `${Math.max(3, Math.min(100, value))}%`}}>
        {pulse && <span className="absolute inset-0 animate-pulse rounded-full bg-white/20" />}
      </div>
    </div>
  );
}

function Pill({status}: {status: AITask['status']}) {
  const s = STATUS[status] ?? STATUS.queued;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.62rem] font-extrabold tracking-wide uppercase ${s.pill}`}>
      {status === 'running' && <Loader2 className="size-3 animate-spin" />}
      {s.label}
    </span>
  );
}

function elapsed(t: AITask): string {
  const start = utc(t.started_at);
  if (!start) return '';
  const end = t.finished_at ? utc(t.finished_at) : Date.now();
  const s = Math.max(0, Math.round((end - start) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/** Compact live card shown in the chat when the assistant starts a task. */
export function TaskInline({id, onOpen}: {id: number; onOpen: (id: number) => void}) {
  const task = useTask(id);
  const pct = task ? (task.status === 'done' ? 100 : task.progress?.percent ?? 0) : 0;
  const tone: Tone = !task ? 'nova' : STATUS[task.status]?.tone ?? 'nova';
  return (
    <button onClick={() => onOpen(id)} className="mt-2 block w-full min-w-0 rounded-2xl border border-nova-400/30 bg-gradient-to-r from-nova-500/[0.12] to-pulse-500/[0.04] px-3 py-2.5 text-left transition hover:border-nova-400/55">
      <span className="flex min-w-0 items-center gap-2.5">
        <ToneIcon tone={tone} icon={task?.status === 'done' ? CheckCircle2 : Zap} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.6rem] font-extrabold tracking-[0.14em] text-nova-200/85 uppercase">Background task #{id}</span>
          <span className="block truncate text-[0.84rem] font-bold text-mist-50">{task?.title ?? 'Starting…'}</span>
        </span>
        {task ? <Pill status={task.status} /> : <Loader2 className="size-4 animate-spin text-mist-400" />}
      </span>
      <span className="mt-2 block"><Bar value={pct} tone={tone} pulse={task?.status === 'running'} /></span>
      <span className="mt-1 flex min-w-0 items-center gap-2 text-[0.66rem] font-bold text-mist-400">
        <span className="min-w-0 flex-1 truncate">{task ? (task.status === 'done' ? `${task.proposals.length} proposal(s) ready for review` : task.error || task.progress?.label || 'Waiting to start') : 'Loading…'}</span>
        <span className="shrink-0">{pct}%</span>
        <span className="shrink-0 text-nova-200">Open ›</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ tasks view */
export default function TasksView({course, focusId, onOpenProposal, onChanged}: {
  course: Course | null; focusId: number | null; onOpenProposal: (id: number) => void; onChanged: () => void;
}) {
  const [tasks, setTasks] = useState<AITask[] | null>(null);
  const [limits, setLimits] = useState<AITaskLimits | null>(null);
  const [prefill, setPrefill] = useState<AITaskParams | null>(null);
  const [scope, setScope] = useState<'course' | 'all'>('course');

  const load = useCallback(() => {
    aiStaffApi.tasks(scope === 'course' ? course?.id : null).then((r) => { setTasks(r.tasks); setLimits(r.limits); }).catch(() => setTasks((t) => t ?? []));
  }, [course?.id, scope]);
  useEffect(load, [load]);
  const running = (tasks ?? []).some(active);
  useEffect(() => {
    const timer = window.setInterval(load, running ? 2500 : 20000);
    return () => window.clearInterval(timer);
  }, [load, running]);

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <Builder course={course} limits={limits} prefill={prefill} onStarted={() => { load(); onChanged(); }} />
      <div className="min-w-0 space-y-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[0.72rem] font-extrabold tracking-[0.12em] text-mist-400 uppercase">
            {running ? 'Working now' : 'Recent tasks'}{scope === 'course' && course ? ` · ${course.code}` : ''}
          </p>
          <div className="flex shrink-0 rounded-full border border-white/8 bg-black/20 p-0.5">
            {(['course', 'all'] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} className={`rounded-full px-2.5 py-1 text-[0.68rem] font-extrabold transition ${scope === s ? 'bg-white/[0.1] text-white' : 'text-mist-400 hover:text-mist-200'}`}>
                {s === 'course' ? 'This course' : 'All'}
              </button>
            ))}
          </div>
        </div>
        {tasks === null && <><Skeleton className="h-40" /><Skeleton className="h-28" /></>}
        {tasks?.length === 0 && (
          <Card className="grid place-items-center px-4 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-nova-500/15 text-nova-200 ring-1 ring-nova-400/25"><Wand2 className="size-6" /></span>
            <p className="mt-2 text-[0.92rem] font-extrabold text-mist-50">No bulk tasks yet</p>
            <p className="mt-1 max-w-sm text-[0.78rem] text-mist-400">Start one on the left, or just ask the assistant — e.g. <i>“read all the materials, make topics, assign every question and write 300 new ones”.</i></p>
          </Card>
        )}
        {tasks?.map((t) => (
          <TaskCardView key={t.id} task={t} focused={t.id === focusId} onOpenProposal={onOpenProposal} onChanged={() => { load(); onChanged(); }} onRerun={(p) => setPrefill({...p})} />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- builder */
function Builder({course, limits, prefill, onStarted}: {course: Course | null; limits: AITaskLimits | null; prefill: AITaskParams | null; onStarted: () => void}) {
  const {toast} = useSession();
  const [materials, setMaterials] = useState<MaterialCard[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [buildTopics, setBuildTopics] = useState(true);
  const [classify, setClassify] = useState(true);
  const [mapMaterials, setMapMaterials] = useState(true);
  const [rerate, setRerate] = useState(false);
  const [untagged, setUntagged] = useState(false);
  const [generate, setGenerate] = useState(true);
  const [count, setCount] = useState(100);
  const [mix, setMix] = useState('balanced');
  const [instructions, setInstructions] = useState('');
  const [maxCost, setMaxCost] = useState<number | null>(null);
  const [estimate, setEstimate] = useState<AITaskEstimate | null>(null);
  const [estError, setEstError] = useState('');
  const [starting, setStarting] = useState(false);
  const [upload, setUpload] = useState<{name: string; stage: string; fraction?: number} | null>(null);
  const [more, setMore] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadMaterials = useCallback(() => {
    if (!course) return;
    api.materials.adminList({course_id: course.id, kind: 'material', limit: 100}).then((r) => setMaterials(r.items.filter((m) => m.status !== 'archived'))).catch(() => setMaterials([]));
  }, [course]);
  useEffect(() => { setMaterials(null); setPicked([]); loadMaterials(); }, [loadMaterials]);
  useEffect(() => {
    if (!prefill) return;
    setPicked(prefill.material_ids ?? []);
    setBuildTopics(prefill.build_topics ?? true);
    setClassify(prefill.classify_questions ?? true);
    setMapMaterials(prefill.map_materials ?? true);
    setRerate(!!prefill.reclassify_difficulty);
    setUntagged(!!prefill.only_untagged);
    setGenerate((prefill.generate_questions ?? 0) > 0);
    if (prefill.generate_questions) setCount(prefill.generate_questions);
    setInstructions(prefill.instructions ?? '');
    setMaxCost(prefill.max_cost ?? null);
  }, [prefill]);

  const params: AITaskParams = useMemo(() => ({
    course_id: course?.id,
    material_ids: picked,
    build_topics: buildTopics,
    classify_questions: classify,
    map_materials: mapMaterials,
    reclassify_difficulty: rerate,
    only_untagged: untagged,
    generate_questions: generate ? Math.max(1, Math.min(limits?.max_questions ?? 1000, count || 0)) : 0,
    difficulty: (MIXES.find((m) => m.id === mix) ?? MIXES[0]).mix,
    instructions: instructions.trim(),
    ...(maxCost ? {max_cost: maxCost} : {}),
  }), [course?.id, picked, buildTopics, classify, mapMaterials, rerate, untagged, generate, count, mix, instructions, maxCost, limits?.max_questions]);

  useEffect(() => {
    if (!course) return;
    const timer = window.setTimeout(() => {
      aiStaffApi.estimateTask(params).then((r) => { setEstimate(r.estimate); setEstError(''); }).catch((e) => { setEstimate(null); setEstError(errText(e)); });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [params, course]);

  const start = async () => {
    if (!course) return;
    setStarting(true);
    try {
      const t = await aiStaffApi.startTask(params);
      toast('success', `Task #${t.id} started`, 'It keeps running on the server — you can leave this page.');
      onStarted();
    } catch (e) {
      toast('error', "Couldn't start the task", errText(e));
    } finally {
      setStarting(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !course) return;
    setUpload({name: file.name, stage: 'Uploading', fraction: 0});
    try {
      const m = await attachFile(file, course.id, (stage, fraction) => setUpload({name: file.name, stage, fraction}));
      toast('success', 'Material added', `${m.title} saved to ${course.code} as a draft.`);
      loadMaterials();
      setPicked((p) => (p.length ? [...p, m.id] : [m.id]));
    } catch (e) {
      toast('error', `Couldn't add ${file.name}`, errText(e));
    } finally {
      setUpload(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const toggleMaterial = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const nothing = !buildTopics && !classify && !mapMaterials && !generate;
  const ceiling = maxCost ?? limits?.default_max_cost ?? 1;
  const over = !!estimate && estimate.cost > ceiling;

  if (!course) {
    return <Card className="p-4 text-[0.82rem] text-mist-400">Pick a course at the top to plan a bulk task.</Card>;
  }
  return (
    <Card className="min-w-0 self-start overflow-hidden p-0 xl:sticky xl:top-3">
      <div className="flex items-center gap-2.5 border-b border-white/6 bg-gradient-to-r from-nova-500/[0.10] to-transparent px-3.5 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-nova-400 to-pulse-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"><Zap className="size-4.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9rem] font-extrabold text-mist-50">New bulk task · {course.code}</p>
          <p className="truncate text-[0.68rem] font-semibold text-mist-400">Whole materials, every question, up to {formatNumber(limits?.max_questions ?? 1000)} new questions</p>
        </div>
      </div>

      <div className="space-y-3.5 px-3.5 py-3.5">
        {/* materials */}
        <section>
          <div className="mb-1.5 flex items-center gap-2">
            <p className="flex-1 text-[0.68rem] font-extrabold tracking-[0.12em] text-mist-400 uppercase">1 · Materials to read</p>
            <button onClick={() => fileInput.current?.click()} disabled={!!upload} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[0.68rem] font-extrabold text-mist-200 transition hover:border-nova-400/40 hover:text-white disabled:opacity-50">
              <FileUp className="size-3.5" /> Upload
            </button>
            <input ref={fileInput} type="file" accept={IMPORT_ACCEPT} className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
          {upload && (
            <div className="mb-1.5 rounded-xl border border-nova-400/25 bg-nova-500/[0.06] px-2.5 py-2">
              <p className="flex items-center gap-2 text-[0.72rem] font-bold text-mist-200"><Loader2 className="size-3.5 animate-spin text-nova-300" /><span className="min-w-0 flex-1 truncate">{upload.name}</span><span className="text-mist-400">{upload.stage}…</span></p>
              {upload.fraction != null && <div className="mt-1.5"><Bar value={upload.fraction * 100} /></div>}
            </div>
          )}
          {materials === null ? <Skeleton className="h-16" /> : materials.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/12 px-3 py-3 text-center text-[0.74rem] text-mist-400">No materials in {course.code} yet — upload a PDF, Word or slides file to read.</p>
          ) : (
            <div className="max-h-44 space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-white/8 bg-black/15 p-1">
              <Check label={`All materials (${materials.length})`} on={picked.length === 0} onClick={() => setPicked([])} strong />
              {materials.map((m) => (
                <Check key={m.id} label={m.title} hint={m.status === 'draft' ? 'draft' : m.topic || undefined} on={picked.includes(m.id)} onClick={() => toggleMaterial(m.id)} />
              ))}
            </div>
          )}
        </section>

        {/* jobs */}
        <section>
          <p className="mb-1.5 text-[0.68rem] font-extrabold tracking-[0.12em] text-mist-400 uppercase">2 · What to do</p>
          <div className="divide-y divide-white/6 rounded-xl border border-white/8 bg-white/[0.02]">
            <Job icon={ListTree} tone="cyan" title="Build topics from the materials" sub="Reads every page and proposes a clean syllabus" on={buildTopics} onChange={setBuildTopics} />
            <Job icon={Layers} tone="pulse" title="Assign every bank question to a topic" sub={estimate ? `${formatNumber(estimate.bank_questions)} question(s) checked — none skipped` : 'All existing questions, checked in batches'} on={classify} onChange={setClassify}>
              {classify && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip on={rerate} onClick={() => setRerate(!rerate)}>Also re-rate difficulty</Chip>
                  <Chip on={untagged} onClick={() => setUntagged(!untagged)}>Only untagged</Chip>
                </div>
              )}
            </Job>
            <Job icon={Tags} tone="gold" title="Tag materials with their topic" sub="So students find readings by topic" on={mapMaterials} onChange={setMapMaterials} />
            <Job icon={FileQuestion} tone="nova" title="Write new questions" sub="Grounded in the material, deduplicated against the bank" on={generate} onChange={setGenerate}>
              {generate && (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="number" min={1} max={limits?.max_questions ?? 1000} value={count || ''}
                      onChange={(e) => setCount(Math.max(0, Math.min(limits?.max_questions ?? 1000, Number(e.target.value) || 0)))}
                      aria-label="How many questions"
                      className="h-8 w-20 rounded-lg border border-white/12 bg-black/25 px-2 text-center text-[0.82rem] font-extrabold text-white outline-none focus:border-nova-400/60"
                    />
                    {COUNTS.map((n) => <Chip key={n} on={count === n} onClick={() => setCount(n)}>{n}</Chip>)}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[0.66rem] font-bold text-mist-500">Difficulty</span>
                    {MIXES.map((m) => <Chip key={m.id} on={mix === m.id} onClick={() => setMix(m.id)} title={`${m.mix.easy}% easy · ${m.mix.medium}% medium · ${m.mix.hard}% hard`}>{m.label}</Chip>)}
                  </div>
                </div>
              )}
            </Job>
          </div>
        </section>

        {/* instructions */}
        <section>
          <button onClick={() => setMore(!more)} className="flex w-full items-center gap-2 text-left text-[0.68rem] font-extrabold tracking-[0.12em] text-mist-400 uppercase">
            <span className="flex-1">3 · Instructions & limits <span className="font-semibold tracking-normal normal-case text-mist-600">(optional)</span></span>
            <ChevronDown className={`size-4 transition ${more ? 'rotate-180' : ''}`} />
          </button>
          {more && (
            <div className="mt-1.5 space-y-2">
              <TextArea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={1500} placeholder="e.g. Final-year law school level. Focus on case law. Use Nigerian examples. About 12 topics." />
              <label className="flex items-center gap-2 text-[0.74rem] font-bold text-mist-300">
                <Coins className="size-4 text-amber-300" /> Stop if cost reaches $
                <input
                  type="number" step="0.1" min={0.05} max={limits?.hard_max_cost ?? 10} value={maxCost ?? ''} placeholder={String(limits?.default_max_cost ?? 1)}
                  onChange={(e) => setMaxCost(e.target.value ? Math.max(0.05, Math.min(limits?.hard_max_cost ?? 10, Number(e.target.value))) : null)}
                  className="h-8 w-20 rounded-lg border border-white/12 bg-black/25 px-2 text-[0.8rem] font-extrabold text-white outline-none focus:border-nova-400/60"
                />
              </label>
            </div>
          )}
        </section>

        {/* estimate */}
        <div className={`rounded-xl border px-3 py-2.5 ${over ? 'border-amber-400/35 bg-amber-500/[0.07]' : 'border-white/8 bg-black/20'}`}>
          {estError ? <p className="flex items-start gap-2 text-[0.74rem] font-bold text-flare-200"><AlertTriangle className="mt-px size-4 shrink-0" />{estError}</p> : !estimate ? <Skeleton className="h-10" /> : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat icon={BookOpen} value={estimate.materials ? `${formatNumber(Math.round(estimate.characters / 1000))}k` : '0'} label="characters" />
                <Stat icon={Timer} value={`~${estimate.minutes || 1} min`} label={`${formatNumber(estimate.calls)} AI calls`} />
                <Stat icon={Coins} value={money(estimate.cost)} label={`stops at ${money(ceiling, 2)}`} />
              </div>
              {over && <p className="mt-2 text-[0.7rem] font-bold text-amber-200">The estimate is above the cost ceiling — the task will stop part-way. Raise the limit under Instructions & limits.</p>}
            </>
          )}
        </div>

        <Button block variant="primary" icon={<Play className="size-4" />} onClick={() => void start()} loading={starting} disabled={nothing || !!estError || !!upload}>
          Start task
        </Button>
        <p className="text-center text-[0.64rem] font-semibold text-mist-500">Runs on the server · results arrive as proposals · nothing changes until you approve</p>
      </div>
    </Card>
  );
}

function Check({label, hint, on, onClick, strong = false}: {label: string; hint?: string; on: boolean; onClick: () => void; strong?: boolean}) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick} className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${on ? 'bg-nova-500/[0.12]' : 'hover:bg-white/[0.04]'}`}>
      <span className={`grid size-4.5 shrink-0 place-items-center rounded-md border transition ${on ? 'border-nova-400 bg-nova-500 text-white' : 'border-white/25'}`}>{on && <CheckCircle2 className="size-3" />}</span>
      <span className={`min-w-0 flex-1 truncate text-[0.78rem] ${strong ? 'font-extrabold text-mist-50' : 'font-semibold text-mist-200'}`}>{label}</span>
      {hint && <span className="max-w-[40%] shrink-0 truncate text-[0.62rem] font-bold text-mist-500">{hint}</span>}
    </button>
  );
}

function Job({icon, tone, title, sub, on, onChange, children}: {icon: typeof Tags; tone: Tone; title: string; sub: string; on: boolean; onChange: (v: boolean) => void; children?: ReactNode}) {
  return (
    <div className={`px-3 py-2.5 transition ${on ? '' : 'opacity-60'}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <ToneIcon tone={tone} icon={icon} size="sm" />
        <button type="button" onClick={() => onChange(!on)} className="min-w-0 flex-1 text-left">
          <span className="block text-[0.8rem] leading-tight font-extrabold text-mist-50">{title}</span>
          <span className="block truncate text-[0.66rem] font-semibold text-mist-500">{sub}</span>
        </button>
        <Switch checked={on} onChange={onChange} aria-label={title} />
      </div>
      {children && <div className="pl-10">{children}</div>}
    </div>
  );
}

function Chip({on, onClick, children, title}: {on: boolean; onClick: () => void; children: ReactNode; title?: string}) {
  return (
    <button type="button" onClick={onClick} title={title} className={`rounded-full border px-2.5 py-1 text-[0.7rem] font-extrabold transition ${on ? 'border-nova-400/60 bg-nova-500/20 text-white' : 'border-white/10 bg-white/[0.03] text-mist-300 hover:border-white/20 hover:text-mist-100'}`}>
      {children}
    </button>
  );
}

function Stat({icon: Icon, value, label}: {icon: typeof Tags; value: string; label: string}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center justify-center gap-1 truncate text-[0.86rem] font-black text-mist-50"><Icon className="size-3.5 shrink-0 text-mist-400" />{value}</p>
      <p className="truncate text-[0.6rem] font-bold text-mist-500">{label}</p>
    </div>
  );
}

/* -------------------------------------------------------------- task card */
function TaskCardView({task, focused, onOpenProposal, onChanged, onRerun}: {
  task: AITask; focused: boolean; onOpenProposal: (id: number) => void; onChanged: () => void; onRerun: (p: AITaskParams) => void;
}) {
  const {toast} = useSession();
  const [open, setOpen] = useState(focused || active(task));
  const [full, setFull] = useState<AITask | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<'cancel' | 'approve' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) { setOpen(true); ref.current?.scrollIntoView({behavior: 'smooth', block: 'start'}); }
  }, [focused]);
  useEffect(() => { if (open && !active(task)) aiStaffApi.task(task.id).then(setFull).catch(() => undefined); }, [open, task]);

  const s = STATUS[task.status] ?? STATUS.queued;
  const pct = task.status === 'done' ? 100 : task.progress?.percent ?? 0;
  const stages = task.progress?.stages ?? [];
  const current = task.progress?.stage ?? task.stage;
  const pending = task.proposals.filter((p) => p.status === 'pending');
  const r = task.result ?? {};
  const log = (full?.log ?? task.log ?? []).slice().reverse();

  const cancel = async () => {
    setBusy('cancel');
    try {
      await aiStaffApi.cancelTask(task.id);
      toast('info', 'Stopping task', 'Work saved so far is kept as proposals.');
      onChanged();
    } catch (e) {
      toast('error', "Couldn't cancel", errText(e));
    } finally {
      setBusy(null);
    }
  };
  const approveAll = async () => {
    setBusy('approve');
    try {
      const res = await aiStaffApi.approveTask(task.id);
      const parts = [res.topics && `${res.topics} topics`, res.questions && `${res.questions} questions`, res.classified && `${res.classified} questions mapped`, res.materials && `${res.materials} materials tagged`].filter(Boolean);
      toast('success', 'Approved and saved', parts.join(' · ') + (res.errors.length ? ` · ${res.errors.length} skipped` : ''));
      setConfirm(false);
      onChanged();
    } catch (e) {
      toast('error', 'Not approved', errText(e));
    } finally {
      setBusy(null);
    }
  };
  const counts = pending.reduce<Record<string, number>>((acc, p) => ({...acc, [p.kind]: (acc[p.kind] ?? 0) + p.count}), {});

  return (
    <div ref={ref} className={`min-w-0 overflow-hidden rounded-2xl border bg-gradient-to-b from-white/[0.045] to-white/[0.015] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.8)] ${focused ? 'border-nova-400/50' : active(task) ? 'border-nova-400/25' : 'border-white/8'}`}>
      <button onClick={() => setOpen(!open)} className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2.5 text-left">
        <ToneIcon tone={s.tone} icon={task.status === 'done' ? CheckCircle2 : task.status === 'failed' ? XCircle : task.status === 'running' ? Sparkles : Zap} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[0.86rem] font-extrabold text-mist-50">{task.title}</span>
          </span>
          <span className="block truncate text-[0.66rem] font-semibold text-mist-500">
            #{task.id}{task.created_at ? ` · ${formatRelative(task.created_at)}` : ''}{elapsed(task) ? ` · ${elapsed(task)}` : ''} · {task.calls} calls · {money(task.cost, 4)}
          </span>
        </span>
        <Pill status={task.status} />
        <ChevronDown className={`size-4 shrink-0 text-mist-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      <div className="px-3 pb-2.5">
        <Bar value={pct} tone={s.tone} pulse={task.status === 'running'} />
        <p className="mt-1 flex min-w-0 items-center gap-2 text-[0.68rem] font-bold text-mist-400">
          <span className="min-w-0 flex-1 truncate">{task.error ? task.error : task.progress?.label || 'Waiting to start'}</span>
          <span className="shrink-0 text-mist-300">{pct}%</span>
        </p>
      </div>

      {open && (
        <div className="space-y-3 border-t border-white/6 px-3 py-3">
          {stages.length > 0 && (
            <ol className="flex min-w-0 flex-wrap gap-1.5">
              {stages.map((st, i) => {
                const idx = stages.indexOf(current);
                const done = task.status === 'done' || i < idx;
                const now = i === idx && active(task);
                const M = STAGES[st] ?? {label: st, icon: Sparkles};
                return (
                  <li key={st} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.66rem] font-extrabold ${done ? 'border-mint-400/30 bg-mint-500/10 text-mint-200' : now ? 'border-nova-400/45 bg-nova-500/15 text-white' : 'border-white/8 text-mist-500'}`}>
                    {done ? <CheckCircle2 className="size-3" /> : now ? <Loader2 className="size-3 animate-spin" /> : <M.icon className="size-3" />}
                    {M.label}
                  </li>
                );
              })}
            </ol>
          )}

          {(r.read || r.topics || r.classify || r.generate) && (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {r.read && <Result label="Read" value={`${r.read.materials} file${r.read.materials === 1 ? '' : 's'}`} sub={`${formatNumber(Math.round(r.read.characters / 1000))}k chars`} />}
              {r.topics && <Result label="Topics" value={String(r.topics.total)} sub={`${r.topics.new} new`} />}
              {r.classify && <Result label="Questions mapped" value={`${formatNumber(r.classify.changed)}`} sub={`of ${formatNumber(r.classify.questions)} checked`} />}
              {r.generate && <Result label="Written" value={`${formatNumber(r.generate.made)}`} sub={`of ${formatNumber(r.generate.asked)} asked`} />}
            </div>
          )}

          {task.proposals.length > 0 && (
            <div className="space-y-1">
              <p className="text-[0.64rem] font-extrabold tracking-[0.12em] text-mist-500 uppercase">Proposals ({task.proposals.length})</p>
              <div className="max-h-56 space-y-1 overflow-y-auto overscroll-contain">
                {task.proposals.map((p) => <ProposalRow key={p.id} p={p} onOpen={() => onOpenProposal(p.id)} />)}
              </div>
            </div>
          )}

          <details className="group rounded-xl border border-white/6 bg-black/20" open={active(task)}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[0.68rem] font-extrabold text-mist-400">
              <Clock className="size-3.5" /> Activity log <ChevronDown className="ml-auto size-3.5 transition group-open:rotate-180" />
            </summary>
            <ul className="max-h-48 space-y-1 overflow-y-auto px-2.5 pb-2">
              {log.map((l, i) => (
                <li key={i} className={`flex gap-2 text-[0.7rem] leading-snug ${l.level === 'warn' ? 'text-amber-200' : 'text-mist-300'}`}>
                  <span className="shrink-0 font-mono text-[0.62rem] text-mist-600">{new Date(utc(l.at)).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'})}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{l.text}</span>
                </li>
              ))}
            </ul>
          </details>

          <div className="flex flex-wrap items-center gap-2">
            {active(task) && (
              <Button size="sm" variant="ghost" icon={<Square className="size-3.5" />} onClick={() => void cancel()} loading={busy === 'cancel'} disabled={task.cancel_requested}>
                {task.cancel_requested ? 'Stopping…' : 'Stop'}
              </Button>
            )}
            {!active(task) && (
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => onRerun(task.params)}>Run again</Button>
            )}
            {pending.length > 0 && !active(task) && (
              <Button size="sm" variant="mint" className="ml-auto" icon={<ShieldCheck className="size-4" />} onClick={() => setConfirm(true)}>
                Approve all ({pending.length})
              </Button>
            )}
          </div>
        </div>
      )}

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Approve everything from task #${task.id}?`}
        subtitle={task.title}
        icon={ShieldCheck}
        tone="mint"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} icon={<X className="size-4" />}>Cancel</Button>
            <Button variant="mint" onClick={() => void approveAll()} loading={busy === 'approve'} icon={<ShieldCheck className="size-4" />}>Approve all</Button>
          </>
        }
      >
        <div className="space-y-2 text-[0.82rem] text-mist-300">
          <p>This approves {pending.length} proposal{pending.length === 1 ? '' : 's'} and saves the following to <b className="text-mist-100">{task.course ?? 'the course'}</b>:</p>
          <ul className="space-y-1">
            {Object.entries(counts).map(([k, n]) => (
              <li key={k} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5"><CheckCircle2 className="size-4 text-mint-300" /><b className="text-mist-50">{formatNumber(n)}</b> {KIND_LABEL[k] ?? k}</li>
            ))}
          </ul>
          <p className="text-[0.74rem] text-mist-500">Every item is re-checked by the same validators as the editors, and versions are recorded. To pick items one by one, open a proposal instead.</p>
        </div>
      </Modal>
    </div>
  );
}

function Result({label, value, sub}: {label: string; value: string; sub: string}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/6 bg-white/[0.025] px-2.5 py-2">
      <p className="truncate text-[0.6rem] font-extrabold tracking-wide text-mist-500 uppercase">{label}</p>
      <p className="truncate text-[0.95rem] font-black text-mist-50">{value}</p>
      <p className="truncate text-[0.62rem] font-semibold text-mist-500">{sub}</p>
    </div>
  );
}

function ProposalRow({p, onOpen}: {p: AITaskProposal; onOpen: () => void}) {
  const pill = p.status === 'pending' ? 'bg-amber-400/15 text-amber-200' : p.status === 'approved' ? 'bg-mint-500/15 text-mint-200' : 'bg-white/8 text-mist-400';
  const Icon = p.kind === 'topics' ? ListTree : p.kind === 'questions' ? FileQuestion : p.kind === 'material_topics' ? Paperclip : Layers;
  return (
    <button onClick={onOpen} className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.05]">
      <Icon className="size-3.5 shrink-0 text-mist-400" />
      <span className="min-w-0 flex-1 truncate text-[0.76rem] font-bold text-mist-200">{p.title}</span>
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.58rem] font-extrabold uppercase ${pill}`}>{p.status}</span>
    </button>
  );
}
