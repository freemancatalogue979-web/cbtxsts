/**
 * Admin: courses, exams and questions.
 *
 * The model the UI mirrors (see backend services/course_bank.py):
 *
 *   COURSE ── owns a QUESTION BANK (can be 10,000+ questions)
 *   EXAM   ── question source is either
 *              · Random from course → each player gets N random bank questions
 *              · Exam-specific      → the exam's own questions (not in the bank)
 *
 * Bank size, exam length and exam-specific set size are three different
 * numbers and are always labelled separately.
 */
import {BookOpen, Check, ChevronRight, FileText, Library, Pencil, Play, Plus, ScrollText, Shuffle, Trash2} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Button, Card, Chip, EmptyState, Field, Modal, SectionHeading, Segmented, Select, Skeleton, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatDate, formatNumber} from '../lib/format';
import {useSession} from '../store/session';
import CourseWorkspace from './CourseWorkspace';
import MaterialsAdmin from './MaterialsAdmin';
import QuestionManager, {ACCENTS, STATUSES} from './QuestionManager';
import type {Course, QuestionSource, Quiz} from '../lib/types';

const emptyCourse = {
  code: '',
  title: '',
  description: '',
  credit_units: 3,
  semester: 'First Semester',
  lecturer: '',
  accent: 'violet' as Course['accent'],
  is_active: true,
};

const emptyQuiz = {
  title: '',
  course_id: null as number | null,
  instructions: '',
  duration_minutes: 25,
  status: 'draft' as Quiz['status'],
  scheduled_at: '',
  end_at: '',
  shuffle_questions: true,
  allow_duel: true,
  pass_score: 50,
  question_source: 'course_random' as QuestionSource,
  /** Random: questions each player gets. Exam-specific: 0 = the whole set. */
  draw_count: 40,
  draw_topics: [] as string[],
  draw_difficulty: {} as Partial<Record<'easy' | 'medium' | 'hard', number>>,
};

type QuizDraft = typeof emptyQuiz & {id?: number};

export const ACCENT_STYLE: Record<string, {bg: string; fg: string}> = {
  red: {bg: 'rgba(244,63,94,0.14)', fg: '#ff8fa3'},
  blue: {bg: 'rgba(59,130,246,0.14)', fg: '#93c5fd'},
  amber: {bg: 'rgba(251,191,36,0.14)', fg: '#fde68a'},
  violet: {bg: 'rgba(168,85,247,0.14)', fg: '#d8b4fe'},
};

export function CourseBadge({course, className = ''}: {course: Pick<Course, 'code' | 'accent'>; className?: string}) {
  const tone = ACCENT_STYLE[course.accent] ?? ACCENT_STYLE.violet;
  return (
    <span
      className={`grid min-h-10 min-w-10 max-w-[7.5rem] shrink-0 place-items-center rounded-xl px-2 py-1 text-center text-[0.7rem] leading-tight font-black [overflow-wrap:anywhere] ${className}`}
      style={{background: tone.bg, color: tone.fg}}
    >
      {course.code}
    </span>
  );
}

/** "Random 40 of 2,000 · LAW 411" / "Exam-specific · 12 questions". */
export function sourceSummary(quiz: Quiz): string {
  if (quiz.question_source === 'course_random') {
    const bank = typeof quiz.bank_size === 'number' ? ` of ${formatNumber(quiz.bank_size)} in bank` : '';
    return `Random ${formatNumber(quiz.draw_count ?? quiz.question_count)} per player${bank}`;
  }
  const own = quiz.exam_question_count ?? quiz.question_count;
  if (quiz.draw_count && quiz.draw_count < own) return `Exam-specific · ${quiz.draw_count} of ${own} per player`;
  return `Exam-specific · ${formatNumber(own)} question${own === 1 ? '' : 's'}`;
}

/* ================================================================ courses */

