import { CalendarDays, Check, CirclePlus, Database, ExternalLink, Loader2, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, qs } from "../lib/api";
import { AI_ESPORTS_MATCH_LIMIT, type AIEsportsAttachment, type AIEsportsRegion, type AIEsportsSelection, shortDate } from "../lib/cloverAI";
import { esportsDate, esportsNumber, teamName, type EsportsCatalog, type EsportsLeague, type EsportsMatch } from "../lib/esports";
import { ErrorNote } from "./ui";

type PickerMatch = { id: string | null; week: number | null; team1: string; team2: string; score1: number | null; score2: number | null; status: string; starts_at: string | null; day?: string; stage?: string; round?: string; phase?: "regular" | "playoffs"; id_conflict?: boolean };
type RoneSchedule = { status: string; weeks: number[]; matches: PickerMatch[]; observed_at: string | null; notice: string };
type AerenaPage = { matches: (EsportsMatch & { week: number | null })[]; weeks: { number: number; matches: number }[]; total: number; has_more: boolean; unlabeled_matches: number; playoff_matches: number; unlabeled_stages: number; season_loaded: boolean; season_observed_at: string | null; season_error: boolean };
const REGIONS: { id: AIEsportsRegion; label: string }[] = [
  { id: "id", label: "Indonesia" }, { id: "ph", label: "Philippines" },
  { id: "my", label: "Malaysia" }, { id: "kh", label: "Cambodia" },
];

function leagueInRegion(league: EsportsLeague, region: AIEsportsRegion): boolean {
  const value = `${league.region} ${league.code} ${league.name}`.toLowerCase();
  const words: Record<AIEsportsRegion, RegExp> = {
    id: /\b(id|idn|indonesia|indonesian)\b/, ph: /\b(ph|phl|philippines|philippine)\b/,
    my: /\b(my|mys|malaysia|malaysian)\b/, kh: /\b(kh|khm|cambodia|cambodian)\b/,
  };
  return words[region].test(value);
}

