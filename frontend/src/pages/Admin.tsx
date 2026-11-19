import { KeyRound, Loader2, PlugZap, Plus, ScanEye, ShieldCheck, Sparkles, Trash2, UserCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Meta, User } from "../lib/types";
import { Badge, ErrorNote, Field, Modal, PageTitle, SectionTitle, Spinner, Ign } from "../components/ui";
import { TeamFocusPanel } from "../components/TeamFocusPanel";
import { nice } from "../lib/caseText";

function UserForm({ meta, initial, onSaved, onClose }: {
  meta: Meta; initial: Partial<User>; onSaved: () => void; onClose: () => void;
}) {
  const edit = Boolean(initial.id);
  const [f, setF] = useState<Record<string, unknown>>({
    email: initial.email ?? "", name: initial.name ?? "", ign: initial.ign ?? "",
    role: initial.role ?? "player", main_role: initial.main_role ?? "",
    bio: initial.bio ?? "", password: "", active: initial.active ?? true,
    roster: initial.roster ?? false,
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const body: Record<string, unknown> = { ...f };
    if (!body.password) delete body.password;
    try {
      if (edit) await api.patch(`/admin/users/${initial.id}`, body);
      else await api.post("/admin/users", body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  return (
    <Modal title={edit ? `Edit ${initial.ign || initial.name}` : "New account"} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name"><input className="input" required value={String(f.name)} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="In-game name"><input className="input" value={String(f.ign)} onChange={(e) => set("ign", e.target.value)} placeholder="Kaze" /></Field>
        </div>
        <div>
          <Field label="Email"><input className="input" type="email" required value={String(f.email)} onChange={(e) => set("email", e.target.value)} /></Field>
          {String(f.email).includes("@") && String(f.email).split("@")[0].trim() && (
            <p className="text-[11px] text-faint mt-1">Signs in with username <b className="text-text">{String(f.email).split("@")[0].trim().toLowerCase()}</b></p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Platform role">
            <select className="input" value={String(f.role)} onChange={(e) => set("role", e.target.value)}>
              {Object.entries(meta.roles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
          <Field label="Main lane (players)">
            <select className="input" value={String(f.main_role)} onChange={(e) => set("main_role", e.target.value)}>
              <option value="">—</option>
              {meta.lanes.map((l) => <option key={l} value={l}>{nice(l)}</option>)}
            </select>
          </Field>
        </div>
        <Field label={edit ? "Reset password (leave empty to keep)" : "Password"} hint="Shared with the member directly">
          <input className="input" type="text" value={String(f.password)} onChange={(e) => set("password", e.target.value)} placeholder={edit ? "••••••••" : "clover2026"} />
        </Field>
        <div className="flex gap-5 text-sm font-semibold">
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-crim" checked={Boolean(f.roster)} onChange={(e) => set("roster", e.target.checked)} /> Show on roster</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-crim" checked={Boolean(f.active)} onChange={(e) => set("active", e.target.checked)} /> Active</label>
        </div>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary">{edit ? "Save" : "Create account"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminPage({ me, meta }: { me: User; meta: Meta }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [form, setForm] = useState<null | Partial<User>>(null);

  const load = useCallback(() => {
    api.get<User[]>("/admin/users").then(setUsers).catch(() => setUsers([]));
  }, []);
  useEffect(() => { if (me.role === "admin") load(); }, [load, me.role]);

  if (me.role !== "admin") {
    return <PageTitle title="Team Admin" sub="Admin access only." />;
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Team Admin" sub="Accounts, roles and the team-wide focus state."
        right={<button className="btn-primary" onClick={() => setForm({})}><Plus size={15} /> New account</button>} />

      <AIProviderPanel />
      <ReaderKeyPanel cfg={GEMINI_PANEL} />
      <ReaderKeyPanel cfg={GROQ_PANEL} />

      <section>
        <SectionTitle>Accounts</SectionTitle>
        {!users && <Spinner />}
        <div className="card overflow-x-auto">
          <table className="w-full sm:min-w-[640px]">
            <thead>
              <tr><th className="th">Member</th><th className="th hidden sm:table-cell">Username · email</th><th className="th">Role</th><th className="th hidden md:table-cell">Lane</th><th className="th hidden md:table-cell">Roster</th><th className="th hidden sm:table-cell">Status</th><th className="th"><span className="sr-only">Edit</span></th></tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id} className="hover:bg-raised/60">
                  <td className="td"><span className="font-bold"><Ign text={u.ign || u.name} /></span> <span className="text-faint text-[11px]">{u.name}</span>
                    <span className="sm:hidden block text-[11px] text-mute">signs in as <b className="text-text">{u.email.split("@")[0]}</b>{u.active ? "" : <span className="text-crim"> · disabled</span>}</span></td>
                  <td className="td hidden sm:table-cell text-mute text-[12.5px]"><b className="text-text">{u.email.split("@")[0]}</b><span className="text-faint">@{u.email.split("@")[1] ?? ""}</span></td>
                  <td className="td"><Badge cls={u.role === "admin" ? "text-crim border-crim/40" : "text-mute"}>{u.role_label}</Badge></td>
                  <td className="td hidden md:table-cell text-[12.5px]">{u.main_role || "—"}</td>
                  <td className="td hidden md:table-cell text-[12.5px]">{u.roster ? "yes" : "—"}</td>
                  <td className="td hidden sm:table-cell">{u.active ? <span className="text-leaf text-[12px] font-bold">active</span> : <span className="text-crim text-[12px] font-bold">disabled</span>}</td>
                  <td className="td text-right">
                    <button className="text-faint hover:text-text p-1.5 -m-1.5" onClick={() => setForm(u)} aria-label={`Edit ${u.ign || u.name}`}><UserCog size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <TeamFocusPanel meta={meta} />

      {form && <UserForm meta={meta} initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}

      <DataWipePanel isAdmin={me.role === "admin"} />
    </div>
  );
}

interface AIProviderStatus {
  configured: boolean;
  source: "admin" | "environment" | "none" | "unavailable";
  has_saved_key: boolean;
  updated_at: string | null;
  message: string | null;
}

function AIProviderPanel() {
  const [status, setStatus] = useState<AIProviderStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const secure = window.isSecureContext || ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

  useEffect(() => {
    let active = true;
    api.get<AIProviderStatus>("/admin/integrations/ai")
      .then((value) => { if (active) setStatus(value); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load provider settings."); });
    return () => { active = false; };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!key.trim() || busy || !secure) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const next = await api.post<AIProviderStatus>("/admin/integrations/ai", { key: key.trim() });
      setKey(""); setStatus(next); setConfirmRemove(false);
      setNotice("Key saved. Provider connection has not been tested.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the key."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (busy || !secure) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const next = await api.del<AIProviderStatus>("/admin/integrations/ai");
      setStatus(next); setKey(""); setConfirmRemove(false);
      setNotice(next.source === "environment" ? "Saved key removed. The server environment key is now in use." : "Saved key removed. Facts-only analysis is available.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove the key."); }
    finally { setBusy(false); }
  }

  const label = status?.source === "admin" ? "Key saved" : status?.source === "environment" ? "Server environment key" : status?.source === "unavailable" ? "Saved key locked" : "Not configured";
  return <section className="max-w-3xl">
    <SectionTitle>AI provider</SectionTitle>
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div className="flex gap-3 items-start"><div className="rounded-lg border border-leaf/20 bg-leaf/10 p-2 text-leaf"><KeyRound size={17} /></div>
          <div><h3 className="text-sm font-extrabold">AI provider API key</h3><p className="mt-1 text-[11px] text-mute leading-relaxed">Admin only. Used for member AI and requested match analysis, not for automatic model training.</p></div></div>
        {status && <span className={`h-fit rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${status.configured ? "border-leaf/30 bg-leaf/10 text-leaf" : "border-amber/30 bg-amber/10 text-amber"}`}>{label}</span>}
      </div>
      {!status && !error && <Spinner label="Loading provider settings" />}
      {status && <>
        {status.message && <div className="rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-[11px] text-amber">{status.message}</div>}
        <form onSubmit={save} className="space-y-2">
          <label htmlFor="ai-provider-key" className="label block">{status.has_saved_key || status.source === "environment" ? "Enter a new key to replace the current one" : "Enter your API key"}</label>
          <div className="flex flex-wrap sm:flex-nowrap gap-2"><input id="ai-provider-key" className="input min-w-0 flex-1" type="password" autoComplete="off" spellCheck={false}
            value={key} onChange={(event) => setKey(event.target.value)} placeholder={status.configured ? "Existing key is hidden" : "Paste your AI provider API key"} maxLength={512} disabled={busy || !secure} />
            <button className="btn-primary shrink-0" disabled={busy || !key.trim() || !secure}>{busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} {status.has_saved_key || status.source === "environment" ? "Update key" : "Save key"}</button></div>
        </form>
        <p className="flex items-start gap-2 text-[11px] text-faint leading-relaxed"><ShieldCheck size={14} className="shrink-0 text-leaf" /><span>The key is encrypted on the server and never displayed again. A saved key overrides the server environment key. Saving it does not verify provider access or billing. Member web searches can incur separate charges; monitor usage and daily limits.</span></p>
        {!secure && <div className="text-[11px] text-amber">Open the hub over HTTPS before entering a key.</div>}
        {status.has_saved_key && <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-3">
          {!confirmRemove ? <button type="button" className="btn-ghost !text-[11px]" onClick={() => setConfirmRemove(true)} disabled={busy || !secure}><Trash2 size={13} /> Remove saved key</button>
            : <><span className="text-[11px] text-mute">Remove the saved key?</span><button type="button" className="btn-ghost !text-[11px] text-crim" onClick={() => void remove()} disabled={busy}>Yes, remove</button><button type="button" className="btn-ghost !text-[11px]" onClick={() => setConfirmRemove(false)} disabled={busy}>Cancel</button></>}
        </div>}
      </>}
      {notice && <p role="status" className="text-[11px] font-bold text-leaf">{notice}</p>}
      <ErrorNote error={error} />
    </div>
  </section>;
}

interface ReaderKeyStatus extends AIProviderStatus { model: string; backup: boolean; backup_names?: string[] }
interface ReaderKeyCheck { ok: boolean; model: string; message: string }

interface ReaderKeyConfig {
  id: "gemini" | "groq"; name: string; title: string; about: string; where: string; placeholder: string;
  savedNotice: string; removedNotice: string; billing: string; tone: "leaf" | "sky"; heading?: string;
}

const GEMINI_PANEL: ReaderKeyConfig = {
  id: "gemini", name: "Gemini", title: "Google Gemini API key", tone: "leaf", heading: "Upload reading",
  about: "Admin only. The most accurate reader for match screenshots: when set, Gemini reads every scrim and tournament scoreboard, draft, Utility upload, document and sheet first. Groq and the main AI key step in automatically if Gemini is busy or refuses.",
  where: "aistudio.google.com/apikey", placeholder: "AIza…",
  savedNotice: "Gemini key saved. Match screenshots are read with it from now on.",
  removedNotice: "Gemini key removed. Uploads go back to the next reader.",
  billing: "Google's free tier has daily limits; paid keys bill by usage. Watch them in Google AI Studio.",
};
const GROQ_PANEL: ReaderKeyConfig = {
  id: "groq", name: "Groq", title: "Groq API key", tone: "sky",
  about: "Admin only. Backup reader: Groq's vision model reads uploads when there's no Gemini key or Gemini can't answer. The main AI key above stays as the last backup and still writes strategy and chat.",
  where: "console.groq.com/keys", placeholder: "gsk_…",
  savedNotice: "Groq key saved. Uploads are read with it from now on.",
  removedNotice: "Groq key removed. Uploads go back to the main AI key.",
  billing: "Groq bills by usage; watch your limits in the Groq console.",
};

/** Optional reading keys (Gemini first, Groq next): screenshots and documents for scrims, tournaments, Utility. */
function ReaderKeyPanel({ cfg }: { cfg: ReaderKeyConfig }) {
  const [status, setStatus] = useState<ReaderKeyStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test" | "remove">("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [check, setCheck] = useState<ReaderKeyCheck | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const secure = window.isSecureContext || ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const path = `/admin/integrations/${cfg.id}`;

  useEffect(() => {
    let active = true;
    api.get<ReaderKeyStatus>(path)
      .then((value) => { if (active) setStatus(value); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : `Could not load the ${cfg.name} settings.`); });
    return () => { active = false; };
  }, [path, cfg.name]);

  async function test() {
    setBusy("test"); setError(null); setCheck(null);
    try { setCheck(await api.post<ReaderKeyCheck>(`${path}/test`, {})); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not test the key."); }
    finally { setBusy(""); }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!key.trim() || busy || !secure) return;
    setBusy("save"); setError(null); setNotice(null); setCheck(null);
    try {
      const next = await api.post<ReaderKeyStatus>(path, { key: key.trim() });
      setKey(""); setStatus(next); setConfirmRemove(false);
      setNotice(cfg.savedNotice);
      setBusy("");
      void test();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the key."); setBusy(""); }
  }

  async function remove() {
    if (busy || !secure) return;
    setBusy("remove"); setError(null); setNotice(null); setCheck(null);
    try {
      const next = await api.del<ReaderKeyStatus>(path);
      setStatus(next); setConfirmRemove(false);
      setNotice(next.configured ? `Saved key removed. The server environment ${cfg.name} key is now in use.`
        : next.backup ? cfg.removedNotice : `${cfg.name} key removed.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove the key."); }
    finally { setBusy(""); }
  }

  const label = status?.source === "admin" ? `${cfg.name} on` : status?.source === "environment" ? "Server environment key" : status?.source === "unavailable" ? "Saved key locked" : "Off";
  const backupText = status?.backup_names?.length ? `Backup: ${status.backup_names.join(", then ")}` : status?.backup ? "Backup: main AI key ready" : "No backup key";
  const toneBox = cfg.tone === "leaf" ? "border-leaf/20 bg-leaf/10 text-leaf" : "border-sky/20 bg-sky/10 text-sky";
  const toneOn = cfg.tone === "leaf" ? "border-leaf/30 bg-leaf/10 text-leaf" : "border-sky/30 bg-sky/10 text-sky";
  return <section className="max-w-3xl" data-reader={cfg.id}>
    {cfg.heading && <SectionTitle>{cfg.heading}</SectionTitle>}
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div className="flex gap-3 items-start min-w-0"><div className={`rounded-lg border p-2 ${toneBox}`}>{cfg.id === "gemini" ? <Sparkles size={17} /> : <ScanEye size={17} />}</div>
          <div className="min-w-0"><h3 className="text-sm font-extrabold">{cfg.title}</h3><p className="mt-1 text-[11px] text-mute leading-relaxed">{cfg.about}</p></div></div>
        {status && <span className={`h-fit rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${status.configured ? toneOn : "border-edge bg-raised text-mute"}`}>{label}</span>}
      </div>
      {!status && !error && <Spinner label={`Loading the ${cfg.name} settings`} />}
      {status && <>
        {status.message && <div className="rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-[11px] text-amber">{status.message}</div>}
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-edge bg-raised px-2.5 py-1 text-mute">Model <b className="text-text break-all">{status.model}</b></span>
          <span className={`rounded-full border px-2.5 py-1 ${status.backup ? "border-leaf/30 bg-leaf/10 text-leaf" : "border-amber/30 bg-amber/10 text-amber"}`}>{backupText}</span>
        </div>
        <form onSubmit={save} className="space-y-2">
          <label htmlFor={`${cfg.id}-key`} className="label block">{status.has_saved_key || status.source === "environment" ? `Enter a new ${cfg.name} key to replace the current one` : `Paste your ${cfg.name} key (${cfg.where})`}</label>
          <div className="flex flex-wrap sm:flex-nowrap gap-2"><input id={`${cfg.id}-key`} className="input min-w-0 flex-1" type="password" autoComplete="off" spellCheck={false}
            value={key} onChange={(event) => setKey(event.target.value)} placeholder={status.configured ? "Existing key is hidden" : cfg.placeholder} maxLength={512} disabled={!!busy || !secure} />
            <button className="btn-primary shrink-0" disabled={!!busy || !key.trim() || !secure}>{busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} {status.has_saved_key || status.source === "environment" ? "Update key" : "Save key"}</button></div>
        </form>
        {status.configured && <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost !text-[11px]" onClick={() => void test()} disabled={!!busy}>{busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />} Test key</button>
          {check && <span role="status" className={`text-[11px] font-bold ${check.ok ? "text-leaf" : "text-amber"}`}>{check.message}</span>}
        </div>}
        <p className="flex items-start gap-2 text-[11px] text-faint leading-relaxed"><ShieldCheck size={14} className="shrink-0 text-leaf" /><span>Encrypted on the server and never shown again. The test only lists the models your key can use; no picture is sent. {cfg.billing}</span></p>
        {!secure && <div className="text-[11px] text-amber">Open the hub over HTTPS before entering a key.</div>}
        {status.has_saved_key && <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-3">
          {!confirmRemove ? <button type="button" className="btn-ghost !text-[11px]" onClick={() => setConfirmRemove(true)} disabled={!!busy || !secure}><Trash2 size={13} /> Remove {cfg.name} key</button>
            : <><span className="text-[11px] text-mute">Remove the {cfg.name} key?</span><button type="button" className="btn-ghost !text-[11px] text-crim" onClick={() => void remove()} disabled={!!busy}>Yes, remove</button><button type="button" className="btn-ghost !text-[11px]" onClick={() => setConfirmRemove(false)} disabled={!!busy}>Cancel</button></>}
        </div>}
      </>}
      {notice && <p role="status" className="text-[11px] font-bold text-leaf">{notice}</p>}
      <ErrorNote error={error} />
    </div>
  </section>;
}

interface DataRow { table: string; label: string; rows: number }

function DataWipePanel({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<DataRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<DataRow[]>("/admin/data-summary").then((r) => {
      setRows(r);
      setSelected(new Set(r.map((x) => x.table)));
    }).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  if (!isAdmin) return null;
  const chosen = rows?.filter((r) => selected?.has(r.table)) ?? [];
  const chosenRows = chosen.reduce((a, r) => a + r.rows, 0);

  function toggle(t: string) {
    setSelected((s) => {
      const n = new Set(s ?? []);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });
  }

  async function wipe() {
    setBusy(true); setErr(null);
    try {
      const res = await api.post<{ deleted: Record<string, number> }>("/admin/data-wipe",
        { tables: chosen.map((r) => r.table), confirm: true });
      const total = Object.values(res.deleted).reduce((a, n) => a + n, 0);
      setResult(`Wiped ${total} rows across ${chosen.length} table${chosen.length === 1 ? "" : "s"}. Accounts, heroes and the map guide were not touched.`);
      setConfirming(false);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Wipe failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <SectionTitle>Data management · danger zone</SectionTitle>
      <div className="card p-4 border-crim/30">
        <p className="text-[12.5px] text-mute leading-relaxed mb-3">
          Wipe operational data for a fresh start. <b className="text-text">Accounts, the hero database and the
          battlefield map guide are always kept</b> — everything else below can be cleared, including player data
          (pools, development, progress history).
        </p>
        {!rows && <Spinner />}
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {(rows ?? []).map((r) => (
            <label key={r.table} className="flex items-center gap-2.5 py-1 cursor-pointer select-none">
              <input type="checkbox" className="accent-crim w-3.5 h-3.5" checked={selected?.has(r.table) ?? false} onChange={() => toggle(r.table)} />
              <span className="text-[12.5px] text-text/90 flex-1">{r.label}</span>
              <span className={`text-[11px] font-bold tabular-nums ${r.rows ? "text-amber" : "text-faint"}`}>{r.rows}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-edge/70">
          <button className="btn-ghost !py-1.5 !text-[11.5px]" onClick={() => setSelected(new Set(rows?.map((r) => r.table) ?? []))}>Select all</button>
          <button className="btn-ghost !py-1.5 !text-[11.5px]" onClick={() => setSelected(new Set())}>Select none</button>
          <span className="text-[11.5px] text-faint">{chosen.length} selected · {chosenRows} rows</span>
          <button className="btn-primary !py-1.5 !text-[12px] ml-auto" disabled={!chosen.length || chosenRows === 0} onClick={() => setConfirming(true)}>
            <Trash2 size={13} /> Wipe selected data
          </button>
        </div>
        {result && <div className="text-leaf text-[12.5px] mt-3 font-semibold">{result}</div>}
        <ErrorNote error={err} />
      </div>

      {confirming && (
        <Modal title="Confirm data wipe" onClose={() => !busy && setConfirming(false)}>
          <div className="space-y-4">
            <p className="text-[13px] text-mute leading-relaxed">
              This permanently deletes <b className="text-crim">{chosenRows} rows</b> across{" "}
              <b className="text-crim">{chosen.length} tables</b>: {chosen.map((c) => c.label).join(", ")}.
              <br /><b className="text-leaf">Kept: accounts, heroes, map guide and team settings.</b>
            </p>
            <ErrorNote error={err} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn-primary !bg-crim" disabled={busy} onClick={wipe}>{busy ? "Wiping…" : "Yes — wipe it"}</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
