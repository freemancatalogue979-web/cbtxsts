/**
 * Turn a Map Lab take into a video file: draw every frame on a hidden canvas (map, zones, drawings,
 * movement trails, chips/holograms, heroes) and record it with the browser's MediaRecorder.
 * Only same-origin pictures are used so the canvas never becomes "tainted" (which would block recording).
 */
import { heroHead, heroOfficial } from "./mlbb";
import { frameAt, pickVideoType, trailsAt, type MapRecording, type ReplayState } from "./mapRecording";
import type { MapChipPreset, MapStep, MapToken } from "./types";
import type { HoloEngine } from "../components/MapHologram";

export const VIDEO_WIDTH = 1280;
const HOLO_SCALE = 1.7;
const HOLO_BASE = 0.855;
const SIDE_COLOR: Record<MapToken["side"], string> = { ours: "#34d399", theirs: "#fb7185", neutral: "#fbbf24" };
const FONT = '"Courier New", Courier, ui-monospace, monospace';

export interface VideoOptions {
  title: string;
  mapSrc: string;
  aspect: number;
  speed: number;
  chipNames: boolean;
  heroNames: boolean;
  holo: HoloEngine | null;
  onProgress?: (share: number) => void;
  signal?: { cancelled: boolean };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function firstImage(srcs: string[]): Promise<HTMLImageElement | null> {
  for (const src of srcs) {
    const img = await loadImage(src);
    if (img) return img;
  }
  return null;
}

interface Pictures { map: HTMLImageElement | null; heroes: Map<string, HTMLImageElement | null>; chips: Map<string, HTMLImageElement | null> }

async function loadPictures(rec: MapRecording, mapSrc: string): Promise<Pictures> {
  const heroNames = new Set<string>();
  const presets = new Set<string>();
  for (const m of Object.values(rec.markers)) {
    if (m.kind === "hero") heroNames.add(m.hero);
    else if (m.preset) presets.add(m.preset);
  }
  const [map, heroes, chips] = await Promise.all([
    loadImage(mapSrc),
    Promise.all([...heroNames].map(async (name) => [name, await firstImage([heroHead(name), heroOfficial(name, "head")])] as const)),
    Promise.all([...presets].map(async (id) => [id, await loadImage(`/map-chips/${id}.webp`)] as const)),
  ]);
  return { map, heroes: new Map(heroes), chips: new Map(chips) };
}

const initials = (name: string) => name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

function roundPicture(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, r: number, fill: string, label: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.clip();
  if (img) ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  else {
    ctx.fillStyle = "#fff";
    ctx.font = `900 ${Math.round(r * 0.75)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(label), x, y);
  }
  ctx.restore();
}

function nameTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number) {
  if (!text) return;
  ctx.save();
  ctx.font = `700 ${Math.round(11 * scale)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = text.length > 18 ? `${text.slice(0, 17)}…` : text;
  const w = ctx.measureText(label).width + 10 * scale, h = 16 * scale;
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y, w, h, 3 * scale);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(label, x, y + h / 2 + 0.5);
  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, pts: number[][], color: string, width: number, head: boolean, headSize: number) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  if (head) {
    const [x2, y2] = pts[pts.length - 1];
    let prev = pts[pts.length - 2];
    for (let i = pts.length - 2; i >= 0; i--) { prev = pts[i]; if (Math.hypot(x2 - prev[0], y2 - prev[1]) > 2) break; }
    const a = Math.atan2(y2 - prev[1], x2 - prev[0]);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 + Math.cos(a + Math.PI + 0.55) * headSize, y2 + Math.sin(a + Math.PI + 0.55) * headSize);
    ctx.lineTo(x2 + Math.cos(a + Math.PI - 0.55) * headSize, y2 + Math.sin(a + Math.PI - 0.55) * headSize);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function stepPoints(step: MapStep, state: ReplayState): number[][] {
  const steps = state.drawing.steps;
  const parent = step.parentId ? steps.find((s) => s.id === step.parentId) : undefined;
  const token = step.tokenId ? state.heroes.find((t) => t.id === step.tokenId) : undefined;
  const chip = step.chipId ? state.chips.find((c) => c.id === step.chipId) : undefined;
  const parentEnd = parent?.points[parent.points.length - 1];
  const start = parentEnd ?? (token ? [token.x, token.y] : chip ? [chip.x, chip.y] : step.points[0]);
  return start ? [start, ...step.points.slice(1)] : [];
}

/** Paint the board at time t (ms) onto ctx. Exported for tests and for a still "poster" frame. */
export function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, rec: MapRecording, t: number, pics: Pictures, opts: VideoOptions) {
  const state = frameAt(rec, t);
  const s = W / 1000;
  const X = (x: number) => (x / 100) * W;
  const Y = (y: number) => (y / 100) * H;

  ctx.clearRect(0, 0, W, H);
  if (pics.map) ctx.drawImage(pics.map, 0, 0, W, H);
  else {
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(125,181,245,0.12)";
    for (let gx = 0; gx <= W; gx += W / 20) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (let gy = 0; gy <= H; gy += H / 10) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
  }
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  for (const z of state.drawing.zones) {
    const token = z.tokenId ? state.heroes.find((h) => h.id === z.tokenId) : undefined;
    const chip = z.chipId ? state.chips.find((c) => c.id === z.chipId) : undefined;
    const [cx, cy] = token ? [token.x, token.y] : chip ? [chip.x, chip.y] : [z.x, z.y];
    ctx.save();
    ctx.beginPath();
    ctx.arc(X(cx), Y(cy), (z.radius / 100) * H, 0, Math.PI * 2);
    ctx.fillStyle = z.color;
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 2.5 * s;
    ctx.stroke();
    ctx.restore();
  }
  const head = (2.6 / 100) * H;
  for (const p of state.drawing.paths) {
    line(ctx, p.points.map(([x, y]) => [X(x), Y(y)]), p.color, 4 * s, p.mode ? p.mode === "arrow" : p.points.length === 2, head);
  }
  for (const st of state.drawing.steps) line(ctx, stepPoints(st, state).map(([x, y]) => [X(x), Y(y)]), st.color, 4 * s, true, head);

  // Movement trails: where each hero has been in the last few seconds.
  for (const trail of trailsAt(rec, t)) {
    const pts = trail.points.map(([x, y]) => [X(x), Y(y)]);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 1; i < pts.length; i++) {
      ctx.globalAlpha = 0.15 + 0.7 * (i / pts.length);
      ctx.strokeStyle = SIDE_COLOR[trail.side];
      ctx.lineWidth = 5 * s;
      ctx.setLineDash([2 * s, 7 * s]);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
      ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const st of state.drawing.steps) {
    const end = st.points[st.points.length - 1];
    if (!end) continue;
    const r = 13 * s;
    ctx.save();
    ctx.beginPath();
    ctx.arc(X(end[0]), Y(end[1]), r, 0, Math.PI * 2);
    ctx.fillStyle = st.color;
    ctx.fill();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
    ctx.fillStyle = "#111116";
    ctx.font = `900 ${Math.round(12 * s)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(st.number), X(end[0]), Y(end[1]) + 0.5);
    ctx.restore();
  }

  const seconds = t / 1000;
  for (const c of state.chips) {
    const r = (c.size / 2) * s, x = X(c.x), y = Y(c.y);
    if (opts.holo && c.preset) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, /^#[\da-f]{6}$/i.test(c.color) ? `${c.color}88` : "rgba(125,249,255,0.5)");
      glow.addColorStop(1, "rgba(4,9,18,0.9)");
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.shadowColor = c.color;
      ctx.shadowBlur = 14 * s;
      ctx.fill();
      ctx.restore();
      const px = c.size * s * HOLO_SCALE;
      ctx.drawImage(opts.holo.render(c.preset as MapChipPreset, c.color, seconds), x - px / 2, y - px * HOLO_BASE, px, px);
    } else {
      roundPicture(ctx, c.preset ? pics.chips.get(c.preset) ?? null : null, x, y, r, c.color, c.name);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.lineWidth = 2.5 * s;
      ctx.strokeStyle = c.color;
      ctx.stroke();
      ctx.restore();
    }
    if (opts.chipNames && !c.hideName) nameTag(ctx, c.name || "Chip", x, y + r + 4 * s, s);
  }

  for (const h of state.heroes) {
    const r = ((h.size ?? 44) / 2) * s, x = X(h.x), y = Y(h.y);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 12 * s;
    ctx.beginPath();
    ctx.arc(x, y, r + 2.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = SIDE_COLOR[h.side];
    ctx.fill();
    ctx.restore();
    roundPicture(ctx, pics.heroes.get(h.hero) ?? null, x, y, r, "#151b26", h.hero);
    if (opts.heroNames) nameTag(ctx, h.hero, x, y + r + 5 * s, s);
  }

  // Title and clock.
  ctx.save();
  ctx.font = `700 ${Math.round(15 * s)}px ${FONT}`;
  ctx.textBaseline = "top";
  const title = opts.title.length > 60 ? `${opts.title.slice(0, 59)}…` : opts.title;
  const tw = ctx.measureText(title).width;
  ctx.fillStyle = "rgba(5,8,14,0.72)";
  ctx.beginPath();
  ctx.roundRect(12 * s, 12 * s, tw + 20 * s, 26 * s, 5 * s);
  ctx.fill();
  ctx.fillStyle = "#f2f4f8";
  ctx.fillText(title, 22 * s, 18 * s);
  const clock = `${fmt(t)} / ${fmt(rec.duration)}`;
  ctx.textAlign = "right";
  const cw = ctx.measureText(clock).width;
  ctx.fillStyle = "rgba(5,8,14,0.72)";
  ctx.beginPath();
  ctx.roundRect(W - cw - 32 * s, H - 38 * s, cw + 20 * s, 26 * s, 5 * s);
  ctx.fill();
  ctx.fillStyle = "#7df9ff";
  ctx.fillText(clock, W - 22 * s, H - 32 * s);
  ctx.restore();
}

function fmt(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function canRecordVideo(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined"
    && "captureStream" in HTMLCanvasElement.prototype
    && !!pickVideoType((type) => MediaRecorder.isTypeSupported(type));
}

/** Play the take onto a hidden canvas in real time (divided by speed) and return the video file. */
export async function renderVideo(rec: MapRecording, opts: VideoOptions): Promise<{ blob: Blob; ext: string }> {
  const type = pickVideoType((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error("This browser can't make video files. Try Chrome, Edge or a recent Safari.");
  const W = VIDEO_WIDTH;
  const H = Math.round(W / opts.aspect / 2) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not start the video canvas.");
  const pics = await loadPictures(rec, opts.mapSrc);
  drawFrame(ctx, W, H, rec, 0, pics, opts);

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start(250);

  const hold = 900; // show the last frame for a moment
  const total = rec.duration / opts.speed + hold;
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    // setTimeout keeps going (slower) in a background tab where requestAnimationFrame would stop.
    const tick = () => {
      const elapsed = performance.now() - t0;
      drawFrame(ctx, W, H, rec, Math.min(rec.duration, elapsed * opts.speed), pics, opts);
      opts.onProgress?.(Math.min(1, elapsed / total));
      if (elapsed >= total || opts.signal?.cancelled) resolve();
      else setTimeout(tick, 1000 / 30);
    };
    tick();
  });
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  if (opts.signal?.cancelled) throw new Error("cancelled");
  return { blob: new Blob(chunks, { type: type.mime.split(";")[0] }), ext: type.ext };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
