import { Loader2, X } from "lucide-react";
import type { ReactNode } from "react";

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-lg sm:text-xl font-extrabold tracking-[0.14em] uppercase">{title}</h1>
        {sub && <p className="text-[13px] text-mute mt-1">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <div className="flex items-center gap-2">
        <span className="inline-block w-1 h-3.5 bg-crim rounded-sm" />
        <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-mute">{children}</h2>
      </div>
      {right}
    </div>
  );
}

export function StatTile({ label, value, hint, tone = "default" }: {
  label: string; value: ReactNode; hint?: string; tone?: "default" | "good" | "bad" | "accent";
}) {
  const toneCls = tone === "good" ? "text-leaf" : tone === "bad" ? "text-crim" : tone === "accent" ? "text-amber" : "text-text";
  return (
    <div className="card px-3.5 py-3">
      <div className="label mb-1.5">{label}</div>
      <div className={`text-xl font-extrabold leading-none tabular-nums ${toneCls}`}>{value}</div>
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
      role="dialog" aria-modal="true">
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
    <div className="rounded border border-crim/50 bg-crim-dim/40 px-3 py-2 text-[13px] text-crim font-medium">
      {msg}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="label pt-0.5">{k}</span>
      <span className="text-sm text-right font-medium">{v}</span>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: {
  tabs: { id: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-edge mb-4 -mx-1 px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-2 text-[12px] font-bold uppercase tracking-[0.1em] whitespace-nowrap border-b-2 -mb-px transition-colors ${
            value === t.id ? "border-crim text-text" : "border-transparent text-faint hover:text-mute"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
