/** Pro Mode primitives — flat, quiet, one accent. Styles live in pro.css. */
import type {ReactNode} from 'react';

export function PageHeader({eyebrow, title, description, actions}: {eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode}) {
  return (
    <header className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <p className="pro-eyebrow">{eyebrow}</p>}
        <h1 className="pro-h1 mt-1 [overflow-wrap:anywhere]">{title}</h1>
        {description && <p className="pro-secondary mt-1.5 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({title, description, action, children, className = ''}: {title?: string; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string}) {
  return (
    <section className={`pro-card ${className}`}>
      {(title || action) && (
        <div className="flex min-w-0 items-start justify-between gap-3 px-4 pt-4 md:px-5 md:pt-5">
          <div className="min-w-0">
            {title && <h2 className="pro-h3">{title}</h2>}
            {description && <p className="pro-meta mt-0.5">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------ colour
 * One accent drives actions; six muted hues give sections and courses an
 * identity (icon tiles, rings, course marks) without turning into neon. */
export type Hue = 'blue' | 'green' | 'amber' | 'violet' | 'rose' | 'teal';
const COURSE_HUES: Record<string, Hue> = {
  violet: 'violet', purple: 'violet', indigo: 'violet', blue: 'blue', sky: 'blue', cyan: 'teal', teal: 'teal',
  emerald: 'green', green: 'green', lime: 'green', amber: 'amber', yellow: 'amber', orange: 'amber', gold: 'amber',
  rose: 'rose', red: 'rose', pink: 'rose', fuchsia: 'violet',
};
const HUE_ORDER: Hue[] = ['blue', 'violet', 'teal', 'amber', 'green', 'rose'];
/** A course keeps the same hue everywhere: its own accent when set, else a stable pick from its id. */
export function hueForCourse(course?: {id?: number | null; accent?: string | null} | null): Hue {
  const named = course?.accent ? COURSE_HUES[course.accent.toLowerCase()] : undefined;
  return named ?? HUE_ORDER[Math.abs(Number(course?.id ?? 0)) % HUE_ORDER.length];
}

/** Tinted icon square — the small splash of colour that keeps Pro lively. */
export function Tile({hue = 'blue', size = 'md', children, className = ''}: {hue?: Hue; size?: 'sm' | 'md' | 'lg'; children: ReactNode; className?: string}) {
  return (
    <span className={`pro-tile ${className}`} data-hue={hue} data-size={size} aria-hidden>
      {children}
    </span>
  );
}

/** Circular progress. Pure SVG; animates its sweep once (150–250ms territory, skipped on reduced motion). */
export function Ring({value, size = 56, stroke = 5, hue, tone, children, label}: {value: number; size?: number; stroke?: number; hue?: Hue; tone?: 'success' | 'warning' | 'danger'; children?: ReactNode; label?: string}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = tone ? `var(--pro-${tone})` : hue ? `var(--pro-h-${hue})` : 'var(--pro-accent)';
  return (
    <span className="pro-ring" style={{width: size, height: size}} role="img" aria-label={label ?? `${Math.round(pct)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--pro-track)" strokeWidth={stroke} />
        <circle
          className="pro-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children != null && <span className="pro-ring-label">{children}</span>}
    </span>
  );
}

/** Segmented choice (sizes, durations, filters). Keyboard: native radio semantics via buttons + aria. */
export function Seg<T extends string | number>({value, options, onChange, label, size = 'md', fill = false}: {value: T; options: {value: T; label: ReactNode; disabled?: boolean}[]; onChange: (value: T) => void; label: string; size?: 'sm' | 'md'; fill?: boolean}) {
  return (
    <div className={`pro-seg ${fill ? 'pro-seg-fill' : ''}`} data-size={size} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className="pro-seg-item"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Metric({label, value, sub, tone, icon, hue = 'blue'}: {label: string; value: ReactNode; sub?: ReactNode; tone?: 'success' | 'warning' | 'danger'; icon?: ReactNode; hue?: Hue}) {
  const color = tone === 'success' ? 'var(--pro-success)' : tone === 'warning' ? 'var(--pro-warning)' : tone === 'danger' ? 'var(--pro-danger)' : 'var(--pro-text-2)';
  return (
    <div className="pro-card pro-metric min-w-0 p-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="pro-eyebrow truncate">{label}</p>
        {icon && (
          <Tile hue={hue} size="sm">
            {icon}
          </Tile>
        )}
      </div>
      <p className="pro-metric-value mt-2">{value}</p>
      {sub != null && (
        <p className="pro-meta mt-1 truncate" style={{color}}>
          {sub}
        </p>
      )}
    </div>
  );
}

export function Progress({value, tone, label}: {value: number; tone?: 'success' | 'warning' | 'danger'; label?: string}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="pro-progress" data-tone={tone} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{width: `${pct}%`}} />
    </div>
  );
}

export function Badge({children, tone}: {children: ReactNode; tone?: 'accent' | 'success' | 'warning' | 'danger'}) {
  return (
    <span className="pro-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function Empty({title, body, action, icon, hue = 'blue'}: {title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode; hue?: Hue}) {
  return (
    <div className="grid place-items-center gap-2 px-4 py-10 text-center">
      {icon && (
        <Tile hue={hue} size="lg" className="mb-1">
          {icon}
        </Tile>
      )}
      <p className="pro-h3">{title}</p>
      {body && <p className="pro-secondary max-w-md">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({className = ''}: {className?: string}) {
  return <div className={`pro-skeleton ${className}`} aria-hidden />;
}

export function LoadingRows({rows = 3}: {rows?: number}) {
  return (
    <div className="grid gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({length: rows}, (_, index) => (
        <Skeleton key={index} className="h-11" />
      ))}
    </div>
  );
}

/** Accuracy → tone: the same thresholds everywhere in Pro. */
export function toneFor(accuracy: number, answered = 1): 'success' | 'warning' | 'danger' | undefined {
  if (!answered) return undefined;
  if (accuracy >= 75) return 'success';
  if (accuracy >= 50) return 'warning';
  return 'danger';
}

export function pct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value)}%`;
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function minutesLabel(minutes: number): string {
  if (!minutes || minutes < 1) return '0 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Exam answers + practice runs combined: what a student actually did. */
export function studyTotals(o: Record<string, any> | null | undefined): {answered: number; correct: number; accuracy: number; minutes: number} {
  const examAnswered = Number(o?.answered ?? 0);
  const answered = examAnswered + Number(o?.practice_answered ?? 0);
  const correct = Number(o?.correct ?? 0) + Number(o?.practice_correct ?? 0);
  const seconds = Number(o?.average_seconds ?? 0) * examAnswered + Number(o?.practice_seconds ?? 0);
  return {answered, correct, accuracy: answered ? Math.round((correct / answered) * 1000) / 10 : 0, minutes: seconds / 60};
}
