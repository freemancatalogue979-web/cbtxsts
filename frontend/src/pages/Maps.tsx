import { Hand, Map as MapIcon, Plus, Swords, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import type { DraftPlan, MapBoard, MapGuide, User } from "../lib/types";
import { navigate } from "../lib/util";
import { Empty, Field, PageTitle, SectionTitle, Spinner } from "../components/ui";
import { BattlefieldMap } from "../components/BattlefieldMap";
import { MapBoardEditor } from "../components/MapBoardEditor";

export function MapsPage({ me, parts }: { me: User; parts: string[] }) {
  void me;
  const [boards, setBoards] = useState<MapBoard[] | null>(null);
  const [kindFilter, setKindFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [drafts, setDrafts] = useState<DraftPlan[]>([]);
  const [tab, setTab] = useState<"boards" | "guide">("boards");
  const id = parts[0] ? Number(parts[0]) : null;

  const load = useCallback(() => {
    api.get<MapBoard[]>(`/maps${qs({ kind: kindFilter || undefined })}`).then(setBoards).catch(() => setBoards([]));
    api.get<DraftPlan[]>("/drafts").then(setDrafts).catch(() => setDrafts([]));
  }, [kindFilter]);
  useEffect(() => { if (!id) load(); }, [load, id]);

  if (id) return <MapBoardEditor id={id} />;
  if (tab === "guide") return <MapGuideView onBack={() => setTab("boards")} />;

  async function create(kind: string, name: string, opponent: string, draftId: number | null) {
    const b = await api.post<MapBoard>("/maps", { kind, name: name || `${kind.toUpperCase()} board`, opponent, draft_id: draftId });
    navigate("maps", b.id);
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Map Lab" sub="Tactical boards on the Land of Dawn — drag heroes, draw rotations, save the plan."
        right={<div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setTab("guide")}><MapIcon size={15} /> Field guide</button>
          <button className="btn-primary" onClick={() => setShowNew(true)}><Plus size={15} /> New board</button>
        </div>} />

      <div className="flex gap-1.5">
        {[{ id: "", label: "All" }, { id: "strategy", label: "Strategy" }, { id: "draft", label: "Drafts" }, { id: "scrim-review", label: "Scrim review" }].map((t) => (
          <button key={t.id}
            className={`chip !cursor-pointer uppercase !text-[10px] ${kindFilter === t.id ? "border-crim/50 text-crim bg-crim/10" : "text-faint border-edge"}`}
            onClick={() => setKindFilter(t.id)}>{t.label}</button>
        ))}
      </div>

      {!boards && <Spinner />}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
        {(boards ?? []).map((b) => (
          <button key={b.id} onClick={() => navigate("maps", b.id)} className="card card-hover p-4 text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-extrabold leading-tight">{b.name}</div>
              <span className={`chip !text-[9px] uppercase ${b.kind === "draft" ? "text-sky border-sky/40" : b.kind === "scrim-review" ? "text-amber border-amber/40" : "text-leaf border-leaf/40"}`}>{b.kind}</span>
            </div>
            {b.opponent && <div className="text-[11px] text-faint mt-1 flex items-center gap-1"><Swords size={10} /> vs {b.opponent}</div>}
            <div className="flex items-center justify-between mt-3 text-[10.5px] text-mute">
              <span className="flex items-center gap-1"><Hand size={10} /> {b.token_count ?? 0} heroes</span>
              <span>{b.updated_at ? new Date(b.updated_at).toLocaleDateString() : ""}</span>
            </div>
          </button>
        ))}
      </div>
      {boards && boards.length === 0 && <Empty title="No boards yet" hint="Create a board and start planning rotations." />}

      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <form className="card p-6 w-full max-w-sm space-y-4 bg-panel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const draftId = fd.get("draft") ? Number(fd.get("draft")) : null;
            create(String(fd.get("kind")), String(fd.get("name") || ""), String(fd.get("opponent") || ""), draftId);
          }}>
            <div className="label">New map board</div>
            <Field label="Name"><input name="name" className="input" autoFocus placeholder="Turtle traps vs Team X" /></Field>
            <Field label="Kind">
              <select name="kind" className="input">
                <option value="strategy">Strategy planning</option>
                <option value="draft">Draft planner</option>
                <option value="scrim-review">Scrim review</option>
              </select>
            </Field>
            <Field label="Opponent"><input name="opponent" className="input" placeholder="Team X" /></Field>
            <Field label="Link a draft board (optional)">
              <select name="draft" className="input">
                <option value="">None</option>
                {drafts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
              <button className="btn-primary">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const SIDE_TONE: Record<string, { dot: string; chip: string; label: string }> = {
  ours:   { dot: "bg-leaf ring-leaf/60",  chip: "text-leaf border-leaf/40 bg-leaf/10",  label: "Our side" },
  enemy:  { dot: "bg-crim ring-crim/60",  chip: "text-crim border-crim/40 bg-crim/10",  label: "Enemy side" },
  shared: { dot: "bg-amber ring-amber/60", chip: "text-amber border-amber/40 bg-amber/10", label: "Shared" },
  river:  { dot: "bg-sky ring-sky/60",    chip: "text-sky border-sky/40 bg-sky/10",    label: "River" },
};
const CAT_LABEL: Record<string, string> = { objective: "Objective", buff: "Buff", camp: "Camp", terrain: "Terrain", lane: "Lane" };

function MapGuideView({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<MapGuide | null>(null);
  const [sel, setSel] = useState<string>("turtle");
  useEffect(() => { api.get<MapGuide>("/map-guide").then(setData).catch(() => setData(null)); }, []);

  const pins = data?.pins ?? [];
  const idx = Math.max(0, pins.findIndex((p) => p.id === sel));
  const pin = pins[idx];

  function step(dir: number) {
    const n = (idx + dir + pins.length) % pins.length;
    setSel(pins[n].id);
  }

  if (!data) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageTitle title="Field Guide · Land of Dawn"
        sub="The map point by point: tap a marker (or use ← →) to see its role, timing and reward."
        right={<button className="btn-ghost" onClick={onBack}><X size={15} /> Back to boards</button>} />

      <div className="grid lg:grid-cols-[minmax(0,2.2fr)_minmax(270px,1fr)] gap-5 items-start">
        <div className="card overflow-hidden" tabIndex={0}
          onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); step(1); } if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); } }}>
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-edge bg-raised/60">
            {Object.entries(SIDE_TONE).map(([k, t]) => (
              <span key={k} className={`chip !text-[9.5px] uppercase ${t.chip}`}>{t.label}</span>
            ))}
            <span className="ml-auto text-[10px] text-faint uppercase tracking-widest font-semibold">← → to move between points</span>
          </div>
          <div className="p-2 sm:p-3">
            <div className="relative w-full aspect-square rounded-lg overflow-hidden border border-edge">
              <BattlefieldMap />
              {pins.map((p) => {
                const t = SIDE_TONE[p.side] ?? SIDE_TONE.shared;
                const active = p.id === sel;
                return (
                  <button key={p.id} onClick={() => setSel(p.id)}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center font-extrabold transition-transform ${active ? "z-10" : ""}`}
                    style={{ left: `${p.x}%`, top: `${p.y}%`, width: active ? 22 : 16, height: active ? 22 : 16, fontSize: 8 }}
                    title={p.name}>
                    <span className={`absolute inset-0 rounded-full ${t.dot} ring-2 ${active ? "animate-pulse" : ""} shadow-[0_2px_10px_rgba(0,0,0,0.6)]`} />
                    <span className="relative text-ink" style={{ fontSize: 7 }}>{p.name.slice(0, 1)}</span>
                  </button>
                );
              })}
            </div>
            <div className="text-[10.5px] text-faint mt-2 px-1 leading-relaxed">{data.note}</div>
          </div>
        </div>

        {/* info card */}
        {pin && (
          <div className="card p-4 lg:sticky lg:top-6 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[15px] font-extrabold leading-tight">{pin.name}</div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <span className={`chip !text-[9px] uppercase ${(SIDE_TONE[pin.side] ?? SIDE_TONE.shared).chip}`}>{(SIDE_TONE[pin.side] ?? SIDE_TONE.shared).label}</span>
                  <span className="chip !text-[9px] uppercase text-mute border-edge-2">{CAT_LABEL[pin.category] ?? pin.category}</span>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button className="btn-ghost !p-1.5" onClick={() => step(-1)} aria-label="Previous point">‹</button>
                <button className="btn-ghost !p-1.5" onClick={() => step(1)} aria-label="Next point">›</button>
              </div>
            </div>
            <p className="text-[12.5px] text-mute leading-relaxed">{pin.blurb}</p>
            <div className="divide-y divide-edge/60 border-y border-edge/60">
              {pin.facts.map(([k, v]) => (
                <div key={k} className="py-2">
                  <div className="label !text-[9.5px] !mb-0.5">{k}</div>
                  <div className="text-[12.5px] text-text font-semibold leading-snug">{v}</div>
                </div>
              ))}
            </div>
            {pin.tips.length > 0 && (
              <div>
                <div className="label !text-[9.5px]">How we use it</div>
                <ul className="space-y-1.5 mt-1">
                  {pin.tips.map((t, i) => (
                    <li key={i} className="text-[12px] text-mute leading-relaxed flex gap-2">
                      <span className="text-leaf font-bold shrink-0">{i + 1}.</span>{t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* rotations by role */}
      <section>
        <SectionTitle>Rotations by role</SectionTitle>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.rotations.map((r) => (
            <div key={r.role} className="card p-4">
              <div className="text-sm font-extrabold mb-2.5">{r.role}</div>
              <ol className="space-y-2">
                {r.steps.map((s, i) => (
                  <li key={i} className="text-[12px] text-mute leading-relaxed flex gap-2">
                    <span className="text-crim font-extrabold shrink-0 tabular-nums">{i + 1}.</span>{s}
                  </li>
                ))}
              </ol>
              {r.links.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-edge/60 text-[10.5px] text-faint italic">{r.links.join(" · ")}</div>
              )}
            </div>
          ))}
        </div>
        <div className="text-[10px] text-faint mt-3">Sources: {data.sources.join(" · ")}</div>
      </section>
    </div>
  );
}
