import { AlertTriangle, FileText, Film, ImageIcon, Link2, Pencil, Plus, ShieldAlert, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, qs } from "../lib/api";
import type { Meta, Scrim, ScrimSummary, User } from "../lib/types";
import { dayLabel, fmtTime, navigate, pct, ResultBadge } from "../lib/util";
import { Badge, Empty, ErrorNote, Field, Modal, PageTitle, SectionTitle, Spinner, StatTile, Tabs } from "../components/ui";
import { DraftBoard } from "../components/DraftBoard";

function ScrimRow({ s, onOpen }: { s: Scrim; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full text-left card card-hover p-3.5 flex items-center gap-3">
      <div className="w-12 text-center">
        <div className="label !text-faint">#</div>
        <div className="font-extrabold tabular-nums">{s.number}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold truncate">
          {s.status === "scheduled" ? <>vs {s.opponent}</> : <>9 CLOVER {s.score_us} - {s.score_them} {s.opponent}</>}
          <span className="text-faint font-semibold"> · {s.format}</span>
        </div>
        <div className="text-[11px] text-faint mt-0.5">
          {dayLabel(s.date)} {fmtTime(s.time)}
          {s.tournament_prep ? " · tournament prep" : ""}
          {s.server ? ` · ${s.server}` : ""}
        </div>
      </div>
      {s.status === "scheduled" && <Badge cls="text-sky border-sky/40 bg-sky/10">scheduled</Badge>}
      {s.status === "played" && <ResultBadge result={s.result} />}
      {s.needs_review && <Badge cls="text-amber border-amber/40 bg-amber/10 uppercase !text-[9px]">review due</Badge>}
    </button>
  );
}

