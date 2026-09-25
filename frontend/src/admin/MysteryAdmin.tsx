/**
 * Mystery desk — staff tooling for the learning-game cases.
 *
 * A case = a hook (blurb), a brief, study clues (optionally costing coins and
 * linking Materials), a server-drawn question run from a course/topic pool,
 * and the solution paragraphs that correct deductions unlock. Everything here
 * is validated again on the server; this form just makes it pleasant to write.
 */
import {ChevronDown, ChevronRight, Eye, Moon, Package, Pencil, Plus, Trash2} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, Field, Modal, SectionHeading, Select, Skeleton, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {useSession} from '../store/session';


interface CaseRow {
  id: number;
  title: string;
  status: string;
  topic: string;
  course_id: number | null;
  difficulty: string;
  question_count: number;
  pass_count: number;
  reward_xp: number;
  reward_coins: number;
  blurb: string;
  brief: string;
  story: string[];
  clues: {id: number; position: number; text: string; material_id: number | null; cost_coins: number}[];
  solves: number;
  solved: number;
  pool: number;
}

const emptyCase = {
  title: '',
  blurb: '',
  brief: '',
  topic: '',
  difficulty: 'medium',
  question_count: 5,
  pass_count: 3,
  reward_xp: 40,
  reward_coins: 15,
  status: 'draft',
  course_id: '' as number | '' | null,
};

