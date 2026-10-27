import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, RefreshCw, Search, Swords, TrendingUp } from "lucide-react";
import { Badge, Empty, ErrorNote, Modal, PageTitle, SectionTitle, Spinner } from "../components/ui";
import { fraction, heroRecords, intel, pct, rankRecords, RANK_DAYS, RANK_TIERS } from "../lib/mlbb";
import type { IntelHero, RankRecord, Records } from "../lib/mlbb";
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
  return <img src={url} alt={name ?? "hero"} width={size} height={size} loading="lazy"
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

function HeroModal({ hero, byId, onClose }: {
  hero: IntelHero; byId: Map<number, IntelHero>; onClose: () => void;
}) {
  const data = hero.hero?.data ?? {};
  const name = data.name ?? `Hero ${hero.hero_id}`;
  const rel = (key: "strong" | "weak" | "assist") =>
    (hero.relation?.[key]?.target_hero_id ?? [])
      .map((id) => byId.get(id)?.hero?.data?.name ?? `#${id}`);
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
        Relations come from the community Rone Arena dataset. Full analytics (stats, trends, combos,
        counters) land in the next Intel phase.
      </p>
    </Modal>
  );
}

export function IntelPage() {
  const [days, setDays] = useState<number>(7);
  const [rank, setRank] = useState<string>("all");
  const [boards, setBoards] = useState<Record<SortField, RankRecord[]>>({ win_rate: [], pick_rate: [], ban_rate: [] });
  const [heroes, setHeroes] = useState<IntelHero[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const [win, pick, ban, list] = await Promise.all([
        intel<Records<RankRecord>>("heroes/rank", { days, rank, sort_field: "win_rate", sort_order: "desc", size: 8, index: 1 }),
        intel<Records<RankRecord>>("heroes/rank", { days, rank, sort_field: "pick_rate", sort_order: "desc", size: 8, index: 1 }),
        intel<Records<RankRecord>>("heroes/rank", { days, rank, sort_field: "ban_rate", sort_order: "desc", size: 8, index: 1 }),
        intel<Records<IntelHero>>("heroes", { size: 200, index: 1, order: "asc" }, 5 * 60_000),
      ]);
      setBoards({ win_rate: rankRecords(win), pick_rate: rankRecords(pick), ban_rate: rankRecords(ban) });
      setHeroes(heroRecords(list));
      setFetchedAt(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load intel");
    } finally {
      setBusy(false);
    }
  }, [days, rank]);
  useEffect(() => { void load(); }, [load]);

  const byId = useMemo(() => new Map(heroes.map((h) => [h.hero_id, h])), [heroes]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = [...heroes].sort((a, b) => (a.hero?.data?.name ?? "").localeCompare(b.hero?.data?.name ?? ""));
    return needle ? base.filter((h) => (h.hero?.data?.name ?? "").toLowerCase().includes(needle)) : base;
  }, [heroes, q]);

  const openHero = openId !== null ? byId.get(openId) ?? null : null;

  return (
    <div className="space-y-6">
      <PageTitle title="MLBB Intel" sub="Live hero analytics — community Rone Arena dataset (not official Moonton data)."
        right={<button className="btn-ghost" onClick={() => { void load(); }} disabled={busy}><RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Refresh</button>} />

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

      <ErrorNote error={err && `${err} — the upstream data service may be unreachable from this host; Refresh retries.`} />

      {busy && !fetchedAt ? <Spinner label="Pulling live hero analytics" /> : (
        <>
          <section>
            <SectionTitle>Leaderboards</SectionTitle>
            <div className="grid md:grid-cols-3 gap-4 mt-3">
              {BOARDS.map((b) => <Board key={b.field} {...b} rows={boards[b.field]} onPick={setOpenId} />)}
            </div>
          </section>

          <section>
            <SectionTitle right={<Badge cls="text-faint border-edge">{filtered.length} heroes</Badge>}>Hero encyclopedia</SectionTitle>
            <div className="relative mt-3 mb-4 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input className="input !pl-8" placeholder="Search heroes…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {filtered.length === 0 ? <Empty title="No heroes match" hint="Clear the search" /> : (
              <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-8 gap-2.5">
                {filtered.map((h) => {
                  const name = h.hero?.data?.name ?? `#${h.hero_id}`;
                  const local = `/heroes/${heroSlug(name)}.webp`;
                  return (
                    <button key={h.hero_id} type="button" onClick={() => setOpenId(h.hero_id)}
                      className="card card-hover p-2.5 flex flex-col items-center gap-2 text-center">
                      <img src={h.hero?.data?.head ?? local} alt={name} width={56} height={56} loading="lazy"
                        className="rounded-lg border border-edge object-cover"
                        onError={(e) => { const img = e.target as HTMLImageElement; if (!img.src.endsWith(local)) img.src = local; else img.style.visibility = "hidden"; }} />
                      <span className="text-[11px] font-bold leading-tight truncate w-full">{name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {openHero && <HeroModal hero={openHero} byId={byId} onClose={() => setOpenId(null)} />}

      <p className="text-[10.5px] text-faint leading-relaxed border-t border-edge/60 pt-3">
        Data source: community-maintained Rone Arena API for MLBB — unaffiliated with Moonton. Metrics use the
        selected window ({days}d) and rank tier ({rank}); rates are shown as percentages of upstream fractions.
      </p>
    </div>
  );
}
