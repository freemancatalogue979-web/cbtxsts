import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Database, Globe2, Radio, RefreshCw, Search, Trophy, X } from "lucide-react";
import { EsportsMatchModal, SceneAnalysisPanel, TeamMark } from "../components/EsportsDetails";
import { ErrorNote, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { esportsDate, esportsNumber, teamCode, teamName, type EsportsCatalog, type EsportsLeague, type EsportsMatch, type EsportsSeries, type EsportsSource, type EsportsView, type SourceStatus } from "../lib/esports";
import type { User } from "../lib/types";
import { RoneEsportsPage } from "./RoneEsports";

const sourceLabels: Record<SourceStatus, string> = {
  fresh: "Feed up to date", syncing: "Updating feed", stale: "Saved feed may be stale",
  unavailable: "Feed unavailable", disabled: "Feed disabled", waiting: "Waiting for first sync",
};

function FeedBadge({ source }: { source: EsportsSource | null }) {
  const status = source?.status ?? "waiting";
  const tone = status === "fresh" ? "text-leaf border-leaf/25 bg-leaf/10" : status === "syncing" ? "text-sky border-sky/25 bg-sky/10" : "text-amber border-amber/25 bg-amber/10";
  return <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide ${tone}`}><span className={`h-1.5 w-1.5 rounded-full bg-current ${status === "syncing" ? "animate-pulse" : ""}`} />{sourceLabels[status]}</span>;
}

function MatchCard({ match, onClick }: { match: EsportsMatch; onClick: () => void }) {
  return <button onClick={onClick} className="w-full text-left rounded-xl border border-edge bg-panel hover:border-crim/40 hover:bg-raised/70 transition-colors group overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-edge/80 bg-white/[0.015]"><div className="flex items-center gap-2 min-w-0 text-[10px] font-bold uppercase tracking-[0.12em] text-mute"><span className="text-crim truncate">{match.league_code || "Aerena"}</span><span className="text-edge-2">/</span><span className="truncate">{match.stage || "Stage TBC"}</span></div><span className={`text-[9px] font-extrabold tracking-[0.14em] uppercase ${match.status === "upcoming" ? "text-leaf" : match.status === "completed" ? "text-mute" : "text-amber"}`}>{match.status === "completed" ? "Result" : match.status === "upcoming" ? "Upcoming" : "Result pending"}</span></div>
    <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-4"><div className="flex flex-col sm:flex-row items-center gap-2 min-w-0 flex-1 text-center sm:text-left"><TeamMark team={match.team1} size={62} /><div className="min-w-0"><div className="font-extrabold text-[12px] sm:text-sm break-words">{teamCode(match.team1)}</div>{teamName(match.team1) !== teamCode(match.team1) && <div className="text-[10px] text-faint leading-snug break-words mt-0.5">{teamName(match.team1)}</div>}</div></div>
      <div className="shrink-0 text-center tabular-nums min-w-[48px]">{match.status === "completed" ? <div className="text-lg font-black tracking-wide whitespace-nowrap">{esportsNumber(match.team1.teamScore)} <span className="text-faint text-xs">:</span> {esportsNumber(match.team2.teamScore)}</div> : <div className="text-[11px] font-black text-faint tracking-[0.2em]">VS</div>}</div>
      <div className="flex flex-col sm:flex-row-reverse items-center gap-2 min-w-0 flex-1 text-center sm:text-right"><TeamMark team={match.team2} size={62} /><div className="min-w-0"><div className="font-extrabold text-[12px] sm:text-sm break-words">{teamCode(match.team2)}</div>{teamName(match.team2) !== teamCode(match.team2) && <div className="text-[10px] text-faint leading-snug break-words mt-0.5">{teamName(match.team2)}</div>}</div></div></div>
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-[10px] font-semibold text-faint"><span className="flex items-center flex-wrap gap-1.5"><CalendarDays size={12} /> {esportsDate(match.starts_at)} <span className="text-edge-2">·</span> {match.format || "Format TBC"}</span><span className="flex items-center gap-1 text-mute group-hover:text-crim transition-colors">Details <ArrowRight size={12} /></span></div>
  </button>;
}

export function EsportsPage({ me }: { me: User }) {
  const [source, setSource] = useState<EsportsSource | null>(null);
  const [catalog, setCatalog] = useState<EsportsCatalog>({ series: [], leagues: [] });
  const [seriesId, setSeriesId] = useState("");
  const [leagueId, setLeagueId] = useState("");
  const [seasonSearch, setSeasonSearch] = useState("");
  const [matchSearch, setMatchSearch] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  const [view, setView] = useState<EsportsView>("upcoming");
  const [matches, setMatches] = useState<EsportsMatch[] | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [showRone, setShowRone] = useState(false);
  const canRefresh = ["admin", "captain", "coach"].includes(me.role);

  useEffect(() => {
    let alive = true;
    const loadOverview = async () => {
      try {
        const [nextSource, nextCatalog] = await Promise.all([api.get<EsportsSource>("/esports/source"), api.get<EsportsCatalog>("/esports/catalog")]);
        if (alive) { setSource(nextSource); setCatalog(nextCatalog); setSourceError(null); setTick((value) => value + 1); }
      } catch (err) { if (alive) setSourceError(err instanceof Error ? err.message : "Could not load the esports feed."); }
    };
    void loadOverview();
    const timer = window.setInterval(loadOverview, 12000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledSearch(matchSearch), 250);
    return () => window.clearTimeout(timer);
  }, [matchSearch]);
  useEffect(() => {
    let alive = true;
    api.get<{ matches: EsportsMatch[] }>(`/esports/matches${qs({ league_id: leagueId, series_id: seriesId, q: settledSearch, view })}`)
      .then((data) => { if (alive) { setMatches(data.matches); setMatchesError(null); } })
      .catch((err) => { if (alive) { setMatches([]); setMatchesError(err instanceof Error ? err.message : "Could not load matches."); } });
    return () => { alive = false; };
  }, [leagueId, seriesId, settledSearch, view, tick]);

  const selectedLeague = catalog.leagues.find((item) => item.id === leagueId);
  const filteredLeagues = useMemo(() => {
    const search = seasonSearch.trim().toLowerCase();
    return catalog.leagues.filter((item) => (!seriesId || item.series_id === seriesId) && (!search || `${item.code} ${item.name} ${item.region}`.toLowerCase().includes(search)));
  }, [catalog.leagues, seasonSearch, seriesId]);
  async function refresh(target = "") {
    setRefreshing(true); setRefreshError(null);
    try { await api.post("/esports/refresh", { league_id: target }); setTick((value) => value + 1); }
    catch (err) { setRefreshError(err instanceof Error ? err.message : "Could not queue the refresh."); }
    finally { setRefreshing(false); }
  }
  function chooseSeries(item: EsportsSeries | null) {
    setSeriesId(item?.id ?? ""); setLeagueId(item?.latest_league_id ?? "");
    setView(item?.latest_league_id ? "all" : "upcoming"); setMatches(null);
  }
  function chooseLeague(item: EsportsLeague) { setSeriesId(item.series_id); setLeagueId(item.id); setView("all"); setMatches(null); }

  if (showRone) return <div><button onClick={() => setShowRone(false)} className="btn-ghost mb-4"><ArrowLeft size={14} /> Back to Aerena</button><RoneEsportsPage /></div>;
  return <div className="space-y-5 pb-8">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="section-pill mb-1">9 Clover / esports</div><h1 className="text-xl sm:text-2xl font-black uppercase tracking-[0.1em]">The pro scene</h1><p className="text-xs text-mute mt-1">Follow leagues, study matches, and keep the evidence close.</p></div>
      <div className="flex items-center gap-2"><button className="btn-ghost !text-[11px]" onClick={() => setShowRone(true)}>Rone feed <ArrowUpRight size={12} /></button>{canRefresh && <button className="btn-ghost !text-[11px]" onClick={() => void refresh()} disabled={refreshing || !source?.enabled}><RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh feed</button>}</div></div>
    <div className="relative overflow-hidden rounded-2xl border border-edge-2 bg-[#111116] px-5 sm:px-7 py-6 sm:py-7"><div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at 85% 0%,rgba(225,29,72,.15),transparent 38%),linear-gradient(115deg,rgba(52,211,153,.04),transparent 50%)" }} /><div aria-hidden="true" className="absolute right-[-25px] top-[-52px] h-52 w-32 border-l border-r border-crim/10 rotate-[24deg]" />
      <div className="relative flex flex-wrap items-start justify-between gap-5"><div className="max-w-xl"><div className="flex flex-wrap items-center gap-2 mb-4"><span className="section-pill">Scene intelligence</span><FeedBadge source={source} /></div><h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight leading-[1.05]">Every game<br /><span className="text-crim">tells a story.</span></h2><p className="text-[11px] sm:text-xs text-mute leading-relaxed mt-3 max-w-[420px]">Explore community match data, source-reported drafts, and grounded match analysis — all in one place.</p></div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:min-w-[280px] pt-1">{[["Series", source?.series_count], ["Seasons", source?.league_count], ["Saved matches", source?.match_count], ["Draft events", source?.draft_events]].map(([label, value]) => <div key={String(label)}><div className="text-[9px] uppercase tracking-[0.16em] font-bold text-faint">{label}</div><div className="text-xl font-black tabular-nums mt-1">{typeof value === "number" ? esportsNumber(value) : "—"}</div></div>)}</div></div>
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.07] mt-5 pt-3 text-[10px] text-faint"><span className="inline-flex items-center gap-1.5"><Database size={12} /> Source: Aerena.gg</span><span>{source?.last_success_at ? `Last full sync ${esportsDate(source.last_success_at)}` : "No successful full sync yet"}</span>{source?.phase && <span className="text-sky">{source.phase}</span>}</div>
    </div>
    {source?.last_error && <div className="flex items-start gap-2 rounded-xl border border-amber/25 bg-amber/5 p-3 text-[11px] text-amber leading-relaxed"><AlertCircle size={15} className="shrink-0 mt-0.5" /><span>Aerena couldn’t fully refresh: {source.last_error} Saved data remains available. The server needs access to Aerena for automatic updates.</span></div>}
    {source?.status === "disabled" && <div className="flex items-start gap-2 rounded-xl border border-amber/25 bg-amber/5 p-3 text-[11px] text-amber"><AlertCircle size={15} className="shrink-0" /><span>Aerena syncing is disabled on this server. Saved data, if any, remains available.</span></div>}
    <ErrorNote error={refreshError || sourceError || matchesError} />
    <div className="flex gap-2 overflow-x-auto pb-1" aria-label="League series"><button onClick={() => chooseSeries(null)} className={`shrink-0 rounded-lg border px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide ${!seriesId ? "bg-crim/10 border-crim/50 text-text" : "bg-panel border-edge text-mute hover:text-text"}`}><Globe2 size={12} className="inline mr-1.5" /> All series</button>{catalog.series.map((item) => <button key={item.id} onClick={() => chooseSeries(item)} className={`shrink-0 rounded-lg border px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide ${seriesId === item.id ? "bg-crim/10 border-crim/50 text-text" : "bg-panel border-edge text-mute hover:text-text"}`}>{item.code}</button>)}</div>
    <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] gap-4 items-start">
      <aside className="rounded-xl border border-edge bg-panel p-4"><div className="flex items-center justify-between mb-3"><div><h2 className="section-pill">Leagues & seasons</h2><p className="text-[10px] text-faint mt-1">Latest seasons marked</p></div><Trophy size={16} className="text-crim" /></div>
        <label className="relative block"><span className="sr-only">Search seasons</span><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input value={seasonSearch} onChange={(event) => setSeasonSearch(event.target.value)} placeholder="Find a season" className="input !pl-8 !py-2 !text-[11px]" /></label>
        <div className="mt-3 max-h-[290px] lg:max-h-[570px] overflow-y-auto space-y-1 pr-0.5">{!filteredLeagues.length && <div className="py-5 text-center text-[11px] text-faint">{catalog.leagues.length ? "No seasons match your search." : "Seasons appear after the first successful sync."}</div>}{filteredLeagues.map((item) => <button key={item.id} onClick={() => chooseLeague(item)} className={`w-full text-left rounded-lg border px-3 py-2.5 flex items-center gap-2 transition-colors ${leagueId === item.id ? "bg-crim/10 border-crim/35" : "border-transparent hover:bg-raised"}`}><span className="min-w-0 flex-1"><span className="block text-[11px] font-extrabold truncate">{item.code}</span><span className="block text-[10px] text-faint truncate mt-0.5">{item.name}</span></span>{item.is_latest && <span className="text-[8px] font-black uppercase tracking-wider text-leaf">Latest</span>}</button>)}</div>
      </aside>
      <main className="min-w-0 space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="section-pill">Match centre</div><h2 className="text-lg font-black mt-1">{selectedLeague?.name || (seriesId ? catalog.series.find((item) => item.id === seriesId)?.name : "Across the scene") || "Across the scene"}</h2></div>{selectedLeague && <button onClick={() => { setLeagueId(""); setSeriesId(""); setView("upcoming"); }} className="text-[10px] font-bold text-faint hover:text-text">Clear season <X size={11} className="inline" /></button>}</div>
        <div className="flex flex-wrap items-center gap-2"><div className="flex rounded-lg bg-panel border border-edge p-1">{(["upcoming", "results", "all"] as EsportsView[]).map((item) => <button key={item} onClick={() => { setView(item); setMatches(null); }} className={`rounded-md px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide ${view === item ? "bg-raised text-text" : "text-faint hover:text-mute"}`}>{item}</button>)}</div><label className="relative flex-1 min-w-[190px]"><span className="sr-only">Search teams, leagues or matches</span><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input value={matchSearch} onChange={(event) => setMatchSearch(event.target.value)} placeholder="Search teams, leagues or matches" className="input !pl-8 !py-2 !text-[11px]" /></label></div>
        <SceneAnalysisPanel matches={matches ?? []} configured={Boolean(source?.ai_configured)} />
        {selectedLeague && !selectedLeague.matches_fetched_at && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-edge bg-raised/50 p-3 text-[11px] text-mute"><span>This season hasn’t been loaded into the database yet.</span>{canRefresh && <button className="btn-ghost !text-[10px]" onClick={() => void refresh(selectedLeague.id)} disabled={refreshing || !source?.enabled}><RefreshCw size={12} /> Load season</button>}</div>}
        {selectedLeague?.matches_error && <div className="text-[11px] text-amber">Season refresh failed. Previously saved matches are still shown.</div>}
        {matches === null && <Spinner label="Loading matches" />}
        {matches && !matchesError && matches.length === 0 && <div className="rounded-xl border border-dashed border-edge-2 bg-panel/60 p-8 text-center"><div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-raised text-faint"><Radio size={17} /></div><div className="text-sm font-bold text-mute">{view === "upcoming" ? "No upcoming matches in the saved feed" : "No matches found"}</div><p className="text-[11px] text-faint mt-1.5">{source?.last_success_at ? "Try another season, search, or view." : "Matches will appear after a successful Aerena sync."}</p></div>}
        {matches && matches.length > 0 && <div className="space-y-2.5">{matches.map((match) => <MatchCard key={match.id} match={match} onClick={() => setSelectedMatch(match.id)} />)}{matches.length >= 80 && <p className="text-[10px] text-faint text-center py-2">Showing the first 80 matches. Narrow your search or season to see more.</p>}</div>}
      </main>
    </div>
    <p className="text-[10px] text-faint leading-relaxed border-t border-edge pt-4">Aerena is an independent, community-compiled source and is not official Moonton/MPL data. Coverage and draft completeness vary by match. Saved source data can support analysis but does not retrain the AI automatically. Live patch feeds and a predictive model are not connected yet.</p>
    {selectedMatch && <EsportsMatchModal key={selectedMatch} matchId={selectedMatch} aiConfigured={Boolean(source?.ai_configured)} onClose={() => setSelectedMatch(null)} />}
  </div>;
}
