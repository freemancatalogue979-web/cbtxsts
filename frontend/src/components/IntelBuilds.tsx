/**
 * MLBB Intel → Builds.
 *
 * Pick a hero (modal picker) → the lanes it's played in → the builds ranked players actually win with:
 * six items, emblem + talents and battle spell, each with its win rate and how often it's used.
 * Tap anything for its description. Under that: community guides for the hero (or trending guides
 * when no hero is picked), opened in a full readable guide.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, Eye, Flame, Shield, Sparkles, Swords, ThumbsUp, Trophy, Users } from "lucide-react";
import { api } from "../lib/api";
import { intel, type IntelHero } from "../lib/mlbb";
import {
  BUILD_RANKS, LANE_LABEL, compact, groupNotes, guides, heroLanes, itemCatalog, rankedBuilds, ratePct, sortBuilds,
  spellCatalog, talentCatalog, type BuildRank, type BuildSort, type Guide, type ItemInfo, type RankedBuild, type SpellInfo, type TalentInfo,
} from "../lib/builds";
import type { Hero } from "../lib/types";
import { navigate } from "../lib/util";
import { HeroImg } from "./HeroImg";
import { HeroPickerModal } from "./HeroPicker";
import { Empty, ErrorNote, Modal, Spinner } from "./ui";

const LONG = 30 * 60_000;
const STORE = "intel.builds.hero";
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const errText = (e: unknown) => (e instanceof Error ? e.message : "Couldn't load that right now");
const rankLabel = (r: BuildRank) => (r === "all" ? "All ranks" : r.charAt(0).toUpperCase() + r.slice(1));
const winTone = (f?: number) => (f === undefined ? "text-mute" : f >= 0.55 ? "text-leaf" : f >= 0.5 ? "text-amber" : "text-danger");

type Detail = { title: string; icon?: string; sub?: string; body?: string; extra?: string };

interface Catalogs { items: Map<number, ItemInfo>; spells: Map<number, SpellInfo>; talents: Map<number, TalentInfo> }

function useCatalogs(): Catalogs {
  const [items, setItems] = useState<Map<number, ItemInfo>>(new Map());
  const [spells, setSpells] = useState<Map<number, SpellInfo>>(new Map());
  const [talents, setTalents] = useState<Map<number, TalentInfo>>(new Map());
  useEffect(() => {
    intel<unknown>("academy/equipment/expanded", { size: 400, index: 1 }, LONG).then((d) => setItems(itemCatalog(d))).catch(() => undefined);
    intel<unknown>("academy/spells", { size: 100, index: 1 }, LONG).then((d) => setSpells(spellCatalog(d))).catch(() => undefined);
    intel<unknown>("academy/emblems", { size: 200, index: 1 }, LONG).then((d) => setTalents(talentCatalog(d))).catch(() => undefined);
  }, []);
  return { items, spells, talents };
}

/** A game icon from the official CDN, with a tidy letter tile when it's missing. */
function GameIcon({ src, name, size = 40, round = false }: { src?: string; name: string; size?: number; round?: boolean }) {
  const [failed, setFailed] = useState(false);
  const shape = round ? "rounded-full" : "rounded-lg";
  if (!src || failed) {
    return (
      <span className={`grid place-items-center ${shape} border border-edge bg-raised text-[10px] font-extrabold text-mute shrink-0`} style={{ width: size, height: size }} aria-hidden="true">
        {name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}
      </span>
    );
  }
  return <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
    className={`${shape} border border-edge bg-raised object-cover shrink-0`} style={{ width: size, height: size }} />;
}

