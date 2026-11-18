/**
 * Utility — its own tab. Players: add games any time (files or by hand), see the heroes
 * with no data and fill them in, what to work on, and animated progress charts. Staff
 * (same tab): fill scrim/tournament games from a scoreboard screenshot after reviewing
 * the sheet, and generate strategy notes for the playbook.
 */
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Crown, Flame, Plus, Upload } from "lucide-react";
import { api } from "../lib/api";
import type { Meta, SoloGame, User } from "../lib/types";
import { fmtDate, navigate, pct } from "../lib/util";
import { CHART_COLORS, CountUp, Ring, Sparkline } from "../components/Charts";
import { MatchEvidence } from "../components/MatchEvidence";
import {
  FormDots, GamesTable, HeroGaps, HeroTable, PlanPanel, ProgressCharts, RecordUploader, SoloGameEditor, WorkOn, rollingForm, useHeroes, useSoloGames,
} from "../components/SoloGames";
import { StrategyMaker } from "../components/StrategyMaker";
import { kdaText } from "../components/PlayerPerformance";
import { ErrorNote, Modal, PageTitle, SectionTitle, Spinner, Tabs, type HeroSlide } from "../components/ui";

type View = "overview" | "add" | "progress" | "matches" | "strategy";
const FILLERS = new Set(["admin", "captain"]);
const WRITERS = new Set(["admin", "captain", "coach"]);
const VIEWERS = new Set(["admin", "captain", "coach", "analyst"]);

