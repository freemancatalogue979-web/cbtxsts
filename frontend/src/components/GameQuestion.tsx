/**
 * Game question kit — the pieces that make answering a *challenge* rather than
 * filling in a form: chunky answer tiles that physically press, hearts, a combo
 * meter that heats up, a boss health bar for exams, and the CORRECT / NOT QUITE
 * banners with their XP float.
 *
 * Everything here is presentational. It receives a verdict and renders it; it
 * never decides correctness, never sees the key before the server does, and
 * never scores anything. Exam, practice, self-test, flashcards and duels all
 * feed it from their own server-authoritative state.
 */
import {CheckCircle2, Flame, Heart, Sparkles, X, XCircle} from 'lucide-react';
import {motion} from 'motion/react';
import type {ReactNode} from 'react';
import {XpFloat} from './ui';
import {answerEffectOf} from '../lib/cosmetics';
import type {CosmeticsRef} from '../lib/cosmetics';

/* ----------------------------------------------------------------- answer tile */

export type AnswerState = 'idle' | 'picked' | 'correct' | 'wrong' | 'muted';

/**
 * One answer. `letter` is whatever the server told us to display — the tile
 * never maps letters itself, which is what keeps shuffled exams honest.
 */
export function AnswerTile({
  letter,
  text,
  state = 'idle',
  disabled = false,
  hint,
  onPick,
}: {
  letter: string;
  text: ReactNode;
  state?: AnswerState;
  disabled?: boolean;
  /** e.g. keyboard shortcut or lives cost */
  hint?: ReactNode;
  onPick?: () => void;
}) {
  const faces: Record<AnswerState, string> = {
    idle: 'border-white/12 bg-[#0c1219] hover:border-nova-400/50 hover:bg-[#111923]',
    picked: 'border-nova-400/80 bg-nova-950/40 shadow-[0_0_15px_-3px_rgba(6,182,212,0.3)]',
    correct: 'border-emerald-500/80 bg-emerald-950/35 text-emerald-100 shadow-[0_0_15px_-3px_rgba(16,185,129,0.3)]',
    wrong: 'border-red-500/80 bg-red-950/35 text-red-100 shadow-[0_0_15px_-3px_rgba(239,68,68,0.3)]',
    muted: 'border-white/8 bg-[#080d12] opacity-50',
  };
  const badges: Record<AnswerState, string> = {
    idle: 'bg-white/8 text-mist-300 border border-white/12',
    picked: 'bg-gradient-to-br from-nova-400 to-nova-500 text-black font-black border border-nova-300',
    correct: 'bg-gradient-to-br from-emerald-400 to-emerald-500 text-black font-black border border-emerald-300',
    wrong: 'bg-gradient-to-br from-red-500 to-red-600 text-white font-black border border-red-400',
    muted: 'bg-white/6 text-mist-500 border border-white/8',
  };
  const animate =
    state === 'correct' ? 'feedback-good' : state === 'wrong' ? 'feedback-bad' : '';

  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : {scale: 0.985}}
      onClick={onPick}
      disabled={disabled}
      aria-pressed={state === 'picked'}
      className={`gbtn flex w-full min-w-0 items-center gap-2.5 rounded-lg border px-3 py-3 text-left touch-manipulation disabled:cursor-default sm:gap-3 sm:px-4 sm:py-3.5 ${faces[state]} ${animate}`}
    >
      <span className={`grid size-9 shrink-0 place-items-center rounded-md border text-[0.88rem] font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] sm:size-10 ${badges[state]}`}>
        {letter}
      </span>
      <span className="min-w-0 flex-1 text-[0.88rem] leading-snug font-semibold break-words text-mist-100 sm:text-[0.92rem]">
        {text}
      </span>
      {state === 'correct' && <CheckCircle2 className="size-5 shrink-0 text-emerald-400" />}
      {state === 'wrong' && <XCircle className="size-5 shrink-0 text-red-400" />}
      {hint !== undefined && state === 'idle' && (
        <span className="hidden shrink-0 rounded border border-white/12 px-1.5 py-0.5 text-[0.62rem] font-bold text-mist-500 sm:block">
          {hint}
        </span>
      )}
    </motion.button>
  );
}

/* ---------------------------------------------------------------------- hearts */

/** Lives, as hearts. `max` is only drawn when the mode actually grants more than one. */
export function Hearts({value, max = 3, className = ''}: {value: number; max?: number; className?: string}) {
  return (
    <span className={`flex items-center gap-0.5 ${className}`} aria-label={`${value} of ${max} lives`}>
      {Array.from({length: max}).map((_, index) => {
        const alive = index < value;
        return (
          <Heart
            key={index}
            className={`size-4 transition-all ${alive ? 'fill-flare-400 text-flare-400' : 'fill-mist-500/15 text-mist-500/45'} ${
              alive && index === value - 1 ? 'anim-pop' : ''
            }`}
          />
        );
      })}
    </span>
  );
}

/* ----------------------------------------------------------------------- combo */

