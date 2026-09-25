/**
 * One course, everything it owns — never mixed with another course:
 *
 *   Overview · Topics · Question bank · Notes · Materials · Discussion
 *
 * Structure: Course → Topic → questions / notes / materials. Topics are the
 * course's curated list; content that already uses a topic label shows up too.
 */
import {ArrowLeft, BookOpen, FileText, Hash, Library, MessageSquare, NotebookPen, Pencil, Plus, Shuffle, ScrollText, Trash2} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, EmptyState, Field, Modal, Segmented, Skeleton, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatDate, formatNumber} from '../lib/format';
import {useSession} from '../store/session';
import MaterialsAdmin from './MaterialsAdmin';
import QuestionManager from './QuestionManager';
import type {Course, CourseDiscussionPost, CourseOverview, CourseTopicRow, Quiz} from '../lib/types';

type Section = 'overview' | 'topics' | 'bank' | 'notes' | 'materials' | 'discussion';

function Stat({label, value, hint}: {label: string; value: number | string; hint?: string}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <p className="truncate text-[1.1rem] font-black text-mist-50 tabular">{typeof value === 'number' ? formatNumber(value) : value}</p>
      <p className="truncate text-[0.7rem] font-bold text-mist-400">{label}</p>
      {hint && <p className="mt-0.5 truncate text-[0.66rem] font-semibold text-mist-600">{hint}</p>}
    </div>
  );
}

