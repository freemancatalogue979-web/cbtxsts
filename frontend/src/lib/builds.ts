/**
 * MLBB Intel → Builds: turns the academy feeds into plain, readable builds.
 *
 * - academy/heroes/{id}/builds   → real ranked builds: 6 items + emblem + talents + spell, with win and use rates
 * - academy/heroes/{id}/recommended, academy/recommended → community guides (title, items, emblem, spell, tips)
 * - academy/equipment/expanded, academy/emblems, academy/spells → names, icons and descriptions by id
 *
 * The upstream shapes nest data a few levels deep and sometimes point at other fields ("@__data.skillname1"),
 * so everything here reads defensively and never shows a raw id or template to a person.
 */
// no app imports here, so the parsing can be tested on its own
type AnyRec = Record<string, unknown>;
const stripTags = (s: string): string => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

export const LANE_IDS: Record<string, number> = { exp: 1, mid: 2, roam: 3, jungle: 4, gold: 5 };
export const LANE_LABEL: Record<string, string> = { exp: "EXP", mid: "Mid", roam: "Roam", jungle: "Jungle", gold: "Gold" };
export const LANE_BY_ID: Record<number, string> = Object.fromEntries(Object.entries(LANE_IDS).map(([k, v]) => [v, k]));
export const BUILD_RANKS = ["all", "epic", "legend", "mythic", "honor", "glory"] as const;
export type BuildRank = (typeof BUILD_RANKS)[number];

