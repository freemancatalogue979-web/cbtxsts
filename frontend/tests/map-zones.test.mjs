import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/mapZones.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { zoneCenter, zoneDistance, zoneRadius, closestMapItem, distanceToPath, MIN_ZONE_RADIUS, MAX_ZONE_RADIUS } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("zones follow their hero or chip and keep a fallback center", () => {
  const hero = { id: "h1", hero: "Miya", side: "ours", x: 30, y: 40 };
  const chip = { id: "c1", name: "Blue buff", color: "#818cf8", size: 52, x: 70, y: 80 };
  const zone = { id: "z1", x: 10, y: 20, radius: 24, color: "#34d399", tokenId: "h1" };
  assert.deepEqual(zoneCenter(zone, [hero], [chip]), [30, 40]);
  assert.deepEqual(zoneCenter(zone, [{ ...hero, x: 55, y: 65 }], [chip]), [55, 65]);
  assert.deepEqual(zoneCenter({ ...zone, tokenId: undefined, chipId: "c1" }, [hero], [chip]), [70, 80]);
  assert.deepEqual(zoneCenter(zone, [], []), [10, 20]);
});

test("radius stays circular on the rectangular game map and respects its bounds", () => {
  const aspect = 1870 / 841, center = [50, 50];
  assert(Math.abs(zoneDistance(center, [50 + 20 / aspect, 50], aspect) - 20) < 0.001);
  assert.equal(zoneDistance(center, [50, 70], aspect), 20);
  assert.equal(zoneRadius(center, center, aspect), MIN_ZONE_RADIUS);
  assert.equal(zoneRadius(center, [200, 200], aspect), MAX_ZONE_RADIUS);
  assert.equal(zoneRadius(center, [50, 73.4], aspect), 23.4);
});

test("selection picks the closest outline, not another nearby element", () => {
  const zone = { id: "z1", center: [50, 50], radius: 25 };
  const path = { kind: "path", id: "p1", points: [[30, 27], [70, 27]] };
  assert.equal(distanceToPath(50, 25, path.points, 2), 2);
  assert.deepEqual(closestMapItem([50, 25], 2, 5, [zone], [path]), { kind: "zone", id: "z1" });
  assert.deepEqual(closestMapItem([50, 27], 2, 5, [zone], [path]), { kind: "path", id: "p1" });
  assert.deepEqual(closestMapItem([50, 50], 2, 5, [zone], []), { kind: "zone", id: "z1" });
  const onEdge = { kind: "step", id: "s1", points: [[30, 25], [70, 25]] };
  assert.deepEqual(closestMapItem([50, 25], 2, 5, [zone], [onEdge]), { kind: "step", id: "s1" });
  assert.equal(closestMapItem([0, 0], 2, 5, [zone], [path]), null);
});
