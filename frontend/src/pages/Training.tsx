import { Check, ClipboardCheck, Plus, Users2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, qs } from "../lib/api";
import type { Activity, Meta, User, Week } from "../lib/types";
import { dayLabel, fmtTime, navigate } from "../lib/util";
import { Badge, Empty, ErrorNote, Field, Modal, PageTitle, Progress, SectionTitle, Segments, Spinner } from "../components/ui";

const SECTIONS: { id: string; label: string; category: string | null; desc: string }[] = [
  { id: "A", label: "Weekly Training", category: "WEEKS", desc: "Training blocks & focus weeks" },
  { id: "B", label: "Role Training", category: "ROLE DRILL", desc: "Lane-specific work" },
  { id: "C", label: "Team Drills", category: "TEAM FIGHT", desc: "Coordinated 5v5 execution" },
  { id: "D", label: "Scenario Training", category: "SCENARIO", desc: "Scripted game states" },
  { id: "E", label: "Communication", category: "COMMUNICATION", desc: "Calls, ladders, timing" },
  { id: "F", label: "Draft Training", category: "DRAFT", desc: "Comps, picks & bans" },
  { id: "G", label: "Hero Training", category: "HERO TRAINING", desc: "Pool expansion" },
  { id: "H", label: "Objective Training", category: "OBJECTIVE DRILL", desc: "Turtle & Lord control" },
  { id: "I", label: "Match Review", category: "MATCH REVIEW", desc: "VOD sessions & lessons" },
  { id: "J", label: "Individual Development", category: "PLAYERS", desc: "Personal growth plans" },
];

const STATUS_STYLE: Record<string, string> = {
  scheduled: "text-sky border-sky/40 bg-sky/10",
  "in-progress": "text-amber border-amber/40 bg-amber/10",
  done: "text-leaf border-leaf/40 bg-leaf-dim/50",
  missed: "text-crim border-crim/40 bg-crim-dim/50",
  cancelled: "text-mute border-edge-2 bg-raised",
};

