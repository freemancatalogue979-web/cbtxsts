/**
 * Utility → a player's own (solo) games.
 *
 * Players drop a screenshot, document or spreadsheet at any time and their games are added
 * straight to their record (undo per file, edit/delete per game, a manual form). From those
 * games: hero gaps (no data / stopped playing / strong in your lane), what to work on,
 * animated progress charts and a personal plan. Player-facing copy never talks about how
 * files are read.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  AlertTriangle, CheckCircle2, CircleDashed, Crown, FileSpreadsheet, FileText, Flame, Gauge, Hourglass, Image as ImageIcon, Info,
  Loader2, Pencil, Plus, RotateCcw, Search, Skull, Sparkles, Target, Trash2, TrendingDown, TrendingUp, Trophy, Upload, X,
} from "lucide-react";
import { api } from "../lib/api";
import type { Hero, SoloAlert, SoloCheck, SoloCoaching, SoloGame, SoloGamesPayload, SoloGaps, SoloGroup, SoloImport } from "../lib/types";
import { fmtDate, pct } from "../lib/util";
import { HeroImg } from "./HeroImg";
import { HeroPickerModal } from "./HeroPicker";
import { FormDots, kdaText } from "./PlayerPerformance";
import { BarChart, CHART_COLORS, CountUp, Donut, HBars, Legend, LineChart, weekLabel } from "./Charts";
import { Empty, ErrorNote, Field, SectionTitle, Spinner } from "./ui";

export const SOLO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.txt,.md,.csv,.tsv,.xlsx,.json";
const MODES = ["Ranked", "Classic", "Brawl", "Custom", "Arcade"];
const LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"];
const TEMPLATE_HEADERS = ["date", "mode", "hero", "lane", "result", "kills", "deaths", "assists", "rating", "gold",
  "damage", "damage_taken", "turret_damage", "duration", "mvp", "notes"];

const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString());
const kdaLine = (g: Pick<SoloGame, "kills" | "deaths" | "assists">) =>
  g.kills == null && g.deaths == null && g.assists == null ? "—" : `${g.kills ?? "–"}/${g.deaths ?? "–"}/${g.assists ?? "–"}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Your games + stats, reloadable. Staff may look at another player's. */
export function useSoloGames(userId?: number, skip = false) {
  const [data, setData] = useState<SoloGamesPayload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (skip) { setLoading(false); return; }
    setLoading(true);
    try {
      setData(await api.get<SoloGamesPayload>(`/solo-games${userId ? `?user_id=${userId}` : ""}`));
      setError(null);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }, [userId, skip]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

function useHeroes() {
  const [heroes, setHeroes] = useState<Hero[]>([]);
  useEffect(() => { api.get<Hero[]>("/heroes").then(setHeroes).catch(() => setHeroes([])); }, []);
  return heroes;
}

function sourceIcon(source: string) {
  if (source === "screenshot") return <ImageIcon size={12} aria-label="From a screenshot" />;
  if (source === "sheet") return <FileSpreadsheet size={12} aria-label="From a spreadsheet" />;
  if (source === "document") return <FileText size={12} aria-label="From a document" />;
  return <Pencil size={12} aria-label="Added by hand" />;
}

function ResultChip({ result }: { result: string }) {
  if (!result) return <span className="chip text-faint border-edge">—</span>;
  return <span className={`chip ${result === "WIN" ? "text-leaf border-leaf/45 bg-leaf/10" : "text-danger border-danger/45 bg-danger/10"}`}>{result === "WIN" ? "Win" : "Loss"}</span>;
}

function CheckLine({ check }: { check: SoloCheck }) {
  const Icon = check.tone === "ok" ? CheckCircle2 : check.tone === "warn" ? AlertTriangle : Info;
  const cls = check.tone === "ok" ? "text-leaf" : check.tone === "warn" ? "text-amber" : "text-mute";
  return <li className={`flex items-start gap-1.5 text-[11px] ${cls}`}><Icon size={12} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{check.text}</span></li>;
}

// --------------------------------------------------------------------------- //
// one game: add / edit
// --------------------------------------------------------------------------- //
type GameForm = Record<"played_on" | "mode" | "hero" | "lane" | "result" | "duration_min" | "kills" | "deaths" | "assists" | "rating" | "gold" | "damage" | "damage_taken" | "turret_damage" | "notes", string> & { mvp: boolean };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function toForm(g?: SoloGame | null, lane = ""): GameForm {
  const s = (v: number | string | null | undefined) => (v == null ? "" : String(v));
  return {
    played_on: g?.played_on ?? todayIso(), mode: g?.mode || "Ranked", hero: g?.hero ?? "", lane: g?.lane ?? lane,
    result: g?.result ?? "", duration_min: s(g?.duration_min), kills: s(g?.kills), deaths: s(g?.deaths), assists: s(g?.assists),
    rating: s(g?.rating), gold: s(g?.gold), damage: s(g?.damage), damage_taken: s(g?.damage_taken),
    turret_damage: s(g?.turret_damage), notes: g?.notes ?? "", mvp: Boolean(g?.mvp),
  };
}

function fromForm(f: GameForm) {
  const num = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    played_on: f.played_on || null, mode: f.mode, hero: f.hero, lane: f.lane, result: f.result,
    duration_min: num(f.duration_min), kills: num(f.kills), deaths: num(f.deaths), assists: num(f.assists),
    rating: num(f.rating), gold: num(f.gold), damage: num(f.damage), damage_taken: num(f.damage_taken),
    turret_damage: num(f.turret_damage), mvp: f.mvp, notes: f.notes,
  };
}