function OverviewSection({course, go}: {course: Course; go: (section: Section) => void}) {
  const {toast} = useSession();
  const [data, setData] = useState<CourseOverview | null>(null);
  useEffect(() => {
    api.admin
      .courseOverview(course.id)
      .then(setData)
      .catch((error: Error) => toast('error', 'Could not load the course overview', error.message));
  }, [course.id, toast]);
  if (!data) return <Skeleton className="h-48" />;
  const levels = ['easy', 'medium', 'hard'] as const;
  const bankTotal = Math.max(1, data.bank.total);
  return (
    <div className="min-w-0 space-y-3">
      {data.course.description && <p className="text-[0.84rem] leading-relaxed text-mist-400">{data.course.description}</p>}
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Question bank" value={data.bank.total} hint={`${formatNumber(data.bank.ready)} ready to draw`} />
        <Stat label="Exam-specific" value={data.exam_specific_questions} hint="owned by single exams" />
        <Stat label="Exams" value={data.exams.length} hint={`${formatNumber(data.submissions)} submissions`} />
        <Stat label="Topics" value={data.topics} />
        <Stat label="Notes" value={data.notes} />
        <Stat label="Materials" value={data.materials} hint={`${formatNumber(data.discussion_posts)} discussion posts`} />
      </div>

      <Card className="min-w-0 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.8rem] font-extrabold text-mist-100">Bank difficulty</p>
          <Button size="sm" variant="ghost" onClick={() => go('bank')} icon={<Library className="size-3.5" />}>
            Open bank
          </Button>
        </div>
        <div className="mt-2 flex h-2.5 min-w-0 overflow-hidden rounded-full bg-white/6">
          {levels.map((level) => (
            <span
              key={level}
              className={level === 'easy' ? 'bg-mint-500/70' : level === 'medium' ? 'bg-nova-500/70' : 'bg-flare-500/70'}
              style={{width: `${((data.bank.by_difficulty[level] ?? 0) / bankTotal) * 100}%`}}
            />
          ))}
        </div>
        <p className="mt-1.5 text-[0.72rem] font-semibold text-mist-500">
          {levels.map((level) => `${formatNumber(data.bank.by_difficulty[level] ?? 0)} ${level}`).join(' · ')}
        </p>
      </Card>

      <Card className="min-w-0 p-3">
        <p className="text-[0.8rem] font-extrabold text-mist-100">Exams for this course</p>
        {data.exams.length === 0 ? (
          <p className="mt-1.5 text-[0.78rem] text-mist-500">No exams yet — create one in the Exams tab.</p>
        ) : (
          <ul className="mt-2 min-w-0 space-y-1">
            {data.exams.slice(0, 8).map((exam) => (
              <li key={exam.id} className="flex min-w-0 items-center gap-2 text-[0.8rem]">
                {exam.question_source === 'course_random' ? <Shuffle className="size-3.5 shrink-0 text-nova-300" /> : <ScrollText className="size-3.5 shrink-0 text-mist-400" />}
                <span className="min-w-0 flex-1 truncate font-bold text-mist-200">{exam.title}</span>
                <span className="shrink-0 text-[0.7rem] font-bold text-mist-500">
                  {exam.question_source === 'course_random' ? `random ${exam.draw_count}` : 'exam-specific'} · {exam.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TopicsSection({course, onChanged}: {course: Course; onChanged: () => void}) {
  const {toast} = useSession();
  const [rows, setRows] = useState<CourseTopicRow[] | null>(null);
  const [editing, setEditing] = useState<{id: number | null; name: string; description: string} | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.admin
      .courseTopics(course.id)
      .then((payload) => setRows(payload.topics))
      .catch((error: Error) => toast('error', 'Could not load topics', error.message));
  }, [course.id, toast]);
  useEffect(load, [load]);

  const save = async () => {
    if (!editing || !editing.name.trim()) return;
    setBusy(true);
    try {
      const payload = editing.id
        ? await api.admin.updateCourseTopic(editing.id, {name: editing.name, description: editing.description})
        : await api.admin.createCourseTopic(course.id, {name: editing.name, description: editing.description});
      setRows(payload.topics);
      toast('success', editing.id ? 'Topic updated' : 'Topic added', editing.name);
      setEditing(null);
      onChanged();
    } catch (error) {
      toast('error', 'Could not save topic', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: CourseTopicRow) => {
    if (!row.id || !window.confirm(`Remove “${row.name}” from the topic list? Questions and notes keep their topic label.`)) return;
    try {
      const payload = await api.admin.deleteCourseTopic(row.id);
      setRows(payload.topics);
      toast('info', 'Topic removed');
    } catch (error) {
      toast('error', 'Could not remove topic', (error as Error).message);
    }
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[0.8rem] font-semibold text-mist-400">Topics organise this course’s questions, notes and materials.</p>
        <Button size="sm" onClick={() => setEditing({id: null, name: '', description: ''})} icon={<Plus className="size-4" />}>
          Add topic
        </Button>
      </div>
      {!rows ? (
        <Skeleton className="h-32" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Hash className="size-6" />} title="No topics yet" detail="Add the course’s topics, then file questions and notes under them." />
      ) : (
        <ul className="grid min-w-0 gap-1.5 md:grid-cols-2">
          {rows.map((row) => (
            <li key={row.id ?? `label-${row.name}`} className="min-w-0">
              <Card className="flex min-w-0 items-start gap-2.5 p-3">
                <Hash className="mt-0.5 size-4 shrink-0 text-nova-300" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.88rem] font-extrabold text-mist-50">{row.name}</p>
                  {row.description && <p className="mt-0.5 line-clamp-2 text-[0.76rem] text-mist-400">{row.description}</p>}
                  <p className="mt-1 text-[0.7rem] font-bold text-mist-500">
                    {formatNumber(row.questions)} questions · {row.notes} notes · {row.materials} materials
                    {!row.curated && ' · not in topic list yet'}
                  </p>
                </div>
                {row.id ? (
                  <div className="flex shrink-0 gap-0.5">
                    <Button size="sm" variant="ghost" title="Edit topic" onClick={() => setEditing({id: row.id, name: row.name, description: row.description})} icon={<Pencil className="size-3.5" />} />
                    <Button size="sm" variant="ghost" title="Remove topic" onClick={() => void remove(row)} icon={<Trash2 className="size-3.5 text-flare-400" />} />
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setEditing({id: null, name: row.name, description: ''})} icon={<Plus className="size-3.5" />}>
                    Add
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit topic' : 'New topic'}
        subtitle={editing?.id ? 'Renaming moves this course’s questions and notes with it.' : `${course.code} · ${course.title}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy} disabled={!editing?.name.trim()}>
              Save topic
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <Field label="Name">
              <TextInput value={editing.name} maxLength={120} onChange={(event) => setEditing({...editing, name: event.target.value})} placeholder="Fundamental rights" />
            </Field>
            <Field label="Description (optional)">
              <TextArea rows={2} maxLength={400} value={editing.description} onChange={(event) => setEditing({...editing, description: event.target.value})} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function BankSection({course, onChanged}: {course: Course; onChanged: () => void}) {
  const {toast} = useSession();
  const [bank, setBank] = useState<Quiz | null>(null);
  useEffect(() => {
    api.admin
      .ensureCourseBank(course.id)
      .then(setBank)
      .catch((error: Error) => toast('error', 'Could not open the question bank', error.message));
  }, [course.id, toast]);
  if (!bank) return <Skeleton className="h-40" />;
  return <QuestionManager quiz={bank} onChanged={onChanged} title={`${course.code} question bank`} />;
}

function DiscussionSection({course}: {course: Course}) {
  const {toast} = useSession();
  const [posts, setPosts] = useState<CourseDiscussionPost[] | null>(null);
  const load = useCallback(() => {
    api.admin
      .courseDiscussion(course.id)
      .then((payload) => setPosts(payload.posts))
      .catch((error: Error) => toast('error', 'Could not load discussion', error.message));
  }, [course.id, toast]);
  useEffect(load, [load]);
  const remove = async (post: CourseDiscussionPost) => {
    if (!window.confirm('Delete this post?')) return;
    try {
      await api.admin.deleteCourseDiscussionPost(post.id);
      toast('info', 'Post deleted');
      load();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };
  if (!posts) return <Skeleton className="h-32" />;
  if (!posts.length) {
    return <EmptyState icon={<MessageSquare className="size-6" />} title="No discussion yet" detail="Players’ questions and tips on this course’s notes and materials appear here." />;
  }
  return (
    <ul className="min-w-0 space-y-1.5">
      {posts.map((post) => (
        <li key={post.id} className="min-w-0">
          <Card className="min-w-0 p-3">
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[0.7rem] font-bold text-mist-500">
                  <span className="text-mist-300">{post.name}</span> · {post.kind} on{' '}
                  <span className="text-mist-300">{post.material_title}</span>
                  {post.topic ? ` · ${post.topic}` : ''} · {post.created_at ? formatDate(post.created_at, true) : ''}
                </p>
                <p className="mt-1 text-[0.84rem] leading-snug text-mist-100 [overflow-wrap:anywhere]">{post.body}</p>
              </div>
              <Button size="sm" variant="ghost" title="Delete post" onClick={() => void remove(post)} icon={<Trash2 className="size-3.5 text-flare-400" />} />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default function CourseWorkspace({
  course,
  onBack,
  onEdit,
  onDelete,
  onChanged,
}: {
  course: Course;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [section, setSection] = useState<Section>('overview');
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />} aria-label="All courses" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.7rem] font-black tracking-[0.12em] text-mist-500 uppercase">{course.code}</p>
          <h2 className="truncate text-[1rem] font-extrabold text-mist-50 sm:text-[1.1rem]">{course.title}</h2>
        </div>
        <Button size="sm" variant="ghost" title="Edit course" onClick={onEdit} icon={<Pencil className="size-3.5" />} />
        <Button size="sm" variant="ghost" title="Delete course" onClick={onDelete} icon={<Trash2 className="size-3.5 text-flare-400" />} />
      </div>

      <Segmented
        value={section}
        options={[
          {value: 'overview', label: 'Overview', icon: BookOpen},
          {value: 'topics', label: 'Topics', icon: Hash},
          {value: 'bank', label: 'Question bank', icon: Library},
          {value: 'notes', label: 'Notes', icon: NotebookPen},
          {value: 'materials', label: 'Materials', icon: FileText},
          {value: 'discussion', label: 'Discussion', icon: MessageSquare},
        ]}
        onChange={setSection}
      />

      {section === 'overview' && <OverviewSection course={course} go={setSection} />}
      {section === 'topics' && <TopicsSection course={course} onChanged={onChanged} />}
      {section === 'bank' && <BankSection course={course} onChanged={onChanged} />}
      {section === 'notes' && <MaterialsAdmin key={`notes-${course.id}`} onChanged={onChanged} course={course} kind="note" />}
      {section === 'materials' && <MaterialsAdmin key={`materials-${course.id}`} onChanged={onChanged} course={course} kind="material" />}
      {section === 'discussion' && <DiscussionSection course={course} />}
    </div>
  );
}
