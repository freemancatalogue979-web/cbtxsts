/**
 * Pro Materials — a calm reading library. Browsing, filters, continue reading,
 * notes, bookmarks and the glossary are Pro screens; opening a material hands
 * over to the existing reader (sections, highlights, player notes, self-tests)
 * so nothing that works today is lost.
 */
import {BookMarked, BookOpen, Bookmark, Clock, FileText, Layers, Library, NotebookPen, Search} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {api} from '../lib/api';
import {OPEN_MATERIAL_EVENT} from '../lib/palette';
import type {MaterialCard, MaterialDetail, MyLearning} from '../lib/types';
import {Reader} from '../panels/MaterialsPanel';
import {useSession} from '../store/session';
import {Badge, Empty, LoadingRows, Metric, PageHeader, Ring, Seg, Tile, hueForCourse, minutesLabel, type Hue, Cover} from './ui';
import {Select} from '../components/ui';

type CourseRow = {id: number; code: string; title: string; accent?: string};
type View = 'library' | 'notes' | 'bookmarks' | 'glossary';
type Level = '' | 'beginner' | 'intermediate' | 'advanced';

const LEVEL_TONE: Record<string, 'success' | 'accent' | 'warning'> = {beginner: 'success', intermediate: 'accent', advanced: 'warning'};

