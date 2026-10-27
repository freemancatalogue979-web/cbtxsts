import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Crown, RefreshCw, Search, Sparkles, Swords, TrendingUp } from "lucide-react";
import { Badge, Empty, ErrorNote, Field, Modal, PageTitle, SectionTitle, Spinner, Tabs } from "../components/ui";
import { heroRecords, intel, intelRaw, pct, rankRecords, recData, digRecords, stripTags, pickStr, pickNum, RANK_DAYS, RANK_TIERS } from "../lib/mlbb";
import type { AnyRec, IntelHero, RankRecord, Records } from "../lib/mlbb";
import { heroSlug } from "../components/HeroImg";

type SortField = "win_rate" | "pick_rate" | "ban_rate";

const BOARDS: { field: SortField; title: string; tone: string; icon: typeof Crown }[] = [
  { field: "win_rate", title: "Top win rate", tone: "text-leaf", icon: Crown },
  { field: "pick_rate", title: "Top pick rate", tone: "text-sky", icon: TrendingUp },
  { field: "ban_rate", title: "Top ban rate", tone: "text-crim", icon: Swords },
];

function rateOf(r: RankRecord, f: SortField): number {
  return f === "win_rate" ? r.main_hero_win_rate : f === "pick_rate" ? r.main_hero_appearance_rate : r.main_hero_ban_rate;
}

