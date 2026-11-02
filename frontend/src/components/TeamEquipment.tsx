import { ExternalLink, Loader2, PackagePlus, PenLine, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { safeExternal, shortDate } from "../lib/cloverAI";
import { ErrorNote, Field, Modal } from "./ui";

type Item = { id: number; name: string; category: string; description: string; patch: string; source_url: string; updated_at: string; provenance: string };
type Fields = Pick<Item, "name" | "category" | "description" | "patch" | "source_url">;
const blank: Fields = { name: "", category: "", description: "", patch: "", source_url: "" };

function EquipmentForm({ initial, onClose, onSaved }: { initial: Item | null; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<Fields>(initial ? { name: initial.name, category: initial.category, description: initial.description, patch: initial.patch, source_url: initial.source_url } : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (key: keyof Fields, value: string) => setValues((previous) => ({ ...previous, [key]: value }));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (initial) await api.patch(`/items/${initial.id}`, values);
      else await api.post("/items", values);
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <Modal title={initial ? "Edit team equipment" : "Add team equipment"} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={(event) => void save(event)} className="space-y-4">
      <p className="text-[11px] text-mute leading-relaxed">This is a team-maintained entry, separate from the community equipment feed. Add only details you can review.</p>
      <Field label="Name"><input className="input" required maxLength={120} value={values.name} onChange={(e) => set("name", e.target.value)} /></Field>
      <div className="grid sm:grid-cols-2 gap-3"><Field label="Category (optional)"><input className="input" maxLength={40} value={values.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Defense" /></Field>
        <Field label="Patch label (optional)"><input className="input" maxLength={20} value={values.patch} onChange={(e) => set("patch", e.target.value)} /></Field></div>
      <Field label="Description"><textarea className="input min-h-28" required maxLength={3000} value={values.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <Field label="Source URL (optional)"><input type="url" className="input" maxLength={2048} value={values.source_url} onChange={(e) => set("source_url", e.target.value)} placeholder="https://…" /></Field>
      <ErrorNote error={error} /><div className="flex justify-end gap-2"><button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !values.name.trim() || !values.description.trim()}>{busy && <Loader2 size={14} className="animate-spin" />} {initial ? "Save changes" : "Add equipment"}</button></div>
    </form>
  </Modal>;
}

export function TeamEquipment({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try { const result = await api.get<Item[]>("/items"); setItems(result); setError(null); }
    catch (e) { setError(e); setItems(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function remove(item: Item) {
    if (!window.confirm(`Delete team equipment “${item.name}”?`)) return;
    setBusy(true); setError(null);
    try { await api.del(`/items/${item.id}`); setSelected(null); await load(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  const filtered = (items ?? []).filter((item) => `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="space-y-3" aria-label="Team equipment">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="section-pill section-pill--leaf">TEAM EQUIPMENT</div><p className="text-[11px] text-mute mt-2">Team-maintained entries are separate from the community feed and aren’t automatically verified.</p></div>
      {canEdit && <button type="button" className="btn-ghost !text-[11px]" onClick={() => setEditing("new")}><PackagePlus size={14} /> Add equipment</button>}</div>
    <ErrorNote error={error} />
    {items === null ? (error ? <button type="button" className="text-[11px] text-leaf underline" onClick={() => void load()}>Retry loading team equipment</button> : <p className="text-[11px] text-mute flex gap-2"><Loader2 className="animate-spin" size={13} /> Loading team equipment…</p>) : <>
      {items.length > 0 && <label className="relative block max-w-sm"><span className="sr-only">Search team equipment</span><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className="input !pl-8" placeholder="Search team equipment…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>}
      {filtered.length === 0 ? <div className="rounded-lg border border-dashed border-edge-2 p-4 text-[11px] text-mute">{items.length ? "No team equipment matches that search." : "No team equipment added yet."}</div> : <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{filtered.map((item) => <button type="button" key={item.id} onClick={() => setSelected(item)} className="card card-hover p-3 text-left min-w-0"><span className="text-[12px] font-extrabold block truncate">{item.name}</span><span className="text-[10px] text-leaf block mt-1">{item.category || "Team entry"}{item.patch && ` · ${item.patch}`}</span><span className="text-[11px] text-mute line-clamp-2 mt-1.5">{item.description}</span></button>)}</div>}
    </>}
    {selected && <Modal title={selected.name} onClose={() => setSelected(null)}><div className="space-y-3"><div className="flex flex-wrap gap-2 text-[10px] font-bold text-leaf"><span>{selected.category || "Team entry"}</span>{selected.patch && <span>· Patch {selected.patch}</span>}</div>
      <p className="text-[12px] text-text/90 leading-relaxed whitespace-pre-wrap break-words">{selected.description}</p><p className="text-[10px] text-mute">Team-maintained, not verified · updated {shortDate(selected.updated_at)}</p>
      {safeExternal(selected.source_url) && <a href={safeExternal(selected.source_url)} target="_blank" rel="noreferrer noopener" className="text-[11px] text-leaf inline-flex items-center gap-1 hover:underline">View source <ExternalLink size={12} /></a>}
      {canEdit && <div className="flex flex-wrap gap-2 pt-2"><button type="button" className="btn-ghost !text-[11px]" disabled={busy} onClick={() => { setSelected(null); setEditing(selected); }}><PenLine size={13} /> Edit</button><button type="button" className="btn-ghost !text-[11px] text-crim" disabled={busy} onClick={() => void remove(selected)}><Trash2 size={13} /> Delete</button></div>}
      <ErrorNote error={error} />
    </div></Modal>}
    {editing && <EquipmentForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
  </section>;
}
