import { Check, CirclePlus, Database, Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import { AI_MATCH_LIMIT, shortDate, toggleMatchSelection } from "../lib/cloverAI";
import { esportsDate, esportsNumber, teamCode, teamName, type EsportsMatch } from "../lib/esports";
import { ErrorNote } from "./ui";

export function AIMatchPicker({ initial, onApply, onCancel }: {
  initial: EsportsMatch[]; onApply: (matches: EsportsMatch[]) => void; onCancel: () => void;
}) {
  const [chosen, setChosen] = useState(initial);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<EsportsMatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true); setMatches(null); setError(null);
    const timer = window.setTimeout(() => {
      api.get<{ matches: EsportsMatch[] }>(`/esports/matches${qs({ view: "all", q: search.trim(), limit: 40 })}`)
        .then((data) => { if (alive) setMatches(data.matches); })
        .catch((e) => { if (alive) setError(e); })
        .finally(() => { if (alive) setLoading(false); });
    }, search.trim() ? 250 : 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [search, reload]);

  function toggle(match: EsportsMatch) {
    setChosen((previous) => toggleMatchSelection(previous, match));
  }

  return <div className="space-y-4">
    <div className="flex gap-3 rounded-lg border border-leaf/20 bg-leaf/5 p-3">
      <Database className="text-leaf shrink-0 mt-0.5" size={16} />
      <p className="text-[11px] text-mute leading-relaxed">Choose up to three public matches already saved from Aerena. No live refresh happens here. Only the selected sample is included; missing games, drafts and stats stay unknown.</p>
    </div>
    <label className="relative block"><span className="sr-only">Search saved matches</span><Search size={14} className="absolute left-3 top-3 text-faint pointer-events-none" />
      <input className="input !pl-9 !text-[12px]" maxLength={100} placeholder="Search teams, season or match ID…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
    <div className="flex items-center justify-between gap-2"><span className="label">Saved Aerena matches</span><span className="text-[10px] font-bold text-faint">{chosen.length} / {AI_MATCH_LIMIT} selected</span></div>
    {chosen.length > 0 && <div className="flex flex-wrap gap-1.5">{chosen.map((match) => <button type="button" key={match.id} onClick={() => toggle(match)}
      aria-label={`Remove ${teamCode(match.team1)} vs ${teamCode(match.team2)} from selection`} className="max-w-full inline-flex items-center gap-1 rounded-md border border-leaf/25 bg-leaf/5 px-2 py-1 text-[10px] font-bold text-leaf">
      <span className="truncate">{teamCode(match.team1)} vs {teamCode(match.team2)}</span><X size={11} className="shrink-0" /></button>)}</div>}
    <div className="space-y-2 max-h-[42vh] overflow-y-auto overscroll-contain pr-0.5">
      {loading && <div className="flex items-center gap-2 py-4 text-[11px] text-faint"><Loader2 size={14} className="animate-spin" /> Loading saved matches…</div>}
      {!loading && matches?.length === 0 && <div className="rounded-lg border border-dashed border-edge-2 px-4 py-6 text-[11px] text-mute leading-relaxed">{search.trim() ? "No saved matches match that search. Try a team name or match ID." : "No Aerena matches are saved yet. Check the Esports feed status; matches will appear here after a successful sync."}</div>}
      {matches?.map((match) => {
        const active = chosen.some((item) => item.id === match.id);
        return <button key={match.id} type="button" aria-pressed={active} onClick={() => toggle(match)} disabled={!active && chosen.length >= AI_MATCH_LIMIT}
          className={`w-full text-left rounded-lg border p-3 min-w-0 transition-colors disabled:opacity-40 ${active ? "border-leaf/45 bg-leaf/5" : "border-edge bg-raised/40 hover:border-edge-2"}`}>
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5 text-[9px] uppercase tracking-wider text-faint font-extrabold"><span className="text-crim">{match.league_code || "Aerena"}</span><span>·</span><span>{match.stage || "Stage unknown"}</span><span>·</span><span>{match.status === "completed" ? "Result" : match.status === "upcoming" ? "Upcoming" : "Pending"}</span></div>
            <div className="text-[12px] font-extrabold text-text mt-1.5 break-words">{teamName(match.team1)} <span className="text-faint">vs</span> {teamName(match.team2)} {match.status === "completed" && <span className="text-mute tabular-nums">· {esportsNumber(match.team1.teamScore)}–{esportsNumber(match.team2.teamScore)}</span>}</div>
            <div className="text-[10px] text-faint mt-1">{esportsDate(match.starts_at, false)} · Saved {shortDate(match.fetched_at)}</div></div>
            <span className={`rounded-full border p-1 shrink-0 ${active ? "border-leaf/50 bg-leaf text-ink" : "border-edge-2 text-faint"}`}>{active ? <Check size={13} /> : <CirclePlus size={13} />}</span></div>
        </button>;
      })}
      {Boolean(error) && <><ErrorNote error={error} /><button type="button" className="text-[11px] text-leaf underline" onClick={() => setReload((value) => value + 1)}>Retry matches</button></>}
    </div>
    <p className="text-[10px] text-faint leading-relaxed">Showing up to 40 saved results. Search to find older matches. Aerena is community-compiled and may be incomplete, unverified or stale.</p>
    <div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn-ghost !text-[11px]" onClick={onCancel}>Cancel</button>
      <button type="button" className="btn-primary !text-[11px]" onClick={() => onApply(chosen)}><Check size={13} /> Use {chosen.length ? `${chosen.length} match${chosen.length === 1 ? "" : "es"}` : "no matches"}</button></div>
  </div>;
}
