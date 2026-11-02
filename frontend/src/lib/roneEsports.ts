/** Defensive normalization for Rone's public MPL feeds.
 * Schedule uses weeks[].days[], while playoffs uses days[], seeds and an
 * optional bracket_image. Missing values remain unknown, never zero-filled.
 */
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const objects = (value: unknown): RecordValue[] => Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map(record) : [];
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
export function roneNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Rone currently returns its images through these public hosts. Never turn an
 * arbitrary source-provided URL into a browser request, and never send a referrer. */
export function roneImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    return ["wsrv.nl", "ik.imagekit.io", "arena.rone.dev"].includes(url.hostname.toLowerCase()) ? url.href : null;
  } catch { return null; }
}

export function roneLinkUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export interface RoneTeam { name: string; fullName: string | null; logo: string | null }
export interface RoneMatch {
  id: string | null; team1: RoneTeam; team2: RoneTeam; score1: number | null; score2: number | null;
  status: string; winner: "team1" | "team2" | null; startsAt: string | null; localTime: string | null;
  bestOf: number | null; round: string | null; replay: string | null;
}
export interface RoneMatchGroup { key: string; week: number | null; label: string; matches: RoneMatch[] }
export interface RoneStanding {
  rank: number | null; team: RoneTeam; points: number | null; matchWins: number | null; matchLosses: number | null;
  gameWins: number | null; gameLosses: number | null; netGames: number | null;
}
export interface RoneSeed { seed: number | null; team: RoneTeam; wins: number | null; losses: number | null }
export interface RoneFeed { groups: RoneMatchGroup[]; standings: RoneStanding[]; seeds: RoneSeed[]; bracketImage: string | null }

export function roneTeam(value: unknown): RoneTeam {
  if (typeof value === "string") return { name: text(value) || "TBD", fullName: null, logo: null };
  const row = record(value);
  const name = text(row.name) || text(row.team_name) || text(row.full_name) || "TBD";
  return { name, fullName: text(row.full_name) || text(row.team_name), logo: roneImageUrl(row.logo) };
}

export function roneMatch(value: unknown): RoneMatch {
  const row = record(value);
  const rawId = typeof row.match_id === "number" && Number.isFinite(row.match_id) ? String(row.match_id) : text(row.match_id);
  const id = rawId && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(rawId) ? rawId : null;
  const winner = row.winner === "team1" || row.winner === "team2" ? row.winner : null;
  return { id, team1: roneTeam(row.team1 ?? row.home ?? row.team_a), team2: roneTeam(row.team2 ?? row.away ?? row.team_b),
    score1: roneNumber(row.score1), score2: roneNumber(row.score2), status: text(row.status) || "unknown", winner,
    startsAt: text(row.start_at), localTime: text(row.local_time), bestOf: roneNumber(row.best_of),
    round: text(row.round), replay: roneLinkUrl(row.replay_url) };
}

function dayGroups(days: unknown, week: number | null, prefix: string): RoneMatchGroup[] {
  return objects(days).map((day, index) => ({
    key: `${prefix}-${index}`, week, label: text(day.label) || (roneNumber(day.day) !== null ? `Day ${roneNumber(day.day)}` : "Date TBC"),
    matches: objects(day.matches).map(roneMatch),
  })).filter((group) => group.matches.length > 0);
}

export function parseRoneFeed(payload: unknown): RoneFeed {
  const outer = record(payload);
  const root = outer.data && typeof outer.data === "object" && !Array.isArray(outer.data) ? record(outer.data) : outer;
  let groups: RoneMatchGroup[] = [];
  if (Array.isArray(root.weeks)) {
    groups = objects(root.weeks).flatMap((week, index) => dayGroups(week.days, roneNumber(week.week), `week-${index}`));
  } else if (Array.isArray(root.days)) {
    groups = dayGroups(root.days, null, "playoff-day");
  } else {
    const raw = Array.isArray(payload) ? payload : Array.isArray(root.matches) ? root.matches : Array.isArray(root.schedule) ? root.schedule : [];
    const matches = objects(raw).map(roneMatch);
    if (matches.length) groups = [{ key: "matches", week: null, label: "Matches", matches }];
  }
  const standings = objects(root.standings).map((row) => {
    const match = record(row.match_wl), game = record(row.game_wl);
    return { rank: roneNumber(row.rank), team: roneTeam(row.team), points: roneNumber(row.match_point),
      matchWins: roneNumber(match.win), matchLosses: roneNumber(match.lose), gameWins: roneNumber(game.win),
      gameLosses: roneNumber(game.lose), netGames: roneNumber(row.net_game_win) };
  });
  const seeds = objects(root.seeds).map((row) => {
    const match = record(row.match_wl);
    return { seed: roneNumber(row.seed), team: roneTeam(row.team), wins: roneNumber(match.win), losses: roneNumber(match.lose) };
  });
  return { groups, standings, seeds, bracketImage: roneImageUrl(root.bracket_image) };
}

export interface RoneItem { id: string; image: string | null }
export interface RonePlayer {
  name: string; hero: string | null; kills: number | null; deaths: number | null; assists: number | null;
  gold: number | null; damageDealt: number | null; damageTaken: number | null; towerDamage: number | null; items: RoneItem[];
}
export interface RoneGameTeam {
  team: RoneTeam; kills: number | null; gold: number | null; turtles: number | null; lords: number | null;
  towers: number | null; players: RonePlayer[];
}
export interface RoneGame { number: number | null; duration: string | null; durationEstimated: boolean; teams: RoneGameTeam[] }

export function parseRoneGames(payload: unknown): RoneGame[] {
  const outer = record(payload);
  const root = outer.data && typeof outer.data === "object" && !Array.isArray(outer.data) ? record(outer.data) : outer;
  return objects(root.games).map((game) => {
    const actualDuration = text(game.duration);
    return { number: roneNumber(game.number), duration: actualDuration || text(game.duration_estimate),
      durationEstimated: !actualDuration && Boolean(text(game.duration_estimate)),
      teams: objects(game.teams).map((side) => {
        const stats = record(side.stats);
        return { team: roneTeam(side.team), kills: roneNumber(side.kills), gold: roneNumber(stats.total_gold),
          turtles: roneNumber(stats.tortoise_kill), lords: roneNumber(stats.lord_kill), towers: roneNumber(stats.tower_destroy),
          players: objects(side.players).map((player) => ({ name: text(player.name) || "Unknown player", hero: text(record(player.hero).name),
            kills: roneNumber(player.kills), deaths: roneNumber(player.deaths), assists: roneNumber(player.assists), gold: roneNumber(player.gold),
            damageDealt: roneNumber(player.damage_dealt), damageTaken: roneNumber(player.damage_taken), towerDamage: roneNumber(player.tower_damage),
            items: objects(player.items).map((item) => ({ id: text(item.id) || (roneNumber(item.id) !== null ? String(item.id) : "Unknown"), image: roneImageUrl(item.image) })) })) };
      }) };
  });
}
