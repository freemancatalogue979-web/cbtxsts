import { Eraser, Hand, Layers, Map as MapIcon, Maximize2, Minimize2, MousePointer2, MoveUpRight, PenLine, Plus, RotateCcw, Save, Swords, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, qs } from "../lib/api";
import type { DraftPlan, Hero, MapBoard, MapGuide, User } from "../lib/types";
import { navigate } from "../lib/util";
import { Empty, Field, PageTitle, SectionTitle, Spinner } from "../components/ui";
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
const GAME_SRC = "/map/game-map.webp"; // official battlefield render (user-provided), 1870×841 → ratio 2.224
const PEN_COLORS = [
  { id: "#34d399", label: "Ours" },
  { id: "#e11d48", label: "Enemy" },
  { id: "#f5b942", label: "Plan" },
  { id: "#7db5f5", label: "Info" },
];
const LANE_SPOTS: Record<Side, Record<string, [number, number]>> = {
  ours: { EXP: [32, 14], JUNGLE: [36, 42], MID: [47, 52], GOLD: [66, 84], ROAM: [52, 44] },
  theirs: { EXP: [68, 86], JUNGLE: [64, 58], MID: [53, 48], GOLD: [34, 16], ROAM: [48, 56] },
  neutral: {},
};
const uid = () => Math.random().toString(36).slice(2, 9);

