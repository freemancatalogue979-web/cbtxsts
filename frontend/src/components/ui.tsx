import { Loader2, Pause, Play, X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

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

/** One face of the header slideshow. `steps` renders the animated loop chips. */
export interface HeroSlide {
  eyebrow?: string;
  title: string;
  sub?: ReactNode;
  steps?: string[];
}

/** Time each slide stays up before the deck turns. */
export const HERO_SLIDE_MS = 6500;

/** Splits text into user-perceived characters, so emoji and accents stay whole. */
export function splitGraphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  return Array.from(text);
}

/** Stylised names (e.g. ᴋαмɪɴαʀɪ) must look exactly as typed: the all-caps
 *  style would swap α, м or ɪ for different capitals, some of which fonts lack. */
export function keepsCase(char: string): boolean {
  return /[^\u0000-\u024F]/u.test(char) && char.toUpperCase() !== char;
}

/** Shows member-typed text (names, IGNs) inside the all-caps style without
 *  swapping stylised letters for capitals the fonts may not have. */
export function CaseSafe({ text }: { text: string }) {
  if (!splitGraphemes(text).some(keepsCase)) return <>{text}</>;
  return (
    <>
      {splitGraphemes(text).map((char, index) => keepsCase(char)
        ? <span key={index} className="normal-case">{char}</span>
        : char)}
    </>
  );
}

/** Letters flip up on a 3D hinge, one after another. Words never break in the middle. Visual only. */
function FlipText({ text }: { text: string }) {
  let index = 0;
  return (
    <>
      {text.split(/(\s+)/).map((word, wordIndex) => /^\s*$/.test(word) ? (word ? " " : null) : (
        <span key={wordIndex} className="flip-word">
          {splitGraphemes(word).map((char, charIndex) => (
            <span key={charIndex} className={keepsCase(char) ? "flip-char flip-char--keep" : "flip-char"} style={{ "--i": index++ } as CSSProperties}>{char}</span>
          ))}
        </span>
      ))}
    </>
  );
}

/** True when the member asked for less motion (OS setting or the app's Calm motion toggle). */
function useCalmMotion(): boolean {
  const read = () => {
    if (typeof window === "undefined") return false;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return reduce || document.documentElement.dataset.effects === "calm";
  };
  const [calm, setCalm] = useState(read);
  useEffect(() => {
    const update = () => setCalm(read());
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    media?.addEventListener?.("change", update);
    const observer = typeof MutationObserver === "function" ? new MutationObserver(update) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-effects"] });
    return () => { media?.removeEventListener?.("change", update); observer?.disconnect(); };
  }, []);
  return calm;
}

/**
 * Page header. Always one slide (eyebrow, title, sub); pages can add more
 * `slides` to turn it into a 3D slideshow that rolls like a cube. Titles flip in
 * letter by letter with an extruded accent edge, and the banner tilts toward the
 * pointer. Calm motion / reduced motion: no auto-advance, tilt or letter flips.
 */
