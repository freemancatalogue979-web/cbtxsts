import { ClipboardList, Pencil, Plus, Trash2, Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Draft, Hero, Meta, Tournament, TournamentGameDraft, TournamentMatchT, User } from "../lib/types";
import { dayLabel, fmtTime, navigate } from "../lib/util";
import { Badge, Empty, ErrorNote, Field, Modal, PageTitle, SectionTitle, Spinner, StatTile } from "../components/ui";
import { DraftBoard, DraftBoardEditor } from "../components/DraftBoard";
import { FilePick } from "../components/FilePick";
import { FileText, Film, ImageIcon, Link2 } from "lucide-react";
import { nice } from "../lib/caseText";

// --------------------------------------------------------------------------- //
// forms
// --------------------------------------------------------------------------- //
function TournamentForm({ initial, onSaved, onClose }: {
  initial: Partial<Tournament> | null; onSaved: () => void; onClose: () => void;
}) {
  const edit = Boolean(initial?.id);
  const [f, setF] = useState<Record<string, unknown>>({
    name: initial?.name ?? "",
    status: initial?.status ?? "upcoming",
    start_date: initial?.start_date ?? "",
    end_date: initial?.end_date ?? "",
    notes: initial?.notes ?? "",
    review_queued: initial?.review_queued ?? false,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const body = { ...f, start_date: f.start_date || null, end_date: f.end_date || null };
    try {
      if (edit) await api.patch(`/tournaments/${initial!.id}`, body);
      else await api.post("/tournaments", body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally { setBusy(false); }
  }

  return (
    <Modal title={edit ? "Edit tournament" : "New tournament"} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Tournament name">
          <input className="input" required value={String(f.name)} onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. MPL Snapshot Cup" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start"><input className="input" type="date" value={String(f.start_date)} onChange={(e) => set("start_date", e.target.value)} /></Field>
          <Field label="End"><input className="input" type="date" value={String(f.end_date)} onChange={(e) => set("end_date", e.target.value)} /></Field>
        </div>
        {edit && (
          <Field label="Status">
            <select className="input" value={String(f.status)} onChange={(e) => set("status", e.target.value)}>
              {["upcoming", "ongoing", "finished"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        )}
        <Field label="Notes">
          <textarea className="input min-h-16" value={String(f.notes)} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="accent-crim" checked={Boolean(f.review_queued)}
            onChange={(e) => set("review_queued", e.target.checked)} />
          Set for review — matches enter the match-review flow
        </label>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{edit ? "Save changes" : "Create tournament"}</button>
        </div>
      </form>
    </Modal>
  );
}

function AddMatchForm({ tournament, initial, onSaved, onClose }: {
  tournament: Tournament; initial?: TournamentMatchT | null; onSaved: () => void; onClose: () => void;
}) {
  const edit = Boolean(initial?.id);
  const [f, setF] = useState<Record<string, unknown>>(initial ? {
    stage: initial.stage, scheduled_date: initial.scheduled_date ?? "",
    start_time: initial.start_time, opponent: initial.opponent,
    format: initial.format, review_queued: initial.review_queued, notes: initial.notes,
  } : {
    stage: tournament.stages[tournament.stages.length - 1] ?? "Day 1",
    scheduled_date: tournament.start_date ?? "",
    start_time: "",
    opponent: "",
    format: "BO3",
    review_queued: tournament.review_queued,
    notes: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const body = { ...f, scheduled_date: f.scheduled_date || null };
      if (edit) await api.patch(`/tournaments/matches/${initial!.id}`, body);
      else await api.post(`/tournaments/${tournament.id}/matches`, body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally { setBusy(false); }
  }

  return (
    <Modal title={edit ? `Edit match ${initial!.match_no} — ${tournament.name}` : `Schedule match — ${tournament.name}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Stage / match day" hint="e.g. Day 1, Groups, Semifinal, Finals">
          <input className="input" list="t-stages" required value={String(f.stage)} onChange={(e) => set("stage", e.target.value)} placeholder="Day 1" />
          <datalist id="t-stages">{tournament.stages.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="Opponent">
          <input className="input" required value={String(f.opponent)} onChange={(e) => set("opponent", e.target.value)} placeholder="Blacklist Intl" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><input className="input" type="date" value={String(f.scheduled_date)} onChange={(e) => set("scheduled_date", e.target.value)} /></Field>
          <Field label="Time"><input className="input" type="time" value={String(f.start_time)} onChange={(e) => set("start_time", e.target.value)} /></Field>
          <Field label="Format">
            <select className="input" value={String(f.format)} onChange={(e) => set("format", e.target.value)}>
              {["BO1", "BO2", "BO3", "BO5", "BO7"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Notes"><input className="input" value={String(f.notes)} onChange={(e) => set("notes", e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="accent-crim" checked={Boolean(f.review_queued)}
            onChange={(e) => set("review_queued", e.target.checked)} />
          Set for review after it's played
        </label>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{edit ? "Save changes" : "Add match"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResultForm({ match, onSaved, onClose }: {
  match: TournamentMatchT; onSaved: () => void; onClose: () => void;
}) {
  const [f, setF] = useState<Record<string, unknown>>({
    status: match.status, result: match.result, score_us: match.score_us,
    score_them: match.score_them, notes: match.notes,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.patch(`/tournaments/matches/${match.id}`, { ...f, score_us: Number(f.score_us) || 0, score_them: Number(f.score_them) || 0 });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally { setBusy(false); }
  }

  return (
    <Modal title={`Result — vs ${match.opponent} (${match.stage || "Match " + match.match_no})`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Status">
            <select className="input" value={String(f.status)} onChange={(e) => set("status", e.target.value)}>
              {["scheduled", "played", "cancelled"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Result">
            <select className="input" value={String(f.result)} onChange={(e) => set("result", e.target.value)}>
              {["", "WIN", "LOSS", "DRAW"].map((r) => <option key={r} value={r}>{nice(r) || "—"}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Us"><input className="input" type="number" min={0} value={Number(f.score_us)} onChange={(e) => set("score_us", e.target.value)} /></Field>
            <Field label="Them"><input className="input" type="number" min={0} value={Number(f.score_them)} onChange={(e) => set("score_them", e.target.value)} /></Field>
          </div>
        </div>
        <Field label="Notes">
          <textarea className="input min-h-20" value={String(f.notes)} onChange={(e) => set("notes", e.target.value)}
            placeholder="How the series went, what to carry into the next one" />
        </Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>Save result</button>
        </div>
      </form>
    </Modal>
  );
}

const blankTDraft = () => ({
  our_bans: ["", "", "", "", ""], enemy_bans: ["", "", "", "", ""],
  our_picks: {} as Record<string, string>, enemy_picks: {} as Record<string, string>,
});

/** Saved per-game drafts (falls back to the old single draft as game 1). */
export function seriesGames(m: TournamentMatchT): TournamentGameDraft[] {
  if (m.games) return m.games;
  return hasDraft(m.draft) ? [{ game_no: 1, result: "", draft: m.draft }] : [];
}

function hasDraft(d?: Draft | null): boolean {
  return Boolean(d && ((d.our_bans ?? []).some(Boolean) || (d.enemy_bans ?? []).some(Boolean)
    || Object.values(d.our_picks ?? {}).some(Boolean) || Object.values(d.enemy_picks ?? {}).some(Boolean)));
}

/** Game numbers to offer: one per game in the score (BO3 2–0 → 1,2 · 2–1 → 1,2,3). */
function slotNumbers(m: TournamentMatchT): number[] {
  const played = m.score_us + m.score_them;
  const fallback = Math.min(Math.max(played, 1), m.max_games ?? 7);
  const saved = Math.max(0, ...seriesGames(m).map((g) => g.game_no));
  const n = Math.max(m.game_slots ?? fallback, saved);
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** Pre-fill a game's result when the score makes it certain (2–0 → all wins, 0–2 → all losses). */
function impliedResult(m: TournamentMatchT): "WIN" | "LOSS" | "" {
  if (m.status !== "played") return "";
  if (m.score_us > 0 && m.score_them === 0) return "WIN";
  if (m.score_them > 0 && m.score_us === 0) return "LOSS";
  return "";
}

function DraftForm({ tournament, match, gameNo, heroes, onSaved, onClose }: {
  tournament: Tournament; match: TournamentMatchT; gameNo: number; heroes: Hero[]; onSaved: () => void; onClose: () => void;
}) {
  const existing = seriesGames(match).find((g) => g.game_no === gameNo);
  const [draft, setDraft] = useState(() => ({ ...blankTDraft(), ...(existing?.draft ?? {}) }));
  const [result, setResult] = useState<"WIN" | "LOSS" | "">(existing?.result || impliedResult(match));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = slotNumbers(match).length;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.put(`/tournaments/matches/${match.id}/games/${gameNo}`, { draft, result });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally { setBusy(false); }
  }

  async function clear() {
    if (!confirm(`Clear the game ${gameNo} draft vs ${match.opponent}?`)) return;
    setBusy(true); setErr(null);
    try {
      await api.del(`/tournaments/matches/${match.id}/games/${gameNo}`);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Clear failed");
    } finally { setBusy(false); }
  }

  return (
    <Modal title={`Game ${gameNo}${total > 1 ? ` of ${total}` : ""} draft — vs ${match.opponent} (${tournament.name})`} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="label">Game {gameNo} result</span>
          {(["WIN", "LOSS", ""] as const).map((r) => (
            <button key={r || "none"} type="button" aria-pressed={result === r} onClick={() => setResult(r)}
              className={`chip !py-1 ${result === r
                ? r === "WIN" ? "text-leaf border-leaf/60 bg-leaf/10" : r === "LOSS" ? "text-danger border-danger/60 bg-danger/10" : "text-text border-edge-2 bg-raised"
                : "text-faint border-edge"}`}>
              {r === "WIN" ? "Win" : r === "LOSS" ? "Loss" : "Not set"}
            </button>
          ))}
        </div>
        <div className="card p-5">
          <DraftBoardEditor heroes={heroes} value={draft} onChange={(next) => setDraft(next as typeof draft)}
            theirsLabel={(match.opponent || "Enemy")} />
        </div>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          {existing && <button type="button" className="btn-ghost !text-danger mr-auto" disabled={busy} onClick={clear}><Trash2 size={13} /> Clear game {gameNo}</button>}
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>Save game {gameNo} draft</button>
        </div>
      </form>
    </Modal>
  );
}

/** Read-only series view: one tab per saved game draft. */
function SeriesDrafts({ match }: { match: TournamentMatchT }) {
  const games = seriesGames(match);
  const [active, setActive] = useState(games[0]?.game_no ?? 1);
  const game = games.find((g) => g.game_no === active) ?? games[0];
  if (!game) return null;
  return (
    <div className="mt-2 space-y-2">
      {games.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={`Drafts vs ${match.opponent}`}>
          {games.map((g) => (
            <button key={g.game_no} role="tab" aria-selected={g.game_no === game.game_no} onClick={() => setActive(g.game_no)}
              className={`chip !py-1 ${g.game_no === game.game_no ? "text-sky border-sky/60 bg-sky/10" : "text-mute border-edge"}`}>
              Game {g.game_no}
              {g.result && <span className={g.result === "WIN" ? "text-leaf" : "text-danger"}> · {g.result === "WIN" ? "W" : "L"}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="text-[11px] text-faint">
        Game {game.game_no}{game.result ? ` · ${game.result === "WIN" ? "Win" : "Loss"}` : ""}
      </div>
      <DraftBoard draft={game.draft} theirsLabel={(match.opponent || "Enemy")} />
    </div>
  );
}

const FILE_KIND_TO_EVID: Record<string, string> = { image: "screenshot", video: "video", pdf: "stats", file: "stats", link: "link" };
const EVID_ICON: Record<string, typeof Link2> = { screenshot: ImageIcon, video: Film, stats: FileText, link: Link2 };

function EvidenceForm({ match, onSaved, onClose }: {
  match: TournamentMatchT; onSaved: () => void; onClose: () => void;
}) {
  const [att, setAtt] = useState<{ kind: string; label: string; url: string }[]>(match.attachments);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.patch(`/tournaments/matches/${match.id}`, { attachments: att });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally { setBusy(false); }
  }

  return (
    <Modal title={`Evidence — vs ${match.opponent}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-[12px] text-mute leading-relaxed">
          Result screenshots, VOD clips, stat sheets — uploaded to our server, visible to the whole squad.
        </p>
        <FilePick
          items={att}
          onChange={(a) => setAtt(a.map((x) => ({ ...x, kind: FILE_KIND_TO_EVID[x.kind] ?? x.kind })))}
          hint="Same style as scrim evidence — screenshots/clips show inline afterwards."
        />
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>Save evidence ({att.length})</button>
        </div>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- //
// page
// --------------------------------------------------------------------------- //
export function TournamentsPage({ me, parts }: { me: User; meta: Meta; parts: string[] }) {
  const canManage = ["admin", "captain"].includes(me.role);
  const canReview = ["admin", "captain", "coach", "analyst"].includes(me.role);
  const [list, setList] = useState<Tournament[] | null>(null);
  const [queue, setQueue] = useState<TournamentMatchT[]>([]);
  const [detail, setDetail] = useState<Tournament | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [showT, setShowT] = useState<null | Partial<Tournament>>(null);
  const [showMatch, setShowMatch] = useState(false);
  const [editMatch, setEditMatch] = useState<null | TournamentMatchT>(null);
  const [showResult, setShowResult] = useState<null | TournamentMatchT>(null);
  const [showDraft, setShowDraft] = useState<null | { match: TournamentMatchT; game: number }>(null);
  const [showEvidence, setShowEvidence] = useState<null | TournamentMatchT>(null);
  const [draftOpen, setDraftOpen] = useState<number | null>(null);

  const id = parts[0] ? Number(parts[0]) : null;

  const load = useCallback(() => {
    api.get<Tournament[]>("/tournaments").then(setList).catch(() => setList([]));
    api.get<TournamentMatchT[]>("/tournaments/review-queue").then(setQueue).catch(() => setQueue([]));
    if (id) api.get<Tournament>(`/tournaments/${id}`).then(setDetail).catch(() => setDetail(null));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (id && canManage) api.get<Hero[]>("/heroes").then(setHeroes).catch(() => setHeroes([]));
  }, [id, canManage]);

  async function toggleReviewT(t: Tournament) {
    await api.patch(`/tournaments/${t.id}`, { review_queued: !t.review_queued });
    load();
  }
  async function toggleReviewM(m: TournamentMatchT) {
    await api.patch(`/tournaments/matches/${m.id}`, { review_queued: !m.review_queued });
    load();
  }

  // ------------------------------ detail ------------------------------ //
  if (id) {
    if (!detail) return <Spinner />;
    const t = detail;
    const matches = t.matches ?? [];
    const byStage = new Map<string, TournamentMatchT[]>();
    for (const m of matches) {
      const k = m.stage || "Matches";
      byStage.set(k, [...(byStage.get(k) ?? []), m]);
    }
    const stageOrder = [...byStage.keys()].sort((a, b) => {
      const da = byStage.get(a)![0].scheduled_date ?? "9999";
      const dbb = byStage.get(b)![0].scheduled_date ?? "9999";
      return da.localeCompare(dbb) || a.localeCompare(b);
    });
    return (
      <div className="space-y-6">
        <button className="label !text-crim" onClick={() => navigate("tournaments")}>← Tournaments</button>
        <PageTitle title={t.name}
          sub={`${t.status}${t.start_date ? ` · ${dayLabel(t.start_date)}${t.end_date ? ` → ${dayLabel(t.end_date)}` : ""}` : ""}`}
          right={canManage && (
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setShowT(t)}><Pencil size={14} /> Edit</button>
              <button className="btn-primary" onClick={() => setShowMatch(true)}><Plus size={15} /> Match</button>
            </div>
          )} />

        {/* stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatTile label="Matches" value={`${t.played_count}/${t.match_count}`} hint="played" />
          <StatTile label="Series W–L" value={`${t.wins}–${t.losses}`} tone={t.wins > t.losses ? "good" : t.losses > t.wins ? "bad" : undefined} />
          <StatTile label="Stages" value={String(t.stages.length || (matches.length ? 1 : 0))} hint={t.stages[0] ?? "—"} />
          <StatTile label="Reviews" value={String(t.review_pending)} hint="pending"
            tone={t.review_pending > 0 ? "accent" : "good"} />
        </div>

        {/* tournament-level review flag */}
        <div className="card p-3.5 flex flex-wrap items-center gap-3">
          <ClipboardList size={15} className={t.review_queued ? "text-leaf" : "text-faint"} />
          <div className="flex-1 min-w-40">
            <div className="text-[13px] font-bold">{t.review_queued ? "Set for review" : "History only"}</div>
            <div className="text-[11px] text-faint">
              {t.review_queued ? "Played matches can enter the match-review flow." : "No review workflow — logged for history."}
            </div>
          </div>
          {canManage && (
            <button className={`chip ${t.review_queued ? "border-leaf/50 text-leaf" : "text-mute"}`} onClick={() => toggleReviewT(t)}>
              {t.review_queued ? "Review: on" : "Review: off"}
            </button>
          )}
        </div>

        {t.notes && <p className="text-[13px] text-text/80 leading-relaxed max-w-3xl">{t.notes}</p>}

        {/* schedule by stage */}
        {stageOrder.length === 0 && (
          <Empty title="No matches scheduled" hint={canManage ? "Add the first match day" : "Staff will schedule the bracket"} />
        )}
        {stageOrder.map((stage) => {
          const ms = byStage.get(stage)!;
          return (
            <section key={stage}>
              <SectionTitle>{stage} <span className="text-mute normal-case">· {ms.length} {ms.length === 1 ? "match" : "matches"}</span></SectionTitle>
              <div className="space-y-2">
                {ms.map((m) => (
                  <div key={m.id} className="card p-3.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="chip !text-[9px] text-mute border-edge-2 w-10 justify-center shrink-0">M{m.match_no}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold truncate">
                          vs {m.opponent}
                          {m.status === "played" && m.result && (
                            <span className={`ml-2 text-[11px] font-extrabold ${m.result === "WIN" ? "text-leaf" : m.result === "LOSS" ? "text-crim" : "text-amber"}`}>
                              {nice(m.result)} {m.score_us}–{m.score_them}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-faint mt-0.5">
                          {m.scheduled_date ? dayLabel(m.scheduled_date) : "TBD"}{m.start_time ? ` ${fmtTime(m.start_time)}` : ""} · {m.format}
                        </div>
                      </div>
                      <Badge cls={m.status === "played" ? "text-leaf border-leaf/40" : m.status === "cancelled" ? "text-mute" : "text-sky border-sky/40"}>{m.status}</Badge>
                      {m.has_review && (
                        <button className="chip !py-1 text-leaf border-leaf/40" onClick={() => navigate("reviews", m.review_id!)}>
                          <ClipboardList size={11} /> Review
                        </button>
                      )}
                      {!m.has_review && m.review_queued && m.status === "played" && canReview && (
                        <button className="chip !py-1 text-amber border-amber/50 bg-amber/10"
                          onClick={() => navigate("reviews", "new", `tmatch=${m.id}`)}>
                          ⚠ Review pending — start
                        </button>
                      )}
                      {!m.has_review && m.review_queued && m.status === "played" && !canReview && (
                        <span className="chip !py-1 text-amber border-amber/40">⚠ Review pending</span>
                      )}
                    </div>
                    {m.notes && <div className="text-[12px] text-mute mt-2 whitespace-pre-wrap">{m.notes}</div>}

                    {/* evidence thumbnails */}
                    {m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {m.attachments.map((a, i) => {
                          const Icon = EVID_ICON[a.kind] ?? Link2;
                          return a.kind === "screenshot" ? (
                            <a key={i} href={a.url} target="_blank" rel="noreferrer" title={a.label}>
                              <img src={a.url} alt={a.label} className="h-9 w-13 rounded border border-edge object-cover hover:border-crim/50 transition" />
                            </a>
                          ) : (
                            <a key={i} href={a.url} target="_blank" rel="noreferrer" className="chip !py-0.5 !text-[9px] text-sky border-sky/40 hover:bg-sky/10">
                              <Icon size={10} /> {a.label.length > 20 ? a.label.slice(0, 18) + "…" : a.label}
                            </a>
                          );
                        })}
                      </div>
                    )}

                    {/* actions */}
                    {canManage && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5 border-t border-edge/60 pt-2.5">
                        <button className="btn-ghost !py-1 !px-2.5 !text-[11px]" onClick={() => setShowResult(m)}>
                          {m.status === "played" ? "Edit result" : "Record result"}
                        </button>
                        <button className="btn-ghost !py-1 !px-2.5 !text-[11px]" onClick={() => setEditMatch(m)}>Edit match</button>
                        {slotNumbers(m).map((no) => {
                          const saved = seriesGames(m).some((g) => g.game_no === no);
                          const many = slotNumbers(m).length > 1;
                          return (
                            <button key={no} className={`btn-ghost !py-1 !px-2.5 !text-[11px] ${saved ? "!text-sky" : ""}`}
                              onClick={() => setShowDraft({ match: m, game: no })}
                              title={saved ? `Edit the game ${no} draft` : `Add the game ${no} draft`}>
                              {saved ? `Edit ${many ? `G${no} ` : ""}draft` : many ? `+ G${no} draft` : "+ Draft"}
                            </button>
                          );
                        })}
                        <button className="btn-ghost !py-1 !px-2.5 !text-[11px]" onClick={() => setShowEvidence(m)}>
                          Evidence ({m.attachments.length})
                        </button>
                        <button className={`btn-ghost !py-1 !px-2.5 !text-[11px] ${m.review_queued ? "!text-leaf" : "!text-faint"}`}
                          onClick={() => toggleReviewM(m)} title="Review flag for this match">
                          {m.review_queued ? "Review ✓" : "Review ·"}
                        </button>
                        <button className="btn-ghost !py-1 !px-2.5 !text-[11px] !text-crim ml-auto" title="Delete match"
                          onClick={async () => { if (confirm(`Delete M${m.match_no} vs ${m.opponent}?`)) { await api.del(`/tournaments/matches/${m.id}`); load(); } }}>
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}

                    {/* draft display */}
                    {seriesGames(m).length > 0 && (
                      <div className="mt-2.5">
                        <button className="label !text-sky" onClick={() => setDraftOpen(draftOpen === m.id ? null : m.id)}>
                          {(() => {
                            const n = seriesGames(m).length;
                            const what = n > 1 ? `${n} drafts` : "draft";
                            return draftOpen === m.id ? `Hide ${what} ▲` : `Show ${what} ▼`;
                          })()}
                        </button>
                        {draftOpen === m.id && <SeriesDrafts key={`${m.id}-${seriesGames(m).length}`} match={m} />}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {canManage && (
          <button className="btn-ghost w-full" onClick={() => setShowMatch(true)}><Plus size={15} /> Schedule a match / stage</button>
        )}
        {canManage && (
          <button className="btn-ghost !text-crim" onClick={async () => {
            if (confirm(`Delete "${t.name}" with all its matches?`)) { await api.del(`/tournaments/${t.id}`); navigate("tournaments"); }
          }}><Trash2 size={13} /> Delete tournament</button>
        )}

        {showT && <TournamentForm initial={showT} onClose={() => setShowT(null)} onSaved={() => { setShowT(null); load(); }} />}
        {showMatch && <AddMatchForm tournament={t} onClose={() => setShowMatch(false)} onSaved={() => { setShowMatch(false); load(); }} />}
        {editMatch && <AddMatchForm tournament={t} initial={editMatch} onClose={() => setEditMatch(null)} onSaved={() => { setEditMatch(null); load(); }} />}
        {showResult && <ResultForm match={showResult} onClose={() => setShowResult(null)} onSaved={() => { setShowResult(null); load(); }} />}
        {showDraft && <DraftForm key={`${showDraft.match.id}-${showDraft.game}`} tournament={t} match={showDraft.match} gameNo={showDraft.game} heroes={heroes}
          onClose={() => setShowDraft(null)} onSaved={() => { setDraftOpen(showDraft.match.id); setShowDraft(null); load(); }} />}
        {showEvidence && <EvidenceForm match={showEvidence} onClose={() => setShowEvidence(null)} onSaved={() => { setShowEvidence(null); load(); }} />}
      </div>
    );
  }

  // ------------------------------ list ------------------------------ //
  return (
    <div className="space-y-6">
      <PageTitle title="Tournaments" sub="Competitions with their own schedule, drafts, results and reviews."
        right={canManage && <button className="btn-primary" onClick={() => setShowT({})}><Plus size={15} /> Tournament</button>} />

      {/* review queue */}
      {queue.length > 0 && (
        <section className="card border-amber/40 p-4 space-y-2">
          <div className="section-pill">Review queue ({queue.length})</div>
          {queue.map((m) => (
            <div key={m.id} className="flex items-center gap-3 flex-wrap rounded-lg border border-edge bg-raised/40 px-3 py-2">
              <Trophy size={13} className="text-amber shrink-0" />
              <div className="flex-1 min-w-0 text-[13px] font-bold truncate">
                {m.tournament_name} · {m.stage || "Match"} — vs {m.opponent}
                <span className={`ml-2 text-[11px] font-extrabold ${m.result === "WIN" ? "text-leaf" : "text-crim"}`}>{nice(m.result)} {m.score_us}–{m.score_them}</span>
              </div>
              {canReview ? (
                <button className="chip !py-1 text-amber border-amber/50" onClick={() => navigate("reviews", "new", `tmatch=${m.id}`)}>
                  Start review
                </button>
              ) : (
                <span className="chip !py-1 text-faint">awaiting staff</span>
              )}
              <button className="chip !py-1 text-mute" onClick={() => navigate("tournaments", m.tournament_id!)}>Open</button>
            </div>
          ))}
        </section>
      )}

      {!list && <Spinner />}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {(list ?? []).map((t) => (
          <button key={t.id} className="card card-hover p-4 text-left" onClick={() => navigate("tournaments", t.id)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[15px] font-extrabold truncate"><Trophy size={13} className="inline -mt-0.5 mr-1 text-amber" />{t.name}</div>
                <div className="text-[11px] text-faint mt-0.5">
                  {t.start_date ? dayLabel(t.start_date) : "TBD"}{t.end_date ? ` → ${dayLabel(t.end_date)}` : ""}
                </div>
              </div>
              <Badge cls={t.status === "ongoing" ? "text-leaf border-leaf/40" : t.status === "finished" ? "text-mute" : "text-sky border-sky/40"}>{t.status}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div><div className="text-lg font-extrabold tabular-nums">{t.played_count}/{t.match_count}</div><div className="label !text-[9px]">played</div></div>
              <div><div className={`text-lg font-extrabold tabular-nums ${t.wins > t.losses ? "text-leaf" : t.losses > t.wins ? "text-crim" : ""}`}>{t.wins}–{t.losses}</div><div className="label !text-[9px]">series</div></div>
              <div><div className={`text-lg font-extrabold tabular-nums ${t.review_pending ? "text-amber" : ""}`}>{t.review_pending}</div><div className="label !text-[9px]">reviews</div></div>
            </div>
            {t.review_queued && <div className="mt-2.5 text-[10px] font-bold text-leaf flex items-center gap-1"><ClipboardList size={11} /> in review flow</div>}
          </button>
        ))}
      </div>
      {list && list.length === 0 && (
        <Empty title="No tournaments yet" hint={canManage ? "Create the first one and schedule its matches" : "Staff will add competitions here"} />
      )}

      {showT && <TournamentForm initial={showT} onClose={() => setShowT(null)} onSaved={() => { setShowT(null); load(); }} />}
    </div>
  );
}
