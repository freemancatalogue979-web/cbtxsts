import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/roneEsports.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { parseRoneFeed, parseRoneGames, roneImageUrl, roneLinkUrl, roneNumber, roneMatch } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const rora = { name: "RORA", full_name: "Aurora Gaming", logo: "https://wsrv.nl?url=https://ik.imagekit.io/teams/aurora.webp" };
const onic = { name: "ONIC", full_name: null, logo: "https://wsrv.nl/?url=https://ik.imagekit.io/teams/onic.webp" };
const match = { match_id: "rora-onic-20260821", start_at: "2026-08-21T09:00:00+00:00", local_time: "5:00 PM", team1: rora, team2: onic,
  score1: 0, score2: 2, best_of: 3, status: "finished", winner: "team2", replay_url: null };

test("schedule preserves all weeks, days, teams, logos and zero scores", () => {
  const feed = parseRoneFeed({ weeks: [{ week: 1, days: [{ label: "Friday, 21 August 2026", matches: [match] }] },
    { week: 2, days: [{ label: "Next week", matches: [{ ...match, match_id: "second" }] }] }] });
  assert.equal(feed.groups.length, 2);
  assert.equal(feed.groups[0].week, 1);
  assert.equal(feed.groups[0].label, "Friday, 21 August 2026");
  assert.deepEqual([feed.groups[0].matches[0].score1, feed.groups[0].matches[0].score2], [0, 2]);
  assert.equal(feed.groups[0].matches[0].team1.name, "RORA");
  assert.equal(feed.groups[0].matches[0].team1.fullName, "Aurora Gaming");
  assert.match(feed.groups[0].matches[0].team2.logo, /^https:\/\/wsrv\.nl/);
  assert.equal(feed.groups[0].matches[0].localTime, "5:00 PM");
  assert.equal(feed.groups[1].matches[0].id, "second");
});

test("playoffs parse the actual days, seeds and bracket shape", () => {
  const feed = parseRoneFeed({ bracket_image: "https://wsrv.nl/?url=https://ik.imagekit.io/bracket.png",
    seeds: [{ seed: 1, team: rora, match_wl: { win: 12, lose: 2 } }],
    days: [{ day: 1, label: "Wednesday, 21 October 2026", matches: [{ ...match, round: "Upper bracket", best_of: 5 }] }] });
  assert.equal(feed.groups.length, 1);
  assert.equal(feed.groups[0].matches[0].round, "Upper bracket");
  assert.equal(feed.groups[0].matches[0].bestOf, 5);
  assert.deepEqual([feed.seeds[0].seed, feed.seeds[0].wins, feed.seeds[0].losses], [1, 12, 2]);
  assert.match(feed.bracketImage, /^https:\/\/wsrv\.nl/);
  const partial = parseRoneFeed({ seeds: [{ seed: 1, team: rora }], days: [], bracket_image: null });
  assert.equal(partial.seeds.length, 1);
  assert.equal(partial.groups.length, 0);
  assert.equal(partial.bracketImage, null);
  const scheduled = parseRoneFeed({ days: [{ label: "Finals", matches: [{ ...match, match_id: null, status: "scheduled", score1: null, score2: null }] }] });
  assert.equal(scheduled.groups[0].matches[0].id, null);
  assert.equal(scheduled.groups[0].matches[0].score1, null);
  assert.equal(scheduled.groups[0].matches[0].status, "scheduled");
});

test("standings retain nested win/loss values and unknowns", () => {
  const feed = parseRoneFeed({ data: { standings: [{ rank: 1, team: rora, match_point: 12,
    match_wl: { win: 12, lose: 2 }, game_wl: { win: 25, lose: 6 }, net_game_win: 19 }, { rank: 2, team: onic }] } });
  assert.deepEqual([feed.standings[0].matchWins, feed.standings[0].matchLosses, feed.standings[0].gameWins, feed.standings[0].netGames], [12, 2, 25, 19]);
  assert.equal(feed.standings[1].points, null);
  assert.equal(roneNumber("0"), 0);
  assert.equal(roneNumber(""), null);
  assert.equal(roneNumber(Infinity), null);
});

test("game details keep team and player stats and mark estimated duration", () => {
  const games = parseRoneGames({ match_id: match.match_id, games: [{ number: 1, duration: null, duration_estimate: "14:07",
    teams: [{ team: rora, kills: 0, stats: { total_gold: 34946, tortoise_kill: 0, lord_kill: 0, tower_destroy: 0 },
      players: [{ name: "Koyl", hero: { name: "Hirara" }, kills: 0, deaths: 2, assists: 0, gold: 8165, damage_dealt: 18069,
        items: [{ id: "3431", image: "https://wsrv.nl/?url=https://ik.imagekit.io/item.png" }] }] }] }] });
  assert.equal(games[0].duration, "14:07");
  assert.equal(games[0].durationEstimated, true);
  assert.equal(games[0].teams[0].kills, 0);
  assert.equal(games[0].teams[0].players[0].hero, "Hirara");
  assert.equal(games[0].teams[0].players[0].items[0].id, "3431");
  assert.equal(games[0].teams[0].players[0].damageTaken, null);
});

test("unsafe URLs, path traversal IDs and missing fields are rejected", () => {
  assert.equal(roneImageUrl("https://untrusted.example/tracker"), null);
  assert.equal(roneImageUrl("javascript:alert(1)"), null);
  assert.equal(roneImageUrl("https://user:pass@wsrv.nl/thing"), null);
  assert.equal(roneLinkUrl("javascript:alert(1)"), null);
  assert.equal(roneMatch({ match_id: "../secret" }).id, null);
  assert.equal(roneMatch({ team1: null, score1: null }).team1.name, "TBD");
  assert.deepEqual(parseRoneFeed({ weeks: [{ days: [] }], seeds: [], bracket_image: null }).groups, []);
});
