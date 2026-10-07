import { CalendarDays, MapPin, Plus, Trash2, Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { EventItem, Meta, User } from "../lib/types";
import { dayLabel, fmtTime, navigate } from "../lib/util";
import { Badge, Empty, ErrorNote, Field, Modal, PageTitle, Spinner } from "../components/ui";

const KIND_TONE: Record<string, string> = {
  tournament: "text-crim border-crim/50 bg-crim-dim/40",
  scrim: "text-sky border-sky/40 bg-sky/10",
  training: "text-leaf border-leaf/40 bg-leaf-dim/40",
  review: "text-amber border-amber/40 bg-amber/10",
  meeting: "text-mute border-edge-2 bg-raised",
  deadline: "text-crim border-crim/40 bg-crim-dim/30",
  other: "text-mute border-edge-2 bg-raised",
};

function EventForm({ meta, initial, onSaved, onClose }: {
  meta: Meta; initial: Partial<EventItem>; onSaved: () => void; onClose: () => void;
}) {
  const edit = Boolean(initial.id);
  const [f, setF] = useState<Record<string, unknown>>({
    title: initial.title ?? "", kind: initial.kind ?? "training", date: initial.date ?? "",
    time: initial.time ?? "", end_time: initial.end_time ?? "", location: initial.location ?? "",
    description: initial.description ?? "", link: initial.link ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = { ...f, date: f.date || null };
    try {
      if (edit) await api.patch(`/events/${initial.id}`, body);
      else await api.post("/events", body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  return (
    <Modal title={edit ? "Edit event" : "New event"} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Title"><input className="input" required value={String(f.title)} onChange={(e) => set("title", e.target.value)} /></Field>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Kind">
            <select className="input" value={String(f.kind)} onChange={(e) => set("kind", e.target.value)}>
              {meta.event_kinds.map((k) => <option key={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Date"><input className="input" type="date" required value={String(f.date)} onChange={(e) => set("date", e.target.value)} /></Field>
          <Field label="Start"><input className="input" type="time" value={String(f.time)} onChange={(e) => set("time", e.target.value)} /></Field>
          <Field label="End"><input className="input" type="time" value={String(f.end_time)} onChange={(e) => set("end_time", e.target.value)} /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Location"><input className="input" value={String(f.location)} onChange={(e) => set("location", e.target.value)} placeholder="Custom lobby / Discord / venue" /></Field>
          <Field label="Link"><input className="input" type="url" value={String(f.link)} onChange={(e) => set("link", e.target.value)} placeholder="https://…" /></Field>
        </div>
        <Field label="Description"><textarea className="input min-h-20" value={String(f.description)} onChange={(e) => set("description", e.target.value)} /></Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary">{edit ? "Save" : "Create event"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function EventsPage({ me, meta }: { me: User; meta: Meta }) {
  const canManage = ["admin", "captain"].includes(me.role);
  const [items, setItems] = useState<EventItem[] | null>(null);
  const [form, setForm] = useState<null | Partial<EventItem>>(null);

  const load = useCallback(() => {
    api.get<EventItem[]>("/events/calendar").then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const upcoming = (items ?? []).filter((i) => (i.date ?? "9999") >= today);
  const past = (items ?? []).filter((i) => (i.date ?? "") < today).reverse();

  const remove = async (id: number | string) => {
    if (!confirm("Delete this event?")) return;
    await api.del(`/events/${id}`);
    load();
  };

  const RowV = ({ ev }: { ev: EventItem }) => (
    <div className="card p-3.5 flex items-start gap-3.5">
      <div className="w-12 shrink-0 text-center bg-raised border border-edge rounded py-1.5">
        <div className="text-[9px] font-bold uppercase text-crim">{ev.date ? new Date(`${ev.date}T00:00`).toLocaleDateString(undefined, { month: "short" }) : "—"}</div>
        <div className="text-lg font-extrabold leading-none">{ev.date ? ev.date.slice(8) : "—"}</div>
        <div className="text-[8.5px] text-faint uppercase">{ev.date ? new Date(`${ev.date}T00:00`).toLocaleDateString(undefined, { weekday: "short" }) : ""}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">{ev.title}</span>
          <span className={`chip !text-[9px] uppercase ${KIND_TONE[ev.kind] ?? ""}`}>{ev.kind}</span>
          {dayLabel(ev.date) === "Today" && <Badge cls="text-leaf border-leaf/40">today</Badge>}
        </div>
        <div className="text-[12px] text-faint mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {ev.time && <span className="inline-flex items-center gap-1"><CalendarDays size={11} /> {fmtTime(ev.time)}{ev.end_time ? ` – ${fmtTime(ev.end_time)}` : ""}</span>}
          {ev.location && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {ev.location}</span>}
          {ev.link && <a href={ev.link} target="_blank" rel="noreferrer" className="text-sky hover:underline" onClick={(e) => e.stopPropagation()}>link</a>}
        </div>
        {ev.description && <div className="text-[12.5px] text-mute mt-1.5 leading-relaxed">{ev.description}</div>}
      </div>
      <div className="flex flex-col gap-1.5 shrink-0">
        {ev.scrim_id != null && <button className="btn-ghost !py-1 !px-2 !text-[11px]" onClick={() => navigate("scrims", ev.scrim_id!)}>Scrim</button>}
        {canManage && ev.source === "event" && (
          <>
            <button className="text-[11px] text-faint hover:text-text" onClick={() => setForm(ev)}>Edit</button>
            <button className="text-[11px] text-faint hover:text-crim" onClick={() => remove(ev.id)}><Trash2 size={12} /></button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageTitle title="Calendar & Events" sub="Tournaments, scrims, training and review blocks in one feed."
        right={canManage && <button className="btn-primary" onClick={() => setForm({})}><Plus size={15} /> New event</button>} />

      {!items && <Spinner />}
      <section className="space-y-2">
        {upcoming.map((ev) => <RowV key={`${ev.source}-${ev.id}`} ev={ev} />)}
        {items && upcoming.length === 0 && <Empty title="Nothing coming up" hint={canManage ? "Create an event" : undefined} />}
      </section>

      {past.length > 0 && (
        <section>
          <div className="label mb-2">Earlier</div>
          <div className="space-y-2 opacity-60">
            {past.slice(0, 12).map((ev) => <RowV key={`${ev.source}-${ev.id}`} ev={ev} />)}
          </div>
        </section>
      )}

      {(items ?? []).some((i) => i.kind === "tournament") && (
        <div className="card border-crim/40 p-4 flex items-center gap-3">
          <Trophy size={18} className="text-crim" />
          <div className="text-[13px] text-mute">
            Tournament weeks lock the training block — check with the captain before booking extra scrims.
          </div>
        </div>
      )}

      {form && <EventForm meta={meta} initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}
