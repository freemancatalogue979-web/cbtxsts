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
