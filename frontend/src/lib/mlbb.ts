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
 * head     — square portrait (academy catalog)
 * art      — tall rectangular splash (academy catalog `painting`; wallpapers endpoint fallback)
 * Primed once per session; components re-render via version bump. */

export interface WallpaperRecord { heroid?: number[]; pictures?: { resolution?: string; url?: string }[] }
interface CatalogRec { data?: { hero_id?: number; hero_name?: string; name?: string; head?: string; head_big?: string; painting?: string } }

let artMap: Map<string, { id?: number; head?: string; art?: string }> | null = null;
let artLoading: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function subscribeArt(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const artVersion = () => version;

export function ensureArtIndex(): void {
  if (artLoading) return;
  artLoading = (async () => {
    try {
      const [catalog, walls] = await Promise.all([
        intel<Records<CatalogRec>>("academy/heroes/catalog", { size: 300, index: 1 }, 30 * 60_000),
        intel<Records<WallpaperRecord>>("heroes/wallpapers", { device: "mobile", size: 300, index: 1 }, 30 * 60_000).catch(() => null),
      ]);
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
      const map = new Map<string, { id?: number; head?: string; art?: string }>();
      for (const r of catalog.records ?? []) {
        const d: CatalogRec["data"] = r.data ?? {};
        const name = d.hero_name ?? d.name;
        if (!name) continue;
        map.set(name.toLowerCase(), {
          id: d.hero_id,
          head: d.head ?? d.head_big,
          art: d.painting || wallById.get(d.hero_id ?? 0), // rectangular splash painting first
        });
      }
      artMap = map;
    } catch {
      artMap = new Map(); // offline/unreachable — local fallbacks apply
    }
    version++;
    listeners.forEach((f) => f());
  })();
}

export interface HeroArt { id?: number; head?: string; art?: string }
export const artFor = (name: string): HeroArt | undefined => artMap?.get(name.toLowerCase());
export const heroIdFor = (name: string): number | undefined => artMap?.get(name.toLowerCase())?.id;

/** Community hero guide (academy/recommended) for one hero — locate its list row by
 * hero_id, then fetch the detail. Returns the inner payload: { hero: { hero_overview,
 * hero_strength, hero_weakness }, cooperates, counters, equips, emblems, spell… } */
export async function guideForHero(heroId: number): Promise<AnyRec | null> {
  const list = await intel<Records<AnyRec>>("academy/recommended", { size: 60, index: 1 }, 10 * 60_000);
  const rec = (list.records ?? []).find((r) => {
    const inner = (r.data as AnyRec | undefined)?.data as AnyRec | undefined;
    const hero = (inner?.hero ?? {}) as AnyRec;
    return pickNum(hero, "hero_id") === heroId || pickNum(inner ?? {}, "hero_id") === heroId;
  });
  const gid = (rec as { id?: number } | undefined)?.id;
  if (gid === undefined) return null;
  const detail = await intel<Records<AnyRec>>(`academy/recommended/${gid}`, { lang: "en" }, 30 * 60_000);
  const first = (detail.records ?? [])[0];
  const inner = ((first as unknown as AnyRec | undefined)?.data ?? null) as AnyRec | null;
  return ((inner?.data ?? inner) ?? null) as AnyRec | null;
}

/** Recursive fallback extractor: some Rone payloads aren't `records`-shaped (emblem/spell
 * records nest under custom keys). Walk the envelope data and return the FIRST array of
 * objects we find (depth-limited, records/list/rows preferred at each level). */
export function digRecords(x: unknown, depth = 0): AnyRec[] {
  if (depth > 6 || x == null) return [];
  if (Array.isArray(x)) return x.length && typeof x[0] === "object" && x[0] !== null ? (x as AnyRec[]) : [];
  if (typeof x !== "object") return [];
  const o = x as AnyRec;
  for (const k of ["records", "list", "rows", "items"]) {
    const v = digRecords(o[k], depth + 1);
    if (v.length) return v;
  }
  for (const v of Object.values(o)) {
    const r = digRecords(v, depth + 1);
    if (r.length) return r;
  }
  return [];
}

export interface LinkSummary {
  linked: boolean; name?: string; avatar?: string; role_id?: number; zone_id?: number;
  level?: number | null; rank_level?: number | null; linked_at?: string | null; user_id?: number;
}
export function linkedRoster(): Promise<LinkSummary[]> {
  return api.get<{ linked?: LinkSummary[] }>("/intel/linked").then((d) => d.linked ?? []);
}
export const linkOf = (userId: number): Promise<LinkSummary> =>
  api.get<LinkSummary>(`/intel/account/of/${userId}`);

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
