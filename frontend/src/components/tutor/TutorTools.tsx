/**
 * AI Tutor tools: the generate sheet, flashcard deck + study mode, the
 * one-question-at-a-time AI Quiz, study material / notes viewers and the
 * student's library. Nothing is saved until the student taps Save.
 */
import {
  ArrowLeft, BookOpen, CalendarCheck, ClipboardPaste, GraduationCap, MessageSquare, CalendarClock, Check, ChevronLeft, ChevronRight, Copy, Download, FileText, HelpCircle, Layers, ListChecks,
  MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Save, Search, SkipForward, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {Button, Chip, ChoiceCards, DifficultyChip, EmptyState, Field, Modal, PillSelect, Segmented, Select, Skeleton, Stepper, TextArea, TextInput, ToggleChips, TopicChip} from '../ui';
import {Markdown} from '../../lib/markdown';
import {
  downloadText, materialToMarkdown, tutorApi, type Deck, type GenKind, type GenerateSource, type NotesDoc,
  type PracticeQuestion, type PracticeResult, type PracticeSet, type SavedCounts, type SavedItem, type SavedKind, type StudyMaterial,
  type StudyPlan, type TutorContext, type TutorCourse, type TutorMode, type TutorUpload,
} from '../../lib/tutor';
import {useSession} from '../../store/session';

export type ToolState =
  | {kind: 'flashcards'; data: Deck; savedId?: number; request?: GenRequest}
  | {kind: 'practice'; data: PracticeSet; savedId?: number; request?: GenRequest; setId?: number}
  | {kind: 'material'; data: StudyMaterial; savedId?: number; request?: GenRequest}
  | {kind: 'plan'; data: StudyPlan; savedId?: number; request?: GenRequest; planId?: number}
  | {kind: 'notes'; data: NotesDoc; savedId?: number; request?: undefined};

/** Turn a generate reply into the tool to show. Practice sets and plans are
 * already stored (unsaved) on the server, so later saves adopt them by id. */
export function toolFromResult(request: GenRequest, result: {kind: GenKind; data: unknown; set_id?: number; plan_id?: number}): ToolState {
  if (result.kind === 'practice') return {kind: 'practice', data: result.data as PracticeSet, request, setId: result.set_id};
  if (result.kind === 'plan') return {kind: 'plan', data: result.data as StudyPlan, request, planId: result.plan_id};
  return {kind: result.kind, data: result.data, request} as ToolState;
}

export interface GenRequest {
  kind: GenKind;
  count?: number;
  difficulty?: string;
  types?: string[];
  source: GenerateSource;
  instructions?: string;
}

export type AskFn = (prompt: string, mode?: TutorMode, context?: TutorContext, label?: string) => void;

const errorText = (error: unknown) => (error as Error).message || 'Something went wrong.';

function ToolHeader({title, subtitle, onBack, children}: {title: string; subtitle?: string; onBack: () => void; children?: React.ReactNode}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/8 pb-3">
      <button onClick={onBack} className="grid size-9 shrink-0 place-items-center rounded-lg text-mist-300 hover:bg-white/8" aria-label="Back to chat">
        <ArrowLeft className="size-5" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.95rem] font-extrabold text-mist-50">{title}</p>
        {subtitle && <p className="truncate text-[0.74rem] font-medium text-mist-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------- generate sheet */
type SourceChoice = 'chat' | 'topic' | 'upload' | 'text';

export function GenerateSheet({
  open, onClose, initialKind, initialCount, conversationId, courses, uploads, courseId, topic, selectedText, onResult,
}: {
  open: boolean;
  onClose: () => void;
  initialKind: GenKind;
  initialCount?: number | null;
  conversationId: number | null;
  courses: TutorCourse[];
  uploads: TutorUpload[];
  courseId: number | null;
  topic: string;
  selectedText?: string;
  onResult: (tool: ToolState, remaining: number) => void;
}) {
  const {toast} = useSession();
  const [kind, setKind] = useState<GenKind>(initialKind);
  const [source, setSource] = useState<SourceChoice>('topic');
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState('mixed');
  const [types, setTypes] = useState<string[]>(['mcq', 'true_false']);
  const [course, setCourse] = useState<number | null>(courseId);
  const [topicName, setTopicName] = useState(topic);
  const [uploadId, setUploadId] = useState<number | null>(uploads[0]?.id ?? null);
  const [text, setText] = useState(selectedText ?? '');
  const [instructions, setInstructions] = useState('');
  const [examDate, setExamDate] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setCourse(courseId);
    setTopicName(topic);
    setText(selectedText ?? '');
    setSource(selectedText ? 'text' : conversationId ? 'chat' : topic || courseId ? 'topic' : uploads.length ? 'upload' : 'text');
    setCount(initialCount || (initialKind === 'flashcards' ? 15 : 8));
    if (initialKind === 'plan') setSource('topic');
  }, [open, initialKind, initialCount, courseId, topic, selectedText, conversationId, uploads.length]);

  const topics = courses.find((c) => c.id === course)?.topics ?? [];
  const max = kind === 'flashcards' ? 50 : 20;

  const run = async () => {
    const src: GenerateSource = {course_id: course};
    if (kind === 'plan') {
      src.topic = topicName.trim() || undefined;
      src.plan = {exam_date: examDate || undefined, minutes_per_day: minutes, topics: topicName.trim() || undefined};
      const request: GenRequest = {kind, source: src, instructions: instructions.trim() || undefined};
      setBusy(true);
      try {
        const result = await tutorApi.generate(request);
        onResult(toolFromResult(request, result), result.remaining_today);
        onClose();
      } catch (error) {
        toast('error', 'Could not make the plan', errorText(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (source === 'chat' && conversationId) src.conversation_id = conversationId;
    if (source === 'topic') {
      if (!topicName.trim() && !course) return toast('error', 'Pick a course or type a topic');
      src.topic = topicName.trim();
    }
    if (source === 'upload') {
      if (!uploadId) return toast('error', 'Upload a document first');
      src.upload_id = uploadId;
      src.topic = topicName.trim() || undefined;
    }
    if (source === 'text') {
      if (text.trim().length < 20) return toast('error', 'Paste a bit more text', 'At least a sentence or two.');
      src.selected_text = text.trim().slice(0, 6000);
    }
    const request: GenRequest = {kind, count: kind === 'material' ? undefined : Math.min(max, Math.max(kind === 'flashcards' ? 5 : 3, count)), difficulty, types: kind === 'practice' ? types : undefined, source: src, instructions: instructions.trim() || undefined};
    setBusy(true);
    try {
      const result = await tutorApi.generate(request);
      onResult(toolFromResult(request, result), result.remaining_today);
      onClose();
    } catch (error) {
      toast('error', 'Could not generate', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Create with AI"
      subtitle="Nothing is saved until you choose Save."
      icon={Sparkles}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button icon={<Sparkles className="size-4" />} loading={busy} onClick={run}>
            {busy ? 'Creating…' : `Create ${kind === 'flashcards' ? 'flashcards' : kind === 'practice' ? 'practice' : kind === 'plan' ? 'plan' : 'material'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented<GenKind>
          value={kind}
          onChange={(value) => {
            setKind(value);
            setCount(value === 'flashcards' ? 15 : 8);
          }}
          options={[
            {value: 'flashcards', label: 'Flashcards', icon: Layers},
            {value: 'practice', label: 'Practice me', icon: ListChecks},
            {value: 'material', label: 'Material', icon: BookOpen},
            {value: 'plan', label: 'Plan', icon: CalendarCheck},
          ]}
        />
        {kind === 'plan' ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Course">
                <Select value={course ?? ''} onChange={(e) => setCourse(Number(e.target.value) || null)}>
                  <option value="">All my courses</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
                </Select>
              </Field>
              <Field label="Exam date (optional)">
                <TextInput type="date" value={examDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setExamDate(e.target.value)} />
              </Field>
              <Field label="Minutes per day">
                <PillSelect
                  aria-label="Minutes per day"
                  value={String(minutes)}
                  onChange={(m) => setMinutes(Number(m))}
                  options={[30, 45, 60, 90, 120, 180].map((m) => ({value: String(m), label: m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`}))}
                />
              </Field>
              <Field label="Focus topics (optional)">
                <TextInput list="tutor-gen-topics" value={topicName} onChange={(e) => setTopicName(e.target.value)} placeholder="Leave empty to use your weak topics" maxLength={200} />
                <datalist id="tutor-gen-topics">{topics.map((t) => <option key={t.id} value={t.name} />)}</datalist>
              </Field>
            </div>
            <p className="flex gap-2.5 rounded-xl border border-nova-400/20 bg-nova-500/[0.08] px-3.5 py-2.5 text-[0.76rem] leading-snug text-mist-300">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-nova-300" />
              The plan uses your results — weak topics get more time, and the last day before the exam is for revision.
            </p>
          </div>
        ) : (
        <div>
          <p className="mb-1.5 text-[0.8rem] font-semibold text-mist-200">Make it from</p>
          <ChoiceCards<SourceChoice>
            value={source}
            onChange={setSource}
            options={[
              {value: 'chat', label: 'This chat', description: conversationId ? 'What we just discussed' : 'Start a chat first', icon: MessageSquare, disabled: !conversationId},
              {value: 'topic', label: 'Course / topic', description: 'Official course material', icon: GraduationCap},
              {value: 'upload', label: 'My upload', description: uploads.length ? `${uploads.length} document${uploads.length === 1 ? '' : 's'}` : 'No uploads yet', icon: Upload, disabled: !uploads.length},
              {value: 'text', label: 'Pasted text', description: 'Notes you paste in', icon: ClipboardPaste},
            ]}
          />
        </div>
        )}
        {kind !== 'plan' && (source === 'topic' || source === 'upload') && (
          <div className="grid gap-2 sm:grid-cols-2">
            {source === 'upload' ? (
              <Field label="Document">
                <Select value={uploadId ?? ''} onChange={(e) => setUploadId(Number(e.target.value) || null)}>
                  {uploads.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="Course">
                <Select value={course ?? ''} onChange={(e) => setCourse(Number(e.target.value) || null)}>
                  <option value="">Any course</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
                </Select>
              </Field>
            )}
            <Field label={source === 'upload' ? 'Focus (optional)' : 'Topic'}>
              <TextInput list="tutor-gen-topics" value={topicName} onChange={(e) => setTopicName(e.target.value)} placeholder="e.g. Negligence, chapter 4" maxLength={120} />
              <datalist id="tutor-gen-topics">{topics.map((t) => <option key={t.id} value={t.name} />)}</datalist>
            </Field>
          </div>
        )}
        {kind !== 'plan' && source === 'text' && (
          <Field label="Text to use" aside={`${text.length.toLocaleString()} / 6,000`}>
            <TextArea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste notes, a paragraph from your material…" maxLength={6000} className="max-h-64 min-h-28 text-[0.86rem] leading-relaxed" />
          </Field>
        )}
        {kind !== 'material' && kind !== 'plan' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="How many" aside={`${kind === 'flashcards' ? 5 : 3}–${max}`}>
              <Stepper value={count} onChange={setCount} min={kind === 'flashcards' ? 5 : 3} max={max} suffix={kind === 'flashcards' ? 'cards' : 'questions'} aria-label="How many" />
            </Field>
            <Field label="Difficulty">
              <PillSelect aria-label="Difficulty" value={difficulty} onChange={setDifficulty} options={['mixed', 'easy', 'medium', 'hard'].map((d) => ({value: d, label: d[0].toUpperCase() + d.slice(1)}))} />
            </Field>
          </div>
        )}
        {kind === 'practice' && (
          <Field label="Question types">
            <ToggleChips
              values={types}
              onChange={setTypes}
              min={1}
              options={[
                {value: 'mcq', label: 'Multiple choice'},
                {value: 'true_false', label: 'True / False'},
                {value: 'short_answer', label: 'Short answer'},
                {value: 'calculation', label: 'Calculation'},
                {value: 'scenario', label: 'Scenario'},
              ]}
            />
          </Field>
        )}
        <Field label="Anything else? (optional)">
          <TextInput value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. focus on case names, keep it short" maxLength={300} />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ save helper */
function useSaver(kind: SavedKind, savedId: number | undefined, onSaved: (id: number) => void, meta: {course_id?: number | null; topic?: string; conversation_id?: number | null}, adopt?: {set_id?: number; plan_id?: number}) {
  const {toast} = useSession();
  const [busy, setBusy] = useState(false);
  const save = async (title: string, data?: object) => {
    setBusy(true);
    try {
      if (savedId) {
        await tutorApi.updateSaved(kind, savedId, {title, data});
        toast('success', 'Changes saved');
      } else {
        const item = await tutorApi.save({kind, title, data, ...meta, ...(adopt ?? {})});
        onSaved(item.id);
        toast('success', 'Saved to My AI Resources');
      }
    } catch (error) {
      toast('error', 'Could not save', errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return {save, busy};
}

interface ViewProps<T> {
  data: T;
  savedId?: number;
  request?: GenRequest;
  meta: {course_id?: number | null; topic?: string; conversation_id?: number | null};
  onBack: () => void;
  onSaved: (id: number) => void;
  onChange: (data: T) => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
  onDeleted: () => void;
  onAsk: AskFn;
  /** open another generated tool (remediation, flashcards from mistakes…) */
  onOpenTool?: (tool: ToolState, remaining: number) => void;
  /** open the generate sheet with this text as the source */
  onGenFrom?: (kind: GenKind, text: string) => void;
}

function DeleteButton({kind, savedId, onDeleted, label = 'Delete'}: {kind: SavedKind; savedId?: number; onDeleted: () => void; label?: string}) {
  const {toast} = useSession();
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<Trash2 className="size-4" />}
      onClick={async () => {
        if (!savedId) return onDeleted();
        if (!window.confirm('Delete this from My AI Resources?')) return;
        try {
          await tutorApi.deleteSaved(kind, savedId);
          toast('success', 'Deleted');
          onDeleted();
        } catch (error) {
          toast('error', 'Could not delete', errorText(error));
        }
      }}
    >
      <span className="hidden sm:inline">{savedId ? label : 'Discard'}</span>
    </Button>
  );
}

/* ------------------------------------------------------------ flashcards */
export function DeckView({data, savedId, meta, onBack, onSaved, onChange, onRegenerate, regenerating, onDeleted, onAsk}: ViewProps<Deck>) {
  const [studying, setStudying] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const {save, busy} = useSaver('flashcards', savedId, onSaved, meta);
  const cards = data.cards;
  const setCard = (i: number, patch: Partial<Deck['cards'][number]>) => onChange({...data, cards: cards.map((c, j) => (j === i ? {...c, ...patch} : c))});

  if (studying) return <FlashcardStudy deck={data} saved={!!savedId} onBack={() => setStudying(false)} onAsk={onAsk} onChange={onChange} />;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ToolHeader title={data.title} subtitle={`${cards.length} flashcards${savedId ? ` · saved${dueCount(data) ? ` · ${dueCount(data)} due` : ''}` : ' · not saved yet'}`} onBack={onBack}>
        <Button size="sm" variant="mint" icon={<Layers className="size-4" />} onClick={() => setStudying(true)} disabled={!cards.length}>Study</Button>
        <Button size="sm" variant="soft" icon={<Save className="size-4" />} loading={busy} onClick={() => save(data.title, data)}>{savedId ? 'Save' : 'Save deck'}</Button>
      </ToolHeader>
      <div className="flex flex-wrap items-center gap-1.5">
        <TextInput value={data.title} onChange={(e) => onChange({...data, title: e.target.value})} className="min-w-0 flex-1 !h-9 text-[0.85rem]" aria-label="Deck title" maxLength={140} />
        <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => downloadText(`${data.title}.md`, `# ${data.title}\n\n` + cards.map((c, i) => `${i + 1}. **${c.front}**\n   ${c.back}`).join('\n\n'))}>
          <span className="hidden sm:inline">Download</span>
        </Button>
        {onRegenerate && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={regenerating} onClick={onRegenerate}><span className="hidden sm:inline">Regenerate</span></Button>}
        <DeleteButton kind="flashcards" savedId={savedId} onDeleted={onDeleted} />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {cards.map((card, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            {editing === i ? (
              <div className="space-y-2">
                <TextArea rows={2} value={card.front} onChange={(e) => setCard(i, {front: e.target.value})} aria-label="Front" />
                <TextArea rows={3} value={card.back} onChange={(e) => setCard(i, {back: e.target.value})} aria-label="Back" />
                <div className="flex justify-end"><Button size="sm" variant="soft" icon={<Check className="size-4" />} onClick={() => setEditing(null)}>Done</Button></div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-nova-500/20 text-[0.7rem] font-extrabold text-nova-200">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.86rem] font-bold text-mist-50">{card.front}</p>
                  <p className="mt-1 text-[0.82rem] text-mist-300">{card.back}</p>
                  {(card.topic || card.difficulty) && <p className="mt-1 text-[0.68rem] font-semibold tracking-wide text-mist-500 uppercase">{[card.topic, card.difficulty].filter(Boolean).join(' · ')}</p>}
                </div>
                <button className="grid size-8 place-items-center rounded-md text-mist-400 hover:bg-white/8" aria-label="Edit card" onClick={() => setEditing(i)}><Pencil className="size-4" /></button>
                <button className="grid size-8 place-items-center rounded-md text-mist-400 hover:bg-flare-500/15 hover:text-flare-300" aria-label="Delete card" onClick={() => onChange({...data, cards: cards.filter((_, j) => j !== i)})}><X className="size-4" /></button>
              </div>
            )}
          </div>
        ))}
        <button
          onClick={() => {
            onChange({...data, cards: [...cards, {front: '', back: ''}]});
            setEditing(cards.length);
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 py-2.5 text-[0.8rem] font-bold text-mist-400 hover:bg-white/[0.04]"
        >
          <Plus className="size-4" /> Add a card
        </button>
      </div>
    </div>
  );
}

const isDue = (card: Deck['cards'][number]) => !card.next_review_at || new Date(card.next_review_at).getTime() <= Date.now();
const dueCount = (deck: Deck) => deck.cards.filter((c) => c.id && isDue(c)).length;

/** Study mode: reveal, then "I know" / "I don't know". On saved decks every
 * answer is recorded and the next review is scheduled (spaced repetition). */
function FlashcardStudy({deck, saved, onBack, onAsk, onChange}: {deck: Deck; saved: boolean; onBack: () => void; onAsk: AskFn; onChange: (deck: Deck) => void}) {
  const {toast} = useSession();
  const [onlyDue, setOnlyDue] = useState(() => saved && dueCount(deck) > 0 && dueCount(deck) < deck.cards.length);
  const start = (due: boolean) => deck.cards.map((_, i) => i).filter((i) => deck.cards[i].front && deck.cards[i].back && (!due || isDue(deck.cards[i])));
  const [queue, setQueue] = useState(() => start(onlyDue));
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [again, setAgain] = useState(0);
  const total = onlyDue ? start(true).length || queue.length : deck.cards.length;
  const current = queue[0];
  const card = current === undefined ? null : deck.cards[current];
  const answer = (gotIt: boolean) => {
    setFlipped(false);
    if (saved && card?.id) {
      const index = current;
      tutorApi.reviewCard(card.id, gotIt ? 'know' : 'dont_know')
        .then((r) => onChange({...deck, cards: deck.cards.map((c, j) => (j === index ? {...c, next_review_at: r.next_review_at, interval_days: r.interval_days} : c))}))
        .catch((error) => toast('error', 'Review not recorded', errorText(error)));
    }
    if (gotIt) {
      setKnown((k) => k + 1);
      setQueue((q) => q.slice(1));
    } else {
      setAgain((a) => a + 1);
      setQueue((q) => [...q.slice(1), q[0]]);
    }
  };
  const restart = (due: boolean) => {
    setOnlyDue(due);
    setQueue(start(due));
    setKnown(0);
    setAgain(0);
    setFlipped(false);
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ToolHeader title={deck.title} subtitle={`${known}/${total} known · ${again} to repeat${onlyDue ? ' · due cards' : ''}`} onBack={onBack}>
        {saved && <Button size="sm" variant="ghost" onClick={() => restart(!onlyDue)}>{onlyDue ? 'Study all' : 'Due only'}</Button>}
      </ToolHeader>
      {card ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <button
            onClick={() => setFlipped((f) => !f)}
            className={`flex min-h-[13rem] w-full max-w-lg flex-col items-center justify-center rounded-2xl border p-5 text-center transition-colors ${flipped ? 'border-mint-400/40 bg-mint-500/10' : 'border-nova-400/40 bg-nova-500/10'}`}
          >
            <span className="mb-2 text-[0.66rem] font-extrabold tracking-[0.18em] text-mist-500">{flipped ? 'ANSWER' : 'QUESTION'} · TAP TO FLIP</span>
            <span className={`${flipped ? 'text-[0.95rem] text-mist-100' : 'text-[1.05rem] font-extrabold text-mist-50'}`}>{flipped ? card.back : card.front}</span>
          </button>
          {flipped ? (
            <div className="flex w-full max-w-lg gap-2">
              <Button block variant="outline" icon={<RotateCcw className="size-4" />} onClick={() => answer(false)}>I don't know</Button>
              <Button block variant="mint" icon={<Check className="size-4" />} onClick={() => answer(true)}>I know</Button>
            </div>
          ) : (
            <Button variant="soft" onClick={() => setFlipped(true)}>Reveal answer</Button>
          )}
          <button className="text-[0.78rem] font-bold text-nova-300 hover:underline" onClick={() => onAsk(`Explain this flashcard in more depth:\nQ: ${card.front}\nA: ${card.back}`, 'EXPLAIN')}>
            <HelpCircle className="mr-1 inline size-3.5" />Explain this card
          </button>
          {!saved && <p className="text-center text-[0.72rem] text-mist-500">Save the deck to track reviews and get reminders when cards are due.</p>}
        </div>
      ) : (
        <EmptyState
          icon={<Check className="size-6" />}
          title="Deck complete!"
          detail={`You knew all ${known} cards${again ? ` (repeated ${again})` : ''}.${saved ? ' Cards you knew come back later for review.' : ''}`}
          action={<div className="flex gap-2"><Button size="sm" variant="soft" onClick={() => restart(false)}>Study again</Button><Button size="sm" onClick={onBack}>Back to deck</Button></div>}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- AI quiz */
interface QuizAnswer {
  picked: string;
  correct: boolean;
}

const norm = (value: string) => value.trim().toLowerCase().replace(/[^\w]+/g, ' ');

export function QuizView({data, savedId, setId, meta, onBack, onSaved, onChange, onRegenerate, regenerating, onDeleted, onAsk, onOpenTool}: ViewProps<PracticeSet> & {setId?: number}) {
  const {toast} = useSession();
  const {save, busy} = useSaver('practice', savedId, onSaved, meta, setId && !savedId ? {set_id: setId} : undefined);
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [extraBusy, setExtraBusy] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, QuizAnswer>>({});
  const [draft, setDraft] = useState('');
  const [revealed, setRevealed] = useState(false);
  const questions = data.questions;
  const q: PracticeQuestion | undefined = questions[index];
  const finished = index >= questions.length;
  const score = Object.values(answers).filter((a) => a.correct).length;

  const identity = `${setId ?? savedId ?? ''}|${data.questions[0]?.question ?? ''}`;
  useEffect(() => {
    setIndex(0);
    setAnswers({});
    setRevealed(false);
    setDraft('');
    setResult(null);
  }, [identity]);

  // record the finished attempt on the server (progress + weak topics)
  const serverId = savedId ?? setId;
  useEffect(() => {
    if (!finished || !serverId || result) return;
    const rows = questions.map((row, i) => ({question_id: row.id ?? 0, correct: Boolean(answers[i]?.correct)})).filter((r, i) => r.question_id && answers[i]);
    if (!rows.length) return;
    tutorApi.practiceResults(serverId, rows).then(setResult).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, serverId]);

  const tryAnother = async (row: PracticeQuestion) => {
    setExtraBusy('similar');
    try {
      const reply = await tutorApi.generate({kind: 'practice', count: 1, source: {course_id: meta.course_id, topic: row.topic || meta.topic || undefined, similar_to: {question: row.question}}, types: [row.type]});
      const fresh = (reply.data as PracticeSet).questions[0];
      if (!fresh) throw new Error('No question came back.');
      onChange({...data, questions: [...questions.slice(0, index + 1), fresh, ...questions.slice(index + 1)]});
      next();
    } catch (error) {
      toast('error', 'Could not make another question', errorText(error));
    } finally {
      setExtraBusy(null);
    }
  };
  const remediate = async (kind: 'practice' | 'flashcards') => {
    const missed = questions.filter((_, i) => answers[i] && !answers[i].correct).map((row) => row.question);
    if (!missed.length) return;
    setExtraBusy(kind);
    try {
      const request = {kind, count: kind === 'flashcards' ? Math.min(20, missed.length * 3) : Math.min(10, Math.max(3, missed.length * 2)), source: {course_id: meta.course_id, topic: weak[0]?.[0], missed}} as GenRequest;
      const reply = await tutorApi.generate(request);
      onOpenTool?.(toolFromResult(request, reply), reply.remaining_today);
    } catch (error) {
      toast('error', 'Could not create it', errorText(error));
    } finally {
      setExtraBusy(null);
    }
  };
  const hint = (row: PracticeQuestion) =>
    onAsk('Give me a hint for this question. Do not tell me the answer.', 'HINT', {selected_text: `Question: ${row.question}${row.options.length ? `\nOptions: ${row.options.join(' | ')}` : ''}`, topic: row.topic || undefined}, 'Practice question');

  const weak = useMemo(() => {
    const misses: Record<string, number> = {};
    questions.forEach((row, i) => {
      if (answers[i] && !answers[i].correct) misses[row.topic || 'General'] = (misses[row.topic || 'General'] ?? 0) + 1;
    });
    return Object.entries(misses).sort((a, b) => b[1] - a[1]);
  }, [answers, questions]);

  const pick = (option: string) => {
    if (!q || answers[index]) return;
    setAnswers({...answers, [index]: {picked: option, correct: norm(option) === norm(q.correct_answer)}});
  };
  const next = () => {
    setIndex((i) => i + 1);
    setDraft('');
    setRevealed(false);
  };
  const askWhy = (row: PracticeQuestion, picked?: string) =>
    onAsk(
      picked && norm(picked) !== norm(row.correct_answer) ? 'Why is my answer wrong?' : 'Why is this the answer?',
      'WHY_WRONG',
      {selected_text: `Question: ${row.question}\n${row.options.length ? `Options: ${row.options.join(' | ')}\n` : ''}My answer: ${picked || '(none)'}\nCorrect answer: ${row.correct_answer}\nExplanation given: ${row.explanation}`, topic: row.topic || undefined},
      'Practice question',
    );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ToolHeader title={data.title} subtitle={finished ? 'Quiz finished' : `Question ${index + 1} of ${questions.length} · score ${score}`} onBack={onBack}>
        <Button size="sm" variant="soft" icon={<Save className="size-4" />} loading={busy} onClick={() => save(data.title, data)} disabled={Boolean(savedId) && !questions.some((row) => !row.id)}>{savedId ? 'Saved' : 'Save set'}</Button>
        {onRegenerate && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={regenerating} onClick={onRegenerate}><span className="hidden sm:inline">New set</span></Button>}
        <DeleteButton kind="practice" savedId={savedId} onDeleted={onDeleted} />
      </ToolHeader>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className="brand-gradient h-full transition-all" style={{width: `${(Math.min(index, questions.length) / Math.max(1, questions.length)) * 100}%`}} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {!finished && q ? (
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <Chip tone="nova">{q.type.replace('_', ' ')}</Chip>
              <TopicChip topic={q.topic} />
              <DifficultyChip level={q.difficulty} />
            </div>
            <p className="text-[1rem] leading-relaxed font-bold text-mist-50">{q.question}</p>
            {q.options.length ? (
              <div className="space-y-2">
                {q.options.map((option, i) => {
                  const done = answers[index];
                  const isRight = norm(option) === norm(q.correct_answer);
                  const state = !done ? 'border-white/10 bg-white/[0.03] text-mist-100' : isRight ? 'border-mint-400/70 bg-mint-500/15 text-mint-100' : done.picked === option ? 'border-flare-400/70 bg-flare-500/15 text-flare-100' : 'border-white/10 bg-white/[0.03] text-mist-100 opacity-60';
                  return (
                    <button key={i} disabled={!!done} onClick={() => pick(option)} className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[0.88rem] transition-colors enabled:hover:bg-white/[0.07] ${state}`}>
                      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white/10 text-[0.72rem] font-extrabold">{'ABCDEF'[i]}</span>
                      <span className="min-w-0 flex-1">{option}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <TextArea rows={q.type === 'short_answer' ? 3 : 5} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={q.type === 'calculation' ? 'Show your working…' : 'Type your answer…'} disabled={revealed} />
                {!revealed ? (
                  <Button size="sm" variant="soft" onClick={() => setRevealed(true)}>Check answer</Button>
                ) : (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-[0.7rem] font-extrabold tracking-[0.14em] text-mist-500">MODEL ANSWER</p>
                    <p className="mt-1 text-[0.88rem] text-mist-100">{q.correct_answer}</p>
                    {!answers[index] && (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline" icon={<X className="size-4" />} onClick={() => setAnswers({...answers, [index]: {picked: draft, correct: false}})}>I missed it</Button>
                        <Button size="sm" variant="mint" icon={<Check className="size-4" />} onClick={() => setAnswers({...answers, [index]: {picked: draft, correct: true}})}>I got it</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {answers[index] && (
              <div className={`rounded-xl border p-3 ${answers[index].correct ? 'border-mint-400/30 bg-mint-500/10' : 'border-flare-400/30 bg-flare-500/10'}`}>
                <p className="text-[0.86rem] font-extrabold text-mist-50">{answers[index].correct ? 'Correct!' : `Not quite — the answer is: ${q.correct_answer}`}</p>
                {q.explanation && <p className="mt-1 text-[0.84rem] text-mist-200">{q.explanation}</p>}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" icon={index + 1 >= questions.length ? <Check className="size-4" /> : <ChevronRight className="size-4" />} onClick={next}>
                    {index + 1 >= questions.length ? 'See results' : 'Next question'}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<HelpCircle className="size-4" />} onClick={() => askWhy(q, answers[index].picked)}>{answers[index].correct ? 'Why?' : 'Why wrong?'}</Button>
                  {!answers[index].correct && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={extraBusy === 'similar'} onClick={() => tryAnother(q)}>Try another</Button>}
                </div>
              </div>
            )}
            {!answers[index] && !revealed && (
              <button className="mr-3 text-[0.76rem] font-bold text-nova-300 hover:underline" onClick={() => hint(q)}>
                <HelpCircle className="mr-0.5 inline size-3.5" />Hint
              </button>
            )}
            {index > 0 && !answers[index] && (
              <button className="text-[0.76rem] font-bold text-mist-500 hover:text-mist-300" onClick={() => setIndex(index - 1)}>
                <ChevronLeft className="mr-0.5 inline size-3.5" />Previous
              </button>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
              <p className="text-[0.72rem] font-extrabold tracking-[0.16em] text-mist-500">YOUR SCORE</p>
              <p className="mt-1 text-3xl font-extrabold text-mist-50">{score}/{questions.length}</p>
              <p className="text-[0.84rem] text-mist-400">{Math.round((score / Math.max(1, questions.length)) * 100)}% correct</p>
            </div>
            {result && result.attempts > 1 && (
              <p className="text-center text-[0.76rem] text-mist-400">Attempt {result.attempts} · best {result.best}%</p>
            )}
            {weak.length > 0 && (
              <div className="rounded-xl border border-flare-400/25 bg-flare-500/[0.07] p-3">
                <p className="text-[0.8rem] font-extrabold text-mist-50">Work on these</p>
                <div className="mt-1.5 mb-2 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="soft" icon={<ListChecks className="size-4" />} loading={extraBusy === 'practice'} onClick={() => remediate('practice')}>Practice my mistakes</Button>
                  <Button size="sm" variant="ghost" icon={<Layers className="size-4" />} loading={extraBusy === 'flashcards'} onClick={() => remediate('flashcards')}>Flashcards for them</Button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {weak.map(([topic, n]) => (
                    <button key={topic} onClick={() => onAsk(`Teach me ${topic} — I keep getting it wrong.`, 'TEACH', {topic})} className="rounded-full border border-flare-400/30 px-2.5 py-1 text-[0.74rem] font-bold text-flare-100 hover:bg-flare-500/15">
                      {topic} · {n} missed
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              {questions.map((row, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-white/8 px-3 py-2">
                  {answers[i]?.correct ? <Check className="mt-0.5 size-4 shrink-0 text-mint-300" /> : <X className="mt-0.5 size-4 shrink-0 text-flare-300" />}
                  <p className="min-w-0 flex-1 text-[0.82rem] text-mist-200">{row.question}</p>
                  {!answers[i]?.correct && <button className="shrink-0 text-[0.74rem] font-bold text-nova-300 hover:underline" onClick={() => askWhy(row, answers[i]?.picked)}>Why?</button>}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="soft" icon={<RotateCcw className="size-4" />} onClick={() => { setIndex(0); setAnswers({}); setRevealed(false); setDraft(''); }}>Retry</Button>
              {onRegenerate && <Button size="sm" icon={<Sparkles className="size-4" />} loading={regenerating} onClick={onRegenerate}>New questions</Button>}
              <Button size="sm" variant="ghost" onClick={() => onAsk(`I scored ${score}/${questions.length} on "${data.title}". ${weak.length ? `I missed questions on ${weak.map((w) => w[0]).join(', ')}.` : ''} What should I focus on next?`, 'WHAT_TO_STUDY')}>What next?</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- study material */
export function MaterialView({data, savedId, meta, onBack, onSaved, onChange, onRegenerate, regenerating, onDeleted, onAsk, onGenFrom}: ViewProps<StudyMaterial>) {
  const {save, busy} = useSaver('material', savedId, onSaved, meta);
  const [editing, setEditing] = useState(false);
  const list = (title: string, items?: string[]) =>
    items?.length ? (
      <section>
        <p className="mb-1 text-[0.95rem] font-extrabold text-mist-50">{title}</p>
        <ul className="list-disc space-y-1 pl-5 text-[0.88rem] text-mist-200 marker:text-nova-300">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </section>
    ) : null;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ToolHeader title={data.title} subtitle={savedId ? 'Saved study material' : 'Not saved yet'} onBack={onBack}>
        <Button size="sm" variant={editing ? 'mint' : 'ghost'} icon={editing ? <Check className="size-4" /> : <Pencil className="size-4" />} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</Button>
        <Button size="sm" variant="soft" icon={<Save className="size-4" />} loading={busy} onClick={() => save(data.title, data)}>Save</Button>
      </ToolHeader>
      <div className="flex flex-wrap gap-1.5">
        {onGenFrom && <Button size="sm" variant="ghost" icon={<Layers className="size-4" />} onClick={() => onGenFrom('flashcards', materialToMarkdown(data))}>Flashcards</Button>}
        {onGenFrom && <Button size="sm" variant="ghost" icon={<ListChecks className="size-4" />} onClick={() => onGenFrom('practice', materialToMarkdown(data))}>Practice</Button>}
        <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => downloadText(`${data.title}.md`, materialToMarkdown(data))}>Download</Button>
        {onRegenerate && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={regenerating} onClick={onRegenerate}>Regenerate</Button>}
        <DeleteButton kind="material" savedId={savedId} onDeleted={onDeleted} />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        {editing ? (
          <div className="space-y-3">
            <Field label="Title"><TextInput value={data.title} onChange={(e) => onChange({...data, title: e.target.value})} maxLength={160} /></Field>
            <Field label="Overview"><TextArea rows={3} value={data.overview ?? ''} onChange={(e) => onChange({...data, overview: e.target.value})} /></Field>
            {data.sections.map((s, i) => (
              <div key={i} className="space-y-1.5 rounded-xl border border-white/10 p-2.5">
                <div className="flex gap-1.5">
                  <TextInput value={s.heading} onChange={(e) => onChange({...data, sections: data.sections.map((x, j) => (j === i ? {...x, heading: e.target.value} : x))})} className="min-w-0 flex-1" aria-label="Section heading" />
                  <button className="grid size-10 place-items-center rounded-md text-mist-400 hover:text-flare-300" aria-label="Remove section" onClick={() => onChange({...data, sections: data.sections.filter((_, j) => j !== i)})}><Trash2 className="size-4" /></button>
                </div>
                <TextArea rows={6} value={s.content} onChange={(e) => onChange({...data, sections: data.sections.map((x, j) => (j === i ? {...x, content: e.target.value} : x))})} aria-label="Section text" />
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => onChange({...data, sections: [...data.sections, {heading: 'New section', content: ''}]})}>Add section</Button>
            <Field label="Summary"><TextArea rows={3} value={data.summary ?? ''} onChange={(e) => onChange({...data, summary: e.target.value})} /></Field>
          </div>
        ) : (
          <>
            {data.overview && <p className="text-[0.92rem] leading-relaxed text-mist-200">{data.overview}</p>}
            {list('Learning objectives', data.objectives)}
            {data.sections.map((s, i) => (
              <section key={i}>
                <p className="mb-1 text-[0.95rem] font-extrabold text-mist-50">{s.heading}</p>
                <Markdown text={s.content} />
                <button className="mt-1 text-[0.74rem] font-bold text-nova-300 hover:underline" onClick={() => onAsk(`Explain this part more simply:\n\n${s.heading}\n${s.content.slice(0, 2500)}`, 'SIMPLE', undefined, s.heading)}>Explain this</button>
              </section>
            ))}
            {data.definitions?.length ? (
              <section>
                <p className="mb-1 text-[0.95rem] font-extrabold text-mist-50">Key definitions</p>
                <dl className="space-y-1.5">{data.definitions.map((d, i) => <div key={i} className="rounded-lg bg-white/[0.04] px-3 py-2"><dt className="text-[0.86rem] font-extrabold text-nova-200">{d.term}</dt><dd className="text-[0.84rem] text-mist-200">{d.meaning}</dd></div>)}</dl>
              </section>
            ) : null}
            {list('Examples', data.examples)}
            {list('Common mistakes', data.common_mistakes)}
            {list('Exam tips', data.exam_tips)}
            {data.summary && <section><p className="mb-1 text-[0.95rem] font-extrabold text-mist-50">Summary</p><Markdown text={data.summary} /></section>}
            {data.practice_questions?.length ? (
              <section>
                <p className="mb-1 text-[0.95rem] font-extrabold text-mist-50">Practice questions</p>
                <div className="space-y-1.5">{data.practice_questions.map((q, i) => <details key={i} className="rounded-lg border border-white/8 px-3 py-2"><summary className="cursor-pointer text-[0.86rem] font-bold text-mist-100">{q.question}</summary><p className="mt-1 text-[0.84rem] text-mist-300">{q.answer}</p></details>)}</div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- notes/plan */
export function NotesView({data, savedId, meta, kind, onBack, onSaved, onChange, onDeleted, onGenFrom}: ViewProps<NotesDoc> & {kind: 'notes'}) {
  const {save, busy} = useSaver(kind, savedId, onSaved, meta);
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ToolHeader title={data.title} subtitle={savedId ? 'Saved notes' : 'Notes · not saved yet'} onBack={onBack}>
        <Button size="sm" variant={editing ? 'mint' : 'ghost'} icon={editing ? <Check className="size-4" /> : <Pencil className="size-4" />} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</Button>
        <Button size="sm" variant="soft" icon={<Save className="size-4" />} loading={busy} onClick={() => save(data.title, data)}>Save</Button>
        <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => downloadText(`${data.title}.md`, `# ${data.title}\n\n${data.content}`)}><span className="hidden sm:inline">Download</span></Button>
        {onGenFrom && <Button size="sm" variant="ghost" icon={<Layers className="size-4" />} onClick={() => onGenFrom('flashcards', data.content)}><span className="hidden sm:inline">Flashcards</span></Button>}
        <DeleteButton kind={kind} savedId={savedId} onDeleted={onDeleted} />
      </ToolHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {editing ? (
          <div className="space-y-2">
            <TextInput value={data.title} onChange={(e) => onChange({...data, title: e.target.value})} maxLength={200} aria-label="Title" />
            <TextArea rows={18} value={data.content} onChange={(e) => onChange({...data, content: e.target.value})} aria-label="Notes" />
          </div>
        ) : (
          <Markdown text={data.content} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ study plan */
export function PlanView({data, savedId, planId, meta, onBack, onSaved, onChange, onRegenerate, regenerating, onDeleted, onAsk}: ViewProps<StudyPlan> & {planId?: number}) {
  const {toast} = useSession();
  const id = savedId ?? planId;
  const {save, busy} = useSaver('plan', savedId, onSaved, meta, planId && !savedId ? {plan_id: planId} : undefined);
  const [moving, setMoving] = useState<number | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const progress = data.progress ?? {done: 0, total: data.days.reduce((n, d) => n + d.items.length, 0), skipped: 0};
  const update = async (itemId: number | undefined, body: {status?: string; date?: string}) => {
    if (!id || !itemId) return;
    try {
      const next = await tutorApi.updatePlanItem(id, itemId, body);
      if (next.data) onChange(next.data as StudyPlan);
    } catch (error) {
      toast('error', 'Could not update the plan', errorText(error));
    }
  };
  const fmt = (day: string) => {
    const d = new Date(`${day}T00:00:00`);
    return day === today ? 'Today' : d.toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'});
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ToolHeader title={data.title} subtitle={`${progress.done}/${progress.total} done${data.exam_date ? ` · exam ${fmt(data.exam_date)}` : ''}${savedId ? '' : ' · not saved yet'}`} onBack={onBack}>
        {!savedId && <Button size="sm" variant="soft" icon={<Save className="size-4" />} loading={busy} onClick={() => save(data.title)}>Save plan</Button>}
        {onRegenerate && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={regenerating} onClick={onRegenerate}><span className="hidden sm:inline">New plan</span></Button>}
        <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => downloadText(`${data.title}.md`, [`# ${data.title}`, data.overview ?? '', ...data.days.flatMap((d) => [`\n## ${d.date}`, ...d.items.map((i) => `- [${i.status === 'completed' ? 'x' : ' '}] ${i.topic}: ${i.activity} (${i.duration} min)`)])].join('\n'))}><span className="hidden sm:inline">Download</span></Button>
        <DeleteButton kind="plan" savedId={savedId} onDeleted={onDeleted} />
      </ToolHeader>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className="h-full bg-mint-400 transition-all" style={{width: `${(progress.done / Math.max(1, progress.total)) * 100}%`}} />
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
        {data.overview && <Markdown text={data.overview} />}
        {data.days.map((day) => (
          <section key={day.date}>
            <p className={`mb-1 text-[0.76rem] font-extrabold tracking-wide uppercase ${day.date === today ? 'text-nova-200' : day.date < today ? 'text-mist-600' : 'text-mist-400'}`}>{fmt(day.date)}</p>
            <div className="space-y-1.5">
              {day.items.map((item, i) => (
                <div key={item.id ?? i} className={`rounded-xl border px-3 py-2 ${item.status === 'completed' ? 'border-mint-400/25 bg-mint-500/[0.06]' : item.status === 'skipped' ? 'border-white/6 opacity-60' : 'border-white/10 bg-white/[0.03]'}`}>
                  <div className="flex items-start gap-2">
                    <button
                      disabled={!id || !item.id}
                      onClick={() => update(item.id, {status: item.status === 'completed' ? 'pending' : 'completed'})}
                      className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border ${item.status === 'completed' ? 'border-mint-400 bg-mint-500 text-ink-950' : 'border-white/25'}`}
                      aria-label={item.status === 'completed' ? 'Mark not done' : 'Mark done'}
                    >
                      {item.status === 'completed' && <Check className="size-3.5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[0.86rem] font-bold ${item.status === 'completed' ? 'text-mist-300 line-through' : 'text-mist-50'}`}>{item.topic}</p>
                      <p className="text-[0.8rem] text-mist-300">{item.activity} · {item.duration} min{item.status === 'skipped' ? ' · skipped' : ''}</p>
                    </div>
                    {id && item.id && item.status !== 'completed' && (
                      <div className="flex shrink-0 items-center">
                        <button className="grid size-8 place-items-center rounded-md text-mist-500 hover:bg-white/8 hover:text-mist-200" aria-label="Ask the tutor" title="Study this with the tutor" onClick={() => onAsk(`Help me with today's study task: ${item.activity} — topic: ${item.topic}.`, 'TEACH', {topic: item.topic})}><Sparkles className="size-4" /></button>
                        <button className="grid size-8 place-items-center rounded-md text-mist-500 hover:bg-white/8 hover:text-mist-200" aria-label="Move to another day" title="Reschedule" onClick={() => setMoving(moving === item.id ? null : item.id ?? null)}><CalendarClock className="size-4" /></button>
                        <button className="grid size-8 place-items-center rounded-md text-mist-500 hover:bg-white/8 hover:text-mist-200" aria-label={item.status === 'skipped' ? 'Undo skip' : 'Skip'} title={item.status === 'skipped' ? 'Undo skip' : 'Skip'} onClick={() => update(item.id, {status: item.status === 'skipped' ? 'pending' : 'skipped'})}><SkipForward className="size-4" /></button>
                      </div>
                    )}
                  </div>
                  {moving === item.id && (
                    <div className="mt-2 flex items-center gap-2 pl-7">
                      <TextInput type="date" min={today} defaultValue={day.date} className="!h-8 max-w-[11rem] text-[0.8rem]" onChange={(e) => { if (e.target.value) { void update(item.id, {date: e.target.value}); setMoving(null); } }} aria-label="New date" />
                      <button className="text-[0.74rem] font-bold text-mist-500" onClick={() => setMoving(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        {data.tips?.length ? (
          <section className="rounded-xl bg-white/[0.04] p-3">
            <p className="mb-1 text-[0.8rem] font-extrabold text-mist-50">Tips</p>
            <ul className="list-disc space-y-0.5 pl-5 text-[0.82rem] text-mist-300">{data.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- library */
const KIND_LABEL: Record<SavedKind, string> = {flashcards: 'Flashcards', practice: 'Practice', material: 'Materials', notes: 'Notes', plan: 'Study plans'};
const KIND_ICON: Record<SavedKind, typeof Layers> = {flashcards: Layers, practice: ListChecks, material: BookOpen, notes: FileText, plan: CalendarCheck};
const KIND_EMPTY: Record<SavedKind | 'all', string> = {
  all: 'Nothing saved yet. Save an answer, flashcards, a practice set or a study plan and it will appear here.',
  flashcards: 'No flashcards yet. Ask the tutor to make some from a topic, a chat or your notes.',
  practice: 'No practice sets yet. Tap "Practice me" to get questions on any topic.',
  material: 'No study materials yet. Create one from a topic or an upload.',
  notes: 'No notes yet. Tap Save under any answer to keep it as a note.',
  plan: 'No study plan yet. Tell the tutor your exam date and how long you can study each day.',
};

function itemMeta(item: SavedItem): string {
  const parts: string[] = [];
  if (item.kind === 'flashcards') parts.push(`${item.items} cards${item.due ? ` · ${item.due} due` : ''}`);
  else if (item.kind === 'practice') parts.push(`${item.items} questions${item.attempts ? ` · best ${item.best_score ?? 0}%` : ''}`);
  else if (item.kind === 'plan') parts.push(`${item.done ?? 0}/${item.items} done${item.exam_date ? ` · exam ${item.exam_date}` : ''}`);
  else if (item.items) parts.push(`${item.items} sections`);
  if (item.topic) parts.push(item.topic);
  return parts.join(' · ');
}

/** My AI Resources: everything the student saved, grouped by type, with
 * open / rename / duplicate / delete. Uploads live at the bottom. */
export function LibraryView({uploads, onBack, onOpen, onUpload, uploading, onUseUpload, onDeleteUpload}: {
  uploads: TutorUpload[];
  onBack: () => void;
  onOpen: (item: SavedItem) => void;
  onUpload: () => void;
  uploading: boolean;
  onUseUpload: (upload: TutorUpload) => void;
  onDeleteUpload: (upload: TutorUpload) => void;
}) {
  const {toast} = useSession();
  const [filter, setFilter] = useState<'all' | SavedKind>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [counts, setCounts] = useState<SavedCounts | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const load = useMemo(() => (kind: string, q: string) => {
    tutorApi.saved(kind, q).then((r) => {
      setItems(r.items);
      setCounts(r.counts);
    }).catch((error) => {
      setItems([]);
      toast('error', 'Could not load your resources', errorText(error));
    });
  }, [toast]);
  useEffect(() => {
    setItems(null);
    const t = window.setTimeout(() => load(filter === 'all' ? '' : filter, query.trim()), query ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [filter, query, load]);
  const reload = () => load(filter === 'all' ? '' : filter, query.trim());
  const act = async (item: SavedItem, action: 'rename' | 'duplicate' | 'delete') => {
    setMenu(null);
    try {
      if (action === 'rename') {
        const title = window.prompt('New name', item.title)?.trim();
        if (!title || title === item.title) return;
        await tutorApi.updateSaved(item.kind, item.id, {title});
      } else if (action === 'duplicate') {
        await tutorApi.duplicateSaved(item.kind, item.id);
        toast('success', 'Copy made');
      } else {
        if (!window.confirm(`Delete "${item.title}"?`)) return;
        await tutorApi.deleteSaved(item.kind, item.id);
        toast('success', 'Deleted');
      }
      reload();
    } catch (error) {
      toast('error', 'That did not work', errorText(error));
    }
  };
  const kinds: SavedKind[] = ['notes', 'material', 'flashcards', 'practice', 'plan'];
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <ToolHeader title="My AI Resources" subtitle="Notes, materials, flashcards, practice sets and study plans you saved" onBack={onBack} />
      <div className="no-scrollbar -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5">
        {(['all', ...kinds] as ('all' | SavedKind)[]).map((k) => {
          const n = k === 'all' ? (counts ? kinds.reduce((sum, x) => sum + (counts[x] ?? 0), 0) : null) : counts?.[k];
          const Icon = k === 'all' ? Sparkles : KIND_ICON[k];
          return (
            <button key={k} onClick={() => setFilter(k)} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.74rem] font-bold ${filter === k ? 'border-nova-400/70 bg-nova-500/20 text-white' : 'border-white/10 text-mist-400 hover:bg-white/[0.05]'}`}>
              <Icon className="size-3.5" />
              {k === 'all' ? 'All' : KIND_LABEL[k]}
              {n !== null && n !== undefined && <span className="text-mist-500">{n}</span>}
            </button>
          );
        })}
      </div>
      <label className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-ink-950/60 px-2.5 focus-within:border-nova-400/60">
        <Search className="size-4 shrink-0 text-mist-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title or topic" className="min-w-0 flex-1 bg-transparent text-[0.82rem] text-mist-100 placeholder:text-mist-600 focus:outline-none" aria-label="Search resources" />
        {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X className="size-3.5 text-mist-500" /></button>}
      </label>
      {counts && counts.cards_due > 0 && filter !== 'plan' && (
        <p className="rounded-lg border border-gold-400/30 bg-gold-500/10 px-3 py-1.5 text-[0.76rem] font-semibold text-gold-100">{counts.cards_due} flashcard{counts.cards_due === 1 ? '' : 's'} due for review.</p>
      )}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        <div className="space-y-1.5">
          {items === null ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)
          ) : items.length ? (
            items.map((item) => {
              const Icon = KIND_ICON[item.kind];
              const key = `${item.kind}-${item.id}`;
              return (
                <div key={key} className="relative flex items-center rounded-xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.06]">
                  <button onClick={() => onOpen(item)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-nova-500/15 text-nova-200"><Icon className="size-4.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.86rem] font-bold text-mist-50">{item.title}</span>
                      <span className="block truncate text-[0.72rem] text-mist-500">{filter === 'all' ? `${KIND_LABEL[item.kind]} · ` : ''}{itemMeta(item)}</span>
                    </span>
                  </button>
                  <button className="mr-1 grid size-9 shrink-0 place-items-center rounded-md text-mist-500 hover:text-mist-200" aria-label="More actions" onClick={() => setMenu(menu === key ? null : key)}><MoreHorizontal className="size-4" /></button>
                  {menu === key && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
                      <div className="absolute top-full right-1 z-30 mt-1 w-40 overflow-hidden rounded-lg border border-white/10 bg-ink-900 shadow-xl">
                        {([
                          ['open', 'Open', ChevronRight],
                          ['rename', 'Rename', Pencil],
                          ['duplicate', 'Duplicate', Copy],
                          ['delete', 'Delete', Trash2],
                        ] as const).map(([action, label, I]) => (
                          <button key={action} onClick={() => (action === 'open' ? (setMenu(null), onOpen(item)) : act(item, action))} className={`flex w-full items-center gap-2 px-3 py-2 text-[0.78rem] ${action === 'delete' ? 'text-flare-300 hover:bg-flare-500/10' : 'text-mist-200 hover:bg-white/[0.06]'}`}>
                            <I className="size-3.5" /> {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          ) : (
            <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[0.82rem] text-mist-500">{query ? 'Nothing matches that search.' : KIND_EMPTY[filter]}</p>
          )}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[0.8rem] font-extrabold tracking-wide text-mist-300">My uploads</p>
            <Button size="sm" variant="ghost" icon={<Upload className="size-4" />} loading={uploading} onClick={onUpload} label="Upload a file" />
          </div>
          <div className="space-y-1.5">
            {uploads.length ? uploads.map((u) => (
              <div key={u.id} className="flex items-center gap-2 rounded-xl border border-white/8 px-3 py-2">
                <FileText className="size-4 shrink-0 text-mist-400" />
                <span className="min-w-0 flex-1 truncate text-[0.84rem] text-mist-100">{u.title} <span className="text-mist-500">· {u.status === 'processing' ? 'processing…' : u.status === 'failed' ? 'could not be read' : `${u.sections} parts`}</span></span>
                <button disabled={u.status === 'processing' || u.status === 'failed'} className="rounded-md px-2 py-1 text-[0.74rem] font-bold text-nova-300 hover:bg-nova-500/15 disabled:opacity-40" onClick={() => onUseUpload(u)}>Ask about it</button>
                <button className="grid size-8 place-items-center rounded-md text-mist-500 hover:text-flare-300" aria-label="Delete upload" onClick={() => onDeleteUpload(u)}><Trash2 className="size-4" /></button>
              </div>
            )) : <p className="text-[0.78rem] text-mist-500">Upload PDF, DOCX or TXT notes and the tutor will answer from them — privately, only for you.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
