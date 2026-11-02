import { useEffect, useRef, useState } from "react";
import { Loader2, PackageSearch, X } from "lucide-react";
import { HeroImg } from "./HeroImg";
import { RoneMatchCard, RoneTeamLogo } from "./RoneMatchCard";
import { ErrorNote, Spinner } from "./ui";
import { esportsNumber } from "../lib/esports";
import { intel, intelRaw, stripTags, type AnyRec, type Records } from "../lib/mlbb";
import { parseRoneGames, type RoneGameTeam, type RoneItem, type RoneMatch, type RonePlayer } from "../lib/roneEsports";

type ItemDetail = { id: string; name: string; description: string; tips: string; loading: boolean };

function PlayerCard({ player, onItem }: { player: RonePlayer; onItem: (item: RoneItem) => void }) {
  const fields: [string, number | null][] = [["Gold", player.gold], ["Damage dealt", player.damageDealt], ["Damage taken", player.damageTaken], ["Tower damage", player.towerDamage]];
  return <div className="rounded-lg border border-edge bg-ink/30 p-3 min-w-0">
    <div className="flex items-center gap-2.5"><HeroImg name={player.hero || ""} size={42} className="rounded-lg shrink-0" />
      <div className="min-w-0 flex-1"><div className="text-[12px] font-extrabold break-words">{player.name}</div><div className="text-[10px] text-mute break-words mt-0.5">{player.hero || "Hero not provided"}</div></div>
      <div className="text-right tabular-nums shrink-0"><div className="text-[9px] text-faint font-bold">K / D / A</div><div className="text-[12px] font-black">{esportsNumber(player.kills)} / {esportsNumber(player.deaths)} / {esportsNumber(player.assists)}</div></div></div>
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3">{fields.map(([label, value]) => <div key={label} className="flex justify-between gap-2 text-[10px]"><span className="text-faint">{label}</span><strong className="tabular-nums text-mute">{esportsNumber(value)}</strong></div>)}</div>
    {player.items.length > 0 && <div className="mt-3 pt-2.5 border-t border-edge/70"><div className="text-[9px] uppercase tracking-wide font-bold text-faint mb-1.5">Equipment · tap for details</div>
      <div className="flex flex-wrap gap-1.5">{player.items.map((item, index) => <button type="button" key={`${item.id}-${index}`} onClick={() => onItem(item)} aria-label={`Open equipment ${item.id}`}
        className="relative w-8 h-8 rounded-md border border-edge-2 bg-raised flex items-center justify-center overflow-hidden hover:border-leaf/60">
        <span className="text-[8px] text-faint">{item.id}</span>{item.image && <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
      </button>)}</div></div>}
  </div>;
}

function GameTeam({ side, onItem }: { side: RoneGameTeam; onItem: (item: RoneItem) => void }) {
  const stats: [string, number | null][] = [["Kills", side.kills], ["Gold", side.gold], ["Turtles", side.turtles], ["Lords", side.lords], ["Towers", side.towers]];
  return <section className="rounded-xl border border-edge bg-raised/30 p-3 sm:p-4">
    <div className="flex items-center gap-2.5 mb-3"><RoneTeamLogo team={side.team} size={42} /><div className="min-w-0"><h3 className="font-extrabold text-sm break-words">{side.team.name}</h3>{side.team.fullName && side.team.fullName !== side.team.name && <p className="text-[10px] text-faint break-words">{side.team.fullName}</p>}</div></div>
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">{stats.map(([label, value]) => <div key={label} className="rounded-md bg-ink/40 border border-edge/70 px-2 py-2"><div className="text-[9px] text-faint font-bold uppercase tracking-wide">{label}</div><div className="text-[12px] font-black tabular-nums mt-1">{esportsNumber(value)}</div></div>)}</div>
    {side.players.length ? <div className="grid md:grid-cols-2 gap-2">{side.players.map((player, index) => <PlayerCard key={`${player.name}-${index}`} player={player} onItem={onItem} />)}</div>
      : <p className="text-[11px] text-faint">Player statistics were not provided for this team.</p>}
  </section>;
}

export function RoneMatchDetails({ region, match, onClose }: { region: string; match: RoneMatch; onClose: () => void }) {
  const [games, setGames] = useState<ReturnType<typeof parseRoneGames> | null>(null);
  const [gameIndex, setGameIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<ItemDetail | null>(null);
  const itemRequest = useRef(0);

  useEffect(() => {
    let alive = true;
    if (!match.id) { setGames([]); return; }
    intelRaw(`esports/${region}/matches/${encodeURIComponent(match.id)}`)
      .then((data) => { if (alive) setGames(parseRoneGames(data)); })
      .catch(() => { if (alive) setError("Rone could not load the game breakdown. The match card above is still available."); });
    return () => { alive = false; itemRequest.current += 1; };
  }, [region, match.id]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (item) { itemRequest.current += 1; setItem(null); } else onClose();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [item, onClose]);

  async function openItem(selected: RoneItem) {
    const requestId = ++itemRequest.current;
    setItem({ id: selected.id, name: `Equipment ${selected.id}`, description: "", tips: "", loading: true });
    try {
      const data = await intel<Records<AnyRec>>("academy/equipment/expanded", { size: 300, index: 1 }, 10 * 60_000);
      const hit = (data.records ?? []).map((row) => row.data).find((row) => String(row?.equipid ?? "") === selected.id);
      if (requestId !== itemRequest.current) return;
      const name = typeof hit?.equipname === "string" ? stripTags(hit.equipname) : `Equipment ${selected.id}`;
      const description = typeof hit?.equipskilldesc === "string" ? stripTags(hit.equipskilldesc) : "";
      const tips = typeof hit?.equiptips === "string" ? stripTags(hit.equiptips) : "";
      setItem({ id: selected.id, name, description, tips, loading: false });
    } catch {
      if (requestId === itemRequest.current) setItem({ id: selected.id, name: `Equipment ${selected.id}`, description: "", tips: "", loading: false });
    }
  }

  const game = games?.[gameIndex];
  return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="rone-match-title">
    <div className="absolute inset-0 bg-black/75" onClick={onClose} />
    <div className="relative w-full max-w-4xl max-h-[94dvh] flex flex-col rounded-t-xl sm:rounded-xl border border-edge-2 bg-panel shadow-2xl">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-edge"><div className="min-w-0"><div className="text-[9px] uppercase tracking-[0.18em] font-extrabold text-crim">Rone match breakdown</div><h2 id="rone-match-title" className="text-sm font-black break-words mt-1">{match.team1.name} vs {match.team2.name}</h2></div>
        <button type="button" onClick={onClose} className="btn-ghost !p-2" aria-label="Close match details"><X size={16} /></button></div>
      <div className="overflow-y-auto p-4 sm:p-5 space-y-4">
        <RoneMatchCard match={match} compact />
        {games === null && !error && <Spinner label="Loading Rone match details" />}
        <ErrorNote error={error} />
        {games && games.length === 0 && <div className="rounded-lg border border-dashed border-edge-2 p-4 text-[11px] text-mute">No per-game statistics are available for this match in the Rone feed.</div>}
        {games && games.length > 0 && <>
          <div className="flex flex-wrap justify-between items-center gap-3"><div><h3 className="text-[10px] uppercase tracking-[0.16em] font-extrabold text-mute">Game breakdown</h3><p className="text-[10px] text-faint mt-1">Player and team numbers as supplied by Rone.</p></div>
            <div className="flex flex-wrap gap-1">{games.map((entry, index) => <button key={index} type="button" onClick={() => setGameIndex(index)} className={`rounded-md px-3 py-1.5 text-[10px] font-extrabold border ${gameIndex === index ? "border-crim/50 bg-crim/10 text-text" : "border-edge text-faint hover:text-text"}`}>GAME {entry.number ?? index + 1}</button>)}</div></div>
          {game && <div className="space-y-3"><div className="text-[10px] text-faint">Duration: <strong className="text-mute">{game.duration || "Not provided"}</strong>{game.durationEstimated ? " (estimated by source)" : ""}</div>
            {game.teams.length ? game.teams.map((side, index) => <GameTeam key={`${side.team.name}-${index}`} side={side} onItem={(selected) => void openItem(selected)} />)
              : <div className="text-[11px] text-faint">Team statistics are not provided for this game.</div>}</div>}
        </>}
        <p className="text-[10px] text-faint leading-relaxed">Rone is a community data source. Statistics and equipment are shown only where supplied; this feed does not establish a verified pick/ban order.</p>
      </div>
    </div>
    {item && <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-5" role="dialog" aria-modal="true" aria-label="Equipment details">
      <div className="absolute inset-0 bg-black/75" onClick={() => { itemRequest.current += 1; setItem(null); }} />
      <div className="relative w-full max-w-lg rounded-t-xl sm:rounded-xl border border-edge-2 bg-panel p-4 sm:p-5">
        <div className="flex justify-between items-start gap-3"><div><div className="text-[10px] font-extrabold text-leaf uppercase tracking-[0.16em]">Equipment details</div><h3 className="text-sm font-black mt-1 break-words">{item.name}</h3></div><button type="button" className="btn-ghost !p-2" aria-label="Close equipment details" onClick={() => { itemRequest.current += 1; setItem(null); }}><X size={15} /></button></div>
        {item.loading ? <div className="flex items-center gap-2 text-[11px] text-faint py-5"><Loader2 size={14} className="animate-spin" /> Loading description…</div>
          : <div className="mt-4 rounded-lg border border-edge bg-raised p-3 text-[11px] text-mute whitespace-pre-line max-h-[50dvh] overflow-y-auto leading-relaxed">{item.tips && <div className="text-leaf font-bold mb-2">{item.tips}</div>}{item.description || <span className="flex gap-2 items-start"><PackageSearch size={14} className="shrink-0" /> The source did not provide a description for this equipment right now.</span>}</div>}
      </div>
    </div>}
  </div>;
}
