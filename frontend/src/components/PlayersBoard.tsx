/**
 * Players tab extras:
 *  - Leaderboard: how every roster member is doing (team games + the games they add in
 *    Utility), best to least, with a clear nudge for anyone who hasn't added data.
 *  - UtilityPanel: one member's Utility games as charts, heroes and latest games, visible to
 *    the whole team.
 *  - LinkedAccountCard: the member's linked MLBB account.
 */
import { ArrowRight, Check, Copy, Crown, Flame, Gamepad2, Medal, Sparkles, Target, TrendingDown, Trophy, Upload, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../lib/api";
import type { BoardRow, Leaderboard, SoloAlert, UtilityProfile } from "../lib/types";
import type { LinkSummary } from "../lib/mlbb";
import { dayLabel, navigate, ResultBadge } from "../lib/util";
import { nice } from "../lib/caseText";
import { AvatarImg } from "./Avatar";
import { BarChart, CHART_COLORS, Legend, weekLabel } from "./Charts";
import { HeroImg } from "./HeroImg";
import { laneKey, WinRing } from "./PlayerBits";
import { AlertCard, FormDots, kdaText } from "./PlayerPerformance";
import { Ign, SectionTitle, Spinner } from "./ui";

const PERIODS = [{ id: "30", label: "30 days" }, { id: "90", label: "90 days" }, { id: "all", label: "All time" }] as const;

function ago(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - Date.parse(iso.length <= 10 ? `${iso}T12:00:00` : iso)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: readonly { id: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className="segmented__opt" data-on={value === o.id || undefined}
          onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

const ScoreBar = ({ value }: { value: number }) => (
  <span className="board-score" role="img" aria-label={`Score ${value} of 100`}>
    <span className="board-score__fill" style={{ "--w": `${Math.max(4, Math.min(100, value))}%` } as CSSProperties} />
  </span>
);

function PodiumCard({ row, place }: { row: BoardRow; place: 1 | 2 | 3 }) {
  return (
    <button type="button" className="podium-card" data-place={place} data-lane={laneKey(row.main_role) || undefined}
      onClick={() => navigate("players", row.user_id)} aria-label={`#${place} ${row.ign}: score ${row.score?.value}`}>
      <span className="podium-card__medal" aria-hidden="true">{place === 1 ? <Crown size={13} /> : <Medal size={12} />}{place}</span>
      <span className="podium-card__face"><AvatarImg user={{ ign: row.ign, name: row.name, avatar: row.avatar }} size={place === 1 ? 52 : 42} /></span>
      <span className="podium-card__name"><Ign text={row.ign} /></span>
      <span className="podium-card__score tabular-nums">{row.score?.value.toFixed(1)}</span>
      <span className="podium-card__meta tabular-nums">{row.win_rate ?? "—"}% · {row.games}g</span>
    </button>
  );
}

function BoardLine({ row, best, least, isMe }: { row: BoardRow; best: boolean; least: boolean; isMe: boolean }) {
  return (
    <li>
      <button type="button" className="board-row" data-lane={laneKey(row.main_role) || undefined} data-me={isMe || undefined}
        data-flag={best ? "best" : least ? "least" : undefined} onClick={() => navigate("players", row.user_id)}>
        <span className="board-row__rank tabular-nums" aria-label={`Rank ${row.rank}`}>{row.rank}</span>
        <AvatarImg user={{ ign: row.ign, name: row.name, avatar: row.avatar }} size={36} />
        <span className="board-row__who">
          <span className="board-row__name">
            <Ign text={row.ign} />
            {best && <span className="board-flag board-flag--best"><Crown size={10} aria-hidden="true" /> Best</span>}
            {least && <span className="board-flag board-flag--least"><TrendingDown size={10} aria-hidden="true" /> Needs work</span>}
            {isMe && <span className="board-flag board-flag--me">You</span>}
          </span>
          <span className="board-row__stats tabular-nums">
            <span><b className="text-leaf">{row.wins}W</b>–<b className="text-danger">{row.losses}L</b></span>
            <span>{row.win_rate ?? "—"}%</span>
            {row.kda && <span>KDA {kdaText(row.kda.ratio)}</span>}
            {row.rating != null && <span>Rtg {row.rating.toFixed(1)}</span>}
            <span className="text-faint">{row.team_games} team · {row.solo_games} utility</span>
          </span>
          {row.heroes.length > 0 && (
            <span className="board-row__heroes" aria-label={`Most played: ${row.heroes.map((h) => h.hero).join(", ")}`}>
              {row.heroes.map((h) => <HeroImg key={h.hero} name={h.hero} size={20} className="rounded-[5px]" />)}
            </span>
          )}
        </span>
        <span className="board-row__right">
          <span className="board-row__score tabular-nums">{row.score?.value.toFixed(1)}</span>
          <ScoreBar value={row.score?.value ?? 0} />
          <FormDots form={row.form.slice(0, 5)} label={`${row.ign} recent results`} />
        </span>
      </button>
    </li>
  );
}

/** The squad, best to least, plus who still needs to add games. */
export function PlayersLeaderboard({ meId }: { meId: number }) {
  const [period, setPeriod] = useState<Leaderboard["period"]>("30");
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    api.get<Leaderboard>(`/players/leaderboard?period=${period}`)
      .then((b) => { if (live) setBoard(b); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [period]);

  const ranked = board?.rows.filter((r) => r.rank != null) ?? [];
  const waiting = board?.rows.filter((r) => r.rank == null) ?? [];
  const podium = ranked.slice(0, 3);
  const me = board?.me;
  return (
    <section aria-label="Leaderboard" className="space-y-3">
      <SectionTitle right={<Segmented value={period} options={PERIODS} onChange={setPeriod} label="Leaderboard period" />}>
        <Trophy size={15} className="inline -mt-0.5 mr-1 text-amber" aria-hidden="true" />Leaderboard
      </SectionTitle>
      {!board && !failed && <Spinner />}
      {failed && <p className="text-[12px] text-faint">Couldn't load the leaderboard. Pull to refresh or try again in a moment.</p>}
      {board && (
        <>
          {me && (
            <div className="board-me card" data-state={me.nudge ? "nudge" : "ok"}>
              <span className="board-me__icon" aria-hidden="true">{me.rank ? <Zap size={16} /> : <Upload size={16} />}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-extrabold">
                  {me.rank ? <>You're #{me.rank} of {me.of}{me.rank === 1 ? " — top of the squad" : ""}</> : "You're not on the board yet"}
                </div>
                <div className="text-[11px] text-mute leading-relaxed">
                  {me.nudge || `${me.games_7d} ${me.games_7d === 1 ? "game" : "games"} this week. Keep adding your games in Utility so the board stays honest.`}
                </div>
              </div>
              <button type="button" className={me.nudge ? "btn-primary !py-1.5 !text-[11px] shrink-0" : "btn-ghost !py-1.5 !text-[11px] shrink-0"}
                onClick={() => navigate("utility", "add")}><Upload size={13} aria-hidden="true" /> Add my games</button>
            </div>
          )}

          {ranked.length === 0 ? (
            <div className="card p-5 text-center">
              <Target size={22} className="mx-auto text-faint" aria-hidden="true" />
              <div className="mt-2 text-[13px] font-extrabold">Nobody is ranked {board.days ? `in the last ${board.days} days` : "yet"}</div>
              <p className="mt-1 text-[11.5px] text-mute">You need {board.min_games} games with a result. Upload your ranked games in Utility and you'll show up here.</p>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-5">
              <div className="card p-3.5 lg:col-span-2 space-y-3">
                <div className="podium" data-count={podium.length}>
                  {podium[1] && <PodiumCard row={podium[1]} place={2} />}
                  {podium[0] && <PodiumCard row={podium[0]} place={1} />}
                  {podium[2] && <PodiumCard row={podium[2]} place={3} />}
                </div>
                {Object.keys(board.awards).length > 0 && (
                  <ul className="board-awards">
                    {Object.entries(board.awards).map(([key, a]) => a && (
                      <li key={key}>
                        <button type="button" onClick={() => navigate("players", a.user_id)}>
                          <span className="board-awards__icon" aria-hidden="true">{key === "grinder" ? <Flame size={12} /> : <Sparkles size={12} />}</span>
                          <span className="board-awards__label">{a.label}</span>
                          <span className="board-awards__who"><Ign text={a.ign} /></span>
                          <b className="tabular-nums">{a.value}</b>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <ol className="card p-2 lg:col-span-3 board-list" aria-label="Ranking">
                {ranked.map((r) => <BoardLine key={r.user_id} row={r} best={r.user_id === board.best} least={r.user_id === board.least} isMe={r.user_id === meId} />)}
              </ol>
            </div>
          )}

          {waiting.length > 0 && (
            <div className="card p-3.5 board-waiting">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2.5">
                <div className="section-pill">Not on the board yet · {waiting.length}</div>
                <span className="text-[10.5px] text-faint">Add your games in Utility: screenshot, sheet or by hand</span>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {waiting.map((r) => (
                  <li key={r.user_id} className="board-waiting__row" data-lane={laneKey(r.main_role) || undefined}>
                    <AvatarImg user={{ ign: r.ign, name: r.name, avatar: r.avatar }} size={30} />
                    <div className="min-w-0 flex-1">
                      <button type="button" className="text-[12.5px] leading-tight truncate block max-w-full text-left" onClick={() => navigate("players", r.user_id)}>
                        <Ign text={r.ign} />{r.user_id === meId && <span className="board-flag board-flag--me ml-1.5">You</span>}
                      </button>
                      <div className="text-[10.5px] text-amber leading-snug">{r.nudge}</div>
                    </div>
                    {r.user_id === meId && (
                      <button type="button" className="btn-primary !py-1 !px-2 !text-[10.5px] shrink-0" onClick={() => navigate("utility", "add")}>
                        <Upload size={12} aria-hidden="true" /> Add
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[10px] text-faint leading-relaxed">
            Score out of 100 = win rate {board.weights.win * 100}% · KDA {board.weights.kda * 100}% · rating {board.weights.rating * 100}% · games played {board.weights.volume * 100}%,
            from scrims, tournaments and the games each player adds in Utility. Ranked from {board.min_games} games with a result.
          </p>
        </>
      )}
    </section>
  );
}

const SOLO_TONE_ICON: Record<SoloAlert["tone"], typeof Flame> = { bad: TrendingDown, warn: Flame, good: Sparkles };

/** A member's Utility games: weekly chart, heroes and latest games. Teammates can see it. */
export function UtilityPanel({ userId, ign }: { userId: number; ign: string }) {
  const [data, setData] = useState<UtilityProfile | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api.get<UtilityProfile>(`/players/${userId}/utility`).then((d) => { if (live) setData(d); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [userId]);
  if (failed) return null;
  if (!data) return <Spinner />;
  const o = data.overall;
  const right = <span className="text-[10.5px] text-faint">{o.games ? `last added ${ago(data.last_added)}` : ""}</span>;
  if (!o.games) {
    return (
      <section aria-label="Utility games" className="space-y-3">
        <SectionTitle right={right}>Utility games · <Ign text={ign} /></SectionTitle>
        <div className="card utility-empty">
          <Upload size={20} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-extrabold">{data.is_self ? "Add your games so the team can see your form" : <><Ign text={ign} /> hasn't added any games yet</>}</div>
            <p className="text-[11.5px] text-mute mt-0.5">
              {data.is_self ? "Upload a screenshot, spreadsheet or document in Utility, or type a game in. It counts straight away and puts you on the leaderboard."
                : "Once they upload games in Utility, their charts and heroes show here."}
            </p>
          </div>
          {data.is_self && <button type="button" className="btn-primary !text-[11.5px] shrink-0" onClick={() => navigate("utility", "add")}><Upload size={13} aria-hidden="true" /> Add my games</button>}
        </div>
      </section>
    );
  }
  const labels = data.weeks.map((w) => weekLabel(w.start));
  const streak = data.streak.count >= 2 ? `${data.streak.count} ${data.streak.result === "WIN" ? "wins" : "losses"} in a row` : "";
  return (
    <section aria-label="Utility games" className="space-y-3">
      <SectionTitle right={right}>Utility games · <Ign text={ign} /></SectionTitle>
      <div className="grid gap-3 lg:grid-cols-5">
        <div className="card p-4 lg:col-span-3 min-w-0">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <WinRing value={o.win_rate} size={56} label="Utility win rate" empty="No results yet" />
            <div className="utility-tiles">
              <div><span className="label">Games</span><b className="tabular-nums">{o.games}</b><small className="tabular-nums"><span className="text-leaf">{o.wins}W</span> <span className="text-danger">{o.losses}L</span></small></div>
              <div><span className="label">KDA</span><b className={`tabular-nums ${!o.kda ? "" : o.kda.ratio >= 3 ? "text-leaf" : o.kda.ratio < 2 ? "text-danger" : ""}`}>{kdaText(o.kda?.ratio)}</b>
                <small className="tabular-nums">{o.kda ? `${o.kda.kills}/${o.kda.deaths}/${o.kda.assists}` : "—"}</small></div>
              <div><span className="label">Rating</span><b className="tabular-nums">{o.rating ? o.rating.avg.toFixed(1) : "—"}</b><small>{o.mvps ? `${o.mvps} MVP` : "avg"}</small></div>
              <div><span className="label">Form</span><FormDots form={data.form.slice(0, 5)} label={`${ign} recent utility games`} /><small>{streak || " "}</small></div>
            </div>
          </div>
          <Legend items={[{ name: "Utility games", color: CHART_COLORS.sky }, { name: "Team games", color: CHART_COLORS.violet }, { name: "Win %", color: CHART_COLORS.win }]} />
          <BarChart height={190} labels={labels}
            series={[{ name: "Utility games", color: CHART_COLORS.sky, values: data.weeks.map((w) => w.solo_games) },
              { name: "Team games", color: CHART_COLORS.violet, values: data.weeks.map((w) => w.team_games) }]}
            overlay={{ name: "Win %", color: CHART_COLORS.win, values: data.weeks.map((w) => w.win_rate) }}
            caption={`${data.ign}: games per week for the last 12 weeks, with win rate`}
            titleFor={(i) => `${labels[i]}: ${data.weeks[i].solo_games} utility + ${data.weeks[i].team_games} team games${data.weeks[i].win_rate != null ? ` · ${data.weeks[i].win_rate}% won` : ""}`} />
          {data.alerts.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2 mt-3">
              {data.alerts.slice(0, 4).map((a, i) => (
                <AlertCard key={`${a.kind}-${a.hero ?? i}`} tone={a.tone} hero={a.hero} icon={SOLO_TONE_ICON[a.tone]} compact
                  label={a.tone === "good" ? "Strength" : a.tone === "bad" ? "Fix this" : "Watch"} title={a.title} detail={a.detail} />
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4 lg:col-span-2 min-w-0 space-y-3">
          <div className="section-pill">Heroes</div>
          <ul className="utility-heroes">
            {data.heroes.slice(0, 6).map((h) => (
              <li key={h.name}>
                <HeroImg name={h.name} size={34} className="rounded-md shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold truncate">{h.name}</span>
                  <span className="block text-[10px] text-faint tabular-nums">{h.games}g · <span className="text-leaf">{h.wins}W</span>–<span className="text-danger">{h.losses}L</span>{h.kda ? ` · KDA ${kdaText(h.kda.ratio)}` : ""}</span>
                </span>
                <WinRing value={h.win_rate} size={34} label={`${h.name} win rate`} empty="No results" />
              </li>
            ))}
          </ul>
          <div className="section-pill">Latest games</div>
          <ul className="divide-y divide-edge/60">
            {data.recent.slice(0, 6).map((g) => (
              <li key={g.id} className="flex items-center gap-2 py-1.5 text-[11.5px]">
                {g.hero ? <HeroImg name={g.hero} size={22} className="rounded shrink-0" /> : <span className="w-[22px] shrink-0" />}
                <span className="min-w-0 flex-1 truncate">
                  <b>{g.hero || "Unknown hero"}</b>
                  <span className="text-faint"> · {g.mode || "Game"}{g.lane ? ` · ${nice(g.lane)}` : ""}{g.played_on ? ` · ${dayLabel(g.played_on)}` : ""}</span>
                </span>
                {(g.kills != null || g.deaths != null || g.assists != null) && <span className="tabular-nums text-mute shrink-0">{g.kills ?? 0}/{g.deaths ?? 0}/{g.assists ?? 0}</span>}
                {g.mvp && <Crown size={11} className="text-amber shrink-0" aria-label="MVP" />}
                {g.result ? <ResultBadge result={g.result} /> : <span className="text-faint w-10 text-center">—</span>}
              </li>
            ))}
          </ul>
          {data.is_self && (
            <button type="button" className="btn-ghost w-full !text-[11px]" onClick={() => navigate("utility", "add")}>
              <Upload size={13} aria-hidden="true" /> Add more games <ArrowRight size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** The member's linked MLBB account: avatar, in-game name, level, rank tier and game ID. */
export function LinkedAccountCard({ link }: { link: LinkSummary }) {
  const [copied, setCopied] = useState(false);
  const [broken, setBroken] = useState(false);
  const id = link.role_id != null ? `${link.role_id}${link.zone_id != null ? ` (${link.zone_id})` : ""}` : "";
  async function copy() {
    if (!id) return;
    try { await navigator.clipboard.writeText(id); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  }
  return (
    <div className="mlbb-link">
      <span className="mlbb-link__face">
        {link.avatar && !broken
          ? <img src={link.avatar} alt="" width={46} height={46} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
          : <Gamepad2 size={18} aria-hidden="true" />}
        <span className="mlbb-link__ok" title="Linked"><Check size={9} strokeWidth={3.5} aria-hidden="true" /></span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="mlbb-link__top">
          <span className="mlbb-link__tag"><Gamepad2 size={10} aria-hidden="true" /> MLBB · linked</span>
          {link.linked_at && <span className="mlbb-link__since">since {dayLabel(link.linked_at.slice(0, 10))}</span>}
        </div>
        <div className="mlbb-link__name"><Ign text={link.name || "MLBB account"} /></div>
        <div className="mlbb-link__chips">
          {link.level != null && <span className="mlbb-link__chip"><span>Lv</span><b className="tabular-nums">{link.level}</b></span>}
          {link.rank_level != null && <span className="mlbb-link__chip"><span>Rank tier</span><b className="tabular-nums">{link.rank_level}</b></span>}
          {id && (
            <button type="button" className="mlbb-link__chip mlbb-link__chip--id" onClick={() => void copy()} aria-label={`Copy game ID ${id}`}>
              <span>ID</span><b className="tabular-nums">{id}</b>{copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
