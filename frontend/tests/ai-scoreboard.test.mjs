import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [board, scrims, tournaments, strategy, perf, types] = await Promise.all([
  read("../src/components/Scoreboard.tsx"),
  read("../src/pages/Scrims.tsx"),
  read("../src/pages/Tournaments.tsx"),
  read("../src/pages/Strategy.tsx"),
  read("../src/components/PlayerPerformance.tsx"),
  read("../src/lib/types.ts"),
]);

test("every scoreboard field can still be typed by hand", () => {
  for (const key of ["kills", "deaths", "assists", "rating", "gold", "damage", "damage_taken", "turret_damage"]) {
    assert.match(board, new RegExp(`key: "${key}"`), key);
  }
  assert.match(board, /aria-label=\{`\$\{who\}\$\{nice\(lane\)\} \$\{m\.label\}`\}/);
  assert.match(board, /aria-label=\{`\$\{who\}\$\{nice\(lane\)\} MVP`\}/);
  assert.match(board, /inputMode=\{m\.key === "rating" \? "decimal" : "numeric"\}/, "ratings take a decimal");
  assert.match(types, /rating\?: number; gold\?: number; damage\?: number; damage_taken\?: number; turret_damage\?: number; mvp\?: boolean;/);
});

test("the AI reads a picked or uploaded screenshot and only fills the form", () => {
  assert.match(board, /api\.post<ScoreboardRead>\("\/ai-tools\/scoreboard", \{\s*image_url: url, opponent: context\.opponent, result: context\.result, lineup, draft: context\.draft,/);
  assert.match(board, /api\.upload<\{ label: string; url: string; kind: string \}>\("\/files", form\)/);
  assert.match(board, /— check and save\./);
  assert.match(board, /done\.read\.checks\.map/, "what the AI changed or wasn't sure about is listed");
  assert.doesNotMatch(board, /\/scrims\/|\/tournaments\//, "the reader never saves a game itself");
});

test("scrim and tournament games both get the reader, our scoreboard and the enemy's", () => {
  for (const [name, page] of [["scrims", scrims], ["tournaments", tournaments]]) {
    assert.match(page, /<ScoreboardReader evidence=\{evidence\} onRead=\{applyRead\}/, name);
    assert.match(page, /<EnemyScoreboard key=\{enemyKey\} form=\{enemyLines\}/, name);
    assert.match(page, /setDraft\(\(d\) => \(\{ \.\.\.d, \.\.\.r\.draft \}\)\)/, name);
    assert.match(page, /enemy_stats ?[:=] ?formToLines\(enemyLines, draft\.enemy_picks \?\? \{\}, true\)/, name);
  }
  assert.match(scrims, /player_stats, enemy_stats,/);
  assert.match(tournaments, /player_stats: formToLines\(lines\),/);
});

test("ratings and MVPs show on the player page", () => {
  assert.match(perf, /label="Match rating"/);
  assert.match(perf, /low_rating: "Low rating"/);
  assert.match(perf, /\{hasRating && <th/);
});

test("staff can have the AI write a strategy note, then edit and publish it", () => {
  assert.match(strategy, /api\.post<AIStrategy>\("\/ai-tools\/strategy", \{ topic: topic\.trim\(\), category, opponent: against\.trim\(\) \}\)/);
  assert.match(strategy, /<Sparkles size=\{15\} \/> Write with AI<\/button>/);
  assert.match(strategy, /right=\{canManage && \(/);
  assert.match(strategy, /Draft ready below — check it and publish\./);
});