export default function MysteryAdmin() {
  const {toast} = useSession();
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [courses, setCourses] = useState<{id: number; code: string; title: string}[]>([]);
  const [courseFilter, setCourseFilter] = useState<number | ''>('');
  const [editing, setEditing] = useState<(typeof emptyCase & {id?: number; storyText?: string; clues?: ClueDraft[]}) | null>(null);
  const limit = 10;

  const load = useCallback(() => {
    api.admin
      .mysteryList({limit, offset})
      .then((data) => {
        const payload = data as unknown as {cases: CaseRow[]; total: number};
        setRows(payload.cases);
        setTotal(payload.total);
      })
      .catch(() => setRows([]));
  }, [offset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
    api.admin.courses().then(setCourses).catch(() => setCourses([]));
  }, [load]);

  const remove = async (row: CaseRow) => {
    if (!window.confirm(`Delete “${row.title}” and every solve attached to it?`)) return;
    try {
      await api.admin.mysteryDelete(row.id);
      toast('info', 'Case deleted');
      load();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  const publish = async (row: CaseRow, next: string) => {
    try {
      await api.admin.mysteryUpdate(row.id, {status: next});
      toast('success', next === 'published' ? 'Case published' : 'Moved to ' + next);
      load();
    } catch (error) {
      toast('error', 'Status refused', (error as Error).message);
    }
  };

  const visible = courseFilter === '' ? rows ?? [] : (rows ?? []).filter((row) => row.course_id === courseFilter);

  return (
    <div className="space-y-3">
      <SectionHeading
        icon={<Package className="size-4" />}
        title="Mystery desk"
        subtitle={rows ? `${formatNumber(total)} cases · solved rates come straight from the arena` : 'Loading…'}
        action={
          <Button size="sm" variant="mint" onClick={() => setEditing({...emptyCase})} icon={<Plus className="size-4" />}>
            New case
          </Button>
        }
      />
      <div className="flex items-center gap-2">
        <Select className="max-w-56" value={String(courseFilter)} onChange={(event) => setCourseFilter(event.target.value ? Number(event.target.value) : '')}>
          <option value="">All courses</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>{course.code}</option>
          ))}
        </Select>
      </div>

      {!rows ? (
        <Skeleton className="h-40 rounded-3xl" />
      ) : rows.length === 0 ? (
        <Card className="p-6 text-center text-[0.84rem] font-bold text-mist-500">No cases yet — write the first one: a hook, a brief, some clues, and pick the course pool to draw from.</Card>
      ) : (
        <ul className="grid gap-2">
          {visible.map((row) => (
            <li key={row.id}>
              <Card className="flex flex-wrap items-center gap-3 p-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/6 text-[1.1rem]">🕵️</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9rem] font-black text-mist-50">{row.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-[0.72rem] font-semibold text-mist-400">{row.blurb}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Chip className={row.status === 'published' ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300' : 'border-white/12 bg-white/6 text-mist-400'}>{row.status}</Chip>
                    {row.topic && <Chip className="border-nova-400/30 bg-nova-500/10 text-nova-200">{row.topic}</Chip>}
                    <Chip>{row.clues.length} clues</Chip>
                    <Chip>{row.pass_count}/{row.question_count} q</Chip>
                    <Chip className={row.pool === 0 ? 'border-flare-400/40 bg-flare-500/12 text-flare-300' : ''}>{row.pool} in pool</Chip>
                    <Chip>{row.solved}/{row.solves} solve rate</Chip>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setEditing({...row, storyText: (row.story ?? []).join('\n'), clues: row.clues})} icon={<Pencil className="size-3.5" />}>
                    Edit
                  </Button>
                  {row.status !== 'published' ? (
                    <Button size="sm" variant="mint" onClick={() => void publish(row, 'published')} icon={<Eye className="size-3.5" />}>
                      Publish
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void publish(row, 'archived')}>
                      Archive
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void remove(row)} icon={<Trash2 className="size-3.5 text-flare-400" />} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {rows && total > limit && (
        <div className="flex items-center justify-between">
          <span className="text-[0.72rem] font-black text-mist-500">
            {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
            <Button size="sm" variant="ghost" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</Button>
          </div>
        </div>
      )}

      {editing && (
        <CaseEditor
          initial={editing}
          courses={courses}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          toast={toast}
        />
      )}
    </div>
  );
}

interface ClueDraft {
  text: string;
  material_id: number | null | string;
  cost_coins: number;
}

function CaseEditor({
  initial,
  courses,
  onClose,
  onSaved,
  toast,
}: {
  initial: typeof emptyCase & {id?: number; storyText?: string; clues?: ClueDraft[]};
  courses: {id: number; code: string; title: string}[];
  onClose: () => void;
  onSaved: () => void;
  toast: (kind: 'info' | 'success' | 'error', title: string, detail?: string) => void;
}) {
  const [form, setForm] = useState({...emptyCase, ...initial, course_id: initial.course_id === null || initial.course_id === undefined ? ('' as number | '') : (initial.course_id as number)});
  const [storyText, setStoryText] = useState(initial.storyText ?? '');
  const [clues, setClues] = useState<ClueDraft[]>(initial.clues?.length ? initial.clues : [{text: '', material_id: '', cost_coins: 0}]);
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(initial.id));
  // Raw typing for the question-count field so it never snaps back mid-edit.
  const [countDraft, setCountDraft] = useState<string | null>(null);

  const submit = async () => {
    if (form.title.trim().length < 4) {
      toast('info', 'Needs a real title', 'Four characters at least.');
      return;
    }
    if (form.question_count < 3 || form.question_count > 20) {
      toast('info', 'Questions: 3 to 20', `You typed ${form.question_count} — clear the box and enter a fresh count.`);
      return;
    }
    setBusy(true);
    const body = {
      title: form.title.trim(),
      blurb: form.blurb,
      brief: form.brief,
      topic: form.topic,
      course_id: form.course_id || null,
      difficulty: form.difficulty,
      question_count: form.question_count,
      pass_count: form.pass_count,
      reward_xp: form.reward_xp,
      reward_coins: form.reward_coins,
      status: form.status,
      story: storyText.split('\n').map((line) => line.trim()).filter(Boolean),
      clues: clues.filter((row) => row.text.trim()).map((row) => ({text: row.text, material_id: row.material_id === '' ? null : Number(row.material_id), cost_coins: row.cost_coins})),
    };
    try {
      if (initial.id) await api.admin.mysteryUpdate(initial.id, body);
      else await api.admin.mysteryCreate(body);
      toast('success', initial.id ? 'Case saved' : 'Case drafted', 'Publish it when the clues read well.');
      onSaved();
    } catch (error) {
      toast('error', 'Server rejected the case', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const num = (value: string) => Math.max(0, Number(value) || 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={initial.id ? 'Edit mystery case' : 'New mystery case'}
      subtitle="Players: study clues → answer drawn questions → every correct deduction unlocks the next piece of the solution."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={() => void submit()} icon={<Moon className="size-4" />}>
            {initial.id ? 'Save case' : 'Draft case'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">
          <TextInput value={form.title} maxLength={160} onChange={(event) => setForm({...form, title: event.target.value})} placeholder="The Case of the Missing Precedent" />
        </Field>
        <Field label="Hook (card blurb)" className="sm:col-span-2">
          <TextInput value={form.blurb} maxLength={600} onChange={(event) => setForm({...form, blurb: event.target.value})} placeholder="One sentence that makes a player want in." />
        </Field>
        <Field label="Course pool">
          <Select value={String(form.course_id ?? '')} onChange={(event) => setForm({...form, course_id: event.target.value ? Number(event.target.value) : ''})}>
            <option value="">All approved questions</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>{course.code} — {course.title}</option>
            ))}
          </Select>
        </Field>
        <Field label="Topic filter (optional)" hint="Leave blank to draw from the whole course.">
          <TextInput value={form.topic} maxLength={120} onChange={(event) => setForm({...form, topic: event.target.value})} placeholder="e.g. Fundamental Rights" />
        </Field>
        <Field label="Difficulty">
          <Select value={form.difficulty} onChange={(event) => setForm({...form, difficulty: event.target.value})}>
            {['easy', 'medium', 'hard'].map((row) => <option key={row} value={row}>{row}</option>)}
          </Select>
        </Field>
        <Field label="Questions per attempt">
          <TextInput
            type="number"
            value={countDraft ?? String(form.question_count)}
            onChange={(event) => {
              // Free typing — validated on save, never snapped while the admin edits.
              const raw = event.target.value.trim();
              setCountDraft(event.target.value);
              const n = raw === '' ? 0 : Math.floor(Number(raw));
              setForm({...form, question_count: Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : 0});
            }}
            onBlur={() => setCountDraft(null)}
          />
        </Field>
        <Field label="Needed to solve">
          <TextInput type="number" min={1} max={20} value={form.pass_count} onChange={(event) => setForm({...form, pass_count: Math.max(1, num(event.target.value) || 1)})} />
        </Field>
        <Field label="Rewards" hint="XP + coins paid once on solve.">
          <div className="flex items-center gap-2">
            <TextInput type="number" min={0} value={form.reward_xp} onChange={(event) => setForm({...form, reward_xp: num(event.target.value)})} />
            <span className="text-[0.7rem] font-black text-mist-500">xp /</span>
            <TextInput type="number" min={0} value={form.reward_coins} onChange={(event) => setForm({...form, reward_coins: num(event.target.value)})} />
            <span className="text-[0.7rem] font-black text-mist-500">coins</span>
          </div>
        </Field>
        <Field label="The brief (case file)" className="sm:col-span-2" hint="Shown when the file is opened.">
          <TextArea rows={3} value={form.brief} maxLength={4000} onChange={(event) => setForm({...form, brief: event.target.value})} />
        </Field>
        <Field label="Solution paragraphs" className="sm:col-span-2" hint="One per line — each correct deduction unlocks the next; all show once solved.">
          <TextArea rows={3} value={storyText} onChange={(event) => setStoryText(event.target.value)} />
        </Field>

        <div className="sm:col-span-2">
          <button type="button" onClick={() => setShowAdvanced((value) => !value)} className="flex items-center gap-1 text-[0.74rem] font-black tracking-wide text-nova-300 uppercase">
            {showAdvanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} Clues ({clues.length})
          </button>
          {showAdvanced && (
            <ul className="mt-2 grid gap-2">
              {clues.map((clue, index) => (
                <li key={index} className="grid gap-2 rounded-2xl border border-white/8 bg-white/4 p-2.5 sm:grid-cols-[1fr_9rem_6rem_auto]">
                  <TextArea rows={2} placeholder={`Clue ${index + 1} — point them at the concept…`} value={clue.text} onChange={(event) => setClues((current) => current.map((row, i) => (i === index ? {...row, text: event.target.value} : row)))} />
                  <TextInput className="self-start" placeholder="Material id" value={String(clue.material_id ?? '')} onChange={(event) => setClues((current) => current.map((row, i) => (i === index ? {...row, material_id: event.target.value === '' ? '' : num(event.target.value)} : row)))} />
                  <TextInput className="self-start" type="number" min={0} max={500} placeholder="cost" value={clue.cost_coins} onChange={(event) => setClues((current) => current.map((row, i) => (i === index ? {...row, cost_coins: Math.min(500, num(event.target.value))} : row)))} />
                  <div className="flex flex-row gap-1.5 sm:flex-col sm:self-start">
                    <Button size="sm" variant="ghost" onClick={() => setClues((current) => current.filter((_, i) => i !== index))} icon={<Trash2 className="size-3.5 text-flare-400" />} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {showAdvanced && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setClues((current) => [...current, {text: '', material_id: '', cost_coins: 0}])} icon={<Plus className="size-3.5" />}>
              Add clue
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
