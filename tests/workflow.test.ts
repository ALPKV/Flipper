import assert from "node:assert/strict";
import { test } from "node:test";
import { planExport } from "../lib/video/export-plan.ts";
import { selectSounds, type Sound } from "../lib/tracking/hits.ts";
import { track, defaultTrackOptions, type Candidate } from "../lib/tracking/core.ts";
import { analyzeFrames } from "../lib/tracking/analyze.ts";

test("large original recordings recommend a single bounded-size compact export", () => {
  const plan = planExport(7.5e9, 1800, 300, 100, "auto", true);
  assert.equal(plan.precise, true);
  assert.equal(plan.fits, true);
  assert.ok(plan.estimatedBytes < 90e6);
});
test("small reels preserve original quality without unnecessary re-encoding", () => {
  assert.equal(planExport(100e6, 300, 20, 8, "auto", false).precise, false);
});
test("oversized single-file exports are rejected rather than creating surprise parts", () => {
  assert.equal(planExport(7.5e9, 1800, 1200, 400, "compact", true).fits, false);
  assert.equal(planExport(7.5e9, 1800, 300, 100, "original", true).fits, false);
});
test("noisy-hall filtering preserves strong impacts while rejecting weak rises and speech", () => {
  const sounds: Sound[] = [
    { t: 1, levelDb: -10, riseDb: 30, z: 90, voice: .1, voiceBefore: .1 },
    { t: 4, levelDb: -20, riseDb: 11, z: 90, voice: .1, voiceBefore: .1 },
    { t: 7, levelDb: -10, riseDb: 30, z: 90, voice: .9, voiceBefore: .1 },
  ];
  assert.deepEqual(selectSounds(sounds).map((s) => s.t), [1, 4]);
  assert.deepEqual(selectSounds(sounds, true).map((s) => s.t), [1]);
});
test("tracking follows elapsed time when video frames are unevenly spaced", () => {
  const times = [0, .02, .04, .10, .12, .14, .20, .22];
  const cands: Candidate[][] = times.map((t) => [{ x: 10 + t * 180, y: 30 + t * 120, area: 12, bw: 4, bh: 4 }]);
  const pts = track(cands, times, defaultTrackOptions(200, 200));
  assert.equal(pts.length, times.length);
});
test("tracking rejects malformed frame timing instead of producing invalid measurements", () => {
  assert.throws(() => analyzeFrames([], [], null), /three frames/);
});
