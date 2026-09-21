/** Admin: courses, exams and the question bank (including bulk paste import). */
import {
  BarChart3,
  BookOpen,
  Check,
  Copy,
  FileText,
  FileUp,
  Flag,
  History,
  Pencil,
  Play,
  Plus,
  ScrollText,
  Shuffle,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useState} from 'react';
import {Avatar, Button, Card, Chip, EmptyState, Field, Modal, SectionHeading, Segmented, Select, Skeleton, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatDate, formatNumber} from '../lib/format';
import {useSession} from '../store/session';
import MaterialsAdmin from './MaterialsAdmin';
import type {Course, OptionKey, QuestionPublic, Quiz} from '../lib/types';

void Avatar;

const ACCENTS: Course['accent'][] = ['red', 'violet', 'blue', 'amber'];
const STATUSES: Quiz['status'][] = ['draft', 'scheduled', 'active', 'completed'];
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const LETTERS: OptionKey[] = ['A', 'B', 'C', 'D'];
/** Question kinds the backend understands (multi-answer types accept e.g. "AC"). */
const QUESTION_TYPES = [
  {value: 'mcq', label: 'Multiple choice'},
  {value: 'true_false', label: 'True / False'},
  {value: 'multi_select', label: 'Multiple answers'},
  {value: 'fill_blank', label: 'Fill in the blank'},
  {value: 'short_answer', label: 'Short answer'},
  {value: 'matching', label: 'Matching pairs'},
  {value: 'ordering', label: 'Ordering / sequence'},
  {value: 'image_choice', label: 'Image choice'},
  {value: 'audio', label: 'Audio question'},
  {value: 'scenario', label: 'Scenario / case study'},
  {value: 'passage', label: 'Passage based'},
  {value: 'assertion_reason', label: 'Assertion / reason'},
] as const;
const QUESTION_STATUSES = ['draft', 'approved', 'rejected', 'archived'] as const;

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
  status: 'scheduled' as Quiz['status'],
  scheduled_at: '',
  shuffle_questions: true,
  allow_duel: true,
};

/**
 * A blank question. ``correct`` deliberately starts EMPTY — the answer is never
 * guessed or defaulted to "A"; the editor (and the API) refuse to save without
 * an explicit choice.
 */
const emptyQuestion = {
  text: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  correct: '' as OptionKey | '',
  explanation: '',
  points: 1,
  difficulty: 'medium' as (typeof DIFFICULTIES)[number],
  question_type: 'mcq',
  topic: '',
  subtopic: '',
  objective: '',
  tags: [] as string[],
  source: '',
  reference: '',
  author: '',
  hint: '',
  admin_notes: '',
  status: 'approved' as 'draft' | 'approved' | 'rejected' | 'archived',
  visible: true,
  flashcard_enabled: true,
  duel_enabled: true,
  practice_enabled: true,
  time_limit_seconds: 0,
  media: {} as Record<string, string>,
};

type QuestionDraft = typeof emptyQuestion & {id?: number};

/**
 * Bulk paste is parsed and validated by the SERVER
 * (`/api/admin/questions/preview-import`) — the old client-side parser here
 * defaulted a missing ``Answer:`` line to "A", which is the exact bug this wave
 * removes. Never parse or guess answers in the browser.
 */
void 0;

