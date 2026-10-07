import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { DevEntry, Hero, Meta, PlayerDetail, PoolEntry, User, PlayerProgress } from "../lib/types";
import { dayLabel, navigate, pct, ResultBadge } from "../lib/util";
import { Empty, ErrorNote, Field, Modal, PageTitle, Progress, SectionTitle, Spinner, StatTile } from "../components/ui";
import { AvatarImg } from "../components/Avatar";
import { HeroImg } from "../components/HeroImg";

const POOL_LABEL: Record<string, string> = { comfort: "Comfort picks", meta: "Meta picks", pocket: "Pocket picks", emergency: "Emergency picks" };
const POOL_ORDER = ["comfort", "meta", "pocket", "emergency"];

function Confidence({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5" title={`Confidence ${value}/10`}>
      {Array.from({ length: 10 }).map((_, i) => (
        <span key={i} className={`h-1 w-2.5 rounded-full ${i < value ? "bg-crim" : "bg-raised border border-edge/60"}`} />
      ))}
    </div>
  );
}

function PoolForm({ playerId, heroes, meta, initial, onSaved, onClose }: {
  playerId: number; heroes: Hero[]; meta: Meta; initial?: PoolEntry | null; onSaved: () => void; onClose: () => void;
}) {
  const edit = Boolean(initial?.id);
  const [f, setF] = useState<Record<string, string>>(initial ? {
    hero_id: String(initial.hero_id), category: initial.category, confidence: String(initial.confidence),
    games: String(initial.games || ""), wins: String(initial.wins || ""), losses: String(initial.losses || ""),
    coach_notes: initial.coach_notes,
  } : { hero_id: "", category: "comfort", confidence: "7", games: "", wins: "", losses: "", coach_notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const body = {
        category: f.category, confidence: Number(f.confidence),
        games: Number(f.games) || 0, wins: Number(f.wins) || 0, losses: Number(f.losses) || 0,
        coach_notes: f.coach_notes,
      };
      if (edit) await api.patch(`/players/pool/${initial!.id}`, body);
      else await api.post(`/players/${playerId}/pool`, { ...body, hero_id: Number(f.hero_id) });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }
  return (
    <Modal title={edit ? `Edit pool entry — ${initial!.hero_name}` : "Add hero to pool"} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Hero">
          <select className="input" required disabled={edit} value={f.hero_id} onChange={(e) => set("hero_id", e.target.value)}>
            <option value="">Pick a hero…</option>
            {heroes.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.role})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <select className="input" value={f.category} onChange={(e) => set("category", e.target.value)}>
              {meta.pool_categories.map((c) => <option key={c} value={c}>{POOL_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field label="Confidence 0-10"><input className="input" type="number" min={0} max={10} value={f.confidence} onChange={(e) => set("confidence", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Games"><input className="input" inputMode="numeric" value={f.games} onChange={(e) => set("games", e.target.value)} /></Field>
          <Field label="Wins"><input className="input" inputMode="numeric" value={f.wins} onChange={(e) => set("wins", e.target.value)} /></Field>
          <Field label="Losses"><input className="input" inputMode="numeric" value={f.losses} onChange={(e) => set("losses", e.target.value)} /></Field>
        </div>
        <Field label="Coach notes (staff only)"><input className="input" value={f.coach_notes} onChange={(e) => set("coach_notes", e.target.value)} /></Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary">{edit ? "Save changes" : "Add to pool"}</button>
        </div>
      </form>
    </Modal>
  );
}

function DevForm({ player, me, meta, initial, onSaved, onClose }: {
  player: PlayerDetail; me: User; meta: Meta; initial?: DevEntry | null; onSaved: () => void; onClose: () => void;
}) {
  const edit = Boolean(initial?.id);
  const isSelf = me.id === player.id;
  const source = initial?.source ?? (isSelf && !["coach", "admin"].includes(me.role) ? "self" : "coach");
  const [f, setF] = useState<Record<string, string>>(initial
    ? { category: initial.category, rating: initial.rating != null ? String(initial.rating) : "", notes: initial.notes }
    : { category: "GENERAL", rating: "7", notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const body = { category: f.category, rating: f.rating === "" ? null : Number(f.rating), notes: f.notes };
      if (edit) await api.patch(`/players/development/${initial!.id}`, body);
      else await api.post(`/players/${player.id}/development`, { ...body, source });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }
  return (
    <Modal title={edit ? "Edit entry" : source === "self" ? "Submit self-review" : `Rate ${player.ign}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <select className="input" value={f.category} onChange={(e) => set("category", e.target.value)}>
              {meta.dev_categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label={source === "self" ? "Self rating 0-10" : "Rating 0-10"}>
            <input className="input" type="number" min={0} max={10} value={f.rating} onChange={(e) => set("rating", e.target.value)} />
          </Field>
        </div>
        <Field label={source === "self" ? "Honest self-review" : "Coach notes"}>
          <textarea className="input min-h-28" required value={f.notes} onChange={(e) => set("notes", e.target.value)}
            placeholder={source === "self" ? "What went well, what didn't, what you'll change." : "Observation, evidence, next step."} />
        </Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary">{edit ? "Save changes" : "Submit"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export function PlayersPage({ me, meta, parts }: { me: User; meta: Meta; parts: string[] }) {
  const [roster, setRoster] = useState<User[] | null>(null);
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [showPool, setShowPool] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const [editPool, setEditPool] = useState<null | PoolEntry>(null);
  const [editDev, setEditDev] = useState<null | DevEntry>(null);
  const id = parts[0] ? Number(parts[0]) : null;

  const load = useCallback(() => {
    api.get<User[]>("/players").then(setRoster).catch(() => setRoster([]));
    api.get<Hero[]>("/heroes").then(setHeroes).catch(() => setHeroes([]));
    if (id) api.get<PlayerDetail>(`/players/${id}`).then(setDetail).catch(() => setDetail(null));
  }, [id]);
  useEffect(load, [load]);

  if (id) {
    if (!detail) return <Spinner />;
    const p = detail;
    const stats = p.scrim_stats;
    const canEditPool = p.can_rate || p.is_self;
    return (
      <div className="space-y-6">
        <button className="label !text-crim" onClick={() => navigate("players")}>← Roster</button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-4">
            <AvatarImg user={p} size={56} />
            <div>
              <div className="text-xl font-extrabold">{p.ign}</div>
              <div className="text-[13px] text-mute">{p.name} · {p.main_role || p.role_label}{p.role === "captain" ? " · Captain" : ""}</div>
            </div>
          </div>
          <div className="flex gap-2">
            {p.is_self && <button className="btn-leaf" onClick={() => setShowDev(true)}><Star size={14} /> Self-review</button>}
            {p.can_rate && !p.is_self && <button className="btn-primary" onClick={() => setShowDev(true)}><Star size={14} /> Rate player</button>}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <StatTile label="Series" value={stats.series_played} hint={`${stats.series_won}W – ${stats.series_lost}L`} />
          <StatTile label="Series win" value={pct(stats.win_rate)} tone={(stats.win_rate ?? 0) >= 50 ? "good" : "bad"} />
          <StatTile label="Coach rating" value={p.avg_rating != null ? `${p.avg_rating}/10` : "—"} tone="accent" />
          <StatTile label="Pool size" value={Object.values(p.pool).flat().length} />
          <div className="card px-3.5 py-3">
            <div className="label mb-1.5">Recent form</div>
            <div className="flex gap-1 mt-1">
              {stats.form.length === 0 && <span className="text-faint text-sm">—</span>}
              {stats.form.map((r, i) => <ResultBadge key={i} result={r} />)}
            </div>
          </div>
        </div>

        <ProgressPanel userId={p.id} ign={p.ign} />

        {/* Hero pool */}
        <section>
          <SectionTitle right={canEditPool && <button className="btn-ghost !py-1.5 !text-[12px]" onClick={() => setShowPool(true)}><Plus size={13} /> Add hero</button>}>
            Hero pool · {p.ign}
          </SectionTitle>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {POOL_ORDER.map((cat) => (
              <div key={cat} className="card p-3.5">
                <div className="label mb-2.5">{POOL_LABEL[cat]}</div>
                <div className="space-y-2.5">
                  {(p.pool[cat] ?? []).map((e: PoolEntry) => (
                    <div key={e.id} className="bg-raised border border-edge/60 rounded-lg p-3">
                      <div className="flex items-center gap-2.5">
                        <HeroImg name={e.hero_name} size={36} className="rounded-md shrink-0" />
                        <div className="min-w-0 flex-1">
                          <button className="text-sm font-bold hover:text-crim leading-tight truncate" onClick={() => navigate("heroes", e.hero_id)}>{e.hero_name}</button>
                          <div className="text-[10px] text-faint">{e.hero_status}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <Confidence value={e.confidence} />
                        <span className="text-[10px] text-mute tabular-nums">{e.games}g{e.win_rate != null ? ` · ${e.win_rate}%` : ""}</span>
                      </div>
                      {e.coach_notes && <div className="text-[10.5px] text-amber/90 mt-1.5 italic">{e.coach_notes}</div>}
                      {e.last_played && <div className="text-[9.5px] text-faint mt-1">last played {dayLabel(e.last_played)}</div>}
                      {canEditPool && (
                        <div className="flex gap-2 mt-1">
                          <button className="text-faint hover:text-crim" title="Edit entry" onClick={() => setEditPool(e)}><Pencil size={12} /></button>
                          <button className="text-faint hover:text-crim" title="Remove" onClick={async () => { if (confirm(`Remove ${e.hero_name} from ${cat}?`)) { await api.del(`/players/pool/${e.id}`); load(); } }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {(p.pool[cat] ?? []).length === 0 && <div className="text-[12px] text-faint">—</div>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Development */}
        <section>
          <SectionTitle>Development tracker</SectionTitle>
          <div className="space-y-2">
            {p.development.length === 0 && <Empty title="No entries yet" />}
            {p.development.map((d: DevEntry) => (
              <div key={d.id} className="card p-3.5 flex items-start gap-3">
                <span className={`chip !text-[9px] uppercase shrink-0 mt-0.5 ${d.source === "self" ? "text-sky border-sky/40 bg-sky/10" : "text-crim border-crim/40 bg-crim-dim/40"}`}>
                  {d.source === "self" ? "Self" : "Coach"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
                    <span className="font-bold text-mute">{d.category}</span>
                    <span>{dayLabel(d.date)}</span>
                    {d.created_by_name && <span>by {d.created_by_name}</span>}
                  </div>
                  <p className="text-[13px] text-text/90 mt-1 leading-relaxed">{d.notes}</p>
                </div>
                {d.rating != null && (
                  <div className="text-right shrink-0">
                    <div className="text-lg font-extrabold text-amber tabular-nums">{d.rating}</div>
                    <div className="label !text-[8.5px]">/ 10</div>
                  </div>
                )}
                {(p.can_rate || (d.source === "self" && d.created_by === me.id)) && (
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button className="text-faint hover:text-crim" title="Edit" onClick={() => setEditDev(d)}><Pencil size={13} /></button>
                    <button className="text-faint hover:text-crim" title="Delete"
                      onClick={async () => { if (confirm("Delete this entry?")) { await api.del(`/players/development/${d.id}`); load(); } }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {showPool && <PoolForm playerId={p.id} heroes={heroes} meta={meta} onClose={() => setShowPool(false)} onSaved={() => { setShowPool(false); load(); }} />}
        {editPool && <PoolForm playerId={p.id} heroes={heroes} meta={meta} initial={editPool} onClose={() => setEditPool(null)} onSaved={() => { setEditPool(null); load(); }} />}
        {showDev && <DevForm player={p} me={me} meta={meta} onClose={() => setShowDev(false)} onSaved={() => { setShowDev(false); load(); }} />}
        {editDev && <DevForm player={p} me={me} meta={meta} initial={editDev} onClose={() => setEditDev(null)} onSaved={() => { setEditDev(null); load(); }} />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageTitle title="Players" sub="Roster, hero pools, form and individual development." />
      {!roster && <Spinner />}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(roster ?? []).map((p) => (
          <button key={p.id} onClick={() => navigate("players", p.id)} className="card card-hover p-4 text-left">
            <div className="flex items-center gap-3">
              <AvatarImg user={p} size={44} />
              <div className="flex-1 min-w-0">
                <div className="font-extrabold truncate">{p.ign}
                  {p.role === "captain" && <span className="text-amber text-[10px] font-bold"> · C</span>}
                </div>
                <div className="text-[11px] text-faint">{p.main_role || p.role_label}</div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3.5 text-[11.5px] text-mute">
              <span className="tabular-nums">{(p as unknown as { scrim_stats: { series_won: number; series_lost: number } }).scrim_stats.series_won}W – {(p as unknown as { scrim_stats: { series_lost: number } }).scrim_stats.series_lost}L series</span>
              <span>Avg confidence {(p as unknown as { avg_confidence: number | null }).avg_confidence ?? "—"}</span>
            </div>
          </button>
        ))}
        {roster && roster.length === 0 && <Empty title="No roster members yet" />}
      </div>
    </div>
  );
}

function ProgressPanel({ userId, ign }: { userId: number; ign: string }) {
  const [prog, setProg] = useState<PlayerProgress | null>(null);
  useEffect(() => {
    api.get<PlayerProgress>(`/players/${userId}/progress`).then(setProg).catch(() => setProg(null));
  }, [userId]);
  if (!prog) return null;

  const weeks = prog.scrim_trend;
  const maxGames = Math.max(1, ...weeks.map((w) => w.games));
  const ratings = prog.rating_trend.filter((r) => r.rating != null).slice(-20);
  const rMin = ratings.length ? Math.min(...ratings.map((r) => r.rating)) : 0;
  const rMax = ratings.length ? Math.max(...ratings.map((r) => r.rating)) : 10;
  const span = Math.max(1, rMax - rMin);
  const spark = ratings.map((r, i) => `${(i / Math.max(1, ratings.length - 1)) * 100},${22 - ((r.rating - rMin) / span) * 20}`).join(" ");

  return (
    <section>
      <SectionTitle>Progress · {ign.toUpperCase()}</SectionTitle>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="card p-4 col-span-1 sm:col-span-2">
          <div className="flex items-baseline justify-between mb-2.5">
            <span className="label !mb-0">Scrim win rate · last 12 weeks</span>
            <span className="text-[10px] text-faint">{weeks.reduce((a, w) => a + w.games, 0)} games</span>
          </div>
          <div className="flex items-end gap-1 h-16">
            {weeks.length === 0 && <span className="text-faint text-sm self-center">No scrims recorded yet</span>}
            {weeks.map((w, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5"
                title={`W${w.week}: ${w.wins}/${w.games} won (${w.win_rate}%)`}>
                <div className="text-[8px] font-bold tabular-nums text-faint">{w.games ? `${w.win_rate}%` : ""}</div>
                <div
                  className={`w-full rounded-sm ${!w.games ? "bg-edge/50" : w.win_rate >= 60 ? "bg-leaf/80" : w.win_rate >= 45 ? "bg-amber/70" : "bg-crim/80"}`}
                  style={{ height: `${Math.max(6, (w.games / maxGames) * 42)}px` }}
                />
                <div className="text-[7.5px] text-faint">{w.games ? w.week.slice(1) : ""}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="label !mb-2">Dev rating trend</div>
          {ratings.length < 2 ? (
            <div className="text-faint text-sm pt-4 text-center">{ratings.length ? "1 entry so far" : "No ratings yet"}</div>
          ) : (
            <>
              <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="w-full h-14">
                <polyline points={spark} fill="none" stroke="#e11d48" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="flex justify-between text-[10px] text-faint">
                <span>{ratings[0].date.slice(5)}</span>
                <span className="text-amber font-extrabold">{ratings[ratings.length - 1].rating}/10 latest</span>
                <span>{ratings[ratings.length - 1].date.slice(5)}</span>
              </div>
            </>
          )}
        </div>

        <div className="card p-4">
          <div className="label !mb-2">Meta readiness</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-extrabold text-leaf tabular-nums">{prog.meta_ready_picks}</span>
            <span className="text-[11px] text-mute">heroes meta-ready</span>
          </div>
          <div className="text-[11px] text-faint mt-2 leading-relaxed">
            Pool breadth {prog.pool.breadth} · avg confidence {prog.pool.avg_confidence ?? "—"}
          </div>
          {prog.pool.recorded_win_rate != null && (
            <div className="mt-1.5">
              <Progress value={prog.pool.recorded_win_rate} tone="leaf" />
              <div className="text-[10px] text-faint mt-1">
                {prog.pool.recorded_win_rate}% WR across {prog.pool.recorded_games} ranked/scrim games
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
