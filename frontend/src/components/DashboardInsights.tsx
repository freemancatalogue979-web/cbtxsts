/**
 * Dashboard → big animated charts from GET /dashboard/insights: team games and win rate by
 * week, form (KDA / rating) next to your own, who's active (daily line + heatmap), top
 * heroes, the scrim/tournament/solo split, and (staff) every player's trend.
 */
import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Flame, Users } from "lucide-react";
import { api } from "../lib/api";
import type { Insights } from "../lib/types";
import { fmtDate, navigate, pct } from "../lib/util";
import { BarChart, CHART_COLORS, CountUp, Donut, HBars, Heatmap, Legend, LineChart, Sparkline, weekLabel } from "./Charts";
import { HeroImg } from "./HeroImg";
import { ErrorNote, SectionTitle, Spinner } from "./ui";

const RANGES = [8, 12, 26] as const;
const dayShort = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

function Big({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="card chart-card p-3.5 min-w-0">
      <div className="text-[10.5px] text-faint">{label}</div>
      <div className={`text-[28px] sm:text-[32px] font-extrabold tabular-nums leading-tight ${tone === "good" ? "text-leaf" : tone === "bad" ? "text-danger" : ""}`}>{value}</div>
      {hint && <div className="text-[10.5px] text-faint truncate">{hint}</div>}
    </div>
  );
}