export function AIMatchPicker({ initial, onApply, onCancel }: {
  initial: AIEsportsAttachment | null; onApply: (selection: AIEsportsAttachment | null) => void; onCancel: () => void;
}) {
  const [source, setSource] = useState<"rone" | "aerena">(initial?.selection.source || "rone");
  const [region, setRegion] = useState<AIEsportsRegion>(initial?.selection.region || "id");
  const [season, setSeason] = useState(initial?.selection.league_id || "");
  const [week, setWeek] = useState<number | null>(initial?.selection.week ?? null);
  const [phase, setPhase] = useState<"regular" | "playoffs">(initial?.selection.mode === "playoffs" || initial?.selection.phase === "playoffs" ? "playoffs" : "regular");
  const [chosen, setChosen] = useState<AIEsportsAttachment["chosen"]>(initial?.selection.mode === "matches" ? initial.chosen : []);
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<EsportsCatalog | null>(null);
  const [rone, setRone] = useState<RoneSchedule | null>(null);
  const [aerena, setAerena] = useState<AerenaPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [loadNotice, setLoadNotice] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [catalogError, setCatalogError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const refreshRone = useRef(false);
  const loadVersion = useRef(0);

  useEffect(() => {
    if (source !== "aerena" || catalog) return;
    let alive = true;
    setCatalogError(null);
    api.get<EsportsCatalog>("/esports/catalog").then((data) => { if (alive) setCatalog(data); })
      .catch((err) => { if (alive) setCatalogError(err); });
    return () => { alive = false; };
  }, [source, catalog, reload]);
  const seasons = useMemo(() => (catalog?.leagues || []).filter((item) => leagueInRegion(item, region)), [catalog, region]);
  useEffect(() => {
    if (source !== "aerena" || !catalog) return;
    if (!seasons.some((item) => item.id === season)) setSeason(seasons[0]?.id || "");
  }, [source, catalog, seasons, season]);

  useEffect(() => {
    if (source !== "rone") return;
    let alive = true;
    const refresh = refreshRone.current;
    refreshRone.current = false;
    setError(null); setLoading(true); setRone(null);
    api.get<RoneSchedule>(`/ai/esports/rone/${region}/${phase === "playoffs" ? "playoffs" : "schedule"}${qs({ refresh })}`)
      .then((data) => { if (alive) setRone(data); }).catch((err) => { if (alive) setError(err); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [source, region, phase, reload]);

  useEffect(() => {
    if (source !== "aerena") return;
    let alive = true;
    setError(null);
    if (!season) { setAerena(null); setLoading(false); return () => { alive = false; }; }
    setLoading(true);
    if (!offset) setAerena(null);
    const timer = window.setTimeout(() => {
      api.get<AerenaPage>(`/ai/esports/aerena/${encodeURIComponent(season)}/matches${qs({ week, phase: phase === "playoffs" ? "playoffs" : "all", q: search.trim(), offset, limit: 50 })}`)
        .then((data) => { if (alive) setAerena((old) => offset && old ? { ...data, matches: [...old.matches, ...data.matches] } : data); })
        .catch((err) => { if (alive) setError(err); }).finally(() => { if (alive) setLoading(false); });
    }, search.trim() ? 250 : 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [source, season, week, phase, search, offset, reload]);

  function changeSource(value: "rone" | "aerena") { loadVersion.current++; setLoadNotice(""); setSource(value); setChosen([]); setWeek(null); setSeason(""); setOffset(0); setSearch(""); }
  function changeRegion(value: AIEsportsRegion) { loadVersion.current++; setLoadNotice(""); setRegion(value); setChosen([]); setWeek(null); setSeason(""); setOffset(0); setSearch(""); }
  function changeWeek(value: number | null) { setWeek(value); setOffset(0); }
  function changePhase(value: "regular" | "playoffs") {
    if (value === phase) return;
    setRone(null); setAerena(null); setLoading(true);
    setPhase(value); setWeek(null); setOffset(0);
  }
  function toggle(match: PickerMatch) {
    if (!match.id) return;
    const selected: AIEsportsAttachment["chosen"][number] = {
      id: match.id, label: `${match.team1} vs ${match.team2}${source === "rone" && phase === "playoffs" ? " · Playoffs" : ""}`,
      ...(source === "rone" ? { phase } : {}),
    };
    setChosen((previous) => previous.some((item) => item.id === selected.id)
      ? previous.filter((item) => item.id !== selected.id)
      : previous.length < AI_ESPORTS_MATCH_LIMIT ? [...previous, selected] : previous);
  }
  async function loadSeason() {
    if (!season || loadingSeason) return;
    const version = ++loadVersion.current;
    setLoadingSeason(true); setLoadNotice("");
    try {
      const result = await api.post<{ loaded: boolean; notice: string }>(`/ai/esports/aerena/${encodeURIComponent(season)}/load${qs({ refresh: Boolean(aerena?.season_loaded) })}`);
      if (version !== loadVersion.current) return;
      setLoadNotice(result.loaded ? "Season loaded. Choose a week or matches below." : result.notice);
      setOffset(0); setReload((value) => value + 1);
    } catch (err) { if (version === loadVersion.current) setError(err); }
    finally { setLoadingSeason(false); }
  }
  const rows: PickerMatch[] = source === "rone" ? (rone?.matches || []).filter((item) => (week === null || item.week === week) &&
    (!search.trim() || `${item.team1} ${item.team2} ${item.id || ""} ${item.round || ""} ${item.day || ""}`.toLowerCase().includes(search.trim().toLowerCase()))) :
    (aerena?.matches || []).map((item) => ({ id: item.id, week: item.week, stage: item.stage, team1: teamName(item.team1), team2: teamName(item.team2),
      score1: item.team1.teamScore ?? null, score2: item.team2.teamScore ?? null, status: item.status, starts_at: item.starts_at }));
  const weeks = source === "rone" ? (rone?.weeks || []).map((n) => ({ number: n, matches: rone?.matches.filter((m) => m.week === n).length || 0 })) : (aerena?.weeks || []);
  const weekCount = weeks.find((item) => item.number === week)?.matches || 0;
  const playoffCount = source === "rone" ? (phase === "playoffs" ? rone?.matches.length || 0 : 0) : aerena?.playoff_matches || 0;
  const currentSeason = seasons.find((item) => item.id === season);
  const scopeLabel = source === "rone" ? `Rone · MPL ${region.toUpperCase()}` : `Aerena · ${currentSeason?.code || "season"}`;
  function apply(mode: "week" | "matches" | "playoffs") {
    const phases = new Set(chosen.map((item) => item.phase || "regular"));
    const chosenPhase = phases.size > 1 ? "all" : (chosen[0]?.phase || "regular");
    const selection: AIEsportsSelection = { source, mode, region, ...(source === "aerena" ? { league_id: season } : {}),
      ...(mode === "week" ? { week: week! } : mode === "matches" ? { match_ids: chosen.map((item) => item.id), ...(source === "rone" ? { phase: chosenPhase } : {}) } : {}) };
    const detail = mode === "week" ? `Week ${week}` : mode === "playoffs" ? "Playoffs" : `${chosen.length} match${chosen.length === 1 ? "" : "es"}${source === "rone" && chosenPhase === "playoffs" ? " · Playoffs" : source === "rone" && chosenPhase === "all" ? " · Regular season & playoffs" : ""}`;
    onApply({ selection, label: `${scopeLabel} · ${detail}`, chosen: mode === "matches" ? chosen : [] });
  }

  return <div className="space-y-4">
    <div className="rounded-xl border border-leaf/20 bg-leaf/[0.05] p-3 flex gap-3">
      <span className="grid place-items-center h-9 w-9 shrink-0 rounded-lg border border-leaf/20 bg-leaf/10 text-leaf"><Database size={17} /></span>
      <div><p className="text-[12px] font-extrabold text-text">Bring the matches to Clover.</p>
        <p className="text-[11px] leading-relaxed text-mute mt-1">Choose a week, the playoffs, or individual matches. Clover loads available public games and counts picks by game number.</p></div>
    </div>
    <div className="grid sm:grid-cols-2 gap-3">
      <div><div className="label mb-1.5 !text-mute">Data source</div><div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Data source">
        {(["rone", "aerena"] as const).map((value) => <button type="button" key={value} aria-pressed={source === value} onClick={() => changeSource(value)}
          className={`rounded-lg border px-3 py-2 text-left text-[11px] font-extrabold transition-colors ${source === value ? "border-leaf/50 bg-leaf/10 text-leaf" : "border-edge bg-raised/40 text-mute hover:border-edge-2"}`}>
          {value === "rone" ? "Rone" : "Aerena"}<span className="block mt-0.5 text-[9px] font-medium text-mute">{value === "rone" ? "MPL weeks & playoffs" : "Seasons & matches"}</span></button>)}
      </div></div>
      <div><div className="label mb-1.5 !text-mute">MPL region</div><div className="grid grid-cols-4 gap-1.5" role="group" aria-label="MPL region">
        {REGIONS.map((item) => <button type="button" key={item.id} aria-label={`${item.id.toUpperCase()} — ${item.label}`} aria-pressed={region === item.id} onClick={() => changeRegion(item.id)}
          className={`rounded-lg border px-1 py-2.5 text-[11px] font-extrabold transition-colors ${region === item.id ? "border-leaf/50 bg-leaf/10 text-leaf" : "border-edge bg-raised/40 text-mute hover:border-edge-2"}`}>{item.id.toUpperCase()}</button>)}
      </div><p className="text-[10px] text-mute mt-1.5">{REGIONS.find((item) => item.id === region)?.label}</p></div>
    </div>
    {source === "aerena" ? <div className="space-y-2"><label className="block"><span className="label mb-1.5 block !text-mute">League / season</span>
      <select className="input !text-[12px]" aria-label="League and season" value={season} onChange={(event) => { loadVersion.current++; setLoadNotice(""); setSeason(event.target.value); setChosen([]); setWeek(null); setOffset(0); }}>
        {!seasons.length && <option value="">{catalog ? "No seasons in this region" : "Loading seasons…"}</option>}
        {seasons.map((item) => <option key={item.id} value={item.id}>{item.name || item.code}</option>)}
      </select></label>
      {Boolean(catalogError) && <><ErrorNote error={catalogError} /><button type="button" className="text-[11px] text-leaf underline" onClick={() => setReload((n) => n + 1)}>Retry seasons</button></>}
      {season && aerena && <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 ${aerena.season_loaded ? "border-edge bg-raised/30" : "border-amber/25 bg-amber/5"}`}>
        <p className="text-[10px] leading-relaxed text-mute">{aerena.season_loaded ? `Season saved ${shortDate(aerena.season_observed_at)}. Refresh to check for missing matches.` : "This season hasn’t been fully loaded yet. Clover can wait for the public feed."}</p>
        <button type="button" className="btn-ghost !text-[10px]" disabled={loadingSeason} onClick={() => void loadSeason()}>{loadingSeason ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {loadingSeason ? "Loading season…" : aerena.season_loaded ? "Refresh season" : "Load season"}</button>
      </div>}
      {loadNotice && <p role="status" className="text-[10px] text-mute">{loadNotice}</p>}
    </div> : <div className="rounded-lg border border-edge bg-raised/30 px-3 py-2 text-[10px] leading-relaxed text-mute">
      Rone’s schedule and playoffs don’t identify a season, so Clover won’t guess one. <a href="https://arena.rone.dev/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-leaf underline">Rone <ExternalLink size={10} /></a>
    </div>}
    <div><div className="label mb-1.5 !text-mute">Stage</div>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Match stage">
        {(["regular", "playoffs"] as const).map((value) => <button type="button" key={value} aria-pressed={phase === value} onClick={() => changePhase(value)}
          className={`rounded-lg border px-3 py-2 text-[11px] font-extrabold transition-colors ${phase === value ? "border-leaf/50 bg-leaf/10 text-leaf" : "border-edge bg-raised/40 text-mute hover:border-edge-2"}`}>
          {value === "playoffs" ? "Playoffs" : source === "rone" ? "Regular season" : "All matches"}</button>)}
      </div>
      {phase === "playoffs" && <p className="text-[10px] text-mute mt-1.5">{source === "rone" ? "Playoff days and rounds are separate from regular-season weeks." : "Shows saved matches with source playoff, bracket, knockout or final stage labels. Coverage can be incomplete."}</p>}
      {chosen.length > 0 && <p className="text-[10px] text-mute mt-1">Your selected matches stay selected when you switch stages.</p>}
    </div>
    {phase !== "playoffs" && <div><div className="flex items-center justify-between gap-2 mb-1.5"><span className="label !text-mute">Week</span><span className="text-[10px] text-mute">Source labels only</span></div>
      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Match week">
        <button type="button" aria-pressed={week === null} onClick={() => changeWeek(null)} className={`rounded-md border px-2.5 py-1.5 text-[10px] font-bold ${week === null ? "border-leaf/50 bg-leaf/10 text-leaf" : "border-edge text-mute"}`}>All weeks</button>
        {weeks.map((item) => <button type="button" key={item.number} aria-pressed={week === item.number} onClick={() => changeWeek(item.number)}
          className={`rounded-md border px-2.5 py-1.5 text-[10px] font-bold ${week === item.number ? "border-leaf/50 bg-leaf/10 text-leaf" : "border-edge text-mute"}`}>Week {item.number} <span className="font-medium">{item.matches}</span></button>)}
      </div>
      {source === "aerena" && Boolean(aerena?.unlabeled_matches) && <p className="text-[10px] text-mute mt-1.5">{aerena?.unlabeled_matches} non-playoff matches have no clear week label and aren’t assigned to a week.</p>}
    </div>}
    {week !== null && weekCount > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-leaf/20 bg-leaf/[0.04] p-3">
      <div className="min-w-0"><p className="text-[11px] font-extrabold text-text flex items-center gap-1.5"><CalendarDays size={14} className="text-leaf" /> Entire week {week}</p>
        <p className="text-[10px] text-mute mt-1">{weekCount} source match{weekCount === 1 ? "" : "es"} · includes every game available, even if not saved yet.{search.trim() && " Includes matches hidden by search."}</p></div>
      <button type="button" className="btn-primary !text-[10px]" disabled={loading || weekCount > AI_ESPORTS_MATCH_LIMIT} onClick={() => apply("week")}><Check size={13} /> Use entire week</button>
      {weekCount > AI_ESPORTS_MATCH_LIMIT && <p className="text-[10px] text-amber">More than {AI_ESPORTS_MATCH_LIMIT} matches: select a smaller set instead.</p>}
    </div>}
    {phase === "playoffs" && playoffCount > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-leaf/20 bg-leaf/[0.04] p-3">
      <div className="min-w-0"><p className="text-[11px] font-extrabold text-text flex items-center gap-1.5"><CalendarDays size={14} className="text-leaf" /> Entire playoffs</p>
        <p className="text-[10px] text-mute mt-1">{playoffCount} source match{playoffCount === 1 ? "" : "es"} · includes all available games.{search.trim() && " Includes matches hidden by search."}</p></div>
      <button type="button" className="btn-primary !text-[10px]" disabled={loading || playoffCount > AI_ESPORTS_MATCH_LIMIT} onClick={() => apply("playoffs")}><Check size={13} /> Use entire playoffs</button>
      {playoffCount > AI_ESPORTS_MATCH_LIMIT && <p className="text-[10px] text-amber">More than {AI_ESPORTS_MATCH_LIMIT} matches: select a smaller set instead.</p>}
    </div>}
    {phase === "playoffs" && source === "aerena" && Boolean(aerena?.unlabeled_stages) && <p className="text-[10px] text-mute">{aerena?.unlabeled_stages} season matches have no stage label and can’t be assigned to playoffs.</p>}
    <label className="relative block"><span className="sr-only">Search matches</span><Search size={14} className="absolute left-3 top-3 text-mute pointer-events-none" />
      <input className="input !pl-9 !text-[12px]" maxLength={100} placeholder="Search teams or match ID…" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} /></label>
    <div className="flex items-center justify-between gap-2"><span className="section-pill">MATCHES</span><span className="text-[10px] font-bold text-mute">{chosen.length} / {AI_ESPORTS_MATCH_LIMIT} selected</span></div>
    {chosen.length > 0 && <div className="flex flex-wrap gap-1.5">{chosen.map((item) => <button type="button" key={item.id} onClick={() => setChosen((old) => old.filter((entry) => entry.id !== item.id))}
      aria-label={`Remove ${item.label} from selection`} className="max-w-full inline-flex items-center gap-1 rounded-md border border-leaf/25 bg-leaf/5 px-2 py-1 text-[10px] font-bold text-leaf"><span className="truncate">{item.label}</span><X size={11} /></button>)}</div>}
    <div className="space-y-2 max-h-[34vh] overflow-y-auto overscroll-contain pr-0.5" aria-live="polite">
      {loading && <div className="flex items-center gap-2 py-3 text-[11px] text-mute"><Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> Loading {phase === "playoffs" ? "playoffs" : source === "rone" ? "schedule" : "matches"}…</div>}
      {!loading && source === "rone" && rone?.status === "saved_stale" && <p className="text-[10px] text-amber">Showing saved {phase === "playoffs" ? "playoffs" : "schedule"}; the live feed could not be refreshed.</p>}
      {!loading && !rows.length && <div className="rounded-lg border border-dashed border-edge-2 px-4 py-5 text-[11px] text-mute leading-relaxed">{source === "rone" && rone?.status === "unavailable" ? rone.notice : search.trim() ? "No matches found for that search." : source === "aerena" && !season ? "Choose a region with an available season." : phase === "playoffs" ? "No playoff matches have been published or saved for these filters yet." : "No matches available for these filters yet."}</div>}
      {rows.map((match, index) => {
        const active = !!match.id && chosen.some((item) => item.id === match.id);
        const stageLabel = match.phase === "playoffs" ? `Playoffs${match.round ? ` · ${match.round}` : ""}` : match.week ? `Week ${match.week}${match.stage ? ` · ${match.stage}` : ""}` : match.stage || "Stage unknown";
        return <button key={`${match.id || "no-detail"}-${match.week}-${index}`} type="button" aria-pressed={active} onClick={() => toggle(match)} disabled={!match.id || (!active && chosen.length >= AI_ESPORTS_MATCH_LIMIT)}
          className={`w-full text-left rounded-lg border p-3 min-w-0 transition-colors disabled:opacity-60 ${active ? "border-leaf/45 bg-leaf/5" : "border-edge bg-raised/40 hover:border-edge-2"}`}>
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-1.5 text-[9px] uppercase tracking-wider text-mute font-extrabold"><span className="text-leaf">{stageLabel}</span><span>·</span><span>{match.status || "unknown"}</span></div>
            <div className="text-[12px] font-extrabold text-text mt-1 break-words">{match.team1} <span className="text-mute">vs</span> {match.team2} {match.score1 !== null && match.score2 !== null && <span className="text-mute tabular-nums">· {esportsNumber(match.score1)}–{esportsNumber(match.score2)}</span>}</div>
            <div className="text-[10px] text-mute mt-1">{match.starts_at ? esportsDate(match.starts_at, false) : match.day || "Date TBC"}{!match.id && (match.id_conflict ? " · Conflicting source record" : source === "rone" && region === "kh" ? " · Match details unavailable for MPL KH" : " · Details not published")}</div></div>
            <span className={`rounded-full border p-1 shrink-0 ${active ? "border-leaf/50 bg-leaf text-ink" : "border-edge-2 text-mute"}`}>{active ? <Check size={13} /> : <CirclePlus size={13} />}</span></div>
        </button>;
      })}
      {source === "aerena" && aerena?.has_more && <button type="button" className="btn-ghost w-full !text-[10px]" disabled={loading} onClick={() => setOffset((n) => n + 50)}>Load more matches</button>}
      {Boolean(error) && <ErrorNote error={error} />}
    </div>
    {source === "rone" && <div className="flex items-center justify-between gap-2 text-[10px] text-mute"><span>{rone?.observed_at ? `${phase === "playoffs" ? "Playoffs" : "Schedule"} saved ${shortDate(rone.observed_at)}` : "Public source availability can vary."}</span><button type="button" className="inline-flex items-center gap-1 text-leaf underline" disabled={loading} onClick={() => { refreshRone.current = true; setReload((n) => n + 1); }}><RefreshCw size={11} /> Retry {phase === "playoffs" ? "playoffs" : "schedule"}</button></div>}
    <p className="text-[10px] text-mute leading-relaxed">Community data can be incomplete or stale. Missing details and games will be reported instead of guessed.</p>
    <div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn-ghost !text-[11px]" onClick={onCancel}>Cancel</button>
      {initial && <button type="button" className="btn-ghost !text-[11px]" onClick={() => onApply(null)}>Clear attachment</button>}
      <button type="button" className="btn-primary !text-[11px]" disabled={!chosen.length} onClick={() => apply("matches")}><Check size={13} /> Use {chosen.length} match{chosen.length === 1 ? "" : "es"}</button></div>
  </div>;
}
