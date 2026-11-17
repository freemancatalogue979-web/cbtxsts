/**
 * 9 Clover AI → Utility AI + Learning utility.
 *
 * Utility AI: a player drops a screenshot, document or spreadsheet at any time and the AI
 * adds their own (solo) games straight to their record — no approval needed, with an undo
 * per file, edit/delete per game, and a manual "add a game" form.
 * Learning utility: what those games say — form, heroes, trend, what to work on — plus
 * AI coaching on request.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  AlertTriangle, BrainCircuit, CheckCircle2, Crown, FileSpreadsheet, FileText, Flame, Gauge, Image as ImageIcon, Info,
  Loader2, Pencil, Plus, RotateCcw, Search, Skull, Sparkles, Target, Trash2, TrendingDown, TrendingUp, Trophy, Upload, X,
} from "lucide-react";
import { api } from "../lib/api";
import type { Hero, SoloAlert, SoloCheck, SoloCoaching, SoloGame, SoloGamesPayload, SoloGroup, SoloImport, User } from "../lib/types";
import { fmtDate, pct } from "../lib/util";
import { HeroImg } from "./HeroImg";
import { HeroPickerModal } from "./HeroPicker";
import { FormDots, kdaText } from "./PlayerPerformance";
import { Empty, ErrorNote, Field, Modal, SectionTitle, Spinner, StatTile } from "./ui";

export const SOLO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.txt,.md,.csv,.tsv,.xlsx,.json";
const MODES = ["Ranked", "Classic", "Brawl", "Custom", "Arcade"];
const LANES = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"];
const STAFF = new Set(["admin", "captain", "coach", "analyst"]);
const TEMPLATE_HEADERS = ["date", "mode", "hero", "lane", "result", "kills", "deaths", "assists", "rating", "gold",
  "damage", "damage_taken", "turret_damage", "duration", "mvp", "notes"];

const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString());
const kdaLine = (g: Pick<SoloGame, "kills" | "deaths" | "assists">) =>
  g.kills == null && g.deaths == null && g.assists == null ? "—" : `${g.kills ?? "–"}/${g.deaths ?? "–"}/${g.assists ?? "–"}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Your games + stats, reloadable. Staff may look at another player's. */
export function useSoloGames(userId?: number) {
  const [data, setData] = useState<SoloGamesPayload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<SoloGamesPayload>(`/solo-games${userId ? `?user_id=${userId}` : ""}`));
      setError(null);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }, [userId]);
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

