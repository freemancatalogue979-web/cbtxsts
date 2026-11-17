import { useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Ban, CheckCircle2, CircleDot, Clock3, Crown, Lightbulb, Repeat2, Shell, Sparkles, Swords, Target, Trophy, XCircle, Zap } from "lucide-react";
import { HeroImg } from "./HeroImg";
import { esportsDate, esportsNumber, gameDuration, hasCoaching, type BreakdownGame, type BreakdownGameTeam, type BreakdownMatch, type BreakdownMatchTeam, type BreakdownPick, type BreakdownPlan, type BreakdownSwap, type BreakdownVerdict, type DraftBreakdownData } from "../lib/esports";

/** Team colours stay fixed per slot so a team reads the same in every game. */
const TONE = {
  team1: { text: "text-sky", border: "border-sky/35", bg: "bg-sky/[0.07]", dot: "bg-sky" },
  team2: { text: "text-rose-300", border: "border-rose-300/35", bg: "bg-rose-300/[0.07]", dot: "bg-rose-300" },
} as const;

const VERDICT: Record<BreakdownVerdict, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  executed: { label: "Executed", className: "border-leaf/40 bg-leaf/10 text-leaf", Icon: CheckCircle2 },
  partial: { label: "Partly executed", className: "border-amber/40 bg-amber/10 text-amber", Icon: CircleDot },
  failed: { label: "Not executed", className: "border-rose-300/40 bg-rose-300/10 text-rose-300", Icon: XCircle },
};

function code(team: { code: string | null; name: string | null; key: string }) {
  return team.code || team.name || (team.key === "team1" ? "Team 1" : "Team 2");
}

function Logo({ team, size = 28 }: { team: BreakdownMatchTeam | BreakdownGameTeam; size?: number }) {
  const [failed, setFailed] = useState(false);
  return <span className="shrink-0 inline-flex items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.08] overflow-hidden" style={{ width: size, height: size }} aria-hidden="true">
    {team.logo && !failed ? <img src={team.logo} alt="" className="w-[80%] h-[80%] object-contain" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <span className="text-[8px] font-black not-italic text-mute">{code(team).slice(0, 3)}</span>}
  </span>;
}

/** Small rounded fact chip: icon + value. */
function StatChip({ icon, label, value, title }: { icon: ReactNode; label: string; value: string; title?: string }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-panel/80 px-2.5 py-1 text-[10px] font-bold tabular-nums" title={title}>
    <span className="text-mute" aria-hidden="true">{icon}</span><span className="sr-only">{label}: </span>{value}
  </span>;
}

