import type { Draft } from "../lib/types";
import { HeroImg } from "./HeroImg";

const LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"];

function Bans({ bans, ours }: { bans?: (string | null)[]; ours: boolean }) {
  const list = (bans ?? []).concat([null, null, null, null, null]).slice(0, 5);
  return (
    <div>
      <div className={`label mb-2.5 ${ours ? "text-leaf/80" : "text-crim/80"}`}>
        {ours ? "Our bans" : "Enemy bans"}
      </div>
      <ol className="flex flex-wrap gap-2.5">
        {list.map((b, i) => (
          <li key={i} className="flex flex-col items-center gap-1.5 w-12">
            <span className={b ? "opacity-90" : "opacity-30"}>
              <HeroImg name={b ?? "?"} size={40} className={`rounded-lg border ${ours ? "border-leaf/25" : "border-crim/25"}`} />
            </span>
            <span className={`text-[10px] font-semibold text-center leading-tight truncate w-full ${b ? "line-through decoration-crim/70" : "text-faint"}`}>
              {b || "—"}
            </span>
            <span className="text-faint text-[9px] font-bold tabular-nums -mt-1">{i + 1}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Read-only draft layout: bans either side, lane picks in the middle. */
export function DraftBoard({ draft, oursLabel = "9 CLOVER", theirsLabel = "ENEMY" }: {
  draft?: Draft; oursLabel?: string; theirsLabel?: string;
}) {
  const d = draft ?? {};
  const ourPicks = d.our_picks ?? {};
  const theirPicks = d.enemy_picks ?? {};
  return (
    <div className="card p-5 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <Bans bans={d.our_bans} ours />
        <Bans bans={d.enemy_bans} ours={false} />
      </div>
      <div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center text-center mb-2">
          <span className="label text-leaf/90">{oursLabel}</span>
          <span className="label px-2">Lane</span>
          <span className="label text-crim/90">{theirsLabel}</span>
        </div>
        <div className="divide-y divide-edge/60">
          {LANES.map((lane) => {
            const ours = ourPicks[lane]; const theirs = theirPicks[lane];
            return (
              <div key={lane} className="grid grid-cols-[1fr_auto_1fr] items-center py-2.5 text-center">
                <span className="inline-flex flex-col items-center gap-1">
                  {ours ? <HeroImg name={ours} size={36} className="rounded-lg border border-leaf/25" /> : null}
                  <span className="text-[12px] font-semibold leading-tight">{ours || "—"}</span>
                </span>
                <span className="label px-3 w-20">{lane}</span>
                <span className="inline-flex flex-col items-center gap-1">
                  {theirs ? <HeroImg name={theirs} size={36} className="rounded-lg border border-crim/25" /> : null}
                  <span className="text-[12px] font-semibold leading-tight text-mute">{theirs || "—"}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
