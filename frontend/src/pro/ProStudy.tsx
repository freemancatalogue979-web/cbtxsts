/**
 * Pro study workspace — Course / Topic, with Study · Practice · Flashcards ·
 * Notes in one place and the AI actions beside the content, so a student can
 * stay inside the topic instead of hopping between screens.
 *
 * Content comes from Study Lab (summary, materials, common mistakes, the
 * student's own mistakes and mastery). Notes are autosaved on this device.
 */
import {Activity, AlertTriangle, BookOpen, CheckCircle2, ChevronRight, Feather, FileText, GraduationCap, Layers, Lightbulb, ListChecks, NotebookPen, Search, Sparkles, Target, Wand2, XCircle} from 'lucide-react';
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {api} from '../lib/api';
import {cacheRead, cacheWrite, userScope} from '../lib/cache';
import type {Tab} from '../lib/nav';
import {jumpToMaterial} from '../lib/palette';
import {useSession} from '../store/session';
import {AI_ACTIONS, askAbout, createMiniExam, practiseTopic} from './actions';
import {setFocus, useFocus} from './focus';
import {Badge, Chip, Cover, Empty, LoadingRows, PageHeader, Ring, Section, Tile, hueForCourse, pct, toneFor, type Hue} from './ui';

type Json = Record<string, any>;
type CourseRow = {id: number; code: string; title: string; accent?: string; available: number; topics: {topic: string; key: string; count: number}[]};
type WorkTab = 'study' | 'practice' | 'flashcards' | 'notes';

const WORK_TABS: {id: WorkTab; label: string; icon: ReactNode}[] = [
  {id: 'study', label: 'Study', icon: <BookOpen />},
  {id: 'practice', label: 'Practice', icon: <Target />},
  {id: 'flashcards', label: 'Flashcards', icon: <Layers />},
  {id: 'notes', label: 'Notes', icon: <NotebookPen />},
];

const ACTION_LOOK: Record<string, {icon: ReactNode; hue: Hue; hint: string}> = {
  explain: {icon: <Lightbulb />, hue: 'amber', hint: 'Key ideas, in order'},
  simplify: {icon: <Feather />, hue: 'teal', hint: 'Plain-language version'},
  examples: {icon: <Wand2 />, hue: 'violet', hint: 'Worked cases'},
  test: {icon: <Target />, hue: 'rose', hint: 'Five quick questions'},
  flashcards: {icon: <Layers />, hue: 'blue', hint: 'Build a review set'},
  analyze: {icon: <Activity />, hue: 'green', hint: 'What to revise next'},
};

