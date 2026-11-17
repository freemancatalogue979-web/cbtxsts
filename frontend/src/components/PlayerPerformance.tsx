import { Crown, Flame, Gauge, Skull, Sparkles, Swords, Target, TrendingDown, Trophy } from "lucide-react";
import type { FocusAlert, GamePlayed, HeroPerf, PerfSummary, PlayerPerformance } from "../lib/types";
import { nice } from "../lib/caseText";
import { dayLabel, navigate, pct, ResultBadge } from "../lib/util";
import { HeroImg } from "./HeroImg";
import { Empty, SectionTitle, StatTile } from "./ui";

const ALERT_ICON: Record<FocusAlert["kind"], typeof Flame> = {
  struggling: TrendingDown, low_kda: Skull, low_rating: Gauge, cold_streak: Flame, no_reps: Swords, strength: Sparkles,
};
const ALERT_LABEL: Record<FocusAlert["kind"], string> = {
  struggling: "Work on it", low_kda: "Dying a lot", low_rating: "Low rating", cold_streak: "Cold streak", no_reps: "No reps yet", strength: "Strength",
};
const TONE: Record<FocusAlert["tone"], { card: string; chip: string; bar: string }> = {
  bad: { card: "border-danger/45", chip: "text-danger border-danger/45 bg-danger/10", bar: "bg-danger" },
  warn: { card: "border-amber/45", chip: "text-amber border-amber/45 bg-amber/10", bar: "bg-amber" },
  good: { card: "border-leaf/45", chip: "text-leaf border-leaf/45 bg-leaf/10", bar: "bg-leaf" },
};

export function kdaText(ratio: number | null | undefined): string {
  return ratio == null ? "—" : ratio.toFixed(ratio >= 10 ? 1 : 2);
}

/** Last results as small W/L blocks, newest first. */
export function FormDots({ form, label = "Recent form" }: { form: string[]; label?: string }) {
  const shown = form.filter(Boolean);
  if (!shown.length) return <span className="text-faint text-[11px]">—</span>;
  return (
    <span className="inline-flex gap-1" role="img" aria-label={`${label}: ${shown.map((r) => (r === "WIN" ? "win" : "loss")).join(", ")}`}>
      {shown.map((r, i) => (
        <span key={i} aria-hidden="true"
          className={`grid h-4 w-4 place-items-center rounded-[4px] text-[8.5px] font-extrabold ${r === "WIN" ? "bg-leaf text-[#04261b]" : "bg-danger text-[#2a0710]"}`}>
          {r === "WIN" ? "W" : "L"}
        </span>
      ))}
    </span>
  );
}

