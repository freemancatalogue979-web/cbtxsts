/**
 * Study Lab — the learning brain of the arena.
 *
 * A dedicated page with internal screens (never one endless scroll): the
 * dashboard reads real performance data, the topic page walks the learning
 * path (Understand → Learn → Practice → Review mistakes → Practice again →
 * Mastery check), and the run player handles server-dealt practice with
 * full explanations. Weakness needs evidence — one mistake never labels
 * a topic; a check that is never passed never "masters" one either.
 */
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Flame,
  GraduationCap,
  Layers,
  Lightbulb,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  Trophy,
  XCircle,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Button, Card, Chip, EmptyState, ProgressBar, SectionHeading, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {sfx} from '../lib/sfx';
import {useSession} from '../store/session';

type Json = Record<string, unknown>;

interface Overview {
  weak_topics: WeakTopic[];
  recommended: string | null;
  in_progress: PathRow[];
  mastered: PathRow[];
  topics_known: number;
  streak_days: number;
  open_mistakes: number;
  continue: PathRow | null;
  active_run: ActiveRun | null;
  recent_mistakes: MistakeRow[];
  next_activity: {kind: string; label: string; topic?: string} | null;
}
interface WeakTopic {
  topic: string;
  weak: boolean;
  severity: number;
  accuracy: number;
  answered: number;
  wrong: number;
  open_mistakes: number;
  repeat_mistakes: number;
  pool: number;
  stage: string;
  state: string;
}
interface PathRow {
  topic: string;
  stage: string;
  state: string;
  state_label: string;
  accuracy: number;
  answered: number;
  progress: number;
  check_passed: boolean;
}
interface ActiveRun {
  id: number;
  topic: string;
  kind: string;
  position: number;
  total: number;
  correct: number;
  score: number;
}
interface MistakeRow {
  id: number;
  question_id: number;
  question: string;
  topic: string;
  your_answer: string;
  correct_answer: string;
  why: string;
  hits: number;
  resolved: boolean;
  source: string;
}
interface TopicPage {
  topic: string;
  stage: string;
  state: string;
  state_label: string;
  understood: boolean;
  sections_done: number[];
  review_seen: number;
  practice: {runs: number; answered: number; correct: number};
  mastery: {answered: number; correct: number; wrong: number; accuracy: number; check_passed: boolean; check_attempts: number};
  understand: {summary: string[]; definitions: string[]; common_mistakes: {question_id: number; selected: string; correct_key: string; hits: number}[]; materials: MaterialRow[]};
  mistakes: {items: TopicMistake[]; total: number; limit: number; offset: number};
  pool: number;
}
interface MaterialRow {
  id: number;
  title: string;
  summary: string[];
  difficulty: string;
  estimated_minutes: number;
  sections: {id: number; position: number; title: string; minutes: number}[];
}
interface TopicMistake {
  id: number;
  question_id: number;
  question: string;
  your_answer: string;
  correct_answer: string;
  why: string;
  hits: number;
  resolved: boolean;
  source: string;
}
interface RunPayload {
  run: {id: number; topic: string; kind: string; position: number; total: number; score: number; correct: number; status: string; mastery_passed?: boolean};
  question: {id: number; text: string; options: Record<string, string>; difficulty: string} | null;
  answers: Record<string, {selected: string; correct: boolean}>;
}
interface AnswerResult {
  correct: boolean;
  correct_answer: string;
  explanation: string;
  topic: string;
  concept: string;
  your_answer: string;
  progress: {answered: number; total: number; score: number; correct: number};
  next: RunPayload['question'];
  finished: boolean;
  rewards: Json[];
  run?: RunPayload['run'];
}

const STAGES = ['understand', 'learn', 'practice', 'review', 'again', 'check', 'mastered'] as const;
const STAGE_LABELS: Record<string, string> = {
  understand: 'Understand',
  learn: 'Learn',
  practice: 'Practice',
  review: 'Review mistakes',
  again: 'Practice again',
  check: 'Mastery check',
  mastered: 'Mastered',
};
const STATE_STYLE: Record<string, string> = {
  needs_study: 'border-flare-500/35 bg-flare-500/12 text-flare-300',
  learning: 'border-nova-400/35 bg-nova-500/12 text-nova-200',
  practicing: 'border-violet-400/35 bg-violet-500/12 text-violet-200',
  improving: 'border-sky-400/35 bg-sky-500/12 text-sky-200',
  strong: 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300',
  mastered: 'border-gold-400/45 bg-gold-500/14 text-gold-300',
};

