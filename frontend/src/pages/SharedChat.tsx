import {
  AlignJustify, ArrowDown, ArrowUp, Check, Copy, ExternalLink, Link2, LockKeyhole, Minus, Plus, RotateCcw, Share2, Type, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getToken } from "../lib/api";
import {
  isShareToken, READER_DEFAULTS, READER_SIZE, READER_ZOOM, readReaderPrefs, saveReaderPrefs,
  type AISharedMessage, type AISharedView, type AISource, type ReaderFont, type ReaderPrefs,
} from "../lib/cloverAI";
import { AIMarkdown, AIVisuals } from "../components/AIVisuals";
import { BrandImg } from "../components/Logo";
import { Spinner } from "../components/ui";

export const READER_FONTS: Record<ReaderFont, { label: string; stack: string }> = {
  // The reader's own device font, so long answers feel like any other article on their phone.
  system: { label: "System", stack: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"' },
  serif: { label: "Serif", stack: '"Iowan Old Style", "Palatino Linotype", Charter, Georgia, Cambria, "Times New Roman", serif' },
  mono: { label: "Mono", stack: '"Courier New", Courier, ui-monospace, monospace' },
};
const SPACING: Record<ReaderPrefs["spacing"], number> = { compact: 1.45, normal: 1.7, airy: 1.95 };
const MODE_LABEL: Record<string, string> = { ai: "AI response", think: "Deep analysis", guidance: "Next step", facts: "Local facts only" };
const SOURCE_LABEL: Record<string, string> = {
  web: "Web", hero: "Hero data", community: "Community", match: "Match", esports_feed: "Esports", draft: "Draft", map: "Map", team_item: "Team item",
};

function storage(): Storage | null { try { return window.localStorage; } catch { return null; } }
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); };
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

type Load =
  | { state: "loading" }
  | { state: "ok"; view: AISharedView }
  | { state: "signin"; message: string }
  | { state: "gone"; message: string }
  | { state: "error"; message: string };

function SourceList({ sources }: { sources: AISource[] }) {
  const list = sources.filter((s) => s.label || s.url).slice(0, 12);
  if (!list.length) return null;
  return (
    <div className="share-sources">
      <div className="share-sources__title">Sources</div>
      <ul>
        {list.map((s, i) => {
          const body = <>
            <span className="share-source__kind">{SOURCE_LABEL[s.kind] ?? "Source"}</span>
            <span className="share-source__label">{s.label || host(s.url ?? "")}</span>
            {s.url && <span className="share-source__host">{host(s.url)} <ExternalLink size={11} aria-hidden="true" /></span>}
            {s.excerpt && <span className="share-source__excerpt">{s.excerpt}</span>}
          </>;
          return <li key={`${s.kind}-${i}`}>{s.url
            ? <a className="share-source" href={s.url} target="_blank" rel="noopener noreferrer nofollow">{body}</a>
            : <div className="share-source">{body}</div>}</li>;
        })}
      </ul>
    </div>
  );
}

function SharedMessage({ message, asker, index }: { message: AISharedMessage; asker: string; index: number }) {
  const [copied, setCopied] = useState(false);
  const copyBody = async () => { if (await copy(message.content)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); } };
  if (message.role === "user") {
    return (
      <div className="share-q" id={`m-${index}`}>
        <div className="share-q__who"><bdi className="ign flip-ign" dir="auto">{asker}</bdi> <span>asked</span> · <time dateTime={message.created_at}>{when(message.created_at)}</time></div>
        <div className="share-q__bubble">{message.content}</div>
        <SourceList sources={message.sources} />
      </div>
    );
  }
  const mode = MODE_LABEL[message.mode] ?? "AI response";
  return (
    <article className="share-a" id={`m-${index}`}>
      <header className="share-a__head">
        <span className="share-a__logo"><BrandImg size={26} /></span>
        <div className="min-w-0 flex-1">
          <div className="share-a__name">9 Clover AI</div>
          <div className="share-a__meta"><span className={`share-a__mode ${message.mode === "facts" ? "share-a__mode--facts" : ""}`}>{mode}</span> · <time dateTime={message.created_at}>{when(message.created_at)}</time></div>
        </div>
        <button type="button" className="share-icon-btn" onClick={copyBody} aria-label="Copy this answer" title="Copy text">
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </header>
      <div className="share-md ai-markdown"><AIMarkdown content={message.content} /></div>
      <div className="share-visuals"><AIVisuals sources={message.sources} /></div>
      {message.note && <p className="share-a__note">{message.note}</p>}
      <SourceList sources={message.sources} />
    </article>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; style?: CSSProperties }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="share-seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)} style={o.style}>{o.label}</button>)}
    </div>
  );
}

