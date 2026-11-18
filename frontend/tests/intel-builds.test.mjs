// MLBB Intel → Builds: the academy feeds become readable builds and guides (shapes from the Rone Arena API docs).
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSync } from "esbuild";

const dir = await mkdtemp(join(tmpdir(), "builds-"));
const out = join(dir, "builds.mjs");
buildSync({ entryPoints: [new URL("../src/lib/builds.ts", import.meta.url).pathname], outfile: out, format: "esm", bundle: true, platform: "neutral", logLevel: "silent" });
const B = await import(out);
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [comp, intel, css] = await Promise.all([read("../src/components/IntelBuilds.tsx"), read("../src/pages/Intel.tsx"), read("../src/index.css")]);

const BUILDS = { records: [{ _id: "x", data: { big_rank: "9", heroid: 17, real_road: 4, build: [
  { battleskill: { data: { __data: { skillname: "Retribution", skillicon: "https://cdn/ret.png", skilldesc: "Deal <font color=\"ffe63c\">True Damage</font>", skillid: 20020 }, battleskillid: 20020, skillshortdesc: "Jungle Special", skillname: "@__data.skillname1" } },
    build_pick_rate: 0.0128, build_win_rate: 0.6308,
    emblem: { data: { attriicon: "https://cdn/as.png", emblemattr: { emblemattr: "+14 Adaptive Penetration\n+10 Adaptive Attack\n", emblemname: "Assassin" }, emblemid: 20005, emblemname: "Assassin" } },
    equipid: [3007, 3001, 2013], new_rune_skill: [112, 122, 631], runeid: 20005 },
  { battleskill: { data: { battleskillid: 20020 } }, build_pick_rate: 0.30, build_win_rate: 0.51, equipid: [3001, 0, 2013], new_rune_skill: [] },
  { build_pick_rate: 0.001, build_win_rate: 0.9, equipid: [1], new_rune_skill: [] },
] } }], total: 1 };

test("ranked builds read items, emblem, spell and talents; no '@' pointers leak through", () => {
  const spells = B.spellCatalog({ records: [{ data: { battleskillid: 20020, __data: { skillid: 20020, skillname: "Retribution", skillicon: "https://cdn/ret.png" } } }] });
  const builds = B.rankedBuilds(BUILDS, spells);
  assert.equal(builds.length, 3);
  const [a, b] = builds;
  assert.deepEqual(a.items, [3007, 3001, 2013]);
  assert.equal(a.spell.name, "Retribution");
  assert.equal(a.spell.desc, "Deal True Damage");
  assert.equal(a.emblem.name, "Assassin");
  assert.deepEqual(a.emblem.bonus, ["+14 Adaptive Penetration", "+10 Adaptive Attack"]);
  assert.deepEqual(a.talents, [112, 122, 631]);
  assert.deepEqual(b.items, [3001, 2013], "empty item slots are dropped");
  assert.equal(b.spell.name, "Retribution", "spell name comes from the catalog when the build only has the id");
  assert.ok(!JSON.stringify(builds).includes("@__data"));
});

test("most used vs most wins: a build nobody uses can't top the win list", () => {
  const builds = B.rankedBuilds(BUILDS);
  assert.deepEqual(B.sortBuilds(builds, "popular").map((x) => x.pickRate), [0.30, 0.0128, 0.001]);
  assert.equal(B.sortBuilds(builds, "winning")[0].winRate, 0.51);
  assert.equal(B.ratePct(0.6308), "63.1%");
  assert.equal(B.ratePct(0.004), "0.4%");
});

test("catalogs: item names/icons/descriptions, talents by gift id", () => {
  const items = B.itemCatalog({ records: [{ data: { equipid: 3573, equipname: "Demon Boots - Favor", equipicon: "https://cdn/i.png", equiptypename: "Roam",
    equiptips: "+40 Movement Speed<br>+10 Mana Regen<br>", equipskilldesc: "\nPassive - Favor: \nMysticism: Restore 4% Mana.\n: \n<font color=\"FFD700\">Devotion</font>: Gains 35% Gold." } }] });
  const it = items.get(3573);
  assert.equal(it.name, "Demon Boots - Favor");
  assert.equal(it.stats, "+40 Movement Speed\n+10 Mana Regen");
  assert.equal(it.desc, "Mysticism: Restore 4% Mana.\nDevotion: Gains 35% Gold.");
  const talents = B.talentCatalog({ records: [{ data: { giftid: 1221, gifttiers: 2, emblemskill: { skillname: "Weapons Master", skillid: 61010, skilldesc: "+5%" } } }] });
  assert.equal(talents.get(1221).name, "Weapons Master");
  assert.equal(talents.get(122).name, "Weapons Master");
});

