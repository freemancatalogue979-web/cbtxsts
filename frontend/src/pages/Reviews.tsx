import { AlertTriangle, FileText, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Meta, Review, Scrim, User } from "../lib/types";
import { dayLabel, navigate, REVIEW_STATUS_STYLE } from "../lib/util";
import { Badge, Empty, ErrorNote, Field, PageTitle, SectionTitle, Spinner, Tabs } from "../components/ui";
import { DraftBoard } from "../components/DraftBoard";

const STAT_FIELDS: [string, string][] = [
  ["kills", "Kills"], ["deaths", "Deaths"], ["gold", "Gold"], ["turrets", "Turrets"],
  ["turtles", "Turtle"], ["lords", "Lord"], ["teamfights", "Team fights"], ["damage", "Damage"],
  ["damage_taken", "Damage taken"], ["objectives", "Objectives"],
];

function emptyDraft() {
  return { our_bans: ["", "", "", "", ""], enemy_bans: ["", "", "", "", ""], our_picks: {} as Record<string, string>, enemy_picks: {} as Record<string, string> };
}

function ReviewForm({ meta, users, initial, scrim, onSaved, onClose }: {
  meta: Meta; users: User[]; initial: Partial<Review>; scrim: Scrim | null;
  onSaved: (id: number) => void; onClose: () => void;
}) {
  const edit = Boolean(initial.id);
  const [f, setF] = useState<Record<string, unknown>>(() => ({
    opponent: initial.opponent ?? scrim?.opponent ?? "",
    date: initial.date ?? scrim?.date ?? "",
    duration_min: initial.duration_min ?? "",
    result: initial.result ?? scrim?.result ?? "LOSS",
    player_ids: initial.player_ids ?? Object.values(scrim?.lineup ?? {}).filter(Boolean) ?? [],
    stats: initial.stats ?? {},
    draft: initial.draft?.our_picks ? { ...emptyDraft(), ...initial.draft } : emptyDraft(),
    biggest_mistakes: initial.biggest_mistakes?.length ? initial.biggest_mistakes : ["", "", ""],
    why_happened: initial.why_happened ?? "",
    should_have_done: initial.should_have_done ?? "",
    who_involved: initial.who_involved ?? "",
    what_change: initial.what_change ?? "",
    lesson: initial.lesson ?? "",
    action_item: initial.action_item ?? "",
    action_assignee_id: initial.action_assignee_id ?? "",
    action_deadline: initial.action_deadline ?? "",
    status: initial.status ?? "open",
  }));
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const draft = f.draft as ReturnType<typeof emptyDraft>;

  function setDraft(side: "our_bans" | "enemy_bans", idx: number, v: string) {
    const arr = [...draft[side]];
    arr[idx] = v;
    set("draft", { ...draft, [side]: arr });
  }
  function setPick(side: "our_picks" | "enemy_picks", lane: string, v: string) {
    set("draft", { ...draft, [side]: { ...draft[side], [lane]: v } });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = {
      ...f,
      date: f.date || null,
      duration_min: Number(f.duration_min) || 0,
      action_assignee_id: f.action_assignee_id === "" ? null : Number(f.action_assignee_id),
      action_deadline: f.action_deadline || null,
      stats: Object.fromEntries(Object.entries(f.stats as Record<string, string>).filter(([, v]) => String(v).trim() !== "")),
    };
    try {
      let id: number;
      if (edit) {
        const r = await api.patch<Review>(`/reviews/${initial.id}`, body);
        id = r.id;
      } else {
        const r = await api.post<Review>("/reviews", { ...body, scrim_id: scrim?.id ?? null });
        id = r.id;
      }
      onSaved(id);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  const laneRow = (lane: string) => (
    <div key={lane} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <input className="input !px-2 text-right" value={draft.our_picks[lane] ?? ""} onChange={(e) => setPick("our_picks", lane, e.target.value)} placeholder="hero" />
      <span className="label w-14 text-center">{lane}</span>
      <input className="input !px-2" value={draft.enemy_picks[lane] ?? ""} onChange={(e) => setPick("enemy_picks", lane, e.target.value)} placeholder="hero" />
    </div>
  );

  return (
    <form onSubmit={save} className="space-y-6">
      {scrim && (
        <div className="card border-crim/40 bg-crim-dim/20 p-3.5 text-[13px]">
          Filing review for <b>Scrim #{scrim.number} vs {scrim.opponent}</b> — {dayLabel(scrim.date)}.{" "}
          {scrim.result === "LOSS" ? <span className="text-amber font-bold">Mandatory: this loss blocks new scrims until filed.</span> : null}
        </div>
      )}

      <div className="grid sm:grid-cols-4 gap-4">
        <Field label="Opponent"><input className="input" required value={String(f.opponent)} onChange={(e) => set("opponent", e.target.value)} /></Field>
        <Field label="Date"><input className="input" type="date" value={String(f.date)} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Duration (min)"><input className="input" inputMode="decimal" value={String(f.duration_min)} onChange={(e) => set("duration_min", e.target.value)} /></Field>
        <Field label="Result">
          <select className="input" value={String(f.result)} onChange={(e) => set("result", e.target.value)}>
            <option>LOSS</option><option>WIN</option><option>DRAW</option>
          </select>
        </Field>
      </div>

      {/* Draft */}
      <section className="card p-4">
        <div className="label mb-3">Draft</div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {(["our_bans", "enemy_bans"] as const).map((side) => (
            <div key={side}>
              <div className={`label mb-1.5 ${side === "our_bans" ? "text-leaf/80" : "text-crim/80"}`}>{side === "our_bans" ? "Our bans" : "Enemy bans"}</div>
              <div className="space-y-1.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-faint text-[10px] font-bold w-3">{i + 1}.</span>
                    <input className="input !py-1.5 !px-2" value={draft[side][i] ?? ""} onChange={(e) => setDraft(side, i, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-1.5">
          <span className="label text-right text-leaf/80">9 CLOVER</span><span className="label w-14 text-center">Lane</span><span className="label text-crim/80">Enemy</span>
        </div>
        <div className="space-y-1.5">{meta.lanes.map(laneRow)}</div>
      </section>

      {/* Stats */}
      <section className="card p-4">
        <div className="label mb-3">Match statistics</div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
          {STAT_FIELDS.map(([k, label]) => (
            <label key={k} className="block">
              <span className="label block mb-1">{label}</span>
              <input className="input !px-2" value={String((f.stats as Record<string, string | number>)[k] ?? "")}
                onChange={(e) => set("stats", { ...(f.stats as object), [k]: e.target.value })} />
            </label>
          ))}
        </div>
      </section>

      {/* Mistakes */}
      <section className="card p-4">
        <div className="label mb-3">Biggest mistakes</div>
        <div className="space-y-2">
          {(f.biggest_mistakes as string[]).map((m, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-crim font-extrabold text-sm w-4 pt-2">#{i + 1}</span>
              <textarea className="input min-h-14" value={m}
                onChange={(e) => set("biggest_mistakes", (f.biggest_mistakes as string[]).map((x, j) => (j === i ? e.target.value : x)))} />
            </div>
          ))}
        </div>
      </section>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Why did it happen?"><textarea className="input min-h-24" value={String(f.why_happened)} onChange={(e) => set("why_happened", e.target.value)} /></Field>
        <Field label="What should we have done?"><textarea className="input min-h-24" value={String(f.should_have_done)} onChange={(e) => set("should_have_done", e.target.value)} /></Field>
        <Field label="Who was involved?"><textarea className="input min-h-16" value={String(f.who_involved)} onChange={(e) => set("who_involved", e.target.value)} /></Field>
        <Field label="What will we change?"><textarea className="input min-h-16" value={String(f.what_change)} onChange={(e) => set("what_change", e.target.value)} /></Field>
      </div>

      <Field label="Lesson from this game">
        <textarea className="input min-h-20 border-leaf/30" value={String(f.lesson)} onChange={(e) => set("lesson", e.target.value)}
          placeholder="One sentence the whole squad remembers." />
      </Field>

      <section className="card p-4">
        <div className="label mb-3">Action item</div>
        <Field label="Action"><textarea className="input min-h-16" value={String(f.action_item)} onChange={(e) => set("action_item", e.target.value)} /></Field>
        <div className="grid grid-cols-3 gap-4 mt-3">
          <Field label="Assigned to">
            <select className="input" value={String(f.action_assignee_id)} onChange={(e) => set("action_assignee_id", e.target.value)}>
              <option value="">—</option>
              {users.filter((u) => u.roster).map((u) => <option key={u.id} value={u.id}>{u.ign}</option>)}
            </select>
          </Field>
          <Field label="Deadline"><input className="input" type="date" value={String(f.action_deadline)} onChange={(e) => set("action_deadline", e.target.value)} /></Field>
          <Field label="Status">
            <select className="input" value={String(f.status)} onChange={(e) => set("status", e.target.value)}>
              {meta.review_statuses.map((s) => <option key={s} value={s}>{REVIEW_STATUS_STYLE[s]?.label ?? s}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <ErrorNote error={err} />
      <div className="flex justify-end gap-2 sticky bottom-0 py-3 bg-ink/95 backdrop-blur border-t border-edge -mx-1 px-1">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary">{edit ? "Save review" : "File review"}</button>
      </div>
    </form>
  );
}

function ReviewDetail({ review, users, canEdit, onEdit, onStatus }: {
  review: Review; users: User[]; canEdit: boolean; onEdit: () => void;
  onStatus: (s: string) => void;
}) {
  const st = REVIEW_STATUS_STYLE[review.status] ?? REVIEW_STATUS_STYLE.open;
  const userName = (uid: number | null | undefined) => users.find((u) => u.id === uid)?.ign ?? "—";
  return (
    <div className="space-y-5">
      <button className="label !text-crim" onClick={() => navigate("reviews")}>← All reviews</button>
      <PageTitle
        title={`Match Review — ${review.scrim_number ? `Scrim #${review.scrim_number}` : "Post-game"}`}
        sub={`vs ${review.opponent} · ${dayLabel(review.date)} · ${review.result}${review.duration_min ? ` · ${review.duration_min} min` : ""}`}
        right={<div className="flex items-center gap-2">
          <Badge cls={st.cls}>{st.label}</Badge>
          {review.mandatory && <Badge cls="text-amber border-amber/40 bg-amber/10">mandatory</Badge>}
        </div>}
      />

      <div className="grid lg:grid-cols-2 gap-4">
        <DraftBoard draft={review.draft} theirsLabel={review.opponent.toUpperCase()} />
        <div className="card p-4">
          <div className="label mb-3">Match statistics</div>
          {Object.keys(review.stats || {}).length === 0 && <div className="text-[13px] text-faint">No stat line attached.</div>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {STAT_FIELDS.filter(([k]) => review.stats?.[k] !== undefined).map(([k, label]) => (
              <div key={k} className="bg-raised border border-edge/60 rounded px-2.5 py-2">
                <div className="label !text-[8.5px]">{label}</div>
                <div className="text-[13px] font-bold mt-0.5">{String(review.stats[k])}</div>
              </div>
            ))}
            {Object.entries(review.stats || {}).filter(([k]) => !STAT_FIELDS.some(([f]) => f === k)).map(([k, v]) => (
              <div key={k} className="bg-raised border border-edge/60 rounded px-2.5 py-2">
                <div className="label !text-[8.5px]">{k.replaceAll("_", " ")}</div>
                <div className="text-[13px] font-bold mt-0.5">{String(v)}</div>
              </div>
            ))}
          </div>
          {review.player_ids.length > 0 && (
            <div className="mt-4">
              <div className="label mb-1.5">Players</div>
              <div className="flex flex-wrap gap-1.5">{review.player_ids.map((id) => <Badge key={id}>{userName(id)}</Badge>)}</div>
            </div>
          )}
        </div>
      </div>

      <section className="card p-4">
        <SectionTitle>Biggest mistakes</SectionTitle>
        {review.biggest_mistakes.length === 0 && <div className="text-[13px] text-faint">None listed.</div>}
        <div className="space-y-2.5">
          {review.biggest_mistakes.map((m, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-crim font-extrabold w-6 shrink-0">#{i + 1}</span>
              <p className="text-[13.5px] text-text/90 leading-relaxed">{m}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid sm:grid-cols-2 gap-4">
        {[["Why did it happen?", review.why_happened], ["What should we have done?", review.should_have_done],
          ["Who was involved?", review.who_involved], ["What will we change?", review.what_change]].map(([label, body]) => (
          <div key={label as string} className="card p-4">
            <div className="label mb-2">{label as string}</div>
            <p className="text-[13.5px] text-text/85 leading-relaxed whitespace-pre-wrap">{(body as string) || "—"}</p>
          </div>
        ))}
      </div>

      <section className="card border-leaf/30 p-4">
        <div className="label !text-leaf/90 mb-2">Lesson from this game</div>
        <p className="text-lg font-bold leading-snug">&ldquo;{review.lesson || "—"}&rdquo;</p>
      </section>

      <section className="card p-4">
        <SectionTitle right={canEdit && review.status !== "resolved" && (
          <div className="flex gap-2">
            {review.status === "open" && <button className="btn-ghost !py-1 !text-[11px]" onClick={() => onStatus("in_progress")}>Start work</button>}
            <button className="btn-leaf !py-1 !text-[11px]" onClick={() => onStatus("resolved")}>Resolve</button>
          </div>
        )}>Action item</SectionTitle>
        <p className="text-[13.5px] text-text/90 whitespace-pre-wrap">{review.action_item || "—"}</p>
        <div className="flex flex-wrap gap-4 mt-3 text-[12px] text-mute">
          <span>Owner: <b className="text-text">{review.action_assignee_id ? userName(review.action_assignee_id) : "—"}</b></span>
          <span>Deadline: <b className="text-text">{dayLabel(review.action_deadline)}</b></span>
        </div>
      </section>

      {canEdit && <button className="btn-primary" onClick={onEdit}><FileText size={15} /> Edit review</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function ReviewsPage({ me, meta, parts }: { me: User; meta: Meta; parts: string[] }) {
  const canEdit = ["admin", "captain", "coach", "analyst"].includes(me.role);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [scrims, setScrims] = useState<Scrim[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tab, setTab] = useState("all");
  const [editing, setEditing] = useState(false);

  const sub = parts[0]; // "new" | "scrim-<id>" | <reviewId>
  const param = parts[1];

  const load = useCallback(() => {
    api.get<Review[]>("/reviews").then(setReviews).catch(() => setReviews([]));
    api.get<Scrim[]>("/scrims").then(setScrims).catch(() => setScrims([]));
    api.get<User[]>("/admin/users").then(setUsers).catch(() => setUsers([]));
  }, []);
  useEffect(load, [load]);

  // -------- create flow (optionally prefilled from a scrim) --------
  if (sub === "new") {
    const scrimIdParam = param?.startsWith("scrim=") ? Number(param.split("=")[1]) : null;
    const scrim = scrims.find((s) => s.id === scrimIdParam) ?? null;
    const draftSource = scrim?.games?.length ? [...scrim.games].reverse().find((g) => g.draft?.our_picks)?.draft : undefined;
    return (
      <div className="max-w-3xl">
        <button className="label !text-crim mb-4 block" onClick={() => navigate("reviews")}>← All reviews</button>
        <PageTitle title="New match review" sub="No review, no next scrim. Be honest — every game teaches us something." />
        {!scrimIdParam && (
          <div className="card p-4 mb-5">
            <div className="label mb-2">Link to a scrim (recommended)</div>
            <div className="flex flex-wrap gap-1.5">
              {scrims.filter((s) => s.status === "played" && !s.has_review).map((s) => (
                <button key={s.id} className="chip card-hover" onClick={() => navigate("reviews", "new", `scrim=${s.id}`)}>
                  #{s.number} vs {s.opponent} · {s.result}
                </button>
              ))}
              {scrims.filter((s) => s.status === "played" && !s.has_review).length === 0 && (
                <span className="text-[12px] text-faint">No unreviewed played scrims — you can still file a free-form review below.</span>
              )}
            </div>
          </div>
        )}
        {canEdit ? (
          <ReviewForm meta={meta} users={users}
            initial={draftSource ? { draft: draftSource as Review["draft"] } : {}}
            scrim={scrim}
            onClose={() => navigate(scrim ? ("scrims") : "reviews")}
            onSaved={(id) => { load(); navigate("reviews", id); }} />
        ) : (
          <Empty title="Your role cannot file reviews" hint="Captain, coach, analyst or admin only" />
        )}
      </div>
    );
  }

  // -------- detail by review id or scrim id --------
  if (sub) {
    const byScrim = sub.startsWith("scrim-");
    const review = byScrim
      ? (reviews ?? []).find((r) => r.scrim_id === Number(sub.slice(6)))
      : (reviews ?? []).find((r) => r.id === Number(sub));
    if (reviews === null) return <Spinner />;
    if (!review) return <Empty title="Review not found" />;
    const scrim = scrims.find((s) => s.id === review.scrim_id) ?? null;
    if (editing && canEdit) {
      return (
        <div className="max-w-3xl">
          <PageTitle title={`Editing review — Scrim #${review.scrim_number ?? ""}`} />
          <ReviewForm meta={meta} users={users} initial={review} scrim={scrim}
            onClose={() => setEditing(false)}
            onSaved={(id) => { setEditing(false); load(); navigate("reviews", id); }} />
        </div>
      );
    }
    return <ReviewDetail review={review} users={users} canEdit={canEdit}
      onEdit={() => setEditing(true)}
      onStatus={async (status) => { await api.patch(`/reviews/${review.id}`, { status }); load(); }} />;
  }

  // -------- list --------
  const filtered = (reviews ?? []).filter((r) => (tab === "all" ? true : r.status === tab));
  return (
    <div className="space-y-5">
      <PageTitle title="Match Review System"
        sub="NO REVIEW, NO NEXT SCRIM. After every lost competitive game, the review is mandatory."
        right={canEdit && <button className="btn-primary" onClick={() => navigate("reviews", "new")}><Plus size={15} /> File review</button>} />

      <div className="card border-crim/40 bg-crim-dim/20 px-4 py-3 flex items-center gap-2.5 text-[13px]">
        <AlertTriangle size={15} className="text-crim shrink-0" />
        <span><b>House rule.</b> A lost game without a filed review blocks all new scrim bookings.</span>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "all", label: "All" },
        { id: "open", label: "Open" },
        { id: "in_progress", label: "In progress" },
        { id: "resolved", label: "Resolved" },
      ]} />

      {!reviews && <Spinner />}
      <div className="space-y-2">
        {filtered.map((r) => {
          const st = REVIEW_STATUS_STYLE[r.status] ?? REVIEW_STATUS_STYLE.open;
          return (
            <button key={r.id} onClick={() => navigate("reviews", r.id)} className="w-full text-left card card-hover p-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className={`chip ${st.cls}`}>{st.label}</span>
                {r.mandatory && <Badge cls="text-amber border-amber/40 bg-amber/10 !text-[9px] uppercase">mandatory</Badge>}
                <span className="text-sm font-bold">
                  {r.scrim_number ? `Scrim #${r.scrim_number}` : "Review"} vs {r.opponent}
                </span>
                <span className="text-[11px] text-faint">{dayLabel(r.date)} · {r.result}</span>
              </div>
              {r.lesson && <div className="text-[13px] text-mute mt-2 italic">“{r.lesson}”</div>}
              {r.action_item && (
                <div className="text-[11px] text-faint mt-1.5">
                  Action: {r.action_item.slice(0, 90)}{r.action_item.length > 90 ? "…" : ""}
                </div>
              )}
            </button>
          );
        })}
        {reviews && filtered.length === 0 && <Empty title="No reviews in this state" />}
      </div>
    </div>
  );
}
