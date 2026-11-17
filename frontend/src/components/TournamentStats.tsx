import { Users } from "lucide-react";
import type { TournamentStatsT } from "../lib/types";
import { nice } from "../lib/caseText";
import { navigate, pct } from "../lib/util";
import { HeroImg } from "./HeroImg";
import { Empty, SectionTitle, StatTile } from "./ui";

/** Match stats for one tournament (or all of them): series + game records from
 *  the scores, and who played each game with the heroes they were on. */
export function TournamentStats({ stats, title = "Match stats", overall = false, tiles = true, kind = "tournament" }: {
  stats: TournamentStatsT; title?: string; overall?: boolean; tiles?: boolean; kind?: "tournament" | "scrim";
}) {
  const { series, games, players, heroes } = stats;
  const hasKda = players.some((p) => p.kda != null);
  const missing = Math.max(0, games.played - games.with_lineup);
  const tone = (w: number, l: number) => (w > l ? "good" : l > w ? "bad" : undefined);
  return (
    <section aria-label={title} className="space-y-3">
      <SectionTitle right={overall && stats.tournaments != null
        ? <span className="text-[11px] text-faint">{stats.tournaments} {stats.tournaments === 1 ? "tournament" : "tournaments"}</span>
        : undefined}>
        {title}
      </SectionTitle>
      {tiles && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatTile label="Series" value={`${series.wins}–${series.losses}`} hint={`${series.played} played${series.draws ? ` · ${series.draws} draw` : ""}`}
          tone={tone(series.wins, series.losses)} />
        <StatTile label="Series win" value={pct(series.win_rate)} tone={series.win_rate == null ? undefined : series.win_rate >= 50 ? "good" : "bad"} />
        <StatTile label="Games" value={`${games.wins}–${games.losses}`} hint={`${games.played} played`} tone={tone(games.wins, games.losses)} />
        <StatTile label="Game win" value={pct(games.win_rate)} tone={games.win_rate == null ? undefined : games.win_rate >= 50 ? "good" : "bad"} />
      </div>}

      <div className="card p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="section-pill"><Users size={11} className="inline -mt-0.5 mr-1" />Who played</div>
          {missing > 0 && (
            <span className="text-[11px] text-amber">{missing} {missing === 1 ? "game has" : "games have"} no lineup yet</span>
          )}
        </div>
        {players.length === 0 ? (
          <Empty title="No lineups recorded" hint={kind === "scrim"
            ? "Book scrims with a lineup (or set who played on each game) and record the games."
            : games.played
              ? "Open a played match and add who played each game — player stats show here."
              : "Record results, then add who played each game."} />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[12px] min-w-[560px]">
              <thead>
                <tr className="text-left text-faint">
                  <th className="label font-normal px-1 pb-2">Player</th>
                  <th className="label font-normal px-1 pb-2">Lane</th>
                  <th className="label font-normal px-1 pb-2 text-right">Games</th>
                  <th className="label font-normal px-1 pb-2 text-right">W–L</th>
                  <th className="label font-normal px-1 pb-2 text-right">Win</th>
                  {overall && <th className="label font-normal px-1 pb-2 text-right">Series</th>}
                  {hasKda && <th className="label font-normal px-1 pb-2 text-right" title="(kills + assists) / deaths, games with K/D/A recorded">KDA</th>}
                  <th className="label font-normal px-1 pb-2 pl-4">Heroes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/60">
                {players.map((p) => (
                  <tr key={p.user_id}>
                    <td className="px-1 py-2">
                      <button className="font-bold hover:text-sky truncate max-w-40" onClick={() => navigate("players", p.user_id)}>{p.name}</button>
                    </td>
                    <td className="px-1 py-2 text-mute">
                      {nice(p.main_lane) || "—"}
                      {Object.keys(p.lanes).length > 1 && <span className="text-faint"> +{Object.keys(p.lanes).length - 1}</span>}
                    </td>
                    <td className="px-1 py-2 text-right tabular-nums font-bold">{p.games}</td>
                    <td className="px-1 py-2 text-right tabular-nums">
                      <span className={p.wins ? "text-leaf" : "text-faint"}>{p.wins}</span>–<span className={p.losses ? "text-danger" : "text-faint"}>{p.losses}</span>
                    </td>
                    <td className={`px-1 py-2 text-right tabular-nums ${p.win_rate == null ? "text-faint" : p.win_rate >= 50 ? "text-leaf" : "text-danger"}`}>{pct(p.win_rate)}</td>
                    {overall && <td className="px-1 py-2 text-right tabular-nums text-mute">{p.series}</td>}
                    {hasKda && (
                      <td className={`px-1 py-2 text-right tabular-nums ${p.kda == null ? "text-faint" : p.kda >= 3 ? "text-leaf" : p.kda < 2 ? "text-danger" : ""}`}>
                        {p.kda == null ? "—" : p.kda.toFixed(2)}
                      </td>
                    )}
                    <td className="px-1 py-2 pl-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {p.heroes.length === 0 && <span className="text-faint">—</span>}
                        {p.heroes.map((h) => (
                          <span key={h.hero} className="inline-flex items-center gap-1 rounded border border-edge bg-raised/60 pr-1.5"
                            title={`${h.hero}: ${h.games} ${h.games === 1 ? "game" : "games"}, ${h.wins} won`}>
                            <HeroImg name={h.hero} size={20} className="rounded-l" />
                            <span className="text-[10px] tabular-nums text-mute">{h.games}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {heroes.length > 0 && (
        <div className="card p-4">
          <div className="section-pill mb-3">Our most-picked heroes</div>
          <div className="flex flex-wrap gap-2">
            {heroes.map((h) => (
              <span key={h.hero} className="inline-flex items-center gap-2 rounded-lg border border-edge bg-raised/50 pr-2.5">
                <HeroImg name={h.hero} size={30} className="rounded-l-lg" />
                <span className="leading-tight">
                  <span className="block text-[11px] font-bold">{h.hero}</span>
                  <span className="block text-[10px] text-faint tabular-nums">
                    {h.games} {h.games === 1 ? "game" : "games"} · {pct(h.win_rate)}
                  </span>
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
