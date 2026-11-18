/**
 * Utility — its own tab. Players: add games any time (files or by hand), see the heroes
 * with no data and fill them in, what to work on, and animated progress charts. Staff
 * (same tab): fill scrim/tournament games from a scoreboard screenshot after reviewing
 * the sheet, and generate strategy notes for the playbook.
 */
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Crown, Flame, Gamepad2, History, LayoutGrid, Plus, Star, Swords, Target, Upload, Users } from "lucide-react";
import { api } from "../lib/api";
import type { Meta, SoloGame, User } from "../lib/types";
import { fmtDate, navigate, pct } from "../lib/util";
import { HeroImg } from "../components/HeroImg";
import { CHART_COLORS, CountUp, Ring, Sparkline } from "../components/Charts";
import { MatchEvidence } from "../components/MatchEvidence";
import {
  FormDots, GamesTable, HeroGaps, HeroTable, PlanPanel, ProgressCharts, RecordUploader, SoloGameEditor, WorkOn, rollingForm, useHeroes, useSoloGames,
} from "../components/SoloGames";
import { StrategyMaker } from "../components/StrategyMaker";
import { kdaText } from "../components/PlayerPerformance";
import { ErrorNote, Modal, PageTitle, SectionTitle, Spinner, Tabs, type HeroSlide, Ign } from "../components/ui";

type View = "overview" | "add" | "progress" | "matches" | "strategy";
const FILLERS = new Set(["admin", "captain"]);
const WRITERS = new Set(["admin", "captain", "coach"]);
const VIEWERS = new Set(["admin", "captain", "coach", "analyst"]);

