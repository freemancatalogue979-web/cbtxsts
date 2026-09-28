/**
 * Pro Flashcards — today's reviews, decks and quick-start decks. Reviewing a
 * deck uses the existing spaced-repetition study view (grades, notes, due
 * scheduling) so card history is shared with Standard.
 */
import {ArrowLeftRight, Brain, CalendarCheck, Layers, MoreHorizontal, Plus, RotateCcw, Sparkles, Trash2} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {api} from '../lib/api';
import {DECK_PRESETS, StudyView, type DeckPayload, type Progress as DeckProgress} from '../panels/FlashcardsPanel';
import {useSession} from '../store/session';
import {Badge, Empty, LoadingRows, Metric, PageHeader, Progress, Ring, Tile, type Hue} from './ui';

const KIND_HUE: Record<string, Hue> = {daily: 'blue', weakness: 'rose', wrong: 'rose', recent: 'teal', favorites: 'amber', mixed: 'violet', custom: 'green'};

export default function ProFlashcards() {
  const {toast} = useSession();
  const [data, setData] = useState<{decks: DeckPayload[]; progress: DeckProgress} | null>(null);
  const [studying, setStudying] = useState<{deckId: number; mode: 'q_to_a' | 'a_to_q'} | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [menuFor, setMenuFor] = useState<number | null>(null);

  const load = useCallback(() => {
    api.flashcards
      .decks()
      .then((payload) => setData(payload as unknown as {decks: DeckPayload[]; progress: DeckProgress}))
      .catch((error: Error) => {
        setData({decks: [], progress: {goal: 0, reviewed_today: 0, goal_percent: 0, study_days: 0, due_total: 0, total_cards: 0, mastered: 0, mastery: 0}});
        toast('error', 'Could not load flashcards', error.message);
      });
  }, [toast]);
  useEffect(load, [load]);

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
      setCreating(false);
      setName('');
      setTopic('');
      setDifficulty('');
      toast('success', 'Deck created', preset?.name ?? name.trim());
      load();
    } catch (error) {
      toast('error', 'Could not create the deck', (error as Error).message);
    }
  };

  const removeDeck = async (deck: DeckPayload) => {
    setMenuFor(null);
    try {
      await api.flashcards.deleteDeck(deck.id);
      toast('success', deck.is_system ? 'Deck reset' : 'Deck deleted', deck.name);
      load();
    } catch (error) {
      toast('error', 'Could not change the deck', (error as Error).message);
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
  const decks = data?.decks ?? [];
  const dueDeck = decks.find((d) => d.stats.due > 0) ?? decks[0];
  const existingKinds = new Set(decks.map((d) => d.kind));
  const presets = DECK_PRESETS.filter((p) => !existingKinds.has(p.kind));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader
        icon={<Layers />}
        hue="blue"
        eyebrow="Spaced review"
        title="Flashcards"
        description="Short daily reviews, scheduled so you see each card just before you'd forget it."
        actions={
          <button type="button" className="pro-btn" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New deck
          </button>
        }
      />

      {/* today */}
      <section className="pro-card grid grid-cols-[minmax(0,1fr)] gap-5 p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:p-6">
        <div className="flex items-center gap-4">
          <Ring value={progress?.goal_percent ?? 0} size={84} stroke={7} hue="blue" label="Daily goal progress">
            <span className="text-[1.05rem]">{Math.round(progress?.goal_percent ?? 0)}%</span>
            <span className="pro-meta text-[0.625rem]">of goal</span>
          </Ring>
          <div className="min-w-0 md:hidden">
            <h2 className="pro-h3">Today's reviews</h2>
            <p className="pro-secondary">{progress ? `${progress.reviewed_today} of ${progress.goal} reviewed` : 'Loading…'}</p>
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="pro-h3 max-md:hidden">Today's reviews</h2>
          <p className="pro-secondary max-md:hidden">
            {progress ? `${progress.reviewed_today} of ${progress.goal} cards reviewed · ${progress.due_total} due now` : 'Loading your reviews…'}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {label: 'Due now', value: progress?.due_total ?? 0, hue: 'amber' as Hue},
              {label: 'Cards', value: progress?.total_cards ?? 0, hue: 'blue' as Hue},
              {label: 'Mastered', value: progress?.mastered ?? 0, hue: 'green' as Hue},
              {label: 'Study days', value: progress?.study_days ?? 0, hue: 'violet' as Hue},
            ].map((row) => (
              <div key={row.label} className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2" style={{borderColor: 'var(--pro-border)'}} data-hue={row.hue}>
                <span className="pro-dot" />
                <span className="pro-meta min-w-0 flex-1 truncate">{row.label}</span>
                <span className="pro-num font-semibold" style={{color: 'var(--pro-text)'}}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
        <button type="button" className="pro-btn pro-btn-primary w-full md:w-auto" disabled={!dueDeck} onClick={() => dueDeck && setStudying({deckId: dueDeck.id, mode: 'q_to_a'})}>
          <Brain className="size-4" />
          {progress?.due_total ? `Review ${progress.due_total} due` : 'Start reviewing'}
        </button>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:hidden">
        <Metric label="Mastery" value={`${Math.round(progress?.mastery ?? 0)}%`} icon={<Sparkles />} hue="green" />
        <Metric label="Decks" value={decks.length} icon={<Layers />} hue="blue" />
      </div>

      {/* decks */}
      <section className="grid gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="pro-h3">Your decks</h2>
            <p className="pro-meta">Built from the question bank and the questions you've met.</p>
          </div>
          <span className="pro-meta max-lg:hidden">{Math.round(progress?.mastery ?? 0)}% overall mastery</span>
        </div>
        {!data ? (
          <LoadingRows rows={3} />
        ) : decks.length === 0 ? (
          <div className="pro-card">
            <Empty icon={<Layers />} title="No decks yet" body="Create a deck, or add one of the ready-made decks below." />
          </div>
        ) : (
          <div className="pro-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {decks.map((deck) => {
              const hue = KIND_HUE[deck.kind] ?? 'blue';
              return (
                <article key={deck.id} className="pro-card pro-lift pro-stack relative mb-2 flex min-w-0 flex-col gap-3 p-4" data-hue={hue}>
                  <div className="flex min-w-0 items-start gap-3">
                    <Tile hue={hue}><Layers /></Tile>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[0.9375rem] font-bold tracking-tight [overflow-wrap:anywhere]" style={{color: 'var(--pro-text)'}}>{deck.name}</h3>
                      {deck.description && <p className="pro-meta pro-clamp-2 mt-0.5">{deck.description}</p>}
                    </div>
                    <div className="relative shrink-0">
                      <button type="button" className="pro-btn pro-btn-ghost pro-btn-sm px-1.5" aria-label={`More for ${deck.name}`} aria-expanded={menuFor === deck.id} onClick={() => setMenuFor(menuFor === deck.id ? null : deck.id)}>
                        <MoreHorizontal className="size-4" />
                      </button>
                      {menuFor === deck.id && <DeckMenu deck={deck} onClose={() => setMenuFor(null)} onReverse={() => { setMenuFor(null); setStudying({deckId: deck.id, mode: 'a_to_q'}); }} onRemove={() => void removeDeck(deck)} />}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {deck.stats.due > 0 ? <Badge tone="warning">{deck.stats.due} due</Badge> : <Badge tone="success">Up to date</Badge>}
                    <span className="pro-meta">{deck.stats.total} cards · {deck.stats.mastered} mastered</span>
                  </div>
                  <div className="mt-auto grid gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="pro-meta">Mastery</span>
                      <span className="pro-meta pro-num">{Math.round(deck.stats.mastery)}%</span>
                    </div>
                    <Progress value={deck.stats.mastery} tone={deck.stats.mastery >= 70 ? 'success' : undefined} label={`${deck.name} mastery`} />
                  </div>
                  <button type="button" className={`pro-btn pro-btn-sm w-full ${deck.stats.due > 0 ? 'pro-btn-primary' : 'pro-btn-soft'}`} onClick={() => setStudying({deckId: deck.id, mode: 'q_to_a'})}>
                    {deck.stats.due > 0 ? `Review ${deck.stats.due} due` : 'Study deck'}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {presets.length > 0 && (
        <section className="grid gap-3">
          <div>
            <h2 className="pro-h3">Ready-made decks</h2>
            <p className="pro-meta">One click to add — they fill themselves from your activity.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {presets.map((preset) => (
              <button key={preset.kind} type="button" onClick={() => void createDeck(preset)} className="pro-card pro-lift flex min-w-0 items-center gap-3 p-3 text-left">
                <Tile hue={KIND_HUE[preset.kind] ?? 'blue'} size="sm"><Plus /></Tile>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium" style={{color: 'var(--pro-text)'}}>{preset.name}</span>
                  <span className="pro-meta block truncate">{preset.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {creating && (
        <div className="fixed inset-0 z-[80] grid place-items-end bg-black/50 sm:place-items-center sm:p-4" role="presentation" onClick={() => setCreating(false)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-label="New deck"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void createDeck();
            }}
            className="pro-pop pro-page grid w-full gap-4 rounded-t-xl p-5 sm:max-w-md sm:rounded-xl"
          >
            <div className="flex items-center gap-3">
              <Tile hue="green"><CalendarCheck /></Tile>
              <div>
                <h2 className="pro-h3">New deck</h2>
                <p className="pro-meta">Cards come from the question bank.</p>
              </div>
            </div>
            <label className="grid gap-1.5">
              <span className="pro-meta font-medium">Name</span>
              <input autoFocus className="pro-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fundamental rights" maxLength={80} required />
            </label>
            <label className="grid gap-1.5">
              <span className="pro-meta font-medium">Topic (optional)</span>
              <input className="pro-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Leave blank for every topic" />
            </label>
            <label className="grid gap-1.5">
              <span className="pro-meta font-medium">Difficulty</span>
              <select className="pro-input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="">Any</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="pro-btn pro-btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
              <button type="submit" className="pro-btn pro-btn-primary" disabled={!name.trim()}>Create deck</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function DeckMenu({deck, onClose, onReverse, onRemove}: {deck: DeckPayload; onClose: () => void; onReverse: () => void; onRemove: () => void}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="pro-pop absolute right-0 top-full z-20 mt-1 grid w-48 p-1" role="menu">
      <button type="button" role="menuitem" className="pro-menu-item" onClick={onReverse}>
        <ArrowLeftRight className="size-4" /> Study answer first
      </button>
      <button type="button" role="menuitem" className="pro-menu-item" onClick={onRemove} style={{color: deck.is_system ? undefined : 'var(--pro-danger)'}}>
        {deck.is_system ? <RotateCcw className="size-4" /> : <Trash2 className="size-4" />}
        {deck.is_system ? 'Reset progress' : 'Delete deck'}
      </button>
    </div>
  );
}