function ActivityRow({ a, me, onOpen }: { a: Activity; me: User; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full text-left card card-hover p-3.5 flex items-center gap-3">
      <div className={`chip ${STATUS_STYLE[a.status] || "text-mute"} !text-[9px] uppercase shrink-0 w-24 justify-center`}>
        {a.status}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold truncate">
          {a.title}
          {!a.required && <span className="text-faint text-[11px] font-semibold"> · optional</span>}
          {a.assigned_player_ids.includes(me.id) && <span className="text-leaf text-[11px] font-bold"> · assigned to you</span>}
        </div>
        <div className="text-[11px] text-faint mt-0.5">
          {a.category} · {dayLabel(a.date)} {fmtTime(a.time)}
          {a.week_number ? ` · Week ${String(a.week_number).padStart(2, "0")}` : ""}
          {a.assigned_player_ids.length > 0 && ` · ${a.assigned_player_ids.length} assigned`}
        </div>
      </div>
      {a.status === "done" && <Check size={15} className="text-leaf shrink-0" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
function ActivityForm({ meta, users, weeks, initial, onSaved, onClose }: {
  meta: Meta; users: User[]; weeks: Week[]; initial: Partial<Activity>;
  onSaved: () => void; onClose: () => void;
}) {
  const [f, setF] = useState<Record<string, unknown>>({
    week_id: initial.week_id ?? "",
    title: initial.title ?? "",
    description: initial.description ?? "",
    category: initial.category ?? "ROLE DRILL",
    date: initial.date ?? "",
    time: initial.time ?? "21:00",
    duration_min: initial.duration_min ?? 60,
    coach_name: initial.coach_name ?? "",
    assigned_player_ids: initial.assigned_player_ids ?? [],
    required: initial.required ?? true,
    status: initial.status ?? "scheduled",
    notes: initial.notes ?? "",
    result: initial.result ?? "",
    score: initial.score ?? "",
    lessons: initial.lessons ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const edit = Boolean(initial.id);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = { ...f, week_id: f.week_id === "" ? null : Number(f.week_id), duration_min: Number(f.duration_min) || 60 };
    try {
      if (edit) await api.patch(`/training/activities/${initial.id}`, body);
      else await api.post("/training/activities", body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={edit ? "Edit activity" : "New training activity"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Title">
            <input className="input" required value={String(f.title)} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Turtle setup walkthrough" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <select className="input" value={String(f.category)} onChange={(e) => set("category", e.target.value)}>
                {meta.activity_categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Week">
              <select className="input" value={String(f.week_id)} onChange={(e) => set("week_id", e.target.value)}>
                <option value="">Standalone</option>
                {weeks.map((w) => <option key={w.id} value={w.id}>Week {String(w.number).padStart(2, "0")} — {w.focus}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <Field label="Description">
          <textarea className="input min-h-20" value={String(f.description)} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Date">
            <input className="input" type="date" value={String(f.date)} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label="Time">
            <input className="input" type="time" value={String(f.time)} onChange={(e) => set("time", e.target.value)} />
          </Field>
          <Field label="Duration (min)">
            <input className="input" type="number" min={5} value={Number(f.duration_min)} onChange={(e) => set("duration_min", e.target.value)} />
          </Field>
          <Field label="Coach">
            <input className="input" value={String(f.coach_name)} onChange={(e) => set("coach_name", e.target.value)} placeholder="ICHIZU" />
          </Field>
        </div>
        <Field label={`Assigned players (${(f.assigned_player_ids as number[]).length})`}>
          <div className="flex flex-wrap gap-1.5">
            {users.filter((u) => u.roster).map((u) => {
              const ids = f.assigned_player_ids as number[];
              const on = ids.includes(u.id);
              return (
                <button type="button" key={u.id}
                  onClick={() => set("assigned_player_ids", on ? ids.filter((i) => i !== u.id) : [...ids, u.id])}
                  className={`chip ${on ? "border-crim/60 text-crim bg-crim-dim/40" : "text-mute"}`}>
                  {u.ign} <span className="text-faint text-[9px]">{u.main_role}</span>
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Status">
            <select className="input" value={String(f.status)} onChange={(e) => set("status", e.target.value)}>
              {meta.activity_statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Score (optional)">
            <input className="input" value={String(f.score)} onChange={(e) => set("score", e.target.value)} placeholder="e.g. 8/10 reps" />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm font-semibold">
            <input type="checkbox" className="accent-crim" checked={Boolean(f.required)} onChange={(e) => set("required", e.target.checked)} />
            Attendance required
          </label>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Result">
            <textarea className="input min-h-16" value={String(f.result)} onChange={(e) => set("result", e.target.value)} placeholder="What happened in the session" />
          </Field>
          <Field label="Lessons learned">
            <textarea className="input min-h-16" value={String(f.lessons)} onChange={(e) => set("lessons", e.target.value)} placeholder="What we take from it" />
          </Field>
        </div>
        <Field label="Internal notes">
          <input className="input" value={String(f.notes)} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{edit ? "Save changes" : "Create activity"}</button>
        </div>
      </form>
    </Modal>
  );
}

function WeekForm({ initial, nextNumber, onSaved, onClose }: {
  initial: Partial<Week>; nextNumber: number; onSaved: () => void; onClose: () => void;
}) {
  const [f, setF] = useState<Record<string, unknown>>({
    number: initial.number ?? nextNumber,
    focus: initial.focus ?? "",
    objective: initial.objective ?? "",
    performance_target: initial.performance_target ?? "",
    start_date: initial.start_date ?? "",
    end_date: initial.end_date ?? "",
    status: initial.status ?? "planned",
    notes: initial.notes ?? "",
    weakness_text: initial.weakness_text ?? "",
    weakness_drills_target: initial.weakness_drills_target ?? 0,
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const edit = Boolean(initial.id);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = { ...f, number: Number(f.number), start_date: f.start_date || null, end_date: f.end_date || null, weakness_drills_target: Number(f.weakness_drills_target) || 0 };
    try {
      if (edit) await api.patch(`/training/weeks/${initial.id}`, body);
      else await api.post("/training/weeks", body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  return (
    <Modal title={edit ? `Edit week ${initial.number}` : "New training week"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Week #">
            <input className="input" type="number" min={1} value={Number(f.number)} onChange={(e) => set("number", e.target.value)} />
          </Field>
          <Field label="Status">
            <select className="input" value={String(f.status)} onChange={(e) => set("status", e.target.value)}>
              {["planned", "active", "completed"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Start">
            <input className="input" type="date" value={String(f.start_date)} onChange={(e) => set("start_date", e.target.value)} />
          </Field>
          <Field label="End">
            <input className="input" type="date" value={String(f.end_date)} onChange={(e) => set("end_date", e.target.value)} />
          </Field>
        </div>
        <Field label="Focus">
          <input className="input uppercase" required value={String(f.focus)} onChange={(e) => set("focus", e.target.value.toUpperCase())} placeholder="OBJECTIVE CONTROL" />
        </Field>
        <Field label="Main objective">
          <textarea className="input min-h-16" value={String(f.objective)} onChange={(e) => set("objective", e.target.value)} />
        </Field>
        <Field label="Performance target">
          <input className="input" value={String(f.performance_target)} onChange={(e) => set("performance_target", e.target.value)} placeholder="Measurable bar for the week" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Weakness addressed">
            <input className="input" value={String(f.weakness_text)} onChange={(e) => set("weakness_text", e.target.value)} />
          </Field>
          <Field label="Drills required">
            <input className="input" type="number" min={0} value={Number(f.weakness_drills_target)} onChange={(e) => set("weakness_drills_target", e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <input className="input" value={String(f.notes)} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary">{edit ? "Save changes" : "Create week"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export function TrainingPage({ me, meta, parts }: { me: User; meta: Meta; parts: string[] }) {
  const canManage = ["admin", "captain", "coach"].includes(me.role);
  const [weeks, setWeeks] = useState<Week[] | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [weekDetail, setWeekDetail] = useState<Week | null>(null);
  const [activityDetail, setActivityDetail] = useState<Activity | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [filterCat, setFilterCat] = useState<string>("");
  const [showActivityForm, setShowActivityForm] = useState<null | Partial<Activity>>(null);
  const [showWeekForm, setShowWeekForm] = useState<null | Partial<Week>>(null);

  const view = parts[0] === "weeks" ? "week" : parts[0] === "activities" ? "activity" : "hub";
  const viewId = parts[1];

  const load = useCallback(() => {
    api.get<Week[]>("/training/weeks").then(setWeeks).catch(() => setWeeks([]));
    api.get<Activity[]>(`/training/activities${qs({ category: filterCat || undefined })}`).then(setActivities).catch(() => setActivities([]));
    api.get<User[]>("/admin/users").then(setUsers).catch(() => setUsers([]));
    if (view === "week" && viewId) api.get<Week>(`/training/weeks/${viewId}`).then(setWeekDetail).catch(() => setWeekDetail(null));
    if (view === "activity" && viewId) api.get<Activity>(`/training/activities/${viewId}`).then(setActivityDetail).catch(() => setActivityDetail(null));
  }, [filterCat, view, viewId]);

  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of activities ?? []) c[a.category] = (c[a.category] || 0) + 1;
    return c;
  }, [activities]);

  if (view === "activity" && viewId) {
    if (!activityDetail) return <Spinner />;
    const a = activityDetail;
    const mine = a.assigned_player_ids.includes(me.id);
    return (
      <div className="max-w-3xl space-y-5">
        <button className="label !text-crim" onClick={() => navigate("training")}>← Training center</button>
        <PageTitle title={a.title} sub={`${a.category}${a.week_number ? ` · Week ${String(a.week_number).padStart(2, "0")}` : ""}`}
          right={canManage && <button className="btn-ghost" onClick={() => setShowActivityForm(a)}>Edit</button>} />
        <div className="card p-4 grid sm:grid-cols-2 gap-x-6 gap-y-2">
          <div><span className="label">When</span><div className="text-sm font-semibold mt-0.5">{dayLabel(a.date)} · {fmtTime(a.time)} · {a.duration_min} min</div></div>
          <div><span className="label">Coach</span><div className="text-sm font-semibold mt-0.5">{a.coach_name || "—"}</div></div>
          <div><span className="label">Status</span><div className="mt-1"><span className={`chip ${STATUS_STYLE[a.status] || ""} uppercase !text-[10px]`}>{a.status}</span></div></div>
          <div><span className="label">Assigned</span>
            <div className="text-sm font-semibold mt-0.5 flex items-center gap-1.5"><Users2 size={13} className="text-faint" /> {a.assigned_player_ids.length || "Whole squad"}</div></div>
        </div>
        {a.description && <div className="card p-4"><div className="label mb-2">Brief</div><p className="text-sm text-text/85 leading-relaxed whitespace-pre-wrap">{a.description}</p></div>}
        {(a.result || a.lessons) && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="card p-4"><div className="label mb-2">Result</div><p className="text-sm text-text/85 whitespace-pre-wrap">{a.result || "—"}</p>{a.score && <div className="chip mt-2 border-leaf/40 text-leaf">{a.score}</div>}</div>
            <div className="card p-4"><div className="label mb-2">Lessons learned</div><p className="text-sm text-text/85 whitespace-pre-wrap">{a.lessons || "—"}</p></div>
          </div>
        )}
        {/* quick completion for assigned players / staff */}
        {(canManage || mine) && a.status !== "done" && (
          <button className="btn-leaf" onClick={async () => { await api.patch(`/training/activities/${a.id}`, { status: "done" }); load(); }}>
            <ClipboardCheck size={15} /> Mark complete
          </button>
        )}
        {showActivityForm && <ActivityForm meta={meta} users={users} weeks={weeks ?? []} initial={showActivityForm}
          onClose={() => setShowActivityForm(null)} onSaved={() => { setShowActivityForm(null); load(); }} />}
      </div>
    );
  }

  if (view === "week" && viewId) {
    if (!weekDetail) return <Spinner />;
    const w = weekDetail;
    return (
      <div className="space-y-5">
        <button className="label !text-crim" onClick={() => navigate("training")}>← Training center</button>
        <PageTitle title={`Week ${String(w.number).padStart(2, "0")} — ${w.focus}`}
          sub={w.objective}
          right={canManage && <button className="btn-ghost" onClick={() => setShowWeekForm(w)}>Edit week</button>} />
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="card p-4">
            <div className="label mb-2">Progress</div>
            <div className="text-3xl font-extrabold tabular-nums">{w.progress}%</div>
            <div className="mt-2"><Progress value={w.progress} /></div>
            <div className="text-[11px] text-faint mt-2">{w.activity_counts.done}/{w.activity_counts.total} sessions · {w.status}</div>
          </div>
          <div className="card p-4 sm:col-span-2">
            <div className="label mb-2">Performance target</div>
            <div className="text-sm font-semibold">{w.performance_target || "—"}</div>
            {w.weakness_text && <div className="mt-3 text-[13px] text-amber font-semibold">Addresses: {w.weakness_text} ({w.weakness_drills_target} drills required)</div>}
            {w.notes && <div className="mt-2 text-[12px] text-faint">{w.notes}</div>}
          </div>
        </div>
        <div className="space-y-2">
          {(w.activities ?? []).map((a) => (
            <ActivityRow key={a.id} a={a} me={me} onOpen={() => navigate("training", "activities", a.id)} />
          ))}
          {canManage && (
            <button className="btn-ghost w-full" onClick={() => setShowActivityForm({ week_id: w.id })}>
              <Plus size={15} /> Add session to week {w.number}
            </button>
          )}
        </div>
        {showWeekForm && <WeekForm initial={showWeekForm} nextNumber={(weeks?.length ?? 0) + 1}
          onClose={() => setShowWeekForm(null)} onSaved={() => { setShowWeekForm(null); load(); }} />}
        {showActivityForm && <ActivityForm meta={meta} users={users} weeks={weeks ?? []} initial={showActivityForm}
          onClose={() => setShowActivityForm(null)} onSaved={() => { setShowActivityForm(null); load(); }} />}
      </div>
    );
  }

  // hub
  const activeWeek = (weeks ?? []).find((w) => w.status === "active");
  return (
    <div className="space-y-6">
      <PageTitle title="Training Center" sub="Every rep is tracked. PLAY → RECORD → REVIEW → IDENTIFY → TRAIN → APPLY → IMPROVE."
        right={canManage && (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setShowWeekForm({})}><Plus size={15} /> Week</button>
            <button className="btn-primary" onClick={() => setShowActivityForm({})}><Plus size={15} /> Activity</button>
          </div>
        )} />

      {activeWeek && (
        <button onClick={() => navigate("training", "weeks", activeWeek.id)} className="card card-hover w-full text-left p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="label">Current block</div>
              <div className="text-xl font-extrabold mt-1">
                Week {String(activeWeek.number).padStart(2, "0")} — <span className="text-crim">{activeWeek.focus}</span>
              </div>
              <div className="text-[12px] text-faint mt-1">{activeWeek.objective}</div>
            </div>
            <div className="w-40">
              <div className="flex justify-between mb-1.5">
                <span className="label">Progress</span>
                <span className="text-sm font-extrabold tabular-nums">{activeWeek.progress}%</span>
              </div>
              <Segments done={activeWeek.activity_counts.done} total={Math.max(activeWeek.activity_counts.total, 1)} />
            </div>
          </div>
        </button>
      )}

      {/* The ten sections from the plan */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {SECTIONS.map((s) => (
          <button key={s.id} className="card card-hover p-3.5 text-left"
            onClick={() => {
              if (s.category === "WEEKS") return navigate("training", "weeks", activeWeek?.id ?? (weeks?.[0]?.id ?? ""));
              if (s.category === "PLAYERS") return navigate("players");
              setFilterCat((cur) => (cur === s.category ? "" : s.category!));
              document.getElementById("activity-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold text-crim">{s.id}</span>
              <span className="text-lg font-extrabold text-edge-2 tabular-nums">{s.category && counts[s.category] ? counts[s.category] : ""}</span>
            </div>
            <div className="text-[12.5px] font-bold mt-1.5 leading-tight">{s.label}</div>
            <div className="text-[10.5px] text-faint mt-0.5">{s.desc}</div>
          </button>
        ))}
      </div>

      {/* Weeks */}
      <section>
        <SectionTitle>Weekly training blocks</SectionTitle>
        {!weeks && <Spinner />}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {(weeks ?? []).map((w) => (
            <button key={w.id} onClick={() => navigate("training", "weeks", w.id)}
              className={`card card-hover p-4 text-left ${w.status === "active" ? "border-crim/50" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="text-lg font-extrabold tabular-nums">W{String(w.number).padStart(2, "0")}</span>
                <Badge cls={w.status === "active" ? "text-crim border-crim/50" : w.status === "completed" ? "text-leaf border-leaf/40" : "text-mute"}>{w.status}</Badge>
              </div>
              <div className="text-[13px] font-bold text-crim tracking-wide mt-1">{w.focus}</div>
              <div className="mt-3"><Progress value={w.progress} /></div>
              <div className="text-[10.5px] text-faint mt-1.5">{w.activity_counts.done}/{w.activity_counts.total} sessions · {dayLabel(w.start_date)}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Activities */}
      <section id="activity-list">
        <SectionTitle right={filterCat && <button className="label !text-crim" onClick={() => setFilterCat("")}>Clear filter ✕</button>}>
          Training activities {filterCat && <span className="text-crim">· {filterCat}</span>}
        </SectionTitle>
        {!activities && <Spinner />}
        <div className="space-y-2">
          {(activities ?? []).map((a) => <ActivityRow key={a.id} a={a} me={me} onOpen={() => navigate("training", "activities", a.id)} />)}
          {activities && activities.length === 0 && <Empty title="Nothing here yet" hint={canManage ? "Create the first activity" : "Staff will schedule sessions"} />}
        </div>
      </section>

      {showWeekForm && <WeekForm initial={showWeekForm} nextNumber={((weeks ?? []).reduce((m, w) => Math.max(m, w.number), 0)) + 1}
        onClose={() => setShowWeekForm(null)} onSaved={() => { setShowWeekForm(null); load(); }} />}
      {showActivityForm && <ActivityForm meta={meta} users={users} weeks={weeks ?? []} initial={showActivityForm}
        onClose={() => setShowActivityForm(null)} onSaved={() => { setShowActivityForm(null); load(); }} />}
    </div>
  );
}
