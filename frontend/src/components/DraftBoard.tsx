import { useState } from "react";
import type { Draft, Hero } from "../lib/types";
import { HeroImg } from "./HeroImg";

const LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"];

export type DraftValue = {
  our_bans?: (string | null)[];
  enemy_bans?: (string | null)[];
  our_picks?: Record<string, string>;
  enemy_picks?: Record<string, string>;
};

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

const STATUS_RANK: Record<string, number> = { META: 0, STRONG: 1, VIABLE: 2, SITUATIONAL: 3, WEAK: 4 };

/** Interactive pro-league slot: hero tile + name; click to open the picker popover. */
function HeroSlot({ heroes, value, onChange, ours, size = 40, strike = false, order }: {
  heroes: Hero[]; value: string; onChange: (v: string) => void;
  ours: boolean; size?: number; strike?: boolean; order?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sorted = [...heroes].sort((a, b) =>
    (STATUS_RANK[a.meta_status] ?? 9) - (STATUS_RANK[b.meta_status] ?? 9) ||
    b.clover_rating - a.clover_rating || b.win_rate - a.win_rate);
  const list = (q ? sorted.filter((h) => h.name.toLowerCase().includes(q.toLowerCase())) : sorted).slice(0, 80);
  return (
    <div className="relative flex flex-col items-center gap-1.5 w-12">
      {open && <div className="fixed inset-0 z-20" onClick={() => { setOpen(false); setQ(""); }} />}
      <button type="button" title={value || "Pick hero"} onClick={() => setOpen((v) => !v)}
        className={`rounded-lg transition hover:scale-105 ${ours ? "hover:ring-1 hover:ring-leaf/50" : "hover:ring-1 hover:ring-crim/50"} ${value ? "" : "opacity-30 hover:opacity-70"}`}>
        <HeroImg name={value || "?"} size={size} className={`rounded-lg border ${ours ? "border-leaf/25" : "border-crim/25"}`} />
      </button>
      <span className={`text-[10px] font-semibold text-center leading-tight truncate w-full ${
        value ? (strike ? "line-through decoration-crim/70" : "") : "text-faint"}`}>
        {value || "—"}
      </span>
      {order !== undefined && <span className="text-faint text-[9px] font-bold tabular-nums -mt-1">{order}</span>}
      {open && (
        <div className={`absolute top-full mt-1 ${ours ? "left-0" : "right-0"} z-30 w-64 card !border-edge-2 bg-panel shadow-[0_12px_40px_rgba(0,0,0,0.7)] p-2 text-left`}>
          <input autoFocus className="input !py-1.5 !text-[12px] mb-1.5" placeholder="Search heroes…"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-64 overflow-y-auto -mx-1 px-1">
            <button type="button" onClick={() => { onChange(""); setOpen(false); setQ(""); }}
              className="w-full text-left px-2 py-1.5 rounded text-[12px] text-faint hover:bg-raised">— empty slot</button>
            {list.map((h) => (
              <button type="button" key={h.id} onClick={() => { onChange(h.name); setOpen(false); setQ(""); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-raised ${h.name === value ? "bg-raised" : ""}`}>
                <HeroImg name={h.name} size={26} className="rounded" />
                <span className="text-[12px] font-bold truncate">{h.name}</span>
                <span className={`ml-auto chip !text-[8px] !px-1 !py-0 uppercase ${
                  h.meta_status === "META" ? "text-crim border-crim/40" : h.meta_status === "STRONG" ? "text-leaf border-leaf/40" : "text-faint border-edge"}`}>
                  {h.meta_status.toLowerCase()}
                </span>
                <span className="text-[10px] text-mute tabular-nums w-10 text-right">{h.win_rate}%</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Interactive pro-league pick/ban board — same broadcast layout as DraftBoard, editable.
 *  Render inside your own card/section wrapper. */
export function DraftBoardEditor({ heroes, value, onChange, lanes = LANES, oursLabel = "9 CLOVER", theirsLabel = "ENEMY" }: {
  heroes: Hero[]; value: DraftValue; onChange: (next: DraftValue) => void;
  lanes?: string[]; oursLabel?: string; theirsLabel?: string;
}) {
  const setBan = (side: "our_bans" | "enemy_bans", idx: number, v: string) => {
    const arr = [...(value[side] ?? [])] as (string | null)[];
    while (arr.length < 5) arr.push("");
    arr[idx] = v;
    onChange({ ...value, [side]: arr });
  };
  const setPick = (side: "our_picks" | "enemy_picks", lane: string, v: string) =>
    onChange({ ...value, [side]: { ...(value[side] ?? {}), [lane]: v } });

  const banCol = (side: "our_bans" | "enemy_bans") => {
    const ours = side === "our_bans";
    const list = ((value[side] ?? []) as (string | null)[]).concat([null, null, null, null, null]).slice(0, 5);
    return (
      <div>
        <div className={`label mb-2.5 ${ours ? "text-leaf/80" : "text-crim/80"}`}>
          {ours ? `${oursLabel} bans` : `${theirsLabel} bans`}
        </div>
        <ol className="flex flex-wrap gap-2.5">
          {list.map((b, i) => (
            <li key={i}>
              <HeroSlot heroes={heroes} ours={ours} strike order={i + 1}
                value={b ?? ""} onChange={(v) => setBan(side, i, v)} />
            </li>
          ))}
        </ol>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {banCol("our_bans")}
        {banCol("enemy_bans")}
      </div>
      <div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center text-center mb-2">
          <span className="label text-leaf/90">{oursLabel}</span>
          <span className="label px-2">Lane</span>
          <span className="label text-crim/90">{theirsLabel}</span>
        </div>
        <div className="divide-y divide-edge/60">
          {lanes.map((lane) => (
            <div key={lane} className="grid grid-cols-[1fr_auto_1fr] items-center py-2 text-center">
              <div className="flex justify-center">
                <HeroSlot heroes={heroes} ours size={36}
                  value={value.our_picks?.[lane] ?? ""} onChange={(v) => setPick("our_picks", lane, v)} />
              </div>
              <span className="label px-3 w-20">{lane}</span>
              <div className="flex justify-center">
                <HeroSlot heroes={heroes} ours={false} size={36}
                  value={value.enemy_picks?.[lane] ?? ""} onChange={(v) => setPick("enemy_picks", lane, v)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
