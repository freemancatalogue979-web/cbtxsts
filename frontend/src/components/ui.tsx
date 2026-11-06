import { Loader2, X } from "lucide-react";
import { createContext, useContext, useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * What the current area looks like, supplied once by the Layout so every page
 * header gets the right icon, eyebrow and hero art without each page passing it.
 */
export interface PageChromeValue {
  icon?: ReactNode;
  /** e.g. "Team ops · Scrims" */
  eyebrow?: string;
  /** Bundled hero portrait shown at its native size in the header. */
  art?: string;
}
export const PageChrome = createContext<PageChromeValue | null>(null);

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  const chrome = useContext(PageChrome);
  return (
    <header className="page-hero mb-5">
      {chrome?.art && (
        <div className="page-hero__art" aria-hidden="true">
          <img src={chrome.art} alt="" width={240} height={390} decoding="async" draggable={false} />
        </div>
      )}
      <div className="page-hero__body">
        {chrome?.icon && <div className="page-hero__icon" aria-hidden="true">{chrome.icon}</div>}
        <div className="min-w-0 flex-1">
          {chrome?.eyebrow && <div className="page-hero__eyebrow">{chrome.eyebrow}</div>}
          <h1 className="page-hero__title">{title}</h1>
          {sub && <p className="page-hero__sub">{sub}</p>}
        </div>
        {right && <div className="page-hero__actions">{right}</div>}
      </div>
    </header>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-2.5">
      <h2 className="section-pill min-w-0">{children}</h2>
      {right}
    </div>
  );
}

export function StatTile({ label, value, hint, tone = "default", icon }: {
  label: string; value: ReactNode; hint?: string; tone?: "default" | "good" | "bad" | "accent"; icon?: ReactNode;
}) {
  // "bad" keeps the fixed danger colour; the accent shifts per area, so an
  // accent-coloured number must never be mistaken for a warning.
  const toneCls = tone === "good" ? "text-leaf" : tone === "bad" ? "text-danger" : tone === "accent" ? "text-amber" : "text-text";
  return (
    <div className="card stat-tile px-3.5 py-3" data-tone={tone}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="label">{label}</div>
        {icon && <span className="stat-tile__icon" aria-hidden="true">{icon}</span>}
      </div>
      <div className={`text-[22px] font-extrabold leading-none tabular-nums ${toneCls}`}>{value}</div>
      {hint && <div className="text-[11px] text-faint mt-1.5">{hint}</div>}
    </div>
  );
}

export function Progress({ value, tone = "crim" }: { value: number; tone?: "crim" | "leaf" }) {
  return (
    <div className="h-1.5 rounded-full bg-raised overflow-hidden border border-edge/60">
      <div
        className={`h-full rounded-full ${tone === "crim" ? "bg-crim" : "bg-leaf"}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Segments({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < done ? "bg-crim" : "bg-raised border border-edge/60"}`} />
      ))}
    </div>
  );
}

export function Badge({ children, cls = "" }: { children: ReactNode; cls?: string }) {
  return <span className={`chip ${cls}`}>{children}</span>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-faint text-sm py-10 justify-center">
      <Loader2 size={16} className="animate-spin" />
      <span>{label}…</span>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card border-dashed px-4 py-8 text-center">
      <div className="text-sm font-semibold text-mute">{title}</div>
      {hint && <div className="text-xs text-faint mt-1">{hint}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label block mb-1.5">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint mt-1 block">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide = false }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className={`relative card w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[92vh] flex flex-col rounded-b-none sm:rounded-b-md`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <div className="text-[13px] font-bold uppercase tracking-[0.14em]">{title}</div>
          <button className="btn-ghost !px-2 !py-1.5" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded border border-danger/50 bg-danger/10 px-3 py-2 text-[13px] text-danger font-semibold">
      {msg}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="label pt-0.5">{k}</span>
      <span className="text-sm text-right font-semibold">{v}</span>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label = "Sections" }: {
  tabs: { id: string; label: string; count?: number }[]; value: string; onChange: (v: string) => void; label?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // Arrow keys move between tabs, as screen-reader users expect from a tablist.
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className="tabs mb-4" role="tablist" aria-label={label}>
      {tabs.map((t, index) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(event) => onKey(event, index)}
            className="tabs__tab"
          >
            <span className="truncate">{t.label}</span>
            {t.count !== undefined && <span className="tabs__count">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
