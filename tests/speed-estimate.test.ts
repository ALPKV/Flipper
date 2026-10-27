import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateSpeed } from "../lib/tracking/speed-estimate.ts";
const base = { release: 1, contact: 1.6, frameSeconds: 1/120, distanceM: 17.68, distanceErrorM: .5, soundDistanceM: 0 };
test("speed uses distance and actual timestamps", () => {
  const r = estimateSpeed(base)!;
  assert.ok(Math.abs(r.kmh - 106.08)<1e-8);
  assert.ok(r.low < r.kmh && r.high > r.kmh);
});
test("acoustic correction removes sound travel from flight time", () => {
  const r = estimateSpeed({...base, contact: base.contact + 24/343, soundDistanceM: 24})!;
  assert.ok(Math.abs(r.kmh - 106.08)<1e-8);
});
test("higher frame rates narrow timing bounds", () => {
  const a = estimateSpeed({...base, frameSeconds:1/30})!, b = estimateSpeed(base)!;
  assert.equal(a.kmh,b.kmh);
  assert.ok(a.high-a.low > b.high-b.low);
});
test("invalid inputs and impossible timing do not produce speed", () => {
  for (const change of [{distanceM:0},{contact:1},{contact:NaN},{frameSeconds:0},{distanceErrorM:18},{soundDistanceM:-1}])
    assert.equal(estimateSpeed({...base,...change}),null);
});
