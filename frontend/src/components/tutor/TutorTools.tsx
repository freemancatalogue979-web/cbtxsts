/**
 * AI Tutor tools: the generate sheet, flashcard deck + study mode, the
 * one-question-at-a-time AI Quiz, study material / notes viewers and the
 * student's library. Nothing is saved until the student taps Save.
 */
import {
  ArrowLeft, BookOpen, Check, ChevronLeft, ChevronRight, Download, FileText, HelpCircle, Layers, ListChecks,
  Pencil, Plus, RefreshCw, RotateCcw, Save, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {Button, Chip, EmptyState, Field, Modal, Segmented, Select, Skeleton, TextArea, TextInput} from '../ui';
import {Markdown} from '../../lib/markdown';
import {
  downloadText, materialToMarkdown, tutorApi, type Deck, type GenKind, type GenerateSource, type NotesDoc,
  type PracticeQuestion, type PracticeSet, type SavedItem, type SavedKind, type StudyMaterial, type TutorContext,
  type TutorCourse, type TutorMode, type TutorUpload,
} from '../../lib/tutor';
import {useSession} from '../../store/session';

export type ToolState =
  | {kind: 'flashcards'; data: Deck; savedId?: number; request?: GenRequest}
  | {kind: 'practice'; data: PracticeSet; savedId?: number; request?: GenRequest}
  | {kind: 'material'; data: StudyMaterial; savedId?: number; request?: GenRequest}
  | {kind: 'notes' | 'plan'; data: NotesDoc; savedId?: number; request?: undefined};

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
  open, onClose, initialKind, conversationId, courses, uploads, courseId, topic, selectedText, onResult,
}: {
  open: boolean;
  onClose: () => void;
  initialKind: GenKind;
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setCourse(courseId);
    setTopicName(topic);
    setText(selectedText ?? '');
    setSource(selectedText ? 'text' : conversationId ? 'chat' : topic || courseId ? 'topic' : uploads.length ? 'upload' : 'text');
    setCount(initialKind === 'flashcards' ? 15 : 8);
  }, [open, initialKind, courseId, topic, selectedText, conversationId, uploads.length]);

  const topics = courses.find((c) => c.id === course)?.topics ?? [];
  const max = kind === 'flashcards' ? 50 : 20;

  const run = async () => {
    const src: GenerateSource = {course_id: course};
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
      onResult({kind, data: result.data, request} as ToolState, result.remaining_today);
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
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" icon={<Sparkles className="size-4" />} loading={busy} onClick={run}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Segmented<GenKind>
          value={kind}
          onChange={(value) => {
            setKind(value);
            setCount(value === 'flashcards' ? 15 : 8);
          }}
          options={[
            {value: 'flashcards', label: 'Flashcards', icon: Layers},
            {value: 'practice', label: 'Practice me', icon: ListChecks},
            {value: 'material', label: 'Study material', icon: BookOpen},
          ]}
        />
        <Field label="Source">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {([
              ['chat', 'This chat', !conversationId],
              ['topic', 'Course / topic', false],
              ['upload', 'My upload', !uploads.length],
              ['text', 'Pasted text', false],
            ] as [SourceChoice, string, boolean][]).map(([value, label, disabled]) => (
              <button
                key={value}
                disabled={disabled}
                onClick={() => setSource(value)}
                className={`rounded-lg border px-2 py-2 text-[0.76rem] font-bold transition-colors disabled:opacity-35 ${source === value ? 'border-nova-400/70 bg-nova-500/20 text-white' : 'border-white/10 bg-white/[0.03] text-mist-300 hover:bg-white/[0.07]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        {(source === 'topic' || source === 'upload') && (
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
        {source === 'text' && (
          <Field label="Text to use">
            <TextArea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste notes, a paragraph from your material…" maxLength={6000} />
          </Field>
        )}
        {kind !== 'material' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={`How many (${kind === 'flashcards' ? 5 : 3}–${max})`}>
              <TextInput type="number" min={kind === 'flashcards' ? 5 : 3} max={max} value={count} onChange={(e) => setCount(Number(e.target.value) || 0)} />
            </Field>
            <Field label="Difficulty">
              <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                {['mixed', 'easy', 'medium', 'hard'].map((d) => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
              </Select>
            </Field>
          </div>
        )}
        {kind === 'practice' && (
          <Field label="Question types">
            <div className="flex flex-wrap gap-1.5">
              {[['mcq', 'Multiple choice'], ['true_false', 'True / False'], ['short_answer', 'Short answer'], ['calculation', 'Calculation'], ['scenario', 'Scenario']].map(([value, label]) => {
                const on = types.includes(value);
                return (
                  <button
                    key={value}
                    onClick={() => setTypes(on ? (types.length > 1 ? types.filter((t) => t !== value) : types) : [...types, value])}
                    className={`rounded-full border px-3 py-1.5 text-[0.74rem] font-bold ${on ? 'border-nova-400/70 bg-nova-500/20 text-white' : 'border-white/10 text-mist-400'}`}
                  >
                    {on && <Check className="mr-1 inline size-3" />}
                    {label}
                  </button>
                );
              })}
            </div>
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
function useSaver(kind: SavedKind, savedId: number | undefined, onSaved: (id: number) => void, meta: {course_id?: number | null; topic?: string; conversation_id?: number | null}) {
  const {toast} = useSession();
  const [busy, setBusy] = useState(false);
  const save = async (title: string, data: object) => {
    setBusy(true);
    try {
      if (savedId) {
        await tutorApi.updateSaved(savedId, {title, data});
        toast('success', 'Changes saved');
      } else {
        const item = await tutorApi.save({kind, title, data, ...meta});
        onSaved(item.id);
        toast('success', 'Saved to your library');
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
}

function DeleteButton({savedId, onDeleted, label = 'Delete'}: {savedId?: number; onDeleted: () => void; label?: string}) {
  const {toast} = useSession();
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<Trash2 className="size-4" />}
      onClick={async () => {
        if (!savedId) return onDeleted();
        if (!window.confirm('Delete this from your library?')) return;
        try {
          await tutorApi.deleteSaved(savedId);
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

  if (studying) return <FlashcardStudy deck={data} onBack={() => setStudying(false)} onAsk={onAsk} />;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ToolHeader title={data.title} subtitle={`${cards.length} flashcards${savedId ? ' · saved' : ' · not saved yet'}`} onBack={onBack}>
        <Button size="sm" variant="mint" icon={<Layers className="size-4" />} onClick={() => setStudying(true)} disabled={!cards.length}>Study</Button>
        <Button size="sm" variant="soft" icon={<Save className="size-4" />} loading={busy} onClick={() => save(data.title, data)}>{savedId ? 'Save' : 'Save deck'}</Button>
      </ToolHeader>
      <div className="flex flex-wrap items-center gap-1.5">
        <TextInput value={data.title} onChange={(e) => onChange({...data, title: e.target.value})} className="min-w-0 flex-1 !h-9 text-[0.85rem]" aria-label="Deck title" maxLength={140} />
        <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => downloadText(`${data.title}.md`, `# ${data.title}\n\n` + cards.map((c, i) => `${i + 1}. **${c.front}**\n   ${c.back}`).join('\n\n'))}>
          <span className="hidden sm:inline">Download</span>
        </Button>
        {onRegenerate && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={regenerating} onClick={onRegenerate}><span className="hidden sm:inline">Regenerate</span></Button>}
        <DeleteButton savedId={savedId} onDeleted={onDeleted} />
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

function FlashcardStudy({deck, onBack, onAsk}: {deck: Deck; onBack: () => void; onAsk: AskFn}) {
  const [queue, setQueue] = useState(() => deck.cards.map((_, i) => i).filter((i) => deck.cards[i].front && deck.cards[i].back));
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [again, setAgain] = useState(0);
  const total = deck.cards.length;
  const current = queue[0];
  const card = current === undefined ? null : deck.cards[current];
  const answer = (gotIt: boolean) => {
    setFlipped(false);
    if (gotIt) {
      setKnown((k) => k + 1);
      setQueue((q) => q.slice(1));
    } else {
      setAgain((a) => a + 1);
      setQueue((q) => [...q.slice(1), q[0]]);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ToolHeader title={deck.title} subtitle={`${known}/${total} learned · ${again} to repeat`} onBack={onBack} />
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
              <Button block variant="outline" icon={<RotateCcw className="size-4" />} onClick={() => answer(false)}>Again</Button>
              <Button block variant="mint" icon={<Check className="size-4" />} onClick={() => answer(true)}>Got it</Button>
            </div>
          ) : (
            <Button variant="soft" onClick={() => setFlipped(true)}>Show answer</Button>
          )}
          <button className="text-[0.78rem] font-bold text-nova-300 hover:underline" onClick={() => onAsk(`Explain this flashcard in more depth:\nQ: ${card.front}\nA: ${card.back}`, 'EXPLAIN')}>
            <HelpCircle className="mr-1 inline size-3.5" />Explain this card
          </button>
        </div>
      ) : (
        <EmptyState icon={<Check className="size-6" />} title="Deck complete!" detail={`You learned all ${total} cards${again ? ` (repeated ${again})` : ''}.`} action={<Button size="sm" onClick={onBack}>Back to deck</Button>} />
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

export function QuizView({data, savedId, meta, onBack, onSaved, onRegenerate, regenerating, onDeleted, onAsk}: ViewProps<PracticeSet>) {
  const {save, busy} = useSaver('practice', savedId, onSaved, meta);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, QuizAnswer>>({});
  const [draft, setDraft] = useState('');
  const [revealed, setRevealed] = useState(false);
  const questions = data.questions;
  const q: PracticeQuestion | undefined = questions[index];
  const finished = index >= questions.length;
  const score = Object.values(answers).filter((a) => a.correct).length;

  useEffect(() => {
    setIndex(0);
    setAnswers({});
    setRevealed(false);
    setDraft('');
  }, [data]);

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
        <Button size="sm" variant="soft" icon={<Save className="size-4" />} loading={busy} onClick={() => save(data.title, data)}>{savedId ? 'Save' : 'Save set'}</Button>
        {onRegenerate && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={regenerating} onClick={onRegenerate}><span className="hidden sm:inline">New set</span></Button>}
        <DeleteButton savedId={savedId} onDeleted={onDeleted} />
      </ToolHeader>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className="brand-gradient h-full transition-all" style={{width: `${(Math.min(index, questions.length) / Math.max(1, questions.length)) * 100}%`}} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {!finished && q ? (
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <Chip className="border-nova-400/30 bg-nova-500/15 text-nova-200">{q.type.replace('_', ' ')}</Chip>
              {q.topic && <Chip>{q.topic}</Chip>}
              {q.difficulty && <Chip>{q.difficulty}</Chip>}
            </div>
            <p className="text-[1rem] leading-relaxed font-bold text-mist-50">{q.question}</p>
            {q.options.length ? (
              <div className="space-y-2">
                {q.options.map((option, i) => {
                  const done = answers[index];
                  const isRight = norm(option) === norm(q.correct_answer);
                  const state = !done ? '' : isRight ? 'border-mint-400/70 bg-mint-500/15 text-mint-100' : done.picked === option ? 'border-flare-400/70 bg-flare-500/15 text-flare-100' : 'opacity-60';
                  return (
                    <button key={i} disabled={!!done} onClick={() => pick(option)} className={`flex w-full items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left text-[0.88rem] text-mist-100 transition-colors enabled:hover:bg-white/[0.07] ${state}`}>
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
                  <Button size="sm" variant="ghost" icon={<HelpCircle className="size-4" />} onClick={() => askWhy(q, answers[index].picked)}>Why?</Button>
                </div>
              </div>
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
            {weak.length > 0 && (
              <div className="rounded-xl border border-flare-400/25 bg-flare-500/[0.07] p-3">
                <p className="text-[0.8rem] font-extrabold text-mist-50">Work on these</p>
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
export function MaterialView({data, savedId, meta, onBack, onSaved, onChange, onRegenerate, regenerating, onDeleted, onAsk}: ViewProps<StudyMaterial>) {
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
        <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => downloadText(`${data.title}.md`, materialToMarkdown(data))}>Download</Button>
        {onRegenerate && <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={regenerating} onClick={onRegenerate}>Regenerate</Button>}
        <DeleteButton savedId={savedId} onDeleted={onDeleted} />
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
export function NotesView({data, savedId, meta, kind, onBack, onSaved, onChange, onDeleted}: ViewProps<NotesDoc> & {kind: 'notes' | 'plan'}) {
  const {save, busy} = useSaver(kind, savedId, onSaved, meta);
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ToolHeader title={data.title} subtitle={kind === 'plan' ? 'Study plan' : 'Notes'} onBack={onBack}>
        <Button size="sm" variant={editing ? 'mint' : 'ghost'} icon={editing ? <Check className="size-4" /> : <Pencil className="size-4" />} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</Button>
        <Button size="sm" variant="soft" icon={<Save className="size-4" />} loading={busy} onClick={() => save(data.title, data)}>Save</Button>
        <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => downloadText(`${data.title}.md`, `# ${data.title}\n\n${data.content}`)}><span className="hidden sm:inline">Download</span></Button>
        <DeleteButton savedId={savedId} onDeleted={onDeleted} />
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

/* --------------------------------------------------------------- library */
const KIND_LABEL: Record<SavedKind, string> = {flashcards: 'Flashcards', practice: 'Practice', material: 'Material', notes: 'Notes', plan: 'Plan'};
const KIND_ICON: Record<SavedKind, typeof Layers> = {flashcards: Layers, practice: ListChecks, material: BookOpen, notes: FileText, plan: Sparkles};

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
  const [items, setItems] = useState<SavedItem[] | null>(null);
  useEffect(() => {
    setItems(null);
    tutorApi.saved(filter === 'all' ? '' : filter).then((r) => setItems(r.items)).catch((error) => {
      setItems([]);
      toast('error', 'Could not load your library', errorText(error));
    });
  }, [filter, toast]);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ToolHeader title="My library" subtitle="Saved decks, practice sets, materials, notes and uploads" onBack={onBack} />
      <Segmented<'all' | SavedKind>
        value={filter}
        onChange={setFilter}
        options={[{value: 'all', label: 'All'}, ...(['flashcards', 'practice', 'material', 'notes', 'plan'] as SavedKind[]).map((k) => ({value: k, label: KIND_LABEL[k]}))]}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        <div className="space-y-1.5">
          {items === null ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)
          ) : items.length ? (
            items.map((item) => {
              const Icon = KIND_ICON[item.kind];
              return (
                <button key={item.id} onClick={() => onOpen(item)} className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-left hover:bg-white/[0.07]">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-nova-500/15 text-nova-200"><Icon className="size-4.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.86rem] font-bold text-mist-50">{item.title}</span>
                    <span className="block truncate text-[0.72rem] text-mist-500">{KIND_LABEL[item.kind]}{item.items ? ` · ${item.items} items` : ''}{item.topic ? ` · ${item.topic}` : ''}</span>
                  </span>
                  <ChevronRight className="size-4 text-mist-500" />
                </button>
              );
            })
          ) : (
            <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[0.82rem] text-mist-500">Nothing saved yet. Create flashcards, a practice set or study material, then tap Save.</p>
          )}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[0.8rem] font-extrabold tracking-wide text-mist-300">My uploads</p>
            <Button size="sm" variant="ghost" icon={<Upload className="size-4" />} loading={uploading} onClick={onUpload}>Upload</Button>
          </div>
          <div className="space-y-1.5">
            {uploads.length ? uploads.map((u) => (
              <div key={u.id} className="flex items-center gap-2 rounded-xl border border-white/8 px-3 py-2">
                <FileText className="size-4 shrink-0 text-mist-400" />
                <span className="min-w-0 flex-1 truncate text-[0.84rem] text-mist-100">{u.title} <span className="text-mist-500">· {u.sections} parts</span></span>
                <button className="rounded-md px-2 py-1 text-[0.74rem] font-bold text-nova-300 hover:bg-nova-500/15" onClick={() => onUseUpload(u)}>Ask about it</button>
                <button className="grid size-8 place-items-center rounded-md text-mist-500 hover:text-flare-300" aria-label="Delete upload" onClick={() => onDeleteUpload(u)}><Trash2 className="size-4" /></button>
              </div>
            )) : <p className="text-[0.78rem] text-mist-500">Upload PDF, DOCX or TXT notes and the tutor will answer from them — privately, only for you.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