/** Streak meter — grey at x1, lit from x3, on fire from x5. */
export function ComboMeter({combo, className = ''}: {combo: number; className?: string}) {
  if (combo < 2) return null;
  const hot = combo >= 5;
  const lit = combo >= 3;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-2 border-black/25 px-2 py-0.5 text-[0.7rem] font-black shadow-[inset_0_2px_0_rgba(255,255,255,0.3)] ${
        hot
          ? 'anim-glow bg-gradient-to-br from-flare-400 to-flare-600 text-white'
          : lit
            ? 'bg-gradient-to-br from-gold-300 to-gold-500 text-ink-950'
            : 'bg-white/10 text-mist-300'
      } ${className}`}
    >
      <Flame className={`size-3.5 ${hot ? 'animate-pulse' : ''}`} />x{combo}
      {hot && <span className="hidden sm:inline">On fire</span>}
    </span>
  );
}

/* -------------------------------------------------------------------- boss bar */

/**
 * Exam framing: the paper is a boss and each correct answer takes a bite out of
 * it. The bar only reflects answered/answered-correctly counts the server has
 * already recorded — it is never a place where scoring happens.
 */
export function BossBar({
  name,
  correct,
  total,
  answered,
  className = '',
}: {
  name: string;
  correct: number;
  total: number;
  answered: number;
  className?: string;
}) {
  const health = total > 0 ? Math.max(0, 100 - (correct / total) * 100) : 100;
  return (
    <div className={`card keep-dark overflow-hidden border border-nova-500/30 bg-[#0b1017] p-3 sm:p-4 ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-nova-400/40 bg-nova-950/40 text-[1.1rem] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
          ⚔
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
 <p className="truncate text-[0.84rem] font-black tracking-wider text-mist-50 sm:text-[0.90rem]">
              TACTICAL BOSS ENCOUNTER · {name}
            </p>
            <span className="text-[0.74rem] font-mono font-black text-nova-300">
              {health.toFixed(0)}% RESISTANCE
            </span>
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-md border border-white/10 bg-black/60">
            <motion.div
              className="h-full rounded-sm bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500"
              initial={false}
              animate={{width: `${health}%`}}
              transition={{type: 'spring', stiffness: 120, damping: 20}}
            />
          </div>
 <p className="mt-1 text-[0.64rem] font-bold tracking-wider text-mist-400">
            {answered}/{total} OBJECTIVES ENGAGED · {correct} CONFIRMED HITS
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- feedback */

/**
 * The verdict banner. Correct: a celebration with the XP that landed. Wrong: the
 * truth, the right letter, and a door into the explanation — never a dead end.
 */
export function AnswerFeedback({
  correct,
  chosen,
  answer,
  xp,
  xpLabel = 'XP',
  combo,
  note,
  action,
  kind = 'question',
  cosmetics,
}: {
  correct: boolean;
  chosen?: string | null;
  answer?: string | null;
  xp?: number;
  /** Duel points are not XP — the float must say what it is paying. */
  xpLabel?: string;
  combo?: number;
  note?: ReactNode;
  action?: ReactNode;
  /** Copy adapts: drills say "Not quite", boss fights say "The boss holds". */
  kind?: 'question' | 'boss' | 'duel';
  /** The player's equipped answer effect — a cosmetic that changes the shout. */
  cosmetics?: CosmeticsRef | null;
}) {
  /* A correct answer wears the equipped answer effect: PERFECT!, PERFECT
     KNOWLEDGE! — decoration only, the verdict itself is still the server's. */
  const effect = correct ? answerEffectOf(cosmetics) : null;
  const headline = correct
    ? effect?.line ?? (kind === 'boss' ? 'Direct hit!' : kind === 'duel' ? 'Point won!' : 'Correct!')
    : kind === 'boss'
      ? 'The boss holds'
      : 'Not quite';

  return (
    <motion.div
      initial={{opacity: 0, y: 10}}
      animate={{opacity: 1, y: 0}}
      transition={{duration: 0.28}}
      className={`relative min-w-0 overflow-hidden rounded-2xl border-2 px-3.5 py-3 sm:px-4 ${
        correct ? 'border-mint-400/60 bg-mint-500/14' : 'border-flare-400/60 bg-flare-500/12'
      }`}
    >
      {correct && xp ? <XpFloat amount={xp} label={xpLabel} className="top-1 right-3" /> : null}
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-full border-2 border-black/25 shadow-[inset_0_2px_0_rgba(255,255,255,0.35)] ${
            correct ? 'bg-gradient-to-br from-mint-300 to-mint-600 text-ink-950' : 'bg-gradient-to-br from-flare-400 to-flare-600 text-white'
          }`}
        >
          {correct ? <CheckCircle2 className="size-4" /> : <X className="size-4" />}
        </span>
        <p className={`game-title min-w-0 flex-1 font-display text-[0.98rem] font-black tracking-wide ${correct ? `text-mint-200 ${effect?.className ?? ''}` : 'text-flare-200'}`}>
          {headline}
        </p>
        {correct && combo !== undefined && <ComboMeter combo={combo} />}
        {!correct && xp ? (
          <span className="text-[0.7rem] font-black text-mist-400 tabular">
            +{xp} {xpLabel}
          </span>
        ) : null}
      </div>

      {!correct && answer && (
        <p className="mt-2 flex min-w-0 items-center gap-2 text-[0.8rem] font-bold text-mist-200">
          <Sparkles className="size-3.5 shrink-0 text-gold-300" />
          <span className="min-w-0 break-words">
            The answer was <span className="font-display text-[0.95rem] font-black text-gold-200">{answer}</span>
            {chosen ? <span className="text-mist-500"> — you picked {chosen}</span> : null}
          </span>
        </p>
      )}

      {note && <div className="mt-2 text-[0.82rem] leading-relaxed font-medium break-words text-mist-300">{note}</div>}
      {action && <div className="mt-2.5 flex min-w-0 flex-wrap gap-2">{action}</div>}
    </motion.div>
  );
}