/** Six item tiles; tap one for what it does. */
function ItemRow({ ids, items, onOpen, size = "md" }: { ids: number[]; items: Map<number, ItemInfo>; onOpen: (d: Detail) => void; size?: "sm" | "md" }) {
  const slots = [...ids.slice(0, 6), ...Array(Math.max(0, 6 - ids.length)).fill(0)] as number[];
  return (
    <ol className={`grid grid-cols-6 ${size === "sm" ? "gap-1" : "gap-1.5 sm:gap-2"}`} aria-label="Items in build order">
      {slots.map((id, i) => {
        const it = id ? items.get(id) : undefined;
        const name = it?.name ?? (id ? "Item" : "");
        return (
          <li key={`${id}-${i}`} className="min-w-0">
            {id ? (
              <button type="button" className="build-item group w-full flex flex-col items-center gap-1 text-center"
                title={name} aria-label={`${i + 1}. ${name}`}
                onClick={() => onOpen({ title: name, icon: it?.icon, sub: it?.kind, body: it?.desc, extra: it?.stats })}>
                <span className="relative block w-full aspect-square">
                  {it?.icon
                    ? <img src={it.icon} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full rounded-lg border border-edge bg-raised object-cover group-hover:border-crim transition"
                        onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                    : <span className="absolute inset-0 grid place-items-center rounded-lg border border-edge bg-raised text-[9px] text-faint">{i + 1}</span>}
                  <span className="build-item__n" aria-hidden="true">{i + 1}</span>
                </span>
                {size === "md" && <span className="text-[9.5px] leading-tight text-mute line-clamp-2 w-full break-words">{name}</span>}
              </button>
            ) : <span className="block w-full aspect-square rounded-lg border border-dashed border-edge" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

function Chip({ icon, name, label, onClick, round = true }: { icon?: string; name: string; label?: string; onClick?: () => void; round?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="build-chip inline-flex items-center gap-1.5 min-w-0 max-w-full rounded-full border border-edge bg-raised pl-1 pr-2.5 py-1 text-left hover:border-crim transition">
      <GameIcon src={icon} name={name} size={22} round={round} />
      <span className="min-w-0">
        {label && <span className="block text-[8.5px] leading-none text-faint">{label}</span>}
        <span className="block text-[11px] font-bold truncate">{name}</span>
      </span>
    </button>
  );
}

function BuildCard({ build, rank, cat, onOpen, top }: { build: RankedBuild; rank: number; cat: Catalogs; onOpen: (d: Detail) => void; top: number }) {
  const use = build.pickRate ?? 0;
  return (
    <article className={`card build-card p-3 sm:p-4 space-y-3 ${rank === 1 ? "build-card--top" : ""}`}>
      <header className="flex items-center gap-3">
        <span className="build-rank" aria-label={`Build ${rank}`}>{rank === 1 ? <Trophy size={14} /> : rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-[20px] font-black tabular-nums leading-none ${winTone(build.winRate)}`}>{ratePct(build.winRate)}</span>
            <span className="text-[10.5px] text-faint">win rate</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 flex-1 max-w-[180px] rounded-full bg-raised overflow-hidden" aria-hidden="true">
              <span className="block h-full rounded-full bg-sky" style={{ width: `${top > 0 ? Math.max(4, (use / top) * 100) : 0}%` }} />
            </span>
            <span className="text-[10.5px] text-mute tabular-nums">used in {ratePct(build.pickRate)} of games</span>
          </div>
        </div>
      </header>
      <ItemRow ids={build.items} items={cat.items} onOpen={onOpen} />
      <div className="flex flex-wrap gap-1.5">
        {build.spell && <Chip label="Spell" icon={build.spell.icon} name={build.spell.name}
          onClick={() => onOpen({ title: build.spell!.name, icon: build.spell!.icon, sub: build.spell!.short ?? "Battle spell", body: build.spell!.desc })} />}
        {build.emblem && <Chip label="Emblem" icon={build.emblem.icon} name={build.emblem.name}
          onClick={() => onOpen({ title: `${build.emblem!.name} emblem`, icon: build.emblem!.icon, sub: "Emblem", body: build.emblem!.bonus.join("\n") || undefined })} />}
        {build.talents.map((id) => {
          const t = cat.talents.get(id);
          return t ? <Chip key={id} label="Talent" icon={t.icon} name={t.name} onClick={() => onOpen({ title: t.name, icon: t.icon, sub: "Talent", body: t.desc })} /> : null;
        })}
      </div>
    </article>
  );
}

function heroName(byId: Map<number, IntelHero>, id?: number) {
  return id !== undefined ? byId.get(id)?.hero?.data?.name : undefined;
}

function Faces({ ids, byId }: { ids: number[]; byId: Map<number, IntelHero> }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const name = heroName(byId, id);
        return name ? (
          <button key={id} type="button" onClick={() => navigate("heroes", id)} title={`Open ${name}`}
            className="inline-flex items-center gap-1 rounded-full border border-edge bg-raised pl-0.5 pr-2 py-0.5 text-[10.5px] font-bold hover:border-crim">
            <HeroImg name={name} size={20} className="rounded-full" /> {name}
          </button>
        ) : null;
      })}
    </span>
  );
}

function GuideCard({ g, byId, cat, onOpen }: { g: Guide; byId: Map<number, IntelHero>; cat: Catalogs; onOpen: () => void }) {
  const name = heroName(byId, g.heroId);
  return (
    <button type="button" onClick={onOpen} className="card card-hover p-3 text-left w-full min-w-0 space-y-2.5">
      <div className="flex items-start gap-2.5 min-w-0">
        {name ? <HeroImg name={name} size={40} className="rounded-lg border border-edge shrink-0" /> : <BookOpen size={20} className="text-amber shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-extrabold leading-snug line-clamp-2">{g.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-faint">
            {name && <span className="text-mute font-bold">{name}{g.lane ? ` · ${LANE_LABEL[g.lane]}` : ""}</span>}
            {g.author && <span>by {g.author}</span>}
            {g.views !== undefined && <span className="inline-flex items-center gap-0.5"><Eye size={10} /> {compact(g.views)}</span>}
            {g.votes !== undefined && <span className="inline-flex items-center gap-0.5"><ThumbsUp size={10} /> {compact(g.votes)}</span>}
            {g.version && <span>v{g.version}</span>}
          </div>
        </div>
      </div>
      {g.builds[0] && <div className="pointer-events-none"><ItemRow ids={g.builds[0].items} items={cat.items} onOpen={() => undefined} size="sm" /></div>}
    </button>
  );
}

function Para({ text }: { text?: string }) {
  return text ? <p className="text-[12px] text-mute leading-relaxed whitespace-pre-line break-words">{text}</p> : null;
}

function Block({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-[12px] font-extrabold">{icon} {title}</h4>
      {children}
    </section>
  );
}

function GuideView({ g, byId, cat, onOpen, onClose, onBuilds }: {
  g: Guide; byId: Map<number, IntelHero>; cat: Catalogs; onOpen: (d: Detail) => void; onClose: () => void; onBuilds?: (name: string) => void;
}) {
  const name = heroName(byId, g.heroId);
  const spell = g.spell?.id !== undefined ? cat.spells.get(g.spell.id) : undefined;
  const [more, setMore] = useState(false);
  return (
    <Modal title={g.title} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-faint">
          {name && <span className="inline-flex items-center gap-1.5 text-mute font-bold"><HeroImg name={name} size={24} className="rounded-md" /> {name}{g.lane ? ` · ${LANE_LABEL[g.lane]}` : ""}</span>}
          {g.author && <span>by {g.author}</span>}
          {g.views !== undefined && <span className="inline-flex items-center gap-0.5"><Eye size={11} /> {compact(g.views)} views</span>}
          {g.votes !== undefined && <span className="inline-flex items-center gap-0.5"><ThumbsUp size={11} /> {compact(g.votes)}</span>}
          {g.version && <span>game v{g.version}</span>}
          {name && onBuilds && <button type="button" className="btn-ghost !py-1 !px-2 !text-[10.5px] ml-auto" onClick={() => onBuilds(name)}><Swords size={12} /> Ranked builds for {name}</button>}
        </div>

        {g.builds.map((b, i) => (
          <Block key={i} icon={<Swords size={13} className="text-crim" />} title={b.title ?? (g.builds.length > 1 ? `Build ${i + 1}` : "Build")}>
            <ItemRow ids={b.items} items={cat.items} onOpen={onOpen} />
            <Para text={b.notes} />
          </Block>
        ))}

        {(g.emblems.length > 0 || g.spell) && (
          <div className="grid sm:grid-cols-2 gap-4">
            {g.emblems.map((e, i) => (
              <Block key={i} icon={<Sparkles size={13} className="text-amber" />} title={e.title ?? "Emblem"}>
                <div className="flex flex-wrap gap-1.5">
                  {e.talents.map((id) => {
                    const t = cat.talents.get(id);
                    return t ? <Chip key={id} label="Talent" icon={t.icon} name={t.name} onClick={() => onOpen({ title: t.name, icon: t.icon, sub: "Talent", body: t.desc })} /> : null;
                  })}
                </div>
                <Para text={e.notes} />
              </Block>
            ))}
            {g.spell && (
              <Block icon={<Flame size={13} className="text-sky" />} title={spell ? `Spell: ${spell.name}` : "Spell"}>
                {spell && <Chip label="Spell" icon={spell.icon} name={spell.name} onClick={() => onOpen({ title: spell.name, icon: spell.icon, sub: spell.short ?? "Battle spell", body: spell.desc })} />}
                <Para text={g.spell.notes} />
              </Block>
            )}
          </div>
        )}

        {g.phases.length > 0 && (
          <Block icon={<Trophy size={13} className="text-leaf" />} title="How to play it">
            <ol className="grid sm:grid-cols-3 gap-2">
              {g.phases.map((p, i) => (
                <li key={i} className="rounded-xl border border-edge bg-raised p-2.5">
                  <div className="text-[11px] font-extrabold text-leaf mb-1">{p.title || `Phase ${i + 1}`}</div>
                  <p className="text-[11.5px] text-mute leading-relaxed whitespace-pre-line">{p.text}</p>
                </li>
              ))}
            </ol>
          </Block>
        )}

        {(g.partners.length > 0 || g.counters.length > 0) && (
          <div className="grid sm:grid-cols-2 gap-4">
            {g.partners.length > 0 && (
              <Block icon={<Users size={13} className="text-leaf" />} title="Plays well with">
                {groupNotes(g.partners).map((n, i) => <div key={i} className="space-y-1.5"><Faces ids={n.heroIds} byId={byId} /><Para text={n.text} /></div>)}
              </Block>
            )}
            {g.counters.length > 0 && (
              <Block icon={<Shield size={13} className="text-danger" />} title="Watch out for">
                {groupNotes(g.counters).map((n, i) => <div key={i} className="space-y-1.5"><Faces ids={n.heroIds} byId={byId} /><Para text={n.text} /></div>)}
              </Block>
            )}
          </div>
        )}

        {(g.strengths || g.weaknesses) && (
          <div className="grid sm:grid-cols-2 gap-4">
            {g.strengths && <Block icon={<ThumbsUp size={13} className="text-leaf" />} title="Strengths"><Para text={g.strengths} /></Block>}
            {g.weaknesses && <Block icon={<Shield size={13} className="text-danger" />} title="Weaknesses"><Para text={g.weaknesses} /></Block>}
          </div>
        )}

        {g.overview && (
          <Block icon={<BookOpen size={13} className="text-sky" />} title="Overview">
            <div className={more ? "" : "max-h-28 overflow-hidden relative"}>
              <Para text={g.overview} />
              {!more && <span className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-panel to-transparent" aria-hidden="true" />}
            </div>
            <button type="button" className="text-[11px] text-crim font-bold" onClick={() => setMore((m) => !m)}>{more ? "Show less" : "Read all"}</button>
          </Block>
        )}
      </div>
    </Modal>
  );
}

export function IntelBuilds({ byId }: { byId: Map<number, IntelHero> }) {
  const cat = useCatalogs();
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [hero, setHero] = useState<string>(() => { try { return localStorage.getItem(STORE) ?? ""; } catch { return ""; } });
  const [lanes, setLanes] = useState<string[]>([]);
  const [lane, setLane] = useState("");
  const [rank, setRank] = useState<BuildRank>("all");
  const [sort, setSort] = useState<BuildSort>("popular");
  const [builds, setBuilds] = useState<RankedBuild[] | null>(null);
  const [buildErr, setBuildErr] = useState<string | null>(null);
  const [list, setList] = useState<Guide[] | null>(null);
  const [guideErr, setGuideErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Guide | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => { api.get<Hero[]>("/heroes").then(setHeroes).catch(() => setHeroes([])); }, []);
  useEffect(() => { try { if (hero) localStorage.setItem(STORE, hero); else localStorage.removeItem(STORE); } catch { /* private mode */ } }, [hero]);

  const intelId = useMemo(() => {
    if (!hero) return undefined;
    for (const [id, h] of byId) if (key(h.hero?.data?.name ?? "") === key(hero)) return id;
    return undefined;
  }, [byId, hero]);
  // the data service accepts the hero id or a plain name ("yisunshin")
  const ref = intelId !== undefined ? String(intelId) : key(hero);
  const local = heroes.find((h) => key(h.name) === key(hero));

  // lanes for this hero
  useEffect(() => {
    if (!hero) { setLanes([]); setLane(""); return; }
    let live = true;
    const fallback = local?.role ? [local.role.toLowerCase()].filter((l) => l in LANE_LABEL) : [];
    intel<unknown>(`academy/heroes/${ref}/lane`, {}, LONG)
      .then((d) => { if (live) { const got = heroLanes(d); const ls = got.length ? got : fallback.length ? fallback : Object.keys(LANE_LABEL); setLanes(ls); setLane((cur) => (ls.includes(cur) ? cur : ls[0])); } })
      .catch(() => { if (live) { const ls = fallback.length ? fallback : Object.keys(LANE_LABEL); setLanes(ls); setLane((cur) => (ls.includes(cur) ? cur : ls[0])); } });
    return () => { live = false; };
  }, [hero, ref, local?.role]);

  // ranked builds
  useEffect(() => {
    if (!hero || !lane) { setBuilds(null); return; }
    let live = true;
    setBuilds(null); setBuildErr(null);
    intel<unknown>(`academy/heroes/${ref}/builds`, { lane, rank, size: 20, index: 1 }, 10 * 60_000)
      .then((d) => { if (live) setBuilds(rankedBuilds(d, cat.spells)); })
      .catch((e) => { if (live) { setBuilds([]); setBuildErr(errText(e)); } });
    return () => { live = false; };
  }, [hero, ref, lane, rank, cat.spells]);

  // guides: this hero's, or what's trending
  useEffect(() => {
    let live = true;
    setList(null); setGuideErr(null);
    const req = hero ? intel<unknown>(`academy/heroes/${ref}/recommended`, { size: 6, index: 1, order: "desc" }, 10 * 60_000)
      : intel<unknown>("academy/recommended", { size: 12, index: 1, order: "desc" }, 10 * 60_000);
    req.then((d) => { if (live) setList(guides(d)); }).catch((e) => { if (live) { setList([]); setGuideErr(errText(e)); } });
    return () => { live = false; };
  }, [hero, ref]);

  const sorted = useMemo(() => sortBuilds(builds ?? [], sort), [builds, sort]);
  const topUse = Math.max(0, ...sorted.map((b) => b.pickRate ?? 0));
  const pickHero = (name: string) => { setHero(name); setOpen(null); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <div className="space-y-5">
      <section className="card build-head p-3 sm:p-4 overflow-hidden relative">
        {hero && <span className="build-head__art" aria-hidden="true"><HeroImg name={hero} size={220} variant="art" className="h-full w-auto object-cover" /></span>}
        <div className="relative space-y-3 max-w-xl">
          <div>
            <div className="section-pill">Hero builds</div>
            <p className="text-[11.5px] text-mute mt-2">What ranked players build on each hero, how often it's used and how often it wins. Tap an item, spell or talent to see what it does.</p>
          </div>
          <HeroPickerModal heroes={heroes} value={local?.id ?? ""} placeholder={hero || "Pick a hero to see their builds"}
            onChange={(id) => { const h = heroes.find((x) => x.id === id); if (h) setHero(h.name); }} />
          {hero && (
            <>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lane">
                {lanes.map((l) => (
                  <button key={l} type="button" aria-pressed={lane === l} onClick={() => setLane(l)}
                    className={`chip !text-[11px] !py-1 !px-2.5 ${lane === l ? "border-crim bg-crim-dim text-text" : ""}`} data-lane={l.toUpperCase()}>{LANE_LABEL[l]}</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rank">
                {BUILD_RANKS.map((r) => (
                  <button key={r} type="button" aria-pressed={rank === r} onClick={() => setRank(r)}
                    className={`chip !text-[10.5px] !py-0.5 !px-2 ${rank === r ? "border-sky bg-sky/10 text-sky" : ""}`}>{rankLabel(r)}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {hero && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-extrabold">{hero}{lane ? ` · ${LANE_LABEL[lane]}` : ""}</h3>
            <span className="text-[10.5px] text-faint">{rankLabel(rank)}</span>
            <div className="ml-auto inline-flex rounded-full border border-edge p-0.5" role="group" aria-label="Sort builds">
              {(["popular", "winning"] as BuildSort[]).map((s) => (
                <button key={s} type="button" aria-pressed={sort === s} onClick={() => setSort(s)}
                  className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${sort === s ? "bg-crim-dim text-text" : "text-mute"}`}>{s === "popular" ? "Most used" : "Most wins"}</button>
              ))}
            </div>
          </div>
          {builds === null ? <Spinner label={`Loading ${hero} builds`} />
            : buildErr ? <ErrorNote error={`Couldn't load builds right now (${buildErr}). Try again in a bit.`} />
            : sorted.length === 0 ? <Empty title={`No ${LANE_LABEL[lane] ?? ""} builds for ${hero} at this rank yet`} hint="Try another lane or All ranks." />
            : (
              <div className="grid lg:grid-cols-2 gap-3">
                {sorted.slice(0, 8).map((b, i) => <BuildCard key={b.key} build={b} rank={i + 1} cat={cat} onOpen={setDetail} top={topUse} />)}
              </div>
            )}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-amber" />
          <h3 className="text-[14px] font-extrabold">{hero ? `${hero} guides` : "Trending guides"}</h3>
          {hero && <button type="button" className="ml-auto text-[11px] text-crim font-bold" onClick={() => setHero("")}>See trending</button>}
        </div>
        {list === null ? <Spinner label="Loading guides" />
          : guideErr ? <ErrorNote error={`Couldn't load guides right now (${guideErr}).`} />
          : list.length === 0 ? <Empty title={hero ? `No community guides for ${hero} yet` : "No guides right now"} />
          : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {list.map((g) => <GuideCard key={g.id} g={g} byId={byId} cat={cat} onOpen={() => setOpen(g)} />)}
            </div>
          )}
      </section>

      {open && <GuideView g={open} byId={byId} cat={cat} onOpen={setDetail} onClose={() => setOpen(null)} onBuilds={hero ? undefined : pickHero} />}
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          <div className="flex items-center gap-3 mb-3">
            <GameIcon src={detail.icon} name={detail.title} size={52} />
            <div className="min-w-0">
              <div className="text-[15px] font-extrabold">{detail.title}</div>
              {detail.sub && <div className="text-[11px] text-faint">{detail.sub}</div>}
            </div>
          </div>
          {detail.extra && <p className="text-[12px] text-leaf font-bold whitespace-pre-line mb-2">{detail.extra}</p>}
          {detail.body
            ? <p className="text-[12.5px] text-mute leading-relaxed whitespace-pre-line bg-raised border border-edge/60 rounded-lg px-3.5 py-3 max-h-[50dvh] overflow-y-auto">{detail.body}</p>
            : <p className="text-[12px] text-faint">No description for this one yet.</p>}
        </Modal>
      )}
    </div>
  );
}
