/**
 * Pro study workspace — Course / Topic, with Study · Practice · Flashcards ·
 * Notes in one place and the AI actions beside the content, so a student can
 * stay inside the topic instead of hopping between screens.
 *
 * Content comes from Study Lab (summary, materials, common mistakes, the
 * student's own mistakes and mastery). Notes are autosaved on this device.
 */
import {BookOpen, CheckCircle2, ChevronRight, Sparkles, XCircle} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {api} from '../lib/api';
import {cacheRead, cacheWrite, userScope} from '../lib/cache';
import type {Tab} from '../lib/nav';
import {jumpToMaterial} from '../lib/palette';
import {useSession} from '../store/session';
import {AI_ACTIONS, askAbout, createMiniExam, practiseTopic} from './actions';
import {setFocus, useFocus} from './focus';
import {Badge, Empty, LoadingRows, PageHeader, Progress, Section, pct, toneFor} from './ui';

type Json = Record<string, any>;
type CourseRow = {id: number; code: string; title: string; available: number; topics: {topic: string; key: string; count: number}[]};
type WorkTab = 'study' | 'practice' | 'flashcards' | 'notes';

const WORK_TABS: {id: WorkTab; label: string}[] = [
  {id: 'study', label: 'Study'},
  {id: 'practice', label: 'Practice'},
  {id: 'flashcards', label: 'Flashcards'},
  {id: 'notes', label: 'Notes'},
];

