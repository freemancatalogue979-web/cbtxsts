import { Plus, ShieldBan, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { Ban, Hero, Meta, User } from "../lib/types";
import { navigate } from "../lib/util";
import { Empty, ErrorNote, Field, Modal, PageTitle, SectionTitle, Spinner } from "../components/ui";
import { HeroImg } from "../components/HeroImg";

function BanForm({ heroes, meta, initial, onSaved, onClose }: {
  heroes: Hero[]; meta: Meta; initial: Partial<Ban>; onSaved: () => void; onClose: () => void;
}) {
  const edit = Boolean(initial.id);
  const [f, setF] = useState<Record<string, unknown>>({
    scope: initial.scope ?? "standard", priority: initial.priority ?? 1,
    opponent: initial.opponent ?? "", patch: initial.patch ?? meta.season_patch,
    hero_id: initial.hero_id ?? "", hero_name: initial.hero_name ?? "",
    reason: initial.reason ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = { ...f, priority: Number(f.priority) || null, hero_id: f.hero_id === "" ? null : Number(f.hero_id) };
    try {
      if (edit) await api.patch(`/bans/${initial.id}`, body);
      else await api.post("/bans", body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  return (
    <Modal title={edit ? "Edit ban entry" : "New ban entry"} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Scope">
            <select className="input" value={String(f.scope)} onChange={(e) => set("scope", e.target.value)}>
              <option value="standard">Standard ban</option>
              <option value="opponent">Opponent-specific</option>
              <option value="patch">Patch-specific</option>
            </select>
          </Field>
          <Field label="Priority">
            <select className="input" value={Number(f.priority)} onChange={(e) => set("priority", e.target.value)}>
              {[1, 2, 3].map((p) => <option key={p} value={p}>Priority {p}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Hero">
          <div className="flex items-center gap-3">
            <HeroImg name={String(f.hero_name || "?")} size={44} className="rounded-lg shrink-0" />
            <select className="input" value={String(f.hero_id)} onChange={(e) => {
              const hero = heroes.find((h) => h.id === Number(e.target.value));
              set("hero_id", e.target.value);
              if (hero) set("hero_name", hero.name);
            }}>
              <option value="">Custom / not in database…</option>
              {heroes.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.role})</option>)}
            </select>
          </div>
        </Field>
        {!f.hero_id && (
          <Field label="Hero name"><input className="input" required value={String(f.hero_name)} onChange={(e) => set("hero_name", e.target.value)} /></Field>
        )}
        {f.scope === "opponent" && (
          <Field label="Opponent"><input className="input" required value={String(f.opponent)} onChange={(e) => set("opponent", e.target.value)} placeholder="Team X" /></Field>
        )}
        {f.scope === "patch" && (
          <Field label="Patch"><input className="input" required value={String(f.patch)} onChange={(e) => set("patch", e.target.value)} /></Field>
        )}
        <Field label="Reason"><textarea className="input min-h-16" required value={String(f.reason)} onChange={(e) => set("reason", e.target.value)} placeholder="Why does this hero leave the pool?" /></Field>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary">{edit ? "Save" : "Add ban"}</button>
        </div>
      </form>
    </Modal>
  );
}

function BanCard({ ban, heroMap, canManage, onToggle, onEdit, onDelete }: {
  ban: Ban; heroMap: Map<number, Hero>; canManage: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const hero = ban.hero_id ? heroMap.get(ban.hero_id) : undefined;
  return (
    <div className={`card p-4 ${ban.active ? "" : "opacity-45"}`}>
      <div className="flex items-center gap-3">
        <HeroImg name={ban.hero_name} size={44} className="rounded-lg shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <button className="text-sm font-extrabold hover:text-crim truncate" onClick={() => hero && navigate("heroes", hero.id)}>
              {ban.hero_name}
            </button>
            <span className="chip !text-[10px] text-crim border-crim/40 shrink-0">P{ban.priority ?? "—"}</span>
          </div>
          <div className="text-[11px] text-faint mt-0.5">{hero ? `${hero.role} · ${hero.meta_status}` : ""}</div>
        </div>
      </div>
      <p className="text-[12.5px] text-mute mt-2.5 leading-relaxed">{ban.reason}</p>
      {canManage && (
        <div className="flex gap-2 mt-2.5">
          <button className="text-[11px] text-faint hover:text-text" onClick={onEdit}>Edit</button>
          <button className="text-[11px] text-faint hover:text-text" onClick={onToggle}>{ban.active ? "Deactivate" : "Reactivate"}</button>
          <button className="text-[11px] text-faint hover:text-crim" title="Delete"
            onClick={() => void onDelete()}><Trash2 size={12} /></button>
        </div>
      )}
    </div>
  );
}

export function BansPage({ me, meta }: { me: User; meta: Meta }) {
  const canManage = ["admin", "captain", "coach"].includes(me.role);
  const [bans, setBans] = useState<Ban[] | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [form, setForm] = useState<null | Partial<Ban>>(null);

  const load = useCallback(() => {
    api.get<Ban[]>("/bans?include_inactive=true").then(setBans).catch(() => setBans([]));
    api.get<Hero[]>("/heroes").then(setHeroes).catch(() => setHeroes([]));
  }, []);
  useEffect(load, [load]);

  const heroMap = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes]);
  const byScope = useMemo(() => {
    const g: Record<string, Ban[]> = { standard: [], opponent: [], patch: [] };
    for (const b of bans ?? []) (g[b.scope] ??= []).push(b);
    return g;
  }, [bans]);

  const groupedOpponents = useMemo(() => {
    const g: Record<string, Ban[]> = {};
    for (const b of byScope.opponent ?? []) (g[b.opponent || "Unknown"] ??= []).push(b);
    return g;
  }, [byScope]);

  const cardProps = (b: Ban) => ({
    ban: b, heroMap, canManage,
    onToggle: async () => { await api.patch(`/bans/${b.id}`, { active: !b.active }); load(); },
    onEdit: () => setForm(b),
    onDelete: async () => { if (confirm(`Delete ${b.hero_name} ban${b.opponent ? ` vs ${b.opponent}` : ""}?`)) { await api.del(`/bans/${b.id}`); load(); } },
  });

  return (
    <div className="space-y-6">
      <PageTitle title="Ban Board" sub={`What leaves the pool — every phase, patch ${meta.season_patch}.`}
        right={canManage && <button className="btn-primary" onClick={() => setForm({})}><Plus size={15} /> Add ban</button>} />

      <section>
        <SectionTitle>Our standard bans</SectionTitle>
        {!bans && <Spinner />}
        <div className="grid sm:grid-cols-3 gap-3">
          {(byScope.standard ?? []).filter((b) => b.active).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).map((b) => (
            <BanCard key={b.id} {...cardProps(b)} />
          ))}
          {bans && (byScope.standard ?? []).filter((b) => b.active).length === 0 && <Empty title="No standard bans" />}
        </div>
      </section>

      <section>
        <SectionTitle>Opponent-specific bans</SectionTitle>
        <div className="space-y-4">
          {Object.entries(groupedOpponents).map(([opp, list]) => (
            <div key={opp}>
              <div className="label mb-2 flex items-center gap-2"><ShieldBan size={12} className="text-crim" /> {opp}</div>
              <div className="grid sm:grid-cols-3 gap-3">
                {list.map((b) => <BanCard key={b.id} {...cardProps(b)} />)}
              </div>
            </div>
          ))}
          {bans && Object.keys(groupedOpponents).length === 0 && <Empty title="No opponent files yet" />}
        </div>
      </section>

      <section>
        <SectionTitle>Patch-specific bans</SectionTitle>
        <div className="grid sm:grid-cols-3 gap-3">
          {(byScope.patch ?? []).map((b) => <BanCard key={b.id} {...cardProps(b)} />)}
          {bans && (byScope.patch ?? []).length === 0 && <Empty title="No patch bans" />}
        </div>
        {bans && (byScope.standard ?? []).some((b) => !b.active) && (
          <div className="mt-4">
            <div className="label mb-2">Inactive</div>
            <div className="grid sm:grid-cols-3 gap-3">
              {(bans ?? []).filter((b) => !b.active).map((b) => <BanCard key={b.id} {...cardProps(b)} />)}
            </div>
          </div>
        )}
      </section>

      {form && <BanForm heroes={heroes} meta={meta} initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}
