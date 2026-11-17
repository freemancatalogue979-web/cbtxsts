export type SourceStatus = "disabled" | "syncing" | "unavailable" | "stale" | "fresh" | "waiting";
export interface EsportsSource {
  status: SourceStatus; enabled: boolean; phase: string; last_attempt_at: string | null;
  last_success_at: string | null; last_error: string | null; refresh_seconds: number;
  series_count: number; league_count: number; match_count: number; draft_events: number; ai_configured: boolean;
}
export interface EsportsSeries { id: string; code: string; name: string; region: string; kind: string; logo: string | null; latest_league_id: string | null }
export interface EsportsLeague {
  id: string; series_id: string; code: string; name: string; region: string; logo: string | null;
  starts_at: string | null; ends_at: string | null; is_latest: boolean; matches_fetched_at: string | null; matches_error: string | null;
}
export interface EsportsCatalog { series: EsportsSeries[]; leagues: EsportsLeague[] }
export interface EsportsTeam {
  team?: string | null; teamCode?: string | null; teamName?: string | null; logo?: string | null; side?: string | null;
  teamScore?: number | null; teamKills?: number | null; teamDeaths?: number | null; teamAssists?: number | null;
  teamGold?: number | null; teamDmgDealt?: number | null; teamDmgTaken?: number | null;
  teamTurtles?: number | null; teamLords?: number | null; teamObjectives?: number | null;
}
export interface EsportsMatch {
  id: string; league_id: string; league_code: string | null; league_name: string | null; stage: string; format: string;
  starts_at: string | null; status: "upcoming" | "completed" | "pending"; team1: EsportsTeam; team2: EsportsTeam;
  winner: EsportsTeam; is_draw: boolean; source_verified: boolean | null; game_count: number; draft_event_count: number;
  fetched_at: string; detail_fetched_at: string | null; source_url: string;
}
export interface EsportsDraftEvent {
  kind: "Pick" | "Ban"; source_order: number; sequence: number | null; side: string | null;
  hero_id: string; hero_name: string | null; player_ign: string; position: string;
}
export interface EsportsPlayerStat {
  id: string; team_id: string; ign: string; position: string; hero_name: string | null;
  kills: number | null; deaths: number | null; assists: number | null; gold: number | null;
  dmgDealt: number | null; dmgTaken: number | null; killParticipation: number | null; isMVP: boolean | null;
}
export interface EsportsGame {
  id: string; number: number; duration_seconds: number | null; team1: EsportsTeam; team2: EsportsTeam; winner: EsportsTeam;
  draft_coverage: "none" | "partial" | "complete" | "ambiguous"; draft_fetched_at: string | null;
  draft: EsportsDraftEvent[]; player_stats: EsportsPlayerStat[];
}
export interface EsportsDetail { match: EsportsMatch; games: EsportsGame[]; detail_error: string | null; detail_refreshing?: boolean; source_note: string }
/** One drafted hero and who played it (from the saved match data). */
export interface BreakdownPick { hero: string | null; player: string | null; position: string | null }
export interface BreakdownSwap { out: string; in: string; player: string | null; position: string | null; why: string; how: string }
export type BreakdownVerdict = "executed" | "partial" | "failed";
/** AI coaching for one draft: how it wins, how to play it, and fixes. */
export interface BreakdownPlan { win_condition: string; execution: string[]; verdict: BreakdownVerdict | null; verdict_note: string; swaps: BreakdownSwap[] }
export interface BreakdownStandout { player: string | null; hero: string | null; mvp: boolean; kills: number | null; deaths: number | null; assists: number | null }
export interface BreakdownGameTeam {
  key: "team1" | "team2"; code: string | null; name: string | null; logo: string | null; side: string | null; won: boolean;
  kills: number | null; gold: number | null; turtles: number | null; lords: number | null;
  picks: BreakdownPick[]; bans: (string | null)[]; standout: BreakdownStandout | null; plan?: BreakdownPlan;
}
export interface BreakdownGame { number: number | null; duration_seconds: number | null; winner: "team1" | "team2" | null; teams: BreakdownGameTeam[]; deciding_factor?: string }
export interface BreakdownMatchTeam { key: "team1" | "team2"; code: string | null; name: string | null; logo: string | null; score: number | null; won: boolean }
export interface BreakdownMatch {
  match_id: string; league: string | null; stage: string | null; format: string | null; date: string | null; status: string | null;
  source_url: string | null; fetched_at: string | null; teams: BreakdownMatchTeam[]; games: BreakdownGame[]; series_story?: string;
}
export interface DraftBreakdownData { headline: string; answer: string; takeaways: string[]; matches: BreakdownMatch[] }
export interface EsportsAnalysis { mode: "facts" | "ai"; answer: string; note: string; source_url: string; fetched_at: string | null; breakdown?: DraftBreakdownData }
export interface EsportsSceneAnalysis { mode: "facts" | "ai"; answer: string; note: string; sources: { match_id: string; source_url: string; fetched_at: string | null }[]; breakdown?: DraftBreakdownData }

/** True when the AI supplied coaching (win conditions etc.), not just facts. */
export function hasCoaching(data: DraftBreakdownData | undefined): boolean {
  return Boolean(data?.matches.some((match) => match.series_story || match.games.some((game) => game.deciding_factor || game.teams.some((team) => team.plan))));
}
export type EsportsView = "upcoming" | "results" | "all";

export function esportsDate(value: string | null, withTime = true): string {
  if (!value) return "Date TBC";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date TBC";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(date);
}
export function esportsNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat().format(value) : "—";
}
export function teamName(team: EsportsTeam): string { return team.teamName || team.teamCode || "To be decided"; }
export function teamCode(team: EsportsTeam): string { return team.teamCode || team.teamName || "TBD"; }
export function gameDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