export function SoloGameEditor({ game, heroes, lane, onSaved, onCancel }: {
  game?: SoloGame | null; heroes: Hero[]; lane?: string; onSaved: (g: SoloGame) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<GameForm>(() => toForm(game, lane));
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
// Utility AI
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

export function AIUtility({ me, onOpenLearning }: { me: User; onOpenLearning?: () => void }) {
  const { data, error, loading, reload } = useSoloGames();
  const heroes = useHeroes();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drag, setDrag] = useState(false);
  const [editing, setEditing] = useState<SoloGame | "new" | null>(null);
  const [q, setQ] = useState("");
  const [result, setResult] = useState<"" | "WIN" | "LOSS">("");
  const [shown, setShown] = useState(25);
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
    void reload();
  }

  async function undo(job: Job) {
    if (!job.result?.batch) return;
    try {
      await api.post("/solo-games/undo", { batch: job.result.batch });
      update(job.id, { status: "undone" });
      void reload();
    } catch (e) { setActionError(e); }
  }

  async function remove(g: SoloGame) {
    if (!window.confirm(`Move this ${g.hero || "game"} game to Trash? You can restore it from Trash.`)) return;
    try { await api.del(`/solo-games/${g.id}`); void reload(); } catch (e) { setActionError(e); }
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files); };
  const games = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.games ?? []).filter((g) => (!result || g.result === result) && (!needle || g.hero.toLowerCase().includes(needle) || g.mode.toLowerCase().includes(needle)));
  }, [data, q, result]);
  const busy = jobs.some((j) => j.status === "uploading" || j.status === "reading");
  const o = data?.stats.overall;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold flex items-center gap-2"><Sparkles size={16} className="text-leaf" /> Utility AI</h2>
          <p className="text-[12px] text-mute mt-1 max-w-2xl">Drop your own games in, any time. A match-history screen, a post-match scoreboard, a PDF or Word file, or a spreadsheet with lots of games. The AI picks out <b>your</b> games and adds them to your record straight away. Team scrims and tournaments aren't touched.</p>
        </div>
        {o && o.games > 0 && onOpenLearning && (
          <button type="button" className="btn-ghost" onClick={onOpenLearning}><BrainCircuit size={14} /> See what they say</button>
        )}
      </div>

      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
        className={`relative rounded-xl border-2 border-dashed p-5 sm:p-7 text-center transition ${drag ? "border-leaf bg-leaf/10" : "border-edge-2 bg-ink/40 hover:border-leaf/50"}`}>
        <input ref={fileRef} id="solo-upload" type="file" className="sr-only" multiple accept={SOLO_ACCEPT} onChange={(e) => void handle(e.target.files)} />
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-leaf/40 bg-leaf/10 text-leaf mb-3">
          {busy ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
        </div>
        <label htmlFor="solo-upload" className="btn-primary cursor-pointer inline-flex"><Upload size={14} /> Pick files</label>
        <p className="text-[11px] text-faint mt-2.5">or drop them here · up to 10 at once</p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5 text-[10px]">
          <span className="chip border-edge text-mute"><ImageIcon size={11} /> Screenshots</span>
          <span className="chip border-edge text-mute"><FileText size={11} /> PDF · Word · text</span>
          <span className="chip border-edge text-mute"><FileSpreadsheet size={11} /> Excel · CSV</span>
        </div>
        <p className="text-[10.5px] text-faint mt-3">Spreadsheets with hero / result / K / D / A columns are read directly. <button type="button" className="text-leaf underline" onClick={downloadTemplate}>Get the CSV template</button></p>
      </div>

      {jobs.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {jobs.map((j) => (
            <li key={j.id} className={`card p-3 ${j.status === "error" ? "border-danger/45" : j.status === "done" && j.result?.added.length ? "border-leaf/40" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-bold truncate max-w-[60%]">{j.name}</span>
                <span className="text-[10.5px] text-faint">
                  {j.status === "uploading" ? "Uploading…" : j.status === "reading" ? "Reading your games…" : j.status === "error" ? "Couldn't read it"
                    : j.status === "undone" ? "Taken back (in Trash)" : `${j.result?.added.length ?? 0} added${j.result?.duplicates ? ` · ${j.result.duplicates} already there` : ""}${j.result?.used_ai === false ? " · no AI needed" : ""}`}
                </span>
                {(j.status === "uploading" || j.status === "reading") && <Loader2 size={13} className="animate-spin text-leaf" />}
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

      <section>
        <SectionTitle right={<button type="button" className="btn-ghost !py-1.5" onClick={() => setEditing("new")}><Plus size={14} /> Add a game</button>}>
          My games{data ? ` · ${data.total}` : ""}
        </SectionTitle>
        <ErrorNote error={error || actionError} />
        {loading && !data ? <Spinner label="Loading your games" /> : !data?.games.length ? (
          <Empty title="No games yet" hint="Upload a screenshot or sheet above, or add a game by hand." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-2.5">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input className="input !pl-8 !py-1.5 !w-48" placeholder="Hero or mode…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter games" />
              </div>
              {(["", "WIN", "LOSS"] as const).map((r) => (
                <button key={r || "all"} type="button" aria-pressed={result === r} onClick={() => setResult(r)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold border ${result === r ? "border-leaf/60 bg-leaf/10 text-leaf" : "border-edge text-faint hover:text-mute"}`}>
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
                    <th className="th hidden sm:table-cell">Mode</th><th className="th"><span className="sr-only">Actions</span></th>
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
                      <td className="td">
                        <span className="flex justify-end gap-1">
                          <button type="button" className="btn-ghost !p-1.5" title="Edit game" aria-label={`Edit ${g.hero} game`} onClick={() => setEditing(g)}><Pencil size={12} /></button>
                          <button type="button" className="btn-ghost !p-1.5 hover:text-danger" title="Move to Trash" aria-label={`Delete ${g.hero} game`} onClick={() => void remove(g)}><Trash2 size={12} /></button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {games.length > shown && <button type="button" className="btn-ghost mt-2.5 w-full justify-center" onClick={() => setShown((s) => s + 50)}>Show more ({games.length - shown} left)</button>}
            {!games.length && <p className="text-[12px] text-faint mt-2">No games match that filter.</p>}
          </>
        )}
      </section>
      <p className="text-[10.5px] text-faint">Only you and team staff can see these games. Deleted games go to Trash. To let the AI chat use them, switch on "My solo games" in Manage memory & context.</p>

      {editing && (
        <Modal title={editing === "new" ? "Add a game" : "Edit game"} onClose={() => setEditing(null)} wide>
          <SoloGameEditor game={editing === "new" ? null : editing} heroes={heroes} lane={me.main_role ?? ""}
            onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
        </Modal>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Learning utility
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
            <b className="text-text">{r.name === "JUNGLE" || r.name === "GOLD" || r.name === "ROAM" || r.name === "MID" ? r.name[0] + r.name.slice(1).toLowerCase() : r.name}</b> {r.games} · {pct(r.win_rate)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Coaching({ coaching }: { coaching: SoloCoaching }) {
  const heroGroups: { key: keyof SoloCoaching["heroes"]; label: string; cls: string }[] = [
    { key: "keep", label: "Keep playing", cls: "border-leaf/45 text-leaf" },
    { key: "work_on", label: "Work on", cls: "border-amber/45 text-amber" },
    { key: "try", label: "Try next", cls: "border-sky/45 text-sky" },
  ];
  return (
    <div className="space-y-3.5">
      <div className="rounded-xl border border-leaf/40 bg-leaf/5 p-4">
        <div className="flex items-center gap-2 text-leaf text-[10px] font-extrabold mb-1"><BrainCircuit size={13} /> Coach's read · {coaching.games_used} games</div>
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
              <li key={i} className="flex gap-2 text-[12px]"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-leaf/50 text-leaf text-[10px] font-extrabold">{i + 1}</span><span>{g}</span></li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function AILearning({ me, onOpenUtility }: { me: User; onOpenUtility?: () => void }) {
  const staff = STAFF.has(me.role);
  const [players, setPlayers] = useState<{ id: number; name: string }[]>([]);
  const [viewing, setViewing] = useState<number | undefined>(undefined);
  const { data, error, loading } = useSoloGames(viewing);
  const [focus, setFocus] = useState("");
  const [coaching, setCoaching] = useState<SoloCoaching | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachError, setCoachError] = useState<unknown>(null);

  useEffect(() => {
    if (!staff) return;
    api.get<{ id: number; name: string; ign?: string }[]>("/players")
      .then((rows) => setPlayers(rows.map((p) => ({ id: p.id, name: p.ign || p.name }))))
      .catch(() => setPlayers([]));
  }, [staff]);

  async function coach(e?: FormEvent) {
    e?.preventDefault();
    setCoachBusy(true); setCoachError(null);
    try { setCoaching(await api.post<SoloCoaching>("/solo-games/coach", { focus })); } catch (err) { setCoachError(err); } finally { setCoachBusy(false); }
  }

  const s = data?.stats;
  const own = !viewing || viewing === me.id;
  const tr = s?.trend;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold flex items-center gap-2"><BrainCircuit size={16} className="text-leaf" /> Learning utility</h2>
          <p className="text-[12px] text-mute mt-1 max-w-2xl">What your own games say: your form, your heroes, and what to work on next. Ask the coach for a plan.</p>
        </div>
        {staff && players.length > 0 && (
          <label className="flex items-center gap-2 text-[11px] text-faint">Player
            <select className="input !py-1.5 !w-44" value={viewing ?? me.id} onChange={(e) => { const id = Number(e.target.value); setViewing(id === me.id ? undefined : id); setCoaching(null); }}>
              <option value={me.id}>Me</option>
              {players.filter((p) => p.id !== me.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <ErrorNote error={error} />
      {loading && !data ? <Spinner label="Reading your games" /> : !s || s.overall.games === 0 ? (
        <div className="card border-dashed p-6 text-center">
          <p className="text-[13px] font-bold text-mute">{own ? "No games to learn from yet" : `${data?.user?.name ?? "This player"} hasn't added any solo games yet`}</p>
          {own && <p className="text-[11.5px] text-faint mt-1">Upload a few screenshots or a sheet in Utility AI and this fills in by itself.</p>}
          {own && onOpenUtility && <button type="button" className="btn-primary mt-3" onClick={onOpenUtility}><Upload size={14} /> Add my games</button>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <StatTile label="Games" value={s.overall.games} hint={s.last_played ? `Last ${fmtDate(s.last_played)}` : undefined} />
            <StatTile label="Win rate" value={pct(s.overall.win_rate)} hint={`${s.overall.wins}W–${s.overall.losses}L`}
              tone={s.overall.win_rate == null ? "default" : s.overall.win_rate >= 50 ? "good" : "bad"} />
            <StatTile label="KDA" value={kdaText(s.overall.kda?.ratio)} hint={s.overall.kda ? `${s.overall.kda.kills}/${s.overall.kda.deaths}/${s.overall.kda.assists} a game` : "Add K/D/A"} />
            <StatTile label="Rating" value={s.overall.rating?.avg ?? "—"} hint={s.overall.rating ? `${s.overall.rating.games} rated` : "Add ratings"} />
            <StatTile label="MVPs" value={s.overall.mvps} icon={<Crown size={13} />} hint={s.overall.gold_per_min ? `${s.overall.gold_per_min} gold/min` : undefined} />
            <StatTile label="Streak" value={s.streak.count ? `${s.streak.count}${s.streak.result === "WIN" ? "W" : "L"}` : "—"}
              tone={s.streak.result === "WIN" ? "good" : s.streak.result === "LOSS" && s.streak.count >= 3 ? "bad" : "default"} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <section className="min-w-0">
              <SectionTitle>What to work on</SectionTitle>
              {s.alerts.length ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {s.alerts.map((a, i) => {
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
              ) : <p className="text-[12px] text-faint">Nothing flagged yet. Alerts need at least 3 games on a hero.</p>}
            </section>
            <section className="min-w-0 space-y-3">
              <SectionTitle>Form</SectionTitle>
              <div className="card p-3 space-y-3">
                <div className="flex items-center justify-between gap-2"><span className="label">Last 10</span><FormDots form={s.form} label="Last 10 games" /></div>
                {tr ? (
                  <div>
                    <div className="label mb-1.5">Last {tr.recent.games} vs the {tr.before.games} before</div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div><div className="text-[10px] text-faint">Win rate</div><Delta value={tr.win_rate} suffix="%" /></div>
                      <div><div className="text-[10px] text-faint">KDA</div><Delta value={tr.kda} /></div>
                      <div><div className="text-[10px] text-faint">Rating</div><Delta value={tr.rating} /></div>
                      <div><div className="text-[10px] text-faint">Deaths</div><Delta value={tr.deaths} invert /></div>
                    </div>
                  </div>
                ) : <p className="text-[11px] text-faint">The trend shows once you have 15+ games.</p>}
                <GroupChips title="Lanes" rows={s.lanes} />
                <GroupChips title="Modes" rows={s.modes} />
              </div>
            </section>
          </div>

          <section className="min-w-0">
            <SectionTitle>My heroes</SectionTitle>
            <div className="overflow-x-auto rounded-lg border border-edge min-w-0">
              <table className="w-full text-[11.5px]">
                <thead className="bg-raised/60 text-faint text-left">
                  <tr><th className="th">Hero</th><th className="th">Games</th><th className="th w-[22%]">Win rate</th><th className="th">KDA</th><th className="th hidden sm:table-cell">Rating</th><th className="th hidden sm:table-cell">MVP</th><th className="th">Form</th></tr>
                </thead>
                <tbody>
                  {s.heroes.slice(0, 20).map((h) => (
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
          </section>

          {own && (
            <section>
              <SectionTitle>AI coach</SectionTitle>
              <form onSubmit={coach} className="flex flex-col sm:flex-row gap-2 mb-3">
                <input className="input flex-1" maxLength={300} value={focus} onChange={(e) => setFocus(e.target.value)}
                  placeholder="Optional focus: climbing to Mythic, my jungle pathing, why I lose on Ling…" aria-label="Coaching focus" />
                <button className="btn-primary justify-center" disabled={coachBusy || s.overall.games < 3}>
                  {coachBusy ? <Loader2 size={14} className="animate-spin" /> : <BrainCircuit size={14} />} {coaching ? "Coach me again" : "Coach me"}
                </button>
              </form>
              {s.overall.games < 3 && <p className="text-[11px] text-faint">Add at least 3 games to get coaching.</p>}
              <ErrorNote error={coachError} />
              {coachBusy && !coaching && <Spinner label="The coach is going through your games" />}
              {coaching && <Coaching coaching={coaching} />}
            </section>
          )}
        </>
      )}
    </div>
  );
}
