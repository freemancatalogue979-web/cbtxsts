/**
 * Staff assistant chat pieces:
 *  - WorkLog: the live "Thinking…" panel → collapses to "Thought for 14s"
 *    (model reasoning, what it said while working, and every tool it ran)
 *  - ThinkToggle: deep-thinking on/off for the next message
 *  - StopButton: replaces Send while the assistant works
 */
import {Brain, Check, ChevronDown, Loader2, ShieldAlert, Square, Wrench} from 'lucide-react';
import {useEffect, useState} from 'react';
import type {WorkStep} from '../lib/tutor';

function useElapsed(running: boolean, since: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);
  return Math.max(0, Math.round(((running ? now : Date.now()) - since) / 1000));
}

function seconds(total: number): string {
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

/** Live work panel. `live` = still running; `ms` = final duration once done. */
export function WorkLog({steps, live, status, startedAt, ms, thinking, stopped}: {
  steps: WorkStep[];
  live: boolean;
  status?: string;
  startedAt?: number;
  ms?: number;
  thinking?: boolean;
  stopped?: boolean;
}) {
  const [open, setOpen] = useState(live);
  useEffect(() => { if (!live) setOpen(false); }, [live]);
  const elapsed = useElapsed(live, startedAt ?? Date.now());
  if (!live && !steps.length) return null;
  const tools = steps.filter((s) => s.kind === 'tool').length;
  const thoughts = steps.filter((s) => s.kind === 'thought').length;
  const duration = live ? elapsed : Math.round((ms ?? 0) / 1000);
  const title = live
    ? (status || (thinking ? 'Thinking…' : 'Working…'))
    : stopped
      ? `Stopped after ${seconds(duration)}`
      : thoughts
        ? `Thought for ${seconds(duration)}`
        : `Worked for ${seconds(duration)}`;
  const detail = [thoughts ? `${thoughts} thought${thoughts === 1 ? '' : 's'}` : '', tools ? `${tools} tool${tools === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');

  return (
    <div className={`mb-2 overflow-hidden rounded-xl border ${live ? 'border-nova-400/30 bg-nova-500/[0.06]' : 'border-white/8 bg-white/[0.02]'}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-white/[0.03]"
      >
        <span className={`grid size-5 shrink-0 place-items-center rounded-md ${live ? 'bg-nova-500/25 text-nova-100' : 'bg-white/[0.06] text-mist-400'}`}>
          {live ? <Loader2 className="size-3 animate-spin" /> : thinking ? <Brain className="size-3" /> : <Wrench className="size-3" />}
        </span>
        <span className={`min-w-0 flex-1 truncate text-[0.74rem] font-extrabold ${live ? 'shimmer-text' : 'text-mist-300'}`}>{title}</span>
        {live && <span className="shrink-0 text-[0.66rem] font-bold text-nova-200/80 tabular">{seconds(elapsed)}</span>}
        {!live && detail && <span className="hidden shrink-0 text-[0.64rem] font-bold text-mist-500 sm:inline">{detail}</span>}
        <ChevronDown className={`size-3.5 shrink-0 text-mist-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ol className="relative max-h-72 space-y-1.5 overflow-y-auto overscroll-contain border-t border-white/6 px-2.5 py-2">
          {steps.length === 0 && (
            <li className="flex items-center gap-2 text-[0.72rem] font-semibold text-mist-400">
              <span className="flex gap-0.5">{[0, 1, 2].map((d) => <span key={d} className="size-1 animate-bounce rounded-full bg-nova-300" style={{animationDelay: `${d * 140}ms`}} />)}</span>
              {thinking ? 'Reasoning about your request…' : 'Reading your request…'}
            </li>
          )}
          {steps.map((step, i) => <Step key={i} step={step} />)}
        </ol>
      )}
    </div>
  );
}

function Step({step}: {step: WorkStep}) {
  const [more, setMore] = useState(false);
  if (step.kind === 'tool') {
    const {tool} = step;
    const running = tool.status === 'running';
    const failed = !running && tool.status !== 'ok';
    return (
      <li className="flex min-w-0 items-start gap-2">
        <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ${running ? 'bg-nova-500/25 text-nova-100' : failed ? 'bg-flare-500/20 text-flare-200' : 'bg-mint-500/20 text-mint-200'}`}>
          {running ? <Loader2 className="size-2.5 animate-spin" /> : failed ? <ShieldAlert className="size-2.5" /> : <Check className="size-2.5" />}
        </span>
        <span className="min-w-0 flex-1 text-[0.72rem] leading-snug">
          <span className="font-extrabold text-mist-100">{tool.label || tool.name}</span>
          {tool.summary && <span className="text-mist-400"> — {tool.summary}</span>}
          {tool.ms != null && !running && <span className="ml-1 text-[0.62rem] font-bold text-mist-600 tabular">{(tool.ms / 1000).toFixed(1)}s</span>}
        </span>
      </li>
    );
  }
  const long = step.text.length > 320;
  const text = long && !more ? `${step.text.slice(0, 320).trimEnd()}…` : step.text;
  return (
    <li className="flex min-w-0 items-start gap-2">
      <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ${step.kind === 'thought' ? 'bg-pulse-500/20 text-pulse-200' : 'bg-white/[0.07] text-mist-300'}`}>
        {step.kind === 'thought' ? <Brain className="size-2.5" /> : <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <span className={`min-w-0 flex-1 text-[0.72rem] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${step.kind === 'thought' ? 'text-mist-400 italic' : 'text-mist-300'}`}>
        {text}
        {long && (
          <button type="button" onClick={() => setMore((v) => !v)} className="ml-1 text-[0.66rem] font-bold text-nova-300 not-italic hover:text-nova-200">
            {more ? 'less' : 'more'}
          </button>
        )}
      </span>
    </li>
  );
}

export function ThinkToggle({on, onChange, disabled}: {on: boolean; onChange: (on: boolean) => void; disabled?: boolean}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      disabled={disabled}
      aria-pressed={on}
      title={on ? 'Deep thinking is on — slower, more careful answers. Click to turn off.' : 'Deep thinking is off — fastest answers. Click to turn on.'}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[0.72rem] font-extrabold transition disabled:opacity-40 ${
        on ? 'border-pulse-400/40 bg-pulse-500/15 text-pulse-100 hover:bg-pulse-500/25' : 'border-white/10 bg-white/[0.03] text-mist-400 hover:text-mist-200'
      }`}
    >
      <Brain className="size-4" />
      <span className="hidden sm:inline">Think</span>
    </button>
  );
}

export function StopButton({onClick}: {onClick: () => void}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Stop"
      aria-label="Stop the assistant"
      className="relative grid size-11 shrink-0 place-items-center rounded-full bg-mist-50 text-ink-950 shadow-lg shadow-black/30 transition hover:bg-white active:scale-95"
    >
      <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-mist-50/25" />
      <Square className="relative size-3.5 fill-current" />
    </button>
  );
}
