import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/mapElements.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { removeStepPreservingBranches, detachStepAnchors, detachZoneAnchors } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("deleting a step keeps its direct branches and their children", () => {
  const steps = [
    { id: "s1", points: [[10, 10], [20, 20]] },
    { id: "s2", parentId: "s1", points: [[1, 1], [30, 30]], extra: "keep" },
    { id: "s3", parentId: "s1", points: [[1, 1], [40, 40]] },
    { id: "s4", parentId: "s2", points: [[30, 30], [50, 50]] },
  ];
  const result = removeStepPreservingBranches(steps, "s1");
  assert.deepEqual(result.map((step) => step.id), ["s2", "s3", "s4"]);
  assert.equal(result[0].parentId, undefined);
  assert.equal(result[1].parentId, undefined);
  assert.deepEqual(result[0].points[0], [20, 20]);
  assert.deepEqual(result[1].points[0], [20, 20]);
  assert.equal(result[0].extra, "keep");
  assert.equal(result[2].parentId, "s2");
  assert.equal(steps[1].parentId, "s1", "the undo snapshot is not mutated");
});

test("removing a hero or chip detaches routes and zones at its last position", () => {
  for (const key of ["tokenId", "chipId"]) {
    const steps = [{ id: "s1", [key]: "anchor", points: [[1, 1], [60, 60]] }, { id: "s2", parentId: "s1", points: [[60, 60], [80, 80]] }];
    const zones = [{ id: "z1", [key]: "anchor", x: 1, y: 1, radius: 20 }, { id: "z2", x: 3, y: 3, radius: 15 }];
    const routes = detachStepAnchors(steps, key, "anchor", 45, 55);
    const coverage = detachZoneAnchors(zones, key, "anchor", 45, 55);
    assert.equal(routes.length, 2);
    assert.equal(routes[0][key], undefined);
    assert.deepEqual(routes[0].points[0], [45, 55]);
    assert.equal(routes[1].parentId, "s1");
    assert.equal(coverage.length, 2);
    assert.equal(coverage[0][key], undefined);
    assert.deepEqual([coverage[0].x, coverage[0].y], [45, 55]);
    assert.deepEqual(coverage[1], zones[1]);
    assert.equal(steps[0][key], "anchor");
    assert.equal(zones[0][key], "anchor");
  }
});