/** Hero chip in the style of the draft board: portrait + name + player. */
function HeroChip({ pick, tone, struck = false, highlight = false }: { pick: BreakdownPick | { hero: string; player?: string | null; position?: string | null }; tone?: string; struck?: boolean; highlight?: boolean }) {
  const hero = pick.hero || "Unknown hero";
  return <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 ${highlight ? "border-leaf/50 bg-leaf/10" : struck ? "border-edge bg-ink/50 opacity-70" : `border-edge bg-panel/80 ${tone ?? ""}`}`}>
    <HeroImg name={hero} size={24} className={`rounded-full shrink-0 ${struck ? "grayscale" : ""}`} />
    <span className="min-w-0 leading-tight">
      <span className={`block truncate text-[10.5px] font-extrabold ${struck ? "line-through decoration-rose-300/80" : ""}`}>{hero}</span>
      {pick.player && <span className="block truncate text-[8.5px] font-bold text-mute">{pick.player}</span>}
    </span>
  </span>;
}

/** Banned hero: the portrait stays recognisable, crossed by a thin red slash. */
function BanChip({ hero }: { hero: string }) {
  return <span className="relative inline-flex overflow-hidden rounded-full ring-1 ring-rose-300/40" title={`Banned: ${hero}`}>
    <HeroImg name={hero} size={22} className="rounded-full grayscale-[60%] opacity-80" />
    <span className="pointer-events-none absolute left-1/2 top-1/2 h-[2px] w-[130%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-rose-300/90" aria-hidden="true" />
    <span className="sr-only">Banned {hero}</span>
  </span>;
}

function SwapCard({ swap }: { swap: BreakdownSwap }) {
  return <li className="rounded-lg border border-leaf/25 bg-gradient-to-br from-leaf/[0.07] to-transparent p-2.5">
    <div className="flex flex-wrap items-center gap-1.5">
      <HeroChip pick={{ hero: swap.out, player: swap.player }} struck />
      <ArrowRight size={14} className="text-leaf shrink-0" aria-label="swap to" />
      <HeroChip pick={{ hero: swap.in, player: swap.player }} highlight />
    </div>
    {swap.why && <p className="mt-2 text-[10.5px] leading-relaxed"><span className="font-extrabold text-leaf">Why · </span>{swap.why}</p>}
    {swap.how && <p className="mt-1 text-[10.5px] leading-relaxed text-text/90"><span className="font-extrabold text-leaf">How · </span>{swap.how}</p>}
  </li>;
}

function PlanBlock({ plan }: { plan: BreakdownPlan }) {
  const verdict = plan.verdict ? VERDICT[plan.verdict] : null;
  return <div className="space-y-2.5">
    {plan.win_condition && <div>
      <div className="flex items-center gap-1.5 text-[9.5px] font-extrabold tracking-[0.14em] text-crim"><Target size={12} aria-hidden="true" />Win condition</div>
      <p className="mt-1 text-[11px] leading-relaxed text-text">{plan.win_condition}</p>
    </div>}
    {plan.execution.length > 0 && <div>
      <div className="flex items-center gap-1.5 text-[9.5px] font-extrabold tracking-[0.14em] text-crim"><Zap size={12} aria-hidden="true" />How to execute</div>
      <ol className="mt-1.5 space-y-1.5">{plan.execution.map((step, index) => <li key={index} className="flex gap-2 text-[10.5px] leading-relaxed">
        <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-crim/15 text-[9px] font-black not-italic text-crim" aria-hidden="true">{index + 1}</span>
        <span className="min-w-0 text-text/90">{step}</span>
      </li>)}</ol>
    </div>}
    {verdict && <div className="flex flex-wrap items-start gap-2">
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-extrabold ${verdict.className}`}><verdict.Icon size={11} aria-hidden="true" />{verdict.label}</span>
      {plan.verdict_note && <span className="min-w-0 flex-1 text-[10px] leading-relaxed text-mute">{plan.verdict_note}</span>}
    </div>}
    {plan.swaps.length > 0 && <div>
      <div className="flex items-center gap-1.5 text-[9.5px] font-extrabold tracking-[0.14em] text-leaf"><Repeat2 size={12} aria-hidden="true" />Hero swap</div>
      <ul className="mt-1.5 space-y-2">{plan.swaps.map((swap) => <SwapCard key={`${swap.out}-${swap.in}`} swap={swap} />)}</ul>
    </div>}
  </div>;
}