test("hero lanes from the lane feed", () => {
  const lanes = B.heroLanes({ records: [{ data: { hero_id: 17, hero: { data: { roadsort: [{ data: { road_sort_id: "4", road_sort_title: "Jungle" } }, ""] } } } }] });
  assert.deepEqual(lanes, ["jungle"]);
});

test("community guides: hero, title, author, items, emblem, spell, phases and grouped partner notes", () => {
  const same = "Best With: Long-range heroes like Pharsa or Yve.";
  const g = B.guides({ records: [{ id: 1093652237288192, updatedAt: 1774498623794, user: { name: " coco" }, dynamic: { views: 368, votes: 20 }, data: { type: "ugc_hero", data: {
    title: "Frame the Meta: A Grandmaster's Guide to Marcel", game_version: "2.1.18",
    hero: { hero_id: 132, hero_lane: "3", hero_strength: "✨Anti-Projectile", hero_weakness: "✨Zero Burst", hero_overview: "Marcel..." },
    equips: [{ equip_title: "MARCEL'S BUILD ITEMS", equip_ids: [3562, 2212, 3206, 3204, 3205, 3207], equip_desc: "Thunder Belt: core." }],
    emblems: [{ emblem_title: "Emblem: Support Emblem", emblem_gifts: [811, 321, 831], emblem_desc: "\n✨ Focusing Mark\n\n" }],
    spell: { spell_id: 20100, spell_desc: "Flicker: Flash-Ult." },
    cooperates: [{ cooperate_hero_id: 101, cooperate_desc: same }, { cooperate_hero_id: 52, cooperate_desc: same }],
    counters: [{ counter_hero_id: 48, counter_desc: "Weak Against: Karrie." }],
    dominants: [{ dominant_title: "Early Game", dominant_desc: "Poke." }, { dominant_title: "Late Game", dominant_desc: "Wait." }],
  } } }] })[0];
  assert.equal(g.title, "Frame the Meta: A Grandmaster's Guide to Marcel");
  assert.equal(g.heroId, 132);
  assert.equal(g.lane, "roam");
  assert.equal(g.author, "coco");
  assert.equal(g.views, 368);
  assert.deepEqual(g.builds[0].items, [3562, 2212, 3206, 3204, 3205, 3207]);
  assert.equal(g.emblems[0].title, "Support Emblem");
  assert.equal(g.emblems[0].notes, "✨ Focusing Mark");
  assert.equal(g.spell.id, 20100);
  assert.deepEqual(g.phases.map((p) => p.title), ["Early Game", "Late Game"]);
  assert.deepEqual(B.groupNotes(g.partners), [{ heroIds: [101, 52], text: same }]);
});

test("the Builds tab uses the real build feeds, a modal hero picker, and opens descriptions", () => {
  assert.match(intel, /\{tab === "builds" && <IntelBuilds byId=\{byId\} \/>\}/);
  assert.doesNotMatch(intel, /function BuildsTab|next phase/);
  assert.match(comp, /academy\/heroes\/\$\{ref\}\/builds`, \{ lane, rank, size: 20, index: 1 \}/);
  assert.match(comp, /academy\/heroes\/\$\{ref\}\/lane`/);
  assert.match(comp, /academy\/heroes\/\$\{ref\}\/recommended`/);
  assert.match(comp, /<HeroPickerModal heroes=\{heroes\}/);
  assert.doesNotMatch(comp, /<select/);
  assert.match(comp, /onOpen\(\{ title: name, icon: it\?\.icon, sub: it\?\.kind, body: it\?\.desc, extra: it\?\.stats \}\)/);
  assert.match(comp, /navigate\("heroes", id\)/, "hero faces open the hero");
  assert.match(css, /\.build-item__n \{/);
});
