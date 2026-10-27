import { useState, useSyncExternalStore } from "react";
import type { Draft, Hero } from "../lib/types";
import { heroSlug } from "./HeroImg";
import { BrandImg } from "./Logo";
import { artFor, artVersion, subscribeArt } from "../lib/mlbb";

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
  useSyncExternalStore(subscribeArt, artVersion);
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const filled = Boolean(name);
  const remote = filled ? (artFor(name!)?.art ?? artFor(name!)?.head) : undefined;
  const src = stage === 0 ? (remote ?? `/heroes/${heroSlug(name!)}.webp`) : `/heroes/${heroSlug(name!)}.webp`;
  const showImg = filled && stage < 2;
  const card = (
    <div className={`relative ${fluid ? "w-full" : "w-[76px] sm:w-[92px]"} aspect-[3/4] rounded-lg overflow-hidden border transition
      ${ours ? "border-leaf/40 shadow-[0_0_16px_rgba(52,211,153,0.14)]" : "border-crim/40 shadow-[0_0_16px_rgba(225,29,72,0.14)]"}
      ${filled ? "bg-overlay" : "bg-raised/50 border-dashed opacity-60"}
      ${interactive ? "cursor-pointer hover:scale-[1.05] hover:border-opacity-90 hover:brightness-110" : ""}`}>
      {showImg ? (
        <img src={src} alt={name!} onError={() => setStage((s) => (s === 0 ? 1 : 2))}
          className="absolute inset-0 w-full h-full object-cover object-top" draggable={false} referrerPolicy="no-referrer" loading="lazy" />
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
  useSyncExternalStore(subscribeArt, artVersion);
  const [failed, setFailed] = useState(false);
  const filled = Boolean(name);
  const remote = filled ? (artFor(name!)?.head ?? artFor(name!)?.art) : undefined;
  const src = remote && !failed ? remote : `/heroes/${heroSlug(name!)}.webp`;
  const thumb = (
    <div className={`relative w-[38px] h-[38px] rounded-md overflow-hidden border transition
      ${ours ? "border-leaf/30" : "border-crim/30"} ${filled ? "" : "border-dashed opacity-50 bg-raised/50"}
      ${interactive ? "cursor-pointer hover:scale-110 hover:border-opacity-80" : ""}`}>
      {filled && !failed ? (
        <img src={src} alt={name!} onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover object-top brightness-[0.68] saturate-75" draggable={false} referrerPolicy="no-referrer" loading="lazy" />
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

/* ---------------- read-only board (stream overlay look) ---------------- */

/** Cinematic draft stage: arena glow backdrop, big team crests, amber VS centerpiece,
 *  name-banded portrait banks, ban stacks on the arena edges. */
function BroadcastCard({ name, ours, lane, player }: { name?: string | null; ours: boolean; lane: string; player?: string }) {
  useSyncExternalStore(subscribeArt, artVersion);
  const [failed, setFailed] = useState(false);
  const filled = Boolean(name);
  const art = filled ? (artFor(name!)?.art ?? artFor(name!)?.head) : undefined;
  const src = !failed && art ? art : filled ? `/heroes/${heroSlug(name)}.webp` : null;
  const showImg = filled && !(!art && !src);
  return (
    <figure className="flex flex-col items-center gap-0.5 min-w-0">
      <div className={`relative w-full aspect-[3/4] rounded-lg overflow-hidden border-2 transition ${
          ours ? "border-leaf/60 shadow-[0_0_24px_rgba(52,211,153,0.25)]" : "border-crim/60 shadow-[0_0_24px_rgba(225,29,72,0.25)]"
        } ${filled ? "" : "border-dashed !border-edge-2 opacity-50"}`}>
        {/* light sheen */}
        <div className="pointer-events-none absolute inset-0 z-10" style={{ background: "linear-gradient(155deg, rgba(255,255,255,0.14), transparent 34%)" }} />
        {showImg && src ? (
          <img src={src} alt={name!} draggable={false} loading="lazy" referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="absolute inset-0 w-full h-full object-cover object-top" />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-raised/60">
            <span className="text-xl font-black text-faint/50 italic select-none">?</span>
          </div>
        )}
        {/* team spine */}
        <div className={`absolute top-0 ${ours ? "left-0" : "right-0"} w-[3px] h-full z-10 ${ours ? "bg-leaf/80" : "bg-crim/80"}`} />
        {/* name band */}
        {filled && (
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-1.5 pt-3 pb-1">
            <div className={`text-center text-[10px] sm:text-[11px] font-black italic uppercase tracking-wider truncate drop-shadow ${ours ? "text-leaf" : "text-crim"}`}>
              {name}
            </div>
          </div>
        )}
      </div>
      <span className="label !text-[8px] mt-0.5">{lane}</span>
      <span className={`text-[10px] font-semibold truncate max-w-full ${player ? "text-mute" : "text-faint/60"}`}>{player || " "}</span>
    </figure>
  );
}

/** Stadium header: big crests, phase-serif caption, amber VS / score center. */
function StageHeader({ oursLabel, theirsLabel, scoreUS, scoreThem }: {
  oursLabel: string; theirsLabel: string; scoreUS?: number; scoreThem?: number;
}) {
  const hasScore = scoreUS !== undefined && scoreThem !== undefined;
  return (
    <div className="relative flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="rounded-xl border-2 border-leaf/50 bg-leaf-dim/30 p-1.5 shrink-0 shadow-[0_0_22px_rgba(52,211,153,0.3)]"><BrandImg size={38} /></span>
        <div className="min-w-0">
          <div className="text-[15px] font-black italic tracking-wider text-leaf truncate uppercase">{oursLabel}</div>
          <div className="label !text-[8px] !text-leaf/60">BLUE SIDE</div>
        </div>
      </div>
      <div className="text-center shrink-0">
        {hasScore ? (
          <div className="flex items-baseline gap-2.5">
            <span className="text-3xl font-black italic text-leaf tabular-nums drop-shadow-[0_0_14px_rgba(52,211,153,0.45)]">{scoreUS}</span>
            <span className="text-xl font-black text-faint">:</span>
            <span className="text-3xl font-black italic text-crim tabular-nums drop-shadow-[0_0_14px_rgba(225,29,72,0.45)]">{scoreThem}</span>
          </div>
        ) : (
          <span className="text-3xl font-black italic tracking-[0.25em] text-transparent bg-clip-text bg-gradient-to-b from-amber via-amber to-crim drop-shadow-[0_2px_16px_rgba(245,185,66,0.35)]">VS</span>
        )}
      </div>
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0 text-right">
          <div className="text-[15px] font-black italic tracking-wider text-crim truncate uppercase">{theirsLabel}</div>
          <div className="label !text-[8px] !text-crim/60">RED SIDE</div>
        </div>
        <span className="w-[42px] h-[42px] rounded-xl border-2 border-crim/50 bg-crim-dim/30 flex items-center justify-center text-sm font-black italic text-crim shrink-0 shadow-[0_0_22px_rgba(225,29,72,0.3)]">
          {initials(theirsLabel)}
        </span>
      </div>
    </div>
  );
}

/** Vertical ban stack for the arena edges (5 slashes, numbered). */
function BanStack({ bans, ours }: { bans?: (string | null)[]; ours: boolean }) {
  const list = (bans ?? []).concat([null, null, null, null, null]).slice(0, 5);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className={`label !text-[7px] ${ours ? "text-leaf/60" : "text-crim/60"}`}>BANS</span>
      {list.map((b, i) => <BanThumb key={i} name={b} ours={ours} order={i + 1} />)}
    </div>
  );
}

export function DraftBoard({ draft, oursLabel = "9 CLOVER", theirsLabel = "ENEMY", scoreUS, scoreThem, players }: {
  draft?: Draft; oursLabel?: string; theirsLabel?: string; scoreUS?: number; scoreThem?: number;
  players?: Record<string, string>;
}) {
  const d = draft ?? {};
  const ourPicks = d.our_picks ?? {};
  const theirPicks = d.enemy_picks ?? {};
  return (
    <div className="card relative overflow-hidden p-4 sm:p-6 space-y-5 bg-[#07070b]">
      {/* arena atmosphere: side tints + ember floor glow + top vignette */}
      <div className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 60% at 8% 50%, rgba(52,211,153,0.10), transparent 70%)," +
            "radial-gradient(55% 60% at 92% 50%, rgba(225,29,72,0.12), transparent 70%)," +
            "radial-gradient(70% 55% at 50% 118%, rgba(245,185,66,0.16), transparent 65%)," +
            "linear-gradient(rgba(0,0,0,0.35), transparent 22%)",
        }} />
      <div className="relative"><StageHeader oursLabel={oursLabel} theirsLabel={theirsLabel} scoreUS={scoreUS} scoreThem={scoreThem} /></div>

      {/* banks with ban stacks on the arena edges — desktop */}
      <div className="relative hidden lg:grid grid-cols-[44px_1fr_56px_1fr_44px] items-center gap-4">
        <BanStack bans={d.our_bans} ours />
        <div className="grid grid-cols-5 gap-3">
          {LANES.map((lane) => (
            <BroadcastCard key={lane} name={ourPicks[lane]} ours lane={lane} player={players?.[lane]} />
          ))}
        </div>
        <div className="flex flex-col items-center gap-1 px-1">
          <span className="text-[26px] font-black italic tracking-[0.15em] text-transparent bg-clip-text bg-gradient-to-b from-amber/90 to-crim/90">VS</span>
          <span className="label !text-[7px] whitespace-nowrap">LANE MATCHUPS</span>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {LANES.map((lane) => (
            <BroadcastCard key={lane} name={theirPicks[lane]} ours={false} lane={lane} />
          ))}
        </div>
        <BanStack bans={d.enemy_bans} ours={false} />
      </div>
      {/* phase caption footer — desktop */}
      <div className="relative hidden lg:flex items-center gap-3 pt-1">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-edge to-transparent" />
        <span className="text-[10px] font-black italic tracking-[0.4em] text-amber/90 drop-shadow-[0_0_10px_rgba(245,185,66,0.35)]">THE DRAFTING PHASE</span>
        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-edge to-transparent" />
      </div>

      {/* mobile: ban strips then lane rows */}
      <div className="relative lg:hidden grid grid-cols-2 gap-4 border-y border-edge/60 py-3">
        <BanStrip bans={d.our_bans} ours label={`${oursLabel} BANS`} />
        <BanStrip bans={d.enemy_bans} ours={false} label={`${theirsLabel} BANS`} />
      </div>
      <div className="relative lg:hidden divide-y divide-edge/50">
        {LANES.map((lane) => {
          const ours = ourPicks[lane]; const theirs = theirPicks[lane];
          return (
            <div key={lane} className="grid grid-cols-[1fr_auto_1fr] items-center py-2">
              <div className="flex justify-end"><div className="w-[82px]"><BroadcastCard name={ours} ours lane={lane} player={players?.[lane]} /></div></div>
              <span className="label w-16 text-center !text-[9px]">{lane}</span>
              <div className="flex justify-start"><div className="w-[82px]"><BroadcastCard name={theirs} ours={false} lane={lane} /></div></div>
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

/* ---------------- in-game-style draft simulator (10-ban hub reference) ----------------
   Layout mirrors the live MOBILE draft screen the user referenced:
   blue team panel left, red team panel right, big filterable hero catalog centre,
   5+5 ban boxes on top — click a slot to arm it, then click a hero in the catalog. */

import { useEffect, useMemo } from "react";
import { HeroImg } from "./HeroImg";
import { Check, Search, X } from "lucide-react";

type ArmTarget = { side: "our" | "enemy"; kind: "pick" | "ban"; key: string | number };

export function DraftSimulator({ heroes, value, onChange, lanes = LANES, oursLabel = "9 CLOVER", theirsLabel = "ENEMY" }: {
  heroes: Hero[]; value: DraftValue; onChange: (next: DraftValue) => void;
  lanes?: string[]; oursLabel?: string; theirsLabel?: string;
}) {
  const [armed, setArmed] = useState<ArmTarget | null>(null);
  const [laneTab, setLaneTab] = useState("ALL");
  const [q, setQ] = useState("");

  const used = useMemo(() => {
    const s = new Set<string>();
    for (const v of Object.values(value.our_picks ?? {})) if (v) s.add(v.toLowerCase());
    for (const v of Object.values(value.enemy_picks ?? {})) if (v) s.add(v.toLowerCase());
    for (const v of [...(value.our_bans ?? []), ...(value.enemy_bans ?? [])]) if (v) s.add(String(v).toLowerCase());
    return s;
  }, [value]);

  const LANE_TABS = ["ALL", "EXP", "GOLD", "MID", "ROAM", "JUNGLE"];
  const list = useMemo(() => {
    const sorted = [...heroes].sort((a, b) =>
      (STATUS_RANK[a.meta_status] ?? 9) - (STATUS_RANK[b.meta_status] ?? 9) ||
      b.clover_rating - a.clover_rating || b.win_rate - a.win_rate);
    const needle = q.trim().toLowerCase();
    return sorted
      .filter((h) => laneTab === "ALL" || (h.role ?? "").toUpperCase() === laneTab)
      .filter((h) => !needle || h.name.toLowerCase().includes(needle))
      .slice(0, 120);
  }, [heroes, laneTab, q]);

  const setPick = (side: "our_picks" | "enemy_picks", lane: string, v: string) =>
    onChange({ ...value, [side]: { ...(value[side] ?? {}), [lane]: v } });
  const setBan = (side: "our_bans" | "enemy_bans", idx: number, v: string) => {
    const arr = [...(value[side] ?? [])] as (string | null)[];
    while (arr.length < 5) arr.push(null);
    arr[idx] = v || null;
    onChange({ ...value, [side]: arr });
  };

  const slotValue = (t: ArmTarget): string => {
    if (t.kind === "pick") {
      return (t.side === "our" ? value.our_picks : value.enemy_picks)?.[String(t.key)] ?? "";
    }
    const arr = (t.side === "our" ? value.our_bans : value.enemy_bans) ?? [];
    return String(arr[Number(t.key)] ?? "");
  };

  const armNext = useMemo(() => {
    // after assigning, advance to the next empty slot: same kind first, ours before theirs
    return (from: ArmTarget): ArmTarget | null => {
      const order: ArmTarget[] = [];
      for (const kind of [from.kind, from.kind === "pick" ? "ban" : "pick"] as const) {
        for (const side of ["our", "enemy"] as const) {
          if (kind === "pick") for (const lane of lanes) order.push({ side, kind, key: lane });
          else for (let i = 0; i < 5; i++) order.push({ side, kind, key: i });
        }
      }
      const start = order.findIndex((t) => t.side === from.side && t.kind === from.kind && t.key === from.key);
      for (let i = 1; i <= order.length; i++) {
        const t = order[(start + i) % order.length];
        if (!slotValue(t)) return t;
      }
      return null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, lanes]);

  const assign = (heroName: string) => {
    if (!armed) return;
    if (armed.kind === "pick") setPick(armed.side === "our" ? "our_picks" : "enemy_picks", String(armed.key), heroName);
    else setBan(armed.side === "our" ? "our_bans" : "enemy_bans", Number(armed.key), heroName);
    setArmed(armNext(armed));
  };

  const clearSlot = (t: ArmTarget) => {
    if (t.kind === "pick") setPick(t.side === "our" ? "our_picks" : "enemy_picks", String(t.key), "");
    else setBan(t.side === "our" ? "our_bans" : "enemy_bans", Number(t.key), "");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setArmed(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const phase = useMemo(() => {
    const bansUsed = [...(value.our_bans ?? []), ...(value.enemy_bans ?? [])].filter(Boolean).length;
    const picksUsed = Object.values(value.our_picks ?? {}).filter(Boolean).length
      + Object.values(value.enemy_picks ?? {}).filter(Boolean).length;
    if (bansUsed < 10 && picksUsed === 0) return { label: "BAN PHASE", left: 10 - bansUsed };
    if (picksUsed < 10) return { label: "PICK PHASE", left: 10 - picksUsed };
    return { label: "DRAFT COMPLETE", left: 0 };
  }, [value]);

  const isArmed = (t: ArmTarget) => !!armed && armed.side === t.side && armed.kind === t.kind && armed.key === t.key;

  const teamPanel = (side: "our" | "enemy") => {
    const ours = side === "our";
    const picks = (ours ? value.our_picks : value.enemy_picks) ?? {};
    return (
      <div className={`rounded-xl border p-3 space-y-2 ${ours ? "border-leaf/40 bg-leaf/5" : "border-crim/40 bg-crim/5"}`}>
        <div className={`text-[10px] font-bold uppercase tracking-[0.18em] ${ours ? "text-leaf" : "text-crim"}`}>
          {ours ? oursLabel : theirsLabel}
        </div>
        {lanes.map((lane) => {
          const name = picks[lane] ?? "";
          const t: ArmTarget = { side, kind: "pick", key: lane };
          const active = isArmed(t);
          return (
            <button key={lane} type="button"
              onClick={() => setArmed(active ? null : t)}
              className={`w-full flex items-center gap-2 rounded-lg p-1.5 border transition text-left
                ${active ? "border-amber bg-amber/10 shadow-[0_0_12px_rgba(245,185,66,0.25)]"
                  : ours ? "border-leaf/25 hover:border-leaf/60" : "border-crim/25 hover:border-crim/60"}`}>
              <span className="relative shrink-0">
                <HeroImg name={name || "?"} size={40} variant="icon" className="rounded-md" />
                {name && (
                  <span role="button" title="Clear"
                    onClick={(e) => { e.stopPropagation(); clearSlot(t); }}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/80 border border-edge-2 grid place-items-center text-[9px] text-crim hover:text-white">
                    <X size={9} />
                  </span>
                )}
              </span>
              <span className="min-w-0">
                <span className={`block text-[8.5px] font-bold uppercase tracking-widest ${ours ? "text-leaf/70" : "text-crim/70"}`}>{lane}</span>
                <span className="block text-[11.5px] font-bold truncate">{name || (active ? "Select hero →" : "Empty slot")}</span>
              </span>
              {active && <Check size={13} className="ml-auto text-amber shrink-0" />}
            </button>
          );
        })}
      </div>
    );
  };

  const banRow = (side: "our_bans" | "enemy_bans") => {
    const ours = side === "our_bans";
    const arr = ([...(value[side] ?? [])] as (string | null)[]).concat([null, null, null, null, null]).slice(0, 5);
    return (
      <div className={`flex gap-1.5 ${ours ? "" : "justify-end"}`}>
        {arr.map((b, i) => {
          const t: ArmTarget = { side: ours ? "our" : "enemy", kind: "ban", key: i };
          const active = isArmed(t);
          return (
            <button key={i} type="button" title={b ? String(b) : `Ban slot ${i + 1}`}
              onClick={() => setArmed(active ? null : t)}
              className={`relative w-11 h-11 rounded-md border overflow-hidden transition grid place-items-center
                  ${active ? "border-amber shadow-[0_0_10px_rgba(245,185,66,0.3)]"
                    : b ? "border-edge" : "border-dashed " + (ours ? "border-leaf/30" : "border-crim/30")}`}>
              {b ? (
                <span className="absolute inset-0 grayscale">
                  <HeroImg name={String(b)} size={44} variant="icon" className="rounded-none" />
                </span>
              ) : (
                <span className="text-[9px] font-black text-faint">{i + 1}</span>
              )}
              {b && (
                <span role="button" title="Clear ban" onClick={(e) => { e.stopPropagation(); clearSlot(t); }}
                  className="absolute inset-0 grid place-items-center bg-black/55 opacity-0 hover:opacity-100 transition text-white">
                  <X size={14} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-3" onClick={(e) => { if (!(e.target as HTMLElement).closest("button,input")) setArmed(null); }}>
      {/* phase bar: ban boxes outside, phase centre — in-game 10-ban layout */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {banRow("our_bans")}
        <div className="text-center px-3">
          <div className={`text-[12px] font-black tracking-[0.22em] ${phase.label === "PICK PHASE" ? "text-leaf" : phase.label === "BAN PHASE" ? "text-crim" : "text-mute"}`}>
            {phase.label}
          </div>
          <div className="label !text-[8px] mt-0.5">
            {phase.left > 0 ? `${phase.left} LEFT` : "READY"}
            {armed ? ` · SELECTING ${armed.kind.toUpperCase()} (${armed.side === "our" ? oursLabel : theirsLabel})` : " · CLICK A SLOT TO ARM"}
          </div>
        </div>
        {banRow("enemy_bans")}
      </div>

      <div className="grid lg:grid-cols-[200px_minmax(0,1fr)_200px] gap-3 items-start">
        {teamPanel("our")}

        {/* catalog */}
        <div className="card !bg-overlay/60 p-3 order-first lg:order-none">
          <div className="flex flex-wrap items-center gap-1 mb-2.5">
            {LANE_TABS.map((t) => (
              <button key={t} type="button" onClick={() => setLaneTab(t)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide border transition
                  ${laneTab === t ? "border-crim/60 bg-crim-dim/40 text-crim" : "border-edge text-faint hover:text-mute"}`}>
                {t === "ALL" ? "All Lanes" : t}
              </button>
            ))}
            <div className="relative ml-auto">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
              <input className="input !py-1 !pl-7 !text-[11.5px] w-40" placeholder="Search hero…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-1.5 max-h-[380px] overflow-y-auto pr-1">
            {list.map((h) => {
              const taken = used.has(h.name.toLowerCase());
              return (
                <button key={h.id} type="button" disabled={!armed || taken}
                  onClick={() => assign(h.name)}
                  title={taken ? `${h.name} already drafted` : armed ? `Draft ${h.name}` : "Arm a slot first"}
                  className={`relative rounded-md overflow-hidden border text-center transition group
                    ${taken ? "opacity-35 grayscale cursor-not-allowed border-edge"
                      : !armed ? "border-edge opacity-70"
                        : "border-edge hover:border-amber hover:shadow-[0_0_10px_rgba(245,185,66,0.25)] hover:scale-[1.06]"}`}>
                  <HeroImg name={h.name} size={58} variant="icon" className="w-full rounded-none aspect-square" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/70 text-[8px] font-bold py-0.5 leading-none truncate px-0.5 select-none">
                    {h.name}
                  </span>
                  {taken && <span className="absolute inset-0 grid place-items-center text-[8px] font-black text-crim tracking-widest bg-black/30">TAKEN</span>}
                </button>
              );
            })}
            {list.length === 0 && <div className="col-span-full text-center text-[11px] text-faint py-6">No heroes in this lane filter.</div>}
          </div>
        </div>

        {teamPanel("enemy")}
      </div>
    </div>
  );
}