export function SoloGameEditor({ game, heroes, lane, hero, onSaved, onCancel }: {
  game?: SoloGame | null; heroes: Hero[]; lane?: string; /** Start a new game on this hero. */ hero?: string;
  onSaved: (g: SoloGame) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<GameForm>(() => ({ ...toForm(game, lane), ...(!game && hero ? { hero } : {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof GameForm>(k: K, v: GameForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const heroId = heroes.find((h) => h.name.toLowerCase() === f.hero.toLowerCase())?.id ?? "";
  const numField = (key: keyof GameForm, label: string, opts: { step?: string; max?: number; placeholder?: string } = {}) => (
    <Field label={label}>
      <input className="input tabular-nums" inputMode="decimal" type="number" min={0} max={opts.max} step={opts.step ?? "1"}
        placeholder={opts.placeholder} value={f[key] as string} onChange={(e) => set(key, e.target.value as never)} aria-label={label} />
    </Field>
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.hero && !f.result) { setError(new Error("Add at least the hero and the result.")); return; }
    setBusy(true); setError(null);
    try {
      const saved = game
        ? await api.patch<SoloGame>(`/solo-games/${game.id}`, fromForm(f))
        : await api.post<SoloGame>("/solo-games", fromForm(f));
      onSaved(saved);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Field label="Date"><input className="input" type="date" value={f.played_on} max={todayIso()} onChange={(e) => set("played_on", e.target.value)} /></Field>
        <Field label="Mode">
          <select className="input" value={f.mode} onChange={(e) => set("mode", e.target.value)}>
            {[...new Set([...MODES, f.mode].filter(Boolean))].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Lane">
          <select className="input" value={f.lane} onChange={(e) => set("lane", e.target.value)}>
            <option value="">—</option>
            {LANES.map((l) => <option key={l} value={l}>{l === "EXP" ? "EXP" : l[0] + l.slice(1).toLowerCase()}</option>)}
          </select>
        </Field>
        <div>
          <span className="label block mb-1.5" aria-hidden="true">Result</span>
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Result">
            {(["WIN", "LOSS"] as const).map((r) => (
              <button key={r} type="button" aria-pressed={f.result === r} onClick={() => set("result", f.result === r ? "" : r)}
                className={`rounded-md border px-2 py-2 text-[11px] font-extrabold transition ${f.result === r
                  ? r === "WIN" ? "border-leaf/60 bg-leaf/15 text-leaf" : "border-danger/60 bg-danger/15 text-danger"
                  : "border-edge text-faint hover:text-mute"}`}>{r === "WIN" ? "Win" : "Loss"}</button>
            ))}
          </div>
        </div>
      </div>
      {/* Not a <label>: a label around buttons would pass every click on it to the first button. */}
      <div>
        <span className="label block mb-1.5">Hero</span>
        <HeroPickerModal heroes={heroes} value={heroId} placeholder={f.hero || "Pick your hero…"}
          onChange={(id) => set("hero", heroes.find((h) => h.id === id)?.name ?? "")} />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
        {numField("kills", "Kills", { max: 199 })}
        {numField("deaths", "Deaths", { max: 199 })}
        {numField("assists", "Assists", { max: 199 })}
        {numField("rating", "Rating", { step: "0.1", max: 20, placeholder: "e.g. 8.6" })}
        {numField("gold", "Gold")}
        {numField("duration_min", "Minutes", { step: "0.1", max: 90 })}
        {numField("damage", "Hero damage")}
        {numField("damage_taken", "Damage taken")}
        {numField("turret_damage", "Turret damage")}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-[12px] font-bold cursor-pointer select-none">
          <input type="checkbox" checked={f.mvp} onChange={(e) => set("mvp", e.target.checked)} /> <Crown size={13} className="text-amber" aria-hidden="true" /> MVP
        </label>
        <div className="flex-1 min-w-[12rem]"><Field label="Notes"><input className="input" maxLength={400} value={f.notes} placeholder="Savage, carried, tilted…" onChange={(e) => set("notes", e.target.value)} /></Field></div>
      </div>
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}><X size={14} /> Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {game ? "Save game" : "Add game"}</button>
      </div>
    </form>
  );
}

// --------------------------------------------------------------------------- //
// add games: upload files
// --------------------------------------------------------------------------- //
type Job = { id: string; name: string; status: "uploading" | "reading" | "done" | "error" | "undone"; result?: SoloImport; error?: string };

function downloadTemplate() {
  const example = [todayIso(), "Ranked", "Ling", "JUNGLE", "WIN", "9", "2", "7", "11.2", "13200", "98000", "41000", "6200", "14:32", "yes", ""];
  const csv = `${TEMPLATE_HEADERS.join(",")}\n${example.join(",")}\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = "9clover-my-games.csv"; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Drop screenshots / documents / sheets; your games are picked out and added right away. */
export function RecordUploader({ onChanged, onAddByHand }: { onChanged: () => void; onAddByHand?: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drag, setDrag] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (id: string, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  async function handle(files: FileList | File[] | null) {
    const list = Array.from(files ?? []).slice(0, 10);
    if (!list.length) return;
    const queued = list.map((f) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: f.name, status: "uploading" as const }));
    setJobs((js) => [...queued, ...js].slice(0, 12));
    for (const [i, file] of list.entries()) {
      const id = queued[i].id;
      try {
        const form = new FormData();
        form.append("file", file);
        const saved = await api.upload<{ url: string }>("/files", form);
        update(id, { status: "reading" });
        const read = await api.post<SoloImport>("/solo-games/import", { file_url: saved.url });
        update(id, { status: "done", result: read });
      } catch (e) {
        update(id, { status: "error", error: errText(e) });
      }
    }
    if (fileRef.current) fileRef.current.value = "";
    onChanged();
  }

  async function undo(job: Job) {
    if (!job.result?.batch) return;
    try {
      await api.post("/solo-games/undo", { batch: job.result.batch });
      update(job.id, { status: "undone" });
      onChanged();
    } catch (e) { setActionError(e); }
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files); };
  const busy = jobs.some((j) => j.status === "uploading" || j.status === "reading");

  return (
    <div className="space-y-3">
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
        className={`utility-drop relative overflow-hidden rounded-2xl border-2 border-dashed p-5 sm:p-7 text-center transition ${drag ? "border-crim bg-crim/10" : "border-edge-2 bg-ink/40 hover:border-crim/50"}`}>
        <input ref={fileRef} id="solo-upload" type="file" className="sr-only" multiple accept={SOLO_ACCEPT} onChange={(e) => void handle(e.target.files)} />
        <div className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-crim/40 bg-crim/10 text-crim mb-3">
          {busy ? <Loader2 size={22} className="animate-spin" /> : <Upload size={22} />}
        </div>
        <p className="text-[14px] font-extrabold">Drop your games here</p>
        <p className="text-[11.5px] text-mute mt-1 max-w-md mx-auto">A match-history screen, a post-match scoreboard, a PDF or Word file, or a sheet with lots of games. Your games go straight onto your record.</p>
        <div className="mt-3.5 flex flex-wrap justify-center gap-2">
          <label htmlFor="solo-upload" className="btn-primary cursor-pointer inline-flex"><Upload size={14} /> Pick files</label>
          {onAddByHand && <button type="button" className="btn-ghost" onClick={onAddByHand}><Plus size={14} /> Add one by hand</button>}
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5 text-[10px]">
          <span className="chip border-edge text-mute"><ImageIcon size={11} /> Screenshots</span>
          <span className="chip border-edge text-mute"><FileText size={11} /> PDF · Word · text</span>
          <span className="chip border-edge text-mute"><FileSpreadsheet size={11} /> Excel · CSV</span>
        </div>
        <p className="text-[10.5px] text-faint mt-3">Up to 10 at once. Sheets with hero / result / K / D / A columns work best. <button type="button" className="text-crim underline" onClick={downloadTemplate}>Get the CSV template</button></p>
      </div>
      <ErrorNote error={actionError} />
      {jobs.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {jobs.map((j) => (
            <li key={j.id} className={`card p-3 ${j.status === "error" ? "border-danger/45" : j.status === "done" && j.result?.added.length ? "border-leaf/40" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-bold truncate max-w-[60%]">{j.name}</span>
                <span className="text-[10.5px] text-faint">
                  {j.status === "uploading" ? "Uploading…" : j.status === "reading" ? "Reading your games…" : j.status === "error" ? "Couldn't read it"
                    : j.status === "undone" ? "Taken back (in Trash)" : `${j.result?.added.length ?? 0} added${j.result?.duplicates ? ` · ${j.result.duplicates} already there` : ""}${j.result?.read_directly ? " · read straight from the sheet" : ""}`}
                </span>
                {(j.status === "uploading" || j.status === "reading") && <Loader2 size={13} className="animate-spin text-crim" />}
                {j.status === "done" && j.result?.batch && (
                  <button type="button" className="btn-ghost !py-1 !px-2 !text-[10px] ml-auto" onClick={() => void undo(j)}><RotateCcw size={12} /> Undo</button>
                )}
              </div>
              {j.error && <p className="text-[11px] text-danger mt-1.5">{j.error}</p>}
              {j.status === "done" && j.result && (
                <>
                  {j.result.added.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {j.result.added.slice(0, 8).map((g) => (
                        <span key={g.id} className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[10.5px] ${g.result === "WIN" ? "border-leaf/35" : g.result === "LOSS" ? "border-danger/35" : "border-edge"}`}>
                          <HeroImg name={g.hero} size={18} className="rounded" /> {g.hero || "?"} <span className="text-faint tabular-nums">{kdaLine(g)}</span>
                        </span>
                      ))}
                      {j.result.added.length > 8 && <span className="text-[10.5px] text-faint self-center">+{j.result.added.length - 8} more</span>}
                    </div>
                  )}
                  {j.result.checks.length > 0 && <ul className="mt-2 space-y-1">{j.result.checks.map((c, i) => <CheckLine key={i} check={c} />)}</ul>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// add games: the list
// --------------------------------------------------------------------------- //
export function GamesTable({ data, loading, error, onEdit, onAdd, onChanged, readOnly = false }: {
  data: SoloGamesPayload | null; loading: boolean; error: unknown; onEdit: (g: SoloGame) => void; onAdd: () => void;
  onChanged: () => void; readOnly?: boolean;
}) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<"" | "WIN" | "LOSS">("");
  const [shown, setShown] = useState(25);
  const [actionError, setActionError] = useState<unknown>(null);
  const games = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.games ?? []).filter((g) => (!result || g.result === result) && (!needle || g.hero.toLowerCase().includes(needle) || g.mode.toLowerCase().includes(needle)));
  }, [data, q, result]);

  async function remove(g: SoloGame) {
    if (!window.confirm(`Move this ${g.hero || "game"} game to Trash? You can restore it from Trash.`)) return;
    try { await api.del(`/solo-games/${g.id}`); onChanged(); } catch (e) { setActionError(e); }
  }

  return (
    <section>
      <SectionTitle right={readOnly ? undefined : <button type="button" className="btn-ghost !py-1.5" onClick={onAdd}><Plus size={14} /> Add a game</button>}>
        {readOnly ? "Games" : "My games"}{data ? ` · ${data.total}` : ""}
      </SectionTitle>
      <ErrorNote error={error || actionError} />
      {loading && !data ? <Spinner label="Loading games" /> : !data?.games.length ? (
        <Empty title="No games yet" hint={readOnly ? "Nothing added yet." : "Upload a screenshot or sheet, or add a game by hand."} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2.5">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input className="input !pl-8 !py-1.5 !w-48" placeholder="Hero or mode…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter games" />
            </div>
            {(["", "WIN", "LOSS"] as const).map((r) => (
              <button key={r || "all"} type="button" aria-pressed={result === r} onClick={() => setResult(r)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${result === r ? "border-crim/60 bg-crim/10 text-crim" : "border-edge text-faint hover:text-mute"}`}>
                {r === "" ? "All" : r === "WIN" ? "Wins" : "Losses"}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-edge min-w-0">
            <table className="w-full text-[11.5px]">
              <thead className="bg-raised/60 text-faint text-left">
                <tr>
                  <th className="th">Date</th><th className="th">Hero</th><th className="th">Result</th><th className="th">K/D/A</th>
                  <th className="th">Rating</th><th className="th hidden sm:table-cell">Gold</th><th className="th hidden md:table-cell">Damage</th>
                  <th className="th hidden sm:table-cell">Mode</th>{!readOnly && <th className="th"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {games.slice(0, shown).map((g) => (
                  <tr key={g.id} className="border-t border-edge/60">
                    <td className="td whitespace-nowrap text-mute">{g.played_on ? fmtDate(g.played_on) : "—"}</td>
                    <td className="td"><span className="flex items-center gap-2 min-w-0"><HeroImg name={g.hero} size={24} className="rounded" /><span className="font-bold truncate">{g.hero || "—"}</span>{g.mvp && <Crown size={12} className="text-amber shrink-0" aria-label="MVP" />}</span></td>
                    <td className="td"><ResultChip result={g.result} /></td>
                    <td className="td tabular-nums">{kdaLine(g)}</td>
                    <td className="td tabular-nums">{g.rating ?? "—"}</td>
                    <td className="td tabular-nums hidden sm:table-cell">{n(g.gold)}</td>
                    <td className="td tabular-nums hidden md:table-cell">{n(g.damage)}</td>
                    <td className="td hidden sm:table-cell text-mute"><span className="inline-flex items-center gap-1.5">{sourceIcon(g.source)} {g.mode || "—"}</span></td>
                    {!readOnly && (
                      <td className="td">
                        <span className="flex justify-end gap-1">
                          <button type="button" className="btn-ghost !p-1.5" title="Edit game" aria-label={`Edit ${g.hero} game`} onClick={() => onEdit(g)}><Pencil size={12} /></button>
                          <button type="button" className="btn-ghost !p-1.5 hover:text-danger" title="Move to Trash" aria-label={`Delete ${g.hero} game`} onClick={() => void remove(g)}><Trash2 size={12} /></button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {games.length > shown && <button type="button" className="btn-ghost mt-2.5 w-full justify-center" onClick={() => setShown((s) => s + 50)}>Show more ({games.length - shown} left)</button>}
          {!games.length && <p className="text-[12px] text-faint mt-2">No games match that filter.</p>}
        </>
      )}
      {!readOnly && <p className="text-[10.5px] text-faint mt-2.5">Only you and team staff can see these games. Deleted games go to Trash. They never change team scrim or tournament stats.</p>}
    </section>
  );
}

// --------------------------------------------------------------------------- //
// what to work on
// --------------------------------------------------------------------------- //
const ALERT_ICON: Record<string, typeof Flame> = {
  losing_streak: Flame, form_drop: TrendingDown, deaths: Skull, struggling: TrendingDown, low_kda: Skull,
  low_rating: Gauge, cold_streak: Flame, strength: Sparkles, form_up: TrendingUp,
};
const TONE: Record<SoloAlert["tone"], string> = {
  bad: "border-danger/45", warn: "border-amber/45", good: "border-leaf/45",
};
const BAR: Record<SoloAlert["tone"], string> = { bad: "bg-danger", warn: "bg-amber", good: "bg-leaf" };
const CHIP: Record<SoloAlert["tone"], string> = {
  bad: "text-danger border-danger/45 bg-danger/10", warn: "text-amber border-amber/45 bg-amber/10", good: "text-leaf border-leaf/45 bg-leaf/10",
};

export function WorkOn({ alerts }: { alerts: SoloAlert[] }) {
  if (!alerts.length) return <p className="text-[12px] text-faint">Nothing flagged yet. This fills in once you have 3+ games on a hero.</p>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {alerts.map((a, i) => {
        const Icon = ALERT_ICON[a.kind] ?? Info;
        return (
          <li key={`${a.kind}-${a.hero ?? i}`} className={`card relative overflow-hidden p-3 flex gap-3 ${TONE[a.tone]}`}>
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${BAR[a.tone]}`} />
            <span className="relative shrink-0">
              {a.hero ? <HeroImg name={a.hero} size={42} className="rounded-lg" /> : <span className={`grid h-[42px] w-[42px] place-items-center rounded-lg border ${CHIP[a.tone]}`}><Icon size={18} /></span>}
              {a.hero && <span className={`absolute -bottom-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full border bg-panel ${CHIP[a.tone]}`}><Icon size={11} aria-hidden="true" /></span>}
            </span>
            <div className="min-w-0"><div className="text-[12px] font-extrabold">{a.title}</div><p className="text-[11px] text-mute mt-0.5">{a.detail}</p></div>
          </li>
        );
      })}
    </ul>
  );
}

const nice_lane = (v: string) => (v ? v[0] + v.slice(1).toLowerCase() : "");

/** Heroes with no games yet, ones you've stopped playing, and what's strong in your lane — each with an add button. */
export function HeroGaps({ gaps, lane, onAdd }: { gaps?: SoloGaps; lane?: string; onAdd?: (hero: string, lane?: string) => void }) {
  if (!gaps) return null;
  const groups: { key: keyof SoloGaps; title: string; hint: string; tone: string; icon: typeof Flame }[] = [
    { key: "no_data", title: "Heroes with no data", hint: `Heroes in your pool${lane ? ` and your ${nice_lane(lane)} lane` : ""} with no games on your record`, tone: "border-sky/40", icon: CircleDashed },
    { key: "not_playing", title: "Heroes you've stopped playing", hint: "You used to play these. Get a few games in so they stay sharp", tone: "border-amber/40", icon: Hourglass },
    { key: "lane_meta", title: "Strong in your lane right now", hint: "Worth adding to your pool", tone: "border-leaf/40", icon: Sparkles },
  ];
  const any = groups.some((g) => gaps[g.key].length);
  if (!any) return <p className="text-[12px] text-faint">No gaps. Every hero in your pool has games on your record.</p>;
  return (
    <div className="space-y-4">
      {groups.map((g) => gaps[g.key].length ? (
        <div key={g.key}>
          <div className="mb-2">
            <h3 className="text-[12.5px] font-extrabold flex items-center gap-1.5"><g.icon size={14} className="text-crim shrink-0" aria-hidden="true" /> {g.title}</h3>
            <p className="text-[10.5px] text-faint mt-0.5">{g.hint}</p>
          </div>
          <ul className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))]">
            {gaps[g.key].map((h) => (
              <li key={h.hero} className={`card p-2.5 flex items-center gap-2.5 ${g.tone}`}>
                <HeroImg name={h.hero} size={44} className="rounded-lg shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[12px] font-extrabold">{h.hero}</span>
                    {h.status && <span className={`chip !py-0 !text-[9px] ${h.status === "META" ? "border-crim/50 text-crim" : "border-leaf/45 text-leaf"}`}>{h.status === "META" ? "Meta" : "Strong"}</span>}
                  </div>
                  <p className="text-[10.5px] text-mute leading-snug line-clamp-3">{h.why}</p>
                </div>
                {onAdd && (
                  <button type="button" className="btn-ghost !p-1.5 shrink-0" title={`Add a ${h.hero} game`} aria-label={`Add a ${h.hero} game`}
                    onClick={() => onAdd(h.hero, h.role && LANES.includes(h.role) ? h.role : undefined)}><Plus size={14} /></button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null)}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// progress
// --------------------------------------------------------------------------- //
function Delta({ value, suffix = "", invert = false }: { value: number | null; suffix?: string; invert?: boolean }) {
  if (value == null) return <span className="text-faint">—</span>;
  const good = invert ? value < 0 : value > 0;
  const cls = value === 0 ? "text-mute" : good ? "text-leaf" : "text-danger";
  return <span className={`font-extrabold tabular-nums ${cls}`}>{value > 0 ? "+" : ""}{Number.isInteger(value) ? value : value.toFixed(value % 1 && Math.abs(value) < 10 ? 2 : 1)}{suffix}</span>;
}

function WinBar({ rate }: { rate: number | null }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-raised overflow-hidden border border-edge/60" role="img" aria-label={`Win rate ${pct(rate)}`}>
      <div className={`h-full rounded-full ${rate == null ? "" : rate >= 55 ? "bg-leaf" : rate >= 45 ? "bg-amber" : "bg-danger"}`} style={{ width: `${rate ?? 0}%` }} />
    </div>
  );
}

function GroupChips({ title, rows }: { title: string; rows: SoloGroup[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="label mb-1.5">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <span key={r.name} className="chip border-edge text-mute tabular-nums">
            <b className="text-text">{LANES.includes(r.name) && r.name !== "EXP" ? nice_lane(r.name) : r.name}</b> {r.games} · {pct(r.win_rate)}
          </span>
        ))}
      </div>
    </div>
  );
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function monday(d: Date) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
const gameKda = (g: SoloGame) => (g.kills == null && g.deaths == null && g.assists == null ? null : ((g.kills ?? 0) + (g.assists ?? 0)) / Math.max(g.deaths ?? 0, 1));
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((t, v) => t + v, 0) / xs.length) * 100) / 100 : null);

/** Weekly wins/losses (+ win %), a rolling KDA/rating line, lanes and top heroes — all from the games list. */
export function weeklyBuckets(games: SoloGame[], weeks = 12, today = new Date()) {
  const start = monday(today);
  const keys = Array.from({ length: weeks }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() - 7 * (weeks - 1 - i)); return isoDay(d); });
  const rows = keys.map((week) => ({ week, wins: 0, losses: 0, other: 0, kda: [] as number[], rating: [] as number[] }));
  const index = new Map(keys.map((k, i) => [k, i]));
  for (const g of games) {
    if (!g.played_on) continue;
    const i = index.get(isoDay(monday(new Date(`${g.played_on}T00:00:00`))));
    if (i == null) continue;
    const r = rows[i];
    if (g.result === "WIN") r.wins++; else if (g.result === "LOSS") r.losses++; else r.other++;
    const k = gameKda(g); if (k != null) r.kda.push(k);
    if (g.rating != null) r.rating.push(g.rating);
  }
  return rows.map((r) => ({
    week: r.week, wins: r.wins, losses: r.losses, other: r.other, games: r.wins + r.losses + r.other,
    win_rate: r.wins + r.losses ? Math.round((r.wins / (r.wins + r.losses)) * 1000) / 10 : null,
    kda: avg(r.kda), rating: avg(r.rating),
  }));
}

export function rollingForm(games: SoloGame[], last = 40, window = 5) {
  const ordered = [...games].filter((g) => g.played_on).sort((a, b) => (a.played_on! < b.played_on! ? -1 : a.played_on! > b.played_on! ? 1 : a.id - b.id)).slice(-last);
  return ordered.map((g, i) => {
    const slice = ordered.slice(Math.max(0, i - window + 1), i + 1);
    const kdas = slice.map(gameKda).filter((v): v is number => v != null);
    const ratings = slice.map((x) => x.rating).filter((v): v is number => v != null);
    const decided = slice.filter((x) => x.result === "WIN" || x.result === "LOSS");
    return {
      game: g, label: g.played_on ? fmtDate(g.played_on) : `#${i + 1}`,
      kda: avg(kdas), rating: avg(ratings),
      win_rate: decided.length ? Math.round((decided.filter((x) => x.result === "WIN").length / decided.length) * 100) : null,
    };
  });
}

const LANE_COLOR: Record<string, string> = { EXP: CHART_COLORS.amber, JUNGLE: CHART_COLORS.win, MID: CHART_COLORS.violet, GOLD: "#fde68a", ROAM: CHART_COLORS.sky };

export function ProgressCharts({ data }: { data: SoloGamesPayload }) {
  const s = data.stats;
  const weeks = useMemo(() => weeklyBuckets(data.games), [data.games]);
  const roll = useMemo(() => rollingForm(data.games), [data.games]);
  const tr = s.trend;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="card chart-card p-4 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div><h3 className="text-[13px] font-extrabold">Games by week</h3><p className="text-[10.5px] text-faint">Wins and losses each week, with your win rate on top</p></div>
            <Legend items={[{ name: "Wins", color: CHART_COLORS.win }, { name: "Losses", color: CHART_COLORS.loss }, { name: "Win %", color: CHART_COLORS.accent }]} />
          </div>
          <BarChart caption="Your games by week" labels={weeks.map((w) => weekLabel(w.week))} height={250}
            titleFor={(i) => `Week of ${weekLabel(weeks[i].week)}`}
            series={[{ name: "Wins", color: CHART_COLORS.win, values: weeks.map((w) => w.wins) }, { name: "Losses", color: CHART_COLORS.loss, values: weeks.map((w) => w.losses) }]}
            overlay={{ name: "Win %", color: CHART_COLORS.accent, values: weeks.map((w) => w.win_rate), format: (v) => (v == null ? "—" : `${v}%`) }} />
        </section>
        <section className="card chart-card p-4 min-w-0">
          <h3 className="text-[13px] font-extrabold">Lanes</h3>
          <p className="text-[10.5px] text-faint mb-3">Where your games come from</p>
          {s.lanes.length ? (
            <div className="flex flex-wrap items-center gap-4">
              <Donut caption="Games by lane" parts={s.lanes.map((l) => ({ label: l.name, value: l.games, color: LANE_COLOR[l.name] ?? CHART_COLORS.pink }))}
                center={<div><div className="text-[22px] font-extrabold tabular-nums"><CountUp value={s.overall.games} /></div><div className="text-[9.5px] text-faint">games</div></div>} />
              <ul className="space-y-1.5 text-[11px] min-w-0 flex-1">
                {s.lanes.map((l) => (
                  <li key={l.name} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: LANE_COLOR[l.name] ?? CHART_COLORS.pink }} />
                    <b className="w-14">{l.name === "EXP" ? "EXP" : nice_lane(l.name)}</b>
                    <span className="text-mute tabular-nums">{l.games} · {pct(l.win_rate)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <p className="text-[11.5px] text-faint">Add the lane to your games to see this.</p>}
        </section>
      </div>
      <section className="card chart-card p-4 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div><h3 className="text-[13px] font-extrabold">Form over your last {roll.length} games</h3><p className="text-[10.5px] text-faint">Averaged over 5 games, so one bad game doesn't hide the trend</p></div>
          <Legend items={[{ name: "KDA", color: CHART_COLORS.accent }, { name: "Rating", color: CHART_COLORS.sky }, { name: "Win % (right)", color: CHART_COLORS.win, dashed: true }]} />
        </div>
        {roll.length >= 2 ? (
          <LineChart caption="Your form over recent games" height={270} labels={roll.map((r) => r.label)}
            titleFor={(i) => `${roll[i].game.hero || "Game"} · ${roll[i].label}`} rightMax={100} rightFormat={(v) => `${Math.round(v)}%`}
            series={[
              { name: "KDA", color: CHART_COLORS.accent, values: roll.map((r) => r.kda), area: true },
              { name: "Rating", color: CHART_COLORS.sky, values: roll.map((r) => r.rating) },
              { name: "Win %", color: CHART_COLORS.win, values: roll.map((r) => r.win_rate), right: true, dashed: true, format: (v) => (v == null ? "—" : `${v}%`) },
            ]} />
        ) : <p className="text-[11.5px] text-faint">Add a couple of dated games to see your form line.</p>}
        {tr && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center border-t border-edge/60 pt-3">
            <div><div className="text-[10px] text-faint">Win rate</div><Delta value={tr.win_rate} suffix="%" /></div>
            <div><div className="text-[10px] text-faint">KDA</div><Delta value={tr.kda} /></div>
            <div><div className="text-[10px] text-faint">Rating</div><Delta value={tr.rating} /></div>
            <div><div className="text-[10px] text-faint">Deaths</div><Delta value={tr.deaths} invert /></div>
            <p className="col-span-full text-[10px] text-faint">Last {tr.recent.games} games vs the {tr.before.games} before</p>
          </div>
        )}
      </section>
      <section className="card chart-card p-4 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div><h3 className="text-[13px] font-extrabold">Heroes</h3><p className="text-[10.5px] text-faint">Games on each hero, coloured by win rate</p></div>
          <GroupChips title="" rows={s.modes} />
        </div>
        <HBars caption="Games per hero" rows={s.heroes.slice(0, 10).map((h) => ({
          key: h.name, value: h.games, label: <span className="inline-flex items-center gap-1.5"><HeroImg name={h.name} size={20} className="rounded" />{h.name}</span>,
          tone: h.win_rate == null ? CHART_COLORS.sky : h.win_rate >= 55 ? CHART_COLORS.win : h.win_rate >= 45 ? CHART_COLORS.amber : CHART_COLORS.loss,
          extra: `${pct(h.win_rate)} · KDA ${kdaText(h.kda?.ratio)}`,
        }))} format={(v) => `${v} game${v === 1 ? "" : "s"}`} />
      </section>
    </div>
  );
}

export function HeroTable({ stats }: { stats: SoloGamesPayload["stats"] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-edge min-w-0">
      <table className="w-full text-[11.5px]">
        <thead className="bg-raised/60 text-faint text-left">
          <tr><th className="th">Hero</th><th className="th">Games</th><th className="th w-[22%]">Win rate</th><th className="th">KDA</th><th className="th hidden sm:table-cell">Rating</th><th className="th hidden sm:table-cell">MVP</th><th className="th">Form</th></tr>
        </thead>
        <tbody>
          {stats.heroes.slice(0, 20).map((h) => (
            <tr key={h.name} className="border-t border-edge/60">
              <td className="td"><span className="flex items-center gap-2"><HeroImg name={h.name} size={26} className="rounded" /><span className="font-bold">{h.name}</span></span></td>
              <td className="td tabular-nums">{h.games} <span className="text-faint">({h.wins}–{h.losses})</span></td>
              <td className="td"><div className="flex items-center gap-2"><span className="tabular-nums w-11 shrink-0">{pct(h.win_rate)}</span><WinBar rate={h.win_rate} /></div></td>
              <td className="td tabular-nums">{kdaText(h.kda?.ratio)}</td>
              <td className="td tabular-nums hidden sm:table-cell">{h.rating?.avg ?? "—"}</td>
              <td className="td tabular-nums hidden sm:table-cell">{h.mvps || "—"}</td>
              <td className="td"><FormDots form={h.form.slice(0, 5)} label={`Form on ${h.name}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// your plan
// --------------------------------------------------------------------------- //
function Plan({ coaching }: { coaching: SoloCoaching }) {
  const heroGroups: { key: keyof SoloCoaching["heroes"]; label: string; cls: string }[] = [
    { key: "keep", label: "Keep playing", cls: "border-leaf/45 text-leaf" },
    { key: "work_on", label: "Work on", cls: "border-amber/45 text-amber" },
    { key: "try", label: "Try next", cls: "border-sky/45 text-sky" },
  ];
  return (
    <div className="space-y-3.5">
      <div className="rounded-xl border border-crim/40 bg-crim/5 p-4">
        <div className="flex items-center gap-2 text-crim text-[10px] font-extrabold mb-1"><Target size={13} /> Your plan · from {coaching.games_used} games</div>
        <p className="text-[14px] font-extrabold">{coaching.headline}</p>
        {coaching.summary && <p className="text-[12px] text-mute mt-1.5 leading-relaxed">{coaching.summary}</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {coaching.strengths.length > 0 && (
          <div className="space-y-2">
            <div className="label flex items-center gap-1.5"><Trophy size={12} className="text-leaf" /> What's working</div>
            {coaching.strengths.map((s, i) => (
              <div key={i} className="card border-leaf/35 p-3"><div className="text-[12px] font-extrabold text-leaf">{s.title}</div><p className="text-[11.5px] text-mute mt-1">{s.detail}</p></div>
            ))}
          </div>
        )}
        {coaching.fixes.length > 0 && (
          <div className="space-y-2">
            <div className="label flex items-center gap-1.5"><Target size={12} className="text-amber" /> Fix next</div>
            {coaching.fixes.map((s, i) => (
              <div key={i} className="card border-amber/35 p-3">
                <div className="text-[12px] font-extrabold text-amber">{s.title}</div>
                <p className="text-[11.5px] text-mute mt-1">{s.detail}</p>
                {s.drill && <p className="text-[11px] mt-1.5 rounded-md border border-edge bg-ink/40 px-2 py-1.5"><b className="text-text">Drill:</b> <span className="text-mute">{s.drill}</span></p>}
              </div>
            ))}
          </div>
        )}
      </div>
      {heroGroups.some((g) => coaching.heroes[g.key]?.length) && (
        <div className="grid gap-2.5 sm:grid-cols-3">
          {heroGroups.map((g) => coaching.heroes[g.key]?.length ? (
            <div key={g.key}>
              <div className="label mb-1.5">{g.label}</div>
              <div className="space-y-1.5">
                {coaching.heroes[g.key].map((h) => (
                  <div key={h.hero} className={`flex items-start gap-2 rounded-lg border bg-panel/60 p-2 ${g.cls}`}>
                    <HeroImg name={h.hero} size={30} className="rounded-md shrink-0" />
                    <div className="min-w-0"><div className="text-[11.5px] font-extrabold">{h.hero}</div><div className="text-[10.5px] text-mute">{h.why}</div></div>
                  </div>
                ))}
              </div>
            </div>
          ) : null)}
        </div>
      )}
      {coaching.next_games.length > 0 && (
        <div className="card p-3">
          <div className="label mb-2">Goals for your next games</div>
          <ol className="space-y-1.5">
            {coaching.next_games.map((g, i) => (
              <li key={i} className="flex gap-2 text-[12px]"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-crim/50 text-crim text-[10px] font-extrabold">{i + 1}</span><span>{g}</span></li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** "Get my plan": strengths, fixes with drills, heroes to keep / work on / try, goals. */
export function PlanPanel({ games }: { games: number }) {
  const [focus, setFocus] = useState("");
  const [coaching, setCoaching] = useState<SoloCoaching | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true); setError(null);
    try { setCoaching(await api.post<SoloCoaching>("/solo-games/coach", { focus })); } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <section>
      <SectionTitle>Your plan</SectionTitle>
      <form onSubmit={run} className="flex flex-col sm:flex-row gap-2 mb-3">
        <input className="input flex-1" maxLength={300} value={focus} onChange={(e) => setFocus(e.target.value)}
          placeholder="Optional focus: climbing to Mythic, my jungle pathing, why I lose on Ling…" aria-label="What should the plan focus on" />
        <button className="btn-primary justify-center" disabled={busy || games < 3}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />} {coaching ? "New plan" : "Get my plan"}
        </button>
      </form>
      {games < 3 && <p className="text-[11px] text-faint">Add at least 3 games to get a plan.</p>}
      <ErrorNote error={error} />
      {busy && !coaching && <Spinner label="Going through your games" />}
      {coaching && <Plan coaching={coaching} />}
    </section>
  );
}

export { FormDots, GroupChips, Delta, useHeroes };