export function PageTitle({ title, sub, right, slides = [] }: { title: string; sub?: ReactNode; right?: ReactNode; slides?: HeroSlide[] }) {
  const chrome = useContext(PageChrome);
  const deck: HeroSlide[] = [{ eyebrow: chrome?.eyebrow, title, sub }, ...slides];
  const count = deck.length;
  const [active, setActive] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(false);
  const calm = useCalmMotion();
  const header = useRef<HTMLElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const current = Math.min(active, count - 1);
  const auto = count > 1 && !paused && !held && !hidden && !calm;

  const go = (next: number) => {
    const target = ((next % count) + count) % count;
    if (target === current) return;
    setPrevious(current);
    setActive(target);
  };

  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(() => go(current + 1), HERO_SLIDE_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, current, count]);

  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const tilt = (event: PointerEvent<HTMLElement>) => {
    const node = header.current;
    if (!node || calm || event.pointerType !== "mouse") return;
    const box = node.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    node.style.setProperty("--tilt-x", x.toFixed(3));
    node.style.setProperty("--tilt-y", y.toFixed(3));
  };
  const resetTilt = () => {
    header.current?.style.setProperty("--tilt-x", "0");
    header.current?.style.setProperty("--tilt-y", "0");
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (count > 1 && event.pointerType !== "mouse") swipe.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) go(current + (dx < 0 ? 1 : -1));
  };

  return (
    <header ref={header} className="page-hero mb-5" data-slides={count} data-calm={calm ? "true" : undefined}
      onPointerMove={tilt} onPointerLeave={() => { resetTilt(); setHeld(false); }} onPointerEnter={(e) => { if (e.pointerType === "mouse") setHeld(true); }}
      onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipe.current = null; }}
      onFocus={() => setHeld(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false); }}>
      {chrome?.art && (
        <div className="page-hero__art" aria-hidden="true">
          <img src={chrome.art} alt="" width={240} height={390} decoding="async" draggable={false} />
        </div>
      )}
      <div className="page-hero__body">
        {chrome?.icon && <div className="page-hero__icon" aria-hidden="true" key={`icon-${current}`}>{chrome.icon}</div>}
        <div className="min-w-0 flex-1">
          <h1 className="sr-only">{title}</h1>
          <div className="page-hero__deck" role={count > 1 ? "region" : undefined}
            aria-roledescription={count > 1 ? "carousel" : undefined} aria-label={count > 1 ? `${title} highlights` : undefined}>
            {deck.map((slide, index) => {
              const state = index === current ? "active" : index === previous ? "leaving" : "waiting";
              const isMain = index === 0;
              return (
                <div key={index} className="hero-slide" data-state={state}
                  role={count > 1 ? "group" : undefined} aria-roledescription={count > 1 ? "slide" : undefined}
                  aria-label={count > 1 ? `${index + 1} of ${count}` : undefined}
                  aria-hidden={index === current ? undefined : true} inert={index === current ? undefined : true}>
                  {slide.eyebrow && <div className="page-hero__eyebrow">{slide.eyebrow}</div>}
                  <div className="page-hero__title">
                    {/* The main title is already the page's <h1>; other slide titles are read once here. */}
                    {!isMain && <span className="sr-only">{slide.title}</span>}
                    <span aria-hidden="true"><FlipText text={slide.title} /></span>
                  </div>
                  {slide.steps ? (
                    <ol className="hero-loop" aria-label="Team loop">
                      {slide.steps.map((step, stepIndex) => (
                        <li key={step} className="hero-loop__step" style={{ "--i": stepIndex, "--n": slide.steps!.length } as CSSProperties}>{step}</li>
                      ))}
                    </ol>
                  ) : slide.sub && <p className="page-hero__sub">{slide.sub}</p>}
                </div>
              );
            })}
          </div>
          {count > 1 && (
            <div className="hero-controls">
              {!calm && (
                <button type="button" className="hero-controls__pause" onClick={() => setPaused((p) => !p)}
                  aria-label={paused ? "Play slideshow" : "Pause slideshow"}>
                  {paused ? <Play size={11} aria-hidden="true" /> : <Pause size={11} aria-hidden="true" />}
                </button>
              )}
              {deck.map((slide, index) => (
                <button key={index} type="button" className="hero-controls__dot" onClick={() => go(index)}
                  aria-label={`Show slide ${index + 1} of ${count}: ${slide.title}`} aria-current={index === current ? "true" : undefined} />
              ))}
            </div>
          )}
        </div>
        {right && <div className="page-hero__actions">{right}</div>}
      </div>
      {count > 1 && (
        <div className="page-hero__timer" aria-hidden="true">
          <span key={`${current}-${auto}`} data-running={auto ? "true" : undefined} style={{ animationDuration: `${HERO_SLIDE_MS}ms` }} />
        </div>
      )}
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
