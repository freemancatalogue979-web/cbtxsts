/**
 * The arena's signature question card: a gradient hairline frame, a shine
 * sweep along the top, ghost question number in the corner, chip header and a
 * brand-gradient quote bar next to the question text. Every place the app asks
 * you something renders inside this shell so the whole arena feels like one game.
 */
import type {ReactNode} from 'react';
import {Chip} from './ui';

const DIFF_STYLES: Record<string, string> = {
  easy: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300 font-mono text-[0.68rem] tracking-wider',
  medium: 'border-amber-500/30 bg-amber-500/12 text-amber-300 font-mono text-[0.68rem] tracking-wider',
  hard: 'border-red-500/30 bg-red-500/12 text-red-300 font-mono text-[0.68rem] tracking-wider',
};

export function DifficultyChip({level}: {level?: string}) {
  if (!level) return null;
  return <Chip className={DIFF_STYLES[level] ?? ''}>{level}</Chip>;
}

export function QuestionCard({
  number,
  chips,
  aside,
  text,
  children,
  className = '',
}: {
  number?: number | string;
  chips?: ReactNode;
  aside?: ReactNode;
  text?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative rounded-xl border border-nova-500/30 bg-ink-900 p-[1.5px] shadow-2xl ${className}`}
    >
      <div className="relative overflow-hidden rounded-[calc(0.75rem-1.5px)] bg-ink-850 p-4 sm:p-6">
        <span aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-nova-400/40 to-transparent" />
        <span aria-hidden className="pointer-events-none absolute -top-24 -right-14 size-52 rounded-full bg-nova-600/15 blur-3xl" />
        {number !== undefined && (
          <span
            aria-hidden
            className="pointer-events-none absolute -top-2 right-2 font-display text-[3.8rem] leading-none font-black text-mist-50/5 sm:text-[4.8rem]"
          >
            {String(number).padStart(2, '0')}
          </span>
        )}
        {(chips || aside) && (
          <div className="relative flex items-start justify-between gap-2 sm:gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">{chips}</div>
            {aside && <div className="ml-auto flex shrink-0 items-center gap-2">{aside}</div>}
          </div>
        )}
        {text !== undefined && (
          <div className="relative mt-3 flex gap-2.5 sm:mt-4">
            <span aria-hidden className="bg-gradient-to-b from-nova-400 to-nova-700 mt-1 w-1 shrink-0 self-stretch rounded-sm" />
            <div className="min-w-0 break-words text-[0.98rem] leading-relaxed font-bold text-mist-50 sm:text-[1.12rem]">{text}</div>
          </div>
        )}
        {children && <div className="relative min-w-0">{children}</div>}
      </div>
    </div>
  );
}
