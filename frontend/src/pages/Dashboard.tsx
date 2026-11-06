import {
  AlertTriangle, ArrowRight, Bell, BrainCircuit, CalendarDays, ClipboardList, Clock, Coins, Crosshair, Crown,
  Flame, Layers, Skull, Swords, Target, Timer, Trophy, Turtle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Dashboard, User } from "../lib/types";
import { dayLabel, fmtTime, navigate, pct, ResultBadge, useCountdown } from "../lib/util";
import { Empty, PageTitle, SectionTitle, Spinner, StatTile } from "../components/ui";

function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** Circular progress for the training block. Decorative: the number is in text too. */
function Ring({ value, size = 112 }: { value: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-raised)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="url(#ring-accent)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped / 100)}
        style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.2,.7,.2,1)", filter: "drop-shadow(0 0 6px rgb(var(--accent-glow) / .55))" }} />
      <defs>
        <linearGradient id="ring-accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-crim)" />
          <stop offset="100%" stopColor="var(--accent-solid)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Big countdown digits in tiles: days, hours, minutes, seconds. */
function CountdownTiles({ date, time }: { date?: string | null; time?: string | null }) {
  const cd = useCountdown(date, time);
  if (!cd) return null;
  if (cd.past) return <div className="text-2xl font-extrabold text-leaf">Live now</div>;
  const parts = [
    ...(cd.days > 0 ? [{ v: cd.days, l: "days" }] : []),
    { v: cd.hours, l: "hrs" }, { v: cd.minutes, l: "min" }, { v: cd.seconds, l: "sec" },
  ];
  return (
    <div className="flex gap-1.5" role="timer" aria-label={`Starts in ${cd.text}`}>
      {parts.map((part) => (
        <div key={part.l} className="min-w-[52px] rounded-lg border border-edge bg-raised/80 px-2 py-1.5 text-center">
          <div className="text-[22px] font-extrabold leading-none tabular-nums">{String(part.v).padStart(2, "0")}</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-faint">{part.l}</div>
        </div>
      ))}
    </div>
  );
}

function TrainingBlock({ dash }: { dash: Dashboard }) {
  const week = dash.current_week;
  return (
    <section className="card p-4 sm:p-5 h-full">
      <SectionTitle right={week && <button className="label !text-crim hover:!text-crim/80" onClick={() => navigate("training", "weeks", week.id)}>Open week →</button>}>
        Current training block
      </SectionTitle>
      {week ? (
        <div className="flex items-center gap-5">
          <div className="relative">
            <Ring value={week.progress} />
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="text-2xl font-extrabold tabular-nums leading-none">{week.progress}%</div>
                <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-faint">progress</div>
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <div className="label">Training week</div>
            <div className="text-4xl font-extrabold tabular-nums leading-none">{String(week.number).padStart(2, "0")}</div>
            <div className="label mt-3">Current focus</div>
            <div className="text-lg font-extrabold text-crim leading-snug break-words">{week.focus}</div>
            <div className="text-[11px] text-faint mt-2">
              {week.activity_counts.done} of {week.activity_counts.total} sessions complete
              {week.start_date && <> · {dayLabel(week.start_date)} → {dayLabel(week.end_date)}</>}
            </div>
          </div>
        </div>
      ) : (
        <Empty title="No active week" hint="Staff can start one from the Training Center" />
      )}
    </section>
  );
}