export default function ProStudy({onTab}: {onTab: (tab: Tab) => void}) {
  const {profile, toast} = useSession();
  const focus = useFocus();
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [lab, setLab] = useState<Json | null>(null);
  const [page, setPage] = useState<Json | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [work, setWork] = useState<WorkTab>('study');

  useEffect(() => {
    api.arena
      .practiceCatalog()
      .then((d) => setCourses((d.courses ?? []) as CourseRow[]))
      .catch(() => setCourses([]));
    api.studyLabOverview().then((d) => setLab(d as Json)).catch(() => undefined);
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
        <PageHeader title="Study" description="Choose a topic to open its workspace: reading, practice, flashcards, notes and AI help in one place." />
        {lab?.continue && (
          <button
            type="button"
            className="pro-card flex min-w-0 items-center gap-4 p-4 text-left md:p-5"
            onClick={() => setFocus({topic: String(lab.continue.topic), courseId: null})}
          >
            <div className="min-w-0 flex-1">
              <p className="pro-eyebrow">Continue</p>
              <p className="pro-h3 mt-1 [overflow-wrap:anywhere]">{String(lab.continue.topic)}</p>
              <p className="pro-meta mt-0.5">
                {lab.continue.state_label} · {pct(lab.continue.accuracy)} accuracy
              </p>
            </div>
            <ChevronRight className="size-5 shrink-0" style={{color: 'var(--pro-muted)'}} />
          </button>
        )}
        {courses === null ? (
          <LoadingRows rows={4} />
        ) : courses.length === 0 ? (
          <div className="pro-card">
            <Empty title="No courses yet" body="Topics appear here once your courses have questions and materials." />
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
            {courses.map((c) => (
              <Section key={c.id} title={c.title} description={`${c.code} · ${c.topics.length} topics`}>
                {c.topics.length === 0 ? (
                  <p className="pro-secondary">No topics yet.</p>
                ) : (
                  <ul className="pro-rows grid">
                    {c.topics.map((t) => (
                      <li key={t.key}>
                        <button
                          type="button"
                          className="group flex w-full min-w-0 items-center gap-3 py-2.5 text-left first:pt-0"
                          onClick={() => setFocus({courseId: c.id, courseCode: c.code, courseTitle: c.title, topic: t.topic})}
                        >
                          <span className="min-w-0 flex-1 text-[0.875rem] [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{t.topic}</span>
                          <span className="pro-meta pro-num shrink-0">{t.count} q</span>
                          <ChevronRight className="size-4 shrink-0 opacity-40 group-hover:opacity-100" style={{color: 'var(--pro-text-2)'}} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            ))}
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
  const common: Json[] = understand.common_mistakes ?? [];
  const mistakes: Json[] = page?.mistakes?.items ?? [];
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
        eyebrow={course ? course.title : undefined}
        title={topic}
        description={
          <>
            {topicCount} questions in the bank · {page?.state_label ?? 'Not started'}
            {mastery.answered ? ` · ${pct(mastery.accuracy)} accuracy over ${mastery.answered} answers` : ''}
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

      <div className="pro-tabs" role="tablist" aria-label="Workspace">
        {WORK_TABS.map((row) => (
          <button key={row.id} type="button" role="tab" className="pro-tab" aria-selected={work === row.id} onClick={() => setWork(row.id)}>
            {row.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
          {work === 'study' &&
            (loadingPage ? (
              <LoadingRows rows={5} />
            ) : (
              <>
                <Section title="Key concepts">
                  {summary.length ? (
                    <ol className="pro-read grid list-decimal gap-2 pl-5" style={{color: 'var(--pro-text)'}}>
                      {summary.map((line, index) => (
                        <li key={index} className="pl-1 [overflow-wrap:anywhere]">
                          {line}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="pro-secondary">
                      No summary for this topic yet. Open a material below, or ask the AI to explain it.
                    </p>
                  )}
                </Section>

                <Section title="Materials" description="Reading linked to this topic.">
                  {materials.length ? (
                    <ul className="pro-rows grid">
                      {materials.map((m) => (
                        <li key={m.id} className="grid min-w-0 gap-2 py-3 first:pt-0 last:pb-0">
                          <div className="flex min-w-0 items-start gap-3">
                            <BookOpen className="mt-0.5 size-4 shrink-0" style={{color: 'var(--pro-text-2)'}} />
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
                    <p className="pro-secondary">No materials are linked to this topic yet.</p>
                  )}
                </Section>

                {common.length > 0 && (
                  <Section title="Common mistakes" description="Where students most often go wrong on this topic.">
                    <ul className="grid gap-2">
                      {common.slice(0, 5).map((row, index) => (
                        <li key={index} className="pro-secondary flex gap-2.5 [overflow-wrap:anywhere]">
                          <span className="mt-2 size-1 shrink-0 rounded-full" style={{background: 'var(--pro-warning)'}} />
                          <span>{typeof row === 'string' ? row : String(row.text ?? row.label ?? row.question ?? '')}</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                <Section title="Your mistakes" description={mistakes.length ? `${page?.mistakes?.total ?? mistakes.length} on this topic` : undefined}>
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
                          </p>
                          {row.why && <p className="pro-secondary [overflow-wrap:anywhere]">{row.why}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="pro-secondary">No mistakes recorded on this topic.</p>
                  )}
                </Section>
              </>
            ))}

          {work === 'practice' && <PracticeTab courseId={course?.id ?? null} topic={topic} max={topicCount} onTab={onTab} toast={toast} />}

          {work === 'flashcards' && (
            <Section title="Flashcards" description="Spaced review keeps this topic fresh.">
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
          <Section title="AI actions" description="Answers are grounded in your course materials.">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              {AI_ACTIONS.map((action) => (
                <button key={action.key} type="button" className="pro-btn pro-btn-sm justify-start" onClick={() => askAbout(topic, action.prompt(topic), onTab)}>
                  {action.label}
                </button>
              ))}
            </div>
          </Section>
          <Section title="Your standing">
            <div className="grid gap-3">
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="pro-meta">Accuracy</span>
                  <span className="pro-meta pro-num">{mastery.answered ? pct(mastery.accuracy) : '—'}</span>
                </div>
                <Progress value={Number(mastery.accuracy ?? 0)} tone={toneFor(Number(mastery.accuracy ?? 0), Number(mastery.answered ?? 0))} label="Topic accuracy" />
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
