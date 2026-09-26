/**
 * Import materials from documents instead of typing them.
 *
 * Pick (or drop) one or more files — Word, PDF, text, Markdown, OpenDocument,
 * RTF, HTML or PowerPoint. The server reads each one into sections; staff only
 * choose the basics: course, name, topic and whether it goes live. The content
 * is the document itself. Nothing is saved until "Import" is pressed.
 */
import {CheckCircle2, FileText, FileUp, Loader2, TriangleAlert, X} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {Button, Field, Modal, Select, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatNumber} from '../lib/format';
import {useSession} from '../store/session';
import type {Course, MaterialImportPreview} from '../lib/types';

export const IMPORT_ACCEPT = '.docx,.pdf,.txt,.md,.markdown,.odt,.rtf,.html,.htm,.pptx';
const ACCEPTED = new Set(IMPORT_ACCEPT.split(','));
const MAX_MB = 20;

type Row = {
  key: string;
  file: File;
  state: 'reading' | 'ready' | 'error' | 'importing' | 'done';
  error?: string;
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
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const noun = kind === 'note' ? 'note' : 'material';

  useEffect(() => {
    if (!open) return;
    setRows([]);
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
        state: problem ? 'error' : 'reading',
        error: problem ?? undefined,
        title: '',
      };
    });
    setRows((current) => [...current, ...incoming]);
    incoming
      .filter((row) => row.state === 'reading')
      .forEach((row) => {
        api.materials
          .importPreview(row.file)
          .then((preview) => patch(row.key, {state: 'ready', preview, title: preview.title}))
          .catch((error: Error) => patch(row.key, {state: 'error', error: error.message}));
      });
  };

  const ready = rows.filter((row) => row.state === 'ready');
  const reading = rows.some((row) => row.state === 'reading');
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
        await api.materials.importFile(row.file, {
          course_id: Number(courseId),
          title: row.title.trim() || row.preview?.title,
          topic: topic.trim(),
          kind,
          status: publish ? 'published' : 'draft',
          keep_file: keepFile,
          ...(parentId ? {parent_id: parentId} : {}),
        });
        patch(row.key, {state: 'done'});
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
    <Modal
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
                  {row.state === 'reading' || row.state === 'importing' ? (
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
                      onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                {row.state === 'error' && <p className="mt-1 text-[0.76rem] font-semibold text-flare-300 [overflow-wrap:anywhere]">{row.error}</p>}
                {row.state === 'reading' && <p className="mt-1 text-[0.74rem] font-semibold text-mist-500">Reading the document…</p>}
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
        <label className="flex min-w-0 cursor-pointer items-start gap-2.5 text-[0.8rem] font-semibold text-mist-300">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-nova-500" checked={keepFile} onChange={(event) => setKeepFile(event.target.checked)} />
          <span className="min-w-0">Keep the original file so players can open or download it too</span>
        </label>
      </div>
    </Modal>
  );
}
