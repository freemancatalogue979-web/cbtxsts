/**
 * Map Lab recordings: capture how markers move on a board over time, replay them and turn them into video.
 *
 * A take stores every marker once (`markers`), every distinct set of drawings once (`drawings`) and a
 * list of light frames: the time, each visible marker's position and which drawing set was showing.
 * Pure functions only (no DOM), so the whole thing is unit tested.
 */
import type { MapChip, MapStep, MapToken, MapZone } from "./types";

export type DrawPath = { color: string; points: number[][]; mode?: "arrow" | "free" };
export interface BoardState { tokens: MapToken[]; chips: MapChip[]; paths: DrawPath[]; steps: MapStep[]; zones: MapZone[] }

export type RecMarker =
  | { kind: "hero"; hero: string; side: MapToken["side"]; size?: number }
  | { kind: "chip"; name: string; color: string; size: number; preset?: MapChip["preset"]; hideName?: boolean };
export interface RecDrawing { paths: DrawPath[]; steps: MapStep[]; zones: MapZone[] }
/** t: ms from the start · p: id → [x, y] for markers on the map · d: index into drawings. */
export interface RecFrame { t: number; p: Record<string, [number, number]>; d: number }
export interface MapRecording {
  id: string; name: string; created_at: string; duration: number;
  markers: Record<string, RecMarker>; drawings: RecDrawing[]; frames: RecFrame[];
}

export const REC_FPS = 8;
export const REC_MAX_MS = 5 * 60_000;
export const REC_MAX_TAKES = 12;

const r1 = (n: number) => Math.round(n * 10) / 10;

function markerOf(item: MapToken | MapChip): RecMarker {
  return "hero" in item
    ? { kind: "hero", hero: item.hero, side: item.side, ...(item.size ? { size: item.size } : {}) }
    : { kind: "chip", name: item.name, color: item.color, size: item.size, ...(item.preset ? { preset: item.preset } : {}), ...(item.hideName ? { hideName: true } : {}) };
}

const drawingKey = (d: RecDrawing) => JSON.stringify(d);

export function startRecording(id: string, name: string, now: Date = new Date()): MapRecording {
  return { id, name, created_at: now.toISOString(), duration: 0, markers: {}, drawings: [], frames: [] };
}

/** Add a frame at time t (ms). Unchanged boards only move the end time, so a still board costs nothing. */
export function addFrame(rec: MapRecording, state: BoardState, t: number): MapRecording {
  if (t > REC_MAX_MS) return rec;
  const markers = { ...rec.markers };
  const p: Record<string, [number, number]> = {};
  for (const item of [...state.tokens, ...state.chips]) {
    markers[item.id] = markerOf(item);
    p[item.id] = [r1(item.x), r1(item.y)];
  }
  const drawing: RecDrawing = { paths: state.paths, steps: state.steps, zones: state.zones };
  const last = rec.frames[rec.frames.length - 1];
  const prev = last ? rec.drawings[last.d] : undefined;
  // Fast path: the editor keeps the same arrays while nothing is drawn, so most ticks skip the compare.
  let d = prev && prev.paths === drawing.paths && prev.steps === drawing.steps && prev.zones === drawing.zones ? last!.d : -1;
  if (d < 0) {
    const key = drawingKey(drawing);
    d = rec.drawings.findIndex((x) => drawingKey(x) === key);
  }
  const drawings = d >= 0 ? rec.drawings : [...rec.drawings, drawing];
  if (d < 0) d = drawings.length - 1;
  const time = Math.max(0, Math.round(t));
  if (last && last.d === d && JSON.stringify(last.p) === JSON.stringify(p)) {
    return { ...rec, markers, drawings, duration: Math.max(rec.duration, time) };
  }
  return { ...rec, markers, drawings, frames: [...rec.frames, { t: time, p, d }], duration: Math.max(rec.duration, time) };
}

export interface ReplayState {
  heroes: { id: string; hero: string; side: MapToken["side"]; size?: number; x: number; y: number }[];
  chips: { id: string; name: string; color: string; size: number; preset?: MapChip["preset"]; hideName?: boolean; x: number; y: number }[];
  drawing: RecDrawing;
}

const ease = (k: number) => k * k * (3 - 2 * k);

/** Board at time t: markers glide between frames, drawings switch at their frame. */
export function frameAt(rec: MapRecording, t: number): ReplayState {
  const empty: RecDrawing = { paths: [], steps: [], zones: [] };
  if (!rec.frames.length) return { heroes: [], chips: [], drawing: empty };
  let i = 0;
  while (i + 1 < rec.frames.length && rec.frames[i + 1].t <= t) i++;
  const a = rec.frames[i];
  const b = rec.frames[i + 1];
  // Glide over at most 600ms before the next frame, so a long still stretch doesn't drift.
  const span = b ? Math.min(b.t - a.t, 600) : 0;
  const k = b && span > 0 ? ease(Math.max(0, Math.min(1, (t - (b.t - span)) / span))) : 0;
  const out: ReplayState = { heroes: [], chips: [], drawing: rec.drawings[a.d] ?? empty };
  for (const [id, [ax, ay]] of Object.entries(a.p)) {
    const m = rec.markers[id];
    if (!m) continue;
    const to = b?.p[id];
    const x = to ? ax + (to[0] - ax) * k : ax;
    const y = to ? ay + (to[1] - ay) * k : ay;
    if (m.kind === "hero") out.heroes.push({ id, hero: m.hero, side: m.side, size: m.size, x, y });
    else out.chips.push({ id, name: m.name, color: m.color, size: m.size, preset: m.preset, hideName: m.hideName, x, y });
  }
  return out;
}

/** Recent movement of each hero up to time t (oldest first, ending where the hero is now). */
export function trailsAt(rec: MapRecording, t: number, windowMs = 4000): { id: string; side: MapToken["side"]; points: [number, number][] }[] {
  const now = frameAt(rec, t);
  return now.heroes.map((h) => {
    const points: [number, number][] = [];
    for (const f of rec.frames) {
      if (f.t > t) break;
      if (f.t < t - windowMs) continue;
      const p = f.p[h.id];
      if (p && (!points.length || points[points.length - 1][0] !== p[0] || points[points.length - 1][1] !== p[1])) points.push(p);
    }
    points.push([h.x, h.y]);
    return { id: h.id, side: h.side, points };
  }).filter((trail) => trail.points.length > 1);
}

/** Drop bad input from saved data (old boards, hand edits) instead of crashing the player. */
export function cleanRecordings(value: unknown): MapRecording[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is MapRecording => !!r && typeof r === "object"
    && typeof (r as MapRecording).id === "string" && Array.isArray((r as MapRecording).frames)
    && Array.isArray((r as MapRecording).drawings) && typeof (r as MapRecording).markers === "object")
    .slice(-REC_MAX_TAKES);
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** First video format this browser can record (MP4 where supported, else WebM). */
export function pickVideoType(isSupported: (type: string) => boolean): { mime: string; ext: "mp4" | "webm" } | null {
  for (const mime of ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    try { if (isSupported(mime)) return { mime, ext: mime.startsWith("video/mp4") ? "mp4" : "webm" }; } catch { /* keep looking */ }
  }
  return null;
}
