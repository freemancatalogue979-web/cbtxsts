import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, ExternalLink } from "lucide-react";
import { esportsDate, esportsNumber } from "../lib/esports";
import type { RoneMatch, RoneTeam } from "../lib/roneEsports";

export function RoneTeamLogo({ team, size = 76 }: { team: RoneTeam; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [team.logo]);
  return <div aria-hidden="true" className="shrink-0 flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.055] overflow-hidden"
    style={{ width: size, height: size }}>
    {team.logo && !failed ? <img src={team.logo} alt="" loading="lazy" referrerPolicy="no-referrer"
      className="w-[86%] h-[86%] object-contain" onError={() => setFailed(true)} />
      : <span className="font-black text-mute text-[12px]">{team.name.slice(0, 4).toUpperCase()}</span>}
  </div>;
}

function MatchTeam({ team, winner }: { team: RoneTeam; winner: boolean }) {
  return <div className="min-w-0 flex flex-col items-center text-center gap-2">
    <RoneTeamLogo team={team} />
    <div className="w-full min-w-0"><div className={`text-sm sm:text-[15px] font-black break-words ${winner ? "text-leaf" : "text-text"}`}>{team.name}</div>
      {winner && <div className="text-[9px] font-extrabold uppercase tracking-wider text-leaf mt-0.5">Winner</div>}
      {team.fullName && team.fullName.toLowerCase() !== team.name.toLowerCase() && <div className="text-[11px] text-mute leading-snug mt-1 break-words">{team.fullName}</div>}</div>
  </div>;
}

export function roneMatchStatus(match: RoneMatch): string {
  const status = match.status.toLowerCase();
  if (["finished", "completed", "complete"].includes(status)) return "Final";
  if (["live", "ongoing", "in_progress"].includes(status)) return "Live";
  if (["scheduled", "upcoming"].includes(status)) return "Scheduled";
  return status === "unknown" ? "Status unknown" : match.status.replace(/_/g, " ");
}

export function RoneMatchCard({ match, onOpen, compact = false, detailsUnavailable }: { match: RoneMatch; onOpen?: () => void; compact?: boolean; detailsUnavailable?: string }) {
  const status = roneMatchStatus(match);
  const hasScore = match.score1 !== null && match.score2 !== null && (status === "Final" || status === "Live" || Boolean(match.winner));
  return <article className="rounded-xl border border-edge bg-panel overflow-hidden">
    <div className="flex flex-wrap justify-between items-center gap-2 border-b border-edge bg-white/[0.025] px-4 py-2.5">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-mute break-words">{match.round || "Match"}{match.bestOf !== null ? ` · BO${match.bestOf}` : ""}</span>
      <span className={`text-[11px] font-black uppercase tracking-[0.14em] ${status === "Final" ? "text-mute" : status === "Live" ? "text-leaf" : "text-amber"}`}>{status}</span>
    </div>
    <div className="grid grid-cols-[minmax(0,1fr)_68px_minmax(0,1fr)] gap-2 items-center px-3 sm:px-4 py-5">
      <MatchTeam team={match.team1} winner={match.winner === "team1"} />
      <div className="text-center self-start pt-4 tabular-nums">
        {hasScore ? <div className="text-xl sm:text-2xl font-black whitespace-nowrap">{esportsNumber(match.score1)} <span className="text-mute text-sm">:</span> {esportsNumber(match.score2)}</div>
          : <div className="text-xs font-black text-mute tracking-[0.16em] pt-1.5">VS</div>}
        <div className="text-[9px] font-bold text-mute uppercase tracking-wide mt-1">{status}</div>
      </div>
      <MatchTeam team={match.team2} winner={match.winner === "team2"} />
    </div>
    <div className="border-t border-edge px-4 py-3 space-y-2">
      <div className="flex items-start gap-1.5 text-[11px] text-mute leading-relaxed"><CalendarDays size={13} className="shrink-0 mt-0.5 text-mute" />
        <span><strong className="text-text">Your time:</strong> {esportsDate(match.startsAt)}{match.localTime && <> <span className="text-mute">·</span> <strong className="text-text">Source local:</strong> {match.localTime}</>}</span></div>
      {match.id && compact && <div className="text-[10px] text-mute break-all">Match ID: {match.id}</div>}
      {(onOpen || match.replay || detailsUnavailable || (!compact && !match.id)) && <div className="flex flex-wrap justify-between items-center gap-2 pt-1">
        {onOpen ? <button type="button" className="text-[11px] font-extrabold text-text hover:text-crim inline-flex items-center gap-1.5" onClick={onOpen}>View match details <ArrowRight size={13} /></button>
          : detailsUnavailable || (!compact && !match.id) ? <span className="text-[10px] text-mute">{detailsUnavailable || (match.idConflict ? "Conflicting source records; details unavailable" : "Match details not provided")}</span> : <span />}
        {match.replay && <a href={match.replay} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-mute hover:text-leaf inline-flex items-center gap-1">Replay <ExternalLink size={11} /></a>}
      </div>}
    </div>
  </article>;
}
