import {
  CirclePlus, Eraser, Footprints, Hand, Layers, Maximize2, Minimize2, MousePointer2,
  MoveUpRight, PenLine, RotateCcw, Save, Trash2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { DraftPlan, Hero, MapBoard, MapChip, MapStep, MapToken } from "../lib/types";
import { navigate } from "../lib/util";
import { BattlefieldMap } from "./BattlefieldMap";
import { HeroImg } from "./HeroImg";
import { Field, Spinner } from "./ui";

type Side = MapToken["side"];
type DrawPath = { color: string; points: number[][]; mode?: "arrow" | "free" };
type Tool = "move" | "pan" | "pen" | "free" | "steps" | "chip" | "erase";
type Target = { kind: "hero" | "chip" | "step"; id: string };
type BoardSnapshot = { tokens: MapToken[]; paths: DrawPath[]; steps: MapStep[]; chips: MapChip[] };
type ChipSettings = Pick<MapChip, "name" | "color" | "size">;
type Gesture =
  | { kind: "pan"; pointerId: number; sx: number; sy: number; ox: number; oy: number }
  | { kind: "drag"; pointerId: number; target: Target; sx: number; sy: number; changed: boolean }
  | { kind: "draw"; pointerId: number; sx: number; sy: number; moved: boolean; points: number[][]; mode: "arrow" | "free";
      color: string; isStep: boolean; number: number; parentId?: string; tokenId?: string; chipId?: string }
  | { kind: "place"; pointerId: number; point: number[]; settings: ChipSettings };

const SIDE_RING: Record<Side, string> = {
  ours: "ring-leaf/90 bg-leaf/10",
  theirs: "ring-crim/90 bg-crim/10",
  neutral: "ring-amber/80 bg-amber/10",
};
const GAME_SRC = "/map/game-map.webp";
const PEN_COLORS = [
  { id: "#34d399", label: "Ours" },
  { id: "#e11d48", label: "Enemy" },
  { id: "#f5b942", label: "Plan" },
  { id: "#7db5f5", label: "Info" },
];
const CHIP_COLORS = [
  { id: "#34d399", label: "Green" },
  { id: "#e11d48", label: "Red" },
  { id: "#f5b942", label: "Gold" },
  { id: "#7db5f5", label: "Blue" },
  { id: "#a78bfa", label: "Purple" },
  { id: "#fb923c", label: "Orange" },
  { id: "#f472b6", label: "Pink" },
  { id: "#f4f4f5", label: "White" },
];
const LANE_SPOTS: Record<Side, Record<string, [number, number]>> = {
  ours: { EXP: [32, 14], JUNGLE: [36, 42], MID: [47, 52], GOLD: [66, 84], ROAM: [52, 44] },
  theirs: { EXP: [68, 86], JUNGLE: [64, 58], MID: [53, 48], GOLD: [34, 16], ROAM: [48, 56] },
  neutral: {},
};
const HERO_SIZE = 44;
const DEFAULT_CHIP: ChipSettings = { name: "Minion", color: "#f5b942", size: 52 };
const uid = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 11);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const endpoint = (step: MapStep) => step.points[step.points.length - 1];

function contrast(color: string): string {
  const hex = /^#[\da-f]{6}$/i.test(color) ? color.slice(1) : "f5b942";
  const n = parseInt(hex, 16);
  return (((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 160) ? "#111116" : "#fff";
}

/** Resolve attached starts without changing their saved fallback coordinates. */
function resolvedPoints(step: MapStep, steps: MapStep[], tokens: MapToken[], chips: MapChip[]): number[][] {
  const parent = step.parentId ? steps.find((s) => s.id === step.parentId) : undefined;
  const token = step.tokenId ? tokens.find((t) => t.id === step.tokenId) : undefined;
  const chip = step.chipId ? chips.find((c) => c.id === step.chipId) : undefined;
  const start = parent && endpoint(parent) ? endpoint(parent)
    : token ? [token.x, token.y]
      : chip ? [chip.x, chip.y]
        : step.points[0];
  return start ? [start, ...step.points.slice(1)] : [];
}

/** Draw in map-percent coordinates while keeping arrowheads aspect-correct. */
function PathShape({ points, color, aspect, head, fade = false }: {
  points: number[][]; color: string; aspect: number; head: boolean; fade?: boolean;
}) {
  if (points.length < 2) return null;
  const [x2, y2] = points[points.length - 1];
  let previous = points[points.length - 2];
  for (let i = points.length - 2; i >= 0; i--) {
    previous = points[i];
    if (Math.hypot((x2 - previous[0]) * aspect, y2 - previous[1]) > 0.2) break;
  }
  const angle = Math.atan2(y2 - previous[1], (x2 - previous[0]) * aspect);
  const h = 2.6;
  const wing1 = [x2 + Math.cos(angle + Math.PI + 0.55) * (h / aspect), y2 + Math.sin(angle + Math.PI + 0.55) * h];
  const wing2 = [x2 + Math.cos(angle + Math.PI - 0.55) * (h / aspect), y2 + Math.sin(angle + Math.PI - 0.55) * h];
  return (
    <g opacity={fade ? 0.7 : 0.95}>
      <polyline points={points.map(([x, y]) => `${x},${y}`).join(" ")} fill="none"
        stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {head && <path d={`M${x2},${y2} L${wing1[0]},${wing1[1]} L${wing2[0]},${wing2[1]} Z`} fill={color} />}
    </g>
  );
}

/** Distance to the full line, not just sampled points, in aspect-corrected coordinates. */
function distanceToPath(x: number, y: number, points: number[][], aspect: number): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const ax = points[i - 1][0] * aspect, ay = points[i - 1][1];
    const bx = points[i][0] * aspect, by = points[i][1];
    const px = x * aspect, py = y;
    const dx = bx - ax, dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const t = denominator ? clamp(((px - ax) * dx + (py - ay) * dy) / denominator, 0, 1) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}

function PenPalette({ color, onChange, prefix }: { color: string; onChange: (value: string) => void; prefix: string }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`${prefix} color`}>
      {PEN_COLORS.map((c) => (
        <button key={c.id} type="button" title={c.label} aria-label={`${prefix} color: ${c.label}`}
          aria-pressed={color === c.id}
          className={`rounded-full border-2 ${color === c.id ? "border-text" : "border-transparent"}`}
          style={{ backgroundColor: c.id, width: 20, height: 20 }} onClick={() => onChange(c.id)} />
      ))}
    </div>
  );
}