export function DashboardInsights() {
  const [weeks, setWeeks] = useState<(typeof RANGES)[number]>(12);
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    api.get<Insights>(`/dashboard/insights?weeks=${weeks}`).then((d) => { if (live) { setData(d); setError(null); } }).catch((e) => live && setError(e));
    return () => { live = false; };
  }, [weeks]);

  const labels = useMemo(() => (data?.weeks ?? []).map(weekLabel), [data]);
  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading charts" />;

  const staff = data.scope === "staff";
  const t = data.team, s = data.summary, a = data.activity;
  const meWeeks = data.me.weeks;
  const people = [...a.people].sort((x, y) => y.active_days - x.active_days || x.name.localeCompare(y.name));
  const players = data.players.map((p) => ({ ...p, act: a.people.find((x) => x.user_id === p.user_id) }));
  const titleWeek = (i: number) => `Week of ${labels[i]}`;

  return (
    <section className="space-y-4" aria-label="Progress charts">
      <SectionTitle right={
        <span className="flex items-center gap-1" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={weeks === r} onClick={() => setWeeks(r)}
              className={`px-2.5 py-1 rounded-md text-[10.5px] font-bold border ${weeks === r ? "border-crim/60 bg-crim/10 text-crim" : "border-edge text-faint hover:text-mute"}`}>{r} weeks</button>
          ))}
        </span>
      }>
        <span className="inline-flex items-center gap-2"><BarChart3 size={15} className="text-crim" aria-hidden="true" /> Progress & activity</span>
      </SectionTitle>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Big label="Team games" value={<CountUp value={s.games} />} hint={`${s.scrim_games} scrim · ${s.tournament_games} tournament`} />
        <Big label="Win rate" value={s.win_rate == null ? "—" : <CountUp value={s.win_rate} digits={0} suffix="%" />} hint={`${s.wins}W · ${s.losses}L`}
          tone={s.win_rate == null ? undefined : s.win_rate >= 50 ? "good" : "bad"} />
        <Big label="Streak" value={s.streak.count ? <span className="inline-flex items-center gap-1"><Flame size={20} aria-hidden="true" /><CountUp value={s.streak.count} />{s.streak.result === "WIN" ? "W" : "L"}</span> : "—"}
          tone={s.streak.result === "WIN" ? "good" : s.streak.result === "LOSS" && s.streak.count >= 2 ? "bad" : undefined} hint="current run" />
        <Big label="Team KDA" value={s.kda == null ? "—" : <CountUp value={s.kda} digits={2} />} hint={s.rating == null ? "no ratings yet" : `rating ${s.rating}`} />
        <Big label={staff ? "Solo games (squad)" : "My solo games"} value={<CountUp value={s.solo_games} />} hint="ranked & classic" />
        <Big label={staff ? "Active this week" : "My active days"} value={staff ? <span><CountUp value={a.active_7} /><span className="text-[15px] text-faint">/{a.members}</span></span> : <CountUp value={a.people[0]?.active_7 ?? 0} />}
          hint={staff ? <span className="inline-flex items-center gap-1.5"><span className="chart-live inline-block h-1.5 w-1.5 rounded-full bg-leaf text-leaf" aria-hidden="true" />{a.active_today} on today</span> : "last 7 days"} />
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="card chart-card p-4 sm:p-5 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div><h3 className="text-[14px] font-extrabold">Games and win rate by week</h3><p className="text-[10.5px] text-faint">Scrims, tournament games and solo games, with the team's win rate on top</p></div>
            <Legend items={[{ name: "Scrims", color: CHART_COLORS.sky }, { name: "Tournament", color: CHART_COLORS.amber }, { name: "Solo", color: CHART_COLORS.violet }, { name: "Team win %", color: CHART_COLORS.accent }]} />
          </div>
          <BarChart caption="Team games and win rate by week" labels={labels} height={330} titleFor={titleWeek}
            series={[
              { name: "Scrims", color: CHART_COLORS.sky, values: t.map((w) => w.scrim_games) },
              { name: "Tournament", color: CHART_COLORS.amber, values: t.map((w) => w.tournament_games) },
              { name: "Solo", color: CHART_COLORS.violet, values: t.map((w) => w.solo_games) },
            ]}
            overlay={{ name: "Team win %", color: CHART_COLORS.accent, values: t.map((w) => w.win_rate), format: (v) => (v == null ? "—" : `${v}%`) }} />
        </div>
        <div className="card chart-card p-4 sm:p-5 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div><h3 className="text-[14px] font-extrabold">Form: team vs me</h3><p className="text-[10.5px] text-faint">KDA each week, and win rate on the right</p></div>
            <Legend items={[{ name: "Team KDA", color: CHART_COLORS.accent }, { name: "My KDA", color: CHART_COLORS.teal }, { name: "My win %", color: CHART_COLORS.win, dashed: true }]} />
          </div>
          <LineChart caption="Team and personal form by week" labels={labels} height={330} titleFor={titleWeek} rightMax={100} rightFormat={(v) => `${Math.round(v)}%`}
            series={[
              { name: "Team KDA", color: CHART_COLORS.accent, values: t.map((w) => w.kda), area: true },
              { name: "My KDA", color: CHART_COLORS.teal, values: meWeeks.map((w) => w.kda) },
              { name: "My win %", color: CHART_COLORS.win, values: meWeeks.map((w) => w.win_rate), right: true, dashed: true, format: (v) => (v == null ? "—" : `${v}%`) },
            ]} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="card chart-card p-4 sm:p-5 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div>
              <h3 className="text-[14px] font-extrabold inline-flex items-center gap-2"><Activity size={15} className="text-leaf" aria-hidden="true" /> {staff ? "Who's active" : "My activity"}</h3>
              <p className="text-[10.5px] text-faint">{staff ? `Members who opened the app each day · ${a.active_28} of ${a.members} in the last 4 weeks` : "Days you opened the app in the last 4 weeks"}</p>
            </div>
            {staff && <Legend items={[{ name: "Active members", color: CHART_COLORS.win }]} />}
          </div>
          {staff && (
            <LineChart caption="Active members per day" labels={a.days.map(dayShort)} height={180}
              series={[{ name: "Active", color: CHART_COLORS.win, values: a.daily_active, area: true }]} yFormat={(v) => String(Math.round(v))} />
          )}
          <div className={staff ? "mt-4" : ""}>
            <Heatmap caption={staff ? "Each member's active days" : "Your active days"} columns={a.days.map(dayShort)} color={CHART_COLORS.win}
              rows={people.slice(0, staff ? 24 : 1).map((p) => ({ label: p.name, cells: p.days, hint: `${p.active_days} days` }))} />
          </div>
          {staff && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {people.filter((p) => p.active_7 === 0).slice(0, 10).map((p) => (
                <li key={p.user_id} className="chip border-amber/45 text-amber !text-[10px]">{p.name} · {p.last_seen ? `last seen ${fmtDate(p.last_seen)}` : "not seen yet"}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="card chart-card p-4 sm:p-5 min-w-0 space-y-4">
          <div>
            <h3 className="text-[14px] font-extrabold">Where the games come from</h3>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Donut caption="Games by type" size={150} parts={[
                { label: "Scrims", value: s.scrim_games, color: CHART_COLORS.sky },
                { label: "Tournament", value: s.tournament_games, color: CHART_COLORS.amber },
                { label: "Solo", value: s.solo_games, color: CHART_COLORS.violet },
              ]} center={<div><div className="text-[20px] font-extrabold tabular-nums"><CountUp value={s.games + s.solo_games} /></div><div className="text-[9.5px] text-faint">games</div></div>} />
              <ul className="space-y-1.5 text-[11px]">
                <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky" />Scrims <b className="tabular-nums">{s.scrim_games}</b></li>
                <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber" />Tournament <b className="tabular-nums">{s.tournament_games}</b></li>
                <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS.violet }} />Solo <b className="tabular-nums">{s.solo_games}</b></li>
              </ul>
            </div>
          </div>
          <div>
            <h3 className="text-[14px] font-extrabold mb-2.5">Our most played heroes</h3>
            {data.heroes.length ? (
              <HBars caption="Most played heroes in team games" rows={data.heroes.map((h) => ({
                key: h.name, value: h.games, label: <span className="inline-flex items-center gap-1.5"><HeroImg name={h.name} size={20} className="rounded" />{h.name}</span>,
                tone: h.win_rate == null ? CHART_COLORS.sky : h.win_rate >= 55 ? CHART_COLORS.win : h.win_rate >= 45 ? CHART_COLORS.amber : CHART_COLORS.loss,
                extra: pct(h.win_rate),
              }))} format={(v) => `${v}`} />
            ) : <p className="text-[11.5px] text-faint">No drafts recorded in this range yet.</p>}
          </div>
        </div>
      </div>

      {staff && players.length > 0 && (
        <div className="card chart-card p-4 sm:p-5 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div><h3 className="text-[14px] font-extrabold inline-flex items-center gap-2"><Users size={15} className="text-crim" aria-hidden="true" /> Every player's trend</h3><p className="text-[10.5px] text-faint">Games per week (team + solo), rating trend and activity</p></div>
            <button type="button" className="label !text-crim" onClick={() => navigate("players")}>Roster →</button>
          </div>
          <div className="overflow-x-auto min-w-0">
            <table className="w-full text-[11.5px]">
              <thead className="text-faint text-left">
                <tr><th className="th">Player</th><th className="th">Games / week</th><th className="th">Win %</th><th className="th hidden md:table-cell">Rating</th><th className="th">Active</th><th className="th hidden sm:table-cell">Last seen</th></tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const games = p.weeks.reduce((n, w) => n + w.games, 0);
                  const decided = p.weeks.filter((w) => w.win_rate != null);
                  const wr = decided.length ? Math.round(decided.reduce((n, w) => n + (w.win_rate ?? 0) * w.games, 0) / Math.max(1, decided.reduce((n, w) => n + w.games, 0))) : null;
                  return (
                    <tr key={p.user_id} className="border-t border-edge/60">
                      <td className="td"><button type="button" className="font-bold hover:text-crim" onClick={() => navigate("players", p.user_id)}>{p.name}</button> <span className="text-faint">{p.lane ? `· ${p.lane === "EXP" ? "EXP" : p.lane[0] + p.lane.slice(1).toLowerCase()}` : ""}</span></td>
                      <td className="td"><span className="inline-flex items-center gap-2"><Sparkline values={p.weeks.map((w) => w.games)} label={`${p.name} games per week`} color={CHART_COLORS.sky} /><b className="tabular-nums">{games}</b></span></td>
                      <td className={`td tabular-nums ${wr == null ? "text-faint" : wr >= 50 ? "text-leaf" : "text-danger"}`}>{wr == null ? "—" : `${wr}%`}</td>
                      <td className="td hidden md:table-cell"><Sparkline values={p.weeks.map((w) => w.rating)} label={`${p.name} rating trend`} color={CHART_COLORS.amber} /></td>
                      <td className="td tabular-nums">{p.act ? <span className={p.act.active_7 ? "text-leaf" : "text-amber"}>{p.act.active_7}/7 days</span> : "—"}</td>
                      <td className="td hidden sm:table-cell text-mute">{p.act?.last_seen ? fmtDate(p.act.last_seen) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
