import assert from "node:assert/strict";
import { test } from "node:test";
import { actionPeaks, coverage, fuseDeliveries, motionFraction, repairWindows } from "../lib/tracking/visual-deliveries.ts";
import { clipWindows, deliveryId } from "../lib/tracking/deliveries.ts";

test("motion detects an action in silence without requiring a ball or bat sound", () => {
  const series = { t: Array.from({ length: 80 }, (_, i) => i * .2), m: Array.from({ length: 80 }, (_, i) => .005 + Math.max(0, 1 - Math.abs(i - 30) / 4) * .15) };
  const peaks = actionPeaks(series);
  assert.equal(peaks.length, 1);
  assert.ok(Math.abs(peaks[0].t - 6) < .3);
  const deliveries = fuseDeliveries([], peaks, coverage(series.t));
  assert.equal(deliveries[0].kind, "motion");
  assert.equal(deliveries[0].t, peaks[0].t, "do not fabricate a contact time");
});
test("one visual action and matching contact produce one clip", () => {
  const deliveries = fuseDeliveries([{ t: 10.8, rel: -5 }], [{ t: 10, strength: .1 }], [[0, 20]]);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].kind, "bat");
  assert.equal(deliveries[0].t, 10.8);
});
test("audio in unseen intervals survives; fully covered unrelated noise is filtered", () => {
  const deliveries = fuseDeliveries([{ t: 5, rel: 0 }, { t: 15, rel: 0 }], [], [[0, 10]]);
  assert.deepEqual(deliveries.map((d) => d.t), [15]);
});
test("large decoder gaps cannot be bridged into a visual action", () => {
  const series = { t: [0, .2, .4, 10, 10.2, 10.4], m: [0, 0, 0, .2, .2, .2] };
  assert.equal(actionPeaks(series).length, 0);
  assert.equal(coverage(series.t).length, 2);
});
test("visual clips have distinct IDs and enough follow-through without a contact mark", () => {
  const d = { t: 5, rel: 0, kind: "motion" as const };
  assert.equal(deliveryId(d), "v5.000");
  const [window] = clipWindows([d], 1, 2.5, 20);
  assert.equal(window.start, 4);
  assert.equal(window.end, 7.5);
});
test("static footage and mismatched frame buffers do not register motion", () => {
  assert.equal(motionFraction(new Uint8Array(10), new Uint8Array(10)), 0);
  assert.equal(motionFraction(new Uint8Array(1), new Uint8Array(10)), 0);
});


test("missing-frame repair covers the beginning, internal holes, and end with context", () => {
  assert.deepEqual(repairWindows([3, 3.2, 3.4, 7, 7.2, 7.4], 10), [[0, 10]]);
  assert.deepEqual(repairWindows(Array.from({length: 51}, (_, i) => i * .2), 10), []);
});
test("an early noise with fully observed video does not survive just because pre-roll is negative", () => {
  assert.equal(fuseDeliveries([{t: .3, rel: 0}], [], [[0, 10]]).length, 0);
  assert.equal(fuseDeliveries([{t: .3, rel: 0}], [], [[2, 10]]).length, 1);
});

test("follow-through immediately after contact does not become a second clip", () => {
  const events = fuseDeliveries([{t: 10.8, rel: 0}], [{t: 10, strength: .1}, {t: 12, strength: .1}], [[0, 20]]);
  assert.equal(events.length, 1);
});