function TeamColumn({ team, gameNumber }: { team: BreakdownGameTeam; gameNumber: number | null }) {
  const tone = TONE[team.key];
  const standout = team.standout;
  return <section className={`min-w-0 rounded-xl border p-3 ${team.won ? "border-leaf/30 bg-leaf/[0.035]" : "border-edge bg-panel/60"}`} aria-label={`${code(team)} draft, game ${gameNumber ?? "?"}`}>
    <header className="flex items-center gap-2">
      <Logo team={team} />
      <span className={`min-w-0 truncate text-[12px] font-black ${tone.text}`}>{code(team)}</span>
      {team.side && <span className={`rounded-full border px-1.5 py-px text-[8.5px] font-extrabold ${tone.border} ${tone.bg} ${tone.text}`}>{team.side} side</span>}
      <span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-black ${team.won ? "bg-leaf/15 text-leaf" : "bg-white/[0.05] text-mute"}`}>{team.won ? "Win" : "Loss"}</span>
    </header>
    {team.picks.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1.5">{team.picks.map((pick, index) => <HeroChip key={`${pick.hero}-${index}`} pick={pick} />)}</div>}
    {team.bans.some(Boolean) && <div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="inline-flex items-center gap-1 text-[8.5px] font-extrabold tracking-[0.14em] text-mute"><Ban size={10} aria-hidden="true" />Bans</span>{team.bans.map((hero, index) => hero && <BanChip key={`${hero}-${index}`} hero={hero} />)}</div>}
    {standout && <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-edge bg-ink/40 px-2 py-1.5">
      {standout.hero && <HeroImg name={standout.hero} size={22} className="rounded-full" />}
      <span className="min-w-0 flex-1 truncate text-[10px] font-bold">{standout.player || "Unknown"}<span className="text-mute"> · {standout.hero}</span></span>
      <span className="text-[10px] font-black tabular-nums not-italic" title="Kills / deaths / assists">{esportsNumber(standout.kills)}/{esportsNumber(standout.deaths)}/{esportsNumber(standout.assists)}</span>
      {standout.mvp && <span className="inline-flex items-center gap-0.5 rounded-full bg-amber/15 px-1.5 py-px text-[8.5px] font-black text-amber"><Crown size={9} aria-hidden="true" />MVP</span>}
    </div>}
    {team.plan && <div className="mt-3 border-t border-edge/70 pt-3"><PlanBlock plan={team.plan} /></div>}
  </section>;
}

function pair(game: BreakdownGame, key: "kills" | "turtles" | "lords"): string | null {
  const [left, right] = game.teams.map((team) => team[key]);
  return left == null || right == null ? null : `${left}–${right}`;
}

function GameCard({ game }: { game: BreakdownGame }) {
  const winner = game.teams.find((team) => team.key === game.winner);
  const kills = pair(game, "kills"), turtles = pair(game, "turtles"), lords = pair(game, "lords");
  return <article className="rounded-2xl border border-edge bg-raised/40 p-3 sm:p-4" aria-label={`Game ${game.number ?? ""}`}>
    <header className="flex flex-wrap items-center gap-1.5">
      <span className="rounded-md bg-crim/15 px-2.5 py-1 text-[10.5px] font-black tracking-[0.12em] text-crim">Game {game.number ?? "?"}</span>
      {winner && <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black ${TONE[winner.key].border} ${TONE[winner.key].bg} ${TONE[winner.key].text}`}><Trophy size={11} aria-hidden="true" />{code(winner)} win</span>}
      {game.duration_seconds != null && <StatChip icon={<Clock3 size={11} />} label="Duration" value={gameDuration(game.duration_seconds)} />}
      {kills && <StatChip icon={<Swords size={11} />} label="Kills" value={kills} title="Kills" />}
      {turtles && <StatChip icon={<Shell size={11} />} label="Turtles" value={turtles} title="Turtles" />}
      {lords && <StatChip icon={<Crown size={11} />} label="Lords" value={lords} title="Lords" />}
    </header>
    {game.deciding_factor && <p className="mt-2.5 flex gap-2 rounded-lg border border-amber/25 bg-amber/[0.06] px-2.5 py-2 text-[10.5px] leading-relaxed">
      <Zap size={13} className="mt-px shrink-0 text-amber" aria-hidden="true" /><span><span className="font-extrabold text-amber">Deciding factor · </span>{game.deciding_factor}</span>
    </p>}
    <div className="mt-3 grid gap-3 lg:grid-cols-2">{game.teams.map((team) => <TeamColumn key={team.key} team={team} gameNumber={game.number} />)}</div>
  </article>;
}

