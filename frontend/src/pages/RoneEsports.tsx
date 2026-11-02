import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Globe2, Search, Trophy } from "lucide-react";
import { RoneMatchCard, RoneTeamLogo } from "../components/RoneMatchCard";
import { RoneMatchDetails } from "../components/RoneMatchDetails";
import { Empty, ErrorNote, PageTitle, Spinner, Tabs } from "../components/ui";
import { esportsNumber } from "../lib/esports";
import { intelRaw } from "../lib/mlbb";
import { parseRoneFeed, type RoneFeed, type RoneMatch, type RoneSeed, type RoneStanding, type RoneTeam } from "../lib/roneEsports";

const REGIONS = [
  { id: "id", league: "MPL ID" }, { id: "ph", league: "MPL PH" },
  { id: "my", league: "MPL MY" }, { id: "kh", league: "MPL KH" },
];
type View = "schedule" | "standings" | "playoffs";

function winsLosses(wins: number | null, losses: number | null): string {
  return wins === null || losses === null ? "—" : `${esportsNumber(wins)}–${esportsNumber(losses)}`;
}
function teamMatches(team: RoneTeam, needle: string): boolean {
  return `${team.name} ${team.fullName || ""}`.toLowerCase().includes(needle);
}

function StandingCard({ row }: { row: RoneStanding }) {
  const fields = [["Match W–L", winsLosses(row.matchWins, row.matchLosses)], ["Game W–L", winsLosses(row.gameWins, row.gameLosses)],
    ["Game diff", row.netGames === null ? "—" : `${row.netGames > 0 ? "+" : ""}${esportsNumber(row.netGames)}`]];
  return <article className="rounded-xl border border-edge bg-panel p-4">
    <div className="flex items-center gap-3"><span className="text-sm text-faint font-black tabular-nums w-6">{row.rank === null ? "—" : `#${row.rank}`}</span>
      <RoneTeamLogo team={row.team} size={58} /><div className="min-w-0 flex-1"><div className="font-black text-sm break-words">{row.team.name}</div>
        {row.team.fullName && row.team.fullName.toLowerCase() !== row.team.name.toLowerCase() && <div className="text-[10px] text-mute leading-snug break-words mt-1">{row.team.fullName}</div>}</div>
      <div className="text-right shrink-0"><div className="text-xl font-black tabular-nums">{esportsNumber(row.points)}</div><div className="text-[9px] font-bold uppercase text-faint">points</div></div></div>
    <div className="grid grid-cols-3 gap-2 border-t border-edge mt-4 pt-3">{fields.map(([label, value]) => <div key={label}><div className="text-[9px] text-faint font-bold uppercase tracking-wide">{label}</div><div className="text-xs font-black tabular-nums mt-1">{value}</div></div>)}</div>
  </article>;
}

function SeedCard({ row }: { row: RoneSeed }) {
  return <div className="rounded-lg border border-edge bg-panel p-3 flex items-center gap-2.5 min-w-0">
    <span className="text-[11px] text-crim font-black w-5 shrink-0">{row.seed === null ? "—" : `#${row.seed}`}</span><RoneTeamLogo team={row.team} size={48} />
    <div className="min-w-0"><div className="text-[11px] font-extrabold break-words">{row.team.name}</div><div className="text-[10px] text-faint mt-1">{winsLosses(row.wins, row.losses)} matches</div></div>
  </div>;
}

