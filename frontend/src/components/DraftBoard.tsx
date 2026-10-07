import type { Draft } from "../lib/types";

const LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"];

function Bans({ bans, ours }: { bans?: (string | null)[]; ours: boolean }) {
  const list = (bans ?? []).concat([null, null, null, null, null]).slice(0, 5);
  return (
    <div>
      <div className={`label mb-1.5 ${ours ? "text-leaf/80" : "text-crim/80"}`}>
        {ours ? "Our bans" : "Enemy bans"}
      </div>
      <ol className="space-y-1">
        {list.map((b, i) => (
          <li key={i} className="flex items-center gap-2 text-[13px]">
            <span className="text-faint text-[10px] font-bold w-3 tabular-nums">{i + 1}.</span>
            <span className={b ? "font-semibold line-through decoration-crim/60" : "text-faint"}>
              {b || "—"}
            </span>
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
    <div className="card p-3.5">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Bans bans={d.our_bans} ours />
        <Bans bans={d.enemy_bans} ours={false} />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center text-center mb-1.5">
        <span className="label text-leaf/90">{oursLabel}</span>
        <span className="label px-2">Lane</span>
        <span className="label text-crim/90">{theirsLabel}</span>
      </div>
      <div className="divide-y divide-edge/60">
        {LANES.map((lane) => (
          <div key={lane} className="grid grid-cols-[1fr_auto_1fr] items-center py-1.5 text-center">
            <span className="text-[13px] font-semibold">{ourPicks[lane] || "—"}</span>
            <span className="label px-2 w-16">{lane}</span>
            <span className="text-[13px] font-semibold text-mute">{theirPicks[lane] || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
