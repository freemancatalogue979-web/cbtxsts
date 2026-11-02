import { BrainCircuit, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { safeExternal, shortDate } from "../lib/cloverAI";
import type { AILearnedMemory as Memory, AILearnedMemoryState } from "../lib/cloverAI";
import { ErrorNote } from "./ui";

function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: () => void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={onChange}
    className={`relative w-9 h-5 rounded-full shrink-0 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-leaf focus-visible:outline-offset-2 ${checked ? "bg-leaf" : "bg-edge-2"}`}>
    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white ${checked ? "left-[18px]" : "left-0.5"}`} />
  </button>;
}

export function AILearnedMemory({ revision, disabled, onBusyChange }: {
  revision: number; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [state, setState] = useState<AILearnedMemoryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    setLoading(true); setState(null); setError(null); setNotice("");
    api.get<AILearnedMemoryState>("/ai/learned-memory")
      .then((result) => { if (alive) setState(result); })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [revision, reload]);

  async function run(action: () => Promise<void>) {
    if (disabled || lock.current) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(null); setNotice("");
    try { await action(); } catch (e) { setError(e); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  function toggle(key: "auto_learn" | "use_memory") {
    if (!state) return;
    void run(async () => {
      const saved = await api.patch<Pick<AILearnedMemoryState, "auto_learn" | "use_memory">>("/ai/learned-memory/settings", { [key]: !state[key] });
      setState((previous) => previous ? { ...previous, ...saved } : previous);
      setNotice(key === "auto_learn" ? (saved.auto_learn ? "Auto-learning is on." : "Auto-learning is off; existing memories remain.") :
        (saved.use_memory ? "Relevant memories can be used again." : "Memories won’t be added directly to future requests. Earlier chat history may still contain them."));
    });
  }
  function remove(memory: Memory) {
    if (!window.confirm("Delete this memory? Earlier chats, backups or provider logs may still contain it.")) return;
    void run(async () => {
      await api.del(`/ai/learned-memory/${memory.id}`);
      setState((previous) => previous ? { ...previous, items: previous.items.filter((item) => item.id !== memory.id) } : previous);
      setNotice("Memory deleted from the app.");
    });
  }
  function removeAll() {
    if (!window.confirm("Delete all your taught and saved research memories? Earlier chats, backups or provider logs may still contain them.")) return;
    void run(async () => {
      await api.del("/ai/learned-memory");
      setState((previous) => previous ? { ...previous, items: [] } : previous);
      setNotice("Your taught and research memories were deleted.");
    });
  }

  const blocked = disabled || busy;
  return <section className="rounded-xl border border-leaf/20 bg-panel overflow-hidden" aria-label="Private learned memory">
    <div className="flex items-start gap-3 p-4 border-b border-edge">
      <div className="rounded-lg bg-leaf/10 text-leaf p-2 shrink-0"><BrainCircuit size={17} /></div>
      <div className="min-w-0"><h2 className="text-[13px] font-extrabold">What you’ve taught me <span className="font-semibold text-mute">{state ? `· ${state.items.length}/${state.limit}` : ""}</span></h2>
        <p className="text-[11px] text-mute leading-relaxed mt-1">Say “remember this” and share a fact, or save a finding from a research source. Your memories stay private to your account and are not automatically shared as community knowledge.</p></div>
    </div>
    <div className="p-4 space-y-3">
      <p className="text-[11px] text-mute leading-relaxed">Explicit teachings may be saved automatically. When memory use is on, relevant saved facts may be sent to the external AI provider with your question. They are unverified and can be wrong. Don’t share passwords or tokens.</p>
      {loading && <p className="text-[11px] text-mute flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading your memories…</p>}
      {!loading && !state && <button type="button" className="text-[11px] text-leaf underline" disabled={blocked} onClick={() => setReload((value) => value + 1)}>Retry loading memories</button>}
      {state && <>
        <div className="rounded-lg border border-edge bg-raised/30 px-3">
          <div className="flex items-start gap-3 py-3 border-b border-edge/70"><div className="flex-1"><div className="text-[12px] font-bold">Auto-save explicit teachings</div><p className="text-[11px] text-mute mt-1">Save clear “remember this” facts and similar teachings. Ordinary chat and a link alone aren’t saved as facts.</p></div><Switch label="Auto-save explicit teachings" checked={state.auto_learn} disabled={blocked} onChange={() => toggle("auto_learn")} /></div>
          <div className="flex items-start gap-3 py-3"><div className="flex-1"><div className="text-[12px] font-bold">Use relevant memories</div><p className="text-[11px] text-mute mt-1">Include matching memories in future answers. Switching off keeps them stored but stops direct recall.</p></div><Switch label="Use relevant memories" checked={state.use_memory} disabled={blocked} onChange={() => toggle("use_memory")} /></div>
        </div>
        {state.items.length === 0 && <div className="rounded-lg border border-dashed border-edge-2 px-3 py-4 text-[11px] text-mute">No memories yet. Try “Remember this: …” followed by what you want me to know.</div>}
        {state.items.map((memory) => <details key={memory.id} className="rounded-lg border border-edge bg-raised/40 p-3 min-w-0">
          <summary className="cursor-pointer text-[12px] font-bold break-words">{memory.topic}</summary>
          <div className="flex flex-wrap gap-2 mt-2 text-[10px] font-bold text-mute"><span>{memory.source_kind === "teaching" ? "Taught by you" : "Saved research"}</span><span>· {shortDate(memory.created_at)}</span><span className="text-amber">· Unverified</span></div>
          <p className="text-[12px] text-text/90 leading-relaxed whitespace-pre-wrap break-words mt-2">{memory.content}</p>
          {memory.source_kind === "research" && <p className="text-[10px] text-mute mt-2">{memory.source_title} · {memory.published_at ? `Published ${shortDate(memory.published_at)}` : "Publication date unknown"} · Retrieved {shortDate(memory.retrieved_at)}</p>}
          <div className="flex flex-wrap gap-4 mt-3">{safeExternal(memory.source_url) && <a className="text-[10px] text-leaf inline-flex items-center gap-1 hover:underline" href={safeExternal(memory.source_url)} target="_blank" rel="noreferrer noopener">View source <ExternalLink size={11} /></a>}
            <button type="button" className="text-[10px] text-mute hover:text-crim inline-flex items-center gap-1" disabled={blocked} aria-label={`Delete memory: ${memory.topic}`} onClick={() => remove(memory)}><Trash2 size={11} /> Delete memory</button></div>
        </details>)}
        {state.items.length > 0 && <button type="button" className="btn-ghost !text-[11px]" disabled={blocked} onClick={removeAll}><Trash2 size={13} /> Delete all memories</button>}
      </>}
      {notice && <p role="status" className="text-[11px] text-leaf">{notice}</p>}
      <ErrorNote error={error} />
    </div>
  </section>;
}
