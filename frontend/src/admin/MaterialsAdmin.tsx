/**
 * Admin studio: materials authoring.
 *
 * Sections and typed blocks (with the same allow-list the reader renders),
 * publishing, duplication, version history, question linking and the analytics
 * that show where readers stop and what confuses them.
 */
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  FileText,
  History,
  Link2,
  MessageSquareWarning,
  Plus,
  Rocket,
  Save,
  Trash2,
  TriangleAlert,
  Upload,
  ExternalLink,
  NotebookPen,
  Pencil,
  Search,
  FileUp,
  Undo2,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Button, Card, Chip, EmptyState, Field, Modal, SectionHeading, Segmented, Select, Skeleton, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatDate, formatNumber} from '../lib/format';
import {useSession} from '../store/session';
import MaterialImport from './MaterialImport';
import type {Course, MaterialAnalytics, MaterialBlock, MaterialCard, MaterialDetail} from '../lib/types';

const BLOCK_TYPES: {value: MaterialBlock['type']; label: string}[] = [
  {value: 'heading', label: 'Heading'},
  {value: 'subheading', label: 'Subheading'},
  {value: 'paragraph', label: 'Paragraph'},
  {value: 'list', label: 'Bullet list'},
  {value: 'numbers', label: 'Numbered list'},
  {value: 'table', label: 'Table'},
  {value: 'keyterm', label: 'Key term'},
  {value: 'definition', label: 'Definition'},
  {value: 'note', label: 'Note'},
  {value: 'tip', label: 'Tip'},
  {value: 'example', label: 'Example'},
  {value: 'summary', label: 'Summary'},
  {value: 'quote', label: 'Quote'},
  {value: 'reference', label: 'Reference'},
  {value: 'image', label: 'Image'},
  {value: 'video', label: 'Video'},
  {value: 'attachment', label: 'Attachment'},
  {value: 'divider', label: 'Divider'},
];

type SectionDraft = {id?: number; title: string; estimated_minutes: number; check_enabled: boolean; blocks: MaterialBlock[]};

const blankBlock = (type: MaterialBlock['type'] = 'paragraph'): MaterialBlock => ({type, text: ''});

const blankSection = (index: number): SectionDraft => ({
  title: `Section ${index}`,
  estimated_minutes: 4,
  check_enabled: false,
  blocks: [blankBlock()],
});

/* ---------------------------------------------------------------- editor */

