/**
 * Pro Question Bank — build a practice session from the course banks.
 * Setup, weak-topic suggestions and history are Pro; the run itself is the
 * existing server-graded runner (clock, explanations, resume on refresh).
 */
import {ArrowRight, BarChart3, CheckCircle2, Clock, History, ListChecks, Play, Search, Target} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import {CustomRun, type CustomRunPayload, type PracticeCatalog} from '../panels/PracticePanel';
import {useSession} from '../store/session';
import {Badge, Empty, LoadingRows, Metric, PageHeader, Ring, Seg, Tile, hueForCourse, pct, toneFor} from './ui';

type Json = Record<string, any>;

export default function ProBank() {
  const {toast} = useSession();
  const [phase, setPhase] = useState<'loading' | 'setup' | 'run'>('loading');
  const [catalog, setCatalog] = useState<PracticeCatalog | null>(null);
  const [run, setRun] = useState<CustomRunPayload | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Json | null>(null);
  const [analytics, setAnalytics] = useState<Json | null>(null);

  const [courseId, setCourseId] = useState<number | null>(null);
  const [topicKey, setTopicKey] = useState('');
  const [count, setCount] = useState(20);
  const [minutes, setMinutes] = useState(30);
  const [topicQuery, setTopicQuery] = useState('');

  const loadSide = useCallback(() => {
    api.arena.practiceHistory().then(setHistory).catch(() => setHistory(null));
    api.arena.analytics(90).then(setAnalytics).catch(() => setAnalytics(null));
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog((await api.arena.practiceCatalog()) as unknown as PracticeCatalog);
    } catch (error) {
      toast('error', 'Question bank unavailable', (error as Error).message);
      setCatalog({courses: [], count_choices: [], duration_choices_minutes: []});
    }
  }, [toast]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // A refresh lands back inside the same session — same paper, same clock.
      try {
        const active = (await api.arena.practiceActive()) as unknown as {run: CustomRunPayload | null; expired: boolean};
        if (!alive) return;
        if (active.run) {
          setRun(active.run);
          setExpired(Boolean(active.expired));
          setPhase('run');
          return;
        }
      } catch {
        /* nothing to resume */
      }
      await loadCatalog();
      loadSide();
      if (alive) setPhase('setup');
    })();
    return () => {
      alive = false;
    };
  }, [loadCatalog, loadSide]);

  const course = catalog?.courses.find((c) => c.id === courseId) ?? catalog?.courses[0] ?? null;
  const topics = course?.topics ?? [];
  const available = topicKey ? (topics.find((t) => t.key === topicKey)?.count ?? 0) : (course?.available ?? 0);
  const countChoices = useMemo(() => {
    const base = (catalog?.count_choices?.length ? catalog.count_choices : [5, 10, 20, 30, 40, 50]).filter((n) => n <= available);
    return [...new Set(base.length ? [...base, available] : available > 0 ? [available] : [])];
  }, [catalog, available]);
  const effectiveCount = countChoices.includes(count) ? count : (countChoices.find((n) => n >= 20) ?? countChoices[countChoices.length - 1] ?? 0);
  const durations = catalog?.duration_choices_minutes?.length ? catalog.duration_choices_minutes : [10, 20, 30, 40, 50, 60];

  /* your accuracy per topic (90 days) */
  const topicStats = useMemo(() => {
    const map = new Map<string, {accuracy: number; answered: number}>();
    for (const row of [...(analytics?.weakest_topics ?? []), ...(analytics?.strongest_topics ?? [])]) map.set(String(row.key).toLowerCase(), {accuracy: Number(row.accuracy), answered: Number(row.answered)});
    return map;
  }, [analytics]);
  const statFor = (name: string) => topicStats.get(name.toLowerCase());

  const start = async (opts?: {courseId: number; topicKey: string; count: number; minutes: number}) => {
    const c = opts ?? {courseId: course?.id ?? 0, topicKey, count: effectiveCount, minutes};
    if (!c.courseId || !c.count) return;
    setBusy(true);
    try {
      const payload = (await api.arena.startPractice({mode: 'custom', course_id: c.courseId, topic: c.topicKey, size: c.count, time_limit_seconds: c.minutes * 60})) as unknown as CustomRunPayload;
      setRun(payload);
      setExpired(false);
      setPhase('run');
      window.scrollTo({top: 0});
    } catch (error) {
      toast('error', 'Could not start practice', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'run' && run) {
    return (
      <CustomRun
        run={run}
        expired={expired}
        onNewPractice={() => {
          setRun(null);
          setExpired(false);
          void loadCatalog();
          loadSide();
          setPhase('setup');
        }}
      />
    );
  }

  const stats = history?.stats ?? {};
  const runs: Json[] = (history?.runs ?? []).slice(0, 6);
  const weak: Json[] = (analytics?.weakest_topics ?? []).slice(0, 4);
  const courseByCode = new Map((catalog?.courses ?? []).map((c) => [c.code, c]));
  const courseById = new Map((catalog?.courses ?? []).map((c) => [c.id, c]));
  const filteredTopics = topics.filter((t) => !topicQuery.trim() || t.topic.toLowerCase().includes(topicQuery.trim().toLowerCase()));
  const topicName = topicKey ? (topics.find((t) => t.key === topicKey)?.topic ?? 'Topic') : 'All topics';

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader eyebrow="Practice" title="Question Bank" description="Build a practice session from your course banks. Every question is marked by the server, with an explanation after each answer." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Sessions" value={history ? Number(stats.runs ?? 0) : '—'} sub={`${Number(stats.days_played ?? 0)} ${Number(stats.days_played ?? 0) === 1 ? 'day' : 'days'} practised`} icon={<ListChecks />} hue="blue" />
        <Metric label="Accuracy" value={history ? (Number(stats.total ?? 0) ? pct(stats.accuracy) : '—') : '—'} tone={toneFor(Number(stats.accuracy ?? 0), Number(stats.total ?? 0))} sub={`${Number(stats.correct ?? 0)} of ${Number(stats.total ?? 0)} correct`} icon={<Target />} hue="green" />
        <Metric label="Questions" value={history ? Number(stats.total ?? 0) : '—'} sub="answered in practice" icon={<CheckCircle2 />} hue="violet" />
        <Metric label="In the bank" value={catalog ? catalog.courses.reduce((n, c) => n + c.available, 0) : '—'} sub={`${catalog?.courses.length ?? 0} courses`} icon={<BarChart3 />} hue="amber" />
      </div>

      {phase === 'loading' || !catalog ? (
        <LoadingRows rows={5} />
      ) : !catalog.courses.length ? (
        <div className="pro-card">
          <Empty icon={<ListChecks />} title="No questions available yet" body="Once questions are published for your courses you can practise them here." />
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          {/* builder */}
          <section className="pro-card grid grid-cols-[minmax(0,1fr)] gap-6 p-4 md:p-6">
            <div className="flex items-center gap-3">
              <Tile hue="blue"><Play /></Tile>
              <div className="min-w-0">
                <h2 className="pro-h3">New practice session</h2>
                <p className="pro-meta">Course, topic, length and time limit.</p>
              </div>
            </div>

            <fieldset className="grid gap-2">
              <legend className="pro-eyebrow mb-2">Course</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {catalog.courses.map((c) => {
                  const active = course?.id === c.id;
                  const hue = hueForCourse(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setCourseId(c.id);
                        setTopicKey('');
                      }}
                      className="pro-card pro-lift pro-mark flex min-w-0 items-center gap-3 p-3 text-left"
                      data-hue={hue}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="pro-meta block font-semibold" style={{color: `var(--pro-h-${hue})`}}>{c.code}</span>
                        <span className="block truncate font-medium" style={{color: 'var(--pro-text)'}}>{c.title}</span>
                      </span>
                      <span className="pro-meta pro-num shrink-0">{c.available} q</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <div className="mb-1 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <legend className="pro-eyebrow">Topic</legend>
                {topics.length > 6 && (
                  <label className="pro-search w-full sm:w-56">
                    <Search />
                    <input className="pro-input w-full" style={{minHeight: 32}} placeholder="Filter topics" value={topicQuery} onChange={(e) => setTopicQuery(e.target.value)} aria-label="Filter topics" />
                  </label>
                )}
              </div>
              <div className="pro-card grid max-h-[19rem] overflow-y-auto overscroll-contain" role="radiogroup" aria-label="Topic">
                {[{key: '', topic: 'All topics', count: course?.available ?? 0}, ...filteredTopics].map((t) => {
                  const active = topicKey === t.key;
                  const s = t.key ? statFor(t.topic) : undefined;
                  return (
                    <button
                      key={t.key || 'all'}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setTopicKey(t.key)}
                      className="flex min-w-0 items-center gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--pro-hover)]"
                      style={{borderColor: 'var(--pro-border)', background: active ? 'var(--pro-accent-soft)' : undefined}}
                    >
                      <span className="grid size-4 shrink-0 place-items-center rounded-full border" style={{borderColor: active ? 'var(--pro-accent)' : 'var(--pro-border-strong)'}}>
                        {active && <span className="size-2 rounded-full" style={{background: 'var(--pro-accent)'}} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate" style={{color: 'var(--pro-text)', fontWeight: t.key ? 450 : 600}}>{t.topic}</span>
                      {s && <span className="pro-meta pro-num shrink-0" style={{color: `var(--pro-${toneFor(s.accuracy, s.answered) ?? 'text-2'})`}}>{pct(s.accuracy)}</span>}
                      <span className="pro-meta pro-num w-12 shrink-0 text-right">{t.count} q</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-5 lg:grid-cols-2">
              <fieldset className="grid min-w-0 gap-2">
                <legend className="pro-eyebrow mb-2">Questions</legend>
                <Seg<number> label="Number of questions" value={effectiveCount} onChange={setCount} options={countChoices.map((n) => ({value: n, label: n === available && !(catalog.count_choices ?? []).includes(n) ? `All ${n}` : String(n)}))} />
              </fieldset>
              <fieldset className="grid min-w-0 gap-2">
                <legend className="pro-eyebrow mb-2">Time limit</legend>
                <Seg<number> label="Time limit" value={minutes} onChange={setMinutes} options={durations.map((m) => ({value: m, label: `${m}m`}))} />
              </fieldset>
            </div>

            <div className="flex min-w-0 flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center" style={{borderColor: 'var(--pro-border)'}}>
              <p className="pro-secondary min-w-0 flex-1">
                <span style={{color: 'var(--pro-text)'}} className="font-medium">{effectiveCount} questions</span> · {minutes} minutes · {course?.code} · {topicName}
              </p>
              <button type="button" className="pro-btn pro-btn-primary w-full sm:w-auto" disabled={busy || !effectiveCount} onClick={() => void start()}>
                <Play className="size-4" />
                {busy ? 'Starting…' : 'Start practice'}
              </button>
            </div>
          </section>

          {/* side */}
          <div className="grid content-start gap-6">
            <section className="pro-card p-4 md:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Tile hue="rose" size="sm"><Target /></Tile>
                <h2 className="pro-h3">Focus on weak topics</h2>
              </div>
              {weak.length === 0 ? (
                <p className="pro-secondary">After a few sessions, the topics you find hardest will appear here for one-click practice.</p>
              ) : (
                <ul className="grid gap-2">
                  {weak.map((row) => {
                    // find the course + key that holds this topic
                    const holder = catalog.courses.find((c) => c.topics.some((t) => t.topic.toLowerCase() === String(row.key).toLowerCase()));
                    const t = holder?.topics.find((x) => x.topic.toLowerCase() === String(row.key).toLowerCase());
                    return (
                      <li key={row.key} className="flex min-w-0 items-center gap-3">
                        <Ring value={Number(row.accuracy)} size={38} stroke={4} tone={toneFor(Number(row.accuracy), Number(row.answered))}>
                          <span className="text-[0.625rem]">{Math.round(Number(row.accuracy))}</span>
                        </Ring>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium" style={{color: 'var(--pro-text)'}}>{row.key}</span>
                          <span className="pro-meta">{row.answered} answered</span>
                        </span>
                        {holder && t && (
                          <button
                            type="button"
                            className="pro-btn pro-btn-sm"
                            disabled={busy}
                            onClick={() => void start({courseId: holder.id, topicKey: t.key, count: Math.min(10, t.count), minutes: 15})}
                            aria-label={`Practise ${row.key}`}
                          >
                            Practise <ArrowRight className="size-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="pro-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 pt-4 md:px-5">
                <Tile hue="teal" size="sm"><History /></Tile>
                <h2 className="pro-h3">Recent sessions</h2>
              </div>
              {runs.length === 0 ? (
                <p className="pro-secondary p-4 md:px-5">Your finished sessions will be listed here.</p>
              ) : (
                <ul className="pro-rows mt-2 grid">
                  {runs.map((r) => {
                    const score = Number(r.total) ? (Number(r.correct) / Number(r.total)) * 100 : 0;
                    const c = r.course_id ? courseById.get(Number(r.course_id)) : undefined;
                    const hue = hueForCourse(c ?? courseByCode.get(String(r.course ?? '')) ?? {id: 0});
                    return (
                      <li key={r.id} className="flex min-w-0 items-center gap-3 px-4 py-3 md:px-5" data-hue={hue}>
                        <span className="pro-dot" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate" style={{color: 'var(--pro-text)'}}>{r.topic || (c ? `${c.code} · all topics` : r.label)}</span>
                          <span className="pro-meta flex items-center gap-1">
                            <Clock className="size-3" />
                            {r.created_at ? formatRelative(r.created_at) : ''} · {r.correct}/{r.total}
                          </span>
                        </span>
                        <Badge tone={score >= 70 ? 'success' : score >= 50 ? 'warning' : 'danger'}>{Math.round(score)}%</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
