import { Crown } from "lucide-react";
import type { CSSProperties } from "react";
import type { EnemyLine, PlayerLine } from "../lib/types";
import { HeroImg } from "./HeroImg";
import { Ign } from "./ui";

const LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"] as const;
const LANE_NAME: Record<string, string> = { EXP: "Exp", JUNGLE: "Jungle", MID: "Mid", GOLD: "Gold", ROAM: "Roam" };

interface Row { lane: string; name?: string; hero?: string; line?: PlayerLine }

const hasKda = (l?: PlayerLine) => !!l && (l.kills != null || l.deaths != null || l.assists != null);

/** Rating tiers, as the game colours them: 10+ gold, 8+ great, 6+ fine, lower needs work. */
export function ratingTier(rating: number): "gold" | "great" | "fine" | "low" {
  return rating >= 10 ? "gold" : rating >= 8 ? "great" : rating >= 6 ? "fine" : "low";
}

function sum(rows: Row[], key: "kills" | "deaths" | "assists"): number {
  return rows.reduce((total, r) => total + (r.line?.[key] ?? 0), 0);
}

function Team({ side, label, rows, peak, note }: { side: "ours" | "theirs"; label: string; rows: Row[]; peak: number; note?: string }) {
  const stats = rows.some((r) => hasKda(r.line));
  return (
    <section className={`lineup__team lineup__team--${side}`} aria-label={`${label} players`}>
      <header className="lineup__head">
        <span className="lineup__team-name">{label}</span>
        {note && <span className="chip !py-0 !text-[9px] text-amber border-amber/40">{note}</span>}
        {stats && (
          <span className="lineup__totals tabular-nums" aria-label={`${label} kills, deaths and assists`}>
            <b className="lineup__k">{sum(rows, "kills")}</b><i>/</i><b className="lineup__d">{sum(rows, "deaths")}</b><i>/</i><b className="lineup__a">{sum(rows, "assists")}</b>
          </span>
        )}
      </header>
      <ol className="lineup__rows">
        {rows.map((r) => {
          const l = r.line;
          const share = hasKda(l) && peak > 0 ? Math.round((((l!.kills ?? 0) + (l!.assists ?? 0)) / peak) * 100) : 0;
          return (
            <li key={r.lane} data-lane={r.lane} className={`lineup__row${l?.mvp ? " lineup__row--mvp" : ""}`}
              style={{ "--share": `${share}%` } as CSSProperties}>
              <span className="lineup__face">
                {r.hero ? <HeroImg name={r.hero} size={40} className="rounded-[9px]" /> : <span className="lineup__noface" aria-hidden />}
                <span className="lineup__lane">{LANE_NAME[r.lane] ?? r.lane}</span>
              </span>
              <span className="lineup__who">
                <span className="lineup__name">{r.name ? <Ign text={r.name} /> : <span className="text-mute">{r.hero || "Not recorded"}</span>}</span>
                <span className="lineup__hero">{r.name && r.hero ? r.hero : LANE_NAME[r.lane] ?? r.lane}</span>
              </span>
              <span className="lineup__score">
                {hasKda(l) && (
                  <span className="lineup__kda tabular-nums" aria-label={`${l!.kills ?? 0} kills, ${l!.deaths ?? 0} deaths, ${l!.assists ?? 0} assists`}>
                    <b className="lineup__k">{l!.kills ?? 0}</b><i>/</i><b className="lineup__d">{l!.deaths ?? 0}</b><i>/</i><b className="lineup__a">{l!.assists ?? 0}</b>
                  </span>
                )}
                {(l?.rating != null || l?.mvp) && (
                  <span className="lineup__badges">
                    {l?.mvp && <span className="lineup__mvp" title="MVP"><Crown size={10} aria-hidden /> MVP</span>}
                    {l?.rating != null && <span className={`lineup__rating lineup__rating--${ratingTier(l.rating)} tabular-nums`} title="Rating">{l.rating.toFixed(1)}</span>}
                  </span>
                )}
              </span>
              {share > 0 && <span className="lineup__bar" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Who played one game, both teams side by side: hero, IGN, lane, K/D/A, rating and MVP. Read-only. */
export function MatchLineup({ ourLabel = "9 Clover", theirLabel, players, ourPicks, playerStats, enemyStats, enemyPicks, note }: {
  ourLabel?: string; theirLabel: string;
  players?: Record<string, string>; ourPicks?: Record<string, string>; playerStats?: Record<string, PlayerLine>;
  enemyStats?: Record<string, EnemyLine>; enemyPicks?: Record<string, string>; note?: string;
}) {
  const ours: Row[] = LANES.filter((lane) => players?.[lane] || ourPicks?.[lane] || hasKda(playerStats?.[lane]))
    .map((lane) => ({ lane, name: players?.[lane], hero: ourPicks?.[lane], line: playerStats?.[lane] }));
  const theirs: Row[] = LANES.filter((lane) => enemyStats?.[lane] || enemyPicks?.[lane])
    .map((lane) => ({ lane, name: enemyStats?.[lane]?.name, hero: enemyStats?.[lane]?.hero || enemyPicks?.[lane], line: enemyStats?.[lane] }));
  if (!ours.length && !theirs.length) return null;
  // Bars compare kill participation (kills + assists) across all ten players.
  const peak = Math.max(0, ...[...ours, ...theirs].map((r) => (r.line?.kills ?? 0) + (r.line?.assists ?? 0)));
  return (
    <div className="lineup" aria-label="Who played">
      {ours.length > 0 && <Team side="ours" label={ourLabel} rows={ours} peak={peak} note={note} />}
      {ours.length > 0 && theirs.length > 0 && <span className="lineup__vs" aria-hidden>vs</span>}
      {theirs.length > 0 && <Team side="theirs" label={theirLabel || "Enemy"} rows={theirs} peak={peak} />}
    </div>
  );
}
