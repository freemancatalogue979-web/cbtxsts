import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/cloverAI.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { safeExternal, shortDate, toggleMatchSelection, AI_MATCH_LIMIT, toggleBoardSelection, AI_BOARD_LIMIT, collectAIExport, AI_EXPORT_LIMIT, revealAIComposer, readAIWorkspaceLayout, saveAIWorkspaceLayout, AI_WORKSPACE_LAYOUT_KEY } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("source links require HTTPS and reject credentials and private hosts", () => {
  for (const value of [null, "", "javascript:alert(1)", "http://example.com", "https://a:b@example.com", "https://localhost/a", "https://foo.local/a", "https://127.1/a", "https://10.0.0.1", "https://192.168.1.4", "https://[::1]/"]) {
    assert.equal(safeExternal(value), undefined, String(value));
  }
  assert.equal(safeExternal("https://example.com/source"), "https://example.com/source");
});

test("missing and malformed source dates stay unknown", () => {
  assert.equal(shortDate(null), "Date unknown");
  assert.equal(shortDate("not-a-date"), "Date unknown");
  assert.notEqual(shortDate("2026-11-01T00:00:00Z"), "Date unknown");
});

test("match selection is explicit, removable and limited to three", () => {
  assert.equal(AI_MATCH_LIMIT, 3);
  const matches = [1, 2, 3, 4].map((id) => ({ id: String(id) }));
  let selected = [];
  for (const match of matches) selected = toggleMatchSelection(selected, match);
  assert.deepEqual(selected.map((m) => m.id), ["1", "2", "3"]);
  const old = selected;
  selected = toggleMatchSelection(selected, matches[1]);
  assert.deepEqual(selected.map((m) => m.id), ["1", "3"]);
  assert.deepEqual(old.map((m) => m.id), ["1", "2", "3"]);
  selected = toggleMatchSelection(selected, matches[3]);
  assert.deepEqual(selected.map((m) => m.id), ["1", "3", "4"]);
});

test("board selection is explicit, removable and limited independently for each lab", () => {
  assert.equal(AI_BOARD_LIMIT, 2);
  const boards = [1, 2, 3].map((id) => ({ id }));
  let drafts = [], maps = [];
  for (const board of boards) drafts = toggleBoardSelection(drafts, board);
  maps = toggleBoardSelection(maps, boards[2]);
  assert.deepEqual(drafts.map((board) => board.id), [1, 2]);
  assert.deepEqual(maps.map((board) => board.id), [3]);
  drafts = toggleBoardSelection(drafts, boards[0]);
  drafts = toggleBoardSelection(drafts, boards[2]);
  assert.deepEqual(drafts.map((board) => board.id), [2, 3]);
});

function exportPage(ids, through, next) {
  return {
    format: "9clover-ai-conversation-v1", exported_at: "2026-11-01T00:00:00Z",
    conversation: { id: "chat-1", title: "Private", created_at: "", updated_at: "" },
    messages: ids.map((id) => ({ id })), truncated: next !== null,
    message_limit: 500, snapshot_through: through, next_after: next, notice: "Plaintext",
  };
}

test("conversation export follows one snapshot and rejects mixed or looping pages", async () => {
  const calls = [];
  const first = exportPage([1, 2], 4, 2);
  const result = await collectAIExport(first, async (after, through) => {
    calls.push([after, through]); return exportPage([3, 4], 4, null);
  });
  assert.deepEqual(calls, [[2, 4]]);
  assert.deepEqual(result.messages.map((m) => m.id), [1, 2, 3, 4]);
  assert.equal(result.truncated, false);
  assert.equal(result.message_limit, AI_EXPORT_LIMIT);
  await assert.rejects(() => collectAIExport(first, async () => exportPage([3], 5, null)), /snapshot changed/);
  await assert.rejects(() => collectAIExport(first, async () => exportPage([2, 3], 4, null)), /Invalid export page/);
  await assert.rejects(() => collectAIExport(exportPage([], 4, 0), async () => { throw Error("should not fetch"); }), /continue this export safely/);
});

test("large exports are bounded and explicitly marked partial", async () => {
  const ids = (from) => Array.from({ length: 500 }, (_, i) => from + i);
  const first = exportPage(ids(1), 2500, 500);
  let fetched = 0;
  const result = await collectAIExport(first, async (after, through) => {
    fetched++;
    return exportPage(ids(after + 1), through, after + 500);
  });
  assert.equal(fetched, 3);
  assert.equal(result.messages.length, 2000);
  assert.equal(result.messages.at(-1).id, 2000);
  assert.equal(result.truncated, true);
  assert.equal(result.next_after, 2000);
});

test("mobile composer is revealed above fixed navigation while desktop stays put", () => {
  const calls = [];
  const element = { scrollIntoView: (options) => calls.push(options) };
  revealAIComposer(element, 320);
  revealAIComposer(element, 767);
  revealAIComposer(element, 768);
  assert.deepEqual(calls, [{ block: "center", behavior: "auto" }, { block: "center", behavior: "auto" }]);
});

test("desktop layout preferences persist safely and reject malformed values", () => {
  const defaults = { navigationOpen: true, historyOpen: true, headerOpen: true };
  assert.deepEqual(readAIWorkspaceLayout(null), defaults);
  assert.deepEqual(readAIWorkspaceLayout({ getItem: () => "not json" }), defaults);
  assert.deepEqual(readAIWorkspaceLayout({ getItem: () => "[]" }), defaults);
  assert.deepEqual(readAIWorkspaceLayout({ getItem: () => '"false"' }), defaults);
  assert.deepEqual(readAIWorkspaceLayout({ getItem: () => { throw Error("blocked"); } }), defaults);
  assert.deepEqual(readAIWorkspaceLayout({ getItem: () => JSON.stringify({ navigationOpen: false, historyOpen: "false", headerOpen: null }) }),
    { navigationOpen: false, historyOpen: true, headerOpen: true });

  let value = "";
  const storage = { getItem: () => value, setItem: (key, content) => { assert.equal(key, AI_WORKSPACE_LAYOUT_KEY); value = content; } };
  const layout = { navigationOpen: false, historyOpen: false, headerOpen: false };
  saveAIWorkspaceLayout(storage, layout);
  assert.deepEqual(readAIWorkspaceLayout(storage), layout);
  assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ["headerOpen", "historyOpen", "navigationOpen"]);
  assert.doesNotThrow(() => saveAIWorkspaceLayout({ setItem: () => { throw Error("blocked"); } }, layout));
});
