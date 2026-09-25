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
} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {Button, Card, Chip, EmptyState, Field, Modal, SectionHeading, Segmented, Select, Skeleton, TextArea, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {formatDate, formatNumber} from '../lib/format';
import {useSession} from '../store/session';
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

function MaterialEditor({
  materialId,
  onBack,
  onSaved,
  course,
  kind = 'material',
}: {
  materialId: number | 'new';
  onBack: () => void;
  onSaved: () => void;
  /** When set, the material belongs to this course (the course workspace). */
  course?: Course | null;
  kind?: 'material' | 'note';
}) {
  const {toast} = useSession();
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
  const [sections, setSections] = useState<SectionDraft[]>([blankSection(1)]);
  const [loading, setLoading] = useState(materialId !== 'new');
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<{version: number; note: string; author: string; created_at: string}[]>([]);
  const [analytics, setAnalytics] = useState<MaterialAnalytics | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkIds, setLinkIds] = useState('');
  const [linked, setLinked] = useState<number[]>([]);
  const [preview, setPreview] = useState<MaterialDetail | null>(null);

  const load = useCallback(async () => {
    if (materialId === 'new') return;
    setLoading(true);
    try {
      const row = await api.materials.adminRead(materialId);
      setDraft({
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
      });
      setLinkUrl(row.link_url ?? '');
      setSections(
        (row.sections ?? []).map((section) => ({
          id: section.id,
          title: section.title,
          estimated_minutes: section.estimated_minutes ?? 3,
          check_enabled: Boolean(section.check_enabled),
          blocks: section.blocks ?? [],
        })),
      );
      setLinked(row.linked_question_ids ?? []);
      setVersions((await api.materials.versions(materialId)).versions ?? []);
      setAnalytics(await api.materials.analytics(materialId).catch(() => null));
    } catch (error) {
      toast('error', 'Could not open the material', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [materialId, toast, course?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (status?: 'draft' | 'published' | 'archived') => {
    if (!draft.title.trim()) {
      toast('error', 'Give the material a title');
      return;
    }
    if (!draft.course_id) {
      toast('error', 'Choose a course', 'Every material belongs to one course.');
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
        const created = await api.materials.create(body);
        toast('success', 'Material created', status === 'published' ? 'It is live for players now.' : 'Saved as a draft.');
        onSaved();
        if (created?.id) onBack();
      } else {
        await api.materials.update(materialId, body);
        toast('success', 'Material saved', status === 'published' ? 'Published to players.' : 'Changes stored + versioned.');
        onSaved();
        void load();
      }
    } catch (error) {
      toast('error', 'Could not save', (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          {course ? `${course.code} materials` : 'Materials'}
        </Button>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
          <Chip className={draft.status === 'published' ? 'border-mint-500/25 bg-mint-500/12 text-mint-300' : 'border-white/10 bg-white/4 text-mist-400'}>{draft.status}</Chip>
          <Button size="sm" variant="outline" icon={<Save className="size-4" />} loading={saving} onClick={() => void save('draft')}>
            Save draft
          </Button>
          <Button size="sm" variant="mint" icon={<Rocket className="size-4" />} loading={saving} onClick={() => void save('published')}>
            Publish
          </Button>
        </div>
      </div>

      <Card className="min-w-0 p-4">
        <SectionHeading title="Material details" subtitle={materialId === 'new' ? 'New material — starts as a draft.' : `Editing material #${materialId}`} />
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field label="Title">
            <TextInput value={draft.title} onChange={(event) => setDraft({...draft, title: event.target.value})} placeholder="Cell transport in plants" />
          </Field>
          {!course && (
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
            <TextInput
              type="number"
              min={1}
              max={600}
              value={String(draft.estimated_minutes)}
              onChange={(event) => setDraft({...draft, estimated_minutes: Number(event.target.value)})}
            />
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
          <Field label="Author shown to players">
            <TextInput value={draft.author} onChange={(event) => setDraft({...draft, author: event.target.value})} placeholder="Dr Okafor" />
          </Field>
          <Field label="Tags (comma separated)">
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
          Let players discuss this material
        </label>
      </Card>

      <Card className="min-w-0 p-4">
        <SectionHeading
          title="Sections & blocks"
          subtitle="HTML is stripped on save — the reader renders plain, typed blocks only."
          action={
            <Button size="sm" variant="soft" icon={<Plus className="size-4" />} onClick={() => setSections([...sections, blankSection(sections.length + 1)])}>
              Add section
            </Button>
          }
        />
        <div className="min-w-0 space-y-3">
          {sections.map((section, sectionIndex) => (
            <div key={section.id ?? `new-${sectionIndex}`} className="min-w-0 rounded-2xl border-2 border-white/12 bg-white/[0.03] p-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/8 text-[0.72rem] font-black text-mist-300 tabular">
                  {sectionIndex + 1}
                </span>
                <TextInput
                  className="min-w-0 flex-1"
                  value={section.title}
                  onChange={(event) =>
                    setSections(sections.map((row, index) => (index === sectionIndex ? {...row, title: event.target.value} : row)))
                  }
                  placeholder="Section title"
                />
                <TextInput
                  type="number"
                  min={1}
                  max={120}
                  value={String(section.estimated_minutes)}
                  onChange={(event) =>
                    setSections(sections.map((row, index) => (index === sectionIndex ? {...row, estimated_minutes: Number(event.target.value)} : row)))
                  }
                  className="w-20 shrink-0"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="size-4" />}
                  onClick={() => setSections(sections.filter((_, index) => index !== sectionIndex))}
                  aria-label="Remove section"
                />
              </div>
              <label className="mt-2 flex items-center gap-2 text-[0.76rem] font-bold text-mist-400">
                <input
                  type="checkbox"
                  checked={section.check_enabled}
                  onChange={(event) =>
                    setSections(sections.map((row, index) => (index === sectionIndex ? {...row, check_enabled: event.target.checked} : row)))
                  }
                />
                Ask a quick check question after this section
              </label>

              <div className="mt-2.5 min-w-0 space-y-2">
                {section.blocks.map((block, blockIndex) => (
                  <BlockEditor
                    key={blockIndex}
                    block={block}
                    index={blockIndex}
                    onChange={(next) =>
                      setSections(
                        sections.map((row, index) =>
                          index === sectionIndex
                            ? {
                                ...row,
                                blocks: row.blocks.map((current, currentIndex) => (currentIndex === blockIndex ? next : current)),
                              }
                            : row,
                        ),
                      )
                    }
                    onMove={(direction) => {
                      const target = blockIndex + direction;
                      if (target < 0 || target >= section.blocks.length) return;
                      const next = [...section.blocks];
                      [next[blockIndex], next[target]] = [next[target], next[blockIndex]];
                      setSections(sections.map((row, index) => (index === sectionIndex ? {...row, blocks: next} : row)));
                    }}
                    onRemove={() =>
                      setSections(
                        sections.map((row, index) =>
                          index === sectionIndex ? {...row, blocks: row.blocks.filter((_, currentIndex) => currentIndex !== blockIndex)} : row,
                        ),
                      )
                    }
                  />
                ))}
              </div>
              <Button
                className="mt-2"
                size="sm"
                variant="ghost"
                icon={<Plus className="size-4" />}
                onClick={() =>
                  setSections(sections.map((row, index) => (index === sectionIndex ? {...row, blocks: [...row.blocks, blankBlock()]} : row)))
                }
              >
                Add block
              </Button>
            </div>
          ))}
          {!sections.length ? <EmptyState icon={<FileText className="size-5" />} title="No sections" detail="Add one to start writing." /> : null}
        </div>
      </Card>

      {materialId !== 'new' ? (
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

          <Card className="min-w-0 p-4 lg:col-span-2">
            <SectionHeading title="Version history" subtitle="Every save keeps a snapshot." action={<History className="size-4 text-nova-300" />} />
            <ul className="mt-2 min-w-0 space-y-1.5">
              {versions.slice(0, 6).map((row) => (
                <li key={`${row.version}-${row.created_at}`} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/8 text-[0.68rem] font-black text-mist-200 tabular">v{row.version}</span>
                  <span className="min-w-0 flex-1 truncate text-[0.8rem] text-mist-300">{row.note}</span>
                  <span className="shrink-0 text-[0.68rem] font-bold text-mist-600">{formatDate(row.created_at)}</span>
                </li>
              ))}
              {!versions.length ? <p className="text-[0.8rem] text-mist-500">No versions recorded yet.</p> : null}
            </ul>
          </Card>

          <Card className="min-w-0 p-4 lg:col-span-2">
            <SectionHeading
              title="Actions"
              subtitle="Duplicate for a new topic, archive when it retires, or preview exactly what a player sees."
              action={
                <div className="flex flex-wrap gap-1.5">
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
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Eye className="size-4" />}
                    onClick={async () => {
                      try {
                        setPreview(await api.materials.adminRead(materialId));
                      } catch (error) {
                        toast('error', 'Preview failed', (error as Error).message);
                      }
                    }}
                  >
                    Preview as player
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Upload className="size-4" />}
                    onClick={() => void save('archived')}
                  >
                    Archive
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Trash2 className="size-4" />}
                    onClick={async () => {
                      if (!window.confirm('Delete this material for good?')) return;
                      try {
                        await api.materials.remove(materialId);
                        toast('success', 'Material deleted');
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
              }
            />
          </Card>
        </div>
      ) : null}

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

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title="Preview as player" subtitle="Exactly the reader view — questions stay hidden." size="lg">
        {preview ? (
          <div className="min-w-0 space-y-3">
            <div className="min-w-0">
              <p className="text-[1.05rem] font-black text-mist-50">{preview.title}</p>
              <p className="text-[0.8rem] text-mist-500">
                {preview.topic || 'General'} · {preview.section_count} sections · {preview.estimated_minutes} min
              </p>
            </div>
            {(preview.sections ?? []).map((section) => (
              <div key={section.id} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[0.86rem] font-black text-mist-100">
                  {section.position}. {section.title}
                </p>
                <div className="mt-1.5 space-y-1.5">
                  {(section.blocks ?? []).map((block, index) => (
                    <p key={index} className="text-[0.8rem] leading-snug text-mist-300">
 <span className="mr-1.5 rounded bg-white/8 px-1.5 py-0.5 text-[0.62rem] font-black tracking-wide text-mist-400">{block.type}</span>
                      {block.text || block.term || block.caption || block.url || (block.items ?? []).join(' · ')}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
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
}: {
  draft: NoteDraft | null;
  setDraft: (next: NoteDraft | null) => void;
  course: Course;
  topics: string[];
  onSaved: () => void;
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
    };
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
        await api.materials.create(body);
      }
      toast('success', draft.id ? 'Note saved' : 'Note created', draft.status === 'published' ? 'Visible to players.' : 'Saved as a draft.');
      setDraft(null);
      onSaved();
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
      subtitle={`${course.code} · ${course.title}`}
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
      if (mode === 'read') setReading(detail);
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
        <p className="min-w-0 flex-1 text-[0.8rem] font-semibold text-mist-400">
          {course
            ? `${formatNumber(stats.total ?? 0)} ${noun}${(stats.total ?? 0) === 1 ? '' : 's'} in ${course.code} · ${formatNumber(stats.published ?? 0)} published`
            : 'Long-form reading that unlocks arena time.'}
        </p>
        <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={create}>
          New {noun}
        </Button>
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
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={create}>
              New {noun}
            </Button>
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
                    Edit
                  </Button>
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

      <Modal open={Boolean(reading)} onClose={() => setReading(null)} title={reading?.title} subtitle={reading ? `${reading.topic || 'No topic'} · updated ${formatDate(reading.updated_at)}` : ''} size="lg">
        {reading && (
          <div className="min-w-0 space-y-3">
            {noteBody(reading)
              .split('\n\n')
              .map((text, index) => (
                <p key={index} className="text-[0.88rem] leading-relaxed whitespace-pre-line text-mist-200 [overflow-wrap:anywhere]">
                  {text}
                </p>
              ))}
            {reading.link_url && (
              <a href={reading.link_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[0.82rem] font-bold text-nova-200">
                <ExternalLink className="size-4" /> Open attached link
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
