import { useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, ArrowUpRight, CircleSlash2, Clock3, Loader2, Sparkles, Swords, X } from "lucide-react";
import { HeroImg } from "./HeroImg";
import { ErrorNote, Spinner } from "./ui";
import { api } from "../lib/api";
import { esportsDate, esportsNumber, gameDuration, teamCode, type EsportsAnalysis, type EsportsDetail, type EsportsGame, type EsportsMatch, type EsportsSceneAnalysis, type EsportsTeam } from "../lib/esports";

export function TeamMark({ team, size = 42 }: { team: EsportsTeam; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [team.logo]);
  return <div className="shrink-0 flex items-center justify-center rounded-xl bg-white/[0.035] border border-white/[0.07] overflow-hidden" style={{ width: size, height: size }} aria-hidden="true">
    {team.logo && !failed ? <img src={team.logo} alt="" className="w-[78%] h-[78%] object-contain" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <span className="text-[10px] font-black tracking-tight text-mute">{teamCode(team).slice(0, 3).toUpperCase()}</span>}
  </div>;
}

function DraftTimeline({ game }: { game: EsportsGame }) {
  if (game.draft_coverage === "none") return <div className="rounded-lg border border-dashed border-edge-2 p-4 text-xs text-mute">No draft events are available for this game in Aerena.</div>;
  if (game.draft_coverage === "ambiguous") return <div className="rounded-lg border border-amber/25 bg-amber/5 p-4 text-xs text-amber">The source draft contains conflicting or incomplete slots. Its sequence is not displayed as fact.</div>;
  return <div>
    <p className="text-[11px] text-faint leading-relaxed mb-3">{game.draft_coverage === "complete" ? "Sequence and sides follow Aerena’s reported draft configuration." : "Partial source data. Pick and ban order are shown separately; a combined sequence is unknown."}{game.draft_fetched_at ? ` Draft saved ${esportsDate(game.draft_fetched_at)}.` : ""}</p>
    <div className="grid sm:grid-cols-2 gap-1.5">{game.draft.map((event) => <div key={`${event.kind}-${event.source_order}`} className="flex items-center gap-2.5 rounded-lg bg-raised/70 border border-edge/70 px-2.5 py-2 min-w-0">
      <span className="w-5 text-center text-[10px] font-black tabular-nums text-faint">{event.sequence ?? `${event.kind === "Ban" ? "B" : "P"}${event.source_order}`}</span>
      {event.hero_name ? <HeroImg key={`${event.hero_id}-${event.hero_name}`} name={event.hero_name} size={32} className="rounded-full" />
        : <span className="h-8 w-8 rounded-full bg-overlay border border-edge flex items-center justify-center text-faint"><CircleSlash2 size={14} /></span>}
      <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold truncate">{event.hero_name || "Unknown hero"}</span><span className="block text-[9px] text-faint truncate">{event.player_ign || (event.kind === "Ban" ? "Ban" : "Player not listed")}</span></span>
      <span className={`text-[9px] uppercase font-extrabold tracking-wide ${event.kind === "Ban" ? "text-crim" : "text-leaf"}`}>{event.kind}</span>
      <span className="text-[9px] uppercase font-bold text-faint w-8 text-right">{event.side || "—"}</span>
    </div>)}</div>
  </div>;
}

function Comparison({ game }: { game: EsportsGame }) {
  const metrics: [string, keyof EsportsTeam][] = [["Kills", "teamKills"], ["Gold", "teamGold"], ["Turtles", "teamTurtles"], ["Lords", "teamLords"], ["Damage dealt", "teamDmgDealt"]];
  return <div className="rounded-xl border border-edge bg-raised/40 overflow-hidden">
    <div className="grid grid-cols-[1fr_92px_1fr] gap-2 items-center px-3 py-2.5 border-b border-edge text-[10px] font-extrabold uppercase tracking-wide"><span className="truncate text-sky">{teamCode(game.team1)}</span><span className="text-center text-faint">Game {game.number}</span><span className="truncate text-right text-crim">{teamCode(game.team2)}</span></div>
    {metrics.map(([label, key]) => <div key={key} className="grid grid-cols-[1fr_92px_1fr] gap-2 px-3 py-2 text-[11px] border-b last:border-0 border-edge/50 tabular-nums"><strong>{esportsNumber(game.team1[key] as number | null)}</strong><span className="text-center text-faint">{label}</span><strong className="text-right">{esportsNumber(game.team2[key] as number | null)}</strong></div>)}
  </div>;
}

