import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Keep display helpers usable on incomplete source records without a browser.
const source = await readFile(new URL("../src/lib/esports.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { esportsDate, esportsNumber, teamName, teamCode, gameDuration } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("unknown dates and statistics are never rendered as zero", () => {
  assert.equal(esportsDate(null), "Date TBC");
  assert.equal(esportsDate("not-a-date"), "Date TBC");
  assert.equal(esportsNumber(null), "—");
  assert.equal(esportsNumber(NaN), "—");
  assert.equal(esportsNumber(Infinity), "—");
  assert.equal(esportsNumber(0), "0");
});

test("match centre exposes playoff filtering and a bounded load-more control", async () => {
  const page = await readFile(new URL("../src/pages/Esports.tsx", import.meta.url), "utf8");
  assert.match(page, /aria-label="Match stage"/);
  assert.match(page, /item === "playoffs".*setView\("all"\)/);
  assert.match(page, /hasMoreMatches && matchLimit < 500/);
  assert.match(page, /Load more matches/);
  assert.match(page, /Source-labelled playoff/);
});

test("team and game displays fall back explicitly", () => {
  assert.equal(teamName({}), "To be decided");
  assert.equal(teamCode({}), "TBD");
  assert.equal(teamName({ teamCode: "ONIC" }), "ONIC");
  assert.equal(teamCode({ teamName: "Team Falcons" }), "Team Falcons");
  assert.equal(gameDuration(null), "—");
  assert.equal(gameDuration(0), "0:00");
  assert.equal(gameDuration(847), "14:07");
});

const { hasCoaching } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("AI draft breakdowns render as chips, not raw markdown text", async () => {
  const details = await readFile(new URL("../src/components/EsportsDetails.tsx", import.meta.url), "utf8");
  const view = await readFile(new URL("../src/components/DraftBreakdown.tsx", import.meta.url), "utf8");
  // Both the match and multi-match analysis use the chip view.
  assert.equal((details.match(/<DraftBreakdown /g) ?? []).length, 2);
  assert.doesNotMatch(details, /whitespace-pre-wrap">\{result\.answer\}/);
  assert.doesNotMatch(details, /Grounded (sample )?analysis/);
  for (const label of ["Win condition", "How to execute", "Hero swap", "Deciding factor", "Takeaways for us", "Why · ", "How · "]) {
    assert.match(view, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(view, /executed: \{ label: "Executed"/);
  assert.match(view, /partial: \{ label: "Partly executed"/);
  assert.match(view, /failed: \{ label: "Not executed"/);
  // Hero chips use the bundled portraits; the swapped-out hero is struck through.
  assert.match(view, /<HeroImg name=\{hero\} size=\{24\}/);
  assert.match(view, /<HeroChip pick=\{\{ hero: swap\.out, player: swap\.player \}\} struck \/>/);
  assert.match(view, /<HeroChip pick=\{\{ hero: swap\.in, player: swap\.player \}\} highlight \/>/);
});

test("sources are presented as verified match data", async () => {
  const page = await readFile(new URL("../src/pages/Esports.tsx", import.meta.url), "utf8");
  const details = await readFile(new URL("../src/components/EsportsDetails.tsx", import.meta.url), "utf8");
  for (const text of [page, details]) {
    assert.doesNotMatch(text, /community-compiled|not independently verified|not official|source-reported drafts/);
  }
  assert.match(details, /Break down every draft: the win condition, how to execute it, and any hero swaps\./);
});

test("coaching is detected only when the AI supplied it", () => {
  const team = { key: "team1", picks: [], bans: [] };
  const facts = { headline: "", answer: "", takeaways: [], matches: [{ match_id: "M", teams: [], games: [{ number: 1, teams: [team] }] }] };
  assert.equal(hasCoaching(undefined), false);
  assert.equal(hasCoaching(facts), false);
  const coached = structuredClone(facts);
  coached.matches[0].games[0].teams[0].plan = { win_condition: "Snowball", execution: [], verdict: null, verdict_note: "", swaps: [] };
  assert.equal(hasCoaching(coached), true);
});
