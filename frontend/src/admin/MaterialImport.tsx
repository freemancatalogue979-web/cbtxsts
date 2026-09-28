/**
 * Import materials from documents instead of typing them.
 *
 * Pick (or drop) one or more files — Word, PDF, text, Markdown, OpenDocument,
 * RTF, HTML or PowerPoint. The server reads each one into sections; staff only
 * choose the basics: course, name, topic and whether it goes live. The content
 * is the document itself. Nothing is saved until "Import" is pressed.
 *
 * Each file is uploaded ONCE (with a progress bar) and read on the server in
 * the background; the dialog polls with short requests, so big documents never
 * run into a proxy's request timeout.
 */
import {CheckCircle2, FileText, FileUp, Loader2, TriangleAlert, X, UploadIcon} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {Button, Field, Modal, Select, TextInput, SwitchRow} from '../components/ui';
import {api, type ImportJob} from '../lib/api';
import {formatNumber} from '../lib/format';
import {useSession} from '../store/session';
import type {Course, MaterialImportPreview} from '../lib/types';

export const IMPORT_ACCEPT = '.docx,.pdf,.txt,.md,.markdown,.odt,.rtf,.html,.htm,.pptx';
const ACCEPTED = new Set(IMPORT_ACCEPT.split(','));
const MAX_MB = 20;
const POLL_MS = 1200;
const PARALLEL_UPLOADS = 2;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Row = {
  key: string;
  file: File;
  state: 'uploading' | 'reading' | 'ready' | 'error' | 'importing' | 'done';
  error?: string;
  jobId?: string;
  progress?: number;
  preview?: MaterialImportPreview;
  title: string;
};

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function precheck(file: File): string | null {
  const ext = extension(file.name);
  if (ext === '.doc') return 'Old .doc file — in Word use Save As → .docx (or PDF), then upload that.';
  if (ext === '.ppt') return 'Old .ppt file — save it as .pptx or PDF first.';
  if (!ACCEPTED.has(ext)) return 'Unsupported file type.';
  if (file.size > MAX_MB * 1024 * 1024) return `Larger than ${MAX_MB} MB.`;
  if (file.size === 0) return 'The file is empty.';
  return null;
}

