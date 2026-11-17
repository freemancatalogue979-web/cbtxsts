import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [solo, page, app, controls, dashboard, players, types] = await Promise.all([
  read("../src/components/SoloGames.tsx"),
  read("../src/pages/CloverAI.tsx"),
  read("../src/App.tsx"),
  read("../src/components/AIDataControls.tsx"),
  read("../src/pages/Dashboard.tsx"),
  read("../src/pages/Players.tsx"),
  read("../src/lib/types.ts"),
]);

test("Utility AI and Learning utility are tabs inside 9 Clover AI", () => {
  assert.match(page, /\{ id: "utility", label: "Utility AI", icon: Upload \}/);
  assert.match(page, /\{ id: "learning", label: "Learning utility", icon: GraduationCap \}/);
  assert.match(page, /tab === "utility" \? <AIUtility me=\{me\}/);
  assert.match(page, /tab === "learning" \? <AILearning me=\{me\}/);
  // #/ai/utility and #/ai/learning deep links
  assert.match(page, /const LINKED_TABS: readonly Tab\[\] = \["utility", "learning"\]/);
  assert.match(app, /<CloverAIPage [^>]*view=\{rest\[0\]\}/);
});

test("players can pick screenshots, documents and spreadsheets — several at once", () => {
  for (const ext of ["image/png", "image/jpeg", "image/webp", ".pdf", ".docx", ".txt", ".csv", ".xlsx"]) {
    assert.ok(solo.includes(ext), ext);
  }
  assert.match(solo, /type="file" className="sr-only" multiple accept=\{SOLO_ACCEPT\}/);
  assert.match(solo, /onDrop=\{onDrop\}/);
  assert.match(solo, /api\.upload<\{ url: string \}>\("\/files", form\)/);
  assert.match(solo, /api\.post<SoloImport>\("\/solo-games\/import", \{ file_url: saved\.url \}\)/);
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

test("Learning utility shows form, heroes, alerts and AI coaching", () => {
  assert.match(solo, /<SectionTitle>What to work on<\/SectionTitle>/);
  assert.match(solo, /<SectionTitle>My heroes<\/SectionTitle>/);
  assert.match(solo, /<SectionTitle>AI coach<\/SectionTitle>/);
  assert.match(solo, /api\.post<SoloCoaching>\("\/solo-games\/coach", \{ focus \}\)/);
  assert.match(solo, /What's working/);
  assert.match(solo, /Fix next/);
});

test("chat only sees solo games after opting in", () => {
  assert.match(controls, /<Toggle label="My solo games" checked=\{!!settings\.share_games\}/);
  assert.match(types, /solo\?: \{ games: number; wins: number; losses: number; win_rate: number \| null \}/);
});

test("solo games show on the dashboard and the hero pool, apart from team numbers", () => {
  assert.match(dashboard, /navigate\("ai", "utility"\)/);
  assert.match(dashboard, /navigate\("ai", "learning"\)/);
  assert.match(dashboard, /My solo games/);
  assert.match(players, /played\.solo && played\.solo\.games > 0/);
  assert.match(players, /team \{played\.games === 1 \? "game" : "games"\}/);
});

test("no all-caps styling sneaks in", () => {
  assert.doesNotMatch(solo, /\b(uppercase|capitalize)\b/);
});
