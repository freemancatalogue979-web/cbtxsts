/**
 * Scrim dashboard + scrim detail visuals: form over time, objectives us vs them, game length,
 * early-game and lord edges, heroes, lanes and opponents — all from /scrims/insights — plus the
 * per-scrim lineup card and series charts built from the scrim's own games.
 */
import { Crown, Flame, Shield, Swords, Timer, TrendingUp, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { Scrim, User } from "../lib/types";
import { nice } from "../lib/caseText";
import { navigate } from "../lib/util";
import { BarChart, CHART_COLORS, CountUp, HBars, Legend, LineChart, Ring } from "./Charts";
import { HeroImg } from "./HeroImg";
import { AvatarImg } from "./Avatar";
import { Empty, Ign } from "./ui";

export interface HeroRow { hero: string; games: number; wins: number; win_rate: number | null }
export interface EdgeSide { games: number; wins: number; win_rate: number | null }
export interface ScrimInsightsT {
  timeline: { id: number; number: number; opponent: string; date: string | null; result: string | null;
    score_us: number; score_them: number; games: number; game_wins: number; game_losses: number;
    kills: number | null; deaths: number | null; win_rate_to_date: number | null; win_rate_last5: number | null }[];
  form: (string | null)[];
  streak: { result: string | null; count: number };
  monthly: { month: string; played: number; wins: number; win_rate: number | null }[];
  objectives: Partial<Record<"kills" | "turrets" | "turtles" | "lords" | "gold", { us: number; them: number; games: number }>>;
  duration: { bucket: string; games: number; wins: number; win_rate: number | null }[];
  early: { ahead_at_10: EdgeSide; behind_at_10: EdgeSide };
  lord_edge: { more_lords: EdgeSide; fewer_lords: EdgeSide };
  heroes: { picked: HeroRow[]; faced: HeroRow[]; banned_by_us: HeroRow[]; banned_by_them: HeroRow[] };
  lanes: { lane: string; games: number; kda: number | null; kills: number | null; deaths: number | null; assists: number | null; rating: number | null }[];
  opponents: { opponent: string; played: number; won: number; lost: number; game_wins: number; game_losses: number }[];
}

const pctTxt = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" });

export function ChartCard({ title, icon, sub, children, className = "" }: { title: string; icon?: ReactNode; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card scrim-chart p-4 min-w-0 ${className}`} aria-label={title}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-bold">{icon}<span className="truncate">{title}</span></div>
          {sub && <div className="text-[10.5px] text-faint mt-0.5">{sub}</div>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** W/L squares, newest last. */
export function FormStrip({ form, size = 22 }: { form: (string | null)[]; size?: number }) {
  if (!form.length) return <span className="text-[11px] text-faint">No results yet</span>;
  return (
    <ol className="flex gap-1" aria-label={`Last ${form.length} results: ${form.map((r) => (r === "WIN" ? "W" : r === "LOSS" ? "L" : "D")).join(" ")}`}>
      {form.map((r, i) => (
        <li key={i} className={`scrim-form scrim-form--${r === "WIN" ? "w" : r === "LOSS" ? "l" : "d"}`} style={{ width: size, height: size, animationDelay: `${i * 45}ms` }}>
          {r === "WIN" ? "W" : r === "LOSS" ? "L" : "D"}
        </li>
      ))}
    </ol>
  );
}

/** One stat, us on the left, them on the right, bars growing out from the middle. */
export function VersusBars({ rows, us = "9 Clover", them = "Them" }: { rows: { label: string; us: number | null | undefined; them: number | null | undefined; fmt?: (v: number) => string; lowerIsBetter?: boolean }[]; us?: string; them?: string }) {
  const shown = rows.filter((r) => r.us != null || r.them != null);
  if (!shown.length) return <div className="text-[11.5px] text-faint">Nothing recorded yet.</div>;
  return (
    <div className="versus">
      <div className="versus__head"><span className="text-leaf">{us}</span><span className="text-danger truncate">{them}</span></div>
      <ul className="grid gap-2.5">
        {shown.map((r) => {
          const a = r.us ?? 0, b = r.them ?? 0, top = Math.max(a, b, 0.0001);
          const f = r.fmt ?? ((v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)));
          const usAhead = r.lowerIsBetter ? a < b : a > b;
          return (
            <li key={r.label} className="versus__row">
              <span className={`versus__num ${usAhead ? "text-leaf" : "text-mute"}`}>{r.us == null ? "—" : f(a)}</span>
              <span className="versus__track versus__track--us"><i style={{ width: `${(100 * a) / top}%` }} /></span>
              <span className="versus__label">{r.label}</span>
              <span className="versus__track versus__track--them"><i style={{ width: `${(100 * b) / top}%` }} /></span>
              <span className={`versus__num ${!usAhead && a !== b ? "text-danger" : "text-mute"}`}>{r.them == null ? "—" : f(b)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EdgeCard({ title, a, b, aLabel, bLabel }: { title: string; a: EdgeSide; b: EdgeSide; aLabel: string; bLabel: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 items-center">
      <Ring value={a.win_rate} size={104} color={CHART_COLORS.win} label={aLabel} sub={`${a.wins}/${a.games} won`} />
      <Ring value={b.win_rate} size={104} color={CHART_COLORS.loss} label={bLabel} sub={`${b.wins}/${b.games} won`} />
      <p className="col-span-2 text-[10.5px] text-faint">{title}</p>
    </div>
  );
}

function HeroList({ rows, empty, rate = true }: { rows: HeroRow[]; empty: string; rate?: boolean }) {
  if (!rows.length) return <div className="text-[11.5px] text-faint">{empty}</div>;
  const top = Math.max(1, ...rows.map((r) => r.games));
  return (
    <ul className="grid gap-1.5">
      {rows.slice(0, 6).map((r) => (
        <li key={r.hero} className="flex items-center gap-2 min-w-0">
          <HeroImg name={r.hero} size={26} className="rounded shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2 text-[11.5px]">
              <b className="truncate">{r.hero}</b>
              <span className="text-faint tabular-nums shrink-0">{r.games}×{rate && r.win_rate != null ? ` · ${pctTxt(r.win_rate)}` : ""}</span>
            </span>
            <span className="block h-1 rounded-full bg-raised mt-1 overflow-hidden">
              <i className="block h-full rounded-full scrim-bar" style={{ width: `${(100 * r.games) / top}%`, background: rate && r.win_rate != null && r.win_rate < 50 ? CHART_COLORS.loss : CHART_COLORS.win }} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The record band at the top of the scrims page. */
export function ScrimRecord({ data, series, games }: { data: ScrimInsightsT | null; series: { total: number; wins: number; losses: number; win_rate: number | null }; games: { total: number; win_rate: number | null } }) {
  const streak = data?.streak;
  return (
    <section className="card scrim-record p-4 sm:p-5" aria-label="Scrim record">
      <div className="scrim-record__ring">
        <Ring value={series.win_rate} size={132} thickness={12} color={(series.win_rate ?? 0) >= 50 ? CHART_COLORS.win : CHART_COLORS.loss}
          label="Series won" sub={`${series.wins}W – ${series.losses}L`} />
      </div>
      <div className="min-w-0 grid gap-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div><div className="label">Series</div><div className="text-[30px] font-extrabold leading-none tabular-nums"><CountUp value={series.total} /></div></div>
          <div><div className="label">Games</div><div className="text-[30px] font-extrabold leading-none tabular-nums"><CountUp value={games.total} /></div></div>
          <div><div className="label">Game win</div><div className="text-[30px] font-extrabold leading-none tabular-nums">{games.win_rate == null ? "—" : <CountUp value={games.win_rate} suffix="%" />}</div></div>
          {streak && streak.count > 1 && (
            <div className={`chip !py-1 ${streak.result === "WIN" ? "text-leaf border-leaf/40" : "text-danger border-danger/40"}`}>
              <Flame size={12} /> {streak.count} {streak.result === "WIN" ? "wins" : "losses"} in a row
            </div>
          )}
        </div>
        <div>
          <div className="label mb-1.5">Last {data?.form.length ?? 0}</div>
          <FormStrip form={data?.form ?? []} />
        </div>
      </div>
    </section>
  );
}

/** Overview tab: every chart. */
export function ScrimOverview({ data }: { data: ScrimInsightsT | null }) {
  if (!data) return <div className="card p-6 text-[12px] text-faint">Loading charts…</div>;
  if (!data.timeline.length) return <Empty title="No played scrims yet" hint="Record a scrim's games and the charts fill in." />;
  const t = data.timeline;
  const labels = t.map((r) => `#${r.number}`);
  const o = data.objectives;
  const fmtK = (v: number) => `${(v / 1000).toFixed(1)}k`;
  const lanes = data.lanes.filter((l) => l.games);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Form over time" icon={<TrendingUp size={14} className="text-crim" />} sub="Win rate after every scrim, and over the last five" className="lg:col-span-2">
        <Legend items={[{ name: "Overall", color: CHART_COLORS.accent }, { name: "Last 5", color: CHART_COLORS.sky, dashed: true }]} />
        <LineChart labels={labels} height={240} yMax={100} yFormat={(v) => `${v}%`} caption="Scrim win rate over time"
          titleFor={(i) => `#${t[i].number} vs ${t[i].opponent} · ${t[i].score_us}–${t[i].score_them}`}
          series={[{ name: "Overall", color: CHART_COLORS.accent, values: t.map((r) => r.win_rate_to_date), area: true },
                   { name: "Last 5", color: CHART_COLORS.sky, values: t.map((r) => r.win_rate_last5) }]} />
      </ChartCard>

      <ChartCard title="Kills and deaths per game" icon={<Swords size={14} className="text-crim" />} sub="Average for each scrim">
        <Legend items={[{ name: "Kills", color: CHART_COLORS.win }, { name: "Deaths", color: CHART_COLORS.loss }]} />
        <BarChart labels={labels.slice(-14)} height={210} caption="Kills and deaths per scrim"
          titleFor={(i) => { const r = t.slice(-14)[i]; return `#${r.number} vs ${r.opponent}`; }}
          series={[{ name: "Kills", color: CHART_COLORS.win, values: t.slice(-14).map((r) => r.kills ?? 0) },
                   { name: "Deaths", color: CHART_COLORS.loss, values: t.slice(-14).map((r) => r.deaths ?? 0) }]} />
      </ChartCard>

      <ChartCard title="Objectives per game" icon={<Shield size={14} className="text-crim" />} sub={o.turrets ? `Average over ${o.turrets.games} games with both sides recorded` : "Record both sides' objectives to fill this"}>
        <VersusBars rows={[
          { label: "Kills", us: o.kills?.us, them: o.kills?.them },
          { label: "Turrets", us: o.turrets?.us, them: o.turrets?.them },
          { label: "Turtles", us: o.turtles?.us, them: o.turtles?.them },
          { label: "Lords", us: o.lords?.us, them: o.lords?.them },
          { label: "Gold", us: o.gold?.us, them: o.gold?.them, fmt: fmtK },
        ]} />
      </ChartCard>

      <ChartCard title="Game length" icon={<Timer size={14} className="text-crim" />} sub="Wins and losses by how long the game ran">
        <Legend items={[{ name: "Won", color: CHART_COLORS.win }, { name: "Lost", color: CHART_COLORS.loss }]} />
        <BarChart labels={data.duration.map((d) => d.bucket)} height={200} caption="Results by game length"
          titleFor={(i) => `${data.duration[i].bucket}: ${pctTxt(data.duration[i].win_rate)} won`}
          series={[{ name: "Won", color: CHART_COLORS.win, values: data.duration.map((d) => d.wins) },
                   { name: "Lost", color: CHART_COLORS.loss, values: data.duration.map((d) => d.games - d.wins) }]} />
      </ChartCard>

      <ChartCard title="Where games are decided" icon={<Crown size={14} className="text-crim" />} sub="Win rate by gold at 10 minutes, and by lord count">
        <div className="grid sm:grid-cols-2 gap-4">
          <EdgeCard title="Gold lead at 10 min" a={data.early.ahead_at_10} b={data.early.behind_at_10} aLabel="Ahead" bLabel="Behind" />
          <EdgeCard title="Lords taken" a={data.lord_edge.more_lords} b={data.lord_edge.fewer_lords} aLabel="More lords" bLabel="Fewer" />
        </div>
      </ChartCard>

      <ChartCard title="Results by month" icon={<TrendingUp size={14} className="text-crim" />}>
        <BarChart labels={data.monthly.map((m) => monthLabel(m.month))} height={200} caption="Scrims per month"
          titleFor={(i) => `${monthLabel(data.monthly[i].month)}: ${data.monthly[i].wins}/${data.monthly[i].played} won`}
          overlay={{ name: "Win %", color: CHART_COLORS.amber, values: data.monthly.map((m) => m.win_rate) }}
          series={[{ name: "Won", color: CHART_COLORS.win, values: data.monthly.map((m) => m.wins) },
                   { name: "Lost", color: CHART_COLORS.loss, values: data.monthly.map((m) => m.played - m.wins) }]} />
      </ChartCard>

      <ChartCard title="Lanes" icon={<Users size={14} className="text-crim" />} sub="KDA per lane from recorded scoreboards">
        {lanes.length ? (
          <HBars caption="KDA by lane" color={CHART_COLORS.sky} format={(v) => v.toFixed(2)}
            rows={lanes.map((l) => ({ key: l.lane, value: l.kda ?? 0,
              label: <span className="lane-tag" data-lane={l.lane}>{nice(l.lane)}</span>,
              extra: <span className="text-faint tabular-nums">{l.kills}/{l.deaths}/{l.assists}{l.rating != null ? ` · ${l.rating}` : ""}</span> }))} />
        ) : <div className="text-[11.5px] text-faint">Add player K/D/A when recording games to see lanes.</div>}
      </ChartCard>

      <ChartCard title="Our picks" sub="Most played heroes and how they did"><HeroList rows={data.heroes.picked} empty="No drafts recorded." /></ChartCard>
      <ChartCard title="Heroes we face" sub="Their picks and our win rate against them"><HeroList rows={data.heroes.faced} empty="No enemy picks recorded." /></ChartCard>
      <ChartCard title="We ban" sub="Our most common bans"><HeroList rows={data.heroes.banned_by_us} empty="No bans recorded." rate={false} /></ChartCard>
      <ChartCard title="They ban" sub="What opponents take away from us"><HeroList rows={data.heroes.banned_by_them} empty="No bans recorded." rate={false} /></ChartCard>

      <ChartCard title="Opponents" sub="Series won and lost per team" className="lg:col-span-2">
        <Legend items={[{ name: "Won", color: CHART_COLORS.win }, { name: "Lost", color: CHART_COLORS.loss }]} />
        <BarChart labels={data.opponents.slice(0, 12).map((x) => x.opponent)} height={210} caption="Series by opponent"
          titleFor={(i) => { const x = data.opponents[i]; return `${x.opponent}: ${x.won}–${x.lost} (games ${x.game_wins}–${x.game_losses})`; }}
          series={[{ name: "Won", color: CHART_COLORS.win, values: data.opponents.slice(0, 12).map((x) => x.won) },
                   { name: "Lost", color: CHART_COLORS.loss, values: data.opponents.slice(0, 12).map((x) => x.lost) }]} />
      </ChartCard>
    </div>
  );
}

// ---------------------------------------------------------------------------------------- //
// scrim detail
// ---------------------------------------------------------------------------------------- //

/** Lineup as lane-coloured rows with avatar and IGN; subs as chips. */
export function LineupCard({ lanes, lineup, substitutes, users }: { lanes: string[]; lineup: Record<string, number | null>; substitutes: number[]; users: User[] }) {
  const byId = (uid: number | null | undefined) => users.find((u) => u.id === uid);
  return (
    <section className="card p-3.5 scrim-lineup" aria-label="Lineup">
      <div className="section-pill mb-2.5">Lineup</div>
      <ul className="grid gap-1.5">
        {lanes.map((lane) => {
          const u = byId(lineup?.[lane]);
          return (
            <li key={lane} className="scrim-lineup__row" data-lane={lane}>
              <span className="scrim-lineup__lane">{nice(lane)}</span>
              {u ? <AvatarImg user={u} size={26} className="shrink-0" /> : <span className="scrim-lineup__empty" aria-hidden="true" />}
              <button type="button" className="min-w-0 text-left truncate text-[13px]" disabled={!u} onClick={() => u && navigate("players", u.id)}>
                {u ? <Ign text={u.ign || u.name} /> : <span className="text-faint">Open</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {substitutes.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="label">Subs</span>
          {substitutes.map((id) => { const u = byId(id); return <span key={id} className="chip !py-0.5"><Ign text={u ? u.ign || u.name : "—"} /></span>; })}
        </div>
      )}
    </section>
  );
}

/** Per-game charts for one scrim. */
export function SeriesCharts({ scrim }: { scrim: Scrim }) {
  const games = [...scrim.games].sort((a, b) => a.game_no - b.game_no);
  if (!games.length) return null;
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
  const labels = games.map((g) => `G${g.game_no}`);
  const kills = games.map((g) => num(g.stats.kills) ?? 0);
  const enemyKills = games.map((g) => num(g.stats.enemy_kills) ?? num(g.stats.deaths) ?? 0);
  const total = (key: string) => games.reduce((t, g) => t + (num(g.stats[key]) ?? 0), 0);
  const has = (key: string) => games.some((g) => num(g.stats[key]) != null);
  // whole-series player lines (sum over games, by lane)
  const lines: Record<string, { name: string; k: number; d: number; a: number; gold: number; dmg: number; games: number }> = {};
  for (const g of games) {
    for (const [lane, line] of Object.entries(g.player_stats ?? {})) {
      const row = lines[lane] ??= { name: g.players?.[lane] || nice(lane), k: 0, d: 0, a: 0, gold: 0, dmg: 0, games: 0 };
      row.k += line.kills ?? 0; row.d += line.deaths ?? 0; row.a += line.assists ?? 0;
      row.gold += line.gold ?? 0; row.dmg += line.damage ?? 0; row.games += 1;
    }
  }
  const players = Object.entries(lines);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Kills each game" icon={<Swords size={14} className="text-crim" />} sub={`${scrim.opponent} in red`}>
        <Legend items={[{ name: "9 Clover", color: CHART_COLORS.win }, { name: scrim.opponent, color: CHART_COLORS.loss }]} />
        <BarChart labels={labels} height={190} caption="Kills per game, us and them"
          titleFor={(i) => `Game ${games[i].game_no}: ${games[i].result || "—"} · ${games[i].duration_min} min`}
          series={[{ name: "9 Clover", color: CHART_COLORS.win, values: kills }, { name: scrim.opponent, color: CHART_COLORS.loss, values: enemyKills }]} />
      </ChartCard>
      <ChartCard title="Series totals" icon={<Shield size={14} className="text-crim" />}>
        <VersusBars them={scrim.opponent} rows={[
          { label: "Kills", us: kills.reduce((a, b) => a + b, 0), them: enemyKills.reduce((a, b) => a + b, 0) },
          { label: "Turrets", us: has("turrets") ? total("turrets") : null, them: has("enemy_turrets") ? total("enemy_turrets") : null },
          { label: "Turtles", us: has("turtles") ? total("turtles") : null, them: has("enemy_turtles") ? total("enemy_turtles") : null },
          { label: "Lords", us: has("lords") ? total("lords") : null, them: has("enemy_lords") ? total("enemy_lords") : null },
          { label: "Gold", us: has("gold") ? total("gold") : null, them: has("enemy_gold") ? total("enemy_gold") : null, fmt: (v) => `${(v / 1000).toFixed(1)}k` },
        ]} />
      </ChartCard>
      {players.length > 0 && (
        <ChartCard title="Players this scrim" icon={<Users size={14} className="text-crim" />} sub="Damage across every game, with K/D/A" className="lg:col-span-2">
          <HBars caption="Damage by player" color={CHART_COLORS.amber}
            format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
            rows={players.map(([lane, r]) => ({ key: lane, value: r.dmg || r.gold || r.k + r.a,
              label: <span className="flex items-center gap-1.5 min-w-0"><span className="lane-tag" data-lane={lane}>{nice(lane)}</span><Ign text={r.name} /></span>,
              extra: <span className="text-faint tabular-nums">{r.k}/{r.d}/{r.a}</span> }))} />
        </ChartCard>
      )}
    </div>
  );
}
