/**
 * Pro exams — official exams (open, upcoming, completed) and the student's
 * mini exams, plus a compact form to create a real, timed mini exam.
 */
import {useEffect, useMemo, useState} from 'react';
import {api} from '../lib/api';
import {formatRelative} from '../lib/format';
import type {Quiz} from '../lib/types';
import {miniExamApi, openMiniExam, type MiniExam} from '../lib/tutor';
import {useSession} from '../store/session';
import {createMiniExam} from './actions';
import {Badge, Empty, LoadingRows, PageHeader, Section, pct, toneFor} from './ui';

type CourseRow = {id: number; code: string; title: string; available: number; topics: {topic: string}[]};
type Filter = 'open' | 'upcoming' | 'completed' | 'mini';

function examState(quiz: Quiz): Filter {
  const attempt = quiz.my_attempt;
  if (attempt && (attempt.status === 'submitted' || attempt.status === 'expired')) return 'completed';
  if (quiz.status === 'active') return 'open';
  if (quiz.status === 'scheduled' || quiz.status === 'draft') return 'upcoming';
  return 'completed';
}

export default function ProExams({onStartExam, onOpenResult}: {onStartExam: (quiz: Quiz) => void; onOpenResult: (attemptId: number) => void}) {
  const {toast} = useSession();
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null);
  const [minis, setMinis] = useState<MiniExam[] | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [filter, setFilter] = useState<Filter>('open');

  useEffect(() => {
    api.quizzes().then((d) => setQuizzes(d.filter((q) => !q.is_bank))).catch(() => setQuizzes([]));
    miniExamApi.list().then((d) => setMinis(d.mini_exams ?? [])).catch(() => setMinis([]));
    api.arena.practiceCatalog().then((d) => setCourses((d.courses ?? []) as CourseRow[])).catch(() => undefined);
  }, []);

  const groups = useMemo(() => {
    const out: Record<'open' | 'upcoming' | 'completed', Quiz[]> = {open: [], upcoming: [], completed: []};
    for (const quiz of quizzes ?? []) out[examState(quiz) as 'open' | 'upcoming' | 'completed'].push(quiz);
    return out;
  }, [quizzes]);

  const tabs: {id: Filter; label: string; count: number | null}[] = [
    {id: 'open', label: 'Open now', count: quizzes ? groups.open.length : null},
    {id: 'upcoming', label: 'Upcoming', count: quizzes ? groups.upcoming.length : null},
    {id: 'completed', label: 'Completed', count: quizzes ? groups.completed.length : null},
    {id: 'mini', label: 'Mini exams', count: minis ? minis.length : null},
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader title="Exams" description="Official exams run in a strict, timed environment. Mini exams are personal, timed tests built from the question bank." />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
          <div className="pro-tabs" role="tablist" aria-label="Exam lists">
            {tabs.map((row) => (
              <button key={row.id} type="button" role="tab" className="pro-tab" aria-selected={filter === row.id} onClick={() => setFilter(row.id)}>
                {row.label}
                {row.count != null && <span className="pro-meta ml-1.5 pro-num">{row.count}</span>}
              </button>
            ))}
          </div>

          {filter === 'mini' ? (
            minis === null ? (
              <LoadingRows rows={3} />
            ) : minis.length === 0 ? (
              <div className="pro-card">
                <Empty title="No mini exams yet" body="Create one from the panel beside this list, or ask the AI Assistant for a targeted test." />
              </div>
            ) : (
              <div className="pro-card overflow-hidden">
                <ul className="pro-rows grid">
                  {minis.map((m) => (
                    <li key={m.id}>
                      <button type="button" className="flex w-full min-w-0 items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--pro-hover)]" onClick={() => openMiniExam(m.id)}>
                        <div className="min-w-0 flex-1">
                          <p className="text-[0.9375rem] font-medium [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{m.title}</p>
                          <p className="pro-meta">
                            {m.question_count} questions · {m.duration_minutes} min
                            {m.created_by === 'ai' ? ' · AI-built' : ''}
                            {m.finished_at ? ` · ${formatRelative(m.finished_at)}` : m.created_at ? ` · ${formatRelative(m.created_at)}` : ''}
                          </p>
                        </div>
                        {m.status === 'submitted' || m.status === 'expired' ? (
                          <Badge tone={toneFor(Number(m.percentage ?? 0))}>{pct(m.percentage)}</Badge>
                        ) : m.status === 'in_progress' ? (
                          <Badge tone="accent">In progress</Badge>
                        ) : (
                          <Badge>Ready</Badge>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : quizzes === null ? (
            <LoadingRows rows={3} />
          ) : groups[filter].length === 0 ? (
            <div className="pro-card">
              <Empty
                title={filter === 'open' ? 'No exams open right now' : filter === 'upcoming' ? 'Nothing scheduled' : 'No completed exams'}
                body={filter === 'open' ? 'Scheduled exams open here at their start time.' : undefined}
              />
            </div>
          ) : (
            <div className="pro-card overflow-hidden">
              <div className="pro-scroll-x">
                <table className="pro-table min-w-[36rem]">
                  <thead>
                    <tr>
                      <th>Exam</th>
                      <th className="w-24">Course</th>
                      <th className="w-24 text-right">Questions</th>
                      <th className="w-20 text-right">Time</th>
                      <th className="w-32 text-right">{filter === 'completed' ? 'Score' : ''}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups[filter].map((quiz) => {
                      const attempt = quiz.my_attempt;
                      return (
                        <tr key={quiz.id}>
                          <td>
                            <p className="font-medium [overflow-wrap:anywhere]">{quiz.title}</p>
                            {filter === 'upcoming' && quiz.scheduled_at && <p className="pro-meta">Opens {formatRelative(quiz.scheduled_at)}</p>}
                          </td>
                          <td className="pro-meta">{quiz.course?.code ?? '—'}</td>
                          <td className="pro-num text-right">{quiz.question_count}</td>
                          <td className="pro-num text-right">{quiz.duration_minutes}m</td>
                          <td className="text-right">
                            {filter === 'completed' && attempt ? (
                              <button type="button" className="pro-btn pro-btn-sm" onClick={() => onOpenResult(attempt.id)}>
                                {pct(attempt.percentage)} · Result
                              </button>
                            ) : filter === 'open' ? (
                              <button type="button" className="pro-btn pro-btn-sm pro-btn-primary" onClick={() => onStartExam(quiz)}>
                                {attempt?.status === 'in_progress' ? 'Resume' : 'Start'}
                              </button>
                            ) : (
                              <span className="pro-meta">Not open</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <CreateMini courses={courses} toast={toast} />
      </div>
    </div>
  );
}

function CreateMini({courses, toast}: {courses: CourseRow[]; toast: ReturnType<typeof useSession>['toast']}) {
  const [courseId, setCourseId] = useState<number | ''>('');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(20);
  const [minutes, setMinutes] = useState(20);
  const [difficulty, setDifficulty] = useState('mixed');
  const [focus, setFocusMode] = useState<'mixed' | 'weak' | 'new'>('mixed');
  const [busy, setBusy] = useState(false);
  const course = courses.find((c) => c.id === courseId);

  useEffect(() => {
    if (courseId === '' && courses.length) setCourseId(courses[0].id);
  }, [courseId, courses]);

  return (
    <Section title="Create a mini exam" description="Built from the question bank and marked by the server.">
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!courseId) return;
          setBusy(true);
          await createMiniExam({courseId, topics: topic ? [topic] : undefined, count, minutes, difficulty, focus}, toast);
          setBusy(false);
        }}
      >
        <label className="grid gap-1.5">
          <span className="pro-meta">Course</span>
          <select className="pro-input" value={courseId} onChange={(e) => { setCourseId(Number(e.target.value)); setTopic(''); }}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="pro-meta">Topic</span>
          <select className="pro-input" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">All topics</option>
            {(course?.topics ?? []).map((t) => (
              <option key={t.topic} value={t.topic}>
                {t.topic}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5">
            <span className="pro-meta">Questions</span>
            <select className="pro-input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[5, 10, 20, 30, 40, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="pro-meta">Time</span>
            <select className="pro-input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[5, 10, 15, 20, 30, 45, 60].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="pro-meta">Difficulty</span>
            <select className="pro-input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="mixed">Mixed</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="pro-meta">Focus</span>
            <select className="pro-input" value={focus} onChange={(e) => setFocusMode(e.target.value as 'mixed' | 'weak' | 'new')}>
              <option value="mixed">Balanced</option>
              <option value="weak">Weak areas</option>
              <option value="new">Unseen questions</option>
            </select>
          </label>
        </div>
        <button type="submit" className="pro-btn pro-btn-primary mt-1" disabled={busy || !courseId}>
          {busy ? 'Creating…' : 'Create and open'}
        </button>
      </form>
    </Section>
  );
}
