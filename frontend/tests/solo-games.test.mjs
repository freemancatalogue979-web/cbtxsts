import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [solo, page, app, controls, dashboard, players, types] = await Promise.all([
  read("../src/components/SoloGames.tsx"),
  read("../src/pages/Utility.tsx"),
  read("../src/App.tsx"),
  read("../src/components/AIDataControls.tsx"),
  read("../src/pages/Dashboard.tsx"),
  read("../src/pages/Players.tsx"),
  read("../src/lib/types.ts"),
]);

test("the player's games live on the Utility tab, and old AI links redirect there", () => {
  assert.match(page, /<RecordUploader onChanged=/);
  assert.match(page, /<GamesTable data=\{data\}/);
  assert.match(app, /case "utility":\s*page = <UtilityPage me=\{user\} meta=\{meta\} parts=\{rest\} \/>/);
  assert.match(app, /if \(route\[1\] === "utility"\) return \["utility", "add"\]/);
  assert.match(app, /if \(route\[1\] === "learning"\) return \["utility", "progress"\]/);
});

test("players can pick screenshots, documents and spreadsheets — several at once", () => {
  for (const ext of ["image/png", "image/jpeg", "image/webp", ".pdf", ".docx", ".txt", ".csv", ".xlsx"]) {
    assert.ok(solo.includes(ext), ext);
  }
  assert.match(solo, /type="file" className="sr-only" multiple accept=\{SOLO_ACCEPT\}/);
  assert.match(solo, /onDrop=\{onDrop\}/);
  assert.match(solo, /api\.upload<\{ url: string \}>\("\/files", form\)/);
  assert.match(solo, /api\.post<SoloImport>\("\/solo-games\/import", \{ file_url: saved\.url, preview: true \}\)/);
  assert.match(solo, /downloadTemplate/);
});

test("imports count straight away but can be undone, edited and deleted (to Trash)", () => {
  assert.match(solo, /api\.post\("\/solo-games\/undo", \{ batch: job\.result\.batch \}\)/);
  assert.match(solo, /api\.del\(`\/solo-games\/\$\{g\.id\}`\)/);
  assert.match(solo, /api\.patch<SoloGame>\(`\/solo-games\/\$\{game\.id\}`/);
  assert.match(solo, /Move this \$\{g\.hero \|\| "game"\} game to Trash/);
});

test("every field can be typed by hand, and heroes use the modal picker", () => {
  for (const key of ["kills", "deaths", "assists", "rating", "gold", "duration_min", "damage", "damage_taken", "turret_damage"]) {
    assert.match(solo, new RegExp(`numField\\("${key}"`), key);
  }
  assert.match(solo, /<HeroPickerModal heroes=\{heroes\}/);
  assert.doesNotMatch(solo, /<select[^>]*hero/i);
});

test("progress shows what to work on, heroes and a personal plan", () => {
  assert.match(page, /<SectionTitle>What to work on<\/SectionTitle>/);
  assert.match(page, /\{mine \? "My heroes" : "Heroes"\}/);
  assert.match(solo, /<SectionTitle>Your plan<\/SectionTitle>/);
  assert.match(solo, /api\.post<SoloCoaching>\("\/solo-games\/coach", \{ focus \}\)/);
  assert.match(solo, /What's working/);
  assert.match(solo, /Fix next/);
});

test("chat only sees solo games after opting in", () => {
  assert.match(controls, /<Toggle label="My solo games" checked=\{!!settings\.share_games\}/);
  assert.match(types, /solo\?: \{ games: number; wins: number; losses: number; win_rate: number \| null \}/);
});

test("solo games show on the dashboard and the hero pool, apart from team numbers", () => {
  assert.match(dashboard, /navigate\("utility", "add"\)/);
  assert.match(dashboard, /navigate\("utility", "progress"\)/);
  assert.match(dashboard, /My solo games/);
  assert.match(players, /played\.solo && played\.solo\.games > 0/);
  assert.match(players, /team \{played\.games === 1 \? "game" : "games"\}/);
});

test("no all-caps styling sneaks in", () => {
  assert.doesNotMatch(solo, /\b(uppercase|capitalize)\b/);
});

test("read games wait for a check: heroes can be changed with the hero picker before they're added", () => {
  assert.match(solo, /function ImportReview\(/);
  assert.match(solo, /status: read\.preview \? "review" : "done"/);
  assert.match(solo, /<HeroPickerModal heroes=\{heroes\} value=\{id\} disabled=\{!r\.keep \|\| busy\}/);
  assert.match(solo, /api\.post<SoloImport>\("\/solo-games\/import\/confirm"/);
  assert.match(solo, /portraits,/);
  assert.doesNotMatch(solo.slice(solo.indexOf("function ImportReview(")), /<select/);
});

test("scrim/tournament evidence review: every hero is editable and checked chips show how sure we are", () => {
  const ev = readFileSync(new URL("../src/components/MatchEvidence.tsx", import.meta.url), "utf8");
  const sb = readFileSync(new URL("../src/components/Scoreboard.tsx", import.meta.url), "utf8");
  const chip = readFileSync(new URL("../src/components/HeroCheck.tsx", import.meta.url), "utf8");
  assert.match(ev, /function HeroFix\(/);
  assert.match(ev, /heroControl=\{heroControl\("ours"\)\}/);
  assert.match(ev, /heroControl=\{heroControl\("enemy"\)\}/);
  assert.match(ev, /portraits: portraits\(\)/);
  assert.match(ev, /our_picks: filled\(picks\.ours\), enemy_picks: filled\(picks\.enemy\)/);
  assert.match(sb, /\{heroControl && <div className="min-w-0">\{heroControl\(lane\)\}<\/div>\}/);
  for (const k of ["portrait", "corrected", "likely", "unsure", "edited", "confirmed"]) assert.match(chip, new RegExp(`${k}: \\{`));
  assert.doesNotMatch(chip + ev.slice(ev.indexOf("function HeroFix(")), /\bAI\b/);
});
