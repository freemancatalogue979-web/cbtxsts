/**
 * Utility → Match data (staff). Browse scrims and tournament matches, choose the match and
 * the game, pick (or upload) the scoreboard screenshot, and the sheet is read and laid out
 * as a match chart with every field editable. Nothing is saved until "Confirm & add".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, CheckCircle2, ChevronRight, Clock, Crown, ExternalLink, Image as ImageIcon, Loader2, ScanLine, Search, Swords, Trophy, Upload,
} from "lucide-react";
import { api } from "../lib/api";
import type { Draft, Hero, HeroCheck, ScoreboardRead, SheetRowHero, UtilityMatch, UtilityRead } from "../lib/types";
import { fmtDate, navigate } from "../lib/util";
import { HeroImg } from "./HeroImg";
import { HeroPickerModal } from "./HeroPicker";
import { EnemyScoreboard, SCORE_LANES, ScoreboardFields, formToLines, linesToForm, sumLines, type LineForm } from "./Scoreboard";
import { CountUp } from "./Charts";
import { Empty, ErrorNote, Spinner } from "./ui";

const laneName = (l: string) => (l === "EXP" ? "EXP" : l[0] + l.slice(1).toLowerCase());
const num = (v: string | undefined) => (v == null || v.trim() === "" ? null : Number(v));
const short = (v: number | null) => (v == null ? "—" : v >= 10000 ? `${(v / 1000).toFixed(1)}k` : v.toLocaleString());

// --------------------------------------------------------------------------- //
// 1. browse
// --------------------------------------------------------------------------- //
function MatchCard({ m, active, onPick }: { m: UtilityMatch; active: boolean; onPick: () => void }) {
  const [us, them] = m.score;
  const filled = m.games.filter((g) => g.has_stats).length;
  return (
    <button type="button" onClick={onPick} aria-pressed={active}
      className={`card w-full text-left p-3 transition hover:border-crim/50 ${active ? "border-crim/70 bg-crim/5 ring-1 ring-crim/40" : ""}`}>
      <div className="flex items-start gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${m.kind === "scrim" ? "border-sky/40 text-sky bg-sky/10" : "border-amber/40 text-amber bg-amber/10"}`}>
          {m.kind === "scrim" ? <Swords size={16} aria-hidden="true" /> : <Trophy size={16} aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-extrabold truncate">{m.title}</div>
          <div className="text-[10.5px] text-faint truncate">{m.event} · {m.date ? fmtDate(m.date) : "No date"} · {m.format}</div>
        </div>
        <span className={`text-[13px] font-extrabold tabular-nums ${m.result === "WIN" ? "text-leaf" : m.result === "LOSS" ? "text-danger" : "text-mute"}`}>{us ?? 0}–{them ?? 0}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {m.slots.map((no) => {
          const g = m.games.find((x) => x.game_no === no);
          return (
            <span key={no} className={`chip !py-0 !text-[9.5px] ${g?.has_stats ? "border-leaf/45 text-leaf" : g ? "border-amber/45 text-amber" : "border-edge text-faint"}`}>
              G{no}{g?.has_stats ? " ✓" : g ? " · no stats" : " · empty"}
            </span>
          );
        })}
        <span className="ml-auto text-[9.5px] text-faint inline-flex items-center gap-1"><ImageIcon size={10} aria-hidden="true" />{m.evidence.length} · {filled}/{m.games.length || 0} filled</span>
      </div>
    </button>
  );
}

// --------------------------------------------------------------------------- //
// 3. the chart
// --------------------------------------------------------------------------- //
function Mirror({ label, us, them, format = short, delay = 0 }: { label: string; us: number | null; them: number | null; format?: (v: number | null) => string; delay?: number }) {
  const top = Math.max(us ?? 0, them ?? 0, 1);
  const lead = (us ?? 0) === (them ?? 0) ? "" : (us ?? 0) > (them ?? 0) ? "us" : "them";
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_5.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-[11px]">
      <b className={`text-right tabular-nums ${lead === "us" ? "text-crim" : "text-mute"}`}>{format(us)}</b>
      <span className="relative h-3 rounded-l-full bg-raised overflow-hidden">
        <span className="chart-bar-x chart-bar-x-rev absolute inset-y-0 right-0 rounded-l-full" style={{ width: `${((us ?? 0) / top) * 100}%`, background: "var(--color-crim)", animationDelay: `${delay}ms` }} />
      </span>
      <span className="text-center text-faint text-[10px] truncate">{label}</span>
      <span className="relative h-3 rounded-r-full bg-raised overflow-hidden">
        <span className="chart-bar-x absolute inset-y-0 left-0 rounded-r-full" style={{ width: `${((them ?? 0) / top) * 100}%`, background: "var(--color-danger)", animationDelay: `${delay}ms` }} />
      </span>
      <b className={`tabular-nums ${lead === "them" ? "text-danger" : "text-mute"}`}>{format(them)}</b>
    </div>
  );
}

/** The "match sheet": result, team totals side by side, and each lane's duel. Follows the edits live. */
export function MatchSheetChart({ ours, enemy, draft, players, result, duration, opponent, title }: {
  ours: LineForm; enemy: LineForm; draft: Draft; players: Record<string, string>; result: string; duration: string; opponent: string; title: string;
}) {
  const totals = (["kills", "deaths", "assists", "gold", "damage", "turret_damage"] as const).map((k) => ({ k, us: sumLines(ours, k), them: sumLines(enemy, k) }));
  const labels: Record<string, string> = { kills: "Kills", deaths: "Deaths", assists: "Assists", gold: "Gold", damage: "Hero damage", turret_damage: "Turret damage" };
  const maxDmg = Math.max(1, ...SCORE_LANES.flatMap((l) => [num(ours[l]?.damage) ?? 0, num(enemy[l]?.damage) ?? 0]));
  const win = result === "WIN", loss = result === "LOSS";
  return (
    <section className="card chart-card p-4 sm:p-5 space-y-5 min-w-0" aria-label="Match sheet">
      <div className="flex flex-wrap items-center gap-3">
        <div className={`grid h-14 w-14 place-items-center rounded-2xl border-2 text-[15px] font-extrabold ${win ? "border-leaf/70 text-leaf bg-leaf/10" : loss ? "border-danger/70 text-danger bg-danger/10" : "border-edge text-faint"}`}>
          {win ? "Win" : loss ? "Loss" : "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-extrabold truncate">{title}</div>
          <div className="text-[11px] text-faint flex flex-wrap gap-x-3">
            <span>9 Clover vs {opponent || "Enemy"}</span>
            {duration && <span className="inline-flex items-center gap-1"><Clock size={11} aria-hidden="true" />{duration} min</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[26px] font-extrabold tabular-nums leading-none">
            <span className="text-crim"><CountUp value={totals[0].us ?? 0} /></span><span className="text-faint mx-1.5">:</span><span className="text-danger"><CountUp value={totals[0].them ?? 0} /></span>
          </div>
          <div className="text-[10px] text-faint mt-1">kills</div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_5.5rem_minmax(0,1fr)_3.5rem] text-[10px] font-extrabold">
          <span /><span className="text-right text-crim">9 Clover</span><span /><span className="text-danger">{opponent || "Enemy"}</span><span />
        </div>
        {totals.map((t, i) => <Mirror key={t.k} label={labels[t.k]} us={t.us} them={t.them} delay={i * 80} />)}
      </div>

      <div className="space-y-2">
        <div className="label">Lane by lane</div>
        {SCORE_LANES.map((lane, i) => {
          const o = ours[lane] ?? {}, e = enemy[lane] ?? {};
          const oh = draft.our_picks?.[lane] || o.hero, eh = draft.enemy_picks?.[lane] || e.hero;
          const od = num(o.damage) ?? 0, ed = num(e.damage) ?? 0;
          return (
            <div key={lane} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-edge/70 bg-ink/30 p-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="relative shrink-0">
                  {oh ? <HeroImg name={oh} size={38} className="rounded-lg" /> : <span className="grid h-[38px] w-[38px] place-items-center rounded-lg border border-edge text-faint">—</span>}
                  {o.mvp && <Crown size={13} className="absolute -top-1.5 -right-1.5 text-amber" aria-label="MVP" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-extrabold truncate">{players[lane] || oh || "—"}</div>
                  <div className="text-[10.5px] text-mute tabular-nums">{o.kills || 0}/{o.deaths || 0}/{o.assists || 0}{o.rating ? <> · <b className="text-text">{o.rating}</b></> : null}</div>
                  <span className="mt-1 block h-1.5 rounded-full bg-raised overflow-hidden"><span className="chart-bar-x block h-full rounded-full bg-crim" style={{ width: `${(od / maxDmg) * 100}%`, animationDelay: `${300 + i * 90}ms` }} /></span>
                </div>
              </div>
              <span className="text-[9.5px] font-extrabold text-faint w-12 text-center">{laneName(lane)}</span>
              <div className="flex items-center gap-2 min-w-0 flex-row-reverse text-right">
                <span className="relative shrink-0">
                  {eh ? <HeroImg name={eh} size={38} className="rounded-lg" /> : <span className="grid h-[38px] w-[38px] place-items-center rounded-lg border border-edge text-faint">—</span>}
                  {e.mvp && <Crown size={13} className="absolute -top-1.5 -left-1.5 text-amber" aria-label="MVP" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-extrabold truncate">{e.name || eh || "—"}</div>
                  <div className="text-[10.5px] text-mute tabular-nums">{e.rating ? <><b className="text-text">{e.rating}</b> · </> : null}{e.kills || 0}/{e.deaths || 0}/{e.assists || 0}</div>
                  <span className="mt-1 block h-1.5 rounded-full bg-raised overflow-hidden"><span className="chart-bar-x chart-bar-x-rev ml-auto block h-full rounded-full bg-danger" style={{ width: `${(ed / maxDmg) * 100}%`, animationDelay: `${300 + i * 90}ms` }} /></span>
                </div>
              </div>
            </div>
          );
        })}
        <p className="text-[10px] text-faint">Bars under each player show hero damage.</p>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- //
// the flow
// --------------------------------------------------------------------------- //
type Review = { match: UtilityMatch; game_no: number; image_url: string; sheet: ScoreboardRead };

export function MatchEvidence() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "scrim" | "tournament">("all");
  const [rows, setRows] = useState<UtilityMatch[] | null>(null);
  const [listError, setListError] = useState<unknown>(null);
  const [picked, setPicked] = useState<UtilityMatch | null>(null);
  const [gameNo, setGameNo] = useState<number | null>(null);
  const [extra, setExtra] = useState<{ url: string; label: string }[]>([]);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [done, setDone] = useState<{ title: string; game_no: number; link: (string | number)[]; learned: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ kind });
      if (q.trim()) params.set("q", q.trim());
      setRows(await api.get<UtilityMatch[]>(`/utility/matches?${params}`));
      setListError(null);
    } catch (e) { setListError(e); }
  }, [q, kind]);
  useEffect(() => { const id = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(id); }, [load]);

  function choose(m: UtilityMatch) {
    setPicked(m); setExtra([]); setError(null); setDone(null); setReview(null);
    const open = m.slots.find((no) => !m.games.find((g) => g.game_no === no)?.has_stats);
    setGameNo(open ?? m.slots[0] ?? null);
  }

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setReading("upload"); setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const saved = await api.upload<{ url: string; label: string }>("/files", form);
      setExtra((xs) => [{ url: saved.url, label: saved.label || file.name }, ...xs]);
      await read(saved.url);
    } catch (e) { setError(e); setReading(null); }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function read(url: string) {
    if (!picked || gameNo == null) return;
    setReading(url); setError(null);
    try {
      const r = await api.post<UtilityRead>("/utility/read", { kind: picked.kind, id: picked.id, game_no: gameNo, image_url: url });
      setReview({ match: r.target, game_no: r.game_no, image_url: url, sheet: r.sheet });
    } catch (e) { setError(e); } finally { setReading(null); }
  }

  if (review) {
    return <ReviewSheet review={review} onBack={() => setReview(null)} onDone={(m, learned) => {
      setReview(null); setDone({ title: m.title, game_no: review.game_no, link: m.link, learned }); setPicked(m); void load();
    }} />;
  }

  const evidence = picked ? [...extra, ...picked.evidence.filter((e) => !extra.some((x) => x.url === e.url))] : [];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section className="min-w-0 space-y-2.5" aria-label="Choose a match">
        <div className="flex items-center gap-2"><span className="step-dot">1</span><h3 className="text-[13px] font-extrabold">Choose the match</h3></div>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[10rem]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input !pl-8" placeholder="Opponent, event, scrim number…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search matches" />
          </div>
          <div className="flex gap-1" role="group" aria-label="Match type">
            {(["all", "scrim", "tournament"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                className={`px-2.5 py-1.5 rounded-md text-[10.5px] font-bold border ${kind === k ? "border-crim/60 bg-crim/10 text-crim" : "border-edge text-faint hover:text-mute"}`}>
                {k === "all" ? "All" : k === "scrim" ? "Scrims" : "Tournaments"}
              </button>
            ))}
          </div>
        </div>
        <ErrorNote error={listError} />
        {!rows ? <Spinner label="Loading matches" /> : !rows.length ? <Empty title="No matches" hint="Create a scrim or a tournament match first, then come back to fill it in." /> : (
          <ul className="space-y-2 max-h-[34rem] overflow-y-auto pr-1">
            {rows.map((m) => <li key={m.key}><MatchCard m={m} active={picked?.key === m.key} onPick={() => choose(m)} /></li>)}
          </ul>
        )}
      </section>

      <section className="min-w-0 space-y-4" aria-label="Game and evidence">
        {done && (
          <div className="card border-leaf/50 bg-leaf/5 p-3 flex flex-wrap items-center gap-2" role="status">
            <CheckCircle2 size={16} className="text-leaf" aria-hidden="true" />
            <span className="text-[12px] font-bold">Game {done.game_no} added to {done.title}.{done.learned > 0 && <span className="text-leaf"> Learned {done.learned} hero {done.learned === 1 ? "portrait" : "portraits"} for next time.</span>}</span>
            <button type="button" className="btn-ghost !py-1 !text-[11px] ml-auto" onClick={() => navigate(...done.link)}><ExternalLink size={12} /> Open the match</button>
          </div>
        )}
        {!picked ? (
          <div className="card border-dashed p-8 text-center text-faint">
            <ScanLine size={28} className="mx-auto mb-2 text-crim" aria-hidden="true" />
            <p className="text-[12.5px] font-bold text-mute">Pick a scrim or tournament match on the left</p>
            <p className="text-[11px] mt-1">Then choose the game and the scoreboard screenshot. You'll see the full sheet before anything is added.</p>
          </div>
        ) : (
          <>
            <div>
              <div className="flex items-center gap-2 mb-2"><span className="step-dot">2</span><h3 className="text-[13px] font-extrabold">Which game?</h3></div>
              <div className="flex flex-wrap gap-1.5">
                {picked.slots.map((no) => {
                  const g = picked.games.find((x) => x.game_no === no);
                  return (
                    <button key={no} type="button" aria-pressed={gameNo === no} onClick={() => setGameNo(no)}
                      className={`rounded-lg border px-3 py-2 text-left transition ${gameNo === no ? "border-crim/70 bg-crim/10" : "border-edge hover:border-edge-2"}`}>
                      <div className="text-[12px] font-extrabold">Game {no}</div>
                      <div className={`text-[10px] ${g?.has_stats ? "text-leaf" : g ? "text-amber" : "text-faint"}`}>{g?.has_stats ? "Has stats · replace" : g ? `${g.result ? (g.result === "WIN" ? "Win" : "Loss") : "Saved"} · no stats` : "New game"}</div>
                    </button>
                  );
                })}
              </div>
              {picked.kind === "tournament" && picked.max_games && picked.slots.length < picked.max_games && (
                <p className="text-[10.5px] text-faint mt-1.5">More games open up as the series score is updated on the match.</p>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2"><span className="step-dot">3</span><h3 className="text-[13px] font-extrabold">Pick the scoreboard</h3></div>
              <input ref={fileRef} id="evidence-upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => void upload(e.target.files)} />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <label htmlFor="evidence-upload" className={`card border-dashed grid place-items-center gap-1 p-3 min-h-28 cursor-pointer text-center hover:border-crim/50 ${reading ? "pointer-events-none opacity-60" : ""}`}>
                  {reading === "upload" ? <Loader2 size={18} className="animate-spin text-crim" /> : <Upload size={18} className="text-crim" aria-hidden="true" />}
                  <span className="text-[11px] font-bold">Upload a screenshot</span>
                </label>
                {evidence.map((e) => (
                  <button key={e.url} type="button" disabled={Boolean(reading) || gameNo == null} onClick={() => void read(e.url)}
                    className="group relative overflow-hidden rounded-xl border border-edge min-h-28 text-left hover:border-crim/60 disabled:opacity-60">
                    <img src={e.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-70 group-hover:opacity-90 transition" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink to-transparent p-2 text-[10.5px] font-bold truncate">{e.label}</span>
                    {reading === e.url && <span className="absolute inset-0 grid place-items-center bg-ink/60"><span className="evidence-scan" aria-hidden="true" /><Loader2 size={20} className="animate-spin text-crim" /></span>}
                    <span className="sr-only">Read {e.label} for game {gameNo}</span>
                  </button>
                ))}
              </div>
              {reading && reading !== "upload" && <p className="text-[11px] text-mute mt-2" role="status">Reading the scoreboard and matching it to game {gameNo}…</p>}
              {!evidence.length && <p className="text-[10.5px] text-faint mt-2">No screenshots on this match yet. Upload one.</p>}
              <ErrorNote error={error} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

type Side = "ours" | "enemy";
type RowHero = SheetRowHero & { lane: string; hero: string };

const CHECK_CHIP: Record<HeroCheck | "edited" | "confirmed", { label: string; cls: string; tip: string } | null> = {
  portrait: { label: "Matched", cls: "border-leaf/40 bg-leaf/10 text-leaf", tip: "The portrait matches this hero." },
  corrected: { label: "Fixed", cls: "border-amber/50 bg-amber/10 text-amber", tip: "The portrait clearly showed another hero, so it was changed." },
  likely: { label: "Likely", cls: "border-sky/40 bg-sky/10 text-sky", tip: "Probably right; the portrait is a close match." },
  unsure: { label: "Check · tap if right", cls: "border-danger/50 bg-danger/10 text-danger", tip: "Couldn't confirm this hero from the portrait." },
  edited: { label: "Changed", cls: "border-leaf/40 bg-leaf/10 text-leaf", tip: "You picked this hero; it will be learned for next time." },
  confirmed: { label: "Looks right", cls: "border-leaf/40 bg-leaf/10 text-leaf", tip: "You confirmed this hero; it will be learned for next time." },
  unchecked: null,
};

function useHeroList() {
  const [heroes, setHeroes] = useState<Hero[]>([]);
  useEffect(() => { api.get<Hero[]>("/heroes").then(setHeroes).catch(() => setHeroes([])); }, []);
  return heroes;
}

/** One row's hero: tap to pick another, with how sure the reading was. */
function HeroFix({ heroes, lane, side, name, row, confirmed, onPick, onConfirm }: {
  heroes: Hero[]; lane: string; side: Side; name: string; row?: RowHero; confirmed: boolean;
  onPick: (hero: string) => void; onConfirm: () => void;
}) {
  const id = heroes.find((h) => h.name.toLowerCase() === name.toLowerCase())?.id ?? "";
  const edited = !!row && name !== row.hero;
  const state: HeroCheck | "edited" | "confirmed" = edited ? "edited" : confirmed ? "confirmed" : row?.hero_check ?? "unchecked";
  const chip = CHECK_CHIP[state];
  const who = side === "ours" ? "" : "Enemy ";
  return (
    <div className={`space-y-1 rounded-xl ${state === "unsure" ? "ring-1 ring-danger/50 p-1" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <HeroPickerModal heroes={heroes} value={id} placeholder={name ? `Read as ${name} — pick the ${who.toLowerCase()}${laneName(lane)} hero` : `Pick the ${who.toLowerCase()}${laneName(lane)} hero`}
            onChange={(next) => onPick(heroes.find((h) => h.id === next)?.name ?? "")} />
        </div>
        {chip && (state === "unsure"
          ? <button type="button" className={`chip shrink-0 !text-[9.5px] ${chip.cls}`} title={chip.tip} onClick={onConfirm}
              aria-label={`${who}${laneName(lane)} hero ${name || "blank"} looks right`}>{chip.label}</button>
          : <span className={`chip shrink-0 !text-[9.5px] ${chip.cls}`} title={chip.tip}>{chip.label}</span>)}
      </div>
      {state === "corrected" && row?.hero_was && <p className="text-[10px] text-faint pl-1">Read as {row.hero_was}; the portrait shows {name}.</p>}
    </div>
  );
}

function ReviewSheet({ review, onBack, onDone }: { review: Review; onBack: () => void; onDone: (m: UtilityMatch, learned: number) => void }) {
  const { match, game_no, sheet } = review;
  const heroList = useHeroList();
  const [ours, setOurs] = useState<LineForm>(() => linesToForm(sheet.player_stats));
  const [enemy, setEnemy] = useState<LineForm>(() => linesToForm(sheet.enemy_stats));
  const [result, setResult] = useState<string>(sheet.result || "");
  const [duration, setDuration] = useState<string>(sheet.duration_min != null ? String(sheet.duration_min) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const rowsBy = useMemo(() => ({
    ours: Object.fromEntries(sheet.rows.ours.map((r) => [r.lane, r])) as Record<string, RowHero>,
    enemy: Object.fromEntries(sheet.rows.enemy.map((r) => [r.lane, r])) as Record<string, RowHero>,
  }), [sheet]);
  const [picks, setPicks] = useState<Record<Side, Record<string, string>>>(() => ({
    ours: Object.fromEntries(SCORE_LANES.map((l) => [l, sheet.draft?.our_picks?.[l] || rowsBy.ours[l]?.hero || ""])),
    enemy: Object.fromEntries(SCORE_LANES.map((l) => [l, sheet.draft?.enemy_picks?.[l] || rowsBy.enemy[l]?.hero || ""])),
  }));
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set());
  const filled = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([, h]) => h));
  const draft: Draft = useMemo(() => ({ ...(sheet.draft ?? {}), our_picks: filled(picks.ours), enemy_picks: filled(picks.enemy) }), [sheet, picks]);
  const players = useMemo(() => Object.fromEntries(sheet.rows.ours.map((r) => [r.lane, r.player || r.name || ""])), [sheet]);
  const existing = match.games.find((g) => g.game_no === game_no);
  const enemyHeroes = draft.enemy_picks ?? {};
  const needLook = (["ours", "enemy"] as Side[]).flatMap((side) => SCORE_LANES.filter((l) => {
    const r = rowsBy[side][l];
    return r?.hero_check === "unsure" && picks[side][l] === r.hero && !confirmed.has(`${side}:${l}`);
  }).map((l) => `${side}:${l}`));
  const enemyNeedsLook = needLook.some((k) => k.startsWith("enemy:"));

  const heroControl = (side: Side) => (lane: string) => (
    <HeroFix heroes={heroList} lane={lane} side={side} name={picks[side][lane] ?? ""} row={rowsBy[side][lane]}
      confirmed={confirmed.has(`${side}:${lane}`)}
      onPick={(hero) => setPicks((p) => ({ ...p, [side]: { ...p[side], [lane]: hero } }))}
      onConfirm={() => setConfirmed((c) => new Set(c).add(`${side}:${lane}`))} />
  );

  /** Heroes a person changed or OK'd, at their portrait spot — the matcher learns them. */
  function portraits() {
    return (["ours", "enemy"] as Side[]).flatMap((side) => SCORE_LANES.flatMap((lane) => {
      const r = rowsBy[side][lane];
      const hero = picks[side][lane];
      if (!r?.portrait || r.portrait.length !== 4 || !hero) return [];
      return hero !== r.hero || confirmed.has(`${side}:${lane}`) ? [{ hero, box: r.portrait }] : [];
    })).slice(0, 10);
  }

  async function confirm() {
    if (!result) { setError(new Error("Set the result (win or loss) first.")); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ ok: boolean; target: UtilityMatch; learned?: number }>("/utility/apply", {
        kind: match.kind, id: match.id, game_no, result, duration_min: duration ? Number(duration) : null,
        lineup: sheet.lineup, draft, player_stats: formToLines(ours, draft.our_picks ?? {}), enemy_stats: formToLines(enemy, enemyHeroes, true),
        evidence_url: review.image_url, portraits: portraits(),
      });
      onDone(r.target, r.learned ?? 0);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost !py-1.5" onClick={onBack}><ArrowLeft size={14} /> Back</button>
        <span className="text-[11px] text-faint inline-flex items-center gap-1">{match.title} <ChevronRight size={11} aria-hidden="true" /> Game {game_no}</span>
        {existing?.has_stats && <span className="chip border-amber/50 text-amber !text-[10px]">Replaces the stats saved on game {game_no}</span>}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-3 min-w-0">
          <MatchSheetChart ours={ours} enemy={enemy} draft={draft} players={players} result={result} duration={duration}
            opponent={match.opponent} title={`${match.title} · Game ${game_no}`} />
          {sheet.checks.length > 0 && (
            <ul className="card p-3 space-y-1">
              {sheet.checks.map((c, i) => (
                <li key={i} className={`text-[11px] ${c.tone === "ok" ? "text-leaf" : c.tone === "warn" ? "text-amber" : "text-mute"}`}>• {c.text}</li>
              ))}
            </ul>
          )}
          <a href={review.image_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-edge">
            <img src={review.image_url} alt={`Scoreboard screenshot for game ${game_no}`} className="w-full max-h-72 object-contain bg-ink" />
          </a>
        </div>
        <div className="space-y-3 min-w-0">
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <span className="label block mb-1">Result</span>
                <div className="flex gap-1" role="group" aria-label="Result">
                  {(["WIN", "LOSS"] as const).map((r) => (
                    <button key={r} type="button" aria-pressed={result === r} onClick={() => setResult(r)}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-extrabold border ${result === r ? (r === "WIN" ? "border-leaf/60 bg-leaf/10 text-leaf" : "border-danger/60 bg-danger/10 text-danger") : "border-edge text-faint"}`}>
                      {r === "WIN" ? "Win" : "Loss"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block w-28">
                <span className="label block mb-1">Length (min)</span>
                <input className="input tabular-nums" inputMode="decimal" value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^0-9.]/g, "").slice(0, 5))} />
              </label>
            </div>
            <div>
              <div className="section-pill mb-2">9 Clover scoreboard</div>
              {needLook.length > 0 && (
                <p role="status" className="mb-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-[11px] text-danger">
                  {needLook.length} {needLook.length === 1 ? "hero needs" : "heroes need"} a look. Tap a hero to change it, or tap “Check” if it&apos;s right.
                </p>
              )}
              <ScoreboardFields form={ours} onChange={setOurs} heroes={draft.our_picks ?? {}} side="ours" gameLabel={`game ${game_no}`}
                heroControl={heroControl("ours")}
                player={(lane) => <span className="input !px-2 flex items-center text-mute truncate">{players[lane] || "—"}</span>} />
            </div>
          </div>
          <EnemyScoreboard form={enemy} onChange={setEnemy} heroes={enemyHeroes} opponent={match.opponent} gameLabel={`game ${game_no}`}
            heroControl={heroControl("enemy")} startOpen={enemyNeedsLook} />
          <ErrorNote error={error} />
          <div className="flex flex-wrap justify-end gap-2 sticky bottom-2 z-10 rounded-xl border border-edge bg-panel/95 p-2 shadow-xl backdrop-blur">
            <button type="button" className="btn-ghost" onClick={onBack}>Cancel</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void confirm()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Confirm & add to game {game_no}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