function NewScrimForm({ meta, users, initial, onSaved, onClose }: {
  meta: Meta; users: User[]; initial?: Scrim | null; onSaved: (id: number) => void; onClose: () => void;
}) {
  const edit = Boolean(initial?.id);
  const [f, setF] = useState<Record<string, unknown>>(initial ? {
    opponent: initial.opponent, date: initial.date ?? "", time: initial.time, format: initial.format,
    server: initial.server, tournament_prep: initial.tournament_prep, notes: initial.notes,
    expected_strategy: initial.expected_strategy,
    lineup: Object.fromEntries(Object.entries(initial.lineup).map(([k, v]) => [k, v ?? ""]) as [string, number | ""][]),
    substitutes: initial.substitutes,
  } : {
    opponent: "", date: "", time: "22:00", format: "BO3", server: "Custom lobby",
    tournament_prep: false, notes: "", expected_strategy: "",
    lineup: {} as Record<string, number | "">, substitutes: [] as number[],
  });
  const [err, setErr] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ message: string; blocking: { scrim_id: number; number: number; opponent: string }[] } | null>(null);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const roster = users.filter((u) => u.roster && u.active);

  // pre-fill default lineup by main role
  useEffect(() => {
    if (edit) return;
    const lineup: Record<string, number | ""> = {};
    for (const lane of meta.lanes) {
      const m = roster.find((u) => u.main_role === lane && u.role === "captain") ?? roster.find((u) => u.main_role === lane);
      lineup[lane] = m?.id ?? "";
    }
    set("lineup", lineup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBlocked(null);
    try {
      const body = {
        ...f,
        date: f.date || null,
        lineup: Object.fromEntries(Object.entries(f.lineup as Record<string, number | "">).map(([k, v]) => [k, v === "" ? null : Number(v)])),
        substitutes: f.substitutes,
      };
      const scrim = edit
        ? await api.patch<Scrim>(`/scrims/${initial!.id}`, body)
        : await api.post<Scrim>("/scrims", body);
      onSaved(scrim.id);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.status === 409) {
        const d = (e2.payload as { detail?: { message?: string; blocking?: { scrim_id: number; number: number; opponent: string }[] } })?.detail;
        setBlocked({ message: d?.message ?? "Blocked by review rule", blocking: d?.blocking ?? [] });
      } else setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  return (
    <Modal title={edit ? `Edit scrim #${initial!.number}` : "Book a scrim"} onClose={onClose} wide>
      {blocked && (
        <div className="rounded border border-amber/50 bg-amber/10 p-3.5 mb-4">
          <div className="flex items-center gap-2 text-amber font-bold text-sm">
            <ShieldAlert size={15} /> NO REVIEW, NO NEXT SCRIM
          </div>
          <p className="text-[13px] text-text/80 mt-1.5">{blocked.message}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            {blocked.blocking.map((b) => (
              <button key={b.scrim_id} className="btn-ghost !py-1.5 !text-[12px]"
                onClick={() => navigate("reviews", "new", `scrim=${b.scrim_id}`)}>
                File review for Scrim #{b.number} →
              </button>
            ))}
          </div>
        </div>
      )}
      <form onSubmit={save} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Opponent">
            <input className="input" required value={String(f.opponent)} onChange={(e) => set("opponent", e.target.value)} placeholder="Team X" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date"><input className="input" type="date" value={String(f.date)} onChange={(e) => set("date", e.target.value)} /></Field>
            <Field label="Time"><input className="input" type="time" value={String(f.time)} onChange={(e) => set("time", e.target.value)} /></Field>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Format">
            <select className="input" value={String(f.format)} onChange={(e) => set("format", e.target.value)}>
              {meta.scrim_formats.map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Server">
            <input className="input" value={String(f.server)} onChange={(e) => set("server", e.target.value)} />
          </Field>
          <label className="col-span-2 flex items-end gap-2 pb-2 text-sm font-semibold">
            <input type="checkbox" className="accent-crim" checked={Boolean(f.tournament_prep)} onChange={(e) => set("tournament_prep", e.target.checked)} />
            Tournament preparation
          </label>
        </div>
        <Field label="Lineup">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {meta.lanes.map((lane) => (
              <label key={lane} className="block">
                <span className="label block mb-1">{lane}</span>
                <select className="input !px-2" value={String((f.lineup as Record<string, number | "">)[lane] ?? "")}
                  onChange={(e) => set("lineup", { ...(f.lineup as Record<string, number | "">), [lane]: e.target.value === "" ? "" : Number(e.target.value) })}>
                  <option value="">—</option>
                  {roster.map((u) => <option key={u.id} value={u.id}>{u.ign}</option>)}
                </select>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Substitutes">
          <div className="flex flex-wrap gap-1.5">
            {roster.map((u) => {
              const subs = f.substitutes as number[];
              const on = subs.includes(u.id);
              return (
                <button type="button" key={u.id}
                  onClick={() => set("substitutes", on ? subs.filter((i) => i !== u.id) : [...subs, u.id])}
                  className={`chip ${on ? "border-crim/60 text-crim bg-crim-dim/40" : "text-mute"}`}>
                  {u.ign}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Expected strategy">
          <textarea className="input min-h-16" value={String(f.expected_strategy)} onChange={(e) => set("expected_strategy", e.target.value)} placeholder="What we intend to test / how we'll play it" />
        </Field>
        <Field label="Notes">
          <input className="input" value={String(f.notes)} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary">{edit ? "Save changes" : "Book scrim"}</button>
        </div>
      </form>
    </Modal>
  );
}

function GameForm({ scrim, initial, onSaved, onClose }: {
  scrim: Scrim; initial?: Scrim["games"][number] | null; onSaved: () => void; onClose: () => void;
}) {
  const edit = Boolean(initial?.id);
  const st = initial?.stats ?? {};
  const numKeys = ["kills", "deaths", "gold", "turrets", "turtles", "lords", "teamfights_won", "teamfights_total",
    "gold_diff_10", "kills_10", "deaths_10", "enemy_kills", "enemy_deaths", "enemy_turrets", "enemy_turtles", "enemy_lords"];
  const [f, setF] = useState<Record<string, string>>(() => ({
    game_no: String(initial?.game_no ?? (scrim.games.length || 0) + 1),
    result: initial?.result || "WIN",
    duration_min: String(initial?.duration_min ?? "15"),
    ...Object.fromEntries(numKeys.map((k) => [k, st && (st as Record<string, number>)[k] !== undefined ? String((st as Record<string, number>)[k]) : ""])),
  }));
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const stats: Record<string, number> = {};
    for (const [k, v] of Object.entries(f)) {
      if (["game_no", "result", "duration_min"].includes(k)) continue;
      if (v !== "") stats[k] = Number(v);
    }
    try {
      const body = { game_no: Number(f.game_no), result: f.result, duration_min: Number(f.duration_min) || 0, stats };
      if (edit) await api.patch(`/scrims/${scrim.id}/games/${initial!.id}`, body);
      else await api.post(`/scrims/${scrim.id}/games`, body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  const num = (k: string, label = k) => (
    <label className="block" key={k}>
      <span className="label block mb-1">{label}</span>
      <input className="input !px-2" inputMode="numeric" value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <Modal title={edit ? `Edit game ${f.game_no} — Scrim #${scrim.number}` : `Record game ${f.game_no} — Scrim #${scrim.number}`} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Game #"><input className="input" value={f.game_no} onChange={(e) => set("game_no", e.target.value)} /></Field>
          <Field label="Result">
            <select className="input" value={f.result} onChange={(e) => set("result", e.target.value)}>
              <option>WIN</option><option>LOSS</option>
            </select>
          </Field>
          <Field label="Duration (min)"><input className="input" value={f.duration_min} onChange={(e) => set("duration_min", e.target.value)} /></Field>
        </div>
        <div>
          <div className="label mb-2 text-leaf/80">9 CLOVER</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {num("kills", "Kills")}{num("deaths", "Deaths")}{num("gold", "Gold")}
            {num("turrets", "Turrets")}{num("turtles", "Turtles")}{num("lords", "Lords")}
          </div>
        </div>
        <div>
          <div className="label mb-2">Fights & early game</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {num("teamfights_won", "TF won")}{num("teamfights_total", "TF total")}{num("gold_diff_10", "Gold±@10")}
            {num("kills_10", "Kills@10")}{num("deaths_10", "Deaths@10")}
          </div>
        </div>
        <div>
          <div className="label mb-2 text-crim/80">{scrim.opponent}</div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {num("enemy_kills", "Kills")}{num("enemy_deaths", "Deaths")}
            {num("enemy_turrets", "Turrets")}{num("enemy_turtles", "Turtles")}{num("enemy_lords", "Lords")}
          </div>
        </div>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary">{edit ? "Save changes" : "Save game"}</button>
        </div>
      </form>
    </Modal>
  );
}

const FILE_KIND_TO_EVIDENCE: Record<string, string> = {
  image: "screenshot", video: "video", pdf: "stats", file: "stats",
};

function AttachmentForm({ scrim, onSaved, onClose }: { scrim: Scrim; onSaved: () => void; onClose: () => void }) {
  const [staged, setStaged] = useState<{ kind: string; label: string; url: string }[]>([]);
  const [kind, setKind] = useState("stream");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
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
        const saved = await api.upload<{ label: string; url: string; kind: string }>("/files", form);
        setStaged((p) => [...p, { kind: FILE_KIND_TO_EVIDENCE[saved.kind] ?? "stats", label: saved.label, url: saved.url }]);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (staged.length === 0) { setErr("Pick a file or add a link first"); return; }
    setBusy(true);
    setErr(null);
    try {
      await api.patch(`/scrims/${scrim.id}`, { attachments: [...scrim.attachments, ...staged] });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const EVID_ICON: Record<string, typeof Link2> = { screenshot: ImageIcon, video: Film, stats: FileText };

  return (
    <Modal title="Attach evidence" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <input ref={fileRef} type="file" multiple className="hidden"
          accept="image/*,video/mp4,video/webm,video/quicktime,.pdf,.txt,.md,.csv,.zip"
          onChange={(e) => onPick(e.target.files)} />
        <button type="button" className="btn-ghost w-full !py-3" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> {uploading ? "Uploading…" : "Upload from device (screenshots, clips, stat sheets)"}
        </button>

        {staged.length > 0 && (
          <div className="space-y-1.5">
            <div className="label">Ready to attach ({staged.length})</div>
            {staged.map((a, i) => {
              const Icon = EVID_ICON[a.kind] ?? Link2;
              return (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-edge bg-raised/50 px-2.5 py-1.5">
                  <Icon size={13} className="text-crim shrink-0" />
                  <span className="text-[12px] font-semibold truncate flex-1">{a.label}</span>
                  <span className="text-faint text-[9px] uppercase shrink-0">{a.kind}</span>
                  <button type="button" className="text-faint hover:text-crim shrink-0" title="Remove"
                    onClick={() => setStaged((p) => p.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
                </div>
              );
            })}
          </div>
        )}

        <div className="card !bg-raised/40 p-3 space-y-3">
          <div className="label !mb-0">…or a web link (stream / replay / drive)</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className="input !py-1.5 text-[12px]" value={kind} onChange={(e) => setKind(e.target.value)}>
                {["screenshot", "replay", "stats", "video", "stream"].map((k) => <option key={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Label">
              <input className="input !py-1.5 text-[12px]" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VOD link" />
            </Field>
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <input className="input !py-1.5 text-[12px]" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </div>
            <button type="button" className="btn-ghost !py-1.5 !px-3 shrink-0"
              onClick={() => {
                if (!url.trim()) return;
                setStaged((p) => [...p, { kind, label: label.trim() || `${kind} link`, url: url.trim() }]);
                setUrl(""); setLabel("");
              }}>Add link</button>
          </div>
        </div>

        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || uploading || staged.length === 0}>
            Attach {staged.length > 0 ? `(${staged.length})` : ""}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export function ScrimsPage({ me, meta, parts }: { me: User; meta: Meta; parts: string[] }) {
  const canManage = ["admin", "captain"].includes(me.role);
  const canUpload = canManage; // captain/admin upload results (coach watches)
  const [tab, setTab] = useState("list");
  const [scrims, setScrims] = useState<Scrim[] | null>(null);
  const [summary, setSummary] = useState<ScrimSummary | null>(null);
  const [detail, setDetail] = useState<Scrim | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editScrim, setEditScrim] = useState(false);
  const [showGame, setShowGame] = useState(false);
  const [editGame, setEditGame] = useState<null | Scrim["games"][number]>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [filters, setFilters] = useState<{ opponent: string; result: string }>({ opponent: "", result: "" });

  const id = parts[0] ? Number(parts[0]) : null;

  const load = useCallback(() => {
    api.get<Scrim[]>(`/scrims${qs(filters)}`).then(setScrims).catch(() => setScrims([]));
    api.get<ScrimSummary>("/scrims/summary").then(setSummary).catch(() => setSummary(null));
    api.get<User[]>("/admin/users").then(setUsers).catch(() => setUsers([]));
    if (id) api.get<Scrim>(`/scrims/${id}`).then(setDetail).catch(() => setDetail(null));
  }, [filters, id]);
  useEffect(load, [load]);

  const userName = (uid: number | null | undefined) => {
    const u = users.find((x) => x.id === uid);
    return u ? u.ign : "—";
  };

  async function removeAttachment(sc: Scrim, att: Scrim["attachments"][number]) {
    if (!confirm(`Remove "${att.label || att.kind}"?`)) return;
    await api.patch(`/scrims/${sc.id}`, { attachments: sc.attachments.filter((x) => x !== att) });
    load();
  }

  // ------------------ detail ------------------
  if (id) {
    if (!detail) return <Spinner />;
    const s = detail;
    const played = s.status === "played";
    return (
      <div className="space-y-5">
        <button className="label !text-crim" onClick={() => navigate("scrims")}>← All scrims</button>
        <PageTitle
          title={`Scrim #${s.number} vs ${s.opponent}`}
          sub={`${dayLabel(s.date)} · ${fmtTime(s.time)} · ${s.format}${s.tournament_prep ? " · tournament prep" : ""}${s.server ? ` · ${s.server}` : ""}`}
          right={
            <div className="flex items-center gap-2">
              {canManage && (
                <>
                  <button className="btn-ghost !py-1.5 !px-2.5 !text-[11px]" onClick={() => setEditScrim(true)} title="Edit scrim">Edit</button>
                  <button className="btn-ghost !py-1.5 !px-2.5 !text-[11px] !text-crim" title="Delete scrim"
                    onClick={async () => {
                      if (confirm(`Delete Scrim #${s.number} vs ${s.opponent} and all its games?`)) {
                        await api.del(`/scrims/${s.id}`);
                        navigate("scrims");
                      }
                    }}><Trash2 size={12} /></button>
                </>
              )}
              {played ? <div className="text-right">
                <div className="text-2xl font-extrabold tabular-nums leading-none">{s.score_us} - {s.score_them}</div>
                <ResultBadge result={s.result} />
              </div> : <Badge cls="text-sky border-sky/40 bg-sky/10">{s.status}</Badge>}
            </div>
          }
        />

        {s.needs_review && (
          <div className="card border-amber/50 bg-amber/10 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-amber text-sm font-bold">
              <AlertTriangle size={16} /> This loss has no review. Rule: NO REVIEW, NO NEXT SCRIM.
            </div>
            {["admin", "captain", "coach", "analyst"].includes(me.role) && (
              <button className="btn-primary" onClick={() => navigate("reviews", "new", `scrim=${s.id}`)}>File the review</button>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="card p-3.5">
            <div className="label mb-2">Lineup</div>
            <div className="space-y-1">
              {meta.lanes.map((lane) => (
                <div key={lane} className="flex justify-between text-[13px]">
                  <span className="text-faint font-bold w-14">{lane}</span>
                  <span className="font-semibold">{userName(s.lineup?.[lane])}</span>
                </div>
              ))}
            </div>
            {s.substitutes.length > 0 && <div className="mt-2 text-[11px] text-faint">Subs: {s.substitutes.map(userName).join(", ")}</div>}
          </div>
          <div className="card p-3.5 lg:col-span-2">
            <div className="label mb-2">Expected strategy</div>
            <p className="text-[13px] text-text/85 whitespace-pre-wrap">{s.expected_strategy || "—"}</p>
            {s.notes && <><div className="label mb-2 mt-4">Notes</div><p className="text-[13px] text-text/85 whitespace-pre-wrap">{s.notes}</p></>}
          </div>
          <div className="card p-3.5">
            <div className="label mb-2">Evidence</div>
            <div className="space-y-2">
              {s.attachments.filter((a) => a.kind === "screenshot" && (a.url ?? "").startsWith("/api/files/")).length > 0 && (
                <div className="grid grid-cols-2 gap-1.5">
                  {s.attachments.filter((a) => a.kind === "screenshot" && (a.url ?? "").startsWith("/api/files/")).map((a, i) => (
                    <div key={i} className="relative">
                      <a href={a.url} target="_blank" rel="noreferrer" title={a.label}>
                        <img src={a.url} alt={a.label} className="rounded-lg border border-edge object-cover w-full aspect-video hover:border-crim/50 transition" />
                      </a>
                      {canManage && (
                        <button className="absolute -top-1.5 -right-1.5 h-4.5 w-4.5 rounded-full bg-crim text-white text-[9px] font-extrabold flex items-center justify-center"
                          title="Remove" onClick={() => void removeAttachment(s, a)}>✕</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {s.attachments.filter((a) => a.kind === "video" && (a.url ?? "").startsWith("/api/files/")).map((a, i) => (
                <video key={i} src={a.url} controls preload="metadata" className="rounded-lg border border-edge w-full max-h-64" />
              ))}
              <div className="space-y-1.5">
                {s.attachments.filter((a) => !(a.url ?? "").startsWith("/api/files/") || (a.kind !== "screenshot" && a.kind !== "video")).map((a, i) => {
                  const Icon = a.kind === "screenshot" ? ImageIcon : a.kind === "video" ? Film : a.kind === "stats" ? FileText : Link2;
                  return (
                    <span key={i} className="flex items-center gap-2">
                      <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[13px] text-sky hover:underline min-w-0">
                        <Icon size={12} /> {a.label || a.kind} <span className="text-faint text-[10px] uppercase">{a.kind}</span>
                      </a>
                      {canManage && (
                        <button className="text-faint hover:text-crim shrink-0" title="Remove"
                          onClick={() => void removeAttachment(s, a)}><Trash2 size={11} /></button>
                      )}
                    </span>
                  );
                })}
              </div>
              {s.attachments.length === 0 && <div className="text-[12px] text-faint">No screenshots, replays or VODs attached.</div>}
            </div>
            {canUpload && <button className="btn-ghost w-full mt-3 !text-[12px]" onClick={() => setShowAttach(true)}><Plus size={13} /> Attach</button>}
          </div>
        </div>

        {/* games */}
        <section>
          <SectionTitle right={canUpload && <button className="btn-ghost !py-1.5 !text-[12px]" onClick={() => setShowGame(true)}><Plus size={13} /> Record game</button>}>
            Games ({s.games.length})
          </SectionTitle>
          {s.games.length === 0 && <Empty title={played ? "No game sheets recorded" : "Not played yet"} hint={canUpload ? "Record each game with its stat sheet" : undefined} />}
          <div className="space-y-3">
            {s.games.map((g) => {
              const st = g.stats as Record<string, number>;
              return (
                <div key={g.id} className="card p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2.5">
                      <Badge>Game {g.game_no}</Badge>
                      <ResultBadge result={g.result} />
                      <span className="text-[12px] text-faint">{g.duration_min} min</span>
                      {canUpload && (
                        <span className="ml-auto flex gap-1">
                          <button className="text-faint hover:text-crim" title="Edit game" onClick={() => setEditGame(g)}><Pencil size={12} /></button>
                          <button className="text-faint hover:text-crim" title="Delete game"
                            onClick={async () => {
                              if (confirm(`Delete game ${g.game_no}? Series score is recomputed.`)) {
                                await api.del(`/scrims/${s.id}/games/${g.id}`);
                                load();
                              }
                            }}><Trash2 size={12} /></button>
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-faint">
                      {st.kills ?? "—"}K / {st.deaths ?? "—"}D · {st.gold ? `${(st.gold / 1000).toFixed(1)}k gold` : ""}
                      {typeof st.gold_diff_10 === "number" && <> · @10 {st.gold_diff_10 >= 0 ? "+" : ""}{st.gold_diff_10}</>}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 text-center">
                    {[["Turrets", st.turrets, st.enemy_turrets], ["Turtles", st.turtles, st.enemy_turtles],
                      ["Lords", st.lords, st.enemy_lords], ["TF won", st.teamfights_won, undefined],
                      ["Kills @10", st.kills_10, undefined], ["Deaths @10", st.deaths_10, undefined],
                      ["Enemy K", st.enemy_kills, undefined], ["Enemy D", st.enemy_deaths, undefined]].map(([label, us, them], i) => (
                      <div key={i} className="bg-raised rounded py-1.5 border border-edge/60">
                        <div className="label !text-[8.5px]">{label as string}</div>
                        <div className="text-[13px] font-bold tabular-nums mt-0.5">
                          {(us as number) ?? "—"}{them !== undefined ? <span className="text-faint"> / {(them as number) ?? "—"}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  {(g.draft?.our_picks || g.draft?.our_bans) && (
                    <details className="mt-3">
                      <summary className="label cursor-pointer hover:text-mute">Draft</summary>
                      <div className="mt-2"><DraftBoard draft={g.draft} theirsLabel={s.opponent.toUpperCase()} /></div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {s.has_review
          ? <button className="btn-ghost" onClick={() => navigate("reviews", `scrim-${s.id}`)}>Open match review →</button>
          : played && s.result === "LOSS" && null}

        {showNew && <NewScrimForm meta={meta} users={users} onClose={() => setShowNew(false)} onSaved={(newId) => { setShowNew(false); navigate("scrims", newId); }} />}
        {editScrim && <NewScrimForm meta={meta} users={users} initial={s} onClose={() => setEditScrim(false)} onSaved={() => { setEditScrim(false); load(); }} />}
        {showGame && <GameForm scrim={s} onClose={() => setShowGame(false)} onSaved={() => { setShowGame(false); load(); }} />}
        {editGame && <GameForm scrim={s} initial={editGame} onClose={() => setEditGame(null)} onSaved={() => { setEditGame(null); load(); }} />}
        {showAttach && <AttachmentForm scrim={s} onClose={() => setShowAttach(false)} onSaved={() => { setShowAttach(false); load(); }} />}
      </div>
    );
  }

  // ------------------ list + summary ------------------
  return (
    <div className="space-y-5">
      <PageTitle title="Scrim Manager" sub="Book, record, review. Every scrim becomes searchable data."
        right={canManage && <button className="btn-primary" onClick={() => setShowNew(true)}><Plus size={15} /> Book scrim</button>} />

      {summary && summary.blocking_losses.length > 0 && (
        <div className="card border-amber/50 bg-amber/10 p-3.5 flex items-center gap-2.5 text-amber text-[13px] font-semibold">
          <ShieldAlert size={15} />
          Scrim booking is locked: review Scrim {summary.blocking_losses.map((s) => `#${s.number}`).join(", ")} first.
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5">
          <StatTile label="Series" value={summary.series.total} hint={`${summary.series.wins}W – ${summary.series.losses}L`} />
          <StatTile label="Series win" value={pct(summary.series.win_rate)} tone={(summary.series.win_rate ?? 0) >= 50 ? "good" : "bad"} />
          <StatTile label="Games" value={summary.games.total} />
          <StatTile label="Game win" value={pct(summary.games.win_rate)} />
          <StatTile label="Avg duration" value={summary.averages.duration_min ? `${summary.averages.duration_min}m` : "—"} />
          <StatTile label="Avg kills" value={summary.averages.kills ?? "—"} />
          <StatTile label="Avg deaths" value={summary.averages.deaths ?? "—"} />
          <StatTile label="Avg objectives" value={summary.averages.objectives ?? "—"} />
        </div>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[{ id: "list", label: "Scrims" }, { id: "opponents", label: "Opponent records" }]} />

      {tab === "list" && (
        <>
          <div className="flex flex-wrap gap-2">
            <input className="input !w-44" placeholder="Opponent…" value={filters.opponent}
              onChange={(e) => setFilters((p) => ({ ...p, opponent: e.target.value }))} />
            <select className="input !w-36" value={filters.result} onChange={(e) => setFilters((p) => ({ ...p, result: e.target.value }))}>
              <option value="">Win/Loss</option><option>WIN</option><option>LOSS</option>
            </select>
          </div>
          {!scrims && <Spinner />}
          <div className="space-y-2">
            {(scrims ?? []).map((s) => <ScrimRow key={s.id} s={s} onOpen={() => navigate("scrims", s.id)} />)}
            {scrims && scrims.length === 0 && <Empty title="No scrims match" />}
          </div>
        </>
      )}

      {tab === "opponents" && summary && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead><tr><th className="th">Opponent</th><th className="th">Played</th><th className="th">Won</th><th className="th">Lost</th><th className="th">Win rate</th></tr></thead>
            <tbody>
              {summary.opponents.map((o) => (
                <tr key={o.opponent} className="hover:bg-raised/60 cursor-pointer"
                  onClick={() => { setFilters({ opponent: o.opponent, result: "" }); setTab("list"); }}>
                  <td className="td font-bold">{o.opponent}</td>
                  <td className="td tabular-nums">{o.played}</td>
                  <td className="td tabular-nums text-leaf">{o.won}</td>
                  <td className="td tabular-nums text-crim">{o.lost}</td>
                  <td className="td tabular-nums">{pct((100 * o.won) / o.played)}</td>
                </tr>
              ))}
              {summary.opponents.length === 0 && <tr><td className="td text-faint" colSpan={5}>No played scrims yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showNew && <NewScrimForm meta={meta} users={users} onClose={() => setShowNew(false)} onSaved={(newId) => { setShowNew(false); navigate("scrims", newId); load(); }} />}
    </div>
  );
}