function MatchSection({ match }: { match: BreakdownMatch }) {
  const [left, right] = match.teams;
  return <section className="space-y-3" aria-label={`Match ${match.match_id}`}>
    {left && right && <header className="flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-panel/70 px-3 py-2.5">
      <Logo team={left} size={30} /><span className={`text-[12px] font-black ${TONE.team1.text}`}>{code(left)}</span>
      <span className="rounded-md bg-ink/60 px-2 py-0.5 text-[13px] font-black tabular-nums not-italic">{esportsNumber(left.score)} – {esportsNumber(right.score)}</span>
      <span className={`text-[12px] font-black ${TONE.team2.text}`}>{code(right)}</span><Logo team={right} size={30} />
      <span className="ml-auto flex flex-wrap gap-1.5">{[match.league, match.stage, match.format].filter(Boolean).map((label) => <span key={label} className="rounded-full border border-edge px-2 py-0.5 text-[9px] font-bold text-mute">{label}</span>)}</span>
    </header>}
    {match.series_story && <p className="text-[11px] leading-relaxed text-text/90"><span className="font-extrabold text-crim">Series · </span>{match.series_story}</p>}
    {match.games.length ? match.games.map((game, index) => <GameCard key={`${game.number}-${index}`} game={game} />)
      : <p className="rounded-lg border border-dashed border-edge-2 p-3 text-[11px] text-mute">No game breakdown is saved for this match yet.</p>}
  </section>;
}

/** Chip-based draft breakdown shared by match and multi-match analysis. */
export function DraftBreakdown({ mode, answer, note, breakdown, sources }: {
  mode: "ai" | "facts"; answer: string; note: string; breakdown?: DraftBreakdownData;
  sources: { match_id: string; source_url: string | null; fetched_at: string | null }[];
}) {
  const coached = hasCoaching(breakdown);
  const many = (breakdown?.matches.length ?? 0) > 1;
  return <div className="mt-4 space-y-4 rounded-2xl border border-edge bg-ink/50 p-3.5 sm:p-4" data-testid="draft-breakdown">
    <div className="flex flex-wrap items-center gap-2">
      <span className="section-pill section-pill--leaf"><Sparkles size={12} aria-hidden="true" />{mode === "ai" ? "AI draft breakdown" : "Match facts"}</span>
      {breakdown && <span className="text-[10px] font-bold text-mute">{breakdown.matches.reduce((total, match) => total + match.games.length, 0)} games · {breakdown.matches.length} {many ? "matches" : "match"}</span>}
    </div>
    {breakdown?.headline && <h4 className="text-[15px] sm:text-[17px] font-black leading-snug">{breakdown.headline}</h4>}
    {breakdown?.answer && <p className="flex gap-2 rounded-xl border border-crim/25 bg-crim/[0.06] px-3 py-2.5 text-[11.5px] leading-relaxed"><Lightbulb size={14} className="mt-0.5 shrink-0 text-crim" aria-hidden="true" /><span>{breakdown.answer}</span></p>}
    {/* A plain-text reply (no structured coaching) is still shown, line by line. */}
    {!coached && answer && <div className="space-y-1.5 text-[11px] leading-relaxed text-text/90">{answer.split("\n").filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}</div>}
    {breakdown?.matches.map((match) => <MatchSection key={match.match_id} match={match} />)}
    {breakdown && breakdown.takeaways.length > 0 && <section aria-label="Takeaways">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-extrabold tracking-[0.14em] text-leaf"><Target size={12} aria-hidden="true" />Takeaways for us</div>
      <ul className="grid gap-2 sm:grid-cols-2">{breakdown.takeaways.map((item, index) => <li key={index} className="flex gap-2 rounded-xl border border-leaf/25 bg-leaf/[0.05] px-3 py-2 text-[10.5px] leading-relaxed">
        <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-leaf/15 text-[9px] font-black not-italic text-leaf" aria-hidden="true">{index + 1}</span><span>{item}</span>
      </li>)}</ul>
    </section>}
    <footer className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-edge pt-3 text-[10px] text-mute">
      <span className="leading-relaxed">{note}</span>
      {sources.map((source) => source.source_url && <a key={source.match_id} href={source.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 font-bold hover:border-leaf/40 hover:text-leaf">
        Aerena · {source.match_id}{source.fetched_at ? ` · ${esportsDate(source.fetched_at)}` : ""}<ArrowUpRight size={10} aria-hidden="true" />
      </a>)}
    </footer>
  </div>;
}
