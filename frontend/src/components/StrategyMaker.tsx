/**
 * Utility → Strategy (staff). Describe what the note should cover (and/or attach your own
 * plan as a document); a playbook note is written from our scrim and tournament records.
 * Edit it, then "Save to playbook" publishes it on the Strategy page.
 */
import { useRef, useState } from "react";
import { BookOpenText, CheckCircle2, ExternalLink, FileText, Loader2, Paperclip, Wand2, X } from "lucide-react";
import { api } from "../lib/api";
import { nice } from "../lib/caseText";
import type { Meta } from "../lib/types";
import { navigate } from "../lib/util";
import { ErrorNote, Field } from "./ui";

type Draft = { title: string; category: string; body: string; tags: string[]; opponent: string; patch: string };
const DOC_ACCEPT = ".pdf,.docx,.txt,.md,.csv,.tsv,.xlsx";
const IDEAS = ["Our turtle and lord setup", "Draft plan against their jungle", "How we close games after 15 minutes", "Early rotations for roam"];

export function StrategyMaker({ meta }: { meta: Meta }) {
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState("");
  const [opponent, setOpponent] = useState("");
  const [doc, setDoc] = useState<{ url: string; name: string } | null>(null);
  const [busy, setBusy] = useState<"" | "upload" | "write" | "save">("");
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tags, setTags] = useState("");
  const [saved, setSaved] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  async function attach(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy("upload"); setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const up = await api.upload<{ url: string }>("/files", form);
      setDoc({ url: up.url, name: file.name });
    } catch (e) { setError(e); } finally { setBusy(""); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function write() {
    if (!topic.trim() && !opponent.trim() && !doc) { setError(new Error("Say what it should cover, name an opponent, or attach a document.")); return; }
    setBusy("write"); setError(null); setSaved(null);
    try {
      const out = await api.post<Draft>("/ai-tools/strategy", { topic: topic.trim(), category, opponent: opponent.trim(), document_url: doc?.url ?? "" });
      setDraft(out); setTags(out.tags.join(", "));
    } catch (e) { setError(e); } finally { setBusy(""); }
  }

  async function save() {
    if (!draft) return;
    setBusy("save"); setError(null);
    try {
      const note = await api.post<{ id: number }>("/strategy", { ...draft, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });
      setSaved(note.id);
    } catch (e) { setError(e); } finally { setBusy(""); }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="card chart-card p-4 space-y-3 min-w-0" aria-label="Generate a strategy">
        <div className="flex items-center gap-2"><Wand2 size={16} className="text-crim" aria-hidden="true" /><h3 className="text-[13px] font-extrabold">Generate a strategy</h3></div>
        <p className="text-[11.5px] text-mute">Built from our scrim and tournament records, each player's form and hero pool, and the opponent's history. Attach your own notes to build on them.</p>
        <Field label="What should it cover?">
          <textarea className="input min-h-24" maxLength={600} value={topic} onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. How we play around our Karrie lineup, our turtle setup, a draft plan vs their Ling…" />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {IDEAS.map((idea) => <button key={idea} type="button" className="chip border-edge text-mute hover:text-text hover:border-crim/50" onClick={() => setTopic(idea)}>{idea}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Pick for me</option>
              {meta.strategy_categories.map((c) => <option key={c} value={c}>{nice(c)}</option>)}
            </select>
          </Field>
          <Field label="Opponent (optional)"><input className="input" maxLength={120} value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="Team name" /></Field>
        </div>
        <div>
          <span className="label block mb-1.5">Your own plan (optional)</span>
          <input ref={fileRef} id="strategy-doc" type="file" accept={DOC_ACCEPT} className="sr-only" onChange={(e) => void attach(e.target.files)} />
          {doc ? (
            <span className="chip border-crim/50 text-text"><FileText size={12} aria-hidden="true" /> {doc.name}
              <button type="button" className="ml-1 text-faint hover:text-danger" aria-label="Remove the document" onClick={() => setDoc(null)}><X size={12} /></button>
            </span>
          ) : (
            <label htmlFor="strategy-doc" className="btn-ghost !py-1.5 cursor-pointer inline-flex">
              {busy === "upload" ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Attach PDF, Word, text or sheet
            </label>
          )}
        </div>
        <ErrorNote error={error} />
        <button type="button" className="btn-primary" disabled={Boolean(busy)} onClick={() => void write()}>
          {busy === "write" ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} {busy === "write" ? "Writing…" : draft ? "Generate again" : "Generate"}
        </button>
        {busy === "write" && <p className="text-[11px] text-mute" role="status">Going through our records and writing the note…</p>}
      </section>

      <section className="min-w-0" aria-label="Strategy preview">
        {!draft ? (
          <div className="card border-dashed p-8 text-center h-full grid place-items-center">
            <div>
              <BookOpenText size={28} className="mx-auto mb-2 text-crim" aria-hidden="true" />
              <p className="text-[12.5px] font-bold text-mute">The note shows up here</p>
              <p className="text-[11px] text-faint mt-1">Edit anything, then save it to the playbook. Nothing is published until you save.</p>
            </div>
          </div>
        ) : (
          <div className="card p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <Field label="Title"><input className="input" value={draft.title} onChange={(e) => set("title", e.target.value)} /></Field>
              <Field label="Category">
                <select className="input" value={draft.category} onChange={(e) => set("category", e.target.value)}>
                  {meta.strategy_categories.map((c) => <option key={c} value={c}>{nice(c)}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Playbook"><textarea className="input min-h-72 font-mono text-[12.5px]" value={draft.body} onChange={(e) => set("body", e.target.value)} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Opponent"><input className="input" value={draft.opponent} onChange={(e) => set("opponent", e.target.value)} /></Field>
              <Field label="Patch"><input className="input" value={draft.patch} onChange={(e) => set("patch", e.target.value)} /></Field>
              <Field label="Tags" hint="comma separated"><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
            </div>
            {saved ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-leaf/50 bg-leaf/5 p-2.5" role="status">
                <CheckCircle2 size={15} className="text-leaf" aria-hidden="true" /><span className="text-[12px] font-bold">Saved to the playbook.</span>
                <button type="button" className="btn-ghost !py-1 !text-[11px] ml-auto" onClick={() => navigate("strategy")}><ExternalLink size={12} /> Open Strategy</button>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>Discard</button>
                <button type="button" className="btn-primary" disabled={Boolean(busy) || !draft.title.trim() || !draft.body.trim()} onClick={() => void save()}>
                  {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <BookOpenText size={14} />} Save to playbook
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