function NextUp({ dash }: { dash: Dashboard }) {
  const activity = dash.next_activity;
  const scrim = dash.next_scrim;
  return (
    <section className="card p-4 sm:p-5 h-full relative overflow-hidden">
      <div aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-crim to-transparent" />
      <SectionTitle>Next up</SectionTitle>
      {activity ? (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xl sm:text-2xl font-extrabold leading-tight break-words">{activity.title}</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[13px] text-mute">
              <span className="chip border-crim/40 text-crim">{activity.category}</span>
              <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} aria-hidden="true" /> {dayLabel(activity.date)}</span>
              <span className="inline-flex items-center gap-1.5"><Clock size={13} aria-hidden="true" /> {fmtTime(activity.time)} · {activity.duration_min} min</span>
              {activity.coach_name && <span>Coach {activity.coach_name}</span>}
            </div>
            {activity.required && <div className="text-[11px] text-amber mt-2 font-semibold">Attendance required — tell the captain if you can’t make it.</div>}
          </div>
          <CountdownTiles date={activity.date} time={activity.time} />
        </div>
      ) : (
        <Empty title="Nothing scheduled" hint="Staff will add the next session soon" />
      )}
      {scrim && (
        <button onClick={() => navigate("scrims", scrim.id)}
          className="mt-4 w-full flex items-center gap-3 rounded-xl border border-edge bg-raised/60 px-3.5 py-3 text-left transition-colors hover:border-edge-2 hover:bg-raised">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-crim/15 text-crim"><Swords size={17} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-faint">Next scrim</span>
            <span className="block truncate text-[14px] font-bold">
              #{scrim.number} vs {scrim.opponent}<span className="text-mute font-semibold"> · {scrim.format}</span>
            </span>
            <span className="block text-[11.5px] text-faint">{dayLabel(scrim.date)} · {fmtTime(scrim.time)}{scrim.tournament_prep ? " · tournament prep" : ""}</span>
          </span>
          <ArrowRight size={16} className="text-faint shrink-0" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

/** Last results as a row of W/L blocks, newest on the right. */
function FormStrip({ results }: { results: Dashboard["recent_results"] }) {
  if (!results.length) return null;
  const ordered = [...results].reverse();
  const tone = (r: string | null | undefined) => r === "WIN" ? "bg-leaf text-[#04261b]" : r === "LOSS" ? "bg-danger text-[#2a0710]" : "bg-amber text-[#2b1d04]";
  return (
    <div className="flex items-center gap-1.5" aria-label={`Recent form: ${ordered.map((s) => s.result ?? "no result").join(", ")}`}>
      {ordered.map((s) => (
        <span key={s.id} aria-hidden="true" title={`#${s.number} vs ${s.opponent}`}
          className={`grid h-6 w-6 place-items-center rounded-md text-[10px] font-extrabold ${tone(s.result)}`}>
          {s.result ? s.result[0] : "–"}
        </span>
      ))}
    </div>
  );
}

const QUICK = [
  { id: "ai", label: "Ask 9 CLOVER AI", icon: BrainCircuit, primary: true },
  { id: "reviews", label: "Reviews", icon: ClipboardList },
  { id: "drafts", label: "Draft Lab", icon: Layers },
];

export function DashboardPage({ me }: { me?: User }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<Dashboard>("/dashboard").then(setDash).catch((e) => setErr(e.message));
  }, []);

  if (err) return <Empty title="Could not load the dashboard" hint={err} />;
  if (!dash) return <Spinner label="Loading operations" />;

  const perf = dash.performance;
  const name = me?.ign || me?.name;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-6">
      <PageTitle
        title={name ? `${greeting()}, ${name}` : "The Hub"}
        sub={`${today}${dash.weakness?.season_name ? ` · ${dash.weakness.season_name}` : ""} · PLAY → REVIEW → TRAIN → IMPROVE`}
        right={
          <>
            {QUICK.map((action) => {
              const Icon = action.icon;
              return (
                <button key={action.id} className={action.primary ? "btn-primary" : "btn-ghost"} onClick={() => navigate(action.id)}>
                  <Icon size={15} aria-hidden="true" /> {action.label}
                </button>
              );
            })}
          </>
        }
      />

      {dash.mandatory_reviews.length > 0 && (
        <button onClick={() => navigate("reviews")} className="w-full text-left card border-danger/60 bg-danger-dim/40 p-4 flex items-start gap-3 hover:bg-danger-dim/60 transition-colors">
          <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <div className="text-sm font-bold text-danger uppercase tracking-wide">No review, no next scrim</div>
            <div className="text-[13px] text-text/80 mt-1">
              {dash.mandatory_reviews.map((s) => `Scrim #${s.number} vs ${s.opponent}`).join(" · ")}{" "}
              was a loss and has no match review. New scrims are blocked until it is filed.
            </div>
          </div>
        </button>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5"><TrainingBlock dash={dash} /></div>
        <div className="lg:col-span-7"><NextUp dash={dash} /></div>
      </div>

      <section>
        <SectionTitle right={<span className="text-[11px] text-faint">last {perf.games_analyzed} scrim games</span>}>
          Team performance
        </SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
          <StatTile icon={<Trophy size={14} />} label="Win rate" value={pct(perf.win_rate)} tone={(perf.win_rate ?? 0) >= 50 ? "good" : "bad"}
            hint={perf.record ? `${perf.record.series_won}W–${perf.record.series_lost}L series` : undefined} />
          <StatTile icon={<Target size={14} />} label="Objective control" value={pct(perf.objective_control)} />
          <StatTile icon={<Turtle size={14} />} label="First turtle" value={pct(perf.first_turtle_rate)} tone="accent" />
          <StatTile icon={<Crown size={14} />} label="Lord conversion" value={perf.lord_conversion == null ? "—" : pct(perf.lord_conversion)} />
          <StatTile icon={<Flame size={14} />} label="Teamfight win" value={pct(perf.teamfight_success)} />
          <StatTile icon={<Timer size={14} />} label="Avg game time" value={perf.avg_game_time_min ? `${perf.avg_game_time_min}m` : "—"} />
          <StatTile icon={<Coins size={14} />} label="Gold diff @10" value={perf.gold_diff_10 === undefined ? "—" : `${perf.gold_diff_10 >= 0 ? "+" : ""}${perf.gold_diff_10}`} tone={(perf.gold_diff_10 ?? 0) >= 0 ? "good" : "bad"} />
          <StatTile icon={<Crosshair size={14} />} label="Kills @10" value={perf.kills_10 ?? "—"} />
          <StatTile icon={<Skull size={14} />} label="Deaths @10" value={perf.deaths_10 ?? "—"} tone={(perf.deaths_10 ?? 0) <= (perf.kills_10 ?? 0) ? "good" : "default"} />
        </div>
      </section>

      {dash.weakness && (
        <section className="card p-4 sm:p-5">
          <SectionTitle>Current team weakness</SectionTitle>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xl font-extrabold break-words">&ldquo;{dash.weakness.current_weakness}&rdquo;</div>
              <div className="text-[12px] text-mute mt-1">
                Required improvement: {dash.weakness.weakness_category.toLowerCase()} drills
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-extrabold text-amber tabular-nums">{dash.weakness.drills_remaining}</div>
              <div className="label">drills remaining</div>
            </div>
          </div>
          {dash.weakness.weakness_drills_target > 0 && (
            <div className="mt-4 flex gap-1" aria-hidden="true">
              {Array.from({ length: Math.min(dash.weakness.weakness_drills_target, 24) }).map((_, i) => (
                <span key={i} className={`h-2 flex-1 rounded-full ${i < dash.weakness!.drills_done ? "bg-leaf shadow-[0_0_8px_rgba(52,211,153,.45)]" : "bg-raised border border-edge/60"}`} />
              ))}
            </div>
          )}
          <div className="text-[11px] text-faint mt-2">
            {dash.weakness.drills_done}/{dash.weakness.weakness_drills_target} drills banked this block
            {dash.open_action_items > 0 && <> · {dash.open_action_items} review action item{dash.open_action_items === 1 ? "" : "s"} still open</>}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section>
          <SectionTitle right={<button className="label !text-crim" onClick={() => navigate("scrims")}>All scrims →</button>}>
            Recent results
          </SectionTitle>
          <div className="card">
            {dash.recent_results.length > 0 && (
              <div className="flex items-center justify-between gap-3 border-b border-edge/60 px-4 py-2.5">
                <span className="label">Form</span>
                <FormStrip results={dash.recent_results} />
              </div>
            )}
            <div className="divide-y divide-edge/60">
              {dash.recent_results.length === 0 && <div className="p-4"><Empty title="No scrims played yet" /></div>}
              {dash.recent_results.map((s) => (
                <button key={s.id} onClick={() => navigate("scrims", s.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left">
                  <ResultBadge result={s.result} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">9 CLOVER <span className="tabular-nums">{s.score_us} - {s.score_them}</span> {s.opponent}</div>
                    <div className="text-[11px] text-faint">{dayLabel(s.date)} · Scrim #{s.number} · {s.format}</div>
                  </div>
                  {s.needs_review && (
                    <span className="chip border-amber/40 text-amber !text-[9px] uppercase"><Bell size={10} aria-hidden="true" /> review due</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <SectionTitle right={<button className="label !text-crim" onClick={() => navigate("events")}>Calendar →</button>}>
            Upcoming events
          </SectionTitle>
          <div className="card divide-y divide-edge/60">
            {dash.upcoming_events.length === 0 && <div className="p-4"><Empty title="Nothing on the calendar" /></div>}
            {dash.upcoming_events.map((ev) => (
              <div key={ev.id} className="px-4 py-3 flex items-start gap-3">
                <div className="w-12 shrink-0 overflow-hidden rounded-lg border border-edge text-center">
                  <div className="bg-crim/20 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-crim">{ev.date ? new Date(`${ev.date}T00:00`).toLocaleDateString(undefined, { month: "short" }) : "—"}</div>
                  <div className="bg-raised py-1 text-lg font-extrabold leading-none tabular-nums">{ev.date ? ev.date.slice(8) : "—"}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-snug">{ev.title}</div>
                  <div className="text-[11px] text-faint mt-0.5">
                    <span className="uppercase font-bold mr-1.5">{ev.kind}</span>
                    {fmtTime(ev.time)}{ev.location ? ` · ${ev.location}` : ""}
                  </div>
                </div>
                {ev.kind === "tournament" && <Target size={14} className="text-crim ml-auto shrink-0 mt-1" aria-hidden="true" />}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