function Bracket({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <section className="rounded-xl border border-edge bg-panel overflow-hidden">
    <div className="flex flex-wrap justify-between items-center gap-2 px-4 py-3 border-b border-edge"><div><h2 className="text-[11px] font-black uppercase tracking-[0.14em]">Playoff bracket</h2><p className="text-[10px] text-faint mt-1">Image supplied by Rone · scroll to see the full bracket</p></div>
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-mute hover:text-leaf inline-flex items-center gap-1">Open full size <ExternalLink size={11} /></a></div>
    {failed ? <div className="p-4 text-[11px] text-mute">The bracket image couldn’t load. Seeds and available matches are shown below.</div>
      : <div className="overflow-x-auto bg-[#18181d] p-3"><img src={url} alt="Playoff bracket from Rone" referrerPolicy="no-referrer" className="block w-full min-w-[620px] h-auto rounded-lg" onError={() => setFailed(true)} /></div>}
  </section>;
}

export function RoneEsportsPage() {
  const [region, setRegion] = useState("ph");
  const [view, setView] = useState<View>("schedule");
  const [feed, setFeed] = useState<RoneFeed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [week, setWeek] = useState<number | null>(null);
  const [selected, setSelected] = useState<RoneMatch | null>(null);

  useEffect(() => {
    let live = true;
    setErr(null); setFeed(null); setWeek(null); setSelected(null);
    intelRaw(`esports/${region}/${view}`)
      .then((payload) => { if (live) setFeed(parseRoneFeed(payload)); })
      .catch(() => { if (live) setErr("The Rone feed couldn’t load from this server. Try again or choose another region."); });
    return () => { live = false; };
  }, [region, view, retry]);

  const league = useMemo(() => REGIONS.find((item) => item.id === region)?.league ?? region.toUpperCase(), [region]);
  const needle = query.trim().toLowerCase();
  const weeks = [...new Set((feed?.groups ?? []).map((group) => group.week).filter((value): value is number => value !== null))];
  const groups = (feed?.groups ?? []).filter((group) => week === null || group.week === week).map((group) => ({
    ...group, matches: group.matches.filter((match) => !needle || teamMatches(match.team1, needle) || teamMatches(match.team2, needle)
      || `${match.id || ""} ${match.round || ""} ${group.label}`.toLowerCase().includes(needle)),
  })).filter((group) => group.matches.length > 0);
  const standings = (feed?.standings ?? []).filter((item) => !needle || teamMatches(item.team, needle));
  const seeds = (feed?.seeds ?? []).filter((item) => !needle || teamMatches(item.team, needle));
  const hasSourceData = view === "standings" ? Boolean(feed?.standings.length) : view === "playoffs"
    ? Boolean(feed?.groups.length || feed?.seeds.length || feed?.bracketImage) : Boolean(feed?.groups.length);

  return <div className="space-y-5 pb-7">
    <PageTitle title="Rone esports" sub="MPL fixtures, standings and playoffs from a community data feed." />
    <div className="flex flex-wrap gap-1.5">{REGIONS.map((item) => <button key={item.id} onClick={() => setRegion(item.id)}
      className={`chip !px-3 !py-1.5 ${region === item.id ? "border-leaf/60 text-leaf bg-leaf-dim/40" : "text-faint"}`}><Globe2 size={12} /> {item.league}</button>)}</div>
    <Tabs value={view} onChange={(value) => { setView(value as View); setQuery(""); }} tabs={[
      { id: "schedule", label: "Schedule" }, { id: "standings", label: "Standings" }, { id: "playoffs", label: "Playoffs" },
    ]} />
    {err && <div className="space-y-2"><ErrorNote error={err} /><button type="button" className="btn-ghost !text-[11px]" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
    {!feed && !err && <Spinner label={`Loading ${league} ${view}`} />}
    {feed && <>
      {hasSourceData && <label className="relative block max-w-sm"><span className="sr-only">Search teams or matches</span><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><input className="input !pl-9 !text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teams or matches" /></label>}
      {view === "schedule" && weeks.length > 1 && <div className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Schedule weeks"><button type="button" onClick={() => setWeek(null)} className={`chip shrink-0 !px-2.5 !py-1.5 ${week === null ? "border-crim/50 text-text" : "text-faint"}`}>All weeks</button>
        {weeks.map((value) => <button type="button" key={value} onClick={() => setWeek(value)} className={`chip shrink-0 !px-2.5 !py-1.5 ${week === value ? "border-crim/50 text-text" : "text-faint"}`}>Week {value}</button>)}</div>}
      {view === "playoffs" && feed.bracketImage && <Bracket url={feed.bracketImage} />}
      {view === "playoffs" && seeds.length > 0 && <section><div className="flex items-center gap-2 mb-3"><Trophy size={14} className="text-crim" /><h2 className="text-[11px] font-black uppercase tracking-[0.15em] text-mute">Playoff seeds</h2></div>
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 gap-2">{seeds.map((row, index) => <SeedCard key={`${row.seed}-${index}`} row={row} />)}</div></section>}
      {view === "standings" && standings.length > 0 && <div className="grid lg:grid-cols-2 gap-3">{standings.map((row, index) => <StandingCard key={`${row.rank}-${index}`} row={row} />)}</div>}
      {view !== "standings" && groups.map((group) => <section key={group.key}>
        <div className="flex flex-wrap items-center gap-2 mb-3"><span className="w-1 h-4 rounded-full bg-crim" /><h2 className="text-[11px] font-black uppercase tracking-[0.12em] text-mute">{group.week !== null ? `Week ${group.week} · ` : ""}{group.label}</h2></div>
        <div className="grid lg:grid-cols-2 gap-3">{group.matches.map((match, index) => <RoneMatchCard key={`${match.id || "no-id"}-${index}`} match={match} onOpen={match.id ? () => setSelected(match) : undefined} />)}</div>
      </section>)}
      {!hasSourceData && <Empty title={`No ${view} data for ${league} right now`} hint="The community feed has not provided this data." />}
      {hasSourceData && view === "playoffs" && !feed.groups.length && <div className="rounded-lg border border-dashed border-edge-2 p-4 text-[11px] text-mute">No playoff matches have been published in this feed yet.</div>}
      {hasSourceData && needle && !groups.length && !standings.length && !seeds.length && <Empty title="No matching teams or matches" hint="Try a different search." />}
      {view === "schedule" && hasSourceData && !needle && week !== null && !groups.length && <Empty title="No matches in this week" />}
    </>}
    <p className="text-[10.5px] text-faint leading-relaxed border-t border-edge/60 pt-3">Community data feed — fixtures, images and results only where Rone supplies them; not official Moonton/MPL output. Team logos and bracket images are fetched from Rone’s image hosts.</p>
    {selected && <RoneMatchDetails key={`${region}-${selected.id}`} region={region} match={selected} onClose={() => setSelected(null)} />}
  </div>;
}
