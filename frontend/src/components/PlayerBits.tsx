import type { CSSProperties } from "react";
import { nice } from "../lib/caseText";
import { Ign } from "./ui";

/** Each lane keeps one colour everywhere in the hub (chips, roster cards, scrim lineups). */
export const LANE_KEYS = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"] as const;

export function laneKey(lane: string | null | undefined): string {
  const key = String(lane ?? "").trim().toUpperCase();
  if (key === "JGL" || key === "JUNGLER") return "JUNGLE";
  if (key === "ROAMER" || key === "SUPPORT") return "ROAM";
  if (key === "MIDDLE") return "MID";
  return (LANE_KEYS as readonly string[]).includes(key) ? key : "";
}

/** A small coloured lane tag: dot + lane name. */
export function LaneTag({ lane, className = "" }: { lane: string | null | undefined; className?: string }) {
  const key = laneKey(lane);
  if (!lane) return null;
  return (
    <span className={`lane-tag ${className}`} data-lane={key || undefined}>
      <i className="lane-tag__dot" aria-hidden="true" />{nice(lane)}
    </span>
  );
}

type ChipUser = { ign?: string | null; name?: string | null; main_role?: string | null; avatar?: string | null };

/** A member as a chip: face (photo or first letters) · IGN exactly as given · optional lane. */
export function PlayerChip({ user, lane = true, title, className = "" }: {
  user: ChipUser; lane?: boolean; title?: string; className?: string;
}) {
  const label = user.ign || user.name || "?";
  const key = laneKey(user.main_role);
  return (
    <span className={`player-chip ${className}`} data-lane={key || undefined}
      title={title ?? [user.name, user.main_role ? nice(user.main_role) : ""].filter(Boolean).join(" · ")}>
      <span className="player-chip__face" aria-hidden="true">
        {user.avatar ? <img src={user.avatar} alt="" draggable={false} /> : <span className="ign">{Array.from(label).slice(0, 1).join("")}</span>}
      </span>
      <span className="player-chip__name"><Ign text={label} /></span>
      {lane && user.main_role && <span className="player-chip__lane">{nice(user.main_role)}</span>}
    </span>
  );
}

/** A compact win-rate ring with the percentage in the middle. */
export function WinRing({ value, size = 50 }: { value: number | null | undefined; size?: number }) {
  const known = typeof value === "number" && Number.isFinite(value);
  const pctValue = known ? Math.max(0, Math.min(100, value as number)) : 0;
  const tone = !known ? "var(--color-edge-2)" : pctValue >= 55 ? "var(--color-leaf)" : pctValue >= 45 ? "var(--color-amber)" : "var(--color-danger)";
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return (
    <span className="win-ring" style={{ width: size, height: size, "--ring": tone } as CSSProperties}
      role="img" aria-label={known ? `Series win rate ${Math.round(pctValue)}%` : "No series yet"}>
      <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden="true">
        <circle cx="18" cy="18" r={r} className="win-ring__track" />
        <circle cx="18" cy="18" r={r} className="win-ring__value" strokeDasharray={`${(pctValue / 100) * c} ${c}`} />
      </svg>
      <span className="win-ring__text">{known ? <>{Math.round(pctValue)}<small>%</small></> : "—"}</span>
    </span>
  );
}

/** A 0–10 meter (confidence, ratings) with the number beside it. */
export function Meter({ value, max = 10, label }: { value: number | null | undefined; max?: number; label: string }) {
  const known = typeof value === "number" && Number.isFinite(value);
  const share = known ? Math.max(0, Math.min(1, (value as number) / max)) : 0;
  return (
    <span className="meter" role="img" aria-label={known ? `${label} ${value} out of ${max}` : `${label}: not rated yet`}>
      <span className="meter__bar"><i style={{ width: `${share * 100}%` }} /></span>
      <span className="meter__value tabular-nums">{known ? value : "—"}</span>
    </span>
  );
}