const obj = (v: unknown): AnyRec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as AnyRec) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
/** a real text value: not empty, not an "@pointer" to another field */
const text = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = stripTags(v.replace(/<br\s*\/?>/gi, "\n")).trim();
  return t && !t.startsWith("@") ? t : undefined;
};
const firstText = (...vals: unknown[]) => vals.map(text).find(Boolean);
/** "Rapid Boots: ...\n\n Thunder Belt: ..." → tidy paragraphs, no emoji bullets doubling up */
export const tidy = (s: string | undefined) =>
  (s ?? "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** records → their .data, whatever the envelope */
export function recordsOf(payload: unknown): AnyRec[] {
  const d = obj(payload);
  const recs = arr(d?.records ?? obj(d?.data)?.records);
  return recs.map((r) => obj(obj(r)?.data) ?? {}).filter((r) => Object.keys(r).length > 0);
}
function rawRecords(payload: unknown): AnyRec[] {
  const d = obj(payload);
  return arr(d?.records ?? obj(d?.data)?.records).map(obj).filter((r): r is AnyRec => !!r);
}

// ---------------------------------------------------------------------------------------------- //
// catalogs
// ---------------------------------------------------------------------------------------------- //
export interface ItemInfo { id: number; name: string; icon?: string; desc?: string; stats?: string; kind?: string }
export interface SpellInfo { id: number; name: string; icon?: string; desc?: string; short?: string }
export interface TalentInfo { id: number; name: string; icon?: string; desc?: string }

export function itemCatalog(payload: unknown): Map<number, ItemInfo> {
  const out = new Map<number, ItemInfo>();
  for (const r of recordsOf(payload)) {
    const id = num(r.equipid);
    const name = text(r.equipname);
    if (id === undefined || !name) continue;
    out.set(id, {
      id, name, icon: text(r.equipicon), kind: text(r.equiptypename),
      stats: tidy(typeof r.equiptips === "string" ? stripTags(r.equiptips.replace(/<br\s*\/?>/gi, "\n")) : undefined) || undefined,
      // drop the empty "\n: " skill lines upstream leaves behind
      desc: tidy(text(r.equipskilldesc)?.split("\n").filter((l) => l.trim() && !/^[\s:]*$/.test(l) && !/:\s*$/.test(l)).join("\n")) || undefined,
    });
  }
  return out;
}

export function spellCatalog(payload: unknown): Map<number, SpellInfo> {
  const out = new Map<number, SpellInfo>();
  for (const r of recordsOf(payload)) {
    const inner = obj(r.__data) ?? {};
    const id = num(r.battleskillid) ?? num(inner.skillid) ?? num(r.skillid);
    const name = firstText(inner.skillname, r.skillname);
    if (id === undefined || !name) continue;
    out.set(id, { id, name, icon: firstText(inner.skillicon, r.skillicon), desc: firstText(inner.skilldesc, r.skilldesc), short: text(r.skillshortdesc) });
  }
  return out;
}

export function talentCatalog(payload: unknown): Map<number, TalentInfo> {
  const out = new Map<number, TalentInfo>();
  for (const r of recordsOf(payload)) {
    const skill = obj(r.emblemskill) ?? {};
    const name = text(skill.skillname);
    if (!name) continue;
    const info = { name, icon: text(skill.skillicon), desc: firstText(skill.skilldescemblem, skill.skilldesc) };
    // builds refer to talents by gift id; some feeds drop the trailing level digit (1221 ↔ 122)
    for (const id of [num(r.giftid), num(skill.skillid)]) {
      if (id === undefined) continue;
      out.set(id, { id, ...info });
      if (id >= 100) out.set(Math.floor(id / 10), { id, ...info });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- //
// ranked builds
// ---------------------------------------------------------------------------------------------- //
export interface RankedBuild {
  key: string;
  items: number[];
  winRate?: number;
  pickRate?: number;
  emblem?: { id?: number; name: string; icon?: string; bonus: string[] };
  spell?: SpellInfo;
  talents: number[];
}

export function rankedBuilds(payload: unknown, spells?: Map<number, SpellInfo>): RankedBuild[] {
  const seen = new Map<string, RankedBuild>();
  for (const rec of recordsOf(payload)) {
    for (const b of arr(rec.build).map(obj)) {
      if (!b) continue;
      const items = arr(b.equipid).map(num).filter((n): n is number => n !== undefined && n > 0);
      if (!items.length) continue;
      const em = obj(obj(b.emblem)?.data);
      const attr = obj(em?.emblemattr);
      const emblemName = firstText(em?.emblemname, attr?.emblemname);
      const bonusText = text(attr?.emblemattr) ?? text(em?.emblemattr);
      const sk = obj(obj(b.battleskill)?.data);
      const skInner = obj(sk?.__data) ?? {};
      const spellId = num(sk?.battleskillid) ?? num(skInner.skillid) ?? num(b.skillid);
      const known = spellId !== undefined ? spells?.get(spellId) : undefined;
      const spellName = firstText(skInner.skillname, sk?.skillname) ?? known?.name;
      const build: RankedBuild = {
        key: "",
        items,
        winRate: num(b.build_win_rate),
        pickRate: num(b.build_pick_rate),
        emblem: emblemName ? { id: num(em?.emblemid), name: emblemName, icon: text(em?.attriicon), bonus: (bonusText ?? "").split("\n").map((l) => l.trim()).filter(Boolean) } : undefined,
        spell: spellName && spellId !== undefined
          ? { id: spellId, name: spellName, icon: firstText(skInner.skillicon, sk?.skillicon) ?? known?.icon, desc: firstText(skInner.skilldesc) ?? known?.desc, short: text(sk?.skillshortdesc) ?? known?.short }
          : known,
        talents: arr(b.new_rune_skill).map(num).filter((n): n is number => n !== undefined && n > 0),
      };
      build.key = [items.join("-"), build.emblem?.name ?? "", build.spell?.id ?? "", build.talents.join("-")].join("|");
      const prev = seen.get(build.key);
      if (!prev || (build.pickRate ?? 0) > (prev.pickRate ?? 0)) seen.set(build.key, build);
    }
  }
  return [...seen.values()];
}

export type BuildSort = "popular" | "winning";
/** Popular: most used first. Winning: best win rate, but builds almost nobody uses go last (a 2-game 100% means nothing). */
export function sortBuilds(builds: RankedBuild[], by: BuildSort): RankedBuild[] {
  const maxPick = Math.max(0, ...builds.map((b) => b.pickRate ?? 0));
  const solid = (b: RankedBuild) => (b.pickRate ?? 0) >= maxPick * 0.1;
  return [...builds].sort((a, b) => by === "popular"
    ? (b.pickRate ?? 0) - (a.pickRate ?? 0) || (b.winRate ?? 0) - (a.winRate ?? 0)
    : Number(solid(b)) - Number(solid(a)) || (b.winRate ?? 0) - (a.winRate ?? 0));
}

/** The lanes this hero is played in, in the order upstream lists them. */
export function heroLanes(payload: unknown): string[] {
  const lanes: string[] = [];
  for (const rec of recordsOf(payload)) {
    const roads = arr(obj(obj(rec.hero)?.data)?.roadsort);
    for (const road of roads.map(obj)) {
      const id = num(obj(road?.data)?.road_sort_id);
      const lane = id !== undefined ? LANE_BY_ID[id] : undefined;
      if (lane && !lanes.includes(lane)) lanes.push(lane);
    }
  }
  return lanes;
}

// ---------------------------------------------------------------------------------------------- //
// community guides
// ---------------------------------------------------------------------------------------------- //
export interface GuideHeroNote { heroId?: number; text: string }
export interface Guide {
  id: string;
  title: string;
  heroId?: number;
  lane?: string;
  author?: string;
  views?: number;
  votes?: number;
  version?: string;
  updated?: number;
  overview?: string;
  strengths?: string;
  weaknesses?: string;
  builds: { title?: string; items: number[]; notes?: string }[];
  emblems: { title?: string; talents: number[]; notes?: string }[];
  spell?: { id?: number; notes?: string };
  phases: { title: string; text: string }[];
  partners: GuideHeroNote[];
  counters: GuideHeroNote[];
}

const shortTitle = (s?: string) => {
  const t = (s ?? "").replace(/^\s*(emblem|build items?|items?)\s*:\s*/i, "").trim();
  return t.length > 70 ? `${t.slice(0, 67)}…` : t || undefined;
};

export function guides(payload: unknown): Guide[] {
  const out: Guide[] = [];
  for (const rec of rawRecords(payload)) {
    const outer = obj(rec.data) ?? {};
    const g = obj(outer.data) ?? outer;
    const hero = obj(g.hero) ?? {};
    const user = obj(rec.user) ?? obj(outer.user);
    const dyn = obj(rec.dynamic) ?? obj(outer.dynamic);
    const title = firstText(g.title, g.recommend);
    if (!title) continue;
    const laneId = num(hero.hero_lane);
    const notes = (list: unknown, idKey: string, descKey: string): GuideHeroNote[] => {
      return arr(list).map(obj).filter((x): x is AnyRec => !!x)
        .map((x) => ({ heroId: num(x[idKey]), text: tidy(text(x[descKey])) }))
        .filter((n) => n.heroId !== undefined || n.text);
    };
    out.push({
      id: String(rec.id ?? `${title}-${out.length}`),
      title,
      heroId: num(hero.hero_id),
      lane: laneId !== undefined ? LANE_BY_ID[laneId] : undefined,
      author: text(user?.name),
      views: num(dyn?.views),
      votes: num(dyn?.votes),
      version: text(g.game_version),
      updated: num(rec.updatedAt) ?? num(rec.createdAt),
      overview: tidy(text(hero.hero_overview)) || undefined,
      strengths: tidy(text(hero.hero_strength)) || undefined,
      weaknesses: tidy(text(hero.hero_weakness)) || undefined,
      builds: arr(g.equips).map(obj).filter((x): x is AnyRec => !!x).map((e) => ({
        title: shortTitle(text(e.equip_title)),
        items: arr(e.equip_ids).map(num).filter((n): n is number => n !== undefined && n > 0),
        notes: tidy(text(e.equip_desc)) || undefined,
      })).filter((b) => b.items.length > 0),
      emblems: arr(g.emblems).map(obj).filter((x): x is AnyRec => !!x).map((e) => ({
        title: shortTitle(text(e.emblem_title)),
        talents: arr(e.emblem_gifts).map(num).filter((n): n is number => n !== undefined && n > 0),
        notes: tidy(text(e.emblem_desc)) || undefined,
      })),
      spell: obj(g.spell) ? { id: num(obj(g.spell)!.spell_id), notes: tidy(text(obj(g.spell)!.spell_desc)) || undefined } : undefined,
      phases: arr(g.dominants).map(obj).filter((x): x is AnyRec => !!x)
        .map((d) => ({ title: text(d.dominant_title) ?? "", text: tidy(text(d.dominant_desc)) }))
        .filter((d) => d.text),
      partners: notes(g.cooperates, "cooperate_hero_id", "cooperate_desc"),
      counters: notes(g.counters, "counter_hero_id", "counter_desc"),
    });
  }
  return out;
}

/** Notes sharing one sentence → one line with every hero it mentions. */
export function groupNotes(list: GuideHeroNote[]): { heroIds: number[]; text: string }[] {
  const groups: { heroIds: number[]; text: string }[] = [];
  for (const n of list) {
    const hit = groups.find((g) => g.text === n.text);
    if (hit) { if (n.heroId !== undefined) hit.heroIds.push(n.heroId); }
    else groups.push({ heroIds: n.heroId !== undefined ? [n.heroId] : [], text: n.text });
  }
  return groups;
}

/** 0.6308 → "63.1%" (one decimal, so a 0.4% use rate isn't shown as 0%) */
export const ratePct = (f?: number) => (f === undefined ? "—" : `${(f * 100).toFixed(1)}%`);
export const compact = (n?: number) => (n === undefined ? "—" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
