import { BrainCircuit, Check, Loader2, PenLine, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import type { AIMemoryCategory, AIMemoryNote } from "../lib/cloverAI";
import { ErrorNote } from "./ui";

const categories: { id: AIMemoryCategory; label: string }[] = [
  { id: "strength", label: "Strength" },
  { id: "focus", label: "Focus area" },
  { id: "preference", label: "Preference" },
  { id: "goal", label: "Goal" },
];
const categoryLabel = (value: AIMemoryCategory) => categories.find((item) => item.id === value)?.label || "Note";

type Editor = { id: string | null; category: AIMemoryCategory; content: string; share: boolean };

export function AIMemoryNotes({ revision, disabled, onBusyChange }: {
  revision: number; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [notes, setNotes] = useState<AIMemoryNote[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const lock = useRef(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setNotes(null); setEditor(null); setError(null); setNotice("");
    api.get<AIMemoryNote[]>("/ai/memory-notes")
      .then((items) => { if (alive) setNotes(items); })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [revision, reload]);

  async function run(action: () => Promise<void>) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(null); setNotice("");
    try { await action(); }
    catch (e) { setError(e); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editor?.content.trim()) return;
    const current = editor;
    await run(async () => {
      const body = { category: current.category, content: current.content.trim(), share_in_context: current.share };
      const saved = current.id
        ? await api.patch<AIMemoryNote>(`/ai/memory-notes/${current.id}`, body)
        : await api.post<AIMemoryNote>("/ai/memory-notes", body);
      setNotes((previous) => current.id ? (previous ?? []).map((item) => item.id === saved.id ? saved : item) : [...(previous ?? []), saved]);
      setEditor(null);
      setNotice(saved.share_in_context ? "Note saved and enabled for future AI requests." : "Note saved; it won’t be added directly to future requests.");
    });
  }
  function toggle(note: AIMemoryNote) {
    void run(async () => {
      const saved = await api.patch<AIMemoryNote>(`/ai/memory-notes/${note.id}`, { share_in_context: !note.share_in_context });
      setNotes((previous) => (previous ?? []).map((item) => item.id === saved.id ? saved : item));
      setNotice(saved.share_in_context ? "Note enabled for future AI requests." : "Note removed from direct context; past messages may still contain it.");
    });
  }
  function remove(note: AIMemoryNote) {
    if (!window.confirm("Delete this coaching note? Existing chats, backups or provider logs may still contain information shared earlier.")) return;
    void run(async () => {
      await api.del(`/ai/memory-notes/${note.id}`);
      setNotes((previous) => (previous ?? []).filter((item) => item.id !== note.id));
      if (editor?.id === note.id) setEditor(null);
      setNotice("Coaching note deleted from the app.");
    });
  }

  const blocked = disabled || busy;
  return <section className="rounded-xl border border-edge bg-panel overflow-hidden" aria-label="Coaching notes">
    <div className="flex flex-wrap items-start justify-between gap-3 p-4 border-b border-edge">
      <div className="flex gap-3 min-w-0">
        <div className="rounded-lg bg-leaf/10 text-leaf p-2 h-fit"><BrainCircuit size={16} /></div>
        <div className="min-w-0"><h3 className="text-[13px] font-extrabold">Coaching notes <span className="font-semibold text-faint">{notes ? `· ${notes.length}/12` : ""}</span></h3>
          <p className="text-[11px] text-mute leading-relaxed mt-1 max-w-xl">Write your own strengths, focus areas and preferences. Nothing is learned automatically from your chats.</p></div>
      </div>
      <button type="button" className="btn-ghost !text-[11px]" disabled={blocked || !notes || notes.length >= 12 || Boolean(editor)}
        onClick={() => setEditor({ id: null, category: "focus", content: "", share: false })}><Plus size={13} /> Add note</button>
    </div>
    <div className="p-4 space-y-3">
      <p className="text-[10px] text-faint leading-relaxed">Each note starts off. Enabling it includes it in future provider requests even when profile sharing is off. Turning it off stops direct inclusion, but earlier messages may still contain it and be sent as chat history. Backups and provider logs may retain it too.</p>
      {loading && <p className="text-[11px] text-faint flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Loading your notes…</p>}
      {!loading && !notes && <button type="button" className="text-[11px] text-leaf underline" disabled={blocked} onClick={() => setReload((value) => value + 1)}>Retry loading notes</button>}
      {notes?.length === 0 && !editor && <div className="rounded-lg border border-dashed border-edge-2 px-3 py-4 text-[11px] text-faint">No coaching notes yet. Add one if you want to keep a practice focus close.</div>}
      {notes?.map((note) => <article key={note.id} className="rounded-lg border border-edge bg-raised/40 p-3 min-w-0">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] uppercase tracking-wider font-extrabold text-mute">{categoryLabel(note.category)}</span><span className={`text-[9px] font-bold ${note.share_in_context ? "text-leaf" : "text-faint"}`}>{note.share_in_context ? "Included in AI context" : "Not included directly"}</span></div>
            <p className="text-[12px] text-text/90 leading-relaxed whitespace-pre-wrap break-words mt-1.5">{note.content}</p></div>
          <button type="button" role="switch" aria-label={`Use ${categoryLabel(note.category)} note in AI context`} aria-checked={note.share_in_context}
            disabled={blocked || Boolean(editor)} onClick={() => toggle(note)} className={`relative w-9 h-5 rounded-full shrink-0 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-leaf focus-visible:outline-offset-2 ${note.share_in_context ? "bg-leaf" : "bg-edge-2"}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white ${note.share_in_context ? "left-[18px]" : "left-0.5"}`} /></button>
        </div>
        <div className="flex gap-3 mt-3"><button type="button" className="text-[10px] text-mute hover:text-leaf inline-flex items-center gap-1" disabled={blocked || Boolean(editor)}
          aria-label={`Edit ${categoryLabel(note.category)} coaching note`} onClick={() => setEditor({ id: note.id, category: note.category, content: note.content, share: note.share_in_context })}><PenLine size={11} /> Edit</button>
          <button type="button" className="text-[10px] text-faint hover:text-crim inline-flex items-center gap-1" disabled={blocked || Boolean(editor)}
            aria-label={`Delete ${categoryLabel(note.category)} coaching note`} onClick={() => remove(note)}><Trash2 size={11} /> Delete</button></div>
      </article>)}
      {editor && <form onSubmit={(e) => void save(e)} className="rounded-lg border border-leaf/25 bg-leaf/[0.035] p-3 space-y-3">
        <div className="text-[12px] font-extrabold">{editor.id ? "Edit coaching note" : "New coaching note"}</div>
        <fieldset disabled={blocked} className="space-y-3">
          <div><div className="text-[10px] font-bold text-mute mb-2">Note type</div><div className="flex flex-wrap gap-1.5">{categories.map((item) => <button type="button" key={item.id} aria-pressed={editor.category === item.id}
            className={`rounded-md border px-2 py-1.5 text-[10px] font-bold ${editor.category === item.id ? "border-leaf/40 bg-leaf/10 text-leaf" : "border-edge text-faint hover:text-mute"}`}
            onClick={() => setEditor({ ...editor, category: item.id })}>{item.label}</button>)}</div></div>
          <label className="block"><span className="text-[10px] font-bold text-mute">Your note</span><textarea aria-label="Your coaching note" className="input mt-1.5 min-h-20 !text-[12px]" maxLength={500} value={editor.content}
            onChange={(e) => setEditor({ ...editor, content: e.target.value })} placeholder="e.g. I want to practice checking the minimap before rotating." /></label>
          <label className="flex gap-2 items-start text-[11px] text-mute leading-relaxed"><input type="checkbox" className="mt-0.5 accent-emerald-400" checked={editor.share} onChange={(e) => setEditor({ ...editor, share: e.target.checked })} />
            <span>Include this note in future AI requests. It may be sent to the external AI provider when the provider is used.</span></label>
          <div className="flex flex-wrap gap-2"><button type="submit" className="btn-primary !text-[11px]" disabled={!editor.content.trim()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save note</button>
            <button type="button" className="btn-ghost !text-[11px]" onClick={() => setEditor(null)}><X size={13} /> Cancel</button></div>
        </fieldset>
      </form>}
      {notice && <p role="status" className="text-[11px] text-leaf">{notice}</p>}
      <ErrorNote error={error} />
    </div>
  </section>;
}