export default function ProStudy({onTab}: {onTab: (tab: Tab) => void}) {
  const {profile, toast} = useSession();
  const focus = useFocus();
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [lab, setLab] = useState<Json | null>(null);
  const [page, setPage] = useState<Json | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [work, setWork] = useState<WorkTab>('study');
  const [heat, setHeat] = useState<Map<string, {mastery: number; answered: number}>>(new Map());
  const [find, setFind] = useState('');

  useEffect(() => {
    api.arena
      .practiceCatalog()
      .then((d) => setCourses((d.courses ?? []) as CourseRow[]))
      .catch(() => setCourses([]));
    api.studyLabOverview().then((d) => setLab(d as Json)).catch(() => undefined);
    api.arena
      .analytics(90)
      .then((d) => {
        const map = new Map<string, {mastery: number; answered: number}>();
        for (const row of ((d as Json).mastery_heatmap ?? []) as Json[]) map.set(String(row.topic).toLowerCase(), {mastery: Number(row.mastery ?? 0), answered: Number(row.answered ?? 0)});
        setHeat(map);
      })
      .catch(() => undefined);
  }, []);

  /* Resolve the course for a topic opened from elsewhere (dashboard, AI). */
  const course = useMemo(() => {
    if (!courses) return null;
    if (focus.courseId) return courses.find((c) => c.id === focus.courseId) ?? null;
    if (focus.topic) return courses.find((c) => c.topics.some((t) => t.topic.toLowerCase() === focus.topic!.toLowerCase())) ?? null;
    return null;
  }, [courses, focus.courseId, focus.topic]);

  const topic = focus.topic;

  useEffect(() => {
    if (!topic) {
      setPage(null);
      return;
    }
    let live = true;
    setLoadingPage(true);
    api
      .studyLabTopic(topic)
      .then((d) => live && setPage(d as Json))
      .catch(() => live && setPage(null))
      .finally(() => live && setLoadingPage(false));
    return () => {
      live = false;
    };
  }, [topic]);

  /* ------------------------------------------------------ topic chooser */
  if (!topic) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <PageHeader icon={<GraduationCap />} hue="blue" eyebrow="Learn" title="Study" description="Choose a topic to open its workspace: reading, practice, flashcards, notes and AI help in one place." />
        {lab?.continue && (
          <button
            type="button"
            className="pro-card pro-lift flex min-w-0 items-center gap-4 p-4 text-left md:p-5"
            data-hue="blue"
            onClick={() => setFocus({topic: String(lab.continue.topic), courseId: null})}
          >
            <Ring value={Number(lab.continue.accuracy ?? 0)} size={52} stroke={5} hue="blue" label={`${pct(lab.continue.accuracy)} accuracy`}>
              <BookOpen className="size-5" style={{color: 'var(--mark)'}} />
            </Ring>
            <div className="min-w-0 flex-1">
              <p className="pro-eyebrow" style={{color: 'var(--mark)'}}>Continue where you left off</p>
              <p className="pro-h3 mt-0.5 [overflow-wrap:anywhere]">{String(lab.continue.topic)}</p>
              <p className="pro-meta mt-0.5">
                {lab.continue.state_label} · {pct(lab.continue.accuracy)} accuracy
              </p>
            </div>
            <span className="pro-btn pro-btn-primary hidden sm:inline-flex">
              Open <ChevronRight className="size-4" />
            </span>
          </button>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="pro-search min-w-0 flex-1 sm:max-w-sm">
            <Search />
            <input className="pro-input" placeholder="Find a topic" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find a topic" />
          </div>
          <div className="flex flex-wrap items-center gap-3 pro-meta">
            <span className="inline-flex items-center gap-1.5"><span className="pro-dot" style={{background: 'var(--pro-success)'}} /> Strong</span>
            <span className="inline-flex items-center gap-1.5"><span className="pro-dot" style={{background: 'var(--pro-warning)'}} /> Building</span>
            <span className="inline-flex items-center gap-1.5"><span className="pro-dot" style={{background: 'var(--pro-danger)'}} /> Needs work</span>
            <span className="inline-flex items-center gap-1.5"><span className="pro-dot" style={{background: 'var(--pro-track)'}} /> New</span>
          </div>
        </div>
        {courses === null ? (
          <LoadingRows rows={4} />
        ) : courses.length === 0 ? (
          <div className="pro-card">
            <Empty icon={<GraduationCap />} hue="blue" title="No courses yet" body="Topics appear here once your courses have questions and materials." />
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
            {courses.map((c) => {
              const hue = hueForCourse(c);
              const term = find.trim().toLowerCase();
              const topics = c.topics.filter((t) => !term || t.topic.toLowerCase().includes(term));
              const started = c.topics.filter((t) => heat.get(t.topic.toLowerCase())?.answered).length;
              if (term && !topics.length) return null;
              return (
                <section key={c.id} className="pro-card overflow-hidden p-2.5">
                  <Cover hue={hue} code={c.code} glyph={<GraduationCap className="size-full" />}>
                    <div className="mt-5 flex min-w-0 items-end justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-[1.0625rem] leading-snug font-bold [overflow-wrap:anywhere]">{c.title}</h2>
                        <p className="mt-0.5 text-[0.75rem] font-semibold text-white/80">
                          {c.topics.length} topics · {started} started
                        </p>
                      </div>
                    </div>
                  </Cover>
                  {topics.length === 0 ? (
                    <p className="pro-secondary p-3">No topics yet.</p>
                  ) : (
                    <ul className="grid gap-0.5 px-3 pt-2 pb-1">
                      {topics.map((t) => {
                        const st = heat.get(t.topic.toLowerCase());
                        const tone = st?.answered ? toneFor(st.mastery) : undefined;
                        return (
                          <li key={t.key}>
                            <button
                              type="button"
                              className="pro-row-btn group py-2"
                              onClick={() => setFocus({courseId: c.id, courseCode: c.code, courseTitle: c.title, topic: t.topic})}
                            >
                              <span className="pro-dot" style={{background: tone ? `var(--pro-${tone})` : 'var(--pro-track)'}} />
                              <span className="min-w-0 flex-1">
                                <span className="block text-[0.8438rem] font-semibold [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{t.topic}</span>
                                {st?.answered ? (
                                  <span className="mt-1 flex items-center gap-2">
                                    <span className="h-1 w-20 overflow-hidden rounded-full" style={{background: 'var(--pro-track)'}}>
                                      <span className="block h-full rounded-full" style={{width: `${Math.max(4, st.mastery)}%`, background: `var(--pro-${tone})`}} />
                                    </span>
                                    <span className="pro-meta">{pct(st.mastery)} mastery</span>
                                  </span>
                                ) : null}
                              </span>
                              <span className="pro-count">{t.count} q</span>
                              <ChevronRight className="size-4 shrink-0 opacity-40 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" style={{color: 'var(--pro-text-2)'}} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ---------------------------------------------------------- workspace */
  const mastery = (page?.mastery ?? {}) as Json;
  const understand = (page?.understand ?? {}) as Json;
  const materials: Json[] = understand.materials ?? [];
  const summary: string[] = understand.summary ?? [];
  const mistakes: Json[] = page?.mistakes?.items ?? [];
  /* common mistakes arrive as question references; resolve them to text and
     only list traps the student hasn't already made (those get a badge). */
  const commonIds = new Set(((understand.common_mistakes ?? []) as Json[]).map((row) => Number(row?.question_id)).filter(Boolean));
  const ownIds = new Set(mistakes.map((row) => Number(row.question_id)));
  const common: {text: string; detail?: string}[] = ((understand.common_mistakes ?? []) as Json[])
    .map((row): {text: string; detail?: string} | null => {
      if (typeof row === 'string') return {text: String(row)};
      if (row?.question_id && ownIds.has(Number(row.question_id))) return null;
      const text = String(row?.text ?? row?.label ?? row?.question ?? '').trim();
      if (!text) return null;
      return {text, detail: row.selected && row.correct_key ? `Often answered ${row.selected} — correct is ${row.correct_key}` : undefined};
    })
    .filter((row): row is {text: string; detail?: string} => Boolean(row));
  const hue = hueForCourse(course);
  const topicCount = course?.topics.find((t) => t.topic.toLowerCase() === topic.toLowerCase())?.count ?? Number(page?.pool ?? 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {/* breadcrumb + switcher */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem]" style={{color: 'var(--pro-text-2)'}}>
        <button type="button" className="pro-link" onClick={() => setFocus({topic: null})}>
          Study
        </button>
        <ChevronRight className="size-3.5 shrink-0" />
        {course ? (
          <button type="button" className="pro-link" onClick={() => { setFocus({courseId: course.id, courseCode: course.code, courseTitle: course.title}); onTab('courses'); }}>
            {course.code}
          </button>
        ) : (
          <span>Topic</span>
        )}
        <ChevronRight className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate" style={{color: 'var(--pro-text)'}}>{topic}</span>
      </div>

      <PageHeader
        icon={<GraduationCap />}
        hue={hue}
        eyebrow={course ? `${course.code} · ${course.title}` : 'Topic'}
        title={topic}
        description={mastery.answered ? `${pct(mastery.accuracy)} accuracy over ${mastery.answered} answers — keep going until the mastery check is passed.` : 'Read the key ideas, then practise to build your standing.'}
        meta={
          <>
            <Chip icon={<ListChecks />} hue="blue">{topicCount} questions</Chip>
            <Chip icon={<Activity />} hue={mastery.check_passed ? 'green' : 'amber'}>{page?.state_label ?? 'Not started'}</Chip>
            {mistakes.length > 0 && <Chip icon={<AlertTriangle />} hue="rose">{page?.mistakes?.total ?? mistakes.length} to revisit</Chip>}
          </>
        }
        actions={
          course && course.topics.length > 1 ? (
            <select
              className="pro-input w-auto max-w-[16rem]"
              aria-label="Switch topic"
              value={course.topics.find((t) => t.topic.toLowerCase() === topic.toLowerCase())?.topic ?? ''}
              onChange={(e) => setFocus({topic: e.target.value})}
            >
              {course.topics.map((t) => (
                <option key={t.key} value={t.topic}>
                  {t.topic}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      <div className="pro-tabs pro-tabs-fit" role="tablist" aria-label="Workspace">
        {WORK_TABS.map((row) => (
          <button key={row.id} type="button" role="tab" className="pro-tab" aria-selected={work === row.id} onClick={() => setWork(row.id)}>
            {row.icon}
            {row.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
          {work === 'study' &&
            (loadingPage ? (
              <LoadingRows rows={5} />
            ) : (
              <>
                <Section icon={<Lightbulb />} hue="amber" title="Key concepts">
                  {summary.length ? (
                    <ol className="pro-read grid list-decimal gap-2 pl-5" style={{color: 'var(--pro-text)'}}>
                      {summary.map((line, index) => (
                        <li key={index} className="pl-1 [overflow-wrap:anywhere]">
                          {line}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <p className="pro-secondary min-w-0 flex-1">No summary for this topic yet. Open a material below, or let the AI walk you through it.</p>
                      <button type="button" className="pro-btn pro-btn-soft pro-btn-sm" onClick={() => askAbout(topic, AI_ACTIONS[0].prompt(topic), onTab)}>
                        <Sparkles className="size-4" /> Explain it
                      </button>
                    </div>
                  )}
                </Section>

                <Section icon={<BookOpen />} hue="blue" title="Materials" description="Reading linked to this topic.">
                  {materials.length ? (
                    <ul className="pro-rows grid">
                      {materials.map((m) => (
                        <li key={m.id} className="grid min-w-0 gap-2 py-3 first:pt-0 last:pb-0">
                          <div className="flex min-w-0 items-start gap-3">
                            <Tile hue="blue" size="sm"><FileText /></Tile>
                            <div className="min-w-0 flex-1">
                              <p className="text-[0.9375rem] font-medium [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{m.title}</p>
                              <p className="pro-meta">
                                {(m.sections ?? []).length} sections{m.estimated_minutes ? ` · ${m.estimated_minutes} min read` : ''}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="pro-btn pro-btn-sm shrink-0"
                              onClick={() => {
                                onTab('materials');
                                jumpToMaterial(Number(m.id));
                              }}
                            >
                              Read
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <p className="pro-secondary min-w-0 flex-1">No materials are linked to this topic yet.</p>
                      <button type="button" className="pro-btn pro-btn-sm" onClick={() => onTab('materials')}>Browse library</button>
                    </div>
                  )}
                </Section>

                {common.length > 0 && (
                  <Section icon={<AlertTriangle />} hue="amber" title="Common mistakes" description="Where students most often go wrong on this topic.">
                    <ul className="pro-rows grid">
                      {common.slice(0, 5).map((row, index) => (
                        <li key={index} className="grid min-w-0 gap-1 py-3 first:pt-0 last:pb-0 [overflow-wrap:anywhere]">
                          <span className="text-[0.9375rem]" style={{color: 'var(--pro-text)'}}>{row.text}</span>
                          {row.detail && <span className="pro-meta">{row.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                <Section icon={<XCircle />} hue="rose" title="Your mistakes" description={mistakes.length ? `${page?.mistakes?.total ?? mistakes.length} on this topic` : undefined}>
                  {mistakes.length ? (
                    <ul className="pro-rows grid">
                      {mistakes.slice(0, 6).map((row) => (
                        <li key={row.id} className="grid min-w-0 gap-1.5 py-3.5 first:pt-0 last:pb-0">
                          <p className="text-[0.9375rem] [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{row.question}</p>
                          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem]">
                            <span className="inline-flex items-center gap-1.5" style={{color: 'var(--pro-danger)'}}>
                              <XCircle className="size-3.5" /> You: {row.your_answer || '—'}
                            </span>
                            <span className="inline-flex items-center gap-1.5" style={{color: 'var(--pro-success)'}}>
                              <CheckCircle2 className="size-3.5" /> Correct: {row.correct_answer}
                            </span>
                            {row.resolved && <Badge tone="success">Resolved</Badge>}
                            {commonIds.has(Number(row.question_id)) && <Badge tone="warning">Common trap</Badge>}
                          </p>
                          {row.why && <p className="pro-secondary [overflow-wrap:anywhere]">{row.why}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="pro-secondary inline-flex items-center gap-2"><CheckCircle2 className="size-4" style={{color: 'var(--pro-success)'}} /> No mistakes recorded on this topic.</p>
                  )}
                </Section>
              </>
            ))}

          {work === 'practice' && <PracticeTab courseId={course?.id ?? null} topic={topic} max={topicCount} onTab={onTab} toast={toast} />}

          {work === 'flashcards' && (
            <Section icon={<Layers />} hue="blue" title="Flashcards" description="Spaced review keeps this topic fresh.">
              <div className="grid gap-4">
                <p className="pro-secondary">
                  Review your due cards, or have the AI build a set for <span style={{color: 'var(--pro-text)'}}>{topic}</span> from your course materials.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="pro-btn pro-btn-primary" onClick={() => onTab('flashcards')}>
                    Review flashcards
                  </button>
                  <button type="button" className="pro-btn" onClick={() => askAbout(topic, AI_ACTIONS.find((a) => a.key === 'flashcards')!.prompt(topic), onTab)}>
                    <Sparkles className="size-4" /> Create with AI
                  </button>
                </div>
              </div>
            </Section>
          )}

          {work === 'notes' && <NotesTab scope={userScope(profile?.id)} topic={topic} />}
        </div>

        {/* side panel: AI actions + standing */}
        <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
          <Section icon={<Sparkles />} hue="violet" title="AI actions" description="Grounded in your course materials.">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
              {AI_ACTIONS.map((action) => {
                const look = ACTION_LOOK[action.key] ?? {icon: <Sparkles />, hue: 'violet' as Hue, hint: ''};
                return (
                  <button key={action.key} type="button" className="pro-row-btn" onClick={() => askAbout(topic, action.prompt(topic), onTab)}>
                    <Tile hue={look.hue} size="sm">{look.icon}</Tile>
                    <span className="grid min-w-0 flex-1 text-left">
                      <span className="truncate text-[0.875rem] font-semibold" style={{color: 'var(--pro-text)'}}>{action.label}</span>
                      {look.hint && <span className="pro-meta truncate">{look.hint}</span>}
                    </span>
                    <ChevronRight className="size-4 shrink-0" style={{color: 'var(--pro-muted)'}} />
                  </button>
                );
              })}
            </div>
          </Section>
          <Section icon={<Target />} hue="green" title="Your standing">
            <div className="grid gap-4">
              <div className="flex items-center gap-4">
                <Ring value={Number(mastery.accuracy ?? 0)} size={72} stroke={6} tone={toneFor(Number(mastery.accuracy ?? 0), Number(mastery.answered ?? 0))} label="Topic accuracy">
                  <span className="pro-num text-[1rem] font-bold" style={{color: 'var(--pro-text)'}}>{mastery.answered ? pct(mastery.accuracy) : '—'}</span>
                </Ring>
                <div className="grid min-w-0 gap-0.5">
                  <span className="text-[0.9375rem] font-semibold" style={{color: 'var(--pro-text)'}}>{page?.state_label ?? 'Not started'}</span>
                  <span className="pro-meta">{mastery.check_passed ? 'Mastery check passed' : 'Pass the mastery check to master it'}</span>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-[0.8125rem]">
                <dt className="pro-meta">Answered</dt>
                <dd className="pro-num text-right" style={{color: 'var(--pro-text)'}}>{Number(mastery.answered ?? 0)}</dd>
                <dt className="pro-meta">Correct</dt>
                <dd className="pro-num text-right" style={{color: 'var(--pro-text)'}}>{Number(mastery.correct ?? 0)}</dd>
                <dt className="pro-meta">Mastery check</dt>
                <dd className="text-right" style={{color: 'var(--pro-text)'}}>{mastery.check_passed ? 'Passed' : 'Not yet'}</dd>
              </dl>
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}

function PracticeTab({courseId, topic, max, onTab, toast}: {courseId: number | null; topic: string; max: number; onTab: (tab: Tab) => void; toast: ReturnType<typeof useSession>['toast']}) {
  const sizes = [5, 10, 20, 30].filter((n) => n <= Math.max(5, max));
  const [size, setSize] = useState(Math.min(10, Math.max(1, max || 10)));
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState<'practice' | 'mini' | null>(null);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Section title="Practice" description="Timed practice from the question bank. Explanations are shown after each answer.">
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <label className="grid gap-1.5">
              <span className="pro-meta">Questions</span>
              <select className="pro-input" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {(sizes.length ? sizes : [max]).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
                {max > 0 && !sizes.includes(max) && <option value={max}>All ({max})</option>}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="pro-meta">Time limit</span>
              <select className="pro-input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[5, 10, 15, 20, 30, 45].map((n) => (
                  <option key={n} value={n}>
                    {n} min
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="pro-btn pro-btn-primary"
              disabled={busy !== null || !courseId || max === 0}
              onClick={async () => {
                setBusy('practice');
                await practiseTopic({courseId, topic, size, minutes}, onTab, toast);
                setBusy(null);
              }}
            >
              {busy === 'practice' ? 'Starting…' : 'Start practice'}
            </button>
          </div>
          {!courseId && <p className="pro-meta">Open this topic from Courses to practise it.</p>}
        </div>
      </Section>
      <Section title="Mini exam" description="A real, timed exam on this topic, marked and analysed when you finish.">
        <button
          type="button"
          className="pro-btn"
          disabled={busy !== null || !courseId}
          onClick={async () => {
            if (!courseId) return;
            setBusy('mini');
            await createMiniExam({courseId, topics: [topic], count: Math.min(size, Math.max(1, max)), minutes}, toast);
            setBusy(null);
          }}
        >
          {busy === 'mini' ? 'Creating…' : `Create a ${Math.min(size, Math.max(1, max))}-question mini exam`}
        </button>
      </Section>
    </div>
  );
}

function NotesTab({scope, topic}: {scope: string; topic: string}) {
  const key = `pro.notes.${topic.toLowerCase()}`;
  const [text, setText] = useState(() => cacheRead<string>(scope, key) ?? '');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setText(cacheRead<string>(scope, key) ?? '');
    setSaved('idle');
  }, [key, scope]);

  const onChange = (value: string) => {
    setText(value);
    setSaved('saving');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      cacheWrite(scope, key, value);
      setSaved('saved');
    }, 500);
  };

  return (
    <Section title="Notes" description="Private to you. Saved automatically on this device." action={<span className="pro-meta">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}</span>}>
      <textarea
        className="pro-input pro-read min-h-[18rem] w-full resize-y py-3"
        style={{maxWidth: 'none'}}
        placeholder={`Write your notes on ${topic}…`}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Notes on ${topic}`}
      />
    </Section>
  );
}