function BoardEditor({ id }: { id: number }) {
  const [board, setBoard] = useState<MapBoard | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [paths, setPaths] = useState<DrawPath[]>([]);
  const [history, setHistory] = useState<{ tokens: Token[]; paths: DrawPath[] }[]>([]);
  const [tool, setTool] = useState<"move" | "pan" | "pen" | "free" | "erase">("move");
  const strokeFree = useRef(false); // true = freehand, false = straight arrow
  const ptrs = useRef(new Map<number, { x: number; y: number }>()); // live pointers: pinch gestures
  const pinch = useRef<{ d0: number; m0: { x: number; y: number }; v0: { z: number; x: number; y: number } } | null>(null);
  const [penColor, setPenColor] = useState(PEN_COLORS[0].id);
  const [stroke, setStroke] = useState<number[][] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mapStyle, setMapStyle] = useState<"game" | "diagram">("game");
  const [gameMapFailed, setGameMapFailed] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [heroQ, setHeroQ] = useState("");
  const [newSide, setNewSide] = useState<Side>("ours");
  const [err, setErr] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);   // viewport (fixed frame)
  const surf = useRef<HTMLDivElement>(null);   // map surface (translated + scaled)
  const fsWrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 }); // zoom & pan of the surface
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const zoomStep = (v: { z: number; x: number; y: number }, k: number) => {
    const s = area.current?.getBoundingClientRect();
    if (!s) return v;
    const nz = Math.max(1, Math.min(5, v.z * k));
    const f = nz / v.z;
    const px = s.width / 2, py = s.height / 2;
    return clampView({ z: nz, x: px - (px - v.x) * f, y: py - (py - v.y) * f });
  };

  const clampView = (v: { z: number; x: number; y: number }) => {
    if (v.z <= 1.001) return { z: 1, x: 0, y: 0 };
    const s = area.current?.getBoundingClientRect();
    if (!s) return v;
    return {
      z: v.z,
      x: Math.max(s.width - s.width * v.z, Math.min(0, v.x)),
      y: Math.max(s.height - s.height * v.z, Math.min(0, v.y)),
    };
  };

  // wheel = zoom toward the cursor (non-passive so the page doesn't scroll instead)
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => {
        const nz = Math.max(1, Math.min(5, v.z * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
        const px = e.clientX - r.left, py = e.clientY - r.top;
        const k = nz / v.z;
        return clampView({ z: nz, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      fsWrap.current?.requestFullscreen?.().catch(() => {});
    }
  }

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
    // surf is the transformed surface — its rect already includes zoom & pan,
    // so map-percentage coordinates stay correct at any zoom level
    const r = surf.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };

  function startPinch() {
    const [a, b] = [...ptrs.current.values()];
    if (!a || !b) return;
    pinch.current = {
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      v0: { ...view },
    };
    setStroke(null); setDragId(null); panRef.current = null;
  }
  function applyPinch() {
    const [a, b] = [...ptrs.current.values()];
    const g = pinch.current;
    if (!a || !b || !g) return;
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const rect = area.current!.getBoundingClientRect();
    const px = mx - rect.left, py = my - rect.top;      // cursor midpoint in viewport px
    const px0 = g.m0.x - rect.left, py0 = g.m0.y - rect.top;
    const nz = Math.max(1, Math.min(5, g.v0.z * (d / g.d0)));
    const k = nz / g.v0.z;
    // zoom about the gesture midpoint, following finger drift
    const x = px - (px0 - g.v0.x) * k;
    const y = py - (py0 - g.v0.y) * k;
    setView(clampView({ z: nz, x, y }));
  }
  function onAreaDown(e: React.PointerEvent) {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) { startPinch(); e.preventDefault(); return; }
    if (ptrs.current.size > 2) return;
    // pan: hand tool, or middle/right-drag with any tool
    if (e.button === 1 || e.button === 2 || tool === "pan") {
      panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (tool === "pen" || tool === "free") {
      strokeFree.current = tool === "free";
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      setStroke([pt(e)]);
    } else if (tool === "erase") {
      const [x, y] = pt(e);
      eraseNearestPath(x, y);
    }
  }
  function onAreaMove(e: React.PointerEvent) {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && ptrs.current.size >= 2) { applyPinch(); return; }
    if (panRef.current) {
      const p = panRef.current;
      setView((v) => clampView({ z: v.z, x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) }));
      return;
    }
    if (dragId) {
      const [x, y] = pt(e);
      setTokens((ts) => ts.map((t) => (t.id === dragId ? { ...t, x, y } : t)));
      setDirty(true);
    } else if (stroke) {
      if (strokeFree.current) setStroke((s) => (s ? [...s, pt(e)] : s));      // freehand ink
      else setStroke((s) => (s ? [s[0], pt(e)] : s));                        // straight arrow
    }
  }
  function onAreaUp(e?: React.PointerEvent) {
    if (e) ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (ptrs.current.size > 0) return; // another finger still down — wait
    if (panRef.current) { panRef.current = null; return; }
    if (dragId) { setDragId(null); return; }
    if (stroke) {
      if (strokeFree.current) {
        if (stroke.length > 1) {
          snapshot();
          setPaths((p) => [...p, { color: penColor, points: stroke }]);
          setDirty(true);
        }
      } else {
        const [a, b] = stroke;
        if (b && Math.hypot(b[0] - a[0], b[1] - a[1]) > 1.2) {
          snapshot();
          setPaths((p) => [...p, { color: penColor, points: [a, b] }]);
          setDirty(true);
        }
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

  /** Straight-arrow renderer. 2-point paths = new-style arrows (line + head);
   *  older saved freehand boards (if any) render as plain polylines. */
  const mapAspect = mapStyle === "game" && !gameMapFailed ? 1870 / 841 : 1;
  function ArrowPath({ pts, color, aspect, fade }: { pts: number[][]; color: string; aspect: number; fade?: boolean }) {
    if (pts.length === 2) {
      const [[x1, y1], [x2, y2]] = pts;
      const ang = Math.atan2(y2 - y1, (x2 - x1) * aspect); // aspect-corrected so heads aren't stretched
      const H = 2.6; // arrow head length in map-%
      const w1 = [x2 + Math.cos(ang + Math.PI + 0.55) * (H / aspect), y2 + Math.sin(ang + Math.PI + 0.55) * H];
      const w2 = [x2 + Math.cos(ang + Math.PI - 0.55) * (H / aspect), y2 + Math.sin(ang + Math.PI - 0.55) * H];
      return (
        <g opacity={fade ? 0.85 : 0.95}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="4"
            strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={`M${x2},${y2} L${w1[0]},${w1[1]} L${w2[0]},${w2[1]} Z`} fill={color} />
        </g>
      );
    }
    return (
      <polyline points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
        vectorEffect="non-scaling-stroke" opacity="0.9" />
    );
  }

  function eraseNearestPath(x: number, y: number) {
    if (paths.length === 0) return;
    let best = -1; let bestDist = 5;
    paths.forEach((p, pi) => {
      // arrows store only 2 endpoints — probe the whole segment so mid-line clicks erase
      const probes = p.points.length === 2
        ? Array.from({ length: 9 }, (_, i) => {
            const t = i / 8;
            return [
              p.points[0][0] + (p.points[1][0] - p.points[0][0]) * t,
              p.points[0][1] + (p.points[1][1] - p.points[0][1]) * t,
            ];
          })
        : p.points;
      for (const [px, py] of probes) {
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
          <button className="btn-ghost !py-1.5 !text-[12px] !text-crim" title="Delete board"
            onClick={async () => {
              if (confirm(`Delete board "${board.name}"? This can't be undone.`)) {
                await api.del(`/maps/${board.id}`);
                navigate("maps");
              }
            }}><Trash2 size={13} /></button>
          <button className="btn-primary !py-1.5 !text-[12.5px]" disabled={!dirty || saving} onClick={save}>
            <Save size={13} /> {saving ? "Saving…" : dirty ? "Save board" : "Saved"}
          </button>
        </div>
      </div>

      {err && <div className="text-crim text-sm">{err}</div>}

      <div className="grid lg:grid-cols-[minmax(0,2.6fr)_minmax(240px,1fr)] gap-5 items-start">
        {/* ------- the board ------- */}
        <div ref={fsWrap} className={`card overflow-hidden ${isFs ? "!rounded-none !border-0 bg-ink flex flex-col h-full" : ""}`}>
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-edge bg-raised/60">
            {([
              ["move", "Drag", MousePointer2],
              ["pan", "Pan", Hand],
              ["pen", "Arrow", MoveUpRight],
              ["free", "Draw", PenLine],
              ["erase", "Erase", Eraser],
            ] as const).map(([t, label, Icon]) => (
              <button key={t}
                className={`btn-ghost !px-2.5 !py-1.5 !text-[11.5px] ${tool === t ? "border-crim/60 text-crim bg-crim-dim/40" : ""}`}
                onClick={() => setTool(t)} aria-pressed={tool === t}>
                <Icon size={13} /> {label}
              </button>
            ))}
            {(tool === "pen" || tool === "free") && (
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
            <div className="flex items-center gap-1 rounded-md border border-edge p-0.5">
              {(["game", "diagram"] as const).map((m) => (
                <button key={m} type="button"
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${mapStyle === m ? "bg-raised text-text" : "text-faint hover:text-mute"}`}
                  onClick={() => setMapStyle(m)}>
                  {m === "game" ? "Game map" : "Diagram"}
                </button>
              ))}
            </div>
            <button className="btn-ghost !px-2 !py-1.5 !text-[11.5px] ml-1" onClick={toggleFullscreen}
              title={isFs ? "Exit fullscreen (Esc)" : "Plan fullscreen"}>
              {isFs ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <span className="mx-1.5 w-px h-5 bg-edge" />
            <button className="btn-ghost !px-2 !py-1.5 !text-[11.5px]" onClick={undo} disabled={history.length === 0}>
              <RotateCcw size={13} /> Undo
            </button>
            <button className="btn-ghost !px-2 !py-1.5 !text-[11.5px] hover:!text-crim"
              onClick={() => { snapshot(); setTokens([]); setPaths([]); setDirty(true); }}>
              <Trash2 size={13} /> Clear
            </button>
            <span className="ml-auto text-[10px] text-faint uppercase tracking-widest font-semibold">
              {tool === "move"
                ? "drag heroes · scroll zooms · right-drag pans"
                : tool === "pan"
                  ? "drag to move around the map · scroll to zoom"
                  : tool === "pen"
                    ? "press, drag, release → straight arrow"
                  : tool === "free"
                    ? "hold & draw freely · pinch to zoom"
                    : "click an arrow to erase"}
            </span>
          </div>

          {/* map surface */}
          <div className={isFs ? "flex-1 min-h-0 grid place-items-center p-2" : "p-2 sm:p-3"}>
            <div
              ref={area}
              className={`relative w-full rounded-lg overflow-hidden border border-edge select-none touch-none ${tool === "pan" ? "cursor-grab active:cursor-grabbing" : ""}`}
              style={{
                aspectRatio: mapStyle === "game" && !gameMapFailed ? "1870 / 841" : "1 / 1",
                ...(isFs
                  ? { width: `min(100%, calc((100dvh - 120px) * ${mapStyle === "game" && !gameMapFailed ? "1.5" : "1"}))` }
                  : {}),
              }}
              onPointerDown={onAreaDown}
              onPointerMove={onAreaMove}
              onPointerUp={onAreaUp}
              onPointerLeave={onAreaUp}
              onPointerCancel={onAreaUp}
              onContextMenu={(e) => e.preventDefault()}
            >
              {/* zoomable / pannable surface */}
              <div
                ref={surf}
                className="absolute inset-0"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: "0 0" }}
              >
              {mapStyle === "game" && !gameMapFailed ? (
                <img
                  src={GAME_SRC}
                  alt="Land of Dawn battlefield"
                  draggable={false}
                  onError={() => { setGameMapFailed(true); setMapStyle("diagram"); }}
                  className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
                />
              ) : (
                <BattlefieldMap className="absolute inset-0" />
              )}

              {/* saved strokes + live preview stroke (all rendered with arrowheads) */}
              <svg viewBox="0 0 100 100" preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full pointer-events-none">
                {paths.map((p, i) => <ArrowPath key={i} pts={p.points} color={p.color} aspect={mapAspect} />)}
                {stroke && <ArrowPath pts={stroke} color={penColor} aspect={mapAspect} fade />}
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
              </div>{/* /surf */}

              {/* zoom controls */}
              <div className="absolute right-2 bottom-2 z-10 flex flex-col items-center gap-1">
                {view.z > 1 && (
                  <button type="button" className="bg-black/65 backdrop-blur-sm border border-edge-2 rounded-md px-1.5 py-1 text-[9.5px] font-bold text-mute hover:text-text"
                    title="Reset zoom" onClick={() => setView({ z: 1, x: 0, y: 0 })}>
                    {Math.round(view.z * 100)}%
                  </button>
                )}
                <button type="button" className="bg-black/65 backdrop-blur-sm border border-edge-2 rounded-md p-1.5 text-mute hover:text-text" title="Zoom in"
                  onClick={() => setView((v) => zoomStep(v, 1.3))}>
                  <ZoomIn size={14} />
                </button>
                <button type="button" className="bg-black/65 backdrop-blur-sm border border-edge-2 rounded-md p-1.5 text-mute hover:text-text" title="Zoom out"
                  onClick={() => setView((v) => zoomStep(v, 1 / 1.3))}>
                  <ZoomOut size={14} />
                </button>
              </div>
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
  const [tab, setTab] = useState<"boards" | "guide">("boards");
  const id = parts[0] ? Number(parts[0]) : null;

  const load = useCallback(() => {
    api.get<MapBoard[]>(`/maps${qs({ kind: kindFilter || undefined })}`).then(setBoards).catch(() => setBoards([]));
    api.get<DraftPlan[]>("/drafts").then(setDrafts).catch(() => setDrafts([]));
  }, [kindFilter]);
  useEffect(() => { if (!id) load(); }, [load, id]);

  if (id) return <BoardEditor id={id} />;
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
