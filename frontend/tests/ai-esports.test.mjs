import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/cloverAI.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const {AI_ESPORTS_MATCH_LIMIT, AI_MATCH_LIMIT, AI_BOARD_LIMIT} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('week analysis has its own bounded match limit without changing board or legacy selection limits', () => {
  assert.equal(AI_ESPORTS_MATCH_LIMIT, 500);
  assert.equal(AI_MATCH_LIMIT, 3);
  assert.equal(AI_BOARD_LIMIT, 2);
});

test('esports picker exposes source, region, season, week and bulk selection with honest source gaps', async () => {
  const picker = await readFile(new URL('../src/components/AIMatchPicker.tsx', import.meta.url), 'utf8');
  for (const phrase of ['Data source', 'MPL region', 'League / season', 'Use entire week', 'Use entire playoffs', 'Load more matches', 'Match stage']) assert.ok(picker.includes(phrase), phrase);
  assert.match(picker, /\/ai\/esports\/rone\/\$\{region\}\/\$\{phase === "playoffs" \? "playoffs" : "schedule"\}/);
  assert.match(picker, /\/ai\/esports\/aerena\/\$\{encodeURIComponent\(season\)\}\/matches/);
  assert.match(picker, /don’t identify a season/);
  assert.match(picker, /weekCount > AI_ESPORTS_MATCH_LIMIT/);
  assert.match(picker, /playoffCount > AI_ESPORTS_MATCH_LIMIT/);
  assert.match(picker, /Your selected matches stay selected when you switch stages/);
  assert.match(picker, /phase: chosenPhase/);
  assert.match(picker, /source, mode, region, \.\.\.\(source === "aerena"/);
  assert.doesNotMatch(picker, /DeepSeek|ChatGPT|Gemini/i);
});

test('chat sends source identifiers, renders load progress and clears the one-message attachment', async () => {
  const chat = await readFile(new URL('../src/pages/CloverAI.tsx', import.meta.url), 'utf8');
  assert.match(chat, /esports_selection: matches\[0\]\?\.selection/);
  assert.match(chat, /loading_matches:\(\\d\+\):\(\\d\+\)/);
  assert.match(chat, /Loading games for match \$\{loadProgress\}/);
  assert.match(chat, /setAttachedMatches\(\[\]\); setAttachedDrafts\(\[\]\); setAttachedMaps\(\[\]\)/);
  assert.match(chat, /Short follow-ups may reuse this public selection when chat history is enabled/);
});
