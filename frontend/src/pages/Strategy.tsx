import { Pin, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import type { Meta, StrategyNote, User } from "../lib/types";
import { dayLabel } from "../lib/util";
import { Badge, Empty, ErrorNote, Field, Modal, PageTitle, Spinner, Tabs } from "../components/ui";

function NoteForm({ meta, initial, onSaved, onClose }: {
  meta: Meta; initial: Partial<StrategyNote>; onSaved: () => void; onClose: () => void;
}) {
  const edit = Boolean(initial.id);
  const [f, setF] = useState<Record<string, unknown>>({
    title: initial.title ?? "", category: initial.category ?? "GENERAL", body: initial.body ?? "",
    opponent: initial.opponent ?? "", patch: initial.patch ?? "",
    tags: (initial.tags ?? []).join(", "), pinned: initial.pinned ?? false,
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = { ...f, tags: String(f.tags).split(",").map((t) => t.trim()).filter(Boolean) };
    try {
      if (edit) await api.patch(`/strategy/${initial.id}`, body);
      else await api.post("/strategy", body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  return (
    <Modal title={edit ? "Edit note" : "New strategy note"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid sm:grid-cols-[2fr_1fr] gap-4">
          <Field label="Title"><input className="input" required value={String(f.title)} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Category">
            <select className="input" value={String(f.category)} onChange={(e) => set("category", e.target.value)}>
              {meta.strategy_categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Playbook body">
          <textarea className="input min-h-44 font-mono text-[13px]" required value={String(f.body)} onChange={(e) => set("body", e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Opponent (optional)"><input className="input" value={String(f.opponent)} onChange={(e) => set("opponent", e.target.value)} /></Field>
          <Field label="Patch (optional)"><input className="input" value={String(f.patch)} onChange={(e) => set("patch", e.target.value)} /></Field>
          <Field label="Tags" hint="comma separated"><input className="input" value={String(f.tags)} onChange={(e) => set("tags", e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="accent-crim" checked={Boolean(f.pinned)} onChange={(e) => set("pinned", e.target.checked)} />
          Pin to the top
        </label>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary">{edit ? "Save" : "Publish"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function StrategyPage({ me, meta }: { me: User; meta: Meta }) {
  const canManage = ["admin", "captain", "coach"].includes(me.role);
  const [notes, setNotes] = useState<StrategyNote[] | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [form, setForm] = useState<null | Partial<StrategyNote>>(null);

  const load = useCallback(() => {
    api.get<StrategyNote[]>(`/strategy${qs({ q: q || undefined, category: cat || undefined })}`).then(setNotes).catch(() => setNotes([]));
  }, [q, cat]);
  useEffect(load, [load]);

  return (
    <div className="space-y-5">
      <PageTitle title="Strategy & Knowledge Base" sub="Playbook, opponent files and tactical doctrine. Squad-wide read access."
        right={canManage && <button className="btn-primary" onClick={() => setForm({})}><Plus size={15} /> New note</button>} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !w-52 !pl-8" placeholder="Search the playbook…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Tabs value={cat} onChange={setCat} tabs={[{ id: "", label: "All" }, ...meta.strategy_categories.map((c) => ({ id: c, label: c.toLowerCase() }))]} />

      {!notes && <Spinner />}
      <div className="space-y-2.5">
        {(notes ?? []).map((n) => {
          const open = openId === n.id;
          return (
            <div key={n.id} className={`card ${n.pinned ? "border-crim/40" : ""}`}>
              <button className="w-full text-left p-4" onClick={() => setOpenId(open ? null : n.id)}>
                <div className="flex flex-wrap items-center gap-2">
                  {n.pinned === true && <Pin size={12} className="text-crim" />}
                  <span className="text-sm font-bold">{n.title}</span>
                  <Badge cls="text-sky border-sky/30 bg-sky/5">{n.category}</Badge>
                  {n.opponent && <Badge cls="text-crim border-crim/30">vs {n.opponent}</Badge>}
                  {n.patch && <Badge>{n.patch}</Badge>}
                  <span className="text-[11px] text-faint ml-auto">updated {dayLabel(n.updated_at?.slice(0, 10))}</span>
                </div>
                {!open && <div className="text-[12.5px] text-faint mt-1.5 line-clamp-1">{n.body.split("\n")[0]}</div>}
              </button>
              {open && (
                <div className="px-4 pb-4">
                  <p className="text-[13.5px] text-text/85 leading-relaxed whitespace-pre-wrap">{n.body}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {n.tags.map((t) => <span key={t} className="chip !text-[10px] text-mute">#{t}</span>)}
                    {canManage && (
                      <span className="ml-auto flex gap-1.5">
                        <button className="btn-ghost !py-1 !px-2.5 !text-[11px]" onClick={() => setForm(n)}>Edit</button>
                        <button className="btn-ghost !py-1 !px-2 !text-[11px] !text-crim" title="Delete note"
                          onClick={async () => { if (confirm(`Delete "${n.title}"?`)) { await api.del(`/strategy/${n.id}`); load(); } }}>
                          <Trash2 size={11} /></button>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {notes && notes.length === 0 && <Empty title="The playbook is empty here" hint={canManage ? "Publish the first note" : undefined} />}
      </div>

      {form && <NoteForm meta={meta} initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}
