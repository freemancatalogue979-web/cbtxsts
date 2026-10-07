import { Eraser, Hand, Layers, MousePointer2, PenLine, Plus, RotateCcw, Save, Swords, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, qs } from "../lib/api";
import type { DraftPlan, Hero, MapBoard, User } from "../lib/types";
import { navigate } from "../lib/util";
import { Empty, Field, PageTitle, Spinner } from "../components/ui";
import { BattlefieldMap } from "../components/BattlefieldMap";
import { HeroImg } from "../components/HeroImg";

type Side = "ours" | "theirs" | "neutral";
type Token = { id: string; hero: string; side: Side; x: number; y: number };
type DrawPath = { color: string; points: number[][] };

const SIDE_RING: Record<Side, string> = {
  ours: "ring-leaf/90 bg-leaf/10",
  theirs: "ring-crim/90 bg-crim/10",
  neutral: "ring-amber/80 bg-amber/10",
};
const PEN_COLORS = [
  { id: "#34d399", label: "Ours" },
  { id: "#e11d48", label: "Enemy" },
  { id: "#f5b942", label: "Plan" },
  { id: "#7db5f5", label: "Info" },
];
const LANE_SPOTS: Record<Side, Record<string, [number, number]>> = {
  ours: { EXP: [13, 38], JUNGLE: [30, 55], MID: [42, 58], GOLD: [60, 84], ROAM: [50, 45] },
  theirs: { EXP: [38, 13], JUNGLE: [55, 30], MID: [58, 42], GOLD: [84, 40], ROAM: [50, 55] },
  neutral: {},
};
const uid = () => Math.random().toString(36).slice(2, 9);