/** "Heroes to work on": one card per alert, worst first. */
export function FocusAlerts({ alerts, compact = false, empty }: { alerts: FocusAlert[]; compact?: boolean; empty?: string }) {
  if (!alerts.length) {
    return empty ? <p className="text-[12px] text-faint">{empty}</p> : null;
  }
  return (
    <ul className={`grid gap-2.5 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
      {alerts.map((a) => {
        const Icon = ALERT_ICON[a.kind];
        const tone = TONE[a.tone];
        return (
          <li key={`${a.kind}-${a.hero}`} className={`card relative overflow-hidden p-3.5 flex gap-3 ${tone.card}`}>
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />
            <span className="relative shrink-0">
              <HeroImg name={a.hero} size={compact ? 44 : 52} className="rounded-lg" />
              <span className={`absolute -bottom-1.5 -right-1.5 grid h-6 w-6 place-items-center rounded-full border bg-panel ${tone.chip}`}>
                <Icon size={12} aria-hidden="true" />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`chip !py-0 !text-[9.5px] ${tone.chip}`}>{ALERT_LABEL[a.kind]}</span>
                {a.pool && <span className="chip !py-0 !text-[9.5px] text-mute">{a.pool} pool</span>}
              </div>
              <div className="mt-1 text-[13px] font-extrabold leading-snug break-words">{a.title}</div>
              <div className="text-[11.5px] text-mute leading-relaxed break-words">{a.detail}</div>
              {!compact && a.tip && <div className="mt-1 text-[11px] text-faint leading-relaxed">{a.tip}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Every hero a player has played with the team: record, KDA and form. */
export function HeroPerformance({ heroes }: { heroes: HeroPerf[] }) {
  if (!heroes.length) return <Empty title="No team games yet" hint="Scrim and tournament games with a lineup show up here." />;
  const hasKda = heroes.some((h) => h.kda);
  const hasRating = heroes.some((h) => h.rating?.avg != null);
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[12px] min-w-[520px]">
        <thead>
          <tr className="text-left text-faint">
            <th className="label font-normal px-1 pb-2">Hero</th>
            <th className="label font-normal px-1 pb-2 text-right">Games</th>
            <th className="label font-normal px-1 pb-2 text-right">W–L</th>
            <th className="label font-normal px-1 pb-2 text-right">Win</th>
            {hasKda && <th className="label font-normal px-1 pb-2 text-right">KDA</th>}
            {hasRating && <th className="label font-normal px-1 pb-2 text-right" title="Average in-game rating">Rating</th>}
            <th className="label font-normal px-1 pb-2 pl-4">Form</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge/60">
          {heroes.map((h) => (
            <tr key={h.key}>
              <td className="px-1 py-1.5">
                <span className="flex items-center gap-2 min-w-0">
                  <HeroImg name={h.hero} size={26} className="rounded shrink-0" />
                  <span className="min-w-0">
                    <span className="block font-bold truncate">{h.hero}</span>
                    <span className="block text-[10px] text-faint truncate">{h.lanes.map(nice).join(" · ")}</span>
                  </span>
                </span>
              </td>
              <td className="px-1 py-1.5 text-right tabular-nums">
                <span className="font-bold">{h.games}</span>
                <span className="block text-[9.5px] text-faint">
                  {[h.scrim_games ? `${h.scrim_games} scrim` : "", h.tournament_games ? `${h.tournament_games} tourn` : ""].filter(Boolean).join(" · ")}
                </span>
              </td>
              <td className="px-1 py-1.5 text-right tabular-nums">
                <span className={h.wins ? "text-leaf" : "text-faint"}>{h.wins}</span>–<span className={h.losses ? "text-danger" : "text-faint"}>{h.losses}</span>
              </td>
              <td className={`px-1 py-1.5 text-right tabular-nums ${h.win_rate == null ? "text-faint" : h.win_rate >= 50 ? "text-leaf" : "text-danger"}`}>{pct(h.win_rate)}</td>
              {hasKda && (
                <td className={`px-1 py-1.5 text-right tabular-nums ${!h.kda ? "text-faint" : h.kda.ratio >= 3 ? "text-leaf" : h.kda.ratio < 2 ? "text-danger" : ""}`}
                  title={h.kda ? `${h.kda.kills}/${h.kda.deaths}/${h.kda.assists} a game over ${h.kda.games}` : undefined}>
                  {kdaText(h.kda?.ratio)}
                </td>
              )}
              {hasRating && (
                <td className={`px-1 py-1.5 text-right tabular-nums ${h.rating?.avg == null ? "text-faint" : h.rating.avg >= 8 ? "text-leaf" : h.rating.avg < 6 ? "text-danger" : ""}`}
                  title={h.rating ? `${h.rating.games} rated ${h.rating.games === 1 ? "game" : "games"}${h.rating.mvps ? ` · ${h.rating.mvps} MVP` : ""}` : undefined}>
                  {h.rating?.avg != null ? h.rating.avg.toFixed(1) : "—"}
                  {h.rating?.mvps ? <Crown size={10} className="inline ml-1 -mt-0.5 text-amber" aria-label={`${h.rating.mvps} MVP`} /> : null}
                </td>
              )}
              <td className="px-1 py-1.5 pl-4"><FormDots form={h.form} label={`${h.hero} form`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Newest scrim + tournament games, each linking to its scrim or tournament. */
export function RecentGames({ games }: { games: GamePlayed[] }) {
  if (!games.length) return null;
  return (
    <ul className="divide-y divide-edge/60">
      {games.map((g) => (
        <li key={`${g.source}-${g.match_id}-${g.game_no}`}>
          <button className="w-full flex items-center gap-2.5 py-1.5 text-left hover:text-sky"
            onClick={() => navigate(g.source === "scrim" ? "scrims" : "tournaments", g.event_id)}>
            {g.hero ? <HeroImg name={g.hero} size={24} className="rounded shrink-0" /> : <span className="w-6 shrink-0" />}
            <span className={`chip !py-0 !text-[9px] shrink-0 ${g.source === "scrim" ? "text-sky border-sky/40" : "text-amber border-amber/40"}`}>
              {g.source === "scrim" ? <Swords size={9} aria-hidden="true" /> : <Trophy size={9} aria-hidden="true" />}
              {g.source === "scrim" ? "scrim" : "tournament"}
            </span>
            <span className="flex-1 min-w-0 truncate text-[12px]">
              <span className="font-bold">{g.label}</span> · vs {g.opponent} · game {g.game_no}
              <span className="text-faint"> · {nice(g.lane)}{g.hero ? ` · ${g.hero}` : ""}{g.date ? ` · ${dayLabel(g.date)}` : ""}</span>
            </span>
            {g.kills != null || g.deaths != null || g.assists != null
              ? <span className="text-[11px] tabular-nums text-mute shrink-0">{g.kills ?? 0}/{g.deaths ?? 0}/{g.assists ?? 0}</span>
              : null}
            {g.rating != null && <span className="text-[11px] tabular-nums text-mute shrink-0" title="Match rating">{g.rating.toFixed(1)}</span>}
            {g.mvp && <span className="chip !py-0 !text-[9px] text-amber border-amber/45 shrink-0"><Crown size={9} aria-hidden="true" />MVP</span>}
            {g.result ? <ResultBadge result={g.result} /> : <span className="text-faint text-[11px] w-10 text-center">—</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function recordHint(s: PerfSummary): string {
  return s.games ? `${s.wins}W – ${s.losses}L · ${pct(s.win_rate)}` : "none yet";
}

/** Player page: everything they played with the team, and what to work on. */
export function PerformancePanel({ perf, ign, isSelf }: { perf: PlayerPerformance; ign: string; isSelf: boolean }) {
  const { overall, scrims, tournaments } = perf;
  const kda = overall.kda;
  return (
    <section aria-label="Team games and heroes" className="space-y-3">
      <SectionTitle right={<span className="text-[11px] text-faint">scrims + tournaments</span>}>Team games · {ign}</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <StatTile icon={<Target size={14} />} label="Team games" value={overall.games}
          hint={overall.games ? `${overall.wins}W – ${overall.losses}L${overall.main_lane ? ` · mostly ${nice(overall.main_lane)}` : ""}` : "none yet"} />
        <StatTile label="Game win" value={pct(overall.win_rate)}
          tone={overall.win_rate == null ? "default" : overall.win_rate >= 50 ? "good" : "bad"} />
        <StatTile icon={<Swords size={14} />} label="Scrim games" value={scrims.games} hint={recordHint(scrims)} />
        <StatTile icon={<Trophy size={14} />} label="Tournament games" value={tournaments.games} hint={recordHint(tournaments)} />
        <StatTile label="KDA" value={kdaText(kda?.ratio)}
          hint={kda ? `${kda.kills}/${kda.deaths}/${kda.assists} a game · ${kda.games} ${kda.games === 1 ? "game" : "games"}` : "add K/D/A to games"}
          tone={!kda ? "default" : kda.ratio >= 3 ? "good" : kda.ratio < 2 ? "bad" : "default"} />
        <StatTile icon={<Gauge size={14} />} label="Match rating" value={overall.rating?.avg != null ? overall.rating.avg.toFixed(1) : "—"}
          hint={overall.rating ? `${overall.rating.mvps} MVP · ${overall.rating.games} rated` : "from scoreboards"}
          tone={overall.rating?.avg == null ? "default" : overall.rating.avg >= 8 ? "good" : overall.rating.avg < 6 ? "bad" : "default"} />
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="section-pill">{isSelf ? "Heroes to work on" : `Heroes ${ign} should work on`}</div>
          <span className="text-[11px] text-faint">from {overall.games} team {overall.games === 1 ? "game" : "games"} · needs 3+ games on a hero</span>
        </div>
        <FocusAlerts alerts={perf.focus}
          empty={overall.games ? "Nothing to flag right now: no hero is losing more than it wins." : "Play some scrims with a lineup recorded and this fills in."} />
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <div className="card p-4 lg:col-span-3 min-w-0">
          <div className="section-pill mb-3">Hero performance</div>
          <HeroPerformance heroes={perf.heroes} />
        </div>
        <div className="card p-4 lg:col-span-2 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="section-pill">Recent games</div>
            <FormDots form={overall.form} />
          </div>
          {perf.recent.length ? <RecentGames games={perf.recent} /> : <p className="text-[12px] text-faint">No games yet.</p>}
        </div>
      </div>
    </section>
  );
}