export function UtilityPage({ me, meta, parts = [] }: { me: User; meta: Meta; parts?: string[] }) {
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
    { eyebrow: "Your record", title: s?.overall.games ? `${s.overall.games} games on your record` : "Start your record", sub: "Drop a screenshot, a document or a sheet. Your games go straight on." },
    { eyebrow: "What to work on", title: s?.alerts.length ? `${s.alerts.length} things to look at` : "Heroes to fill in", sub: "The heroes you haven't logged, the ones you've stopped playing, and where you're slipping." },
  ];
  if (canFill || canWrite) slides.push({ eyebrow: "Staff", title: "Match data and strategy", sub: "Fill scrim and tournament games from a scoreboard, then generate a playbook note.", steps: ["Choose the match", "Check the sheet", "Confirm"] });

  return (
    <div className="space-y-5">
      <PageTitle title="Utility" sub="Your games, your progress, and what to work on next." slides={slides}
        right={<button type="button" className="btn-primary" onClick={() => go("add")}><Upload size={14} /> Add games</button>} />

      <section className="card utility-band chart-card p-4 sm:p-5" aria-label="Your numbers">
        {own.loading && !data ? <Spinner label="Loading your record" /> : (
          <div className="flex flex-wrap items-center gap-5">
            <Ring value={s?.overall.win_rate ?? null} size={132} label="Win rate" sub="win rate" color={s?.overall.win_rate != null && s.overall.win_rate < 45 ? CHART_COLORS.loss : CHART_COLORS.win} />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[17px] font-extrabold truncate">{data?.user?.name ?? me.ign ?? me.name}</h2>
                {lane && <span className="chip border-crim/50 text-crim">{lane === "EXP" ? "EXP" : lane[0] + lane.slice(1).toLowerCase()}</span>}
                {s && s.streak.count >= 2 && (
                  <span className={`chip ${s.streak.result === "WIN" ? "border-leaf/50 text-leaf" : "border-danger/50 text-danger"}`}><Flame size={11} aria-hidden="true" /> {s.streak.count} {s.streak.result === "WIN" ? "wins" : "losses"} in a row</span>
                )}
                {s?.last_played && <span className="text-[10.5px] text-faint">Last game {fmtDate(s.last_played)}</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Metric label="Games" value={<CountUp value={s?.overall.games ?? 0} />} hint={s ? `${s.overall.wins}W · ${s.overall.losses}L` : undefined} />
                <Metric label="KDA" value={s?.overall.kda?.ratio != null ? <CountUp value={s.overall.kda.ratio} digits={2} /> : "—"} hint={s?.overall.kda ? `${s.overall.kda.kills}/${s.overall.kda.deaths}/${s.overall.kda.assists} a game` : "Add K/D/A"} />
                <Metric label="Rating" value={s?.overall.rating?.avg != null ? <CountUp value={s.overall.rating.avg} digits={1} /> : "—"} hint={s?.overall.rating ? `${s.overall.rating.games} rated` : "Add ratings"} />
                <Metric label="MVPs" value={<span className="inline-flex items-center gap-1"><Crown size={15} className="text-amber" aria-hidden="true" /><CountUp value={s?.overall.mvps ?? 0} /></span>} hint={s?.overall.gold_per_min ? `${s.overall.gold_per_min} gold/min` : undefined} />
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {s && s.form.length > 0 && <span className="inline-flex items-center gap-2 text-[10.5px] text-faint">Last 10 <FormDots form={s.form} label="Last 10 games" /></span>}
                {roll.length >= 3 && <span className="inline-flex items-center gap-2 text-[10.5px] text-faint">KDA trend <Sparkline values={roll.map((r) => r.kda)} label="KDA over your recent games" /></span>}
              </div>
            </div>
          </div>
        )}
        <ErrorNote error={own.error} />
      </section>

      <Tabs tabs={tabs} value={view} onChange={go} label="Utility sections" />

      {view === "overview" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="space-y-5 min-w-0">
            <section>
              <SectionTitle>What to work on</SectionTitle>
              {s ? <WorkOn alerts={s.alerts} /> : null}
            </section>
            <section>
              <SectionTitle>Heroes to fill in</SectionTitle>
              <HeroGaps gaps={data?.gaps} lane={lane} onAdd={addFor} />
            </section>
          </div>
          <div className="space-y-4 min-w-0">
            <RecordUploader onChanged={() => void own.reload()} onAddByHand={() => addFor()} />
            {data && data.games.length > 0 && (
              <section className="card p-3">
                <div className="flex items-center justify-between mb-2"><span className="label">Latest games</span><button type="button" className="text-[10.5px] text-crim" onClick={() => go("add")}>See all</button></div>
                <ul className="space-y-1.5">
                  {data.games.slice(0, 6).map((g) => (
                    <li key={g.id} className="flex items-center gap-2 text-[11.5px]">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${g.result === "WIN" ? "bg-leaf" : g.result === "LOSS" ? "bg-danger" : "bg-edge-2"}`} aria-label={g.result || "No result"} />
                      <b className="truncate">{g.hero || "—"}</b>
                      <span className="text-mute tabular-nums">{g.kills ?? "–"}/{g.deaths ?? "–"}/{g.assists ?? "–"}</span>
                      <span className="ml-auto text-faint">{g.played_on ? fmtDate(g.played_on) : ""}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}

      {view === "add" && (
        <div className="space-y-5">
          <RecordUploader onChanged={() => void own.reload()} onAddByHand={() => addFor()} />
          <GamesTable data={data} loading={own.loading} error={null} onEdit={(g) => setEditing({ game: g })} onAdd={() => addFor()} onChanged={() => void own.reload()} />
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

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-edge/70 bg-ink/35 px-3 py-2">
      <div className="text-[10px] text-faint">{label}</div>
      <div className="text-[20px] font-extrabold tabular-nums leading-tight">{value}</div>
      {hint && <div className="text-[10px] text-faint truncate">{hint}</div>}
    </div>
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-faint">Player</span>
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
        <div className="card border-dashed p-8 text-center">
          <ClipboardCheck size={26} className="mx-auto mb-2 text-crim" aria-hidden="true" />
          <p className="text-[13px] font-bold text-mute">{mine ? "No games yet" : `${data?.user?.name ?? "This player"} hasn't added any games yet`}</p>
          {mine && <p className="text-[11.5px] text-faint mt-1">Add a few games and your charts fill in by themselves.</p>}
          {mine && <button type="button" className="btn-primary mt-3" onClick={() => navigate("utility", "add")}><Plus size={14} /> Add my games</button>}
        </div>
      ) : (
        <>
          <ProgressCharts data={data} />
          {!mine && (
            <>
              <section><SectionTitle>What to work on</SectionTitle><WorkOn alerts={s.alerts} /></section>
              <section><SectionTitle>Hero gaps</SectionTitle><HeroGaps gaps={data.gaps} lane={data.user?.lane} /></section>
            </>
          )}
          <section className="min-w-0"><SectionTitle>{mine ? "My heroes" : "Heroes"}</SectionTitle><HeroTable stats={s} /></section>
          {mine && <PlanPanel games={s.overall.games} />}
          {!mine && <GamesTable data={data} loading={false} error={null} onEdit={() => undefined} onAdd={() => undefined} onChanged={() => void other.reload()} readOnly />}
        </>
      )}
    </div>
  );
}