function ReaderPanel({ prefs, onChange, onClose }: { prefs: ReaderPrefs; onChange: (p: ReaderPrefs) => void; onClose: () => void }) {
  const set = (patch: Partial<ReaderPrefs>) => onChange({ ...prefs, ...patch });
  const size = (d: number) => set({ size: Math.min(READER_SIZE.max, Math.max(READER_SIZE.min, prefs.size + d)) });
  const zoom = (d: number) => set({ zoom: Math.round(Math.min(READER_ZOOM.max, Math.max(READER_ZOOM.min, prefs.zoom + d)) * 10) / 10 });
  return (
    <div className="share-panel" role="dialog" aria-label="Reading settings">
      <div className="share-panel__row share-panel__row--head">
        <span className="share-panel__title"><Type size={15} /> Reading settings</span>
        <button type="button" className="share-icon-btn" aria-label="Close reading settings" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="share-panel__row">
        <span className="share-panel__label">Font</span>
        <Segmented label="Font" value={prefs.font} onChange={(font) => set({ font })}
          options={(Object.keys(READER_FONTS) as ReaderFont[]).map((id) => ({ id, label: READER_FONTS[id].label, style: { fontFamily: READER_FONTS[id].stack } }))} />
      </div>
      <div className="share-panel__row">
        <span className="share-panel__label">Text size</span>
        <div className="share-stepper">
          <button type="button" aria-label="Smaller text" onClick={() => size(-1)} disabled={prefs.size <= READER_SIZE.min}><Minus size={14} /></button>
          <input type="range" min={READER_SIZE.min} max={READER_SIZE.max} step={1} value={prefs.size} aria-label="Text size"
            onChange={(e) => set({ size: Number(e.target.value) })} />
          <button type="button" aria-label="Bigger text" onClick={() => size(1)} disabled={prefs.size >= READER_SIZE.max}><Plus size={14} /></button>
          <span className="share-stepper__value">{prefs.size}px</span>
        </div>
      </div>
      <div className="share-panel__row">
        <span className="share-panel__label">Zoom</span>
        <div className="share-stepper">
          <button type="button" aria-label="Zoom out" onClick={() => zoom(-0.1)} disabled={prefs.zoom <= READER_ZOOM.min}><Minus size={14} /></button>
          <span className="share-stepper__value share-stepper__value--wide">{Math.round(prefs.zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => zoom(0.1)} disabled={prefs.zoom >= READER_ZOOM.max}><Plus size={14} /></button>
        </div>
      </div>
      <div className="share-panel__row">
        <span className="share-panel__label">Line spacing</span>
        <Segmented label="Line spacing" value={prefs.spacing} onChange={(spacing) => set({ spacing })}
          options={[{ id: "compact", label: "Tight" }, { id: "normal", label: "Normal" }, { id: "airy", label: "Airy" }]} />
      </div>
      <div className="share-panel__row">
        <span className="share-panel__label">Page width</span>
        <Segmented label="Page width" value={prefs.width} onChange={(width) => set({ width })}
          options={[{ id: "narrow", label: "Comfort" }, { id: "wide", label: "Wide" }]} />
      </div>
      <div className="share-panel__row share-panel__row--foot">
        <span className="text-[11px] text-faint">Saved on this device. Pinch or Ctrl + scroll also zooms.</span>
        <button type="button" className="share-chip-btn" onClick={() => onChange(READER_DEFAULTS)}><RotateCcw size={13} /> Reset</button>
      </div>
    </div>
  );
}

/** Full-screen reader for a shared AI answer or chat (route #/share/<token>). Works signed in or out. */
export function SharedChatPage({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => readReaderPrefs(storage()));
  const [panel, setPanel] = useState(false);
  const [progress, setProgress] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { saveReaderPrefs(storage(), prefs); }, [prefs]);

  const fetchShare = useCallback(async () => {
    if (!isShareToken(token)) { setLoad({ state: "gone", message: "This link isn't complete. Ask for it again." }); return; }
    setLoad({ state: "loading" });
    try {
      const bearer = getToken();
      // Plain fetch: a 401 here means "team link", it must not sign the member out of the hub.
      const res = await fetch(`/api/shared/${encodeURIComponent(token)}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setLoad({ state: "ok", view: body as AISharedView });
      else if (res.status === 401) setLoad({ state: "signin", message: body.detail || "Sign in to open this link." });
      else if (res.status === 404) setLoad({ state: "gone", message: body.detail || "This link was removed." });
      else setLoad({ state: "error", message: body.detail || "Something went wrong." });
    } catch {
      setLoad({ state: "error", message: "Can't reach the hub right now. Check your connection and try again." });
    }
  }, [token]);
  useEffect(() => { void fetchShare(); }, [fetchShare]);

  const view = load.state === "ok" ? load.view : null;
  useEffect(() => {
    document.title = view ? `${view.title} · 9 Clover AI` : "Shared from 9 Clover AI";
  }, [view]);

  // Reading progress + keyboard text size (+ / −) when not typing.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => setProgress(el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 1);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [view]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest?.("input, textarea")) return;
      if (e.key === "+" || e.key === "=") setPrefs((p) => ({ ...p, size: Math.min(READER_SIZE.max, p.size + 1) }));
      else if (e.key === "-" || e.key === "_") setPrefs((p) => ({ ...p, size: Math.max(READER_SIZE.min, p.size - 1) }));
      else if (e.key === "Escape") setPanel(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const style = useMemo(() => ({
    "--reader-font": READER_FONTS[prefs.font].stack,
    "--reader-size": `${prefs.size}px`,
    "--reader-lh": String(SPACING[prefs.spacing]),
    "--reader-width": prefs.width === "wide" ? "1100px" : "760px",
    "--reader-zoom": String(prefs.zoom),
  }) as CSSProperties, [prefs]);

  const counts = view ? { asked: view.messages.filter((m) => m.role === "user").length, answers: view.messages.filter((m) => m.role === "assistant").length } : null;
  const shareLink = async () => {
    const url = window.location.href;
    if (typeof navigator.share === "function" && window.matchMedia?.("(pointer: coarse)").matches) {
      try { await navigator.share({ title: view?.title, url }); return; } catch { /* fall back to copy */ }
    }
    if (await copy(url)) { setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 1800); }
  };
  const signIn = () => {
    try { window.sessionStorage.setItem("clover_after_login", window.location.hash); } catch { /* storage blocked */ }
    window.location.hash = "/login";
  };

  return (
    <div className="share-reader" style={style}>
      <div className="share-bar">
        <a href="#/dashboard" className="share-bar__brand" aria-label="Open 9 Clover"><BrandImg size={28} /></a>
        <div className="share-bar__title">
          <div className="share-bar__name">{view?.title ?? "Shared from 9 Clover AI"}</div>
          <div className="share-bar__sub">{view ? (view.kind === "chat" ? "Shared conversation" : "Shared answer") : "9 Clover AI"}</div>
        </div>
        {view && <>
          <button type="button" className={`share-chip-btn ${panel ? "share-chip-btn--on" : ""}`} aria-expanded={panel} onClick={() => setPanel((v) => !v)} title="Font, size and zoom">
            <Type size={15} /> <span className="share-hide-xs">Aa</span>
          </button>
          <button type="button" className="share-chip-btn" onClick={shareLink} title="Copy link">
            {linkCopied ? <Check size={15} /> : <Share2 size={15} />} <span className="share-hide-xs">{linkCopied ? "Copied" : "Share"}</span>
          </button>
        </>}
        <div className="share-bar__progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      </div>
      {panel && view && <ReaderPanel prefs={prefs} onChange={setPrefs} onClose={() => setPanel(false)} />}

      <div ref={scroller} className="share-scroll">
        {load.state === "loading" && <div className="share-center"><Spinner label="Opening the shared chat" /></div>}
        {load.state === "signin" && <div className="share-center"><div className="share-card">
          <LockKeyhole size={26} className="text-amber" />
          <h1>Team only link</h1>
          <p>{load.message}</p>
          <button type="button" className="btn-primary justify-center w-full" onClick={signIn}>Sign in to open</button>
        </div></div>}
        {(load.state === "gone" || load.state === "error") && <div className="share-center"><div className="share-card">
          <Link2 size={26} className="text-crim" />
          <h1>{load.state === "gone" ? "Link not available" : "Couldn't open it"}</h1>
          <p>{load.message}</p>
          {load.state === "error" && <button type="button" className="btn-primary justify-center w-full" onClick={() => void fetchShare()}>Try again</button>}
          <a className="btn-ghost justify-center w-full mt-2" href="#/dashboard">Go to 9 Clover</a>
        </div></div>}

        {view && counts && (
          <main className="share-main">
            <header className="share-intro">
              <span className="share-intro__pill">{view.kind === "chat" ? "Conversation" : "AI answer"}</span>
              <h1 className="share-intro__title">{view.title}</h1>
              <div className="share-intro__meta">
                Shared by <bdi className="ign flip-ign" dir="auto">{view.shared_by.name}</bdi> · {when(view.created_at)}
                {view.kind === "chat" && <> · {counts.asked} {counts.asked === 1 ? "question" : "questions"}, {counts.answers} {counts.answers === 1 ? "answer" : "answers"}</>}
              </div>
            </header>
            <div className="share-thread">
              {view.messages.map((m, i) => <SharedMessage key={m.id} message={m} asker={view.shared_by.name} index={i} />)}
            </div>
            {view.truncated && <p className="share-foot">Only the first {view.messages.length} messages are shown.</p>}
            <footer className="share-foot">
              <AlignJustify size={14} aria-hidden="true" /> Answers were written by 9 Clover AI. Check important facts before you rely on them.
              <div className="mt-3"><a className="share-chip-btn" href="#/dashboard"><BrandImg size={16} /> Open 9 Clover</a></div>
            </footer>
          </main>
        )}
      </div>

      {view && view.messages.length > 2 && <div className="share-jump">
        <button type="button" aria-label="Back to top" onClick={() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" })}><ArrowUp size={16} /></button>
        <button type="button" aria-label="Jump to the end" onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}><ArrowDown size={16} /></button>
      </div>}
    </div>
  );
}