/** True on phone-width screens (kept in sync on rotate/resize). */
function useNarrow(px = 640) {
  const query = `(max-width: ${px - 1}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

export function UtilityPage({ me, meta, parts = [] }: { me: User; meta: Meta; parts?: string[] }) {
  const narrow = useNarrow();
  const canFill = FILLERS.has(me.role);
  const canWrite = WRITERS.has(me.role);
  const tabs = useMemo(() => [
    { id: "overview", label: "Overview" },
    { id: "add", label: "Add games" },
    { id: "progress", label: "Progress" },
    ...(canFill ? [{ id: "matches", label: "Match data" }] : []),
    ...(canWrite ? [{ id: "strategy", label: "Strategy" }] : []),
  ], [canFill, canWrite]);
  const wanted = (parts[0] ?? "overview") as View;
  const view: View = tabs.some((t) => t.id === wanted) ? wanted : "overview";
  const go = (v: string) => (v === "overview" ? navigate("utility") : navigate("utility", v));

  const own = useSoloGames();
  const heroes = useHeroes();
  const [editing, setEditing] = useState<{ game: SoloGame | null; hero?: string; lane?: string } | null>(null);
  const data = own.data;
  const s = data?.stats;
  const lane = data?.user?.lane || me.main_role || "";
  const roll = useMemo(() => rollingForm(data?.games ?? [], 20), [data]);
  const addFor = (hero?: string, laneFor?: string) => setEditing({ game: null, hero, lane: laneFor });

  const slides: HeroSlide[] = [
    { eyebrow: "Your record", title: s?.overall.games ? `${s.overall.games} games on your record` : "Start your record", sub: "Drop a screenshot, a document or a sheet. Check the heroes, and they're on." },
    { eyebrow: "What to work on", title: s?.alerts.length ? `${s.alerts.length} things to look at` : "Heroes to fill in", sub: "The heroes you haven't logged, the ones you've stopped playing, and where you're slipping." },
  ];
  if (canFill || canWrite) slides.push({ eyebrow: "Staff", title: "Match data and strategy", sub: "Fill scrim and tournament games from a scoreboard, then generate a playbook note.", steps: ["Choose the match", "Check the sheet", "Confirm"] });

  const name = data?.user?.name ?? me.ign ?? me.name;
  const latest = data?.games.slice(0, 6) ?? [];

  return (
    <div className="utility-page space-y-5">
      <PageTitle title="Utility" sub="Your games, your progress, and what to work on next." slides={slides} />

      <section className="card u-hero p-4 sm:p-6" aria-label="Your numbers">
        {own.loading && !data ? <Spinner label="Loading your record" /> : (
          <>
            <div className="flex flex-wrap items-center gap-4 sm:gap-5">
              <div className="u-ring shrink-0">
                <Ring value={s?.overall.win_rate ?? null} size={narrow ? 92 : 128} label="Win rate" sub="win rate" color={s?.overall.win_rate != null && s.overall.win_rate < 45 ? CHART_COLORS.loss : CHART_COLORS.sky} />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-[11px] font-bold text-faint">Your record</p>
                <h2 className="text-[22px] sm:text-[26px] font-extrabold leading-tight truncate"><Ign text={name} /></h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  {lane && <span className="u-pill u-pill--blue">{lane === "EXP" ? "EXP" : lane[0] + lane.slice(1).toLowerCase()} lane</span>}
                  {s && s.streak.count >= 2 && (
                    <span className={`u-pill ${s.streak.result === "WIN" ? "u-pill--green" : "u-pill--red"}`}><Flame size={11} aria-hidden="true" /> {s.streak.count} {s.streak.result === "WIN" ? "wins" : "losses"} in a row</span>
                  )}
                  {s?.last_played && <span className="u-pill">Last game {fmtDate(s.last_played)}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
                  {s && s.form.length > 0 && <span className="inline-flex items-center gap-2 text-[10.5px] text-faint">Last 10 <FormDots form={s.form} label="Last 10 games" /></span>}
                  {roll.length >= 3 && <span className="inline-flex items-center gap-2 text-[10.5px] text-faint">KDA trend <Sparkline values={roll.map((r) => r.kda)} label="KDA over your recent games" color={CHART_COLORS.sky} /></span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                <button type="button" className="btn-primary flex-1 sm:flex-none" onClick={() => go("add")}><Upload size={14} /> Add games</button>
                <button type="button" className="btn-ghost flex-1 sm:flex-none" onClick={() => addFor()}><Plus size={14} /> By hand</button>
              </div>
            </div>
            <div className="mt-4 sm:mt-5 grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
              <Metric tint="blue" icon={<Gamepad2 size={17} />} label="Games" value={<CountUp value={s?.overall.games ?? 0} />} hint={s ? `${s.overall.wins}W · ${s.overall.losses}L` : undefined} />
              <Metric tint="red" icon={<Swords size={17} />} label="KDA" value={s?.overall.kda?.ratio != null ? <CountUp value={s.overall.kda.ratio} digits={2} /> : "—"} hint={s?.overall.kda ? `${s.overall.kda.kills}/${s.overall.kda.deaths}/${s.overall.kda.assists} a game` : "Add K/D/A"} />
              <Metric tint="yellow" icon={<Star size={17} />} label="Rating" value={s?.overall.rating?.avg != null ? <CountUp value={s.overall.rating.avg} digits={1} /> : "—"} hint={s?.overall.rating ? `${s.overall.rating.games} rated` : "Add ratings"} />
              <Metric tint="green" icon={<Crown size={17} />} label="MVPs" value={<CountUp value={s?.overall.mvps ?? 0} />} hint={s?.overall.gold_per_min ? `${s.overall.gold_per_min} gold/min` : "Best-player badges"} />
            </div>
          </>
        )}
        <ErrorNote error={own.error} />
      </section>

      <Tabs tabs={tabs} value={view} onChange={go} label="Utility sections" />

      {view === "overview" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="space-y-5 min-w-0">
            <Panel tint="red" icon={<Target size={16} />} title={<SectionTitle>What to work on</SectionTitle>} sub="Where you're slipping and where you're strong, from your own games.">
              {s ? <WorkOn alerts={s.alerts} /> : null}
            </Panel>
            <Panel tint="blue" icon={<LayoutGrid size={16} />} title={<SectionTitle>Heroes to fill in</SectionTitle>} sub="Tap + on a hero to log a game with it.">
              <HeroGaps gaps={data?.gaps} lane={lane} onAdd={addFor} />
            </Panel>
          </div>
          <div className="space-y-5 min-w-0">
            <RecordUploader onChanged={() => void own.reload()} onAddByHand={() => addFor()} />
            <Panel tint="green" icon={<History size={16} />} title={<h3 className="text-[14px] font-extrabold">Latest games</h3>}
              right={latest.length > 0 ? <button type="button" className="u-link" onClick={() => go("add")}>See all</button> : undefined}>
              {latest.length ? (
                <ul className="divide-y divide-edge">
                  {latest.map((g) => (
                    <li key={g.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <HeroImg name={g.hero} size={36} className="rounded-xl shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-extrabold truncate">{g.hero || "—"}</div>
                        <div className="text-[10.5px] text-faint truncate">{[g.mode, g.played_on ? fmtDate(g.played_on) : ""].filter(Boolean).join(" · ") || "No date"}</div>
                      </div>
                      <span className="text-[11.5px] tabular-nums text-mute">{g.kills ?? "–"}/{g.deaths ?? "–"}/{g.assists ?? "–"}</span>
                      <span className={`u-pill ${g.result === "WIN" ? "u-pill--green" : g.result === "LOSS" ? "u-pill--red" : ""}`}>{g.result === "WIN" ? "Win" : g.result === "LOSS" ? "Loss" : "—"}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[12px] text-faint">Your games show up here as soon as you add them.</p>}
            </Panel>
          </div>
        </div>
      )}

      {view === "add" && (
        <div className="space-y-5">
          <RecordUploader onChanged={() => void own.reload()} onAddByHand={() => addFor()} />
          <div className="card p-4 sm:p-5">
            <GamesTable data={data} loading={own.loading} error={null} onEdit={(g) => setEditing({ game: g })} onAdd={() => addFor()} onChanged={() => void own.reload()} />
          </div>
        </div>
      )}

      {view === "progress" && <Progress me={me} ownData={own} />}
      {view === "matches" && canFill && <MatchEvidence />}
      {view === "strategy" && canWrite && <StrategyMaker meta={meta} />}

      {editing && (
        <Modal title={editing.game ? "Edit game" : editing.hero ? `Add a ${editing.hero} game` : "Add a game"} onClose={() => setEditing(null)} wide>
          <SoloGameEditor game={editing.game} hero={editing.hero} heroes={heroes} lane={editing.lane || lane}
            onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void own.reload(); }} />
        </Modal>
      )}
    </div>
  );
}

type Tint = "blue" | "red" | "yellow" | "green";

function Metric({ label, value, hint, icon, tint }: { label: string; value: React.ReactNode; hint?: string; icon: React.ReactNode; tint: Tint }) {
  return (
    <div className={`u-stat u-stat--${tint}`}>
      <span className={`u-icon u-icon--${tint}`} aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10.5px] font-bold text-faint">{label}</div>
        <div className="text-[20px] sm:text-[24px] font-extrabold tabular-nums leading-tight">{value}</div>
        {hint && <div className="text-[10px] text-faint leading-snug">{hint}</div>}
      </div>
    </div>
  );
}

/** A white panel with a tinted icon, a heading and optional actions. */
function Panel({ icon, tint, title, sub, right, children }: { icon: React.ReactNode; tint: Tint; title: React.ReactNode; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card u-panel p-4 sm:p-5 min-w-0">
      <div className="u-panel-head flex items-start gap-3 mb-3.5">
        <span className={`u-icon u-icon--${tint}`} aria-hidden="true">{icon}</span>
        <div className="min-w-0 flex-1">
          {title}
          {sub && <p className="text-[11px] text-faint -mt-1">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Progress({ me, ownData }: { me: User; ownData: ReturnType<typeof useSoloGames> }) {
  const staff = VIEWERS.has(me.role);
  const [players, setPlayers] = useState<{ id: number; name: string }[]>([]);
  const [viewing, setViewing] = useState<number | undefined>(undefined);
  const other = useSoloGames(viewing, !viewing || viewing === me.id);
  useEffect(() => {
    if (!staff) return;
    api.get<{ id: number; name: string; ign?: string }[]>("/players")
      .then((rows) => setPlayers(rows.map((p) => ({ id: p.id, name: p.ign || p.name }))))
      .catch(() => setPlayers([]));
  }, [staff]);
  const mine = !viewing || viewing === me.id;
  const src = mine ? ownData : other;
  const data = src.data;
  const s = data?.stats;

  return (
    <div className="space-y-5">
      {staff && players.length > 0 && (
        <div className="card u-panel flex flex-wrap items-center gap-2.5 p-3">
          <span className="u-icon u-icon--blue" aria-hidden="true"><Users size={16} /></span>
          <span className="text-[11.5px] font-bold text-mute">Player</span>
          <select className="input !py-1.5 !w-48" aria-label="Whose progress" value={viewing ?? me.id}
            onChange={(e) => { const id = Number(e.target.value); setViewing(id === me.id ? undefined : id); }}>
            <option value={me.id}>Me</option>
            {players.filter((p) => p.id !== me.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {!mine && s && <span className="text-[11px] text-mute">{s.overall.games} games · {pct(s.overall.win_rate)} · KDA {kdaText(s.overall.kda?.ratio)}</span>}
        </div>
      )}
      <ErrorNote error={src.error} />
      {src.loading && !data ? <Spinner label="Loading progress" /> : !data || !s || s.overall.games === 0 ? (
        <div className="card u-empty p-8 sm:p-10 text-center">
          <span className="u-icon u-icon--blue u-icon--lg mx-auto mb-3" aria-hidden="true"><ClipboardCheck size={24} /></span>
          <p className="text-[13px] font-bold text-mute">{mine ? "No games yet" : `${data?.user?.name ?? "This player"} hasn't added any games yet`}</p>
          {mine && <p className="text-[11.5px] text-faint mt-1">Add a few games and your charts fill in by themselves.</p>}
          {mine && <button type="button" className="btn-primary mt-3" onClick={() => navigate("utility", "add")}><Plus size={14} /> Add my games</button>}
        </div>
      ) : (
        <>
          <ProgressCharts data={data} />
          {!mine && (
            <>
              <Panel tint="red" icon={<Target size={16} />} title={<SectionTitle>What to work on</SectionTitle>}><WorkOn alerts={s.alerts} /></Panel>
              <Panel tint="blue" icon={<LayoutGrid size={16} />} title={<SectionTitle>Hero gaps</SectionTitle>}><HeroGaps gaps={data.gaps} lane={data.user?.lane} /></Panel>
            </>
          )}
          <Panel tint="yellow" icon={<Star size={16} />} title={<SectionTitle>{mine ? "My heroes" : "Heroes"}</SectionTitle>} sub="Win rate, KDA and form on every hero you've logged."><HeroTable stats={s} /></Panel>
          {mine && <div className="card u-panel p-4 sm:p-5"><PlanPanel games={s.overall.games} /></div>}
          {!mine && <div className="card u-panel p-4 sm:p-5"><GamesTable data={data} loading={false} error={null} onEdit={() => undefined} onAdd={() => undefined} onChanged={() => void other.reload()} readOnly /></div>}
        </>
      )}
    </div>
  );
}
