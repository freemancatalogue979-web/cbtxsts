import { AlertTriangle, ArrowRight, Bell, CalendarDays, Clock, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Dashboard } from "../lib/types";
import { dayLabel, fmtTime, navigate, pct, ResultBadge, useCountdown } from "../lib/util";
import { Empty, PageTitle, Progress, SectionTitle, Spinner, StatTile } from "../components/ui";

function NextActivity({ dash }: { dash: Dashboard }) {
  const activity = dash.next_activity;
  const cd = useCountdown(activity?.date, activity?.time);
  if (!activity) return <Empty title="Nothing scheduled" hint="Staff will add the next session soon" />;
  return (
    <div className="card p-4 sm:p-5 relative overflow-hidden">
      <div className="absolute inset-y-0 left-0 w-1 bg-crim" />
      <SectionTitle>Next activity</SectionTitle>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg sm:text-xl font-extrabold leading-tight">{activity.title}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[13px] text-mute">
            <span className="chip border-crim/40 text-crim">{activity.category}</span>
            <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} /> {dayLabel(activity.date)}</span>
            <span className="inline-flex items-center gap-1.5"><Clock size={13} /> {fmtTime(activity.time)} · {activity.duration_min} min</span>
            {activity.coach_name && <span>Coach {activity.coach_name}</span>}
          </div>
        </div>
        {cd && (
          <div className="text-right">
            <div className="label mb-1">{cd.past ? "Status" : "Starts in"}</div>
            <div className={`text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight ${cd.past ? "text-leaf" : "text-text"}`}>
              {cd.text}
            </div>
          </div>
        )}
      </div>
      {activity.required && <div className="text-[11px] text-amber mt-3 font-semibold">Attendance required — inform the captain if you cannot make it.</div>}
    </div>
  );
}

