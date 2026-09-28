/**
 * Pieces the tool-using tutor adds to a chat bubble:
 *  - ToolTrail: a compact "what I looked at" row (course topics, your progress…)
 *  - ActionCards: things the AI made — a real mini exam with a START button.
 */
import {Check, ChevronRight, Clock, FileQuestion, Loader2, ShieldAlert, Sparkles, Timer, Wrench} from 'lucide-react';
import {openMiniExam, type AgentAction, type MiniExamCard, type ToolEvent} from '../../lib/tutor';

const DIFFICULTY: Record<string, string> = {easy: 'Easy', medium: 'Medium', hard: 'Hard', mixed: 'Mixed'};

/** Latest status per tool name, keeping first-seen order. */
export function mergeTool(list: ToolEvent[] | undefined, next: ToolEvent): ToolEvent[] {
  const rows = [...(list ?? [])];
  const at = rows.findIndex((row) => row.name === next.name && row.status === 'running');
  if (at >= 0) rows[at] = next;
  else rows.push(next);
  return rows;
}

export function ToolTrail({tools, live}: {tools: ToolEvent[]; live?: boolean}) {
  if (!tools.length) return null;
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1" aria-label="What the tutor checked">
      {tools.map((tool, index) => {
        const running = tool.status === 'running';
        const failed = tool.status !== 'ok' && !running;
        return (
          <span
            key={`${tool.name}-${index}`}
            title={tool.summary || tool.label}
            className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[0.66rem] font-bold ${
              running
                ? 'border-nova-400/30 bg-nova-500/10 text-nova-200'
                : failed
                  ? 'border-white/8 bg-white/[0.02] text-mist-600'
                  : 'border-white/8 bg-white/[0.03] text-mist-400'
            }`}
          >
            {running ? <Loader2 className="size-3 animate-spin" /> : failed ? <ShieldAlert className="size-3" /> : <Check className="size-3 text-mint-300" />}
            <span className="truncate">{tool.label || tool.name}</span>
          </span>
        );
      })}
      {live && tools.every((tool) => tool.status !== 'running') && (
        <span className="inline-flex items-center gap-1 px-1 text-[0.66rem] font-bold text-mist-500">
          <Wrench className="size-3" /> writing…
        </span>
      )}
    </div>
  );
}

export function ActionCards({actions}: {actions: AgentAction[]}) {
  const cards = actions.filter((action): action is MiniExamCard => action.type === 'mini_exam');
  if (!cards.length) return null;
  return (
    <div className="mt-2 grid gap-2">
      {cards.map((card) => (
        <MiniExamStartCard key={card.id} card={card} />
      ))}
    </div>
  );
}

function MiniExamStartCard({card}: {card: MiniExamCard}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-nova-400/25 bg-gradient-to-br from-nova-500/[0.14] via-ink-900/60 to-pulse-500/[0.08] p-3.5 sm:p-4">
      <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-nova-500/15 blur-2xl" />
      <div className="relative flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-nova-400 to-pulse-500 text-white shadow-lg shadow-nova-900/40">
          <FileQuestion className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[0.62rem] font-extrabold tracking-[0.14em] text-nova-300 uppercase">
            <Sparkles className="size-3" /> Mini exam{card.course ? ` · ${card.course}` : ''}
          </p>
          <p className="mt-0.5 text-[0.95rem] leading-snug font-extrabold text-mist-50">{card.title}</p>
          {card.topics?.length > 0 && <p className="mt-0.5 line-clamp-2 text-[0.74rem] text-mist-400">{card.topics.join(' · ')}</p>}
        </div>
      </div>
      <div className="relative mt-3 grid grid-cols-3 gap-1.5">
        <Stat icon={<FileQuestion className="size-3.5" />} value={String(card.question_count)} label="questions" />
        <Stat icon={<Timer className="size-3.5" />} value={`${card.duration_minutes}`} label="minutes" />
        <Stat icon={<Clock className="size-3.5" />} value={DIFFICULTY[card.difficulty] ?? card.difficulty} label="difficulty" />
      </div>
      <button
        onClick={() => openMiniExam(card.id)}
        className="relative mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-nova-400 to-nova-600 text-[0.84rem] font-extrabold tracking-wide text-white shadow-lg shadow-nova-900/40 transition hover:from-nova-300 hover:to-nova-500 active:scale-[0.99]"
      >
        Open exam <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

function Stat({icon, value, label}: {icon: React.ReactNode; value: string; label: string}) {
  return (
    <div className="rounded-xl border border-white/8 bg-ink-950/40 px-2 py-1.5 text-center">
      <p className="flex items-center justify-center gap-1 text-[0.86rem] font-extrabold text-mist-50">
        <span className="text-nova-300">{icon}</span>
        {value}
      </p>
      <p className="text-[0.6rem] font-bold tracking-wide text-mist-500 uppercase">{label}</p>
    </div>
  );
}