function BlockEditor({
  block,
  index,
  onChange,
  onMove,
  onRemove,
}: {
  block: MaterialBlock;
  index: number;
  onChange: (next: MaterialBlock) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Select
          value={block.type}
          onChange={(event) => onChange({...block, type: event.target.value as MaterialBlock['type']})}
          className="min-w-0 flex-1"
        >
          {BLOCK_TYPES.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" icon={<ChevronUp className="size-4" />} onClick={() => onMove(-1)} aria-label="Move up" />
        <Button size="sm" variant="ghost" icon={<ChevronDown className="size-4" />} onClick={() => onMove(1)} aria-label="Move down" />
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={onRemove} aria-label="Remove block" />
        <span className="ml-auto text-[0.68rem] font-black text-mist-600 tabular">#{index + 1}</span>
      </div>

      <div className="mt-2 min-w-0 space-y-2">
        {block.type === 'list' || block.type === 'numbers' ? (
          <TextArea
            rows={3}
            value={(block.items ?? []).join('\n')}
            onChange={(event) => onChange({...block, items: event.target.value.split('\n')})}
            placeholder="One item per line"
          />
        ) : block.type === 'table' ? (
          <div className="min-w-0 space-y-2">
            <TextInput
              value={(block.head ?? []).join(' | ')}
              onChange={(event) => onChange({...block, head: event.target.value.split('|').map((cell) => cell.trim())})}
              placeholder="Header cells, separated by |"
            />
            <TextArea
              rows={3}
              value={(block.rows ?? []).map((row) => row.join(' | ')).join('\n')}
              onChange={(event) =>
                onChange({...block, rows: event.target.value.split('\n').map((row) => row.split('|').map((cell) => cell.trim()))})
              }
              placeholder="One row per line, cells separated by |"
            />
          </div>
        ) : block.type === 'keyterm' ? (
          <div className="min-w-0 space-y-2">
            <TextInput value={block.term ?? ''} onChange={(event) => onChange({...block, term: event.target.value})} placeholder="Term" />
            <TextInput value={block.meaning ?? ''} onChange={(event) => onChange({...block, meaning: event.target.value})} placeholder="Meaning" />
          </div>
        ) : block.type === 'image' || block.type === 'attachment' || block.type === 'video' ? (
          <div className="min-w-0 space-y-2">
            <TextInput value={block.url ?? ''} onChange={(event) => onChange({...block, url: event.target.value})} placeholder="https://…" />
            <TextInput
              value={block.type === 'video' ? (block.title ?? '') : (block.caption ?? '')}
              onChange={(event) => onChange(block.type === 'video' ? {...block, title: event.target.value} : {...block, caption: event.target.value})}
              placeholder={block.type === 'video' ? 'Video title' : 'Caption'}
            />
          </div>
        ) : block.type === 'divider' ? (
          <p className="text-[0.76rem] text-mist-500">A horizontal rule — nothing to fill in.</p>
        ) : (
          <TextArea rows={block.type === 'paragraph' ? 3 : 2} value={block.text ?? ''} onChange={(event) => onChange({...block, text: event.target.value})} placeholder="Write the content…" />
        )}
        {['note', 'tip', 'example', 'summary', 'definition', 'quote'].includes(block.type) && block.type !== 'tip' ? (
          <TextInput value={block.title ?? ''} onChange={(event) => onChange({...block, title: event.target.value})} placeholder="Label (optional)" />
        ) : null}
      </div>
    </div>
  );
}

type EditorTab = 'read' | 'content' | 'notes' | 'details' | 'history' | 'insights';
type VersionRow = {id: number; version: number; note: string; author: string; created_at: string};

/** Everything a staff member can do with one material, split into sub-tabs
 *  so nothing is buried at the bottom of a long page:
 *  Read · Content · Notes · Details · History · Insights. */
function MaterialEditor({
  materialId,
  onBack,
  onSaved,
  course,
  kind = 'material',
  parentId = null,
  parentTitle = '',
}: {
  materialId: number | 'new';
  onBack: () => void;
  onSaved: () => void;
  /** When set, the material belongs to this course (the course workspace). */
  course?: Course | null;
  kind?: 'material' | 'note';
  /** Notes only: the material this note sits inside. */
  parentId?: number | null;
  parentTitle?: string;
}) {
  const {toast} = useSession();
  const isNew = materialId === 'new';
  const isNote = kind === 'note';
  const noun = isNote ? 'note' : 'material';
  const [tab, setTab] = useState<EditorTab>(isNew ? 'details' : 'read');
  const [courses, setCourses] = useState<Course[]>([]);
  const [topicNames, setTopicNames] = useState<string[]>([]);
  const [linkUrl, setLinkUrl] = useState('');
  const [draft, setDraft] = useState({
    title: '',
    topic: '',
    subtopic: '',
    description: '',
    difficulty: 'intermediate' as 'beginner' | 'intermediate' | 'advanced',
    estimated_minutes: 10,
    tags: '',
    summary: '',
    author: '',
    accent: 'violet',
    status: 'draft' as 'draft' | 'published' | 'archived',
    course_id: (course?.id ?? null) as number | null,
    quiz_id: null as number | null,
    allow_discussion: true,
  });
  const [sections, setSections] = useState<SectionDraft[]>([blankSection(1)]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [analytics, setAnalytics] = useState<MaterialAnalytics | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkIds, setLinkIds] = useState('');
  const [linked, setLinked] = useState<number[]>([]);
  const [noteCount, setNoteCount] = useState<number | null>(null);
  const [owner, setOwner] = useState<{id: number | null; title: string}>({id: parentId, title: parentTitle});

  /* ---- undo / redo for content edits (grouped: one step per pause in typing) */
  const [past, setPast] = useState<SectionDraft[][]>([]);
  const [future, setFuture] = useState<SectionDraft[][]>([]);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const lastEdit = useRef(0);
  const updateSections = (next: SectionDraft[]) => {
    const now = Date.now();
    if (now - lastEdit.current > 800) {
      setPast((stack) => [...stack.slice(-59), sectionsRef.current]);
      setFuture([]);
    }
    lastEdit.current = now;
    setSections(next);
  };
  const undoEdit = () => {
    if (!past.length) return;
    setFuture((stack) => [sectionsRef.current, ...stack].slice(0, 60));
    setSections(past[past.length - 1]);
    setPast((stack) => stack.slice(0, -1));
    lastEdit.current = 0;
  };
  const redoEdit = () => {
    if (!future.length) return;
    setPast((stack) => [...stack, sectionsRef.current]);
    setSections(future[0]);
    setFuture((stack) => stack.slice(1));
    lastEdit.current = 0;
  };

  /* ---- unsaved-changes tracking */
  const [savedKey, setSavedKey] = useState('');
  const currentKey = JSON.stringify({draft, sections, linkUrl});
  const dirty = savedKey !== '' && savedKey !== currentKey;
  useEffect(() => {
    if (isNew) setSavedKey(JSON.stringify({draft, sections, linkUrl}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (course) return;
    api.admin
      .courses()
      .then(setCourses)
      .catch(() => setCourses([]));
  }, [course]);

  useEffect(() => {
    if (!draft.course_id) {
      setTopicNames([]);
      return;
    }
    api.admin
      .courseTopics(draft.course_id)
      .then((payload) => setTopicNames(payload.topics.map((row) => row.name)))
      .catch(() => setTopicNames([]));
  }, [draft.course_id]);

  const load = useCallback(async () => {
    if (materialId === 'new') return;
    setLoading(true);
    try {
      const row = await api.materials.adminRead(materialId);
      const nextDraft = {
        title: row.title,
        topic: row.topic,
        subtopic: row.subtopic,
        description: row.description,
        difficulty: row.difficulty,
        estimated_minutes: row.estimated_minutes,
        tags: (row.tags ?? []).join(', '),
        summary: (row.summary ?? []).join('\n'),
        author: row.author,
        accent: row.accent,
        status: row.status,
        course_id: row.course_id ?? course?.id ?? null,
        quiz_id: row.quiz_id ?? null,
        allow_discussion: row.allow_discussion,
      };
      const nextSections = (row.sections ?? []).map((section) => ({
        id: section.id,
        title: section.title,
        estimated_minutes: section.estimated_minutes ?? 3,
        check_enabled: Boolean(section.check_enabled),
        blocks: section.blocks ?? [],
      }));
      const nextLink = row.link_url ?? '';
      setDraft(nextDraft);
      setSections(nextSections);
      setLinkUrl(nextLink);
      setSavedKey(JSON.stringify({draft: nextDraft, sections: nextSections, linkUrl: nextLink}));
      setLinked(row.linked_question_ids ?? []);
      if (row.parent_id) setOwner((current) => ({id: row.parent_id ?? null, title: current.title}));
      setVersions(((await api.materials.versions(materialId)).versions ?? []) as VersionRow[]);
      setAnalytics(await api.materials.analytics(materialId).catch(() => null));
      if ((row.kind ?? 'material') !== 'note') {
        api.materials
          .adminList({parent_id: materialId, limit: 1})
          .then((payload) => setNoteCount(payload.total ?? 0))
          .catch(() => setNoteCount(null));
      }
    } catch (error) {
      toast('error', `Could not open the ${noun}`, (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [materialId, toast, course?.id, noun]);

  useEffect(() => {
    void load();
  }, [load]);

  const leave = () => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    onBack();
  };

  const save = async (status?: 'draft' | 'published' | 'archived') => {
    if (!draft.title.trim()) {
      toast('error', `Give the ${noun} a title`);
      setTab('details');
      return;
    }
    if (!draft.course_id && !owner.id) {
      toast('error', 'Choose a course', `Every ${noun} belongs to one course.`);
      setTab('details');
      return;
    }
    setSaving(true);
    const body = {
      title: draft.title,
      topic: draft.topic,
      subtopic: draft.subtopic,
      description: draft.description,
      difficulty: draft.difficulty,
      estimated_minutes: Number(draft.estimated_minutes) || 10,
      tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      summary: draft.summary.split('\n').map((line) => line.trim()).filter(Boolean),
      author: draft.author,
      accent: draft.accent,
      status: status ?? draft.status,
      course_id: draft.course_id,
      quiz_id: draft.quiz_id,
      kind,
      link_url: linkUrl.trim(),
      allow_discussion: draft.allow_discussion,
      ...(isNew && owner.id ? {parent_id: owner.id} : {}),
      sections: sections.map((section) => ({
        id: section.id ?? null,
        title: section.title,
        estimated_minutes: Number(section.estimated_minutes) || 3,
        check_enabled: section.check_enabled,
        blocks: section.blocks
          .filter((block) => (block.type === 'divider' ? true : Boolean(block.text || block.items?.length || block.rows?.length || block.url || block.term)))
          .map((block) => ({...block, items: block.items?.filter((item) => item.trim())})),
      })),
    };
    try {
      if (materialId === 'new') {
        await api.materials.create(body);
        toast('success', `${isNote ? 'Note' : 'Material'} created`, status === 'published' ? 'It is live for players now.' : 'Saved as a draft.');
        onSaved();
        onBack();
      } else {
        await api.materials.update(materialId, body);
        toast('success', 'Saved', status === 'published' ? 'Published to players.' : 'A version was kept — you can undo it in History.');
        onSaved();
        setPast([]);
        setFuture([]);
        void load();
      }
    } catch (error) {
      toast('error', 'Could not save', (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const restore = async (row: VersionRow, label = 'Version restored') => {
    if (materialId === 'new') return;
    if (dirty && !window.confirm('Discard your unsaved changes and restore this version?')) return;
    try {
      await api.materials.restoreVersion(materialId, row.id);
      toast('success', label, 'The restore is saved as a new version, so you can undo it too.');
      onSaved();
      setPast([]);
      setFuture([]);
      await load();
    } catch (error) {
      toast('error', 'Could not restore', (error as Error).message);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const tabs: {value: EditorTab; label: string; icon: typeof BookOpen}[] = isNew
    ? [
        {value: 'details', label: 'Details', icon: SlidersHorizontal},
        {value: 'content', label: 'Content', icon: Pencil},
      ]
    : [
        {value: 'read', label: 'Read', icon: Eye},
        {value: 'content', label: 'Content', icon: Pencil},
        ...(isNote ? [] : [{value: 'notes' as EditorTab, label: noteCount ? `Notes (${noteCount})` : 'Notes', icon: NotebookPen}]),
        {value: 'details', label: 'Details', icon: SlidersHorizontal},
        {value: 'history', label: 'History', icon: History},
        ...(isNote ? [] : [{value: 'insights' as EditorTab, label: 'Insights', icon: BarChart3}]),
      ];

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={leave} aria-label="Back" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.68rem] font-black tracking-[0.12em] text-mist-500 uppercase">
            {owner.id ? `Note in ${owner.title || 'a material'}` : `${course ? `${course.code} · ` : ''}${isNote ? 'Note' : 'Material'}`}
          </p>
          <h2 className="truncate text-[1rem] font-extrabold text-mist-50 sm:text-[1.1rem]">{draft.title || (isNew ? `New ${noun}` : 'Untitled')}</h2>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Chip className={statusTone(draft.status)}>{draft.status}</Chip>
        {dirty && <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-200">Unsaved changes</Chip>}
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="outline" icon={<Save className="size-4" />} loading={saving} onClick={() => void save('draft')}>
            Save draft
          </Button>
          <Button size="sm" variant="mint" icon={<Rocket className="size-4" />} loading={saving} onClick={() => void save('published')}>
            Publish
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label={`${isNote ? 'Note' : 'Material'} sections`} className="grid min-w-0 grid-cols-3 gap-1 rounded-xl border border-white/10 bg-ink-950/80 p-1 sm:flex">
        {tabs.map((option) => {
          const Icon = option.icon;
          const active = option.value === tab;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(option.value)}
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[0.76rem] font-bold transition-colors sm:flex-1 ${
                active ? 'brand-gradient text-white' : 'text-mist-400 hover:bg-white/5 hover:text-mist-100'
              }`}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------ read */}
      {tab === 'read' && (
        <Card className="min-w-0 p-4">
          {dirty && (
            <p className="mb-3 rounded-xl border border-gold-500/25 bg-gold-500/10 px-3 py-2 text-[0.76rem] font-bold text-gold-200">
              Showing your unsaved edits — save to make them live.
            </p>
          )}
          <h1 className="text-[1.15rem] leading-tight font-black text-mist-50 [overflow-wrap:anywhere] sm:text-[1.3rem]">{draft.title || 'Untitled'}</h1>
          <p className="mt-1 text-[0.74rem] font-bold text-mist-500">
            {draft.topic || 'No topic'} · {sections.length} section{sections.length === 1 ? '' : 's'} · {draft.estimated_minutes} min · {draft.difficulty}
          </p>
          {draft.description && <p className="mt-2 text-[0.86rem] leading-relaxed text-mist-300 [overflow-wrap:anywhere]">{draft.description}</p>}
          {draft.summary.trim() && (
            <ul className="mt-3 list-disc space-y-1 rounded-xl border border-white/10 bg-white/[0.03] py-2.5 pr-3 pl-7 text-[0.82rem] text-mist-300">
              {draft.summary
                .split('\n')
                .filter((line) => line.trim())
                .map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
            </ul>
          )}
          {linkUrl && (
            <a href={linkUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[0.82rem] font-bold text-nova-200">
              <ExternalLink className="size-4" /> {linkUrl.startsWith('/api/material-files/') ? 'Open the original file' : 'Open attached link'}
            </a>
          )}
          <div className="mt-4 min-w-0 space-y-4">
            {sections.map((section, index) => (
              <section key={section.id ?? `s-${index}`} className="min-w-0 space-y-2 border-t border-white/8 pt-3">
                <h3 className="text-[0.95rem] font-extrabold text-mist-50 [overflow-wrap:anywhere]">
                  {index + 1}. {section.title || `Section ${index + 1}`}
                </h3>
                {section.blocks.map((block, blockIndex) => (
                  <PlainBlock key={blockIndex} block={block} />
                ))}
              </section>
            ))}
            {!sections.length && (
              <EmptyState
                icon={<FileText className="size-5" />}
                title="Nothing to read yet"
                detail="Write the content first."
                action={
                  <Button size="sm" onClick={() => setTab('content')} icon={<Pencil className="size-4" />}>
                    Write content
                  </Button>
                }
              />
            )}
          </div>
        </Card>
      )}

      {/* --------------------------------------------------------- content */}
      {tab === 'content' && (
        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" icon={<Undo2 className="size-4" />} disabled={!past.length} onClick={undoEdit}>
              Undo
            </Button>
            <Button size="sm" variant="ghost" icon={<Redo2 className="size-4" />} disabled={!future.length} onClick={redoEdit}>
              Redo
            </Button>
            <span className="min-w-0 flex-1 truncate text-[0.72rem] font-semibold text-mist-500">
              {past.length ? `${past.length} change${past.length === 1 ? '' : 's'} you can undo` : 'Edits here can be undone until you save'}
            </span>
            <Button size="sm" variant="soft" icon={<Plus className="size-4" />} onClick={() => updateSections([...sections, blankSection(sections.length + 1)])}>
              Add section
            </Button>
          </div>
          {sections.map((section, sectionIndex) => (
            <div key={section.id ?? `new-${sectionIndex}`} className="min-w-0 rounded-2xl border-2 border-white/12 bg-white/[0.03] p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/8 text-[0.72rem] font-black text-mist-300 tabular">{sectionIndex + 1}</span>
                <TextInput
                  className="min-w-0 flex-1"
                  value={section.title}
                  onChange={(event) => updateSections(sections.map((row, index) => (index === sectionIndex ? {...row, title: event.target.value} : row)))}
                  placeholder="Section title"
                  aria-label="Section title"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="size-4" />}
                  onClick={() => updateSections(sections.filter((_, index) => index !== sectionIndex))}
                  aria-label="Remove section"
                />
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
                <label className="flex items-center gap-2 text-[0.76rem] font-bold text-mist-400">
                  Minutes
                  <TextInput
                    type="number"
                    min={1}
                    max={120}
                    value={String(section.estimated_minutes)}
                    onChange={(event) =>
                      updateSections(sections.map((row, index) => (index === sectionIndex ? {...row, estimated_minutes: Number(event.target.value)} : row)))
                    }
                    className="w-20"
                  />
                </label>
                <label className="flex items-center gap-2 text-[0.76rem] font-bold text-mist-400">
                  <input
                    type="checkbox"
                    checked={section.check_enabled}
                    onChange={(event) =>
                      updateSections(sections.map((row, index) => (index === sectionIndex ? {...row, check_enabled: event.target.checked} : row)))
                    }
                  />
                  Quick check question after this section
                </label>
              </div>
              <div className="mt-2.5 min-w-0 space-y-2">
                {section.blocks.map((block, blockIndex) => (
                  <BlockEditor
                    key={blockIndex}
                    block={block}
                    index={blockIndex}
                    onChange={(next) =>
                      updateSections(
                        sections.map((row, index) =>
                          index === sectionIndex ? {...row, blocks: row.blocks.map((current, currentIndex) => (currentIndex === blockIndex ? next : current))} : row,
                        ),
                      )
                    }
                    onMove={(direction) => {
                      const target = blockIndex + direction;
                      if (target < 0 || target >= section.blocks.length) return;
                      const next = [...section.blocks];
                      [next[blockIndex], next[target]] = [next[target], next[blockIndex]];
                      lastEdit.current = 0;
                      updateSections(sections.map((row, index) => (index === sectionIndex ? {...row, blocks: next} : row)));
                    }}
                    onRemove={() => {
                      lastEdit.current = 0;
                      updateSections(
                        sections.map((row, index) => (index === sectionIndex ? {...row, blocks: row.blocks.filter((_, currentIndex) => currentIndex !== blockIndex)} : row)),
                      );
                    }}
                  />
                ))}
              </div>
              <Button
                className="mt-2"
                size="sm"
                variant="ghost"
                icon={<Plus className="size-4" />}
                onClick={() => updateSections(sections.map((row, index) => (index === sectionIndex ? {...row, blocks: [...row.blocks, blankBlock()]} : row)))}
              >
                Add block
              </Button>
            </div>
          ))}
          {!sections.length ? <EmptyState icon={<FileText className="size-5" />} title="No sections" detail="Add one to start writing." /> : null}
        </div>
      )}

      {/* ----------------------------------------------------------- notes */}
      {tab === 'notes' && materialId !== 'new' && (
        <MaterialNotes
          material={{id: materialId, title: draft.title, course_id: draft.course_id}}
          course={course}
          onCount={setNoteCount}
          onChanged={onSaved}
        />
      )}

      {/* --------------------------------------------------------- details */}
      {tab === 'details' && (
        <div className="min-w-0 space-y-3">
          <Card className="min-w-0 p-4">
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Field label="Title" className="sm:col-span-2">
                <TextInput value={draft.title} onChange={(event) => setDraft({...draft, title: event.target.value})} placeholder={isNote ? 'Exam tips' : 'Cell transport in plants'} />
              </Field>
              {!course && !owner.id && (
                <Field label="Course">
                  <Select value={draft.course_id ?? ''} onChange={(event) => setDraft({...draft, course_id: event.target.value ? Number(event.target.value) : null})}>
                    <option value="">Choose a course…</option>
                    {courses.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.code} — {row.title}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Topic">
                <TextInput list="material-topics" value={draft.topic} onChange={(event) => setDraft({...draft, topic: event.target.value})} placeholder="Cell Biology" />
                <datalist id="material-topics">
                  {topicNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
              <Field label="Sub-topic">
                <TextInput value={draft.subtopic} onChange={(event) => setDraft({...draft, subtopic: event.target.value})} placeholder="Osmosis" />
              </Field>
              <Field label="Difficulty">
                <Select value={draft.difficulty} onChange={(event) => setDraft({...draft, difficulty: event.target.value as typeof draft.difficulty})}>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </Select>
              </Field>
              <Field label="Estimated minutes">
                <TextInput type="number" min={1} max={600} value={String(draft.estimated_minutes)} onChange={(event) => setDraft({...draft, estimated_minutes: Number(event.target.value)})} />
              </Field>
              <Field label="Author shown to players">
                <TextInput value={draft.author} onChange={(event) => setDraft({...draft, author: event.target.value})} placeholder="Dr Okafor" />
              </Field>
              <Field label="Accent">
                <Select value={draft.accent} onChange={(event) => setDraft({...draft, accent: event.target.value})}>
                  {['violet', 'gold', 'mint', 'flare'].map((accent) => (
                    <option key={accent} value={accent}>
                      {accent}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tags (comma separated)" className="sm:col-span-2">
                <TextInput value={draft.tags} onChange={(event) => setDraft({...draft, tags: event.target.value})} placeholder="osmosis, membranes" />
              </Field>
              <Field label="File or link (optional)" hint="PDF, slides, video or any https:// resource." className="sm:col-span-2">
                <TextInput value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://…" inputMode="url" />
              </Field>
              <Field label="Short description" className="sm:col-span-2">
                <TextArea rows={2} value={draft.description} onChange={(event) => setDraft({...draft, description: event.target.value})} />
              </Field>
              <Field label="Summary points (one per line)" className="sm:col-span-2">
                <TextArea rows={3} value={draft.summary} onChange={(event) => setDraft({...draft, summary: event.target.value})} />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-[0.82rem] font-bold text-mist-300">
              <input type="checkbox" checked={draft.allow_discussion} onChange={(event) => setDraft({...draft, allow_discussion: event.target.checked})} />
              Let players discuss this {noun}
            </label>
          </Card>
          {materialId !== 'new' && (
            <Card className="min-w-0 p-3">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Copy className="size-4" />}
                  onClick={async () => {
                    try {
                      const copy = await api.materials.duplicate(materialId);
                      toast('success', 'Duplicated', `Copy #${copy.id} is waiting as a draft.`);
                      onSaved();
                    } catch (error) {
                      toast('error', 'Could not duplicate', (error as Error).message);
                    }
                  }}
                >
                  Duplicate
                </Button>
                <Button size="sm" variant="ghost" icon={<Upload className="size-4" />} onClick={() => void save('archived')}>
                  Archive
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 className="size-4" />}
                  onClick={async () => {
                    const extra = noteCount ? ` Its ${noteCount} note${noteCount === 1 ? '' : 's'} will stay in the course's Notes tab.` : '';
                    if (!window.confirm(`Delete this ${noun} for good?${extra}`)) return;
                    try {
                      await api.materials.remove(materialId);
                      toast('success', `${isNote ? 'Note' : 'Material'} deleted`);
                      onSaved();
                      onBack();
                    } catch (error) {
                      toast('error', 'Could not delete', (error as Error).message);
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* --------------------------------------------------------- history */}
      {tab === 'history' && (
        <Card className="min-w-0 p-3.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-[0.8rem] font-semibold text-mist-400">Every save keeps a copy. Restore any of them — restoring is saved too, so it can be undone.</p>
            {versions.length > 1 && (
              <Button size="sm" variant="outline" icon={<Undo2 className="size-4" />} onClick={() => void restore(versions[1], 'Last save undone')}>
                Undo last save
              </Button>
            )}
          </div>
          <ul className="mt-3 min-w-0 divide-y divide-white/6 rounded-2xl border border-white/8">
            {versions.map((row, index) => (
              <li key={row.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.82rem] font-bold text-mist-100">
                    {row.note || 'Saved'} {index === 0 && <span className="text-mint-300">· current</span>}
                  </p>
                  <p className="truncate text-[0.7rem] font-semibold text-mist-500">
                    {formatDate(row.created_at, true)}
                    {row.author ? ` · ${row.author}` : ''}
                  </p>
                </div>
                {index > 0 && (
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => void restore(row)} aria-label="Restore this version">
                    <span className="hidden sm:inline">Restore</span>
                  </Button>
                )}
              </li>
            ))}
            {!versions.length && <li className="px-3 py-3 text-[0.8rem] text-mist-500">No versions yet — they appear after the first save.</li>}
          </ul>
        </Card>
      )}

      {/* -------------------------------------------------------- insights */}
      {tab === 'insights' && (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          <Card className="min-w-0 p-4">
            <SectionHeading
              title="Linked questions"
              subtitle={`${linked.length} question${linked.length === 1 ? '' : 's'} feed the material self-test.`}
              action={
                <Button size="sm" variant="soft" icon={<Link2 className="size-4" />} onClick={() => setLinkOpen(true)}>
                  Link
                </Button>
              }
            />
            <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
              {linked.length ? (
                linked.map((id) => (
                  <Chip key={id} className="border-nova-500/25 bg-nova-500/12 text-nova-200">
                    Q{id}
                  </Chip>
                ))
              ) : (
                <p className="text-[0.8rem] text-mist-500">Nothing linked yet — readers fall back to the topic pool.</p>
              )}
            </div>
          </Card>
          <Card className="min-w-0 p-4">
            <SectionHeading title="Analytics" subtitle="Where readers stop, what confuses them." action={<BarChart3 className="size-4 text-nova-300" />} />
            {analytics ? (
              <div className="mt-2 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  {label: 'Views', value: analytics.views},
                  {label: 'Starts', value: analytics.starts},
                  {label: 'Completions', value: analytics.completions},
                  {label: 'Avg seconds', value: analytics.average_seconds ?? 0},
                  {label: 'Confusions', value: (analytics.confusions ?? []).reduce((sum, row) => sum + row.count, 0)},
                  {label: 'Version', value: analytics.material.version},
                ].map((tile) => (
                  <div key={tile.label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                    <p className="text-[0.95rem] font-black text-mist-50 tabular">{formatNumber(Number(tile.value) || 0)}</p>
                    <p className="text-[0.64rem] font-bold tracking-wide text-mist-500">{tile.label}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[0.8rem] text-mist-500">No analytics yet.</p>
            )}
            {(analytics?.confusions ?? []).length ? (
              <ul className="mt-2.5 space-y-1.5">
                {(analytics?.confusions ?? []).slice(0, 4).map((row) => (
                  <li key={row.section_id} className="flex min-w-0 items-center gap-2 text-[0.8rem] text-mist-300">
                    <MessageSquareWarning className="size-3.5 shrink-0 text-flare-300" />
                    <span className="min-w-0 flex-1 truncate">Section #{row.section_id}</span>
                    <span className="shrink-0 font-black text-flare-300 tabular">{row.count}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </div>
      )}

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Link questions" subtitle="Paste question IDs from the bank — the self-test draws from these first.">
        <div className="min-w-0 space-y-3">
          <TextArea rows={3} value={linkIds} onChange={(event) => setLinkIds(event.target.value)} placeholder="12, 44, 91" />
          <Button
            block
            variant="primary"
            icon={<Link2 className="size-4" />}
            onClick={async () => {
              const ids = linkIds
                .split(/[,\s]+/)
                .map((value) => Number(value.trim()))
                .filter((value) => Number.isFinite(value) && value > 0);
              if (!ids.length || materialId === 'new') {
                toast('error', 'Add at least one numeric question ID');
                return;
              }
              try {
                const payload = await api.materials.linkQuestions(materialId, ids);
                toast('success', `${payload.added} question(s) linked`);
                setLinked((current) => Array.from(new Set([...current, ...ids])));
                setLinkOpen(false);
                setLinkIds('');
              } catch (error) {
                toast('error', 'Could not link', (error as Error).message);
              }
            }}
          >
            Link these questions
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------- a material's notes */

type UndoAction = {label: string; run: () => Promise<void>};

/** The Notes tab inside one material: add, import, read, edit, delete — and
 *  undo the last of those. Older edits are restored from each note's history. */
function MaterialNotes({
  material,
  course,
  onCount,
  onChanged,
}: {
  material: {id: number; title: string; course_id: number | null};
  course?: Course | null;
  onCount: (count: number) => void;
  onChanged: () => void;
}) {
  const {toast} = useSession();
  const [items, setItems] = useState<MaterialCard[] | null>(null);
  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [reading, setReading] = useState<MaterialDetail | null>(null);
  const [fullEdit, setFullEdit] = useState<number | 'new' | null>(null);
  const [history, setHistory] = useState<{note: MaterialCard; rows: VersionRow[]} | null>(null);
  const [importing, setImporting] = useState(false);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [undoing, setUndoing] = useState(false);
  // NoteEditor / MaterialImport need a course; inside a material it is the material's course.
  const noteCourse: Course | null = course ?? (material.course_id ? ({id: material.course_id, code: '', title: material.title} as Course) : null);

  const load = useCallback(() => {
    api.materials
      .adminList({parent_id: material.id, limit: 100, ...(query.trim() ? {q: query.trim()} : {})})
      .then((payload) => {
        setItems(payload.items ?? []);
        if (!query.trim()) onCount(payload.total ?? 0);
      })
      .catch((error: Error) => toast('error', 'Could not load notes', error.message));
  }, [material.id, query, toast, onCount]);

  useEffect(() => {
    const handle = window.setTimeout(load, query ? 250 : 0);
    return () => window.clearTimeout(handle);
  }, [load, query]);

  useEffect(() => {
    if (!material.course_id) return;
    api.admin
      .courseTopics(material.course_id)
      .then((payload) => setTopics(payload.topics.map((row) => row.name)))
      .catch(() => setTopics([]));
  }, [material.course_id]);

  const changed = () => {
    load();
    onChanged();
  };

  const runUndo = async () => {
    if (!undo) return;
    setUndoing(true);
    try {
      await undo.run();
      toast('success', 'Undone');
      setUndo(null);
      changed();
    } catch (error) {
      toast('error', 'Could not undo', (error as Error).message);
    } finally {
      setUndoing(false);
    }
  };

  const openNote = async (row: MaterialCard, mode: 'read' | 'edit') => {
    try {
      const detail = await api.materials.adminRead(row.id);
      if (mode === 'read') {
        setReading(detail);
        return;
      }
      const structured =
        (detail.sections?.length ?? 0) > 1 || (detail.sections ?? []).some((section) => (section.blocks ?? []).some((block) => block.type !== 'paragraph'));
      if (structured) setFullEdit(detail.id); // keep headings, lists and tables intact
      else
        setNoteDraft({
          id: detail.id,
          title: detail.title,
          topic: detail.topic,
          description: detail.description,
          body: noteBody(detail),
          link_url: detail.link_url ?? '',
          status: detail.status,
        });
    } catch (error) {
      toast('error', 'Could not open the note', (error as Error).message);
    }
  };

  const remove = async (row: MaterialCard) => {
    if (!window.confirm(`Delete “${row.title}”? You can undo this straight after.`)) return;
    try {
      const snapshot = await api.materials.adminRead(row.id);
      await api.materials.remove(row.id);
      toast('info', 'Note deleted');
      setUndo({
        label: `Deleted “${row.title}”`,
        run: async () => {
          await api.materials.create({
            title: snapshot.title,
            topic: snapshot.topic,
            subtopic: snapshot.subtopic,
            description: snapshot.description,
            difficulty: snapshot.difficulty,
            estimated_minutes: snapshot.estimated_minutes,
            tags: snapshot.tags,
            summary: snapshot.summary,
            author: snapshot.author,
            status: snapshot.status,
            link_url: snapshot.link_url ?? '',
            kind: 'note',
            course_id: snapshot.course_id ?? material.course_id,
            parent_id: material.id,
            allow_discussion: snapshot.allow_discussion,
            sections: (snapshot.sections ?? []).map((section) => ({
              title: section.title,
              estimated_minutes: section.estimated_minutes ?? 3,
              check_enabled: Boolean(section.check_enabled),
              blocks: section.blocks ?? [],
            })),
          });
        },
      });
      changed();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  const openHistory = async (row: MaterialCard) => {
    try {
      const payload = await api.materials.versions(row.id);
      setHistory({note: row, rows: (payload.versions ?? []) as VersionRow[]});
    } catch (error) {
      toast('error', 'Could not load history', (error as Error).message);
    }
  };

  if (fullEdit !== null) {
    return (
      <MaterialEditor
        materialId={fullEdit}
        course={course}
        kind="note"
        parentId={material.id}
        parentTitle={material.title}
        onBack={() => {
          setFullEdit(null);
          changed();
        }}
        onSaved={changed}
      />
    );
  }

  const newNote = () => setNoteDraft({title: '', topic: '', description: '', body: '', link_url: '', status: 'published'});

  return (
    <div className="min-w-0 space-y-3">
      {undo && (
        <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-nova-500/30 bg-nova-500/10 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[0.8rem] font-bold text-nova-100">{undo.label}</span>
          <Button size="sm" variant="outline" icon={<Undo2 className="size-4" />} loading={undoing} onClick={() => void runUndo()}>
            Undo
          </Button>
          <button
            type="button"
            aria-label="Dismiss"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-mist-400 hover:bg-white/5"
            onClick={() => setUndo(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 basis-full text-[0.8rem] font-semibold text-mist-400 sm:basis-auto">
          Notes that belong to this material{items ? ` · ${items.length}` : ''}
        </p>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" icon={<FileUp className="size-4" />} onClick={() => setImporting(true)} disabled={!noteCourse}>
            Import
          </Button>
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={newNote} disabled={!noteCourse}>
            New note
          </Button>
        </div>
      </div>

      {(items?.length ?? 0) > 4 || query ? (
        <div className="relative min-w-0">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mist-500" />
          <TextInput className="pl-9" placeholder="Search these notes…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search notes" />
        </div>
      ) : null}

      {!items ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : !items.length ? (
        <EmptyState
          icon={<NotebookPen className="size-5" />}
          title={query ? 'No notes match' : 'No notes in this material yet'}
          detail="Add short notes, tips or summaries that go with this material — players see them in its Notes tab."
          action={
            <div className="flex flex-wrap justify-center gap-1.5">
              <Button size="sm" variant="outline" icon={<FileUp className="size-4" />} onClick={() => setImporting(true)} disabled={!noteCourse}>
                Import from file
              </Button>
              <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={newNote} disabled={!noteCourse}>
                New note
              </Button>
            </div>
          }
        />
      ) : (
        <ul className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((row) => (
            <li key={row.id} className="min-w-0">
              <Card className="flex h-full min-w-0 flex-col p-3">
                <div className="flex min-w-0 items-start gap-2">
                  <p className="line-clamp-2 min-w-0 flex-1 text-[0.9rem] font-extrabold text-mist-50">{row.title}</p>
                  <Chip className={`shrink-0 ${statusTone(row.status)}`}>{row.status}</Chip>
                </div>
                {row.description && <p className="mt-1 line-clamp-3 text-[0.78rem] leading-snug text-mist-400 [overflow-wrap:anywhere]">{row.description}</p>}
                <p className="mt-2 truncate text-[0.7rem] font-bold text-mist-500">
                  {row.topic || 'No topic'} · updated {formatDate(row.updated_at)}
                </p>
                <div className="mt-auto flex min-w-0 gap-1.5 pt-2.5">
                  <Button size="sm" variant="outline" className="flex-1" icon={<Eye className="size-3.5" />} onClick={() => void openNote(row, 'read')}>
                    Read
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1" icon={<Pencil className="size-3.5" />} onClick={() => void openNote(row, 'edit')}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" title="History & undo" aria-label={`History of ${row.title}`} icon={<History className="size-3.5" />} onClick={() => void openHistory(row)} />
                  <Button size="sm" variant="ghost" title="Delete note" aria-label={`Delete ${row.title}`} icon={<Trash2 className="size-3.5 text-flare-400" />} onClick={() => void remove(row)} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {noteCourse && (
        <NoteEditor
          draft={noteDraft}
          setDraft={setNoteDraft}
          course={noteCourse}
          parentId={material.id}
          subtitle={`Note in “${material.title}”`}
          topics={topics}
          onSaved={({id, created, title}) => {
            setUndo(
              created
                ? {label: `Added “${title}”`, run: async () => void (await api.materials.remove(id))}
                : {
                    label: `Saved “${title}”`,
                    run: async () => {
                      const payload = await api.materials.versions(id);
                      const previous = payload.versions?.[1];
                      if (!previous) throw new Error('There is no earlier version to go back to.');
                      await api.materials.restoreVersion(id, previous.id);
                    },
                  },
            );
            changed();
          }}
        />
      )}

      {noteCourse && (
        <MaterialImport
          open={importing}
          onClose={() => setImporting(false)}
          course={noteCourse}
          kind="note"
          parentId={material.id}
          parentTitle={material.title}
          topics={topics}
          onImported={changed}
        />
      )}

      <Modal
        open={Boolean(reading)}
        onClose={() => setReading(null)}
        title={reading?.title}
        subtitle={reading ? `${reading.topic || 'No topic'} · updated ${formatDate(reading.updated_at)}` : ''}
        size="lg"
        footer={
          reading ? (
            <>
              <Button variant="ghost" onClick={() => setReading(null)}>
                Close
              </Button>
              <Button
                icon={<Pencil className="size-4" />}
                onClick={() => {
                  const row = items?.find((item) => item.id === reading.id);
                  setReading(null);
                  if (row) void openNote(row, 'edit');
                }}
              >
                Edit
              </Button>
            </>
          ) : undefined
        }
      >
        {reading && (
          <div className="min-w-0 space-y-3">
            {(reading.sections ?? []).map((section) => (
              <section key={section.id} className="min-w-0 space-y-2">
                {(reading.sections?.length ?? 0) > 1 && <h3 className="text-[0.95rem] font-extrabold text-mist-50">{section.title}</h3>}
                {(section.blocks ?? []).map((block, index) => (
                  <PlainBlock key={index} block={block} />
                ))}
              </section>
            ))}
            {reading.link_url && (
              <a href={reading.link_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[0.82rem] font-bold text-nova-200">
                <ExternalLink className="size-4" /> {reading.link_url.startsWith('/api/material-files/') ? 'Open the original file' : 'Open attached link'}
              </a>
            )}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(history)} onClose={() => setHistory(null)} title={history ? `History · ${history.note.title}` : 'History'} subtitle="Restore any earlier version — restoring is saved too, so it can be undone.">
        {history && (
          <ul className="min-w-0 divide-y divide-white/6 rounded-2xl border border-white/8">
            {history.rows.map((row, index) => (
              <li key={row.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.82rem] font-bold text-mist-100">
                    {row.note || 'Saved'} {index === 0 && <span className="text-mint-300">· current</span>}
                  </p>
                  <p className="truncate text-[0.7rem] font-semibold text-mist-500">{formatDate(row.created_at, true)}</p>
                </div>
                {index > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RotateCcw className="size-3.5" />}
                    onClick={async () => {
                      try {
                        await api.materials.restoreVersion(history.note.id, row.id);
                        toast('success', 'Version restored');
                        setHistory(null);
                        changed();
                      } catch (error) {
                        toast('error', 'Could not restore', (error as Error).message);
                      }
                    }}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
            {!history.rows.length && <li className="px-3 py-3 text-[0.8rem] text-mist-500">No versions yet.</li>}
          </ul>
        )}
      </Modal>
    </div>
  );
}

/* ----------------------------------------------------------------- list */

/* ------------------------------------------------------------------ notes */

type NoteDraft = {id?: number; title: string; topic: string; description: string; body: string; link_url: string; status: 'draft' | 'published' | 'archived'};

/** Plain text of a note: its section paragraphs, blank-line separated. */
function noteBody(detail: MaterialDetail): string {
  return (detail.sections ?? [])
    .flatMap((section) => section.blocks ?? [])
    .map((block) => (block.items?.length ? block.items.join('\n') : (block.text ?? '')))
    .filter((text) => text.trim())
    .join('\n\n');
}

function NoteEditor({
  draft,
  setDraft,
  course,
  topics,
  onSaved,
  parentId,
  subtitle,
}: {
  draft: NoteDraft | null;
  setDraft: (next: NoteDraft | null) => void;
  course: Course;
  topics: string[];
  onSaved: (result: {id: number; created: boolean; title: string}) => void;
  /** Set when the note lives inside a material (that material's Notes tab). */
  parentId?: number;
  subtitle?: string;
}) {
  const {toast} = useSession();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      toast('error', 'Give the note a title');
      return;
    }
    setBusy(true);
    const paragraphs = draft.body
      .split(/\n\s*\n/)
      .map((text) => text.trim())
      .filter(Boolean);
    const body = {
      title: draft.title,
      topic: draft.topic,
      description: draft.description || paragraphs[0]?.slice(0, 280) || '',
      course_id: course.id,
      kind: 'note',
      link_url: draft.link_url.trim(),
      status: draft.status,
      estimated_minutes: Math.max(1, Math.round(draft.body.split(/\s+/).length / 200)),
      sections: [{title: draft.title, estimated_minutes: 3, check_enabled: false, blocks: paragraphs.map((text) => ({type: 'paragraph', text}))}],
      ...(parentId && !draft.id ? {parent_id: parentId} : {}),
    };
    let savedId = draft.id ?? 0;
    try {
      if (draft.id) {
        // keep the existing section id so the reader's progress survives an edit
        const current = await api.materials.adminRead(draft.id);
        const sectionId = current.sections?.[0]?.id ?? null;
        await api.materials.update(draft.id, {
          ...current,
          ...body,
          tags: current.tags,
          summary: current.summary,
          sections: [{...body.sections[0], id: sectionId}],
        });
      } else {
        savedId = (await api.materials.create(body)).id;
      }
      toast('success', draft.id ? 'Note saved' : 'Note created', draft.status === 'published' ? 'Visible to players.' : 'Saved as a draft.');
      setDraft(null);
      onSaved({id: savedId, created: !draft.id, title: draft.title});
    } catch (error) {
      toast('error', 'Could not save note', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={Boolean(draft)}
      onClose={() => setDraft(null)}
      title={draft?.id ? 'Edit note' : 'New note'}
      subtitle={subtitle ?? `${course.code} · ${course.title}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} icon={<Save className="size-4" />}>
            Save note
          </Button>
        </>
      }
    >
      {draft && (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2">
            <TextInput value={draft.title} onChange={(event) => setDraft({...draft, title: event.target.value})} placeholder="Doctrine of covering the field" />
          </Field>
          <Field label="Topic">
            <TextInput list="note-topics" value={draft.topic} onChange={(event) => setDraft({...draft, topic: event.target.value})} placeholder="Federalism" />
            <datalist id="note-topics">
              {topics.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label="Status">
            <Select value={draft.status} onChange={(event) => setDraft({...draft, status: event.target.value as NoteDraft['status']})}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
          <Field label="Note" hint="Separate paragraphs with a blank line." className="sm:col-span-2">
            <TextArea rows={9} value={draft.body} onChange={(event) => setDraft({...draft, body: event.target.value})} />
          </Field>
          <Field label="Short excerpt (optional)" hint="Shown on the note card. Defaults to the first paragraph." className="sm:col-span-2">
            <TextArea rows={2} maxLength={500} value={draft.description} onChange={(event) => setDraft({...draft, description: event.target.value})} />
          </Field>
          <Field label="File or link (optional)" className="sm:col-span-2">
            <TextInput value={draft.link_url} onChange={(event) => setDraft({...draft, link_url: event.target.value})} placeholder="https://…" inputMode="url" />
          </Field>
        </div>
      )}
    </Modal>
  );
}

/** Compact read-only rendering of one block (staff preview of a note). */
function PlainBlock({block}: {block: MaterialBlock}) {
  const text = 'text-[0.86rem] leading-relaxed text-mist-200 [overflow-wrap:anywhere]';
  if (block.type === 'heading') return <h4 className="pt-1 text-[0.9rem] font-extrabold text-mist-50">{block.text}</h4>;
  if (block.type === 'subheading') return <h5 className="text-[0.84rem] font-bold text-mist-100">{block.text}</h5>;
  if (block.type === 'list' || block.type === 'numbers') {
    const List = block.type === 'numbers' ? 'ol' : 'ul';
    return (
      <List className={`${text} space-y-0.5 pl-5 ${block.type === 'numbers' ? 'list-decimal' : 'list-disc'}`}>
        {(block.items ?? []).map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </List>
    );
  }
  if (block.type === 'table') {
    return (
      <div className="max-w-full overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-[0.78rem] text-mist-200">
          {block.head && block.head.length > 0 && (
            <thead className="bg-white/5 font-bold">
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index} className="px-2.5 py-1.5">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {(block.rows ?? []).map((row, index) => (
              <tr key={index} className="border-t border-white/6">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-2.5 py-1.5 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.type === 'divider') return <hr className="border-white/10" />;
  if (block.type === 'keyterm' || block.type === 'definition') {
    const term = block.term || block.title;
    const meaning = block.meaning || block.text;
    if (!term && !meaning) return null;
    return (
      <p className={`${text} rounded-xl border border-nova-500/20 bg-nova-500/8 px-3 py-2`}>
        {term && <b className="text-mist-50">{term}</b>}
        {term && meaning ? ' — ' : ''}
        {meaning}
      </p>
    );
  }
  if (block.type === 'image' && block.url) {
    return (
      <figure className="min-w-0">
        <img src={block.url} alt={block.caption || block.text || ''} className="max-h-80 max-w-full rounded-xl border border-white/10 object-contain" loading="lazy" />
        {block.caption && <figcaption className="mt-1 text-[0.72rem] text-mist-500">{block.caption}</figcaption>}
      </figure>
    );
  }
  if ((block.type === 'video' || block.type === 'attachment' || block.type === 'reference') && block.url) {
    return (
      <a href={block.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-[0.82rem] font-bold text-nova-200 [overflow-wrap:anywhere]">
        <ExternalLink className="size-4 shrink-0" /> {block.title || block.text || block.caption || block.url}
      </a>
    );
  }
  if (['note', 'tip', 'example', 'summary', 'quote'].includes(block.type) && block.text) {
    return (
      <div className={`${text} rounded-xl border-l-4 border-white/20 bg-white/[0.04] px-3 py-2 whitespace-pre-line`}>
        <span className="mr-1 text-[0.66rem] font-black tracking-[0.12em] text-mist-400 uppercase">{block.title || block.type}</span> {block.text}
      </div>
    );
  }
  return block.text
 ? <p className={`${text} whitespace-pre-line`}>{block.text}</p> : null;
}

function statusTone(status: string): string {
  return status === 'published'
    ? 'border-mint-500/25 bg-mint-500/12 text-mint-300'
    : status === 'draft'
      ? 'border-gold-500/25 bg-gold-500/12 text-gold-300'
      : 'border-white/10 bg-white/4 text-mist-400';
}

/* ----------------------------------------------------------------- list */

function MaterialsTab({
  onChanged,
  course = null,
  kind = 'material',
  unassigned = false,
}: {
  onChanged: () => void;
  course?: Course | null;
  kind?: 'material' | 'note';
  unassigned?: boolean;
}) {
  const {toast} = useSession();
  const [items, setItems] = useState<MaterialCard[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<'all' | 'published' | 'draft' | 'archived'>('all');
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [reading, setReading] = useState<MaterialDetail | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const limit = kind === 'note' ? 24 : 40;
  const isNotes = kind === 'note';
  const noun = isNotes ? 'note' : 'material';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.materials.adminList({
        ...(filter === 'all' ? {} : {status: filter}),
        ...(course ? {course_id: course.id, kind} : {}),
        ...(unassigned ? {unassigned: true} : {}),
        ...(query.trim() ? {q: query.trim()} : {}),
        ...(topic ? {topic} : {}),
        limit,
        offset,
      });
      setItems(payload.items ?? []);
      setStats(payload.stats ?? {});
      setTotal(payload.total ?? 0);
    } catch (error) {
      toast('error', `Could not load ${noun}s`, (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, offset, toast, course, kind, query, topic, limit, noun, unassigned]);

  useEffect(() => {
    setOffset(0);
  }, [filter, query, topic]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(), query ? 250 : 0);
    return () => window.clearTimeout(handle);
  }, [load, query]);

  useEffect(() => {
    if (!course) return;
    api.admin
      .courseTopics(course.id)
      .then((payload) => setTopics(payload.topics.map((row) => row.name)))
      .catch(() => setTopics([]));
  }, [course]);

  const openNote = async (row: MaterialCard, mode: 'read' | 'edit') => {
    try {
      const detail = await api.materials.adminRead(row.id);
      const structured =
        (detail.sections?.length ?? 0) > 1 || (detail.sections ?? []).some((section) => (section.blocks ?? []).some((block) => block.type !== 'paragraph'));
      if (mode === 'read') setReading(detail);
      else if (structured) setEditing(detail.id); // keep headings, lists and tables intact
      else
        setNoteDraft({
          id: detail.id,
          title: detail.title,
          topic: detail.topic,
          description: detail.description,
          body: noteBody(detail),
          link_url: detail.link_url ?? '',
          status: detail.status,
        });
    } catch (error) {
      toast('error', 'Could not open the note', (error as Error).message);
    }
  };

  const remove = async (row: MaterialCard) => {
    if (!window.confirm(`Delete “${row.title}”?`)) return;
    try {
      await api.materials.remove(row.id);
      toast('info', `${isNotes ? 'Note' : 'Material'} deleted`);
      onChanged();
      void load();
    } catch (error) {
      toast('error', 'Could not delete', (error as Error).message);
    }
  };

  if (editing !== null) {
    return (
      <MaterialEditor
        materialId={editing}
        course={course}
        kind={kind}
        parentTitle={editing === 'new' ? '' : (items?.find((row) => row.id === editing)?.parent_title ?? '')}
        onBack={() => setEditing(null)}
        onSaved={() => {
          onChanged();
          void load();
        }}
      />
    );
  }

  const create = () => {
    if (isNotes && course) setNoteDraft({title: '', topic: topic, description: '', body: '', link_url: '', status: 'published'});
    else setEditing('new');
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 basis-full text-[0.8rem] font-semibold text-mist-400 sm:basis-auto">
          {course
            ? `${formatNumber(stats.total ?? 0)} ${noun}${(stats.total ?? 0) === 1 ? '' : 's'} in ${course.code} · ${formatNumber(stats.published ?? 0)} published`
            : 'Long-form reading that unlocks arena time.'}
        </p>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" icon={<FileUp className="size-4" />} onClick={() => setImporting(true)}>
            Import
          </Button>
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={create}>
            New {noun}
          </Button>
        </div>
      </div>

      {!course && (
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {label: 'Total', value: stats.total ?? 0, icon: BookOpen},
            {label: 'Published', value: stats.published ?? 0, icon: Rocket},
            {label: 'Views', value: stats.views ?? 0, icon: Eye},
            {label: 'Confusions', value: stats.confusion_reports ?? 0, icon: TriangleAlert},
          ].map((tile) => (
            <Card key={tile.label} className="min-w-0 p-3">
              <tile.icon className="size-4 text-nova-300" />
              <p className="mt-1.5 text-[1.05rem] font-black text-mist-50 tabular">{formatNumber(tile.value)}</p>
              <p className="text-[0.66rem] font-bold tracking-wide text-mist-500">{tile.label}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="relative min-w-0">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mist-500" />
          <TextInput className="pl-9" placeholder={`Search ${noun}s…`} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={`Search ${noun}s`} />
        </div>
        {course && (
          <Select value={topic} onChange={(event) => setTopic(event.target.value)} aria-label="Filter by topic">
            <option value="">All topics</option>
            {topics.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <Segmented
        value={filter}
        options={[
          {value: 'all', label: 'All'},
          {value: 'published', label: 'Published'},
          {value: 'draft', label: 'Drafts'},
          {value: 'archived', label: 'Archived'},
        ]}
        onChange={(value) => setFilter(value as typeof filter)}
      />

      {loading ? (
        <div className={isNotes ? 'grid gap-2 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2'}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-28 w-full" />
          ))}
        </div>
      ) : !items.length ? (
        <EmptyState
          icon={isNotes ? <NotebookPen className="size-5" /> : <BookOpen className="size-5" />}
          title={query || topic ? `No ${noun}s match` : `No ${noun}s yet`}
          detail={course ? `${isNotes ? 'Notes' : 'Materials'} you add here belong to ${course.code} only.` : 'Create the first one.'}
          action={
            <div className="flex flex-wrap justify-center gap-1.5">
              <Button size="sm" variant="outline" icon={<FileUp className="size-4" />} onClick={() => setImporting(true)}>
                Import from file
              </Button>
              <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={create}>
                New {noun}
              </Button>
            </div>
          }
        />
      ) : isNotes ? (
        <ul className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((row) => (
            <li key={row.id} className="min-w-0">
              <Card className="flex h-full min-w-0 flex-col p-3">
                <div className="flex min-w-0 items-start gap-2">
                  <p className="line-clamp-2 min-w-0 flex-1 text-[0.9rem] font-extrabold text-mist-50">{row.title}</p>
                  <Chip className={`shrink-0 ${statusTone(row.status)}`}>{row.status}</Chip>
                </div>
                {row.description && <p className="mt-1 line-clamp-3 text-[0.78rem] leading-snug text-mist-400 [overflow-wrap:anywhere]">{row.description}</p>}
                {row.parent_title && (
                  <p className="mt-1.5 flex min-w-0 items-center gap-1 text-[0.7rem] font-bold text-nova-200">
                    <BookOpen className="size-3 shrink-0" />
                    <span className="truncate">in {row.parent_title}</span>
                  </p>
                )}
                <p className="mt-2 truncate text-[0.7rem] font-bold text-mist-500">
                  {row.topic || 'No topic'} · updated {formatDate(row.updated_at)}
                </p>
                <div className="mt-auto flex min-w-0 gap-1.5 pt-2.5">
                  <Button size="sm" variant="outline" className="flex-1" icon={<Eye className="size-3.5" />} onClick={() => void openNote(row, 'read')}>
                    Open
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1" icon={<Pencil className="size-3.5" />} onClick={() => void openNote(row, 'edit')}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" title="Delete note" icon={<Trash2 className="size-3.5 text-flare-400" />} onClick={() => void remove(row)} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="min-w-0 space-y-1.5">
          {items.map((row) => (
            <li key={row.id} className="min-w-0">
              <Card className="min-w-0 p-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-nova-500/25 bg-nova-500/10">
                    <BookOpen className="size-4 text-nova-300" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[0.88rem] font-extrabold text-mist-50">{row.title}</p>
                    <p className="mt-0.5 truncate text-[0.72rem] font-bold text-mist-500">
                      {row.topic || 'No topic'} · {row.section_count} section{row.section_count === 1 ? '' : 's'} · updated {formatDate(row.updated_at)}
                      {!course && row.course_title ? ` · ${row.course_title}` : ''}
                    </p>
                  </div>
                  <Chip className={`shrink-0 ${statusTone(row.status)}`}>{row.status}</Chip>
                </div>
                <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" icon={<FileText className="size-3.5" />} onClick={() => setEditing(row.id)}>
                    Open
                  </Button>
                  {row.note_count ? (
                    <Chip className="self-center border-nova-500/25 bg-nova-500/10 text-nova-200">
                      <NotebookPen className="size-3" /> {row.note_count} note{row.note_count === 1 ? '' : 's'}
                    </Chip>
                  ) : null}
                  {row.link_url && (
                    <a
                      href={row.link_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-8 items-center gap-1 rounded-xl px-2.5 text-[0.76rem] font-bold text-nova-200 hover:bg-white/5"
                    >
                      <ExternalLink className="size-3.5" /> Link
                    </a>
                  )}
                  <Button size="sm" variant="ghost" title="Delete material" icon={<Trash2 className="size-3.5 text-flare-400" />} onClick={() => void remove(row)} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {total > limit && (
        <div className="flex items-center justify-between gap-3">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
            Previous
          </Button>
          <span className="text-[0.76rem] font-bold text-mist-500 tabular">
            {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {formatNumber(total)}
          </span>
          <Button size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
            Next
          </Button>
        </div>
      )}

      {course && (
        <NoteEditor
          draft={noteDraft}
          setDraft={setNoteDraft}
          course={course}
          topics={topics}
          onSaved={() => {
            onChanged();
            void load();
          }}
        />
      )}

      <MaterialImport
        open={importing}
        onClose={() => setImporting(false)}
        course={course}
        kind={kind}
        topics={topics}
        onImported={() => {
          onChanged();
          void load();
        }}
      />

      <Modal open={Boolean(reading)} onClose={() => setReading(null)} title={reading?.title} subtitle={reading ? `${reading.topic || 'No topic'} · updated ${formatDate(reading.updated_at)}` : ''} size="lg">
        {reading && (
          <div className="min-w-0 space-y-3">
            {(reading.sections ?? []).map((section) => (
              <section key={section.id} className="min-w-0 space-y-2">
                {(reading.sections?.length ?? 0) > 1 && <h3 className="text-[0.95rem] font-extrabold text-mist-50">{section.title}</h3>}
                {(section.blocks ?? []).map((block, index) => <PlainBlock key={index} block={block} />)}
              </section>
            ))}
            {reading.link_url && (
              <a href={reading.link_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[0.82rem] font-bold text-nova-200">
                <ExternalLink className="size-4" /> {reading.link_url.startsWith('/api/material-files/') ? 'Open the original file' : 'Open attached link'}
              </a>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/**
 * Materials authoring. Inside a course workspace pass `course` (and `kind`):
 * the list, filters and new items are scoped to that course only.
 */
export default function MaterialsAdmin({
  onChanged,
  course = null,
  kind = 'material',
  unassigned = false,
}: {
  onChanged: () => void;
  course?: Course | null;
  kind?: 'material' | 'note';
  /** List only materials that have no course yet, so staff can assign them. */
  unassigned?: boolean;
}) {
  return <MaterialsTab onChanged={onChanged} course={course} kind={kind} unassigned={unassigned} />;
}
