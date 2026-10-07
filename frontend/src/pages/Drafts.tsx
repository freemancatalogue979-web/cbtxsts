import { Layers as LayersIcon, Map, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { DraftPlan, Hero, Meta, User } from "../lib/types";
import { navigate } from "../lib/util";
import { Badge, Empty, ErrorNote, Field, PageTitle, Spinner } from "../components/ui";
import { DraftBoard } from "../components/DraftBoard";
import { HeroImg } from "../components/HeroImg";

const STATUS_TONE: Record<string, string> = {
  idea: "text-sky border-sky/40 bg-sky/10",
  testing: "text-amber border-amber/40 bg-amber/10",
  approved: "text-leaf border-leaf/40 bg-leaf-dim/50",
  archived: "text-mute border-edge-2 bg-raised",
};

function blankDraft() {
  return {
    our_bans: ["", "", "", "", ""] as (string | null)[],
    enemy_bans: ["", "", "", "", ""] as (string | null)[],
    our_picks: {} as Record<string, string>,
    enemy_picks: {} as Record<string, string>,
  };
}


const STATUS_RANK: Record<string, number> = { META: 0, STRONG: 1, VIABLE: 2, SITUATIONAL: 3, WEAK: 4 };

function HeroPicker({ heroes, value, onChange }: { heroes: Hero[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const cur = heroes.find((h) => h.name === value);
  const sorted = [...heroes].sort((a, b) =>
    (STATUS_RANK[a.meta_status] ?? 9) - (STATUS_RANK[b.meta_status] ?? 9) ||
    b.clover_rating - a.clover_rating || b.win_rate - a.win_rate);
  const list = (q ? sorted.filter((h) => h.name.toLowerCase().includes(q.toLowerCase())) : sorted).slice(0, 80);
  return (
    <div className="relative flex items-center gap-2 min-w-0">
      {open && <div className="fixed inset-0 z-20" onClick={() => { setOpen(false); setQ(""); }} />}
      <HeroImg name={value || "?"} size={28} className="rounded-md shrink-0" />
      <button type="button" className="input !px-2 !py-1.5 min-w-0 text-left truncate flex items-center justify-between gap-1.5"
        onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{value || "—"}</span>
        {cur && <span className="text-[10px] text-mute tabular-nums shrink-0">{cur.win_rate}%</span>}
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-30 w-64 card !border-edge-2 bg-panel shadow-[0_12px_40px_rgba(0,0,0,0.7)] p-2">
          <input autoFocus className="input !py-1.5 !text-[12px] mb-1.5" placeholder="Search heroes…"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-64 overflow-y-auto -mx-1 px-1">
            <button type="button" onClick={() => { onChange(""); setOpen(false); setQ(""); }}
              className="w-full text-left px-2 py-1.5 rounded text-[12px] text-faint hover:bg-raised">— empty slot</button>
            {list.map((h) => (
              <button type="button" key={h.id} onClick={() => { onChange(h.name); setOpen(false); setQ(""); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-raised ${h.name === value ? "bg-raised" : ""}`}>
                <HeroImg name={h.name} size={26} className="rounded" />
                <span className="text-[12px] font-bold truncate">{h.name}</span>
                <span className={`ml-auto chip !text-[8px] !px-1 !py-0 uppercase ${
                  h.meta_status === "META" ? "text-crim border-crim/40" : h.meta_status === "STRONG" ? "text-leaf border-leaf/40" : "text-faint border-edge"}`}>
                  {h.meta_status.toLowerCase()}
                </span>
                <span className="text-[10px] text-mute tabular-nums w-10 text-right">{h.win_rate}%</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DraftEditor({ meta, heroes, initial, onSaved, onBack }: {
  meta: Meta; heroes: Hero[]; initial: DraftPlan | null;
  onSaved: (id: number) => void; onBack: () => void;
}) {
  const [f, setF] = useState(() => ({
    name: initial?.name ?? "", opponent: initial?.opponent ?? "", patch: initial?.patch ?? meta.season_patch,
    notes: initial?.notes ?? "", status: initial?.status ?? "idea",
    draft: initial?.draft ? { ...blankDraft(), ...initial.draft } : blankDraft(),
  }));
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF((p: typeof f) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = { ...f, draft: f.draft };
    try {
      if (initial?.id) {
        const d = await api.patch<DraftPlan>(`/drafts/${initial.id}`, body);
        onSaved(d.id);
      } else {
        const d = await api.post<DraftPlan>("/drafts", body);
        onSaved(d.id);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  return (
    <form onSubmit={save} className="space-y-5 max-w-3xl">
      <button type="button" className="label !text-crim" onClick={onBack}>← Draft boards</button>
      <PageTitle title={initial ? `Editing: ${initial.name}` : "New draft board"} sub="Build the pick/ban plan, test it in scrims, approve it for matches." />
      <div className="grid sm:grid-cols-4 gap-4">
        <Field label="Board name"><input className="input col-span-2" required value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Opponent (optional)"><input className="input" value={f.opponent} onChange={(e) => set("opponent", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Patch"><input className="input" value={f.patch} onChange={(e) => set("patch", e.target.value)} /></Field>
          <Field label="Status">
            <select className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
              {meta.draft_statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {(["our_bans", "enemy_bans"] as const).map((side) => (
            <div key={side}>
              <div className={`label mb-2 ${side === "our_bans" ? "text-leaf/80" : "text-crim/80"}`}>{side === "our_bans" ? "Our bans" : "Enemy bans"}</div>
              <div className="space-y-1.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-faint text-[10px] font-bold w-3">{i + 1}.</span>
                    <HeroPicker heroes={heroes} value={(f.draft[side][i] as string) ?? ""}
                      onChange={(v) => set("draft", { ...f.draft, [side]: f.draft[side].map((x: string | null, j: number) => (j === i ? v : x)) })} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-1.5">
            <span className="label text-right text-leaf/80">9 CLOVER picks</span>
            <span className="label w-14 text-center">Lane</span>
            <span className="label text-crim/80">Enemy picks</span>
          </div>
          <div className="space-y-1.5">
            {meta.lanes.map((lane) => (
              <div key={lane} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <HeroPicker heroes={heroes} value={f.draft.our_picks[lane] ?? ""}
                  onChange={(v) => set("draft", { ...f.draft, our_picks: { ...f.draft.our_picks, [lane]: v } })} />
                <span className="label w-14 text-center">{lane}</span>
                <HeroPicker heroes={heroes} value={f.draft.enemy_picks[lane] ?? ""}
                  onChange={(v) => set("draft", { ...f.draft, enemy_picks: { ...f.draft.enemy_picks, [lane]: v } })} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <Field label="Notes / win condition">
        <textarea className="input min-h-20" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <ErrorNote error={err} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onBack}>Cancel</button>
        <button className="btn-primary">{initial ? "Save board" : "Create board"}</button>
      </div>
    </form>
  );
}

export function DraftsPage({ me, meta, parts }: { me: User; meta: Meta; parts: string[] }) {
  const canManage = ["admin", "captain", "coach"].includes(me.role);
  const [drafts, setDrafts] = useState<DraftPlan[] | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [editing, setEditing] = useState<DraftPlan | null | "new">(null);

  const sub = parts[0];
  const load = useCallback(() => {
    api.get<DraftPlan[]>("/drafts").then(setDrafts).catch(() => setDrafts([]));
    api.get<Hero[]>("/heroes").then(setHeroes).catch(() => setHeroes([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { if (sub === "new" && canManage) setEditing("new"); }, [sub, canManage]);

  if (editing) {
    return (
      <DraftEditor meta={meta} heroes={heroes} initial={editing === "new" ? null : editing}
        onBack={() => { setEditing(null); if (sub === "new") navigate("drafts"); }}
        onSaved={() => { setEditing(null); if (sub === "new") navigate("drafts"); load(); }} />
    );
  }

  return (
    <div className="space-y-5">
      <PageTitle title="Draft Lab" sub="Saved pick/ban boards — ideas become tested comps become approved doctrine."
        right={canManage && <button className="btn-primary" onClick={() => setEditing("new")}><Plus size={15} /> New board</button>} />
      {!drafts && <Spinner />}
      <div className="grid lg:grid-cols-2 gap-4">
        {(drafts ?? []).map((d) => (
          <div key={d.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 px-1">
              <LayersIcon size={14} className="text-crim" />
              <span className="text-sm font-extrabold">{d.name}</span>
              <Badge cls={STATUS_TONE[d.status] ?? "text-mute"}>{d.status}</Badge>
              {d.opponent && <Badge cls="text-crim border-crim/30">vs {d.opponent}</Badge>}
              <span className="text-[11px] text-faint ml-auto">{d.patch}</span>
              <button className="text-[11px] text-faint hover:text-leaf flex items-center gap-1"
                title="Open as a tactical map board"
                onClick={async () => {
                  await api.post("/maps", { kind: "draft", name: `Map · ${d.name}`, opponent: d.opponent, draft_id: d.id });
                  navigate("maps");
                }}>
                <Map size={11} /> Map
              </button>
              {canManage && <button className="text-[11px] text-faint hover:text-text" onClick={() => setEditing(d)}>Edit</button>}
            </div>
            <DraftBoard draft={d.draft} theirsLabel={(d.opponent || "Enemy").toUpperCase()} />
            {d.notes && <div className="text-[12px] text-mute px-1 leading-relaxed">{d.notes}</div>}
          </div>
        ))}
        {drafts && drafts.length === 0 && <Empty title="No draft boards yet" hint={canManage ? "Build the first board" : "Staff will publish boards here"} />}
      </div>
    </div>
  );
}