function accuracyBar(value: number): string {
  if (value >= 85) return 'bg-emerald-500';
  if (value >= 65) return 'bg-sky-500';
  if (value >= 45) return 'bg-amber-500';
  return 'bg-flare-500';
}

type Screen = {name: 'dashboard'} | {name: 'topic'; topic: string} | {name: 'mistakes'};

export default function StudyLabPanel() {
  const {toast} = useSession();
  const [screen, setScreen] = useState<Screen>({name: 'dashboard'});
  const [overview, setOverview] = useState<Overview | null>(null);
  const [run, setRun] = useState<RunPayload | null>(null);

  const refreshOverview = useCallback(() => {
    api
      .studyLabOverview()
      .then((data) => setOverview(data as unknown as Overview))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshOverview();
  }, [refreshOverview]);

  // A run survives navigation and refreshes: if the server has one open, offer it.
  useEffect(() => {
    api
      .studyRunActive()
      .then((data) => {
        const payload = data as unknown as RunPayload & {run: RunPayload['run'] | null};
        if (payload.run) setRun(payload);
      })
      .catch(() => undefined);
  }, []);

  if (!overview) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-24 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    );
  }

  if (run) {
    return (
      <RunPlayer
        run={run}
        setRun={setRun}
        onExit={() => {
          refreshOverview();
        }}
        toast={toast}
      />
    );
  }

  if (screen.name === 'topic') {
    return (
      <TopicScreen
        topic={screen.topic}
        onBack={() => {
          setScreen({name: 'dashboard'});
          refreshOverview();
        }}
        onStartRun={(payload) => setRun(payload)}
        toast={toast}
      />
    );
  }

  if (screen.name === 'mistakes') {
    return <MistakeScreen onBack={() => setScreen({name: 'dashboard'})} onPractice={(topic) => setScreen({name: 'topic', topic})} />;
  }

  const open = (topic: string) => setScreen({name: 'topic', topic});

  return (
    <div className="grid gap-3 sm:gap-4">
      {/* ------------------------------------------------- header + streaks */}
      <Card className="relative overflow-hidden !p-4 sm:!p-5">
        <div className="pointer-events-none absolute -top-16 -right-10 size-40 rounded-full bg-nova-500/15 blur-3xl" />
        <div className="flex flex-wrap items-center gap-3">
          <span className="brand-gradient grid size-11 shrink-0 place-items-center rounded-2xl text-white">
            <GraduationCap className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[1.05rem] font-black text-mist-50">Study Lab</h2>
            <p className="text-[0.78rem] font-semibold text-mist-400">Your weak spots, your path through them — graded by the server, never guessed.</p>
          </div>
          <div className="flex items-center gap-1.5">
            {overview.streak_days > 0 && (
              <Chip className="border-amber-400/40 bg-amber-500/12 text-amber-300">
                <Flame className="size-3.5" /> {overview.streak_days}-day streak
              </Chip>
            )}
            <Chip>{overview.mastered.length} mastered</Chip>
          </div>
        </div>
      </Card>

      {/* --------------------------------------------------- continue / next */}
      {(overview.active_run || overview.continue) && (
        <Card className="flex flex-wrap items-center gap-3 !p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
            <RotateCcw className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] font-black tracking-wide text-mist-500 uppercase">
              {overview.active_run ? 'Resume run' : 'Continue learning'}
            </p>
            <p className="truncate text-[0.92rem] font-extrabold text-mist-100">
              {overview.active_run ? `${overview.active_run.topic} — question ${Math.min(overview.active_run.position + 1, overview.active_run.total)} of ${overview.active_run.total}` : overview.continue?.topic}
            </p>
          </div>
          <Button
            size="sm"
            variant="mint"
            onClick={() => {
              if (overview.active_run) {
                api
                  .studyRunActive()
                  .then((data) => {
                    const payload = data as unknown as RunPayload;
                    if (payload.run) setRun(payload);
                    else refreshOverview();
                  })
                  .catch(() => refreshOverview());
              } else if (overview.continue) {
                open(overview.continue.topic);
              }
            }}
            icon={<ChevronRight className="size-4" />}
          >
            {overview.active_run ? 'Resume' : 'Open path'}
          </Button>
        </Card>
      )}

      {/* ------------------------------------------------------- weak topics */}
      <section>
        <SectionHeading icon={<AlertTriangle className="size-4" />} title="Weak topics" subtitle={overview.weak_topics.length ? 'Based on answered questions, repeats and recent runs — not one bad day.' : 'Nothing flagged yet.'} />
        {overview.weak_topics.length === 0 ? (
          <Card className="!p-4 text-[0.85rem] font-semibold text-mist-400">
            Keep practising — the Lab starts judging a topic after about 6+ answered questions.{' '}
            {overview.topics_known > 0 && `You have data on ${overview.topics_known} topic${overview.topics_known === 1 ? '' : 's'}.`}
          </Card>
        ) : (
          <ul className="grid gap-2">
            {overview.weak_topics.map((row) => (
              <li key={row.topic}>
                <Card className="group !p-3.5 transition hover:border-nova-400/30">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[0.95rem] font-extrabold text-mist-50">{row.topic}</p>
                        <Chip className={STATE_STYLE[row.state] ?? 'border-white/12 bg-white/6 text-mist-300'}>{STAGE_LABELS[row.stage] ?? row.state}</Chip>
                        {row.weak && (
                          <Chip className="border-flare-500/35 bg-flare-500/12 text-flare-300">
                            <Target className="size-3" /> weak
                          </Chip>
                        )}
                      </div>
                      <p className="mt-0.5 text-[0.74rem] font-bold text-mist-500">
                        {row.accuracy}% of {row.answered} · {row.wrong} missed{row.repeat_mistakes ? ` · ${row.repeat_mistakes} repeated` : ''}
                      </p>
                    </div>
                    <div className="hidden w-32 sm:block">
                      <ProgressBar value={row.accuracy} barClassName={accuracyBar(row.accuracy)} />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => open(row.topic)}
                      icon={<ArrowLeft className="size-3.5 rotate-180" />}
                    >
                      {row.pool > 0 ? 'Study' : 'Blocked'}
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------ recommended */}
      {overview.recommended && (
        <Card className="flex flex-wrap items-center gap-3 !p-4" >
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold-500/15 text-gold-300">
            <Sparkles className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] font-black tracking-wide text-mist-500 uppercase">Recommended</p>
            <p className="text-[0.92rem] font-extrabold text-mist-50">“Practice {overview.recommended}”</p>
            {overview.next_activity && <p className="text-[0.74rem] font-bold text-mist-400">{overview.next_activity.label}</p>}
          </div>
          <Button size="sm" onClick={() => open(overview.recommended as string)} icon={<Target className="size-4" />}>
            Open path
          </Button>
        </Card>
      )}

      {/* --------------------------------------- progress grid + mistakes */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section>
          <SectionHeading icon={<Layers className="size-4" />} title="Topic mastery" />
          <Card className="!p-3">
            {overview.in_progress.length + overview.mastered.length === 0 ? (
              <p className="px-1 py-2 text-[0.82rem] font-semibold text-mist-500">No paths started yet — open a weak topic and the Lab will walk it with you.</p>
            ) : (
              <ul className="grid gap-2">
                {[...overview.in_progress, ...overview.mastered].slice(0, 6).map((row) => (
                  <li key={row.topic}>
                    <button
                      type="button"
                      onClick={() => open(row.topic)}
                      className="w-full rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5 text-left transition hover:border-white/20"
                    >
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-[0.86rem] font-extrabold text-mist-100">{row.topic}</p>
                        <Chip className={STATE_STYLE[row.state] ?? 'border-white/12 bg-white/6 text-mist-300'}>{row.state_label}</Chip>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <ProgressBar value={row.accuracy} barClassName={accuracyBar(row.accuracy)} />
                        <span className="w-11 text-right text-[0.7rem] font-black tabular text-mist-400">{row.accuracy}%</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
        <section>
          <SectionHeading
            icon={<CircleHelp className="size-4" />}
            title="Recent mistakes"
            action={
              <Button size="sm" variant="ghost" onClick={() => setScreen({name: 'mistakes'})}>
                Full review
              </Button>
            }
          />
          <Card className="!p-3">
            {overview.recent_mistakes.length === 0 ? (
              <p className="px-1 py-2 text-[0.82rem] font-semibold text-mist-500">Nothing open in the mistake book right now. Clean sheet.</p>
            ) : (
              <ul className="grid gap-2">
                {overview.recent_mistakes.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => open(row.topic)}
                      className="w-full rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5 text-left transition hover:border-flare-400/30"
                    >
                      <p className="line-clamp-2 text-[0.8rem] font-bold text-mist-200">{row.question}</p>
                      <p className="mt-1 text-[0.7rem] font-black text-mist-500">
                        You: <span className="text-flare-300">{row.your_answer}</span> · Correct:{' '}
                        <span className="text-emerald-300">{row.correct_answer}</span> · {row.topic}
                        {row.hits > 1 && <span className="text-amber-300"> · missed ×{row.hits}</span>}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- topic screen */
function TopicScreen({
  topic,
  onBack,
  onStartRun,
  toast,
}: {
  topic: string;
  onBack: () => void;
  onStartRun: (payload: RunPayload) => void;
  toast: (kind: 'info' | 'success' | 'error', title: string, detail?: string) => void;
}) {
  const [page, setPage] = useState<TopicPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [mistakesOffset, setMistakesOffset] = useState(0);

  const load = useCallback(
    (offset = 0) => {
      api
        .studyLabTopic(topic, offset)
        .then((data) => setPage(data as unknown as TopicPage))
        .catch((error: Error) => toast('error', 'Could not open that topic', error.message));
    },
    [topic, toast],
  );
  useEffect(() => {
    setPage(null);
    setMistakesOffset(0);
    load(0);
  }, [load]);

  const act = async (body: Json) => {
    setBusy(true);
    try {
      await api.studyLabAction(topic, body);
      load(mistakesOffset);
    } catch (error) {
      toast('error', 'That did not stick', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startRun = async (kind: 'practice' | 'check', count = 0) => {
    setBusy(true);
    try {
      const data = (await api.studyRunStart({topic, kind, count})) as unknown as RunPayload;
      onStartRun(data);
    } catch (error) {
      toast('error', 'Cannot start that run', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!page) return <Skeleton className="h-64 rounded-3xl" />;

  const stageIndex = STAGES.indexOf(page.stage as (typeof STAGES)[number]);

  return (
    <div className="grid gap-3 sm:gap-4">
      <Card className="!p-4">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />}>
            Lab
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[1rem] font-black text-mist-50">{page.topic}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.72rem] font-black text-mist-500">
              <Chip className={STATE_STYLE[page.state] ?? 'border-white/12 bg-white/6 text-mist-300'}>{page.state_label}</Chip>
              <span>{page.mastery.accuracy}% of {page.mastery.answered} answered</span>
              <span>· {page.pool} questions in the bank</span>
            </div>
          </div>
        </div>
        {/* the path rail */}
        <ol className="mt-3 flex flex-wrap items-center gap-1.5">
          {STAGES.slice(0, 6).map((stage, index) => {
            const reached = index <= stageIndex;
            return (
              <li key={stage} className="flex items-center gap-1.5">
                <span
                  className={
                    reached
                      ? 'grid size-6 place-items-center rounded-full bg-emerald-500/85 text-[0.68rem] font-black text-white'
                      : 'grid size-6 place-items-center rounded-full border border-white/15 bg-white/5 text-[0.68rem] font-black text-mist-500'
                  }
                >
                  {reached ? '✓' : index + 1}
                </span>
                <span className={`text-[0.7rem] font-black uppercase tracking-wide ${index === stageIndex ? 'text-mist-100' : 'text-mist-500'}`}>
                  {STAGE_LABELS[stage]}
                </span>
                {index < 5 && <ChevronRight className="size-3 text-mist-600" />}
              </li>
            );
          })}
          {page.mastery.check_passed && <Chip className="border-gold-400/45 bg-gold-500/14 text-gold-300"><Trophy className="size-3" /> mastered</Chip>}
        </ol>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ------------------------------------------------- Understand */}
        <Card className={`!p-4 ${stageIndex <= 0 ? 'ring-1 ring-nova-400/30' : ''}`}>
          <SectionHeading icon={<Lightbulb className="size-4" />} title="Understand" subtitle="Plain-language notes, examples and your own common slips." />
          <div className="grid gap-2.5">
            {page.understand.summary.length > 0 ? (
              <ul className="grid gap-1.5">
                {page.understand.summary.slice(0, 6).map((line, index) => (
                  <li key={index} className="flex gap-2 rounded-xl bg-white/4 px-2.5 py-2 text-[0.82rem] font-semibold text-mist-200">
                    <BookOpen className="mt-0.5 size-3.5 shrink-0 text-nova-300" /> {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.8rem] font-semibold text-mist-500">
                No study sheet has been published for this topic yet — the practice engine still knows it cold.
              </p>
            )}
            {page.understand.common_mistakes.length > 0 && (
              <div className="rounded-xl border border-amber-400/25 bg-amber-500/8 p-2.5">
                <p className="mb-1 text-[0.7rem] font-black tracking-wide text-amber-300 uppercase">Your common mistakes</p>
                <ul className="grid gap-1 text-[0.78rem] font-bold text-mist-300">
                  {page.understand.common_mistakes.map((row) => (
                    <li key={row.question_id}>
                      Missed ×{row.hits}: you pick <span className="text-flare-300">{row.selected}</span>, the key is <span className="text-emerald-300">{row.correct_key}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {page.understand.materials.slice(0, 3).map((material) => (
                <Chip key={material.id} className="border-white/12 bg-white/6 text-mist-300">
                  📄 {material.title} · {material.estimated_minutes}m
                </Chip>
              ))}
            </div>
            <Button
              size="sm"
              variant={page.understood ? 'outline' : 'mint'}
              loading={busy}
              disabled={page.understood}
              onClick={() => void act({action: 'understood'})}
              icon={<CheckCircle2 className="size-4" />}
            >
              {page.understood ? 'Marked as understood' : 'I understand this topic'}
            </Button>
          </div>
        </Card>

        {/* ------------------------------------------------- Learn */}
        <Card className={`!p-4 ${stageIndex === 1 ? 'ring-1 ring-nova-400/30' : ''}`}>
          <SectionHeading icon={<BookOpen className="size-4" />} title="Learn" subtitle="Structured sections from the Materials system — tick what is solid." />
          {page.understand.materials.length === 0 || page.understand.materials[0].sections.length === 0 ? (
            <EmptyState icon={<Search className="size-5" />} title="No sections yet" detail="Staff can publish a study sheet for this topic; until then, jump to Practice." />
          ) : (
            <ul className="grid gap-1.5">
              {page.understand.materials[0].sections.map((section) => {
                const done = page.sections_done.includes(section.id);
                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act({action: 'section_done', section_id: section.id})}
                      className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition ${done ? 'border-emerald-400/35 bg-emerald-500/10' : 'border-white/8 bg-white/4 hover:border-white/20'}`}
                    >
                      <span className={`grid size-5 place-items-center rounded-md border text-[0.65rem] font-black ${done ? 'border-emerald-400/60 bg-emerald-500/25 text-emerald-300' : 'border-white/20 text-mist-500'}`}>
                        {done ? '✓' : section.position}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[0.84rem] font-extrabold text-mist-100">{section.title}</span>
                      <span className="text-[0.68rem] font-black text-mist-500">{section.minutes}m</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ------------------------------------------------- Practice */}
        <Card className={`!p-4 ${stageIndex === 2 || stageIndex === 4 ? 'ring-1 ring-nova-400/30' : ''}`}>
          <SectionHeading icon={<Target className="size-4" />} title={stageIndex >= 4 ? 'Practice again' : 'Practice'} subtitle="Your shaky questions surface first — then fresh ones." />
          <div className="flex flex-wrap items-center gap-2 text-[0.78rem] font-black text-mist-400">
            <Chip>runs {page.practice.runs}</Chip>
            <Chip>{page.practice.correct}/{page.practice.answered} right</Chip>
            <Chip>{page.mastery.answered} answered overall</Chip>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="mint" loading={busy} disabled={page.pool === 0} onClick={() => void startRun('practice', 10)} icon={<Sparkles className="size-4" />}>
              Practice 10
            </Button>
            <Button size="sm" variant="outline" loading={busy} disabled={page.pool === 0} onClick={() => void startRun('practice', 20)}>
              Practice 20
            </Button>
            {page.pool === 0 && <span className="self-center text-[0.72rem] font-bold text-flare-300">No approved questions for this topic yet.</span>}
          </div>
        </Card>

        {/* ----------------------------------------- Review mistakes + check */}
        <Card className={`!p-4 ${stageIndex === 3 ? 'ring-1 ring-nova-400/30' : ''}`}>
          <SectionHeading
            icon={<CircleHelp className="size-4" />}
            title="Review mistakes"
            subtitle={`${page.mistakes.total} logged for this topic`}
            action={
              page.mistakes.total > 10 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const next = mistakesOffset + 10 >= page.mistakes.total ? 0 : mistakesOffset + 10;
                    setMistakesOffset(next);
                    load(next);
                  }}
                >
                  {mistakesOffset + 10 >= page.mistakes.total ? 'First page' : `Next ${Math.min(10, page.mistakes.total - mistakesOffset - 10)}`}
                </Button>
              ) : undefined
            }
          />
          {page.mistakes.items.length === 0 ? (
            <p className="text-[0.8rem] font-semibold text-mist-500">Nothing to review here — no open mistakes on this topic.</p>
          ) : (
            <ul className="grid gap-1.5">
              {page.mistakes.items.map((row) => (
                <li key={row.id} className={`rounded-xl border px-3 py-2 ${row.resolved ? 'border-emerald-400/20 bg-emerald-500/6' : 'border-white/8 bg-white/4'}`}>
                  <p className="line-clamp-2 text-[0.79rem] font-bold text-mist-200">{row.question}</p>
                  <p className="mt-1 text-[0.7rem] font-black">
                    <span className="text-flare-300">Your answer: {row.your_answer}</span> · <span className="text-emerald-300">Correct: {row.correct_answer}</span>
                    {row.hits > 1 && <span className="text-amber-300"> · ×{row.hits}</span>}
                    {row.resolved && <span className="text-emerald-300"> · retired</span>}
                  </p>
                  {row.why && <p className="mt-1 line-clamp-2 text-[0.72rem] font-semibold text-mist-400">Why: {row.why}</p>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" loading={busy} disabled={page.mistakes.total === 0} onClick={() => void act({action: 'review_done'})} icon={<CheckCircle2 className="size-4" />}>
              Reviewed — mark done
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={busy}
              disabled={!page.mastery.check_passed && page.mastery.answered < 6}
              title={page.mastery.answered < 6 ? 'Answer a few more questions first' : undefined}
              onClick={() => void startRun('check')}
              icon={<Trophy className="size-4 text-gold-300" />}
            >
              Mastery check
            </Button>
            {page.mastery.check_attempts > 0 && (
              <span className="self-center text-[0.68rem] font-black text-mist-500">
                checks: {page.mastery.check_passed ? 'passed ✓' : `${page.mastery.check_attempts} attempted · need 80% on hard questions`}
              </span>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- run player */
function RunPlayer({
  run,
  setRun,
  onExit,
  toast,
}: {
  run: RunPayload;
  setRun: (value: RunPayload | null) => void;
  onExit: () => void;
  toast: (kind: 'info' | 'success' | 'error', title: string, detail?: string) => void;
}) {
  const [feedback, setFeedback] = useState<AnswerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(Date.now());

  const answer = async (label: string) => {
    if (!run.question || busy) return;
    setBusy(true);
    try {
      const result = (await api.studyRunAnswer(run.run.id, {
        question_id: run.question.id,
        selected: label,
        elapsed_ms: Math.max(0, Date.now() - startedRef.current),
      })) as unknown as AnswerResult;
      sfx.play(result.correct ? 'correct' : 'wrong');
      setFeedback(result);
      if (result.finished) {
        const done = result.run ?? run.run;
        setRun({...run, run: done, question: null});
        if ((result.rewards?.length ?? 0) > 0) {
          toast('success', done.mastery_passed ? 'Mastery check passed' : 'Run finished', `${done.correct}/${done.total} correct · rewards banked`);
        }
      }
    } catch (error) {
      toast('error', 'That answer did not land', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finishUp = () => {
    setRun(null);
    setFeedback(null);
    onExit();
  };

  const question = feedback && !feedback.finished ? feedback.next ?? run.question : run.question;
  const finished = feedback?.finished ?? false;

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-3">
      <Card className="!p-3.5">
        <div className="flex items-center gap-3">
          {!finished && (
            <Button size="sm" variant="ghost" onClick={() => { void api.studyRunAbandon(run.run.id).catch(() => undefined); finishUp(); }}>
              Abandon
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.86rem] font-black text-mist-100">
              {run.run.kind === 'check' ? '🎓 Mastery check — ' : '📚 '}
              {run.run.topic}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <ProgressBar value={(Math.min(run.run.position + (feedback ? 1 : 0), run.run.total) / Math.max(1, run.run.total)) * 100} barClassName={run.run.kind === 'check' ? 'bg-gold-500' : 'bg-nova-500'} />
              <span className="text-[0.7rem] font-black tabular text-mist-400">
                {Math.min(run.run.position + (feedback && !finished ? 1 : 0), run.run.total)}/{run.run.total} · {run.run.score} pts
              </span>
            </div>
          </div>
          {finished && (
            <Button size="sm" variant="mint" onClick={finishUp} icon={<Trophy className="size-4" />}>
              {run.run.kind === 'check' ? 'See the Lab' : 'Done'}
            </Button>
          )}
        </div>
      </Card>

      {finished ? (
        <Card className="!p-6 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-300">
            <CheckCircle2 className="size-7" />
          </span>
          <p className="mt-3 text-[1.15rem] font-black text-mist-50">
            {run.run.correct}/{run.run.total} correct
          </p>
          <p className="mt-1 text-[0.82rem] font-bold text-mist-400">
            {run.run.kind === 'check'
              ? feedback?.run?.mastery_passed
                ? 'You passed the mastery check — this topic now carries a Mastered state.'
                : 'Not this time (80% of hard questions needed). The Lab queued you straight into practice again.'
              : 'Practice recorded. Weak questions resurface until they stop hurting.'}
          </p>
          {feedback && feedback.rewards.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {feedback.rewards.map((reward, index) => (
                <Chip key={index} className="border-gold-400/40 bg-gold-500/12 text-gold-300">
                  +{String((reward as Json).amount ?? (reward as Json).xp ?? 1)} {String((reward as Json).kind ?? 'reward')}
                </Chip>
              ))}
            </div>
          )}
        </Card>
      ) : question ? (
        <Card className="!p-4 sm:!p-5">
          <p className="text-[0.95rem] leading-snug font-bold text-mist-50 sm:text-[1.02rem]">{question.text}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.entries(question.options).map(([label, text]) => (
              <button
                key={label}
                type="button"
                disabled={busy || Boolean(feedback)}
                onClick={() => void answer(label)}
                className="flex items-start gap-2.5 rounded-2xl border border-white/12 bg-white/5 px-3 py-2.5 text-left transition hover:border-nova-400/60 hover:bg-nova-500/10 disabled:opacity-60"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/6 text-[0.72rem] font-black text-nova-200">{label}</span>
                <span className="min-w-0 flex-1 text-[0.86rem] leading-snug font-bold text-mist-100">{text}</span>
              </button>
            ))}
          </div>
          {feedback && (
            <div className={`mt-3 rounded-2xl border p-3 ${feedback.correct ? 'border-emerald-400/35 bg-emerald-500/10' : 'border-flare-500/40 bg-flare-500/10'}`}>
              <div className="flex items-center gap-2">
                {feedback.correct ? <CheckCircle2 className="size-5 text-emerald-300" /> : <XCircle className="size-5 text-flare-300" />}
                <p className="text-[0.9rem] font-black text-mist-50">
                  {feedback.correct ? 'Correct' : `Not quite — the key is ${feedback.correct_answer}`}
                </p>
              </div>
              {feedback.explanation && <p className="mt-1.5 text-[0.8rem] leading-relaxed font-semibold text-mist-300">{feedback.explanation}</p>}
              <p className="mt-1.5 text-[0.7rem] font-black tracking-wide text-mist-500 uppercase">
                Concept tested: {feedback.concept || `${feedback.topic} · ${question.difficulty}`}
              </p>
              <Button size="sm" className="mt-2.5" variant="mint" onClick={() => setFeedback(null)}>
                Next question
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card className="!p-5 text-center text-[0.86rem] font-bold text-mist-300">
          This run is waiting on the server — refresh or head back to the Lab.
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => api.studyRunActive().then((data) => {
              const payload = data as unknown as RunPayload;
              if (payload.run) setRun(payload);
            })}>Reconnect</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ mistake screen */
interface MistakePage {
  items: (MistakeRow & {options: Record<string, string>})[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

function MistakeScreen({onBack, onPractice}: {onBack: () => void; onPractice: (topic: string) => void}) {
  const [page, setPage] = useState<MistakePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const limit = 10;

  useEffect(() => {
    api
      .studyMistakes({limit, offset, only_open: onlyOpen})
      .then((data) => setPage(data as unknown as MistakePage))
      .catch(() => setPage({items: [], total: 0, limit, offset, has_more: false}));
  }, [offset, onlyOpen]);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-3">
      <Card className="!p-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />}>
            Lab
          </Button>
          <p className="min-w-0 flex-1 truncate text-[0.95rem] font-black text-mist-50">Mistake review</p>
          <Chip className="shrink-0">{page?.total ?? '—'} items</Chip>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[0.68rem] font-bold text-mist-500">
            {onlyOpen ? 'Open misses — not yet answered correctly.' : 'Everything on record, retired included.'}
          </p>
          <Button size="sm" variant={onlyOpen ? 'outline' : 'mint'} onClick={() => { setOnlyOpen((value) => !value); setOffset(0); }}>
            {onlyOpen ? 'Show retired too' : 'Only open'}
          </Button>
        </div>
      </Card>
      {!page ? (
        <Skeleton className="h-40 rounded-3xl" />
      ) : page.items.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="size-6" />} title="Nothing to fix" detail="Every recorded mistake here has since been answered correctly somewhere in the arena." />
      ) : (
        <ul className="grid gap-2">
          {page.items.map((row) => (
            <li key={row.id}>
              <Card className={`!p-3.5 ${row.resolved ? 'opacity-75' : ''}`}>
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-[0.88rem] leading-snug font-bold text-mist-100">{row.question}</p>
                  {row.resolved && (
                    <Chip className="mt-0.5 shrink-0 border-emerald-400/25 bg-emerald-500/10 text-[0.58rem] text-emerald-300">
                      <CheckCircle2 className="size-3" /> retired
                    </Chip>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.74rem] font-black">
                  <span className="max-w-full min-w-0 break-words rounded-lg bg-flare-500/12 px-2 py-1 text-flare-300">Your answer: {row.your_answer || '—'}</span>
                  <span className="max-w-full min-w-0 break-words rounded-lg bg-emerald-500/12 px-2 py-1 text-emerald-300">Correct: {row.correct_answer}</span>
                  <Chip className="border-white/12 bg-white/6 text-mist-400">{row.topic}</Chip>
                  <Chip className="border-white/12 bg-white/6 text-mist-400">×{row.hits} · {row.source}</Chip>
                </div>
                {row.why && <p className="mt-2 text-[0.78rem] leading-relaxed font-semibold text-mist-300"><span className="font-black text-mist-500 uppercase">Why:</span> {row.why}</p>}
                {!row.resolved && (
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => onPractice(row.topic)} icon={<Target className="size-3.5" />}>
                      Practice this concept
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {page && (page.total > limit || offset > 0) && (
        <div className="flex items-center justify-between">
          <span className="text-[0.72rem] font-black text-mist-500">
            {page.total === 0 ? '0–0' : `${page.offset + 1}–${Math.min(page.offset + limit, page.total)}`} of {page.total}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
            <Button size="sm" variant="ghost" disabled={!page.has_more} onClick={() => setOffset(offset + limit)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