export function MapBoardEditor({ id }: { id: number }) {
  const [board, setBoard] = useState<MapBoard | null>(null);
  const [tokens, setTokens] = useState<MapToken[]>([]);
  const [paths, setPaths] = useState<DrawPath[]>([]);
  const [steps, setSteps] = useState<MapStep[]>([]);
  const [chips, setChips] = useState<MapChip[]>([]);
  const [history, setHistory] = useState<BoardSnapshot[]>([]);
  const [tool, setTool] = useState<Tool>("move");
  const [stepMode, setStepMode] = useState<"arrow" | "free">("arrow");
  const [penColor, setPenColor] = useState(PEN_COLORS[0].id);
  const [chipDraft, setChipDraft] = useState<ChipSettings>(DEFAULT_CHIP);
  const [selected, setSelected] = useState<Target | null>(null);
  const [preview, setPreview] = useState<{ points: number[][]; color: string; head: boolean } | null>(null);
  const [chipPreview, setChipPreview] = useState<{ point: number[]; settings: ChipSettings } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mapStyle, setMapStyle] = useState<"game" | "diagram">("game");
  const [gameMapFailed, setGameMapFailed] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [heroQ, setHeroQ] = useState("");
  const [newSide, setNewSide] = useState<Side>("ours");
  const [err, setErr] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const surf = useRef<HTMLDivElement>(null);
  const fsWrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; m0: { x: number; y: number }; v0: { z: number; x: number; y: number } } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const mapAspect = mapStyle === "game" && !gameMapFailed ? 1870 / 841 : 1;
  const selectedChip = selected?.kind === "chip" ? chips.find((c) => c.id === selected.id) : undefined;
  const selectedHero = selected?.kind === "hero" ? tokens.find((t) => t.id === selected.id) : undefined;
  const selectedStep = selected?.kind === "step" ? steps.find((s) => s.id === selected.id) : undefined;
  const chipSettings = selectedChip ?? chipDraft;

  const clampView = (v: { z: number; x: number; y: number }) => {
    if (v.z <= 1.001) return { z: 1, x: 0, y: 0 };
    const r = area.current?.getBoundingClientRect();
    if (!r) return v;
    return { z: v.z, x: clamp(v.x, r.width - r.width * v.z, 0), y: clamp(v.y, r.height - r.height * v.z, 0) };
  };
  const zoomStep = (v: { z: number; x: number; y: number }, k: number) => {
    const r = area.current?.getBoundingClientRect();
    if (!r) return v;
    const z = clamp(v.z * k, 1, 5), factor = z / v.z;
    return clampView({ z, x: r.width / 2 - (r.width / 2 - v.x) * factor, y: r.height / 2 - (r.height / 2 - v.y) * factor });
  };

  // The board mounts after its API response; bind once it actually exists.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => {
        const z = clamp(v.z * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 1, 5);
        const x = e.clientX - r.left, y = e.clientY - r.top, factor = z / v.z;
        return clampView({ z, x: x - (x - v.x) * factor, y: y - (y - v.y) * factor });
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id]);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const load = useCallback(() => {
    api.get<MapBoard>(`/maps/${id}`).then((b) => {
      setBoard(b);
      const data = b.data || {};
      setTokens(data.tokens ?? []);
      setPaths(data.paths ?? []);
      setSteps(data.steps ?? []);
      setChips(data.chips ?? []);
      setHistory([]);
      setSelected(null);
      setDirty(false);
    }).catch(() => setBoard(null));
    api.get<Hero[]>("/heroes").then(setHeroes).catch(() => setHeroes([]));
  }, [id]);
  useEffect(load, [load]);

  const snapshot = () => setHistory((h) => [...h.slice(-29), { tokens, paths, steps, chips }]);
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setTokens(last.tokens); setPaths(last.paths); setSteps(last.steps); setChips(last.chips);
    setHistory(history.slice(0, -1)); setSelected(null); setDirty(true);
  };
  const point = (e: React.PointerEvent): number[] => {
    const r = surf.current!.getBoundingClientRect();
    return [Math.round(clamp((e.clientX - r.left) / r.width * 100, 0, 100) * 10) / 10,
      Math.round(clamp((e.clientY - r.top) / r.height * 100, 0, 100) * 10) / 10];
  };

  function chooseTool(next: Tool) {
    if (next === "chip" && selectedChip) {
      setChipDraft({ name: selectedChip.name, color: selectedChip.color, size: selectedChip.size });
    }
    setSelected(null);
    setTool(next);
  }
  function selectTarget(target: Target) {
    setSelected(target);
    if (target.kind === "chip") {
      const chip = chips.find((c) => c.id === target.id);
      if (chip) setChipDraft({ name: chip.name, color: chip.color, size: chip.size });
    }
  }
  function targetAt(e: React.PointerEvent): Target | null {
    const el = (e.target as Element).closest<HTMLElement>("[data-map-kind][data-map-id]");
    const kind = el?.dataset.mapKind;
    const targetId = el?.dataset.mapId;
    return targetId && (kind === "hero" || kind === "chip" || kind === "step") ? { kind, id: targetId } : null;
  }
  function startPinch() {
    const [a, b] = [...ptrs.current.values()];
    if (!a || !b) return;
    pinch.current = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { ...view } };
    gesture.current = null;
    setPreview(null); setChipPreview(null);
  }
  function applyPinch() {
    const [a, b] = [...ptrs.current.values()], p = pinch.current, r = area.current?.getBoundingClientRect();
    if (!a || !b || !p || !r) return;
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const x = (a.x + b.x) / 2 - r.left, y = (a.y + b.y) / 2 - r.top;
    const x0 = p.m0.x - r.left, y0 = p.m0.y - r.top;
    const z = clamp(p.v0.z * distance / p.d0, 1, 5), factor = z / p.v0.z;
    setView(clampView({ z, x: x - (x0 - p.v0.x) * factor, y: y - (y0 - p.v0.y) * factor }));
  }

  function deleteStep(idToDelete: string) {
    const ids = new Set([idToDelete]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of steps) {
        if (step.parentId && ids.has(step.parentId) && !ids.has(step.id)) { ids.add(step.id); changed = true; }
      }
    }
    snapshot(); setSteps((ss) => ss.filter((s) => !ids.has(s.id))); setSelected(null); setDirty(true);
  }
  function removeToken(idToDelete: string) {
    const token = tokens.find((t) => t.id === idToDelete);
    if (!token) return;
    snapshot();
    setSteps((ss) => ss.map((s) => s.tokenId === idToDelete
      ? { ...s, tokenId: undefined, points: [[token.x, token.y], ...s.points.slice(1)] } : s));
    setTokens((ts) => ts.filter((t) => t.id !== idToDelete));
    setSelected(null); setDirty(true);
  }
  function removeChip(idToDelete: string) {
    const chip = chips.find((c) => c.id === idToDelete);
    if (!chip) return;
    snapshot();
    setSteps((ss) => ss.map((s) => s.chipId === idToDelete
      ? { ...s, chipId: undefined, points: [[chip.x, chip.y], ...s.points.slice(1)] } : s));
    setChips((cs) => cs.filter((c) => c.id !== idToDelete));
    setSelected(null); setDirty(true);
  }
  function eraseAt(x: number, y: number, target: Target | null) {
    if (target?.kind === "step") { deleteStep(target.id); return; }
    if (target?.kind === "chip") { removeChip(target.id); return; }
    let best = 4.5 / view.z;
    let found: { kind: "path"; index: number } | { kind: "step"; id: string } | null = null;
    paths.forEach((p, index) => {
      const distance = distanceToPath(x, y, p.points, mapAspect);
      if (distance < best) { best = distance; found = { kind: "path", index }; }
    });
    steps.forEach((s) => {
      const distance = distanceToPath(x, y, resolvedPoints(s, steps, tokens, chips), mapAspect);
      if (distance < best) { best = distance; found = { kind: "step", id: s.id }; }
    });
    // Assignments in forEach are invisible to TypeScript's control-flow analysis.
    const hit = found as { kind: "path"; index: number } | { kind: "step"; id: string } | null;
    if (hit?.kind === "step") deleteStep(hit.id);
    else if (hit?.kind === "path") { snapshot(); setPaths((pp) => pp.filter((_, i) => i !== hit.index)); setDirty(true); }
  }

  function onAreaDown(e: React.PointerEvent<HTMLDivElement>) {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (ptrs.current.size === 2) { startPinch(); e.preventDefault(); return; }
    if (ptrs.current.size > 2) return;
    if (e.button === 1 || e.button === 2 || tool === "pan") {
      gesture.current = { kind: "pan", pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
      e.preventDefault(); return;
    }
    if (e.button !== 0) return;
    const target = targetAt(e);
    if (tool === "move") {
      if (target) {
        // Opening the marker editor changes the layout, so wait until release.
        // Otherwise the map shifts underneath a marker as soon as it is dragged.
        gesture.current = { kind: "drag", pointerId: e.pointerId, target, sx: e.clientX, sy: e.clientY, changed: false };
        e.preventDefault();
      } else setSelected(null);
    } else if (tool === "pen" || tool === "free" || tool === "steps") {
      const parent = tool === "steps" && target?.kind === "step" ? steps.find((s) => s.id === target.id) : undefined;
      const token = tool === "steps" && target?.kind === "hero" ? tokens.find((t) => t.id === target.id) : undefined;
      const chip = tool === "steps" && target?.kind === "chip" ? chips.find((c) => c.id === target.id) : undefined;
      const start = parent && endpoint(parent) ? endpoint(parent) : token ? [token.x, token.y] : chip ? [chip.x, chip.y] : point(e);
      const color = parent?.color ?? penColor;
      const mode = tool === "steps" ? stepMode : tool === "free" ? "free" : "arrow";
      gesture.current = { kind: "draw", pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, points: [start],
        mode, color, isStep: tool === "steps", number: parent ? parent.number + 1 : 1,
        parentId: parent?.id, tokenId: token?.id, chipId: chip?.id };
      setPreview({ points: [start], color, head: tool === "steps" || mode === "arrow" });
      e.preventDefault();
    } else if (tool === "chip") {
      const p = point(e), settings = { ...chipDraft, name: chipDraft.name.trim() || "Chip" };
      gesture.current = { kind: "place", pointerId: e.pointerId, point: p, settings };
      setChipPreview({ point: p, settings });
      e.preventDefault();
    } else if (tool === "erase") {
      const [x, y] = point(e); eraseAt(x, y, target); e.preventDefault();
    }
  }
  function onAreaMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && ptrs.current.size >= 2) { applyPinch(); return; }
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.kind === "pan") {
      setView((v) => clampView({ z: v.z, x: g.ox + e.clientX - g.sx, y: g.oy + e.clientY - g.sy }));
    } else if (g.kind === "drag") {
      if (!g.changed && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return;
      if (!g.changed) { snapshot(); g.changed = true; }
      const [x, y] = point(e);
      if (g.target.kind === "hero") setTokens((ts) => ts.map((t) => t.id === g.target.id ? { ...t, x, y } : t));
      else if (g.target.kind === "chip") setChips((cs) => cs.map((c) => c.id === g.target.id ? { ...c, x, y } : c));
      else setSteps((ss) => ss.map((s) => s.id === g.target.id ? { ...s, points: [...s.points.slice(0, -1), [x, y]] } : s));
      setDirty(true);
    } else if (g.kind === "draw") {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) >= 5) g.moved = true;
      const p = point(e);
      if (g.mode === "free") {
        const last = g.points[g.points.length - 1];
        if (Math.hypot((p[0] - last[0]) * mapAspect, p[1] - last[1]) > 0.15) g.points = [...g.points, p];
      } else g.points = [g.points[0], p];
      setPreview({ points: g.points, color: g.color, head: g.isStep || g.mode === "arrow" });
    } else {
      g.point = point(e);
      setChipPreview({ point: g.point, settings: g.settings });
    }
  }
  function onAreaUp(e: React.PointerEvent<HTMLDivElement>, cancelled = false) {
    ptrs.current.delete(e.pointerId);
    if (pinch.current) {
      if (ptrs.current.size < 2) pinch.current = null;
      if (ptrs.current.size > 0) return;
    }
    if (ptrs.current.size > 0) return;
    const g = gesture.current;
    gesture.current = null;
    setPreview(null); setChipPreview(null);
    if (!g || g.pointerId !== e.pointerId || cancelled) return;
    if (g.kind === "drag") {
      selectTarget(g.target);
    } else if (g.kind === "place") {
      const [x, y] = point(e);
      snapshot(); setChips((cs) => [...cs, { id: uid(), ...g.settings, x, y }]); setDirty(true);
    } else if (g.kind === "draw" && (g.moved || Math.hypot(e.clientX - g.sx, e.clientY - g.sy) >= 5)) {
      const end = point(e);
      const last = g.points[g.points.length - 1];
      const points = g.mode === "arrow" ? [g.points[0], end]
        : Math.hypot(end[0] - last[0], end[1] - last[1]) > 0.05 ? [...g.points, end] : g.points;
      const length = points.slice(1).reduce((total, p, i) => total + Math.hypot((p[0] - points[i][0]) * mapAspect, p[1] - points[i][1]), 0);
      if (points.length < 2 || length < 0.4) return;
      snapshot();
      if (g.isStep) {
        setSteps((ss) => [...ss, { id: uid(), number: g.number, mode: g.mode, color: g.color, points,
          parentId: g.parentId, tokenId: g.tokenId, chipId: g.chipId }]);
      } else setPaths((pp) => [...pp, { color: g.color, points, mode: g.mode }]);
      setDirty(true);
    }
  }

  function onMarkerKey(e: React.KeyboardEvent, target: Target) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTool("move"); selectTarget(target); return; }
    if (tool !== "move") return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (target.kind === "hero") removeToken(target.id);
      else if (target.kind === "chip") removeChip(target.id);
      else deleteStep(target.id);
      return;
    }
    const d = e.shiftKey ? 2 : 0.5;
    const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
    const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
    if (!dx && !dy) return;
    e.preventDefault(); snapshot(); selectTarget(target);
    if (target.kind === "hero") setTokens((ts) => ts.map((t) => t.id === target.id ? { ...t, x: clamp(t.x + dx, 0, 100), y: clamp(t.y + dy, 0, 100) } : t));
    else if (target.kind === "chip") setChips((cs) => cs.map((c) => c.id === target.id ? { ...c, x: clamp(c.x + dx, 0, 100), y: clamp(c.y + dy, 0, 100) } : c));
    else setSteps((ss) => ss.map((s) => {
      if (s.id !== target.id) return s;
      const last = endpoint(s);
      return { ...s, points: [...s.points.slice(0, -1), [clamp(last[0] + dx, 0, 100), clamp(last[1] + dy, 0, 100)]] };
    }));
    setDirty(true);
  }

  function updateChip(patch: Partial<ChipSettings>) {
    if (selectedChip) {
      snapshot(); setChips((cs) => cs.map((c) => c.id === selectedChip.id ? { ...c, ...patch } : c)); setDirty(true);
    } else setChipDraft((draft) => ({ ...draft, ...patch }));
  }
  function addToken(hero: string) {
    snapshot();
    const spots = LANE_SPOTS[newSide];
    const lane = heroes.find((h) => h.name === hero)?.role;
    const [x, y] = (lane && spots[lane]) || [50 + (Math.random() * 10 - 5), 50 + (Math.random() * 10 - 5)];
    setTokens((ts) => [...ts, { id: uid(), hero, side: newSide, x, y }]); setDirty(true);
  }
  async function loadDraftLineup() {
    if (!board?.draft_id) return;
    try {
      const d = await api.get<DraftPlan>(`/drafts/${board.draft_id}`), lineup: MapToken[] = [];
      for (const [lane, hero] of Object.entries(d.draft.our_picks || {})) {
        const [x, y] = LANE_SPOTS.ours[lane] || [50, 50];
        if (hero) lineup.push({ id: uid(), hero, side: "ours", x, y });
      }
      for (const [lane, hero] of Object.entries(d.draft.enemy_picks || {})) {
        const [x, y] = LANE_SPOTS.theirs[lane] || [50, 50];
        if (hero) lineup.push({ id: uid(), hero, side: "theirs", x, y });
      }
      snapshot(); setTokens((ts) => [...ts, ...lineup]); setDirty(true);
    } catch (error) { setErr(error instanceof Error ? error.message : "Draft load failed"); }
  }
  async function save() {
    if (!board) return;
    setSaving(true); setErr(null);
    try {
      const b = await api.patch<MapBoard>(`/maps/${board.id}`, {
        name: board.name, opponent: board.opponent, notes: board.notes,
        data: { ...board.data, tokens, paths, steps, chips },
      });
      setBoard(b); setDirty(false);
    } catch (error) { setErr(error instanceof Error ? error.message : "Save failed"); }
    finally { setSaving(false); }
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else fsWrap.current?.requestFullscreen?.().catch(() => {});
  }
  const filteredHeroes = useMemo(() => {
    const q = heroQ.trim().toLowerCase();
    const rank: Record<string, number> = { META: 0, STRONG: 1, VIABLE: 2, SITUATIONAL: 3, WEAK: 4 };
    const list = [...heroes].sort((a, b) => (rank[a.meta_status] ?? 9) - (rank[b.meta_status] ?? 9) || b.clover_rating - a.clover_rating);
    return (q ? list.filter((h) => h.name.toLowerCase().includes(q)) : list).slice(0, 60);
  }, [heroes, heroQ]);

  if (!board) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button className="label !text-crim" onClick={() => navigate("maps")}>← Map boards</button>
        <input className="input !w-auto min-w-40 flex-1 max-w-72 !font-extrabold" value={board.name}
          onChange={(e) => { setBoard({ ...board, name: e.target.value }); setDirty(true); }} placeholder="Board name" />
        <span className="chip text-faint border-edge-2 uppercase !text-[10px]">{board.kind}</span>
        <div className="flex items-center gap-2 ml-auto">
          {board.draft_id != null && <button className="btn-ghost !py-1.5 !text-[12px]" onClick={loadDraftLineup}>
            <Layers size={13} /> Place draft lineup
          </button>}
          <button className="btn-ghost !py-1.5 !text-[12px] !text-crim" title="Delete board" onClick={async () => {
            if (confirm(`Delete board "${board.name}"? This can't be undone.`)) { await api.del(`/maps/${board.id}`); navigate("maps"); }
          }}><Trash2 size={13} /></button>
          <button className="btn-primary !py-1.5 !text-[12.5px]" disabled={!dirty || saving} onClick={save}>
            <Save size={13} /> {saving ? "Saving…" : dirty ? "Save board" : "Saved"}
          </button>
        </div>
      </div>
      {err && <div className="text-crim text-sm" role="alert">{err}</div>}

      <div className="grid lg:grid-cols-[minmax(0,2.6fr)_minmax(240px,1fr)] gap-5 items-start">
        <div ref={fsWrap} className={`card overflow-hidden ${isFs ? "!rounded-none !border-0 bg-ink flex flex-col h-full" : ""}`}>
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-edge bg-raised/60">
            {([
              ["move", "Drag", MousePointer2], ["pan", "Pan", Hand], ["pen", "Arrow", MoveUpRight],
              ["free", "Draw", PenLine], ["steps", "Steps", Footprints], ["chip", "Chip", CirclePlus], ["erase", "Erase", Eraser],
            ] as const).map(([t, label, Icon]) => (
              <button key={t} type="button" className={`btn-ghost !px-2.5 !py-1.5 !text-[11.5px] ${tool === t ? "border-crim/60 text-crim bg-crim-dim/40" : ""}`}
                onClick={() => chooseTool(t)} aria-pressed={tool === t}>
                <Icon size={13} /> {label}
              </button>
            ))}
            {(tool === "pen" || tool === "free") && <PenPalette color={penColor} onChange={setPenColor} prefix="Drawing" />}
            <span className="mx-1.5 w-px h-5 bg-edge" />
            <div className="flex items-center gap-1 rounded-md border border-edge p-0.5">
              {(["game", "diagram"] as const).map((m) => (
                <button key={m} type="button" className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${mapStyle === m ? "bg-raised text-text" : "text-faint hover:text-mute"}`}
                  aria-pressed={mapStyle === m} onClick={() => setMapStyle(m)}>{m === "game" ? "Game map" : "Diagram"}</button>
              ))}
            </div>
            <button type="button" className="btn-ghost !px-2 !py-1.5 !text-[11.5px] ml-1" onClick={toggleFullscreen}
              aria-label={isFs ? "Exit fullscreen" : "Plan fullscreen"} title={isFs ? "Exit fullscreen (Esc)" : "Plan fullscreen"}>
              {isFs ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <span className="mx-1.5 w-px h-5 bg-edge" />
            <button type="button" className="btn-ghost !px-2 !py-1.5 !text-[11.5px]" onClick={undo} disabled={history.length === 0}>
              <RotateCcw size={13} /> Undo
            </button>
            <button type="button" className="btn-ghost !px-2 !py-1.5 !text-[11.5px] hover:!text-crim"
              onClick={() => { snapshot(); setTokens([]); setPaths([]); setSteps([]); setChips([]); setSelected(null); setDirty(true); }}>
              <Trash2 size={13} /> Clear
            </button>
            <span className="ml-auto text-[10px] text-faint uppercase tracking-widest font-semibold">
              {tool === "move" ? "drag markers · pinch or scroll to zoom"
                : tool === "pan" ? "drag to pan · pinch to zoom"
                  : tool === "pen" ? "drag to draw an arrow"
                    : tool === "free" ? "hold & draw freely"
                      : tool === "steps" ? "drag a numbered point to continue"
                        : tool === "chip" ? "tap or drag on the map to place"
                          : "erase a step and its following steps · undo to restore"}
            </span>
          </div>

          {tool === "steps" && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5 border-b border-leaf/20 bg-leaf/[0.045]">
              <div className="flex items-center gap-2 text-leaf">
                <Footprints size={15} /><span className="text-[11px] font-extrabold uppercase tracking-[0.13em]">Steps</span>
                {steps.length > 0 && <span className="chip !text-[10px] text-leaf border-leaf/30">{steps.length}</span>}
              </div>
              <div className="flex rounded-md border border-edge bg-ink/50 p-0.5" role="group" aria-label="Step line style">
                <button type="button" onClick={() => setStepMode("arrow")} aria-pressed={stepMode === "arrow"}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-[10.5px] font-bold ${stepMode === "arrow" ? "bg-raised text-text" : "text-faint"}`}>
                  <MoveUpRight size={12} /> Arrow
                </button>
                <button type="button" onClick={() => setStepMode("free")} aria-pressed={stepMode === "free"}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-[10.5px] font-bold ${stepMode === "free" ? "bg-raised text-text" : "text-faint"}`}>
                  <PenLine size={12} /> Freehand
                </button>
              </div>
              <PenPalette color={penColor} onChange={setPenColor} prefix="Step" />
              <p className="text-[11px] leading-relaxed text-mute flex-1 min-w-[190px]">
                Start from a hero or anywhere. Drag from a number to add the next step.
              </p>
            </div>
          )}

          {(tool === "chip" || selectedChip) && (
            <div className="border-b border-edge bg-raised/35 px-3.5 py-3 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.13em] text-amber">
                    <CirclePlus size={14} /> {selectedChip ? "Edit chip" : "Place chips"}
                  </div>
                  <p className="text-[11px] text-mute mt-1">
                    {selectedChip ? "Changes apply to this chip. Drag it on the map to move it." : "Name it, pick a color and size, then tap or drag on the map. Place as many as you like."}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedChip && <button type="button" className="btn-ghost !px-2 !py-1.5 !text-[11px] !text-crim" onClick={() => removeChip(selectedChip.id)}>
                    <Trash2 size={12} /> Remove
                  </button>}
                  <button type="button" className="btn-ghost !px-2 !py-1.5 !text-[11px]" onClick={() => { setSelected(null); setTool("move"); }}>
                    <X size={12} /> Done
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5">
                <label className="block min-w-36 flex-1 max-w-64">
                  <span className="label block mb-1">Chip name</span>
                  <input className="input !py-1.5" aria-label="Chip name" maxLength={24} value={chipSettings.name}
                    onChange={(e) => updateChip({ name: e.target.value })} placeholder="e.g. Minion" />
                </label>
                <div>
                  <span className="label block mb-1">Color</span>
                  <div className="flex items-center gap-1.5">
                    {CHIP_COLORS.map((c) => <button key={c.id} type="button" title={c.label} aria-label={`Chip color: ${c.label}`}
                      aria-pressed={chipSettings.color.toLowerCase() === c.id}
                      className={`rounded-full border-2 ${chipSettings.color.toLowerCase() === c.id ? "border-text" : "border-transparent"}`}
                      style={{ backgroundColor: c.id, width: 21, height: 21 }} onClick={() => updateChip({ color: c.id })} />)}
                    <input type="color" aria-label="Custom chip color" title="Choose any color" value={chipSettings.color}
                      onChange={(e) => updateChip({ color: e.target.value })} className="w-7 h-7 p-0.5 rounded border border-edge-2 bg-raised cursor-pointer" />
                  </div>
                </div>
                <label className="block min-w-32 flex-1 max-w-52">
                  <span className="label flex justify-between mb-1"><span>Chip size</span><span className="text-mute">{chipSettings.size}px</span></span>
                  <input type="range" aria-label="Chip size" min={32} max={112} step={4} value={chipSettings.size}
                    onChange={(e) => updateChip({ size: Number(e.target.value) })} className="w-full h-2 cursor-pointer"
                    style={{ accentColor: chipSettings.color }} />
                </label>
              </div>
            </div>
          )}
          {tool === "move" && selectedHero && (
            <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 border-b border-edge bg-raised/35">
              <span className="text-[11px] font-extrabold text-mute">{selectedHero.hero}</span>
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-faint">
                Hero size <input type="range" aria-label="Hero size" min={32} max={112} step={4} value={selectedHero.size ?? HERO_SIZE}
                  onChange={(e) => { snapshot(); setTokens((ts) => ts.map((t) => t.id === selectedHero.id ? { ...t, size: Number(e.target.value) } : t)); setDirty(true); }} />
                <span className="text-mute">{selectedHero.size ?? HERO_SIZE}px</span>
              </label>
              <button type="button" className="btn-ghost !px-2 !py-1.5 !text-[11px] !text-crim ml-auto" onClick={() => removeToken(selectedHero.id)}>
                <Trash2 size={12} /> Remove hero
              </button>
              <button type="button" aria-label="Close marker editor" onClick={() => setSelected(null)} className="text-faint hover:text-text"><X size={14} /></button>
            </div>
          )}
          {tool === "move" && selectedStep && (
            <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 border-b border-edge bg-raised/35">
              <span className="text-[11px] font-extrabold text-mute">Step {selectedStep.number}</span>
              <span className="text-[11px] text-faint">Drag to reposition. Removing it also removes the steps after it.</span>
              <button type="button" className="btn-ghost !px-2 !py-1.5 !text-[11px] !text-crim ml-auto" onClick={() => deleteStep(selectedStep.id)}>
                <Trash2 size={12} /> Remove step
              </button>
              <button type="button" aria-label="Close step editor" onClick={() => setSelected(null)} className="text-faint hover:text-text"><X size={14} /></button>
            </div>
          )}

          <div className={isFs ? "flex-1 min-h-0 grid place-items-center p-2 overflow-auto" : "p-2 sm:p-3"}>
            <div ref={area} data-map-viewport
              className={`relative w-full rounded-lg overflow-hidden border border-edge select-none touch-none ${tool === "pan" ? "cursor-grab active:cursor-grabbing" : tool === "steps" || tool === "chip" ? "cursor-crosshair" : ""}`}
              style={{ aspectRatio: mapStyle === "game" && !gameMapFailed ? "1870 / 841" : "1 / 1",
                ...(isFs ? { width: `min(100%, calc((100dvh - 220px) * ${mapAspect}))` } : {}) }}
              onPointerDown={onAreaDown} onPointerMove={onAreaMove} onPointerUp={(e) => onAreaUp(e)}
              onPointerCancel={(e) => onAreaUp(e, true)} onContextMenu={(e) => e.preventDefault()}>
              <div ref={surf} data-map-surface className="absolute inset-0"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: "0 0" }}>
                {mapStyle === "game" && !gameMapFailed ? (
                  <img src={GAME_SRC} alt="Land of Dawn battlefield" draggable={false}
                    onError={() => { setGameMapFailed(true); setMapStyle("diagram"); }}
                    className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none" />
                ) : <BattlefieldMap className="absolute inset-0 pointer-events-none" />}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                  {paths.map((p, i) => <PathShape key={`path-${i}`} points={p.points} color={p.color} aspect={mapAspect}
                    head={p.mode ? p.mode === "arrow" : p.points.length === 2} />)}
                  {steps.map((s) => <PathShape key={s.id} points={resolvedPoints(s, steps, tokens, chips)} color={s.color} aspect={mapAspect} head />)}
                  {preview && <PathShape points={preview.points} color={preview.color} aspect={mapAspect} head={preview.head} fade />}
                </svg>

                {tokens.map((t) => {
                  const size = t.size ?? HERO_SIZE;
                  const target: Target = { kind: "hero", id: t.id };
                  return (
                    <button key={t.id} type="button" data-map-kind="hero" data-map-id={t.id} data-map-hero={t.hero}
                      aria-label={`${t.hero} hero token`} title={`${t.hero} (${t.side}) — select to resize or remove`}
                      onKeyDown={(e) => onMarkerKey(e, target)}
                      onDoubleClick={() => { if (tool === "move") removeToken(t.id); }}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ${SIDE_RING[t.side]} shadow-[0_4px_14px_rgba(0,0,0,0.65)] ${selected?.kind === "hero" && selected.id === t.id ? "outline outline-2 outline-offset-4 outline-white" : ""} ${tool === "move" ? "cursor-grab active:cursor-grabbing" : ""}`}
                      style={{ left: `${t.x}%`, top: `${t.y}%`, width: size, height: size, touchAction: "none" }}>
                      <HeroImg name={t.hero} size={size} eager className="rounded-full block" />
                      <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 text-[9px] font-bold bg-black/80 px-1.5 py-0.5 rounded leading-none whitespace-nowrap max-w-[100px] truncate pointer-events-none">{t.hero}</span>
                    </button>
                  );
                })}
                {chips.map((c) => {
                  const target: Target = { kind: "chip", id: c.id };
                  const initials = c.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?";
                  return (
                    <button key={c.id} type="button" data-map-kind="chip" data-map-id={c.id} data-map-chip={c.name}
                      aria-label={`${c.name || "Chip"} chip`} title={`${c.name || "Chip"} — select to edit or resize`}
                      onKeyDown={(e) => onMarkerKey(e, target)} onDoubleClick={() => { if (tool === "move") removeChip(c.id); }}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 shadow-[0_4px_14px_rgba(0,0,0,0.7)] font-black flex items-center justify-center ${selected?.kind === "chip" && selected.id === c.id ? "outline outline-2 outline-offset-4 outline-white" : ""} ${tool === "move" ? "cursor-grab active:cursor-grabbing" : ""}`}
                      style={{ left: `${c.x}%`, top: `${c.y}%`, width: c.size, height: c.size, backgroundColor: c.color,
                        color: contrast(c.color), fontSize: Math.max(12, c.size * 0.32), touchAction: "none" }}>
                      {initials}
                      <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 text-[9.5px] text-white font-bold bg-black/85 px-1.5 py-0.5 rounded leading-none whitespace-nowrap max-w-[140px] truncate pointer-events-none">{c.name || "Chip"}</span>
                    </button>
                  );
                })}
                {steps.map((s) => {
                  const end = endpoint(s);
                  if (!end) return null;
                  const target: Target = { kind: "step", id: s.id };
                  return (
                    <button key={s.id} type="button" data-map-kind="step" data-map-id={s.id} data-map-step={s.number}
                      aria-label={`Step ${s.number}`} title={`Step ${s.number} — drag from here in Steps to continue`}
                      onKeyDown={(e) => onMarkerKey(e, target)}
                      className={`absolute z-[2] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 shadow-[0_2px_9px_rgba(0,0,0,0.8)] flex items-center justify-center text-[11px] font-black ${selected?.kind === "step" && selected.id === s.id ? "outline outline-2 outline-offset-2 outline-white" : ""} ${tool === "move" ? "cursor-grab active:cursor-grabbing" : tool === "steps" ? "cursor-crosshair" : ""}`}
                      style={{ left: `${end[0]}%`, top: `${end[1]}%`, width: 26, height: 26, backgroundColor: s.color, color: contrast(s.color), touchAction: "none" }}>
                      {s.number}
                    </button>
                  );
                })}
                {chipPreview && <div aria-hidden="true" className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 opacity-60 pointer-events-none flex items-center justify-center font-black"
                  style={{ left: `${chipPreview.point[0]}%`, top: `${chipPreview.point[1]}%`, width: chipPreview.settings.size, height: chipPreview.settings.size,
                    color: contrast(chipPreview.settings.color), backgroundColor: chipPreview.settings.color }}>
                  {chipPreview.settings.name.slice(0, 1).toUpperCase()}
                </div>}
              </div>
              <div className="absolute right-2 bottom-2 z-10 flex flex-col items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
                {view.z > 1 && <button type="button" className="bg-black/65 backdrop-blur-sm border border-edge-2 rounded-md px-1.5 py-1 text-[9.5px] font-bold text-mute hover:text-text"
                  title="Reset zoom" onClick={() => setView({ z: 1, x: 0, y: 0 })}>{Math.round(view.z * 100)}%</button>}
                <button type="button" className="bg-black/65 backdrop-blur-sm border border-edge-2 rounded-md p-1.5 text-mute hover:text-text" title="Zoom in" aria-label="Zoom in"
                  onClick={() => setView((v) => zoomStep(v, 1.3))}><ZoomIn size={14} /></button>
                <button type="button" className="bg-black/65 backdrop-blur-sm border border-edge-2 rounded-md p-1.5 text-mute hover:text-text" title="Zoom out" aria-label="Zoom out"
                  onClick={() => setView((v) => zoomStep(v, 1 / 1.3))}><ZoomOut size={14} /></button>
              </div>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 px-3.5 pb-3.5">
            <Field label="Opponent (optional)"><input className="input" value={board.opponent}
              onChange={(e) => { setBoard({ ...board, opponent: e.target.value }); setDirty(true); }} /></Field>
            <Field label="Notes / win condition"><input className="input" value={board.notes}
              onChange={(e) => { setBoard({ ...board, notes: e.target.value }); setDirty(true); }} /></Field>
          </div>
        </div>

        <div className="card p-4 lg:sticky lg:top-6">
          <div className="label mb-2.5">Place a hero</div>
          <div className="flex gap-1.5 mb-3">
            {(["ours", "theirs", "neutral"] as Side[]).map((s) => <button key={s}
              className={`chip !cursor-pointer uppercase !text-[9.5px] ${newSide === s ? (s === "ours" ? "text-leaf border-leaf/50 bg-leaf/10" : s === "theirs" ? "text-crim border-crim/50 bg-crim/10" : "text-amber border-amber/50 bg-amber/10") : "text-faint border-edge"}`}
              onClick={() => setNewSide(s)}>{s === "ours" ? "9 CLOVER" : s === "theirs" ? "ENEMY" : "NEUTRAL"}</button>)}
          </div>
          <input className="input mb-3 !py-2" placeholder="Search 135 heroes…" value={heroQ} onChange={(e) => setHeroQ(e.target.value)} />
          <div className="grid grid-cols-5 gap-2 max-h-[26rem] overflow-y-auto pr-1">
            {filteredHeroes.map((h) => <button key={h.id} onClick={() => addToken(h.name)}
              className="flex flex-col items-center gap-1 p-1 rounded-md hover:bg-raised transition-colors"
              title={`${h.name} · ${h.meta_status} · WR ${h.win_rate}% — add as ${newSide}`}>
              <span className="relative"><HeroImg name={h.name} size={36} className="rounded-md" />
                {(h.meta_status === "META" || h.meta_status === "STRONG") && <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-ink ${h.meta_status === "META" ? "bg-crim" : "bg-leaf"}`} />}
              </span><span className="text-[8.5px] font-semibold leading-tight text-center w-full truncate">{h.name}</span>
            </button>)}
            {filteredHeroes.length === 0 && <div className="col-span-5 text-xs text-faint py-4 text-center">—</div>}
          </div>
          <div className="text-[10px] text-faint mt-3 leading-relaxed border-t border-edge/60 pt-2.5">
            Select a marker in Drag to resize or remove it. Steps, chips, drawings and positions save together with the board.
          </div>
        </div>
      </div>
    </div>
  );
}