export function DashboardPage() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<Dashboard>("/dashboard").then(setDash).catch((e) => setErr(e.message));
  }, []);

  if (err) return <Empty title="Could not load the dashboard" hint={err} />;
  if (!dash) return <Spinner label="Loading operations" />;

  const week = dash.current_week;
  const perf = dash.performance;

  return (
    <div className="space-y-6">
      <PageTitle
        title="Competitive Operations"
        sub={dash.weakness?.season_name || "PLAY → RECORD → REVIEW → IDENTIFY → TRAIN → APPLY → IMPROVE"}
      />

      {dash.mandatory_reviews.length > 0 && (
        <button onClick={() => navigate("reviews")} className="w-full text-left card border-crim/60 bg-crim-dim/30 p-4 flex items-start gap-3 hover:bg-crim-dim/50 transition-colors">
          <AlertTriangle size={18} className="text-crim shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-crim uppercase tracking-wide">No review, no next scrim</div>
            <div className="text-[13px] text-text/80 mt-1">
              {dash.mandatory_reviews.map((s) => `Scrim #${s.number} vs ${s.opponent}`).join(" · ")}{" "}
              was a loss and has no match review. New scrims are blocked until it is filed.
            </div>
          </div>
        </button>
      )}

      {/* Training block + next activity */}
      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2 card p-4 sm:p-5">
          <SectionTitle right={week && <button className="label !text-crim hover:!text-crim/80" onClick={() => navigate("training", "weeks", week.id)}>Open week →</button>}>
            Current training block
          </SectionTitle>
          {week ? (
            <>
              <div className="label">Training week</div>
              <div className="text-3xl font-extrabold tabular-nums">{String(week.number).padStart(2, "0")}</div>
              <div className="label mt-4">Current focus</div>
              <div className="text-xl font-extrabold text-crim tracking-wide">{week.focus}</div>
              <div className="flex items-center justify-between mt-5 mb-1.5">
                <span className="label">Progress</span>
                <span className="text-sm font-extrabold tabular-nums">{week.progress}%</span>
              </div>
              <Progress value={week.progress} />
              <div className="text-[11px] text-faint mt-2">
                {week.activity_counts.done} of {week.activity_counts.total} sessions complete
                {week.start_date && <> · {dayLabel(week.start_date)} → {dayLabel(week.end_date)}</>}
              </div>
            </>
          ) : (
            <Empty title="No active week" />
          )}
        </div>
        <div className="lg:col-span-3">
          <NextActivity dash={dash} />
          {dash.next_scrim && (
            <button onClick={() => navigate("scrims", dash.next_scrim!.id)}
              className="card card-hover w-full text-left p-4 mt-4 flex items-center justify-between gap-3">
              <div>
                <div className="label mb-1">Next scrim</div>
                <div className="font-bold text-[15px]">
                  Scrim #{dash.next_scrim.number} vs {dash.next_scrim.opponent}
                  <span className="text-mute font-semibold"> · {dash.next_scrim.format}</span>
                </div>
                <div className="text-[12px] text-faint mt-1">{dayLabel(dash.next_scrim.date)} · {fmtTime(dash.next_scrim.time)}{dash.next_scrim.tournament_prep ? " · tournament prep" : ""}</div>
              </div>
              <ArrowRight size={16} className="text-faint" />
            </button>
          )}
        </div>
      </div>

      {/* Performance */}
      <section>
        <SectionTitle right={<span className="text-[11px] text-faint">last {perf.games_analyzed} scrim games</span>}>
          Team performance
        </SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
          <StatTile label="Win rate" value={pct(perf.win_rate)} tone={(perf.win_rate ?? 0) >= 50 ? "good" : "bad"}
            hint={perf.record ? `${perf.record.series_won}W–${perf.record.series_lost}L series` : undefined} />
          <StatTile label="Objective control" value={pct(perf.objective_control)} />
          <StatTile label="First turtle" value={pct(perf.first_turtle_rate)} tone="accent" />
          <StatTile label="Lord conversion" value={perf.lord_conversion == null ? "—" : pct(perf.lord_conversion)} />
          <StatTile label="Teamfight win" value={pct(perf.teamfight_success)} />
          <StatTile label="Avg game time" value={perf.avg_game_time_min ? `${perf.avg_game_time_min}m` : "—"} />
          <StatTile label="Gold diff @10" value={perf.gold_diff_10 === undefined ? "—" : `${perf.gold_diff_10 >= 0 ? "+" : ""}${perf.gold_diff_10}`} tone={(perf.gold_diff_10 ?? 0) >= 0 ? "good" : "bad"} />
          <StatTile label="Kills @10" value={perf.kills_10 ?? "—"} />
          <StatTile label="Deaths @10" value={perf.deaths_10 ?? "—"} tone={(perf.deaths_10 ?? 0) <= (perf.kills_10 ?? 0) ? "good" : "default"} />
        </div>
      </section>

      {/* Weakness + action items */}
      {dash.weakness && (
        <section className="card p-4 sm:p-5">
          <SectionTitle>Current team weakness</SectionTitle>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xl font-extrabold">&ldquo;{dash.weakness.current_weakness}&rdquo;</div>
              <div className="text-[12px] text-mute mt-1">
                Required improvement: {dash.weakness.weakness_category.toLowerCase()} drills
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-extrabold text-amber tabular-nums">{dash.weakness.drills_remaining}</div>
              <div className="label">drills remaining</div>
            </div>
          </div>
          <div className="mt-3">
            <Progress value={dash.weakness.weakness_drills_target ? (100 * dash.weakness.drills_done) / dash.weakness.weakness_drills_target : 0} tone="leaf" />
            <div className="text-[11px] text-faint mt-1.5">
              {dash.weakness.drills_done}/{dash.weakness.weakness_drills_target} drills banked this block
              {dash.open_action_items > 0 && <> · {dash.open_action_items} review action item{dash.open_action_items === 1 ? "" : "s"} still open</>}
            </div>
          </div>
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Recent results */}
        <section>
          <SectionTitle right={<button className="label !text-crim" onClick={() => navigate("scrims")}>All scrims →</button>}>
            Recent results
          </SectionTitle>
          <div className="card divide-y divide-edge/60">
            {dash.recent_results.length === 0 && <div className="p-4"><Empty title="No scrims played yet" /></div>}
            {dash.recent_results.map((s) => (
              <button key={s.id} onClick={() => navigate("scrims", s.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-raised transition-colors text-left">
                <ResultBadge result={s.result} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">9 CLOVER {s.score_us} - {s.score_them} {s.opponent}</div>
                  <div className="text-[11px] text-faint">{dayLabel(s.date)} · Scrim #{s.number} · {s.format}</div>
                </div>
                {s.needs_review && (
                  <span className="chip border-amber/40 text-amber !text-[9px] uppercase"><Bell size={10} /> review due</span>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* Upcoming events */}
        <section>
          <SectionTitle right={<button className="label !text-crim" onClick={() => navigate("events")}>Calendar →</button>}>
            Upcoming events
          </SectionTitle>
          <div className="card divide-y divide-edge/60">
            {dash.upcoming_events.length === 0 && <div className="p-4"><Empty title="Nothing on the calendar" /></div>}
            {dash.upcoming_events.map((ev) => (
              <div key={ev.id} className="px-4 py-3 flex items-start gap-3">
                <div className="w-11 shrink-0 text-center card !bg-raised py-1.5">
                  <div className="text-[9px] font-bold uppercase text-crim">{ev.date ? new Date(`${ev.date}T00:00`).toLocaleDateString(undefined, { month: "short" }) : "—"}</div>
                  <div className="text-base font-extrabold leading-none">{ev.date ? ev.date.slice(8) : "—"}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-snug">{ev.title}</div>
                  <div className="text-[11px] text-faint mt-0.5">
                    <span className="uppercase font-bold mr-1.5">{ev.kind}</span>
                    {fmtTime(ev.time)}{ev.location ? ` · ${ev.location}` : ""}
                  </div>
                </div>
                {ev.kind === "tournament" && <Target size={14} className="text-crim ml-auto shrink-0 mt-1" />}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