function MatchAnalysis({ matchId, configured }: { matchId: string; configured: boolean }) {
  const [question, setQuestion] = useState("What stands out in this match, and what can we actually infer?");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EsportsAnalysis | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true); setError(null); setResult(null);
    try { setResult(await api.post<EsportsAnalysis>(`/esports/matches/${encodeURIComponent(matchId)}/analysis`, { question: question.trim() })); }
    catch (err) { setError(err instanceof Error ? err.message : "Analysis failed."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-leaf/20 bg-gradient-to-br from-leaf/[0.07] via-panel to-panel p-4 sm:p-5">
    <div className="flex items-start gap-3 mb-3"><div className="rounded-lg bg-leaf/10 p-2 text-leaf"><Sparkles size={16} /></div><div><h3 className="font-extrabold text-sm">Ask 9 Clover AI</h3><p className="text-[11px] text-mute mt-1">Match analysis grounded in saved Aerena evidence, not invented coach quotes.</p></div></div>
    <form onSubmit={submit} className="space-y-2.5"><label className="sr-only" htmlFor="match-question">Your match question</label><textarea id="match-question" className="input min-h-[72px] resize-y !text-xs" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} />
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-faint leading-relaxed max-w-[520px]">{configured ? "Your question and this public match’s saved facts are sent to DeepSeek. No private Archive or team data is included automatically." : "DeepSeek is not configured. You can still generate a facts-only summary; no question is sent externally."}</span>
        <button type="submit" className="btn-leaf shrink-0 !text-[11px]" disabled={busy || !question.trim()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {configured ? "Analyze match" : "Show facts"}</button></div>
    </form>
    <ErrorNote error={error} />
    {result && <div className="mt-4 rounded-lg bg-ink/50 border border-edge p-3.5"><div className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-leaf mb-2">{result.mode === "deepseek" ? "Grounded analysis" : "Facts only"}</div><div className="text-xs text-text/90 leading-relaxed whitespace-pre-wrap">{result.answer}</div>
      <div className="mt-3 pt-3 border-t border-edge text-[10px] text-faint leading-relaxed">{result.note} <a href={result.source_url} target="_blank" rel="noreferrer" className="text-mute hover:text-leaf underline">Source: Aerena <ArrowUpRight size={10} className="inline" /></a>{result.fetched_at ? ` · saved ${esportsDate(result.fetched_at)}` : ""}</div></div>}
  </section>;
}

export function EsportsMatchModal({ matchId, aiConfigured, onClose }: { matchId: string; aiConfigured: boolean; onClose: () => void }) {
  const [detail, setDetail] = useState<EsportsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gameNumber, setGameNumber] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<EsportsDetail>(`/esports/matches/${encodeURIComponent(matchId)}`).then((data) => {
      if (alive) { setDetail(data); setGameNumber(data.games[0]?.number ?? null); }
    }).catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Could not load match."); });
    return () => { alive = false; };
  }, [matchId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const game = detail?.games.find((item) => item.number === gameNumber);
  const winnerName = game?.winner.teamName || game?.winner.teamCode ||
    (game?.winner.team && game.winner.team === game.team1.team ? teamCode(game.team1) :
      game?.winner.team && game.winner.team === game.team2.team ? teamCode(game.team2) : "Not recorded");
  return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label="Match details">
    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
    <div className="relative w-full sm:max-w-4xl max-h-[94dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-edge-2 bg-panel shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-edge"><div className="min-w-0"><div className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-crim">Match intelligence</div><div className="text-[11px] text-faint truncate mt-0.5">{detail?.match.league_name || matchId}</div></div><button onClick={onClose} className="btn-ghost !p-2" aria-label="Close match details"><X size={16} /></button></div>
      <div className="overflow-y-auto p-4 sm:p-6 space-y-5">
        {!detail && !error && <Spinner label="Loading match details" />}
        <ErrorNote error={error} />
        {detail && <>
          <div className="rounded-xl border border-edge bg-gradient-to-r from-sky/[0.07] via-raised to-crim/[0.08] px-4 py-5">
            <div className="text-center text-[10px] text-faint font-bold uppercase tracking-[0.14em] mb-4">{detail.match.stage || "Match"} · {detail.match.format || "Format TBC"} · {esportsDate(detail.match.starts_at)}</div>
            <div className="flex items-center justify-center gap-3 sm:gap-6"><div className="flex items-center gap-2.5 min-w-0 flex-1 justify-end"><span className="font-extrabold text-right text-xs sm:text-base truncate">{teamCode(detail.match.team1)}</span><TeamMark team={detail.match.team1} size={50} /></div>
              <div className="text-center font-black tabular-nums text-xl sm:text-2xl min-w-[65px]">{detail.match.status === "completed" ? <>{esportsNumber(detail.match.team1.teamScore)} <span className="text-faint text-sm">:</span> {esportsNumber(detail.match.team2.teamScore)}</> : <span className="text-faint text-xs tracking-widest">VS</span>}</div>
              <div className="flex items-center gap-2.5 min-w-0 flex-1"><TeamMark team={detail.match.team2} size={50} /><span className="font-extrabold text-xs sm:text-base truncate">{teamCode(detail.match.team2)}</span></div></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-faint"><span>Match saved {esportsDate(detail.match.fetched_at)}{detail.match.detail_fetched_at ? ` · Player details saved ${esportsDate(detail.match.detail_fetched_at)}` : ""} · {detail.match.source_verified ? "Marked verified by source" : "Not independently verified"}</span><a href={detail.match.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-mute hover:text-crim">View on Aerena <ArrowUpRight size={12} /></a></div>
          {detail.detail_error && <div className="rounded-lg border border-amber/25 bg-amber/5 px-3 py-2 text-[11px] text-amber">{detail.detail_error} Showing the saved match data.</div>}
          {detail.games.length > 0 ? <>
            <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[10px] font-extrabold uppercase tracking-[0.17em] text-mute">Game breakdown</div><div className="text-[10px] text-faint mt-1">Drafts and stats when the source provides them</div></div><div className="flex flex-wrap gap-1">{detail.games.map((item) => <button key={item.id} onClick={() => setGameNumber(item.number)} className={`rounded-md px-3 py-1.5 text-[10px] font-extrabold border ${gameNumber === item.number ? "border-crim/50 bg-crim/10 text-text" : "border-edge text-faint hover:text-text"}`}>GAME {item.number}</button>)}</div></div>
            {game && <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4"><Comparison game={game} /><div className="rounded-xl border border-edge bg-raised/30 p-4"><div className="flex items-center justify-between"><div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-mute">Game notes</div><Clock3 size={14} className="text-faint" /></div>
                <div className="mt-4 flex items-center justify-between text-xs"><span className="text-faint">Duration</span><strong>{gameDuration(game.duration_seconds)}</strong></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-faint">Winner</span><strong>{winnerName}</strong></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-faint">Draft coverage</span><strong className={game.draft_coverage === "complete" ? "text-leaf" : "text-amber"}>{game.draft_coverage === "complete" ? "20 source slots" : game.draft_coverage === "none" ? "Not available" : game.draft_coverage === "ambiguous" ? "Unclear" : "Partial"}</strong></div></div></div>
              <div><div className="flex items-center gap-2 mb-3"><Swords size={14} className="text-crim" /><h3 className="text-[10px] uppercase tracking-[0.16em] font-extrabold text-mute">Draft sequence</h3></div><DraftTimeline game={game} /></div>
              <div><div className="flex items-center gap-2 mb-3"><Activity size={14} className="text-crim" /><h3 className="text-[10px] uppercase tracking-[0.16em] font-extrabold text-mute">Player statistics</h3></div>
                {game.player_stats.length ? <div className="overflow-x-auto rounded-xl border border-edge"><table className="w-full text-left text-[11px]"><thead className="bg-raised text-faint uppercase tracking-wider"><tr><th className="p-3">Player</th><th className="p-3">Team</th><th className="p-3">Hero</th><th className="p-3">Role</th><th className="p-3 text-right whitespace-nowrap">K / D / A</th><th className="p-3 text-right">Gold</th><th className="p-3 text-right whitespace-nowrap">Dmg dealt</th><th className="p-3 text-right">KP</th></tr></thead><tbody>{game.player_stats.map((stat) => <tr key={stat.id} className="border-t border-edge/70"><td className="p-3 font-bold whitespace-nowrap">{stat.ign || "Unknown"} {stat.isMVP && <span className="text-[9px] text-leaf">MVP</span>}</td><td className="p-3 whitespace-nowrap text-mute">{stat.team_id && stat.team_id === game.team1.team ? teamCode(game.team1) : stat.team_id && stat.team_id === game.team2.team ? teamCode(game.team2) : "—"}</td><td className="p-3 whitespace-nowrap">{stat.hero_name || "Unknown"}</td><td className="p-3 text-mute">{stat.position || "—"}</td><td className="p-3 text-right tabular-nums whitespace-nowrap">{esportsNumber(stat.kills)} / {esportsNumber(stat.deaths)} / {esportsNumber(stat.assists)}</td><td className="p-3 text-right tabular-nums">{esportsNumber(stat.gold)}</td><td className="p-3 text-right tabular-nums">{esportsNumber(stat.dmgDealt)}</td><td className="p-3 text-right tabular-nums">{stat.killParticipation != null ? `${Math.round(stat.killParticipation * 100)}%` : "—"}</td></tr>)}</tbody></table></div>
                  : <div className="rounded-lg border border-dashed border-edge-2 p-4 text-xs text-mute">Player statistics are not available in the saved match detail.</div>}</div>
            </div>}
          </> : <div className="rounded-xl border border-dashed border-edge-2 p-5 text-center text-xs text-mute">No game breakdown is available for this match yet.</div>}
          <MatchAnalysis matchId={matchId} configured={aiConfigured} /><p className="text-[10px] text-faint leading-relaxed">{detail.source_note}</p>
        </>}
      </div>
    </div>
  </div>;
}

