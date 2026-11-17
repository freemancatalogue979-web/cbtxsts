import { AlertTriangle, CheckCircle2, ChevronDown, Crown, Info, Loader2, ScanLine, Sparkles, Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { Attachment, Draft, EnemyLine, PlayerLine, ScoreboardRead } from "../lib/types";
import { nice } from "../lib/caseText";
import { HeroImg } from "./HeroImg";
import { ErrorNote } from "./ui";

export const SCORE_LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"];
const MAIN = [
  { key: "kills", short: "K", label: "kills" },
  { key: "deaths", short: "D", label: "deaths" },
  { key: "assists", short: "A", label: "assists" },
  { key: "rating", short: "Rtg", label: "match rating" },
] as const;
const MORE = [
  { key: "gold", label: "Gold" },
  { key: "damage", label: "Hero dmg" },
  { key: "damage_taken", label: "Dmg taken" },
  { key: "turret_damage", label: "Turret dmg" },
] as const;
const NUM_KEYS = [...MAIN.map((m) => m.key), ...MORE.map((m) => m.key)];

/** Lane → field → text, as typed. `mvp` is "1" or "". */
export type LineForm = Record<string, Record<string, string>>;

export function linesToForm(stats?: Record<string, PlayerLine | EnemyLine> | null): LineForm {
  return Object.fromEntries(SCORE_LANES.map((lane) => {
    const line = (stats?.[lane] ?? {}) as EnemyLine & Record<string, unknown>;
    const row: Record<string, string> = Object.fromEntries(NUM_KEYS.map((k) => [k, line[k] != null ? String(line[k]) : ""]));
    row.mvp = line.mvp ? "1" : "";
    row.name = line.name ?? "";
    row.hero = line.hero ?? "";
    return [lane, row];
  }));
}

/** Only what was filled in; enemy rows also keep the player's name and hero. */
export function formToLines(form: LineForm, heroes: Record<string, string> = {}, enemy = false): Record<string, EnemyLine> {
  const out: Record<string, EnemyLine> = {};
  for (const lane of SCORE_LANES) {
    const row = form[lane] ?? {};
    const line: EnemyLine & Record<string, unknown> = {};
    for (const k of NUM_KEYS) {
      const v = (row[k] ?? "").trim();
      if (v === "") continue;
      const n = Number(v);
      if (Number.isFinite(n)) line[k] = k === "rating" ? Math.round(n * 10) / 10 : Math.round(n);
    }
    if (row.mvp) line.mvp = true;
    if (enemy && Object.keys(line).length) {
      if (row.name?.trim()) line.name = row.name.trim();
      const hero = heroes[lane] || row.hero;
      if (hero) line.hero = hero;
    }
    if (Object.keys(line).length) out[lane] = line;
  }
  return out;
}

export function sumLines(form: LineForm, key: string): number | null {
  const vals = SCORE_LANES.map((lane) => (form[lane]?.[key] ?? "").trim()).filter((v) => v !== "");
  return vals.length ? vals.reduce((t, v) => t + (Number(v) || 0), 0) : null;
}

const clean = (key: string, v: string) => key === "rating"
  ? v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 4)
  : v.replace(/[^0-9]/g, "").slice(0, 7);

/** The scoreboard of one side, typed by hand (or filled by the AI reader).
 *  `player(lane)` renders who played that lane on our side. */