export default function MaterialImport({
  open,
  onClose,
  onImported,
  course = null,
  kind = 'material',
  topics = [],
  parentId,
  parentTitle = '',
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  /** Fixed course (inside a course workspace). Otherwise staff pick one. */
  course?: Course | null;
  kind?: 'material' | 'note';
  topics?: string[];
  /** Import as notes inside this material. */
  parentId?: number;
  parentTitle?: string;
}) {
  const {toast} = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<number | ''>(course?.id ?? '');
  const [topic, setTopic] = useState('');
  const [publish, setPublish] = useState(true);
  const [keepFile, setKeepFile] = useState(true);
  const [fixSpelling, setFixSpelling] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const noun = kind === 'note' ? 'note' : 'material';
  const queue = useRef<Row[]>([]);
  const active = useRef(0);
  const alive = useRef(true);
  const removed = useRef(new Set<string>());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    queue.current = [];
    removed.current = new Set();
    setTopic('');
    setCourseId(course?.id ?? '');
    if (!course) {
      api.admin
        .courses()
        .then(setCourses)
        .catch(() => setCourses([]));
    }
  }, [open, course]);

  const patch = (key: string, next: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? {...row, ...next} : row)));

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list).map((file, index): Row => {
      const problem = precheck(file);
      return {
        key: `${file.name}-${file.size}-${Date.now()}-${index}`,
        file,
        state: problem ? 'error' : 'uploading',
        error: problem ?? undefined,
        title: '',
        progress: 0,
      };
    });
    setRows((current) => [...current, ...incoming]);
    queue.current.push(...incoming.filter((row) => row.state === 'uploading'));
    for (let i = active.current; i < PARALLEL_UPLOADS; i += 1) void pump();
  };

  /** Poll a job until it leaves `waitingState` (short GETs — no long requests). */
  const follow = async (key: string, jobId: string, waitingState: 'reading' | 'importing'): Promise<ImportJob | null> => {
    let misses = 0;
    while (alive.current) {
      await sleep(POLL_MS);
      if (!alive.current || removed.current.has(key)) return null;
      try {
        const job = await api.materials.importStatus(jobId);
        misses = 0;
        if (job.state !== waitingState) return job;
      } catch (error) {
        const status = (error as {status?: number}).status;
        if (status === 404) return {id: jobId, state: 'error', filename: '', size: 0, error: (error as Error).message};
        if ((misses += 1) >= 8) return {id: jobId, state: 'error', filename: '', size: 0, error: 'Lost contact with the server. Check your connection and add the file again.'};
      }
    }
    return null;
  };

  const pump = async () => {
    const row = queue.current.shift();
    if (!row) return;
    active.current += 1;
    try {
      if (removed.current.has(row.key)) return;
      let job = await api.materials.importUpload(row.file, (fraction) => patch(row.key, {progress: fraction}));
      patch(row.key, {state: 'reading', jobId: job.id, progress: 1});
      if (job.state === 'reading') job = (await follow(row.key, job.id, 'reading')) ?? job;
      if (job.state === 'ready' && job.preview) patch(row.key, {state: 'ready', preview: job.preview, title: job.preview.title});
      else if (job.state === 'error') patch(row.key, {state: 'error', error: job.error ?? 'That file could not be read.'});
    } catch (error) {
      patch(row.key, {state: 'error', error: (error as Error).message});
    } finally {
      active.current -= 1;
      void pump();
    }
  };

  const ready = rows.filter((row) => row.state === 'ready');
  const reading = rows.some((row) => row.state === 'reading' || row.state === 'uploading');
  const done = rows.filter((row) => row.state === 'done').length;

  const run = async () => {
    if (!courseId) {
      toast('error', 'Choose a course', `Every ${noun} belongs to one course.`);
      return;
    }
    setBusy(true);
    let imported = 0;
    for (const row of ready) {
      patch(row.key, {state: 'importing'});
      try {
        if (!row.jobId) throw new Error('Add the file again.');
        let job = await api.materials.importCommit(row.jobId, {
          course_id: Number(courseId),
          title: row.title.trim() || row.preview?.title,
          topic: topic.trim(),
          kind,
          status: publish ? 'published' : 'draft',
          keep_file: keepFile,
          fix_spelling: fixSpelling,
          ...(parentId ? {parent_id: parentId} : {}),
        });
        if (job.state === 'importing') job = (await follow(row.key, row.jobId, 'importing')) ?? job;
        if (job.state !== 'done') {
          // "ready" again means the server refused (e.g. course problem) — keep the file so it can be retried.
          patch(row.key, job.state === 'ready' ? {state: 'ready', error: job.error ?? undefined} : {state: 'error', error: job.error ?? 'Import failed.'});
          if (job.state === 'ready') toast('error', `Couldn't import ${row.file.name}`, job.error ?? undefined);
          continue;
        }
        patch(row.key, {state: 'done', error: undefined});
        imported += 1;
      } catch (error) {
        patch(row.key, {state: 'error', error: (error as Error).message});
      }
    }
    setBusy(false);
    if (imported) {
      onImported();
      toast('success', `${imported} ${noun}${imported === 1 ? '' : 's'} imported`, publish ? 'Players can read them now.' : 'Saved as drafts.');
    }
    if (imported === ready.length) onClose();
  };

  return (
    <Modal icon={UploadIcon} tone="cyan"
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={`Import ${noun}s from files`}
      subtitle={parentId ? `Notes in “${parentTitle || 'this material'}”` : course ? `${course.code} · ${course.title}` : 'Word, PDF, text, slides — the document becomes the content.'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={run} loading={busy} disabled={!ready.length || reading || !courseId} icon={<FileUp className="size-4" />}>
            {ready.length > 1 ? `Import ${ready.length} files` : 'Import'}
          </Button>
        </>
      }
    >
      <div className="min-w-0 space-y-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
          className={`flex w-full min-w-0 flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition ${
            dragging ? 'border-nova-400 bg-nova-500/10' : 'border-white/15 bg-white/[0.02] hover:border-nova-400/60'
          }`}
        >
          <FileUp className="size-6 text-nova-300" />
          <span className="text-[0.88rem] font-extrabold text-mist-100">{rows.length ? 'Add more files' : 'Choose files or drop them here'}</span>
          <span className="text-[0.72rem] font-semibold text-mist-500">.docx · .pdf · .txt · .md · .odt · .rtf · .html · .pptx — up to {MAX_MB} MB each</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />

        {rows.length > 0 && (
          <ul className="min-w-0 space-y-1.5">
            {rows.map((row) => (
              <li key={row.key} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  {row.state === 'uploading' || row.state === 'reading' || row.state === 'importing' ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-nova-300" />
                  ) : row.state === 'done' ? (
                    <CheckCircle2 className="size-4 shrink-0 text-mint-400" />
                  ) : row.state === 'error' ? (
                    <TriangleAlert className="size-4 shrink-0 text-flare-400" />
                  ) : (
                    <FileText className="size-4 shrink-0 text-mist-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[0.74rem] font-bold text-mist-400">{row.file.name}</span>
                  {!busy && row.state !== 'done' && (
                    <button
                      type="button"
                      aria-label={`Remove ${row.file.name}`}
                      className="grid size-7 shrink-0 place-items-center rounded-lg text-mist-500 hover:bg-white/5 hover:text-mist-200"
                      onClick={() => {
                        removed.current.add(row.key);
                        queue.current = queue.current.filter((item) => item.key !== row.key);
                        setRows((current) => current.filter((item) => item.key !== row.key));
                      }}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                {row.state === 'error' && <p className="mt-1 text-[0.76rem] font-semibold text-flare-300 [overflow-wrap:anywhere]">{row.error}</p>}
                {row.state === 'uploading' && (
                  <div className="mt-1.5 flex min-w-0 items-center gap-2">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-nova-400 transition-[width] duration-300" style={{width: `${Math.round((row.progress ?? 0) * 100)}%`}} />
                    </div>
                    <span className="shrink-0 text-[0.7rem] font-bold tabular-nums text-mist-400">
                      {row.progress ? `Uploading ${Math.round(row.progress * 100)}%` : 'Waiting…'}
                    </span>
                  </div>
                )}
                {row.state === 'reading' && <p className="mt-1 text-[0.74rem] font-semibold text-mist-500">Uploaded — reading the document…</p>}
                {row.state === 'importing' && <p className="mt-1 text-[0.74rem] font-semibold text-mist-500">Creating the {noun}…</p>}
                {row.state === 'ready' && row.error && <p className="mt-1 text-[0.74rem] font-semibold text-flare-300 [overflow-wrap:anywhere]">{row.error}</p>}
                {row.preview && row.state !== 'error' && (
                  <div className="mt-1.5 min-w-0 space-y-1.5">
                    <TextInput
                      aria-label="Material name"
                      value={row.title}
                      maxLength={200}
                      disabled={row.state !== 'ready' || busy}
                      onChange={(event) => patch(row.key, {title: event.target.value})}
                      placeholder="Name of the material"
                    />
                    <p className="text-[0.7rem] font-semibold text-mist-500 [overflow-wrap:anywhere]">
                      {row.preview.format} · {formatNumber(row.preview.words)} words · {row.preview.sections.length} section
                      {row.preview.sections.length === 1 ? '' : 's'} · ~{row.preview.estimated_minutes} min
                      {row.preview.pages ? ` · ${row.preview.pages} pages` : ''}
                    </p>
                    <p className="line-clamp-2 text-[0.7rem] text-mist-500">
                      {row.preview.sections
                        .slice(0, 6)
                        .map((section) => section.title)
                        .join(' · ')}
                      {row.preview.sections.length > 6 ? ` · +${row.preview.sections.length - 6} more` : ''}
                    </p>
                    {row.preview.notes.map((note) => (
                      <p key={note} className="text-[0.68rem] font-semibold text-gold-300/90">
                        {note}
                      </p>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {!course && (
            <Field label="Course" className="sm:col-span-2">
              <Select value={courseId} onChange={(event) => setCourseId(event.target.value ? Number(event.target.value) : '')}>
                <option value="">Choose a course…</option>
                {courses.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code} — {row.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Topic (optional)" hint={rows.length > 1 ? 'Applied to every file.' : undefined}>
            <TextInput list="import-topics" value={topic} maxLength={120} onChange={(event) => setTopic(event.target.value)} placeholder="Federalism" />
            <datalist id="import-topics">
              {topics.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label="Visibility">
            <Select value={publish ? 'published' : 'draft'} onChange={(event) => setPublish(event.target.value === 'published')}>
              <option value="published">Publish now</option>
              <option value="draft">Save as draft</option>
            </Select>
          </Field>
        </div>
        <SwitchRow label="Keep the original file" description="Players can open or download it too." checked={keepFile} onChange={setKeepFile} />
        <SwitchRow label="Fix obvious spelling mistakes" description="Names, British spelling and course terms are kept." checked={fixSpelling} onChange={setFixSpelling} />
      </div>
    </Modal>
  );
}
