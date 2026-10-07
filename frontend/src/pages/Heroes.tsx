import { Plus, Search, ShieldBan, Users2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, qs } from "../lib/api";
import type { Hero, Meta, User } from "../lib/types";
import { navigate, HERO_STATUS_STYLE } from "../lib/util";
import { Empty, ErrorNote, Field, Modal, PageTitle, Spinner, Tabs } from "../components/ui";
import { HeroImg } from "../components/HeroImg";

const TIER_TONE: Record<string, string> = {
  S: "text-crim border-crim/50", A: "text-amber border-amber/40",
  B: "text-sky border-sky/40", C: "text-mute border-edge-2", D: "text-faint border-edge",
};
const TIER_DOT: Record<string, string> = {
  S: "bg-crim", A: "bg-amber", B: "bg-sky", C: "bg-mute", D: "bg-raised",
};

function HeroForm({ meta, initial, onSaved, onClose }: {
  meta: Meta; initial: Partial<Hero>; onSaved: () => void; onClose: () => void;
}) {
  const edit = Boolean(initial.id);
  const [f, setF] = useState<Record<string, unknown>>({
    name: initial.name ?? "", role: initial.role ?? "EXP", hero_class: initial.hero_class ?? "",
    difficulty: initial.difficulty ?? 5, meta_status: initial.meta_status ?? "VIABLE",
    tier: initial.tier ?? "A", patch: initial.patch ?? meta.season_patch,
    win_rate: initial.win_rate ?? 50, pick_rate: initial.pick_rate ?? 5, ban_rate: initial.ban_rate ?? 5,
    clover_rating: initial.clover_rating ?? 5, notes: initial.notes ?? "",
    strong_against: (initial.strong_against ?? []).join(", "),
    weak_against: (initial.weak_against ?? []).join(", "),
    synergy: (initial.synergy ?? []).join(", "),
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const list = (s: unknown) => String(s).split(",").map((x) => x.trim()).filter(Boolean);
    const body = { ...f, strong_against: list(f.strong_against), weak_against: list(f.weak_against), synergy: list(f.synergy) };
    try {
      if (edit) await api.patch(`/heroes/${initial.id}`, body);
      else await api.post("/heroes", body);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  const rate = (k: string, label: string, step = 0.1) => (
    <label className="block" key={k}>
      <span className="label block mb-1">{label}</span>
      <input className="input !px-2" type="number" step={step} value={Number(f[k])} onChange={(e) => set(k, Number(e.target.value))} />
    </label>
  );

  return (
    <Modal title={edit ? `Edit ${initial.name}` : "Add hero"} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Name"><input className="input" required value={String(f.name)} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Role">
            <select className="input" value={String(f.role)} onChange={(e) => set("role", e.target.value)}>
              {meta.lanes.map((l) => <option key={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Class"><input className="input" value={String(f.hero_class)} onChange={(e) => set("hero_class", e.target.value)} /></Field>
          {rate("difficulty", "Difficulty 1-10", 1)}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Meta status">
            <select className="input" value={String(f.meta_status)} onChange={(e) => set("meta_status", e.target.value)}>
              {meta.hero_statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Tier">
            <select className="input" value={String(f.tier)} onChange={(e) => set("tier", e.target.value)}>
              {meta.hero_tiers.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Patch"><input className="input" value={String(f.patch)} onChange={(e) => set("patch", e.target.value)} /></Field>
          {rate("clover_rating", "9 CLOVER /10")}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {rate("win_rate", "Win rate %")}{rate("pick_rate", "Pick rate %")}{rate("ban_rate", "Ban rate %")}
        </div>
        <Field label="Notes"><textarea className="input min-h-20" value={String(f.notes)} onChange={(e) => set("notes", e.target.value)} /></Field>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Strong against" hint="comma separated"><input className="input" value={String(f.strong_against)} onChange={(e) => set("strong_against", e.target.value)} /></Field>
          <Field label="Weak against"><input className="input" value={String(f.weak_against)} onChange={(e) => set("weak_against", e.target.value)} /></Field>
          <Field label="Team synergy"><input className="input" value={String(f.synergy)} onChange={(e) => set("synergy", e.target.value)} /></Field>
        </div>
        <ErrorNote error={err} />
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary">{edit ? "Save" : "Add hero"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Hero face chip used inside counter/synergy lists. */
function HeroChip({ name, tone }: { name: string; tone: string }) {
  return (
    <span className={`chip !py-0.5 !pl-0.5 !pr-2 border-current/25 ${tone}`}>
      <HeroImg name={name} size={20} className="rounded" />
      {name}
    </span>
  );
}

export function HeroesPage({ me, meta, parts }: { me: User; meta: Meta; parts: string[] }) {
  const canAdd = me.role === "admin";
  const canAnnotate = ["admin", "coach"].includes(me.role);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [heroes, setHeroes] = useState<Hero[] | null>(null);
  const [detail, setDetail] = useState<Hero | null>(null);
  const [form, setForm] = useState<null | Partial<Hero>>(null);
  const id = parts[0] ? Number(parts[0]) : null;

  const load = useCallback(() => {
    api.get<Hero[]>(`/heroes${qs({ q: q || undefined, role: role || undefined })}`).then(setHeroes).catch(() => setHeroes([]));
    if (id) api.get<Hero>(`/heroes/${id}`).then(setDetail).catch(() => setDetail(null));
  }, [q, role, id]);
  useEffect(load, [load]);

  const grouped = useMemo(() => {
    const g: Record<string, Hero[]> = {};
    for (const h of heroes ?? []) (g[h.role] ??= []).push(h);
    return g;
  }, [heroes]);

  if (id) {
    if (!detail) return <Spinner />;
    const h = detail;
    return (
      <div className="space-y-8 max-w-4xl">
        <button className="label !text-crim" onClick={() => navigate("heroes")}>← Hero database</button>

        {/* Majestic header: large icon, identity, verdicts */}
        <div className="flex flex-wrap items-start gap-6">
          <HeroImg name={h.name} size={96} eager className="rounded-lg border border-edge-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.9)]" />
          <div className="flex-1 min-w-56">
            <PageTitle title={h.name} sub={`${h.role} · ${h.hero_class} · difficulty ${h.difficulty}/10 · patch ${h.patch}`} />
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className={`chip ${HERO_STATUS_STYLE[h.meta_status] ?? "text-mute"}`}>{h.meta_status}</span>
              <span className={`chip ${TIER_TONE[h.tier] ?? ""}`}>Tier {h.tier}</span>
              {canAnnotate && <button className="btn-ghost !py-1.5 !text-[12px]" onClick={() => setForm(h)}>Edit</button>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[["Win rate", `${h.win_rate.toFixed(1)}%`], ["Pick rate", `${h.pick_rate.toFixed(1)}%`],
            ["Ban rate", `${h.ban_rate.toFixed(1)}%`], ["9 CLOVER rating", `${h.clover_rating.toFixed(1)}/10`]].map(([l, v]) => (
            <div key={l} className="card p-4">
              <div className="label">{l}</div>
              <div className="text-xl font-extrabold mt-1.5 tabular-nums">{v}</div>
              {l === "9 CLOVER rating" && (
                <div className="flex gap-0.5 mt-3">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <span key={i} className={`h-1 flex-1 rounded-full ${i < Math.round(h.clover_rating) ? "bg-crim" : "bg-raised border border-edge/60"}`} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {h.notes && <div className="card p-5"><div className="label mb-2.5">Notes</div><p className="text-sm text-text/85 leading-relaxed whitespace-pre-wrap">{h.notes}</p></div>}

        <div className="grid sm:grid-cols-3 gap-4">
          {([["Strong against", h.strong_against, "text-leaf"], ["Weak against", h.weak_against, "text-crim"], ["Team synergy", h.synergy, "text-sky"]] as [string, string[], string][]).map(([label, list, cls]) => (
            <div key={label} className="card p-5">
              <div className="label mb-3">{label}</div>
              <div className="flex flex-wrap gap-2">
                {list.length === 0 && <span className="text-faint text-sm">—</span>}
                {list.map((x) => <HeroChip key={x} name={x} tone={cls} />)}
              </div>
            </div>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="label mb-4 flex items-center gap-1.5"><Users2 size={12} /> Player specialists</div>
            {(h.specialists ?? []).length === 0 && <div className="text-sm text-faint">Nobody has {h.name} in their pool.</div>}
            <div className="space-y-1">
              {(h.specialists ?? []).map((s) => (
                <button key={s.user_id} onClick={() => navigate("players", s.user_id)} className="w-full flex items-center justify-between text-left hover:bg-raised rounded-lg px-3 py-2.5 transition-colors">
                  <span className="text-sm font-semibold">{s.ign} <span className="text-faint text-[11px] font-medium">{s.main_role}</span></span>
                  <span className="text-[11px] text-mute">{s.category} · conf {s.confidence}/10{s.win_rate != null ? ` · ${s.win_rate}% WR` : ""}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <div className="label mb-4 flex items-center gap-1.5"><ShieldBan size={12} /> On the ban board</div>
            {(h.on_ban_board ?? []).length === 0 && <div className="text-sm text-faint">Not currently banned by us.</div>}
            <div className="space-y-2.5">
              {(h.on_ban_board ?? []).map((b, i) => (
                <div key={i} className="text-[13px] leading-relaxed">
                  <span className="font-bold text-crim uppercase">{b.scope === "standard" ? `Standard P${b.priority}` : b.scope === "opponent" ? `vs ${b.opponent}` : `Patch ${b.patch}`}</span>
                  <span className="text-mute"> — {b.reason}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {form && <HeroForm meta={meta} initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageTitle title="Hero Database" sub={`Patch ${meta.season_patch} meta, internal ratings and counter notes.`}
        right={canAdd && <button className="btn-primary" onClick={() => setForm({})}><Plus size={15} /> Add hero</button>} />
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !w-56 !pl-8" placeholder="Search hero…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Tabs value={role} onChange={setRole} tabs={[{ id: "", label: "All" }, ...meta.lanes.map((l) => ({ id: l, label: l }))]} />
      {!heroes && <Spinner />}
      <div className="space-y-10">
        {Object.entries(grouped).map(([lane, list]) => (
          <section key={lane}>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-[13px] font-extrabold uppercase tracking-[0.22em]">{lane}</h2>
              <span className="text-[11px] font-bold text-faint tabular-nums">{list.length}</span>
              <span className="h-px flex-1 bg-edge/70" />
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-x-5 gap-y-6">
              {list.map((h) => (
                <button key={h.id} onClick={() => navigate("heroes", h.id)} className="group text-left">
                  <div className="relative rounded-lg overflow-hidden border border-edge/80 group-hover:border-crim/50 transition-all duration-200 group-hover:shadow-[0_10px_30px_-10px_rgba(225,29,72,0.35)] group-hover:-translate-y-0.5">
                    <HeroImg name={h.name} size={140} className="w-full !h-auto aspect-square group-hover:scale-[1.04] transition-transform duration-300" />
                    <span className={`absolute top-1.5 right-1.5 w-5 h-5 rounded flex items-center justify-center text-[10px] font-extrabold bg-black/70 backdrop-blur-sm border ${TIER_TONE[h.tier] ?? "border-edge-2"}`}>
                      {h.tier}
                    </span>
                    <span className={`absolute bottom-1.5 left-1.5 w-1.5 h-1.5 rounded-full ${TIER_DOT[h.tier] ?? ""} hidden`} />
                    <span className={`absolute bottom-0 inset-x-0 h-0.5 ${h.meta_status === "META" ? "bg-crim/80" : h.meta_status === "STRONG" ? "bg-leaf/70" : "bg-transparent"}`} />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-1.5">
                    <div className="text-[12px] font-extrabold leading-tight truncate">{h.name}</div>
                    <span className="text-[11px] font-extrabold text-crim tabular-nums shrink-0">{h.clover_rating.toFixed(1)}</span>
                  </div>
                  <div className="text-[10px] text-faint truncate">{h.hero_class}</div>
                </button>
              ))}
            </div>
          </section>
        ))}
        {heroes && heroes.length === 0 && <Empty title="No heroes match" />}
      </div>
      {form && <HeroForm meta={meta} initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </div>
  );
}