function BoardEditor({ id }: { id: number }) {
  const [board, setBoard] = useState<MapBoard | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [paths, setPaths] = useState<DrawPath[]>([]);
  const [history, setHistory] = useState<{ tokens: Token[]; paths: DrawPath[] }[]>([]);
  const [tool, setTool] = useState<"move" | "pen" | "erase">("move");
  const [penColor, setPenColor] = useState(PEN_COLORS[0].id);
  const [stroke, setStroke] = useState<number[][] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [heroQ, setHeroQ] = useState("");
  const [newSide, setNewSide] = useState<Side>("ours");
  const [err, setErr] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.get<MapBoard>(`/maps/${id}`).then((b) => {
      setBoard(b);
      const d = b.data || {};
      setTokens((d.tokens as Token[]) ?? []);
      setPaths((d.paths as DrawPath[]) ?? []);
      setDirty(false);
    }).catch(() => setBoard(null));
    api.get<Hero[]>("/heroes").then(setHeroes).catch(() => setHeroes([]));
  }, [id]);
  useEffect(load, [load]);

  const snapshot = () => setHistory((h) => [...h.slice(-29), { tokens, paths }]);
  const undo = () => setHistory((h) => {
    if (h.length === 0) return h;
    const last = h[h.length - 1];
    setTokens(last.tokens); setPaths(last.paths); setDirty(true);
    return h.slice(0, -1);
  });

  const pt = (e: React.PointerEvent): number[] => {
    const r = area.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };

  function onAreaDown(e: React.PointerEvent) {
    if (tool === "pen") {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      setStroke([pt(e)]);
    } else if (tool === "erase") {
      const [x, y] = pt(e);
      eraseNearestPath(x, y);
    }
  }
  function onAreaMove(e: React.PointerEvent) {
    if (dragId) {
      const [x, y] = pt(e);
      setTokens((ts) => ts.map((t) => (t.id === dragId ? { ...t, x, y } : t)));
      setDirty(true);
    } else if (stroke) {
      setStroke((s) => s ? [...s, pt(e)] : s);
    }
  }
  function onAreaUp() {
    if (dragId) { setDragId(null); return; }
    if (stroke) {
      if (stroke.length > 1) {
        snapshot();
        setPaths((p) => [...p, { color: penColor, points: stroke }]);
        setDirty(true);
      }
      setStroke(null);
    }
  }

  function startDrag(id: string, e: React.PointerEvent) {
    if (tool !== "move") return;
    e.stopPropagation();
    snapshot();
    setDragId(id);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function eraseNearestPath(x: number, y: number) {
    if (paths.length === 0) return;
    let best = -1; let bestDist = 5;
    paths.forEach((p, pi) => {
      for (const [px, py] of p.points) {
        const d = Math.hypot(px - x, py - y);
        if (d < bestDist) { bestDist = d; best = pi; }
      }
    });
    if (best >= 0) {
      snapshot();
      setPaths((p) => p.filter((_, i) => i !== best));
      setDirty(true);
    }
  }

  function addToken(hero: string) {
    snapshot();
    const spots = LANE_SPOTS[newSide];
    const heroLane = heroes.find((h) => h.name === hero)?.role;
    const [x, y] = (heroLane && spots[heroLane]) || [50 + (Math.random() * 10 - 5), 50 + (Math.random() * 10 - 5)];
    setTokens((ts) => [...ts, { id: uid(), hero, side: newSide, x, y }]);
    setDirty(true);
  }

  function removeToken(id: string) {
    snapshot();
    setTokens((ts) => ts.filter((t) => t.id !== id));
    setDirty(true);
  }

  async function loadDraftLineup() {
    if (!board?.draft_id) return;
    try {
      const d = await api.get<DraftPlan>(`/drafts/${board.draft_id}`);
      snapshot();
      const nt: Token[] = [];
      for (const [lane, hero] of Object.entries(d.draft.our_picks || {})) {
        const [x, y] = LANE_SPOTS.ours[lane] || [50, 50];
        if (hero) nt.push({ id: uid(), hero, side: "ours", x, y });
      }
      for (const [lane, hero] of Object.entries(d.draft.enemy_picks || {})) {
        const [x, y] = LANE_SPOTS.theirs[lane] || [50, 50];
        if (hero) nt.push({ id: uid(), hero, side: "theirs", x, y });
      }
      setTokens((ts) => [...ts, ...nt]);
      setDirty(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Draft load failed");
    }
  }

  async function save() {
    if (!board) return;
    setSaving(true);
    setErr(null);
    try {
      const b = await api.patch<MapBoard>(`/maps/${board.id}`, {
        name: board.name, opponent: board.opponent, notes: board.notes,
        data: { tokens, paths },
      });
      setBoard(b);
      setDirty(false);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const filteredHeroes = useMemo(() => {
    const q = heroQ.trim().toLowerCase();
    const rank: Record<string, number> = { META: 0, STRONG: 1, VIABLE: 2, SITUATIONAL: 3, WEAK: 4 };
    const list = [...heroes].sort((a, b) =>
      (rank[a.meta_status] ?? 9) - (rank[b.meta_status] ?? 9) || b.clover_rating - a.clover_rating);
    return (q ? list.filter((h) => h.name.toLowerCase().includes(q)) : list).slice(0, 60);
  }, [heroes, heroQ]);

  if (!board) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button className="label !text-crim" onClick={() => navigate("maps")}>← Map boards</button>
        <input
          className="input !w-auto min-w-40 flex-1 max-w-72 !font-extrabold"
          value={board.name}
          onChange={(e) => { setBoard({ ...board, name: e.target.value }); setDirty(true); }}
          placeholder="Board name"
        />
        <span className="chip text-faint border-edge-2 uppercase !text-[10px]">{board.kind}</span>
        <div className="flex items-center gap-2 ml-auto">
          {board.draft_id != null && (
            <button className="btn-ghost !py-1.5 !text-[12px]" onClick={loadDraftLineup}>
              <Layers size={13} /> Place draft lineup
            </button>
          )}
          <button className="btn-primary !py-1.5 !text-[12.5px]" disabled={!dirty || saving} onClick={save}>
            <Save size={13} /> {saving ? "Saving…" : dirty ? "Save board" : "Saved"}
          </button>
        </div>
      </div>

      {err && <div className="text-crim text-sm">{err}</div>}

      <div className="grid lg:grid-cols-[minmax(0,2.6fr)_minmax(240px,1fr)] gap-5 items-start">
        {/* ------- the board ------- */}
        <div className="card overflow-hidden">
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-edge bg-raised/60">
            {([
              ["move", "Drag", MousePointer2],
              ["pen", "Draw", PenLine],
              ["erase", "Erase", Eraser],
            ] as const).map(([t, label, Icon]) => (
              <button key={t}
                className={`btn-ghost !px-2.5 !py-1.5 !text-[11.5px] ${tool === t ? "border-crim/60 text-crim bg-crim-dim/40" : ""}`}
                onClick={() => setTool(t)} aria-pressed={tool === t}>
                <Icon size={13} /> {label}
              </button>
            ))}
            {tool === "pen" && (
              <span className="flex items-center gap-1.5 ml-1">
                {PEN_COLORS.map((c) => (
                  <button key={c.id} title={c.label}
                    className={`w-4.5 h-4.5 rounded-full border-2 ${penColor === c.id ? "border-text" : "border-transparent"}`}
                    style={{ backgroundColor: c.id, width: 18, height: 18 }}
                    onClick={() => setPenColor(c.id)} />
                ))}
              </span>
            )}
            <span className="mx-1.5 w-px h-5 bg-edge" />
            <button className="btn-ghost !px-2 !py-1.5 !text-[11.5px]" onClick={undo} disabled={history.length === 0}>
              <RotateCcw size={13} /> Undo
            </button>
            <button className="btn-ghost !px-2 !py-1.5 !text-[11.5px] hover:!text-crim"
              onClick={() => { snapshot(); setTokens([]); setPaths([]); setDirty(true); }}>
              <Trash2 size={13} /> Clear
            </button>
            <span className="ml-auto text-[10px] text-faint uppercase tracking-widest font-semibold">
              {tool === "move" ? "drag heroes anywhere" : tool === "pen" ? "hold & draw on the map" : "click a stroke to erase"}
            </span>
          </div>

          {/* map surface */}
          <div className="p-2 sm:p-3">
            <div
              ref={area}
              className="relative w-full aspect-square rounded-lg overflow-hidden border border-edge select-none touch-none"
              onPointerDown={onAreaDown}
              onPointerMove={onAreaMove}
              onPointerUp={onAreaUp}
              onPointerLeave={onAreaUp}
            >
              <BattlefieldMap className="absolute inset-0" />

              {/* saved strokes + live stroke */}
              <svg viewBox="0 0 100 100" preserveAspectRatio="none"
                className={`absolute inset-0 w-full h-full ${tool !== "move" ? "" : "pointer-events-none"}`}>
                {paths.map((p, i) => (
                  <polyline key={i} points={p.points.map(([x, y]) => `${x},${y}`).join(" ")}
                    fill="none" stroke={p.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke" opacity="0.9" />
                ))}
                {stroke && (
                  <polyline points={stroke.map(([x, y]) => `${x},${y}`).join(" ")}
                    fill="none" stroke={penColor} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke" opacity="0.9" />
                )}
              </svg>

              {/* hero tokens */}
              {tokens.map((t) => (
                <div
                  key={t.id}
                  onPointerDown={(e) => startDrag(t.id, e)}
                  onDoubleClick={() => removeToken(t.id)}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 ${tool === "move" ? "cursor-grab active:cursor-grabbing" : "pointer-events-auto cursor-default"}`}
                  style={{ left: `${t.x}%`, top: `${t.y}%`, touchAction: "none" }}
                  title={`${t.hero} (${t.side}) — double-click removes`}
                >
                  <span className={`rounded-full ring-2 ${SIDE_RING[t.side]} shadow-[0_4px_14px_rgba(0,0,0,0.65)] overflow-hidden leading-none`}>
                    <HeroImg name={t.hero} size={34} eager className="rounded-full block" />
                  </span>
                  <span className="text-[8.5px] font-bold bg-black/75 backdrop-blur-[2px] px-1.5 py-0.5 rounded leading-none whitespace-nowrap max-w-[72px] truncate">
                    {t.hero}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* footer meta */}
          <div className="grid sm:grid-cols-2 gap-3 px-3.5 pb-3.5">
            <Field label="Opponent (optional)">
              <input className="input" value={board.opponent}
                onChange={(e) => { setBoard({ ...board, opponent: e.target.value }); setDirty(true); }} />
            </Field>
            <Field label="Notes / win condition">
              <input className="input" value={board.notes}
                onChange={(e) => { setBoard({ ...board, notes: e.target.value }); setDirty(true); }} />
            </Field>
          </div>
        </div>

        {/* ------- hero palette ------- */}
        <div className="card p-4 lg:sticky lg:top-6">
          <div className="label mb-2.5">Place a hero</div>
          <div className="flex gap-1.5 mb-3">
            {(["ours", "theirs", "neutral"] as Side[]).map((s) => (
              <button key={s}
                className={`chip !cursor-pointer uppercase !text-[9.5px] ${newSide === s ? (s === "ours" ? "text-leaf border-leaf/50 bg-leaf/10" : s === "theirs" ? "text-crim border-crim/50 bg-crim/10" : "text-amber border-amber/50 bg-amber/10") : "text-faint border-edge"}`}
                onClick={() => setNewSide(s)}>
                {s === "ours" ? "9 CLOVER" : s === "theirs" ? "ENEMY" : "NEUTRAL"}
              </button>
            ))}
          </div>
          <input className="input mb-3 !py-2" placeholder="Search 135 heroes…" value={heroQ} onChange={(e) => setHeroQ(e.target.value)} />
          <div className="grid grid-cols-5 gap-2 max-h-[26rem] overflow-y-auto pr-1">
            {filteredHeroes.map((h) => (
              <button key={h.id} onClick={() => addToken(h.name)}
                className="flex flex-col items-center gap-1 p-1 rounded-md hover:bg-raised transition-colors"
                title={`${h.name} · ${h.meta_status} · WR ${h.win_rate}% — add as ${newSide}`}>
                <span className="relative">
                  <HeroImg name={h.name} size={36} className="rounded-md" />
                  {(h.meta_status === "META" || h.meta_status === "STRONG") && (
                    <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-ink ${h.meta_status === "META" ? "bg-crim" : "bg-leaf"}`} />
                  )}
                </span>
                <span className="text-[8.5px] font-semibold leading-tight text-center w-full truncate">{h.name}</span>
              </button>
            ))}
            {filteredHeroes.length === 0 && <div className="col-span-5 text-xs text-faint py-4 text-center">—</div>}
          </div>
          <div className="text-[10px] text-faint mt-3 leading-relaxed border-t border-edge/60 pt-2.5">
            Tip: double-click a token to remove it. Drawings + positions save together with the board.
          </div>
        </div>
      </div>
    </div>
  );
}

export function MapsPage({ me, parts }: { me: User; parts: string[] }) {
  void me;
  const [boards, setBoards] = useState<MapBoard[] | null>(null);
  const [kindFilter, setKindFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [drafts, setDrafts] = useState<DraftPlan[]>([]);
  const id = parts[0] ? Number(parts[0]) : null;

  const load = useCallback(() => {
    api.get<MapBoard[]>(`/maps${qs({ kind: kindFilter || undefined })}`).then(setBoards).catch(() => setBoards([]));
    api.get<DraftPlan[]>("/drafts").then(setDrafts).catch(() => setDrafts([]));
  }, [kindFilter]);
  useEffect(() => { if (!id) load(); }, [load, id]);

  if (id) return <BoardEditor id={id} />;

  async function create(kind: string, name: string, opponent: string, draftId: number | null) {
    const b = await api.post<MapBoard>("/maps", { kind, name: name || `${kind.toUpperCase()} board`, opponent, draft_id: draftId });
    navigate("maps", b.id);
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Map Lab" sub="Tactical boards on the Land of Dawn — drag heroes, draw rotations, save the plan."
        right={<button className="btn-primary" onClick={() => setShowNew(true)}><Plus size={15} /> New board</button>} />

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
