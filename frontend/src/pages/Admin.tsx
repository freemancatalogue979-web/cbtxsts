import { KeyRound, Loader2, Plus, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Meta, User } from "../lib/types";
import { Badge, ErrorNote, Field, Modal, PageTitle, SectionTitle, Spinner } from "../components/ui";
import { TeamFocusPanel } from "../components/TeamFocusPanel";

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
          <Field label="In-game name"><input className="input" value={String(f.ign)} onChange={(e) => set("ign", e.target.value.toUpperCase())} placeholder="KAZE" /></Field>
        </div>
        <Field label="Email"><input className="input" type="email" required value={String(f.email)} onChange={(e) => set("email", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Platform role">
            <select className="input" value={String(f.role)} onChange={(e) => set("role", e.target.value)}>
              {Object.entries(meta.roles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
          <Field label="Main lane (players)">
            <select className="input" value={String(f.main_role)} onChange={(e) => set("main_role", e.target.value)}>
              <option value="">—</option>
              {meta.lanes.map((l) => <option key={l}>{l}</option>)}
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

      <section>
        <SectionTitle>Accounts</SectionTitle>
        {!users && <Spinner />}
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr><th className="th">Member</th><th className="th">Email</th><th className="th">Role</th><th className="th">Lane</th><th className="th">Roster</th><th className="th">Status</th><th className="th"></th></tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id} className="hover:bg-raised/60">
                  <td className="td"><span className="font-bold">{u.ign || u.name}</span> <span className="text-faint text-[11px]">{u.name}</span></td>
                  <td className="td text-mute text-[12.5px]">{u.email}</td>
                  <td className="td"><Badge cls={u.role === "admin" ? "text-crim border-crim/40" : "text-mute"}>{u.role_label}</Badge></td>
                  <td className="td text-[12.5px]">{u.main_role || "—"}</td>
                  <td className="td text-[12.5px]">{u.roster ? "yes" : "—"}</td>
                  <td className="td">{u.active ? <span className="text-leaf text-[12px] font-bold">active</span> : <span className="text-crim text-[12px] font-bold">disabled</span>}</td>
                  <td className="td text-right">
                    <button className="text-faint hover:text-text" onClick={() => setForm(u)}><UserCog size={15} /></button>
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
