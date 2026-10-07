import { Check, ClipboardCheck, FileText, Film, ImageIcon, Link2, Pencil, Plus, Trash2, Upload, Users2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, qs } from "../lib/api";
import type { Activity, Meta, Program, ProgressCell, User, Week } from "../lib/types";
import { dayLabel, fmtTime, navigate } from "../lib/util";
import { Badge, Empty, ErrorNote, Field, Modal, PageTitle, Progress, SectionTitle, Segments, Spinner } from "../components/ui";
import { AvatarImg } from "../components/Avatar";

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
        </div>
        {(a.assigned ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {(a.assigned ?? []).map((u) => (
              <span key={u.id} className="chip !text-[9px] !py-0.5 !px-1.5 text-mute border-edge-2" title={u.name}>
                {u.ign}{u.main_role ? ` · ${u.main_role}` : ""}
              </span>
            ))}
          </div>
        )}
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
// Training programs: activity → own weeks/tasks → per-member progress matrix
// ---------------------------------------------------------------------------
function ProgramForm({ users, program, onSaved, onClose }: {
  users: User[]; program: Program | null; onSaved: () => void; onClose: () => void;
}) {
  const [f, setF] = useState<Record<string, unknown>>({
    name: program?.name ?? "",
    focus: program?.focus ?? "",
    description: program?.description ?? "",
    enrolled_ids: program?.enrolled_ids ?? [],
    status: program?.status ?? "active",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (program) await api.patch(`/programs/${program.id}`, f);
      else await api.post("/programs", f);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={program ? "Edit program" : "New training program"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Program name">
            <input className="input" required value={String(f.name)} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Jungle pathing" />
          </Field>
          <Field label="Focus">
            <input className="input" value={String(f.focus)} onChange={(e) => set("focus", e.target.value)} placeholder="e.g. JUNGLE · Macro · Team fight" />
          </Field>
        </div>
        <Field label="What this program is about">
          <textarea className="input min-h-20" value={String(f.description)} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label={`Enrolled players (${(f.enrolled_ids as number[]).length})`}>
          <div className="flex flex-wrap gap-1.5">
            {users.filter((u) => u.roster).map((u) => {
              const ids = f.enrolled_ids as number[];
              const on = ids.includes(u.id);
              return (
                <button type="button" key={u.id}
                  onClick={() => set("enrolled_ids", on ? ids.filter((i) => i !== u.id) : [...ids, u.id])}
                  className={`chip ${on ? "border-crim/60 text-crim bg-crim-dim/40" : "text-mute"}`}>
                  {u.ign} <span className="text-faint text-[9px]">{u.main_role}</span>
                </button>
              );
            })}
          </div>
        </Field>
        {program && (
          <Field label="Status">
            <select className="input" value={String(f.status)} onChange={(e) => set("status", e.target.value)}>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
          </Field>
        )}
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{program ? "Save changes" : "Create program"}</button>
        </div>
      </form>
    </Modal>
  );
}

type Att = { label: string; url: string; kind: string };

const ATT_ICON: Record<string, typeof Link2> = {
  image: ImageIcon, video: Film, pdf: FileText, file: FileText, link: Link2,
};

/** Shared device-file picker + removable attachment list + optional web link. */
function FilePick({ items, onChange, hint }: { items: Att[]; onChange: (a: Att[]) => void; hint?: string }) {
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setErr(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const saved = await api.upload<Att>("/files", form);
        onChange([...items, saved]);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <input ref={fileRef} type="file" multiple className="hidden"
        accept="image/*,video/mp4,video/webm,video/quicktime,.pdf,.txt,.md,.csv,.zip"
        onChange={(e) => onPick(e.target.files)} />
      {items.map((a, i) => {
        const Icon = ATT_ICON[a.kind] ?? Link2;
        return (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-edge bg-raised/50 px-2.5 py-1.5">
            <Icon size={13} className="text-crim shrink-0" />
            {a.kind === "image" && <img src={a.url} alt="" className="h-7 w-10 rounded object-cover border border-edge shrink-0" />}
            <span className="text-[12px] font-semibold truncate flex-1">{a.label}</span>
            <button type="button" className="text-faint hover:text-crim shrink-0"
              onClick={() => onChange(items.filter((_, j) => j !== i))} title="Remove"><Trash2 size={12} /></button>
          </div>
        );
      })}
      <button type="button" className="btn-ghost w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
        <Upload size={14} /> {uploading ? "Uploading…" : "Pick files from device"}
      </button>
      {hint && <div className="text-[10.5px] text-faint leading-snug">{hint}</div>}
      <div className="flex gap-2 items-center">
        <input className="input !py-1.5 flex-1 text-[12px]" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Link label (optional)" />
        <input className="input !py-1.5 flex-[1.4] text-[12px]" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
        <button type="button" className="btn-ghost !py-1.5 !px-3 shrink-0"
          onClick={() => {
            if (!linkUrl.trim()) return;
            onChange([...items, { label: linkLabel.trim() || linkUrl.trim(), url: linkUrl.trim(), kind: "link" }]);
            setLinkLabel(""); setLinkUrl("");
          }}>Add link</button>
      </div>
      <ErrorNote error={err} />
    </div>
  );
}

/** Attach a week from the training schedule to a program. */
function ProgramWeekForm({ program, week, weeks, onSaved, onClose }: {
  program: Program; week: Program["weeks"][number] | null; weeks: Week[]; onSaved: () => void; onClose: () => void;
}) {
  const edit = Boolean(week);
  const attached = new Set(program.weeks.map((w) => w.scheduled?.id).filter((x): x is number => x != null));
  const choices = weeks.filter((w) => (edit ? w.id === week?.scheduled?.id : !attached.has(w.id)));
  const [twId, setTwId] = useState<number | "">(week?.scheduled?.id ?? "");
  const [desc, setDesc] = useState(week?.description ?? "");
  const [att, setAtt] = useState<Att[]>(week?.attachments ?? []);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (edit && week) {
        await api.patch(`/programs/weeks/${week.id}`, { description: desc, attachments: att });
      } else {
        if (twId === "") { setErr("Pick a scheduled week"); setBusy(false); return; }
        await api.post(`/programs/${program.id}/weeks`, { training_week_id: Number(twId), description: desc, attachments: att });
      }
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const chosen = weeks.find((w) => w.id === Number(twId));
  return (
    <Modal title={edit ? `Program week W${String(week?.number ?? 0).padStart(2, "0")}` : `Attach schedule week to ${program.name}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Week from schedule">
          <select className="input" required disabled={edit} value={String(twId)} onChange={(e) => setTwId(Number(e.target.value))}>
            <option value="">— pick a scheduled week —</option>
            {choices.map((w) => (
              <option key={w.id} value={w.id}>W{String(w.number).padStart(2, "0")} — {w.focus}{w.start_date ? ` (${dayLabel(w.start_date)})` : ""}</option>
            ))}
          </select>
        </Field>
        {chosen && (
          <div className="card !bg-raised/40 p-3">
            <div className="flex items-center gap-2">
              <Badge cls={chosen.status === "active" ? "text-crim border-crim/50" : chosen.status === "completed" ? "text-leaf border-leaf/40" : "text-mute"}>{chosen.status}</Badge>
              <span className="text-[10px] font-extrabold text-crim uppercase tracking-wide">{dayLabel(chosen.start_date)} → {dayLabel(chosen.end_date)}</span>
            </div>
            {chosen.objective && <p className="text-[12px] text-mute leading-relaxed mt-1.5 line-clamp-3">{chosen.objective}</p>}
          </div>
        )}
        {!edit && choices.length === 0 && (
          <div className="text-[12px] text-amber font-semibold">All scheduled weeks are already attached — create more under the Schedule tab.</div>
        )}
        <Field label="Program note for this week (optional)">
          <textarea className="input min-h-16" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What this program expects during that week" />
        </Field>
        <Field label={`Attachments (${att.length})`}>
          <FilePick items={att} onChange={setAtt} />
        </Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || (!edit && twId === "")}>{edit ? "Save changes" : "Attach week"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Player marks a week done — with optional note + completion evidence. */
function ClaimDoneModal({ program, week, cell, onSaved, onClose }: {
  program: Program; week: Program["weeks"][number]; cell: ProgressCell | undefined; onSaved: () => void; onClose: () => void;
}) {
  const [notes, setNotes] = useState(cell?.notes ?? "");
  const [att, setAtt] = useState<Att[]>(cell?.attachments ?? []);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/programs/weeks/${week.id}/progress`, { status: "done", notes, attachments: att });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`I've done it — W${String(week.number).padStart(2, "0")} · ${week.title}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-[12px] text-mute leading-relaxed">
          Marking this week done on <span className="text-text font-semibold">{program.name}</span>.
          Upload proof (replay screenshots, result screens, VOD clips) — optional, but staff may ask for evidence.
        </p>
        <Field label="Evidence">
          <FilePick items={att} onChange={setAtt} hint="Screenshots of the reps, stats or the match result work best." />
        </Field>
        <Field label="Note (optional)">
          <textarea className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How it went, any blockers" />
        </Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-leaf" disabled={busy}><Check size={15} /> Mark week done</button>
        </div>
      </form>
    </Modal>
  );
}

function ProgramCard({ p, me, onOpen }: { p: Program; me: User; onOpen: () => void }) {
  const enrolledYou = p.enrolled_ids.includes(me.id);
  return (
    <button onClick={onOpen} className={`card card-hover p-4 text-left ${p.status === "archived" ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold truncate">{p.name}</div>
          <div className="text-[11px] text-faint mt-0.5 truncate">{p.focus || "General"}
            {enrolledYou && <span className="text-leaf font-bold"> · you're in</span>}</div>
        </div>
        <Badge cls={p.status === "active" ? "text-leaf border-leaf/40" : "text-mute"}>{p.status}</Badge>
      </div>
      <div className="flex flex-wrap gap-1 mt-2.5">
        {p.enrolled.map((u) => (
          <span key={u.id} className="chip !text-[9px] !py-0.5 !px-1.5 text-mute border-edge-2" title={u.name}>
            {u.ign}{u.main_role ? ` · ${u.main_role}` : ""}
          </span>
        ))}
        {p.enrolled.length === 0 && <span className="text-[11px] text-faint">No players enrolled yet</span>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1"><Progress value={p.completion} /></div>
        <span className="text-[11px] font-extrabold tabular-nums text-mute w-8 text-right">{p.completion}%</span>
      </div>
      <div className="text-[10.5px] text-faint mt-1.5">{p.week_count} {p.week_count === 1 ? "task" : "tasks"} · per-member tracking</div>
    </button>
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
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [showProgramForm, setShowProgramForm] = useState<null | { program: Program | null }>(null);
  const [showTaskForm, setShowTaskForm] = useState<null | { week: Program["weeks"][number] | null }>(null);
  const [showClaim, setShowClaim] = useState<null | Program["weeks"][number]>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [filterCat, setFilterCat] = useState<string>("");
  const [showActivityForm, setShowActivityForm] = useState<null | Partial<Activity>>(null);
  const [showWeekForm, setShowWeekForm] = useState<null | Partial<Week>>(null);

  const view = parts[0] === "weeks" ? "week"
    : parts[0] === "activities" ? "activity"
    : parts[0] === "programs" ? "program"
    : parts[0] === "schedule" ? "schedule" : "hub";
  const viewId = parts[1];

  const load = useCallback(() => {
    api.get<Week[]>("/training/weeks").then(setWeeks).catch(() => setWeeks([]));
    api.get<Activity[]>(`/training/activities${qs({ category: filterCat || undefined })}`).then(setActivities).catch(() => setActivities([]));
    api.get<User[]>("/admin/users").then(setUsers).catch(() => setUsers([]));
    api.get<Program[]>("/programs").then(setPrograms).catch(() => setPrograms([]));
    if (view === "week" && viewId) api.get<Week>(`/training/weeks/${viewId}`).then(setWeekDetail).catch(() => setWeekDetail(null));
    if (view === "activity" && viewId) api.get<Activity>(`/training/activities/${viewId}`).then(setActivityDetail).catch(() => setActivityDetail(null));
    if (view === "program" && viewId) api.get<Program>(`/programs/${viewId}`).then(setProgram).catch(() => setProgram(null));
  }, [filterCat, view, viewId]);

  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of activities ?? []) c[a.category] = (c[a.category] || 0) + 1;
    return c;
  }, [activities]);

  if (view === "program" && viewId) {
    if (!program) return <Spinner />;
    const p = program;
    const enrolled = p.enrolled;
    const matrix = p.matrix ?? {};
    async function toggle(weekId: number, userId: number, cur: string) {
      await api.post(`/programs/weeks/${weekId}/progress`, {
        user_id: canManage ? userId : undefined,
        status: cur === "done" ? "pending" : "done",
      });
      load();
      window.dispatchEvent(new Event("clover:notifications-changed"));
    }
    const memberDone = (uid: number) =>
      p.weeks.filter((w) => matrix[String(w.id)]?.[String(uid)]?.status === "done").length;
    function onCellClick(w: Program["weeks"][number], u: (typeof enrolled)[number]) {
      const cell = matrix[String(w.id)]?.[String(u.id)];
      const done = cell?.status === "done";
      if (u.id === me.id) {
        if (done) { if (confirm("Revert this week to pending? (your note and evidence stay)")) void toggle(w.id, u.id, "done"); }
        else setShowClaim(w);
      } else if (canManage) {
        void toggle(w.id, u.id, cell?.status ?? "pending");
      }
    }
    return (
      <div className="space-y-5">
        <button className="label !text-crim" onClick={() => navigate("training")}>← Training programs</button>
        <PageTitle title={p.name} sub={`${p.focus || "General"} · ${p.week_count} ${p.week_count === 1 ? "task" : "tasks"} · ${enrolled.length} enrolled${p.status === "archived" ? " · archived" : ""}`}
          right={canManage && (
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setShowProgramForm({ program: p })}>Edit</button>
              <button className="btn-primary" onClick={() => setShowTaskForm({ week: null })}><Plus size={15} /> Week</button>
            </div>
          )} />
        {p.description && <p className="text-sm text-text/80 leading-relaxed max-w-3xl">{p.description}</p>}

        {/* progress matrix */}
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
            <div className="label">Per-member progress</div>
            <div className="label !text-faint normal-case">tap your cell to mark done</div>
          </div>
          {enrolled.length === 0 && <div className="p-4"><Empty title="No players enrolled" hint={canManage ? "Edit the program to enroll players" : "Staff will enroll players"} /></div>}
          {enrolled.length > 0 && p.weeks.length === 0 && <div className="p-4"><Empty title="No tasks yet" hint={canManage ? "Add the first week task" : "Staff will add tasks"} /></div>}
          {enrolled.length > 0 && p.weeks.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="border-b border-edge">
                    <th className="text-left px-4 py-2.5 label !mb-0 sticky left-0 bg-panel z-10">Week task</th>
                    {enrolled.map((u) => (
                      <th key={u.id} className="px-2 py-2.5 text-center min-w-16">
                        <div className="flex flex-col items-center gap-1">
                          <AvatarImg user={u} size={22} />
                          <span className="text-[9.5px] font-extrabold text-mute uppercase tracking-wide">{u.ign}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.weeks.map((w) => (
                    <tr key={w.id} className="border-b border-edge/60 last:border-0">
                      <td className="px-4 py-3 sticky left-0 bg-panel z-10 max-w-56">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-extrabold text-crim shrink-0">W{String(w.number).padStart(2, "0")}</span>
                          {w.scheduled ? (
                            <button className="text-[13px] font-bold truncate hover:text-crim transition text-left"
                              title={`Open schedule week W${String(w.scheduled.number).padStart(2, "0")}`}
                              onClick={() => navigate("training", "weeks", w.scheduled!.id)}>{w.title}</button>
                          ) : (
                            <span className="text-[13px] font-bold truncate">{w.title}</span>
                          )}
                          {canManage && (
                            <span className="flex gap-1 shrink-0">
                              <button className="text-faint hover:text-crim" onClick={() => setShowTaskForm({ week: w })} title="Edit task"><Pencil size={12} /></button>
                              <button className="text-faint hover:text-crim" title="Delete task"
                                onClick={async () => { if (confirm(`Delete W${w.number} "${w.title}"?`)) { await api.del(`/programs/weeks/${w.id}`); load(); } }}>
                                <Trash2 size={12} /></button>
                            </span>
                          )}
                        </div>
                      </td>
                      {enrolled.map((u) => {
                        const cell = matrix[String(w.id)]?.[String(u.id)];
                        const done = cell?.status === "done";
                        const clickable = canManage || u.id === me.id;
                        const evCount = cell?.attachments?.length ?? 0;
                        return (
                          <td key={u.id} className="px-2 py-3 text-center">
                            <button disabled={!clickable} onClick={() => onCellClick(w, u)}
                              title={done ? `Done${cell?.completed_at ? ` · ${dayLabel(cell.completed_at.split("T")[0])}` : ""}${evCount ? ` · ${evCount} evidence` : ""}`
                                : u.id === me.id ? "Mark this week done (add evidence)" : "Pending"}
                              className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-lg border-2 transition ${
                                done ? "border-leaf bg-leaf-dim/50 text-leaf"
                                  : clickable ? "border-edge-2 text-faint hover:border-crim/60 hover:text-crim"
                                  : "border-edge text-edge-2 cursor-not-allowed"}`}>
                              {done ? <Check size={14} strokeWidth={3} /> : <span className="text-[10px] font-bold">·</span>}
                              {evCount > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-crim px-0.5 text-[8px] font-extrabold text-white">
                                  {evCount}
                                </span>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* per-member totals */}
                  <tr className="bg-raised/40">
                    <td className="px-4 py-2.5 label !mb-0 !text-faint sticky left-0 z-10">Member completion</td>
                    {enrolled.map((u) => (
                      <td key={u.id} className="px-2 py-2.5 text-center">
                        <span className="text-[11px] font-extrabold tabular-nums text-mute">
                          {memberDone(u.id)}/{p.weeks.length}
                        </span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* task briefs */}
        {p.weeks.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-3">
            {p.weeks.map((w) => (
              <div key={w.id} className="card p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-extrabold text-crim">W{String(w.number).padStart(2, "0")}</span>
                  {w.scheduled ? (
                    <button className="text-sm font-bold hover:text-crim transition"
                      onClick={() => navigate("training", "weeks", w.scheduled!.id)}>{w.title}</button>
                  ) : (
                    <span className="text-sm font-bold">{w.title}</span>
                  )}
                  {w.scheduled && (
                    <span className="flex items-center gap-1.5 ml-auto">
                      <Badge cls={w.scheduled.status === "active" ? "text-crim border-crim/50" : w.scheduled.status === "completed" ? "text-leaf border-leaf/40" : "text-mute"}>{w.scheduled.status}</Badge>
                      <span className="text-[10px] text-faint font-bold">{dayLabel(w.scheduled.start_date)} → {dayLabel(w.scheduled.end_date)}</span>
                    </span>
                  )}
                </div>
                {w.scheduled?.objective && <p className="text-[12px] text-text/70 mt-1.5 leading-relaxed line-clamp-3">{w.scheduled.objective}</p>}
                {w.description && <p className="text-[12.5px] text-mute mt-1.5 leading-relaxed whitespace-pre-wrap">{w.description}</p>}
                {w.attachments.length > 0 && (
                  <div className="space-y-2 mt-2.5">
                    {w.attachments.some((a) => a.kind === "image") && (
                      <div className="grid grid-cols-2 gap-1.5">
                        {w.attachments.filter((a) => a.kind === "image").map((a, i) => (
                          <a key={i} href={a.url} target="_blank" rel="noreferrer" title={a.label}>
                            <img src={a.url} alt={a.label} className="rounded-lg border border-edge object-cover w-full aspect-video hover:border-crim/50 transition" />
                          </a>
                        ))}
                      </div>
                    )}
                    {w.attachments.filter((a) => a.kind === "video").map((a, i) => (
                      <video key={i} src={a.url} controls preload="metadata" className="rounded-lg border border-edge w-full max-h-64" />
                    ))}
                    <div className="flex flex-wrap gap-1.5">
                      {w.attachments.filter((a) => a.kind !== "image" && a.kind !== "video").map((a, i) => {
                        const Icon = ATT_ICON[a.kind] ?? Link2;
                        return (
                          <a key={i} href={a.url} target="_blank" rel="noreferrer" className="chip text-sky border-sky/40 hover:bg-sky/10" download={a.kind !== "link" ? a.label : undefined}>
                            <Icon size={11} /> {a.label}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}
                {/* completion evidence from members */}
                {(() => {
                  const evs = enrolled
                    .map((u) => ({ u, c: matrix[String(w.id)]?.[String(u.id)] }))
                    .filter((x) => (x.c?.attachments?.length ?? 0) > 0 || (x.c?.notes ?? "") !== "");
                  if (!evs.length) return null;
                  return (
                    <div className="mt-3 border-t border-edge pt-2.5">
                      <div className="label !text-[9px] mb-2">Completion evidence</div>
                      <div className="space-y-2.5">
                        {evs.map(({ u, c }) => (
                          <div key={u.id} className="flex items-start gap-2">
                            <AvatarImg user={u} size={20} />
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-extrabold text-mute uppercase">
                                {u.ign}
                                {c?.status === "done" && <span className="text-leaf"> ✓</span>}
                                {c?.completed_at && <span className="text-faint normal-case font-semibold"> · {dayLabel(c.completed_at.split("T")[0])}</span>}
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {(c?.attachments ?? []).map((a, i) => a.kind === "image" ? (
                                  <a key={i} href={a.url} target="_blank" rel="noreferrer" title={a.label}>
                                    <img src={a.url} alt={a.label} className="h-10 w-14 rounded border border-edge object-cover hover:border-crim/50 transition" />
                                  </a>
                                ) : (
                                  <a key={i} href={a.url} target="_blank" rel="noreferrer" className="chip !py-0.5 !text-[9px] text-sky border-sky/40 hover:bg-sky/10" title={a.label}>
                                    {a.kind === "video" ? <Film size={10} /> : a.kind === "link" ? <Link2 size={10} /> : <FileText size={10} />} {a.label.length > 24 ? a.label.slice(0, 22) + "…" : a.label}
                                  </a>
                                ))}
                              </div>
                              {c?.notes && <div className="text-[11px] text-faint italic mt-1">“{c.notes}”</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}

        {canManage && (
          <button className="btn-ghost !text-crim" onClick={async () => {
            if (confirm(`Delete program "${p.name}" and all its progress?`)) { await api.del(`/programs/${p.id}`); navigate("training"); }
          }}><Trash2 size={13} /> Delete program</button>
        )}
        {showProgramForm && <ProgramForm users={users} program={showProgramForm.program}
          onClose={() => setShowProgramForm(null)} onSaved={() => { setShowProgramForm(null); load(); }} />}
        {showTaskForm && <ProgramWeekForm program={p} week={showTaskForm.week} weeks={weeks ?? []}
          onClose={() => setShowTaskForm(null)} onSaved={() => { setShowTaskForm(null); load(); }} />}
        {showClaim && <ClaimDoneModal program={p} week={showClaim} cell={matrix[String(showClaim.id)]?.[String(me.id)]}
          onClose={() => setShowClaim(null)}
          onSaved={() => { setShowClaim(null); load(); window.dispatchEvent(new Event("clover:notifications-changed")); }} />}
      </div>
    );
  }

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
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(a.assigned ?? []).length === 0 && (
                <span className="text-sm font-semibold flex items-center gap-1.5"><Users2 size={13} className="text-faint" /> Whole squad</span>
              )}
              {(a.assigned ?? []).map((u) => (
                <span key={u.id} className="flex items-center gap-1.5 chip !py-1 text-mute border-edge-2" title={u.name}>
                  <AvatarImg user={u} size={18} />
                  <span className="font-bold text-text">{u.ign}</span>
                  {u.main_role && <span className="text-crim font-bold !text-[9px] uppercase">{u.main_role}</span>}
                </span>
              ))}
            </div>
          </div>
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
  const tab = view === "schedule" ? "schedule" : "programs";
  return (
    <div className="space-y-6">
      <PageTitle title="Training Center" sub="Every rep is tracked. PLAY → RECORD → REVIEW → IDENTIFY → TRAIN → APPLY → IMPROVE."
        right={canManage && (
          tab === "programs" ? (
            <button className="btn-primary" onClick={() => setShowProgramForm({ program: null })}><Plus size={15} /> Program</button>
          ) : (
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setShowWeekForm({})}><Plus size={15} /> Week</button>
              <button className="btn-primary" onClick={() => setShowActivityForm({})}><Plus size={15} /> Activity</button>
            </div>
          )
        )} />

      <div className="flex gap-1 border-b border-edge -mt-2">
        {([["programs", "Programs"], ["schedule", "Schedule"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => (k === "schedule" ? navigate("training", "schedule") : navigate("training"))}
            className={`px-4 py-2 text-[12px] font-extrabold uppercase tracking-wider border-b-2 -mb-px transition ${
              tab === k ? "text-crim border-crim" : "text-faint border-transparent hover:text-mute"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "programs" ? (
        <section className="space-y-3">
          <div className="text-[12px] text-faint max-w-2xl">
            Each program runs its own list of week tasks with its own players. Track who has done what per activity —
            a player can be on Jungle pathing W2 and Roam vision W1 at the same time.
          </div>
          {!programs && <Spinner />}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {(programs ?? []).map((p) => (
              <ProgramCard key={p.id} p={p} me={me} onOpen={() => navigate("training", "programs", p.id)} />
            ))}
          </div>
          {programs && programs.length === 0 && (
            <Empty title="No training programs yet"
              hint={canManage ? "Create the first program and enroll players" : "Staff will set up programs here"} />
          )}
        </section>
      ) : (
      <>

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

      </>
      )}

      {showWeekForm && <WeekForm initial={showWeekForm} nextNumber={((weeks ?? []).reduce((m, w) => Math.max(m, w.number), 0)) + 1}
        onClose={() => setShowWeekForm(null)} onSaved={() => { setShowWeekForm(null); load(); }} />}
      {showActivityForm && <ActivityForm meta={meta} users={users} weeks={weeks ?? []} initial={showActivityForm}
        onClose={() => setShowActivityForm(null)} onSaved={() => { setShowActivityForm(null); load(); }} />}
      {showProgramForm && <ProgramForm users={users} program={showProgramForm.program}
        onClose={() => setShowProgramForm(null)} onSaved={() => { setShowProgramForm(null); load(); }} />}
    </div>
  );
}
