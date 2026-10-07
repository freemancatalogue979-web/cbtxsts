import { useEffect, useState } from "react";

/** "Tue 13 Oct" style date from an ISO yyyy-mm-dd string. */
export function fmtDate(iso: string | null | undefined, withYear = false): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  const s = dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return withYear ? `${s} ${y}` : s;
}

export function fmtTime(t: string | null | undefined): string {
  return t || "—";
}

/** Relative day label: Today / Tomorrow / Wed / 15 Oct */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const today = new Date();
  const local = (dx: Date) => `${dx.getFullYear()}-${String(dx.getMonth() + 1).padStart(2, "0")}-${String(dx.getDate()).padStart(2, "0")}`;
  if (iso === local(today)) return "Today";
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (iso === local(tomorrow)) return "Tomorrow";
  return fmtDate(iso);
}

/** Live-updating countdown to a date+time. */
export function useCountdown(isoDate: string | null | undefined, time: string | null | undefined) {
  const target = (() => {
    if (!isoDate) return null;
    const t = time && /^\d{2}:\d{2}/.test(time) ? time : "00:00";
    return new Date(`${isoDate}T${t.slice(0, 5)}:00`);
  })();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!target) return null;
  const diff = target.getTime() - now;
  const past = diff < 0;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  return { past, days, hours, minutes, seconds, text: past ? "now / in progress" : `${days > 0 ? `${days}d ` : ""}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` };
}

export const RESULT_STYLE: Record<string, string> = {
  WIN: "text-leaf border-leaf/40 bg-leaf-dim/60",
  LOSS: "text-crim border-crim/40 bg-crim-dim/60",
  DRAW: "text-amber border-amber/40 bg-amber/10",
};

export function ResultBadge({ result }: { result: string | null | undefined }) {
  if (!result) return <span className="chip text-mute">—</span>;
  return <span className={`chip ${RESULT_STYLE[result] || "text-mute"}`}>{result}</span>;
}

export const HERO_STATUS_STYLE: Record<string, string> = {
  META: "text-crim border-crim/50 bg-crim-dim/50",
  STRONG: "text-leaf border-leaf/40 bg-leaf-dim/50",
  VIABLE: "text-sky border-sky/40 bg-sky/10",
  SITUATIONAL: "text-amber border-amber/40 bg-amber/10",
  WEAK: "text-mute border-edge-2 bg-raised",
  "BANNED/RESTRICTED": "text-crim border-crim/50 bg-crim-dim/70",
};

export const REVIEW_STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "text-crim border-crim/50 bg-crim-dim/50" },
  in_progress: { label: "In progress", cls: "text-amber border-amber/40 bg-amber/10" },
  resolved: { label: "Resolved", cls: "text-leaf border-leaf/40 bg-leaf-dim/50" },
};

export const LANE_SHORT: Record<string, string> = {
  EXP: "EXP", JUNGLE: "JGL", MID: "MID", GOLD: "GOLD", ROAM: "ROAM",
};

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(digits)}%`;
}

export function hashRoute(): string[] {
  const h = window.location.hash.replace(/^#\/?/, "");
  return h ? h.split("/") : ["dashboard"];
}

export function navigate(...parts: (string | number)[]) {
  window.location.hash = `/${parts.join("/")}`;
}