export function ScoreboardFields({ form, onChange, heroes, side, gameLabel, player }: {
  form: LineForm; onChange: (next: LineForm) => void; heroes: Record<string, string>;
  side: "ours" | "enemy"; gameLabel: string; player?: (lane: string) => ReactNode;
}) {
  const hasMore = SCORE_LANES.some((lane) => MORE.some((m) => (form[lane]?.[m.key] ?? "") !== ""));
  const [more, setMore] = useState(hasMore);
  const setField = (lane: string, key: string, value: string) => onChange({ ...form, [lane]: { ...form[lane], [key]: value } });
  const toggleMvp = (lane: string) => onChange(Object.fromEntries(SCORE_LANES.map((l) => [l, { ...form[l], mvp: l === lane && !form[lane]?.mvp ? "1" : "" }])));
  const who = side === "ours" ? "" : "Enemy ";

  return (
    <div className="space-y-2">
      {SCORE_LANES.map((lane, i) => {
        const hero = heroes[lane] || form[lane]?.hero;
        const row = form[lane] ?? {};
        return (
          <div key={lane} className="space-y-1.5">
            <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_2.5rem] sm:grid-cols-[5.5rem_minmax(0,1fr)_repeat(4,3.5rem)_2.25rem] items-end gap-1.5 sm:gap-2">
              <div className="hidden sm:flex items-center gap-1.5 pb-2 min-w-0">
                {hero ? <HeroImg name={hero} size={22} className="rounded shrink-0" /> : null}
                <span className="label truncate">{nice(lane)}</span>
              </div>
              <div className="min-w-0 col-span-5 sm:col-span-1">
                <span className="label block mb-1 sm:hidden truncate">{nice(lane)}{hero ? ` · ${hero}` : ""}</span>
                {side === "ours" && player ? player(lane) : (
                  <input className="input !px-2" aria-label={`${who}${nice(lane)} player name, ${gameLabel}`} placeholder={hero || "Name"}
                    value={row.name ?? ""} maxLength={60} onChange={(e) => setField(lane, "name", e.target.value)} />
                )}
              </div>
              {MAIN.map((m) => (
                <label key={m.key} className="block">
                  <span className={`label block mb-1 text-center ${i > 0 ? "sm:hidden" : ""}`}>{m.short}</span>
                  <input className="input !px-1 text-center tabular-nums" inputMode={m.key === "rating" ? "decimal" : "numeric"}
                    aria-label={`${who}${nice(lane)} ${m.label}`} placeholder={m.key === "rating" ? "0.0" : ""}
                    value={row[m.key] ?? ""} onChange={(e) => setField(lane, m.key, clean(m.key, e.target.value))} />
                </label>
              ))}
              <button type="button" onClick={() => toggleMvp(lane)} aria-pressed={Boolean(row.mvp)}
                aria-label={`${who}${nice(lane)} MVP`} title="MVP"
                className={`mb-[3px] h-[34px] rounded-lg border flex items-center justify-center transition ${row.mvp ? "border-amber/60 bg-amber/15 text-amber" : "border-edge text-faint hover:text-mute"}`}>
                <Crown size={14} aria-hidden="true" />
              </button>
            </div>
            {more && (
              <div className="grid grid-cols-4 gap-1.5 sm:gap-2 sm:pl-[6rem]">
                {MORE.map((m) => (
                  <label key={m.key} className="block min-w-0">
                    <span className={`label block mb-1 truncate ${i > 0 ? "sm:hidden" : ""}`}>{m.label}</span>
                    <input className="input !px-1.5 tabular-nums" inputMode="numeric" aria-label={`${who}${nice(lane)} ${m.label.toLowerCase()}`}
                      value={row[m.key] ?? ""} onChange={(e) => setField(lane, m.key, clean(m.key, e.target.value))} />
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <button type="button" className="text-[11px] text-mute hover:text-text inline-flex items-center gap-1" onClick={() => setMore((v) => !v)} aria-expanded={more}>
        <ChevronDown size={12} className={`transition ${more ? "rotate-180" : ""}`} aria-hidden="true" />
        {more ? "Hide gold & damage" : "Gold & damage"}
      </button>
    </div>
  );
}

/** Collapsible enemy scoreboard (opens by itself once it has numbers). */
export function EnemyScoreboard({ form, onChange, heroes, opponent, gameLabel }: {
  form: LineForm; onChange: (next: LineForm) => void; heroes: Record<string, string>; opponent: string; gameLabel: string;
}) {
  const filled = SCORE_LANES.some((lane) => NUM_KEYS.some((k) => (form[lane]?.[k] ?? "") !== ""));
  const [open, setOpen] = useState(filled);
  const shown = open || filled;
  return (
    <div className="card p-4">
      <button type="button" className="w-full flex items-center justify-between gap-2" onClick={() => setOpen((v) => !v)} aria-expanded={shown}>
        <span className="section-pill">{opponent || "Enemy"} scoreboard</span>
        <span className="text-[11px] text-faint inline-flex items-center gap-1">
          {filled ? "filled" : "optional"} <ChevronDown size={12} className={`transition ${shown ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>
      {shown && <div className="mt-3"><ScoreboardFields form={form} onChange={onChange} heroes={heroes} side="enemy" gameLabel={gameLabel} /></div>}
    </div>
  );
}

const isImage = (a: Attachment) => (a.url ?? "").startsWith("/api/files/")
  && (a.kind === "screenshot" || a.kind === "image" || /\.(png|jpe?g|webp|gif)$/i.test(a.url ?? ""));

const CHECK_ICON = { ok: CheckCircle2, warn: AlertTriangle, info: Info };
const CHECK_TONE = { ok: "text-leaf", warn: "text-amber", info: "text-mute" };

/** "Read the screenshot with AI": pick evidence (or upload one), the AI reads the
 *  scoreboard, compares it with the draft + lineup and fills the form. The person
 *  checks the numbers and saves — nothing is saved by the AI. */
export function ScoreboardReader({ evidence, context, onRead, onUploaded }: {
  evidence: Attachment[];
  context: { opponent: string; result: string; lineup: Record<string, number | "">; draft: Draft };
  onRead: (read: ScoreboardRead) => void;
  onUploaded?: (att: { kind: string; label: string; url: string }) => void;
}) {
  const images = evidence.filter(isImage);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ label: string; read: ScoreboardRead } | null>(null);
  const [extra, setExtra] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function read(url: string, label: string) {
    setBusy(url); setErr(null); setDone(null);
    try {
      const lineup = Object.fromEntries(Object.entries(context.lineup).filter(([, v]) => v !== ""));
      const r = await api.post<ScoreboardRead>("/ai-tools/scoreboard", {
        image_url: url, opponent: context.opponent, result: context.result, lineup, draft: context.draft,
      });
      onRead(r);
      setDone({ label, read: r });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read that screenshot");
    } finally { setBusy(null); }
  }

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy("upload"); setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const saved = await api.upload<{ label: string; url: string; kind: string }>("/files", form);
      const att = { kind: "screenshot", label: saved.label, url: saved.url };
      setExtra((x) => [...x, att]);
      onUploaded?.(att);
      await read(saved.url, saved.label);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
      setBusy(null);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const all = [...images, ...extra.filter((x) => !images.some((i) => i.url === x.url))];
  const filledLanes = done ? Object.keys(done.read.player_stats).length : 0;

  return (
    <section className="card p-4 border-crim/30 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-crim)_9%,transparent),transparent_60%)]" aria-label="Fill from a screenshot">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="h-9 w-9 rounded-xl bg-crim-dim/60 border border-crim/40 text-crim flex items-center justify-center shrink-0"><ScanLine size={17} aria-hidden="true" /></div>
        <div className="flex-1 min-w-[12rem]">
          <div className="text-sm font-bold flex items-center gap-1.5">Fill from screenshot <Sparkles size={13} className="text-crim" aria-hidden="true" /></div>
          <p className="text-[11.5px] text-mute leading-relaxed">
            Pick the end-of-game scoreboard. AI reads every player's K/D/A, rating, gold and MVP, matches them to the draft and who played, and fills the form below. Check it, fix anything, then save.
          </p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void upload(e.target.files)} aria-label="Upload a scoreboard screenshot" />
        <button type="button" className="btn-ghost !py-1.5 !text-[12px]" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
          {busy === "upload" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Upload screenshot
        </button>
      </div>
      {all.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {all.map((a) => (
            <button key={a.url} type="button" disabled={busy !== null} onClick={() => void read(a.url!, a.label || "screenshot")}
              title={`Read ${a.label || "this screenshot"} with AI`}
              className={`relative shrink-0 w-36 rounded-lg border overflow-hidden text-left transition ${done?.read.image_url === a.url ? "border-leaf/70" : "border-edge hover:border-crim/60"} disabled:opacity-60`}>
              <img src={a.url} alt="" className="w-full aspect-video object-cover" />
              <span className="block px-1.5 py-1 text-[10px] text-mute truncate bg-panel/90">{a.label || "screenshot"}</span>
              {busy === a.url && (
                <span className="absolute inset-0 bg-ink/70 flex flex-col items-center justify-center gap-1 text-[10.5px] text-text">
                  <Loader2 size={16} className="animate-spin text-crim" /> Reading…
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {all.length === 0 && <p className="mt-2 text-[11px] text-faint">No screenshots in the evidence yet — upload one.</p>}
      {busy && busy !== "upload" && <p className="mt-2 text-[11px] text-mute" role="status">Reading the scoreboard — this takes a few seconds…</p>}
      <ErrorNote error={err} />
      {done && (
        <div className="mt-3 rounded-lg border border-edge/70 bg-panel/60 p-3" role="status">
          <div className="text-[12px] font-bold text-text">
            Filled from {done.label}{done.read.result ? ` · ${done.read.result === "WIN" ? "win" : "loss"}` : ""}{filledLanes ? ` · ${filledLanes}/5 players` : ""} — check and save.
          </div>
          {done.read.checks.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {done.read.checks.map((c, i) => {
                const Icon = CHECK_ICON[c.tone] ?? Info;
                return (
                  <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-mute leading-snug">
                    <Icon size={12} className={`mt-0.5 shrink-0 ${CHECK_TONE[c.tone] ?? "text-mute"}`} aria-hidden="true" />{c.text}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
