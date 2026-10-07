import { Plus, UserCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Meta, Settings, User } from "../lib/types";
import { Badge, ErrorNote, Field, Modal, PageTitle, SectionTitle, Spinner } from "../components/ui";

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
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    api.get<User[]>("/admin/users").then(setUsers).catch(() => setUsers([]));
    api.get<Settings>("/admin/settings").then((s) => setSettingsDraft(s)).catch(() => setSettingsDraft(null));
  }, []);
  useEffect(load, [load]);

  if (me.role !== "admin") {
    return <PageTitle title="Team Admin" sub="Admin access only." />;
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settingsDraft) return;
    await api.patch("/admin/settings", settingsDraft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Team Admin" sub="Accounts, roles and the team-wide focus state."
        right={<button className="btn-primary" onClick={() => setForm({})}><Plus size={15} /> New account</button>} />

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

      {settingsDraft && (
        <section className="max-w-xl">
          <SectionTitle>Team focus (dashboard)</SectionTitle>
          <form onSubmit={saveSettings} className="card p-4 space-y-4">
            <Field label="Season label">
              <input className="input" value={settingsDraft.season_name} onChange={(e) => setSettingsDraft({ ...settingsDraft, season_name: e.target.value })} />
            </Field>
            <Field label="Current team weakness">
              <input className="input" value={settingsDraft.current_weakness} onChange={(e) => setSettingsDraft({ ...settingsDraft, current_weakness: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Weakness drill category">
                <select className="input" value={settingsDraft.weakness_category} onChange={(e) => setSettingsDraft({ ...settingsDraft, weakness_category: e.target.value })}>
                  {meta.activity_categories.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Drills required">
                <input className="input" type="number" min={0} value={settingsDraft.weakness_drills_target}
                  onChange={(e) => setSettingsDraft({ ...settingsDraft, weakness_drills_target: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="flex items-center gap-3">
              <button className="btn-primary">Save focus</button>
              {saved && <span className="text-leaf text-[12.5px] font-bold">Saved</span>}
            </div>
          </form>
        </section>
      )}

      {form && <UserForm meta={meta} initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}
