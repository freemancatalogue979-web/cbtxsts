/**
 * Pieces the tool-using tutor adds to a chat bubble:
 *  - ToolTrail: a compact "what I looked at" row (course topics, your progress…)
 *  - ActionCards: things the AI made — a real mini exam with a START button.
 */
import {Check, ChevronRight, FileQuestion, Gauge, Loader2, Play, ShieldAlert, Sparkles, Timer, Wrench} from 'lucide-react';
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
  const topics = card.topics ?? [];
  const shown = topics.slice(0, 3);
  const perQuestion = card.question_count ? Math.round((card.duration_minutes * 60) / card.question_count) : 0;
  return (
    <div className="relative overflow-hidden rounded-2xl p-px" style={{background: 'linear-gradient(135deg, rgba(167,139,250,0.7), rgba(56,189,248,0.25) 45%, rgba(236,72,153,0.45))'}}>
      <div className="relative overflow-hidden rounded-[calc(1rem-1px)] bg-ink-950/95 p-3.5 sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-nova-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-10 size-36 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="relative flex items-start gap-3">
          <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-nova-300 to-pulse-600 text-white shadow-lg shadow-nova-900/50">
            <FileQuestion className="size-5" />
            <span className="absolute -right-1.5 -bottom-1.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-ink-950 bg-mint-400 px-1 text-[0.6rem] font-black text-ink-950 tabular">{card.question_count}</span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-[0.6rem] font-black tracking-[0.14em] text-nova-300 uppercase">
              <Sparkles className="size-3" /> Mini exam ready{card.course ? <span className="text-mist-500"> · {card.course}</span> : null}
            </p>
            <p className="mt-0.5 text-[0.95rem] leading-snug font-black text-mist-50">{card.title}</p>
          </div>
        </div>
        {shown.length > 0 && (
          <div className="relative mt-2.5 flex flex-wrap gap-1">
            {shown.map((t) => (
              <span key={t} className="max-w-full truncate rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[0.66rem] font-bold text-mist-300">
                <span className="text-nova-400">#</span> {t}
              </span>
            ))}
            {topics.length > shown.length && <span className="rounded-full border border-dashed border-white/12 px-2 py-0.5 text-[0.66rem] font-bold text-mist-500">+{topics.length - shown.length} more</span>}
          </div>
        )}
        <div className="relative mt-3 grid grid-cols-3 gap-1.5">
          <Stat icon={<FileQuestion className="size-3.5" />} tone="bg-nova-500/15 text-nova-200" value={String(card.question_count)} label="questions" />
          <Stat icon={<Timer className="size-3.5" />} tone="bg-sky-500/15 text-sky-200" value={`${card.duration_minutes}m`} label={perQuestion ? `~${perQuestion}s each` : 'minutes'} />
          <Stat icon={<Gauge className="size-3.5" />} tone="bg-amber-500/15 text-amber-200" value={DIFFICULTY[card.difficulty] ?? card.difficulty} label="difficulty" extra={<DifficultyMeter level={card.difficulty} />} />
        </div>
        <button
          onClick={() => openMiniExam(card.id)}
          className="relative mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-nova-300 to-nova-600 text-[0.84rem] font-black tracking-wide text-white shadow-lg shadow-nova-900/50 transition hover:brightness-110 active:scale-[0.99]"
        >
          <Play className="size-4 fill-current" /> Open exam <ChevronRight className="size-4 opacity-70" />
        </button>
      </div>
    </div>
  );
}

function DifficultyMeter({level}: {level: string}) {
  const bars = level === 'easy' ? ['bg-mint-400', '', ''] : level === 'medium' ? ['bg-amber-400', 'bg-amber-400', ''] : level === 'hard' ? ['bg-flare-400', 'bg-flare-400', 'bg-flare-400'] : ['bg-mint-400', 'bg-amber-400', 'bg-flare-400'];
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {bars.map((c, i) => <span key={i} className={`w-1 rounded-sm ${c || 'bg-white/12'}`} style={{height: 5 + i * 3}} />)}
    </span>
  );
}

function Stat({icon, value, label, tone, extra}: {icon: React.ReactNode; value: string; label: string; tone: string; extra?: React.ReactNode}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/8 bg-white/[0.035] p-2">
      <div className="flex items-center justify-between gap-1">
        <span className={`grid size-6 shrink-0 place-items-center rounded-lg ${tone}`}>{icon}</span>
        {extra}
      </div>
      <p className="mt-1.5 truncate text-[0.86rem] leading-none font-black text-mist-50 tabular">{value}</p>
      <p className="mt-0.5 truncate text-[0.56rem] font-black tracking-[0.08em] text-mist-500 uppercase">{label}</p>
    </div>
  );
}
