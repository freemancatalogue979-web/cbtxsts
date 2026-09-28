import {Hourglass, Snowflake, Timer} from 'lucide-react';
import {useEffect, useState} from 'react';

/** mm:ss (or h:mm:ss past an hour). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

type Props = {
  /** Countdown to a server deadline (self-ticking, skew-corrected). */
  endsAt?: string | null;
  /** Controlled countdown — the caller owns the seconds (e.g. freeze power-up). */
  remaining?: number;
  /** Full time allowed, for the ring and the "of 30:00" line. */
  totalSeconds?: number;
  /** Stopwatch origin when there is no time limit (defaults to mount time). */
  startedAt?: string | null;
  /** client − server clock difference in ms. */
  skewRef?: {readonly current: number};
  /** Freeze power-up seconds left. */
  frozen?: number;
  /** Stop ticking (run finished). */
  paused?: boolean;
  className?: string;
};

const RING = 2 * Math.PI * 20;

/**
 * The practice clock: a countdown ring when the run is timed, a stopwatch when
 * it isn't — so players always know how much time they're working with.
 * Owns its own tick so only the clock re-renders.
 */
export default function PracticeClock({endsAt, remaining, totalSeconds = 0, startedAt, skewRef, frozen = 0, paused = false, className = ''}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [paused]);

  const serverNow = now - (skewRef?.current ?? 0);
  const countdown = Boolean(endsAt) || remaining !== undefined;
  let seconds: number;
  if (endsAt) seconds = Math.max(0, Math.ceil((Date.parse(endsAt) - serverNow) / 1000));
  else if (remaining !== undefined) seconds = Math.max(0, remaining);
  else {
    const origin = startedAt ? Date.parse(startedAt) : mountedAt;
    seconds = Math.max(0, Math.floor(((startedAt ? serverNow : now) - origin) / 1000));
  }

  const total = totalSeconds > 0 ? totalSeconds : 0;
  const fraction = countdown ? (total ? seconds / total : 1) : (seconds % 60) / 60;
  const isFrozen = frozen > 0;
  const critical = countdown && !isFrozen && seconds <= 60;
  const warn = countdown && !isFrozen && !critical && (total ? seconds / total <= 0.25 : seconds <= 300);

  const tone = isFrozen
    ? {ring: '#7dd3fc', text: 'text-sky-200', box: 'border-sky-400/40 bg-sky-500/10', label: 'text-sky-300'}
    : critical
      ? {ring: '#fb7185', text: 'text-flare-200', box: 'border-flare-500/50 bg-flare-500/12', label: 'text-flare-300'}
      : warn
        ? {ring: '#fbbf24', text: 'text-gold-100', box: 'border-gold-500/40 bg-gold-500/10', label: 'text-gold-300'}
        : {ring: 'url(#practice-clock-grad)', text: 'text-mist-50', box: 'border-white/10 bg-ink-900/80', label: 'text-mist-500'};
  const Icon = isFrozen ? Snowflake : countdown ? Hourglass : Timer;
  const label = isFrozen ? `Frozen · ${frozen}s` : countdown ? (seconds === 0 ? "Time's up" : 'Time left') : 'Time spent';
  const sub = countdown ? (total ? `of ${formatClock(total)}` : 'timed run') : 'No time limit';

  return (
    <div
      role="timer"
      aria-live={critical ? 'assertive' : 'off'}
      aria-label={`${label} ${formatClock(seconds)}`}
      className={`flex shrink-0 items-center gap-2.5 rounded-2xl border py-1.5 pr-3.5 pl-1.5 backdrop-blur transition-colors ${tone.box} ${critical ? 'animate-pulse' : ''} ${className}`}
    >
      <span className="relative grid size-11 shrink-0 place-items-center">
        <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90" aria-hidden>
          <defs>
            <linearGradient id="practice-clock-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>
          </defs>
          <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke={tone.ring}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - Math.min(1, Math.max(0, fraction)))}
            style={{transition: 'stroke-dashoffset 0.5s linear, stroke 0.3s'}}
          />
        </svg>
        <Icon className={`relative size-4 ${tone.label}`} />
      </span>
      <span className="min-w-0 leading-none">
        <span className={`block text-[0.6rem] font-black tracking-[0.12em] uppercase ${tone.label}`}>{label}</span>
        <span className={`mt-1 block text-[1.3rem] font-black tabular tracking-tight ${tone.text}`}>{formatClock(seconds)}</span>
        <span className="mt-0.5 block text-[0.62rem] font-semibold text-mist-500">{sub}</span>
      </span>
    </div>
  );
}
