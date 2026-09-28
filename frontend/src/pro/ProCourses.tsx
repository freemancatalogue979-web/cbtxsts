/**
 * Pro courses — the course list and a course page with its topic structure.
 * Topics, question counts and the student's standing come from the shared
 * practice catalogue, analytics and Study Lab (one source of truth).
 */
import {ArrowLeft, Search} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {api} from '../lib/api';
import type {Tab} from '../lib/nav';
import {useSession} from '../store/session';
import {createMiniExam, practiseTopic} from './actions';
import {setFocus, useFocus} from './focus';
import {Badge, Empty, LoadingRows, PageHeader, Progress, Section, pct, toneFor} from './ui';

type Json = Record<string, any>;
type CourseRow = {id: number; code: string; title: string; available: number; topics: {topic: string; key: string; count: number}[]};

export default function ProCourses({onTab}: {onTab: (tab: Tab) => void}) {
  const {toast} = useSession();
  const focus = useFocus();
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [analytics, setAnalytics] = useState<Json | null>(null);
  const [lab, setLab] = useState<Json | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(focus.courseId);

  useEffect(() => {
    api.arena
      .practiceCatalog()
      .then((d) => setCourses((d.courses ?? []) as CourseRow[]))
      .catch(() => setCourses([]));
    api.arena.analytics(90).then(setAnalytics).catch(() => undefined);
    api.studyLabOverview().then((d) => setLab(d as Json)).catch(() => undefined);
  }, []);

  /* topic → your standing (Study Lab state + accuracy) */
  const standing = useMemo(() => {
    const map = new Map<string, {accuracy: number; answered: number; state: string}>();
    for (const row of [...(lab?.in_progress ?? []), ...(lab?.mastered ?? [])] as Json[]) {
      map.set(String(row.topic).toLowerCase(), {accuracy: Number(row.accuracy ?? 0), answered: Number(row.answered ?? 0), state: String(row.state_label ?? '')});
    }
    for (const row of [...(analytics?.weakest_topics ?? []), ...(analytics?.strongest_topics ?? [])] as Json[]) {
      const key = String(row.key).toLowerCase();
      if (!map.has(key)) map.set(key, {accuracy: Number(row.accuracy ?? 0), answered: Number(row.answered ?? 0), state: ''});
    }
    return map;
  }, [analytics, lab]);

  const courseStats = useMemo(() => {
    const map = new Map<string, {accuracy: number; answered: number}>();
    for (const row of (analytics?.courses ?? []) as Json[]) map.set(String(row.key).toLowerCase(), {accuracy: Number(row.accuracy ?? 0), answered: Number(row.answered ?? 0)});
    return map;
  }, [analytics]);

  const statsFor = (course: CourseRow) => courseStats.get(course.code.toLowerCase()) ?? courseStats.get(course.title.toLowerCase());

  const open = courses?.find((c) => c.id === openId) ?? null;

  const studyTopic = (course: CourseRow, topic: string | null) => {
    setFocus({courseId: course.id, courseCode: course.code, courseTitle: course.title, topic});
    onTab('study');
  };

  /* ---------------------------------------------------------- course page */
  if (open) {
    const stats = statsFor(open);
    const studied = open.topics.filter((t) => standing.get(t.topic.toLowerCase())?.answered).length;
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <div>
          <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm -ml-2" onClick={() => setOpenId(null)}>
            <ArrowLeft className="size-4" /> All courses
          </button>
        </div>
        <PageHeader
          eyebrow={open.code}
          title={open.title}
          description={`${open.topics.length} topics · ${open.available} practice questions`}
          actions={
            <>
              <button
                type="button"
                className="pro-btn"
                disabled={busy === 'mini'}
                onClick={async () => {
                  setBusy('mini');
                  await createMiniExam({courseId: open.id, count: 10, minutes: 10}, toast);
                  setBusy(null);
                }}
              >
                Create mini exam
              </button>
              <button type="button" className="pro-btn pro-btn-primary" onClick={() => studyTopic(open, open.topics[0]?.topic ?? null)}>
                Study this course
              </button>
            </>
          }
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniStat label="Your accuracy" value={stats?.answered ? pct(stats.accuracy) : '—'} />
          <MiniStat label="Answered" value={String(stats?.answered ?? 0)} />
          <MiniStat label="Topics studied" value={`${studied} / ${open.topics.length}`} />
          <MiniStat label="Question bank" value={String(open.available)} />
        </div>

        <Section title="Topics" description="Open a topic to study it, or practise it straight from the bank.">
          {open.topics.length === 0 ? (
            <Empty title="No topics yet" body="Your lecturers have not organised this course into topics yet." />
          ) : (
            <>
              {/* table ≥ md */}
              <div className="hidden md:block">
                <table className="pro-table">
                  <thead>
                    <tr>
                      <th>Topic</th>
                      <th className="w-24 text-right">Questions</th>
                      <th className="w-48">Your accuracy</th>
                      <th className="w-56 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.topics.map((t) => {
                      const s = standing.get(t.topic.toLowerCase());
                      return (
                        <tr key={t.key}>
                          <td>
                            <p className="font-medium [overflow-wrap:anywhere]">{t.topic}</p>
                            {s?.state && <p className="pro-meta">{s.state}</p>}
                          </td>
                          <td className="pro-num text-right">{t.count}</td>
                          <td>
                            {s?.answered ? (
                              <div className="flex items-center gap-2.5">
                                <div className="min-w-0 flex-1">
                                  <Progress value={s.accuracy} tone={toneFor(s.accuracy)} label={`${t.topic} accuracy`} />
                                </div>
                                <span className="pro-num pro-meta w-10 text-right">{pct(s.accuracy)}</span>
                              </div>
                            ) : (
                              <span className="pro-meta">Not started</span>
                            )}
                          </td>
                          <td className="text-right">
                            <div className="inline-flex gap-1.5">
                              <button type="button" className="pro-btn pro-btn-sm" onClick={() => studyTopic(open, t.topic)}>
                                Study
                              </button>
                              <button
                                type="button"
                                className="pro-btn pro-btn-sm"
                                disabled={busy === t.key}
                                onClick={async () => {
                                  setBusy(t.key);
                                  await practiseTopic({courseId: open.id, topic: t.topic, size: Math.min(10, t.count)}, onTab, toast);
                                  setBusy(null);
                                }}
                              >
                                Practise
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* list < md */}
              <ul className="pro-rows grid md:hidden">
                {open.topics.map((t) => {
                  const s = standing.get(t.topic.toLowerCase());
                  return (
                    <li key={t.key} className="grid gap-2.5 py-3.5 first:pt-0 last:pb-0">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[0.9375rem] font-medium [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{t.topic}</p>
                          <p className="pro-meta">
                            {t.count} questions{s?.answered ? ` · ${pct(s.accuracy)} accuracy` : ' · Not started'}
                          </p>
                        </div>
                      </div>
                      {s?.answered ? <Progress value={s.accuracy} tone={toneFor(s.accuracy)} label={`${t.topic} accuracy`} /> : null}
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" className="pro-btn pro-btn-sm" onClick={() => studyTopic(open, t.topic)}>
                          Study
                        </button>
                        <button
                          type="button"
                          className="pro-btn pro-btn-sm"
                          disabled={busy === t.key}
                          onClick={async () => {
                            setBusy(t.key);
                            await practiseTopic({courseId: open.id, topic: t.topic, size: Math.min(10, t.count)}, onTab, toast);
                            setBusy(null);
                          }}
                        >
                          Practise
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Section>
      </div>
    );
  }

  /* ---------------------------------------------------------- course list */
  const term = query.trim().toLowerCase();
  const list = (courses ?? []).filter((c) => !term || `${c.code} ${c.title} ${c.topics.map((t) => t.topic).join(' ')}`.toLowerCase().includes(term));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader title="Courses" description="Your courses, their topics and where you stand in each." />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" style={{color: 'var(--pro-muted)'}} />
        <input className="pro-input pl-9" placeholder="Search courses or topics" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search courses" />
      </div>

      {courses === null ? (
        <LoadingRows rows={4} />
      ) : list.length === 0 ? (
        <div className="pro-card">
          <Empty title={term ? 'No matching courses' : 'No courses yet'} body={term ? 'Try a different search.' : 'Courses appear here once your institution adds them.'} />
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((course) => {
            const stats = statsFor(course);
            const studied = course.topics.filter((t) => standing.get(t.topic.toLowerCase())?.answered).length;
            const coverage = course.topics.length ? (studied / course.topics.length) * 100 : 0;
            return (
              <button
                key={course.id}
                type="button"
                onClick={() => {
                  setOpenId(course.id);
                  setFocus({courseId: course.id, courseCode: course.code, courseTitle: course.title});
                }}
                className="pro-card grid min-w-0 gap-3 p-4 text-left transition-colors hover:border-[var(--pro-border-strong)] md:p-5"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="pro-eyebrow">{course.code}</p>
                    <p className="pro-h3 mt-1 [overflow-wrap:anywhere]">{course.title}</p>
                  </div>
                  {stats?.answered ? <Badge tone={toneFor(stats.accuracy)}>{pct(stats.accuracy)}</Badge> : null}
                </div>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="pro-meta">Topics studied</span>
                    <span className="pro-meta pro-num">{studied} / {course.topics.length}</span>
                  </div>
                  <Progress value={coverage} label={`${course.code} topics studied`} />
                </div>
                <p className="pro-meta">{course.available} questions in the bank</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniStat({label, value}: {label: string; value: string}) {
  return (
    <div className="pro-card p-3.5">
      <p className="pro-eyebrow truncate">{label}</p>
      <p className="mt-1.5 text-[1.25rem] font-semibold pro-num" style={{color: 'var(--pro-text)'}}>{value}</p>
    </div>
  );
}
