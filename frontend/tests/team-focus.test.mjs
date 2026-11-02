import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/teamFocus.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { toTeamFocusDraft, parseDrillTarget, focusHasChanges, focusPayload } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const settings = { season_name: "S18", current_weakness: "Rotations", weakness_category: "MACRO", weakness_drills_target: 3 };

test("drill targets preserve zero and reject blank, negative, fractional and unsafe input", () => {
  for (const [input, expected] of [["0", 0], ["03", 3], [" 12 ", 12], ["9007199254740991", Number.MAX_SAFE_INTEGER]]) {
    assert.equal(parseDrillTarget(input), expected);
  }
  for (const input of ["", " ", "-1", "1.5", "1e2", "9007199254740992", "NaN"]) {
    assert.equal(parseDrillTarget(input), null, input);
  }
});

test("dirty state and payload retain exactly the settings being edited", () => {
  const draft = toTeamFocusDraft(settings);
  assert.equal(draft.weakness_drills_target, "3");
  assert.equal(focusHasChanges(draft, settings), false);
  assert.deepEqual(focusPayload(draft), settings);
  assert.deepEqual(settings, { season_name: "S18", current_weakness: "Rotations", weakness_category: "MACRO", weakness_drills_target: 3 });
  for (const [key, value] of Object.entries({ season_name: "S19", current_weakness: "Draft", weakness_category: "DRAFT", weakness_drills_target: "0" })) {
    assert.equal(focusHasChanges({ ...draft, [key]: value }, settings), true, key);
  }
  assert.equal(focusPayload({ ...draft, weakness_drills_target: "" }), null);
  assert.equal(focusPayload({ ...draft, weakness_drills_target: "0" }).weakness_drills_target, 0);
  assert.equal(focusPayload({ ...draft, current_weakness: "   \n" }).current_weakness, "");
  assert.equal(focusPayload({ ...draft, current_weakness: "  Rotations  " }).current_weakness, "  Rotations  ");
});
