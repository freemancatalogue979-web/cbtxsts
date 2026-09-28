/**
 * Pro courses — the course list and a course page with its topic structure.
 * Topics, question counts and the student's standing come from the shared
 * practice catalogue, analytics and Study Lab (one source of truth).
 */
import {ArrowLeft, Search, Library, BookOpen, Target, ListChecks, Compass, Database, Layers} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {api} from '../lib/api';
import type {Tab} from '../lib/nav';
import {useSession} from '../store/session';
import {createMiniExam, practiseTopic} from './actions';
import {setFocus, useFocus} from './focus';
import {Cover, Empty, LoadingRows, Metric, PageHeader, Progress, Ring, Section, hueForCourse, pct, toneFor} from './ui';

type Json = Record<string, any>;
type CourseRow = {id: number; code: string; title: string; accent?: string; available: number; topics: {topic: string; key: string; count: number}[]};

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
    /* practice runs count too — the heatmap folds in practice answers */
    for (const row of (analytics?.mastery_heatmap ?? []) as Json[]) {
      const key = String(row.topic).toLowerCase();
      if (!map.has(key) && Number(row.answered) > 0) map.set(key, {accuracy: Number(row.mastery ?? 0), answered: Number(row.answered ?? 0), state: 'Practised'});
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
          icon={<BookOpen />}
          hue={hueForCourse(open)}
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

        <div className="pro-stagger grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric icon={<Target />} hue="green" label="Your accuracy" value={stats?.answered ? pct(stats.accuracy) : '—'} tone={stats?.answered ? toneFor(stats.accuracy) : undefined} sub={stats?.answered ? 'exam answers' : 'no exam answers yet'} />
          <Metric icon={<ListChecks />} hue="blue" label="Answered" value={String(stats?.answered ?? 0)} sub="in this course" />
          <Metric icon={<Compass />} hue="violet" label="Topics studied" value={`${studied} / ${open.topics.length}`} sub={`${Math.round(open.topics.length ? (studied / open.topics.length) * 100 : 0)}% coverage`} />
          <Metric icon={<Database />} hue="amber" label="Question bank" value={String(open.available)} sub="practice questions" />
        </div>

        <Section icon={<Layers />} hue={hueForCourse(open)} title="Topics" description="Open a topic to study it, or practise it straight from the bank.">
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
                            <div className="flex min-w-0 items-center gap-3" data-hue={s?.answered ? undefined : hueForCourse(open)}>
                              <span className="pro-dot" style={s?.answered ? {background: `var(--pro-${toneFor(s.accuracy) ?? 'accent'})`} : {opacity: 0.35}} />
                              <div className="min-w-0">
                                <p className="font-semibold [overflow-wrap:anywhere]">{t.topic}</p>
                                {s?.state && <p className="pro-meta">{s.state}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="text-right"><span className="pro-count">{t.count}</span></td>
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
                              <button type="button" className="pro-btn pro-btn-sm pro-btn-soft" onClick={() => studyTopic(open, t.topic)}>
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
      <PageHeader icon={<Library />} hue="teal" eyebrow="Learn" title="Courses" description="Your courses, their topics and where you stand in each." />

      <div className="pro-search max-w-md">
        <Search />
        <input className="pro-input" placeholder="Search courses or topics" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search courses" />
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
                className="pro-card pro-lift grid min-w-0 content-start gap-4 p-2.5 text-left"
              >
                <Cover hue={hueForCourse(course)} code={course.code} glyph={<BookOpen className="size-full" />} className="min-h-[124px]">
                  <p className="mt-8 pr-12 text-[1.0625rem] leading-snug font-bold [overflow-wrap:anywhere]">{course.title}</p>
                </Cover>
                <div className="grid gap-3 px-2 pb-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <Ring value={coverage} size={44} stroke={4.5} hue={hueForCourse(course)} label={`${Math.round(coverage)}% of topics studied`}>
                      <span className="text-[0.6875rem]">{Math.round(coverage)}%</span>
                    </Ring>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-semibold" style={{color: 'var(--pro-text)'}}>
                        {studied} of {course.topics.length} topics studied
                      </p>
                      <p className="pro-meta truncate">{stats?.answered ? `${pct(stats.accuracy)} exam accuracy` : 'Coverage from practice and exams'}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="pro-chip"><ListChecks /> {course.available} questions</span>
                    <span className="pro-chip"><Layers /> {course.topics.length} topics</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
