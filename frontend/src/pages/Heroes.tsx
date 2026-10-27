import { Plus, Search, ShieldBan, Users2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, qs } from "../lib/api";
import { guideForHero, heroIdFor, intel, pickStr, stripTags } from "../lib/mlbb";
import type { AnyRec } from "../lib/mlbb";
import type { Hero, Meta, User } from "../lib/types";
import { navigate, HERO_STATUS_STYLE } from "../lib/util";
import { Empty, ErrorNote, Field, Modal, PageTitle, Spinner, Tabs } from "../components/ui";
import { HeroImg } from "../components/HeroImg";

const TIER_TONE: Record<string, string> = {
  "S+": "text-crim border-crim/70 bg-crim/10", S: "text-crim border-crim/50", A: "text-amber border-amber/40",
  B: "text-sky border-sky/40", C: "text-mute border-edge-2", D: "text-faint border-edge",
};

const SORTS = [
  { id: "rating", label: "9C rating", key: (h: Hero) => h.clover_rating },
  { id: "win", label: "Win rate", key: (h: Hero) => h.win_rate },
  { id: "pick", label: "Pick rate", key: (h: Hero) => h.pick_rate },
  { id: "ban", label: "Ban rate", key: (h: Hero) => h.ban_rate },
] as const;

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
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("rating");
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
    const s = SORTS.find((x) => x.id === sort) ?? SORTS[0];
    for (const h of heroes ?? []) (g[h.role] ??= []).push(h);
    for (const list of Object.values(g)) list.sort((a, b) => s.key(b) - s.key(a) || a.name.localeCompare(b.name));
    return g;
  }, [heroes, sort]);

  if (id) {
    if (!detail) return <Spinner />;
    const h = detail;
    const p = h.profile ?? null;
    return (
      <div className="space-y-8 max-w-4xl">
        <button className="label !text-crim" onClick={() => navigate("heroes")}>← Hero database</button>

        {/* Majestic header: large icon, identity, verdicts */}
        <div className="flex flex-wrap items-start gap-6">
          <HeroImg name={h.name} size={96} eager className="rounded-lg border border-edge-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.9)]" />
          <div className="flex-1 min-w-56">
            <PageTitle title={h.name} sub={`${p ? `${p.title} · ` : ""}${h.role} · ${h.hero_class} · difficulty ${h.difficulty}/10 · patch ${h.patch}`} />
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

        {p && (
          <>
            {/* Full profile: identity, ratings, skills */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="card p-5">
                <div className="label mb-3">Identity</div>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-faint">Title</span><span className="font-semibold text-right">{p.title}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-faint">Roles</span>
                    <span className="flex flex-wrap gap-1.5 justify-end">{p.roles.map((x) => <span key={x} className="chip border-edge-2 text-text/85">{x}</span>)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-faint">Lanes</span>
                    <span className="flex flex-wrap gap-1.5 justify-end">{p.lanes.map((x) => <span key={x} className="chip border-edge-2 text-text/85">{x}</span>)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-faint">Specialties</span>
                    <span className="flex flex-wrap gap-1.5 justify-end">{p.specialties.map((x) => <span key={x} className="chip border-leaf/30 text-leaf/90">{x}</span>)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-faint">Released</span><span className="font-semibold">{p.release}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-faint">Skins</span><span className="font-semibold tabular-nums">{p.skins}</span></div>
                </div>
              </div>
              <div className="card p-5">
                <div className="label mb-3">Power profile</div>
                <div className="space-y-4">
                  {([["Offense", p.ratings.offense], ["Durability", p.ratings.durability],
                     ["Ability effects", p.ratings.ability_effects], ["Difficulty", p.ratings.difficulty]] as [string, number][]).map(([label, v]) => (
                    <div key={label}>
                      <div className="flex justify-between text-[11px] mb-1.5">
                        <span className="text-mute font-semibold uppercase tracking-[0.14em]">{label}</span>
                        <span className="font-extrabold tabular-nums">{v}/10</span>
                      </div>
                      <div className="flex gap-1">
                        {Array.from({ length: 10 }).map((_, i) => (
                          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < v ? (label === "Difficulty" ? "bg-amber" : "bg-crim") : "bg-raised border border-edge/60"}`} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <LiveSkillsCard heroName={h.name} fallbackNames={p.skills} />
            <SkillCombosCard heroName={h.name} />
            <SkillGuideCard heroName={h.name} />
          </>
        )}

        {form && <HeroForm meta={meta} initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageTitle title="Hero Database" sub={`Patch ${meta.season_patch} meta. Win/pick/ban rates: MLBBDex public stats (Oct 2026, CC BY-SA, Mobile Legends Wiki).`}
        right={canAdd && <button className="btn-primary" onClick={() => setForm({})}><Plus size={15} /> Add hero</button>} />
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input !w-56 !pl-8" placeholder="Search hero…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 ml-auto">
          <span className="label">Sort</span>
          <select className="input !w-36 !py-1.5" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
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
                    <span className={`absolute bottom-0 inset-x-0 h-0.5 ${h.meta_status === "META" ? "bg-crim/80" : h.meta_status === "STRONG" ? "bg-leaf/70" : "bg-transparent"}`} />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-1.5">
                    <div className="text-[12px] font-extrabold leading-tight truncate">{h.name}</div>
                    <span className="text-[11px] font-extrabold text-crim tabular-nums shrink-0">{h.clover_rating.toFixed(1)}</span>
                  </div>
                  <div className="text-[10px] text-faint truncate">{h.hero_class} · {h.win_rate.toFixed(1)}% WR · {h.pick_rate.toFixed(1)}% PK</div>
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

/* ---------- Official kit (Rone Arena hero detail: icons + descriptions) ---------- */

interface LiveSkill {
  skillid?: number; skillname?: string; skilldesc?: string; skillicon?: string;
  skillvideo?: string; skilltag?: { tagname?: string }[];
}
interface LiveSkillSet { skilllist?: LiveSkill[]; skilllistid?: string | number }
type HeroDetailRec = { data?: { heroskilllist?: LiveSkillSet[] } };

/** Fields may arrive as "@__data.skillname" style placeholders — resolve them against the
 *  skill item, then the record data (same pattern Rone uses for spells/equipment). */
function resolveField(v: unknown, roots: Record<string, unknown>[]): string {
  if (typeof v !== "string") return v == null ? "" : String(v);
  if (!v.startsWith("@")) return v;
  const parts = v.slice(1).split(".");
  for (const root of roots) {
    let cur: unknown = root;
    for (const p of parts) cur = (cur as Record<string, unknown> | undefined)?.[p];
    if (typeof cur === "string" && cur !== v) return cur;
  }
  // numbered siblings fallback: @__data.skillname → find any skillnameN near the parent
  for (const root of roots) {
    const parent = parts.slice(0, -1).reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], root);
    if (parent && typeof parent === "object") {
      const key = parts[parts.length - 1].replace(/\d+$/, "");
      const hit = Object.keys(parent as Record<string, unknown>).find((k) => k === key || (k.startsWith(key) && typeof (parent as Record<string, unknown>)[k] === "string"));
      if (hit) {
        const val = (parent as Record<string, unknown>)[hit];
        if (typeof val === "string" && val !== v) return val;
      }
    }
  }
  return "";
}

/** The official skilldesc carries MLBB's <font color="xxxxxx"> highlights. Convert them
 *  into real colored spans without ever trusting upstream HTML (strip unknown tags first). */
function SkillDesc({ text }: { text: string }) {
  const parts = text.split(/(<font color="?[0-9a-fA-F]{6}"?>|<\/font>)/g); // keep delimiters
  const nodes: ReactNode[] = [];
  let colored = false;
  let color = "";
  for (const chunk of parts) {
    const m = chunk.match(/^<font color="?([0-9a-fA-F]{6})"?>$/);
    if (m) { colored = true; color = m[1]; continue; }
    if (chunk === "</font>") { colored = false; continue; }
    const plain = stripTags(chunk);
    if (!plain) continue;
    nodes.push(colored
      ? <span key={nodes.length} style={{ color: `#${color}` }}>{plain}</span>
      : <span key={nodes.length}>{plain}</span>);
  }
  return <p className="text-[12px] text-mute leading-relaxed whitespace-pre-line">{nodes}</p>;
}

function skillKey(idx: number, total: number): string {
  if (idx === 0) return "P";
  if (idx === total - 1) return "ULT";
  return `S${idx}`;
}

type ResolvedSkill = { id?: number; name: string; desc: string; icon: string; cd: string; tags: string[]; tagsRgb: (string | undefined)[] };
type ResolvedKit = { listid?: string | number; skills: ResolvedSkill[] };

/** Upstream nesting has moved between releases (record.data.hero.data…). Search the record
 *  tree (depth ≤ 5) for the first heroskilllist array and return it with its container. */
function findKits(node: unknown, depth = 0): { kits: LiveSkillSet[]; host: AnyRec } | null {
  if (depth > 5 || !node || typeof node !== "object") return null;
  if (Array.isArray(node)) return null;
  const rec = node as AnyRec;
  const kits = rec.heroskilllist;
  if (Array.isArray(kits) && kits.length > 0) return { kits: kits as LiveSkillSet[], host: rec };
  for (const key of ["data", "hero"] as const) {
    const hit = Array.isArray(rec[key])
      ? findKits((rec[key] as unknown[])[0], depth + 1) ?? (rec[key] as unknown[]).reduce<ReturnType<typeof findKits>>((acc, el) => acc ?? findKits(el, depth + 1), null)
      : findKits(rec[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

function LiveSkillsCard({ heroName, fallbackNames }: { heroName: string; fallbackNames: string[] }) {
  const [sets, setSets] = useState<ResolvedKit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setSets(null); setErr(null);
    // intel() already unwraps the envelope — `d` IS { records, total }
    intel<{ records?: HeroDetailRec[] }>(`heroes/${encodeURIComponent(heroName)}`, { size: 1, index: 1, lang: "en" }, 30 * 60_000)
      .then((d) => {
        const rec = (d.records?.[0] ?? {}) as AnyRec;
        const found = findKits(rec);
        const heroData = found?.host ?? {};
        const kits = found?.kits ?? [];
        if (kits.length === 0) {
          console.warn("[skills] no heroskilllist found in hero detail — top keys:",
            Object.keys(rec).join(","), "— data keys:", rec.data ? Object.keys(rec.data as object).join(",") : "(none)");
        }
        const resolved: ResolvedKit[] = kits.map((k) => {
          const skills = ((k.skilllist ?? []) as (LiveSkill & Record<string, unknown>)[])
            .map((raw) => {
              // skill entries can themselves be wrapped ({ data: {...} }) at some releases
              const s = (raw.skillname !== undefined || raw.skillicon !== undefined ? raw
                : ((raw.data ?? Object.values(raw).find((v) => v && typeof v === "object")) ?? raw)) as LiveSkill & Record<string, unknown>;
              const roots: Record<string, unknown>[] = [s, heroData, rec];
              return {
                id: s.skillid,
                name: resolveField(s.skillname, roots).trim(),
                desc: resolveField(s.skilldesc, roots).trim(),
                icon: resolveField(s.skillicon, roots).trim(),
                cd: resolveField(s["skillcd&cost"], roots).trim(),
                tags: ((s.skilltag ?? []) as (Record<string, unknown>)[])
                  .map((t) => resolveField(t.tagname, [t, s, heroData, rec]).trim())
                  .filter(Boolean),
                tagsRgb: ((s.skilltag ?? []) as (Record<string, unknown>)[])
                  .map((t) => {
                    const rgb = resolveField(t.tagrgb, [t, s, heroData, rec]).trim();
                    return rgb || undefined;
                  }),
              } satisfies ResolvedSkill;
            })
            .filter((s) => s.name);
          return { listid: k.skilllistid, skills };
        }).filter((k) => k.skills.length > 0);
        setSets(resolved.length ? resolved : []);
      })
      .catch((e) => { setErr(e instanceof Error ? e.message : "Failed"); setSets(null); });
  }, [heroName]);
  useEffect(load, [load]);

  // Offline fallback: plain names, never fabricate icons/descriptions.
  const fallbackCard = (withRetry: boolean) => (
    <div className="card p-5">
      <div className="label mb-4 flex items-center justify-between">Skills
        {withRetry && <button className="btn-ghost !py-1 !text-[10.5px]" onClick={load}>Retry live kit</button>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {fallbackNames.map((s, i) => (
          <div key={`${s}-${i}`} className="flex items-center gap-3 bg-raised border border-edge/60 rounded-lg px-3.5 py-3">
            <span className="w-7 h-7 rounded bg-overlay border border-edge-2 flex items-center justify-center text-[10px] font-extrabold text-crim shrink-0">
              {i === 0 ? "P" : i === fallbackNames.length - 1 ? "ULT" : `S${i}`}
            </span>
            <span className="text-[13px] font-bold leading-tight">{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
  if (!sets) {
    if (err) return fallbackNames.length > 0 ? fallbackCard(true)
      : <div className="card p-5"><div className="label mb-2">Skills</div><div className="text-[11.5px] text-faint flex items-center justify-between gap-2">Live kit unavailable. <button className="btn-ghost !py-1 !text-[10.5px]" onClick={load}>Retry</button></div></div>;
    return <div className="card p-5"><div className="label">Skills</div><Spinner label="Loading official kit" /></div>;
  }
  if (sets.length === 0) return fallbackNames.length > 0 ? fallbackCard(true) : null;

  const multiForm = sets.length > 1;
  return (
    <div className="card p-5">
      <div className="label mb-4">Skills · official kit</div>
      <div className="space-y-5">
        {sets.map((kit, ki) => (
          <div key={kit.listid ?? ki} className={multiForm ? "space-y-2" : ""}>
            {multiForm && <div className="label !text-[9.5px]">Form {ki + 1}</div>}
            <div className="grid sm:grid-cols-2 gap-3">
              {kit.skills.map((s, si) => (
                <div key={s.id ?? si} className="flex gap-3 bg-raised border border-edge/60 rounded-lg px-3.5 py-3">
                  <span className="relative w-11 h-11 rounded-lg overflow-hidden bg-overlay border border-edge-2 shrink-0 grid place-items-center">
                    {s.icon ? (
                      <img src={s.icon} alt={s.name} width={44} height={44} loading="lazy" referrerPolicy="no-referrer"
                        className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <span className="text-[10px] font-extrabold text-crim">{skillKey(si, kit.skills.length)}</span>
                    )}
                    <span className="absolute bottom-0 right-0 px-1 rounded-tl-md bg-black/80 text-[8px] font-black text-crim">
                      {skillKey(si, Math.max(kit.skills.length, 2))}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="text-[13px] font-extrabold leading-tight truncate">{s.name}</span>
                      {s.cd ? <span className="text-[9.5px] text-faint font-semibold shrink-0 uppercase tracking-wide">{s.cd}</span> : null}
                    </span>
                    {s.tags.length > 0 && (
                      <span className="flex flex-wrap gap-1 mt-0.5">
                        {s.tags.map((t, ti) => (
                          <span key={ti} className="text-[8.5px] px-1.5 py-px rounded border border-edge-2 uppercase tracking-wide"
                            style={{ color: s.tagsRgb[ti] ? `#${s.tagsRgb[ti].replace(/^#/, "")}` : undefined }}>{t}</span>
                        ))}
                      </span>
                    )}
                    {s.desc && <span className="block mt-1"><SkillDesc text={s.desc} /></span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-faint mt-3">P = passive · S1/S2 = skills · ULT = ultimate. Icons, descriptions &amp; tags: live Rone Arena (Moonton) data.</div>
    </div>
  );
}

/* ---------- Live skill combos (Rone Arena official data, icons included) ---------- */

interface ComboSkill { data?: { skillid?: number; skillicon?: string } }
interface ComboRec { data?: { title?: string; desc?: string; skill_id?: ComboSkill[] } }

function SkillCombosCard({ heroName }: { heroName: string }) {
  const [rows, setRows] = useState<ComboRec[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setRows(null); setErr(null);
    intel<{ records?: ComboRec[] }>(`heroes/${encodeURIComponent(heroName)}/skill-combos`, { lang: "en" }, 30 * 60_000)
      .then((d) => setRows(d.records ?? []))
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed"));
  }, [heroName]);
  useEffect(load, [load]);
  if (err) return (
    <div className="card p-5">
      <div className="label mb-2">Skill combos · live game data</div>
      <div className="text-[11.5px] text-faint flex items-center justify-between gap-2">
        Data service unreachable. <button className="btn-ghost !py-1 !text-[10.5px]" onClick={load}>Retry</button>
      </div>
    </div>
  );
  if (!rows) return <div className="card p-5"><div className="label">Skill combos · live game data</div><Spinner label="Loading combos" /></div>;
  if (rows.length === 0) return null; // upstream simply has none for this hero
  const skills: { icon?: string; id?: number }[] = [];
  // dedupe icons in order of first appearance across all combos
  const seen = new Set<number>();
  for (const r of rows) for (const s of r.data?.skill_id ?? []) {
    const sk = s.data?.skillid;
    if (sk != null && !seen.has(sk)) { seen.add(sk); skills.push({ id: sk, icon: s.data?.skillicon }); }
  }
  return (
    <div className="card p-5">
      <div className="label mb-4">Skill combos · live game data</div>
      {skills.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {skills.map((s, i) => (
            <span key={s.id ?? i} className="w-10 h-10 rounded-lg bg-raised border border-edge overflow-hidden grid place-items-center" title={s.id != null ? `Skill #${s.id}` : undefined}>
              {s.icon
                ? <img src={s.icon} alt={s.id != null ? `Skill ${s.id}` : ""} width={40} height={40} loading="lazy" referrerPolicy="no-referrer" className="object-cover w-full h-full" onError={(e) => { const el = e.target as HTMLImageElement; el.style.display = "none"; }} />
                : <span className="text-[9px] font-extrabold text-faint">{s.id ?? "?"}</span>}
            </span>
          ))}
          <span className="text-[10px] text-faint ml-1">official skill icons</span>
        </div>
      )}
      <div className="space-y-3">
        {rows.map((r, i) => {
          const d = r.data ?? {};
          const seq = d.skill_id ?? [];
          return (
            <div key={i} className="bg-raised border border-edge/60 rounded-lg px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
                {d.title && <span className="chip border-crim/40 text-crim !text-[9px] uppercase">{d.title}</span>}
                {seq.length > 0 && (
                  <div className="flex items-center gap-1">
                    {seq.map((s, j) => (
                      <span key={j} className="flex items-center gap-1">
                        {s.data?.skillicon
                          ? <img src={s.data.skillicon} alt="" width={26} height={26} loading="lazy" referrerPolicy="no-referrer" className="rounded-md border border-edge-2 bg-overlay" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          : <span className="w-6 h-6 rounded-md bg-overlay border border-edge-2 grid place-items-center text-[8px] font-extrabold text-faint">{s.data?.skillid ?? "?"}</span>}
                        {j < seq.length - 1 && <span className="text-faint text-[11px]">→</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {d.desc && <div className="text-[12px] text-mute leading-relaxed">{stripTags(d.desc)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Official guide strengths & weaknesses (academy/recommended) ---------- */

function SkillGuideCard({ heroName }: { heroName: string }) {
  const [loaded, setLoaded] = useState(false);
  const [strength, setStrength] = useState<string>("");
  const [weakness, setWeakness] = useState<string>("");
  useEffect(() => {
    setLoaded(false); setStrength(""); setWeakness("");
    const id = heroIdFor(heroName);
    if (!id) { setLoaded(true); return; }
    let live = true;
    guideForHero(id)
      .then((g) => {
        if (!live) return;
        if (g) {
          const hero = (g.hero ?? {}) as AnyRec;
          setStrength(pickStr(hero, "hero_strength") ?? "");
          setWeakness(pickStr(hero, "hero_weakness") ?? "");
        }
        setLoaded(true);
      })
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [heroName]);
  if (!loaded || (!strength && !weakness)) return null; // no guide upstream — stay silent, never fabricate
  return (
    <div className="card p-5">
      <div className="label mb-4">Coach notes · official guide</div>
      <div className="grid sm:grid-cols-2 gap-3">
        {strength && (
          <div className="bg-leaf/5 border border-leaf/30 rounded-lg px-4 py-3">
            <div className="label !text-leaf mb-1.5">Strengths</div>
            <p className="text-[11.5px] text-mute whitespace-pre-line leading-relaxed">{stripTags(strength).replace(/✨/g, "• ")}</p>
          </div>
        )}
        {weakness && (
          <div className="bg-crim/5 border border-crim/30 rounded-lg px-4 py-3">
            <div className="label !text-crim mb-1.5">Weaknesses</div>
            <p className="text-[11.5px] text-mute whitespace-pre-line leading-relaxed">{stripTags(weakness).replace(/✨/g, "• ")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
