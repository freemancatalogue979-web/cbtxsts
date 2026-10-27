import { useState } from "react";
import type { Draft, Hero } from "../lib/types";
import { heroSlug } from "./HeroImg";
import { BrandImg } from "./Logo";

const LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"];

export type DraftValue = {
  our_bans?: (string | null)[];
  enemy_bans?: (string | null)[];
  our_picks?: Record<string, string>;
  enemy_picks?: Record<string, string>;
};

function initials(label: string): string {
  return label.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

/* ---------------- broadcast atoms ---------------- */

/** Portrait hero card — pro overlay style (3:4 art, side accent bar, name plate). */
function HeroPortrait({ name, ours, player, interactive = false, onClick, fluid = false, bare = false }: {
  name?: string | null; ours: boolean; player?: string; interactive?: boolean; onClick?: () => void;
  /** fluid: fill the parent's width (cinema banks); bare: no caption row under the card */
  fluid?: boolean; bare?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const filled = Boolean(name);
  const card = (
    <div className={`relative ${fluid ? "w-full" : "w-[76px] sm:w-[92px]"} aspect-[3/4] rounded-lg overflow-hidden border transition
      ${ours ? "border-leaf/40 shadow-[0_0_16px_rgba(52,211,153,0.14)]" : "border-crim/40 shadow-[0_0_16px_rgba(225,29,72,0.14)]"}
      ${filled ? "bg-overlay" : "bg-raised/50 border-dashed opacity-60"}
      ${interactive ? "cursor-pointer hover:scale-[1.05] hover:border-opacity-90 hover:brightness-110" : ""}`}>
      {filled && !failed ? (
        <img src={`/heroes/${heroSlug(name!)}.webp`} alt={name!} onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover object-top" draggable={false} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-mute font-extrabold text-lg select-none">
          {filled ? initials(name!) : "?"}
        </div>
      )}
      {filled && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-5 pb-1 px-1">
          <div className="text-[10.5px] font-bold leading-tight truncate text-center">{name}</div>
        </div>
      )}
      <div className={`absolute top-0 ${ours ? "left-0" : "right-0"} w-[3px] h-full ${ours ? "bg-leaf/70" : "bg-crim/70"}`} />
    </div>
  );
  if (bare) return interactive ? <button type="button" className="block w-full" onClick={onClick}>{card}</button> : card;
  return (
    <div className={`flex flex-col items-center gap-1 min-w-0 ${fluid ? "w-full" : ""}`}>
      {interactive ? <button type="button" onClick={onClick}>{card}</button> : card}
      <span className={`text-[10px] font-semibold truncate max-w-[92px] ${player ? "text-mute" : "text-faint/70"}`}>
        {player || (filled ? "\u00A0" : "—")}
      </span>
    </div>
  );
}

/** Small slashed ban thumbnail. */
function BanThumb({ name, ours, order, interactive = false, onClick }: {
  name?: string | null; ours: boolean; order: number; interactive?: boolean; onClick?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const filled = Boolean(name);
  const thumb = (
    <div className={`relative w-[38px] h-[38px] rounded-md overflow-hidden border transition
      ${ours ? "border-leaf/30" : "border-crim/30"} ${filled ? "" : "border-dashed opacity-50 bg-raised/50"}
      ${interactive ? "cursor-pointer hover:scale-110 hover:border-opacity-80" : ""}`}>
      {filled && !failed ? (
        <img src={`/heroes/${heroSlug(name!)}.webp`} alt={name!} onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover object-top brightness-[0.68] saturate-75" draggable={false} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] font-extrabold text-mute select-none">
          {filled ? initials(name!) : "?"}
        </div>
      )}
      {filled && (
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(135deg, transparent 45%, rgba(225,29,72,0.95) 46.5%, rgba(225,29,72,0.95) 53.5%, transparent 55%)" }} />
      )}
      <span className="absolute bottom-0 right-0.5 text-[8px] font-black text-white/70 drop-shadow tabular-nums">{order}</span>
    </div>
  );
  return interactive ? <button type="button" title={name || `Ban ${order}`} onClick={onClick}>{thumb}</button> : thumb;
}

/** Team header — crests, names, big centre score / VERSUS. */
function DraftHeader({ oursLabel, theirsLabel, scoreUS, scoreThem, caption }: {
  oursLabel: string; theirsLabel: string; scoreUS?: number; scoreThem?: number; caption?: string;
}) {
  const hasScore = scoreUS !== undefined && scoreThem !== undefined;
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="rounded-lg border border-leaf/30 bg-leaf-dim/30 p-1 shrink-0"><BrandImg size={28} /></span>
        <div className="min-w-0">
          <div className="text-[13px] font-extrabold tracking-wide text-leaf truncate">{oursLabel}</div>
          <div className="label !text-[8px] !text-leaf/50">BLUE SIDE</div>
        </div>
      </div>
      <div className="text-center shrink-0">
        {hasScore ? (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-leaf tabular-nums">{scoreUS}</span>
            <span className="label !text-[10px]">:</span>
            <span className="text-2xl font-black text-crim tabular-nums">{scoreThem}</span>
          </div>
        ) : (
          <span className="text-sm font-black tracking-[0.35em] text-mute">VS</span>
        )}
        <div className="label !text-[7.5px] mt-0.5">{caption ?? (hasScore ? "SERIES" : "DRAFT PHASE")}</div>
      </div>
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="min-w-0 text-right">
          <div className="text-[13px] font-extrabold tracking-wide text-crim truncate">{theirsLabel}</div>
          <div className="label !text-[8px] !text-crim/50">RED SIDE</div>
        </div>
        <span className="w-[34px] h-[34px] rounded-lg border border-crim/30 bg-crim-dim/30 flex items-center justify-center text-[11px] font-black text-crim shrink-0">
          {initials(theirsLabel)}
        </span>
      </div>
    </div>
  );
}

function BanStrip({ bans, ours, label }: { bans?: (string | null)[]; ours: boolean; label: string }) {
  const list = (bans ?? []).concat([null, null, null, null, null]).slice(0, 5);
  return (
    <div className={ours ? "" : "text-right"}>
      <div className={`label !text-[8.5px] mb-1.5 ${ours ? "text-leaf/70" : "text-crim/70"}`}>{label}</div>
      <ol className={`flex flex-wrap gap-1.5 ${ours ? "" : "justify-end"}`}>
        {list.map((b, i) => <li key={i}><BanThumb name={b} ours={ours} order={i + 1} /></li>)}
      </ol>
    </div>
  );
}

/* ---------------- read-only board ---------------- */

/** Pro broadcast draft board: header with crests + score, slash-through ban strips,
 *  portrait hero cards facing off per lane. */
export function DraftBoard({ draft, oursLabel = "9 CLOVER", theirsLabel = "ENEMY", scoreUS, scoreThem, players }: {
  draft?: Draft; oursLabel?: string; theirsLabel?: string; scoreUS?: number; scoreThem?: number;
  players?: Record<string, string>;
}) {
  const d = draft ?? {};
  const ourPicks = d.our_picks ?? {};
  const theirPicks = d.enemy_picks ?? {};
  return (
    <div className="card relative overflow-hidden p-4 sm:p-5 space-y-4">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-leaf/[0.06] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-crim/[0.06] to-transparent" />
      <DraftHeader oursLabel={oursLabel} theirsLabel={theirsLabel} scoreUS={scoreUS} scoreThem={scoreThem} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-y border-edge/60 py-3">
        <BanStrip bans={d.our_bans} ours label={`${oursLabel} BANS`} />
        <BanStrip bans={d.enemy_bans} ours={false} label={`${theirsLabel} BANS`} />
      </div>
      {/* cinema: facing banks of five portrait cards (desktop), lane rows below on mobile */}
      <div className="hidden lg:grid grid-cols-[1fr_auto_1fr] items-center gap-5">
        <div className="grid grid-cols-5 gap-3">
          {LANES.map((lane) => (
            <div key={lane} className="flex flex-col items-center gap-1 min-w-0">
              <HeroPortrait name={ourPicks[lane]} ours fluid bare />
              <span className="label !text-[8px] mt-0.5">{lane}</span>
              <span className={`text-[10px] font-semibold truncate max-w-full ${players?.[lane] ? "text-mute" : "text-faint/60"}`}>
                {players?.[lane] ?? "\u00A0"}
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center gap-1 px-1">
          <span className="text-2xl font-black tracking-[0.2em] text-mute">VS</span>
          <span className="label !text-[7.5px] whitespace-nowrap">LANE MATCHUPS</span>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {LANES.map((lane) => (
            <div key={lane} className="flex flex-col items-center gap-1 min-w-0">
              <HeroPortrait name={theirPicks[lane]} ours={false} fluid bare />
              <span className="label !text-[8px] mt-0.5">{lane}</span>
              <span className="text-[10px] font-semibold text-faint/60">{"\u00A0"}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="lg:hidden divide-y divide-edge/50">
        {LANES.map((lane) => {
          const ours = ourPicks[lane]; const theirs = theirPicks[lane];
          return (
            <div key={lane} className="grid grid-cols-[1fr_auto_1fr] items-center py-2">
              <div className="flex justify-end">
                <HeroPortrait name={ours} ours player={players?.[lane]} />
              </div>
              <span className="label w-16 text-center !text-[9px]">{lane}</span>
              <div className="flex justify-start">
                <HeroPortrait name={theirs} ours={false} player={players ? "" : undefined} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- interactive board (editor) ---------------- */

const STATUS_RANK: Record<string, number> = { META: 0, STRONG: 1, VIABLE: 2, SITUATIONAL: 3, WEAK: 4 };

function HeroPopover({ heroes, value, onChange, anchor, close }: {
  heroes: Hero[]; value: string; onChange: (v: string) => void; anchor: "left" | "right"; close: () => void;
}) {
  const [q, setQ] = useState("");
  const sorted = [...heroes].sort((a, b) =>
    (STATUS_RANK[a.meta_status] ?? 9) - (STATUS_RANK[b.meta_status] ?? 9) ||
    b.clover_rating - a.clover_rating || b.win_rate - a.win_rate);
  const list = (q ? sorted.filter((h) => h.name.toLowerCase().includes(q.toLowerCase())) : sorted).slice(0, 80);
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={close} />
      <div className={`absolute top-full mt-1.5 ${anchor === "left" ? "left-0" : "right-0"} z-30 w-64 card !border-edge-2 bg-panel shadow-[0_12px_40px_rgba(0,0,0,0.7)] p-2 text-left`}>
        <input autoFocus className="input !py-1.5 !text-[12px] mb-1.5" placeholder="Search heroes…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 overflow-y-auto -mx-1 px-1">
          <button type="button" onClick={() => { onChange(""); close(); }}
            className="w-full text-left px-2 py-1.5 rounded text-[12px] text-faint hover:bg-raised">— empty slot</button>
          {list.map((h) => (
            <button type="button" key={h.id} onClick={() => { onChange(h.name); close(); }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-raised ${h.name === value ? "bg-raised" : ""}`}>
              <img src={`/heroes/${heroSlug(h.name)}.webp`} alt={h.name} width={26} height={26} className="rounded" loading="lazy" />
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
    </>
  );
}

/** Clickable board slot (portrait pick or ban thumb) owning its picker popover. */
function Slot({ heroes, value, onChange, ours, kind, order, anchor, fluid = false, bare = false }: {
  heroes: Hero[]; value: string; onChange: (v: string) => void;
  ours: boolean; kind: "pick" | "ban"; order?: number; anchor: "left" | "right";
  fluid?: boolean; bare?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`relative ${fluid ? "block w-full" : "inline-flex"}`}>
      {kind === "pick" ? (
        <HeroPortrait name={value || null} ours={ours} interactive fluid={fluid} bare={bare}
          onClick={() => setOpen((v) => !v)} player={value ? undefined : "—"} />
      ) : (
        <BanThumb name={value || null} ours={ours} order={order ?? 0} interactive onClick={() => setOpen((v) => !v)} />
      )}
      {open && <HeroPopover heroes={heroes} value={value} anchor={anchor} onChange={onChange} close={() => setOpen(false)} />}
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

  const banStrip = (side: "our_bans" | "enemy_bans") => {
    const ours = side === "our_bans";
    const list = ((value[side] ?? []) as (string | null)[]).concat([null, null, null, null, null]).slice(0, 5);
    return (
      <div className={ours ? "" : "text-right"}>
        <div className={`label !text-[8.5px] mb-1.5 ${ours ? "text-leaf/70" : "text-crim/70"}`}>
          {ours ? `${oursLabel} BANS` : `${theirsLabel} BANS`}
        </div>
        <ol className={`flex flex-wrap gap-1.5 ${ours ? "" : "justify-end"}`}>
          {list.map((b, i) => (
            <li key={i}>
              <Slot kind="ban" heroes={heroes} ours={ours} order={i + 1} anchor={ours ? "left" : "right"}
                value={b ?? ""} onChange={(v) => setBan(side, i, v)} />
            </li>
          ))}
        </ol>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <DraftHeader oursLabel={oursLabel} theirsLabel={theirsLabel} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-y border-edge/60 py-3">
        {banStrip("our_bans")}
        {banStrip("enemy_bans")}
      </div>
      {/* cinema banks (desktop) */}
      <div className="hidden lg:grid grid-cols-[1fr_auto_1fr] items-center gap-5">
        <div className="grid grid-cols-5 gap-3">
          {lanes.map((lane) => (
            <div key={lane} className="flex flex-col items-center gap-1 min-w-0">
              <Slot kind="pick" heroes={heroes} ours anchor="left" fluid bare
                value={value.our_picks?.[lane] ?? ""} onChange={(v) => setPick("our_picks", lane, v)} />
              <span className="label !text-[8px] mt-0.5">{lane}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center gap-1 px-1">
          <span className="text-2xl font-black tracking-[0.2em] text-mute">VS</span>
          <span className="label !text-[7.5px] whitespace-nowrap">CLICK TO PICK</span>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {lanes.map((lane) => (
            <div key={lane} className="flex flex-col items-center gap-1 min-w-0">
              <Slot kind="pick" heroes={heroes} ours={false} anchor="right" fluid bare
                value={value.enemy_picks?.[lane] ?? ""} onChange={(v) => setPick("enemy_picks", lane, v)} />
              <span className="label !text-[8px] mt-0.5">{lane}</span>
            </div>
          ))}
        </div>
      </div>
      {/* lane rows (mobile/tablet) */}
      <div className="lg:hidden divide-y divide-edge/50">
        {lanes.map((lane) => (
          <div key={lane} className="grid grid-cols-[1fr_auto_1fr] items-center py-2">
            <div className="flex justify-end">
              <Slot kind="pick" heroes={heroes} ours anchor="right"
                value={value.our_picks?.[lane] ?? ""} onChange={(v) => setPick("our_picks", lane, v)} />
            </div>
            <span className="label w-16 text-center !text-[9px]">{lane}</span>
            <div className="flex justify-start">
              <Slot kind="pick" heroes={heroes} ours={false} anchor="left"
                value={value.enemy_picks?.[lane] ?? ""} onChange={(v) => setPick("enemy_picks", lane, v)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