function CourseEditor({
  editing,
  setEditing,
  onSaved,
}: {
  editing: (typeof emptyCourse & {id?: number}) | null;
  setEditing: (next: (typeof emptyCourse & {id?: number}) | null) => void;
  onSaved: () => void;
}) {
  const {toast} = useSession();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.id) await api.admin.updateCourse(editing.id, editing);
      else await api.admin.createCourse(editing);
      toast('success', editing.id ? 'Course updated' : 'Course created', editing.title);
      setEditing(null);
      onSaved();
    } catch (error) {
      toast('error', 'Could not save course', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={Boolean(editing)}
      onClose={() => setEditing(null)}
      title={editing?.id ? 'Edit course' : 'New course'}
      footer={
        <>
          <Button variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} icon={<Check className="size-4" />}>
            Save course
          </Button>
        </>
      }
    >
      {editing && (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <Field label="Code">
            <TextInput value={editing.code} maxLength={24} onChange={(event) => setEditing({...editing, code: event.target.value.toUpperCase()})} />
          </Field>
          <Field label="Title">
            <TextInput value={editing.title} onChange={(event) => setEditing({...editing, title: event.target.value})} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <TextArea rows={2} value={editing.description} onChange={(event) => setEditing({...editing, description: event.target.value})} />
          </Field>
          <Field label="Credit units">
            <TextInput type="number" min={0} max={12} value={editing.credit_units} onChange={(event) => setEditing({...editing, credit_units: Number(event.target.value)})} />
          </Field>
          <Field label="Semester">
            <TextInput value={editing.semester} onChange={(event) => setEditing({...editing, semester: event.target.value})} />
          </Field>
          <Field label="Lecturer">
            <TextInput value={editing.lecturer} onChange={(event) => setEditing({...editing, lecturer: event.target.value})} />
          </Field>
          <Field label="Accent colour">
            <Select value={editing.accent} onChange={(event) => setEditing({...editing, accent: event.target.value as Course['accent']})}>
              {ACCENTS.map((accent) => (
                <option key={accent} value={accent}>
                  {accent}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-3 sm:col-span-2">
            <input type="checkbox" checked={editing.is_active} onChange={(event) => setEditing({...editing, is_active: event.target.checked})} className="size-5 accent-fuchsia-500" />
            <span className="text-[0.86rem] font-bold text-mist-200">Visible to players</span>
          </label>
        </div>
      )}
    </Modal>
  );
}

function CoursesTab({onChanged, openCourseId, onOpenCourse}: {onChanged: () => void; openCourseId: number | null; onOpenCourse: (id: number | null) => void}) {
  const {toast} = useSession();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [editing, setEditing] = useState<(typeof emptyCourse & {id?: number}) | null>(null);
  const [query, setQuery] = useState('');
  const [orphans, setOrphans] = useState(0);
  const [showOrphans, setShowOrphans] = useState(false);

  const load = useCallback(() => {
    api.admin
      .courses()
      .then(setCourses)
      .catch((error: Error) => toast('error', 'Could not load courses', error.message));
    api.materials
      .adminList({unassigned: true, limit: 1})
      .then((payload) => setOrphans(payload.total ?? 0))
      .catch(() => setOrphans(0));
  }, [toast]);

  useEffect(load, [load]);

  const remove = async (course: Course) => {
    if (!window.confirm(`Delete ${course.code}? Its exams stay but lose the course link.`)) return;
    try {
      await api.admin.deleteCourse(course.id);
      toast('info', 'Course deleted');
      onOpenCourse(null);
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  const open = courses?.find((course) => course.id === openCourseId) ?? null;
  if (open) {
    return (
      <>
        <CourseWorkspace
          course={open}
          onBack={() => {
            onOpenCourse(null);
            load();
          }}
          onEdit={() => setEditing({...emptyCourse, ...open})}
          onDelete={() => void remove(open)}
          onChanged={() => {
            load();
            onChanged();
          }}
        />
        <CourseEditor editing={editing} setEditing={setEditing} onSaved={() => { load(); onChanged(); }} />
      </>
    );
  }

  if (showOrphans) {
    return (
      <div className="min-w-0 space-y-3">
        <Button size="sm" variant="ghost" onClick={() => { setShowOrphans(false); load(); }}>
          ← Courses
        </Button>
        <p className="text-[0.8rem] font-semibold text-mist-400">These were saved without a course. Open each one and choose its course.</p>
        <MaterialsAdmin onChanged={onChanged} unassigned />
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = (courses ?? []).filter((course) => !needle || `${course.code} ${course.title}`.toLowerCase().includes(needle));

  return (
    <div className="min-w-0 space-y-3">
      <SectionHeading
        title="Courses"
        subtitle="Each course owns its question bank, topics, notes, materials and discussion."
        icon={<BookOpen className="size-4" />}
        action={
          <Button size="sm" onClick={() => setEditing({...emptyCourse})} icon={<Plus className="size-4" />}>
            New course
          </Button>
        }
      />
      {orphans > 0 && (
        <button
          type="button"
          onClick={() => setShowOrphans(true)}
          className="w-full rounded-2xl border border-gold-500/30 bg-gold-500/10 p-3 text-left text-[0.8rem] font-bold text-gold-200"
        >
          {orphans} material{orphans === 1 ? '' : 's'} not linked to any course — tap to assign
        </button>
      )}
      {(courses?.length ?? 0) > 6 && (
        <TextInput placeholder="Find a course…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find a course" />
      )}

      {!courses ? (
        <Skeleton className="h-40" />
      ) : courses.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-6" />} title="No courses yet" detail="Create a course, then fill its question bank." />
      ) : (
        <ul className="grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((course) => (
            <li key={course.id} className="min-w-0">
              <Card className="min-w-0 p-0">
                <button type="button" onClick={() => onOpenCourse(course.id)} className="flex w-full min-w-0 items-center gap-3 p-3 text-left touch-manipulation">
                  <CourseBadge course={course} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9rem] font-extrabold text-mist-50">{course.title}</span>
                    <span className="mt-0.5 block truncate text-[0.74rem] font-semibold text-mist-500">
                      {formatNumber(course.question_count ?? 0)} in bank · {course.quiz_count ?? 0} exams · {course.material_count ?? 0} materials
                    </span>
                    {!course.is_active && <span className="mt-1 inline-block text-[0.68rem] font-black text-mist-500 uppercase">Hidden</span>}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-mist-500" />
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <CourseEditor editing={editing} setEditing={setEditing} onSaved={() => { load(); onChanged(); }} />
    </div>
  );
}

/* ================================================================== exams */

function SourceOption({
  active,
  onClick,
  icon,
  title,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-w-0 items-start gap-2.5 rounded-2xl border p-3 text-left transition-colors touch-manipulation ${
        active ? 'border-nova-400/60 bg-nova-500/12' : 'border-white/10 bg-white/[0.03] hover:border-white/20'
      }`}
    >
      <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ${active ? 'bg-nova-500/25 text-nova-200' : 'bg-white/6 text-mist-400'}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[0.86rem] font-extrabold text-mist-50">{title}</span>
        <span className="mt-0.5 block text-[0.74rem] leading-snug font-semibold text-mist-400">{detail}</span>
      </span>
    </button>
  );
}

function ExamEditor({
  editing,
  setEditing,
  courses,
  onSaved,
}: {
  editing: QuizDraft | null;
  setEditing: (next: QuizDraft | null) => void;
  courses: Course[];
  onSaved: () => void;
}) {
  const {toast} = useSession();
  const [busy, setBusy] = useState(false);
  const [topics, setTopics] = useState<{topic: string; count: number}[]>([]);
  const [bankSize, setBankSize] = useState<{bank: number; eligible: number} | null>(null);
  const [mixOn, setMixOn] = useState(false);

  const courseId = editing?.course_id ?? null;
  const random = editing?.question_source === 'course_random';

  useEffect(() => {
    if (!courseId) {
      setTopics([]);
      setBankSize(null);
      return;
    }
    api.admin.studio
      .topics(courseId)
      .then((data) => setTopics(((data.topics as {topic: string; count: number}[]) ?? []).slice(0, 60)))
      .catch(() => setTopics([]));
    api.admin
      .bank(courseId)
      .then((row) => setBankSize({bank: row.bank, eligible: row.eligible}))
      .catch(() => setBankSize(null));
  }, [courseId]);

  useEffect(() => {
    setMixOn(Boolean(editing && Object.values(editing.draw_difficulty ?? {}).some((value) => Number(value) > 0)));
    // only when a different exam opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, editing === null]);

  if (!editing) return <Modal open={false} onClose={() => setEditing(null)}>{null}</Modal>;

  const course = courses.find((row) => row.id === editing.course_id) ?? null;
  const pickedTopics = editing.draw_topics ?? [];
  const eligible = pickedTopics.length
    ? topics.filter((row) => pickedTopics.includes(row.topic)).reduce((sum, row) => sum + row.count, 0)
    : (bankSize?.eligible ?? null);
  const mixTotal = (['easy', 'medium', 'hard'] as const).reduce((sum, level) => sum + (Number(editing.draw_difficulty?.[level]) || 0), 0);
  const tooMany = random && eligible !== null && editing.draw_count > eligible;

  const save = async () => {
    if (!editing.title.trim()) {
      toast('error', 'Give the exam a title');
      return;
    }
    if (random) {
      if (!editing.course_id) {
        toast('error', 'Choose a course', 'Random questions are drawn from that course’s question bank.');
        return;
      }
      if (editing.draw_count < 1) {
        toast('error', 'How many questions per player?', 'Set the number each player should get, for example 40.');
        return;
      }
      if (mixOn && mixTotal !== editing.draw_count) {
        toast('error', 'Difficulty mix does not add up', `The mix totals ${mixTotal} but each player gets ${editing.draw_count}.`);
        return;
      }
    }
    setBusy(true);
    const payload: Record<string, unknown> = {
      title: editing.title,
      course_id: editing.course_id,
      instructions: editing.instructions,
      duration_minutes: editing.duration_minutes,
      status: editing.status,
      shuffle_questions: editing.shuffle_questions,
      allow_duel: editing.allow_duel,
      pass_score: editing.pass_score,
      question_source: editing.question_source,
      draw_count: editing.draw_count,
      draw_difficulty: random && mixOn ? editing.draw_difficulty : {},
      scheduled_at: editing.scheduled_at ? new Date(editing.scheduled_at).toISOString().slice(0, 19) : null,
      end_at: editing.end_at ? new Date(editing.end_at).toISOString().slice(0, 19) : null,
    };
    if (editing.id) payload.draw_topics = random ? pickedTopics : [];
    else payload.topics = random ? pickedTopics : [];
    try {
      if (editing.id) await api.admin.updateQuiz(editing.id, payload);
      else await api.admin.createQuiz(payload);
      toast('success', editing.id ? 'Exam updated' : 'Exam created', editing.title);
      setEditing(null);
      onSaved();
    } catch (error) {
      toast('error', 'Could not save exam', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => setEditing(null)}
      title={editing.id ? 'Edit exam' : 'New exam'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={Boolean(tooMany)} icon={<Check className="size-4" />}>
            Save exam
          </Button>
        </>
      }
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-4">
        <Field label="Title" className="sm:col-span-2">
          <TextInput value={editing.title} onChange={(event) => setEditing({...editing, title: event.target.value})} placeholder="LAW 411 Mid-semester test" />
        </Field>

        {/* ------------------------------------------------ QUESTION SOURCE */}
        <div className="min-w-0 sm:col-span-2">
          <p className="mb-1.5 text-[0.72rem] font-black tracking-[0.12em] text-mist-400 uppercase">Question source</p>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <SourceOption
              active={random}
              onClick={() => setEditing({...editing, question_source: 'course_random', draw_count: editing.draw_count || 40})}
              icon={<Shuffle className="size-4" />}
              title="Random from course"
              detail="Every player gets their own random selection from the course question bank."
            />
            <SourceOption
              active={!random}
              onClick={() => setEditing({...editing, question_source: 'exam_specific', draw_count: 0, draw_topics: [], draw_difficulty: {}})}
              icon={<ScrollText className="size-4" />}
              title="Exam-specific questions"
              detail="Questions written or imported only for this exam. They are not added to the course bank."
            />
          </div>
        </div>

        <Field label={random ? 'Course (required)' : 'Course (optional)'}>
          <Select value={editing.course_id ?? ''} onChange={(event) => setEditing({...editing, course_id: event.target.value ? Number(event.target.value) : null, draw_topics: []})}>
            <option value="">{random ? 'Choose a course…' : 'No course'}</option>
            {courses.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} — {row.title}
              </option>
            ))}
          </Select>
        </Field>

        {random ? (
          <Field label="Questions per player" hint="Each player is dealt this many random questions when they start.">
            <TextInput
              type="number"
              inputMode="numeric"
              value={String(editing.draw_count)}
              onChange={(event) => {
                const n = Math.floor(Number(event.target.value || 0));
                setEditing({...editing, draw_count: Number.isFinite(n) ? Math.max(0, Math.min(500, n)) : 0});
              }}
            />
          </Field>
        ) : (
          <Field label="Questions per player" hint="0 = every exam-specific question. A smaller number gives each player a random subset.">
            <TextInput
              type="number"
              inputMode="numeric"
              value={String(editing.draw_count)}
              onChange={(event) => {
                const n = Math.floor(Number(event.target.value || 0));
                setEditing({...editing, draw_count: Number.isFinite(n) ? Math.max(0, Math.min(500, n)) : 0});
              }}
            />
          </Field>
        )}

        {random && (
          <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:col-span-2">
            {course ? (
              <>
                <div className="grid min-w-0 grid-cols-3 gap-2 text-center">
                  <div className="min-w-0">
                    <p className="text-[1.05rem] font-black text-mist-50 tabular">{bankSize ? formatNumber(bankSize.bank) : '…'}</p>
                    <p className="text-[0.66rem] font-bold text-mist-500">in {course.code} bank</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[1.05rem] font-black text-mist-50 tabular">{eligible === null ? '…' : formatNumber(eligible)}</p>
                    <p className="text-[0.66rem] font-bold text-mist-500">{pickedTopics.length ? 'in picked topics' : 'ready to draw'}</p>
                  </div>
                  <div className="min-w-0">
                    <p className={`text-[1.05rem] font-black tabular ${tooMany ? 'text-flare-300' : 'text-nova-200'}`}>{formatNumber(editing.draw_count)}</p>
                    <p className="text-[0.66rem] font-bold text-mist-500">per player</p>
                  </div>
                </div>
                <p className={`mt-2 text-[0.74rem] leading-snug font-semibold ${tooMany ? 'text-flare-300' : 'text-mist-400'}`}>
                  {tooMany
                    ? `Only ${formatNumber(eligible ?? 0)} questions are available — add questions to the bank or lower the number.`
                    : `The bank stays at its full size. Each player who starts gets ${editing.draw_count} questions picked at random, so two players see different papers.`}
                </p>

                {topics.length > 0 && (
                  <div className="mt-3 min-w-0">
                    <p className="mb-1.5 text-[0.7rem] font-black tracking-wide text-mist-400 uppercase">
                      Topics {pickedTopics.length ? `· ${pickedTopics.length} picked` : '· whole course'}
                    </p>
                    <div className="flex max-h-32 min-w-0 flex-wrap gap-1.5 overflow-y-auto">
                      {topics.map((row) => {
                        const on = pickedTopics.includes(row.topic);
                        return (
                          <button
                            key={row.topic}
                            type="button"
                            onClick={() => setEditing({...editing, draw_topics: on ? pickedTopics.filter((t) => t !== row.topic) : [...pickedTopics, row.topic]})}
                            className={`max-w-full truncate rounded-full border px-2.5 py-1 text-[0.72rem] font-bold ${
                              on ? 'border-nova-400/50 bg-nova-500/18 text-nova-100' : 'border-white/10 text-mist-400 hover:border-white/25'
                            }`}
                          >
                            {row.topic} <span className="opacity-60">{row.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <label className="mt-3 flex items-center gap-2 text-[0.78rem] font-bold text-mist-300">
                  <input type="checkbox" checked={mixOn} onChange={(event) => setMixOn(event.target.checked)} className="size-4 accent-fuchsia-500" />
                  Control the difficulty mix
                </label>
                {mixOn && (
                  <div className="mt-2 grid min-w-0 grid-cols-3 gap-2">
                    {(['easy', 'medium', 'hard'] as const).map((level) => (
                      <Field key={level} label={level}>
                        <TextInput
                          type="number"
                          inputMode="numeric"
                          value={String(editing.draw_difficulty?.[level] ?? 0)}
                          onChange={(event) =>
                            setEditing({...editing, draw_difficulty: {...editing.draw_difficulty, [level]: Math.max(0, Math.floor(Number(event.target.value) || 0))}})
                          }
                        />
                      </Field>
                    ))}
                    <p className={`col-span-3 text-[0.72rem] font-bold ${mixTotal === editing.draw_count ? 'text-mist-500' : 'text-gold-300'}`}>
                      Mix total {mixTotal} / {editing.draw_count}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[0.78rem] font-semibold text-mist-400">Choose a course to see its question bank.</p>
            )}
          </div>
        )}

        {!random && (
          <p className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[0.76rem] leading-snug font-semibold text-mist-400 sm:col-span-2">
            {editing.id
              ? 'Manage this exam’s own questions from the exam list → Questions.'
              : 'After saving, add or import this exam’s questions from the exam list → Questions. They stay out of the course bank unless you choose “Add to bank”.'}
          </p>
        )}

        <Field label="Status">
          <Select value={editing.status} onChange={(event) => setEditing({...editing, status: event.target.value as Quiz['status']})}>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Duration (minutes)">
          <TextInput type="number" min={1} max={300} value={editing.duration_minutes} onChange={(event) => setEditing({...editing, duration_minutes: Number(event.target.value)})} />
        </Field>
        <Field label="Opens at" hint="Optional — blank = available immediately.">
          <TextInput type="datetime-local" value={editing.scheduled_at} onChange={(event) => setEditing({...editing, scheduled_at: event.target.value})} />
        </Field>
        <Field label="Closes at" hint="Optional hard deadline.">
          <TextInput type="datetime-local" value={editing.end_at} onChange={(event) => setEditing({...editing, end_at: event.target.value})} />
        </Field>
        <Field label="Passing score (%)">
          <TextInput
            type="number"
            min={0}
            max={100}
            value={editing.pass_score}
            onChange={(event) => setEditing({...editing, pass_score: Math.max(0, Math.min(100, Number(event.target.value) || 0))})}
          />
        </Field>
        <div className="flex min-w-0 flex-col justify-end gap-2">
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={editing.shuffle_questions} onChange={(event) => setEditing({...editing, shuffle_questions: event.target.checked})} className="size-5 accent-fuchsia-500" />
            <span className="text-[0.84rem] font-bold text-mist-200">Shuffle question order</span>
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={editing.allow_duel} onChange={(event) => setEditing({...editing, allow_duel: event.target.checked})} className="size-5 accent-fuchsia-500" />
            <span className="text-[0.84rem] font-bold text-mist-200">Usable in duels</span>
          </label>
        </div>
        <Field label="Instructions" className="sm:col-span-2">
          <TextArea rows={3} value={editing.instructions} onChange={(event) => setEditing({...editing, instructions: event.target.value})} />
        </Field>
      </div>
    </Modal>
  );
}

function statusChip(status: string): string {
  return status === 'active'
    ? 'border-mint-500/32 bg-mint-500/14 text-mint-300'
    : status === 'scheduled'
      ? 'border-pulse-500/32 bg-pulse-500/14 text-pulse-300'
      : 'border-white/12 bg-white/6 text-mist-500';
}

function QuizzesTab({onChanged, onManageQuestions, onOpenBank}: {onChanged: () => void; onManageQuestions: (quiz: Quiz) => void; onOpenBank: (courseId: number) => void}) {
  const {toast} = useSession();
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [editing, setEditing] = useState<QuizDraft | null>(null);
  const [courseFilter, setCourseFilter] = useState<number | ''>('');

  const load = useCallback(() => {
    api.admin
      .quizzes()
      .then(setQuizzes)
      .catch((error: Error) => toast('error', 'Could not load exams', error.message));
    api.admin
      .courses()
      .then(setCourses)
      .catch(() => setCourses([]));
  }, [toast]);

  useEffect(load, [load]);

  const setStatus = async (quiz: Quiz, status: Quiz['status']) => {
    try {
      await api.admin.setQuizStatus(quiz.id, status);
      toast('success', `Exam ${status}`, quiz.title);
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not change status', (error as Error).message);
    }
  };

  const remove = async (quiz: Quiz) => {
    if (!window.confirm(`Delete “${quiz.title}” and all its attempts? This cannot be undone.`)) return;
    try {
      await api.admin.deleteQuiz(quiz.id);
      toast('info', 'Exam deleted');
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  const edit = (quiz: Quiz) =>
    setEditing({
      id: quiz.id,
      title: quiz.title,
      course_id: quiz.course?.id ?? null,
      instructions: quiz.instructions,
      duration_minutes: quiz.duration_minutes,
      status: quiz.status,
      scheduled_at: quiz.scheduled_at ? quiz.scheduled_at.slice(0, 16) : '',
      end_at: quiz.end_at ? String(quiz.end_at).slice(0, 16) : '',
      shuffle_questions: quiz.shuffle_questions,
      allow_duel: quiz.allow_duel,
      pass_score: quiz.pass_score ?? 50,
      question_source: quiz.question_source ?? 'exam_specific',
      draw_count: quiz.draw_count ?? 0,
      draw_topics: quiz.draw_topics ?? [],
      draw_difficulty: quiz.draw_difficulty ?? {},
    });

  const shown = (quizzes ?? []).filter((quiz) => !courseFilter || quiz.course?.id === courseFilter);

  return (
    <div className="min-w-0 space-y-3">
      <SectionHeading
        title="Exams"
        subtitle="Choose where each exam’s questions come from, then schedule it."
        icon={<FileText className="size-4" />}
        action={
          <Button size="sm" onClick={() => setEditing({...emptyQuiz, course_id: courseFilter || null})} icon={<Plus className="size-4" />}>
            New exam
          </Button>
        }
      />
      {courses.length > 1 && (
        <Select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value ? Number(event.target.value) : '')} aria-label="Filter exams by course" className="sm:max-w-xs">
          <option value="">All courses</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.code} — {course.title}
            </option>
          ))}
        </Select>
      )}

      {!quizzes ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon={<FileText className="size-6" />} title="No exams yet" detail="Create an exam and pick its question source." />
      ) : (
        <ul className="min-w-0 space-y-1.5">
          {shown.map((quiz) => {
            const random = quiz.question_source === 'course_random';
            return (
              <li key={quiz.id} className="min-w-0">
                <Card className="min-w-0 p-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9rem] font-extrabold text-mist-50">{quiz.title}</p>
                      <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[0.74rem] font-semibold text-mist-500">
                        <span className="inline-flex items-center gap-1 text-mist-300">
                          {random ? <Shuffle className="size-3" /> : <ScrollText className="size-3" />}
                          {sourceSummary(quiz)}
                        </span>
                        <span>· {quiz.course?.code ?? 'No course'}</span>
                        <span>· {quiz.duration_minutes} min</span>
                        {quiz.submission_count ? <span>· {formatNumber(quiz.submission_count)} submitted</span> : null}
                        {quiz.scheduled_at ? <span>· opens {formatDate(quiz.scheduled_at, true)}</span> : null}
                      </p>
                    </div>
                    <Chip className={`shrink-0 ${statusChip(quiz.status)}`}>{quiz.status}</Chip>
                  </div>
                  <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                    {quiz.status !== 'active' ? (
                      <Button size="sm" variant="mint" onClick={() => setStatus(quiz, 'active')} icon={<Play className="size-3.5" />}>
                        Go live
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setStatus(quiz, 'completed')}>
                        Close
                      </Button>
                    )}
                    {random ? (
                      quiz.course && (
                        <Button size="sm" variant="outline" onClick={() => onOpenBank(quiz.course!.id)} icon={<Library className="size-3.5" />}>
                          Course bank
                        </Button>
                      )
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => onManageQuestions(quiz)} icon={<ScrollText className="size-3.5" />}>
                        Questions
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => edit(quiz)} icon={<Pencil className="size-3.5" />}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" title="Delete exam" onClick={() => remove(quiz)} icon={<Trash2 className="size-3.5 text-flare-400" />} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <ExamEditor
        editing={editing}
        setEditing={setEditing}
        courses={courses}
        onSaved={() => {
          load();
          onChanged();
        }}
      />
    </div>
  );
}

/* ============================================================== questions */

/**
 * Questions, organised by COURSE: pick a course, then either its question bank
 * or one of its exams' exam-specific sets. No cross-course lists, no importing
 * questions "from an exam".
 */
function QuestionsHub({
  onChanged,
  target,
  setTarget,
}: {
  onChanged: () => void;
  target: {courseId: number | null; examId: number | null};
  setTarget: (next: {courseId: number | null; examId: number | null}) => void;
}) {
  const {toast} = useSession();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [exams, setExams] = useState<Quiz[]>([]);
  const [active, setActive] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.admin
      .courses()
      .then((rows) => {
        setCourses(rows);
        if (!target.courseId && !target.examId && rows[0]) setTarget({courseId: rows[0].id, examId: null});
      })
      .catch((error: Error) => toast('error', 'Could not load courses', error.message));
    api.admin
      .quizzes()
      .then(setExams)
      .catch(() => setExams([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const specificExams = useMemo(
    () => exams.filter((quiz) => quiz.question_source !== 'course_random' && (target.courseId ? quiz.course?.id === target.courseId : !quiz.course)),
    [exams, target.courseId],
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        if (target.examId) {
          const quiz = exams.find((row) => row.id === target.examId) ?? (await api.admin.quiz(target.examId));
          if (!cancelled) setActive(quiz);
        } else if (target.courseId) {
          const bank = await api.admin.ensureCourseBank(target.courseId);
          if (!cancelled) setActive(bank);
        } else if (!cancelled) setActive(null);
      } catch (error) {
        if (!cancelled) toast('error', 'Could not open questions', (error as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [target.courseId, target.examId, exams, toast]);

  if (!courses) return <Skeleton className="h-40" />;

  return (
    <div className="min-w-0 space-y-3">
      <Card className="min-w-0 p-2.5 sm:p-3">
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <Field label="Course">
            <Select value={target.courseId ?? ''} onChange={(event) => setTarget({courseId: event.target.value ? Number(event.target.value) : null, examId: null})}>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} — {course.title}
                </option>
              ))}
              <option value="">Exams without a course</option>
            </Select>
          </Field>
          <Field label="Questions in">
            <Select value={target.examId ?? ''} onChange={(event) => setTarget({...target, examId: event.target.value ? Number(event.target.value) : null})}>
              {target.courseId && <option value="">Course question bank</option>}
              {!target.courseId && <option value="">Choose an exam…</option>}
              {specificExams.map((quiz) => (
                <option key={quiz.id} value={quiz.id}>
                  Exam-specific: {quiz.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {loading && !active ? (
        <Skeleton className="h-40" />
      ) : active ? (
        <QuestionManager key={active.id} quiz={active} onChanged={onChanged} />
      ) : (
        <EmptyState icon={<ScrollText className="size-6" />} title="Pick where to work" detail="Choose a course bank or an exam-specific set above." />
      )}
    </div>
  );
}

/* =================================================================== root */

type Tab = 'courses' | 'exams' | 'questions';

export default function ContentAdmin({onChanged}: {onChanged: () => void}) {
  const [tab, setTab] = useState<Tab>('courses');
  const [openCourse, setOpenCourse] = useState<number | null>(null);
  const [target, setTarget] = useState<{courseId: number | null; examId: number | null}>({courseId: null, examId: null});

  return (
    <div className="min-w-0 space-y-4">
      <Segmented
        value={tab}
        options={[
          {value: 'courses', label: 'Courses', icon: BookOpen},
          {value: 'exams', label: 'Exams', icon: FileText},
          {value: 'questions', label: 'Questions', icon: ScrollText},
        ]}
        onChange={setTab}
      />

      {tab === 'courses' && <CoursesTab onChanged={onChanged} openCourseId={openCourse} onOpenCourse={setOpenCourse} />}
      {tab === 'exams' && (
        <QuizzesTab
          onChanged={onChanged}
          onManageQuestions={(quiz) => {
            setTarget({courseId: quiz.course?.id ?? null, examId: quiz.id});
            setTab('questions');
          }}
          onOpenBank={(courseId) => {
            setTarget({courseId, examId: null});
            setTab('questions');
          }}
        />
      )}
      {tab === 'questions' && <QuestionsHub onChanged={onChanged} target={target} setTarget={setTarget} />}
    </div>
  );
}