function CoursesTab({onChanged}: {onChanged: () => void}) {
  const {toast} = useSession();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [editing, setEditing] = useState<(typeof emptyCourse & {id?: number}) | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.admin
      .courses()
      .then(setCourses)
      .catch((error: Error) => toast('error', 'Could not load courses', error.message));
  }, [toast]);

  useEffect(load, [load]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.id) await api.admin.updateCourse(editing.id, editing);
      else await api.admin.createCourse(editing);
      toast('success', editing.id ? 'Course updated' : 'Course created', editing.title);
      setEditing(null);
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not save course', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (course: Course) => {
    if (!window.confirm(`Delete ${course.code}? Its exams stay but lose the course link.`)) return;
    try {
      await api.admin.deleteCourse(course.id);
      toast('info', 'Course deleted');
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Courses"
        subtitle="Group exams under a course code."
        icon={<BookOpen className="size-4" />}
        action={
          <Button size="sm" onClick={() => setEditing({...emptyCourse})} icon={<Plus className="size-4" />}>
            New course
          </Button>
        }
      />

      {!courses ? (
        <Skeleton className="h-40" />
      ) : courses.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-6" />} title="No courses yet" />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {courses.map((course) => (
            <li key={course.id}>
              <Card className="flex items-start gap-3 p-4">
                <span
                  className="mt-0.5 grid min-h-11 min-w-11 max-w-[9rem] shrink-0 place-items-center rounded-2xl px-2.5 py-1.5 text-center text-[0.72rem] leading-tight font-black [overflow-wrap:anywhere]"
                  style={{
                    background:
                      course.accent === 'red'
                        ? 'rgba(244,63,94,0.16)'
                        : course.accent === 'blue'
                          ? 'rgba(59,130,246,0.16)'
                          : course.accent === 'amber'
                            ? 'rgba(251,191,36,0.16)'
                            : 'rgba(168,85,247,0.16)',
                    color:
                      course.accent === 'red'
                        ? '#ff8fa3'
                        : course.accent === 'blue'
                          ? '#93c5fd'
                          : course.accent === 'amber'
                            ? '#fde68a'
                            : '#d8b4fe',
                  }}
                >
                  {course.code}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.92rem] font-extrabold text-mist-50">{course.title}</p>
                  <p className="mt-0.5 truncate text-[0.78rem] font-semibold text-mist-500">
                    {course.credit_units} units · {course.semester}
                    {course.lecturer ? ` · ${course.lecturer}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Chip className={course.is_active ? 'border-mint-500/30 bg-mint-500/12 text-mint-300' : 'border-white/12 bg-white/6 text-mist-500'}>
                      {course.is_active ? 'Active' : 'Hidden'}
                    </Chip>
                    {!!course.quiz_count && <Chip>{course.quiz_count} exams</Chip>}
                    {!!course.topic_count && <Chip>{course.topic_count} topics</Chip>}
                    {!!course.question_count && <Chip>{course.question_count} questions</Chip>}
                    {!!course.material_count && <Chip>{course.material_count} materials</Chip>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({...course})} icon={<Pencil className="size-3.5" />}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(course)} icon={<Trash2 className="size-3.5 text-flare-400" />} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

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
              <TextInput
                type="number"
                min={0}
                max={12}
                value={editing.credit_units}
                onChange={(event) => setEditing({...editing, credit_units: Number(event.target.value)})}
              />
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
              <input
                type="checkbox"
                checked={editing.is_active}
                onChange={(event) => setEditing({...editing, is_active: event.target.checked})}
                className="size-5 accent-fuchsia-500"
              />
              <span className="text-[0.86rem] font-bold text-mist-200">Visible to players</span>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}

function QuizzesTab({onChanged, onManageQuestions}: {onChanged: () => void; onManageQuestions: (quiz: Quiz) => void}) {
  const {toast} = useSession();
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [editing, setEditing] = useState<(typeof emptyQuiz & {id?: number}) | null>(null);
  const [busy, setBusy] = useState(false);

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

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const payload = {
      ...editing,
      scheduled_at: editing.scheduled_at ? new Date(editing.scheduled_at).toISOString().slice(0, 19) : null,
    };
    try {
      if (editing.id) await api.admin.updateQuiz(editing.id, payload);
      else await api.admin.createQuiz(payload);
      toast('success', editing.id ? 'Exam updated' : 'Exam created', editing.title);
      setEditing(null);
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not save exam', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

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

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Exams"
        subtitle="Publish, schedule and close arena exams."
        icon={<FileText className="size-4" />}
        action={
          <Button size="sm" onClick={() => setEditing({...emptyQuiz})} icon={<Plus className="size-4" />}>
            New exam
          </Button>
        }
      />

      {!quizzes ? (
        <div className="space-y-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : quizzes.length === 0 ? (
        <EmptyState icon={<FileText className="size-6" />} title="No exams yet" detail="Create your first arena exam." />
      ) : (
        <ul className="space-y-2">
          {quizzes.map((quiz) => (
            <li key={quiz.id}>
              <Card className="flex flex-wrap items-center gap-2.5 p-3.5 sm:gap-3 sm:p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.94rem] font-extrabold text-mist-50">{quiz.title}</p>
                  <p className="mt-0.5 truncate text-[0.78rem] font-semibold text-mist-500">
                    {quiz.course?.code ?? 'No course'} · {quiz.question_count} questions · {quiz.duration_minutes} min
                    {quiz.submission_count ? ` · ${formatNumber(quiz.submission_count)} submissions` : ''}
                    {quiz.scheduled_at ? ` · opens ${formatDate(quiz.scheduled_at, true)}` : ''}
                  </p>
                </div>

                <Chip
                  className={
                    quiz.status === 'active'
                      ? 'border-mint-500/32 bg-mint-500/14 text-mint-300'
                      : quiz.status === 'scheduled'
                        ? 'border-pulse-500/32 bg-pulse-500/14 text-pulse-300'
                        : 'border-white/12 bg-white/6 text-mist-500'
                  }
                >
                  {quiz.status}
                </Chip>

                <div className="flex flex-wrap gap-1.5">
                  {quiz.status !== 'active' && (
                    <Button size="sm" variant="mint" onClick={() => setStatus(quiz, 'active')} icon={<Play className="size-3.5" />}>
                      Go live
                    </Button>
                  )}
                  {quiz.status === 'active' && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(quiz, 'completed')}>
                      Close
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => onManageQuestions(quiz)} icon={<ScrollText className="size-3.5" />}>
                    Questions
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditing({
                        id: quiz.id,
                        title: quiz.title,
                        course_id: quiz.course?.id ?? null,
                        instructions: quiz.instructions,
                        duration_minutes: quiz.duration_minutes,
                        status: quiz.status,
                        scheduled_at: quiz.scheduled_at ? quiz.scheduled_at.slice(0, 16) : '',
                        shuffle_questions: quiz.shuffle_questions,
                        allow_duel: quiz.allow_duel,
                      })
                    }
                    icon={<Pencil className="size-3.5" />}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(quiz)} icon={<Trash2 className="size-3.5 text-flare-400" />} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit exam' : 'New exam'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy} icon={<Check className="size-4" />}>
              Save exam
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            <Field label="Title" className="sm:col-span-2">
              <TextInput value={editing.title} onChange={(event) => setEditing({...editing, title: event.target.value})} />
            </Field>
            <Field label="Course">
              <Select
                value={editing.course_id ?? ''}
                onChange={(event) => setEditing({...editing, course_id: event.target.value ? Number(event.target.value) : null})}
              >
                <option value="">No course</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} — {course.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={editing.status} onChange={(event) => setEditing({...editing, status: event.target.value as Quiz['status']})}>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Duration (minutes)">
              <TextInput
                type="number"
                min={1}
                max={300}
                value={editing.duration_minutes}
                onChange={(event) => setEditing({...editing, duration_minutes: Number(event.target.value)})}
              />
            </Field>
            <Field label="Opens at" hint="Optional — leave blank for immediately available.">
              <TextInput
                type="datetime-local"
                value={editing.scheduled_at}
                onChange={(event) => setEditing({...editing, scheduled_at: event.target.value})}
              />
            </Field>
            <Field label="Instructions" className="sm:col-span-2">
              <TextArea rows={3} value={editing.instructions} onChange={(event) => setEditing({...editing, instructions: event.target.value})} />
            </Field>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={editing.shuffle_questions}
                onChange={(event) => setEditing({...editing, shuffle_questions: event.target.checked})}
                className="size-5 accent-fuchsia-500"
              />
              <span className="text-[0.86rem] font-bold text-mist-200">Shuffle questions per player</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={editing.allow_duel}
                onChange={(event) => setEditing({...editing, allow_duel: event.target.checked})}
                className="size-5 accent-fuchsia-500"
              />
              <span className="text-[0.86rem] font-bold text-mist-200">Usable in duels</span>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}

function QuestionsTab({quiz, onChanged}: {quiz: Quiz; onChanged: () => void}) {
  const {toast} = useSession();
  const [questions, setQuestions] = useState<QuestionPublic[] | null>(null);
  const [editing, setEditing] = useState<(typeof emptyQuestion & {id?: number}) | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawCount, setDrawCount] = useState(20);
  const [drawBusy, setDrawBusy] = useState(false);
  const [bank, setBank] = useState<{course_id: number; code: string; bank: number; drawn_copies: number} | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sortKey, setSortKey] = useState('position');
  // Page-based bank browsing: 20 at a time, "X–Y of Z" — never one endless
  // scroll of thousands of questions.
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [historyFor, setHistoryFor] = useState<QuestionPublic | null>(null);
  const [versions, setVersions] = useState<{version: number; created_at: string; note?: string; author?: string}[] | null>(null);
  const [statsFor, setStatsFor] = useState<{question_id: number; stats: {answered: number; correct: number; accuracy: number; avg_ms: number}; most_wrong: string[]} | null>(null);

  useEffect(() => {
    if (!drawOpen || !quiz.course) return;
    api.admin
      .bank(quiz.course.id)
      .then(setBank)
      .catch(() => setBank(null));
  }, [drawOpen, quiz.course]);

  const filtering = Boolean(query.trim() || statusFilter || flaggedOnly || sortKey !== 'position');

  const load = useCallback(() => {
    api.admin.studio
      .search({
        quiz_id: quiz.id,
        q: query.trim() || undefined,
        status: statusFilter || undefined,
        flagged: flaggedOnly || undefined,
        sort: sortKey,
        limit,
        offset,
      })
      .then((payload) => {
        const data = payload as {rows?: QuestionPublic[]; total?: number};
        setQuestions((data.rows ?? []) as QuestionPublic[]);
        setTotal(data.total ?? 0);
      })
      .catch((error: Error) => toast('error', 'Could not load questions', error.message));
  }, [quiz.id, toast, query, statusFilter, flaggedOnly, sortKey, offset]);

  useEffect(() => {
    const handle = window.setTimeout(load, filtering ? 280 : 0);
    return () => window.clearTimeout(handle);
  }, [load, filtering]);

  const openHistory = async (question: QuestionPublic) => {
    setHistoryFor(question);
    setVersions(null);
    try {
      const payload = await api.admin.studio.versions(question.id);
      setVersions((payload ?? []) as never);
    } catch (error) {
      toast('error', 'Could not load versions', (error as Error).message);
      setVersions([]);
    }
  };

  const restore = async (question: QuestionPublic, version: number) => {
    try {
      await api.admin.studio.restoreVersion(question.id, version);
      toast('success', `Restored version ${version}`, 'The current answer and text were snapshotted first.');
      setHistoryFor(null);
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Restore failed', (error as Error).message);
    }
  };

  const duplicate = async (question: QuestionPublic) => {
    try {
      await api.admin.studio.duplicateQuestion(question.id, {quiz_id: quiz.id});
      toast('success', 'Question duplicated', 'The copy keeps the original source link and answer.');
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not duplicate', (error as Error).message);
    }
  };

  const flag = async (question: QuestionPublic) => {
    const reason = window.prompt('Why is this question being flagged?', question.flag_reason ?? '');
    if (reason === null) return;
    try {
      await api.admin.studio.flag(question.id, {reason});
      toast('info', 'Flagged for review');
      load();
    } catch (error) {
      toast('error', 'Could not flag', (error as Error).message);
    }
  };

  const unflag = async (question: QuestionPublic) => {
    try {
      await api.admin.studio.unflag(question.id);
      toast('success', 'Flag cleared');
      load();
    } catch (error) {
      toast('error', 'Could not unflag', (error as Error).message);
    }
  };

  const showStats = async (question: QuestionPublic) => {
    try {
      const payload = (await api.admin.studio.analytics(question.id)) as {
        question_id: number;
        stats: {answered: number; correct: number; accuracy: number; avg_ms: number};
        most_wrong: string[];
      };
      setStatsFor(payload);
    } catch (error) {
      toast('error', 'No analytics yet', (error as Error).message);
    }
  };

  // The server parses and validates the paste — it is the only code allowed to
  // decide what a valid answer looks like. Invalid rows come back with reasons
  // instead of being quietly turned into "A".
  const [preview, setPreview] = useState<{
    valid?: number;
    rejected?: number;
    duplicates?: number;
    preview?: Record<string, unknown>[];
    errors?: {index: number; number?: number; text: string; answer?: string | null; reasons: string[]}[];
    warnings?: {text?: string; reason?: string}[];
    file?: {filename: string; kind: string; bytes: number; pages?: number | null; rows_detected?: number | null; notes: string[]};
  } | null>(null);

  /* Device uploads: the same preview/report pipeline, fed by a real file. */
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [paperBusy, setPaperBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const readPaper = async (file: File) => {
    setPaperFile(file);
    setPreview(null);
    setPaperBusy(true);
    try {
      const report = (await api.admin.studio.previewImportFile(file, {
        quiz_id: quiz.id,
        course_id: quiz.course?.id ?? null,
      })) as never;
      setPreview(report);
    } catch (error) {
      setPaperFile(null);
      toast('error', 'Could not read that file', (error as Error).message);
    } finally {
      setPaperBusy(false);
    }
  };

  useEffect(() => {
    if (!bulkOpen || paperFile) return undefined;
    const handle = window.setTimeout(() => {
      if (bulkText.trim().length < 8) {
        setPreview(null);
        return;
      }
      api.admin.studio
        .previewImport({raw: bulkText, quiz_id: quiz.id, course_id: quiz.course?.id ?? null})
        .then((payload) => setPreview(payload as never))
        .catch(() => setPreview(null));
    }, 350);
    return () => window.clearTimeout(handle);
  }, [bulkText, bulkOpen, paperFile, quiz.id, quiz.course?.id]);

  const save = async () => {
    if (!editing) return;
    if (!editing.correct) {
      toast('error', 'Choose the correct answer', 'Every question needs an explicit A–D answer — it is never assumed.');
      return;
    }
    const filled = ['a', 'b'].every((letter) => String(editing[`option_${letter}` as keyof QuestionDraft] ?? '').trim().length > 0);
    if (!filled) {
      toast('error', 'Options A and B are required');
      return;
    }
    setBusy(true);
    try {
      if (editing.id) await api.admin.updateQuestion(editing.id, editing);
      else await api.admin.createQuestion(quiz.id, editing);
      toast('success', editing.id ? 'Question updated' : 'Question added');
      setEditing(null);
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not save question', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bulkSave = async () => {
    setBusy(true);
    try {
      const result = (paperFile
        ? await api.admin.studio.importFile(paperFile, {
            quiz_id: quiz.id,
            course_id: quiz.course?.id ?? null,
            mode: 'append',
            skip_duplicates: true,
          })
        : await api.admin.studio.importQuestions({
            raw: bulkText,
            quiz_id: quiz.id,
            course_id: quiz.course?.id ?? null,
            mode: 'append',
            skip_duplicates: true,
          })) as {created?: number; rejected?: number; skipped?: number; errors?: {text: string}[]};
      toast(
        result.created ? 'success' : 'info',
        `${result.created ?? 0} question${result.created === 1 ? '' : 's'} imported`,
        `${result.rejected ?? 0} rejected · ${result.skipped ?? 0} duplicates skipped`,
      );
      if (!result.rejected) {
        setBulkOpen(false);
        setBulkText('');
        setPaperFile(null);
      }
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Import failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runDraw = async () => {
    setDrawBusy(true);
    try {
      const result = await api.admin.draw(quiz.id, drawCount);
      toast(
        'success',
        `Drew ${result.drawn} question${result.drawn === 1 ? '' : 's'}`,
        `${result.total} in this exam now · ${result.available} still available in the bank`,
      );
      setDrawOpen(false);
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Draw failed', (error as Error).message);
    } finally {
      setDrawBusy(false);
    }
  };

  const remove = async (question: QuestionPublic) => {
    if (!window.confirm('Delete this question?')) return;
    try {
      await api.admin.deleteQuestion(question.id);
      toast('info', 'Question deleted');
      load();
      onChanged();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeading
        title={quiz.title}
        subtitle={`${total > 0 ? `${formatNumber(total)}` : questions?.length ?? quiz.question_count} questions in the bank`}
        icon={<ScrollText className="size-4" />}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setDrawOpen(true)} icon={<Shuffle className="size-3.5" />}>
              Draw from bank
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)} icon={<Upload className="size-3.5" />}>
              Import questions
            </Button>
            <Button size="sm" onClick={() => setEditing({...emptyQuestion})} icon={<Plus className="size-4" />}>
              Add question
            </Button>
          </div>
        }
      />

      <Card className="min-w-0 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]">
          <TextInput
            placeholder="Search text, topic, tags…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
            aria-label="Search the question bank"
          />
          <Select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setOffset(0);
            }}
            aria-label="Filter by review status"
          >
            <option value="">Any status</option>
            {QUESTION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <Select
            value={sortKey}
            onChange={(event) => {
              setSortKey(event.target.value);
              setOffset(0);
            }}
            aria-label="Sort questions"
          >
            <option value="position">Exam order</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="hardest">Most missed</option>
            <option value="easiest">Most mastered</option>
            <option value="most_used">Most used</option>
            <option value="least_used">Least used</option>
            <option value="az">A → Z</option>
          </Select>
          <button
            type="button"
            onClick={() => {
              setFlaggedOnly((value) => !value);
              setOffset(0);
            }}
            aria-pressed={flaggedOnly}
 className={`min-h-10 shrink-0 rounded-2xl border px-3 text-[0.76rem] font-black tracking-wide transition-colors touch-manipulation ${
              flaggedOnly ? 'border-flare-500/50 bg-flare-500/16 text-flare-200' : 'border-white/10 bg-white/4 text-mist-500'
            }`}
          >
            Flagged
          </button>
        </div>
      </Card>

      {!questions ? (
        <div className="space-y-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-28" />
          ))}
        </div>
      ) : questions.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="size-6" />}
          title="No questions yet"
          detail="Add them one by one or paste a whole paper with the bulk importer."
          action={
            <Button size="sm" onClick={() => setBulkOpen(true)} icon={<Upload className="size-4" />}>
              Import questions
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {questions.map((question, position) => (
            <li key={question.id}>
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/6 text-[0.78rem] font-black tabular text-mist-400">
                    {offset + position + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9rem] font-bold text-mist-100">{question.text}</p>
                    {question.drawn && (
                      <Chip className="mt-1.5 border-pulse-500/30 bg-pulse-500/12 text-pulse-200">Drawn from bank</Chip>
                    )}
                    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                      {LETTERS.filter((letter) => question.options[letter]).map((letter) => (
                        <li
                          key={letter}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[0.8rem] font-semibold ${
                            question.correct === letter
                              ? 'border-mint-500/40 bg-mint-500/12 text-mint-200'
                              : 'border-white/8 bg-white/[0.02] text-mist-400'
                          }`}
                        >
                          <span className="font-black">{letter}</span>
                          <span className="min-w-0 flex-1 truncate">{question.options[letter]}</span>
                          {question.correct === letter && <Check className="size-3.5 shrink-0" />}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Chip>{question.points} pts</Chip>
                      <Chip className="capitalize">{question.difficulty}</Chip>
                      {question.topic && (
                        <Chip className="border-nova-500/25 bg-nova-500/10 text-nova-200">
                          {question.topic}
                          {question.subtopic ? ` · ${question.subtopic}` : ''}
                        </Chip>
                      )}
                      {question.question_type && question.question_type !== 'mcq' && (
                        <Chip className="border-pulse-500/25 bg-pulse-500/10 text-pulse-200">
                          {QUESTION_TYPES.find((type) => type.value === question.question_type)?.label ?? question.question_type}
                        </Chip>
                      )}
                      {typeof question.usage_count === 'number' && question.usage_count > 0 && (
                        <Chip className="tabular">
                          {question.usage_count} answers · {Math.round(question.accuracy ?? 0)}% right
                        </Chip>
                      )}
                      {question.status && question.status !== 'approved' && (
                        <Chip className="capitalize border-gold-500/30 bg-gold-500/12 text-gold-200">{question.status}</Chip>
                      )}
                      {question.visible === false && <Chip className="border-white/14 bg-white/6 text-mist-400">Hidden</Chip>}
                      {question.explanation && <Chip className="border-pulse-500/25 bg-pulse-500/10 text-pulse-300">Has explanation</Chip>}
                      {question.flag_reason && <Chip className="border-flare-500/35 bg-flare-500/12 text-flare-200">Flagged</Chip>}
                      {(question.tags ?? []).slice(0, 3).map((tag) => (
                        <Chip key={tag} className="text-mist-400">
                          #{tag}
                        </Chip>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Version history"
                      onClick={() => void openHistory(question)}
                      icon={<History className="size-3.5" />}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Usage analytics"
                      onClick={() => void showStats(question)}
                      icon={<BarChart3 className="size-3.5" />}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Duplicate"
                      onClick={() => void duplicate(question)}
                      icon={<Copy className="size-3.5" />}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title={question.flag_reason ? 'Clear flag' : 'Flag for review'}
                      onClick={() => void (question.flag_reason ? unflag(question) : flag(question))}
                      icon={<Flag className={`size-3.5 ${question.flag_reason ? 'text-flare-400' : ''}`} />}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing({
                          id: question.id,
                          text: question.text,
                          option_a: question.options.A ?? '',
                          option_b: question.options.B ?? '',
                          option_c: question.options.C ?? '',
                          option_d: question.options.D ?? '',
                          correct: (question.correct ?? '') as OptionKey | '',
                          explanation: question.explanation ?? '',
                          points: question.points,
                          difficulty: (question.difficulty as (typeof DIFFICULTIES)[number]) ?? 'medium',
                          question_type: question.question_type ?? 'mcq',
                          topic: question.topic ?? '',
                          subtopic: question.subtopic ?? '',
                          objective: question.objective ?? '',
                          tags: question.tags ?? [],
                          source: question.source ?? '',
                          reference: question.reference ?? '',
                          author: question.author ?? '',
                          hint: question.hint ?? '',
                          admin_notes: question.admin_notes ?? '',
                          status: (question.status as QuestionDraft['status']) ?? 'approved',
                          visible: question.visible ?? true,
                          flashcard_enabled: question.flashcard_enabled ?? true,
                          duel_enabled: question.duel_enabled ?? true,
                          practice_enabled: question.practice_enabled ?? true,
                          time_limit_seconds: question.time_limit_seconds ?? 0,
                          media: (question.media ?? {}) as Record<string, string>,
                        })
                      }
                      icon={<Pencil className="size-3.5" />}
                    />
                    <Button size="sm" variant="ghost" onClick={() => remove(question)} icon={<Trash2 className="size-3.5 text-flare-400" />} />
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {questions && questions.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
            Previous
          </Button>
          <span className="text-center text-[0.78rem] font-bold text-mist-500">
            {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {formatNumber(total)}
          </span>
          <Button size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
            Next
          </Button>
        </div>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit question' : 'New question'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy} icon={<Check className="size-4" />}>
              Save question
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Field label="Question">
              <TextArea rows={3} value={editing.text} onChange={(event) => setEditing({...editing, text: event.target.value})} />
            </Field>

            {/* Option rows: the letter badge IS the selector, so the answer is
                always a deliberate choice — never inferred from order. */}
            <div className="grid gap-3">
              {LETTERS.map((letter) => {
                const key = `option_${letter.toLowerCase()}` as keyof typeof editing;
                const isCorrect = editing.correct === letter;
                return (
                  <div
                    key={letter}
                    className={`flex items-center gap-2 rounded-2xl border p-2 transition-colors ${
                      isCorrect ? 'border-mint-500/45 bg-mint-500/10' : 'border-white/10 bg-white/[0.02]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setEditing({...editing, correct: letter})}
                      aria-pressed={isCorrect}
                      aria-label={`Mark option ${letter} as the correct answer`}
                      className={`grid size-11 shrink-0 place-items-center rounded-xl border font-display text-[0.9rem] font-black transition-colors touch-manipulation ${
                        isCorrect ? 'border-mint-500/60 bg-mint-500/25 text-mint-100' : 'border-white/12 bg-white/6 text-mist-300 hover:border-white/30'
                      }`}
                    >
                      {letter}
                    </button>
                    <TextInput
                      value={String(editing[key] ?? '')}
                      placeholder={`Option ${letter} text`}
                      onChange={(event) => setEditing({...editing, [key]: event.target.value})}
                      className="min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => setEditing({...editing, correct: isCorrect ? ('' as OptionKey) : letter})}
 className={`hidden shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[0.7rem] font-black tracking-wide transition-colors sm:flex ${
                        isCorrect ? 'border-mint-500/50 bg-mint-500/16 text-mint-200' : 'border-white/10 bg-white/4 text-mist-500 hover:text-mist-200'
                      }`}
                    >
                      <Check className="size-3.5" />
                      {isCorrect ? 'Correct' : 'Select'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label="Correct answer"
                hint={editing.correct ? `Saved as ${editing.correct}` : 'Required — no default is ever assumed'}
              >
                <Select
                  value={editing.correct}
                  onChange={(event) => setEditing({...editing, correct: event.target.value as OptionKey})}
                  className={editing.correct ? '' : 'border-flare-500/45'}
                >
                  <option value="">Select the correct answer…</option>
                  {LETTERS.map((letter) => (
                    <option key={letter} value={letter}>
                      {letter}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Points">
                <TextInput
                  type="number"
                  min={1}
                  max={20}
                  value={editing.points}
                  onChange={(event) => setEditing({...editing, points: Number(event.target.value)})}
                />
              </Field>
              <Field label="Difficulty">
                <Select
                  value={editing.difficulty}
                  onChange={(event) => setEditing({...editing, difficulty: event.target.value as (typeof DIFFICULTIES)[number]})}
                >
                  {DIFFICULTIES.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Explanation" hint="Shown to players in the post-exam review and flashcards.">
              <TextArea rows={2} value={editing.explanation} onChange={(event) => setEditing({...editing, explanation: event.target.value})} />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Question type">
                <Select value={editing.question_type} onChange={(event) => setEditing({...editing, question_type: event.target.value})}>
                  {QUESTION_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Review status">
                <Select value={editing.status} onChange={(event) => setEditing({...editing, status: event.target.value as QuestionDraft['status']})}>
                  {QUESTION_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Topic">
                <TextInput value={editing.topic} onChange={(event) => setEditing({...editing, topic: event.target.value})} placeholder="e.g. Constitutional Law" />
              </Field>
              <Field label="Subtopic">
                <TextInput value={editing.subtopic} onChange={(event) => setEditing({...editing, subtopic: event.target.value})} />
              </Field>
              <Field label="Learning objective" className="sm:col-span-2">
                <TextInput value={editing.objective} onChange={(event) => setEditing({...editing, objective: event.target.value})} />
              </Field>
              <Field label="Tags" hint="Comma separated — used for filtering and decks." className="sm:col-span-2">
                <TextInput
                  value={editing.tags.join(', ')}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      tags: event.target.value
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
              <Field label="Source">
                <TextInput value={editing.source} onChange={(event) => setEditing({...editing, source: event.target.value})} placeholder="Past paper, textbook…" />
              </Field>
              <Field label="Reference">
                <TextInput value={editing.reference} onChange={(event) => setEditing({...editing, reference: event.target.value})} />
              </Field>
              <Field label="Author">
                <TextInput value={editing.author} onChange={(event) => setEditing({...editing, author: event.target.value})} />
              </Field>
              <Field label="Time limit (seconds)" hint="0 = use the exam clock">
                <TextInput
                  type="number"
                  min={0}
                  max={3600}
                  value={editing.time_limit_seconds}
                  onChange={(event) => setEditing({...editing, time_limit_seconds: Math.max(0, Number(event.target.value) || 0)})}
                />
              </Field>
              <Field label="Hint" hint="Offered by the hint power-up and practice mode." className="sm:col-span-2">
                <TextInput value={editing.hint} onChange={(event) => setEditing({...editing, hint: event.target.value})} />
              </Field>
              <Field label="Image URL" className="sm:col-span-2">
                <TextInput
                  value={editing.media.image ?? ''}
                  onChange={(event) => setEditing({...editing, media: {...editing.media, image: event.target.value}})}
                  placeholder="https://…"
                />
              </Field>
              <Field label="Admin notes" className="sm:col-span-2">
                <TextArea rows={2} value={editing.admin_notes} onChange={(event) => setEditing({...editing, admin_notes: event.target.value})} />
              </Field>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {[
                {key: 'visible' as const, label: 'Visible to players'},
                {key: 'flashcard_enabled' as const, label: 'Usable in flashcards'},
                {key: 'duel_enabled' as const, label: 'Usable in duels'},
                {key: 'practice_enabled' as const, label: 'Usable in practice / boss'},
              ].map((row) => (
                <label key={row.key} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={Boolean(editing[row.key])}
                    onChange={(event) => setEditing({...editing, [row.key]: event.target.checked})}
                    className="size-5 accent-fuchsia-500"
                  />
                  <span className="text-[0.84rem] font-bold text-mist-200">{row.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={bulkOpen}
        onClose={() => {
          setBulkOpen(false);
          setPaperFile(null);
        }}
        title="Import questions"
        subtitle="Paste a paper or load a file from your device — the answer letter is always taken exactly as written."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={bulkSave} loading={busy} disabled={!preview || (preview.valid ?? 0) === 0} icon={<Upload className="size-4" />}>
              Import {preview?.valid ? `${preview.valid}` : ''} questions
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="rounded-2xl border border-nova-500/25 bg-nova-500/8 px-3.5 py-2.5 text-[0.78rem] font-bold text-nova-100">
            Importing into <span className="font-extrabold text-nova-500">{quiz.title}</span>
            {quiz.course ? ` · ${quiz.course.code}` : ' · no course attached yet'}
          </p>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-[0.74rem] leading-relaxed text-mist-400">
 <p className="font-sans text-[0.72rem] font-black tracking-[0.16em] text-mist-500">Format</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{`1. Which court has original jurisdiction over presidential elections?
A. Supreme Court
B. Court of Appeal
C. Federal High Court
D. National Industrial Court
Answer: Court of Appeal
Explanation: Section 246(1)(a) of the 1999 Constitution.

2. Next question...`}</pre>
            <p className="mt-2 font-sans text-[0.7rem] font-semibold text-mist-500">
              The answer may be a letter (B) or the exact option text — text is resolved to the option's stable key, so shuffled options can never move it.
            </p>
          </div>

          <div>
 <p className="text-[0.72rem] font-black tracking-[0.16em] text-mist-500">From your device</p>
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) void readPaper(file);
              }}
              className={`mt-2 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition-colors touch-manipulation ${
                dragging ? 'border-nova-400/60 bg-nova-500/10' : 'border-white/14 bg-white/[0.02] hover:border-white/25'
              }`}
            >
              <input
                type="file"
                accept=".txt,.csv,.tsv,.pdf,.json,text/plain,text/csv,application/pdf,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readPaper(file);
                  event.target.value = '';
                }}
              />
              <FileUp className={`size-5 ${paperBusy ? 'animate-pulse text-nova-300' : 'text-mist-400'}`} />
              <span className="text-[0.82rem] font-bold text-mist-200">
                {paperBusy ? 'Reading the file…' : 'Drop a .txt, .csv or .pdf here'}
              </span>
              <span className="text-[0.72rem] font-semibold text-mist-500">
                or tap to browse · answers are read exactly as written and never guessed
              </span>
            </label>

            {paperFile && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
                <Chip className="border-nova-500/30 bg-nova-500/12 text-nova-200">
                  {preview?.file?.kind ? preview.file.kind : 'File'}
                </Chip>
                <span className="min-w-0 flex-1 truncate text-[0.8rem] font-bold text-mist-100">{paperFile.name}</span>
                <span className="shrink-0 text-[0.72rem] font-semibold text-mist-500 tabular">
                  {(paperFile.size / 1024).toFixed(1)} KB
                  {preview?.file?.rows_detected ? ` · ${preview.file.rows_detected} rows` : ''}
                  {preview?.file?.pages ? ` · ${preview.file.pages} pages` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPaperFile(null);
                    setPreview(null);
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 text-[0.72rem] font-black text-mist-500 transition-colors hover:text-flare-300"
                >
                  Remove
                </button>
              </div>
            )}

            {Boolean(preview?.file?.notes?.length) && (
              <ul className="mt-2 space-y-1">
                {(preview?.file?.notes ?? []).map((note, index) => (
                  <li key={index} className="text-[0.74rem] font-semibold text-mist-400">
                    · {note}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Field
            label={paperFile ? 'Or paste text instead' : 'Questions'}
            hint={
              preview
                ? `${preview.valid ?? 0} ready · ${preview.rejected ?? 0} rejected · ${preview.duplicates ?? 0} duplicates`
                : 'Waiting for input…'
            }
          >
            <TextArea rows={12} value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder="Paste your questions here…" />
          </Field>

          <AnimatePresence>
            {preview && ((preview.valid ?? 0) + (preview.rejected ?? 0) > 0) && (
              <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="space-y-2">
                {(preview.rejected ?? 0) > 0 && (
                  <ul className="space-y-1.5">
                    {(preview.errors ?? []).slice(0, 6).map((row, index) => (
                      <li key={index} className="rounded-2xl border border-flare-500/35 bg-flare-500/10 px-3.5 py-2.5">
                        <p className="text-[0.78rem] font-black text-flare-200">
                          {row.number ? `Question ${row.number}` : `Row ${index + 1}`}: {row.reasons.join(', ')}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[0.72rem] font-semibold text-mist-400">{row.text}</p>
                        {row.answer && (
                          <p className="mt-0.5 font-mono text-[0.7rem] text-mist-500">
                            answer found: “{row.answer}” — fix it to A, B, C or D (AC for multi-select) before importing.
                          </p>
                        )}
                      </li>
                    ))}
                    {(preview.errors ?? []).length > 6 && (
                      <li className="px-2 text-[0.74rem] font-semibold text-mist-500">+ {(preview.errors ?? []).length - 6} more rejected rows…</li>
                    )}
                  </ul>
                )}
                {(preview.valid ?? 0) > 0 && (
                  <p className="rounded-2xl border border-mint-500/30 bg-mint-500/10 px-3.5 py-2.5 text-[0.78rem] font-bold text-mint-200">
                    {preview.valid} question{preview.valid === 1 ? '' : 's'} will import with the exact answer letter given.
                    Rejected rows are never imported as “A”.
                  </p>
                )}
                {(preview.duplicates ?? 0) > 0 && (
                  <p className="text-[0.74rem] font-semibold text-mist-500">{preview.duplicates} duplicate rows will be skipped.</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Modal>

      <Modal
        open={drawOpen}
        onClose={() => setDrawOpen(false)}
        title="Draw from Question Bank"
        subtitle={quiz.course ? `${quiz.course.code} · ${quiz.course.title}` : 'No course on this exam yet'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDrawOpen(false)}>
              Cancel
            </Button>
            <Button onClick={runDraw} loading={drawBusy} disabled={!quiz.course} icon={<Shuffle className="size-4" />}>
              Draw {drawCount} questions
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {quiz.course ? (
            <>
              <p className="text-[0.84rem] leading-relaxed font-semibold text-mist-400">
                Every question belongs to its course's single bank. This pulls{' '}
                <span className="font-black text-mist-100">{drawCount}</span> random questions from the{' '}
                <span className="font-black text-nova-200">{quiz.course.code}</span> bank only — anything already in
                this exam is skipped, so a question can never repeat.
              </p>
              {bank && (
                <div className="flex flex-wrap gap-2">
                  <Chip className="border-mint-500/28 bg-mint-500/12 text-mint-300">{bank.bank} originals in bank</Chip>
                  <Chip>{bank.drawn_copies} already drawn into exams</Chip>
                  {drawCount > bank.bank && (
                    <Chip className="border-gold-400/30 bg-gold-500/12 text-gold-300">
                      Only {bank.bank} available — all of them will be drawn
                    </Chip>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[10, 20, 50, 70].map((value) => (
                  <button
                    key={value}
                    onClick={() => setDrawCount(value)}
                    className={`min-h-11 rounded-xl border py-2 text-[0.82rem] font-black tabular transition-colors touch-manipulation ${
                      drawCount === value ? 'border-nova-400/50 bg-nova-500/16 text-nova-200' : 'border-white/10 bg-white/4 text-mist-400'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <Field label="Exact number to draw">
                <TextInput
                  type="number"
                  min={1}
                  max={200}
                  value={String(drawCount)}
                  onChange={(event) => setDrawCount(Math.max(1, Math.min(200, Number(event.target.value) || 1)))}
                />
              </Field>
            </>
          ) : (
            <p className="text-[0.84rem] font-semibold text-mist-400">
              Edit this exam and choose a course first — draws always come from that course's bank only.
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(historyFor)}
        onClose={() => setHistoryFor(null)}
        title={`Version history${historyFor ? ` · Q${historyFor.id}` : ''}`}
        subtitle="Every save snapshots the previous text, options and answer. Restoring keeps the current state in history first."
        size="lg"
      >
        {!versions ? (
          <div className="space-y-2">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-14" />
            ))}
          </div>
        ) : versions.length === 0 ? (
          <EmptyState icon={<History className="size-6" />} title="No earlier versions" detail="The first saved edit creates version 1." />
        ) : (
          <ul className="space-y-2">
            {versions.map((row) => (
              <li key={row.version} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3.5 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/6 font-display text-[0.78rem] font-black text-mist-300">
                  v{row.version}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.84rem] font-bold text-mist-100">{row.note || 'Question updated'}</p>
                  <p className="truncate text-[0.7rem] font-semibold text-mist-500">
                    {row.author ? `${row.author} · ` : ''}
                    {row.created_at ? new Date(row.created_at).toLocaleString() : ''}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => historyFor && void restore(historyFor, row.version)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={Boolean(statsFor)}
        onClose={() => setStatsFor(null)}
        title="Question analytics"
        subtitle="Live usage straight from graded answers — exams, duels, practice and flashcards."
      >
        {statsFor && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {label: 'Answers', value: statsFor.stats.answered},
                {label: 'Correct', value: statsFor.stats.correct},
                {label: 'Accuracy', value: `${Math.round(statsFor.stats.accuracy)}%`},
                {label: 'Avg time', value: `${Math.round((statsFor.stats.avg_ms ?? 0) / 100) / 10}s`},
              ].map((tile) => (
                <div key={tile.label} className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
 <p className="text-[0.6rem] font-black tracking-[0.14em] text-mist-500">{tile.label}</p>
                  <p className="mt-1 font-display text-lg font-black tabular text-mist-50">{tile.value}</p>
                </div>
              ))}
            </div>
            {statsFor.most_wrong.length > 0 && (
              <div className="rounded-2xl border border-flare-500/25 bg-flare-500/8 px-3.5 py-3">
 <p className="text-[0.68rem] font-black tracking-[0.16em] text-flare-200">Most-chosen wrong answers</p>
                <p className="mt-1 font-mono text-[0.78rem] font-bold text-mist-300">{statsFor.most_wrong.join(' · ')}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function ContentAdmin({onChanged}: {onChanged: () => void}) {
  const [tab, setTab] = useState<'courses' | 'exams' | 'questions' | 'materials'>('exams');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const {toast} = useSession();

  useEffect(() => {
    if (tab === 'questions' && !quiz) {
      api.admin
        .quizzes()
        .then((rows) => setQuiz(rows[0] ?? null))
        .catch((error: Error) => toast('error', 'Could not load exams', error.message));
    }
  }, [tab, quiz, toast]);

  if (tab === 'questions' && !quiz) {
    return (
      <div className="space-y-4">
        <Segmented
          value={tab}
          options={[
            {value: 'courses', label: 'Courses', icon: BookOpen},
            {value: 'exams', label: 'Exams', icon: FileText},
            {value: 'questions', label: 'Questions', icon: ScrollText},
            {value: 'materials', label: 'Materials', icon: BookOpen},
          ]}
          onChange={setTab}
        />
        <EmptyState
          icon={<X className="size-6" />}
          title="Pick an exam first"
          detail="Create an exam, then open its question bank."
          action={
            <Button size="sm" onClick={() => setTab('exams')}>
              Go to exams
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <Segmented
        value={tab}
        options={[
          {value: 'courses', label: 'Courses', icon: BookOpen},
          {value: 'exams', label: 'Exams', icon: FileText},
          {value: 'questions', label: 'Questions', icon: ScrollText},
          {value: 'materials', label: 'Materials', icon: BookOpen},
        ]}
        onChange={setTab}
      />

      {tab === 'courses' && <CoursesTab onChanged={onChanged} />}
      {tab === 'exams' && (
        <QuizzesTab
          onChanged={onChanged}
          onManageQuestions={(target) => {
            setQuiz(target);
            setTab('questions');
          }}
        />
      )}
      {tab === 'questions' && quiz && <QuestionsTab quiz={quiz} onChanged={onChanged} />}
      {tab === 'materials' && <MaterialsAdmin onChanged={onChanged} />}
    </div>
  );
}