/** Analyze an explicit small sample from the currently displayed public results. */
export function SceneAnalysisPanel({ matches, configured }: { matches: EsportsMatch[]; configured: boolean }) {
  const [question, setQuestion] = useState("What can we learn from these matches? Separate observations from unknowns.");
  const [result, setResult] = useState<EsportsSceneAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestVersion = useRef(0);
  const ids = matches.slice(0, 8).map((match) => match.id);
  const scopeKey = ids.join("|");
  useEffect(() => {
    requestVersion.current += 1;
    setResult(null); setError(null); setBusy(false);
    return () => { requestVersion.current += 1; };
  }, [scopeKey]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || !ids.length || busy) return;
    const version = ++requestVersion.current;
    setBusy(true); setResult(null); setError(null);
    try {
      const response = await api.post<EsportsSceneAnalysis>("/esports/analysis", { question: question.trim(), match_ids: ids });
      if (requestVersion.current === version) setResult(response);
    } catch (err) {
      if (requestVersion.current === version) setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      if (requestVersion.current === version) setBusy(false);
    }
  }
  return <details className="group rounded-xl border border-leaf/20 bg-gradient-to-r from-leaf/[0.06] to-panel overflow-hidden">
    <summary className="cursor-pointer list-none flex items-center gap-3 p-3.5"><span className="rounded-lg bg-leaf/10 text-leaf p-2"><Sparkles size={15} /></span><span className="flex-1 min-w-0"><span className="block text-xs font-extrabold">Ask 9 Clover AI</span><span className="block text-[10px] text-faint mt-1">Analyze a small sample of the matches shown below</span></span><span className="text-[10px] font-bold text-mute group-open:hidden">OPEN +</span><span className="text-[10px] font-bold text-mute hidden group-open:block">CLOSE −</span></summary>
    <div className="border-t border-edge/80 p-3.5 sm:p-4"><form onSubmit={submit} className="space-y-2.5"><label htmlFor="scene-question" className="sr-only">Question about the visible matches</label><textarea id="scene-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} className="input min-h-[68px] resize-y !text-xs" />
      <p className="text-[10px] text-faint leading-relaxed">Uses up to the first 8 matches in the current filter ({ids.length} selected), not a complete season. {configured ? "Your question and their saved public Aerena facts are sent to DeepSeek; private Archive and team data are not included automatically." : "DeepSeek is not configured; only a facts-only summary is available and no question is sent externally."}</p>
      <button className="btn-leaf !text-[11px]" type="submit" disabled={busy || !ids.length || !question.trim()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}{configured ? "Analyze selected matches" : "Show saved facts"}</button></form>
      <ErrorNote error={error} />
      {result && <div className="mt-4 rounded-lg border border-edge bg-ink/50 p-3.5"><div className="text-[9px] uppercase tracking-[0.15em] font-extrabold text-leaf mb-2">{result.mode === "deepseek" ? "Grounded sample analysis" : "Facts only"}</div><div className="text-xs leading-relaxed text-text/90 whitespace-pre-wrap">{result.answer}</div><p className="mt-3 pt-3 border-t border-edge text-[10px] leading-relaxed text-faint">{result.note}</p><div className="flex flex-wrap gap-2 mt-2">{result.sources.map((source) => <a key={source.match_id} href={source.source_url} target="_blank" rel="noreferrer" className="text-[10px] text-mute underline hover:text-leaf">{source.match_id} <ArrowUpRight size={10} className="inline" /></a>)}</div></div>}
    </div>
  </details>;
}
