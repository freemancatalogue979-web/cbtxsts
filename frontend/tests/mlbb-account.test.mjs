import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../src/pages/AccountMLBB.tsx", import.meta.url), "utf8");

test("my MLBB page reads the readable Moonton rows", () => {
  assert.match(page, /export function MatchList/);
  assert.match(page, /export function HeroList/);
  assert.match(page, /data\.records/);
  for (const key of ["kills", "deaths", "assists", "win_rate", "hero_name", "match_time"]) assert.ok(page.includes(`"${key}"`) || page.includes(`.${key}`), key);
  assert.doesNotMatch(page, /ListSection/);
});

test("linking copy: Moonton direct, in-game mail code, no fixed digit count", () => {
  assert.match(page, /Moonton/);
  assert.match(page, /Code from your in-game mail/);
  assert.doesNotMatch(page, /6-digit/);
  assert.doesNotMatch(page, /deprecated/);
});

test("hero faces come from the local pack first", () => {
  assert.match(page, /import \{ HeroImg \} from "\.\.\/components\/HeroImg"/);
});

test("errors show what MLBB actually said, plus reconnect and a connection check", () => {
  assert.match(page, /function reason\(/);
  assert.match(page, /"message"/);
  assert.match(page, /relink === true/);
  assert.match(page, /session_expired/);
  assert.match(page, /export function ConnectionCheck/);
  assert.match(page, /Refresh your MLBB sign-in/);
  assert.doesNotMatch(page, /try Refresh in a bit/);
});