/** Hero portrait — official CDN head shot, initials fallback. */
function Head({ url, name, size = 30 }: { url?: string; name?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="flex items-center justify-center bg-overlay border border-edge rounded-md text-[10px] font-extrabold text-mute"
        style={{ width: size, height: size }}>
        {(name ?? "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
      </div>
    );
  }
  return <img src={url} alt={name ?? "hero"} width={size} height={size} loading="lazy" referrerPolicy="no-referrer"
    className="rounded-md border border-edge object-cover" onError={() => setFailed(true)} />;
}

function Board({ field, title, tone, icon: Icon, rows, onPick }: {
  field: SortField; title: string; tone: string; icon: typeof Crown;
  rows: RankRecord[]; onPick: (heroId: number) => void;
}) {
  const max = Math.max(0.0001, ...rows.map((r) => rateOf(r, field)));
  return (
    <div className="card p-4">
      <div className={`flex items-center gap-2 mb-3 ${tone}`}>
        <Icon size={14} />
        <span className="label !text-[10px] !text-current">{title}</span>
      </div>
      <ol className="space-y-2">
        {rows.map((r, i) => {
          const name = r.main_hero?.data?.name ?? `#${r.main_heroid}`;
          const val = rateOf(r, field);
          return (
            <li key={r.main_heroid}>
              <button type="button" className="w-full flex items-center gap-2.5 group" onClick={() => onPick(r.main_heroid)} title={`Open ${name}`}>
                <span className="text-faint text-[10px] font-black w-4 tabular-nums">{i + 1}</span>
                <Head url={r.main_hero?.data?.head} name={name} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-bold truncate group-hover:text-leaf">{name}</span>
                    <span className={`text-[11px] font-extrabold tabular-nums ${tone}`}>{pct(val)}</span>
                  </span>
                  <span className="block h-1 mt-1 rounded bg-raised overflow-hidden">
                    <span className={`block h-full rounded ${field === "win_rate" ? "bg-leaf/70" : field === "pick_rate" ? "bg-sky/70" : "bg-crim/70"}`}
                      style={{ width: `${Math.max(4, (val / max) * 100)}%` }} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <li className="text-[12px] text-faint">No records in this window.</li>}
      </ol>
    </div>
  );
}

function HeroModal({ hero, byId, onClose }: { hero: IntelHero; byId: Map<number, IntelHero>; onClose: () => void }) {
  const data = hero.hero?.data ?? {};
  const name = data.name ?? `Hero ${hero.hero_id}`;
  const rel = (key: "strong" | "weak" | "assist") =>
    (hero.relation?.[key]?.target_hero_id ?? []).map((id) => byId.get(id)?.hero?.data?.name ?? `#${id}`);
  const section = (title: string, names: string[], cls: string) => (
    <div>
      <div className="label mb-1.5">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {names.length === 0 && <span className="text-[12px] text-faint">None listed upstream.</span>}
        {names.map((n) => (
          <span key={n} className={`chip ${cls} inline-flex items-center gap-1.5`}>
            <img src={`/heroes/${heroSlug(n)}.webp`} alt="" width={16} height={16} className="rounded"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            {n}
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <Modal title={name} onClose={onClose}>
      <div className="flex items-center gap-3 mb-4">
        <Head url={data.head} name={name} size={64} />
        <div>
          <div className="text-lg font-extrabold">{name}</div>
          <div className="text-[11px] text-faint">Hero ID {hero.hero_id}</div>
        </div>
      </div>
      <div className="space-y-4">
        {section("Strong against", rel("strong"), "text-leaf border-leaf/40")}
        {section("Weak against", rel("weak"), "text-crim border-crim/40")}
        {section("Pairs well with", rel("assist"), "text-sky border-sky/40")}
      </div>
      <p className="mt-5 text-[11px] text-faint leading-relaxed">
        Relations from the community dataset. Per-hero statistics, skill combos and builds load on this page next phase.
      </p>
    </Modal>
  );
}

/** Generic remote reference-data tab: fetch records, search, render compact cards. */
function ReferenceGrid({ path, searchKeys, iconKeys, titleKeys, descKeys }: {
  path: string; searchKeys: string[]; iconKeys: string[]; titleKeys: string[]; descKeys: string[];
}) {
  const [rows, setRows] = useState<AnyRec[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    intel<AnyRec>(path, { size: 300, index: 1 }, 10 * 60_000)
      .then((d) => {
        let rows = recData<AnyRec>(d as unknown as Records<AnyRec>);
        if (rows.length === 0) {
          // payload isn't records-shaped (emblems/spells nest under custom keys) —
          // dig for the first array of objects, then unwrap one .data level if present
          const dug = digRecords(d);
          rows = dug.map((r) => (typeof r.data === "object" && r.data !== null ? { ...(r.data as AnyRec) } : r));
        }
        setRows(rows);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed"));
  }, [path]);
  if (err) return <ErrorNote error={err} />;
  if (!rows) return <Spinner label="Loading" />;
  const needle = q.trim().toLowerCase();
  const list = needle ? rows.filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle))
    || String(pickStr(r as AnyRec, ...searchKeys) ?? "").toLowerCase().includes(needle)) : rows;
  return (
    <div>
      <div className="relative mb-4 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.length === 0 ? <Empty title="Nothing matches" /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((r, i) => {
            const emblem = (r.emblemskill ?? undefined) as AnyRec | undefined;
            const inner = (r.__data ?? undefined) as AnyRec | undefined;
            const title = pickStr(r, ...titleKeys) ?? pickStr(emblem, ...titleKeys) ?? pickStr(inner, ...titleKeys) ?? `#${pickNum(r, "equipid", "id", "_object") ?? i}`;
            const desc = pickStr(r, ...descKeys) ?? pickStr(emblem, ...descKeys) ?? pickStr(inner, ...descKeys);
            const icon = pickStr(r, ...iconKeys) ?? pickStr(emblem, ...iconKeys) ?? pickStr(inner, ...iconKeys);
            return (
              <div key={i} className="card p-3.5 flex items-start gap-3">
                {icon ? <img src={icon} alt="" width={42} height={42} loading="lazy" referrerPolicy="no-referrer"
                  className="rounded-lg border border-edge object-cover shrink-0 bg-raised"
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} /> : null}
                <div className="min-w-0">
                  <div className="text-[13px] font-bold truncate">{title}</div>
                  {desc && <div className="text-[11.5px] text-mute mt-1 leading-relaxed">{stripTags(desc)}</div>}
                  {pickStr(r, "numdescribe") && <Badge cls="text-leaf border-leaf/40 mt-1.5">{pickStr(r, "numdescribe")}</Badge>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BuildsTab({ byId }: { byId: Map<number, IntelHero> }) {
  const [rows, setRows] = useState<{ id: unknown; data: AnyRec }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    intel<Records<AnyRec>>("academy/recommended", { size: 60, index: 1 })
      .then((d) => setRows((d.records ?? []).map((r) => ({ id: (r as AnyRec & { id?: unknown }).id, data: r.data ?? {} }))))
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed"));
  }, []);
  if (err) return <ErrorNote error={err} />;
  if (!rows) return <Spinner label="Loading recommended builds" />;
  if (rows.length === 0) return <Empty title="No recommended builds published upstream right now" />;
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {rows.map((r, i) => {
        const inner = (r.data.data ?? undefined) as AnyRec | undefined;
        const cooperates = Array.isArray(inner?.cooperates) ? inner!.cooperates as AnyRec[] : [];
        const heroId = pickNum(r.data, "hero_id") ?? pickNum(inner, "hero_id", "heroid");
        const heroName = heroId ? byId.get(heroId)?.hero?.data?.name : undefined;
        const title = pickStr(r.data, "title", "name") ?? pickStr(inner, "title", "name") ?? (heroName ? `${heroName} setup` : `Build #${i + 1}`);
        return (
          <div key={String(r.id ?? i)} className="card p-4">
            <div className="flex items-center gap-2.5 mb-2">
              {heroName
                ? <img src={`/heroes/${heroSlug(heroName)}.webp`} alt={heroName} width={34} height={34} className="rounded-lg border border-edge" />
                : <Sparkles size={18} className="text-amber" />}
              <div>
                <div className="text-[13px] font-extrabold truncate">{stripTags(title)}</div>
                {heroName && <div className="text-[10px] text-faint">for {heroName}</div>}
              </div>
            </div>
            {cooperates.length > 0 && (
              <ul className="space-y-1.5 mt-2">
                {cooperates.slice(0, 3).map((c, j) => (
                  <li key={j} className="text-[11.5px] text-mute leading-relaxed">
                    <span className="text-leaf font-bold">{byId.get(pickNum(c, "cooperate_hero_id") ?? -1)?.hero?.data?.name ?? "Synergy"}: </span>
                    {stripTags(String(c.cooperate_desc ?? ""))}
                  </li>
                ))}
              </ul>
            )}
            <div className="text-[10px] text-faint mt-2">Upstream recommended set — equipment/emblem detail page next phase.</div>
          </div>
        );
      })}
    </div>
  );
}

function ToolsTab() {
  const [matches, setMatches] = useState("500");
  const [wrNow, setWrNow] = useState("52");
  const [wrTarget, setWrTarget] = useState("60");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await intelRaw<Record<string, unknown>>("addon/win-rate-calculator", {
        "match-now": Number(matches) || 0, "wr-now": Number(wrNow) || 0, "wr-future": Number(wrTarget) || 0,
      });
      setResult(r);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Calculation failed"); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
      <form onSubmit={run} className="card p-5 space-y-4">
        <div className="flex items-center gap-2 text-amber"><Calculator size={15} /><span className="label !text-[10px] !text-current">Win-rate calculator</span></div>
        <Field label="Matches played"><input className="input" inputMode="numeric" value={matches} onChange={(e) => setMatches(e.target.value)} /></Field>
        <Field label="Current win rate %"><input className="input" inputMode="decimal" value={wrNow} onChange={(e) => setWrNow(e.target.value)} /></Field>
        <Field label="Target win rate %"><input className="input" inputMode="decimal" value={wrTarget} onChange={(e) => setWrTarget(e.target.value)} /></Field>
        <ErrorNote error={err} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Calculating…" : "Calculate"}</button>
      </form>
      {result && (
        <div className="card p-5 border-amber/40">
          <div className="label !text-[10px] !text-amber mb-2">Result</div>
          <div className="text-3xl font-black text-leaf tabular-nums">{String(result.required_no_lose_matches ?? "—")}</div>
          <div className="label !text-[9px] mb-3">consecutive wins needed</div>
          <p className="text-[12.5px] text-mute leading-relaxed">{String(result.message ?? "")}</p>
        </div>
      )}
    </div>
  );
}

export function IntelPage() {
  const [tab, setTab] = useState("overview");
  const [days, setDays] = useState<number>(7);
  const [rank, setRank] = useState<string>("all");
  const [boards, setBoards] = useState<Record<SortField, RankRecord[]>>({ win_rate: [], pick_rate: [], ban_rate: [] });
  const [heroes, setHeroes] = useState<IntelHero[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const loadHeroes = useCallback(async () =>
    heroRecords(await intel<Records<IntelHero>>("heroes", { size: 300, index: 1, order: "asc" }, 5 * 60_000)), []);
  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const [win, pick, ban, list] = await Promise.all([
        intel<Records<RankRecord>>("heroes/rank", { days, rank, sort_field: "win_rate", sort_order: "desc", size: 8, index: 1 }),
        intel<Records<RankRecord>>("heroes/rank", { days, rank, sort_field: "pick_rate", sort_order: "desc", size: 8, index: 1 }),
        intel<Records<RankRecord>>("heroes/rank", { days, rank, sort_field: "ban_rate", sort_order: "desc", size: 8, index: 1 }),
        loadHeroes(),
      ]);
      setBoards({ win_rate: rankRecords(win), pick_rate: rankRecords(pick), ban_rate: rankRecords(ban) });
      setHeroes(list);
      setFetchedAt(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load intel");
    } finally {
      setBusy(false);
    }
  }, [days, rank, loadHeroes]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    intel<Records<AnyRec>>("academy/meta/version", {}, 30 * 60_000)
      .then((d) => setVersion(recData<AnyRec>(d)[0]?.game_version as string | undefined ?? null))
      .catch(() => setVersion(null));
  }, []);

  const byId = useMemo(() => new Map(heroes.map((h) => [h.hero_id, h])), [heroes]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = [...heroes].sort((a, b) => (a.hero?.data?.name ?? "").localeCompare(b.hero?.data?.name ?? ""));
    return needle ? base.filter((h) => (h.hero?.data?.name ?? "").toLowerCase().includes(needle)) : base;
  }, [heroes, q]);
  const openHero = openId !== null ? byId.get(openId) ?? null : null;

  const tabs = [
    { id: "overview", label: "Overview" }, { id: "heroes", label: "Heroes" },
    { id: "builds", label: "Builds" }, { id: "equipment", label: "Equipment" },
    { id: "emblems", label: "Emblems" }, { id: "spells", label: "Spells" },
    { id: "ranks", label: "Ranks" }, { id: "tools", label: "Tools" },
  ];

  return (
    <div className="space-y-6">
      <PageTitle title="MLBB Intel" sub="Live hero analytics & game database — community Rone Arena dataset (not official Moonton)."
        right={<div className="flex items-center gap-2">
          {version && <Badge cls="text-sky border-sky/40">game v{version}</Badge>}
          <button className="btn-ghost" onClick={() => { void load(); }} disabled={busy}><RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Refresh</button>
        </div>} />

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {(tab === "overview" || tab === "heroes") && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="label flex items-center gap-2">Window
            <select className="input !w-auto !py-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {RANK_DAYS.map((d) => <option key={d} value={d}>Last {d}d</option>)}
            </select>
          </label>
          <label className="label flex items-center gap-2">Rank
            <select className="input !w-auto !py-1 capitalize" value={rank} onChange={(e) => setRank(e.target.value)}>
              {RANK_TIERS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {fetchedAt && <span className="text-[11px] text-faint ml-auto">Fetched {fetchedAt.toLocaleTimeString()}</span>}
        </div>
      )}

      <ErrorNote error={err && `${err} — the upstream data service may be unreachable from this host; Refresh retries.`} />

      {tab === "overview" && (busy && !fetchedAt ? <Spinner label="Pulling live hero analytics" /> : (
        <div className="grid md:grid-cols-3 gap-4">
          {BOARDS.map((b) => <Board key={b.field} {...b} rows={boards[b.field]} onPick={setOpenId} />)}
        </div>
      ))}

      {tab === "heroes" && (
        <section>
          <SectionTitle right={<Badge cls="text-faint border-edge">{filtered.length} heroes</Badge>}>Hero encyclopedia</SectionTitle>
          <div className="relative mt-3 mb-4 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input !pl-8" placeholder="Search heroes…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {filtered.length === 0 ? <Empty title={heroes.length ? "No heroes match" : "No hero data loaded"} hint={heroes.length ? "Clear the search" : "Check the data connection above"} /> : (
            <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-8 gap-2.5">
              {filtered.map((h) => {
                const name = h.hero?.data?.name ?? `#${h.hero_id}`;
                const local = `/heroes/${heroSlug(name)}.webp`;
                return (
                  <button key={h.hero_id} type="button" onClick={() => setOpenId(h.hero_id)}
                    className="card card-hover p-2.5 flex flex-col items-center gap-2 text-center">
                    <img src={h.hero?.data?.head ?? local} alt={name} width={56} height={56} loading="lazy" referrerPolicy="no-referrer"
                      className="rounded-lg border border-edge object-cover"
                      onError={(e) => { const img = e.target as HTMLImageElement; if (!img.src.endsWith(local)) img.src = local; else img.style.visibility = "hidden"; }} />
                    <span className="text-[11px] font-bold leading-tight truncate w-full">{name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab === "equipment" && <ReferenceGrid path="academy/equipment" searchKeys={["equipname"]} iconKeys={["equipicon", "icon"]} titleKeys={["equipname", "name"]} descKeys={["description", "itemdesc", "desc"]} />}
      {tab === "emblems" && <ReferenceGrid path="academy/emblems" searchKeys={["emblemname", "skillname"]} iconKeys={["emblemicon", "skillicon", "icon"]} titleKeys={["emblemname", "skillname", "name"]} descKeys={["skilldesc", "skilldescemblem", "description"]} />}
      {tab === "spells" && <ReferenceGrid path="academy/spells" searchKeys={["skillname", "name"]} iconKeys={["skillicon", "icon"]} titleKeys={["skillname", "name"]} descKeys={["skilldesc", "description"]} />}
      {tab === "ranks" && <ReferenceGrid path="academy/ranks" searchKeys={["bigrank_name", "minrank_name"]} iconKeys={["icon"]} titleKeys={["bigrank_name", "name"]} descKeys={["minrank_name", "description"]} />}
      {tab === "builds" && <BuildsTab byId={byId} />}
      {tab === "tools" && <ToolsTab />}

      {openHero && <HeroModal hero={openHero} byId={byId} onClose={() => setOpenId(null)} />}

      <p className="text-[10.5px] text-faint leading-relaxed border-t border-edge/60 pt-3">
        Data source: community-maintained Rone Arena API for MLBB — unaffiliated with Moonton. Leaderboards use the
        selected window ({days}d) and rank tier ({rank}); rates shown as percentages of upstream fractions.
      </p>
    </div>
  );
}
