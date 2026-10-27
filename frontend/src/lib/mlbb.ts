/**
 * MLBB Intel client — calls OUR backend proxy (/api/intel/*), which fronts the
 * community Rone Arena API (arena.rone.dev). Verified envelope:
 *   { code: 0, message: "OK", data: {...}, traceID }
 * Ranking/list rows live in data.records[].data.
 *
 * Rates upstream are FRACTIONS (0.506 == 50.6%).
 */
import { api } from "./api";

export interface Envelope<T> { code: number; message?: string; data?: T }

export interface Records<T> { records?: { data: T }[]; total?: number }

export interface RankRecord {
  main_heroid: number;
  main_hero_win_rate: number;
  main_hero_appearance_rate: number; // pick rate
  main_hero_ban_rate: number;
  main_hero?: { data?: { name?: string; head?: string } };
}

export interface IntelHero {
  hero_id: number;
  hero?: { data?: { name?: string; head?: string; smallmap?: string } };
  relation?: {
    assist?: { target_hero_id?: number[] };
    strong?: { target_hero_id?: number[] };
    weak?: { target_hero_id?: number[] };
  };
}

const mem = new Map<string, { t: number; data: unknown }>();

export async function intel<T>(path: string, params: Record<string, string | number | undefined> = {}, ttlMs = 60_000): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const suffix = qs.toString() ? `${path}?${qs.toString()}` : path;
  const hit = mem.get(suffix);
  if (hit && hit.t > Date.now()) return hit.data as T;
  const env = await api.get<Envelope<T>>(`/intel/${suffix}`);
  if (env.code !== 0 || env.data === undefined) {
    throw new Error(env.message || `Data service error (code ${env.code ?? "?"})`);
  }
  mem.set(suffix, { t: Date.now() + ttlMs, data: env.data });
  return env.data;
}

export const rankRecords = (d?: Records<RankRecord>) => (d?.records ?? []).map((r) => r.data);
export const heroRecords = (d?: Records<IntelHero>) => (d?.records ?? []).map((r) => r.data);
export const pct = (fraction?: number) => fraction === undefined ? "—" : `${(fraction * 100).toFixed(1)}%`;
export const fraction = (f?: number) => (f === undefined ? 0 : f * 100);

export const RANK_DAYS = [1, 3, 7, 15, 30] as const;
export const RANK_TIERS = ["all", "epic", "legend", "mythic", "honor", "glory"] as const;

/* ---------------- official CDN artwork index ----------------
 * head     — square portrait (heroes list)
 * art      — large/skin artwork (wallpapers endpoint, mobile crop preferred)
 * Primed once per session; components re-render via version bump. */

export interface WallpaperRecord { heroid?: number[]; pictures?: { resolution?: string; url?: string }[] }

let artMap: Map<string, { head?: string; art?: string }> | null = null;
let artLoading: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function subscribeArt(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const artVersion = () => version;

export function ensureArtIndex(): void {
  if (artLoading) return;
  artLoading = (async () => {
    try {
      const [heroList, walls] = await Promise.all([
        intel<Records<IntelHero>>("heroes", { size: 300, index: 1, order: "asc" }, 30 * 60_000),
        intel<Records<WallpaperRecord>>("heroes/wallpapers", { device: "mobile", size: 300, index: 1 }, 30 * 60_000).catch(() => null),
      ]);
      const list = heroRecords(heroList);
      const nameById = new Map(list.map((h) => [h.hero_id, h.hero?.data?.name ?? ""]));
      const wallById = new Map<number, string>();
      if (walls) {
        for (const r of walls.records ?? []) {
          const hid = r.data?.heroid?.[0];
          if (!hid || wallById.has(hid)) continue;
          const pics = r.data?.pictures ?? [];
          const pick = pics.find((p) => p.resolution === "1080x1920") ?? pics.find((p) => (p.resolution ?? "").startsWith("1080")) ?? pics[0];
          if (pick?.url) wallById.set(hid, pick.url);
        }
      }
      artMap = new Map();
      for (const h of list) {
        const name = h.hero?.data?.name;
        if (!name) continue;
        artMap.set(name.toLowerCase(), { head: h.hero?.data?.head, art: wallById.get(h.hero_id) });
      }
    } catch {
      artMap = new Map(); // offline/unreachable — local fallbacks apply
    }
    version++;
    listeners.forEach((f) => f());
  })();
}

export interface HeroArt { head?: string; art?: string }
export const artFor = (name: string): HeroArt | undefined => artMap?.get(name.toLowerCase());

/* ---------------- account link (per-user, backend-held tokens) ---------------- */

export interface LinkStatus { linked: boolean; name?: string; avatar?: string; role_id?: number; zone_id?: number; linked_at?: string | null }

export const linkStatus = () => api.get<LinkStatus>("/intel/account/status");
export const sendLinkCode = (role_id: number, zone_id: number) =>
  api.post<{ sent: boolean; hint: string }>("/intel/account/send-code", { role_id, zone_id });
export const connectLink = (role_id: number, zone_id: number, vc: string) =>
  api.post<{ linked: boolean; name: string }>("/intel/account/connect", { role_id, zone_id, vc });
export const disconnectLink = () => api.post<{ linked: boolean }>("/intel/account/disconnect", {});
export const accountProfile = () => api.get<Record<string, unknown>>("/intel/account/profile");
export const accountMatches = (index = 1, size = 20) =>
  api.get<Record<string, unknown>>(`/intel/account/matches?index=${index}&size=${size}`);
export const accountHeroes = () => api.get<Record<string, unknown>>("/intel/account/heroes");

/** Endpoints that don't use the {code} envelope (e.g. addon tools) — passthrough. */
export async function intelRaw<T = Record<string, unknown>>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const suffix = qs.toString() ? `${path}?${qs.toString()}` : path;
  return api.get<T>(`/intel/${suffix}`);
}

/* defensive record reading — the community API's field sets vary by endpoint */
export type AnyRec = Record<string, unknown>;
export const recData = <T extends AnyRec>(r: unknown): T[] => {
  const d = (r as { data?: { records?: { data?: T }[] } })?.data?.records;
  return Array.isArray(d) ? d.map((x) => (x?.data ?? {}) as T).filter((x) => Object.keys(x).length > 0) : [];
};
export const pickStr = (o: AnyRec | undefined, ...keys: string[]): string | undefined => {
  for (const k of keys) { const v = o?.[k]; if (typeof v === "string" && v.trim()) return v; }
  return undefined;
};
export const pickNum = (o: AnyRec | undefined, ...keys: string[]): number | undefined => {
  for (const k of keys) { const v = o?.[k]; if (typeof v === "number" && Number.isFinite(v)) return v; }
  return undefined;
};
export const stripTags = (s: string): string => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
