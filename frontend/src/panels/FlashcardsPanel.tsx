/**
 * Flashcards — decks, spaced repetition and swipe-to-study.
 *
 * Every card is rendered from the API payload, so the answer shown here is
 * exactly ``Question.correct`` from the server — the same value exams, duels
 * and practice grade against. Nothing is inferred on the client.
 */
import {
  ArrowLeftRight,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  Layers,
  Plus,
  RotateCcw,
  Shuffle,
  Sparkles,
  Timer,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Character from '../components/Character';
import Scenery from '../components/Scenery';
import {AnswerTile} from '../components/GameQuestion';
import {Button, Card, Chip, EmptyState, Modal, ProgressBar, ProgressRing, SectionHeading, Skeleton, TextInput, XpFloat} from '../components/ui';
import {Holdable} from '../components/Holdable';
import {api, type Json} from '../lib/api';
import {formatNumber} from '../lib/format';
import {sfx} from '../lib/sfx';
import {HAPTICS} from '../lib/haptics';
import {useSession} from '../store/session';

type CardPayload = {
  card_id: number;
  question_id: number;
  state: string;
  due_on: string | null;
  due_now: boolean;
  bookmarked: boolean;
  notes: string;
  front: string;
  back: string;
  explanation: string;
  options: Record<string, string>;
  correct: string;
  correct_label: string | null;
  answer_text: string[];
  difficulty: string;
  topic: string;
  source: string;
  reference: string;
  hint: string;
};

type DeckPayload = {
  id: number;
  name: string;
  description: string;
  kind: string;
  is_system: boolean;
  is_public: boolean;
  stats: {total: number; mastered: number; due: number; mastery: number; new?: number; learning?: number; reviewing?: number; bookmarked?: number};
};

type Progress = {
  goal: number;
  reviewed_today: number;
  goal_percent: number;
  study_days: number;
  due_total: number;
  total_cards: number;
  mastered: number;
  mastery: number;
};

const DECK_PRESETS: {kind: string; name: string; blurb: string; config?: Record<string, unknown>}[] = [
  {kind: 'wrong', name: 'Questions I got wrong', blurb: 'Everything you missed in exams, in one deck.'},
  {kind: 'weakness', name: 'Weakness drill', blurb: 'Your most-missed questions first.'},
  {kind: 'favorites', name: 'Bookmarked', blurb: 'Cards you starred for later.'},
  {kind: 'recent', name: 'Recent activity', blurb: 'The last questions you answered.'},
  {kind: 'mixed', name: 'Mixed bag', blurb: 'A shuffle across the whole bank.'},
];

const GRADES: {id: 'again' | 'hard' | 'good' | 'easy'; label: string; blurb: string; className: string}[] = [
  {id: 'again', label: 'Again', blurb: 'Show again today', className: 'border-rose-500/40 bg-rose-500/12 text-rose-200'},
  {id: 'hard', label: 'Hard', blurb: 'Tricky — sooner', className: 'border-amber-500/40 bg-amber-500/12 text-amber-200'},
  {id: 'good', label: 'Good', blurb: 'Got it', className: 'border-mint-500/40 bg-mint-500/12 text-mint-200'},
  {id: 'easy', label: 'Easy', blurb: 'Too easy', className: 'border-nova-500/40 bg-nova-500/12 text-nova-200'},
];

const STATE_STYLE: Record<string, string> = {
  new: 'border-white/14 bg-white/6 text-mist-400',
  learning: 'border-amber-500/30 bg-amber-500/12 text-amber-200',
  reviewing: 'border-nova-500/30 bg-nova-500/12 text-nova-200',
  mastered: 'border-mint-500/30 bg-mint-500/12 text-mint-200',
};

function StudyView({deckId, mode, onExit}: {deckId: number; mode: 'q_to_a' | 'a_to_q'; onExit: () => void}) {
  const {toast, pushRewards, setProfile} = useSession();
  const [payload, setPayload] = useState<{deck: DeckPayload; cards: CardPayload[]; next_due?: Record<string, number>} | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [shuffle, setShuffle] = useState(true);
  const [dueOnly, setDueOnly] = useState(false);
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  /* A little "+XP" that pops off the card when a review pays out. Purely
     cosmetic — the rewards themselves still come from the server response. */
  const [float, setFloat] = useState<{key: number; amount: number} | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const startedAt = useRef(Date.now());
  const touchStart = useRef<{x: number; y: number} | null>(null);

  const load = useCallback(
    (options: {shuffle?: boolean; due_only?: boolean; bookmarked?: boolean} = {}) => {
      api.flashcards
        .deck(deckId, {
          mode,
          shuffle: options.shuffle ?? shuffle,
          due_only: options.due_only ?? dueOnly,
          bookmarked: options.bookmarked ?? bookmarkedOnly,
          limit: 60,
        })
        .then((data) => {
          setPayload(data as unknown as {deck: DeckPayload; cards: CardPayload[]});
          setIndex(0);
          setFlipped(false);
          startedAt.current = Date.now();
        })
        .catch((error: Error) => toast('error', 'Deck unavailable', error.message));
    },
    [deckId, mode, shuffle, dueOnly, bookmarkedOnly, toast],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, mode]);

  // Session timer + keyboard shortcuts.
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const cards = payload?.cards ?? [];
  const card = cards[index];

  const advance = useCallback(() => {
    setFlipped(false);
    setIndex((value) => value + 1);
    startedAt.current = Date.now();
    setSeconds(0);
  }, []);

  const grade = useCallback(
    async (value: 'again' | 'hard' | 'good' | 'easy') => {
      if (!card) return;
      try {
        const result = await api.flashcards.grade({
          card_id: card.card_id,
          question_id: card.question_id,
          grade: value,
          elapsed_ms: Date.now() - startedAt.current,
        });
        const rewards = (result as {rewards?: unknown[]}).rewards ?? [];
        if (rewards.length) {
          pushRewards(rewards as never);
          const xp = rewards.reduce<number>((sum, row) => sum + Number((row as {amount?: number}).amount ?? 0), 0);
          if (xp > 0) setFloat({key: Date.now(), amount: xp});
        }
        if ((result as {profile?: unknown}).profile) setProfile((result as {profile: never}).profile);
        if ((result as {goal_hit?: boolean}).goal_hit) toast('success', 'Daily goal hit!', 'Bonus XP landed.');
        setReviewed((count) => count + 1);
        if (value === 'good' || value === 'easy') {
          setCorrectCount((count) => count + 1);
          sfx.play('correct');
        } else {
          sfx.play('wrong');
        }
        HAPTICS.tap();
      } catch (error) {
        toast('error', 'Could not save that review', (error as Error).message);
      }
      advance();
    },
    [advance, card, pushRewards, setProfile, toast],
  );

  const toggleBookmark = async () => {
    if (!card) return;
    try {
      const next = !card.bookmarked;
      await api.flashcards.updateCard(card.card_id, {bookmarked: next});
      setPayload((current) =>
        current ? {...current, cards: current.cards.map((row) => (row.card_id === card.card_id ? {...row, bookmarked: next} : row))} : current,
      );
    } catch (error) {
      toast('error', 'Could not update card', (error as Error).message);
    }
  };

  const saveNotes = async () => {
    if (!card) return;
    try {
      await api.flashcards.updateCard(card.card_id, {notes: noteDraft});
      setPayload((current) =>
        current ? {...current, cards: current.cards.map((row) => (row.card_id === card.card_id ? {...row, notes: noteDraft} : row))} : current,
      );
      setNotesOpen(false);
    } catch (error) {
      toast('error', 'Could not save note', (error as Error).message);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!card) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        setFlipped((value) => !value);
      }
      if (!flipped) return;
      if (event.key === '1') void grade('again');
      if (event.key === '2') void grade('hard');
      if (event.key === '3') void grade('good');
      if (event.key === '4') void grade('easy');
      if (event.key.toLowerCase() === 'b') void toggleBookmark();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped, card, grade]);

  if (!payload) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (!cards.length || !card) {
    return (
      <Card className="relative overflow-hidden p-5 text-center">
        <Character mood={reviewed ? 'celebrate' : 'idle'} size={96} tone="day" className="absolute -top-1 -right-1 opacity-90" />
        <div className="mx-auto grid size-14 place-items-center rounded-2xl brand-gradient text-white">
          <Trophy className="size-6" />
        </div>
        <h3 className="mt-3 text-base font-extrabold text-mist-50">
          {reviewed ? 'Deck cleared!' : 'Nothing due right now'}
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-[0.82rem] font-medium text-mist-500">
          {reviewed
            ? `You reviewed ${reviewed} card${reviewed === 1 ? '' : 's'} — ${correctCount} landed. Come back when the next cards fall due.`
            : 'Every card in this filter is scheduled for later. Switch off “due only” to study ahead.'}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={onExit}>
            Back to decks
          </Button>
          <Button variant="ghost" onClick={() => { setDueOnly(false); load({due_only: false}); }}>
            Study the whole deck
          </Button>
        </div>
      </Card>
    );
  }

  const progress = Math.round((index / cards.length) * 100);
  const stateClass = STATE_STYLE[card.state] ?? STATE_STYLE.new;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" icon={<ChevronLeft className="size-4" />} onClick={onExit} className="-ml-1">
          Decks
        </Button>
        <Chip className="border-white/12 bg-white/6 text-mist-300">{payload.deck.name}</Chip>
        <Chip className={stateClass}>{card.state}</Chip>
        {card.topic && <Chip className="hidden border-white/12 bg-white/6 text-mist-400 sm:inline-flex">{card.topic}</Chip>}
        <div className="ml-auto flex items-center gap-2">
          <Character
            mood={!flipped ? 'idle' : card.state === 'new' ? 'think' : 'cheer'}
            size={40}
            tone="day"
            className="-my-2 hidden sm:block"
            label="Arena hero"
          />
          <Chip className="border-white/12 bg-white/6 text-mist-300" icon={<Timer className="size-3.5" />}>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </Chip>
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeftRight className="size-4" />}
            onClick={() => {
              setFlipped(false);
              onExit();
            }}
            className="hidden sm:inline-flex"
          >
            {mode === 'q_to_a' ? 'Q → A' : 'A → Q'}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ProgressBar value={progress} className="flex-1" />
        <span className="shrink-0 text-[0.72rem] font-bold text-mist-500">
          {index + 1}/{cards.length}
        </span>
      </div>

      {float ? <XpFloat key={float.key} amount={float.amount} className="top-16 left-1/2 -translate-x-1/2" /> : null}
      <div
        className="relative touch-pan-y [perspective:1400px]"
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStart.current = {x: touch.clientX, y: touch.clientY};
        }}
        onTouchEnd={(event) => {
          if (!touchStart.current || !flipped) return;
          const touch = event.changedTouches[0];
          const dx = touch.clientX - touchStart.current.x;
          const dy = touch.clientY - touchStart.current.y;
          if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
          void grade(dx > 0 ? 'good' : 'again');
          touchStart.current = null;
        }}
      >
        <motion.button
          type="button"
          onClick={() => setFlipped((value) => !value)}
          className="block w-full text-left"
          whileTap={{scale: 0.995}}
        >
          <Card className="card-raised relative min-h-56 w-full overflow-hidden p-5 sm:min-h-64">
            <div className="pointer-events-none absolute -top-20 -right-16 size-52 rounded-full bg-nova-600/14 blur-3xl" />
            <Scenery layer="arena" className="opacity-60" />
            <div className="relative flex items-center justify-between gap-2">
              <Chip className="border-white/12 bg-white/6 text-mist-400">
                {mode === 'q_to_a' ? 'Question' : 'Answer'}
              </Chip>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); void toggleBookmark(); }}
                  className="grid size-8 place-items-center rounded-xl border border-white/12 bg-white/6 text-mist-400 transition-colors hover:text-gold-300"
                  aria-label={card.bookmarked ? 'Remove bookmark' : 'Bookmark card'}
                >
                  {card.bookmarked ? <BookmarkCheck className="size-4 text-gold-300" /> : <Bookmark className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); setNoteDraft(card.notes); setNotesOpen(true); }}
                  className="grid size-8 place-items-center rounded-xl border border-white/12 bg-white/6 text-mist-400 transition-colors hover:text-nova-300"
                  aria-label="Card notes"
                >
                  <Sparkles className="size-4" />
                </button>
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={flipped ? 'back' : 'front'}
                initial={{opacity: 0, rotateY: -78, scale: 0.96}}
                animate={{opacity: 1, rotateY: 0, scale: 1}}
                exit={{opacity: 0, rotateY: 78, scale: 0.96}}
                transition={{duration: 0.3, ease: [0.22, 1, 0.36, 1]}}
                className="relative mt-4 [backface-visibility:hidden]"
              >
                <p className="text-[1.02rem] leading-relaxed font-extrabold text-mist-50 sm:text-[1.15rem]">
                  {flipped ? card.back : card.front}
                </p>
                {card.options && Object.keys(card.options).length > 0 && (
                  <div className="mt-4 grid gap-1.5">
                    {Object.entries(card.options).map(([key, value]) => (
                      <AnswerTile
                        key={key}
                        letter={key}
                        text={value}
                        /* Muted while the card is face down, then the stored key
                           lights up — the label comes from the server, so the
                           reveal can never disagree with the exam. */
                        state={flipped ? (card.correct_label === key ? 'correct' : 'muted') : 'muted'}
                      />
                    ))}
                  </div>
                )}
                {flipped && (
                  <div className="mt-4 grid gap-2">
                    <div className="rounded-xl border border-mint-500/25 bg-mint-500/10 px-3 py-2.5">
 <p className="text-[0.7rem] font-bold tracking-wide text-mint-300">Correct answer</p>
                      <p className="mt-0.5 text-[0.86rem] font-bold break-words text-mist-100">
                        {card.correct_label ? `${card.correct_label}. ` : ''}
                        {card.back}
                      </p>
                    </div>
                    {card.explanation && (
                      <p className="rounded-xl border border-white/8 bg-ink-900/50 px-3 py-2.5 text-[0.8rem] font-medium text-mist-300">
                        {card.explanation}
                      </p>
                    )}
                    {(card.source || card.reference) && (
                      <p className="text-[0.72rem] font-semibold text-mist-500">
                        Source: {[card.source, card.reference].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {card.notes && (
                      <p className="rounded-xl border border-gold-500/20 bg-gold-500/8 px-3 py-2 text-[0.78rem] font-medium text-gold-200">
                        Note: {card.notes}
                      </p>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <p className="relative mt-5 text-[0.72rem] font-semibold text-mist-500">
              {flipped ? 'Rate how it went — that drives the next review date.' : 'Tap the card to flip it over. Space works too.'}
            </p>
          </Card>
        </motion.button>
      </div>

      {flipped ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GRADES.map((option, position) => (
            <button
              key={option.id}
              onClick={() => void grade(option.id)}
              className={`gpress flex items-center gap-2 rounded-2xl border-2 px-3 py-3 text-left ${option.className}`}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-lg border-2 border-black/20 bg-black/15 text-[0.68rem] font-black tabular">
                {position + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[0.84rem] font-extrabold">{option.label}</span>
                <span className="block truncate text-[0.66rem] font-semibold opacity-80">{option.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Button variant="primary" size="lg" className="w-full" onClick={() => setFlipped(true)}>
          Flip the card
        </Button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Chip className="border-white/12 bg-white/6 text-mist-400" icon={<Shuffle className="size-3.5" />}>
          <select
            value={String(shuffle)}
            onChange={(event) => { const value = event.target.value === 'true'; setShuffle(value); load({shuffle: value}); }}
            className="bg-transparent text-[0.74rem] font-bold text-mist-300 outline-none"
            aria-label="Shuffle"
          >
            <option value="true">Shuffled</option>
            <option value="false">In order</option>
          </select>
        </Chip>
        <Chip className="border-white/12 bg-white/6 text-mist-400">
          <select
            value={dueOnly ? 'due' : 'all'}
            onChange={(event) => { const value = event.target.value === 'due'; setDueOnly(value); load({due_only: value}); }}
            className="bg-transparent text-[0.74rem] font-bold text-mist-300 outline-none"
            aria-label="Due filter"
          >
            <option value="due">Due only</option>
            <option value="all">Whole deck</option>
          </select>
        </Chip>
        <Chip className="border-white/12 bg-white/6 text-mist-400">
          <select
            value={bookmarkedOnly ? 'star' : 'all'}
            onChange={(event) => { const value = event.target.value === 'star'; setBookmarkedOnly(value); load({bookmarked: value}); }}
            className="bg-transparent text-[0.74rem] font-bold text-mist-300 outline-none"
            aria-label="Bookmark filter"
          >
            <option value="all">All cards</option>
            <option value="star">Bookmarked</option>
          </select>
        </Chip>
        <Chip className="ml-auto border-mint-500/25 bg-mint-500/10 text-mint-200">
          {correctCount}/{reviewed || 0} known
        </Chip>
      </div>

      <Modal
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        title="Card note"
        subtitle="Private to you — a mnemonic, a page number, anything."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNotesOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveNotes()}>Save note</Button>
          </>
        }
      >
        <textarea
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="e.g. Section 2(3) — remember the proviso…"
          className="w-full resize-y rounded-2xl border border-white/12 bg-ink-900/70 px-3 py-2.5 text-[0.86rem] font-medium text-mist-100 outline-none focus:border-nova-400/60"
        />
      </Modal>
    </div>
  );
}

export default function FlashcardsPanel() {
  const {toast} = useSession();
  const [data, setData] = useState<{decks: DeckPayload[]; progress: Progress} | null>(null);
  const [studying, setStudying] = useState<{deckId: number; mode: 'q_to_a' | 'a_to_q'} | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [stats, setStats] = useState<Json | null>(null);

  const load = () => {
    api.flashcards
      .decks()
      .then((payload) => setData(payload as unknown as {decks: DeckPayload[]; progress: Progress}))
      .catch((error: Error) => toast('error', 'Could not load flashcards', error.message));
    api.flashcards.stats().then(setStats).catch(() => setStats(null));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createDeck = async (preset?: {kind: string; name: string; config?: Record<string, unknown>}) => {
    try {
      await api.flashcards.createDeck({
        name: preset?.name ?? name.trim(),
        description: preset ? '' : 'Custom deck',
        kind: preset?.kind ?? 'custom',
        topic: preset ? '' : topic.trim(),
        difficulty: preset ? '' : difficulty,
        config: preset?.config ?? {},
      });
      setCreateOpen(false);
      setName('');
      setTopic('');
      setDifficulty('');
      toast('success', 'Deck ready', preset?.name ?? name.trim());
      load();
    } catch (error) {
      toast('error', 'Could not create deck', (error as Error).message);
    }
  };

  const removeDeck = async (deck: DeckPayload) => {
    try {
      await api.flashcards.deleteDeck(deck.id);
      toast('success', deck.is_system ? 'Deck reset' : 'Deck deleted', deck.name);
      load();
    } catch (error) {
      toast('error', 'Could not delete deck', (error as Error).message);
    }
  };

  if (studying) {
    return (
      <StudyView
        deckId={studying.deckId}
        mode={studying.mode}
        onExit={() => {
          setStudying(null);
          load();
        }}
      />
    );
  }

  const progress = data?.progress;
  const decks = useMemo(() => data?.decks ?? [], [data]);

  return (
    <div className="grid gap-4">
      <Card className="relative overflow-hidden p-4 sm:p-5">
        <div className="pointer-events-none absolute -top-20 -right-16 size-48 rounded-full bg-nova-600/14 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <ProgressRing value={progress?.goal_percent ?? 0} size={78} stroke={7}>
            <span className="text-[0.8rem] font-black text-mist-50">{Math.round(progress?.goal_percent ?? 0)}%</span>
            <span className="text-[0.58rem] font-bold text-mist-500">goal</span>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <h2 className="text-[1.02rem] font-extrabold text-mist-50">Today’s reviews</h2>
            <p className="mt-0.5 text-[0.8rem] font-medium text-mist-500">
              {progress ? `${progress.reviewed_today} of ${progress.goal} cards reviewed · ${progress.due_total} due now` : 'Loading your study plan…'}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Chip className="border-white/12 bg-white/6 text-mist-300">🔥 {progress?.study_days ?? 0}-day study</Chip>
              <Chip className="border-white/12 bg-white/6 text-mist-300">{progress?.total_cards ?? 0} cards</Chip>
              <Chip className="border-mint-500/25 bg-mint-500/10 text-mint-200">{progress?.mastered ?? 0} mastered</Chip>
              <Chip className="border-nova-500/25 bg-nova-500/10 text-nova-200">{progress?.mastery ?? 0}% mastery</Chip>
            </div>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button variant="primary" className="flex-1 sm:flex-none" onClick={() => decks[0] && setStudying({deckId: decks[0].id, mode: 'q_to_a'})} disabled={!decks.length}>
              Study now
            </Button>
            <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
              New
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-3">
        <SectionHeading
          title="Decks"
          subtitle="Arena decks, plus everything you build from the bank."
          icon={<Layers className="size-4" />}
          action={<Chip className="border-white/12 bg-white/6 text-mist-400">{decks.length} decks</Chip>}
        />

        {!data && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {data && !decks.length && (
          <EmptyState
            icon={<Layers className="size-5" />}
            title="No decks yet"
            detail="Create a deck from the question bank, or grab one of the ready-made drills below."
          />
        )}

        <ul className="grid gap-3 sm:grid-cols-2">
          {decks.map((deck) => (
            <li key={deck.id} className="min-w-0">
              <Holdable
                className="h-full"
                contentClassName="h-full"
                hint={deck.is_system ? 'Hold to reset this deck' : 'Hold to delete this deck'}
                actions={[
                  {
                    key: 'delete',
                    label: deck.is_system ? 'Reset' : 'Delete',
                    icon: deck.is_system ? <RotateCcw className="size-4" /> : <Trash2 className="size-4" />,
                    tone: 'danger',
                    onAction: () => void removeDeck(deck),
                  },
                ]}
              >
              <Card className="flex h-full flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[0.92rem] leading-snug font-extrabold break-words text-mist-50">{deck.name}</h3>
                    <p className="mt-0.5 line-clamp-2 text-[0.76rem] font-medium text-mist-500">{deck.description || 'Custom deck'}</p>
                  </div>
                  <Chip className={deck.is_system ? 'border-nova-500/25 bg-nova-500/10 text-nova-200' : 'border-white/12 bg-white/6 text-mist-400'}>
                    {deck.is_system ? 'Arena' : 'Mine'}
                  </Chip>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[0.74rem] font-semibold text-mist-400">
                  <span>{deck.stats.total} cards</span>
                  <span className="text-right">{deck.stats.due} due</span>
                  <span className="text-mint-300">{deck.stats.mastered} mastered</span>
                  <span className="text-right text-nova-300">{deck.stats.mastery}% mastery</span>
                </div>
                <ProgressBar value={deck.stats.mastery} className="mt-2" />

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={() => setStudying({deckId: deck.id, mode: 'q_to_a'})}>
                    Q → A
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setStudying({deckId: deck.id, mode: 'a_to_q'})}>
                    A → Q
                  </Button>
                  <button
                    onClick={() => void removeDeck(deck)}
                    className="ml-auto grid size-8 place-items-center rounded-xl border border-white/12 bg-white/6 text-mist-500 transition-colors hover:text-rose-300"
                    aria-label={deck.is_system ? 'Reset deck' : 'Delete deck'}
                  >
                    {deck.is_system ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5" />}
                  </button>
                </div>
              </Card>
              </Holdable>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-3">
        <SectionHeading title="Quick decks" subtitle="One tap builds a deck from how you have been playing." icon={<Sparkles className="size-4" />} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {DECK_PRESETS.map((preset) => (
            <button
              key={preset.kind}
              onClick={() => void createDeck(preset)}
              className="rounded-2xl border border-white/10 bg-ink-900/60 p-3 text-left transition-colors hover:border-nova-400/30"
            >
              <span className="block text-[0.84rem] font-extrabold text-mist-100">{preset.name}</span>
              <span className="mt-0.5 block text-[0.74rem] font-medium text-mist-500">{preset.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      {stats && (
        <Card className="p-4">
          <SectionHeading title="Review history" subtitle="Last 30 study days" icon={<Timer className="size-4" />} />
          <div className="mt-3 flex h-24 items-end gap-1">
            {((stats.history as {day: string; reviews: number}[] | undefined) ?? []).slice(0, 30).reverse().map((row) => {
              const max = Math.max(...((stats.history as {reviews: number}[] | undefined) ?? [{reviews: 1}]).map((entry) => entry.reviews), 1);
              return (
                <div
                  key={row.day}
                  title={`${row.day}: ${row.reviews} reviews`}
                  className="flex-1 rounded-t bg-nova-500/50"
                  style={{height: `${Math.max(6, (row.reviews / max) * 100)}%`}}
                />
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Chip className="border-white/12 bg-white/6 text-mist-300">{formatNumber(Number(stats.total_reviews ?? 0))} reviews</Chip>
            <Chip className="border-mint-500/25 bg-mint-500/10 text-mint-200">{String(stats.accuracy ?? 0)}% known</Chip>
            <Chip className="border-white/12 bg-white/6 text-mist-300">{String(stats.streak_days ?? 0)} study days</Chip>
            <Chip className="border-nova-500/25 bg-nova-500/10 text-nova-200">
              {Number((stats.next_due as {due_today?: number} | undefined)?.due_today ?? 0)} due today
            </Chip>
          </div>
        </Card>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New deck" subtitle="Build it from the question bank." size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} icon={<X className="size-4" />}>Cancel</Button>
            <Button variant="primary" onClick={() => void createDeck()} disabled={name.trim().length < 2}>Create deck</Button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-[0.76rem] font-bold text-mist-400">Deck name</span>
            <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Contract law — offer & acceptance" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[0.76rem] font-bold text-mist-400">Topic (optional)</span>
            <TextInput value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Any topic in the bank" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[0.76rem] font-bold text-mist-400">Difficulty</span>
            <select
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value)}
              className="rounded-2xl border border-white/12 bg-ink-900/70 px-3 py-2.5 text-[0.86rem] font-semibold text-mist-100 outline-none focus:border-nova-400/60"
            >
              <option value="">Any</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        </div>
      </Modal>
    </div>
  );
}
