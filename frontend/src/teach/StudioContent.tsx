/** Teacher Studio — materials library and quiz builder. */
import {Archive, ArchiveRestore, BarChart3, BookOpen, CheckCircle2, Copy, Database, Eye, FileText, Link2, ListChecks, Loader2, Pencil, Plus, Rocket, Send, Trash2, Upload, X} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ApiError, api} from '../lib/api';
import {VISIBILITY_LABEL, formatBytes, teachers, type QKind, type StudioStudent, type TGroup, type TMaterial, type TQuestion, type TQuiz, type Visibility} from '../lib/teachers';
import type {Course} from '../lib/types';
import {Empty, LoadingRows, Seg} from '../pro/ui';
import {useSession} from '../store/session';
import {MaterialSheet, VisibilityBadge} from './content';
import {Field, PersonAvatar, Sheet, StatusPill, timeAgo} from './ui';
import {askConfirm, Select} from '../components/ui';

const errText = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.');

/* ------------------------------------------------------- shared pickers */
function VisibilityPicker({value, groupId, groups, onChange}: {value: Visibility; groupId: number | null; groups: TGroup[]; onChange: (v: Visibility, groupId: number | null) => void}) {
  return (
    <div className="grid gap-2">
      <Field label="Who can see it" group hint={value === 'private' ? 'Only you — share with individual students from chat.' : value === 'students' ? 'Everyone you currently teach.' : value === 'group' ? 'Members of one of your groups.' : 'Anyone on Genesis, on your public profile.'}>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {(Object.keys(VISIBILITY_LABEL) as Visibility[]).map((v) => (
            <button key={v} type="button" className="t-chip-btn justify-center" aria-pressed={value === v} onClick={() => onChange(v, v === 'group' ? groupId ?? groups[0]?.id ?? null : null)} disabled={v === 'group' && groups.length === 0}>
              {VISIBILITY_LABEL[v]}
            </button>
          ))}
        </div>
      </Field>
      {value === 'group' && (
        <Select className="pro-input" value={groupId ?? ''} onChange={(e) => onChange('group', Number(e.target.value))} aria-label="Group">
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

export function ShareToStudents({open, onClose, title, onShare}: {open: boolean; onClose: () => void; title: string; onShare: (ids: number[]) => Promise<number>}) {
  const {toast} = useSession();
  const [students, setStudents] = useState<StudioStudent[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPicked([]);
    teachers.students().then((r) => setStudents(r.items.filter((s) => s.relationship.status === 'active'))).catch(() => setStudents([]));
  }, [open]);
  const share = async () => {
    setBusy(true);
    try {
      const n = await onShare(picked);
      toast('success', `Shared with ${n} student${n === 1 ? '' : 's'}`, 'They were notified.');
      onClose();
    } catch (e) {
      toast('error', 'Could not share', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      icon={<Send />}
      title="Share with students"
      subtitle={title}
      footer={
        <button type="button" className="pro-btn pro-btn-primary" disabled={!picked.length || busy} onClick={() => void share()}>
          {busy && <Loader2 className="size-4 animate-spin" />} Share{picked.length ? ` (${picked.length})` : ''}
        </button>
      }
    >
      {students === null && <LoadingRows rows={3} />}
      {students?.length === 0 && <p className="pro-secondary">No active students yet. Accept a request first.</p>}
      {students && students.length > 1 && (
        <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm mb-2" onClick={() => setPicked(picked.length === students.length ? [] : students.map((s) => s.student.id))}>
          {picked.length === students.length ? 'Clear all' : 'Select all'}
        </button>
      )}
      <div className="grid gap-1">
        {students?.map((s) => {
          const on = picked.includes(s.student.id);
          return (
            <button key={s.student.id} type="button" className="t-row t-row-btn rounded-xl" aria-pressed={on} style={{background: on ? 'var(--pro-accent-soft)' : undefined}} onClick={() => setPicked(on ? picked.filter((id) => id !== s.student.id) : [...picked, s.student.id])}>
              <PersonAvatar id={s.student.id} name={s.student.name} hue={s.student.avatar_hue} hasPhoto={s.student.has_photo} size={34} />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate font-semibold">{s.student.name}</span>
                <span className="pro-meta block truncate">{s.relationship.topic || s.relationship.subject}</span>
              </span>
              {on && <CheckCircle2 className="size-5" style={{color: 'var(--pro-accent-text)'}} />}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------------------- materials */
export function StudioMaterials({groups}: {groups: TGroup[]}) {
  const {toast} = useSession();
  const [items, setItems] = useState<TMaterial[] | null>(null);
  const [editing, setEditing] = useState<TMaterial | 'new' | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [sharing, setSharing] = useState<TMaterial | null>(null);
  const [filter, setFilter] = useState<'all' | Visibility>('all');
  const load = useCallback(() => {
    teachers.materials().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);
  const shown = (items ?? []).filter((m) => filter === 'all' || m.visibility === filter);
  const remove = async (m: TMaterial) => {
    if (!(await askConfirm(`Delete “${m.title}”? Students lose access.`))) return;
    try {
      await teachers.deleteMaterial(m.id);
      load();
    } catch (e) {
      toast('error', 'Could not delete', errText(e));
    }
  };
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Seg value={filter} onChange={(v) => setFilter(v as typeof filter)} label="Visibility" size="sm" options={[{value: 'all', label: 'All'}, ...(Object.keys(VISIBILITY_LABEL) as Visibility[]).map((v) => ({value: v, label: VISIBILITY_LABEL[v]}))]} />
        <button type="button" className="pro-btn pro-btn-primary" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> New material
        </button>
      </div>
      {items === null && <LoadingRows rows={4} />}
      {items && shown.length === 0 && (
        <Empty
          icon={<BookOpen className="size-6" />}
          hue="blue"
          title={items.length ? 'Nothing with this visibility' : 'No materials yet'}
          body="Upload notes, past questions or slides — or write a short explainer. You decide who sees each one."
          action={
            <button type="button" className="pro-btn pro-btn-sm" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Create one
            </button>
          }
        />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((m) => (
          <article key={m.id} className="pro-card t-card">
            <div className="flex items-start gap-3">
              <span className="t-attach-icon" style={{['--mark' as string]: m.kind === 'link' ? 'var(--pro-h-teal)' : m.kind === 'file' ? 'var(--pro-h-blue)' : 'var(--pro-h-violet)'}}>
                {m.kind === 'link' ? <Link2 /> : m.kind === 'file' ? <FileText /> : <BookOpen />}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="pro-h3 truncate">{m.title}</h3>
                <p className="pro-meta truncate">{[m.subject, m.topic].filter(Boolean).join(' · ') || 'General'} · {timeAgo(m.updated_at)}</p>
              </div>
              <VisibilityBadge visibility={m.visibility} group={m.group?.name} />
            </div>
            {m.description && <p className="pro-secondary line-clamp-2 [overflow-wrap:anywhere]">{m.description}</p>}
            <div className="t-stat-line">
              <span>
                <Eye className="size-3.5" /> {m.stats?.views ?? 0} views
              </span>
              <span>{m.stats?.unique_viewers ?? 0} students</span>
              {m.file && <span>{formatBytes(m.file.size)}</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="pro-btn pro-btn-sm" onClick={() => setPreview(m.id)}>
                <Eye className="size-4" /> Preview
              </button>
              <button type="button" className="pro-btn pro-btn-sm" onClick={() => setEditing(m)}>
                <Pencil className="size-4" /> Edit
              </button>
              <button type="button" className="pro-btn pro-btn-sm" onClick={() => setSharing(m)}>
                <Send className="size-4" /> Share
              </button>
              <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm ml-auto" onClick={() => void remove(m)} aria-label="Delete material" title="Delete">
                <Trash2 className="size-4" />
              </button>
            </div>
          </article>
        ))}
      </div>
      <MaterialEditor
        open={editing !== null}
        material={editing === 'new' ? null : editing}
        groups={groups}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
      <MaterialSheet id={preview} onClose={() => setPreview(null)} />
      <ShareToStudents open={!!sharing} onClose={() => setSharing(null)} title={sharing?.title ?? ''} onShare={async (ids) => (await teachers.shareMaterial(sharing!.id, ids)).shared} />
    </div>
  );
}

function MaterialEditor({open, material, groups, onClose, onSaved}: {open: boolean; material: TMaterial | null; groups: TGroup[]; onClose: () => void; onSaved: () => void}) {
  const {toast} = useSession();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<TMaterial['kind']>('file');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [file, setFile] = useState<TMaterial['file']>(null);
  const [visibility, setVisibility] = useState<Visibility>('students');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(material?.title ?? '');
    setDescription(material?.description ?? '');
    setSubject(material?.subject ?? '');
    setTopic(material?.topic ?? '');
    setKind(material?.kind ?? 'file');
    setLink(material?.link ?? '');
    setFile(material?.file ?? null);
    setVisibility(material?.visibility ?? 'students');
    setGroupId(material?.group?.id ?? null);
    setBody('');
    if (material?.kind === 'text') teachers.studioMaterial(material.id).then((m) => setBody(m.body ?? '')).catch(() => {});
  }, [open, material]);

  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    setUploading(true);
    try {
      const stored = await teachers.upload(picked, 'material');
      setFile(stored);
      if (!title.trim()) setTitle(picked.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      toast('error', 'Upload failed', errText(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const valid = title.trim().length >= 2 && (kind === 'file' ? !!file : kind === 'link' ? /^https?:\/\//.test(link.trim()) : body.trim().length > 0);
  const save = async () => {
    setBusy(true);
    const payload = {title, description, subject, topic, kind, body, link, file_id: file?.id ?? null, visibility, group_id: visibility === 'group' ? groupId : null};
    try {
      if (material) await teachers.updateMaterial(material.id, payload);
      else await teachers.createMaterial(payload);
      toast('success', material ? 'Material updated' : 'Material published');
      onSaved();
    } catch (e) {
      toast('error', 'Could not save', errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      icon={<BookOpen />}
      title={material ? 'Edit material' : 'New material'}
      footer={
        <>
          <button type="button" className="pro-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pro-btn pro-btn-primary" onClick={() => void save()} disabled={!valid || busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} {material ? 'Save' : 'Publish'}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <Seg
          value={kind}
          onChange={(v) => setKind(v as TMaterial['kind'])}
          label="Type"
          fill
          options={[
            {value: 'file', label: 'File'},
            {value: 'text', label: 'Write'},
            {value: 'link', label: 'Link'},
          ]}
        />
        {kind === 'file' && (
          <div className="grid gap-2">
            <input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.png,.jpg,.jpeg,.webp" onChange={(e) => void upload(e.target.files?.[0])} />
            {file ? (
              <div className="t-attach">
                <span className="t-attach-icon">
                  <FileText />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{file.name}</span>
                  <span className="pro-meta">{formatBytes(file.size)}</span>
                </span>
                <button type="button" className="pro-btn pro-btn-sm" onClick={() => fileRef.current?.click()}>
                  Replace
                </button>
              </div>
            ) : (
              <button type="button" className="grid place-items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center" style={{borderColor: 'var(--pro-border-strong)'}} onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" style={{color: 'var(--pro-accent-text)'}} />}
                <span className="font-semibold">{uploading ? 'Uploading…' : 'Choose a file'}</span>
                <span className="pro-meta">PDF, Word, PowerPoint, Excel, text or images · up to 15 MB</span>
              </button>
            )}
          </div>
        )}
        <Field label="Title">
          <input className="pro-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Subject">
            <input className="pro-input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={80} placeholder="e.g. Mathematics" />
          </Field>
          <Field label="Topic">
            <input className="pro-input" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} placeholder="e.g. Differentiation" />
          </Field>
        </div>
        {kind === 'link' && (
          <Field label="Link" hint="Must start with https://">
            <input className="pro-input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" inputMode="url" />
          </Field>
        )}
        {kind === 'text' && (
          <Field label="Content" hint="Plain text. Line breaks are kept.">
            <textarea className="pro-input" style={{minHeight: 220}} value={body} onChange={(e) => setBody(e.target.value)} maxLength={60000} />
          </Field>
        )}
        <Field label="Short description (optional)">
          <textarea className="pro-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        <VisibilityPicker value={visibility} groupId={groupId} groups={groups} onChange={(v, g) => (setVisibility(v), setGroupId(g))} />
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------- quizzes */
export function StudioQuizzes({groups}: {groups: TGroup[]}) {
  const {toast} = useSession();
  const [items, setItems] = useState<TQuiz[] | null>(null);
  const [filter, setFilter] = useState<'active' | 'draft' | 'published' | 'archived'>('active');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [results, setResults] = useState<number | null>(null);
  const [sharing, setSharing] = useState<TQuiz | null>(null);
  const load = useCallback(() => {
    teachers.quizzes().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);
  const shown = (items ?? []).filter((q) => (filter === 'active' ? q.status === 'draft' || q.status === 'published' : q.status === filter));
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast('success', done);
      load();
    } catch (e) {
      toast('error', 'Action failed', errText(e));
    }
  };
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Seg
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
          label="Status"
          size="sm"
          options={[
            {value: 'active', label: 'Active'},
            {value: 'draft', label: 'Drafts'},
            {value: 'published', label: 'Published'},
            {value: 'archived', label: 'Archived'},
          ]}
        />
        <button type="button" className="pro-btn pro-btn-primary" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> New quiz
        </button>
      </div>
      {items === null && <LoadingRows rows={4} />}
      {items && shown.length === 0 && (
        <Empty
          icon={<ListChecks className="size-6" />}
          hue="green"
          title="No quizzes here"
          body="Build a quiz from scratch or pull questions from the Genesis question bank. Students' scores show up in your Students tab."
          action={
            <button type="button" className="pro-btn pro-btn-sm" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Build a quiz
            </button>
          }
        />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((q) => (
          <article key={q.id} className="pro-card t-card">
            <div className="flex items-start gap-3">
              <span className="t-attach-icon" style={{['--mark' as string]: 'var(--pro-h-green)'}}>
                <ListChecks />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="pro-h3 truncate">{q.title}</h3>
                <p className="pro-meta truncate">
                  {q.question_count} questions · {q.time_limit_minutes ? `${q.time_limit_minutes} min` : 'untimed'} · pass {q.pass_mark}%
                </p>
              </div>
              <StatusPill status={q.status} />
            </div>
            <div className="t-stat-line">
              <VisibilityBadge visibility={q.visibility} group={q.group?.name} />
              <span>{q.stats?.attempts ?? 0} attempts</span>
              {q.stats?.average != null && <span>avg {Math.round(q.stats.average)}%</span>}
              {q.stats?.pass_rate != null && <span>{Math.round(q.stats.pass_rate)}% pass</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {q.status !== 'archived' && (
                <button type="button" className="pro-btn pro-btn-sm" onClick={() => setEditing(q.id)}>
                  <Pencil className="size-4" /> Edit
                </button>
              )}
              {q.status === 'draft' && (
                <button type="button" className="pro-btn pro-btn-primary pro-btn-sm" onClick={() => void act(() => teachers.publishQuiz(q.id), 'Quiz published')} disabled={!q.question_count}>
                  <Rocket className="size-4" /> Publish
                </button>
              )}
              {q.status === 'published' && (
                <>
                  <button type="button" className="pro-btn pro-btn-sm" onClick={() => setResults(q.id)}>
                    <BarChart3 className="size-4" /> Results
                  </button>
                  <button type="button" className="pro-btn pro-btn-sm" onClick={() => setSharing(q)}>
                    <Send className="size-4" /> Share
                  </button>
                </>
              )}
              <span className="ml-auto flex gap-1">
                {q.status === 'archived' ? (
                  <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm" onClick={() => void act(() => teachers.unarchiveQuiz(q.id), 'Restored as draft')} aria-label="Restore" title="Restore">
                    <ArchiveRestore className="size-4" />
                  </button>
                ) : (
                  q.status === 'published' && (
                    <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm" onClick={() => void act(() => teachers.archiveQuiz(q.id), 'Quiz archived')} aria-label="Archive" title="Archive">
                      <Archive className="size-4" />
                    </button>
                  )
                )}
                <button
                  type="button"
                  className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm"
                  aria-label="Delete"
                  title="Delete"
                  onClick={async () => {
                    if ((await askConfirm(`Delete “${q.title}”? Quizzes with attempts are archived instead.`))) void act(() => teachers.deleteQuiz(q.id), 'Quiz removed');
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </span>
            </div>
          </article>
        ))}
      </div>
      <QuizBuilder
        quizId={editing}
        groups={groups}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
      <QuizResults quizId={results} onClose={() => setResults(null)} />
      <ShareToStudents open={!!sharing} onClose={() => setSharing(null)} title={sharing?.title ?? ''} onShare={async (ids) => (await teachers.shareQuiz(sharing!.id, ids)).shared} />
    </div>
  );
}

const LETTERS = 'ABCDEF';
/** MCQ answers are stored as a letter (A–F) — drop blank options and re-letter the answer. */
function compactMcq(q: TQuestion): TQuestion {
  if (q.kind !== 'mcq') return q;
  const correct = LETTERS.indexOf(q.answer.toUpperCase());
  const kept: string[] = [];
  let answer = '';
  q.options.forEach((o, i) => {
    if (!o.trim()) return;
    if (i === correct) answer = LETTERS[kept.length]!;
    kept.push(o);
  });
  return {...q, options: kept, answer};
}

const KIND_LABEL: Record<QKind, string> = {mcq: 'Multiple choice', tf: 'True / False', short: 'Short answer', numeric: 'Numerical'};
const blankQuestion = (kind: QKind): TQuestion => ({
  kind,
  prompt: '',
  options: kind === 'mcq' ? ['', '', '', ''] : kind === 'tf' ? ['True', 'False'] : [],
  answer: kind === 'tf' ? 'True' : '',
  tolerance: 0,
  explanation: '',
  marks: 1,
  difficulty: 'medium',
});

function questionProblem(q: TQuestion): string | null {
  if (q.prompt.trim().length < 3) return 'Add the question text';
  if (q.kind === 'mcq') {
    const filled = q.options.filter((o) => o.trim());
    if (filled.length < 2) return 'Add at least two options';
    const correct = LETTERS.indexOf(q.answer.toUpperCase());
    if (correct < 0 || !q.options[correct]?.trim()) return 'Mark the correct option';
  }
  if (q.kind === 'short' && !q.answer.trim()) return 'Add the accepted answer';
  if (q.kind === 'numeric' && (q.answer.trim() === '' || Number.isNaN(Number(q.answer)))) return 'Add a numerical answer';
  return null;
}

function QuizBuilder({quizId, groups, onClose, onSaved}: {quizId: number | 'new' | null; groups: TGroup[]; onClose: () => void; onSaved: () => void}) {
  const {toast} = useSession();
  const open = quizId !== null;
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [minutes, setMinutes] = useState(15);
  const [passMark, setPassMark] = useState(50);
  const [visibility, setVisibility] = useState<Visibility>('students');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [status, setStatus] = useState<TQuiz['status']>('draft');
  const [questions, setQuestions] = useState<TQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [bank, setBank] = useState(false);

  useEffect(() => {
    if (!open) return;
    const fill = (q: TQuiz | null) => {
      setTitle(q?.title ?? '');
      setDescription(q?.description ?? '');
      setSubject(q?.subject ?? '');
      setTopic(q?.topic ?? '');
      setMinutes(q?.time_limit_minutes ?? 15);
      setPassMark(q?.pass_mark ?? 50);
      setVisibility(q?.visibility ?? 'students');
      setGroupId(q?.group?.id ?? null);
      setStatus(q?.status ?? 'draft');
      setQuestions(q?.questions ?? [blankQuestion('mcq')]);
    };
    if (quizId === 'new') fill(null);
    else {
      setLoading(true);
      teachers
        .studioQuiz(quizId as number)
        .then(fill)
        .catch((e) => toast('error', 'Could not open quiz', errText(e)))
        .finally(() => setLoading(false));
    }
  }, [open, quizId, toast]);

  const update = (index: number, patch: Partial<TQuestion>) => setQuestions((qs) => qs.map((q, i) => (i === index ? {...q, ...patch} : q)));
  const problems = questions.map(questionProblem);
  const firstProblem = problems.findIndex(Boolean);
  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);

  const save = async (publish: boolean) => {
    if (title.trim().length < 2) return toast('error', 'Add a quiz title');
    if (firstProblem >= 0) return toast('error', `Question ${firstProblem + 1}`, problems[firstProblem]!);
    setBusy(true);
    const payload = {
      title,
      description,
      subject,
      topic,
      time_limit_minutes: minutes,
      pass_mark: passMark,
      visibility,
      group_id: visibility === 'group' ? groupId : null,
      questions: questions.map(compactMcq),
    };
    try {
      const saved = quizId === 'new' ? await teachers.createQuiz(payload) : await teachers.updateQuiz(quizId as number, payload);
      if (publish && saved.status === 'draft') await teachers.publishQuiz(saved.id);
      toast('success', publish ? 'Quiz published' : 'Quiz saved');
      onSaved();
    } catch (e) {
      toast('error', 'Could not save', errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="xl"
      icon={<ListChecks />}
      title={quizId === 'new' ? 'New quiz' : 'Edit quiz'}
      subtitle={`${questions.length} question${questions.length === 1 ? '' : 's'} · ${totalMarks} mark${totalMarks === 1 ? '' : 's'}`}
      footer={
        <>
          <button type="button" className="pro-btn" onClick={() => void save(false)} disabled={busy || loading}>
            {status === 'published' ? 'Save changes' : 'Save draft'}
          </button>
          {status === 'draft' && (
            <button type="button" className="pro-btn pro-btn-primary" onClick={() => void save(true)} disabled={busy || loading || !questions.length}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />} Publish
            </button>
          )}
        </>
      }
    >
      {loading ? (
        <LoadingRows rows={5} />
      ) : (
        <div className="grid min-w-0 gap-5">
          <section className="grid gap-3">
            <Field label="Title">
              <input className="pro-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Differentiation — rules check" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Subject">
                <input className="pro-input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={80} />
              </Field>
              <Field label="Topic">
                <input className="pro-input" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Time limit (minutes)" hint="0 = untimed">
                <input className="pro-input" type="number" min={0} max={300} value={minutes} onChange={(e) => setMinutes(Math.max(0, Math.min(300, Number(e.target.value) || 0)))} />
              </Field>
              <Field label="Pass mark (%)">
                <input className="pro-input" type="number" min={0} max={100} value={passMark} onChange={(e) => setPassMark(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
              </Field>
            </div>
            <Field label="Instructions (optional)">
              <textarea className="pro-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
            </Field>
            <VisibilityPicker value={visibility} groupId={groupId} groups={groups} onChange={(v, g) => (setVisibility(v), setGroupId(g))} />
          </section>

          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="pro-h3">Questions</h3>
              <button type="button" className="pro-btn pro-btn-sm" onClick={() => setBank(true)}>
                <Database className="size-4" /> From question bank
              </button>
            </div>
            {questions.map((q, i) => (
              <QuestionEditor
                key={i}
                index={i}
                q={q}
                problem={problems[i]}
                onChange={(patch) => update(i, patch)}
                onRemove={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                onDuplicate={() => setQuestions((qs) => [...qs.slice(0, i + 1), {...q, id: undefined}, ...qs.slice(i + 1)])}
                onMove={(dir) =>
                  setQuestions((qs) => {
                    const j = i + dir;
                    if (j < 0 || j >= qs.length) return qs;
                    const next = [...qs];
                    [next[i], next[j]] = [next[j]!, next[i]!];
                    return next;
                  })
                }
              />
            ))}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(KIND_LABEL) as QKind[]).map((kind) => (
                <button key={kind} type="button" className="pro-btn pro-btn-sm" onClick={() => setQuestions((qs) => [...qs, blankQuestion(kind)])}>
                  <Plus className="size-4" /> {KIND_LABEL[kind]}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      <BankImport
        open={bank}
        onClose={() => setBank(false)}
        onAdd={(picked) => {
          setQuestions((qs) => [...qs.filter((q) => q.prompt.trim()), ...picked]);
          setBank(false);
        }}
      />
    </Sheet>
  );
}

function QuestionEditor({index, q, problem, onChange, onRemove, onDuplicate, onMove}: {index: number; q: TQuestion; problem: string | null; onChange: (patch: Partial<TQuestion>) => void; onRemove: () => void; onDuplicate: () => void; onMove: (dir: -1 | 1) => void}) {
  const setKind = (kind: QKind) => {
    const blank = blankQuestion(kind);
    onChange({kind, options: blank.options, answer: blank.answer});
  };
  return (
    <div className="pro-card grid min-w-0 gap-3 p-3 md:p-4" style={{borderColor: problem && q.prompt ? 'color-mix(in srgb, var(--pro-warning) 45%, var(--pro-border))' : undefined}}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pro-badge" data-tone="accent">
          Q{index + 1}
        </span>
        <Select className="pro-input !h-9 !w-auto !py-0 text-[0.82rem]" value={q.kind} onChange={(e) => setKind(e.target.value as QKind)} aria-label="Question type">
          {(Object.keys(KIND_LABEL) as QKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        {q.source_question_id && (
          <span className="pro-badge" data-tone="info">
            Bank
          </span>
        )}
        <span className="ml-auto flex gap-0.5">
          <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm" onClick={() => onMove(-1)} aria-label="Move up" title="Move up">
            ↑
          </button>
          <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm" onClick={() => onMove(1)} aria-label="Move down" title="Move down">
            ↓
          </button>
          <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm" onClick={onDuplicate} aria-label="Duplicate" title="Duplicate">
            <Copy className="size-4" />
          </button>
          <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm" onClick={onRemove} aria-label="Delete question" title="Delete question">
            <Trash2 className="size-4" />
          </button>
        </span>
      </div>
      <textarea className="pro-input" value={q.prompt} onChange={(e) => onChange({prompt: e.target.value})} placeholder="Question" maxLength={4000} aria-label={`Question ${index + 1}`} />
      {q.kind === 'mcq' && (
        <div className="grid gap-2">
          {q.options.map((opt, oi) => {
            const correct = q.answer.toUpperCase() === LETTERS[oi];
            return (
              <div key={oi} className="flex items-center gap-2">
                <button
                  type="button"
                  className="grid size-8 shrink-0 place-items-center rounded-full border text-[0.75rem] font-bold"
                  style={{borderColor: correct ? 'var(--pro-success)' : 'var(--pro-border-strong)', background: correct ? 'var(--pro-success)' : 'transparent', color: correct ? '#fff' : 'var(--pro-muted)'}}
                  onClick={() => onChange({answer: LETTERS[oi]!})}
                  aria-label={`Mark option ${String.fromCharCode(65 + oi)} correct`}
                  title="Mark as correct"
                >
                  {correct ? <CheckCircle2 className="size-4" /> : String.fromCharCode(65 + oi)}
                </button>
                <input
                  className="pro-input min-w-0 flex-1"
                  value={opt}
                  maxLength={400}
                  placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                  onChange={(e) => onChange({options: q.options.map((o, j) => (j === oi ? e.target.value : o))})}
                />
                {q.options.length > 2 && (
                  <button type="button" className="pro-btn pro-btn-ghost pro-btn-icon pro-btn-sm" onClick={() => {
                      const idx = LETTERS.indexOf(q.answer.toUpperCase());
                      onChange({options: q.options.filter((_, j) => j !== oi), answer: idx === oi ? '' : idx > oi ? LETTERS[idx - 1]! : q.answer});
                    }} aria-label="Remove option" title="Remove option">
                    <X className="size-4" />
                  </button>
                )}
              </div>
            );
          })}
          {q.options.length < 6 && (
            <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm justify-self-start" onClick={() => onChange({options: [...q.options, '']})}>
              <Plus className="size-4" /> Option
            </button>
          )}
        </div>
      )}
      {q.kind === 'tf' && <Seg value={q.answer.toLowerCase() === 'false' ? 'False' : 'True'} onChange={(v) => onChange({answer: v})} label="Correct answer" fill options={[{value: 'True', label: 'True'}, {value: 'False', label: 'False'}]} />}
      {q.kind === 'short' && (
        <Field label="Accepted answers" hint="Separate alternatives with | — matching ignores case and extra spaces.">
          <input className="pro-input" value={q.answer} onChange={(e) => onChange({answer: e.target.value})} maxLength={400} placeholder="e.g. mitochondria | mitochondrion" />
        </Field>
      )}
      {q.kind === 'numeric' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Answer">
            <input className="pro-input" inputMode="decimal" value={q.answer} onChange={(e) => onChange({answer: e.target.value})} placeholder="e.g. 9.81" />
          </Field>
          <Field label="Tolerance (±)">
            <input className="pro-input" type="number" min={0} step="any" value={q.tolerance} onChange={(e) => onChange({tolerance: Math.max(0, Number(e.target.value) || 0)})} />
          </Field>
        </div>
      )}
      <details className="group">
        <summary className="pro-meta cursor-pointer select-none font-semibold">Explanation, marks & difficulty</summary>
        <div className="mt-3 grid gap-3">
          <textarea className="pro-input" value={q.explanation} onChange={(e) => onChange({explanation: e.target.value})} placeholder="Explanation shown after submitting (optional)" maxLength={4000} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marks">
              <input className="pro-input" type="number" min={1} max={20} value={q.marks} onChange={(e) => onChange({marks: Math.max(1, Math.min(20, Number(e.target.value) || 1))})} />
            </Field>
            <Field label="Difficulty">
              <Select className="pro-input" value={q.difficulty} onChange={(e) => onChange({difficulty: e.target.value as TQuestion['difficulty']})}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </Field>
          </div>
        </div>
      </details>
      {problem && q.prompt && <p className="pro-meta" style={{color: 'var(--pro-warning)'}}>{problem}</p>}
    </div>
  );
}

function BankImport({open, onClose, onAdd}: {open: boolean; onClose: () => void; onAdd: (questions: TQuestion[]) => void}) {
  const {toast} = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(10);
  const [preview, setPreview] = useState<TQuestion[] | null>(null);
  const [available, setAvailable] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    api
      .courses()
      .then((list) => {
        setCourses(list);
        setCourseId((c) => c ?? list[0]?.id ?? null);
      })
      .catch(() => {});
  }, [open]);
  const load = async () => {
    if (!courseId) return;
    setBusy(true);
    try {
      const res = await teachers.bankPreview(courseId, topic.trim(), count);
      setPreview(res.items);
      setAvailable(res.available);
      setPicked(new Set(res.items.map((_, i) => i)));
    } catch (e) {
      toast('error', 'Could not load questions', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const chosen = useMemo(() => (preview ?? []).filter((_, i) => picked.has(i)), [preview, picked]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Database />}
      title="Add from the question bank"
      subtitle="Questions are copied into your quiz — edit them freely."
      footer={
        <button type="button" className="pro-btn pro-btn-primary" disabled={!chosen.length} onClick={() => onAdd(chosen)}>
          <Plus className="size-4" /> Add {chosen.length || ''} question{chosen.length === 1 ? '' : 's'}
        </button>
      }
    >
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_90px_auto] sm:items-end">
          <Field label="Course">
            <Select className="pro-input" value={courseId ?? ''} onChange={(e) => setCourseId(Number(e.target.value))}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Topic (optional)">
            <input className="pro-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Any" />
          </Field>
          <Field label="How many">
            <input className="pro-input" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          </Field>
          <button type="button" className="pro-btn" onClick={() => void load()} disabled={!courseId || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />} Load
          </button>
        </div>
        {preview && <p className="pro-meta">{available} matching questions in the bank · showing a random {preview.length}</p>}
        {preview?.length === 0 && <p className="pro-secondary">No questions match. Try another course or leave the topic blank.</p>}
        <div className="grid gap-2">
          {preview?.map((q, i) => {
            const on = picked.has(i);
            return (
              <button
                key={i}
                type="button"
                className="pro-card flex items-start gap-3 p-3 text-left"
                style={{borderColor: on ? 'var(--pro-accent)' : undefined}}
                aria-pressed={on}
                onClick={() =>
                  setPicked((s) => {
                    const next = new Set(s);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
              >
                <CheckCircle2 className="mt-0.5 size-5 shrink-0" style={{color: on ? 'var(--pro-accent-text)' : 'var(--pro-border-strong)'}} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.88rem] font-semibold [overflow-wrap:anywhere]">{q.prompt}</span>
                  <span className="pro-meta block [overflow-wrap:anywhere]">
                    Answer: {q.kind === 'mcq' ? `${q.answer}. ${q.options[LETTERS.indexOf(q.answer.toUpperCase())] ?? ''}` : q.answer} · {q.difficulty}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

function QuizResults({quizId, onClose}: {quizId: number | null; onClose: () => void}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof teachers.quizResults>> | null>(null);
  useEffect(() => {
    setData(null);
    if (quizId) teachers.quizResults(quizId).then(setData).catch(() => {});
  }, [quizId]);
  const s = data?.quiz.stats;
  return (
    <Sheet open={quizId !== null} onClose={onClose} size="lg" icon={<BarChart3 />} title={data?.quiz.title ?? 'Results'} subtitle="Best attempt per student counts towards averages.">
      {!data ? (
        <LoadingRows rows={4} />
      ) : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Completion', data.completion != null ? `${Math.round(data.completion)}%` : '—', `${s?.students ?? 0} of ${data.targets}`],
              ['Average', s?.average != null ? `${Math.round(s.average)}%` : '—', ''],
              ['Pass rate', s?.pass_rate != null ? `${Math.round(s.pass_rate)}%` : '—', `pass mark ${data.quiz.pass_mark}%`],
              ['Attempts', String(s?.attempts ?? 0), ''],
            ].map(([label, value, sub]) => (
              <div key={label} className="t-kpi">
                <span className="pro-eyebrow">{label}</span>
                <b>{value}</b>
                {sub && <span className="pro-meta">{sub}</span>}
              </div>
            ))}
          </div>
          {data.questions.length > 0 && (
            <section className="grid gap-2">
              <h3 className="pro-h3">Question difficulty</h3>
              <p className="pro-meta">Share of students who got each question right — low numbers show what to re-teach.</p>
              {data.questions.map((q, i) => (
                <div key={q.id} className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-3">
                  <span className="truncate text-[0.85rem]">
                    <b>Q{i + 1}.</b> {q.prompt}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{background: 'var(--pro-hover)'}}>
                      <span className="block h-full rounded-full" style={{width: `${q.correct_rate ?? 0}%`, background: (q.correct_rate ?? 0) < 50 ? 'var(--pro-warning)' : 'var(--pro-success)'}} />
                    </span>
                    <span className="pro-meta w-9 text-right">{q.correct_rate != null ? `${Math.round(q.correct_rate)}%` : '—'}</span>
                  </span>
                </div>
              ))}
            </section>
          )}
          <section className="grid gap-2">
            <h3 className="pro-h3">Attempts</h3>
            {data.attempts.length === 0 && <p className="pro-secondary">No attempts yet.</p>}
            {data.attempts.map((a) => (
              <div key={a.id} className="flex items-center gap-3">
                <PersonAvatar id={a.student.id} name={a.student.name} hue={a.student.avatar_hue} hasPhoto={a.student.has_photo} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.student.name}</span>
                  <span className="pro-meta">{timeAgo(a.submitted_at)}</span>
                </span>
                <span className="pro-badge" data-tone={a.passed ? 'success' : 'warning'}>
                  {Math.round(a.percentage)}%
                </span>
              </div>
            ))}
          </section>
        </div>
      )}
    </Sheet>
  );
}