export default function ProMaterials() {
  const {toast, refreshProfile} = useSession();
  const [view, setView] = useState<View>('library');
  const [items, setItems] = useState<MaterialCard[] | null>(null);
  const [topics, setTopics] = useState<{topic: string; count: number}[]>([]);
  const [mine, setMine] = useState<MyLearning | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [courseId, setCourseId] = useState<number | 0>(0);
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<Level>('');
  const [term, setTerm] = useState('');
  const [reading, setReading] = useState<MaterialDetail | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [glossary, setGlossary] = useState<{term: string; meaning: string; material_id: number; material_title: string}[] | null>(null);
  const [glossQuery, setGlossQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const [payload, learning] = await Promise.all([
        api.materials.library({search: term, topic, difficulty: level, course_id: courseId || undefined, limit: 60}),
        api.materials.mine().catch(() => null),
      ]);
      setItems(payload.items ?? []);
      setTopics(payload.topics ?? []);
      if (learning) setMine(learning);
    } catch (error) {
      setItems([]);
      toast('error', 'Could not load materials', (error as Error).message);
    }
  }, [term, topic, level, courseId, toast]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), term ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [load, term]);

  useEffect(() => {
    api
      .arena.practiceCatalog()
      .then((d: unknown) => setCourses(((d as {courses?: CourseRow[]}).courses ?? []).map(({id, code, title, accent}) => ({id, code, title, accent}))))
      .catch(() => undefined);
  }, []);

  const open = useCallback(
    async (id: number) => {
      setOpening(id);
      try {
        setReading(await api.materials.read(id));
        window.scrollTo({top: 0});
      } catch (error) {
        toast('error', 'Could not open that material', (error as Error).message);
      } finally {
        setOpening(null);
      }
    },
    [toast],
  );

  /* Study workspace / command menu deep links. */
  useEffect(() => {
    const handler = (event: Event) => {
      const id = Number((event as CustomEvent).detail);
      if (id) void open(id);
    };
    window.addEventListener(OPEN_MATERIAL_EVENT, handler);
    return () => window.removeEventListener(OPEN_MATERIAL_EVENT, handler);
  }, [open]);

  useEffect(() => {
    if (view !== 'glossary' || glossary) return;
    api.materials
      .glossary('')
      .then((r) => setGlossary(r.terms ?? []))
      .catch(() => setGlossary([]));
  }, [view, glossary]);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const hueOf = (m: {course_id?: number | null; accent?: string}): Hue => hueForCourse(m.course_id ? (courseById.get(m.course_id) ?? {id: m.course_id}) : {id: 0, accent: m.accent});

  if (reading) {
    return (
      <Reader
        material={reading}
        onBack={() => {
          setReading(null);
          void load();
        }}
        onToast={toast}
        onProfileRefresh={() => void refreshProfile()}
      />
    );
  }

  /* The server's "mine" payload carries the lists; totals are derived here. */
  const summary = mine
    ? (mine.summary ?? {
        reading: mine.continue_reading?.length ?? 0,
        completed: mine.completed?.length ?? 0,
        notes: mine.notes?.length ?? 0,
        bookmarks: mine.bookmarks?.length ?? 0,
        minutes: Math.round(
          [...(mine.completed ?? []), ...(mine.continue_reading ?? [])].reduce((n, m) => n + Number((m as {progress?: {seconds_spent?: number}}).progress?.seconds_spent ?? 0), 0) / 60,
        ),
        percent: 0,
      })
    : null;
  const continueList = mine?.continue_reading ?? [];
  const glossFiltered = (glossary ?? []).filter((g) => !glossQuery.trim() || `${g.term} ${g.meaning}`.toLowerCase().includes(glossQuery.trim().toLowerCase()));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader icon={<BookOpen />} hue="amber" eyebrow="Library" title="Materials" description="Course reading with your highlights, notes and bookmarks kept alongside." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Reading" value={summary ? summary.reading : '—'} sub="in progress" icon={<BookOpen />} hue="blue" />
        <Metric label="Completed" value={summary ? summary.completed : '—'} sub={summary && items?.length ? `of ${items.length} in the library` : 'finished'} icon={<BookMarked />} hue="green" />
        <Metric label="Notes" value={summary ? summary.notes : '—'} sub={summary ? `${summary.bookmarks} bookmarks` : ''} icon={<NotebookPen />} hue="amber" />
        <Metric label="Read time" value={summary ? minutesLabel(summary.minutes) : '—'} sub="all time" icon={<Clock />} hue="violet" />
      </div>

      {continueList.length > 0 && view === 'library' && (
        <section className="grid gap-3">
          <h2 className="pro-h3 flex items-center gap-2"><span className="pro-dot" style={{background: 'var(--pro-h-amber)'}} /> Continue reading</h2>
          <div className="pro-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {continueList.slice(0, 3).map((m) => {
              const pctDone = Number((m as {progress?: {percent?: number}}).progress?.percent ?? 0);
              return (
                <button
                  key={m.material_id}
                  type="button"
                  onClick={() => void open(m.material_id)}
                  className="pro-card pro-lift pro-mark flex min-w-0 items-center gap-3 p-4 text-left"
                  data-hue={hueOf(m)}
                  aria-busy={opening === m.material_id}
                >
                  <Ring value={pctDone} size={48} stroke={4} hue={hueOf(m)}>
                    <span className="text-[0.6875rem]">{Math.round(pctDone)}%</span>
                  </Ring>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" style={{color: 'var(--pro-text)'}}>{m.title}</span>
                    <span className="pro-meta block truncate">{m.topic || 'General'} · {m.estimated_minutes} min read</span>
                  </span>
                  <span className="pro-btn pro-btn-sm shrink-0">Resume</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="pro-tabs pro-tabs-fit" role="tablist" aria-label="Materials views">
        {(
          [
            ['library', 'Library', <Library key="l" className="size-4" />],
            ['notes', 'My notes', <NotebookPen key="n" className="size-4" />],
            ['bookmarks', 'Bookmarks', <Bookmark key="b" className="size-4" />],
            ['glossary', 'Glossary', <Layers key="g" className="size-4" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className="pro-tab inline-flex items-center justify-center gap-1.5" onClick={() => setView(id)}>
            <span className="max-sm:hidden">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {view === 'library' && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <label className="pro-search min-w-0">
              <Search />
              <input className="pro-input w-full" placeholder="Search titles, topics and tags" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search materials" />
            </label>
            <div className="flex min-w-0 flex-wrap gap-2 md:flex-nowrap">
              {courses.length > 0 && (
                <Select className="pro-input min-w-0 flex-1 md:w-44 md:flex-none" value={courseId} onChange={(e) => setCourseId(Number(e.target.value))} aria-label="Course">
                  <option value={0}>All courses</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              )}
              {topics.length > 0 && (
                <Select className="pro-input min-w-0 flex-1 md:w-48 md:flex-none" value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic">
                  <option value="">All topics</option>
                  {topics.map((t) => (
                    <option key={t.topic} value={t.topic}>
                      {t.topic} ({t.count})
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </div>
          <div className="pro-scroll-x">
            <Seg<Level>
              label="Level"
              size="sm"
              value={level}
              onChange={setLevel}
              options={[
                {value: '', label: 'All levels'},
                {value: 'beginner', label: 'Beginner'},
                {value: 'intermediate', label: 'Intermediate'},
                {value: 'advanced', label: 'Advanced'},
              ]}
            />
          </div>

          {items === null ? (
            <LoadingRows rows={4} />
          ) : items.length === 0 ? (
            <div className="pro-card">
              <Empty
                icon={<FileText />}
                title={term || topic || level || courseId ? 'Nothing matches those filters' : 'No materials published yet'}
                body={term || topic || level || courseId ? 'Try a different search or clear the filters.' : 'When your lecturers publish reading for your courses, it will appear here.'}
                action={
                  term || topic || level || courseId ? (
                    <button
                      type="button"
                      className="pro-btn pro-btn-sm"
                      onClick={() => {
                        setTerm('');
                        setTopic('');
                        setLevel('');
                        setCourseId(0);
                      }}
                    >
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="pro-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((m) => {
                const hue = hueOf(m);
                const course = m.course_id ? courseById.get(m.course_id) : undefined;
                const done = m.progress?.status === 'completed';
                const pctDone = Number(m.progress?.percent ?? 0);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => void open(m.id)}
                    aria-busy={opening === m.id}
                    className="pro-card pro-lift flex min-w-0 flex-col gap-3 p-2.5 text-left"
                  >
                    <Cover hue={hue} code={course?.code ?? m.course_title ?? 'General'} glyph={m.kind === 'note' ? <NotebookPen className="size-full" /> : <BookOpen className="size-full" />} className="min-h-[84px]">
                      <span className="absolute top-3.5 right-3.5 inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[0.6875rem] font-semibold text-white backdrop-blur-sm">
                        <Clock className="size-3" /> {m.estimated_minutes} min
                      </span>
                      <p className="mt-5 truncate text-[0.75rem] font-semibold text-white/85">{m.topic || 'General reading'}</p>
                    </Cover>
                    <div className="grid min-w-0 gap-1.5 px-1.5">
                      <p className="text-[0.9375rem] leading-snug font-bold tracking-tight [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{m.title}</p>
                      {m.description && <p className="pro-secondary pro-clamp-2">{m.description}</p>}
                    </div>
                    <div className="mt-auto flex min-w-0 flex-wrap items-center gap-2 px-1.5 pb-1.5">
                      <Badge tone={LEVEL_TONE[m.difficulty]}>{m.difficulty}</Badge>
                      <span className="pro-meta">{m.section_count} sections</span>
                      <span className="ml-auto">
                        {done ? <Badge tone="success">Completed</Badge> : pctDone > 0 ? <span className="pro-meta pro-num">{Math.round(pctDone)}%</span> : null}
                      </span>
                    </div>
                    {pctDone > 0 && !done && (
                      <div className="pro-progress mx-1.5 mb-1.5" aria-hidden>
                        <span style={{width: `${pctDone}%`, background: `var(--pro-h-${hue})`}} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {view === 'notes' && (
        <div className="pro-card overflow-hidden">
          {!mine ? (
            <div className="p-4"><LoadingRows rows={3} /></div>
          ) : mine.notes.length === 0 ? (
            <Empty icon={<NotebookPen />} hue="amber" title="No notes yet" body="Select text while reading, or open the Notes tab in any material, to write your own notes." />
          ) : (
            <ul className="pro-rows grid">
              {mine.notes.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => void open(n.material_id)} className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--pro-hover)]">
                    <Tile hue="amber" size="sm"><NotebookPen /></Tile>
                    <span className="min-w-0 flex-1">
                      <span className="pro-meta block truncate">{n.title}</span>
                      <span className="pro-body pro-clamp-2 mt-0.5 block [overflow-wrap:anywhere]">{n.body}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view === 'bookmarks' && (
        <div className="pro-card overflow-hidden">
          {!mine ? (
            <div className="p-4"><LoadingRows rows={3} /></div>
          ) : mine.bookmarks.length === 0 ? (
            <Empty icon={<Bookmark />} hue="violet" title="No bookmarks yet" body="Bookmark a section while reading to come straight back to it." />
          ) : (
            <ul className="pro-rows grid">
              {mine.bookmarks.map((b) => (
                <li key={b.id}>
                  <button type="button" onClick={() => void open(b.material_id)} className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--pro-hover)]">
                    <Tile hue="violet" size="sm"><Bookmark /></Tile>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" style={{color: 'var(--pro-text)'}}>{b.label || b.title}</span>
                      <span className="pro-meta block truncate">{b.snippet || b.title}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view === 'glossary' && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <label className="pro-search">
            <Search />
            <input className="pro-input w-full" placeholder="Find a term" value={glossQuery} onChange={(e) => setGlossQuery(e.target.value)} aria-label="Search glossary" />
          </label>
          <div className="pro-card overflow-hidden">
            {glossary === null ? (
              <div className="p-4"><LoadingRows rows={4} /></div>
            ) : glossFiltered.length === 0 ? (
              <Empty icon={<Layers />} hue="teal" title={glossary.length ? 'No matching terms' : 'The glossary is empty'} body={glossary.length ? undefined : 'Key terms defined in your materials collect here.'} />
            ) : (
              <dl className="pro-rows grid">
                {glossFiltered.map((g) => (
                  <div key={`${g.term}-${g.material_id}`} className="grid gap-1 px-4 py-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-6">
                    <dt className="font-medium [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{g.term}</dt>
                    <dd className="min-w-0">
                      <p className="pro-body [overflow-wrap:anywhere]">{g.meaning}</p>
                      <button type="button" className="pro-link pro-meta mt-1" onClick={() => void open(g.material_id)}>
                        {g.material_title}
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
